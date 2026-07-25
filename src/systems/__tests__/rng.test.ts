import { describe, it, expect } from 'vitest';
import { makeRng } from '../rng';

describe('makeRng', () => {
  it('is deterministic: same seed produces the same nextFloat sequence', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 10 }, () => a.nextFloat());
    const seqB = Array.from({ length: 10 }, () => b.nextFloat());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    const seqA = Array.from({ length: 5 }, () => a.nextFloat());
    const seqB = Array.from({ length: 5 }, () => b.nextFloat());
    expect(seqA).not.toEqual(seqB);
  });

  it('nextFloat stays within [0, 1)', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt stays within [0, nExcl) and is an integer', () => {
    const rng = makeRng(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });

  it('nextInt(1) is always 0', () => {
    const rng = makeRng(9);
    for (let i = 0; i < 20; i++) {
      expect(rng.nextInt(1)).toBe(0);
    }
  });

  it('pick returns an element of the array and is deterministic per seed', () => {
    const items = ['a', 'b', 'c', 'd'];
    const a = makeRng(55);
    const b = makeRng(55);
    for (let i = 0; i < 20; i++) {
      const pickedA = a.pick(items);
      const pickedB = b.pick(items);
      expect(items).toContain(pickedA);
      expect(pickedA).toBe(pickedB);
    }
  });

  it('pick throws on an empty array', () => {
    const rng = makeRng(3);
    expect(() => rng.pick([])).toThrow();
  });

  it('matches the known mulberry32 sequence for seed 1 (regression-pins the algorithm)', () => {
    const rng = makeRng(1);
    const first = rng.nextFloat();
    const second = rng.nextFloat();
    // Pinned by running mulberry32(1) directly — guards against an accidental algorithm swap.
    expect(first).toBeCloseTo(0.6270739405881613, 12);
    expect(second).toBeCloseTo(0.002735721180215478, 12);
  });
});
