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
    category: 'defense', // HUD build-catalog tab (plan 046)
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
    category: 'survival', // HUD build-catalog tab (plan 046)
  },
  // Spike trap (plan 040) — the roadmap's "one trap": an ARMED floor tile that triggers ONCE when an
  // enemy stands on it (deals SPIKE_TRAP_DAMAGE, then goes spent) and is re-armed each morning by a
  // worker order (+ tap). `blocksPath:false` is load-bearing: mobs must be able to walk ONTO it (that's
  // how it fires), so it never joins BuildManager's occupied/walls set. NOT `baseOnly` — it lines the
  // kill-funnel outside the base (decision #5). The third live/simulated buildable — routed to
  // TrapBehavior on completion via the StructureManager registry (finishSite dispatch on `behavior`).
  // maxHp is an inert display stat (traps aren't mob-damageable this slice); cost {wood:5} is a
  // placeholder — scarce range (a funnel-liner, not spammable). Inlined here beside wall/campfire so
  // all buildable costs live in this data table, not split into config (plan 043 Step 16).
  spike_trap: {
    id: 'spike_trap',
    name: 'Spike Trap',
    cost: { wood: 5 },
    color: 0x9a6b3f,
    maxHp: 10,
    armour: 0,
    speed: 0,
    blocksPath: false,
    behavior: 'trap',
    animKey: 'spikeTrap', // truthy → routes through the animated-buildable branch (like the campfire)
    // Rendered ~2 tiles tall (32px art at native scale 1) so it reads against the dark ground (the
    // half-size 1-tile decal was too small — owner feedback), but CENTRED on its tile (originY 0.5) so
    // the spikes sit ON the square you build it on, not floating above it (bottom-anchoring pushed the
    // art up off the tile). The pick column spans those 2 rows; it still occupies ONE logical tile.
    tilesTall: 2,
    originY: 0.5,
    category: 'defense', // HUD build-catalog tab (plan 046)
  },
};
