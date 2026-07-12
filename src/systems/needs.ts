/**
 * Pure hunger/needs math. No Phaser imports, no module-level mutable state — every value (current
 * level, elapsed time, tuning constants) is passed in as an argument so this stays deterministic and
 * testable. Consumed later by GameScene to drain hunger every frame and route starvation into combat.
 */

/** Clamp `v` to `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Hunger after `deltaMs` of drain at `drainPerSec`, clamped to `[0, max]`. The clamp is a large-delta
 * guard: on tab-refocus Phaser can hand a huge `deltaMs`, and this must never send hunger below 0
 * (nor, defensively, above `max`).
 */
export function drainHunger(
  current: number,
  deltaMs: number,
  drainPerSec: number,
  max: number,
): number {
  return clamp(current - (drainPerSec * deltaMs) / 1000, 0, max);
}

/** Hunger after eating `nutrition` worth of food, capped at `max`. */
export function feed(current: number, nutrition: number, max: number): number {
  return Math.min(max, current + nutrition);
}

/** Whether `hunger` is low enough to trigger starvation damage — true only at/below zero. */
export function isStarving(hunger: number): boolean {
  return hunger <= 0;
}
