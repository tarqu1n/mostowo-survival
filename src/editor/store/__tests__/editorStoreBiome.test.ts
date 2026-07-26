import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../editorStore';
import { parseMap, serializeMap } from '../../../systems/mapFormat';
import { generateBiome, type BiomeResult } from '../../../systems/biomeGen';
import { parseBiomeDefs } from '../../../systems/biomeDefs';
import { parseEdgeSet, type EdgeSet } from '../../../systems/edgeSets';
// Static JSON imports — mirrors terrain.test.ts / index.test.ts's committed-file posture.
import biomesDoc from '../../../../public/assets/tilesets/pixel-crawler/biomes.json';
import grassDoc from '../../../../public/assets/tilesets/pixel-crawler/edge-sets/grass.json';
import mudDoc from '../../../../public/assets/tilesets/pixel-crawler/edge-sets/mud.json';
import waterDoc from '../../../../public/assets/tilesets/pixel-crawler/edge-sets/water.json';

const grass = parseEdgeSet(grassDoc, 'grass');
const mud = parseEdgeSet(mudDoc, 'mud');
const water = parseEdgeSet(waterDoc, 'water');
const edgeSets: Record<string, EdgeSet> = { grass, mud, water };
const forest = parseBiomeDefs(biomesDoc).forest;

/** Fresh map for each test — mirrors `editorStoreTerrain.test.ts`'s `reset` helper (the store is a
 *  module-level singleton shared across tests). */
function reset(width = 32, height = 32): void {
  useEditorStore.getState().newMap('scratch', 'Scratch', width, height);
}

describe('editorStore: applyBiomeResult (plan 052 step 10)', () => {
  beforeEach(() => reset());

  it('returns false when no map is open', () => {
    useEditorStore.getState().closeMap();
    const result = generateBiome({
      region: { cols: 8, rows: 8 },
      biome: forest,
      seed: 1,
      edgeSets,
    });
    expect(useEditorStore.getState().applyBiomeResult(result, { col: 0, row: 0 }, edgeSets)).toBe(
      false,
    );
  });

  it('bakes a real Forest generation into the map as one undoable batch that round-trips through parseMap', () => {
    const region = { cols: 32, rows: 32 };
    const result = generateBiome({ region, biome: forest, seed: 6, edgeSets });
    const ok = useEditorStore.getState().applyBiomeResult(result, { col: 0, row: 0 }, edgeSets);
    expect(ok).toBe(true);

    const map = useEditorStore.getState().map!;
    // Overlay role (grass) always has content for the Forest preset -> a new layer above ground.
    expect(map.layers.length).toBe(2);
    expect(map.layers[1].name).toBe('Biome Overlay');
    expect(map.objects.length).toBe(result.objects.length);
    expect(map.objects.length).toBeGreaterThan(0);
    // Palette grew to cover the baked frames/images.
    expect(map.palette.length).toBeGreaterThan(1);

    // Passes parseMap: void-consistency, palette validity, no object on void.
    const reparsed = parseMap(JSON.parse(serializeMap(map)));
    expect(reparsed.objects.length).toBe(map.objects.length);

    expect(useEditorStore.getState().canUndo).toBe(true);
    useEditorStore.getState().undo();
    const reverted = useEditorStore.getState().map!;
    expect(reverted.layers.length).toBe(1);
    expect(reverted.objects.length).toBe(0);
    expect(useEditorStore.getState().canUndo).toBe(false);
  });

  it('translates region-local coordinates by `origin` into absolute map coordinates', () => {
    const region = { cols: 10, rows: 10 };
    const result = generateBiome({ region, biome: forest, seed: 3, edgeSets });
    const origin = { col: 15, row: 15 };
    useEditorStore.getState().applyBiomeResult(result, origin, edgeSets);
    const map = useEditorStore.getState().map!;

    for (const obj of map.objects) {
      if (obj.kind === 'node') {
        expect(obj.col).toBeGreaterThanOrEqual(origin.col);
        expect(obj.col).toBeLessThan(origin.col + region.cols + 1);
        expect(obj.row).toBeGreaterThanOrEqual(origin.row);
      } else if (obj.kind === 'decor') {
        expect(obj.x).toBeGreaterThanOrEqual(origin.col * 16);
        expect(obj.y).toBeGreaterThanOrEqual(origin.row * 16);
      }
    }
  });

  it('skips creating an overlay layer when the result has no overlay-role cells', () => {
    const synthetic: BiomeResult = {
      tileEdits: [{ layerRole: 'base', cells: [] }],
      objects: [],
      meta: { seed: 1, counts: {} },
    };
    useEditorStore.getState().applyBiomeResult(synthetic, { col: 0, row: 0 }, edgeSets);
    const map = useEditorStore.getState().map!;
    expect(map.layers.length).toBe(1);
  });

  it('drops (does not crash on) an object placement that lands on a void cell', () => {
    const map = useEditorStore.getState().map!;
    const cells = new Array(32 * 32).fill(1) as number[];
    cells[0] = 0; // (0,0) void
    map.shape = { cells };

    const synthetic: BiomeResult = {
      tileEdits: [{ layerRole: 'overlay', cells: [] }],
      objects: [
        { kind: 'node', layerId: 'nodes', ref: 'tree', col: 0, row: 0 },
        { kind: 'node', layerId: 'nodes', ref: 'tree', col: 1, row: 1 },
      ],
      meta: { seed: 1, counts: { nodes: 2 } },
    };
    const ok = useEditorStore.getState().applyBiomeResult(synthetic, { col: 0, row: 0 }, edgeSets);
    expect(ok).toBe(true);

    const after = useEditorStore.getState().map!;
    expect(after.objects.length).toBe(1);
    expect(after.objects[0]).toMatchObject({ col: 1, row: 1 });
  });

  it('bakes base-role cells onto the current active layer, not a new one', () => {
    // Top row (row 0) painted mud (a 'base'-role band) — the rest of the region is left untouched.
    const synthetic: BiomeResult = {
      tileEdits: [
        {
          layerRole: 'base',
          cells: Array.from({ length: 6 }, (_, col) => ({
            col,
            row: 0,
            rotation: 0 as const,
            edgeSetId: 'mud',
            frame: mud.method === 'blob' ? mud.surfaces[0].base : 0,
          })),
        },
      ],
      objects: [],
      meta: { seed: 1, counts: {} },
    };
    useEditorStore.getState().applyBiomeResult(synthetic, { col: 0, row: 0 }, edgeSets);
    const map = useEditorStore.getState().map!;
    expect(map.layers.length).toBe(1); // no overlay content -> no new layer
    expect(map.layers[0].id).toBe('ground');
    expect(map.layers[0].cells.slice(0, 6).every((v) => v !== 0)).toBe(true);
  });
});
