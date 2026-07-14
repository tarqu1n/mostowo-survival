/**
 * Editor document store (plan 014 step 5, extended steps 6-7) — the SINGLE React↔Phaser bridge. React
 * components subscribe via the `useEditorStore` hook; the Phaser `EditorScene` reads via
 * `useEditorStore.getState()` and `useEditorStore.subscribe(selector, listener)`. Neither side
 * imports the other; both talk only to this store.
 *
 * Every document mutation routes through the encapsulated `HistoryStack` (`applyCommand`/`undo`/
 * `redo`), so undo/redo is uniform. Two counters signal the Phaser scene what to do without it
 * re-diffing the whole `MapFile`:
 *  - `mapEpoch` bumps when the WHOLE document is replaced (New/Open/Close) → full texture (re)load,
 *    bake and camera fit.
 *  - `docRevision` bumps on every in-place edit (applyCommand/undo/redo) → rebake. Paint actions also
 *    populate `pendingDirty` (consumed+cleared by `EditorScene.onDocEdited`) so a brush/eraser/fill/
 *    rect edit rebakes only the touched chunks of the active layer instead of the whole map; anything
 *    that doesn't set it (undo/redo, layer add/rename/delete/reorder/overhead, favourites) falls back
 *    to the existing full chunked rebake — correct, just not narrowed (acceptable: none of those are
 *    a per-cell hot path like a paint drag). Layer reorder needs no extra signal beyond that fallback:
 *    `EditorScene`'s per-chunk rebake re-reads `map.layers[layerIndex]` by ARRAY POSITION every time,
 *    and a chunk-RT's depth is fixed to that same position at creation — so re-running the full
 *    per-chunk loop after `map.layers` has been reordered already redraws the right content at the
 *    right depth with no depth-reassignment step. Layer ADD/DELETE change `map.layers.length`, which
 *    `onDocEdited` already detects to trigger a full `syncDocument()` rebuild (new/removed RT).
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  createEmptyMap,
  isInside,
  type DecorAnim,
  type DecorObject,
  type DecorRegion,
  type MapFile,
  type MapObject,
  type NodeObject,
  type PortalFacing,
  type PortalObject,
  type PortalRect,
  type TileLayer,
} from '../../systems/mapFormat';
import type { TileSource } from '../../data/tileset';
import type { WorldLayout } from '../../systems/worldLayout';
import { GROUND_CHUNK_ROWS } from '../../config';
import type { AssetCatalog } from '../catalog';
import { parseAssetId } from '../textureLoading';
import {
  cellsToChanges,
  findOrAppendPaletteIndex,
  floodFill,
  lineCells,
  rectCells,
} from '../paintOps';
import { footprintIsValid, nextObjectId } from '../objectOps';
import { HistoryStack, type Command } from './history';

/** A central-pane tab (plan 017 step 1). `map`/`world` are the two permanent, non-closable tabs; an
 *  `object` tab is opened on demand from the Library's ⚙ (one per asset) and can be closed. The id is
 *  deterministic — `map` / `world` / `object:<assetId>` — so `openObjectTab` dedupes with a plain
 *  `find` and no separate lookup table is needed. */
export type EditorTab =
  | { id: 'map'; kind: 'map' }
  | { id: 'world'; kind: 'world' }
  | { id: string; kind: 'object'; assetId: string };

export type EditorTool =
  | 'pan'
  | 'brush'
  | 'eraser'
  | 'fill'
  | 'rect'
  | 'select'
  | 'collision'
  | 'zone'
  | 'shape'
  | 'place'
  | 'portal';

/** A drag/commit delta for `translateObjects` — px for decor (`dxPx`/`dyPx`), tile steps for
 *  node/portal (`dCol`/`dRow`, always whole tiles — see module doc on nodes/portals being inherently
 *  tile-addressed). A caller only cares about the pair relevant to the object kinds it's moving; the
 *  other pair is simply unused for those objects. */
export interface TranslateDelta {
  dxPx: number;
  dyPx: number;
  dCol: number;
  dRow: number;
}

export interface EditorOverlays {
  grid: boolean;
  walkability: boolean;
  zones: boolean;
  ghosts: boolean;
}

/**
 * A catalog asset armed for `decor` placement (plan 014 step 7b), carrying the chosen crop/anim
 * alongside the asset id so the Library's atlas-hotspot / animated-strip pickers can pass a specific
 * sprite through to `placeDecor` without a second lookup. Mutually exclusive (an armed asset is a
 * plain whole-image placement, a `region` crop, or an `anim` strip, never more than one) — the Library
 * only ever constructs one of the three shapes, mirroring `DecorObject`'s own region/anim exclusivity.
 * `anim` omits `fps`: placement always stamps `DECOR_ANIM_DEFAULT_FPS` (critique #6 — no per-instance
 * editable fps in v1), so there's nothing to carry here. `anim` may also carry an optional
 * `omit: number[]` (plan 017 step 6) — row-major cell indices, `0..frames-1`, to skip; the played set
 * is `[0..frames-1]` minus `omit`. Since `Omit<DecorAnim, 'fps'>` keeps every other `DecorAnim` field
 * verbatim, `omit` already threads through unchanged — `placeDecor`'s `{ ...anim, fps }` spread stamps
 * it onto `DecorObject.anim` with no dedicated handling needed.
 */
export interface ArmedObjectAsset {
  assetId: string;
  region?: DecorRegion;
  anim?: Omit<DecorAnim, 'fps'>;
}

/** Fixed animation rate every placed `anim` decor gets stamped with (critique #6: no per-instance
 *  editable fps field in v1 — the game will use fixed anim-framerate constants of its own, e.g.
 *  `ACTION_ANIM_FRAMERATE`/`DEATH_ANIM_FRAMERATE` in `src/config.ts`). `fps` still lives in the
 *  `DecorObject.anim` schema (see mapFormat's module doc) so the loader stays catalog-independent —
 *  it just isn't an authoring knob yet. */
export const DECOR_ANIM_DEFAULT_FPS = 8;

/** Loaded asset catalog (`AssetCatalog`, see `catalog.ts`). The Library panel fetches + narrows
 *  `asset-catalog.json` on mount and populates this via `setCatalog`; `null` until then. */
export type EditorCatalog = AssetCatalog | null;

/** Chunks of ONE layer touched by the most recent paint command — see module doc. `chunks` are the
 *  `Math.floor(row / GROUND_CHUNK_ROWS)` indices `EditorScene` should rebake; everything else on that
 *  layer is left untouched. */
export interface PendingDirty {
  layerIndex: number;
  chunks: number[];
}

const EMPTY_WORLD: WorldLayout = { schemaVersion: 1, placements: [] };

export interface EditorState {
  /** Central-pane tabs (plan 017 step 1). Always leads with the permanent `map` + `world` tabs;
   *  object tabs are appended by `openObjectTab`. */
  tabs: EditorTab[];
  /** Id of the currently-shown tab. Defaults to `'map'`; never dangles (close/reconcile always
   *  re-point it to a live tab, `'map'` at worst). */
  activeTabId: string;
  map: MapFile | null;
  mapId: string | null;
  dirty: boolean;
  world: WorldLayout;
  catalog: EditorCatalog;
  activeLayerId: string | null;
  activeTool: EditorTool;
  brushAsset: string | null;
  /** A catalog asset (+ optional chosen `region`/`anim`) clicked in the Library, "arming" `decor`
   *  placement for the `place` tool. Mutually exclusive with `armedNodeRef` (arming one clears the
   *  other — only one thing is ever armed at a time). */
  armedObjectAsset: ArmedObjectAsset | null;
  /** A `NODES` key clicked in the Library's "Nodes" section, arming `node` placement for the `place`
   *  tool. Mutually exclusive with `armedObjectAsset`. */
  armedNodeRef: string | null;
  /** Decor placement/drag snaps to `snapToTileCenter` (`src/systems/grid.ts`) when true (the
   *  default); holding Alt while placing/dragging always forces free-pixel placement regardless of
   *  this flag. Nodes/portals are always tile-snapped (col/row addressed) — this flag only affects
   *  decor. */
  snapToTileCenter: boolean;
  /** A tile rect just drawn with the Portal tool, awaiting the name/facing dialog (`PortalDialog`).
   *  Set on pointer-up of a valid (non-void) portal drag; cleared on dialog confirm/cancel. */
  pendingPortalRect: PortalRect | null;
  selectedObjectIds: string[];
  activeZoneId: number | null;
  overlays: EditorOverlays;
  /** Editor VIEW state, not map data — which layer ids are hidden in the viewport. Never touches
   *  `MapFile`/`TileLayer` (those have no visibility field; see module doc on `overhead` vs this). */
  hiddenLayerIds: string[];
  /** See module doc. Set by paint actions just before `applyCommand`; consumed+cleared by
   *  `EditorScene.onDocEdited` via `consumePendingDirty`. */
  pendingDirty: PendingDirty | null;

  /** Full-reload signal (see module doc). */
  mapEpoch: number;
  /** In-place-edit signal (see module doc). */
  docRevision: number;
  canUndo: boolean;
  canRedo: boolean;

  // ---- actions (all document mutations route through the history stack) ----
  newMap(id: string, name: string, width: number, height: number): void;
  loadMap(map: MapFile, id: string): void;
  closeMap(): void;
  /** Opens (find-or-append) the `object:<assetId>` tab and activates it — a no-duplicate open, since
   *  the id is deterministic. */
  openObjectTab(assetId: string): void;
  /** Activates the tab with `id` if it exists; a no-op otherwise. */
  activateTab(id: string): void;
  /** Closes an object tab. No-op for the permanent `map`/`world` tabs. If the closed tab was active,
   *  activates its left neighbour (the tab that sat at the closed index − 1), falling back to `'map'`. */
  closeTab(id: string): void;
  setActiveLayer(layerId: string): void;
  setActiveTool(tool: EditorTool): void;
  setBrushAsset(asset: string | null): void;
  setArmedObjectAsset(armed: ArmedObjectAsset | null): void;
  setArmedNodeRef(ref: string | null): void;
  setSnapToTileCenter(enabled: boolean): void;
  setPendingPortalRect(rect: PortalRect | null): void;
  setSelectedObjectIds(ids: string[]): void;
  setActiveZoneId(id: number | null): void;
  toggleOverlay(key: keyof EditorOverlays): void;
  toggleLayerVisibility(layerId: string): void;
  setWorld(world: WorldLayout): void;
  setCatalog(catalog: EditorCatalog): void;
  markSaved(): void;
  applyCommand(cmd: Command): void;
  undo(): void;
  redo(): void;
  /** Read + clear `pendingDirty` in one step — `EditorScene` calls this once per rebake so a stale
   *  value never lingers into an unrelated edit. */
  consumePendingDirty(): PendingDirty | null;

  // ---- painting (step 6) ----
  /** Brush stroke: paints every cell along the segment `(fromCol,fromRow)`→`(toCol,toRow)` on the
   *  active layer with the resolved `brushAsset` (palette find-or-append). `strokeId` coalesces a
   *  whole drag into one undo entry (mint a fresh id on pointer-down, reuse it for every move/up). */
  paintLine(fromCol: number, fromRow: number, toCol: number, toRow: number, strokeId: string): void;
  /** Eraser stroke: sets every cell along the segment to 0 on the active layer. */
  eraseLine(fromCol: number, fromRow: number, toCol: number, toRow: number, strokeId: string): void;
  /** Flood fill from `(col,row)` on the active layer, bounded by the shape mask. Fills with the
   *  resolved `brushAsset` if one is set, else with 0 (an "erase fill") — see module doc on why fill
   *  doesn't strictly require a brush. */
  fillFrom(col: number, row: number): void;
  /** Rect tool: fills the normalized rectangle spanning the two corners on the active layer with the
   *  resolved `brushAsset`. One command (not stroke-coalesced — a single press-drag-release). */
  paintRectArea(c0: number, r0: number, c1: number, r1: number): void;

  // ---- layers (step 6) ----
  addLayer(name?: string): void;
  renameLayer(layerId: string, name: string): void;
  deleteLayer(layerId: string): void;
  /** Moves a layer one slot toward the front (renders later/"on top") or back (renders earlier/
   *  "underneath") of `map.layers` — mirrors the bring-forward/send-back language step 7 uses for
   *  decor stacking, avoiding an ambiguous up/down (list position vs. render stack) reading. */
  moveLayer(layerId: string, direction: 'forward' | 'backward'): void;
  toggleLayerOverhead(layerId: string): void;

  // ---- favourites (step 6) ----
  /** Toggles `assetId` in the active zone's favourites (`zones.defs[activeZoneId].favourites`) when a
   *  zone is active, else in the map-level `meta.favourites` (created lazily on first use). */
  toggleFavourite(assetId: string): void;

  // ---- objects: place, transform, stack, portals (step 7) ----
  /** Places a `decor` object at `(x,y)` px with the default cosmetic transform (scale 1, rotation 0,
   *  no flip, depth 0, no collision) and an auto `decor_NNNN` id; selects it. An optional `region`
   *  (atlas crop) or `anim` (animated strip, minus `fps` — see `ArmedObjectAsset`/
   *  `DECOR_ANIM_DEFAULT_FPS`) is written onto the new object exactly as `mapFormat` expects (mutually
   *  exclusive, omitted when absent). Refuses (returns `false`, no mutation) if its anchor tile is
   *  void/out-of-bounds — matches `parseMap`'s void-consistency invariant. */
  placeDecor(
    asset: string,
    x: number,
    y: number,
    region?: DecorRegion,
    anim?: Omit<DecorAnim, 'fps'>,
  ): boolean;
  /** Places a `kind:'node'` object referencing a `NODES` key at `(col,row)`; auto `node_NNNN` id;
   *  selects it. Void-rejected like `placeDecor`. */
  placeNode(ref: string, col: number, row: number): boolean;
  /** Creates a `kind:'portal'` object from a drawn rect + the dialog's name/facing; auto
   *  `portal_NNNN` id; selects it. Void-rejected (every rect cell must be inside) like the above. */
  createPortal(rect: PortalRect, name: string, facing: PortalFacing): boolean;
  /** Commits a select-tool drag: applies `delta` to every object in `ids` (decor via px, node/portal
   *  via tile steps — each object only reads the pair relevant to its kind), as ONE undoable command.
   *  Validates the PROSPECTIVE footprint of every target first; if any would land on void/
   *  out-of-bounds, the whole move is refused (no mutation, returns `false`) — the caller (EditorScene)
   *  then redraws from the unchanged map to snap its live-preview sprites back. A zero delta is a
   *  no-op (returns `true`, no history entry — a click-without-drag shouldn't create undo noise). */
  translateObjects(ids: string[], delta: TranslateDelta): boolean;
  /** Removes every object in `ids` as one undoable command (reinserted at their original array
   *  indices on undo, preserving order); `selectedObjectIds` is reconciled (stale ids dropped)
   *  automatically by `applyCommand`. */
  deleteObjects(ids: string[]): void;
  /** Duplicates every object in `ids` with fresh auto ids, offset by one tile (px for decor, col/row
   *  for node/portal) when that offset stays void-valid, else stacked at the exact same position
   *  (always valid, since the source object's footprint already was) — duplication never silently
   *  drops an object. One undoable command; selects the new copies; returns their ids. */
  duplicateObjects(ids: string[]): string[];
  /** Patches a `decor` object's fields (Inspector numeric/checkbox edits). Patches touching `x`/`y`/
   *  `collision` are footprint-validated before applying (refused, returns `false`, if they'd land on
   *  void); patches to purely cosmetic fields (scale/rotation/flip/depth) always apply. One undoable
   *  command per call. */
  updateDecor(id: string, patch: Partial<Omit<DecorObject, 'id' | 'kind' | 'asset'>>): boolean;
  /** Patches a `node` object's `col`/`row` (Inspector fields); footprint-validated. */
  updateNode(id: string, patch: Partial<Pick<NodeObject, 'col' | 'row'>>): boolean;
  /** Patches a `portal` object's `name`/`facing`/`rect` (Inspector fields); a `rect` patch is
   *  footprint-validated (every cell of the new rect must stay inside). */
  updatePortal(id: string, patch: Partial<Pick<PortalObject, 'name' | 'facing' | 'rect'>>): boolean;
  /** Bumps `rotation` by `deltaDeg` (e.g. ±90 from the Inspector's rotate buttons) on every `decor`
   *  object in `ids` as one undoable command; node/portal ids are silently skipped (no rotation
   *  concept). Free/arbitrary rotation goes through `updateDecor` directly (the field accepts any
   *  degree value). */
  rotateObjects(ids: string[], deltaDeg: number): void;
  /** Toggles `flipX` (`axis:'x'`) or `flipY` (`axis:'y'`) on every `decor` object in `ids`, one
   *  undoable command; node/portal ids skipped. */
  flipObjects(ids: string[], axis: 'x' | 'y'): void;
  /** Adds `delta` to `depth` on every `decor` object in `ids` (bring-forward = +1, send-back = -1),
   *  one undoable command; node/portal ids skipped (they don't stack via `depth`). */
  bumpDepth(ids: string[], delta: number): void;
}

// One history stack for the single editor document. Encapsulated here (not exported): the store is
// the only thing that mutates it; React/Phaser observe via `docRevision`/`canUndo`/`canRedo`.
const history = new HistoryStack();

/** If `activeLayerId` no longer names a layer in `map` (deleted, or an undo removed it), fall back to
 *  the first layer, or `null` for an empty layer set. Called after every history-stack move so the
 *  active-layer selection never dangles. */
function reconcileActiveLayer(map: MapFile | null, activeLayerId: string | null): string | null {
  if (!map) return null;
  if (activeLayerId && map.layers.some((l) => l.id === activeLayerId)) return activeLayerId;
  return map.layers[0]?.id ?? null;
}

/** Resolve the current `brushAsset` (a catalog id, optionally `#frame`) to a palette index in `map`,
 *  find-or-appending as needed (mutates `map.palette` directly — NOT part of the undo/redo history,
 *  see `findOrAppendPaletteIndex`'s doc). No brush selected, or a malformed asset id, resolves to `0`
 *  (empty) — callers gate brush/rect on a brush being set in the UI; this is just a safe fallback. */
function resolveBrushValue(map: MapFile, brushAsset: string | null): number {
  if (!brushAsset) return 0;
  try {
    const { pack, path, frame } = parseAssetId(brushAsset);
    const source: TileSource =
      frame === undefined ? { kind: 'image', path } : { kind: 'sheetFrame', sheet: path, frame };
    return findOrAppendPaletteIndex(map, pack, source);
  } catch (e) {
    console.warn(`[editor] invalid brushAsset "${brushAsset}": ${(e as Error).message}`);
    return 0;
  }
}

/** Next auto `layer_NNNN` id — scans existing ids so re-adding after deletes never collides. */
function nextLayerId(map: MapFile): string {
  let max = 0;
  for (const layer of map.layers) {
    const m = /^layer_(\d+)$/.exec(layer.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `layer_${String(max + 1).padStart(4, '0')}`;
}

/** Filters `ids` down to ones that still name an object in `map` — called after every history-stack
 *  move (mirrors `reconcileActiveLayer`) so `selectedObjectIds` never dangles on a deleted/undone
 *  object. Deliberately only DROPS stale ids; it never re-adds one (e.g. undoing a delete restores
 *  the object to `map.objects` but does not restore its prior selection — there's no stale reference
 *  to clean up in that direction). */
function reconcileSelection(map: MapFile | null, ids: string[]): string[] {
  if (!map) return [];
  const existing = new Set(map.objects.map((o) => o.id));
  return ids.filter((id) => existing.has(id));
}

/** Drop object tabs whose asset is gone from the fresh catalog, and re-point `activeTabId` if it
 *  pointed at a dropped tab. Net-new defensive code (NOT an existing reconcile pattern): a reclassify
 *  never changes an asset id, so this only fires if an asset file is removed/renamed on disk and the
 *  catalog regenerates without it. `map`/`world` are always kept; an object tab survives iff the
 *  catalog is non-null AND still lists its `assetId`. A null catalog (the initial/cleared state) keeps
 *  every tab unchanged — we don't nuke tabs just because the catalog hasn't loaded. A dropped active
 *  tab falls back to `'map'`. */
function reconcileTabs(
  tabs: EditorTab[],
  activeTabId: string,
  catalog: EditorCatalog,
): { tabs: EditorTab[]; activeTabId: string } {
  if (!catalog) return { tabs, activeTabId };
  const kept = tabs.filter(
    (t) => t.kind !== 'object' || catalog.assets.some((a) => a.id === t.assetId),
  );
  if (kept.length === tabs.length) return { tabs, activeTabId };
  const stillActive = kept.some((t) => t.id === activeTabId);
  return { tabs: kept, activeTabId: stillActive ? activeTabId : 'map' };
}

/** Bundles several `{do,undo}` op pairs into ONE `Command` — `do` runs them in order, `undo` reverses
 *  them in REVERSE order (so a later op's undo, which may assume an earlier op's effect, unwinds
 *  first). Used by the multi-object batch actions (rotate/flip/depth-bump) so selecting N objects and
 *  pressing e.g. "rotate +90" is one undo step, not N. */
function batchCommand(ops: Array<{ do: () => void; undo: () => void }>): Command {
  return {
    do: () => {
      for (const op of ops) op.do();
    },
    undo: () => {
      for (let i = ops.length - 1; i >= 0; i--) ops[i].undo();
    },
  };
}

export const useEditorStore = create<EditorState>()(
  subscribeWithSelector((set, get) => ({
    tabs: [
      { id: 'map', kind: 'map' },
      { id: 'world', kind: 'world' },
    ],
    activeTabId: 'map',
    map: null,
    mapId: null,
    dirty: false,
    world: EMPTY_WORLD,
    catalog: null,
    activeLayerId: null,
    activeTool: 'pan',
    brushAsset: null,
    armedObjectAsset: null,
    armedNodeRef: null,
    snapToTileCenter: true,
    pendingPortalRect: null,
    selectedObjectIds: [],
    activeZoneId: null,
    overlays: { grid: true, walkability: false, zones: false, ghosts: false },
    hiddenLayerIds: [],
    pendingDirty: null,
    mapEpoch: 0,
    docRevision: 0,
    canUndo: false,
    canRedo: false,

    newMap: (id, name, width, height) => {
      const map = createEmptyMap(id, name, width, height);
      history.clear();
      set((s) => ({
        map,
        mapId: id,
        activeLayerId: map.layers[0]?.id ?? null,
        selectedObjectIds: [],
        armedObjectAsset: null,
        armedNodeRef: null,
        pendingPortalRect: null,
        dirty: true, // freshly created — not yet on disk
        pendingDirty: null,
        mapEpoch: s.mapEpoch + 1,
        docRevision: 0,
        canUndo: false,
        canRedo: false,
      }));
    },

    loadMap: (map, id) => {
      history.clear();
      set((s) => ({
        map,
        mapId: id,
        activeLayerId: map.layers[0]?.id ?? null,
        selectedObjectIds: [],
        armedObjectAsset: null,
        armedNodeRef: null,
        pendingPortalRect: null,
        dirty: false, // just read from disk
        pendingDirty: null,
        mapEpoch: s.mapEpoch + 1,
        docRevision: 0,
        canUndo: false,
        canRedo: false,
      }));
    },

    closeMap: () => {
      history.clear();
      set((s) => ({
        map: null,
        mapId: null,
        activeLayerId: null,
        selectedObjectIds: [],
        armedObjectAsset: null,
        armedNodeRef: null,
        pendingPortalRect: null,
        dirty: false,
        pendingDirty: null,
        mapEpoch: s.mapEpoch + 1,
        docRevision: 0,
        canUndo: false,
        canRedo: false,
      }));
    },

    openObjectTab: (assetId) =>
      set((s): Partial<EditorState> => {
        const id = `object:${assetId}`;
        const tab: EditorTab = { id, kind: 'object', assetId };
        const tabs = s.tabs.some((t) => t.id === id) ? s.tabs : [...s.tabs, tab];
        return { tabs, activeTabId: id };
      }),
    activateTab: (id) =>
      set((s): Partial<EditorState> =>
        s.tabs.some((t) => t.id === id) ? { activeTabId: id } : {},
      ),
    closeTab: (id) =>
      set((s): Partial<EditorState> => {
        if (id === 'map' || id === 'world') return {}; // permanent tabs — never closed
        const index = s.tabs.findIndex((t) => t.id === id);
        if (index < 0) return {}; // not open — nothing to remove
        const tabs = s.tabs.filter((t) => t.id !== id);
        // Closing the active tab hands focus to its left neighbour (index − 1); everything else keeps
        // the current active tab. `?? 'map'` guards the (unreachable — index 0/1 are permanent) case
        // of closing the leftmost tab.
        const activeTabId = s.activeTabId === id ? (s.tabs[index - 1]?.id ?? 'map') : s.activeTabId;
        return { tabs, activeTabId };
      }),
    setActiveLayer: (layerId) => set({ activeLayerId: layerId }),
    setActiveTool: (activeTool) => set({ activeTool }),
    setBrushAsset: (brushAsset) => set({ brushAsset }),
    // Arming one kind clears the other — only one thing is ever armed at a time (see module doc).
    setArmedObjectAsset: (armedObjectAsset) =>
      set((s): Partial<EditorState> => ({
        armedObjectAsset,
        armedNodeRef: armedObjectAsset ? null : s.armedNodeRef,
      })),
    setArmedNodeRef: (armedNodeRef) =>
      set((s): Partial<EditorState> => ({
        armedNodeRef,
        armedObjectAsset: armedNodeRef ? null : s.armedObjectAsset,
      })),
    setSnapToTileCenter: (snapToTileCenter) => set({ snapToTileCenter }),
    setPendingPortalRect: (pendingPortalRect) => set({ pendingPortalRect }),
    setSelectedObjectIds: (selectedObjectIds) => set({ selectedObjectIds }),
    setActiveZoneId: (activeZoneId) => set({ activeZoneId }),
    toggleOverlay: (key) =>
      set((s): Partial<EditorState> => ({ overlays: { ...s.overlays, [key]: !s.overlays[key] } })),
    toggleLayerVisibility: (layerId) =>
      set((s): Partial<EditorState> => ({
        hiddenLayerIds: s.hiddenLayerIds.includes(layerId)
          ? s.hiddenLayerIds.filter((id) => id !== layerId)
          : [...s.hiddenLayerIds, layerId],
      })),
    setWorld: (world) => set({ world }),
    setCatalog: (catalog) =>
      set((s) => ({ catalog, ...reconcileTabs(s.tabs, s.activeTabId, catalog) })),
    markSaved: () => set({ dirty: false }),

    applyCommand: (cmd) => {
      history.apply(cmd);
      set((s) => ({
        dirty: true,
        docRevision: s.docRevision + 1,
        activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
        selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
    },

    undo: () => {
      if (!history.undo()) return;
      set((s) => ({
        dirty: true,
        docRevision: s.docRevision + 1,
        pendingDirty: null, // a whole coalesced stroke reverted at once — fall back to a full rebake
        activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
        selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
    },

    redo: () => {
      if (!history.redo()) return;
      set((s) => ({
        dirty: true,
        docRevision: s.docRevision + 1,
        pendingDirty: null,
        activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
        selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
    },

    consumePendingDirty: () => {
      const { pendingDirty } = get();
      if (pendingDirty) set({ pendingDirty: null });
      return pendingDirty;
    },

    // ---- painting ----

    paintLine: (fromCol, fromRow, toCol, toRow, strokeId) => {
      const { map, activeLayerId, brushAsset } = get();
      if (!map || !activeLayerId) return;
      const layerIndex = map.layers.findIndex((l) => l.id === activeLayerId);
      const layer = map.layers[layerIndex];
      if (!layer) return;
      const value = resolveBrushValue(map, brushAsset);
      const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
        isInside(map, col, row),
      );
      const changes = cellsToChanges(layer.cells, map.meta.width, points, value);
      if (changes.length === 0) return;
      const cmd: Command = {
        strokeId,
        do: () => {
          for (const c of changes) layer.cells[c.index] = value;
        },
        undo: () => {
          for (const c of changes) layer.cells[c.index] = c.prev;
        },
      };
      const chunks = [...new Set(points.map(({ row }) => Math.floor(row / GROUND_CHUNK_ROWS)))];
      set({ pendingDirty: { layerIndex, chunks } });
      get().applyCommand(cmd);
    },

    eraseLine: (fromCol, fromRow, toCol, toRow, strokeId) => {
      const { map, activeLayerId } = get();
      if (!map || !activeLayerId) return;
      const layerIndex = map.layers.findIndex((l) => l.id === activeLayerId);
      const layer = map.layers[layerIndex];
      if (!layer) return;
      const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
        isInside(map, col, row),
      );
      const changes = cellsToChanges(layer.cells, map.meta.width, points, 0);
      if (changes.length === 0) return;
      const cmd: Command = {
        strokeId,
        do: () => {
          for (const c of changes) layer.cells[c.index] = 0;
        },
        undo: () => {
          for (const c of changes) layer.cells[c.index] = c.prev;
        },
      };
      const chunks = [...new Set(points.map(({ row }) => Math.floor(row / GROUND_CHUNK_ROWS)))];
      set({ pendingDirty: { layerIndex, chunks } });
      get().applyCommand(cmd);
    },

    fillFrom: (col, row) => {
      const { map, activeLayerId, brushAsset } = get();
      if (!map || !activeLayerId) return;
      const layerIndex = map.layers.findIndex((l) => l.id === activeLayerId);
      const layer = map.layers[layerIndex];
      if (!layer) return;
      const value = resolveBrushValue(map, brushAsset);
      const changes = floodFill(
        layer.cells,
        map.meta.width,
        map.meta.height,
        col,
        row,
        value,
        (c, r) => isInside(map, c, r),
      );
      if (changes.length === 0) return;
      const cmd: Command = {
        do: () => {
          for (const c of changes) layer.cells[c.index] = value;
        },
        undo: () => {
          for (const c of changes) layer.cells[c.index] = c.prev;
        },
      };
      const width = map.meta.width;
      const chunks = [
        ...new Set(changes.map((c) => Math.floor(Math.floor(c.index / width) / GROUND_CHUNK_ROWS))),
      ];
      set({ pendingDirty: { layerIndex, chunks } });
      get().applyCommand(cmd);
    },

    paintRectArea: (c0, r0, c1, r1) => {
      const { map, activeLayerId, brushAsset } = get();
      if (!map || !activeLayerId) return;
      const layerIndex = map.layers.findIndex((l) => l.id === activeLayerId);
      const layer = map.layers[layerIndex];
      if (!layer) return;
      const value = resolveBrushValue(map, brushAsset);
      const points = rectCells(c0, r0, c1, r1, (c, r) => isInside(map, c, r));
      const changes = cellsToChanges(layer.cells, map.meta.width, points, value);
      if (changes.length === 0) return;
      const cmd: Command = {
        do: () => {
          for (const c of changes) layer.cells[c.index] = value;
        },
        undo: () => {
          for (const c of changes) layer.cells[c.index] = c.prev;
        },
      };
      const chunks = [...new Set(points.map(({ row }) => Math.floor(row / GROUND_CHUNK_ROWS)))];
      set({ pendingDirty: { layerIndex, chunks } });
      get().applyCommand(cmd);
    },

    // ---- layers ----

    addLayer: (name) => {
      const map = get().map;
      if (!map) return;
      const id = nextLayerId(map);
      const newLayer: TileLayer = {
        id,
        name: name?.trim() || 'New Layer',
        kind: 'tiles',
        overhead: false,
        cells: new Array<number>(map.meta.width * map.meta.height).fill(0),
      };
      const cmd: Command = {
        do: () => {
          map.layers.push(newLayer);
        },
        undo: () => {
          const i = map.layers.indexOf(newLayer);
          if (i >= 0) map.layers.splice(i, 1);
        },
      };
      get().applyCommand(cmd);
      set({ activeLayerId: id });
    },

    renameLayer: (layerId, name) => {
      const map = get().map;
      if (!map) return;
      const layer = map.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const trimmed = name.trim();
      if (trimmed.length === 0 || trimmed === layer.name) return;
      const prev = layer.name;
      const cmd: Command = {
        do: () => {
          layer.name = trimmed;
        },
        undo: () => {
          layer.name = prev;
        },
      };
      get().applyCommand(cmd);
    },

    deleteLayer: (layerId) => {
      const map = get().map;
      if (!map) return;
      if (map.layers.length <= 1) return; // keep at least one layer to paint on
      const index = map.layers.findIndex((l) => l.id === layerId);
      if (index < 0) return;
      const [removed] = map.layers.slice(index, index + 1);
      const cmd: Command = {
        do: () => {
          map.layers.splice(index, 1);
        },
        undo: () => {
          map.layers.splice(index, 0, removed);
        },
      };
      get().applyCommand(cmd);
    },

    moveLayer: (layerId, direction) => {
      const map = get().map;
      if (!map) return;
      const index = map.layers.findIndex((l) => l.id === layerId);
      if (index < 0) return;
      const targetIndex = direction === 'forward' ? index + 1 : index - 1;
      if (targetIndex < 0 || targetIndex >= map.layers.length) return;
      const cmd: Command = {
        do: () => {
          const [l] = map.layers.splice(index, 1);
          map.layers.splice(targetIndex, 0, l);
        },
        undo: () => {
          const [l] = map.layers.splice(targetIndex, 1);
          map.layers.splice(index, 0, l);
        },
      };
      get().applyCommand(cmd);
    },

    toggleLayerOverhead: (layerId) => {
      const map = get().map;
      if (!map) return;
      const layer = map.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const prev = layer.overhead;
      const cmd: Command = {
        do: () => {
          layer.overhead = !prev;
        },
        undo: () => {
          layer.overhead = prev;
        },
      };
      get().applyCommand(cmd);
    },

    // ---- favourites ----

    toggleFavourite: (assetId) => {
      const map = get().map;
      if (!map) return;
      const zoneId = get().activeZoneId;

      if (zoneId !== null) {
        const zoneDef = map.zones.defs.find((z) => z.id === zoneId);
        if (!zoneDef) return;
        const has = zoneDef.favourites.includes(assetId);
        const cmd: Command = {
          do: () => {
            zoneDef.favourites = has
              ? zoneDef.favourites.filter((a) => a !== assetId)
              : [...zoneDef.favourites, assetId];
          },
          undo: () => {
            zoneDef.favourites = has
              ? [...zoneDef.favourites, assetId]
              : zoneDef.favourites.filter((a) => a !== assetId);
          },
        };
        get().applyCommand(cmd);
        return;
      }

      const has = (map.meta.favourites ?? []).includes(assetId);
      const cmd: Command = {
        do: () => {
          const current = map.meta.favourites ?? [];
          map.meta.favourites = has ? current.filter((a) => a !== assetId) : [...current, assetId];
        },
        undo: () => {
          const current = map.meta.favourites ?? [];
          map.meta.favourites = has ? [...current, assetId] : current.filter((a) => a !== assetId);
        },
      };
      get().applyCommand(cmd);
    },

    // ---- objects: place, transform, stack, portals (step 7) ----

    placeDecor: (asset, x, y, region, anim) => {
      const map = get().map;
      if (!map) return false;
      const id = nextObjectId(map, 'decor');
      const obj: DecorObject = {
        id,
        kind: 'decor',
        asset,
        x,
        y,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
        depth: 0,
        ...(region ? { region } : {}),
        ...(anim ? { anim: { ...anim, fps: DECOR_ANIM_DEFAULT_FPS } } : {}),
      };
      if (!footprintIsValid(map, obj)) return false;
      const cmd: Command = {
        do: () => {
          map.objects.push(obj);
        },
        undo: () => {
          const i = map.objects.indexOf(obj);
          if (i >= 0) map.objects.splice(i, 1);
        },
      };
      get().applyCommand(cmd);
      set({ selectedObjectIds: [id] });
      return true;
    },

    placeNode: (ref, col, row) => {
      const map = get().map;
      if (!map) return false;
      const id = nextObjectId(map, 'node');
      const obj: NodeObject = { id, kind: 'node', ref, col, row };
      if (!footprintIsValid(map, obj)) return false;
      const cmd: Command = {
        do: () => {
          map.objects.push(obj);
        },
        undo: () => {
          const i = map.objects.indexOf(obj);
          if (i >= 0) map.objects.splice(i, 1);
        },
      };
      get().applyCommand(cmd);
      set({ selectedObjectIds: [id] });
      return true;
    },

    createPortal: (rect, name, facing) => {
      const map = get().map;
      if (!map) return false;
      const id = nextObjectId(map, 'portal');
      const obj: PortalObject = { id, kind: 'portal', name, rect, facing };
      if (!footprintIsValid(map, obj)) return false;
      const cmd: Command = {
        do: () => {
          map.objects.push(obj);
        },
        undo: () => {
          const i = map.objects.indexOf(obj);
          if (i >= 0) map.objects.splice(i, 1);
        },
      };
      get().applyCommand(cmd);
      set({ selectedObjectIds: [id] });
      return true;
    },

    translateObjects: (ids, delta) => {
      const map = get().map;
      if (!map) return false;
      const targets = map.objects.filter((o) => ids.includes(o.id));
      if (targets.length === 0) return false;
      if (delta.dxPx === 0 && delta.dyPx === 0 && delta.dCol === 0 && delta.dRow === 0) return true; // no movement — nothing to commit

      // Build prospective next values + validate EVERY target's footprint before mutating anything.
      const prev = new Map<string, { x: number; y: number } | { col: number; row: number }>();
      const next = new Map<string, { x: number; y: number } | { col: number; row: number }>();
      for (const obj of targets) {
        if (obj.kind === 'decor') {
          prev.set(obj.id, { x: obj.x, y: obj.y });
          next.set(obj.id, { x: obj.x + delta.dxPx, y: obj.y + delta.dyPx });
        } else if (obj.kind === 'node') {
          prev.set(obj.id, { col: obj.col, row: obj.row });
          next.set(obj.id, { col: obj.col + delta.dCol, row: obj.row + delta.dRow });
        } else {
          prev.set(obj.id, { col: obj.rect.col, row: obj.rect.row });
          next.set(obj.id, { col: obj.rect.col + delta.dCol, row: obj.rect.row + delta.dRow });
        }
      }
      for (const obj of targets) {
        const n = next.get(obj.id);
        if (!n) continue;
        const candidate: MapObject =
          obj.kind === 'decor'
            ? { ...obj, x: (n as { x: number; y: number }).x, y: (n as { x: number; y: number }).y }
            : obj.kind === 'node'
              ? {
                  ...obj,
                  col: (n as { col: number; row: number }).col,
                  row: (n as { col: number; row: number }).row,
                }
              : {
                  ...obj,
                  rect: {
                    ...obj.rect,
                    col: (n as { col: number; row: number }).col,
                    row: (n as { col: number; row: number }).row,
                  },
                };
        if (!footprintIsValid(map, candidate)) return false; // any target on void/OOB refuses the WHOLE move
      }

      const cmd: Command = {
        do: () => {
          for (const obj of targets) {
            const n = next.get(obj.id);
            if (!n) continue;
            if (obj.kind === 'decor') {
              obj.x = (n as { x: number; y: number }).x;
              obj.y = (n as { x: number; y: number }).y;
            } else if (obj.kind === 'node') {
              obj.col = (n as { col: number; row: number }).col;
              obj.row = (n as { col: number; row: number }).row;
            } else {
              obj.rect.col = (n as { col: number; row: number }).col;
              obj.rect.row = (n as { col: number; row: number }).row;
            }
          }
        },
        undo: () => {
          for (const obj of targets) {
            const p = prev.get(obj.id);
            if (!p) continue;
            if (obj.kind === 'decor') {
              obj.x = (p as { x: number; y: number }).x;
              obj.y = (p as { x: number; y: number }).y;
            } else if (obj.kind === 'node') {
              obj.col = (p as { col: number; row: number }).col;
              obj.row = (p as { col: number; row: number }).row;
            } else {
              obj.rect.col = (p as { col: number; row: number }).col;
              obj.rect.row = (p as { col: number; row: number }).row;
            }
          }
        },
      };
      get().applyCommand(cmd);
      return true;
    },

    deleteObjects: (ids) => {
      const map = get().map;
      if (!map) return;
      const removed: Array<{ index: number; obj: MapObject }> = [];
      map.objects.forEach((o, index) => {
        if (ids.includes(o.id)) removed.push({ index, obj: o });
      });
      if (removed.length === 0) return;
      const cmd: Command = {
        do: () => {
          // Remove from the end backwards (by the ORIGINAL indices, captured before any mutation) so
          // earlier indices stay valid as later ones are spliced out.
          for (let i = removed.length - 1; i >= 0; i--) map.objects.splice(removed[i].index, 1);
        },
        undo: () => {
          // Reinsert in ascending index order so every object lands back at its original position.
          for (const { index, obj } of removed) map.objects.splice(index, 0, obj);
        },
      };
      get().applyCommand(cmd); // applyCommand also reconciles selectedObjectIds — no separate clear needed
    },

    duplicateObjects: (ids) => {
      const map = get().map;
      if (!map) return [];
      const targets = map.objects.filter((o) => ids.includes(o.id));
      if (targets.length === 0) return [];
      const mintedIds: string[] = [];
      const copies: MapObject[] = [];
      for (const obj of targets) {
        if (obj.kind === 'decor') {
          const id = nextObjectId(map, 'decor', mintedIds);
          mintedIds.push(id);
          const tileSize = map.meta.tileSize;
          const offset: DecorObject = { ...obj, id, x: obj.x + tileSize, y: obj.y + tileSize };
          copies.push(footprintIsValid(map, offset) ? offset : { ...obj, id, x: obj.x, y: obj.y });
        } else if (obj.kind === 'node') {
          const id = nextObjectId(map, 'node', mintedIds);
          mintedIds.push(id);
          const offset: NodeObject = { ...obj, id, col: obj.col + 1, row: obj.row + 1 };
          copies.push(
            footprintIsValid(map, offset) ? offset : { ...obj, id, col: obj.col, row: obj.row },
          );
        } else {
          const id = nextObjectId(map, 'portal', mintedIds);
          mintedIds.push(id);
          const offset: PortalObject = {
            ...obj,
            id,
            rect: { ...obj.rect, col: obj.rect.col + 1, row: obj.rect.row + 1 },
          };
          copies.push(
            footprintIsValid(map, offset) ? offset : { ...obj, id, rect: { ...obj.rect } },
          );
        }
      }
      const cmd: Command = {
        do: () => {
          map.objects.push(...copies);
        },
        undo: () => {
          for (const copy of copies) {
            const i = map.objects.indexOf(copy);
            if (i >= 0) map.objects.splice(i, 1);
          }
        },
      };
      get().applyCommand(cmd);
      const newIds = copies.map((o) => o.id);
      set({ selectedObjectIds: newIds });
      return newIds;
    },

    updateDecor: (id, patch) => {
      const map = get().map;
      if (!map) return false;
      const obj = map.objects.find((o) => o.id === id && o.kind === 'decor') as
        DecorObject | undefined;
      if (!obj) return false;
      const touchesFootprint = 'x' in patch || 'y' in patch || 'collision' in patch;
      if (touchesFootprint) {
        const candidate: DecorObject = { ...obj, ...patch };
        if (!footprintIsValid(map, candidate)) return false;
      }
      const prev: Partial<DecorObject> = {};
      for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
        (prev as Record<string, unknown>)[key] = obj[key as keyof DecorObject];
      }
      const cmd: Command = {
        do: () => Object.assign(obj, patch),
        undo: () => Object.assign(obj, prev),
      };
      get().applyCommand(cmd);
      return true;
    },

    updateNode: (id, patch) => {
      const map = get().map;
      if (!map) return false;
      const obj = map.objects.find((o) => o.id === id && o.kind === 'node') as
        NodeObject | undefined;
      if (!obj) return false;
      const candidate: NodeObject = { ...obj, ...patch };
      if (!footprintIsValid(map, candidate)) return false;
      const prev: Partial<Pick<NodeObject, 'col' | 'row'>> = { col: obj.col, row: obj.row };
      const cmd: Command = {
        do: () => Object.assign(obj, patch),
        undo: () => Object.assign(obj, prev),
      };
      get().applyCommand(cmd);
      return true;
    },

    updatePortal: (id, patch) => {
      const map = get().map;
      if (!map) return false;
      const obj = map.objects.find((o) => o.id === id && o.kind === 'portal') as
        PortalObject | undefined;
      if (!obj) return false;
      if (patch.rect) {
        const candidate: PortalObject = { ...obj, rect: patch.rect };
        if (!footprintIsValid(map, candidate)) return false;
      }
      const prev: Partial<Pick<PortalObject, 'name' | 'facing' | 'rect'>> = {
        name: obj.name,
        facing: obj.facing,
        rect: { ...obj.rect },
      };
      const cmd: Command = {
        do: () => Object.assign(obj, patch),
        undo: () => Object.assign(obj, prev),
      };
      get().applyCommand(cmd);
      return true;
    },

    rotateObjects: (ids, deltaDeg) => {
      const map = get().map;
      if (!map) return;
      const ops: Array<{ do: () => void; undo: () => void }> = [];
      for (const obj of map.objects) {
        if (!ids.includes(obj.id) || obj.kind !== 'decor') continue;
        const prevRotation = obj.rotation;
        const nextRotation = obj.rotation + deltaDeg;
        ops.push({
          do: () => {
            obj.rotation = nextRotation;
          },
          undo: () => {
            obj.rotation = prevRotation;
          },
        });
      }
      if (ops.length === 0) return;
      get().applyCommand(batchCommand(ops));
    },

    flipObjects: (ids, axis) => {
      const map = get().map;
      if (!map) return;
      const key = axis === 'x' ? 'flipX' : 'flipY';
      const ops: Array<{ do: () => void; undo: () => void }> = [];
      for (const obj of map.objects) {
        if (!ids.includes(obj.id) || obj.kind !== 'decor') continue;
        const prevVal = obj[key];
        const nextVal = !prevVal;
        ops.push({
          do: () => {
            obj[key] = nextVal;
          },
          undo: () => {
            obj[key] = prevVal;
          },
        });
      }
      if (ops.length === 0) return;
      get().applyCommand(batchCommand(ops));
    },

    bumpDepth: (ids, delta) => {
      const map = get().map;
      if (!map) return;
      const ops: Array<{ do: () => void; undo: () => void }> = [];
      for (const obj of map.objects) {
        if (!ids.includes(obj.id) || obj.kind !== 'decor') continue;
        const prevDepth = obj.depth;
        const nextDepth = obj.depth + delta;
        ops.push({
          do: () => {
            obj.depth = nextDepth;
          },
          undo: () => {
            obj.depth = prevDepth;
          },
        });
      }
      if (ops.length === 0) return;
      get().applyCommand(batchCommand(ops));
    },
  })),
);
