import { describe, it, expect } from 'vitest';
import { generateBiome, type BiomeGenExisting } from '../index';
import { generateTerrain } from '../terrain';
import { generateScatter } from '../scatter';
import { parseBiomeDefs } from '../../biomeDefs';
import { parseEdgeSet, type EdgeSet } from '../../edgeSets';
// Static JSON imports — mirrors terrain.test.ts's committed-file posture.
import biomesDoc from '../../../../public/assets/tilesets/pixel-crawler/biomes.json';
import grassDoc from '../../../../public/assets/tilesets/pixel-crawler/edge-sets/grass.json';
import mudDoc from '../../../../public/assets/tilesets/pixel-crawler/edge-sets/mud.json';
import waterDoc from '../../../../public/assets/tilesets/pixel-crawler/edge-sets/water.json';

const grass = parseEdgeSet(grassDoc, 'grass');
const mud = parseEdgeSet(mudDoc, 'mud');
const water = parseEdgeSet(waterDoc, 'water');
const edgeSets: Record<string, EdgeSet> = { grass, mud, water };

const forest = parseBiomeDefs(biomesDoc).forest;

const region = { cols: 32, rows: 32 };

describe('generateBiome', () => {
  it('is deterministic: same (region, biome, seed) -> identical BiomeResult', () => {
    const opts = { region, biome: forest, seed: 6, edgeSets };
    const a = generateBiome(opts);
    const b = generateBiome(opts);
    expect(a).toEqual(b);
    expect(a.tileEdits.flatMap((l) => l.cells).length).toBeGreaterThan(0);
    expect(a.objects.length).toBeGreaterThan(0);
  });

  it('meta.counts sums to objects.length, grouped by originating scatter layer', () => {
    const result = generateBiome({ region, biome: forest, seed: 6, edgeSets });
    const tally: Record<string, number> = {};
    for (const obj of result.objects) tally[obj.layerId] = (tally[obj.layerId] ?? 0) + 1;
    expect(result.meta.counts).toEqual(tally);
    expect(Object.values(result.meta.counts).reduce((a, b) => a + b, 0)).toBe(
      result.objects.length,
    );
    expect(result.meta.seed).toBe(6);
  });

  it('edge-falloff thins scatter placements near the region border far more than the interior', () => {
    const seed = 9;
    // Reproduce Steps 7+8's raw (pre-falloff, pre-exclusion) placements directly for comparison.
    const terrainResult = generateTerrain({ region, terrain: forest.terrain, seed, edgeSets });
    const rawScatter = generateScatter({
      region,
      layers: forest.scatter,
      field: forest.terrain.field,
      seed,
      cellEdgeSet: terrainResult.cellEdgeSet,
    });
    const tileOf = (p: (typeof rawScatter.placements)[number]): { col: number; row: number } =>
      p.kind === 'node' ? { col: p.col, row: p.row } : { col: p.x / 16, row: p.y / 16 };
    const isBorder = (col: number, row: number): boolean =>
      Math.min(col, row, region.cols - 1 - col, region.rows - 1 - row) < 3;

    const rawBorder = rawScatter.placements.filter((p) => {
      const { col, row } = tileOf(p);
      return isBorder(col, row);
    });
    const rawInterior = rawScatter.placements.filter((p) => {
      const { col, row } = tileOf(p);
      return !isBorder(col, row);
    });
    expect(rawBorder.length).toBeGreaterThan(0);
    expect(rawInterior.length).toBeGreaterThan(0);

    const result = generateBiome({ region, biome: forest, seed, edgeSets });
    const survivingKeys = new Set(
      result.objects.map((o) => (o.kind === 'node' ? `n:${o.col}:${o.row}` : `d:${o.x}:${o.y}`)),
    );
    const keyOf = (p: (typeof rawScatter.placements)[number]): string =>
      p.kind === 'node' ? `n:${p.col}:${p.row}` : `d:${p.x}:${p.y}`;

    const borderRetained = rawBorder.filter((p) => survivingKeys.has(keyOf(p))).length;
    const interiorRetained = rawInterior.filter((p) => survivingKeys.has(keyOf(p))).length;

    const borderRate = borderRetained / rawBorder.length;
    const interiorRate = interiorRetained / rawInterior.length;
    expect(borderRate).toBeLessThan(interiorRate);
    expect(interiorRate).toBeGreaterThan(0.9); // interior is beyond the falloff band -> essentially untouched
  });

  it('excludes tile edits and objects on cells outside `existing.isInside`', () => {
    const half = region.cols / 2;
    const existing: BiomeGenExisting = { isInside: (col) => col < half };
    const result = generateBiome({ region, biome: forest, seed: 6, edgeSets, existing });

    for (const layer of result.tileEdits) {
      for (const cell of layer.cells) expect(cell.col).toBeLessThan(half);
    }
    for (const obj of result.objects) {
      const col = obj.kind === 'node' ? obj.col : obj.x / 16;
      expect(col).toBeLessThan(half);
    }
  });

  it('excludes tile edits and objects on cells `existing.isOccupied` reports as taken', () => {
    const existing: BiomeGenExisting = { isOccupied: () => true };
    const result = generateBiome({ region, biome: forest, seed: 6, edgeSets, existing });

    expect(result.tileEdits.flatMap((l) => l.cells).length).toBe(0);
    expect(result.objects.length).toBe(0);
  });
});
