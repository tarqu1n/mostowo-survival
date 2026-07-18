/**
 * Map file schema v1 — types + a single validating choke point (parseMap) for every map JSON
 * import (plan 014 step 1). Pure — no Phaser. `TileSource` is reused (type-only) from
 * `data/tileset.ts`, which is itself Phaser-free (verified before writing this module).
 *
 * Shape/void model: `shape.cells` is a per-tile 0(void)/1(inside) mask over the width×height
 * bounding box; an ABSENT `shape` means "all inside" (migrates rectangular maps for free — see
 * `isInside`). Void-consistency is enforced as a parseMap invariant, not editor courtesy: a void
 * cell must be 0 in every tile layer and in zones, and no object/portal footprint may land on one
 * (see `validateVoidConsistency`).
 *
 * Palette encoding: `palette[0]` is `null` — a reserved slot standing in for "empty" (layer cell
 * value `0`). Real entries occupy `palette[1..]`; a layer cell value `n >= 1` means `palette[n]`.
 * The editor's find-or-append is append-only past this reserved slot so re-saves never renumber
 * existing indices (a renumber would churn every cell in every layer's diff).
 */

import type { TileSource } from '../data/tileset';
import { TILE_SIZE } from '../config';

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

// ---- Parsing helpers (throw with a precise `<path> <problem>` message) ----

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path} must be an object`);
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(`${path} must be a string`);
  return value;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} must be a finite number`);
  return value;
}

function expectInt(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (!Number.isInteger(n)) fail(`${path} must be an integer`);
  return n;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(`${path} must be a boolean`);
  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value;
}

/** Parse a flat `expectedLength`-sized row-major cells array of non-negative integers, optionally
 *  capped at `max`. */
function parseCells(
  value: unknown,
  path: string,
  expectedLength: number,
  opts?: { max?: number },
): number[] {
  const arr = expectArray(value, path);
  if (arr.length !== expectedLength) {
    fail(`${path} length ${arr.length} !== expected ${expectedLength} (width*height)`);
  }
  return arr.map((v, i) => {
    const n = expectInt(v, `${path}[${i}]`);
    if (n < 0) fail(`${path}[${i}] must be >= 0 (got ${n})`);
    if (opts?.max !== undefined && n > opts.max) {
      fail(`${path}[${i}] ${n} exceeds max ${opts.max}`);
    }
    return n;
  });
}

function parseTileSource(value: unknown, path: string): TileSource {
  const obj = expectRecord(value, path);
  const kind = expectString(obj.kind, `${path}.kind`);
  if (kind === 'image') {
    return { kind: 'image', path: expectString(obj.path, `${path}.path`) };
  }
  if (kind === 'sheetFrame') {
    return {
      kind: 'sheetFrame',
      sheet: expectString(obj.sheet, `${path}.sheet`),
      frame: expectInt(obj.frame, `${path}.frame`),
    };
  }
  fail(`${path}.kind must be 'image' or 'sheetFrame', got ${JSON.stringify(kind)}`);
}

/** Palette-entry clockwise rotation; absent ⇒ 0. Only the four 90° steps are valid. */
function parseRotation(value: unknown, path: string): 0 | 90 | 180 | 270 | undefined {
  if (value === undefined) return undefined;
  const n = expectInt(value, path);
  if (n !== 0 && n !== 90 && n !== 180 && n !== 270) {
    fail(`${path} must be one of 0, 90, 180, 270, got ${JSON.stringify(value)}`);
  }
  return n;
}

function parseMeta(value: unknown, path: string): MapMeta {
  const obj = expectRecord(value, path);
  const schemaVersion = expectInt(obj.schemaVersion, `${path}.schemaVersion`);
  if (schemaVersion !== 1) {
    fail(`${path}.schemaVersion ${schemaVersion} is not supported by parseMap (use migrateMap)`);
  }
  const width = expectInt(obj.width, `${path}.width`);
  const height = expectInt(obj.height, `${path}.height`);
  if (width <= 0) fail(`${path}.width must be > 0`);
  if (height <= 0) fail(`${path}.height must be > 0`);
  // favourites is optional — read only if present, and omit the key entirely when absent so maps
  // without it serialize unchanged (JSON.stringify drops `undefined` fields).
  const favourites =
    obj.favourites === undefined
      ? undefined
      : expectArray(obj.favourites, `${path}.favourites`).map((f, i) =>
          expectString(f, `${path}.favourites[${i}]`),
        );
  return {
    schemaVersion: 1,
    id: expectString(obj.id, `${path}.id`),
    name: expectString(obj.name, `${path}.name`),
    width,
    height,
    tileSize: expectInt(obj.tileSize, `${path}.tileSize`),
    ...(favourites === undefined ? {} : { favourites }),
  };
}

function parseShape(
  value: unknown,
  path: string,
  width: number,
  height: number,
): MapShape | undefined {
  if (value === undefined) return undefined;
  const obj = expectRecord(value, path);
  return { cells: parseCells(obj.cells, `${path}.cells`, width * height, { max: 1 }) };
}

function parsePalette(value: unknown, path: string): Array<TilePaletteEntry | null> {
  const arr = expectArray(value, path);
  if (arr.length < 1) fail(`${path} must contain at least the reserved index-0 entry`);
  return arr.map((entry, i) => {
    const entryPath = `${path}[${i}]`;
    if (i === 0) {
      if (entry !== null) fail(`${entryPath} must be null (index 0 is reserved for "empty")`);
      return null;
    }
    if (entry === null) fail(`${entryPath} must not be null (only index 0 is reserved)`);
    const obj = expectRecord(entry, entryPath);
    const rotation = parseRotation(obj.rotation, `${entryPath}.rotation`);
    return {
      pack: expectString(obj.pack, `${entryPath}.pack`),
      source: parseTileSource(obj.source, `${entryPath}.source`),
      // Constructed LAST and omitted when 0/absent so legacy maps round-trip byte-identical.
      ...(rotation ? { rotation } : {}),
    };
  });
}

function parseLayer(
  value: unknown,
  path: string,
  width: number,
  height: number,
  paletteLength: number,
): TileLayer {
  const obj = expectRecord(value, path);
  const kind = expectString(obj.kind, `${path}.kind`);
  if (kind !== 'tiles') fail(`${path}.kind must be 'tiles', got ${JSON.stringify(kind)}`);
  return {
    id: expectString(obj.id, `${path}.id`),
    name: expectString(obj.name, `${path}.name`),
    kind: 'tiles',
    overhead: expectBoolean(obj.overhead, `${path}.overhead`),
    cells: parseCells(obj.cells, `${path}.cells`, width * height, { max: paletteLength - 1 }),
  };
}

function parseTerrainSection(
  value: unknown,
  path: string,
  width: number,
  height: number,
  layerIds: ReadonlySet<string>,
): TerrainSection {
  const obj = expectRecord(value, path);
  const layerId = expectString(obj.layerId, `${path}.layerId`);
  if (!layerIds.has(layerId)) fail(`${path}.layerId "${layerId}" does not match any layer id`);
  return {
    layerId,
    terrainId: expectString(obj.terrainId, `${path}.terrainId`),
    cells: parseCells(obj.cells, `${path}.cells`, width * height, { max: 1 }),
  };
}

function parseWalkability(
  value: unknown,
  path: string,
  width: number,
  height: number,
): Walkability {
  const obj = expectRecord(value, path);
  return { cells: parseCells(obj.cells, `${path}.cells`, width * height, { max: 1 }) };
}

function parseZoneDef(value: unknown, path: string): ZoneDef {
  const obj = expectRecord(value, path);
  const id = expectInt(obj.id, `${path}.id`);
  if (id <= 0 || id > 255) fail(`${path}.id must be an integer in 1..255 (got ${id})`);
  const favouritesRaw = expectArray(obj.favourites, `${path}.favourites`);
  return {
    id,
    name: expectString(obj.name, `${path}.name`),
    colour: expectString(obj.colour, `${path}.colour`),
    favourites: favouritesRaw.map((f, i) => expectString(f, `${path}.favourites[${i}]`)),
  };
}

function parseZones(value: unknown, path: string, width: number, height: number): Zones {
  const obj = expectRecord(value, path);
  const defsRaw = expectArray(obj.defs, `${path}.defs`);
  const defs = defsRaw.map((d, i) => parseZoneDef(d, `${path}.defs[${i}]`));
  const seenIds = new Set<number>();
  for (const def of defs) {
    if (seenIds.has(def.id)) fail(`${path}.defs has duplicate zone id ${def.id}`);
    seenIds.add(def.id);
  }
  const cells = parseCells(obj.cells, `${path}.cells`, width * height, { max: 255 });
  for (let i = 0; i < cells.length; i++) {
    const zoneId = cells[i];
    if (zoneId !== 0 && !seenIds.has(zoneId)) {
      fail(`${path}.cells[${i}] references unknown zone id ${zoneId}`);
    }
  }
  return { defs, cells };
}

function parseCollisionFootprint(value: unknown, path: string): CollisionFootprint {
  const obj = expectRecord(value, path);
  const w = expectInt(obj.w, `${path}.w`);
  const h = expectInt(obj.h, `${path}.h`);
  if (w <= 0) fail(`${path}.w must be > 0`);
  if (h <= 0) fail(`${path}.h must be > 0`);
  return { col: expectInt(obj.col, `${path}.col`), row: expectInt(obj.row, `${path}.row`), w, h };
}

function parseDecorRegion(value: unknown, path: string): DecorRegion {
  const obj = expectRecord(value, path);
  const x = expectInt(obj.x, `${path}.x`);
  const y = expectInt(obj.y, `${path}.y`);
  const w = expectInt(obj.w, `${path}.w`);
  const h = expectInt(obj.h, `${path}.h`);
  if (x < 0) fail(`${path}.x must be >= 0`);
  if (y < 0) fail(`${path}.y must be >= 0`);
  if (w <= 0) fail(`${path}.w must be > 0`);
  if (h <= 0) fail(`${path}.h must be > 0`);
  return { x, y, w, h };
}

function parseDecorAnim(value: unknown, path: string): DecorAnim {
  const obj = expectRecord(value, path);
  const frameWidth = expectInt(obj.frameWidth, `${path}.frameWidth`);
  const frameHeight = expectInt(obj.frameHeight, `${path}.frameHeight`);
  const frames = expectInt(obj.frames, `${path}.frames`);
  const fps = expectInt(obj.fps, `${path}.fps`);
  if (frameWidth <= 0) fail(`${path}.frameWidth must be > 0`);
  if (frameHeight <= 0) fail(`${path}.frameHeight must be > 0`);
  if (frames <= 0) fail(`${path}.frames must be > 0`);
  if (fps <= 0) fail(`${path}.fps must be > 0`);
  // omit is optional and read only when present, so the key is never added when absent — that's
  // what keeps a strip authored before plan 017 step 6.3 byte-identical on round-trip. When present:
  // an array of unique non-negative ints, each a valid cell index (`< frames`). Its members are the
  // row-major grid cells to SKIP; the played set is `[0..frames-1]` minus omit (see DecorAnim doc).
  let omit: number[] | undefined;
  if (obj.omit !== undefined) {
    const arr = expectArray(obj.omit, `${path}.omit`);
    omit = arr.map((v, i) => {
      const n = expectInt(v, `${path}.omit[${i}]`);
      if (n < 0) fail(`${path}.omit[${i}] must be >= 0 (got ${n})`);
      if (n >= frames) fail(`${path}.omit[${i}] ${n} must be < frames (${frames})`);
      return n;
    });
    if (new Set(omit).size !== omit.length) {
      fail(`${path}.omit must not contain duplicate indices`);
    }
    // Defensive guard (mirrors the 6.2 server sanitiser): the played set must have >= 1 frame. An
    // anim whose omit skips EVERY cell would hand Phaser's generateFrameNumbers an empty list and
    // crash it at draw time.
    if (frames - omit.length < 1) {
      fail(`${path}.omit skips every frame — at least one played frame is required`);
    }
  }
  // omit LAST so a legacy anim's field order ({frameWidth, frameHeight, frames, fps}) is preserved.
  return { frameWidth, frameHeight, frames, fps, ...(omit !== undefined ? { omit } : {}) };
}

const PORTAL_FACINGS: ReadonlySet<string> = new Set(['up', 'down', 'left', 'right']);

function parseMapObject(value: unknown, path: string): MapObject {
  const obj = expectRecord(value, path);
  const id = expectString(obj.id, `${path}.id`);
  const kind = expectString(obj.kind, `${path}.kind`);

  if (kind === 'node') {
    const ref = expectString(obj.ref, `${path}.ref`);
    if (ref.length === 0) fail(`${path}.ref must be a non-empty string`);
    // skin is optional and read only when present, so the key is never added when absent — that's
    // what keeps a node authored before plan 021 step 4 byte-identical on round-trip.
    const skin = obj.skin === undefined ? undefined : expectString(obj.skin, `${path}.skin`);
    // rotation is optional and read only when present, so the key is never added when absent — that's
    // what keeps a node authored before node rotation existed byte-identical on round-trip. Built LAST
    // (after skin) to preserve legacy key order.
    const rotation =
      obj.rotation === undefined ? undefined : expectNumber(obj.rotation, `${path}.rotation`);
    // depthBias is optional and read only when present, so the key is never added when absent — that's
    // what keeps a node authored before plan 029 byte-identical on round-trip. Built LAST (after
    // rotation) to preserve legacy key order.
    const depthBias =
      obj.depthBias === undefined ? undefined : expectInt(obj.depthBias, `${path}.depthBias`);
    return {
      id,
      kind: 'node',
      ref,
      col: expectInt(obj.col, `${path}.col`),
      row: expectInt(obj.row, `${path}.row`),
      ...(skin !== undefined ? { skin } : {}),
      ...(rotation ? { rotation } : {}),
      ...(depthBias ? { depthBias } : {}),
    };
  }

  if (kind === 'decor') {
    // region/anim are optional and read only when present (mirrors meta.favourites — see module
    // doc) so a map authored before step 7a re-serializes byte-identical. Mutually exclusive: a
    // decor object crops a static atlas sprite XOR plays an animated strip, never both.
    const region =
      obj.region === undefined ? undefined : parseDecorRegion(obj.region, `${path}.region`);
    const anim = obj.anim === undefined ? undefined : parseDecorAnim(obj.anim, `${path}.anim`);
    if (region !== undefined && anim !== undefined) {
      fail(`${path} cannot have both region and anim (mutually exclusive)`);
    }
    return {
      id,
      kind: 'decor',
      asset: expectString(obj.asset, `${path}.asset`),
      x: expectNumber(obj.x, `${path}.x`),
      y: expectNumber(obj.y, `${path}.y`),
      scaleX: expectNumber(obj.scaleX, `${path}.scaleX`),
      scaleY: expectNumber(obj.scaleY, `${path}.scaleY`),
      rotation: expectNumber(obj.rotation, `${path}.rotation`),
      flipX: expectBoolean(obj.flipX, `${path}.flipX`),
      flipY: expectBoolean(obj.flipY, `${path}.flipY`),
      depth: expectNumber(obj.depth, `${path}.depth`),
      collision:
        obj.collision === undefined
          ? undefined
          : parseCollisionFootprint(obj.collision, `${path}.collision`),
      ...(region === undefined ? {} : { region }),
      ...(anim === undefined ? {} : { anim }),
    };
  }

  if (kind === 'portal') {
    const facing = expectString(obj.facing, `${path}.facing`);
    if (!PORTAL_FACINGS.has(facing)) {
      fail(`${path}.facing must be one of up/down/left/right, got ${JSON.stringify(facing)}`);
    }
    return {
      id,
      kind: 'portal',
      name: expectString(obj.name, `${path}.name`),
      rect: parseCollisionFootprint(obj.rect, `${path}.rect`),
      facing: facing as PortalFacing,
    };
  }

  fail(`${path}.kind must be one of node/decor/portal, got ${JSON.stringify(kind)}`);
}

/** Every tile cell an object/portal occupies, in map-local tile coords. Cosmetic decor (no
 *  `collision`) is anchored by its pixel position floored to a tile — every object footprints to
 *  at least one cell so void-consistency has something concrete to check. */
function objectFootprintCells(
  obj: MapObject,
  tileSize: number,
): Array<{ col: number; row: number }> {
  const rectCells = (rect: { col: number; row: number; w: number; h: number }) => {
    const cells: Array<{ col: number; row: number }> = [];
    for (let dr = 0; dr < rect.h; dr++) {
      for (let dc = 0; dc < rect.w; dc++) cells.push({ col: rect.col + dc, row: rect.row + dr });
    }
    return cells;
  };

  switch (obj.kind) {
    case 'node':
      return [{ col: obj.col, row: obj.row }];
    case 'portal':
      return rectCells(obj.rect);
    case 'decor':
      return obj.collision
        ? rectCells(obj.collision)
        : [{ col: Math.floor(obj.x / tileSize), row: Math.floor(obj.y / tileSize) }];
  }
}

/** Void ⇒ every tile layer 0, zone 0, and no object/portal footprint overlaps it (advisor round
 *  2). Walkability is deliberately NOT checked here — void already blocks at runtime regardless
 *  of its stored walkability value (see module doc). */
function validateVoidConsistency(map: MapFile): void {
  if (map.shape) {
    const { width, height } = map.meta;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (getCell(map.shape.cells, col, row, width) !== 0) continue; // inside — nothing to check
        for (const layer of map.layers) {
          if (getCell(layer.cells, col, row, width) !== 0) {
            fail(`void cell (${col},${row}) has a non-empty tile in layer "${layer.id}"`);
          }
        }
        if (getCell(map.zones.cells, col, row, width) !== 0) {
          fail(`void cell (${col},${row}) has a non-zero zone id`);
        }
      }
    }
  }

  for (const obj of map.objects) {
    for (const { col, row } of objectFootprintCells(obj, map.meta.tileSize)) {
      if (!isInside(map, col, row)) {
        fail(
          `object "${obj.id}" (${obj.kind}) footprint cell (${col},${row}) is outside the map or void`,
        );
      }
    }
  }
}

// ---- Public API ----

/** Validate + narrow an unknown JSON value into a `MapFile`. Throws with a precise message on the
 *  first violation (structural or invariant). The single choke point every map JSON import goes
 *  through. */
export function parseMap(json: unknown): MapFile {
  const root = expectRecord(json, 'map');
  const meta = parseMeta(root.meta, 'map.meta');
  const { width, height } = meta;

  const shape = parseShape(root.shape, 'map.shape', width, height);
  const palette = parsePalette(root.palette, 'map.palette');

  const layersRaw = expectArray(root.layers, 'map.layers');
  const layers = layersRaw.map((l, i) =>
    parseLayer(l, `map.layers[${i}]`, width, height, palette.length),
  );
  const layerIds = new Set<string>();
  for (const layer of layers) {
    if (layerIds.has(layer.id)) fail(`map.layers has duplicate layer id "${layer.id}"`);
    layerIds.add(layer.id);
  }

  const terrainRaw = expectArray(root.terrain, 'map.terrain');
  const terrain = terrainRaw.map((t, i) =>
    parseTerrainSection(t, `map.terrain[${i}]`, width, height, layerIds),
  );

  const walkability = parseWalkability(root.walkability, 'map.walkability', width, height);
  const zones = parseZones(root.zones, 'map.zones', width, height);

  const objectsRaw = expectArray(root.objects, 'map.objects');
  const objects = objectsRaw.map((o, i) => parseMapObject(o, `map.objects[${i}]`));
  const objectIds = new Set<string>();
  for (const obj of objects) {
    if (objectIds.has(obj.id)) fail(`map.objects has duplicate object id "${obj.id}"`);
    objectIds.add(obj.id);
  }

  const map: MapFile = { meta, shape, palette, layers, terrain, walkability, zones, objects };
  validateVoidConsistency(map);
  return map;
}

const CELLS_BLOCK = /"cells": \[\n([\s\S]*?)\n(\s*)\]/g;

/** Collapse every `"cells": [...]` array (one number per line, `JSON.stringify`'s default) into
 *  `width`-wide rows on their own compact line — every cells array in this schema is a
 *  `width*height` row-major grid, so one width applies uniformly. Diff-friendly: an edit to one
 *  row only touches that row's line. */
function collapseCellsArrays(json: string, width: number): string {
  return json.replace(CELLS_BLOCK, (_match, body: string, closeIndent: string) => {
    const numbers = body
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter((line) => line.length > 0);
    const rowIndent = `${closeIndent}  `;
    const rows: string[] = [];
    for (let i = 0; i < numbers.length; i += width) {
      rows.push(rowIndent + numbers.slice(i, i + width).join(','));
    }
    return `"cells": [\n${rows.join(',\n')}\n${closeIndent}]`;
  });
}

/**
 * Serialize a `MapFile` to diff-friendly JSON: stable key order (guaranteed by construction —
 * every `MapFile` in this codebase is built field-by-field in schema order, never spread from
 * arbitrary input, so plain `JSON.stringify` key insertion order already matches the schema),
 * 2-space indent, and cells grids collapsed to one compact line per row (see
 * `collapseCellsArrays`).
 */
export function serializeMap(map: MapFile): string {
  const json = JSON.stringify(map, null, 2);
  return `${collapseCellsArrays(json, map.meta.width)}\n`;
}

/** A blank rectangular (all-inside — no `shape`) map: one empty `ground` tile layer, no terrain,
 *  fully walkable, no zones/objects. `tileSize` defaults to the game's `TILE_SIZE`. */
export function createEmptyMap(id: string, name: string, width: number, height: number): MapFile {
  if (!Number.isInteger(width) || width <= 0) {
    fail('createEmptyMap: width must be a positive integer');
  }
  if (!Number.isInteger(height) || height <= 0) {
    fail('createEmptyMap: height must be a positive integer');
  }
  const size = width * height;
  return {
    meta: { schemaVersion: 1, id, name, width, height, tileSize: TILE_SIZE },
    palette: [null],
    layers: [
      {
        id: 'ground',
        name: 'Ground',
        kind: 'tiles',
        overhead: false,
        cells: new Array(size).fill(0) as number[],
      },
    ],
    terrain: [],
    walkability: { cells: new Array(size).fill(0) as number[] },
    zones: { defs: [], cells: new Array(size).fill(0) as number[] },
    objects: [],
  };
}

// ---- Resize (editor "Resize map" action, plan 024 step 1) ----

/** Editor sanity ceiling for a map's width/height (tiles) — single source of truth shared with
 *  `NewMapDialog` (was a local `MAX_DIM` there) and `planResize`/`applyResize` below. */
export const MAX_MAP_DIM = 512;

/** Map id pattern — client mirror of the middleware's `ID_RE` (lowercase letters, digits, hyphens). */
export const MAP_ID_PATTERN = /^[a-z0-9-]+$/;

/** Tiles to add on each edge of a resize; negative crops that edge. */
export interface ResizeEdges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Pure analysis of a prospective resize for the dialog — no remap performed. `applyResize`
 *  re-derives (and re-checks) the same plan before it actually remaps. */
export interface ResizePlan {
  /** New-map-local offset of the old origin: old `(c,r)` -> new `(c+dLeft, r+dTop)`. */
  dLeft: number;
  dTop: number;
  newWidth: number;
  newHeight: number;
  /** Both new dims are integers in `1..MAX_MAP_DIM`. */
  dimsValid: boolean;
  /** Ids of objects whose translated footprint would leave the new bounds — Apply-blocking. */
  offendingObjectIds: string[];
  /** True when cropping discards a cell that's non-empty in a layer, non-zero in zones, or blocked
   *  in walkability. Void removal never counts — informational for the dialog, not Apply-blocking. */
  discardsNonEmpty: boolean;
}

/** Analyse `edges` against `map` without mutating or remapping anything. Reuses the module's
 *  `objectFootprintCells` (translating its cells by `(dLeft,dTop)` afterwards is equivalent to
 *  translating the object first — both `dLeft`/`dTop` are whole tiles). */
export function planResize(map: MapFile, edges: ResizeEdges): ResizePlan {
  const { width, height, tileSize } = map.meta;
  const dLeft = edges.left;
  const dTop = edges.top;
  const newWidth = width + edges.left + edges.right;
  const newHeight = height + edges.top + edges.bottom;
  const dimsValid =
    Number.isInteger(newWidth) &&
    Number.isInteger(newHeight) &&
    newWidth >= 1 &&
    newWidth <= MAX_MAP_DIM &&
    newHeight >= 1 &&
    newHeight <= MAX_MAP_DIM;

  const offendingObjectIds: string[] = [];
  for (const obj of map.objects) {
    const leavesBounds = objectFootprintCells(obj, tileSize).some(({ col, row }) => {
      const nc = col + dLeft;
      const nr = row + dTop;
      return nc < 0 || nc >= newWidth || nr < 0 || nr >= newHeight;
    });
    if (leavesBounds) offendingObjectIds.push(obj.id);
  }

  // A cropped-away cell is an OLD cell whose translated position falls outside the new bounds.
  // Void cells (shape mask 0) never count, even if a stray non-zero value is stored under them.
  let discardsNonEmpty = false;
  findDiscard: for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const nc = col + dLeft;
      const nr = row + dTop;
      if (nc >= 0 && nc < newWidth && nr >= 0 && nr < newHeight) continue; // kept, not cropped
      if (!isInside(map, col, row)) continue; // void — doesn't count
      const idx = cellIndex(col, row, width);
      const nonEmpty =
        map.layers.some((layer) => layer.cells[idx] !== 0) ||
        map.zones.cells[idx] !== 0 ||
        map.walkability.cells[idx] === 1;
      if (nonEmpty) {
        discardsNonEmpty = true;
        break findDiscard;
      }
    }
  }

  return { dLeft, dTop, newWidth, newHeight, dimsValid, offendingObjectIds, discardsNonEmpty };
}

/** Translate a single object's placement by whole tiles — the shared move used by `applyResize`
 *  for every object kind (node col/row, portal rect, decor pixel anchor + optional collision). */
function translateObject(obj: MapObject, dLeft: number, dTop: number, tileSize: number): MapObject {
  switch (obj.kind) {
    case 'node':
      return { ...obj, col: obj.col + dLeft, row: obj.row + dTop };
    case 'portal':
      return {
        ...obj,
        rect: { ...obj.rect, col: obj.rect.col + dLeft, row: obj.rect.row + dTop },
      };
    case 'decor':
      return {
        ...obj,
        x: obj.x + dLeft * tileSize,
        y: obj.y + dTop * tileSize,
        ...(obj.collision
          ? {
              collision: {
                ...obj.collision,
                col: obj.collision.col + dLeft,
                row: obj.collision.row + dTop,
              },
            }
          : {}),
      };
  }
}

/** Perform the resize, returning a NEW `MapFile` (fresh arrays throughout) — never mutates `map`.
 *  Throws if the plan isn't clean (invalid dims or an object would leave the new bounds); this is a
 *  guard against a misuse of the API, not user-facing validation — the dialog prevents both, and the
 *  store double-checks before calling this. */
export function applyResize(map: MapFile, edges: ResizeEdges): MapFile {
  const plan = planResize(map, edges);
  if (!plan.dimsValid) {
    fail(
      `applyResize: resulting dims ${plan.newWidth}x${plan.newHeight} are invalid (must be integers in 1..${MAX_MAP_DIM})`,
    );
  }
  if (plan.offendingObjectIds.length > 0) {
    fail(
      `applyResize: object(s) would leave the new bounds: ${plan.offendingObjectIds.join(', ')}`,
    );
  }

  const { width, height, tileSize } = map.meta;
  const { dLeft, dTop, newWidth, newHeight } = plan;

  // Copy old (c,r) -> new (c+dLeft, r+dTop) where the new cell is in bounds; every other new cell
  // (newly added by an expand) keeps `defaultValue`.
  const remapGrid = (oldCells: number[], defaultValue: number): number[] => {
    const newCells = new Array<number>(newWidth * newHeight).fill(defaultValue);
    for (let row = 0; row < height; row++) {
      const nr = row + dTop;
      if (nr < 0 || nr >= newHeight) continue;
      for (let col = 0; col < width; col++) {
        const nc = col + dLeft;
        if (nc < 0 || nc >= newWidth) continue;
        newCells[cellIndex(nc, nr, newWidth)] = oldCells[cellIndex(col, row, width)];
      }
    }
    return newCells;
  };

  // Absent shape means "all inside" and stays absent: a translate+crop of an all-inside map is
  // still all-inside, so there's nothing to remap.
  const shape = map.shape ? { cells: remapGrid(map.shape.cells, 1) } : undefined;
  const layers = map.layers.map((layer) => ({ ...layer, cells: remapGrid(layer.cells, 0) }));
  const terrain = map.terrain.map((section) => ({
    ...section,
    cells: remapGrid(section.cells, 0),
  }));
  const walkability = { cells: remapGrid(map.walkability.cells, 0) };
  const zones = { ...map.zones, cells: remapGrid(map.zones.cells, 0) };
  const objects = map.objects.map((obj) => translateObject(obj, dLeft, dTop, tileSize));

  return {
    meta: { ...map.meta, width: newWidth, height: newHeight },
    ...(shape ? { shape } : {}),
    palette: map.palette, // unchanged — no tile-source data depends on position
    layers,
    terrain,
    walkability,
    zones,
    objects,
  };
}

/** Narrow + upgrade an unknown JSON value to the current `MapFile` shape, dispatching on
 *  `meta.schemaVersion`. v1 is the only version today (identity through `parseMap`); future
 *  versions add cases above the `default`, never mutate this one. */
export function migrateMap(json: unknown): MapFile {
  const root = expectRecord(json, 'map');
  const meta = expectRecord(root.meta, 'map.meta');
  const schemaVersion = meta.schemaVersion;
  switch (schemaVersion) {
    case 1:
      return parseMap(json);
    default:
      fail(`migrateMap: unsupported schemaVersion ${JSON.stringify(schemaVersion)}`);
  }
}

function tileSourceKey(source: TileSource): string {
  return source.kind === 'image'
    ? `image:${source.path}`
    : `sheetFrame:${source.sheet}:${source.frame}`;
}

/**
 * Deduped union of every texture this map needs: palette entries + decor asset refs. The
 * enumeration future preload/refcount/release consumes; `node-ref`→texture resolution needs
 * `NODES` and is layered on in the registry, not here (keeps this module dependency-light).
 *
 * Deliberately SHEET-granular, not region-granular (plan 014 step 7a): a `DecorObject.region` crops
 * a sub-rect at render, but the load/dedupe unit stays the whole sheet — walking `region`s here to
 * enumerate just the sub-rects actually used would be a trivial future derived pass IF a per-map
 * atlas-baking step ever needs it, so it isn't built speculatively now. Known trade-off (critique
 * #5): loading a whole multi-sprite atlas (e.g. `Furniture.png` 800×864) to draw one cropped sprite
 * is fine for v1's small test maps but is real mobile texture-memory pressure once the full Mostowo
 * camp map lands with many atlases in play — that's the point region-baking (crop once into a
 * per-map atlas at build/stream time, authored data untouched) earns its keep; noted here for that
 * follow-up, not solved now.
 *
 * Content-drift caveat (critique #3): this module is asset-blind by design (no pixel reads), so
 * `parseMap` validates a `region`'s ints/positivity but can't know whether it still lands on the
 * right sprite — re-running `scripts/pixel-crawler/gen_regions.py` after any sheet edit is the ONLY
 * guard against a sprite moving inside a same-size sheet (an out-of-bounds region is caught by the
 * Node catalog build; a same-size drift isn't, that's the gap). A DEV-only region-bounds assert
 * against the loaded texture's real dimensions belongs in the renderer (`decorSprites`, step 7b),
 * not here — this module has no texture/pixel access to assert against.
 */
export function collectTextureSources(map: MapFile): TextureSourceRef[] {
  const seen = new Set<string>();
  const result: TextureSourceRef[] = [];

  for (const entry of map.palette) {
    if (entry === null) continue; // reserved empty slot
    const key = `palette:${tileSourceKey(entry.source)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ kind: 'palette', source: entry.source });
  }

  for (const obj of map.objects) {
    if (obj.kind !== 'decor') continue;
    const key = `decorAsset:${obj.asset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ kind: 'decorAsset', asset: obj.asset });
  }

  return result;
}
