/**
 * Campfire fuel math — pure helpers (no Phaser), mirroring systems/needs.ts (hunger). A campfire
 * burns continuously once built: fuel drains every frame, and the fire is "lit" while any fuel
 * remains. Feeding wood tops the tank back up. The actual numbers (max / burn rate / per-wood) live
 * in config.ts (CAMPFIRE_* constants) and are passed in by the caller — these helpers only clamp.
 * See docs/GAME-MECHANICS.md.
 */

/** Fuel remaining after `deltaMs` of burn at `burnPerSec`, clamped at 0 (never negative). */
export function drainFuel(fuel: number, deltaMs: number, burnPerSec: number): number {
  return Math.max(0, fuel - (deltaMs / 1000) * burnPerSec);
}

/** Fuel after feeding one unit of wood worth `perWood`, clamped at `max`. */
export function feedFuel(fuel: number, perWood: number, max: number): number {
  return Math.min(max, fuel + perWood);
}

/** A campfire is lit while it has any fuel left. */
export function isLit(fuel: number): boolean {
  return fuel > 0;
}

/**
 * Discrete flame-intensity level (1..`levels`) for a given fuel — the fire's art is authored as
 * `levels` sheets (embers → roaring), and this buckets fuel onto them so the visible flame steps up
 * as fuel rises. Clamped to [1, levels]: a lit fire (fuel > 0) is always at least level 1, a full tank
 * is `levels`. (`fuel <= 0` also maps to 1, but an unlit fire isn't drawn from a level anyway.)
 */
export function fuelLevel(fuel: number, max: number, levels: number): number {
  return Math.min(levels, Math.max(1, Math.ceil((levels * fuel) / max)));
}

/**
 * Light-radius fraction (`minFrac`..1) for a given fuel — the lit disc lerps with fuel so a dying fire
 * throws less light. Full tank → 1 (full radius); empty → `minFrac`. Clamped to [0,1] on fuel/max.
 */
export function lightFrac(fuel: number, max: number, minFrac: number): number {
  return minFrac + (1 - minFrac) * Math.max(0, Math.min(1, fuel / max));
}
