/**
 * Map file schema v1 — types + cell helpers + the shared y-sort law (plan 014 step 1). Pure — no
 * Phaser. `TileSource` is reused (type-only) from `data/tileset.ts`, which is itself Phaser-free
 * (verified before writing this module).
 *
 * Shape/void model: `shape.cells` is a per-tile 0(void)/1(inside) mask over the width×height
 * bounding box; an ABSENT `shape` means "all inside" (migrates rectangular maps for free — see
 * `isInside`). Void-consistency is enforced as a parseMap invariant, not editor courtesy: a void
 * cell must be 0 in every tile layer and in zones, and no object/portal footprint may land on one
 * (see `validateVoidConsistency` in `parse.ts`).
 *
 * Palette encoding: `palette[0]` is `null` — a reserved slot standing in for "empty" (layer cell
 * value `0`). Real entries occupy `palette[1..]`; a layer cell value `n >= 1` means `palette[n]`.
 * The editor's find-or-append is append-only past this reserved slot so re-saves never renumber
 * existing indices (a renumber would churn every cell in every layer's diff).
 */

import type { TileSource } from '../../data/tileset';

// ---- Types (map schema v1) ----

/** One slot in a named tile palette (editor quick-access tray, plan 033). Stores the tile itself — a
 *  catalog asset id plus optional rotation — never a `MapFile.palette` index, and layer is not bound
 *  per slot. `rotation` is optional-omitted-when-absent so slots stay minimal and round-trip
 *  byte-identical.
 *
 *  This is the shape of the editor's GLOBAL `src/data/maps/palettes.json` (plan 033 step 9), NOT part
 *  of the map schema — tile palettes are editor curation shared across every map, auto-saved on every
 *  edit, and validated/loaded by `src/editor/palettesSource.ts` (not `parseMap`). The type lives here
 *  only because it's the natural home for the tile-slot vocabulary. */
export interface TilePaletteSlot {
  assetId: string;
  rotation?: number;
}

/** A named tile palette (plan 033) — one editor quick-access tray. See `TilePaletteSlot`'s doc: these
 *  are the entries of the editor's GLOBAL `palettes.json` (`{ palettes: NamedTilePalette[] }`), a
 *  cross-map editor-curation file, NOT stored in any map. The active-palette pointer is editor
 *  view-state (store-only), not stored here either. */
export interface NamedTilePalette {
  id: string;
  name: string;
  slots: TilePaletteSlot[];
}

export interface MapMeta {
  schemaVersion: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  tileSize: number;
  /** Map-level favourited catalog asset ids (editor Library "Favourites" pseudo-category) used when
   *  no zone is active. Optional and always LAST in this interface / every `MapMeta` constructor so
   *  serialized key order stays stable; omitted entirely (not `[]`) on maps that never favourited
   *  anything, so old maps round-trip byte-identical. */
  favourites?: string[];
}

/** Per-tile inside/void mask, `width*height` row-major. Absent on `MapFile` ⇒ all-inside. */
export interface MapShape {
  cells: number[];
}

/** One palette slot. `MapFile.palette[0]` is always `null` (see module doc); this shape is every
 *  other slot. */
export interface TilePaletteEntry {
  pack: string;
  source: TileSource;
  /** Clockwise rotation in degrees applied when this tile is blitted; absent = 0. A rotated tile is
   *  a distinct palette slot (`pack + source + rotation`). Optional and always LAST in this interface
   *  / every constructor so serialized key order stays stable; omitted entirely (not `0`) when
   *  unrotated, so old maps round-trip byte-identical. */
  rotation?: 0 | 90 | 180 | 270;
}

export interface TileLayer {
  id: string;
  name: string;
  kind: 'tiles';
  /** Renders above entities (e.g. a tree canopy layer) rather than below. */
  overhead: boolean;
  /** `width*height` row-major palette indices; `0` = empty. */
  cells: number[];
}

/** Editor-only semantic autotile data — the game loader never reads this; baked `TileLayer.cells`
 *  are canonical. Kept alongside so the terrain brush stays re-editable across sessions. */
export interface TerrainSection {
  layerId: string;
  terrainId: string;
  /** `width*height` row-major 0|1 mask. */
  cells: number[];
}

/** Base terrain passability only — runtime obstacles (walls, live nodes) composite over this at
 *  runtime exactly as today's `isBlocked` closure does. */
export interface Walkability {
  /** `width*height` row-major; `0` = walkable (default), `1` = blocked. */
  cells: number[];
}

export interface ZoneDef {
  /** uint8, `1..255` (`0` is reserved for "no zone" in `Zones.cells`). */
  id: number;
  name: string;
  colour: string;
  /** Catalog asset ids favourited for quick access while this zone is active in the editor. */
  favourites: string[];
}

export interface Zones {
  defs: ZoneDef[];
  /** `width*height` row-major zone ids; `0` = none. Every non-zero id must exist in `defs`. */
  cells: number[];
}

export interface CollisionFootprint {
  col: number;
  row: number;
  w: number;
  h: number;
}

export interface NodeObject {
  id: string;
  kind: 'node';
  /** A `NODES` key — cross-checked against `src/data/nodes.ts` in the registry, not here. */
  ref: string;
  col: number;
  row: number;
  /** Chosen skin id within the referenced def's `skins`; omit ⇒ the def's first/default skin.
   *  Per-placed-instance art (plan 021). Omitted-when-absent for byte-identical legacy round-trip. */
  skin?: string;
  /** Clockwise rotation in degrees applied to the placed sprite (arbitrary angle, like `DecorObject`).
   *  Absent ⇒ 0 (upright). optional-omitted-when-absent so a node authored before node
   *  rotation existed round-trips byte-identical. */
  rotation?: number;
  /** Integer "virtual rows" nudge layered on the base-row y-sort (plan 029). Positive ⇒ drawn further
   *  in front, as if the node sat that many rows lower. Feeds `rowDepthOffset(row, depthBias)`. Absent
   *  ⇒ 0. Always LAST and optional-omitted-when-absent so a node authored before it existed round-trips
   *  byte-identical. */
  depthBias?: number;
}

/** Divisor for the base-row y-sort offset (plan 029). `MAX_MAP_DIM = 512` is the row ceiling, so `4096`
 *  leaves huge headroom for `depthBias` while keeping the offset strictly `< 1` — a world object's depth
 *  stays inside its renderer's integer band and never disturbs decor/monster/player layering above it. */
export const ROW_DEPTH_DIVISOR = 4096;

/** Intra-stack tiebreaker for a multi-sprite object at ONE tile (plan 029 / 5b — e.g. the campfire's
 *  base/flame/smoke). Defined structurally as a fraction of one row's granularity so the invariant is
 *  self-documenting: a stack may layer at most a few × this on top of its base depth and MUST stay
 *  `< 1 / ROW_DEPTH_DIVISOR`, so the whole stack sorts as a single row against every other object and
 *  never crosses a row boundary. */
export const SUB_ROW_EPSILON = 1 / (ROW_DEPTH_DIVISOR * 16);

/** Shared base-row y-sort law (plan 029) — single source of truth for editor AND game so their draw
 *  order agrees, applied to any in-band world object (resource nodes, buildables). Maps a base `row`
 *  (+ optional `bias` in "virtual rows") to a fraction in `[0, 1)`: lower on the map (higher row) ⇒
 *  larger offset ⇒ drawn in front. Callers add the result to their own integer band base
 *  (`DEPTH_OBJECTS` in the editor, `1` in the game). The clamp is a defensive guarantee the result
 *  stays in `[0, 1)` even for out-of-range `row + bias`. */
export function rowDepthOffset(row: number, bias = 0): number {
  return Math.min(Math.max(row + bias, 0), ROW_DEPTH_DIVISOR - 1) / ROW_DEPTH_DIVISOR;
}

/** A crop rect (sheet-local px) into `DecorObject.asset`'s source PNG — plan 014 step 7a's
 *  metadata-not-split atlas model: rather than physically splitting a multi-sprite sheet (e.g.
 *  `Environment/Props/Static/Furniture.png`) into one file per sprite, a decor instance carries the
 *  bounding box of the ONE sprite it wants, cropped at render. Ints; `x,y >= 0`, `w,h > 0`. Mutually
 *  exclusive with `anim` (a decor object is a static atlas crop OR an animated strip, never both —
 *  `parseMap` rejects both present). Sourced from the matching `CatalogAsset.regions` entry
 *  (`scripts/pixel-crawler/gen_regions.py` detects them); absent `region` on a decor whose asset
 *  isn't an atlas ⇒ render the whole sheet/image (today's behaviour, unchanged). */
export interface DecorRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Animation-strip playback for a decor instance — deliberately the same shape
 *  `Phaser.Loader.LoaderPlugin.spritesheet(key, url, { frameWidth, frameHeight })` consumes
 *  directly, plus `frames`/`fps` for `anims.create`. `frameWidth`/`frameHeight`/`frames`/`fps` are
 *  ints, all `> 0`. Mutually exclusive with `region` (see `DecorRegion` doc) — a decor object is a
 *  static crop OR an animated strip, never both. Sourced from the matching `CatalogAsset`'s
 *  `frameWidth`/`frameHeight`/`frames` (a `strip` asset) plus an editor-chosen `fps`.
 *
 *  Grid geometry is decoupled from the played-frame set (plan 017 step 6.3): `frames` is the TOTAL
 *  number of grid cells the sheet slices into (`cols*rows`), NOT the animation length; `omit` lists
 *  the row-major cell indices (`0..frames-1`) to SKIP. The played set is therefore `[0..frames-1]`
 *  minus `omit`, ascending. `omit` is absent (never `[]`) when nothing is skipped — matching the
 *  other optional-omitted-when-absent fields (`meta.favourites`, `region`) and, crucially, keeping
 *  a strip authored before this change (equivalent to `start:0 → end:frames-1`) byte-identical on
 *  round-trip. Motivating case: a 2-col×11-row sheet = 22 cells whose blank 22nd cell (`omit:[21]`)
 *  is dropped → 21 played frames. `omit` is always LAST so legacy key order is preserved. */
export interface DecorAnim {
  frameWidth: number;
  frameHeight: number;
  frames: number;
  fps: number;
  omit?: number[];
}

export interface DecorObject {
  id: string;
  kind: 'decor';
  /** Asset-catalog id, e.g. `pixel-crawler/…`. */
  asset: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Degrees. */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  depth: number;
  /** Runtime collision footprint (tiles). Omit for purely cosmetic decor. */
  collision?: CollisionFootprint;
  /** Static atlas-sprite crop — mutually exclusive with `anim`. Both LAST (after `collision`) and
   *  optional-omitted-when-absent (see `parseMapObject`/`serializeMap`), like `meta.favourites`, so
   *  a map authored before step 7a round-trips byte-identical. */
  region?: DecorRegion;
  /** Animated-strip playback — mutually exclusive with `region`. See field-order note on `region`. */
  anim?: DecorAnim;
}

export type PortalFacing = 'up' | 'down' | 'left' | 'right';

export interface PortalRect {
  col: number;
  row: number;
  w: number;
  h: number;
}

export interface PortalObject {
  id: string;
  kind: 'portal';
  name: string;
  rect: PortalRect;
  facing: PortalFacing;
}

export type MapObject = NodeObject | DecorObject | PortalObject;

export interface MapFile {
  meta: MapMeta;
  /** Absent ⇒ every tile is inside (see module doc). */
  shape?: MapShape;
  /** `palette[0]` is always `null` — see module doc. */
  palette: Array<TilePaletteEntry | null>;
  /** Ordered bottom→top. */
  layers: TileLayer[];
  terrain: TerrainSection[];
  walkability: Walkability;
  zones: Zones;
  objects: MapObject[];
}

/** A deduped texture reference `collectTextureSources` walks out of a map — either a palette
 *  entry's `TileSource` or a decor object's catalog asset id. Node-ref→texture resolution happens
 *  in the registry (needs `NODES`), not here — keeps this module dependency-light. */
export type TextureSourceRef =
  { kind: 'palette'; source: TileSource } | { kind: 'decorAsset'; asset: string };

// ---- Cell helpers ----

/** Row-major index of `(col,row)` in a `width`-wide flat cells array. */
export function cellIndex(col: number, row: number, width: number): number {
  return row * width + col;
}

export function getCell(cells: number[], col: number, row: number, width: number): number {
  return cells[cellIndex(col, row, width)];
}

export function setCell(
  cells: number[],
  col: number,
  row: number,
  width: number,
  value: number,
): void {
  cells[cellIndex(col, row, width)] = value;
}

/** True if `(col,row)` is within bounds AND inside the shape mask (absent shape ⇒ all-inside). */
export function isInside(map: MapFile, col: number, row: number): boolean {
  const { width, height } = map.meta;
  if (col < 0 || row < 0 || col >= width || row >= height) return false;
  if (!map.shape) return true;
  return getCell(map.shape.cells, col, row, width) === 1;
}
