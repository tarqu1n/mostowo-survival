import { describe, it, expect } from 'vitest';
import { makeNoise2D } from '../noise';
import { makeRng } from '../rng';

describe('makeNoise2D', () => {
  it('is deterministic: same seed + same (x, y) gives the same value, repeatedly', () => {
    const noise = makeNoise2D(makeRng(42));
    const points: Array<[number, number]> = [
      [0, 0],
      [1.5, 2.25],
      [-3.1, 7.8],
      [100.25, -50.5],
    ];
    for (const [x, y] of points) {
      const first = noise.sample(x, y);
      const second = noise.sample(x, y);
      const third = noise.sample(x, y);
      expect(second).toBe(first);
      expect(third).toBe(first);
    }
  });

  it('is deterministic across fresh instances with the same seed', () => {
    const a = makeNoise2D(makeRng(7));
    const b = makeNoise2D(makeRng(7));
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        expect(a.sample(x + 0.37, y + 0.61)).toBe(b.sample(x + 0.37, y + 0.61));
      }
    }
  });

  it('produces a different field for a different seed', () => {
    const a = makeNoise2D(makeRng(1));
    const b = makeNoise2D(makeRng(2));
    let differences = 0;
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        if (a.sample(x + 0.5, y + 0.5) !== b.sample(x + 0.5, y + 0.5)) differences++;
      }
    }
    expect(differences).toBeGreaterThan(0);
  });

  it('sample stays within [0, 1] across a grid', () => {
    const noise = makeNoise2D(makeRng(99));
    for (let x = -20; x < 20; x++) {
      for (let y = -20; y < 20; y++) {
        const v = noise.sample(x * 0.3, y * 0.3);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('fbm stays within [0, 1] across a grid', () => {
    const noise = makeNoise2D(makeRng(123));
    for (let x = -20; x < 20; x++) {
      for (let y = -20; y < 20; y++) {
        const v = noise.fbm(x, y, { octaves: 4, scale: 0.1 });
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('has rough spatial continuity: nearby samples are close in value', () => {
    const noise = makeNoise2D(makeRng(5));
    for (let x = -5; x < 5; x += 0.7) {
      for (let y = -5; y < 5; y += 0.7) {
        const base = noise.sample(x, y);
        const nearX = noise.sample(x + 0.01, y);
        const nearY = noise.sample(x, y + 0.01);
        expect(Math.abs(nearX - base)).toBeLessThan(0.05);
        expect(Math.abs(nearY - base)).toBeLessThan(0.05);
      }
    }
  });

  it('fbm also has rough spatial continuity', () => {
    const noise = makeNoise2D(makeRng(11));
    const opts = { octaves: 4, scale: 0.15 };
    for (let x = -5; x < 5; x += 1) {
      for (let y = -5; y < 5; y += 1) {
        const base = noise.fbm(x, y, opts);
        const near = noise.fbm(x + 0.01, y, opts);
        expect(Math.abs(near - base)).toBeLessThan(0.05);
      }
    }
  });

  it('distinguishes real noise from pure per-cell randomness: far-apart samples vary meaningfully', () => {
    const noise = makeNoise2D(makeRng(21));
    const values = new Set<number>();
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        values.add(noise.sample(x * 1.3, y * 1.7));
      }
    }
    // Real spatial variation should produce many distinct values, not a single constant.
    expect(values.size).toBeGreaterThan(50);
  });
});
