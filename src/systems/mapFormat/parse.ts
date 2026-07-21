/**
 * Parsing + validation for the map schema — the single validating choke point (`parseMap`) every
 * map JSON import goes through, plus the low-level `expect*`/`parse*` primitives it's built from.
 * The primitives `fail`/`expectRecord` and the geometry helper `objectFootprintCells` are exported
 * for the sibling `serialize`/`resize` modules to reuse but are NOT re-exported by the barrel — the
 * public surface stays exactly `parseMap`.
 */

import type { TileSource } from '../../data/tileset';
import {
  getCell,
  isInside,
  type CollisionFootprint,
  type DecorAnim,
  type DecorRegion,
  type MapFile,
  type MapMeta,
  type MapObject,
  type MapShape,
  type PortalFacing,
  type TileLayer,
  type TilePaletteEntry,
  type TerrainSection,
  type Walkability,
  type ZoneDef,
  type Zones,
} from './schema';

// ---- Parsing helpers (throw with a precise `<path> <problem>` message) ----

export function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function expectRecord(value: unknown, path: string): Record<string, unknown> {
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
export function objectFootprintCells(
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
