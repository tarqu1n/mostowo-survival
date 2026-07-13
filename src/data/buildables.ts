/**
 * Buildable catalogue. Keyed by buildable id; add new placeable structures here.
 */

import type { BuildableDef } from './types';

export const BUILDABLES: Record<string, BuildableDef> = {
  // maxHp is a real display stat (Inspect-mode panel); armour/speed are inert for objects — see
  // plan 003 Context & decisions. Walls remain indestructible in combat this slice.
  wall: {
    id: 'wall',
    name: 'Wall',
    cost: { wood: 2 },
    color: 0x6b6b6b,
    maxHp: 10,
    armour: 0,
    speed: 0,
  },
  // Base-only light source; always burning once built, drains fuel continuously (see
  // config.CAMPFIRE_FUEL_* — plan 012 Context & decisions). Renders as a 2-tile-tall animated
  // sprite (log base + flames), bottom-anchored like a tall ResourceNodeDef.
  campfire: {
    id: 'campfire',
    name: 'Campfire',
    cost: { stone: 10, wood: 10 },
    color: 0xff7a2b,
    maxHp: 20,
    armour: 0,
    speed: 0,
    light: 8,
    baseOnly: true,
    blocksPath: true,
    behavior: 'campfire', // live/simulated — routed to CampfireManager on completion (see finishSite)
    animKey: 'campfire',
    tilesTall: 2, // 32×32 bonfire art renders native at 2 tiles (no upscale); bottom-anchored
    originY: 1,
  },
};
