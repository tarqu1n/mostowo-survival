/**
 * Bridson fast Poisson-disk sampling — seeded via the shared `Rng` (src/systems/rng.ts). Produces a
 * blue-noise point set over a rectangular domain with a guaranteed minimum spacing (`radius`), used
 * later to scatter foliage/nodes across a region. Pure, no Phaser, no side effects. Does NOT import
 * `noise.ts`: density-based thinning is supplied by the caller via `accept`, keeping this module
 * write-disjoint from the parallel noise-field work.
 */

import type { Rng } from './rng';

/** A candidate point's acceptance test. `boolean` is a hard keep/reject; a `number` in `[0, 1]` is a
 * keep-probability rolled against the injected `Rng` (e.g. a density field's sample at `x, y`). */
export type PoissonAccept = (x: number, y: number) => boolean | number;

export interface PoissonSampleOptions {
  /** Domain width in tiles; points fall in `[0, width)`. */
  width: number;
  /** Domain height in tiles; points fall in `[0, height)`. */
  height: number;
  /** Minimum allowed distance between any two returned points. */
  radius: number;
  /** Seeded PRNG driving every random choice — same `rng` state + same opts ⇒ same output. */
  rng: Rng;
  /** Optional per-candidate accept/thin test; see `PoissonAccept`. Omit to accept every candidate
   * that satisfies the spacing constraint. */
  accept?: PoissonAccept;
}

export interface PoissonPoint {
  x: number;
  y: number;
}

/** Candidate attempts per active point before it's retired (Bridson's suggested default). */
const DEFAULT_K = 30;

/** Bounded retries for finding an initial point that survives `accept` before giving up empty. */
const MAX_INITIAL_ATTEMPTS = 1000;

/** Resolves a `PoissonAccept` result (bool or probability) against the shared `rng`. */
function passesAccept(accept: PoissonAccept | undefined, x: number, y: number, rng: Rng): boolean {
  if (!accept) return true;
  const result = accept(x, y);
  if (typeof result === 'boolean') return result;
  return rng.nextFloat() < result;
}

/**
 * Bridson fast Poisson-disk sampling: background grid (cell size `radius / sqrt(2)`, so each cell
 * holds at most one accepted point) for O(1) neighbor lookups, an active list, and `k` candidates
 * per active point sampled in the annulus `[radius, 2*radius]` around it.
 */
export function poissonSample(opts: PoissonSampleOptions): PoissonPoint[] {
  const { width, height, radius, rng, accept } = opts;
  const k = DEFAULT_K;

  if (width <= 0 || height <= 0 || radius <= 0) return [];

  const cellSize = radius / Math.sqrt(2);
  const gridWidth = Math.max(1, Math.ceil(width / cellSize));
  const gridHeight = Math.max(1, Math.ceil(height / cellSize));
  const grid: number[] = new Array<number>(gridWidth * gridHeight).fill(-1);

  const points: PoissonPoint[] = [];
  const active: number[] = [];

  const cellOf = (x: number, y: number): { gx: number; gy: number } => ({
    gx: Math.min(gridWidth - 1, Math.floor(x / cellSize)),
    gy: Math.min(gridHeight - 1, Math.floor(y / cellSize)),
  });

  const inBounds = (x: number, y: number): boolean => x >= 0 && x < width && y >= 0 && y < height;

  /** True if `x, y` is at least `radius` away from every already-accepted point, via grid lookup. */
  const isFarEnoughFromExisting = (x: number, y: number): boolean => {
    const { gx, gy } = cellOf(x, y);
    const minGx = Math.max(0, gx - 2);
    const maxGx = Math.min(gridWidth - 1, gx + 2);
    const minGy = Math.max(0, gy - 2);
    const maxGy = Math.min(gridHeight - 1, gy + 2);
    for (let cy = minGy; cy <= maxGy; cy++) {
      for (let cx = minGx; cx <= maxGx; cx++) {
        const idx = grid[cy * gridWidth + cx];
        if (idx === -1) continue;
        const p = points[idx];
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy < radius * radius) return false;
      }
    }
    return true;
  };

  const addPoint = (x: number, y: number): void => {
    const idx = points.length;
    points.push({ x, y });
    active.push(idx);
    const { gx, gy } = cellOf(x, y);
    grid[gy * gridWidth + gx] = idx;
  };

  let initial: PoissonPoint | null = null;
  for (let attempt = 0; attempt < MAX_INITIAL_ATTEMPTS; attempt++) {
    const x = rng.nextFloat() * width;
    const y = rng.nextFloat() * height;
    if (passesAccept(accept, x, y, rng)) {
      initial = { x, y };
      break;
    }
  }
  if (!initial) return [];
  addPoint(initial.x, initial.y);

  while (active.length > 0) {
    const activeIdx = rng.nextInt(active.length);
    const pointIdx = active[activeIdx];
    const origin = points[pointIdx];

    let found = false;
    for (let attempt = 0; attempt < k; attempt++) {
      const r = radius * (1 + rng.nextFloat());
      const theta = 2 * Math.PI * rng.nextFloat();
      const x = origin.x + r * Math.cos(theta);
      const y = origin.y + r * Math.sin(theta);

      if (!inBounds(x, y)) continue;
      if (!isFarEnoughFromExisting(x, y)) continue;
      if (!passesAccept(accept, x, y, rng)) continue;

      addPoint(x, y);
      found = true;
      break;
    }

    if (!found) {
      active.splice(activeIdx, 1);
    }
  }

  return points;
}
