/**
 * Pure reclassify helpers (plan 017 step 3) — the frame-grid arithmetic + `putAssetOverride` plumbing
 * the object-editor tab (`tabs/ObjectEditorTab.tsx`) drives, lifted out of the retired plan 014 step 7c
 * `AssetReclassify` popover. Frame-grid geometry is deterministic integer arithmetic — never a
 * pixel-decode / LLM job (plan 014 step 7c) — so it lives here as small pure functions that are unit
 * tested directly (`__tests__/reclassify.test.ts`). Keeping the `pack.json`-override path here too
 * (relative-path key + patch shape) lets the tab deal purely in `(asset, type, cols, rows, omit)` —
 * plan 017 step 6 decouples grid geometry (`cols`/`rows`) from the played-frame set (`omit`), so
 * `frames` (total grid cells) is always derived, never itself a draft input.
 */
import { TILE_SIZE } from '../config';
import { putAssetOverride, type AssetOverridePatch, type AssetOverrideResult } from './api';
import type { CatalogAsset, CatalogAssetType } from './catalog';

export interface GridSuggestion {
  rows: number;
  cols: number;
  frames: number;
}

/** Candidate `{rows, cols}` strip grids for a sheet of size `w`×`h`, purely arithmetic (no pixel
 *  decode — plan 014 step 7c: "frame-grid geometry is deterministic integer arithmetic ... NOT an
 *  LLM job"): every `(rows, cols)` pair (capped at 8×8, i.e. up to 64 frames — plenty for any prop
 *  animation) where both `h/rows` and `w/cols` are whole numbers. Pairs whose resulting per-frame
 *  size is itself a multiple of `TILE_SIZE` sort first — the far more likely real grid for pixel-art
 *  authored at a tile-multiple size — then by ascending total frame count. `1×1` (the "unsliced
 *  whole sheet" case, not a grid) is never offered. Capped to 8 chips so the row doesn't wrap
 *  endlessly on a highly-divisible sheet size. Geometry unchanged by plan 017 step 6 (decoupling grid
 *  geometry from the played-frame set) — a chip picking `{cols, rows}` is still the right suggestion;
 *  it's the tab (plan 017 step 6.5) that must also clear any draft `omit` when a chip is clicked, since
 *  the chip's grid may no longer have the same cell indices as whatever was omitted before. */
export function suggestGrids(w: number, h: number): GridSuggestion[] {
  const MAX = 8;
  const out: { rows: number; cols: number; frames: number; tileAligned: boolean }[] = [];
  for (let rows = 1; rows <= MAX; rows++) {
    if (h % rows !== 0) continue;
    const frameHeight = h / rows;
    for (let cols = 1; cols <= MAX; cols++) {
      if (rows === 1 && cols === 1) continue;
      if (w % cols !== 0) continue;
      const frameWidth = w / cols;
      out.push({
        rows,
        cols,
        frames: rows * cols,
        tileAligned: frameWidth % TILE_SIZE === 0 && frameHeight % TILE_SIZE === 0,
      });
    }
  }
  out.sort((a, b) =>
    a.tileAligned !== b.tileAligned ? (a.tileAligned ? -1 : 1) : a.frames - b.frames,
  );
  return out.slice(0, MAX).map(({ rows, cols, frames }) => ({ rows, cols, frames }));
}

/** Initial `frames` draft for a reclassify form — the asset's own resolved frame count when it's
 *  already a real (≥2-frame) strip, else `2` (the smallest meaningful strip to guess from). */
export function seedFrames(asset: CatalogAsset): number {
  return asset.frames !== undefined && asset.frames >= 2 ? asset.frames : 2;
}

/** Initial `rows` draft — recovered from the asset's resolved `frameHeight` (`rows = h / frameHeight`;
 *  `rows` itself isn't a `CatalogAsset` field, see `catalog.ts`). Defaults to `1` (classic single-row
 *  strip) when the asset has no resolved `frameHeight`. */
export function seedRows(asset: CatalogAsset): number {
  return asset.frameHeight ? Math.max(1, Math.round(asset.h / asset.frameHeight)) : 1;
}

/** Initial `cols` draft — mirror of `seedRows`, recovered from the asset's resolved `frameWidth`
 *  (`cols = w / frameWidth`; `cols` itself isn't a `CatalogAsset` field, see `catalog.ts`). Defaults
 *  to `2` (the smallest meaningful strip, matching `seedFrames`'s old default of 2 with `seedRows`
 *  defaulting to 1 — i.e. a 2×1 starter grid) when the asset has no resolved `frameWidth`. */
export function seedCols(asset: CatalogAsset): number {
  return asset.frameWidth ? Math.max(1, Math.round(asset.w / asset.frameWidth)) : 2;
}

/** Initial `omit` draft — the asset's own resolved omit list, or `[]` when it has none (a fresh
 *  strip, or a non-strip type). */
export function seedOmit(asset: CatalogAsset): number[] {
  return asset.omit ?? [];
}

export interface ReclassifyGrid {
  /** Only meaningful for a `strip` (`undefined` for tile/object). */
  cols: number | undefined;
  /** Per-frame pixel size derived from the sheet dims (`w / cols`, `h / rows`). */
  frameWidth: number | undefined;
  frameHeight: number | undefined;
  /** Total grid cells (`cols*rows`) — the geometry-mode `frames`, before `omit` is applied.
   *  `undefined` for tile/object. */
  frames: number | undefined;
  /** Ascending `[0..frames-1]` minus the sanitised `omit` — the frames that actually play. Empty for
   *  tile/object (no grid to play). */
  played: number[];
  /** True when the grid divides the sheet into whole-pixel frames AND at least one cell survives
   *  `omit` (always true for non-strip types, which have no grid). Gates Apply and whether an
   *  overlay/per-frame preview is drawn. */
  valid: boolean;
}

/** Derive a strip's frame grid (cols + per-frame pixel size + played-cell set) and validity from the
 *  draft type/cols/rows/omit. Non-strip types have no grid (`cols`/dims/`frames` `undefined`, `played`
 *  empty) and are always valid. `col = i % cols`, `row = floor(i / cols)` is the frame layout the
 *  tab's preview uses — GRID math, not a single-row assumption (the bug plan 017 fixes: a 2×2 sheet
 *  cropped as if 1×4). `omit` removes cells from the played set (sanitised here to unique in-range
 *  ints, ascending); `played.length >= 1` is part of validity — "omit everything" is never valid. */
export function reclassifyGrid(
  asset: CatalogAsset,
  type: CatalogAssetType,
  cols: number,
  rows: number,
  omit: number[],
): ReclassifyGrid {
  if (type !== 'strip') {
    return {
      cols: undefined,
      frameWidth: undefined,
      frameHeight: undefined,
      frames: undefined,
      played: [],
      valid: true,
    };
  }
  const frames = cols * rows;
  const frameHeight = asset.h / rows;
  const frameWidth = asset.w / cols;
  const omitSet = new Set(omit.filter((i) => Number.isInteger(i) && i >= 0 && i < frames));
  const played: number[] = [];
  for (let i = 0; i < frames; i++) {
    if (!omitSet.has(i)) played.push(i);
  }
  const valid =
    Number.isInteger(cols) &&
    cols >= 1 &&
    Number.isInteger(rows) &&
    rows >= 1 &&
    Number.isInteger(frameHeight) &&
    Number.isInteger(frameWidth) &&
    played.length >= 1;
  return { cols, frameWidth, frameHeight, frames, played, valid };
}

/** Build the `pack.json` `overrides[relPath]` patch for a reclassify — a `strip` carries its frame
 *  grid as `cols`/`rows` (geometry mode: `frames` is derived server-side as `cols*rows`, never
 *  authored here — keeps `pack.json` lean/self-documenting) plus `omit` when non-empty; tile/object
 *  force just the `type`. */
export function reclassifyPatch(
  type: CatalogAssetType,
  cols: number,
  rows: number,
  omit: number[],
): AssetOverridePatch {
  return type === 'strip' ? { type, cols, rows, ...(omit.length ? { omit } : {}) } : { type };
}

/** The pack-relative path used as this asset's `pack.json` `overrides` key (id minus its `<pack>/`
 *  prefix). */
export function assetRelPath(asset: CatalogAsset): string {
  return asset.id.slice(asset.pack.length + 1);
}

/** Commit a reclassify: PUT the `pack.json` override (which reruns the server-side generators) and
 *  return the generator warnings. The caller must refetch the catalog (`loadCatalog`) afterwards to
 *  see the result — this mirrors how `putMap` doesn't re-read the map it just wrote (`api.ts`). */
export async function applyReclassify(
  asset: CatalogAsset,
  type: CatalogAssetType,
  cols: number,
  rows: number,
  omit: number[],
): Promise<AssetOverrideResult> {
  return putAssetOverride(asset.pack, assetRelPath(asset), reclassifyPatch(type, cols, rows, omit));
}
