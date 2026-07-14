import { describe, it, expect, vi } from 'vitest';
import type { CatalogAsset } from '../catalog';
import {
  applyReclassify,
  assetRelPath,
  reclassifyGrid,
  reclassifyPatch,
  seedCols,
  seedFrames,
  seedOmit,
  seedRows,
  suggestGrids,
} from '../reclassify';
import * as api from '../api';

/** A minimal `CatalogAsset` for the grid math (only `id`/`pack`/`type`/`w`/`h`/`frames`/`frameWidth`/
 *  `frameHeight`/`omit` are read by the helpers under test). */
function asset(over: Partial<CatalogAsset> = {}): CatalogAsset {
  return {
    id: 'pack/Furniture/furnace.png',
    pack: 'pack',
    type: 'object',
    source: { kind: 'image', path: 'Furniture/furnace.png' },
    w: 64,
    h: 64,
    category: 'misc',
    tags: [],
    ...over,
  };
}

describe('suggestGrids', () => {
  it('offers real grids for a square sheet and never 1×1', () => {
    const grids = suggestGrids(64, 64);
    expect(grids.every((g) => !(g.rows === 1 && g.cols === 1))).toBe(true);
    // The tile-aligned 2×2 (32×32 per frame, a whole TILE_SIZE multiple) should be present and sorted
    // ahead of a non-tile-aligned grid.
    expect(grids).toContainEqual({ rows: 2, cols: 2, frames: 4 });
  });

  it('only offers grids that divide the sheet evenly', () => {
    const grids = suggestGrids(48, 16);
    for (const g of grids) {
      expect(48 % g.cols).toBe(0);
      expect(16 % g.rows).toBe(0);
    }
  });
});

describe('reclassifyGrid', () => {
  it('lays a 2×2 sheet out as rows=2/cols=2 (the plan 017 fix, not a single row)', () => {
    const g = reclassifyGrid(asset(), 'strip', 2, 2, []);
    expect(g).toEqual({
      cols: 2,
      frameWidth: 32,
      frameHeight: 32,
      frames: 4,
      played: [0, 1, 2, 3],
      valid: true,
    });
  });

  it('handles a classic single-row strip', () => {
    const g = reclassifyGrid(asset({ w: 96, h: 16 }), 'strip', 6, 1, []);
    expect(g).toEqual({
      cols: 6,
      frameWidth: 16,
      frameHeight: 16,
      frames: 6,
      played: [0, 1, 2, 3, 4, 5],
      valid: true,
    });
  });

  it('flags an invalid grid when a frame dimension does not divide the sheet', () => {
    // 64/3 cols is non-integer.
    expect(reclassifyGrid(asset(), 'strip', 3, 1, []).valid).toBe(false);
  });

  it('has no grid and is always valid for non-strip types', () => {
    expect(reclassifyGrid(asset(), 'object', 2, 2, [])).toEqual({
      cols: undefined,
      frameWidth: undefined,
      frameHeight: undefined,
      frames: undefined,
      played: [],
      valid: true,
    });
  });

  it('a 2×11 strip on a 192×704 sheet resolves the full grid geometry', () => {
    const g = reclassifyGrid(asset({ w: 192, h: 704 }), 'strip', 2, 11, []);
    expect(g.cols).toBe(2);
    expect(g.frames).toBe(22);
    expect(g.frameWidth).toBe(96);
    expect(g.frameHeight).toBe(64);
    expect(g.played).toEqual(Array.from({ length: 22 }, (_, i) => i));
    expect(g.valid).toBe(true);
  });

  it('omitting one cell drops it from the played set but stays valid', () => {
    const g = reclassifyGrid(asset({ w: 192, h: 704 }), 'strip', 2, 11, [21]);
    expect(g.played).toHaveLength(21);
    expect(g.played).not.toContain(21);
    expect(g.valid).toBe(true);
  });

  it('omitting every cell is invalid ("omit everything" is never valid)', () => {
    const allCells = Array.from({ length: 22 }, (_, i) => i);
    const g = reclassifyGrid(asset({ w: 192, h: 704 }), 'strip', 2, 11, allCells);
    expect(g.played).toEqual([]);
    expect(g.valid).toBe(false);
  });

  it('flags a non-integer grid as invalid (cols:5 on a 192px-wide sheet)', () => {
    expect(reclassifyGrid(asset({ w: 192, h: 704 }), 'strip', 5, 11, []).valid).toBe(false);
  });

  it('resolves a furnace 2×2 grid on a 64×96 sheet', () => {
    const g = reclassifyGrid(asset({ w: 64, h: 96 }), 'strip', 2, 2, []);
    expect(g.frameWidth).toBe(32);
    expect(g.frameHeight).toBe(48);
    expect(g.frames).toBe(4);
  });
});

describe('seedFrames / seedRows / seedCols / seedOmit', () => {
  it('seeds frames from a resolved strip, else 2', () => {
    expect(seedFrames(asset({ frames: 6 }))).toBe(6);
    expect(seedFrames(asset({ frames: 1 }))).toBe(2);
    expect(seedFrames(asset())).toBe(2);
  });

  it('recovers rows from the resolved frameHeight (rows = h / frameHeight)', () => {
    expect(seedRows(asset({ h: 64, frameHeight: 32 }))).toBe(2);
    expect(seedRows(asset({ h: 64 }))).toBe(1);
  });

  it('recovers cols from the resolved frameWidth (cols = w / frameWidth), else 2', () => {
    expect(seedCols(asset({ w: 64, frameWidth: 32 }))).toBe(2);
    expect(seedCols(asset({ w: 64 }))).toBe(2);
  });

  it('seeds omit from the asset, else empty', () => {
    expect(seedOmit(asset({ omit: [3, 7] }))).toEqual([3, 7]);
    expect(seedOmit(asset())).toEqual([]);
  });
});

describe('patch + relPath plumbing', () => {
  it('carries cols/rows/omit for a strip and just the type otherwise', () => {
    expect(reclassifyPatch('strip', 2, 11, [21])).toEqual({
      type: 'strip',
      cols: 2,
      rows: 11,
      omit: [21],
    });
    expect(reclassifyPatch('object', 2, 11, [])).toEqual({ type: 'object' });
  });

  it('omits the `omit` key entirely when the list is empty (never `frames`)', () => {
    const patch = reclassifyPatch('strip', 2, 11, []);
    expect(patch).toEqual({ type: 'strip', cols: 2, rows: 11 });
    expect(patch).not.toHaveProperty('omit');
    expect(patch).not.toHaveProperty('frames');
  });

  it('strips the pack prefix to form the pack.json override key', () => {
    expect(assetRelPath(asset())).toBe('Furniture/furnace.png');
  });
});

describe('applyReclassify', () => {
  it('PUTs the strip patch (cols/rows/omit) through putAssetOverride', async () => {
    const spy = vi.spyOn(api, 'putAssetOverride').mockResolvedValue({ warnings: [] });
    await applyReclassify(asset(), 'strip', 2, 11, [21]);
    expect(spy).toHaveBeenCalledWith('pack', 'Furniture/furnace.png', {
      type: 'strip',
      cols: 2,
      rows: 11,
      omit: [21],
    });
    spy.mockRestore();
  });

  it('PUTs just the type for a non-strip reclassify', async () => {
    const spy = vi.spyOn(api, 'putAssetOverride').mockResolvedValue({ warnings: [] });
    await applyReclassify(asset(), 'object', 2, 11, []);
    expect(spy).toHaveBeenCalledWith('pack', 'Furniture/furnace.png', { type: 'object' });
    spy.mockRestore();
  });
});
