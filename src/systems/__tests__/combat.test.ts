import { describe, it, expect } from 'vitest';
import { meleeDamage, hitChance, damageTaken, resolveMeleeAttack } from '../combat';
import type { CombatantStats } from '../../data/types';

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

  it('kills a maxHp-3 zombie in 3 hits of flat-1 damage', () => {
    const attacker = makeStats({ strength: 0 });
    const zombie = makeStats({ maxHp: 3, dodge: 0, armour: 0 });
    const alwaysHit = () => 0; // rng() * 100 = 0 < hitChance(100) -> always hits.
    let hp = zombie.maxHp;

    for (let i = 0; i < 3; i++) {
      const dmg = resolveMeleeAttack(attacker, zombie, 1, alwaysHit);
      expect(dmg).toBe(1);
      hp -= dmg;
    }

    expect(hp).toBe(0);
  });
});
