import { describe, it, expect } from 'vitest';
import { MANIFEST, WORLD, WORLD_INDEX, originOf, loadMapFile } from '../mapRuntime';

describe('mapRuntime', () => {
  it('eager-parses MANIFEST and WORLD at module load', () => {
    expect(MANIFEST.schemaVersion).toBe(1);
    expect(MANIFEST.maps.some((m) => m.id === 'test')).toBe(true);
    expect(WORLD.schemaVersion).toBe(1);
  });

  it('builds a WORLD_INDEX from the eager manifest (no map files loaded)', () => {
    // Nothing is placed in world.json/manifest.json yet, so no tile resolves to a map.
    expect(WORLD_INDEX.mapAt(0, 0)).toBeNull();
  });

  it("originOf('test') falls back to {col:0,row:0} — the L0 start map is unplaced", () => {
    expect(originOf('test')).toEqual({ col: 0, row: 0 });
  });

  it('originOf returns {col:0,row:0} for an unknown map id too', () => {
    expect(originOf('does-not-exist')).toEqual({ col: 0, row: 0 });
  });

  it("loadMapFile('test') resolves a parsed MapFile matching the manifest entry", async () => {
    const map = await loadMapFile('test');
    expect(map.meta.id).toBe('test');
    expect(map.meta.width).toBe(45);
    expect(map.meta.height).toBe(80);
    const manifestEntry = MANIFEST.maps.find((m) => m.id === 'test');
    expect(manifestEntry).toBeDefined();
    expect(map.meta.width).toBe(manifestEntry?.width);
    expect(map.meta.height).toBe(manifestEntry?.height);
    expect(map.meta.name).toBe(manifestEntry?.name);
  });

  it('loadMapFile rejects an id with no matching map file', async () => {
    await expect(loadMapFile('does-not-exist')).rejects.toThrow(/no map file found/);
  });
});
