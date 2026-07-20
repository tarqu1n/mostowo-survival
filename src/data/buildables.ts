/**
 * Buildable catalogue. Keyed by buildable id; add new placeable structures here.
 */

import type { BuildableDef } from './types';

export const BUILDABLES: Record<string, BuildableDef> = {
  // maxHp is a real display stat (Inspect-mode panel); armour/speed are inert for objects — see
  // plan 003 Context & decisions. Walls are mob-DESTRUCTIBLE (plan 037 decision #1, reverses the old
  // "indestructible this slice" note): a live WallBehavior structure with an HP-stage render. Players
  // never damage them in combat — removal is a deconstruct order (chunk 2b); only mob attacks lower HP.
  wall: {
    id: 'wall',
    name: 'Wall',
    cost: { wood: 2 },
    color: 0x6b6b6b,
    // Low-HP early-game archetype: the spiked palisade chips the horde but won't hold long (the later
    // solid high-HP no-thorns wall is the tradeoff). Placeholder — wave-time tuning knob (vs wave DPS).
    maxHp: 12,
    armour: 0,
    speed: 0,
    blocksPath: true,
    behavior: 'wall', // live/simulated — routed to WallBehavior on completion (see finishSite dispatch)
    thorns: 1, // wave-time tuning knob
    orientable: true, // player-rotate at placement picks the facing (down/right/up/left)
  },
  // Base-only light source; always burning once built, drains fuel continuously (see
  // config.CAMPFIRE_FUEL_* — plan 012 Context & decisions). Renders as two layers (ember base + a
  // flame on top), bottom-anchored like a tall ResourceNodeDef — see CampfireBehavior (plan 016).
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
    behavior: 'campfire', // live/simulated — routed to CampfireBehavior on completion (see finishSite)
    animKey: 'campfire',
    tilesTall: 3, // flame height (Fire_01 48px → 3 tiles native) + the tappable pick column
    originY: 1,
  },
};
