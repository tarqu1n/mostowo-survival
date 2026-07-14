import { describe, it, expect } from 'vitest';
import {
  computeGhostStripCells,
  ghostBoundingBox,
  pxToTile,
  snapPxDeltaToTiles,
  unplacedMapIds,
} from '../worldViewOps';

describe('snapPxDeltaToTiles', () => {
  it('rounds a pixel delta to the nearest whole tile at the given zoom', () => {
    expect(snapPxDeltaToTiles(0, 4)).toBe(0);
    expect(snapPxDeltaToTiles(2, 4)).toBe(1); // rounds up at the midpoint
    expect(snapPxDeltaToTiles(1, 4)).toBe(0);
    expect(snapPxDeltaToTiles(-6, 4)).toBe(-1); // JS Math.round rounds -1.5 toward +Infinity
    expect(snapPxDeltaToTiles(17, 4)).toBe(4);
  });

  it('is a no-op (0) for a non-positive pxPerTile', () => {
    expect(snapPxDeltaToTiles(10, 0)).toBe(0);
    expect(snapPxDeltaToTiles(10, -3)).toBe(0);
  });
});

describe('pxToTile', () => {
  it('floors a pixel offset into a tile index', () => {
    expect(pxToTile(0, 4)).toBe(0);
    expect(pxToTile(3, 4)).toBe(0);
    expect(pxToTile(4, 4)).toBe(1);
    expect(pxToTile(-1, 4)).toBe(-1);
  });

  it('is a no-op (0) for a non-positive pxPerTile', () => {
    expect(pxToTile(10, 0)).toBe(0);
  });
});

describe('unplacedMapIds', () => {
  it('returns map ids absent from the placements list', () => {
    const ids = ['a', 'b', 'c'];
    const placements = [{ mapId: 'b', origin: { col: 0, row: 0 } }];
    expect(unplacedMapIds(ids, placements)).toEqual(['a', 'c']);
  });

  it('returns everything when nothing is placed', () => {
    expect(unplacedMapIds(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('returns nothing when every map is placed', () => {
    const placements = [
      { mapId: 'a', origin: { col: 0, row: 0 } },
      { mapId: 'b', origin: { col: 10, row: 0 } },
    ];
    expect(unplacedMapIds(['a', 'b'], placements)).toEqual([]);
  });
});

describe('computeGhostStripCells', () => {
  /** A rectangular (all-inside) neighbour's `isInside` — the common case in these tests. */
  function rectInside(width: number, height: number) {
    return (col: number, row: number): boolean =>
      col >= 0 && row >= 0 && col < width && row < height;
  }

  it('returns cells just outside the open map, in both coordinate spaces', () => {
    // Open map: 10x10 at global origin (0,0). Neighbour: 10x10 placed directly to the right, at
    // global origin (10,0) — so its LEFT column (neighbour-local col 0) is the strip.
    const cells = computeGhostStripCells(
      { col: 0, row: 0 },
      10,
      10,
      3,
      { col: 10, row: 0 },
      10,
      10,
      rectInside(10, 10),
    );
    expect(cells.length).toBeGreaterThan(0);
    // Every cell should be within the 3-tile-deep ring (local col in [10,12]) and map to neighbour
    // local col in [0,2].
    for (const c of cells) {
      expect(c.localCol).toBeGreaterThanOrEqual(10);
      expect(c.localCol).toBeLessThanOrEqual(12);
      expect(c.neighbourCol).toBeGreaterThanOrEqual(0);
      expect(c.neighbourCol).toBeLessThanOrEqual(2);
      // Rows line up 1:1 since both maps share row origin 0.
      expect(c.neighbourRow).toBe(c.localRow);
    }
    // Depth 3 × 10 rows = 30 cells exactly (neighbour is rectangular/all-inside, no shape gaps).
    expect(cells.length).toBe(30);
  });

  it("excludes cells that fall inside the open map's own bounds", () => {
    // Neighbour overlaps my bbox slightly (pathological/invalid layout) — cells inside MY bbox must
    // never appear even though they satisfy the neighbour's own isInside check.
    const cells = computeGhostStripCells(
      { col: 0, row: 0 },
      10,
      10,
      5,
      { col: 5, row: 0 }, // overlaps my right half
      10,
      10,
      rectInside(10, 10),
    );
    for (const c of cells) {
      const insideMine = c.localCol >= 0 && c.localCol < 10 && c.localRow >= 0 && c.localRow < 10;
      expect(insideMine).toBe(false);
    }
  });

  it('returns nothing for a neighbour outside the ring depth', () => {
    const cells = computeGhostStripCells(
      { col: 0, row: 0 },
      10,
      10,
      2, // depth 2 — a neighbour starting at global col 20 is 10 tiles away, well outside
      { col: 20, row: 0 },
      10,
      10,
      rectInside(10, 10),
    );
    expect(cells).toEqual([]);
  });

  it("respects the neighbour's shape mask (a void neighbour cell contributes nothing)", () => {
    const cells = computeGhostStripCells(
      { col: 0, row: 0 },
      4,
      4,
      2,
      { col: 4, row: 0 },
      4,
      4,
      () => false, // entirely void neighbour
    );
    expect(cells).toEqual([]);
  });

  it('returns [] immediately for depth <= 0', () => {
    expect(
      computeGhostStripCells({ col: 0, row: 0 }, 4, 4, 0, { col: 4, row: 0 }, 4, 4, () => true),
    ).toEqual([]);
  });
});

describe('ghostBoundingBox', () => {
  it('returns null for an empty cell list', () => {
    expect(ghostBoundingBox([])).toBeNull();
  });

  it('computes the min/max local col/row across all cells', () => {
    const box = ghostBoundingBox([
      { localCol: 10, localRow: 0, neighbourCol: 0, neighbourRow: 0 },
      { localCol: 12, localRow: 5, neighbourCol: 2, neighbourRow: 5 },
      { localCol: -3, localRow: -1, neighbourCol: 1, neighbourRow: 1 },
    ]);
    expect(box).toEqual({ minCol: -3, minRow: -1, maxCol: 12, maxRow: 5 });
  });
});
