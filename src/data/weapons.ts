/**
 * Monster weapon catalogue — the SINGLE source of truth for weapon GAMEPLAY stats (damage + attack
 * cadence). A monster rolls one of its `EnemyDef.weaponPool` ids per spawn; the equipped weapon's
 * `damage` feeds `resolveMeleeAttack` and its `attackMs` gates the bite, so a knife bites ~2× as
 * often as a club. Unarmed monsters fall back to `UNARMED_BASE_DAMAGE` + `CONTACT_DAMAGE_COOLDOWN_MS`.
 *
 * Weapon ART (source image, grip pivot, draw z, integer scale) lives in the manifest
 * (tileset.ts `actors.enemy.weapons`), keyed by the SAME id — the art-vs-gameplay split the codebase
 * uses everywhere. No stat is duplicated there.
 */

export interface MonsterWeapon {
  id: string;
  name: string;
  /** Base damage fed into resolveMeleeAttack (before the target's armour/dodge). */
  damage: number;
  /** Minimum ms between this weapon's bites — the per-weapon contact cooldown (slow club vs fast knife). */
  attackMs: number;
}

export const MONSTER_WEAPONS: Record<string, MonsterWeapon> = {
  club: { id: 'club', name: 'Club', damage: 2, attackMs: 1500 }, // slow + heavy
  knife: { id: 'knife', name: 'Knife', damage: 1, attackMs: 750 }, // fast + light
};
