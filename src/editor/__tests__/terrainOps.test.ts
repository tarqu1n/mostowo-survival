import { describe, expect, it } from 'vitest';
import { computeTerrainBake } from '../terrainOps';
import type { Dims, Mask, TerrainMapping } from '../../systems/autotile';
// Python-generated parity fixtures (plan 014 step 10 acceptance bar; extended plan 052 step 1): the
// real, committed terrain defs + one mask/expected-frames fixture PER TERRAIN, all computed by
// `scripts/pixel-crawler/gen_terrains.py` via a plain-Python mirror of `src/systems/autotile.ts`'s
// `blobKey`/`paintMask`/`pickFrame` logic. Static JSON imports (`resolveJsonModule`, like
// `catalog.ts`'s runtime `fetch` counterpart) rather than `node:fs` — this repo has no `@types/node`
// dependency, and Vite/vitest resolve `.json` imports natively regardless of tsconfig's
// `include: ["src"]` (that only governs tsc's root file set, not the import graph from files in `src`).
import terrainsDoc from '../../../public/assets/tilesets/pixel-crawler/terrains.json';
import grassFixture from './fixtures/grass-terrain-parity.json';
import dirtFixture from './fixtures/dirt-terrain-parity.json';
// Hand-committed grass invariance snapshot (plan 052 step 1, finding #4). This file is NOT emitted by
// gen_terrains.py — the parity fixtures regenerate with the script and so cannot catch grass drift,
// but this snapshot is authored once and only changes by a deliberate hand-edit, so any accidental
// change to the generated grass block (e.g. from onboarding another terrain) fails the test below.
import grassDefSnapshot from './fixtures/grass-terrain-def.snapshot.json';

type ParityFixture = {
  dims: Dims;
  mask: Mask;
  expected: Array<{ col: number; row: number; frame: number }>;
};

const PARITY_CASES: Array<{ id: string; fixture: ParityFixture }> = [
  { id: 'grass', fixture: grassFixture as ParityFixture },
  { id: 'dirt', fixture: dirtFixture as ParityFixture },
];

describe('computeTerrainBake — Python autotiler parity', () => {
  it.each(PARITY_CASES)(
    'bakes the committed $id fixture mask to the exact frames gen_terrains.py computed',
    ({ id, fixture }) => {
      const terrain = terrainsDoc.terrains.find((t) => t.id === id);
      if (!terrain) throw new Error(`terrains.json has no ${id} entry`);
      const mapping = terrain.mapping as unknown as TerrainMapping;

      const layerCells = new Array<number>(fixture.dims.cols * fixture.dims.rows).fill(0);

      // resolveIndex maps a baked frame 1:1 to a distinct "palette index" (the frame itself, offset by
      // 1 so 0 stays reserved for empty) — this test only cares that the FRAME CHOICE matches the
      // Python reference for each cell, not the real find-or-append palette machinery (that's
      // paintOps.ts's job, exercised in the editorStore integration instead).
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
    },
  );

  it('keeps the committed grass terrain def byte-identical to its hand-authored snapshot (grass-invariance guard)', () => {
    const grass = terrainsDoc.terrains.find((t) => t.id === 'grass');
    if (!grass) throw new Error('terrains.json has no grass entry');
    expect(grass).toEqual(grassDefSnapshot);
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
