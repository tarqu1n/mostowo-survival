/**
 * Pure geometry/math helpers for the World view tab (plan 014 step 9) — no React, no Phaser, no
 * store imports, so these are Tier-1 vitest-able like `shapeOps.ts`/`zoneOps.ts`. Two concerns live
 * here:
 *
 *  - Drag/drop math for the World view's React grid (`WorldViewTab.tsx`): converting a raw pixel
 *    delta at the current zoom into a whole-tile delta (placements always snap to whole tiles), and
 *    which map ids sit in the "unplaced" tray.
 *  - Ghost-strip geometry for the per-map view's `EditorScene`: given the open map's placement and a
 *    neighbour's placement, which global cells fall in the ~N-tile-deep ring just outside the open
 *    map's bounds AND belong to that neighbour — expressed in BOTH the open map's local coordinate
 *    space (where to draw) and the neighbour's local coordinate space (what to sample). Deliberately
 *    bounded to the ring, never the whole neighbour map (the plan is explicit: "never bake whole
 *    neighbour maps").
 */

import type { MapPlacement } from '../systems/worldLayout';

// ---- World-view drag math ----

/** Snaps a raw pixel drag delta to a whole-tile delta at the given world-view zoom (CSS px per
 *  world tile). Placements are always whole-tile — there's no free-pixel mode for map placement. */
export function snapPxDeltaToTiles(deltaPx: number, pxPerTile: number): number {
  if (!(pxPerTile > 0)) return 0;
  return Math.round(deltaPx / pxPerTile);
}

/** Which tile-space coordinate a raw pixel offset (already relative to the world grid's own origin,
 *  including any scroll/pan) falls in at the given zoom — floor, not round: a coordinate is "inside"
 *  tile N for the whole `[N, N+1)` px-per-tile span. */
export function pxToTile(px: number, pxPerTile: number): number {
  if (!(pxPerTile > 0)) return 0;
  return Math.floor(px / pxPerTile);
}

/** Map ids present in `allMapIds` but absent from `placements` — the World view's side tray. */
export function unplacedMapIds(
  allMapIds: readonly string[],
  placements: readonly MapPlacement[],
): string[] {
  const placed = new Set(placements.map((p) => p.mapId));
  return allMapIds.filter((id) => !placed.has(id));
}

// ---- Ghost-strip geometry ----

export interface GhostCell {
  /** Cell position in the OPEN map's local coordinate space — may be negative or >= its
   *  width/height, since a ghost cell is by definition just outside the open map's own bounds. */
  localCol: number;
  localRow: number;
  /** The same global cell, resolved to the NEIGHBOUR's own local coordinate space, for sampling its
   *  tile layers/palette. */
  neighbourCol: number;
  neighbourRow: number;
}

/**
 * Every global cell that (a) falls within `depth` tiles of the open map's bounding box but OUTSIDE
 * the box itself, (b) is within the neighbour's own bounding box, and (c) is inside the neighbour's
 * shape mask (`neighbourIsInside`). Returns cells in both the open map's local space (`localCol/Row`
 * — where `EditorScene` positions the baked strip) and the neighbour's local space (`neighbourCol/
 * Row` — what to sample from its tile layers). Empty if the neighbour doesn't reach into the ring at
 * all (bbox pre-filter below), so callers can skip a neighbour cheaply without scanning its cells.
 */
export function computeGhostStripCells(
  myOrigin: { col: number; row: number },
  myWidth: number,
  myHeight: number,
  depth: number,
  neighbourOrigin: { col: number; row: number },
  neighbourWidth: number,
  neighbourHeight: number,
  neighbourIsInside: (col: number, row: number) => boolean,
): GhostCell[] {
  const results: GhostCell[] = [];
  if (depth <= 0) return results;

  const ringMinCol = myOrigin.col - depth;
  const ringMaxCol = myOrigin.col + myWidth - 1 + depth;
  const ringMinRow = myOrigin.row - depth;
  const ringMaxRow = myOrigin.row + myHeight - 1 + depth;

  // bbox pre-filter: intersect the ring's bounding box with the neighbour's own bbox in global
  // space, before touching any per-cell shape-mask check.
  const nMinCol = Math.max(ringMinCol, neighbourOrigin.col);
  const nMaxCol = Math.min(ringMaxCol, neighbourOrigin.col + neighbourWidth - 1);
  const nMinRow = Math.max(ringMinRow, neighbourOrigin.row);
  const nMaxRow = Math.min(ringMaxRow, neighbourOrigin.row + neighbourHeight - 1);
  if (nMinCol > nMaxCol || nMinRow > nMaxRow) return results;

  const myMaxCol = myOrigin.col + myWidth - 1;
  const myMaxRow = myOrigin.row + myHeight - 1;

  for (let grow = nMinRow; grow <= nMaxRow; grow++) {
    for (let gcol = nMinCol; gcol <= nMaxCol; gcol++) {
      // Ghosts render only OUTSIDE the open map's own bounds — its own tiles already render normally.
      if (gcol >= myOrigin.col && gcol <= myMaxCol && grow >= myOrigin.row && grow <= myMaxRow) {
        continue;
      }
      const neighbourCol = gcol - neighbourOrigin.col;
      const neighbourRow = grow - neighbourOrigin.row;
      if (!neighbourIsInside(neighbourCol, neighbourRow)) continue;
      results.push({
        localCol: gcol - myOrigin.col,
        localRow: grow - myOrigin.row,
        neighbourCol,
        neighbourRow,
      });
    }
  }
  return results;
}

/** Bounding box (in the open map's LOCAL coordinate space) of a set of ghost cells — `null` for an
 *  empty set. `EditorScene` uses this to size the single RenderTexture the strips bake into. */
export function ghostBoundingBox(
  cells: readonly GhostCell[],
): { minCol: number; minRow: number; maxCol: number; maxRow: number } | null {
  if (cells.length === 0) return null;
  let minCol = Infinity;
  let minRow = Infinity;
  let maxCol = -Infinity;
  let maxRow = -Infinity;
  for (const c of cells) {
    if (c.localCol < minCol) minCol = c.localCol;
    if (c.localRow < minRow) minRow = c.localRow;
    if (c.localCol > maxCol) maxCol = c.localCol;
    if (c.localRow > maxRow) maxRow = c.localRow;
  }
  return { minCol, minRow, maxCol, maxRow };
}
