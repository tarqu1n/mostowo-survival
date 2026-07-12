import { describe, it, expect } from 'vitest';
import { findPath, reachableAdjacent, type Cell, type Dims } from '../pathfind';

const DIMS: Dims = { cols: 10, rows: 10 };

function blockedFromSet(blocked: Set<string>): (col: number, row: number) => boolean {
  return (col: number, row: number) => blocked.has(`${col},${row}`);
}

describe('findPath', () => {
  it('returns [] when start === goal', () => {
    const isBlocked = blockedFromSet(new Set());
    const start: Cell = { col: 3, row: 3 };
    const goal: Cell = { col: 3, row: 3 };
    expect(findPath(start, goal, isBlocked, DIMS)).toEqual([]);
  });

  it('returns null when the goal tile is blocked', () => {
    const isBlocked = blockedFromSet(new Set(['5,5']));
    const path = findPath({ col: 0, row: 0 }, { col: 5, row: 5 }, isBlocked, DIMS);
    expect(path).toBeNull();
  });

  it('returns null when the start tile is blocked', () => {
    const isBlocked = blockedFromSet(new Set(['0,0']));
    const path = findPath({ col: 0, row: 0 }, { col: 5, row: 5 }, isBlocked, DIMS);
    expect(path).toBeNull();
  });

  it('returns null when the goal is walled off (unreachable)', () => {
    // Fully enclose (5,5) with a ring of blocked tiles.
    const blocked = new Set<string>();
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        blocked.add(`${5 + dc},${5 + dr}`);
      }
    }
    const isBlocked = blockedFromSet(blocked);
    const path = findPath({ col: 0, row: 0 }, { col: 5, row: 5 }, isBlocked, DIMS);
    expect(path).toBeNull();
  });

  it('routes around a wall built inline via the isBlocked predicate', () => {
    // A vertical wall at col=5 spanning rows 0..7, leaving a gap at row 8 to walk through.
    const blocked = new Set<string>();
    for (let row = 0; row <= 7; row++) blocked.add(`5,${row}`);
    const isBlocked = blockedFromSet(blocked);

    const start: Cell = { col: 0, row: 0 };
    const goal: Cell = { col: 9, row: 0 };
    const path = findPath(start, goal, isBlocked, DIMS);

    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    // Never steps onto a blocked tile.
    for (const cell of path!) {
      expect(isBlocked(cell.col, cell.row)).toBe(false);
    }
    // Ends at the goal, never includes the start.
    expect(path![path!.length - 1]).toEqual(goal);
    expect(path!.some((c) => c.col === start.col && c.row === start.row)).toBe(false);
    // Must detour through the gap at row 8 to cross col 5.
    expect(path!.some((c) => c.col === 5 && c.row === 8)).toBe(true);
  });

  it('rejects a diagonal corner-cut when both shared orthogonal cells are blocked', () => {
    // Block (3,2) and (2,3) so the diagonal step from (2,2) to (3,3) would cut the corner.
    // (2,2) keeps other open neighbours, so it isn't fully isolated.
    const blocked = new Set(['3,2', '2,3']);
    const isBlocked = blockedFromSet(blocked);
    const path = findPath({ col: 2, row: 2 }, { col: 3, row: 3 }, isBlocked, DIMS);
    // (3,3) itself is open, but every route there must detour rather than cut the corner.
    expect(path).not.toBeNull();
    // A legal corner-cut path would be length 1 (direct diagonal); rejection forces a longer route.
    expect(path!.length).toBeGreaterThan(1);
    for (const cell of path!) {
      expect(isBlocked(cell.col, cell.row)).toBe(false);
    }
  });

  it('allows a diagonal corner-cut when only one shared orthogonal cell is blocked', () => {
    const blocked = new Set(['1,0']);
    const isBlocked = blockedFromSet(blocked);
    const path = findPath({ col: 0, row: 0 }, { col: 1, row: 1 }, isBlocked, DIMS);
    expect(path).toEqual([{ col: 1, row: 1 }]);
  });
});

describe('reachableAdjacent', () => {
  it('picks a walkable reachable neighbour of the target tile', () => {
    const isBlocked = blockedFromSet(new Set());
    const from: Cell = { col: 0, row: 0 };
    const tile: Cell = { col: 5, row: 5 };
    const result = reachableAdjacent(from, tile, isBlocked, DIMS);
    expect(result).not.toBeNull();
    // Must be one of the 8 neighbours of tile.
    const dc = Math.abs(result!.col - tile.col);
    const dr = Math.abs(result!.row - tile.row);
    expect(dc).toBeLessThanOrEqual(1);
    expect(dr).toBeLessThanOrEqual(1);
    expect(dc + dr).toBeGreaterThan(0);
  });

  it('returns null when all neighbours are blocked or unreachable', () => {
    const blocked = new Set<string>();
    const tile: Cell = { col: 5, row: 5 };
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        blocked.add(`${tile.col + dc},${tile.row + dr}`);
      }
    }
    const isBlocked = blockedFromSet(blocked);
    const result = reachableAdjacent({ col: 0, row: 0 }, tile, isBlocked, DIMS);
    expect(result).toBeNull();
  });

  it('respects a restricted offsets set', () => {
    const isBlocked = blockedFromSet(new Set());
    const from: Cell = { col: 5, row: 8 };
    const tile: Cell = { col: 5, row: 5 };
    // Only allow the tile directly below the target (its "base" side).
    const offsets: ReadonlyArray<readonly [number, number]> = [[0, 1]];
    const result = reachableAdjacent(from, tile, isBlocked, DIMS, offsets);
    expect(result).toEqual({ col: 5, row: 6 });
  });

  it('returns null when the restricted offsets are all blocked', () => {
    const blocked = new Set(['5,6']);
    const isBlocked = blockedFromSet(blocked);
    const from: Cell = { col: 5, row: 8 };
    const tile: Cell = { col: 5, row: 5 };
    const offsets: ReadonlyArray<readonly [number, number]> = [[0, 1]];
    const result = reachableAdjacent(from, tile, isBlocked, DIMS, offsets);
    expect(result).toBeNull();
  });
});
