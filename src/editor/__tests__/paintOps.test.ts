import { describe, it, expect } from 'vitest';
import {
  floodFill,
  rectCells,
  lineCells,
  cellsToChanges,
  findOrAppendPaletteIndex,
} from '../paintOps';
import { createEmptyMap } from '../../systems/mapFormat';

const always = (): boolean => true;

describe('floodFill', () => {
  it('fills a 4-connected region matching the start cell value', () => {
    const width = 4;
    const height = 4;
    // prettier-ignore
    const cells = [
      0, 0, 0, 0,
      0, 1, 1, 0,
      0, 1, 1, 0,
      0, 0, 0, 0,
    ];
    const changes = floodFill(cells, width, height, 1, 1, 5, always);
    const indices = changes.map((c) => c.index).sort((a, b) => a - b);
    expect(indices).toEqual([5, 6, 9, 10]); // the 2x2 block of 1s
    for (const c of changes) expect(c.prev).toBe(1);
  });

  it('does not cross diagonal-only connections (4-connected, not 8)', () => {
    const width = 3;
    const height = 3;
    // prettier-ignore
    const cells = [
      1, 0, 1,
      0, 1, 0,
      1, 0, 1,
    ];
    const changes = floodFill(cells, width, height, 0, 0, 9, always);
    expect(changes).toEqual([{ index: 0, prev: 1 }]); // only the start cell — no orthogonal neighbour matches
  });

  it('is bounded by isInside (never crosses the shape mask)', () => {
    const width = 3;
    const height = 1;
    const cells = [1, 1, 1];
    const isInside = (col: number): boolean => col < 2; // col 2 is "void"
    const changes = floodFill(cells, width, height, 0, 0, 5, isInside);
    const indices = changes.map((c) => c.index).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1]); // col 2 excluded even though its value matches
  });

  it('is a no-op when the start cell is already the target value', () => {
    const cells = [3, 3, 3];
    expect(floodFill(cells, 3, 1, 0, 0, 3, always)).toEqual([]);
  });

  it('is a no-op when the start cell is outside', () => {
    const cells = [1, 1, 1];
    const isInside = (col: number): boolean => col !== 0;
    expect(floodFill(cells, 3, 1, 0, 0, 9, isInside)).toEqual([]);
  });

  it('fills an entire uniform grid when unbounded', () => {
    const cells = [0, 0, 0, 0, 0, 0];
    const changes = floodFill(cells, 3, 2, 1, 0, 7, always);
    expect(changes).toHaveLength(6);
  });
});

describe('rectCells', () => {
  it('normalizes reversed corners into the same rectangle', () => {
    const forward = rectCells(1, 1, 2, 2, always);
    const reversed = rectCells(2, 2, 1, 1, always);
    const norm = (cs: Array<{ col: number; row: number }>) =>
      cs.map((c) => `${c.col},${c.row}`).sort();
    expect(norm(forward)).toEqual(norm(reversed));
    expect(forward).toHaveLength(4);
  });

  it('produces a single cell when both corners are equal', () => {
    expect(rectCells(3, 4, 3, 4, always)).toEqual([{ col: 3, row: 4 }]);
  });

  it('filters cells through isInside (skips void)', () => {
    const isInside = (col: number, row: number): boolean => !(col === 1 && row === 1);
    const cells = rectCells(0, 0, 1, 1, isInside);
    expect(cells).toHaveLength(3);
    expect(cells).not.toContainEqual({ col: 1, row: 1 });
  });
});

describe('lineCells', () => {
  it('walks a horizontal segment', () => {
    expect(lineCells(0, 0, 3, 0)).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 3, row: 0 },
    ]);
  });

  it('walks a vertical segment', () => {
    expect(lineCells(2, 0, 2, 3)).toEqual([
      { col: 2, row: 0 },
      { col: 2, row: 1 },
      { col: 2, row: 2 },
      { col: 2, row: 3 },
    ]);
  });

  it('walks a 45-degree diagonal segment', () => {
    expect(lineCells(0, 0, 3, 3)).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 2 },
      { col: 3, row: 3 },
    ]);
  });

  it('returns a single point for a degenerate (zero-length) segment', () => {
    expect(lineCells(5, 5, 5, 5)).toEqual([{ col: 5, row: 5 }]);
  });

  it('never skips a tile on an arbitrary shallow-slope segment (no gaps)', () => {
    const cells = lineCells(0, 0, 5, 2);
    // Every intermediate column 0..5 must appear at least once — a fast brush drag must not leave gaps.
    const cols = new Set(cells.map((c) => c.col));
    for (let c = 0; c <= 5; c++) expect(cols.has(c)).toBe(true);
    // Hand-computed Bresenham trace for (0,0) -> (5,2):
    expect(cells).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 1 },
      { col: 3, row: 1 },
      { col: 4, row: 2 },
      { col: 5, row: 2 },
    ]);
  });

  it('walks a reversed (right-to-left) segment symmetrically', () => {
    const forward = lineCells(0, 0, 3, 0);
    const backward = lineCells(3, 0, 0, 0);
    expect(backward).toEqual([...forward].reverse());
  });
});

describe('cellsToChanges', () => {
  it('produces one change per distinct cell that actually changes value', () => {
    const cells = [0, 0, 0, 5];
    const points = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 3, row: 0 }, // already 5 — matches newValue, skipped
    ];
    const changes = cellsToChanges(cells, 4, points, 5);
    expect(changes).toEqual([
      { index: 0, prev: 0 },
      { index: 1, prev: 0 },
    ]);
  });

  it('dedupes repeated points (e.g. a line revisiting a cell)', () => {
    const cells = [0, 0];
    const points = [
      { col: 0, row: 0 },
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ];
    expect(cellsToChanges(cells, 2, points, 9)).toEqual([
      { index: 0, prev: 0 },
      { index: 1, prev: 0 },
    ]);
  });

  it('returns an empty array when every point already equals newValue', () => {
    const cells = [4, 4, 4];
    const points = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ];
    expect(cellsToChanges(cells, 3, points, 4)).toEqual([]);
  });
});

describe('findOrAppendPaletteIndex', () => {
  it('appends a new palette entry and returns its index', () => {
    const map = createEmptyMap('x', 'X', 2, 2);
    expect(map.palette).toHaveLength(1); // just the reserved null slot
    const index = findOrAppendPaletteIndex(map, 'pixel-crawler', {
      kind: 'sheetFrame',
      sheet: 'Environment/Tilesets/Floors_Tiles.png',
      frame: 252,
    });
    expect(index).toBe(1);
    expect(map.palette).toHaveLength(2);
    expect(map.palette[1]).toEqual({
      pack: 'pixel-crawler',
      source: { kind: 'sheetFrame', sheet: 'Environment/Tilesets/Floors_Tiles.png', frame: 252 },
    });
  });

  it('returns the SAME index for a repeated call with an identical source, without growing the palette', () => {
    const map = createEmptyMap('x', 'X', 2, 2);
    const first = findOrAppendPaletteIndex(map, 'pixel-crawler', {
      kind: 'sheetFrame',
      sheet: 'Environment/Tilesets/Floors_Tiles.png',
      frame: 252,
    });
    const second = findOrAppendPaletteIndex(map, 'pixel-crawler', {
      kind: 'sheetFrame',
      sheet: 'Environment/Tilesets/Floors_Tiles.png',
      frame: 252,
    });
    expect(second).toBe(first);
    expect(map.palette).toHaveLength(2); // no growth on the repeat
  });

  it('treats a different frame on the same sheet as a distinct entry', () => {
    const map = createEmptyMap('x', 'X', 2, 2);
    const a = findOrAppendPaletteIndex(map, 'pixel-crawler', {
      kind: 'sheetFrame',
      sheet: 'Environment/Tilesets/Floors_Tiles.png',
      frame: 251,
    });
    const b = findOrAppendPaletteIndex(map, 'pixel-crawler', {
      kind: 'sheetFrame',
      sheet: 'Environment/Tilesets/Floors_Tiles.png',
      frame: 253,
    });
    expect(a).not.toBe(b);
    expect(map.palette).toHaveLength(3);
  });

  it('treats image sources as distinct from sheetFrame sources even with an overlapping path', () => {
    const map = createEmptyMap('x', 'X', 2, 2);
    const imageIndex = findOrAppendPaletteIndex(map, 'pixel-crawler', {
      kind: 'image',
      path: '_derived/rock.png',
    });
    const otherImageIndex = findOrAppendPaletteIndex(map, 'pixel-crawler', {
      kind: 'image',
      path: '_derived/bush.png',
    });
    expect(imageIndex).not.toBe(otherImageIndex);
  });

  it('is append-only across a mixed sequence — repeats never renumber earlier entries', () => {
    const map = createEmptyMap('x', 'X', 2, 2);
    const a = findOrAppendPaletteIndex(map, 'p', { kind: 'image', path: 'a.png' });
    const b = findOrAppendPaletteIndex(map, 'p', { kind: 'image', path: 'b.png' });
    const aAgain = findOrAppendPaletteIndex(map, 'p', { kind: 'image', path: 'a.png' });
    expect(aAgain).toBe(a);
    expect(map.palette).toHaveLength(3); // 1 reserved + a + b, never re-appended
    expect(b).toBe(2);
  });

  it('returns the SAME index for repeated calls with the same (pack, source, rotation)', () => {
    const map = createEmptyMap('x', 'X', 2, 2);
    const first = findOrAppendPaletteIndex(
      map,
      'pixel-crawler',
      { kind: 'sheetFrame', sheet: 'Environment/Tilesets/Floors_Tiles.png', frame: 252 },
      90,
    );
    const second = findOrAppendPaletteIndex(
      map,
      'pixel-crawler',
      { kind: 'sheetFrame', sheet: 'Environment/Tilesets/Floors_Tiles.png', frame: 252 },
      90,
    );
    expect(second).toBe(first);
    expect(map.palette).toHaveLength(2); // no growth on the repeat
  });

  it('treats a different rotation on the same source as a distinct entry', () => {
    const map = createEmptyMap('x', 'X', 2, 2);
    const source = {
      kind: 'sheetFrame' as const,
      sheet: 'Environment/Tilesets/Floors_Tiles.png',
      frame: 252,
    };
    const at90 = findOrAppendPaletteIndex(map, 'pixel-crawler', source, 90);
    const at180 = findOrAppendPaletteIndex(map, 'pixel-crawler', source, 180);
    expect(at90).not.toBe(at180);
    expect(map.palette).toHaveLength(3);
  });

  it('treats an omitted rotation and an explicit rotation of 0 as equal', () => {
    const map = createEmptyMap('x', 'X', 2, 2);
    const source = {
      kind: 'sheetFrame' as const,
      sheet: 'Environment/Tilesets/Floors_Tiles.png',
      frame: 252,
    };
    const omitted = findOrAppendPaletteIndex(map, 'pixel-crawler', source);
    const explicitZero = findOrAppendPaletteIndex(map, 'pixel-crawler', source, 0);
    expect(explicitZero).toBe(omitted);
    expect(map.palette).toHaveLength(2); // no growth — omitted and 0 resolve to the same slot
  });
});
