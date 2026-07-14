# Game Mechanics — tuned numbers & flows

The gameplay-mechanics reference: what the systems *do* and the numbers they run on. History lives in
[STATUS.md](STATUS.md), rationale in [DECISIONS.md](DECISIONS.md) — this doc is the terse "how it
actually works" index, updated as mechanics land or their tuning changes.

## Buildables & build flow

Palette (BUILD button) → `buildManager.select(id)` enters build mode for that buildable → place a
ghost (gated by `tilePlaceable`: bounds/occupancy/reachability, plus the base-zone check for
`baseOnly` buildables) → cost is spent from the inventory **at placement**, not completion → a worker
`build` task runs over `BUILD_MS` → `finishSite` materialises the result, branching on
`def.behavior`: a *static* buildable (no `behavior` — the wall) becomes a static tile; a *live*
buildable (`behavior` set — the campfire) hands off to its runtime manager (`CampfireManager`) to
create the simulated sprite. (`behavior` is the live-vs-static discriminant; `animKey` is purely
visual — see [DECISIONS.md](DECISIONS.md) "generalise buildable runtime on buildable #2".) Buildables
are defined in [src/data/buildables.ts](../src/data/buildables.ts) (`BuildableDef`,
[src/data/types.ts](../src/data/types.ts)).

## Campfire

Cost **10 stone + 10 wood**; placeable **base-zone only**; **always burning once built** — drains fuel
continuously, day and night. Fuel max **120**, burns **1/s** (⇒ a full tank lasts ~120s, short of a
full day/night cycle — deliberate upkeep pressure), **+30 fuel per wood** fed (⇒ 4 wood refuels an
empty fire), starts full. Blocks its tile like a wall. Goes dark at 0 fuel.

**Flame + light scale with fuel (plan 016):** the fire sprite and its light/vision radius both lerp
with fuel — a full fire is native-size + **8-tile** light; a dying one shrinks to `CAMPFIRE_FLAME_MIN_FRAC`
of that size and `CAMPFIRE_LIGHT_MIN_FRAC` of that radius (both in [src/config.ts](../src/config.ts)).
A single consistent sprite is scaled (Bonfire_07); the Bonfire_0x sheets aren't a clean intensity ramp
to swap across, so scaling reads better than a per-level swap.

**Refuel is a queued worker order (plan 016), not an instant tap:** tapping the fire (command mode)
enqueues a `refuel` order — the worker walks adjacent, then feeds **1 wood every
`CAMPFIRE_FEED_INTERVAL_MS`** (tending, like chop/mine), showing the yellow queued outline; re-tapping
toggles it off. It self-terminates when a full wood no longer fits (topped up) or the bag runs dry.
Because a tap on the fire always resolves to `refuel` (never a move), it can't walk the worker into the
blocking fire tile.

All numbers are `CAMPFIRE_FUEL_MAX`/`_BURN_PER_SEC`/`_PER_WOOD`/`_FEED_INTERVAL_MS`/`_LIGHT_MIN_FRAC`/
`_FLAME_MIN_FRAC` in [src/config.ts](../src/config.ts). Owned at runtime by
[src/scenes/world/CampfireManager.ts](../src/scenes/world/CampfireManager.ts) (sprite scale, fuel tick,
`feedOne`); the `refuel` executor + tap→action resolution are in
[src/scenes/GameScene.ts](../src/scenes/GameScene.ts) / [ScenePicker](../src/scenes/input/ScenePicker.ts);
pure fuel math (`drainFuel`/`feedFuel`/`isLit`/`fuelFrac`) in
[src/systems/campfire.ts](../src/systems/campfire.ts).

## Base zone

A constant-size rect anchored at (centred on) the spawn tile: `BASE_ZONE_SIZE` (tile extent) in
[src/config.ts](../src/config.ts), computed via `baseZoneFromSpawn(SPAWN_TILE, BASE_ZONE_SIZE)` —
**placeholder**, expected to be replaced by a dynamic/claimed base later. Checked via `isInBase(rect,
col, row)` in [src/systems/base.ts](../src/systems/base.ts); gates any `baseOnly` buildable's placement.

## Light/night interaction

Lit campfires cut inverted-mask holes in the night overlay
([src/scenes/world/SurvivalClock.ts](../src/scenes/world/SurvivalClock.ts)) and extend the vision
reveal ([src/scenes/fx/VisionController.ts](../src/scenes/fx/VisionController.ts)) — both fed by one
scene-mediated `lightSources()` closure over `CampfireManager` (behavior-neutral seam, so future light
emitters aggregate in without either consumer changing; no manager↔manager edge). Enemies are
**not** fog-gated yet (deferred to the night-waves plan) — the reveal is purely the night-overlay hole
making near-fire content readable, not a stealth mechanic. Mask technique (inverted geometry mask +
baked textures, no shader): [RENDERING.md](RENDERING.md).
