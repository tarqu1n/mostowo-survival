import { describe, it, expect } from 'vitest';
import { sanitiseOverridePatch } from '../vite-editor-api.mjs';

// Plan 018 step 6.2 — `sanitiseOverridePatch` gains `cols`/`omit` (strip geometry mode) alongside
// the legacy `frames`/`rows` fields. `cols` is validated as an integer >= 1; `omit` is only
// meaningful (and only accepted) alongside `cols`, as an array of ints >= 0; when both `cols` and
// `omit` are present, a cross-field guard rejects any out-of-range index and rejects "omit
// everything" (played count must stay >= 1). rows defaults to 1 in that guard, matching the
// catalog builder (`asset-catalog.mjs`'s `stripFrameDims`, plan 018 step 6.1).

describe('sanitiseOverridePatch', () => {
  it('legacy: {type:"strip", frames:4} -> unchanged, accepted', () => {
    expect(sanitiseOverridePatch({ type: 'strip', frames: 4 })).toEqual({
      type: 'strip',
      frames: 4,
    });
  });

  it('legacy: {type:"strip", frames:4, rows:2} -> accepted', () => {
    expect(sanitiseOverridePatch({ type: 'strip', frames: 4, rows: 2 })).toEqual({
      type: 'strip',
      frames: 4,
      rows: 2,
    });
  });

  it('geometry: {type:"strip", cols:2, rows:11} -> accepted, cols/rows pass through', () => {
    const out = sanitiseOverridePatch({ type: 'strip', cols: 2, rows: 11 });
    expect(out).toEqual({ type: 'strip', cols: 2, rows: 11 });
    expect(out.cols).toBe(2);
    expect(out.rows).toBe(11);
  });

  it('geometry: {type:"strip", cols:2, rows:11, omit:[21]} -> accepted, omit deep-equals [21]', () => {
    const out = sanitiseOverridePatch({ type: 'strip', cols: 2, rows: 11, omit: [21] });
    expect(out).toEqual({ type: 'strip', cols: 2, rows: 11, omit: [21] });
    expect(out.omit).toEqual([21]);
  });

  it('rejects cols:0', () => {
    expect(sanitiseOverridePatch({ cols: 0 })).toBeNull();
  });

  it('rejects cols:1.5 (non-integer)', () => {
    expect(sanitiseOverridePatch({ cols: 1.5 })).toBeNull();
  });

  it('rejects cols:"2" (string, not a number)', () => {
    expect(sanitiseOverridePatch({ cols: '2' })).toBeNull();
  });

  it('rejects omit without cols', () => {
    expect(sanitiseOverridePatch({ omit: [21] })).toBeNull();
  });

  it('rejects omit:[-1] (negative index)', () => {
    expect(sanitiseOverridePatch({ cols: 2, omit: [-1] })).toBeNull();
  });

  it('rejects omit:[1.5] (non-integer index)', () => {
    expect(sanitiseOverridePatch({ cols: 2, omit: [1.5] })).toBeNull();
  });

  it('rejects omit:["x"] (non-numeric entry)', () => {
    expect(sanitiseOverridePatch({ cols: 2, omit: ['x'] })).toBeNull();
  });

  it('rejects omit index out of range: {cols:2, rows:2, omit:[4]} (cells=4, index 4 not < 4)', () => {
    expect(sanitiseOverridePatch({ cols: 2, rows: 2, omit: [4] })).toBeNull();
  });

  it('rejects omit-everything: {cols:2, rows:2, omit:[0,1,2,3]} (played count 0)', () => {
    expect(sanitiseOverridePatch({ cols: 2, rows: 2, omit: [0, 1, 2, 3] })).toBeNull();
  });

  it('accepts {cols:2, rows:2, omit:[0,1,2]} (played count 1)', () => {
    const out = sanitiseOverridePatch({ cols: 2, rows: 2, omit: [0, 1, 2] });
    expect(out).toEqual({ cols: 2, rows: 2, omit: [0, 1, 2] });
  });

  it('rows-defaulting: {cols:2, omit:[2]} -> cells=2*1=2, index 2 not < 2 -> rejected', () => {
    expect(sanitiseOverridePatch({ cols: 2, omit: [2] })).toBeNull();
  });

  it('rows-defaulting: {cols:2, omit:[1]} -> cells=2*1=2, index 1 < 2, played count 1 -> accepted', () => {
    const out = sanitiseOverridePatch({ cols: 2, omit: [1] });
    expect(out).toEqual({ cols: 2, omit: [1] });
  });

  it('rejects non-object / null / array / empty-result patches (existing behaviour, unchanged)', () => {
    expect(sanitiseOverridePatch(null)).toBeNull();
    expect(sanitiseOverridePatch([])).toBeNull();
    expect(sanitiseOverridePatch({})).toBeNull();
    expect(sanitiseOverridePatch('nope')).toBeNull();
  });

  it('rejects an invalid type', () => {
    expect(sanitiseOverridePatch({ type: 'bogus' })).toBeNull();
  });
});
