/**
 * Pure region-geometry helpers (plan 017 step 4) — the box arithmetic the object-editor tab's
 * Regions editor (`tabs/ObjectEditorTab.tsx`) drives. Mirrors `reclassify.ts`'s posture: the only
 * real logic here is deterministic integer geometry (slice a box into an even grid, seed editable
 * boxes from the catalog, sanitise a draft list before it's PUT), so it lives as small pure functions
 * unit-tested directly (`__tests__/regions.test.ts`) and keeps the React component thin.
 *
 * A `Box` is the bare `{x,y,w,h}` rect shape `pack.json`'s `regions[relPath]` stores VERBATIM (no
 * `key` — that's a catalog-only, coordinate-derived field, see `catalog.ts`'s `CatalogRegion`). It's
 * an alias of `api.ts`'s wire `RegionRect` so the editor, the PUT body, and the written pack.json all
 * speak one shape.
 */
import type { RegionRect } from './api';
import type { CatalogAsset } from './catalog';

/** An editable region box — bare `{x,y,w,h}`, exactly what `pack.json` `regions[relPath]` stores. */
export type Box = RegionRect;

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * Split `box` into a `cols`×`rows` grid of equal-as-possible integer cells that tile it EXACTLY —
 * no gaps, no overlaps, every pixel covered. The single action behind "grid-slice a merged crop row"
 * (the motivating Farm.png case). Boundaries are placed at `round(i * w / cols)` so a non-divisible
 * span (e.g. 10px into 3) distributes its remainder across cells (widths 3/4/3) rather than leaving a
 * short trailing cell. Returns cells in row-major order (row 0 left-to-right first). `cols`/`rows`
 * are floored to `>= 1`.
 */
export function sliceBox(box: Box, cols: number, rows: number): Box[] {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= c; i++) xs.push(box.x + Math.round((i * box.w) / c));
  for (let j = 0; j <= r; j++) ys.push(box.y + Math.round((j * box.h) / r));
  const out: Box[] = [];
  for (let j = 0; j < r; j++) {
    for (let i = 0; i < c; i++) {
      out.push({ x: xs[i], y: ys[j], w: xs[i + 1] - xs[i], h: ys[j + 1] - ys[j] });
    }
  }
  return out;
}

/**
 * Seed the editable box list for an asset from its current catalog `regions` (dropping the catalog's
 * coordinate-derived `key` — pack.json stores bare rects). An asset with no regions (a plain
 * single-sprite `object`, or a freshly-classified `object` with 0/1 detected sprites) seeds ONE box
 * covering the whole sheet, so the author can subdivide from there.
 */
export function seedRegions(asset: CatalogAsset): Box[] {
  const regions = asset.regions;
  if (regions && regions.length > 0) {
    return regions.map((rgn) => ({ x: rgn.x, y: rgn.y, w: rgn.w, h: rgn.h }));
  }
  return [{ x: 0, y: 0, w: asset.w, h: asset.h }];
}

/** Tunables for {@link detectRegionAt}. `alphaThresh` = the opacity a pixel must clear to count as a
 *  real object pixel. `gap` = how many transparent pixels the flood may BRIDGE (0 = tight, walk opaque
 *  pixels only — the interactive default, so a click never leaks into a touching neighbour). `seedRadius`
 *  = if the exact click is transparent, snap the seed to the nearest opaque pixel within this Chebyshev
 *  radius (click tolerance, kept SEPARATE from `gap` so forgiving clicks don't also merge sprites).
 *  `minArea` = reject a detected blob smaller than this (px²); 1 by default (the user clicked a specific
 *  sprite — honour it) rather than the batch detector's 40. */
export interface DetectOpts {
  alphaThresh?: number;
  gap?: number;
  seedRadius?: number;
  minArea?: number;
}

/**
 * Auto-detect the tight bounding box of the sprite under a clicked pixel — the "double-click to detect"
 * affordance in the Regions editor. A CLIENT-SIDE, single-seed cousin of the server's connected-component
 * detector (`scripts/pixel-crawler/objects.py` `components()`), but deliberately TIGHTER: because a click
 * means "this one sprite", it defaults to `gap:0` (walk opaque pixels only, no dilation) so it never
 * bridges into a touching/near neighbour — on a densely-packed sheet the batch detector's `gap:1` merges
 * half the sheet into one blob, which is exactly the wrong answer for a point-and-grab gesture. Click
 * tolerance is handled independently by `seedRadius` (snap a near-miss to the nearest opaque pixel),
 * so being forgiving about aim never costs you sprite separation.
 *
 * `alpha` is the sheet's raw alpha channel, row-major, length `w*h` (one byte per pixel). Flood-fills
 * (4-connectivity) the blob reachable from the seed, tightening the box on REAL pixels only. Returns
 * null if no opaque pixel sits within `seedRadius` of the click (empty sheet space) or the blob is below
 * `minArea`. It catches sprites the batch pass drops because it ignores the global `min_area` cut and
 * whatever merged/omitted them — it only cares what's under the click.
 */
export function detectRegionAt(
  alpha: Uint8Array,
  w: number,
  h: number,
  px: number,
  py: number,
  opts: DetectOpts = {},
): Box | null {
  const alphaThresh = opts.alphaThresh ?? 8;
  const gap = Math.max(0, Math.floor(opts.gap ?? 0));
  const seedRadius = Math.max(0, Math.floor(opts.seedRadius ?? 2));
  const minArea = Math.max(1, Math.floor(opts.minArea ?? 1));
  if (w <= 0 || h <= 0) return null;

  const cx = clampInt(px, 0, w - 1);
  const cy = clampInt(py, 0, h - 1);
  const isReal = (x: number, y: number): boolean => alpha[y * w + x] > alphaThresh;

  // Seed: the clicked pixel if it's opaque, else the NEAREST opaque pixel within `seedRadius` (so a
  // slightly-off click still catches the sprite). This is the only place aim-tolerance lives — the flood
  // itself stays tight.
  let seedX = -1;
  let seedY = -1;
  let bestD = Infinity;
  for (let dy = -seedRadius; dy <= seedRadius; dy++) {
    const ny = cy + dy;
    if (ny < 0 || ny >= h) continue;
    for (let dx = -seedRadius; dx <= seedRadius; dx++) {
      const nx = cx + dx;
      if (nx < 0 || nx >= w) continue;
      if (!isReal(nx, ny)) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        seedX = nx;
        seedY = ny;
      }
    }
  }
  if (seedX < 0) return null;

  // A pixel is "passable" (walkable by the flood) if it's real, or — when `gap>0` — within `gap` of a
  // real pixel (bridges hairline seams; off by default so touching sprites stay separate).
  const passable =
    gap === 0
      ? isReal
      : (x: number, y: number): boolean => {
          for (let dy = -gap; dy <= gap; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= h) continue;
            for (let dx = -gap; dx <= gap; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= w) continue;
              if (isReal(nx, ny)) return true;
            }
          }
          return false;
        };

  const seen = new Uint8Array(w * h);
  const stack: number[] = [seedY * w + seedX];
  seen[seedY * w + seedX] = 1;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  while (stack.length > 0) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    if (alpha[p] > alphaThresh) {
      // Tighten the box on real pixels only (a bridged-transparent pixel doesn't count).
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x > 0 && !seen[p - 1] && passable(x - 1, y)) {
      seen[p - 1] = 1;
      stack.push(p - 1);
    }
    if (x < w - 1 && !seen[p + 1] && passable(x + 1, y)) {
      seen[p + 1] = 1;
      stack.push(p + 1);
    }
    if (y > 0 && !seen[p - w] && passable(x, y - 1)) {
      seen[p - w] = 1;
      stack.push(p - w);
    }
    if (y < h - 1 && !seen[p + w] && passable(x, y + 1)) {
      seen[p + w] = 1;
      stack.push(p + w);
    }
  }

  if (x1 < 0) return null; // reachable mask held no real pixels (all bridge, no substance)
  const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  if (box.w * box.h < minArea) return null;
  return box;
}

/**
 * Normalise a draft box list before it's PUT: round every coord to an integer, clamp each box fully
 * in-bounds of the `sheetW`×`sheetH` sheet, and DROP any box that rounds to a degenerate size
 * (`w < 1` or `h < 1`). The server's `sanitiseRegions` re-validates identically and rejects anything
 * out-of-bounds — this just guarantees the client never sends a box that would be rejected (or a
 * stray zero-size click). An empty result is legal: it clears the override (fall back to
 * auto-detection).
 */
export function sanitiseClientRegions(boxes: Box[], sheetW: number, sheetH: number): Box[] {
  const out: Box[] = [];
  for (const b of boxes) {
    const w0 = Math.round(b.w);
    const h0 = Math.round(b.h);
    if (w0 < 1 || h0 < 1) continue;
    const x = clampInt(b.x, 0, sheetW - 1);
    const y = clampInt(b.y, 0, sheetH - 1);
    const w = clampInt(w0, 1, sheetW - x);
    const h = clampInt(h0, 1, sheetH - y);
    out.push({ x, y, w, h });
  }
  return out;
}
