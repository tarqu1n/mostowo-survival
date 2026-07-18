/**
 * Pure region-select helpers for the map editor (region select & move) — NO Phaser/React imports,
 * Tier-1 vitest-able (`__tests__/regionOps.test.ts`), mirroring `paintOps.ts`/`objectOps.ts`'s posture.
 *
 * A "region" is a rectangular block of the map marquee-selected with the Select tool. Moving it
 * relocates the CONTENTS of that block — every tile layer's `cells`, the `walkability`/`zones` grids,
 * each `terrain` mask, and every object whose footprint intersects the block — by a whole-tile
 * `(dCol,dRow)` step (the editor "add an area between existing stuff without redoing it" flow). The
 * map's void/shape mask is deliberately NOT moved (it's structural — see the store's `translateRegion`
 * doc). Tiles are the same flat `width*height` row-major integer grids every paint tool writes;
 * objects reuse `objectOps`' footprint model.
 */

import { isInside, type MapFile, type MapObject } from '../systems/mapFormat';
import { objectFootprintCells } from './objectOps';

/** A marquee-selected tile rectangle (map-local, whole tiles). `w`/`h` are always `>= 1`. */
export interface RegionRect {
  col: number;
  row: number;
  w: number;
  h: number;
}

/**
 * Order-independent tile rect spanning two corners, CLAMPED to the map's `[0,width)×[0,height)`
 * bounds (a marquee drag can end off-map). Returns `null` when the clamped rect has zero area (both
 * corners resolve outside the map on the same side) — the caller treats that as "no selection".
 */
export function normalizeRegion(
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  width: number,
  height: number,
): RegionRect | null {
  const minCol = Math.max(0, Math.min(c0, c1));
  const maxCol = Math.min(width - 1, Math.max(c0, c1));
  const minRow = Math.max(0, Math.min(r0, r1));
  const maxRow = Math.min(height - 1, Math.max(r0, r1));
  if (maxCol < minCol || maxRow < minRow) return null;
  return { col: minCol, row: minRow, w: maxCol - minCol + 1, h: maxRow - minRow + 1 };
}

/** True if `(col,row)` lies inside `region` (half-open on the far edges — `region.col + region.w` is
 *  the first column PAST the rect). */
export function regionContains(region: RegionRect, col: number, row: number): boolean {
  return (
    col >= region.col &&
    col < region.col + region.w &&
    row >= region.row &&
    row < region.row + region.h
  );
}

/** True if ANY of `obj`'s footprint cells fall inside `region` — the capture test for the marquee (an
 *  object is grabbed when it overlaps the box at all, matching how the box visually encloses it). */
export function objectInRegion(obj: MapObject, region: RegionRect, tileSize: number): boolean {
  return objectFootprintCells(obj, tileSize).some(({ col, row }) =>
    regionContains(region, col, row),
  );
}

/** Ids of every object whose footprint intersects `region` (decor/node/portal alike). */
export function captureRegionObjects(map: MapFile, region: RegionRect): string[] {
  return map.objects.filter((o) => objectInRegion(o, region, map.meta.tileSize)).map((o) => o.id);
}

/** True if translating `region` by `(dCol,dRow)` keeps it fully within `[0,width)×[0,height)` — the
 *  gate that stops a nudge from pushing tiles off the map edge (which would silently drop them). */
export function regionMoveInBounds(
  region: RegionRect,
  dCol: number,
  dRow: number,
  width: number,
  height: number,
): boolean {
  return (
    region.col + dCol >= 0 &&
    region.col + region.w + dCol <= width &&
    region.row + dRow >= 0 &&
    region.row + region.h + dRow <= height
  );
}

/** True if EVERY destination tile of a `(dCol,dRow)` move of `region` is inside the map (bounds AND
 *  not void) — refuse the move otherwise, so content never lands on a void cell (which would break
 *  `parseMap`'s void-consistency invariant). */
export function regionDestinationInside(
  map: MapFile,
  region: RegionRect,
  dCol: number,
  dRow: number,
): boolean {
  for (let dr = 0; dr < region.h; dr++) {
    for (let dc = 0; dc < region.w; dc++) {
      if (!isInside(map, region.col + dc + dCol, region.row + dr + dRow)) return false;
    }
  }
  return true;
}

/** One `{index}->value` change produced by a block move (carries both `prev` and `next` because a
 *  block move sets DIFFERENT values per cell, unlike the single-value paint `CellChange`). */
export interface RegionCellEdit {
  index: number;
  prev: number;
  next: number;
}

/**
 * Block-move edits for ONE flat `width*height` grid: relocate `region`'s cells by `(dCol,dRow)`.
 * Every source cell is cleared to `0`; every destination cell that passes `isInsideDest` receives its
 * source value. Destination writes win where source and destination rectangles overlap, so the block
 * MOVES (rather than smears) — source values are read from the ORIGINAL `cells` array, so the move is
 * effectively simultaneous. Returns only cells whose value actually changes (deduped by flat index).
 *
 * Callers gate the whole move on `regionMoveInBounds` + `regionDestinationInside` first, so in
 * practice every destination passes `isInsideDest` here; the predicate is still applied per-cell as a
 * defensive skip (a skipped destination just leaves its source-clear in place — never a smear).
 */
export function computeGridRegionMove(
  cells: readonly number[],
  width: number,
  region: RegionRect,
  dCol: number,
  dRow: number,
  isInsideDest: (col: number, row: number) => boolean,
): RegionCellEdit[] {
  const nextByIndex = new Map<number, number>();
  // Clear every source cell to empty first.
  for (let dr = 0; dr < region.h; dr++) {
    for (let dc = 0; dc < region.w; dc++) {
      const col = region.col + dc;
      const row = region.row + dr;
      nextByIndex.set(row * width + col, 0);
    }
  }
  // Stamp destinations, overriding the clear where the two rects overlap. Source values come from the
  // untouched `cells` array, so overlapping moves don't read already-cleared cells.
  for (let dr = 0; dr < region.h; dr++) {
    for (let dc = 0; dc < region.w; dc++) {
      const srcCol = region.col + dc;
      const srcRow = region.row + dr;
      const dstCol = srcCol + dCol;
      const dstRow = srcRow + dRow;
      if (!isInsideDest(dstCol, dstRow)) continue;
      nextByIndex.set(dstRow * width + dstCol, cells[srcRow * width + srcCol]);
    }
  }
  const edits: RegionCellEdit[] = [];
  for (const [index, next] of nextByIndex) {
    const prev = cells[index];
    if (prev !== next) edits.push({ index, prev, next });
  }
  return edits;
}
