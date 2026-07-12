import { describe, it, expect } from 'vitest';
import { hurtboxContains, hurtboxTiles, DEFAULT_HURTBOX } from '../hurtbox';
import type { Cell } from '../pathfind';

const at = (col: number, row: number): Cell => ({ col, row });

describe('hurtboxContains', () => {
  const feet = at(10, 10);

  it('a 1x1 box covers only the feet tile', () => {
    expect(hurtboxContains(feet, DEFAULT_HURTBOX, at(10, 10))).toBe(true);
    expect(hurtboxContains(feet, DEFAULT_HURTBOX, at(10, 9))).toBe(false); // one up
    expect(hurtboxContains(feet, DEFAULT_HURTBOX, at(11, 10))).toBe(false); // one right
  });

  it('a 1x2 box adds the tile directly above (the drawn torso), not below', () => {
    const box = { width: 1, height: 2 };
    expect(hurtboxContains(feet, box, at(10, 10))).toBe(true); // feet
    expect(hurtboxContains(feet, box, at(10, 9))).toBe(true); // torso (up)
    expect(hurtboxContains(feet, box, at(10, 8))).toBe(false); // two up — beyond height
    expect(hurtboxContains(feet, box, at(10, 11))).toBe(false); // below feet — never
    expect(hurtboxContains(feet, box, at(11, 9))).toBe(false); // torso but off-column
  });

  it('an odd width is centred on the feet column', () => {
    const box = { width: 3, height: 1 };
    expect(hurtboxContains(feet, box, at(9, 10))).toBe(true);
    expect(hurtboxContains(feet, box, at(10, 10))).toBe(true);
    expect(hurtboxContains(feet, box, at(11, 10))).toBe(true);
    expect(hurtboxContains(feet, box, at(12, 10))).toBe(false);
    expect(hurtboxContains(feet, box, at(8, 10))).toBe(false);
  });

  it('an even width extends one further right of centre', () => {
    const box = { width: 2, height: 1 };
    expect(hurtboxContains(feet, box, at(10, 10))).toBe(true); // feet column
    expect(hurtboxContains(feet, box, at(11, 10))).toBe(true); // extends right
    expect(hurtboxContains(feet, box, at(9, 10))).toBe(false); // not left
  });

  it('a large 2x3 box covers footprint plus body upward', () => {
    const box = { width: 2, height: 3 };
    const covered = hurtboxTiles(feet, box);
    for (const t of covered) expect(hurtboxContains(feet, box, t)).toBe(true);
    expect(hurtboxContains(feet, box, at(10, 7))).toBe(false); // three up — beyond height
  });
});

describe('hurtboxTiles', () => {
  it('enumerates exactly width*height tiles rising up from the feet', () => {
    const tiles = hurtboxTiles(at(5, 5), { width: 1, height: 2 });
    expect(tiles).toHaveLength(2);
    expect(tiles).toContainEqual(at(5, 5));
    expect(tiles).toContainEqual(at(5, 4));
  });

  it('DEFAULT_HURTBOX enumerates just the feet tile', () => {
    expect(hurtboxTiles(at(3, 7), DEFAULT_HURTBOX)).toEqual([at(3, 7)]);
  });

  it('every enumerated tile is contained, and count matches width*height', () => {
    const box = { width: 3, height: 2 };
    const tiles = hurtboxTiles(at(0, 0), box);
    expect(tiles).toHaveLength(box.width * box.height);
    for (const t of tiles) expect(hurtboxContains(at(0, 0), box, t)).toBe(true);
  });
});
