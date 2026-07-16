/**
 * Pure paint-tool helpers for the map editor (plan 014 step 6). NO Phaser/React imports — Tier-1
 * vitest-able (`__tests__/paintOps.test.ts`), mirroring `src/systems/autotile.ts`'s posture.
 *
 * Deliberately generic: every grid helper takes a flat `cells` array + `width`/`height` + an
 * `isInside(col,row)` predicate rather than a `MapFile`/`TileLayer` — step 8 (walkability/zones/
 * shape painting) reuses this exact pipeline against different target grids, so nothing here
 * hardcodes "tile layer".
 */

import type { MapFile, TilePaletteEntry } from '../systems/mapFormat';
import type { TileSource } from '../data/tileset';

/** `(col, row) => boolean` — true if the cell is paintable (in bounds AND inside the shape mask). */
export type IsInside = (col: number, row: number) => boolean;

export interface CellChange {
  /** Row-major flat index into the `cells` array that changed. */
  index: number;
  /** The value at `index` before the change (what `undo` should restore). */
  prev: number;
}

/**
 * 4-connected flood fill starting at `(startCol, startRow)`. Matches every reachable cell whose
 * current value equals the START cell's value, bounded by `isInside` (void/out-of-bounds cells are
 * never visited or changed — flood fill never crosses the shape mask). No-op (returns `[]`) when the
 * start cell is outside, or its value already equals `newValue`. Returns the changed cells as
 * `{index, prev}` pairs so a caller can build an undo patch without re-deriving which cells moved.
 */
export function floodFill(
  cells: readonly number[],
  width: number,
  height: number,
  startCol: number,
  startRow: number,
  newValue: number,
  isInside: IsInside,
): CellChange[] {
  if (!isInside(startCol, startRow)) return [];
  const startIndex = startRow * width + startCol;
  const target = cells[startIndex];
  if (target === newValue) return [];

  const changes: CellChange[] = [];
  const visited = new Set<number>([startIndex]);
  const stack: Array<[number, number]> = [[startCol, startRow]];

  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    const [col, row] = next;
    const index = row * width + col;
    changes.push({ index, prev: cells[index] });

    const neighbours: Array<[number, number]> = [
      [col + 1, row],
      [col - 1, row],
      [col, row + 1],
      [col, row - 1],
    ];
    for (const [nc, nr] of neighbours) {
      if (nc < 0 || nr < 0 || nc >= width || nr >= height) continue;
      const nIndex = nr * width + nc;
      if (visited.has(nIndex)) continue;
      if (cells[nIndex] !== target) continue;
      if (!isInside(nc, nr)) continue;
      visited.add(nIndex);
      stack.push([nc, nr]);
    }
  }
  return changes;
}

/** Every `(col,row)` inside the normalized (order-independent) rectangle spanning the two corners,
 *  filtered by `isInside` (a rect drag never paints void cells). */
export function rectCells(
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  isInside: IsInside,
): Array<{ col: number; row: number }> {
  const minCol = Math.min(c0, c1);
  const maxCol = Math.max(c0, c1);
  const minRow = Math.min(r0, r1);
  const maxRow = Math.max(r0, r1);
  const cells: Array<{ col: number; row: number }> = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (isInside(col, row)) cells.push({ col, row });
    }
  }
  return cells;
}

/**
 * Every `(col,row)` along the segment from `(c0,r0)` to `(c1,r1)` inclusive, via Bresenham's
 * algorithm — so a fast brush drag (pointer moves several tiles between `pointermove` events)
 * doesn't leave gaps. NOT filtered by `isInside`; callers filter (a brush drag should still resolve
 * every cell it crosses so the tool can skip void ones individually, not abort the whole segment).
 */
export function lineCells(
  c0: number,
  r0: number,
  c1: number,
  r1: number,
): Array<{ col: number; row: number }> {
  const cells: Array<{ col: number; row: number }> = [];
  let x = c0;
  let y = r0;
  const dx = Math.abs(c1 - c0);
  const dy = -Math.abs(r1 - r0);
  const sx = c0 < c1 ? 1 : -1;
  const sy = r0 < r1 ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    cells.push({ col: x, row: y });
    if (x === c1 && y === r1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}

/**
 * Turn a (possibly-repeating, unfiltered) list of `{col,row}` points into the deduped `CellChange`s
 * needed to paint them all to `newValue` — one entry per distinct cell that would actually change,
 * skipping cells already at `newValue` (so a brush stroke over already-painted tiles produces an
 * empty command rather than a no-op undo entry). Shared by the line/rect paint tools; flood fill
 * builds its own list directly (see `floodFill`) since it must match on the START value, not skip by
 * target value.
 */
export function cellsToChanges(
  cells: readonly number[],
  width: number,
  points: ReadonlyArray<{ col: number; row: number }>,
  newValue: number,
): CellChange[] {
  const seen = new Set<number>();
  const changes: CellChange[] = [];
  for (const { col, row } of points) {
    const index = row * width + col;
    if (seen.has(index)) continue; // dedupe repeats within one call (a line can revisit a cell)
    seen.add(index);
    const prev = cells[index];
    if (prev === newValue) continue; // already this value — nothing to change
    changes.push({ index, prev });
  }
  return changes;
}

function tileSourceEquals(a: TileSource, b: TileSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'image') return a.path === (b as Extract<TileSource, { kind: 'image' }>).path;
  const sheetB = b as Extract<TileSource, { kind: 'sheetFrame' }>;
  return a.sheet === sheetB.sheet && a.frame === sheetB.frame;
}

/**
 * Find `map.palette`'s existing slot for `{pack, source, rotation}` (index >= 1 — index 0 is the
 * reserved empty slot), or APPEND a new one and return its index. A rotated tile is a DISTINCT slot,
 * so `rotation` joins the equality check (`0` and absent are equal). Mutates `map.palette` directly
 * and immediately — this append is deliberately NOT part of the undo/redo history (advisor rule: the
 * palette is append-only and unused entries are tolerated; only cell VALUES are undone/redone, never
 * palette membership, so re-saves never renumber existing indices).
 */
export function findOrAppendPaletteIndex(
  map: MapFile,
  pack: string,
  source: TileSource,
  rotation: 0 | 90 | 180 | 270 = 0,
): number {
  for (let i = 1; i < map.palette.length; i++) {
    const entry = map.palette[i];
    if (
      entry &&
      entry.pack === pack &&
      tileSourceEquals(entry.source, source) &&
      (entry.rotation ?? 0) === rotation
    )
      return i;
  }
  // `rotation` constructed LAST and omitted when 0 (mirror mapFormat) so serialized order stays stable.
  const entry: TilePaletteEntry = { pack, source, ...(rotation ? { rotation } : {}) };
  map.palette.push(entry);
  return map.palette.length - 1;
}
