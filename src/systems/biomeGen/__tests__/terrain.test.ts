import { describe, it, expect } from 'vitest';
import { generateTerrain, type TerrainCell } from '../terrain';
import { parseBiomeDefs, type BiomeTerrain } from '../../biomeDefs';
import { parseEdgeSet, type EdgeSet } from '../../edgeSets';
// Static JSON imports (`resolveJsonModule`) — mirrors `biomeDefs.test.ts`'s committed-file posture.
import biomesDoc from '../../../../public/assets/tilesets/pixel-crawler/biomes.json';
import grassDoc from '../../../../public/assets/tilesets/pixel-crawler/edge-sets/grass.json';
import mudDoc from '../../../../public/assets/tilesets/pixel-crawler/edge-sets/mud.json';
import waterDoc from '../../../../public/assets/tilesets/pixel-crawler/edge-sets/water.json';

const grass = parseEdgeSet(grassDoc, 'grass');
const mud = parseEdgeSet(mudDoc, 'mud');
const water = parseEdgeSet(waterDoc, 'water');
const edgeSets: Record<string, EdgeSet> = { grass, mud, water };

const forestTerrain: BiomeTerrain = parseBiomeDefs(biomesDoc).forest.terrain;

/** Every painted cell must resolve to exactly one of `frame`/`imageAsset` — the "no unmapped cells"
 *  acceptance bar. */
function expectFullyResolved(cells: TerrainCell[]): void {
  for (const cell of cells) {
    const hasFrame = cell.frame !== undefined;
    const hasAsset = cell.imageAsset !== undefined;
    expect(hasFrame !== hasAsset).toBe(true);
  }
}

describe('generateTerrain', () => {
  it('is deterministic: same inputs -> byte-identical result', () => {
    const opts = { region: { cols: 24, rows: 24 }, terrain: forestTerrain, seed: 6, edgeSets };
    const a = generateTerrain(opts);
    const b = generateTerrain(opts);
    expect(a).toEqual(b);
  });

  it('produces a different result for a different seed', () => {
    const base = { region: { cols: 24, rows: 24 }, terrain: forestTerrain, edgeSets };
    const a = generateTerrain({ ...base, seed: 6 });
    const b = generateTerrain({ ...base, seed: 99 });
    expect(a.cellEdgeSet).not.toEqual(b.cellEdgeSet);
  });

  it('every layer cell resolves to a real frame or image asset (no unmapped cells)', () => {
    const result = generateTerrain({
      region: { cols: 24, rows: 24 },
      terrain: forestTerrain,
      seed: 6,
      edgeSets,
    });
    for (const layer of result.layers) expectFullyResolved(layer.cells);
    expect(result.layers.flatMap((l) => l.cells).length).toBeGreaterThan(0);
  });

  it('Forest preset: water forms a pool that is always ringed by mud, never touching grass directly', () => {
    const cols = 24;
    const rows = 24;
    const result = generateTerrain({
      region: { cols, rows },
      terrain: forestTerrain,
      seed: 6,
      edgeSets,
    });
    const at = (col: number, row: number): string | undefined =>
      col >= 0 && col < cols && row >= 0 && row < rows
        ? result.cellEdgeSet[row * cols + col]
        : undefined;
    let waterCount = 0;
    let mudCount = 0;
    let waterGrassAdjacency = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const id = at(col, row);
        if (id === 'water') waterCount++;
        if (id === 'mud') mudCount++;
        if (id !== 'water') continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          if (at(col + dx, row + dy) === 'grass') waterGrassAdjacency++;
        }
      }
    }
    expect(waterCount).toBeGreaterThan(0);
    expect(mudCount).toBeGreaterThan(0);
    expect(waterGrassAdjacency).toBe(0);
  });

  it('Forest preset: water is predominantly one contiguous pool (not scattered puddles)', () => {
    const cols = 24;
    const rows = 24;
    const result = generateTerrain({
      region: { cols, rows },
      terrain: forestTerrain,
      seed: 6,
      edgeSets,
    });
    const isWater = (col: number, row: number): boolean =>
      col >= 0 &&
      col < cols &&
      row >= 0 &&
      row < rows &&
      result.cellEdgeSet[row * cols + col] === 'water';
    const visited = new Set<number>();
    const components: number[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        if (!isWater(col, row) || visited.has(idx)) continue;
        let size = 0;
        const stack = [idx];
        visited.add(idx);
        while (stack.length > 0) {
          const cur = stack.pop()!;
          size++;
          const cx = cur % cols;
          const cy = (cur / cols) | 0;
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = cx + dx;
            const ny = cy + dy;
            const nIdx = ny * cols + nx;
            if (isWater(nx, ny) && !visited.has(nIdx)) {
              visited.add(nIdx);
              stack.push(nIdx);
            }
          }
        }
        components.push(size);
      }
    }
    // Continuous noise thresholded into bands can legitimately carve a second, smaller local-minimum
    // puddle (concentric ringing is per-pool, not a guarantee of exactly one pool) — assert the pool
    // is DOMINATED by one component rather than requiring a single component for every seed.
    const total = components.reduce((sum, n) => sum + n, 0);
    const largest = Math.max(...components);
    expect(total).toBeGreaterThan(0);
    expect(largest / total).toBeGreaterThan(0.8);
  });

  it('the water (depth-method) band overhangs the region by one row/col (dual-grid, region-local coords)', () => {
    const cols = 24;
    const rows = 24;
    const result = generateTerrain({
      region: { cols, rows },
      terrain: forestTerrain,
      seed: 6,
      edgeSets,
    });
    const baseLayer = result.layers.find((l) => l.layerRole === 'base')!;
    const waterCells = baseLayer.cells.filter((c) => c.edgeSetId === 'water');
    expect(waterCells.some((c) => c.col === cols || c.row === rows)).toBe(true);
    for (const c of waterCells) {
      expect(c.col).toBeGreaterThanOrEqual(0);
      expect(c.col).toBeLessThanOrEqual(cols);
      expect(c.row).toBeGreaterThanOrEqual(0);
      expect(c.row).toBeLessThanOrEqual(rows);
    }
  });

  it('a fully-mud band (maxHeight 1, no water) is a flat opaque fill with no autotiling', () => {
    const terrain: BiomeTerrain = {
      base: 'grass',
      field: { scale: 0.1, octaves: 2 },
      bands: [{ edgeSetId: 'mud', maxHeight: 1 }],
    };
    const result = generateTerrain({ region: { cols: 6, rows: 6 }, terrain, seed: 1, edgeSets });
    const overlay = result.layers.find((l) => l.layerRole === 'overlay')!;
    const base = result.layers.find((l) => l.layerRole === 'base')!;
    expect(overlay.cells).toHaveLength(0); // grass mask is empty -> whole region is mud
    expect(base.cells).toHaveLength(36);
    for (const cell of base.cells) {
      expect(cell.edgeSetId).toBe('mud');
      expect(cell.frame).toBe(mud.method === 'blob' ? mud.surfaces[0].base : undefined);
      expect(cell.rotation).toBe(0);
    }
  });

  it('an empty bands array (flat single-terrain biome) paints only the base overlay', () => {
    const terrain: BiomeTerrain = { base: 'grass', field: { scale: 0.1, octaves: 2 }, bands: [] };
    const result = generateTerrain({ region: { cols: 6, rows: 6 }, terrain, seed: 1, edgeSets });
    const overlay = result.layers.find((l) => l.layerRole === 'overlay')!;
    const base = result.layers.find((l) => l.layerRole === 'base')!;
    expect(overlay.cells).toHaveLength(36);
    expect(base.cells).toHaveLength(0);
    expect(result.cellEdgeSet.every((id) => id === 'grass')).toBe(true);
    expectFullyResolved(overlay.cells);
  });

  it('throws a clear error when a band references an unregistered edge set', () => {
    const terrain: BiomeTerrain = {
      base: 'grass',
      field: { scale: 0.1, octaves: 2 },
      bands: [{ edgeSetId: 'lava', maxHeight: 0.5 }],
    };
    expect(() =>
      generateTerrain({ region: { cols: 4, rows: 4 }, terrain, seed: 1, edgeSets }),
    ).toThrow(/no edge set registered for id "lava"/);
  });

  it("throws a clear error when terrain.base isn't a blob-method edge set", () => {
    const terrain: BiomeTerrain = { base: 'water', field: { scale: 0.1, octaves: 2 }, bands: [] };
    expect(() =>
      generateTerrain({ region: { cols: 4, rows: 4 }, terrain, seed: 1, edgeSets }),
    ).toThrow(/must use the 'blob' method/);
  });
});
