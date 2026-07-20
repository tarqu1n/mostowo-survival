/**
 * Pure night-wave pacing + escalation math (plan 038 Steps 3/5) — no Phaser, no scene deps, no mutable
 * module state. `WaveDirector` owns the *effects* (spawning, timers, phase edges); this owns the
 * *numbers*: which spawn interval a point in the night falls on, how each survived night ramps the
 * assault, and which enemy a given spawn is. Kept pure so the curves are unit-testable in isolation.
 *
 * The base pacing beats + spawn geometry live in `config.ts` (data); the escalation SHAPE lives here as
 * the marked TUNABLE constants below — placeholders from plan 038 Step 5, refined by feel in playtest.
 */

/** One beat of the pacing curve: this interval applies until night progress reaches `untilNorm`. */
export interface WaveBeat {
  untilNorm: number;
  intervalMs: number;
}

/**
 * Spawn interval (ms) for a normalized night progress `norm` ∈ [0,1] (0 = dusk, 1 = dawn), read off the
 * ascending trickle→push→lull `beats` and scaled by `intervalScale` (<1 = denser, later nights). Falls
 * back to the last beat past the final threshold. Pure.
 */
export function intervalForNightProgress(
  norm: number,
  beats: readonly WaveBeat[],
  intervalScale = 1,
): number {
  const n = Math.max(0, Math.min(1, norm));
  for (const b of beats) if (n < b.untilNorm) return b.intervalMs * intervalScale;
  return beats[beats.length - 1].intervalMs * intervalScale;
}

/** The tuned shape of a single night's assault (plan 038 Step 5). */
export interface NightEscalation {
  /** Mobs spawned immediately when the wave begins — a bigger opening rush on later nights. */
  openingBurst: number;
  /** Multiplier on the pacing intervals (<1 = denser spawns). */
  intervalScale: number;
  /** Spawn a boar instead of a skeleton every Nth spawn (0 = never — skeletons only). */
  boarEvery: number;
}

// --- TUNABLE (plan 038 Step 5) — the per-night ramp; placeholders refined by feel in playtest. -----
const OPENING_BURST_MAX = 5; // cap the opening rush so a deep run doesn't wall you at the treeline
const INTERVAL_SCALE_PER_NIGHT = 0.12; // each night this much denser…
const INTERVAL_SCALE_FLOOR = 0.5; // …down to this floor (never faster than 2× night 1)
const BOARS_FROM_NIGHT = 2; // boars first appear on night 2
const BOAR_EVERY_START = 5; // …every 5th spawn then, tightening…
const BOAR_EVERY_MIN = 3; // …to at most every 3rd

/**
 * The wave shape for the night of in-game `dayCount` (1 = the first night). Each survived night ramps:
 * a larger opening burst, denser pacing, and — from night {@link BOARS_FROM_NIGHT} — the occasional
 * boar mixed in. Data-driven + clamped so a long run can't runaway into an unwinnable wall. Pure.
 */
export function escalationForNight(dayCount: number): NightEscalation {
  const n = Math.max(1, Math.floor(dayCount));
  return {
    openingBurst: Math.min(OPENING_BURST_MAX, n), // 1,2,3,4,5,5,…
    intervalScale: Math.max(INTERVAL_SCALE_FLOOR, 1 - (n - 1) * INTERVAL_SCALE_PER_NIGHT),
    boarEvery:
      n < BOARS_FROM_NIGHT
        ? 0
        : Math.max(BOAR_EVERY_MIN, BOAR_EVERY_START - (n - BOARS_FROM_NIGHT)),
  };
}

/**
 * Which enemy id the `index`-th spawn of a wave is (0-based): a boar on every `boarEvery`-th spawn,
 * else the skeleton. `boarEvery === 0` ⇒ always the skeleton. Pure.
 */
export function spawnKindForIndex(index: number, boarEvery: number): 'kidZombie' | 'boar' {
  if (boarEvery > 0 && (index + 1) % boarEvery === 0) return 'boar';
  return 'kidZombie';
}
