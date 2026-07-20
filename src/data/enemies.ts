/**
 * Enemy catalogue. Keyed by enemy id; add new enemy types here.
 */

import type { EnemyDef } from './types';

export const ENEMIES: Record<string, EnemyDef> = {
  kidZombie: {
    id: 'kidZombie',
    name: 'Kid Zombie',
    color: 0x6b8f3e,
    maxHp: 3,
    armour: 0,
    speed: 45,
    vision: 80,
    strength: 1,
    dex: 0,
    dodge: 0,
    hurtbox: { width: 1, height: 2 }, // skeleton sprite ≈ 1 tile wide, ~2 tall — torso overhangs up
    weaponPool: ['club', 'knife'], // rolls one per spawn (Phase B) — club: slow/2dmg, knife: fast/1dmg
  },
  // A fast, dangerous charger (plan 035b). 4-way directional (`dir4`) — distinct left/right sheets from
  // the craftpix-creatures pack, no flip. Faster than the zombie with a heftier bite; wide/short hurtbox
  // (a low, broad quadruped) so it's hit by its flank, not a tall torso. No weaponPool — natural bite
  // (UNARMED_BASE_DAMAGE + strength). Stats are starting values; playtest-tune (see plan open questions).
  boar: {
    id: 'boar',
    name: 'Boar',
    color: 0x8a5a3b,
    actorKind: 'dir4',
    maxHp: 5,
    armour: 0,
    speed: 70, // charges — noticeably faster than the 45px/s zombie
    vision: 100, // spots and commits from a touch further out
    strength: 2, // a solid bite (unarmed base 1 + 2 = 3 per hit)
    dex: 0,
    dodge: 0,
    hurtbox: { width: 2, height: 1 }, // wide + short: a low, broad body — hit by its flank, not a torso
  },
};
