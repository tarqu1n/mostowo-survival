import { describe, expect, it } from 'vitest';
import { computeTerrainBake } from '../terrainOps';
import type { Dims, Mask, TerrainMapping } from '../../systems/autotile';
// Python-generated parity fixture (plan 014 step 10 acceptance bar): the real, committed terrain defs
// + a mask/expected-frames fixture, both computed by `scripts/pixel-crawler/gen_terrains.py` via a
// plain-Python mirror of `src/systems/autotile.ts`'s `blobKey`/`paintMask`/`pickFrame` logic. Static
// JSON imports (`resolveJsonModule`, like `catalog.ts`'s runtime `fetch` counterpart) rather than
// `node:fs` — this repo has no `@types/node` dependency, and Vite/vitest resolve `.json` imports
// natively regardless of tsconfig's `include: ["src"]` (that only governs tsc's root file set, not
// the import graph it follows from files that ARE in `src`).
import terrainsDoc from '../../../public/assets/tilesets/pixel-crawler/terrains.json';
import fixtureDoc from './fixtures/grass-terrain-parity.json';

describe('computeTerrainBake — Python autotiler parity (grass terrain)', () => {
  it('bakes the committed fixture mask to the exact frames scripts/pixel-crawler/gen_terrains.py computed', () => {
    const grass = terrainsDoc.terrains.find((t) => t.id === 'grass');
    if (!grass) throw new Error('terrains.json has no grass entry');
    const mapping = grass.mapping as unknown as TerrainMapping;

    const fixture = fixtureDoc as {
      dims: Dims;
      mask: Mask;
      expected: Array<{ col: number; row: number; frame: number }>;
    };
    const layerCells = new Array<number>(fixture.dims.cols * fixture.dims.rows).fill(0);

    // resolveIndex maps a baked frame 1:1 to a distinct "palette index" (the frame itself, offset by
    // 1 so 0 stays reserved for empty) — this test only cares that the FRAME CHOICE matches the Python
    // reference for each cell, not the real find-or-append palette machinery (that's paintOps.ts's
    // job, exercised in the editorStore integration instead).
    const resolveIndex = (frame: number): number => frame + 1;

    const changes = computeTerrainBake(
      fixture.mask,
      fixture.dims,
      mapping,
      new Set(),
      layerCells,
      resolveIndex,
    );

    const byIndex = new Map(changes.map((c) => [c.index, c.next - 1]));
    for (const { col, row, frame } of fixture.expected) {
      const index = row * fixture.dims.cols + col;
      expect(byIndex.get(index)).toBe(frame);
    }
    // No extra baked cells beyond what the Python reference expected.
    expect(changes.length).toBe(fixture.expected.length);
  });
});

describe('computeTerrainBake', () => {
  const dims: Dims = { cols: 3, rows: 3 };
  const mapping: TerrainMapping = { 0: 10, 255: 20 };
  const resolveIndex = (frame: number): number => 100 + frame; // arbitrary distinct palette indices

  it('bakes a freshly-painted single cell to its resolved palette index', () => {
    // prettier-ignore
    const mask: Mask = [
      0, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ];
    const layerCells = new Array<number>(9).fill(0);
    const changes = computeTerrainBake(mask, dims, mapping, new Set(), layerCells, resolveIndex);
    expect(changes).toEqual([{ index: 4, prev: 0, next: 110 }]); // frame 10 -> resolveIndex 110
  });

  it('is a no-op when the resolved frame already matches the layer cell', () => {
    // prettier-ignore
    const mask: Mask = [
      0, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ];
    const layerCells = new Array<number>(9).fill(0);
    layerCells[4] = 110; // already baked to frame 10's palette index
    expect(computeTerrainBake(mask, dims, mapping, new Set(), layerCells, resolveIndex)).toEqual(
      [],
    );
  });

  it('clears an erased cell (mask 1->0) back to empty even though paintMask no longer reports it', () => {
    // mask now has the centre cell OFF — paintMask reports nothing for it — but it was previously baked.
    // prettier-ignore
    const mask: Mask = [
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
    ];
    const layerCells = new Array<number>(9).fill(0);
    layerCells[4] = 110; // stale bake from before the erase
    const changes = computeTerrainBake(mask, dims, mapping, new Set([4]), layerCells, resolveIndex);
    expect(changes).toEqual([{ index: 4, prev: 110, next: 0 }]);
  });

  it('does not re-clear an already-empty erased cell', () => {
    const mask: Mask = new Array(9).fill(0) as Mask;
    const layerCells = new Array<number>(9).fill(0);
    expect(computeTerrainBake(mask, dims, mapping, new Set([4]), layerCells, resolveIndex)).toEqual(
      [],
    );
  });
});
