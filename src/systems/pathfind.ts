/**
 * A* pathfinding on the tile grid, for a worker unit (player now, NPC workers later).
 * Pure — no Phaser, no scene deps. Obstacles are supplied by the caller via `isBlocked`
 * (completed walls + live trees, etc.); out-of-bounds always counts as blocked.
 *
 * 8-connected with an octile heuristic. Diagonal moves may not cut between two blocked
 * orthogonal corners (no squeezing through a wall's diagonal gap).
 */

/** A grid cell. */
export interface Cell {
  col: number;
  row: number;
}

/** Grid extent; anything outside `[0,cols) × [0,rows)` is treated as blocked. */
export interface Dims {
  cols: number;
  rows: number;
}

/** True if `(col,row)` cannot be walked. */
type Blocked = (col: number, row: number) => boolean;

/** Step costs. Diagonal ≈ √2 so octile distances stay admissible. */
const STRAIGHT = 1;
const DIAGONAL = 1.4142135623730951;

/** The 8 neighbour offsets (orthogonal + diagonal). */
const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Out-of-bounds counts as blocked; otherwise defer to the caller's predicate. */
function isWall(col: number, row: number, isBlocked: Blocked, dims: Dims): boolean {
  if (col < 0 || row < 0 || col >= dims.cols || row >= dims.rows) return true;
  return isBlocked(col, row);
}

/**
 * A diagonal step from `(col,row)` by `(dc,dr)` is legal only if it doesn't cut a wall
 * corner: reject when BOTH shared orthogonal cells are blocked. (Orthogonal steps always
 * pass this test since one delta is zero.)
 */
function cornerOk(
  col: number,
  row: number,
  dc: number,
  dr: number,
  isBlocked: Blocked,
  dims: Dims,
): boolean {
  if (dc === 0 || dr === 0) return true;
  const sideA = isWall(col + dc, row, isBlocked, dims);
  const sideB = isWall(col, row + dr, isBlocked, dims);
  return !(sideA && sideB);
}

/** Octile distance: cheap-diagonals-first estimate, admissible for 8-connectivity. */
function octile(ac: number, ar: number, bc: number, br: number): number {
  const dc = Math.abs(ac - bc);
  const dr = Math.abs(ar - br);
  return STRAIGHT * (dc + dr) + (DIAGONAL - 2 * STRAIGHT) * Math.min(dc, dr);
}

/**
 * Find a shortest 8-connected path from `start` to `goal`.
 *
 * Return contract — callers MUST branch all three:
 * - `start === goal` → `[]` (already there; treat as "arrived, act now").
 * - `goal` blocked or unreachable → `null` (skip / pick another adjacent tile).
 * - otherwise → a non-empty list of tiles to step *to*, ending at `goal`, **never
 *   including `start`**.
 */
export function findPath(start: Cell, goal: Cell, isBlocked: Blocked, dims: Dims): Cell[] | null {
  if (start.col === goal.col && start.row === goal.row) return [];
  if (isWall(goal.col, goal.row, isBlocked, dims)) return null;
  if (isWall(start.col, start.row, isBlocked, dims)) return null;

  const key = (col: number, row: number): number => row * dims.cols + col;
  const goalKey = key(goal.col, goal.row);

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  // Open set as a plain array scanned linearly — fine at our grid sizes.
  const open: Array<{ col: number; row: number; f: number }> = [];

  const startKey = key(start.col, start.row);
  gScore.set(startKey, 0);
  open.push({
    col: start.col,
    row: start.row,
    f: octile(start.col, start.row, goal.col, goal.row),
  });

  while (open.length > 0) {
    // Pop the lowest-f node.
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    const currentKey = key(current.col, current.row);

    if (currentKey === goalKey) return reconstruct(cameFrom, currentKey, dims);

    const currentG = gScore.get(currentKey) ?? Infinity;

    for (const [dc, dr] of OFFSETS) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      if (isWall(nc, nr, isBlocked, dims)) continue;
      if (!cornerOk(current.col, current.row, dc, dr, isBlocked, dims)) continue;

      const stepCost = dc !== 0 && dr !== 0 ? DIAGONAL : STRAIGHT;
      const tentativeG = currentG + stepCost;
      const nKey = key(nc, nr);
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentativeG);
        open.push({ col: nc, row: nr, f: tentativeG + octile(nc, nr, goal.col, goal.row) });
      }
    }
  }

  return null;
}

/** Walk `cameFrom` back to the start, returning the path excluding the start tile. */
function reconstruct(cameFrom: Map<number, number>, goalKey: number, dims: Dims): Cell[] {
  const path: Cell[] = [];
  let k: number | undefined = goalKey;
  while (k !== undefined) {
    path.push({ col: k % dims.cols, row: Math.floor(k / dims.cols) });
    k = cameFrom.get(k);
  }
  path.reverse();
  path.shift(); // drop the start tile
  return path;
}

/**
 * Of `tile`'s candidate neighbours (all 8 by default), return the walkable one reachable from
 * `from` by the shortest successful {@link findPath}, else `null`. Used by harvest/build to stand
 * next to a target — so "no reachable adjacent tile" is detectable rather than a silent stall.
 * (`[]` counts as reachable: `from` already *is* that neighbour.)
 *
 * Pass a restricted `offsets` set to constrain *which* sides count — e.g. a tall tree that overhangs
 * upward wants the worker at its base, not on a canopy tile above it (see NODES.tree.standOffsets).
 */
export function reachableAdjacent(
  from: Cell,
  tile: Cell,
  isBlocked: Blocked,
  dims: Dims,
  offsets: ReadonlyArray<readonly [number, number]> = OFFSETS,
): Cell | null {
  let best: Cell | null = null;
  let bestLen = Infinity;
  for (const [dc, dr] of offsets) {
    const nc = tile.col + dc;
    const nr = tile.row + dr;
    if (isWall(nc, nr, isBlocked, dims)) continue;
    const path = findPath(from, { col: nc, row: nr }, isBlocked, dims);
    if (path === null) continue;
    if (path.length < bestLen) {
      bestLen = path.length;
      best = { col: nc, row: nr };
    }
  }
  return best;
}
