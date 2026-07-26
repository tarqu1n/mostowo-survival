import { describe, it, expect } from 'vitest';
import { generateScatter, type ScatterPlacement } from '../scatter';
import type { BiomeScatterLayer } from '../../biomeDefs';
import { TILE_SIZE } from '../../../config';

const FIELD = { scale: 0.06, octaves: 2 };

function flatCellEdgeSet(cols: number, rows: number, id = 'grass'): string[] {
  return new Array<string>(cols * rows).fill(id);
}

function pairwiseMinDistanceTiles(placements: ScatterPlacement[]): number {
  const points = placements.map((p) =>
    p.kind === 'decor' ? { x: p.x / TILE_SIZE, y: p.y / TILE_SIZE } : { x: p.col, y: p.row },
  );
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < min) min = d;
    }
  }
  return min;
}

describe('generateScatter', () => {
  it('is deterministic: same inputs -> byte-identical result', () => {
    const region = { cols: 30, rows: 30 };
    const layer: BiomeScatterLayer = {
      id: 'ferns',
      kind: 'decor',
      spacing: 2,
      density: 0.8,
      members: [{ ref: 'craftpix-nature/Bushes/Fern1_3.png', weight: 1 }],
    };
    const input = {
      region,
      layers: [layer],
      field: FIELD,
      seed: 6,
      cellEdgeSet: flatCellEdgeSet(region.cols, region.rows),
    };
    const a = generateScatter(input);
    const b = generateScatter(input);
    expect(a).toEqual(b);
    expect(a.placements.length).toBeGreaterThan(0);
  });

  it('honours the layer minimum spacing between placements', () => {
    const region = { cols: 40, rows: 40 };
    const layer: BiomeScatterLayer = {
      id: 'ferns',
      kind: 'decor',
      spacing: 3,
      density: 1,
      members: [{ ref: 'craftpix-nature/Bushes/Fern1_3.png', weight: 1 }],
    };
    const result = generateScatter({
      region,
      layers: [layer],
      field: FIELD,
      seed: 1,
      cellEdgeSet: flatCellEdgeSet(region.cols, region.rows),
    });
    expect(result.placements.length).toBeGreaterThan(10);
    expect(pairwiseMinDistanceTiles(result.placements)).toBeGreaterThanOrEqual(3 - 1e-9);
  });

  it('the density field thins placements in low-density layers vs high-density ones', () => {
    const region = { cols: 50, rows: 50 };
    const cellEdgeSet = flatCellEdgeSet(region.cols, region.rows);
    const makeLayer = (density: number): BiomeScatterLayer => ({
      id: 'nodes',
      kind: 'node',
      spacing: 2,
      density,
      members: [{ ref: 'tree', weight: 1 }],
    });

    const sparse = generateScatter({
      region,
      layers: [makeLayer(0.05)],
      field: FIELD,
      seed: 4,
      cellEdgeSet,
    });
    const dense = generateScatter({
      region,
      layers: [makeLayer(1)],
      field: FIELD,
      seed: 4,
      cellEdgeSet,
    });

    expect(sparse.placements.length).toBeLessThan(dense.placements.length);
  });

  it('places zero points on cells whose edge-set is in avoidTerrains', () => {
    const region = { cols: 40, rows: 40 };
    const cellEdgeSet = flatCellEdgeSet(region.cols, region.rows, 'grass');
    for (let row = 0; row < region.rows; row++) {
      for (let col = 0; col < 20; col++) {
        cellEdgeSet[row * region.cols + col] = 'water';
      }
    }
    const layer: BiomeScatterLayer = {
      id: 'nodes',
      kind: 'node',
      spacing: 2,
      density: 1,
      members: [{ ref: 'tree', weight: 1 }],
      avoidTerrains: ['water'],
    };
    const result = generateScatter({ region, layers: [layer], field: FIELD, seed: 2, cellEdgeSet });

    expect(result.placements.length).toBeGreaterThan(0);
    for (const p of result.placements) {
      if (p.kind !== 'node') continue;
      expect(p.col).toBeGreaterThanOrEqual(20);
    }
  });

  it('clumping scatters child placements near their parent, on top of the Poisson-sampled parents', () => {
    const region = { cols: 60, rows: 60 };
    const cellEdgeSet = flatCellEdgeSet(region.cols, region.rows);
    const baseLayer: BiomeScatterLayer = {
      id: 'berries',
      kind: 'node',
      spacing: 8,
      density: 1,
      members: [{ ref: 'berryBush', weight: 1 }],
    };
    const clumpedLayer: BiomeScatterLayer = {
      ...baseLayer,
      clump: { chance: 1, radius: 2, count: [3, 3] },
    };

    const parentsOnly = generateScatter({
      region,
      layers: [baseLayer],
      field: FIELD,
      seed: 3,
      cellEdgeSet,
    }).placements;
    const withClump = generateScatter({
      region,
      layers: [clumpedLayer],
      field: FIELD,
      seed: 3,
      cellEdgeSet,
    }).placements;

    expect(withClump.length).toBeGreaterThan(parentsOnly.length);

    const isNode = (p: ScatterPlacement): p is Extract<ScatterPlacement, { kind: 'node' }> =>
      p.kind === 'node';
    const parents = parentsOnly.filter(isNode);
    const all = withClump.filter(isNode);

    // Every placement in the clumped run is either exactly one of the Poisson parents, or lies within
    // (radius + flooring slack) tiles of one — i.e. a clump child, never an unrelated stray point.
    const TOLERANCE = 2; // both parent and child col/row are independently floored from continuous coords
    for (const p of all) {
      const isExactParent = parents.some((parent) => parent.col === p.col && parent.row === p.row);
      if (isExactParent) continue;
      const nearParent = parents.some((parent) => {
        const dx = parent.col - p.col;
        const dy = parent.row - p.row;
        return Math.sqrt(dx * dx + dy * dy) <= 2 + TOLERANCE;
      });
      expect(nearParent).toBe(true);
    }
  });
});
