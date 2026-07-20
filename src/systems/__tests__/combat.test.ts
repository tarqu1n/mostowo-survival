import { describe, it, expect } from 'vitest';
import {
  meleeDamage,
  rangedDamage,
  hitChance,
  damageTaken,
  resolveMeleeAttack,
  resolveRangedAttack,
  objectAsDefender,
} from '../combat';
import type { CombatantStats, ObjectStats } from '../../data/types';

function makeStats(overrides: Partial<CombatantStats> = {}): CombatantStats {
  return {
    maxHp: 10,
    armour: 0,
    speed: 90,
    strength: 0,
    dex: 0,
    dodge: 0,
    ...overrides,
  };
}

describe('meleeDamage', () => {
  it('equals weaponBase + strength', () => {
    const attacker = makeStats({ strength: 4 });
    expect(meleeDamage(attacker, 3)).toBe(7);
  });

  it('handles zero strength', () => {
    const attacker = makeStats({ strength: 0 });
    expect(meleeDamage(attacker, 1)).toBe(1);
  });
});

describe('rangedDamage', () => {
  it('equals weaponBase + dex (the ranged analogue of strength)', () => {
    const attacker = makeStats({ dex: 3 });
    expect(rangedDamage(attacker, 2)).toBe(5);
  });

  it('handles zero dex (the player today)', () => {
    const attacker = makeStats({ dex: 0 });
    expect(rangedDamage(attacker, 2)).toBe(2);
  });
});

describe('hitChance', () => {
  it('is 100 when dodge is 0', () => {
    expect(hitChance(makeStats({ dodge: 0 }))).toBe(100);
  });

  it('floors at 5 when dodge is very high', () => {
    expect(hitChance(makeStats({ dodge: 200 }))).toBe(5);
  });

  it('subtracts dodge from 100 in the normal range', () => {
    expect(hitChance(makeStats({ dodge: 30 }))).toBe(70);
  });
});

describe('damageTaken', () => {
  it('subtracts armour from incoming damage', () => {
    expect(damageTaken(10, makeStats({ armour: 3 }))).toBe(7);
  });

  it('never goes below 0', () => {
    expect(damageTaken(2, makeStats({ armour: 5 }))).toBe(0);
  });
});

describe('resolveMeleeAttack', () => {
  it('returns 0 on a miss', () => {
    const attacker = makeStats({ strength: 5 });
    const defender = makeStats({ dodge: 50, armour: 0 });
    // hitChance(defender) = 50; rng() * 100 = 60 >= 50 -> miss.
    const rng = () => 0.6;
    expect(resolveMeleeAttack(attacker, defender, 1, rng)).toBe(0);
  });

  it('returns the resolved damage on a hit', () => {
    const attacker = makeStats({ strength: 5 });
    const defender = makeStats({ dodge: 50, armour: 2 });
    // hitChance(defender) = 50; rng() * 100 = 10 < 50 -> hit.
    const rng = () => 0.1;
    // meleeDamage = 1 (weapon base) + 5 (strength) = 6; damageTaken = 6 - 2 = 4.
    expect(resolveMeleeAttack(attacker, defender, 1, rng)).toBe(4);
  });

  it('kills a maxHp-3 enemy in 3 hits of flat-1 damage', () => {
    const attacker = makeStats({ strength: 0 });
    const enemy = makeStats({ maxHp: 3, dodge: 0, armour: 0 });
    const alwaysHit = () => 0; // rng() * 100 = 0 < hitChance(100) -> always hits.
    let hp = enemy.maxHp;

    for (let i = 0; i < 3; i++) {
      const dmg = resolveMeleeAttack(attacker, enemy, 1, alwaysHit);
      expect(dmg).toBe(1);
      hp -= dmg;
    }

    expect(hp).toBe(0);
  });
});

describe('objectAsDefender (structure-as-defender adapter, plan 037 2c)', () => {
  const wall: ObjectStats = { maxHp: 12, armour: 2, speed: 0 };

  it('keeps armour + maxHp and zeroes the offence/evasion stats', () => {
    const def = objectAsDefender(wall);
    expect(def.maxHp).toBe(12);
    expect(def.armour).toBe(2);
    expect(def.strength).toBe(0);
    expect(def.dex).toBe(0);
    expect(def.dodge).toBe(0);
  });

  it('lets a structure be the defender of resolveMeleeAttack (never dodges; armour reduces)', () => {
    const attacker = makeStats({ strength: 2 });
    // dodge 0 → always hits regardless of the roll; meleeDamage 1+2=3, minus armour 2 = 1.
    expect(resolveMeleeAttack(attacker, objectAsDefender(wall), 1, () => 0.99)).toBe(1);
  });
});

describe('resolveRangedAttack', () => {
  it('returns 0 on a miss', () => {
    const attacker = makeStats({ dex: 5 });
    const defender = makeStats({ dodge: 50, armour: 0 });
    // hitChance(defender) = 50; rng() * 100 = 60 >= 50 -> miss.
    expect(resolveRangedAttack(attacker, defender, 2, () => 0.6)).toBe(0);
  });

  it('resolves ranged damage through dex (not strength) on a hit', () => {
    const attacker = makeStats({ strength: 9, dex: 3 }); // strength must be ignored by the ranged path
    const defender = makeStats({ dodge: 0, armour: 1 });
    // rangedDamage = 2 (weapon base) + 3 (dex) = 5; damageTaken = 5 - 1 = 4.
    expect(resolveRangedAttack(attacker, defender, 2, () => 0)).toBe(4);
  });

  it('kills a maxHp-3 enemy in 2 bow hits (base 2, dex 0)', () => {
    const attacker = makeStats({ dex: 0 });
    const enemy = makeStats({ maxHp: 3, dodge: 0, armour: 0 });
    let hp = enemy.maxHp;
    for (let i = 0; i < 2; i++) hp -= resolveRangedAttack(attacker, enemy, 2, () => 0);
    expect(hp).toBeLessThanOrEqual(0); // 3 - 2 - 2 = -1
  });
});
