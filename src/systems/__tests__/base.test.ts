import { describe, it, expect } from 'vitest';
import { isInBase, baseZoneTileRect, baseZoneFromSpawn } from '../base';

// A fixed test rect (independent of config's BASE_ZONE_SIZE/SPAWN_TILE) so these cases stay stable
// regardless of tuning changes elsewhere.
const testRect = { minCol: 12, maxCol: 32, minRow: 26, maxRow: 52 };

describe('isInBase', () => {
  it('is true at each corner of the inclusive rectangle', () => {
    expect(isInBase(testRect, testRect.minCol, testRect.minRow)).toBe(true);
    expect(isInBase(testRect, testRect.maxCol, testRect.minRow)).toBe(true);
    expect(isInBase(testRect, testRect.minCol, testRect.maxRow)).toBe(true);
    expect(isInBase(testRect, testRect.maxCol, testRect.maxRow)).toBe(true);
  });

  it('is true at the centre', () => {
    const centreCol = Math.floor((testRect.minCol + testRect.maxCol) / 2);
    const centreRow = Math.floor((testRect.minRow + testRect.maxRow) / 2);
    expect(isInBase(testRect, centreCol, centreRow)).toBe(true);
  });

  it('is false just outside each edge', () => {
    const centreRow = Math.floor((testRect.minRow + testRect.maxRow) / 2);
    const centreCol = Math.floor((testRect.minCol + testRect.maxCol) / 2);
    expect(isInBase(testRect, testRect.minCol - 1, centreRow)).toBe(false);
    expect(isInBase(testRect, testRect.maxCol + 1, centreRow)).toBe(false);
    expect(isInBase(testRect, centreCol, testRect.minRow - 1)).toBe(false);
    expect(isInBase(testRect, centreCol, testRect.maxRow + 1)).toBe(false);
  });

  it('is false for a far-away tile', () => {
    expect(isInBase(testRect, 0, 0)).toBe(false);
    expect(isInBase(testRect, 200, 200)).toBe(false);
  });
});

describe('baseZoneTileRect', () => {
  it('returns the given rect, copied', () => {
    const result = baseZoneTileRect(testRect);
    expect(result).toEqual(testRect);
    expect(result).not.toBe(testRect); // a copy, not the same reference
  });
});

describe('baseZoneFromSpawn', () => {
  it('centres a rect of the given size on the spawn tile (odd dimensions)', () => {
    const spawn = { col: 21, row: 33 };
    const size = { w: 21, h: 27 };
    const rect = baseZoneFromSpawn(spawn, size);

    expect(rect).toEqual({ minCol: 11, maxCol: 31, minRow: 20, maxRow: 46 });
    // Spans exactly `size` tiles on each axis.
    expect(rect.maxCol - rect.minCol + 1).toBe(size.w);
    expect(rect.maxRow - rect.minRow + 1).toBe(size.h);
    // For odd sizes, spawn sits exactly on the centre tile.
    const centreCol = Math.floor((rect.minCol + rect.maxCol) / 2);
    const centreRow = Math.floor((rect.minRow + rect.maxRow) / 2);
    expect(centreCol).toBe(spawn.col);
    expect(centreRow).toBe(spawn.row);
  });

  it('gates correctly at the rect edges the resulting rect produces', () => {
    const rect = baseZoneFromSpawn({ col: 21, row: 33 }, { w: 21, h: 27 });
    expect(isInBase(rect, rect.minCol, rect.minRow)).toBe(true);
    expect(isInBase(rect, rect.maxCol, rect.maxRow)).toBe(true);
    expect(isInBase(rect, rect.minCol - 1, rect.minRow)).toBe(false);
    expect(isInBase(rect, rect.maxCol + 1, rect.maxRow)).toBe(false);
    expect(isInBase(rect, rect.minCol, rect.minRow - 1)).toBe(false);
    expect(isInBase(rect, rect.maxCol, rect.maxRow + 1)).toBe(false);
  });
});
