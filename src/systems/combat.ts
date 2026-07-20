/**
 * Combat resolution: pure functions, no Phaser imports. Both the player's attack and an enemy's contact
 * attack go through `resolveMeleeAttack` rather than each hand-rolling damage math.
 */

import type { CombatantStats, ObjectStats } from '../data/types';

export function meleeDamage(attacker: CombatantStats, weaponBaseDamage: number): number {
  return weaponBaseDamage + attacker.strength;
}

/** Adapt an inert object's stats (a structure) to a combat defender: it keeps its armour + maxHp but
 *  has no offence/evasion, so strength/dex/dodge read 0 — a wall never dodges and never counter-scales.
 *  Lets a structure be the `defender` of {@link resolveMeleeAttack} (plan 037 2c — the mob-vs-wall path,
 *  the ObjectStats-as-defender adapter the plan anticipated). Pure. */
export function objectAsDefender(stats: ObjectStats): CombatantStats {
  return { ...stats, strength: 0, dex: 0, dodge: 0 };
}

/** Ranged damage: weapon base + the attacker's dexterity (the ranged analogue of `meleeDamage`'s
 *  strength bonus). Feeds {@link resolveRangedAttack} — the bow's damage path (plan 035a Step 5). */
export function rangedDamage(attacker: CombatantStats, weaponBaseDamage: number): number {
  return weaponBaseDamage + attacker.dex;
}

/** 5% floor so dodge can never make something literally unhittable. */
export function hitChance(defender: CombatantStats): number {
  return Math.min(100, Math.max(5, 100 - defender.dodge));
}

export function damageTaken(incoming: number, defender: CombatantStats): number {
  return Math.max(0, incoming - defender.armour);
}

/** Rolls hit chance, then resolves melee damage. Returns the HP to subtract, or 0 on a miss. */
export function resolveMeleeAttack(
  attacker: CombatantStats,
  defender: CombatantStats,
  weaponBaseDamage: number,
  rng: () => number = Math.random,
): number {
  if (rng() * 100 >= hitChance(defender)) return 0;
  return damageTaken(meleeDamage(attacker, weaponBaseDamage), defender);
}

/** Rolls hit chance, then resolves RANGED damage — the bow's resolve, mirroring
 *  {@link resolveMeleeAttack} but through {@link rangedDamage} (dex, not strength). Returns the HP to
 *  subtract, or 0 on a miss (plan 035a Step 5). */
export function resolveRangedAttack(
  attacker: CombatantStats,
  defender: CombatantStats,
  weaponBaseDamage: number,
  rng: () => number = Math.random,
): number {
  if (rng() * 100 >= hitChance(defender)) return 0;
  return damageTaken(rangedDamage(attacker, weaponBaseDamage), defender);
}
