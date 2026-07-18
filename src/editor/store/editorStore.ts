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
 *
 *  A dimension-changing edit (`resizeMap`, plan 024) also just rides `docRevision`, not a dedicated
 *  third counter — it's an in-place edit like any other applyCommand/undo/redo move, it just happens
 *  to swap in arrays of a NEW width/height rather than same-sized ones. Nothing here distinguishes
 *  "same dims, cells changed" from "dims changed" — that's the Phaser scene's job (a baked-dims
 *  fallback, plan 024 step 3: `EditorScene` compares the map's current `meta.width/height` against
 *  what it last baked at and does a full rebuild, not a rebake, when they differ), not this store's.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  applyResize,
  createEmptyMap,
  isInside,
  planResize,
  type DecorAnim,
  type DecorObject,
  type DecorRegion,
  type MapFile,
  type MapObject,
  type NamedTilePalette,
  type NodeObject,
  type PortalFacing,
  type PortalObject,
  type PortalRect,
  type ResizeEdges,
  type TerrainSection,
  type TileLayer,
  type TilePaletteSlot,
  type ZoneDef,
} from '../../systems/mapFormat';
import type { TileSource } from '../../data/tileset';
import { pickWeighted } from '../../data/tileset';
import type { Dims } from '../../systems/autotile';
import type { MapPlacement, WorldLayout } from '../../systems/worldLayout';
import { GROUND_CHUNK_ROWS, TILE_SIZE } from '../../config';
import { toast } from 'sonner';
import { NODES } from '../../data/nodes';
import nodesJson from '../../data/maps/nodes.json';
import {
  parseNodeDefs,
  type AuthoredNodeDef,
  type NodeDefsFile,
  type NodeSkinDef,
  type ParsedNodeDef,
} from '../../systems/nodeDefs';
import { ITEMS } from '../../data/items';
import { getMapReferenceSidecar, mapReferenceImageUrl } from '../api';
import { computeAutoAlign, parseSidecar, type AutoAlign } from '../underlayAlign';
import {
  deleteSettings,
  getCachedImage,
  getSettings,
  putCachedImage,
  putSettings,
  type UnderlaySettings,
} from '../underlayStore';
import {
  deleteBrowse,
  deleteRecents,
  getBrowse,
  getRecents,
  putBrowse,
  putRecents,
  pushRecent,
  type LibraryBrowseState,
  type RecentEntry,
} from '../libraryViewStore';
import type { AssetCatalog, CatalogAssetRole } from '../catalog';
import type { TerrainCatalog, TerrainDef } from '../terrainCatalog';
import { parseAssetId } from '../textureLoading';
import {
  cellsToChanges,
  findOrAppendPaletteIndex,
  floodFill,
  lineCells,
  rectCells,
  type CellChange,
} from '../paintOps';
import { footprintIsValid, nextObjectId } from '../objectOps';
import {
  captureRegionObjects,
  computeGridRegionMove,
  regionDestinationInside,
  regionMoveInBounds,
  type RegionCellEdit,
  type RegionRect,
} from '../regionOps';
import { computeVoidCascade } from '../shapeOps';
import { defaultZoneColour, nextFreeZoneId } from '../zoneOps';
import { computeTerrainBake } from '../terrainOps';
import { HistoryStack, type Command } from './history';

/** A central-pane tab (plan 017 step 1, extended plan 021 step 8). `map`/`world`/`nodeTypes` are the
 *  three permanent, non-closable tabs; an `object` tab is opened on demand from the Library's ⚙ (one
 *  per asset) and can be closed. The id is deterministic — `map` / `world` / `nodeTypes` /
 *  `object:<assetId>` — so `openObjectTab` dedupes with a plain `find` and no separate lookup table is
 *  needed. */
export type EditorTab =
  | { id: 'map'; kind: 'map' }
  | { id: 'world'; kind: 'world' }
  | { id: 'nodeTypes'; kind: 'nodeTypes' }
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
  | 'terrain'
  | 'place'
  | 'portal'
  /** Eyedropper: click/tap a cell or object to sample what's there and arm it (then auto-switch to
   *  the matching paint tool). The touch-reachable equivalent of the Alt-click modifier that the
   *  tile-paint tools expose — see `EditorScene.sampleUnderPointer`. */
  | 'eyedropper';

/** Values `libraryRoleFilter` can take (plan 032 step 3) — the same three-member union as
 *  `CatalogAssetRole`, but named separately since it's a VIEW concept (which role the Library's
 *  browse surface currently shows) rather than an asset's own classification. No `'mixed'`/`'all'`
 *  sentinel — the filter is always exactly one of the three roles. */
export type LibraryRoleFilter = CatalogAssetRole;

/** Tool → auto-synced `libraryRoleFilter` (plan 032 step 3, critique #3's settled mapping), applied by
 *  `setActiveTool` unless the user manually overrode the filter since the last tool switch (see
 *  `libraryRoleFilterOverridden`). Every tool NOT listed here (`pan`, `select`, `collision`, `zone`,
 *  `shape`, `portal`, `eyedropper`) keeps whatever filter was already active — it neither forces nor
 *  blocks a filter, it's just not one of the tools this plan wires up. `'actor'` never appears as a
 *  value here: actors are only ever shown via a manual chip click (`setLibraryRoleFilter`), never by
 *  switching tools. */
const TOOL_LIBRARY_FILTER: Partial<Record<EditorTool, LibraryRoleFilter>> = {
  brush: 'tile',
  rect: 'tile',
  fill: 'tile',
  eraser: 'tile',
  terrain: 'tile',
  place: 'object',
};

/** Which gesture the `collision`/`zone`/`shape`/`terrain` tools paint with (plan 014 step 8, extended
 *  step 10) — mirrors the brush/rect/fill distinction that tile painting expresses as separate
 *  `EditorTool`s, but these tools each write a DIFFERENT target (a non-tile grid, or — for `terrain` —
 *  an editor-only mask that then rebakes into a tile layer) rather than painting a tile layer
 *  directly, so one tool id covers all three gestures and `paintMode` picks the gesture. Tile painting
 *  (`brush`/`eraser`/`fill`/`rect`) ignores this field entirely — it keeps using `activeTool` as its
 *  own gesture selector. */
export type PaintMode = 'brush' | 'rect' | 'fill';

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

/** The live reference-underlay: the persisted `UnderlaySettings` plus the resolved base64 `dataUrl`
 *  the Phaser scene loads as a texture (plan 022 step 4). Editor VIEW state only — never `MapFile`,
 *  never persisted whole (only its `UnderlaySettings` half is, via `underlayStore`; the `dataUrl` is
 *  re-resolved from cache/fetch on load, or held in-memory for ad-hoc file images). */
export type UnderlayState = UnderlaySettings & { dataUrl: string };

/** Starting opacity for a freshly-picked underlay — a shade above the `GHOST_ALPHA=0.4` precedent so
 *  the trace-over image reads clearly while tile layers still paint legibly on top. */
const DEFAULT_UNDERLAY_OPACITY = 0.5;

/** Empty Library browse state — the reset value when no map is open and the fallback when a map has
 *  no persisted browse. `search` is transient (store-only, never persisted; see `libraryViewStore`). */
const EMPTY_LIBRARY_BROWSE: LibraryBrowseState = {
  search: '',
  selectedPack: null,
  selectedCategory: null,
  expandedPacks: [],
};

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
  /** Bumped on every world-layout mutation (`applyWorldCommand`, undo/redo of a `domain:'world'`
   *  entry) — mirrors `docRevision`'s role for `map`: `world.placements` is mutated IN PLACE (same
   *  reference), so React components (`WorldViewTab`) subscribe to this counter purely as a
   *  re-render trigger and read the current `world` via `getState()` in the render body, exactly
   *  like `ZonesPanel` does for `map`. */
  worldRevision: number;
  /** Unsaved `world.json` changes — the World view's OWN dirty flag, independent of the per-map
   *  `dirty` (placements and the open map document are different files with different save
   *  actions). */
  worldDirty: boolean;
  catalog: EditorCatalog;
  /** Loaded terrain-defs file (`terrains.json`, plan 014 step 10) — `null` until the Library's mount
   *  fetch (`loadTerrainCatalog`) lands. The terrain brush (armed via `activeTerrainId`) and the
   *  pre-save full rebake both read this to resolve a terrain id to its sheet + blob mapping. */
  terrainCatalog: TerrainCatalog | null;
  /** Authored node-def registry (plan 021 step 7) — the editable RAW list (`AuthoredNodeDef[]`, same
   *  shape as `nodes.json`'s `defs`), NOT the parsed `ResourceNodeDef`-shaped map (see
   *  `nodeDefsParsed`). Seeded synchronously from the bundled `src/data/maps/nodes.json` (mirrors
   *  `src/data/nodes.ts`'s boot-time `NODES`) so the palette/placement never see an empty registry
   *  before `loadNodeDefs()` (`nodeDefsSource.ts`, called from the Library panel's mount effect
   *  alongside `loadCatalog`/`loadTerrainCatalog`) resolves the live `GET /__editor/nodes` fetch. */
  nodeDefs: AuthoredNodeDef[];
  /** `parseNodeDefs({version:1, defs: nodeDefs})`, recomputed by every commit (`tryParseNodeDefs`) so
   *  it's always in lockstep with `nodeDefs`. This is what the palette (`LibraryPanel`) and placement
   *  (`EditorScene`) read INSTEAD of the boot-time `NODES` import, so a newly authored/edited def
   *  appears without a reload (plan 021 step 7's "palette + placement read the live store" side
   *  effect). */
  nodeDefsParsed: Record<string, ParsedNodeDef>;
  /** Unsaved node-def changes — this registry's own dirty flag, independent of the per-map `dirty`
   *  and world's `worldDirty` (`nodes.json` is a third, separate file with its own save action). */
  nodeDefsDirty: boolean;
  /** Bumps on every node-def mutation — a React re-render trigger, mirrors `worldRevision`. */
  nodeDefsRevision: number;
  /** A `TerrainDef.id` armed for the `terrain` tool (step 10) — mirrors `activeZoneId`'s role for the
   *  `zone` tool. `null` ⇒ the terrain tool is disarmed (painting/erasing both no-op with a warning). */
  activeTerrainId: string | null;
  activeLayerId: string | null;
  /** Editor tile palettes (plan 033 step 9) — the SOURCE OF TRUTH for the curated quick-access trays,
   *  a GLOBAL cross-map slice loaded from / auto-saved to `src/data/maps/palettes.json` (NOT map data,
   *  NOT `map.meta`). Structural edits are plain immutable `set`s — never `applyCommand`, never
   *  undoable, never dirty the map. Persistence is a debounced store SUBSCRIBER (`palettesSource.ts`'s
   *  `installPaletteAutosave`), not inline here. Map open/close/switch leaves this untouched. */
  tilePalettes: NamedTilePalette[];
  /** Active tile-palette pointer (plan 033) — editor VIEW state, store-only (the palette STRUCTURE is
   *  the global `tilePalettes` slice above; this pointer is not persisted). `null` when there are no
   *  palettes. Switching it is a plain `set` — never a command, never dirties the map. Reconciled
   *  against `tilePalettes` (via `reconcileActiveTilePalette`) after every palette-slice mutation so it
   *  never dangles, exactly like `activeLayerId`. */
  activeTilePaletteId: string | null;
  /** Library multi-select "add to palette" mode (plan 033, Step 4) — transient store view-state (never
   *  persisted, never a command/dirty). Kept in the store, not component state, so it survives the
   *  compact `<Sheet>` unmount. */
  palettePickMode: boolean;
  /** The asset ids (`assetId` or `assetId#frame`) currently ticked in Library pick mode. */
  palettePickSelection: string[];
  activeTool: EditorTool;
  /** Which `CatalogAssetRole` the Library panel's browse surface currently shows (plan 032 step 3) —
   *  filters `visibleAssets`/`categoriesByPack` (and the Recent/Favourites surfaces) uniformly, so an
   *  `'actor'` asset is invisible everywhere in the browse tree unless this is `'actor'`. Auto-synced
   *  by `setActiveTool` per `TOOL_LIBRARY_FILTER` UNLESS `libraryRoleFilterOverridden` is set; a manual
   *  chip click (`setLibraryRoleFilter`) always wins over the auto-sync until the next tool switch.
   *  Defaults to `'tile'` — actors are hidden by default and never auto-selected by any tool. */
  libraryRoleFilter: LibraryRoleFilter;
  /** True once the user has manually picked a Library filter chip since the last tool switch — makes
   *  the very next `setActiveTool` call skip its `TOOL_LIBRARY_FILTER` auto-sync (once), then that same
   *  switch resets this back to `false` so auto-sync resumes for whatever tool comes after. */
  libraryRoleFilterOverridden: boolean;
  brushAsset: string | null;
  /** Pending clockwise rotation (deg) applied to the tileset piece painted by the `brush` tool. A
   *  rotated tile becomes a distinct palette entry (see `findOrAppendPaletteIndex`). STICKY across
   *  arming a new `brushAsset` (lay many rotated tiles without re-rotating). Brush-gesture only —
   *  `fill`/`rect` paint at angle 0 this plan. */
  brushRotation: 0 | 90 | 180 | 270;
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
  /** Clockwise rotation (deg, arbitrary angle) stamped onto the next decor/node placed with the `place`
   *  tool — set by the placement rotation wheel (Toolbar/ContextBar). STICKY across arming a new
   *  asset/node (place a whole row at the same angle without re-setting it). Applies to decor AND nodes
   *  (both carry a `rotation` field); portals have no rotation and ignore it. Normalised to `[0,360)`. */
  placeRotation: number;
  /** A tile rect just drawn with the Portal tool, awaiting the name/facing dialog (`PortalDialog`).
   *  Set on pointer-up of a valid (non-void) portal drag; cleared on dialog confirm/cancel. */
  pendingPortalRect: PortalRect | null;
  selectedObjectIds: string[];
  /** The Select tool's marquee region — a tile rectangle drawn around an area of the map to move its
   *  whole contents (tiles on every layer + walkability/zone/terrain grids + intersecting objects) as
   *  one block via `translateRegion`. Editor VIEW state, NOT map data and NOT in the undo history
   *  (like `selectedObjectIds`): drawing/clearing a box isn't an undoable edit, only the moves it
   *  drives are. `null` when no box is drawn. Cleared on a plain (no-drag) click, tool switch away
   *  from `select`, map load/close/new, resize, and undo/redo (see those sites). */
  regionSelection: RegionRect | null;
  /** Gesture for the `collision`/`zone`/`shape` tools (step 8) — see `PaintMode`'s doc. */
  paintMode: PaintMode;

  // ---- input-modifier intent (plan 027 step 2) — the sticky/momentary split ----
  // The context bar's toggles (touch parity) and a physically-held Alt/Shift are TWO independent
  // sources of the same intent; they must never share one boolean or a keyup/blur would silently
  // wipe a bar toggle. So the sticky context-bar toggles below are the source of truth, the
  // `*Held` momentary fields track the physical key, and `EditorScene` reads the EFFECTIVE intent
  // as the OR of the two (`eraseActive || altHeld`, etc.). A `window` blur clears ONLY the
  // momentary `*Held` fields — never the sticky toggles.
  /** Sticky "erase / inverse action" toggle set by the context bar (collision/zone/terrain clear,
   *  shape restore-to-inside). OR'd with `altHeld` for the effective read. */
  eraseActive: boolean;
  /** Sticky "free-pixel placement" toggle set by the context bar (place/drag ignore tile-snap).
   *  OR'd with `altHeld` for the effective read. */
  freePixelActive: boolean;
  /** Sticky "multi-select" toggle set by the context bar (select tool toggles into the set).
   *  OR'd with `shiftHeld` for the effective read. */
  multiSelectActive: boolean;
  /** Momentary: Alt is physically held right now (set on keydown, cleared on keyup + `window` blur).
   *  A separate override OR'd into `eraseActive`/`freePixelActive` at read time — never the same
   *  boolean as the sticky toggles. */
  altHeld: boolean;
  /** Momentary: Shift is physically held right now (keydown/keyup/blur, like `altHeld`). OR'd into
   *  `multiSelectActive` at read time. */
  shiftHeld: boolean;
  activeZoneId: number | null;
  overlays: EditorOverlays;
  /** Editor VIEW state, not map data — which layer ids are hidden in the viewport. Never touches
   *  `MapFile`/`TileLayer` (those have no visibility field; see module doc on `overhead` vs this). */
  hiddenLayerIds: string[];
  /** Library panel's MRU "Recent" picks for the open map (plan 030) — editor VIEW state, persisted
   *  per-map in `localStorage` (`libraryViewStore`), NEVER in `MapFile`. Empty when no map is open.
   *  Deduped/capped via `pushLibraryRecent`. */
  libraryRecents: RecentEntry[];
  /** Library panel's search/filter/expansion state for the open map (plan 030) — editor VIEW state.
   *  `selectedPack`/`selectedCategory`/`expandedPacks` persist per-map (`libraryViewStore`); `search`
   *  is transient (in-memory only — survives a close/reopen within a session, not a reload). Never in
   *  `MapFile`. Reset to `EMPTY_LIBRARY_BROWSE` when no map is open. */
  libraryBrowse: LibraryBrowseState;
  /** Reference-underlay for the open map (plan 022) — a trace-over image behind the tile layers,
   *  editor VIEW state only (its `UnderlaySettings` persist per-map in `localStorage`, NEVER in
   *  `MapFile`). `null` when no reference is picked / the fetch failed / the map has no persisted
   *  underlay. See `UnderlayState`. */
  underlay: UnderlayState | null;
  /** Bumped on every underlay change (pick/clear/opacity/offset/scale/visible/lock/lifecycle swap) —
   *  mirrors `docRevision`/`worldRevision`: the Phaser `EditorScene` subscribes to it and re-reads
   *  `underlay` via `getState()`, no map re-diff. */
  underlayRevision: number;
  /** See module doc. Set by paint actions just before `applyCommand`; consumed+cleared by
   *  `EditorScene.onDocEdited` via `consumePendingDirty`. */
  pendingDirty: PendingDirty | null;

  /** Full-reload signal (see module doc). */
  mapEpoch: number;
  /** In-place-edit signal (see module doc). */
  docRevision: number;
  /** Bumped to tell `EditorScene` to drop any in-flight touch/gesture tracking. The compact drawers
   *  (Library/Inspector) are modal DOM overlays; opening/closing one can swallow a finger's `touchend`
   *  (a Radix Sheet `preventDefault`s it), stranding a phantom in the scene's touch set — which then
   *  makes a later single tap register as a two-finger pinch and jams the editor in zoom. EditorApp
   *  bumps this on every drawer toggle (the exact desync boundary) so the scene resets deterministically,
   *  rather than the scene guessing from an unreliable native touch count. */
  pointerGestureResetNonce: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Thumbnail-bake capability (plan 014 step 9) — `EditorScene` is the only thing with every tile
   *  texture resident, so it's the only thing that CAN bake a thumbnail, but the store is the only
   *  React↔Phaser bridge (module doc) and there's no scene ref in React. So `EditorScene.create()`
   *  installs this closure (producing a 1px-per-tile PNG `Blob` of the CURRENTLY open map, `null` if
   *  none) and clears it back to `null` on teardown; `Toolbar`'s Save calls it after a successful
   *  `putMap` and PUTs the result via `putThumb`. `null` before the scene has mounted, or after it's
   *  torn down (StrictMode double-mount, HMR) — callers must treat a `null` capability, or a `null`
   *  Blob result, as "skip the thumbnail export", never as a save failure. */
  bakeThumbnail: (() => Promise<Blob | null>) | null;
  /** Viewport-zoom capability — same React↔Phaser bridge shape as `bakeThumbnail`. The camera lives in
   *  `EditorScene`, so the on-screen zoom buttons (ContextBar) can't touch it directly; the scene
   *  installs this closure on create (stepping the integer zoom by `delta`, anchored on the viewport
   *  centre, clamped to the MIN..MAX range) and clears it to `null` on teardown. `null` before the
   *  scene mounts / after it tears down — callers no-op on `null`. */
  zoomViewport: ((delta: number) => void) | null;

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
  /** Switches the active tool AND auto-syncs `libraryRoleFilter` per `TOOL_LIBRARY_FILTER` (skipped if
   *  `libraryRoleFilterOverridden`); always resets `libraryRoleFilterOverridden` to `false` afterward,
   *  win or lose, so the override is a one-tool-switch grace period, not a permanent pin. */
  setActiveTool(tool: EditorTool): void;
  /** Manually sets the Library role filter (a chip click) and flags the override so the very next
   *  `setActiveTool` call leaves it alone — see `libraryRoleFilterOverridden`'s doc. */
  setLibraryRoleFilter(filter: LibraryRoleFilter): void;
  setBrushAsset(asset: string | null): void;
  /** Set the pending brush rotation directly (one of 0/90/180/270). */
  setBrushRotation(deg: 0 | 90 | 180 | 270): void;
  /** Cycle the pending brush rotation by ±90°, wrapping through the 0/90/180/270 set. */
  rotateBrush(delta: 90 | -90): void;
  setArmedObjectAsset(armed: ArmedObjectAsset | null): void;
  setArmedNodeRef(ref: string | null): void;
  setSnapToTileCenter(enabled: boolean): void;
  /** Set the sticky placement rotation (deg) applied to the next placed decor/node. Any real number is
   *  accepted and normalised to `[0,360)`. */
  setPlaceRotation(deg: number): void;
  setPendingPortalRect(rect: PortalRect | null): void;
  setSelectedObjectIds(ids: string[]): void;
  /** Set (or clear, with `null`) the Select tool's marquee region. */
  setRegionSelection(region: RegionRect | null): void;
  /** Moves the current `regionSelection`'s whole contents by `(dCol,dRow)` WHOLE tiles as ONE
   *  undoable command: every tile layer's cells, the walkability/zone grids, each terrain mask, and
   *  every object whose footprint intersects the region are relocated together (the void/shape mask is
   *  NOT — see below). The vacated source cells are cleared to empty. On success the region box itself
   *  follows to the new location (so repeated nudges keep moving the same group) and returns `true`.
   *
   *  Refuses (returns `false`, NO mutation) when: there's no region/map; the move would push the box
   *  off the map edge (`regionMoveInBounds` — never silently drops tiles); any destination tile is
   *  void (`regionDestinationInside` — never breaks the void-consistency invariant); or any captured
   *  object's destination footprint is void/out-of-bounds (mirrors `translateObjects`' all-or-nothing
   *  contract). A zero delta is a no-op (`true`, no history entry).
   *
   *  Why the void/shape mask is excluded: it's structural (moving it would create/destroy void regions
   *  and cascade tile/object removal). The terrain MASKS are moved so a later `rebakeTerrainsForSave`
   *  re-derives the moved tiles correctly rather than reverting them to the mask's old position. */
  translateRegion(dCol: number, dRow: number): boolean;
  setPaintMode(mode: PaintMode): void;
  /** Set the sticky erase/inverse toggle (context bar). */
  setEraseActive(active: boolean): void;
  /** Set the sticky free-pixel toggle (context bar). */
  setFreePixelActive(active: boolean): void;
  /** Set the sticky multi-select toggle (context bar). */
  setMultiSelectActive(active: boolean): void;
  /** Set the momentary Alt-held field (keyboard). Blur clears this, never the sticky toggle. */
  setAltHeld(held: boolean): void;
  /** Set the momentary Shift-held field (keyboard). Blur clears this, never the sticky toggle. */
  setShiftHeld(held: boolean): void;
  setActiveZoneId(id: number | null): void;
  toggleOverlay(key: keyof EditorOverlays): void;
  toggleLayerVisibility(layerId: string): void;

  // ---- Library view-state (plan 030) — recents + browse, editor view-state persisted per-map in
  //      localStorage (`libraryViewStore`), never in MapFile. Both write-throughs no-op the disk
  //      write when `mapId` is null (in-memory state still updates). ----
  /** Record a library pick as the most-recent entry (moves an existing one to front, caps the list)
   *  and write the new list through to `localStorage` for the open map (skipped if no map). */
  pushLibraryRecent(entry: RecentEntry): void;
  /** Merge `partial` into `libraryBrowse`. Persists the browse subset for the open map only when
   *  `partial` touches a persisted field (a `search`-only patch updates memory but skips the disk
   *  write — `search` is transient). No-op disk write when no map is open. */
  patchLibraryBrowse(partial: Partial<LibraryBrowseState>): void;

  // ---- reference underlay (plan 022 step 4) — editor view-state, persisted per-map in localStorage,
  //      never in MapFile. All are no-ops when `mapId` is null; async paths bail if the map swaps
  //      mid-flight (epoch-guard spirit — compare `mapId` after each await). ----
  /** Picks a committed repo reference by `name`: resolve its data URL (cache → else fetch + cache),
   *  fetch+parse its sidecar and `computeAutoAlign` for the initial scale/offset, set `underlay`,
   *  persist, bump the revision. Any align `warning` surfaces via a sonner toast; a fetch failure is
   *  non-fatal (toast, `underlay` left unchanged). */
  setUnderlayReference(name: string): Promise<void>;
  /** Loads an ad-hoc image `File` (desktop file-picker / drag-drop): read to a data URL,
   *  `referenceName=null`, identity auto-align (no sidecar), set + persist + bump. The bytes live in
   *  memory only (no cache key), so an ad-hoc underlay does not survive a reload. */
  setUnderlayImageFromFile(file: File): Promise<void>;
  /** Clears the underlay for the open map and deletes its persisted settings. */
  clearUnderlay(): void;
  setUnderlayOpacity(opacity: number): void;
  setUnderlayOffset(offsetX: number, offsetY: number): void;
  setUnderlayScale(scale: number): void;
  toggleUnderlayVisible(): void;
  toggleUnderlayLock(): void;
  /** Lifecycle helper (called by `loadMap`/`newMap` after `mapId` is set): if `mapId` has persisted
   *  underlay settings naming a `referenceName`, resolve its data URL (cache → else fetch) and
   *  populate `underlay`. Ad-hoc (`referenceName=null`) settings aren't re-resolvable, so they're
   *  skipped. Silently non-fatal on failure. Guarded against a map swap mid-fetch. */
  hydrateUnderlay(mapId: string): Promise<void>;
  /** Internal reconciler: if the LIVE `underlay` (if any) has drifted from the open map's persisted
   *  `UnderlaySettings` (offset/scale), copies the persisted values onto the live object and bumps
   *  `underlayRevision`; a genuine no-op otherwise — the persisted blob is the source of truth (see
   *  `hydrateUnderlay`'s doc), the live object is just its resolved-`dataUrl` cache. Called
   *  unconditionally from `applyCommand`/`undo`/`redo` so it's free on every edit; the only mutation
   *  that currently causes a divergence is `resizeMap` writing the persisted offset via `putSettings`
   *  without touching `underlay` directly (its `do`/`undo` stay `set`-free — see its doc). Not meant
   *  to be called from UI code. */
  syncUnderlayFromSettings(): void;
  /** Replaces the whole world layout WITHOUT touching history — used to seed `world` from disk on the
   *  World view's initial load (`getWorld` → `parseWorldLayout`). Resets `worldDirty` to `false`
   *  (freshly read) and bumps `worldRevision`. Do NOT use for user edits — those go through the
   *  history-tracked `addPlacement`/`movePlacement`/`removePlacement`. */
  setWorld(world: WorldLayout): void;
  /** Marks the world layout clean after a successful `putWorld`. */
  markWorldSaved(): void;
  /** Installs (or clears, with `null`) the thumbnail-bake capability — called by `EditorScene` on
   *  create/teardown. See `bakeThumbnail`'s doc. */
  setBakeThumbnail(fn: (() => Promise<Blob | null>) | null): void;
  /** Installs (or clears, with `null`) the viewport-zoom capability — called by `EditorScene` on
   *  create/teardown. See `zoomViewport`'s doc. */
  setZoomViewport(fn: ((delta: number) => void) | null): void;
  /** Signal `EditorScene` to clear its touch/gesture tracking — see `pointerGestureResetNonce`. */
  resetPointerGesture(): void;
  setCatalog(catalog: EditorCatalog): void;
  setTerrainCatalog(catalog: TerrainCatalog | null): void;
  setActiveTerrainId(id: string | null): void;
  /** Installs a freshly-loaded node-def registry (`GET /__editor/nodes` result) — mirrors `setWorld`:
   *  no history entry, resets `nodeDefsDirty` to `false`, bumps `nodeDefsRevision`. Re-validates via
   *  `parseNodeDefs` regardless (the single choke point every node-def path commits through — see
   *  `tryParseNodeDefs`); on a corrupt/invalid file this toasts and leaves whatever registry was
   *  already loaded (the bundled seed, or a prior good load) in place rather than clobbering the
   *  store with bad data. */
  setNodeDefs(defs: AuthoredNodeDef[]): void;
  /** Marks the node-def registry clean after a successful `putNodes`. */
  markNodeDefsSaved(): void;
  markSaved(): void;
  applyCommand(cmd: Command): void;
  /** Applies a world-layout command through the SAME history stack as `applyCommand`, stamping
   *  `domain:'world'` so undo/redo update the world side effects (`worldDirty`/`worldRevision`)
   *  rather than the map's (`dirty`/`docRevision`). Placement edits route through here so Ctrl+Z
   *  works uniformly across map and world. */
  applyWorldCommand(cmd: Command): void;
  undo(): void;
  redo(): void;
  /** Read + clear `pendingDirty` in one step — `EditorScene` calls this once per rebake so a stale
   *  value never lingers into an unrelated edit. */
  consumePendingDirty(): PendingDirty | null;

  // ---- world layout (step 9) — placement edits, all undoable through the ONE history stack ----
  /** Adds a placement for `mapId` at `origin` (whole global tile coords). No-op (returns `false`) if
   *  the map is already placed. One undoable command tagged `domain:'world'`. */
  addPlacement(mapId: string, origin: { col: number; row: number }): boolean;
  /** Moves an existing placement's origin to `origin` (whole global tile coords). No-op (returns
   *  `false`) if the map isn't placed or the origin is unchanged. One undoable command tagged
   *  `domain:'world'` — `strokeId` (optional) coalesces a whole drag into one undo entry, exactly
   *  like paint strokes. */
  movePlacement(mapId: string, origin: { col: number; row: number }, strokeId?: string): boolean;
  /** Removes `mapId`'s placement (returns it to the unplaced tray). No-op (returns `false`) if it
   *  isn't placed. One undoable command tagged `domain:'world'`. */
  removePlacement(mapId: string): boolean;

  // ---- node defs registry (plan 021 step 7) — create/duplicate/update/delete node TYPES (defs),
  //      not placed instances (see `placeNode`/`updateNode` for those). Every mutation below builds a
  //      candidate `nodeDefs` array and runs it through `parseNodeDefs` (`tryParseNodeDefs`) before
  //      committing — an invalid result toasts the precise reason and leaves the store untouched. NOT
  //      wired into the history stack (unlike map/world edits): `nodes.json` is its own file with its
  //      own dirty flag/save action (`nodeDefsDirty`/`putNodes`), not part of the map/world undo
  //      timeline. ----
  /** Appends a new def with sensible defaults (a single placeholder skin — replace its asset via
   *  `updateSkin`/the Node Types panel's picker before placing it for real) and a fresh id (`node`,
   *  `node_2`, … — scans every existing def id, unlike `nextObjectId`'s `prefix_0001` scheme for
   *  placed objects). Returns the new id, or `null` (+ toast) if the candidate somehow fails to
   *  validate (shouldn't happen with these defaults). */
  createNodeDef(): string | null;
  /** Deep-copies `id`'s def with a fresh id (`<id>_copy`, `<id>_copy_2`, …) and name (`"<name>
   *  copy"`), appends it, returns the new id. `null` (+ toast) if `id` doesn't exist or the copy
   *  somehow fails to validate. */
  duplicateNodeDef(id: string): string | null;
  /** Merges `patch` into def `id` (everything but `id`/`skins` — skins go through the dedicated
   *  sub-actions below) and commits if the result validates. `false` (+ toast) if `id` doesn't exist
   *  or the patched def is invalid (e.g. `yieldItemId` not in `ITEMS`, non-positive `maxHp`). */
  updateNodeDef(id: string, patch: Partial<Omit<AuthoredNodeDef, 'id' | 'skins'>>): boolean;
  /** Removes def `id` — GUARDED: refuses (`false` + toast with the reason) if any placed
   *  `kind:'node'` object in the CURRENTLY OPEN map still references it (`ref === id`). Known
   *  limitation: only the open map is scanned (this store only ever holds one open `MapFile` at a
   *  time — it does not mirror the world-integrity test's eager load of every committed map); a def
   *  referenced solely by a map that ISN'T currently open can still be deleted here, and would only
   *  be caught by the world-integrity test on the next full-suite run. `false` (+ toast) if `id`
   *  doesn't exist. */
  deleteNodeDef(id: string): boolean;
  /** Appends a new skin (placeholder asset, weight 1) to def `defId`, returns its fresh id (`skin`,
   *  `skin_2`, … scoped to that def's own skin ids), or `null` (+ toast) if `defId` doesn't exist. */
  addSkin(defId: string): string | null;
  /** Merges `patch` into skin `skinId` of def `defId` and commits if the result validates. `false`
   *  (+ toast) if the def/skin doesn't exist or the patch is invalid (e.g. non-positive `weight`). */
  updateSkin(defId: string, skinId: string, patch: Partial<Omit<NodeSkinDef, 'id'>>): boolean;
  /** Removes skin `skinId` from def `defId` — GUARDED like `deleteNodeDef` (same open-map-only
   *  limitation: refuses if a placed node in the open map has `ref: defId, skin: skinId`), and
   *  independently refused by `parseNodeDefs` itself if it would leave the def with zero skins (a def
   *  always needs at least one — no separate check needed here). */
  removeSkin(defId: string, skinId: string): boolean;
  /** Moves skin `skinId` (within def `defId`) to array index `toIndex` (clamped in range) —
   *  reordering changes which skin is `skins[0]` (the def's "default"). `false` if the def/skin
   *  doesn't exist. */
  moveSkin(defId: string, skinId: string, toIndex: number): boolean;

  // ---- resize (plan 024 step 2) ----
  /** Resizes the open map by `edges` (tiles; a negative edge crops) as ONE undoable command — see
   *  `systems/mapFormat`'s `planResize`/`applyResize` for the pure analysis/remap this wraps around a
   *  live in-place swap (mirrors `buildShapeCommand`'s captured-prior-reference style: `do`/`undo`
   *  swap whole array references + `meta` dims + translated objects onto the live `map`, never
   *  mutating the OLD arrays, so both directions are cheap reference assignments). Bails (returns
   *  `false`, no mutation) if there's no open map, the resulting dims are invalid, or any object would
   *  leave the new bounds (`ResizePlan.offendingObjectIds`) — mirrors the dialog's own Apply-gating so
   *  a caller that skips the dialog's checks still can't corrupt the document.
   *
   *  A resize that touches the top/left edge (`dLeft || dTop`) additionally, in the SAME command: (1)
   *  if the map is placed in `world.placements`, shifts that placement's origin by `(-dLeft,-dTop)`
   *  and tags the command `domain:'map+world'` so undo/redo bump BOTH the map's and the world's side
   *  effects, plus toasts that the world layout now has unsaved changes (Save Map ≠ Save World); (2)
   *  if the map has persisted `UnderlaySettings`, shifts their offset by `(+dLeft,+dTop)` (via
   *  `putSettings`, so the traced reference underlay stays aligned) even when the underlay isn't
   *  currently hydrated — `syncUnderlayFromSettings` picks up the live half of that afterwards. A
   *  right/bottom-only resize touches neither: it stays a plain, undomain-tagged map command and never
   *  dirties `world`. Does NOT set `pendingDirty` — a dimension change always needs the scene's full
   *  rebuild (see module doc), not a narrowed rebake. */
  resizeMap(edges: ResizeEdges): boolean;

  /** Renames the open map: sets a NEW `map` reference with `meta.id = newId` + `meta.name = newName`,
   *  points `mapId` at `newId`, and does the in-memory + localStorage half of an id migration —
   *  migrating the underlay-settings key (`getSettings(oldId)` → `putSettings(newId)` → `deleteSettings(oldId)`,
   *  bumping `underlayRevision`) and rewriting any matching `world.placements` entry `oldId→newId`
   *  in place (`worldDirty:true` + `worldRevision` bump). Clears `dirty` (the caller writes the doc to
   *  disk around this call). Returns `{ placementMigrated }` — `true` iff a world placement was rewritten.
   *
   *  Deliberately NOT routed through `applyCommand`/history — a rename is an immediate disk migration
   *  (the id is a filesystem key), not an undoable edit; reverse it by renaming back. All disk IO
   *  (putMap/deleteMap/putThumb/putWorld) lives in the calling component, not here. A name-only change
   *  (id unchanged) skips the underlay/world migration and just swaps the `map` reference. */
  renameMapState(newId: string, newName: string): { placementMigrated: boolean };

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

  // ---- tile palettes (plan 033 step 9 — GLOBAL, auto-saved, NOT undoable) ----
  /** Installs a freshly-loaded palette set (the boot `GET /__editor/palettes` result) into the global
   *  `tilePalettes` slice, then reconciles the active pointer. Mirrors `setNodeDefs`/`setWorld`'s
   *  "install from disk" posture — no command, no dirty. Used by `palettesSource.ts`'s `loadPalettes`. */
  setTilePalettes(palettes: NamedTilePalette[]): void;
  /** Re-points `activeTilePaletteId` at the first palette (or `null`) if it's null/dangling — see
   *  `resolveActiveTilePalette`. Called after every palette-slice mutation so the pointer never dangles. */
  reconcileActiveTilePalette(): void;
  /** Sets the active-palette pointer directly (a plain `set`, like `setActiveLayer`) — no command, no
   *  dirty, no counter bump. */
  setActiveTilePalette(id: string): void;
  /** Appends a new empty named palette (`"Palette N"` default) to the global `tilePalettes` slice via a
   *  plain immutable `set` (NOT undoable), then makes it active. Autosaved by the store subscriber. */
  addTilePalette(name?: string): void;
  /** Bulk-appends slots to the active palette via a plain immutable `set` (NOT undoable), deduping exact
   *  `assetId`+`rotation` duplicates. Lazily creates `"Palette 1"` (and makes it active) if there are no
   *  palettes yet. Autosaved by the store subscriber. */
  addTilesToActivePalette(entries: TilePaletteSlot[]): void;
  /** Removes the slot at `index` from palette `paletteId` via a plain immutable `set` (NOT undoable). */
  removeTilePaletteSlot(paletteId: string, index: number): void;
  /** Arms the brush from a palette slot — sets `brushAsset`/`brushRotation` and switches to the brush
   *  tool (mirrors `pickTile`). A brush-arm, NOT a palette mutation: no command, no dirty. */
  selectPaletteSlot(slot: TilePaletteSlot): void;
  /** Toggles Library pick mode (transient view-state); leaving pick mode clears the selection. */
  togglePalettePickMode(): void;
  /** Adds/removes an asset id in the Library pick selection (transient view-state). */
  togglePalettePickTile(assetId: string): void;
  /** Clears the Library pick selection (transient view-state). */
  clearPalettePick(): void;

  // ---- collision / walkability (step 8) ----
  /** Paints `walkability.cells` along a line segment (brush stroke, `strokeId`-coalesced), skipping
   *  void cells like every other paint tool. `blocked` sets `1` (blocked) or `0` (walkable). */
  paintWalkabilityLine(
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
    strokeId: string,
    blocked: boolean,
  ): void;
  /** Flood-fills `walkability.cells` from `(col,row)`, bounded by the shape mask. */
  fillWalkabilityFrom(col: number, row: number, blocked: boolean): void;
  /** Fills a rectangle of `walkability.cells`. */
  paintWalkabilityRect(c0: number, r0: number, c1: number, r1: number, blocked: boolean): void;

  // ---- zones (step 8) ----
  /** Creates a zone def with the lowest free uint8 id (1..255), a default name/colour, activates it,
   *  and returns the new id — or `null` (no mutation, a console warning) if the id space is
   *  exhausted (all 255 zone ids taken). */
  createZone(): number | null;
  renameZone(id: number, name: string): void;
  recolourZone(id: number, colour: string): void;
  /** Deletes a zone def AND clears every cell painted with its id, as ONE undoable command.
   *  Deactivates it if it was the active zone. */
  deleteZone(id: number): void;
  /** Paints `zones.cells` along a line segment (brush stroke, `strokeId`-coalesced), skipping void
   *  cells. `paint` writes the active zone's id (no-op + console warning if none is active); `!paint`
   *  clears to `0` regardless of which zone owned the cell. */
  paintZoneLine(
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
    strokeId: string,
    paint: boolean,
  ): void;
  fillZoneFrom(col: number, row: number, paint: boolean): void;
  paintZoneRect(c0: number, r0: number, c1: number, r1: number, paint: boolean): void;

  // ---- shape (step 8) ----
  /** Paints `shape.cells` along a line segment (brush stroke, `strokeId`-coalesced). `inside=true`
   *  sets the cell to `1` (a plain cell-value change, no side effects). `inside=false` voids it
   *  (`0`) — as one undoable command with the FULL void-consistency cascade (every tile layer cell
   *  zeroed, zone id zeroed, overlapping objects removed — see `computeVoidCascade`). Materializes
   *  `map.shape` on first use (an absent shape means "all inside"); undoing back past the very first
   *  shape edit restores the absent state exactly. NOT gated by the shape mask (`isInside`) — that
   *  would make void cells impossible to paint back to inside — only by the map's width/height
   *  bounds. */
  paintShapeLine(
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
    strokeId: string,
    inside: boolean,
  ): void;
  fillShapeFrom(col: number, row: number, inside: boolean): void;
  paintShapeRect(c0: number, r0: number, c1: number, r1: number, inside: boolean): void;

  // ---- terrain (step 10) ----
  /** Paints (or erases) `activeTerrainId`'s mask for the ACTIVE LAYER along a line segment (brush
   *  stroke, `strokeId`-coalesced), inside cells only, then rebakes every currently-painted mask cell
   *  into the layer's real `cells` via `computeTerrainBake` + append-only palette — mask edit + baked
   *  cell changes land as ONE undoable command. `on=true` paints (armed terrain required); `on=false`
   *  erases (same armed terrain required — it identifies WHICH section's mask/bake to touch). No-op
   *  (with a console warning) if no terrain is armed. */
  paintTerrainLine(
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
    strokeId: string,
    on: boolean,
  ): void;
  fillTerrainFrom(col: number, row: number, on: boolean): void;
  paintTerrainRect(c0: number, r0: number, c1: number, r1: number, on: boolean): void;
  /** Rebakes every `TerrainSection`'s mask into its layer's real `cells` IN FULL — the pre-save
   *  canonicalization pass (advisor rule: baked cells are canonical, the mask is editor-only
   *  convenience). Mutates the live map directly and is NOT pushed onto the undo stack (a
   *  canonicalization pass, not a semantic edit); bumps `docRevision` only if something actually
   *  changed. Returns whether anything changed. */
  rebakeTerrainsForSave(): boolean;

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
  /** Patches a `node` object's `col`/`row`/`skin`/`rotation`/`depthBias` (Inspector fields);
   *  footprint-validated. A `skin` patch overrides the placement-rolled skin (plan 021 step 9); a
   *  `rotation` patch spins the placed sprite (arbitrary degrees, like decor); a `depthBias` patch
   *  nudges the y-sort order (plan 029), same manual-override concept as the Bring forward/Send back
   *  buttons' `bumpDepth`. */
  updateNode(
    id: string,
    patch: Partial<Pick<NodeObject, 'col' | 'row' | 'skin' | 'rotation' | 'depthBias'>>,
  ): boolean;
  /** Advances the selected node's `skin` to the next one in its def's `skins` list (wraps), acting on
   *  the placement-rolled/overridden skin. Drives the cycle-skin shortcut (plan 021 step 9). No-op
   *  (returns false) if the node's def has 0/1 skins. One undoable command per call (via `updateNode`). */
  cycleNodeSkin(id: string): boolean;
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
  /** Adds `delta` to `depth` on every `decor` object in `ids` (bring-forward = +1, send-back = -1);
   *  adds `delta` to `depthBias` (treated as `0` when absent) on every `node` object in `ids` (plan
   *  029's y-sort nudge). One undoable command covering the mixed selection; `portal` ids are
   *  silently skipped (no depth/depthBias concept). */
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
 *  see `findOrAppendPaletteIndex`'s doc). `rotation` (deg, default 0) selects a distinct palette slot
 *  for a rotated tile. No brush selected, or a malformed asset id, resolves to `0` (empty) — callers
 *  gate brush/rect on a brush being set in the UI; this is just a safe fallback. */
function resolveBrushValue(
  map: MapFile,
  brushAsset: string | null,
  rotation: 0 | 90 | 180 | 270 = 0,
): number {
  if (!brushAsset) return 0;
  try {
    const { pack, path, frame } = parseAssetId(brushAsset);
    const source: TileSource =
      frame === undefined ? { kind: 'image', path } : { kind: 'sheetFrame', sheet: path, frame };
    return findOrAppendPaletteIndex(map, pack, source, rotation);
  } catch (e) {
    console.warn(`[editor] invalid brushAsset "${brushAsset}": ${(e as Error).message}`);
    return 0;
  }
}

/** Builds a plain `{index}->value` undoable Command from a pre-computed `CellChange` list — shared by
 *  every target-grid paint action (tile layers, walkability, zones; step 8 generalises the step-6
 *  tile-paint pipeline over "which cells array" rather than duplicating this do/undo pair per
 *  target). Shape painting does NOT use this directly — it needs the extra void-consistency cascade,
 *  see `buildShapeCommand`. Returns `null` (nothing to apply) when `changes` is empty. */
function commandFromChanges(
  cells: number[],
  changes: CellChange[],
  value: number,
  strokeId?: string,
): Command | null {
  if (changes.length === 0) return null;
  return {
    strokeId,
    do: () => {
      for (const c of changes) cells[c.index] = value;
    },
    undo: () => {
      for (const c of changes) cells[c.index] = c.prev;
    },
  };
}

/** In-bounds check that deliberately ignores the shape mask — used ONLY by the shape tool itself
 *  (painting the mask can't be gated by the mask it's editing; every other paint tool gates on the
 *  real `isInside`, which DOES respect it). */
function inBounds(map: MapFile, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < map.meta.width && row < map.meta.height;
}

/**
 * Builds the ONE undoable command for a shape-paint operation touching `points` (already filtered to
 * `inBounds`). `inside=true` is a plain cell-set (no cascade). `inside=false` computes
 * `computeVoidCascade` for exactly the cells that are NEWLY voided (i.e. currently `1`, per the
 * pre-edit `shapeCellsBase`) and bundles the tile-layer/zone zeroing + object removal into the same
 * command. Materializes `map.shape` (absent ⇒ all-inside) on first write; `hadShapeBefore` lets undo
 * restore the exact prior absent/present state. Returns `null` if nothing would change.
 */
function buildShapeCommand(
  map: MapFile,
  points: ReadonlyArray<{ col: number; row: number }>,
  inside: boolean,
): Command | null {
  const width = map.meta.width;
  const height = map.meta.height;
  const hadShapeBefore = !!map.shape;
  const shapeCellsBase = map.shape
    ? map.shape.cells
    : (new Array(width * height).fill(1) as number[]);
  const value = inside ? 1 : 0;
  const changes = cellsToChanges(shapeCellsBase, width, points, value);
  if (changes.length === 0) return null;

  const cascade = inside ? null : computeVoidCascade(map, new Set(changes.map((c) => c.index)));
  const removedObjects = cascade
    ? cascade.removedObjectIndices.map((index) => ({ index, obj: map.objects[index] }))
    : [];

  return {
    do: () => {
      if (!map.shape) map.shape = { cells: shapeCellsBase.slice() };
      for (const c of changes) map.shape.cells[c.index] = value;
      if (cascade) {
        for (const tc of cascade.tileChanges) map.layers[tc.layerIndex].cells[tc.index] = 0;
        for (const zc of cascade.zoneChanges) map.zones.cells[zc.index] = 0;
        for (let i = removedObjects.length - 1; i >= 0; i--) {
          map.objects.splice(removedObjects[i].index, 1);
        }
      }
    },
    undo: () => {
      if (cascade) {
        for (const { index, obj } of removedObjects) map.objects.splice(index, 0, obj);
        for (const zc of cascade.zoneChanges) map.zones.cells[zc.index] = zc.prev;
        for (const tc of cascade.tileChanges) map.layers[tc.layerIndex].cells[tc.index] = tc.prev;
      }
      if (map.shape) {
        for (const c of changes) map.shape.cells[c.index] = c.prev;
      }
      if (!hadShapeBefore) map.shape = undefined;
    },
  };
}

/**
 * Builds the ONE undoable command for a terrain-paint operation touching `points` on `layer` (already
 * filtered to `isInside`). Toggles `terrainId`'s `TerrainSection` mask for `layer.id` at `points` to
 * `on`, materializing the section lazily on first paint (mirrors `buildShapeCommand` materializing
 * `map.shape`), then rebakes via `computeTerrainBake`: every currently-painted mask cell's resolved
 * frame (via `terrainDef.mapping` + append-only palette) diffed against `layer.cells`, PLUS an
 * explicit clear-to-0 for any cell this edit just erased (mask 1->0). Returns `null` if nothing would
 * change (every point already at `on`'s value). `existingSection` is a mutable closure variable (not a
 * captured array index) so repeated undo/redo cycles correctly recreate/re-remove a section that
 * didn't exist before this command, exactly like `buildShapeCommand` materializes/un-materializes
 * `map.shape`.
 */
function buildTerrainCommand(
  map: MapFile,
  layer: TileLayer,
  terrainId: string,
  terrainDef: TerrainDef,
  points: ReadonlyArray<{ col: number; row: number }>,
  on: boolean,
): Command | null {
  const width = map.meta.width;
  const height = map.meta.height;
  const layerId = layer.id;
  let existingSection: TerrainSection | undefined = map.terrain.find(
    (t) => t.layerId === layerId && t.terrainId === terrainId,
  );
  const hadSectionBefore = !!existingSection;
  const baseCells = existingSection
    ? existingSection.cells
    : (new Array(width * height).fill(0) as number[]);
  const value = on ? 1 : 0;
  const maskChanges = cellsToChanges(baseCells, width, points, value);
  if (maskChanges.length === 0) return null;

  const nextMask = baseCells.slice();
  for (const c of maskChanges) nextMask[c.index] = value;
  // Cells this edit just erased (1->0) — paintMask no longer reports them, so they need an explicit
  // clear (see computeTerrainBake's doc).
  const clearedIndices = new Set(
    maskChanges.filter((c) => value === 0 && c.prev === 1).map((c) => c.index),
  );

  const dims: Dims = { cols: width, rows: height };
  const resolveIndex = (frame: number): number =>
    findOrAppendPaletteIndex(
      map,
      terrainDef.pack,
      {
        kind: 'sheetFrame',
        sheet: terrainDef.sheet,
        frame,
      },
      0, // terrain autotile always bakes at angle 0 (brush-only rotation this plan)
    );
  const bakeChanges = computeTerrainBake(
    nextMask,
    dims,
    terrainDef.mapping,
    clearedIndices,
    layer.cells,
    resolveIndex,
  );

  return {
    do: () => {
      let section = existingSection;
      if (!section) {
        section = { layerId, terrainId, cells: baseCells.slice() };
        map.terrain.push(section);
        existingSection = section;
      }
      for (const c of maskChanges) section.cells[c.index] = value;
      for (const c of bakeChanges) layer.cells[c.index] = c.next;
    },
    undo: () => {
      for (const c of bakeChanges) layer.cells[c.index] = c.prev;
      if (existingSection) {
        for (const c of maskChanges) existingSection.cells[c.index] = c.prev;
      }
      if (!hadSectionBefore && existingSection) {
        const i = map.terrain.indexOf(existingSection);
        if (i >= 0) map.terrain.splice(i, 1);
        existingSection = undefined; // a redo's `do` recreates it fresh, matching the first-run path
      }
    },
  };
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

/** Next auto `palette_NNNN` id (plan 033) — scans existing palette ids so re-adding after a delete/undo
 *  never collides. Mirrors `nextLayerId`'s scan-for-max `<prefix>_NNNN` scheme used across the format. */
function nextTilePaletteId(palettes: readonly NamedTilePalette[]): string {
  let max = 0;
  for (const p of palettes) {
    const m = /^palette_(\d+)$/.exec(p.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `palette_${String(max + 1).padStart(4, '0')}`;
}

/** If `activeTilePaletteId` no longer names a palette in the GLOBAL `tilePalettes` slice (removed, or a
 *  fresh load replaced the set), fall back to the first palette, or `null` for an empty set (plan 033
 *  step 9). Pure resolver behind the `reconcileActiveTilePalette` store action — the pointer is
 *  reconciled after every palette-slice mutation so it never dangles (mirrors `reconcileActiveLayer`).
 *  Map-independent now: tile palettes are global editor curation, not map data. */
function resolveActiveTilePalette(
  palettes: readonly NamedTilePalette[],
  activeTilePaletteId: string | null,
): string | null {
  if (activeTilePaletteId && palettes.some((p) => p.id === activeTilePaletteId)) {
    return activeTilePaletteId;
  }
  return palettes[0]?.id ?? null;
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

/** Falls back to `null` if `activeZoneId` no longer names a zone def (a delete, or an undo/redo that
 *  crossed a zone's creation/deletion) — called after every history-stack move (mirrors
 *  `reconcileActiveLayer`/`reconcileSelection`). This isn't just tidiness: `paintZoneLine`/`Rect`/
 *  `fillZoneFrom` paint the RAW `activeZoneId` value into `zones.cells` when `paint` is true, so a
 *  dangling id would let the zone tool write a cell value with no matching `zones.defs` entry —
 *  exactly what `parseMap`'s zone-id invariant rejects. */
function reconcileActiveZone(map: MapFile | null, activeZoneId: number | null): number | null {
  if (!map || activeZoneId === null) return null;
  return map.zones.defs.some((z) => z.id === activeZoneId) ? activeZoneId : null;
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

// ---- node defs registry helpers (plan 021 step 7) ----

/** Validates a candidate node-defs array as a whole `NodeDefsFile` (`{version:1, defs: candidate}`)
 *  via `parseNodeDefs` — the single choke point every node-def mutation (create/duplicate/update/
 *  delete/skin sub-actions) AND `setNodeDefs`'s initial/reload install commit through. Never throws
 *  itself; callers toast `error` and leave state untouched on failure. */
function tryParseNodeDefs(
  candidate: AuthoredNodeDef[],
): { ok: true; parsed: Record<string, ParsedNodeDef> } | { ok: false; error: string } {
  try {
    return { ok: true, parsed: parseNodeDefs({ version: 1, defs: candidate }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Lowest-numbered free id of the form `base`, `base_2`, `base_3`, … not already present in
 *  `existing` — node-def ids and per-def skin ids are freeform authored strings (unlike the
 *  sequential `prefix_0001` scheme `nextObjectId` mints for placed map objects), so a fresh one just
 *  needs to dodge whatever's already taken. */
function freshId(existing: Iterable<string>, base: string): string {
  const used = new Set(existing);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Placeholder skin asset id stamped by `createNodeDef`/`addSkin` — passes `parseNodeDefs` (which
 *  only requires a non-empty string) but isn't a real catalog asset. The Node Types panel (plan 021
 *  step 8) is expected to replace it via the region/asset picker before the def is placed or saved
 *  for real use; the world-integrity test (`src/data/maps/__tests__/world.test.ts`) catches an
 *  unreplaced placeholder landing in a COMMITTED `nodes.json` (it cross-checks every def's skins
 *  against the asset catalog). */
export const PLACEHOLDER_SKIN_ASSET = '__unassigned__';

/** Fallback `yieldItemId` for a freshly-created def — the first entry in `ITEMS` (deterministic; and
 *  always valid — `parseNodeDefs` would refuse the candidate anyway if `ITEMS` were somehow empty). */
const DEFAULT_YIELD_ITEM_ID = Object.keys(ITEMS)[0] ?? 'wood';

function defaultAuthoredNodeDef(id: string): AuthoredNodeDef {
  return {
    id,
    name: 'New node',
    maxHp: 10,
    yieldItemId: DEFAULT_YIELD_ITEM_ID,
    yieldPerHit: 1,
    regrowMs: 60_000,
    blocksPath: true,
    color: 0xffffff,
    stumpColor: 0x808080,
    scale: 1,
    originX: 0.5,
    originY: 1,
    skins: [{ id: 'default', asset: PLACEHOLDER_SKIN_ASSET, weight: 1 }],
  };
}

/** True if the CURRENTLY OPEN map places a `kind:'node'` object referencing `defId` (optionally also
 *  matching a specific `skinId`) — the delete-guard's cross-ref check. See `deleteNodeDef`/
 *  `removeSkin`'s interface docs for the open-map-only limitation (this store holds one open
 *  `MapFile` at a time, not every committed map). */
function openMapReferencesNodeDef(map: MapFile | null, defId: string, skinId?: string): boolean {
  if (!map) return false;
  return map.objects.some(
    (obj) =>
      obj.kind === 'node' && obj.ref === defId && (skinId === undefined || obj.skin === skinId),
  );
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

/** Read a `Blob`/`File` as a base64 data URL (`FileReader`) — used for both fetched reference PNGs
 *  and ad-hoc picked/dropped files, so a single data-URI path feeds `load.image` and `localStorage`
 *  (plan 022's no-object-URL simplification). Rejects on a read error. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/** Strip the in-memory `dataUrl` off a live `UnderlayState`, leaving the `UnderlaySettings` half that
 *  is what actually persists to `localStorage` (the data URL is re-resolved on load, never stored in
 *  the settings blob). */
function settingsOf(u: UnderlayState): UnderlaySettings {
  return {
    referenceName: u.referenceName,
    visible: u.visible,
    locked: u.locked,
    opacity: u.opacity,
    offsetX: u.offsetX,
    offsetY: u.offsetY,
    scale: u.scale,
  };
}

/** Fetch `url` and resolve to a base64 data URL (throws on a non-OK response). */
async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
  return blobToDataUrl(await res.blob());
}

/** Decode a data URL just far enough to read its intrinsic pixel size — needed so `computeAutoAlign`
 *  can compare the actually-loaded image against the sidecar's recorded dimensions. */
function imageSizeFromDataUrl(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
}

export const useEditorStore = create<EditorState>()(
  subscribeWithSelector((set, get) => ({
    tabs: [
      { id: 'map', kind: 'map' },
      { id: 'world', kind: 'world' },
      { id: 'nodeTypes', kind: 'nodeTypes' },
    ],
    activeTabId: 'map',
    map: null,
    mapId: null,
    dirty: false,
    world: EMPTY_WORLD,
    worldRevision: 0,
    worldDirty: false,
    catalog: null,
    terrainCatalog: null,
    // Seeded synchronously from the bundled JSON (see `nodeDefs`/`nodeDefsParsed`'s interface docs) —
    // `NODES` (src/data/nodes.ts) IS `parseNodeDefs(nodesJson)`, reused here directly as the initial
    // parsed view so it's byte-identical to boot-time NODES until `loadNodeDefs()` overwrites it with
    // whatever's actually on disk via the editor API.
    nodeDefs: (nodesJson as NodeDefsFile).defs,
    nodeDefsParsed: NODES,
    nodeDefsDirty: false,
    nodeDefsRevision: 0,
    activeTerrainId: null,
    activeLayerId: null,
    tilePalettes: [],
    activeTilePaletteId: null,
    palettePickMode: false,
    palettePickSelection: [],
    activeTool: 'pan',
    libraryRoleFilter: 'tile',
    libraryRoleFilterOverridden: false,
    brushAsset: null,
    brushRotation: 0,
    armedObjectAsset: null,
    armedNodeRef: null,
    snapToTileCenter: true,
    placeRotation: 0,
    pendingPortalRect: null,
    selectedObjectIds: [],
    regionSelection: null,
    paintMode: 'brush',
    eraseActive: false,
    freePixelActive: false,
    multiSelectActive: false,
    altHeld: false,
    shiftHeld: false,
    activeZoneId: null,
    overlays: { grid: true, walkability: false, zones: false, ghosts: false },
    hiddenLayerIds: [],
    libraryRecents: [],
    libraryBrowse: EMPTY_LIBRARY_BROWSE,
    underlay: null,
    underlayRevision: 0,
    pendingDirty: null,
    mapEpoch: 0,
    docRevision: 0,
    pointerGestureResetNonce: 0,
    canUndo: false,
    canRedo: false,
    bakeThumbnail: null,
    zoomViewport: null,

    newMap: (id, name, width, height) => {
      const map = createEmptyMap(id, name, width, height);
      history.clear();
      const persistedBrowse = getBrowse(id);
      set((s) => ({
        map,
        mapId: id,
        activeLayerId: map.layers[0]?.id ?? null,
        // Plan 033 step 9: tile palettes are GLOBAL editor curation — a new map neither creates nor
        // resets them, so `tilePalettes`/`activeTilePaletteId` are deliberately left untouched here.
        palettePickMode: false,
        palettePickSelection: [],
        selectedObjectIds: [],
        regionSelection: null,
        activeZoneId: null,
        armedObjectAsset: null,
        armedNodeRef: null,
        pendingPortalRect: null,
        dirty: true, // freshly created — not yet on disk
        pendingDirty: null,
        underlay: null, // fresh doc — drop any prior underlay; hydrate restores if this id has one
        underlayRevision: s.underlayRevision + 1,
        // Library view-state (plan 030): hydrate this map's recents/browse (empty/default on a miss);
        // `search` always rehydrates blank (transient — never persisted).
        libraryRecents: getRecents(id),
        libraryBrowse: persistedBrowse ? { ...persistedBrowse, search: '' } : EMPTY_LIBRARY_BROWSE,
        mapEpoch: s.mapEpoch + 1,
        docRevision: 0,
        canUndo: false,
        canRedo: false,
      }));
      void get().hydrateUnderlay(id);
    },

    loadMap: (map, id) => {
      history.clear();
      const persistedBrowse = getBrowse(id);
      set((s) => ({
        map,
        mapId: id,
        activeLayerId: map.layers[0]?.id ?? null,
        // Plan 033 step 9: tile palettes are GLOBAL editor curation — opening a map neither migrates
        // nor resets them, so `tilePalettes`/`activeTilePaletteId` are deliberately left untouched here
        // (they persist across map switches).
        palettePickMode: false,
        palettePickSelection: [],
        selectedObjectIds: [],
        regionSelection: null,
        activeZoneId: null,
        armedObjectAsset: null,
        armedNodeRef: null,
        pendingPortalRect: null,
        dirty: false, // just read from disk
        pendingDirty: null,
        underlay: null, // swap maps → drop the old underlay; hydrate re-resolves this map's own
        underlayRevision: s.underlayRevision + 1,
        // Library view-state (plan 030): hydrate this map's recents/browse (empty/default on a miss);
        // `search` always rehydrates blank (transient — never persisted).
        libraryRecents: getRecents(id),
        libraryBrowse: persistedBrowse ? { ...persistedBrowse, search: '' } : EMPTY_LIBRARY_BROWSE,
        mapEpoch: s.mapEpoch + 1,
        docRevision: 0,
        canUndo: false,
        canRedo: false,
      }));
      void get().hydrateUnderlay(id);
    },

    closeMap: () => {
      history.clear();
      set((s) => ({
        map: null,
        mapId: null,
        activeLayerId: null,
        // Plan 033 step 9: tile palettes are GLOBAL — closing a map leaves `tilePalettes`/
        // `activeTilePaletteId` untouched (they aren't map data).
        palettePickMode: false,
        palettePickSelection: [],
        selectedObjectIds: [],
        regionSelection: null,
        activeZoneId: null,
        armedObjectAsset: null,
        armedNodeRef: null,
        pendingPortalRect: null,
        dirty: false,
        pendingDirty: null,
        underlay: null,
        underlayRevision: s.underlayRevision + 1,
        // Library view-state (plan 030): no map open ⇒ reset to defaults.
        libraryRecents: [],
        libraryBrowse: EMPTY_LIBRARY_BROWSE,
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
        if (id === 'map' || id === 'world' || id === 'nodeTypes') return {}; // permanent tabs — never closed
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
    setActiveTool: (activeTool) =>
      set((s): Partial<EditorState> => {
        const mapped = TOOL_LIBRARY_FILTER[activeTool];
        const libraryRoleFilter =
          !s.libraryRoleFilterOverridden && mapped ? mapped : s.libraryRoleFilter;
        // The marquee region belongs to the Select tool — drop it when switching to any other tool so
        // a stale box never lingers (or accepts a nudge) under an unrelated tool.
        const regionSelection = activeTool === 'select' ? s.regionSelection : null;
        return {
          activeTool,
          libraryRoleFilter,
          libraryRoleFilterOverridden: false,
          regionSelection,
        };
      }),
    setLibraryRoleFilter: (filter) =>
      set({ libraryRoleFilter: filter, libraryRoleFilterOverridden: true }),
    // `brushRotation` is deliberately NOT reset here — it's sticky across arming a new asset.
    setBrushAsset: (brushAsset) => set({ brushAsset }),
    setBrushRotation: (brushRotation) => set({ brushRotation }),
    rotateBrush: (delta) =>
      set((s): Partial<EditorState> => ({
        brushRotation: ((((s.brushRotation + delta) % 360) + 360) % 360) as 0 | 90 | 180 | 270,
      })),
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
    setPlaceRotation: (deg) =>
      set({ placeRotation: Number.isFinite(deg) ? ((deg % 360) + 360) % 360 : 0 }),
    setPendingPortalRect: (pendingPortalRect) => set({ pendingPortalRect }),
    setSelectedObjectIds: (selectedObjectIds) => set({ selectedObjectIds }),
    setRegionSelection: (regionSelection) => set({ regionSelection }),
    setPaintMode: (paintMode) => set({ paintMode }),
    setEraseActive: (eraseActive) => set({ eraseActive }),
    setFreePixelActive: (freePixelActive) => set({ freePixelActive }),
    setMultiSelectActive: (multiSelectActive) => set({ multiSelectActive }),
    setAltHeld: (altHeld) => set({ altHeld }),
    setShiftHeld: (shiftHeld) => set({ shiftHeld }),
    setActiveZoneId: (activeZoneId) => set({ activeZoneId }),
    toggleOverlay: (key) =>
      set((s): Partial<EditorState> => ({ overlays: { ...s.overlays, [key]: !s.overlays[key] } })),
    toggleLayerVisibility: (layerId) =>
      set((s): Partial<EditorState> => ({
        hiddenLayerIds: s.hiddenLayerIds.includes(layerId)
          ? s.hiddenLayerIds.filter((id) => id !== layerId)
          : [...s.hiddenLayerIds, layerId],
      })),

    // ---- Library view-state (plan 030) ----
    pushLibraryRecent: (entry) => {
      const libraryRecents = pushRecent(get().libraryRecents, entry);
      set({ libraryRecents });
      const { mapId } = get();
      if (mapId) putRecents(mapId, libraryRecents);
    },
    patchLibraryBrowse: (partial) => {
      const libraryBrowse = { ...get().libraryBrowse, ...partial };
      set({ libraryBrowse });
      // `search` is transient — a search-only patch updates memory but never hits disk.
      const touchesPersisted =
        'selectedPack' in partial || 'selectedCategory' in partial || 'expandedPacks' in partial;
      const { mapId } = get();
      if (mapId && touchesPersisted) putBrowse(mapId, libraryBrowse);
    },

    // ---- reference underlay (plan 022 step 4) ----

    setUnderlayReference: async (name) => {
      const mapId = get().mapId;
      if (!mapId) return;
      // Cache first (deduped by reference name across maps), else fetch the committed PNG + cache it.
      let dataUrl = getCachedImage(name);
      if (dataUrl === null) {
        try {
          dataUrl = await fetchAsDataUrl(mapReferenceImageUrl(name));
        } catch (e) {
          toast.error(`Couldn't load reference "${name}": ${(e as Error).message}`);
          return;
        }
        if (get().mapId !== mapId) return; // map swapped during the fetch — abandon
        putCachedImage(name, dataUrl);
      }
      // Auto-align from the sidecar (optional). Any failure degrades to identity — non-fatal.
      let align: AutoAlign = { scale: 1, offsetX: 0, offsetY: 0 };
      try {
        const size = await imageSizeFromDataUrl(dataUrl);
        if (get().mapId !== mapId) return;
        const sidecarJson = await getMapReferenceSidecar(name);
        if (get().mapId !== mapId) return;
        // Centre the reference over the map so the captured centre coordinate lands at the map's
        // centre (the reference PNG is captured centred on that coordinate — see `capture.mjs`).
        const meta = get().map?.meta;
        align = computeAutoAlign({
          sidecar: parseSidecar(sidecarJson),
          imageW: size.w,
          imageH: size.h,
          tileSize: TILE_SIZE,
          mapWidth: meta?.width,
          mapHeight: meta?.height,
        });
      } catch (e) {
        console.warn(`[editor] underlay auto-align failed for "${name}":`, e);
      }
      if (align.warning) toast.warning(align.warning);
      const settings: UnderlaySettings = {
        referenceName: name,
        visible: true,
        locked: false,
        opacity: DEFAULT_UNDERLAY_OPACITY,
        offsetX: align.offsetX,
        offsetY: align.offsetY,
        scale: align.scale,
      };
      if (get().mapId !== mapId) return;
      putSettings(mapId, settings);
      set((s) => ({
        underlay: { ...settings, dataUrl },
        underlayRevision: s.underlayRevision + 1,
      }));
    },

    setUnderlayImageFromFile: async (file) => {
      const mapId = get().mapId;
      if (!mapId) return;
      let dataUrl: string;
      try {
        dataUrl = await blobToDataUrl(file);
      } catch (e) {
        toast.error(`Couldn't read image file: ${(e as Error).message}`);
        return;
      }
      if (get().mapId !== mapId) return; // map swapped during the read — abandon
      // No sidecar for an ad-hoc file → identity align (imageW/H irrelevant with sidecar absent).
      const align = computeAutoAlign({ sidecar: null, imageW: 0, imageH: 0, tileSize: TILE_SIZE });
      const settings: UnderlaySettings = {
        referenceName: null,
        visible: true,
        locked: false,
        opacity: DEFAULT_UNDERLAY_OPACITY,
        offsetX: align.offsetX,
        offsetY: align.offsetY,
        scale: align.scale,
      };
      putSettings(mapId, settings);
      set((s) => ({
        underlay: { ...settings, dataUrl },
        underlayRevision: s.underlayRevision + 1,
      }));
    },

    clearUnderlay: () => {
      const mapId = get().mapId;
      if (!mapId) return;
      deleteSettings(mapId);
      set((s) => ({ underlay: null, underlayRevision: s.underlayRevision + 1 }));
    },

    setUnderlayOpacity: (opacity) => {
      const { underlay, mapId } = get();
      if (!underlay || !mapId) return;
      const next: UnderlayState = { ...underlay, opacity };
      putSettings(mapId, settingsOf(next));
      set((s) => ({ underlay: next, underlayRevision: s.underlayRevision + 1 }));
    },

    setUnderlayOffset: (offsetX, offsetY) => {
      const { underlay, mapId } = get();
      if (!underlay || !mapId) return;
      const next: UnderlayState = { ...underlay, offsetX, offsetY };
      putSettings(mapId, settingsOf(next));
      set((s) => ({ underlay: next, underlayRevision: s.underlayRevision + 1 }));
    },

    setUnderlayScale: (scale) => {
      const { underlay, mapId } = get();
      if (!underlay || !mapId) return;
      const next: UnderlayState = { ...underlay, scale };
      putSettings(mapId, settingsOf(next));
      set((s) => ({ underlay: next, underlayRevision: s.underlayRevision + 1 }));
    },

    toggleUnderlayVisible: () => {
      const { underlay, mapId } = get();
      if (!underlay || !mapId) return;
      const next: UnderlayState = { ...underlay, visible: !underlay.visible };
      putSettings(mapId, settingsOf(next));
      set((s) => ({ underlay: next, underlayRevision: s.underlayRevision + 1 }));
    },

    toggleUnderlayLock: () => {
      const { underlay, mapId } = get();
      if (!underlay || !mapId) return;
      const next: UnderlayState = { ...underlay, locked: !underlay.locked };
      putSettings(mapId, settingsOf(next));
      set((s) => ({ underlay: next, underlayRevision: s.underlayRevision + 1 }));
    },

    hydrateUnderlay: async (mapId) => {
      const settings = getSettings(mapId);
      // Only committed references are re-resolvable; ad-hoc file images (referenceName === null) have
      // no cache key, so their bytes don't survive a reload — skip them.
      if (!settings || !settings.referenceName) return;
      const name = settings.referenceName;
      let dataUrl = getCachedImage(name);
      if (dataUrl === null) {
        try {
          dataUrl = await fetchAsDataUrl(mapReferenceImageUrl(name));
        } catch (e) {
          console.warn(`[editor] couldn't restore underlay "${name}":`, e);
          return; // non-fatal — leave `underlay` null
        }
        if (get().mapId !== mapId) return; // map swapped during the fetch — abandon
        putCachedImage(name, dataUrl);
      }
      if (get().mapId !== mapId) return;
      set((s) => ({
        underlay: { ...settings, dataUrl },
        underlayRevision: s.underlayRevision + 1,
      }));
    },

    syncUnderlayFromSettings: () => {
      const mapId = get().mapId;
      if (!mapId) return;
      const s = getSettings(mapId);
      const u = get().underlay;
      if (u && s && (u.offsetX !== s.offsetX || u.offsetY !== s.offsetY || u.scale !== s.scale)) {
        set((st) => ({
          underlay: { ...u, offsetX: s.offsetX, offsetY: s.offsetY, scale: s.scale },
          underlayRevision: st.underlayRevision + 1,
        }));
      }
    },

    setWorld: (world) =>
      set((s) => ({ world, worldDirty: false, worldRevision: s.worldRevision + 1 })),
    markWorldSaved: () => set({ worldDirty: false }),
    setBakeThumbnail: (fn) => set({ bakeThumbnail: fn }),
    setZoomViewport: (fn) => set({ zoomViewport: fn }),
    resetPointerGesture: () =>
      set((s) => ({ pointerGestureResetNonce: s.pointerGestureResetNonce + 1 })),
    setCatalog: (catalog) =>
      set((s) => ({ catalog, ...reconcileTabs(s.tabs, s.activeTabId, catalog) })),
    setTerrainCatalog: (terrainCatalog) => set({ terrainCatalog }),
    setActiveTerrainId: (activeTerrainId) => set({ activeTerrainId }),
    setNodeDefs: (defs) => {
      const result = tryParseNodeDefs(defs);
      if (!result.ok) {
        toast.error(`Couldn't load node defs: ${result.error}`);
        return;
      }
      set((s) => ({
        nodeDefs: defs,
        nodeDefsParsed: result.parsed,
        nodeDefsDirty: false,
        nodeDefsRevision: s.nodeDefsRevision + 1,
      }));
    },
    markNodeDefsSaved: () => set({ nodeDefsDirty: false }),
    markSaved: () => set({ dirty: false }),

    applyCommand: (cmd) => {
      history.apply(cmd);
      set((s) => ({
        dirty: true,
        docRevision: s.docRevision + 1,
        activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
        selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
        activeZoneId: reconcileActiveZone(s.map, s.activeZoneId),
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
      get().syncUnderlayFromSettings();
    },

    applyWorldCommand: (cmd) => {
      history.apply({ ...cmd, domain: 'world' });
      set((s) => ({
        worldDirty: true,
        worldRevision: s.worldRevision + 1,
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
    },

    undo: () => {
      if (!history.undo()) return;
      get().syncUnderlayFromSettings();
      // A single shared stack spans map + world; the reverted entry's `domain` tag says which side
      // effects to bump (see history.ts / applyWorldCommand). `'map+world'` (plan 024's `resizeMap`,
      // a top/left resize of a PLACED map) bumps both sets in one go — it must be checked before the
      // plain `'world'` branch below (a distinct string, so either check order works, but matching
      // this order keeps the three cases readably distinct top-to-bottom: coupled, world-only, map).
      const domain = history.getLastDomain();
      if (domain === 'map+world') {
        set((s) => ({
          dirty: true,
          docRevision: s.docRevision + 1,
          pendingDirty: null,
          regionSelection: null, // region select isn't history-tracked — drop the box so it can't drift from the reverted content
          activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
          selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
          activeZoneId: reconcileActiveZone(s.map, s.activeZoneId),
          worldDirty: true,
          worldRevision: s.worldRevision + 1,
          canUndo: history.canUndo(),
          canRedo: history.canRedo(),
        }));
        return;
      }
      if (domain === 'world') {
        set((s) => ({
          worldDirty: true,
          worldRevision: s.worldRevision + 1,
          canUndo: history.canUndo(),
          canRedo: history.canRedo(),
        }));
        return;
      }
      set((s) => ({
        dirty: true,
        docRevision: s.docRevision + 1,
        pendingDirty: null, // a whole coalesced stroke reverted at once — fall back to a full rebake
        regionSelection: null, // region select isn't history-tracked — drop the box so it can't drift from the reverted content
        activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
        selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
        activeZoneId: reconcileActiveZone(s.map, s.activeZoneId),
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
    },

    redo: () => {
      if (!history.redo()) return;
      get().syncUnderlayFromSettings();
      const domain = history.getLastDomain();
      if (domain === 'map+world') {
        set((s) => ({
          dirty: true,
          docRevision: s.docRevision + 1,
          pendingDirty: null,
          regionSelection: null, // region select isn't history-tracked — drop the box so it can't drift from the reverted content
          activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
          selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
          activeZoneId: reconcileActiveZone(s.map, s.activeZoneId),
          worldDirty: true,
          worldRevision: s.worldRevision + 1,
          canUndo: history.canUndo(),
          canRedo: history.canRedo(),
        }));
        return;
      }
      if (domain === 'world') {
        set((s) => ({
          worldDirty: true,
          worldRevision: s.worldRevision + 1,
          canUndo: history.canUndo(),
          canRedo: history.canRedo(),
        }));
        return;
      }
      set((s) => ({
        dirty: true,
        docRevision: s.docRevision + 1,
        pendingDirty: null,
        activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
        selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
        activeZoneId: reconcileActiveZone(s.map, s.activeZoneId),
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
    },

    consumePendingDirty: () => {
      const { pendingDirty } = get();
      if (pendingDirty) set({ pendingDirty: null });
      return pendingDirty;
    },

    // ---- world layout (step 9) ----
    // `world.placements` is mutated IN PLACE (the command closures capture the live array), exactly
    // like `map` is — so undo/redo restore it without replacing the `world` object reference. The
    // World tab mounts once for the app's lifetime (all tabs stay mounted, hidden via CSS) and seeds
    // `world` from disk exactly once via `setWorld`, so these captured references never go stale.

    addPlacement: (mapId, origin) => {
      const world = get().world;
      if (world.placements.some((p) => p.mapId === mapId)) return false;
      const placement: MapPlacement = { mapId, origin: { col: origin.col, row: origin.row } };
      const cmd: Command = {
        do: () => {
          world.placements.push(placement);
        },
        undo: () => {
          const i = world.placements.indexOf(placement);
          if (i >= 0) world.placements.splice(i, 1);
        },
      };
      get().applyWorldCommand(cmd);
      return true;
    },

    movePlacement: (mapId, origin, strokeId) => {
      const world = get().world;
      const placement = world.placements.find((p) => p.mapId === mapId);
      if (!placement) return false;
      if (placement.origin.col === origin.col && placement.origin.row === origin.row) return false;
      const prev = { col: placement.origin.col, row: placement.origin.row };
      const next = { col: origin.col, row: origin.row };
      const cmd: Command = {
        strokeId,
        do: () => {
          placement.origin = { ...next };
        },
        undo: () => {
          placement.origin = { ...prev };
        },
      };
      get().applyWorldCommand(cmd);
      return true;
    },

    removePlacement: (mapId) => {
      const world = get().world;
      const index = world.placements.findIndex((p) => p.mapId === mapId);
      if (index < 0) return false;
      const removed = world.placements[index];
      const cmd: Command = {
        do: () => {
          world.placements.splice(index, 1);
        },
        undo: () => {
          world.placements.splice(index, 0, removed);
        },
      };
      get().applyWorldCommand(cmd);
      return true;
    },

    // ---- node defs registry (plan 021 step 7) ----

    createNodeDef: () => {
      const { nodeDefs } = get();
      const id = freshId(
        nodeDefs.map((d) => d.id),
        'node',
      );
      const candidate = [...nodeDefs, defaultAuthoredNodeDef(id)];
      const result = tryParseNodeDefs(candidate);
      if (!result.ok) {
        toast.error(`Couldn't create node def: ${result.error}`);
        return null;
      }
      set((s) => ({
        nodeDefs: candidate,
        nodeDefsParsed: result.parsed,
        nodeDefsDirty: true,
        nodeDefsRevision: s.nodeDefsRevision + 1,
      }));
      return id;
    },

    duplicateNodeDef: (id) => {
      const { nodeDefs } = get();
      const source = nodeDefs.find((d) => d.id === id);
      if (!source) {
        toast.error(`Can't duplicate — node def "${id}" not found`);
        return null;
      }
      const newId = freshId(
        nodeDefs.map((d) => d.id),
        `${id}_copy`,
      );
      // Deep-copy via JSON round-trip (mirrors `serializeMap`'s posture elsewhere) — `AuthoredNodeDef`
      // is plain JSON-shaped data, no functions/Dates/etc to worry about losing.
      const cloned = JSON.parse(JSON.stringify(source)) as AuthoredNodeDef;
      const copy: AuthoredNodeDef = { ...cloned, id: newId, name: `${source.name} copy` };
      const candidate = [...nodeDefs, copy];
      const result = tryParseNodeDefs(candidate);
      if (!result.ok) {
        toast.error(`Couldn't duplicate node def: ${result.error}`);
        return null;
      }
      set((s) => ({
        nodeDefs: candidate,
        nodeDefsParsed: result.parsed,
        nodeDefsDirty: true,
        nodeDefsRevision: s.nodeDefsRevision + 1,
      }));
      return newId;
    },

    updateNodeDef: (id, patch) => {
      const { nodeDefs } = get();
      const index = nodeDefs.findIndex((d) => d.id === id);
      if (index < 0) {
        toast.error(`Can't update — node def "${id}" not found`);
        return false;
      }
      const candidate = nodeDefs.slice();
      candidate[index] = { ...candidate[index], ...patch, id, skins: candidate[index].skins };
      const result = tryParseNodeDefs(candidate);
      if (!result.ok) {
        toast.error(`Invalid node def: ${result.error}`);
        return false;
      }
      set((s) => ({
        nodeDefs: candidate,
        nodeDefsParsed: result.parsed,
        nodeDefsDirty: true,
        nodeDefsRevision: s.nodeDefsRevision + 1,
      }));
      return true;
    },

    deleteNodeDef: (id) => {
      const { nodeDefs, map } = get();
      const index = nodeDefs.findIndex((d) => d.id === id);
      if (index < 0) {
        toast.error(`Can't delete — node def "${id}" not found`);
        return false;
      }
      if (openMapReferencesNodeDef(map, id)) {
        toast.error(`Can't delete "${id}" — it's still placed in the open map`);
        return false;
      }
      const candidate = nodeDefs.slice();
      candidate.splice(index, 1);
      const result = tryParseNodeDefs(candidate);
      if (!result.ok) {
        toast.error(`Couldn't delete node def: ${result.error}`);
        return false;
      }
      set((s) => ({
        nodeDefs: candidate,
        nodeDefsParsed: result.parsed,
        nodeDefsDirty: true,
        nodeDefsRevision: s.nodeDefsRevision + 1,
      }));
      return true;
    },

    addSkin: (defId) => {
      const { nodeDefs } = get();
      const defIndex = nodeDefs.findIndex((d) => d.id === defId);
      if (defIndex < 0) {
        toast.error(`Can't add skin — node def "${defId}" not found`);
        return null;
      }
      const def = nodeDefs[defIndex];
      const skinId = freshId(
        def.skins.map((s) => s.id),
        'skin',
      );
      const newSkin: NodeSkinDef = { id: skinId, asset: PLACEHOLDER_SKIN_ASSET, weight: 1 };
      const candidate = nodeDefs.slice();
      candidate[defIndex] = { ...def, skins: [...def.skins, newSkin] };
      const result = tryParseNodeDefs(candidate);
      if (!result.ok) {
        toast.error(`Couldn't add skin: ${result.error}`);
        return null;
      }
      set((s) => ({
        nodeDefs: candidate,
        nodeDefsParsed: result.parsed,
        nodeDefsDirty: true,
        nodeDefsRevision: s.nodeDefsRevision + 1,
      }));
      return skinId;
    },

    updateSkin: (defId, skinId, patch) => {
      const { nodeDefs } = get();
      const defIndex = nodeDefs.findIndex((d) => d.id === defId);
      if (defIndex < 0) {
        toast.error(`Can't update skin — node def "${defId}" not found`);
        return false;
      }
      const def = nodeDefs[defIndex];
      const skinIndex = def.skins.findIndex((s) => s.id === skinId);
      if (skinIndex < 0) {
        toast.error(`Can't update skin — "${skinId}" not found on def "${defId}"`);
        return false;
      }
      const skins = def.skins.slice();
      skins[skinIndex] = { ...skins[skinIndex], ...patch, id: skinId };
      const candidate = nodeDefs.slice();
      candidate[defIndex] = { ...def, skins };
      const result = tryParseNodeDefs(candidate);
      if (!result.ok) {
        toast.error(`Invalid skin: ${result.error}`);
        return false;
      }
      set((s) => ({
        nodeDefs: candidate,
        nodeDefsParsed: result.parsed,
        nodeDefsDirty: true,
        nodeDefsRevision: s.nodeDefsRevision + 1,
      }));
      return true;
    },

    removeSkin: (defId, skinId) => {
      const { nodeDefs, map } = get();
      const defIndex = nodeDefs.findIndex((d) => d.id === defId);
      if (defIndex < 0) {
        toast.error(`Can't remove skin — node def "${defId}" not found`);
        return false;
      }
      const def = nodeDefs[defIndex];
      const skinIndex = def.skins.findIndex((s) => s.id === skinId);
      if (skinIndex < 0) {
        toast.error(`Can't remove skin — "${skinId}" not found on def "${defId}"`);
        return false;
      }
      if (openMapReferencesNodeDef(map, defId, skinId)) {
        toast.error(`Can't remove skin "${skinId}" — it's still placed on a node in the open map`);
        return false;
      }
      const skins = def.skins.slice();
      skins.splice(skinIndex, 1);
      const candidate = nodeDefs.slice();
      candidate[defIndex] = { ...def, skins };
      // parseNodeDefs itself refuses an empty `skins` array — no separate "last skin" check needed.
      const result = tryParseNodeDefs(candidate);
      if (!result.ok) {
        toast.error(`Couldn't remove skin: ${result.error}`);
        return false;
      }
      set((s) => ({
        nodeDefs: candidate,
        nodeDefsParsed: result.parsed,
        nodeDefsDirty: true,
        nodeDefsRevision: s.nodeDefsRevision + 1,
      }));
      return true;
    },

    moveSkin: (defId, skinId, toIndex) => {
      const { nodeDefs } = get();
      const defIndex = nodeDefs.findIndex((d) => d.id === defId);
      if (defIndex < 0) {
        toast.error(`Can't reorder skins — node def "${defId}" not found`);
        return false;
      }
      const def = nodeDefs[defIndex];
      const skinIndex = def.skins.findIndex((s) => s.id === skinId);
      if (skinIndex < 0) {
        toast.error(`Can't reorder skins — "${skinId}" not found on def "${defId}"`);
        return false;
      }
      const skins = def.skins.slice();
      const [moved] = skins.splice(skinIndex, 1);
      const clampedIndex = Math.max(0, Math.min(toIndex, skins.length));
      skins.splice(clampedIndex, 0, moved);
      const candidate = nodeDefs.slice();
      candidate[defIndex] = { ...def, skins };
      const result = tryParseNodeDefs(candidate);
      if (!result.ok) {
        toast.error(`Couldn't reorder skins: ${result.error}`);
        return false;
      }
      set((s) => ({
        nodeDefs: candidate,
        nodeDefsParsed: result.parsed,
        nodeDefsDirty: true,
        nodeDefsRevision: s.nodeDefsRevision + 1,
      }));
      return true;
    },

    // ---- resize (plan 024 step 2) ----

    resizeMap: (edges) => {
      const { map, mapId, world } = get();
      if (!map || !mapId) return false;
      const plan = planResize(map, edges);
      if (!plan.dimsValid || plan.offendingObjectIds.length > 0) return false;
      const { dLeft, dTop } = plan;
      const resized = applyResize(map, edges);

      // Capture prior array/ref state (mirrors `buildShapeCommand`'s captured-prior-reference style)
      // so `undo` is a cheap reference-restore, never a re-derivation.
      const oldState = {
        width: map.meta.width,
        height: map.meta.height,
        shape: map.shape,
        layerCells: map.layers.map((l) => l.cells),
        terrainCells: map.terrain.map((t) => t.cells),
        walk: map.walkability.cells,
        zones: map.zones.cells,
        objects: map.objects,
      };
      const newState = {
        width: resized.meta.width,
        height: resized.meta.height,
        shape: resized.shape,
        layerCells: resized.layers.map((l) => l.cells),
        terrainCells: resized.terrain.map((t) => t.cells),
        walk: resized.walkability.cells,
        zones: resized.zones.cells,
        objects: resized.objects,
      };
      const applyState = (st: typeof oldState): void => {
        map.meta.width = st.width;
        map.meta.height = st.height;
        map.shape = st.shape;
        map.layers.forEach((l, i) => {
          l.cells = st.layerCells[i];
        });
        map.terrain.forEach((t, i) => {
          t.cells = st.terrainCells[i];
        });
        map.walkability.cells = st.walk;
        map.zones.cells = st.zones;
        map.objects = st.objects;
      };

      // Underlay: shift the PERSISTED offset (not the live cache — `syncUnderlayFromSettings` picks
      // that up after `applyCommand`) even if this map's underlay isn't currently hydrated, so a
      // later `hydrateUnderlay` on this map resolves the already-corrected offset.
      const baseSettings = getSettings(mapId);
      const shiftUnderlay = !!baseSettings && (dLeft !== 0 || dTop !== 0);

      // World coupling: only a top/left edit moves the origin, and only if this map is placed.
      const placement =
        dLeft !== 0 || dTop !== 0 ? world.placements.find((p) => p.mapId === mapId) : undefined;
      const prevOrigin = placement
        ? { col: placement.origin.col, row: placement.origin.row }
        : null;
      const coupled = !!placement;

      const cmd: Command = {
        do: () => {
          applyState(newState);
          if (shiftUnderlay && baseSettings) {
            putSettings(mapId, {
              ...baseSettings,
              offsetX: baseSettings.offsetX + dLeft,
              offsetY: baseSettings.offsetY + dTop,
            });
          }
          if (placement && prevOrigin) {
            placement.origin = { col: prevOrigin.col - dLeft, row: prevOrigin.row - dTop };
          }
        },
        undo: () => {
          applyState(oldState);
          if (shiftUnderlay && baseSettings) {
            putSettings(mapId, baseSettings);
          }
          if (placement && prevOrigin) {
            placement.origin = { col: prevOrigin.col, row: prevOrigin.row };
          }
        },
      };

      // `applyCommand`/`applyWorldCommand` each hard-code ONE domain's side effects; a resize can need
      // BOTH at once, so this inlines `history.apply` with the conditional `domain` tag (mirroring
      // `applyWorldCommand`'s own inline style) rather than forcing either of those two through a
      // domain they don't own.
      history.apply({ ...cmd, domain: coupled ? 'map+world' : undefined });
      get().syncUnderlayFromSettings();
      set((s) => ({
        dirty: true,
        docRevision: s.docRevision + 1,
        regionSelection: null, // a crop/grow can leave the box off the new bounds — drop it
        activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
        selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
        activeZoneId: reconcileActiveZone(s.map, s.activeZoneId),
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
        ...(coupled ? { worldDirty: true, worldRevision: s.worldRevision + 1 } : {}),
      }));
      if (coupled) {
        toast.info('Map resized — world layout has unsaved changes (Save World separately).');
      }
      return true;
    },

    renameMapState: (newId, newName) => {
      const { map, mapId: oldId, world } = get();
      if (!map) return { placementMigrated: false };

      const idChanged = newId !== oldId;

      // Underlay settings migration (only on an id change, and only if the old id had settings).
      let underlayMigrated = false;
      if (idChanged && oldId) {
        const settings = getSettings(oldId);
        if (settings) {
          putSettings(newId, settings);
          deleteSettings(oldId);
          underlayMigrated = true;
        }
      }

      // Library view-state migration (plan 030): move recents + browse from old→new id so a
      // rename+reload keeps them and leaves no orphaned `oldId` keys (mirrors the underlay above).
      // In-memory `libraryRecents`/`libraryBrowse` are unchanged by a rename — only the persistence
      // key moves. Both `get*` degrade to empty/null, so an absent value just deletes nothing.
      if (idChanged && oldId) {
        const recents = getRecents(oldId);
        if (recents.length) {
          putRecents(newId, recents);
          deleteRecents(oldId);
        }
        const browse = getBrowse(oldId);
        if (browse) {
          putBrowse(newId, { ...browse, search: '' });
          deleteBrowse(oldId);
        }
      }

      // World placement migration: rewrite the matching placement's mapId in place (mirrors
      // `movePlacement`'s in-place mutation) so the World tab sees the same array reference.
      let placementMigrated = false;
      if (idChanged) {
        const placement = world.placements.find((p) => p.mapId === oldId);
        if (placement) {
          placement.mapId = newId;
          placementMigrated = true;
        }
      }

      set((s) => ({
        map: s.map ? { ...s.map, meta: { ...s.map.meta, id: newId, name: newName } } : s.map,
        mapId: newId,
        dirty: false,
        ...(underlayMigrated ? { underlayRevision: s.underlayRevision + 1 } : {}),
        ...(placementMigrated ? { worldDirty: true, worldRevision: s.worldRevision + 1 } : {}),
      }));

      return { placementMigrated };
    },

    // ---- painting ----

    paintLine: (fromCol, fromRow, toCol, toRow, strokeId) => {
      const { map, activeLayerId, brushAsset, brushRotation } = get();
      if (!map || !activeLayerId) return;
      const layerIndex = map.layers.findIndex((l) => l.id === activeLayerId);
      const layer = map.layers[layerIndex];
      if (!layer) return;
      // Brush gesture carries the pending rotation; fill/rect stay angle-0 this plan.
      const value = resolveBrushValue(map, brushAsset, brushRotation);
      const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
        isInside(map, col, row),
      );
      const changes = cellsToChanges(layer.cells, map.meta.width, points, value);
      const cmd = commandFromChanges(layer.cells, changes, value, strokeId);
      if (!cmd) return;
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
      const cmd = commandFromChanges(layer.cells, changes, 0, strokeId);
      if (!cmd) return;
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
      const value = resolveBrushValue(map, brushAsset, 0); // fill stays angle-0 (brush-only rotation this plan)
      const changes = floodFill(
        layer.cells,
        map.meta.width,
        map.meta.height,
        col,
        row,
        value,
        (c, r) => isInside(map, c, r),
      );
      const cmd = commandFromChanges(layer.cells, changes, value);
      if (!cmd) return;
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
      const value = resolveBrushValue(map, brushAsset, 0); // rect stays angle-0 (brush-only rotation this plan)
      const points = rectCells(c0, r0, c1, r1, (c, r) => isInside(map, c, r));
      const changes = cellsToChanges(layer.cells, map.meta.width, points, value);
      const cmd = commandFromChanges(layer.cells, changes, value);
      if (!cmd) return;
      const chunks = [...new Set(points.map(({ row }) => Math.floor(row / GROUND_CHUNK_ROWS)))];
      set({ pendingDirty: { layerIndex, chunks } });
      get().applyCommand(cmd);
    },

    // ---- collision / walkability (step 8) ----
    // Base-terrain passability only, gated by the shape mask like every other paint tool. No tile
    // layer is touched, so there's nothing to rebake — `pendingDirty: { layerIndex: 0, chunks: [] }`
    // reuses the existing narrow-rebake signal to mean "rebake nothing" (an empty chunk list is a
    // no-op loop in `EditorScene.onDocEdited`) instead of falling back to a full, pointless retile.

    paintWalkabilityLine: (fromCol, fromRow, toCol, toRow, strokeId, blocked) => {
      const map = get().map;
      if (!map) return;
      const value = blocked ? 1 : 0;
      const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
        isInside(map, col, row),
      );
      const changes = cellsToChanges(map.walkability.cells, map.meta.width, points, value);
      const cmd = commandFromChanges(map.walkability.cells, changes, value, strokeId);
      if (!cmd) return;
      set({ pendingDirty: { layerIndex: 0, chunks: [] } });
      get().applyCommand(cmd);
    },

    fillWalkabilityFrom: (col, row, blocked) => {
      const map = get().map;
      if (!map) return;
      const value = blocked ? 1 : 0;
      const changes = floodFill(
        map.walkability.cells,
        map.meta.width,
        map.meta.height,
        col,
        row,
        value,
        (c, r) => isInside(map, c, r),
      );
      const cmd = commandFromChanges(map.walkability.cells, changes, value);
      if (!cmd) return;
      set({ pendingDirty: { layerIndex: 0, chunks: [] } });
      get().applyCommand(cmd);
    },

    paintWalkabilityRect: (c0, r0, c1, r1, blocked) => {
      const map = get().map;
      if (!map) return;
      const value = blocked ? 1 : 0;
      const points = rectCells(c0, r0, c1, r1, (c, r) => isInside(map, c, r));
      const changes = cellsToChanges(map.walkability.cells, map.meta.width, points, value);
      const cmd = commandFromChanges(map.walkability.cells, changes, value);
      if (!cmd) return;
      set({ pendingDirty: { layerIndex: 0, chunks: [] } });
      get().applyCommand(cmd);
    },

    // ---- zones (step 8) ----

    createZone: () => {
      const map = get().map;
      if (!map) return null;
      const id = nextFreeZoneId(map.zones.defs);
      if (id === null) {
        console.warn('[editor] cannot create zone — id space exhausted (255 zones)');
        return null;
      }
      const def: ZoneDef = {
        id,
        name: `Zone ${id}`,
        colour: defaultZoneColour(map.zones.defs.length),
        favourites: [],
      };
      const cmd: Command = {
        do: () => {
          map.zones.defs.push(def);
        },
        undo: () => {
          const i = map.zones.defs.indexOf(def);
          if (i >= 0) map.zones.defs.splice(i, 1);
        },
      };
      get().applyCommand(cmd);
      set({ activeZoneId: id });
      return id;
    },

    renameZone: (id, name) => {
      const map = get().map;
      if (!map) return;
      const def = map.zones.defs.find((z) => z.id === id);
      if (!def) return;
      const trimmed = name.trim();
      if (trimmed.length === 0 || trimmed === def.name) return;
      const prev = def.name;
      const cmd: Command = {
        do: () => {
          def.name = trimmed;
        },
        undo: () => {
          def.name = prev;
        },
      };
      get().applyCommand(cmd);
    },

    recolourZone: (id, colour) => {
      const map = get().map;
      if (!map) return;
      const def = map.zones.defs.find((z) => z.id === id);
      if (!def || def.colour === colour) return;
      const prev = def.colour;
      const cmd: Command = {
        do: () => {
          def.colour = colour;
        },
        undo: () => {
          def.colour = prev;
        },
      };
      get().applyCommand(cmd);
    },

    deleteZone: (id) => {
      const map = get().map;
      if (!map) return;
      const defIndex = map.zones.defs.findIndex((z) => z.id === id);
      if (defIndex < 0) return;
      const removedDef = map.zones.defs[defIndex];
      const cellChanges: CellChange[] = [];
      map.zones.cells.forEach((v, index) => {
        if (v === id) cellChanges.push({ index, prev: v });
      });
      const cmd: Command = {
        do: () => {
          map.zones.defs.splice(defIndex, 1);
          for (const c of cellChanges) map.zones.cells[c.index] = 0;
        },
        undo: () => {
          map.zones.defs.splice(defIndex, 0, removedDef);
          for (const c of cellChanges) map.zones.cells[c.index] = c.prev;
        },
      };
      // `applyCommand` reconciles `activeZoneId` to `null` automatically if it pointed at the
      // just-removed def (see `reconcileActiveZone`) — no separate deselect step needed here.
      get().applyCommand(cmd);
    },

    paintZoneLine: (fromCol, fromRow, toCol, toRow, strokeId, paint) => {
      const { map, activeZoneId } = get();
      if (!map) return;
      if (paint && activeZoneId === null) {
        console.warn('[editor] zone brush: no active zone selected — arm one in the Zones panel');
        return;
      }
      const value = paint ? (activeZoneId as number) : 0;
      const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
        isInside(map, col, row),
      );
      const changes = cellsToChanges(map.zones.cells, map.meta.width, points, value);
      const cmd = commandFromChanges(map.zones.cells, changes, value, strokeId);
      if (!cmd) return;
      set({ pendingDirty: { layerIndex: 0, chunks: [] } });
      get().applyCommand(cmd);
    },

    fillZoneFrom: (col, row, paint) => {
      const { map, activeZoneId } = get();
      if (!map) return;
      if (paint && activeZoneId === null) {
        console.warn('[editor] zone fill: no active zone selected — arm one in the Zones panel');
        return;
      }
      const value = paint ? (activeZoneId as number) : 0;
      const changes = floodFill(
        map.zones.cells,
        map.meta.width,
        map.meta.height,
        col,
        row,
        value,
        (c, r) => isInside(map, c, r),
      );
      const cmd = commandFromChanges(map.zones.cells, changes, value);
      if (!cmd) return;
      set({ pendingDirty: { layerIndex: 0, chunks: [] } });
      get().applyCommand(cmd);
    },

    paintZoneRect: (c0, r0, c1, r1, paint) => {
      const { map, activeZoneId } = get();
      if (!map) return;
      if (paint && activeZoneId === null) {
        console.warn('[editor] zone rect: no active zone selected — arm one in the Zones panel');
        return;
      }
      const value = paint ? (activeZoneId as number) : 0;
      const points = rectCells(c0, r0, c1, r1, (c, r) => isInside(map, c, r));
      const changes = cellsToChanges(map.zones.cells, map.meta.width, points, value);
      const cmd = commandFromChanges(map.zones.cells, changes, value);
      if (!cmd) return;
      set({ pendingDirty: { layerIndex: 0, chunks: [] } });
      get().applyCommand(cmd);
    },

    // ---- shape (step 8) ----
    // Deliberately NOT gated by `isInside` — see `buildShapeCommand`'s doc. A shape edit can touch
    // every tile layer at once (the void cascade), so it explicitly clears `pendingDirty` to force
    // `onDocEdited`'s full chunked rebake fallback rather than narrowing to one layer.

    paintShapeLine: (fromCol, fromRow, toCol, toRow, strokeId, inside) => {
      const map = get().map;
      if (!map) return;
      const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
        inBounds(map, col, row),
      );
      const cmd = buildShapeCommand(map, points, inside);
      if (!cmd) return;
      cmd.strokeId = strokeId;
      set({ pendingDirty: null });
      get().applyCommand(cmd);
    },

    fillShapeFrom: (col, row, inside) => {
      const map = get().map;
      if (!map) return;
      // Flood fill bounded only by map bounds (not the mask it's editing) — matches every other
      // shape operation's `inBounds` gate.
      const width = map.meta.width;
      const height = map.meta.height;
      const baseCells = map.shape
        ? map.shape.cells
        : (new Array(width * height).fill(1) as number[]);
      const changes = floodFill(baseCells, width, height, col, row, inside ? 1 : 0, () => true);
      if (changes.length === 0) return;
      const points = changes.map((c) => ({
        col: c.index % width,
        row: Math.floor(c.index / width),
      }));
      const cmd = buildShapeCommand(map, points, inside);
      if (!cmd) return;
      set({ pendingDirty: null });
      get().applyCommand(cmd);
    },

    paintShapeRect: (c0, r0, c1, r1, inside) => {
      const map = get().map;
      if (!map) return;
      const points = rectCells(c0, r0, c1, r1, (c, r) => inBounds(map, c, r));
      const cmd = buildShapeCommand(map, points, inside);
      if (!cmd) return;
      set({ pendingDirty: null });
      get().applyCommand(cmd);
    },

    // ---- terrain (step 10) ----
    // A terrain paint/erase always requires an armed terrain (`activeTerrainId`) — unlike the zone
    // tool's "erase clears regardless of which zone owned the cell", terrain sections are keyed by
    // (layerId, terrainId) so erasing needs to know WHICH section's mask/bake to touch, same as
    // painting does. Every path clears `pendingDirty` (forces EditorScene's full chunked-rebake
    // fallback) rather than narrowing to a chunk list: a terrain rebake's affected cells can span the
    // touched cell's whole 8-neighbour ring, potentially crossing a chunk boundary — see terrainOps.ts's
    // module doc for why the bake itself always sweeps the full mask regardless.

    paintTerrainLine: (fromCol, fromRow, toCol, toRow, strokeId, on) => {
      const { map, activeLayerId, activeTerrainId, terrainCatalog } = get();
      if (!map || !activeLayerId) return;
      if (activeTerrainId === null) {
        console.warn('[editor] terrain brush: no active terrain armed — pick one in the Library');
        return;
      }
      const layer = map.layers.find((l) => l.id === activeLayerId);
      const terrainDef = terrainCatalog?.terrains.find((t) => t.id === activeTerrainId);
      if (!layer || !terrainDef) return;
      const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
        isInside(map, col, row),
      );
      const cmd = buildTerrainCommand(map, layer, activeTerrainId, terrainDef, points, on);
      if (!cmd) return;
      cmd.strokeId = strokeId;
      set({ pendingDirty: null });
      get().applyCommand(cmd);
    },

    fillTerrainFrom: (col, row, on) => {
      const { map, activeLayerId, activeTerrainId, terrainCatalog } = get();
      if (!map || !activeLayerId) return;
      if (activeTerrainId === null) {
        console.warn('[editor] terrain fill: no active terrain armed — pick one in the Library');
        return;
      }
      const layer = map.layers.find((l) => l.id === activeLayerId);
      const terrainDef = terrainCatalog?.terrains.find((t) => t.id === activeTerrainId);
      if (!layer || !terrainDef) return;
      const width = map.meta.width;
      const height = map.meta.height;
      const section = map.terrain.find(
        (t) => t.layerId === activeLayerId && t.terrainId === activeTerrainId,
      );
      const baseCells = section ? section.cells : (new Array(width * height).fill(0) as number[]);
      const changes = floodFill(baseCells, width, height, col, row, on ? 1 : 0, (c, r) =>
        isInside(map, c, r),
      );
      if (changes.length === 0) return;
      const points = changes.map((c) => ({
        col: c.index % width,
        row: Math.floor(c.index / width),
      }));
      const cmd = buildTerrainCommand(map, layer, activeTerrainId, terrainDef, points, on);
      if (!cmd) return;
      set({ pendingDirty: null });
      get().applyCommand(cmd);
    },

    paintTerrainRect: (c0, r0, c1, r1, on) => {
      const { map, activeLayerId, activeTerrainId, terrainCatalog } = get();
      if (!map || !activeLayerId) return;
      if (activeTerrainId === null) {
        console.warn('[editor] terrain rect: no active terrain armed — pick one in the Library');
        return;
      }
      const layer = map.layers.find((l) => l.id === activeLayerId);
      const terrainDef = terrainCatalog?.terrains.find((t) => t.id === activeTerrainId);
      if (!layer || !terrainDef) return;
      const points = rectCells(c0, r0, c1, r1, (c, r) => isInside(map, c, r));
      const cmd = buildTerrainCommand(map, layer, activeTerrainId, terrainDef, points, on);
      if (!cmd) return;
      set({ pendingDirty: null });
      get().applyCommand(cmd);
    },

    rebakeTerrainsForSave: () => {
      const { map, terrainCatalog } = get();
      if (!map) return false;
      const dims: Dims = { cols: map.meta.width, rows: map.meta.height };
      let changed = false;
      for (const section of map.terrain) {
        const layer = map.layers.find((l) => l.id === section.layerId);
        if (!layer) continue; // orphaned section (its layer was deleted) — nothing to bake into
        const terrainDef = terrainCatalog?.terrains.find((t) => t.id === section.terrainId);
        if (!terrainDef) continue; // unknown terrain id (catalog not loaded, or a stale id) — skip, don't crash
        const resolveIndex = (frame: number): number =>
          findOrAppendPaletteIndex(
            map,
            terrainDef.pack,
            {
              kind: 'sheetFrame',
              sheet: terrainDef.sheet,
              frame,
            },
            0, // terrain autotile always bakes at angle 0 (brush-only rotation this plan)
          );
        const bakeChanges = computeTerrainBake(
          section.cells,
          dims,
          terrainDef.mapping,
          new Set(),
          layer.cells,
          resolveIndex,
        );
        for (const c of bakeChanges) layer.cells[c.index] = c.next;
        if (bakeChanges.length > 0) changed = true;
      }
      if (changed) set((s) => ({ docRevision: s.docRevision + 1, pendingDirty: null }));
      return changed;
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

    // ---- tile palettes (plan 033 step 9 — GLOBAL, auto-saved, NOT undoable) ----

    setTilePalettes: (palettes) => {
      set({ tilePalettes: palettes });
      get().reconcileActiveTilePalette();
    },

    reconcileActiveTilePalette: () =>
      set((s) => ({
        activeTilePaletteId: resolveActiveTilePalette(s.tilePalettes, s.activeTilePaletteId),
      })),

    setActiveTilePalette: (id) => set({ activeTilePaletteId: id }),

    addTilePalette: (name) => {
      const palettes = get().tilePalettes;
      const id = nextTilePaletteId(palettes);
      const created: NamedTilePalette = {
        id,
        name: name?.trim() || `Palette ${palettes.length + 1}`,
        slots: [],
      };
      // Plain immutable append — the global slice is the source of truth (no map history, no dirty).
      set({ tilePalettes: [...palettes, created], activeTilePaletteId: id });
    },

    addTilesToActivePalette: (entries) => {
      if (entries.length === 0) return;
      const palettes = get().tilePalettes;
      // Lazy first-palette creation: with no palettes yet, materialise "Palette 1" and make it active.
      // Otherwise target the active palette (falling back to the first if the pointer is null/dangling).
      const lazyCreate = palettes.length === 0;
      const created: NamedTilePalette | null = lazyCreate
        ? { id: nextTilePaletteId(palettes), name: 'Palette 1', slots: [] }
        : null;
      const active = get().activeTilePaletteId;
      const target = created ?? palettes.find((p) => p.id === active) ?? palettes[0];
      // Dedupe exact `assetId`+`rotation` duplicates — against the target's existing slots AND within
      // this batch. Slot key normalises a missing rotation to 0.
      const slotKey = (s: TilePaletteSlot): string => `${s.assetId}#${s.rotation ?? 0}`;
      const seen = new Set(target.slots.map(slotKey));
      const toAppend: TilePaletteSlot[] = [];
      for (const e of entries) {
        const key = slotKey(e);
        if (seen.has(key)) continue;
        seen.add(key);
        // Normalise rotation omit-when-absent so slots round-trip byte-identical (Step 1 contract).
        toAppend.push(
          e.rotation ? { assetId: e.assetId, rotation: e.rotation } : { assetId: e.assetId },
        );
      }
      if (toAppend.length === 0 && !created) return; // nothing new and no structural change to make
      // Build the next palette set immutably: a NEW target object with a NEW slots array, and (when
      // lazily created) the new palette appended.
      const updatedTarget: NamedTilePalette = { ...target, slots: [...target.slots, ...toAppend] };
      const nextPalettes = created
        ? [...palettes, updatedTarget]
        : palettes.map((p) => (p.id === target.id ? updatedTarget : p));
      set({
        tilePalettes: nextPalettes,
        // A lazily-created palette becomes active as view-state.
        ...(created ? { activeTilePaletteId: created.id } : {}),
      });
    },

    removeTilePaletteSlot: (paletteId, index) => {
      const palettes = get().tilePalettes;
      const palette = palettes.find((p) => p.id === paletteId);
      if (!palette || index < 0 || index >= palette.slots.length) return;
      const updated: NamedTilePalette = {
        ...palette,
        slots: palette.slots.filter((_, i) => i !== index),
      };
      set({ tilePalettes: palettes.map((p) => (p.id === paletteId ? updated : p)) });
    },

    selectPaletteSlot: (slot) => {
      // Brush-arm, NOT a palette mutation — replicates `pickTile`'s store-level arm sequence
      // (LibraryPanel.tsx `pickTile`; that copy also does component-only recents/onPick side effects,
      // so this can't call it directly). Adds a `brushRotation` set for the slot's rotation.
      const s = get();
      s.setBrushAsset(slot.assetId);
      s.setBrushRotation((slot.rotation ?? 0) as 0 | 90 | 180 | 270);
      if (s.activeTool !== 'brush' && s.activeTool !== 'rect') s.setActiveTool('brush');
    },

    togglePalettePickMode: () =>
      set((s): Partial<EditorState> => {
        const palettePickMode = !s.palettePickMode;
        // Leaving pick mode clears the selection so a stale set never lingers into the next session.
        return {
          palettePickMode,
          palettePickSelection: palettePickMode ? s.palettePickSelection : [],
        };
      }),

    togglePalettePickTile: (assetId) =>
      set((s): Partial<EditorState> => ({
        palettePickSelection: s.palettePickSelection.includes(assetId)
          ? s.palettePickSelection.filter((a) => a !== assetId)
          : [...s.palettePickSelection, assetId],
      })),

    clearPalettePick: () => set({ palettePickSelection: [] }),

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
        rotation: get().placeRotation, // sticky placement-wheel angle (deg); 0 = upright default
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
      // Roll a weighted-random skin from the def so a placed forest comes out visually varied
      // (plan 021 step 9) — the inspector picker + cycle-skin shortcut let you override it after.
      // Only persist `skin` when the roll differs from the def's default (`skins[0]`): an omitted
      // `skin` already means "the first skin", so single-skin seeds (tree/rock/bush) stay byte-identical
      // to today and map files don't carry a redundant `skin: "default"` on every placement.
      const def = get().nodeDefsParsed[ref];
      const rolled = def && def.skins.length > 0 ? pickWeighted(def.skins).id : undefined;
      const skin = rolled !== undefined && def && rolled !== def.skins[0].id ? rolled : undefined;
      // Stamp the sticky placement-wheel angle, omitted when 0 so an upright node stays byte-identical
      // to a legacy (rotation-less) placement — mirrors `skin`'s omitted-when-default treatment.
      const rotation = get().placeRotation;
      const obj: NodeObject = {
        id,
        kind: 'node',
        ref,
        col,
        row,
        ...(skin !== undefined ? { skin } : {}),
        ...(rotation ? { rotation } : {}),
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

    translateRegion: (dCol, dRow) => {
      const { map, regionSelection: region } = get();
      if (!map || !region) return false;
      if (dCol === 0 && dRow === 0) return true; // no movement — nothing to commit (no undo noise)

      const { width, height, tileSize } = map.meta;
      // Refuse before mutating anything (mirrors `translateObjects`' all-or-nothing contract):
      //  1. the box must stay fully on-map (never silently drop tiles off the edge), and
      //  2. no destination tile may be void (never break parseMap's void-consistency invariant).
      if (!regionMoveInBounds(region, dCol, dRow, width, height)) return false;
      if (!regionDestinationInside(map, region, dCol, dRow)) return false;

      // Capture every object whose footprint intersects the box, and validate each one's DESTINATION
      // footprint up-front — one invalid target (e.g. a decor collision box that would poke off-map)
      // refuses the WHOLE move, exactly like `translateObjects`.
      const capturedIds = new Set(captureRegionObjects(map, region));
      const targets = map.objects.filter((o) => capturedIds.has(o.id));
      const objPrev = new Map<string, { x: number; y: number } | { col: number; row: number }>();
      const objNext = new Map<string, { x: number; y: number } | { col: number; row: number }>();
      for (const obj of targets) {
        if (obj.kind === 'decor') {
          objPrev.set(obj.id, { x: obj.x, y: obj.y });
          objNext.set(obj.id, { x: obj.x + dCol * tileSize, y: obj.y + dRow * tileSize });
        } else if (obj.kind === 'node') {
          objPrev.set(obj.id, { col: obj.col, row: obj.row });
          objNext.set(obj.id, { col: obj.col + dCol, row: obj.row + dRow });
        } else {
          objPrev.set(obj.id, { col: obj.rect.col, row: obj.rect.row });
          objNext.set(obj.id, { col: obj.rect.col + dCol, row: obj.rect.row + dRow });
        }
      }
      for (const obj of targets) {
        const n = objNext.get(obj.id);
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
        if (!footprintIsValid(map, candidate)) return false;
      }

      // Block-move edits for every flat width*height grid EXCEPT the void/shape mask (structural, see
      // the action doc): all tile layers, walkability, zones, and each terrain mask. A grid that
      // doesn't change (e.g. an untouched walkability grid) contributes nothing.
      const isIn = (c: number, r: number): boolean => isInside(map, c, r);
      const gridMoves: Array<{ cells: number[]; edits: RegionCellEdit[] }> = [];
      const collect = (cells: number[]): void => {
        const edits = computeGridRegionMove(cells, width, region, dCol, dRow, isIn);
        if (edits.length > 0) gridMoves.push({ cells, edits });
      };
      for (const layer of map.layers) collect(layer.cells);
      collect(map.walkability.cells);
      collect(map.zones.cells);
      for (const section of map.terrain) collect(section.cells);

      const applyObj = (
        which: Map<string, { x: number; y: number } | { col: number; row: number }>,
      ): void => {
        for (const obj of targets) {
          const v = which.get(obj.id);
          if (!v) continue;
          if (obj.kind === 'decor') {
            obj.x = (v as { x: number; y: number }).x;
            obj.y = (v as { x: number; y: number }).y;
          } else if (obj.kind === 'node') {
            obj.col = (v as { col: number; row: number }).col;
            obj.row = (v as { col: number; row: number }).row;
          } else {
            obj.rect.col = (v as { col: number; row: number }).col;
            obj.rect.row = (v as { col: number; row: number }).row;
          }
        }
      };

      const cmd: Command = {
        do: () => {
          for (const g of gridMoves) for (const e of g.edits) g.cells[e.index] = e.next;
          applyObj(objNext);
        },
        undo: () => {
          for (const g of gridMoves) for (const e of g.edits) g.cells[e.index] = e.prev;
          applyObj(objPrev);
        },
      };
      // Multiple layers move at once — no narrowed rebake is worth it, so force the scene's full
      // chunked rebake by leaving `pendingDirty` cleared (see the module doc + shape/void cascade).
      set({ pendingDirty: null });
      get().applyCommand(cmd);
      // The box follows its contents so repeated nudges keep moving the same group. Set AFTER
      // applyCommand (whose own `set` doesn't touch `regionSelection`).
      set({ regionSelection: { ...region, col: region.col + dCol, row: region.row + dRow } });
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
      // rotation is optional: a zero angle is stored as `undefined` (key dropped by JSON.stringify) so
      // an unrotated node round-trips byte-identical, matching how `skin`/placement omit their defaults.
      const norm: Partial<NodeObject> = { ...patch };
      if ('rotation' in norm && !norm.rotation) norm.rotation = undefined;
      // depthBias mirrors rotation's omit-when-zero (plan 029) so an Inspector edit back to 0 clears
      // the key, matching `bumpDepth`'s normalisation.
      if ('depthBias' in norm && !norm.depthBias) norm.depthBias = undefined;
      const candidate: NodeObject = { ...obj, ...norm };
      if (!footprintIsValid(map, candidate)) return false;
      // Snapshot exactly the keys being patched (mirrors `updateDecor`) so undo restores rotation/skin
      // too, not just col/row.
      const prev: Partial<NodeObject> = {};
      for (const key of Object.keys(norm) as Array<keyof NodeObject>) {
        (prev as Record<string, unknown>)[key] = obj[key];
      }
      const cmd: Command = {
        do: () => Object.assign(obj, norm),
        undo: () => Object.assign(obj, prev),
      };
      get().applyCommand(cmd);
      return true;
    },

    cycleNodeSkin: (id) => {
      const map = get().map;
      if (!map) return false;
      const obj = map.objects.find((o) => o.id === id && o.kind === 'node') as
        NodeObject | undefined;
      if (!obj) return false;
      const def = get().nodeDefsParsed[obj.ref];
      if (!def || def.skins.length < 2) return false;
      const cur = obj.skin ?? def.skins[0].id;
      const idx = def.skins.findIndex((s) => s.id === cur);
      // Unknown current skin ⇒ treat as position 0 so the first cycle lands on skins[1].
      const next = def.skins[(Math.max(idx, 0) + 1) % def.skins.length];
      return get().updateNode(id, { skin: next.id });
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
        if (!ids.includes(obj.id)) continue;
        if (obj.kind === 'decor') {
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
        } else if (obj.kind === 'node') {
          // depthBias is optional-omitted-when-zero (plan 029), matching how updateNode normalises
          // rotation: a bump that lands back on 0 clears the key so an unbiased node round-trips
          // byte-identical.
          const prevBias = obj.depthBias;
          const nextBias = (obj.depthBias ?? 0) + delta;
          const nextVal = nextBias === 0 ? undefined : nextBias;
          ops.push({
            do: () => {
              obj.depthBias = nextVal;
            },
            undo: () => {
              obj.depthBias = prevBias;
            },
          });
        }
        // portal ids fall through untouched (no depth/depthBias concept).
      }
      if (ops.length === 0) return;
      get().applyCommand(batchCommand(ops));
    },
  })),
);
