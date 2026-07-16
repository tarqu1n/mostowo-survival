/**
 * Pure geometry for the reference-underlay auto-align (plan 022 step 2) — no Phaser, no
 * localStorage, no editor deps (kept free of `config.ts`'s `TILE_SIZE` so it stays trivially
 * unit-testable; the caller passes `tileSize` in). Two halves: `parseSidecar` defensively narrows
 * the raw `unknown` JSON `getMapReferenceSidecar` (`api.ts`) returns down to the small subset this
 * module needs, then `computeAutoAlign` turns that (plus the actual loaded image size) into a
 * scale/offset the editor can apply to the underlay sprite.
 */

/** The subset of the capture tool's sidecar (`scripts/map-reference/capture.mjs`,
 *  `<name>-reference.json`) this module reads — the real file also carries `name`/`source`/
 *  `center`/`metresPerTile`/`bbox`/etc, all ignored here. */
export interface Sidecar {
  pxPerTile: number;
  image: { w: number; h: number };
  grid: { w: number; h: number };
}

/** Narrow untrusted JSON to a `Sidecar`, or `null` if any required field is missing/wrong-typed —
 *  never throws. `Number.isFinite` rejects `NaN`/`Infinity`; `pxPerTile` is additionally required to
 *  be `> 0` (a zero/negative value would make `computeAutoAlign`'s division nonsensical, so treat it
 *  as an invalid sidecar rather than propagate an `Infinity` scale). */
export function parseSidecar(json: unknown): Sidecar | null {
  if (typeof json !== 'object' || json === null) return null;
  const obj = json as Record<string, unknown>;

  const pxPerTile = obj.pxPerTile;
  if (typeof pxPerTile !== 'number' || !Number.isFinite(pxPerTile) || pxPerTile <= 0) return null;

  const image = obj.image;
  if (typeof image !== 'object' || image === null) return null;
  const imageW = (image as Record<string, unknown>).w;
  const imageH = (image as Record<string, unknown>).h;
  if (typeof imageW !== 'number' || !Number.isFinite(imageW)) return null;
  if (typeof imageH !== 'number' || !Number.isFinite(imageH)) return null;

  const grid = obj.grid;
  if (typeof grid !== 'object' || grid === null) return null;
  const gridW = (grid as Record<string, unknown>).w;
  const gridH = (grid as Record<string, unknown>).h;
  if (typeof gridW !== 'number' || !Number.isFinite(gridW)) return null;
  if (typeof gridH !== 'number' || !Number.isFinite(gridH)) return null;

  return { pxPerTile, image: { w: imageW, h: imageH }, grid: { w: gridW, h: gridH } };
}

export interface AutoAlign {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Set only when the loaded image's actual pixel size doesn't match the sidecar's recorded
   *  `image.{w,h}` — a stale/wrong-sized reference image (the sidecar's real value here; the
   *  capture tool authors `pxPerTile === TILE_SIZE`, so scale is usually just `1`). */
  warning?: string;
}

/** Auto-align an underlay image against the tile grid. With a sidecar: `scale = tileSize /
 *  sidecar.pxPerTile` (typically `1`, since the capture tool authors `pxPerTile === TILE_SIZE`).
 *
 *  Offset: the capture tool centres its OSM slice on the author-supplied coordinate (see
 *  `capture.mjs` — `center: [lon, lat]`, symmetric bbox), so that coordinate lives at the *middle* of
 *  the reference image. To make it land at the middle of the *map* — the whole point of "the
 *  coordinate is the map's centre" — we centre the reference's on-grid footprint over the map when
 *  `mapWidth`/`mapHeight` (in TILES) are supplied: `offset = (mapTiles − refTiles) / 2`. The footprint
 *  is derived from the *actual* loaded pixels (`imageW * scale / tileSize`), so a scaled or
 *  wrong-sized image still centres on its true middle. Without map dims (or without a sidecar) we
 *  fall back to a zero offset (image flush to the grid origin) — the legacy behaviour.
 *
 *  A `warning` is set if the actually-loaded `imageW`/`imageH` disagree with what the sidecar
 *  recorded. Without a sidecar, everything falls back to identity `{ scale: 1, offsetX: 0, offsetY: 0
 *  }` (no warning — there's nothing to compare against, and no known real-world centre to align). */
export function computeAutoAlign(opts: {
  sidecar?: Sidecar | null;
  imageW: number;
  imageH: number;
  tileSize: number;
  /** Map size in TILES. When supplied (with a sidecar) the reference is centred over the map so its
   *  captured centre coordinate lands at the map's centre; omit to keep the legacy zero offset. */
  mapWidth?: number;
  mapHeight?: number;
}): AutoAlign {
  const { sidecar, imageW, imageH, tileSize, mapWidth, mapHeight } = opts;
  if (!sidecar) return { scale: 1, offsetX: 0, offsetY: 0 };

  const scale = tileSize / sidecar.pxPerTile;
  // On-grid footprint of the reference, in tiles (1 image px == scale/tileSize of a tile).
  const refTilesW = (imageW * scale) / tileSize;
  const refTilesH = (imageH * scale) / tileSize;
  const offsetX = typeof mapWidth === 'number' ? (mapWidth - refTilesW) / 2 : 0;
  const offsetY = typeof mapHeight === 'number' ? (mapHeight - refTilesH) / 2 : 0;

  const result: AutoAlign = { scale, offsetX, offsetY };
  if (imageW !== sidecar.image.w || imageH !== sidecar.image.h) {
    result.warning =
      `Reference image is ${imageW}×${imageH}px but the sidecar expects ` +
      `${sidecar.image.w}×${sidecar.image.h}px — it may be stale or the wrong file.`;
  }
  return result;
}
