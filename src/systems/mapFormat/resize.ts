/**
 * Editor "Resize map" action (plan 024 step 1) + schema-version migration (`migrateMap`) + the
 * texture-source enumeration (`collectTextureSources`). Pure — no Phaser.
 */

import type { TileSource } from '../../data/tileset';
import { cellIndex, isInside, type MapFile, type MapObject, type TextureSourceRef } from './schema';
import { expectRecord, fail, objectFootprintCells, parseMap } from './parse';

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
