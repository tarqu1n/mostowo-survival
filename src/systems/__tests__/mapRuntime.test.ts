import { describe, it, expect } from 'vitest';
import { MANIFEST, WORLD, WORLD_INDEX, originOf, loadMapFile } from '../mapRuntime';

describe('mapRuntime', () => {
  it('eager-parses MANIFEST and WORLD at module load', () => {
    expect(MANIFEST.schemaVersion).toBe(1);
    expect(MANIFEST.maps.some((m) => m.id === 'the-moon')).toBe(true);
    expect(WORLD.schemaVersion).toBe(1);
  });

  it('builds a WORLD_INDEX from the eager manifest (no map files loaded)', () => {
    // the-moon is placed at {78,230}; tile (0,0) sits outside its footprint, so it resolves to no map.
    expect(WORLD_INDEX.mapAt(0, 0)).toBeNull();
  });

  it("originOf('the-moon') returns its world.json placement", () => {
    // Derive the expectation from the placement rather than hard-coding coordinates: the-moon is
    // authored/repositioned from the World view, and a hard-coded origin would re-break this test —
    // and with it the Pages deploy gate — every time the map is nudged.
    const placement = WORLD.placements.find((p) => p.mapId === 'the-moon');
    expect(placement).toBeDefined();
    expect(originOf('the-moon')).toEqual(placement?.origin);
  });

  it('originOf returns {col:0,row:0} for an unknown map id too', () => {
    expect(originOf('does-not-exist')).toEqual({ col: 0, row: 0 });
  });

  it("loadMapFile('the-moon') resolves a parsed MapFile matching the manifest entry", async () => {
    const map = await loadMapFile('the-moon');
    expect(map.meta.id).toBe('the-moon');
    expect(map.meta.width).toBe(245);
    expect(map.meta.height).toBe(280);
    const manifestEntry = MANIFEST.maps.find((m) => m.id === 'the-moon');
    expect(manifestEntry).toBeDefined();
    expect(map.meta.width).toBe(manifestEntry?.width);
    expect(map.meta.height).toBe(manifestEntry?.height);
    expect(map.meta.name).toBe(manifestEntry?.name);
  });

  it('loadMapFile rejects an id with no matching map file', async () => {
    await expect(loadMapFile('does-not-exist')).rejects.toThrow(/no map file found/);
  });
});
