import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditorStore } from '../editorStore';
import { parseMap, serializeMap } from '../../../systems/mapFormat';
import type { TerrainCatalog } from '../../terrainCatalog';

/**
 * Integration coverage for the terrain brush (plan 014 step 10) through the real store pipeline —
 * `terrainOps.test.ts` proves the pure bake math matches the Python reference; this file proves the
 * STORE wiring around it: arming, mask+bake as one undoable command, erase, the pre-save full rebake,
 * and a save/reopen round-trip through `serializeMap`/`parseMap`.
 *
 * A small synthetic `TerrainCatalog` (not the real generated grass mapping) keeps each case focused on
 * ONE blob key at a time — `key 0` (an isolated painted cell, no neighbours) and `key 255`/`FULL_KEY`
 * (fully surrounded) are exact-match entries, so there's no dependency on the fallback tiers already
 * covered by `src/systems/__tests__/autotile.test.ts`.
 */
const TEST_CATALOG: TerrainCatalog = {
  terrains: [
    {
      id: 'grass',
      name: 'Grass',
      pack: 'pixel-crawler',
      sheet: 'Environment/Tilesets/Floors_Tiles.png',
      fillFrame: 999,
      mapping: { 0: 10, 255: 999 },
    },
  ],
};

function reset(width = 6, height = 6): void {
  useEditorStore.getState().newMap('scratch', 'Scratch', width, height);
  useEditorStore.getState().setTerrainCatalog(TEST_CATALOG);
  useEditorStore.getState().setActiveTerrainId('grass');
}

describe('editorStore: terrain brush (step 10)', () => {
  beforeEach(() => reset());

  it('warns and no-ops when painting with no terrain armed', () => {
    useEditorStore.getState().setActiveTerrainId(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useEditorStore.getState().paintTerrainLine(1, 1, 1, 1, 's', true);
    const map = useEditorStore.getState().map!;
    expect(map.terrain).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('painting an isolated cell writes the mask AND bakes the layer cell, as one undoable command', () => {
    useEditorStore.getState().paintTerrainLine(2, 2, 2, 2, 's', true);
    const map = useEditorStore.getState().map!;
    const layer = map.layers[0];
    const index = 2 * 6 + 2;

    expect(map.terrain).toHaveLength(1);
    expect(map.terrain[0].layerId).toBe(layer.id);
    expect(map.terrain[0].terrainId).toBe('grass');
    expect(map.terrain[0].cells[index]).toBe(1);

    // blobKey 0 (isolated cell, no neighbours) -> mapping[0] = frame 10 -> a freshly find-or-appended
    // palette entry (index 1, since 0 is reserved for empty).
    expect(layer.cells[index]).toBe(1);
    expect(map.palette[1]).toEqual({
      pack: 'pixel-crawler',
      source: { kind: 'sheetFrame', sheet: 'Environment/Tilesets/Floors_Tiles.png', frame: 10 },
    });

    // ONE undo reverts BOTH the mask and the baked cell — this was the section's first-ever paint, so
    // undo removes it entirely (see the dedicated "removed by undo" case below), not just zeroes it.
    useEditorStore.getState().undo();
    expect(map.terrain).toHaveLength(0);
    expect(layer.cells[index]).toBe(0);
    expect(useEditorStore.getState().canUndo).toBe(false);
  });

  it('a fresh terrain section is created lazily and removed by undo if this was the first paint', () => {
    useEditorStore.getState().paintTerrainLine(0, 0, 0, 0, 's', true);
    const map = useEditorStore.getState().map!;
    expect(map.terrain).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(map.terrain).toHaveLength(0); // the section didn't exist before this command — undo removes it
  });

  it('painting a fully-surrounded block resolves each interior cell via blobKey (FULL_KEY -> mapping[255])', () => {
    // Paint a 3x3 block — every interior neighbour is filled, so the CENTRE cell's blobKey is FULL (255).
    useEditorStore.getState().paintTerrainRect(1, 1, 3, 3, true);
    const map = useEditorStore.getState().map!;
    const centreIndex = 2 * 6 + 2;
    // mapping[255] = 999 -> a second distinct palette entry.
    const centrePaletteIndex = map.layers[0].cells[centreIndex];
    expect(centrePaletteIndex).toBeGreaterThan(0);
    const entry = map.palette[centrePaletteIndex]!;
    expect(entry.source).toEqual({
      kind: 'sheetFrame',
      sheet: 'Environment/Tilesets/Floors_Tiles.png',
      frame: 999,
    });
  });

  it('erasing clears the mask AND rebakes (clears) the layer cell, undoably', () => {
    useEditorStore.getState().paintTerrainLine(4, 4, 4, 4, 'paint', true);
    const map = useEditorStore.getState().map!;
    const index = 4 * 6 + 4;
    expect(map.layers[0].cells[index]).toBeGreaterThan(0);

    useEditorStore.getState().paintTerrainLine(4, 4, 4, 4, 'erase', false);
    expect(map.terrain[0].cells[index]).toBe(0);
    expect(map.layers[0].cells[index]).toBe(0); // rebaked back to empty, not left stale

    useEditorStore.getState().undo(); // undoes the erase
    expect(map.terrain[0].cells[index]).toBe(1);
    expect(map.layers[0].cells[index]).toBeGreaterThan(0);
  });

  it('skips void cells (respects the shape mask, like every other paint tool)', () => {
    const map = useEditorStore.getState().map!;
    const cells = new Array(36).fill(1) as number[];
    cells[0] = 0; // (0,0) void
    map.shape = { cells };
    useEditorStore.getState().paintTerrainLine(0, 0, 1, 0, 's', true);
    expect(map.layers[0].cells[0]).toBe(0); // untouched — void
    expect(map.terrain.length === 0 || map.terrain[0].cells[0] === 0).toBe(true);
  });

  it('coalesces same-strokeId segments into one undo entry', () => {
    useEditorStore.getState().paintTerrainLine(0, 0, 1, 0, 'drag-1', true);
    useEditorStore.getState().paintTerrainLine(1, 0, 3, 0, 'drag-1', true);
    const map = useEditorStore.getState().map!;
    expect(map.terrain[0].cells.slice(0, 4)).toEqual([1, 1, 1, 1]);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().map!.terrain).toHaveLength(0);
    expect(useEditorStore.getState().canUndo).toBe(false);
  });

  it('fillTerrainFrom floods a bounded area', () => {
    useEditorStore.getState().fillTerrainFrom(0, 0, true);
    const map = useEditorStore.getState().map!;
    expect(map.terrain[0].cells.every((v) => v === 1)).toBe(true);
    expect(map.layers[0].cells.every((v) => v > 0)).toBe(true);
  });

  it('rebakeTerrainsForSave is idempotent and a no-drift save changes nothing', () => {
    useEditorStore.getState().paintTerrainRect(0, 0, 2, 2, true);
    const map = useEditorStore.getState().map!;
    const before = map.layers[0].cells.slice();

    const changedFirst = useEditorStore.getState().rebakeTerrainsForSave();
    expect(changedFirst).toBe(false); // already consistent from incremental painting
    expect(map.layers[0].cells).toEqual(before);

    // Simulate drift: hand-corrupt a baked cell, then rebake should restore it.
    map.layers[0].cells[0] = 12345;
    const changedSecond = useEditorStore.getState().rebakeTerrainsForSave();
    expect(changedSecond).toBe(true);
    expect(map.layers[0].cells[0]).toBe(before[0]);
  });

  it('a saved-then-reopened map preserves the terrain section and its baked cells', () => {
    useEditorStore.getState().paintTerrainRect(0, 0, 2, 2, true);
    const map = useEditorStore.getState().map!;
    useEditorStore.getState().rebakeTerrainsForSave();

    const json = serializeMap(map);
    const reopened = parseMap(JSON.parse(json)); // throws on any invariant violation

    expect(reopened.terrain).toHaveLength(1);
    expect(reopened.terrain[0].cells.slice(0, 3)).toEqual([1, 1, 1]);
    // Baked cells are canonical and present in the reopened file, independent of the mask.
    expect(reopened.layers[0].cells.slice(0, 3).every((v) => v > 0)).toBe(true);

    // A fresh session (loadMap) can keep painting the SAME terrain section seamlessly.
    useEditorStore.getState().loadMap(reopened, 'scratch');
    useEditorStore.getState().setTerrainCatalog(TEST_CATALOG);
    useEditorStore.getState().setActiveTerrainId('grass');
    useEditorStore.getState().paintTerrainLine(5, 5, 5, 5, 'more', true);
    const map2 = useEditorStore.getState().map!;
    expect(map2.terrain).toHaveLength(1); // still ONE section for (layer, terrain) — reused, not duplicated
    expect(map2.terrain[0].cells[5 * 6 + 5]).toBe(1);
  });
});
