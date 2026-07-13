/**
 * Adapters mapping runtime instances to the Inspect-mode panel's common InspectableStats shape.
 * Objects (trees/walls) omit armour/speed — inert per plan 003 (see Context & decisions), they'd
 * always read a meaningless 0. Combatants (enemies/player) surface the full stat block.
 */

import { BUILDABLES } from '../data/buildables';
import type { CombatantStats, InspectableStats } from '../data/types';
import type { TreeNode, BuildSite, EnemyUnit } from '../entities/types';

export function treeStats(node: TreeNode): InspectableStats {
  return { name: 'Tree', maxHp: node.def.maxHp, currentHp: node.hp };
}

export function wallStats(site: BuildSite): InspectableStats {
  return {
    name: 'Wall',
    maxHp: BUILDABLES.wall.maxHp,
    extra: [{ label: 'Status', value: site.done ? 'Built' : 'Building' }],
  };
}

function combatantExtra(stats: CombatantStats): { label: string; value: string }[] {
  return [
    { label: 'Armour', value: String(stats.armour) },
    { label: 'Speed', value: String(stats.speed) },
    { label: 'Vision', value: String(stats.vision ?? 0) },
    { label: 'Strength', value: String(stats.strength) },
    { label: 'Dodge', value: String(stats.dodge) },
  ];
}

export function enemyStats(unit: EnemyUnit): InspectableStats {
  return {
    name: unit.def.name,
    maxHp: unit.def.maxHp,
    currentHp: unit.hp,
    extra: combatantExtra(unit.def),
  };
}

export function playerCombatStats(stats: CombatantStats, hp: number): InspectableStats {
  return { name: 'You', maxHp: stats.maxHp, currentHp: hp, extra: combatantExtra(stats) };
}
