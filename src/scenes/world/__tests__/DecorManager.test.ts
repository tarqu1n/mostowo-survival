import { describe, it, expect } from 'vitest';
import { footprintCells } from '../DecorManager';

describe('footprintCells', () => {
  it('translates a 1x1 footprint at the map origin (no placement offset)', () => {
    expect(footprintCells({ col: 5, row: 8, w: 1, h: 1 }, 0, 0)).toEqual([{ col: 5, row: 8 }]);
  });

  it('enumerates every cell in a w x h footprint, row-major', () => {
    const cells = footprintCells({ col: 2, row: 3, w: 2, h: 3 }, 0, 0);
    expect(cells).toEqual([
      { col: 2, row: 3 },
      { col: 3, row: 3 },
      { col: 2, row: 4 },
      { col: 3, row: 4 },
      { col: 2, row: 5 },
      { col: 3, row: 5 },
    ]);
  });

  it('offsets every cell by the map placement origin (global tile coords)', () => {
    expect(footprintCells({ col: 0, row: 0, w: 1, h: 1 }, 10, 20)).toEqual([{ col: 10, row: 20 }]);
  });
});
