/**
 * Combat resolution: pure functions, no Phaser imports. Both the player's attack and an enemy's contact
 * attack go through `resolveMeleeAttack` rather than each hand-rolling damage math.
 */

import type { CombatantStats } from '../data/types';

export function meleeDamage(attacker: CombatantStats, weaponBaseDamage: number): number {
  return weaponBaseDamage + attacker.strength;
}

/** Defined for schema completeness — nothing calls this yet, no ranged weapon exists. */
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
