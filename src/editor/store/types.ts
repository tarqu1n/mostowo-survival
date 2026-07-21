/**
 * Public editor-store types (plan 043 step 7) — split out of `editorStore.ts` so the Zustand slices
 * and the barrel can share one `EditorState` definition. Everything here is re-exported unchanged from
 * `./editorStore` so consumers keep importing from that path.
 */
import type { StateCreator } from 'zustand';
import type {
  DecorAnim,
  DecorObject,
  DecorRegion,
  MapFile,
  NamedTilePalette,
  NodeObject,
  PortalFacing,
  PortalObject,
  PortalRect,
  ResizeEdges,
  TilePaletteSlot,
} from '../../systems/mapFormat';
import type { WorldLayout } from '../../systems/worldLayout';
import type { AuthoredNodeDef, NodeSkinDef, ParsedNodeDef } from '../../systems/nodeDefs';
import type { AssetCatalog, CatalogAssetRole } from '../catalog';
import type { TerrainCatalog } from '../terrainCatalog';
import type { UnderlaySettings } from '../underlayStore';
import type { LibraryBrowseState, RecentEntry } from '../libraryViewStore';
import type { RegionRect } from '../regionOps';
import type { Command } from './history';

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

/** The live reference-underlay: the persisted `UnderlaySettings` plus the resolved base64 `dataUrl`
 *  the Phaser scene loads as a texture (plan 022 step 4). Editor VIEW state only — never `MapFile`,
 *  never persisted whole (only its `UnderlaySettings` half is, via `underlayStore`; the `dataUrl` is
 *  re-resolved from cache/fetch on load, or held in-memory for ad-hoc file images). */
export type UnderlayState = UnderlaySettings & { dataUrl: string };

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
  /** The palette slot the user last tapped to arm the brush (`selectPaletteSlot`), tracked by identity so
   *  the strip keeps THAT slot highlighted (and shows its live orientation on the swatch) even after
   *  `rotateBrush` spins `brushRotation` away from the slot's own `rotation`. Without it, rotating an
   *  armed tile would drop the highlight (no slot matches the new angle) and the user couldn't see which
   *  tile — at what rotation — they're about to paint. Cleared whenever the brush is armed from anywhere
   *  else (`setBrushAsset` nulls it) or nothing is armed; `paletteId` scopes the highlight to the palette
   *  it was picked from. Transient view-state — not persisted. */
  selectedPaletteSlot: { paletteId: string | null; assetId: string; rotation?: number } | null;
  /** Per-slot working-rotation memory: the last `brushRotation` the user rotated each palette slot to,
   *  keyed by `paletteSlotRotationKey`. Re-selecting a slot restores its remembered angle instead of
   *  resetting to the slot's base rotation — so switching between tiles no longer forces re-rotating the
   *  same one each time. Transient view-state (session-scoped), not persisted to `palettes.json`. */
  paletteSlotRotations: Record<string, 0 | 90 | 180 | 270>;
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
  /** Renames palette `id` (plain immutable `set`, NOT undoable, autosaved). A blank/whitespace-only
   *  name is ignored (keeps the previous name). */
  renameTilePalette(id: string, name: string): void;
  /** Deletes palette `id` entirely (plain immutable `set`, NOT undoable, autosaved), then reconciles the
   *  active-palette pointer (if the deleted one was active, it repoints to the first remaining, or null). */
  deleteTilePalette(id: string): void;
  /** Arms the brush from a palette slot — sets `brushAsset`/`brushRotation`, records the slot as the
   *  sticky `selectedPaletteSlot` (so the strip highlight survives later `rotateBrush` calls), and
   *  switches to the brush tool (mirrors `pickTile`). A brush-arm, NOT a palette mutation: no command,
   *  no dirty. */
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

/** A Zustand slice factory for the composed `EditorState`, carrying the `subscribeWithSelector`
 *  middleware in its mutator tuple so slices compose under one `create()` in `editorStore.ts`. Each
 *  slice returns the subset of `EditorState` it owns; cross-slice action calls go through the combined
 *  `get()`, which sees the whole state. */
export type EditorSlice<T> = StateCreator<
  EditorState,
  [['zustand/subscribeWithSelector', never]],
  [],
  T
>;
