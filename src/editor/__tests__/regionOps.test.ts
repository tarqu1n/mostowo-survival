import { describe, it, expect } from 'vitest';
import {
  captureRegionObjects,
  computeGridRegionMove,
  normalizeRegion,
  objectInRegion,
  regionContains,
  regionDestinationInside,
  regionMoveInBounds,
  type RegionRect,
} from '../regionOps';
import {
  createEmptyMap,
  type DecorObject,
  type MapFile,
  type NodeObject,
  type PortalObject,
} from '../../systems/mapFormat';

const TILE_SIZE = 16;

/** Apply a computed edit list to a grid (mirrors the store command's `do`) so tests can assert the
 *  resulting grid, not just the edit deltas. */
function applyEdits(cells: number[], edits: ReturnType<typeof computeGridRegionMove>): number[] {
  const out = cells.slice();
  for (const e of edits) out[e.index] = e.next;
  return out;
}

describe('normalizeRegion', () => {
  it('orders corners independently and is inclusive of both', () => {
    expect(normalizeRegion(4, 4, 2, 1, 10, 10)).toEqual({ col: 2, row: 1, w: 3, h: 4 });
    expect(normalizeRegion(2, 1, 4, 4, 10, 10)).toEqual({ col: 2, row: 1, w: 3, h: 4 });
  });

  it('clamps to map bounds', () => {
    expect(normalizeRegion(-3, -1, 2, 2, 10, 10)).toEqual({ col: 0, row: 0, w: 3, h: 3 });
    expect(normalizeRegion(8, 8, 20, 20, 10, 10)).toEqual({ col: 8, row: 8, w: 2, h: 2 });
  });

  it('returns null when the rect is fully off-map on one side', () => {
    expect(normalizeRegion(-5, 2, -2, 4, 10, 10)).toBeNull();
    expect(normalizeRegion(2, 12, 4, 15, 10, 10)).toBeNull();
  });

  it('a single-cell drag is a 1×1 region', () => {
    expect(normalizeRegion(3, 3, 3, 3, 10, 10)).toEqual({ col: 3, row: 3, w: 1, h: 1 });
  });
});

describe('regionContains', () => {
  const region: RegionRect = { col: 2, row: 2, w: 3, h: 2 };
  it('is inclusive of the near edge and exclusive of the far edge', () => {
    expect(regionContains(region, 2, 2)).toBe(true);
    expect(regionContains(region, 4, 3)).toBe(true); // last cell (col 2+3-1, row 2+2-1)
    expect(regionContains(region, 5, 2)).toBe(false); // one past the right edge
    expect(regionContains(region, 2, 4)).toBe(false); // one past the bottom edge
    expect(regionContains(region, 1, 2)).toBe(false);
  });
});

describe('objectInRegion / captureRegionObjects', () => {
  function fixture(): MapFile {
    const map = createEmptyMap('t', 'T', 10, 10);
    const node: NodeObject = { id: 'node_0001', kind: 'node', ref: 'tree', col: 3, row: 3 };
    const outsideNode: NodeObject = { id: 'node_0002', kind: 'node', ref: 'tree', col: 8, row: 8 };
    const decor: DecorObject = {
      id: 'decor_0001',
      kind: 'decor',
      asset: 'pixel-crawler/foo.png',
      x: 3 * TILE_SIZE + 8, // floors to tile (3,4)
      y: 4 * TILE_SIZE + 8,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
      depth: 0,
    };
    const portal: PortalObject = {
      id: 'portal_0001',
      kind: 'portal',
      name: 'edge',
      rect: { col: 4, row: 2, w: 3, h: 1 }, // straddles the region's right edge
      facing: 'down',
    };
    map.objects = [node, outsideNode, decor, portal];
    return map;
  }

  it('captures any object whose footprint overlaps the region, and only those', () => {
    const map = fixture();
    const region: RegionRect = { col: 2, row: 2, w: 3, h: 3 }; // cols 2..4, rows 2..4
    const ids = captureRegionObjects(map, region);
    expect(ids.sort()).toEqual(['decor_0001', 'node_0001', 'portal_0001']);
    // The portal only overlaps by one cell (col 4) — still captured.
    const portal = map.objects.find((o) => o.id === 'portal_0001')!;
    expect(objectInRegion(portal, region, TILE_SIZE)).toBe(true);
  });

  it('excludes an object entirely outside the region', () => {
    const map = fixture();
    const region: RegionRect = { col: 0, row: 0, w: 5, h: 5 };
    expect(captureRegionObjects(map, region)).not.toContain('node_0002');
  });
});

describe('regionMoveInBounds', () => {
  const region: RegionRect = { col: 2, row: 2, w: 3, h: 3 }; // occupies cols 2..4, rows 2..4
  it('allows a move that keeps the whole rect on-map', () => {
    expect(regionMoveInBounds(region, 1, 1, 10, 10)).toBe(true);
    expect(regionMoveInBounds(region, -2, -2, 10, 10)).toBe(true); // to (0,0)
    expect(regionMoveInBounds(region, 5, 5, 10, 10)).toBe(true); // far edge at 10
  });
  it('refuses a move that pushes any edge past the map', () => {
    expect(regionMoveInBounds(region, -3, 0, 10, 10)).toBe(false);
    expect(regionMoveInBounds(region, 6, 0, 10, 10)).toBe(false);
    expect(regionMoveInBounds(region, 0, 6, 10, 10)).toBe(false);
  });
});

describe('computeGridRegionMove', () => {
  const inside = (): boolean => true;

  it('relocates a block, clearing the vacated source cells', () => {
    // 4×4 grid, a 2×2 block of value 7 at (0,0).
    const width = 4;
    // prettier-ignore
    const cells = [
      7, 7, 0, 0,
      7, 7, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ];
    const region: RegionRect = { col: 0, row: 0, w: 2, h: 2 };
    const edits = computeGridRegionMove(cells, width, region, 2, 2, inside);
    const out = applyEdits(cells, edits);
    // prettier-ignore
    expect(out).toEqual([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 7, 7,
      0, 0, 7, 7,
    ]);
  });

  it('handles overlapping source/destination — a 1-cell shift does not smear', () => {
    const width = 4;
    // prettier-ignore
    const cells = [
      1, 2, 0, 0,
      3, 4, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ];
    const region: RegionRect = { col: 0, row: 0, w: 2, h: 2 };
    const edits = computeGridRegionMove(cells, width, region, 1, 0, inside);
    const out = applyEdits(cells, edits);
    // prettier-ignore
    expect(out).toEqual([
      0, 1, 2, 0,
      0, 3, 4, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
  });

  it('only emits cells that actually change', () => {
    const width = 4;
    // Moving an all-zero block by (1,0) changes nothing.
    const cells = new Array(16).fill(0) as number[];
    const region: RegionRect = { col: 0, row: 0, w: 2, h: 2 };
    expect(computeGridRegionMove(cells, width, region, 1, 0, inside)).toEqual([]);
  });

  it('skips destination cells the predicate rejects (source still cleared)', () => {
    const width = 4;
    // prettier-ignore
    const cells = [
      5, 5, 0, 0,
      5, 5, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ];
    const region: RegionRect = { col: 0, row: 0, w: 2, h: 2 };
    // Reject the right column of the destination (col 3) — those stamps are dropped, sources cleared.
    const edits = computeGridRegionMove(cells, width, region, 2, 0, (c) => c !== 3);
    const out = applyEdits(cells, edits);
    // prettier-ignore
    expect(out).toEqual([
      0, 0, 5, 0,
      0, 0, 5, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
  });
});

describe('regionDestinationInside', () => {
  it('is true on a rectangular (no-void) map', () => {
    const map = createEmptyMap('t', 'T', 6, 6);
    const region: RegionRect = { col: 1, row: 1, w: 2, h: 2 };
    expect(regionDestinationInside(map, region, 1, 1)).toBe(true);
  });

  it('is false when a destination tile is a void cell', () => {
    const map = createEmptyMap('t', 'T', 6, 6);
    // Carve a void hole at (4,4) — shape 1=inside, 0=void.
    map.shape = { cells: new Array(36).fill(1) as number[] };
    map.shape.cells[4 * 6 + 4] = 0;
    const region: RegionRect = { col: 1, row: 1, w: 2, h: 2 };
    // Moving +3,+3 lands the block's (last) cell on (4,4) which is void.
    expect(regionDestinationInside(map, region, 3, 3)).toBe(false);
  });
});
