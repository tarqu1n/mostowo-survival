import { describe, it, expect } from 'vitest';
import { createEmptyMap, setCell } from '../mapFormat';
import { mapBlocks } from '../mapWalkability';

describe('mapBlocks', () => {
  it('is false for an inside, walkable cell', () => {
    // createEmptyMap's walkability.cells default to all-0 (walkable), no shape (all-inside).
    const map = createEmptyMap('x', 'X', 3, 3);
    expect(mapBlocks(map, 1, 1)).toBe(false);
  });

  it('is true for an inside, blocked cell', () => {
    const map = createEmptyMap('x', 'X', 3, 3);
    setCell(map.walkability.cells, 1, 1, map.meta.width, 1);
    expect(mapBlocks(map, 1, 1)).toBe(true);
  });

  it('is true out of bounds (negative col/row)', () => {
    const map = createEmptyMap('x', 'X', 3, 3);
    expect(mapBlocks(map, -1, 0)).toBe(true);
    expect(mapBlocks(map, 0, -1)).toBe(true);
  });

  it('is true out of bounds (col/row beyond width/height)', () => {
    const map = createEmptyMap('x', 'X', 3, 3);
    expect(mapBlocks(map, 3, 0)).toBe(true); // width is 3, valid cols are 0..2
    expect(mapBlocks(map, 0, 3)).toBe(true); // height is 3, valid rows are 0..2
  });
});
