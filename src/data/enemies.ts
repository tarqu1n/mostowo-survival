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
  },
};
