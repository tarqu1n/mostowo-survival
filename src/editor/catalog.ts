/**
 * Typed access to the generated asset catalog (`public/assets/asset-catalog.json`, plan 014 step 2)
 * for the editor's Library panel (step 6). A light structural narrow — not a strict `parseMap`-style
 * validator — since the catalog is machine-generated and committed (`npm run assets:catalog`), not
 * hand-authored; this just replaces `unknown` with real types for the Library UI.
 */

import type { TileSource } from '../data/tileset';

export interface CatalogPack {
  id: string;
  name: string;
  licence: string;
  tileSize: number;
}

/** The three classifications an asset can carry. NOTE: the `'strip'` token is baked into `pack.json`
 *  `rules`, the committed catalog, the server's `OVERRIDE_TYPES`, and `gen_regions.py`, so it stays
 *  `'strip'` on the wire — but the editor UI DISPLAYS it as "Animated strip" (plan 017 step 6, a
 *  label-only rename at the display layer). */
export type CatalogAssetType = 'tile' | 'strip' | 'object';

/** One detected sprite bounding box within an `object` atlas's sheet (plan 014 step 7a). `key` is
 *  rect-derived (`"${x}_${y}_${w}_${h}"`, see `scripts/pixel-crawler/gen_regions.py`), stable across
 *  regens unless the sprite actually moves/resizes. Prefer `regionKey()` below for a list/React key:
 *  it recomputes from the rect, so it stays collision-free even against catalog data still carrying
 *  the old top-left-only `key` before a regen. */
export interface CatalogRegion {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Unique list/React key for a region: the full rect, NOT just the `key` field. Two distinct sprites
 *  can share a top-left corner (nested/overlapping boxes), so `key` alone (`"${x}_${y}"`) can collide
 *  — deriving from `x/y/w/h` here is collision-proof regardless of how stale the catalog's `key` is
 *  (see `scripts/pixel-crawler/gen_regions.py`). */
export function regionKey(r: { x: number; y: number; w: number; h: number }): string {
  return `${r.x}_${r.y}_${r.w}_${r.h}`;
}

export interface CatalogAsset {
  /** `<pack>/<relative path>` — stable across regens. Tile-type ids never carry `#frame` (they name
   *  the whole sheet); the Library appends `#frame` itself when a specific tile frame is clicked. */
  id: string;
  pack: string;
  type: CatalogAssetType;
  source: TileSource;
  /** Sheet/image pixel size. */
  w: number;
  h: number;
  /** Total grid cell count — present on `tile`/`strip` (sheet) assets, absent on standalone `object`
   *  images. For a `strip`, plan 017 step 6 decouples this from the *played* frame set: `frames`
   *  is always `cols*rows` (every cell in the grid), and `omit` (below) lists the cells skipped when
   *  playing. A no-op for pre-6.4 data, where `frames` was already `cols*rows`. */
  frames?: number;
  /** Explicit per-frame cell size for a `strip` asset (Phaser `load.spritesheet` shape) — GRID
   *  math, not just a single horizontal row (plan 014 step 7c): `cols = w / frameWidth`,
   *  `rows = h / frameHeight`, i.e. `frameWidth = w / cols`, `frameHeight = h / rows`. `cols`/`rows`
   *  themselves aren't `CatalogAsset` fields — they're `pack.json` override inputs consumed at
   *  catalog-build time; a consumer that needs them back derives them from `w`/`frameWidth` and
   *  `h`/`frameHeight`. Never a square/smaller-dim guess (see `src/data/tileset.ts` `StripAnim` doc
   *  and `scripts/asset-catalog.mjs`'s `stripFrameDims`). Absent on `tile`/`object` assets. */
  frameWidth?: number;
  frameHeight?: number;
  /** Cell indices (row-major, `0..frames-1`) skipped by a geometry-mode `strip` — present only when
   *  non-empty; the played set is `[0..frames-1]` minus `omit` (plan 017 step 6). Absent on
   *  `tile`/`object` assets and on a strip with no omitted cells. */
  omit?: number[];
  /** Present on `object` assets detected as multi-sprite atlases (>=2 regions merged from
   *  `<pack>/regions.json`) — see `scripts/pixel-crawler/gen_regions.py`. Absent ⇒ a plain
   *  single-sprite object (place the whole image), including every `object` asset with 0 or 1
   *  detected region. */
  regions?: CatalogRegion[];
  category: string;
  tags: string[];
}

export interface AssetCatalog {
  packs: CatalogPack[];
  assets: CatalogAsset[];
}

/** Narrow an unknown JSON value fetched from `asset-catalog.json` into `AssetCatalog`. Throws with a
 *  short message on an unrecognisable shape (a regen that broke the generator, wrong file, etc). */
export function parseCatalog(json: unknown): AssetCatalog {
  if (typeof json !== 'object' || json === null) {
    throw new Error('asset-catalog.json: expected an object');
  }
  const root = json as { packs?: unknown; assets?: unknown };
  if (!Array.isArray(root.packs) || !Array.isArray(root.assets)) {
    throw new Error('asset-catalog.json: expected { packs: [...], assets: [...] }');
  }
  return { packs: root.packs as CatalogPack[], assets: root.assets as CatalogAsset[] };
}

/** Column count of a tile asset's sheet at `tileSize` px per cell — derived from the catalog's own
 *  `w`, never hardcoded (different sheets use different column counts). */
export function catalogTileCols(asset: CatalogAsset, tileSize: number): number {
  return Math.max(1, Math.floor(asset.w / tileSize));
}
