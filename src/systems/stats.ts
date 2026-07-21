/**
 * Adapters mapping runtime instances to the Inspect-mode panel's common InspectableStats shape.
 * Objects (trees/walls) omit armour/speed — inert per plan 003 (see Context & decisions), they'd
 * always read a meaningless 0. Combatants (enemies/player) surface the full stat block.
 */

import { BUILDABLES } from '../data/buildables';
import { CAMPFIRE_FUEL_MAX } from '../config';
import type { CombatantStats, InspectableStats } from '../data/types';
import type {
  TreeNode,
  BuildSite,
  CampfireStructure,
  WallStructure,
  TrapStructure,
} from '../entities/types';
import type { MonsterCharacter } from '../entities/MonsterCharacter';

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

/** Inspect a LIVE barricade wall (plan 037): its running hp (the mob-damage path lowers it) vs maxHp.
 *  A finished wall is picked as a `structure` (its sprite draws over the hidden site rect), so this —
 *  not {@link wallStats}, which reads a BuildSite — is what the Inspect panel shows for a standing wall. */
export function placedWallStats(wall: WallStructure): InspectableStats {
  return {
    name: 'Wall',
    maxHp: wall.state.maxHp,
    currentHp: wall.state.hp,
    extra: [{ label: 'Status', value: 'Built' }],
  };
}

/** Inspect a LIVE spike trap (plan 040): its armed/spent status. maxHp is the inert display stat off
 *  BUILDABLES (traps aren't mob-damageable this slice), so no currentHp bar — like the campfire. */
export function trapStats(trap: TrapStructure): InspectableStats {
  return {
    name: 'Spike Trap',
    maxHp: BUILDABLES.spike_trap.maxHp,
    extra: [{ label: 'Status', value: trap.state.armed ? 'Armed' : 'Spent' }],
  };
}

export function campfireStats(unit: CampfireStructure): InspectableStats {
  return {
    name: 'Campfire',
    maxHp: BUILDABLES.campfire.maxHp,
    extra: [
      { label: 'Fuel', value: `${Math.ceil(unit.state.fuel)}/${CAMPFIRE_FUEL_MAX}` },
      { label: 'Status', value: unit.state.lit ? 'Lit' : 'Out' },
    ],
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

export function enemyStats(unit: MonsterCharacter): InspectableStats {
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
