/**
 * Seeded 2D value-noise field + fbm (fractal Brownian motion) wrapper. Pure, Phaser-free — later
 * plan steps use this to carve height/moisture-banded terrain patches and modulate scatter density
 * for the Poisson-disk sampler (`poisson.ts`). Seeded via the shared `Rng` (`rng.ts`).
 */

import type { Rng } from './rng';

/** A seeded 2D noise field: `sample(x, y)` is a pure function of its inputs for this instance. */
export interface Noise2D {
  /** Value noise at `(x, y)`, in `[0, 1]`. Adjacent samples vary smoothly (continuous, not per-cell). */
  sample: (x: number, y: number) => number;
  /**
   * Fractal Brownian motion: sums `octaves` layers of `sample` at doubling frequency (`scale`
   * multiplies the input coordinates for octave 0) and halving amplitude, normalized to `[0, 1]`.
   */
  fbm: (x: number, y: number, opts: { octaves: number; scale: number }) => number;
}

const LATTICE_SIZE = 256;
const LATTICE_MASK = LATTICE_SIZE - 1;

/** Smoothstep-style fade curve (Perlin's `6t^5 - 15t^4 + 10t^3`) — smooth first/second derivatives. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Builds a deterministic 2D value-noise field seeded by `rng`. A fixed-size lattice of random
 * values is drawn from `rng` once at construction (never consumed per-sample), then `sample`
 * hashes integer lattice coordinates into that table and bilinearly interpolates the four
 * surrounding corners with a smoothstep fade — giving continuous, repeatable noise.
 */
export function makeNoise2D(rng: Rng): Noise2D {
  const lattice = new Float64Array(LATTICE_SIZE * LATTICE_SIZE);
  for (let i = 0; i < lattice.length; i++) {
    lattice[i] = rng.nextFloat();
  }

  const valueAt = (ix: number, iy: number): number => {
    const xi = ix & LATTICE_MASK;
    const yi = iy & LATTICE_MASK;
    return lattice[yi * LATTICE_SIZE + xi];
  };

  const sample = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = fade(x - x0);
    const ty = fade(y - y0);

    const v00 = valueAt(x0, y0);
    const v10 = valueAt(x0 + 1, y0);
    const v01 = valueAt(x0, y0 + 1);
    const v11 = valueAt(x0 + 1, y0 + 1);

    const top = lerp(v00, v10, tx);
    const bottom = lerp(v01, v11, tx);
    return lerp(top, bottom, ty);
  };

  const fbm = (x: number, y: number, opts: { octaves: number; scale: number }): number => {
    const { octaves, scale } = opts;
    let amplitude = 1;
    let frequency = scale;
    let sum = 0;
    let maxAmplitude = 0;
    for (let o = 0; o < octaves; o++) {
      sum += sample(x * frequency, y * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return maxAmplitude > 0 ? sum / maxAmplitude : 0;
  };

  return { sample, fbm };
}
