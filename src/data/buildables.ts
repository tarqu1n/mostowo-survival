/**
 * Buildable catalogue. Keyed by buildable id; add new placeable structures here.
 */

import type { BuildableDef } from './types';

export const BUILDABLES: Record<string, BuildableDef> = {
  // maxHp is a real display stat (Inspect-mode panel); armour/speed are inert for objects — see
  // plan 003 Context & decisions. Walls remain indestructible in combat this slice.
  wall: { id: 'wall', name: 'Wall', cost: { wood: 2 }, color: 0x6b6b6b, maxHp: 10, armour: 0, speed: 0 },
};
