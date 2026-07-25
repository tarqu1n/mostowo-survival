/**
 * Shared seeded PRNG (mulberry32) — the "one true" deterministic RNG for the codebase. Consolidates
 * the algorithm that used to live as a private `mulberry32` in `monsterAI.test.ts`. Pure — no Phaser,
 * no side effects. `Rng` is a plain `() => number` (via `nextFloat`) so it's directly usable wherever
 * an `rng: () => number` is threaded (e.g. `stepMonster`, `resolveMeleeAttack`), and later steps
 * (`noise.ts`, `poisson.ts`) build on this as the shared seeded-RNG primitive.
 */

/** A seeded PRNG: `nextFloat` is the raw `() => number` shape most call sites expect. */
export interface Rng {
  /** Next float in `[0, 1)`. */
  nextFloat: () => number;
  /** Next integer in `[0, nExcl)`. */
  nextInt: (nExcl: number) => number;
  /** A uniformly random element of `array`. Throws on an empty array. */
  pick: <T>(array: T[]) => T;
}

/**
 * Builds a deterministic mulberry32 generator seeded by `seed`. Same seed ⇒ same `nextFloat()`
 * sequence, forever — this is the exact algorithm the old `monsterAI.test.ts` private `mulberry32`
 * used, byte-for-byte, so existing seeded test expectations keep reproducing.
 */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const nextFloat = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const nextInt = (nExcl: number): number => Math.floor(nextFloat() * nExcl);
  const pick = <T>(array: T[]): T => {
    if (array.length === 0) throw new Error('Rng.pick: array is empty');
    return array[nextInt(array.length)];
  };
  return { nextFloat, nextInt, pick };
}
