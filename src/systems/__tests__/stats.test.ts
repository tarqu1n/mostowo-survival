import { describe, it, expect } from 'vitest';
import { treeStats, wallStats, trapStats, enemyStats, playerCombatStats } from '../stats';
import { BUILDABLES } from '../../data/buildables';
import { ENEMIES } from '../../data/enemies';
import { NODES } from '../../data/nodes';
import type { TreeNode, BuildSite, TrapStructure } from '../../entities/types';
import type { MonsterCharacter } from '../../entities/MonsterCharacter';
import type { CombatantStats } from '../../data/types';

describe('treeStats', () => {
  it('returns name/maxHp/currentHp from the node', () => {
    const node = {
      id: 'tree-1',
      def: NODES.tree,
      hp: 2,
      alive: true,
      col: 1,
      row: 1,
    } as unknown as TreeNode;

    expect(treeStats(node)).toEqual({ name: 'Tree', maxHp: NODES.tree.maxHp, currentHp: 2 });
  });
});

describe('wallStats', () => {
  it('reports "Building" when the site is not done', () => {
    const site = {
      id: 'site-1',
      col: 2,
      row: 2,
      progress: 0.5,
      done: false,
    } as unknown as BuildSite;

    expect(wallStats(site)).toEqual({
      name: 'Wall',
      maxHp: BUILDABLES.wall.maxHp,
      extra: [{ label: 'Status', value: 'Building' }],
    });
  });

  it('reports "Built" when the site is done', () => {
    const site = {
      id: 'site-1',
      col: 2,
      row: 2,
      progress: 1,
      done: true,
    } as unknown as BuildSite;

    expect(wallStats(site)).toEqual({
      name: 'Wall',
      maxHp: BUILDABLES.wall.maxHp,
      extra: [{ label: 'Status', value: 'Built' }],
    });
  });
});

describe('trapStats', () => {
  const trap = (armed: boolean) =>
    ({ id: 'trap-1', col: 6, row: 3, state: { armed } }) as unknown as TrapStructure;

  it('reports "Armed" for a primed trap', () => {
    expect(trapStats(trap(true))).toEqual({
      name: 'Spike Trap',
      maxHp: BUILDABLES.spike_trap.maxHp,
      extra: [{ label: 'Status', value: 'Armed' }],
    });
  });

  it('reports "Spent" for a fired trap', () => {
    expect(trapStats(trap(false))).toEqual({
      name: 'Spike Trap',
      maxHp: BUILDABLES.spike_trap.maxHp,
      extra: [{ label: 'Status', value: 'Spent' }],
    });
  });
});

describe('enemyStats', () => {
  it('returns the enemy def name/maxHp/currentHp plus combatant extras', () => {
    const unit = {
      id: 'enemy-1',
      def: ENEMIES.kidZombie,
      hp: 1,
      alive: true,
      col: 3,
      row: 3,
      state: 'chasing' as const,
      lastContactAt: 0,
      lastRepathAt: 0,
    } as unknown as MonsterCharacter;

    const result = enemyStats(unit);
    expect(result.name).toBe(ENEMIES.kidZombie.name);
    expect(result.maxHp).toBe(ENEMIES.kidZombie.maxHp);
    expect(result.currentHp).toBe(1);
    expect(result.extra).toEqual([
      { label: 'Armour', value: String(ENEMIES.kidZombie.armour) },
      { label: 'Speed', value: String(ENEMIES.kidZombie.speed) },
      { label: 'Vision', value: String(ENEMIES.kidZombie.vision ?? 0) },
      { label: 'Strength', value: String(ENEMIES.kidZombie.strength) },
      { label: 'Dodge', value: String(ENEMIES.kidZombie.dodge) },
    ]);
  });
});

describe('playerCombatStats', () => {
  it('returns "You" with the given hp and combatant extras', () => {
    const stats: CombatantStats = {
      maxHp: 10,
      armour: 1,
      speed: 90,
      vision: 80,
      strength: 2,
      dex: 0,
      dodge: 5,
    };

    const result = playerCombatStats(stats, 7);
    expect(result.name).toBe('You');
    expect(result.maxHp).toBe(10);
    expect(result.currentHp).toBe(7);
    expect(result.extra).toEqual([
      { label: 'Armour', value: '1' },
      { label: 'Speed', value: '90' },
      { label: 'Vision', value: '80' },
      { label: 'Strength', value: '2' },
      { label: 'Dodge', value: '5' },
    ]);
  });

  it('defaults vision to 0 when omitted', () => {
    const stats: CombatantStats = {
      maxHp: 10,
      armour: 0,
      speed: 90,
      strength: 0,
      dex: 0,
      dodge: 0,
    };

    const result = playerCombatStats(stats, 10);
    expect(result.extra).toEqual([
      { label: 'Armour', value: '0' },
      { label: 'Speed', value: '90' },
      { label: 'Vision', value: '0' },
      { label: 'Strength', value: '0' },
      { label: 'Dodge', value: '0' },
    ]);
  });
});
