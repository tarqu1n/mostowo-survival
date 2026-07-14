import { describe, it, expect } from 'vitest';
import { stripFrameDims } from '../asset-catalog.mjs';

// Plan 018 step 6.1 — `stripFrameDims` decouples grid geometry (`cols`/`rows`) from the played-frame
// set (`omit`). Legacy mode (no `colsOverride`) must stay byte-identical to the pre-6.1 behaviour;
// geometry mode (`colsOverride` given) is the new path, motivated by
// `Alchemy_Table_01-Sheet.png` (192x704, a 2x11 grid = 22 cells, but only 21 real frames — the
// trailing cell is blank).

describe('stripFrameDims', () => {
  it('legacy: {frames:4} single-row 128x32 -> unchanged pre-6.1 result', () => {
    const warnings = [];
    const result = stripFrameDims(
      128,
      32,
      'legacy-row.png',
      4,
      undefined,
      undefined,
      undefined,
      warnings,
    );
    expect(result).toEqual({ frameWidth: 32, frameHeight: 32, frames: 4, omit: [] });
    expect(warnings.length).toBe(0);
  });

  it('legacy: {frames:4, rows:2} on 64x96 -> unchanged pre-6.1 result', () => {
    const warnings = [];
    const result = stripFrameDims(64, 96, 'legacy-grid.png', 4, 2, undefined, undefined, warnings);
    expect(result).toEqual({ frameWidth: 32, frameHeight: 48, frames: 4, omit: [] });
    expect(warnings.length).toBe(0);
  });

  it('geometry: {cols:2, rows:11} on 192x704 -> 22 cells, no omit', () => {
    const warnings = [];
    const result = stripFrameDims(
      192,
      704,
      'alchemy-table.png',
      undefined,
      11,
      2,
      undefined,
      warnings,
    );
    expect(result).toEqual({ frameWidth: 96, frameHeight: 64, frames: 22, omit: [] });
    expect(warnings.length).toBe(0);
  });

  it('geometry: {cols:2, rows:11, omit:[21]} on 192x704 -> the motivating Alchemy case', () => {
    const warnings = [];
    const result = stripFrameDims(192, 704, 'alchemy-table.png', undefined, 11, 2, [21], warnings);
    expect(result).toEqual({ frameWidth: 96, frameHeight: 64, frames: 22, omit: [21] });
    expect(warnings.length).toBe(0);
  });

  it('geometry: mid-grid omit {cols:2, rows:11, omit:[5]} -> omits an interior cell, not just trailing', () => {
    const warnings = [];
    const result = stripFrameDims(192, 704, 'alchemy-table.png', undefined, 11, 2, [5], warnings);
    expect(result).toEqual({ frameWidth: 96, frameHeight: 64, frames: 22, omit: [5] });
    expect(warnings.length).toBe(0);
  });

  it('geometry: bad grid {cols:5} on 192x704 (non-integer frameWidth) -> warns + 1 unsliced frame fallback', () => {
    const warnings = [];
    const result = stripFrameDims(
      192,
      704,
      'bad-grid.png',
      undefined,
      undefined,
      5,
      undefined,
      warnings,
    );
    expect(result).toEqual({ frameWidth: 192, frameHeight: 704, frames: 1, omit: [] });
    expect(warnings.length).toBe(1);
  });

  it('geometry: omit sanitisation dedupes, drops out-of-range, and sorts ascending', () => {
    const warnings = [];
    const result = stripFrameDims(
      192,
      704,
      'alchemy-table.png',
      undefined,
      11,
      2,
      [21, 21, -1, 99, 3],
      warnings,
    );
    expect(result.omit).toEqual([3, 21]);
    expect(result.frames).toBe(22);
    expect(warnings.length).toBe(0);
  });
});
