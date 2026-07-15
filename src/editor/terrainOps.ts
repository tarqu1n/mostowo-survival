/**
 * Pure terrain-brush bake helpers for the map editor (plan 014 step 10). NO Phaser/React imports —
 * Tier-1 vitest-able (`__tests__/terrainOps.test.ts`), mirroring `shapeOps.ts`/`zoneOps.ts`'s posture.
 * The actual blob classification lives in `src/systems/autotile.ts` (step 3, untouched here) — this
 * module is the glue between a painted 0/1 terrain mask and a tile LAYER's real palette-indexed cells.
 *
 * Rebake strategy: `computeTerrainBake` re-runs `paintMask` over the WHOLE mask on every call rather
 * than only the touched cell + its 8 neighbours. That's the plan's documented "simplest-correct"
 * choice — a cell's blobKey can only change within its own 8-neighbour ring, so any cell the current
 * edit didn't actually affect resolves to the SAME frame it already holds and is filtered out below
 * (no-op), giving the exact same result set as a narrower "only recompute the dirty ring" pass would,
 * just via one full-mask sweep. `autotile.ts`'s `pickFrame` fallback tiers aren't exported (autotile.ts
 * is left unmodified per step 3's rule), so this can't cheaply special-case just the dirty ring anyway
 * without duplicating that fallback logic — the full sweep sidesteps that without any drift risk. Test
 * maps are small (per the plan), so the extra recompute cost is negligible.
 *
 * `clearedIndices` covers the other half: a mask cell erased (1->0) this edit no longer appears in
 * `paintMask`'s output at all (it isn't painted), so its PREVIOUSLY-baked frame would otherwise linger
 * in the layer's cells forever. Callers pass exactly the indices that flipped 1->0 in this edit; this
 * module clears them to palette index 0 (empty) if they aren't still covered by `paintMask`'s reported
 * (indices are disjoint by construction: `paintMask` only reports mask===1 cells).
 */

import { paintMask, type Dims, type Mask, type TerrainMapping } from '../systems/autotile';

/** One layer cell whose palette index changed as a result of a terrain (re)bake. */
export interface TerrainBakeChange {
  /** Row-major flat index into the layer's `cells` array. */
  index: number;
  /** The value at `index` before the bake (what `undo` should restore). */
  prev: number;
  /** The value to write (what `do`/`redo` should apply). */
  next: number;
}

/** Resolves a baked `frame` to a palette index in the target map — bind a caller's
 *  `findOrAppendPaletteIndex(map, pack, {kind:'sheetFrame', sheet, frame})` closure to this shape. */
export type ResolveFrameIndex = (frame: number) => number;

/**
 * Computes every layer-cell change a terrain rebake requires: every currently-painted (`mask===1`)
 * cell's resolved palette index (via `paintMask` + `resolveIndex`), diffed against `layerCells` so only
 * genuinely-changed cells produce an entry, PLUS an explicit clear-to-0 for every `clearedIndices` entry
 * (cells that just went 1->0 and so no longer appear in `paintMask`'s output — see module doc). Pass an
 * empty `clearedIndices` set for a full-mask rebake (e.g. the pre-save canonicalization pass) where
 * nothing was just erased.
 */
export function computeTerrainBake(
  // `readonly number[]`, not the branded `Mask`: `TerrainSection.cells` (mapFormat.ts) is a plain
  // `number[]` — its values are constrained to 0|1 by `parseCells({max:1})`/every store mutation, but
  // not branded at the type level, matching every other editor grid (walkability/zone cells are
  // likewise plain `number[]`). Cast to `Mask` below for the `paintMask` call it's genuinely valid for.
  mask: readonly number[],
  dims: Dims,
  terrainMapping: TerrainMapping,
  clearedIndices: ReadonlySet<number>,
  layerCells: readonly number[],
  resolveIndex: ResolveFrameIndex,
): TerrainBakeChange[] {
  const changes: TerrainBakeChange[] = [];
  const seen = new Set<number>();
  for (const cell of paintMask(mask as Mask, dims, terrainMapping)) {
    const index = cell.row * dims.cols + cell.col;
    seen.add(index);
    const next = resolveIndex(cell.frame);
    const prev = layerCells[index];
    if (prev !== next) changes.push({ index, prev, next });
  }
  for (const index of clearedIndices) {
    if (seen.has(index)) continue; // can't happen (paintMask only reports mask===1 cells) — guard anyway
    const prev = layerCells[index];
    if (prev !== 0) changes.push({ index, prev, next: 0 });
  }
  return changes;
}
