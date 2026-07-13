import { describe, it, expect } from 'vitest';
import { objectFootprintCells, footprintIsValid, nextObjectId } from '../objectOps';
import {
  createEmptyMap,
  type DecorObject,
  type NodeObject,
  type PortalObject,
} from '../../systems/mapFormat';

const TILE_SIZE = 16;

describe('objectFootprintCells', () => {
  it('a node footprints its single col/row', () => {
    const obj: NodeObject = { id: 'node_0001', kind: 'node', ref: 'tree', col: 3, row: 4 };
    expect(objectFootprintCells(obj, TILE_SIZE)).toEqual([{ col: 3, row: 4 }]);
  });

  it('a portal footprints every cell of its rect', () => {
    const obj: PortalObject = {
      id: 'portal_0001',
      kind: 'portal',
      name: 'South road',
      rect: { col: 2, row: 5, w: 2, h: 2 },
      facing: 'down',
    };
    const cells = objectFootprintCells(obj, TILE_SIZE);
    expect(cells).toEqual([
      { col: 2, row: 5 },
      { col: 3, row: 5 },
      { col: 2, row: 6 },
      { col: 3, row: 6 },
    ]);
  });

  it('cosmetic decor (no collision) footprints the tile under its floored pixel position', () => {
    const obj: DecorObject = {
      id: 'decor_0001',
      kind: 'decor',
      asset: 'pixel-crawler/foo.png',
      x: 40,
      y: 33,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
      depth: 0,
    };
    // floor(40/16)=2, floor(33/16)=2
    expect(objectFootprintCells(obj, TILE_SIZE)).toEqual([{ col: 2, row: 2 }]);
  });

  it('decor with a collision footprint uses that rect instead of the pixel-floor tile', () => {
    const obj: DecorObject = {
      id: 'decor_0002',
      kind: 'decor',
      asset: 'pixel-crawler/foo.png',
      x: 100,
      y: 100,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
      depth: 0,
      collision: { col: 1, row: 1, w: 2, h: 1 },
    };
    expect(objectFootprintCells(obj, TILE_SIZE)).toEqual([
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ]);
  });
});

describe('footprintIsValid', () => {
  it('is true when every footprint cell is inside an all-inside (unshaped) map', () => {
    const map = createEmptyMap('m', 'M', 4, 4);
    const obj: NodeObject = { id: 'node_0001', kind: 'node', ref: 'tree', col: 2, row: 2 };
    expect(footprintIsValid(map, obj)).toBe(true);
  });

  it('is false when a footprint cell lands on a void cell', () => {
    const map = createEmptyMap('m', 'M', 4, 4);
    map.shape = { cells: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1] }; // (2,2) is void
    const obj: NodeObject = { id: 'node_0001', kind: 'node', ref: 'tree', col: 2, row: 2 };
    expect(footprintIsValid(map, obj)).toBe(false);
  });

  it('is false when a footprint cell is out of bounds', () => {
    const map = createEmptyMap('m', 'M', 4, 4);
    const obj: NodeObject = { id: 'node_0001', kind: 'node', ref: 'tree', col: 10, row: 10 };
    expect(footprintIsValid(map, obj)).toBe(false);
  });

  it('rejects a portal rect that partially overlaps void even if its origin cell is inside', () => {
    const map = createEmptyMap('m', 'M', 4, 4);
    // all inside except (3,0)
    const cells = new Array(16).fill(1) as number[];
    cells[3] = 0;
    map.shape = { cells };
    const obj: PortalObject = {
      id: 'portal_0001',
      kind: 'portal',
      name: 'X',
      rect: { col: 2, row: 0, w: 2, h: 1 }, // covers (2,0) inside + (3,0) void
      facing: 'down',
    };
    expect(footprintIsValid(map, obj)).toBe(false);
  });
});

describe('nextObjectId', () => {
  it('starts at 0001 for an empty map', () => {
    const map = createEmptyMap('m', 'M', 4, 4);
    expect(nextObjectId(map, 'decor')).toBe('decor_0001');
  });

  it('scans existing ids of the same prefix for the max, ignoring other prefixes', () => {
    const map = createEmptyMap('m', 'M', 4, 4);
    map.objects.push(
      {
        id: 'decor_0001',
        kind: 'decor',
        asset: 'a',
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
        depth: 0,
      },
      {
        id: 'decor_0003',
        kind: 'decor',
        asset: 'a',
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
        depth: 0,
      },
      { id: 'node_0007', kind: 'node', ref: 'tree', col: 0, row: 0 },
    );
    expect(nextObjectId(map, 'decor')).toBe('decor_0004');
    expect(nextObjectId(map, 'node')).toBe('node_0008');
    expect(nextObjectId(map, 'portal')).toBe('portal_0001');
  });

  it('also avoids ids passed via extraIds, so a same-batch mint never collides', () => {
    const map = createEmptyMap('m', 'M', 4, 4);
    map.objects.push({
      id: 'decor_0001',
      kind: 'decor',
      asset: 'a',
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
      depth: 0,
    });
    const first = nextObjectId(map, 'decor');
    expect(first).toBe('decor_0002');
    const second = nextObjectId(map, 'decor', [first]);
    expect(second).toBe('decor_0003');
  });
});
