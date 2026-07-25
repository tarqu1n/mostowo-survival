import { describe, it, expect } from 'vitest';
import { poissonSample } from '../poisson';
import { makeRng } from '../rng';

function pairwiseMinDistance(points: Array<{ x: number; y: number }>): number {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < min) min = d;
    }
  }
  return min;
}

describe('poissonSample', () => {
  it('respects the minimum spacing radius between all pairs of points', () => {
    const points = poissonSample({ width: 50, height: 50, radius: 3, rng: makeRng(1) });
    expect(points.length).toBeGreaterThan(10);
    expect(pairwiseMinDistance(points)).toBeGreaterThanOrEqual(3 - 1e-9);
  });

  it('is deterministic: same seed + same opts produce an identical output array', () => {
    const a = poissonSample({ width: 40, height: 40, radius: 2, rng: makeRng(99) });
    const b = poissonSample({ width: 40, height: 40, radius: 2, rng: makeRng(99) });
    expect(a).toEqual(b);
  });

  it('produces a different point set for a different seed', () => {
    const a = poissonSample({ width: 40, height: 40, radius: 2, rng: makeRng(1) });
    const b = poissonSample({ width: 40, height: 40, radius: 2, rng: makeRng(2) });
    expect(a).not.toEqual(b);
  });

  it('keeps every point within [0, width) x [0, height)', () => {
    const points = poissonSample({ width: 30, height: 20, radius: 2, rng: makeRng(7) });
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(30);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(20);
    }
  });

  it('a hard-reject accept produces zero points in the rejected region and materially fewer overall', () => {
    const unconstrained = poissonSample({ width: 50, height: 50, radius: 2, rng: makeRng(5) });
    const rightHalfBlocked = poissonSample({
      width: 50,
      height: 50,
      radius: 2,
      rng: makeRng(5),
      accept: (x) => x < 25,
    });

    expect(rightHalfBlocked.every((p) => p.x < 25)).toBe(true);
    expect(rightHalfBlocked.length).toBeLessThan(unconstrained.length);
  });

  it('a probability accept thins the point count relative to an unconstrained run', () => {
    const unconstrained = poissonSample({ width: 60, height: 60, radius: 2, rng: makeRng(11) });
    const halfThinned = poissonSample({
      width: 60,
      height: 60,
      radius: 2,
      rng: makeRng(11),
      accept: () => 0.5,
    });

    expect(halfThinned.length).toBeLessThan(unconstrained.length);
  });

  it('returns an empty array when the domain cannot fit even one point under a rejecting accept', () => {
    const points = poissonSample({
      width: 10,
      height: 10,
      radius: 2,
      rng: makeRng(3),
      accept: () => false,
    });
    expect(points).toEqual([]);
  });
});
