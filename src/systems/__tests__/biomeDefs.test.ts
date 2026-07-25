import { describe, it, expect } from 'vitest';
import { parseBiomeDefs } from '../biomeDefs';
// Static JSON import (`resolveJsonModule`), not `node:fs` — this repo has no `@types/node` dependency
// and Vite/vitest resolve `.json` imports natively (see `terrainOps.test.ts`'s equivalent note).
import biomesDoc from '../../../public/assets/tilesets/pixel-crawler/biomes.json';

/** A minimal, valid Forest-shaped biome — real `NODES` ids (`tree`/`rock`/`berryBush`) so node-ref
 *  cross-validation exercises the real catalog without a mock. */
function validForest(): unknown {
  return {
    version: 1,
    biomes: [
      {
        id: 'forest',
        name: 'Forest',
        seed: 1,
        terrain: {
          base: 'grass',
          field: { scale: 0.05, octaves: 3 },
          bands: [
            { edgeSetId: 'water', maxHeight: 0.22 },
            { edgeSetId: 'mud', maxHeight: 0.38 },
          ],
        },
        scatter: [
          {
            id: 'foliage',
            kind: 'node',
            spacing: 3,
            density: 0.6,
            members: [
              { ref: 'tree', weight: 3, skin: 'ff_green_1' },
              { ref: 'rock', weight: 1 },
            ],
            avoidTerrains: ['water'],
          },
          {
            id: 'berries',
            kind: 'node',
            spacing: 6,
            density: 0.3,
            members: [{ ref: 'berryBush', weight: 1 }],
            avoidTerrains: ['water'],
            clump: { chance: 0.4, radius: 2, count: [1, 3] },
          },
        ],
      },
    ],
  };
}

describe('parseBiomeDefs', () => {
  it('parses a valid Forest biome', () => {
    const parsed = parseBiomeDefs(validForest());
    expect(Object.keys(parsed)).toEqual(['forest']);
    const forest = parsed.forest;
    expect(forest.name).toBe('Forest');
    expect(forest.terrain.base).toBe('grass');
    expect(forest.terrain.bands).toHaveLength(2);
    expect(forest.terrain.bands[0].edgeSetId).toBe('water');
    expect(forest.scatter).toHaveLength(2);
    expect(forest.scatter[0].members[0]).toEqual({ ref: 'tree', weight: 3, skin: 'ff_green_1' });
  });

  it('defaults an omitted seed to undefined', () => {
    const raw = validForest() as { biomes: Array<Record<string, unknown>> };
    delete raw.biomes[0].seed;
    const parsed = parseBiomeDefs(raw);
    expect(parsed.forest.seed).toBeUndefined();
  });

  it('rejects a non-object root', () => {
    expect(() => parseBiomeDefs(null)).toThrow(/biomeDefs must be an object/);
    expect(() => parseBiomeDefs([])).toThrow(/biomeDefs must be an object/);
  });

  it('rejects an unsupported version', () => {
    const raw = validForest() as { version: number };
    raw.version = 2;
    expect(() => parseBiomeDefs(raw)).toThrow(/biomeDefs\.version 2 is not supported/);
  });

  it('rejects an unknown top-level key', () => {
    const raw = validForest() as Record<string, unknown>;
    raw.extra = true;
    expect(() => parseBiomeDefs(raw)).toThrow(/unknown key "extra"/);
  });

  it('rejects a duplicate biome id', () => {
    const raw = validForest() as { biomes: unknown[] };
    raw.biomes.push(raw.biomes[0]);
    expect(() => parseBiomeDefs(raw)).toThrow(/duplicate biome id "forest"/);
  });

  it('rejects terrain.bands out of ascending order', () => {
    const raw = validForest() as {
      biomes: Array<{ terrain: { bands: Array<{ maxHeight: number }> } }>;
    };
    raw.biomes[0].terrain.bands[1].maxHeight = 0.1;
    expect(() => parseBiomeDefs(raw)).toThrow(/bands must be sorted strictly ascending/);
  });

  it('rejects a maxHeight outside (0,1]', () => {
    const raw = validForest() as {
      biomes: Array<{ terrain: { bands: Array<{ maxHeight: number }> } }>;
    };
    raw.biomes[0].terrain.bands[0].maxHeight = 0;
    expect(() => parseBiomeDefs(raw)).toThrow(/maxHeight must be in \(0,1\]/);
  });

  it('rejects a non-positive scatter weight', () => {
    const raw = validForest() as {
      biomes: Array<{ scatter: Array<{ members: Array<{ weight: number }> }> }>;
    };
    raw.biomes[0].scatter[0].members[0].weight = 0;
    expect(() => parseBiomeDefs(raw)).toThrow(/weight must be > 0/);
  });

  it('rejects an unknown node ref for a node-kind scatter layer', () => {
    const raw = validForest() as {
      biomes: Array<{ scatter: Array<{ members: Array<{ ref: string }> }> }>;
    };
    raw.biomes[0].scatter[0].members[0].ref = 'not-a-real-node';
    expect(() => parseBiomeDefs(raw)).toThrow(/is not a known node id/);
  });

  it('rejects an unknown skin for a known node ref', () => {
    const raw = validForest() as {
      biomes: Array<{ scatter: Array<{ members: Array<{ skin?: string }> }> }>;
    };
    raw.biomes[0].scatter[0].members[0].skin = 'not-a-real-skin';
    expect(() => parseBiomeDefs(raw)).toThrow(/is not a skin of node "tree"/);
  });

  it('rejects a skin on a decor-kind scatter layer', () => {
    const raw = validForest() as { biomes: Array<{ scatter: unknown[] }> };
    raw.biomes[0].scatter.push({
      id: 'ground',
      kind: 'decor',
      spacing: 1,
      density: 0.5,
      members: [{ ref: 'craftpix-nature/Bushes/Fern1_3.png', weight: 1, skin: 'x' }],
    });
    expect(() => parseBiomeDefs(raw)).toThrow(/skin is only valid on a 'node' scatter layer/);
  });

  it('rejects an unknown key anywhere via the strict path message', () => {
    const raw = validForest() as { biomes: Array<Record<string, unknown>> };
    raw.biomes[0].bogus = 1;
    expect(() => parseBiomeDefs(raw)).toThrow(/biomeDefs\.biomes\[0\] has unknown key "bogus"/);
  });

  it('validates decor refs against an injected decorAssetIds context', () => {
    const raw = validForest() as { biomes: Array<{ scatter: unknown[] }> };
    raw.biomes[0].scatter.push({
      id: 'ground',
      kind: 'decor',
      spacing: 1,
      density: 0.5,
      members: [{ ref: 'craftpix-nature/Bushes/Fern1_3.png', weight: 1 }],
    });

    expect(() => parseBiomeDefs(raw, { decorAssetIds: new Set(['some-other-asset.png']) })).toThrow(
      /is not a known asset-catalog id/,
    );

    expect(() =>
      parseBiomeDefs(raw, {
        decorAssetIds: new Set(['craftpix-nature/Bushes/Fern1_3.png']),
      }),
    ).not.toThrow();

    // Omitting the context entirely skips the decor cross-check.
    expect(() => parseBiomeDefs(raw)).not.toThrow();
  });

  it('validates edge-set ids against an injected edgeSetIds context', () => {
    const raw = validForest();
    expect(() => parseBiomeDefs(raw, { edgeSetIds: new Set(['grass']) })).toThrow(
      /is not a known tile-edge-set id/,
    );
    expect(() =>
      parseBiomeDefs(raw, { edgeSetIds: new Set(['grass', 'water', 'mud']) }),
    ).not.toThrow();
  });

  it('parses the real committed public/assets biomes.json catalog', () => {
    const parsed = parseBiomeDefs(biomesDoc, { edgeSetIds: new Set(['grass', 'water', 'mud']) });
    expect(Object.keys(parsed)).toEqual(['forest']);
    expect(parsed.forest.scatter.map((l) => l.id)).toEqual([
      'groundDetail',
      'foliage',
      'nodes',
      'berries',
    ]);
  });
});
