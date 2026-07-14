import { describe, it, expect } from 'vitest';
import { computeVoidCascade } from '../shapeOps';
import { createEmptyMap, type DecorObject, type NodeObject } from '../../systems/mapFormat';

// 4x4 map — index = row*4 + col.
function fourByFour() {
  return createEmptyMap('scratch', 'Scratch', 4, 4);
}

describe('computeVoidCascade', () => {
  it('is empty for a cell that has no tile/zone/object content', () => {
    const map = fourByFour();
    const cascade = computeVoidCascade(map, new Set([5])); // (col 1, row 1)
    expect(cascade).toEqual({ tileChanges: [], zoneChanges: [], removedObjectIndices: [] });
  });

  it('reports a non-empty tile-layer cell so the caller can zero it', () => {
    const map = fourByFour();
    map.layers[0].cells[5] = 3; // some palette index
    const cascade = computeVoidCascade(map, new Set([5]));
    expect(cascade.tileChanges).toEqual([{ layerIndex: 0, index: 5, prev: 3 }]);
  });

  it('reports every layer that has content at a voided cell', () => {
    const map = fourByFour();
    map.layers.push({
      id: 'l2',
      name: 'Overhead',
      kind: 'tiles',
      overhead: true,
      cells: new Array<number>(16).fill(0),
    });
    map.layers[0].cells[5] = 3;
    map.layers[1].cells[5] = 7;
    const cascade = computeVoidCascade(map, new Set([5]));
    expect(cascade.tileChanges).toEqual([
      { layerIndex: 0, index: 5, prev: 3 },
      { layerIndex: 1, index: 5, prev: 7 },
    ]);
  });

  it('reports a non-zero zone cell so the caller can zero it', () => {
    const map = fourByFour();
    map.zones.defs.push({ id: 1, name: 'Camp', colour: '#88aa44', favourites: [] });
    map.zones.cells[5] = 1;
    const cascade = computeVoidCascade(map, new Set([5]));
    expect(cascade.zoneChanges).toEqual([{ index: 5, prev: 1 }]);
  });

  it('reports an object whose footprint overlaps a voided cell, by array index', () => {
    const map = fourByFour();
    const node: NodeObject = { id: 'node_0001', kind: 'node', ref: 'tree', col: 1, row: 1 }; // index 5
    map.objects.push(node);
    const cascade = computeVoidCascade(map, new Set([5]));
    expect(cascade.removedObjectIndices).toEqual([0]);
  });

  it('does not report an object whose footprint misses every voided cell', () => {
    const map = fourByFour();
    const node: NodeObject = { id: 'node_0001', kind: 'node', ref: 'tree', col: 3, row: 3 }; // index 15
    map.objects.push(node);
    const cascade = computeVoidCascade(map, new Set([5]));
    expect(cascade.removedObjectIndices).toEqual([]);
  });

  it('reports a decor collision footprint spanning multiple cells even if only one is voided', () => {
    const map = fourByFour();
    const decor: DecorObject = {
      id: 'decor_0001',
      kind: 'decor',
      asset: 'pixel-crawler/foo.png',
      x: 16,
      y: 16,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
      depth: 0,
      collision: { col: 1, row: 1, w: 2, h: 1 }, // covers index 5 and 6
    };
    map.objects.push(decor);
    const cascade = computeVoidCascade(map, new Set([6])); // only the SECOND cell is voided
    expect(cascade.removedObjectIndices).toEqual([0]);
  });

  it('collects tile/zone/object cascades together and indices stay ascending across many objects', () => {
    const map = fourByFour();
    map.zones.defs.push({ id: 1, name: 'Camp', colour: '#88aa44', favourites: [] });
    map.zones.cells[5] = 1;
    map.layers[0].cells[5] = 2;
    const a: NodeObject = { id: 'node_0001', kind: 'node', ref: 'tree', col: 1, row: 1 }; // index 5
    const b: NodeObject = { id: 'node_0002', kind: 'node', ref: 'rock', col: 2, row: 2 }; // index 10, untouched
    const c: NodeObject = { id: 'node_0003', kind: 'node', ref: 'tree', col: 2, row: 1 }; // index 6
    map.objects.push(a, b, c);
    const cascade = computeVoidCascade(map, new Set([5, 6]));
    expect(cascade.tileChanges).toEqual([{ layerIndex: 0, index: 5, prev: 2 }]);
    expect(cascade.zoneChanges).toEqual([{ index: 5, prev: 1 }]);
    expect(cascade.removedObjectIndices).toEqual([0, 2]); // ascending, b (index 1) excluded
  });
});
