# Spike Trap — Trigger-Once Damage Tile, Re-Armed Each Morning

> Status: planned — run /execute-plan to begin. **Depends on plan 037** landing its foundation first
> (StructureManager + behavior-module registry + a destructible `PlacedStructure` with `hp`/`takeDamage`).
> This plan is the **"trap + re-arm" slice** the 037 critique (#3) recommended splitting out — it
> **supersedes plan 037 Steps 7–8** and the spike half of 037 Step 2 (art). Trim those from 037 when
> this lands so the two don't collide.

## Summary

Add the roadmap's **one trap** (ROADMAP Step 3): a **spike trap** buildable placed by day that sits
**armed** on a walkable tile, **triggers once** when an enemy steps onto it (deals a hit, then goes
**spent**), and is **re-armed each morning** by a queued worker order (mirroring the campfire refuel
order) plus a player tap-to-rearm. It rides entirely on the reusable **`StructureManager` +
behavior-module registry** that plan 037 introduces — the trap is just another `behavior:'trap'`
module — so this plan writes **no foundation refactor**, only the trap module, its trigger/re-arm loop,
art, and tests. Numbers ship as **flagged placeholders** (damage / cost / re-arm cost) for a later
wave-tuning pass; the wave (plan 038) is live, so the trap can be eyeballed against real pathing but
final tuning is out of scope here.

## Context & decisions

**Direction (ROADMAP.md / GAME-DESIGN.md):** ROADMAP Step 3 is "one trap", sequenced *after* the night
wave so it tunes against real wave pathing — the wave (plan 038) and fire-heart claim + light sightline
(plan 039) have since landed, and 038 already built the objective-target seam (`MonsterTickEnv.fire` /
`attackFire`, the `seek` FSM state). GAME-DESIGN "Traps": traps are **multipliers on walls** (funnel the
wave into a kill-channel), **trigger-once + re-armed by a queued worker order each morning** (reuse the
`refuel` pattern), placed in the day phase at scarce cost. Owner decision 2026-07-20: **no separate
arena map — `the-moon` is the MVP map, evolved in place**; the trap is placed at runtime on it, exactly
like the campfire.

**Locked decisions (this planning session):**

1. **Build on plan 037's foundation.** Assume 037 has landed `StructureManager` + the behavior-module
   registry + a destructible `PlacedStructure` (`hp`/`takeDamage`, `reset()`/`destroy()` discipline).
   The trap is a new `behavior:'trap'` module registered alongside the `campfire` and `wall` modules —
   **no StructureManager work in this plan.** If 037 has *not* landed when execution starts, stop and
   resequence (do not rebuild the foundation here).
2. **This supersedes 037 Steps 7–8** (spike trap + trap re-arm) and the **spike** portion of 037 Step 2
   (art curation). When this plan is adopted, trim those from 037 so 037 = foundation + walls + gate only.
3. **Placeholder numbers, tuning deferred.** Trap damage, build cost, and any re-arm cost are flagged
   placeholders in `config.ts`; final tuning against wave DPS is a later pass (out of scope). Pick
   sensible starters (damage that meaningfully hurts a skeleton but doesn't one-shot a boar; cost in the
   scarce range like the campfire).
4. **Trigger = same-tile, trigger-once.** An **armed** trap fires when an enemy occupies its tile
   (exact `col`/`row` match — enemies key off a single feet tile, so this is deterministic under
   `step()`). One trigger = one damage application, then `armed=false` (spent). Not AoE, not cooldown,
   not always-on. The reserved `ObjectStats.activationRange` field (`types.ts:69`) stays unused this
   slice (noted for a future AoE trap).
5. **Flat damage, trap is the aggressor.** Apply flat `SPIKE_TRAP_DAMAGE` to the enemy via its existing
   `Character.takeDamage` — **not** `resolveMeleeAttack` (a trap has no `strength`/`dex`). 037's
   ObjectStats-as-*defender* adapter is for structures *taking* damage and is not needed here.
6. **`blocksPath:false`, not `baseOnly`.** Mobs must be able to walk *onto* the trap (that's how it
   fires), so it never joins BuildManager's `occupied`/`walls` set. It is **not** `baseOnly` — it lines
   the funnel outside the claim (fire-heart claim / plan 039 changed `baseOnly` to the lit radius; the
   trap is unaffected because it isn't `baseOnly`).
7. **Re-arm is a queued worker order + a dawn auto-enqueue.** Mirror `refuel` end-to-end for a new
   `rearm` action. "Each morning" = the **night→`'day'`** transition on `time:changed` (there is no
   separate `dawn` phase — `DayPhase` is only `'day'|'night'`). Re-arm **cost is a placeholder**: MVP
   re-arms for **worker-time only (no resource)**, flagged for tuning (#3). Tapping a **spent** trap
   also queues a manual `rearm`.

**Key files & patterns to mirror (from repo sweep — full detail in the 037 "Key files" section, which
still applies):**

- **Buildable data:** `src/data/buildables.ts` (`campfire` `:22-37` is the live-buildable template);
  `BuildableDef extends ObjectStats` (`types.ts:115-140`) — set `behavior:'trap'`, `blocksPath:false`,
  `cost`, `animKey`, placeholder `maxHp`. `activationRange` (`types.ts:69`) stays unused.
- **Behavior module:** the `campfire` module 037 dissolves `CampfireManager` into
  (`src/scenes/world/CampfireManager.ts` today) is the shape to copy — `materialise(site, struct)`,
  `tick(delta)`, `onTap(struct)`, `reset()`/`destroy()`. The trap module owns `armed` + the
  armed/trigger/spent sheet-frame swap (mirror the campfire `applyFlame` sheet-swap, `CampfireManager.ts`).
- **Enemy-on-tile query (trigger seam):** `EnemyManager.enemyAt(col,row)` (`:136-143`) /
  `enemiesInTiles(tiles)` (`:149-157`) — the trap `tick` queries these, then `enemy.takeDamage(...)`.
  The trap module gets a narrow dep closure for this (mirror how `campfire` gets `spend`, and how the
  wave got `litHearth`/`attackFire` closures wired in `GameScene`).
- **Refuel → rearm order:** `src/systems/tasks.ts:7-11` `Action` union (add `rearm` carrying `{trapId}`).
  Clone the six refuel touchpoints in `GameScene.ts`: `ScenePicker.actionAt`
  (`src/scenes/input/ScenePicker.ts:60-65`), `enqueue`+`isRefuelQueued`/`toggleRefuel`
  (`GameScene.ts:888-931`), `beginCurrent` refuel branch (`:839-857`), dispatch switch (`:745-746`),
  `runRefuel` executor (`:1006-1023`, **condition-terminates** when armed — like "topped up"),
  `describeActionTarget` (`:243-248`). Structure lookup via 037's `structureById` (was `campfireById`).
- **Dawn hook:** `time:changed` `phase==='day'` transition — precedent `WaveDirector.onTimeChanged`
  (`src/scenes/world/WaveDirector.ts:95-98`), subscribed in `GameScene.wireBus` with a SHUTDOWN `off`.
  On the night→day edge, auto-enqueue a `rearm` per spent trap (new **system-initiated** worker order —
  verify it composes sanely with player `build`/`refuel`/`rearm` queueing).
- **Art (cross-pack):** the spike sheets are `craftpix-dungeon` (not the active `pixel-crawler`), loaded
  the cross-pack way the boar uses via a `pack` field (`tileset.ts:143`). Assets under
  `public/assets/tilesets/craftpix-dungeon/Traps/Spikes/` (`1..4`, ~192×32 animated extend/retract).
  `resolveTile`/`TileSource` (`tileset.ts:36`,`:574`); animated buildables use manifest `stations.*`
  StripAnims + key helpers (campfire flame precedent).
- **Test/scenario API:** `src/scenes/testApi.ts` — place via `finishSite(createBlueprint(c,r,'spike_trap'))`
  then read back the StructureManager; scenario `enemies` accept `{at,...}` to script an enemy onto the
  trap tile; `step(ms)` (`:351-360`) deterministic. Fire-seam precedents `damageFire`/`beginWave`
  (`:397-408`). **`DebugState`** (`:37-89`): append `traps: {col,row,armed}[]` **at the END** + serializer
  (`:434-487`); update `testApi.ts` + `tests/e2e/harness.ts` + the `refactor-tripwire` golden **together**
  (deliberate bump). Config constants (`config.ts`, placeholders): `SPIKE_TRAP_DAMAGE`,
  `SPIKE_TRAP_COST`, trigger-anim timing.

## Steps

- [ ] **Step 1: Curate the spike-trap art** `[inline]`
  - Visually review the CraftPix spike candidates and pin the sprite + frame slicing before any rendering
    code. Prefer the repo's sheet-preview path (check `docs/README.md` art-pipeline + `scripts/` for a
    contact-sheet/previewer; the guppi widget-shots harness is a *separate* repo — do not use it),
    otherwise `Read` the PNGs directly under `public/assets/tilesets/craftpix-dungeon/Traps/Spikes/`.
  - Decide and **record** (see Docs): (a) which spike variant (`1..4`); (b) the exact **frame slicing** —
    frame width/count and which frames are **armed-idle / trigger (extend) / spent (retracted or
    blood-stained idle)**; cross-check catalog `regions`/`frames` and pack `tileSize` 16 (sheets ~192×32).
  - Side effects: none (no code). Independent of the other steps — can be done first.
  - Docs: record the spike → file mapping + frame slicing in the art-decisions shard 037 Step 2 writes
    (under `docs/decisions/` or the art section from `docs/README.md`); if 037's shard doesn't exist yet,
    create it. This is the single source Steps 2–3 read exact paths/frames from. Note that 037 Step 2 no
    longer needs to cover spikes (this plan owns them).
  - Done when: the art shard names the exact spike sprite file with verified armed/trigger/spent frame
    slicing — enough that Step 2 needs no further art judgement.

- [ ] **Step 2: `spike_trap` buildable + trap behavior module** `[inline]`
  - Add `spike_trap` to `src/data/buildables.ts`: `behavior:'trap'`, `blocksPath:false`, **not**
    `baseOnly`, `cost` = placeholder `SPIKE_TRAP_COST` (scarce range, e.g. `{wood:5}` — flag for tuning),
    placeholder `maxHp` (traps aren't the focus of enemy attacks; a small value is fine), `animKey` +
    art refs for the spike sprite chosen in Step 1.
  - Register the cross-pack CraftPix spike art (boar `pack`-field precedent, `tileset.ts:143`): manifest
    StripAnim entries + key helpers mirroring the campfire flame, using the Step 1 frame slicing. Ensure
    **PreloadScene** loads the new sheet(s).
  - Add a `trap` behavior module to the StructureManager registry (037's `register(behaviorId, module)`):
    `materialise(site, struct)` plays the build settle then shows the **armed-idle** frame and sets
    `struct.armed = true`; expose `armed` on the runtime record. Give the module a narrow dep for enemy
    queries (Step 3 uses it) wired in `GameScene` as a closure (mirror campfire `spend`).
  - Add `SPIKE_TRAP_DAMAGE`, `SPIKE_TRAP_COST`, and trigger-anim timing consts to `config.ts` under a
    "Trap tuning (placeholder — tune vs wave)" comment block.
  - Side effects: `src/data/tileset.ts` manifest; `PreloadScene` asset list; `finishSite` behavior route
    (trap takes the live route, stays **off** `occupied` because `blocksPath:false`); build palette (the
    trap appears in BUILD — confirm affordability/placement UI works with a non-blocking buildable).
  - Docs: `docs/STATUS.md` (trap buildable landed); reference Step 1's art shard, don't duplicate.
  - Done when: selecting `spike_trap` in BUILD and placing it by day builds a spike sprite that stands
    **armed** on a walkable tile (enemies/player can path across it); a scenario can read the trap's
    `armed` state.

- [ ] **Step 3: Trigger — armed trap damages an enemy on its tile, then spent** `[inline]`
  - In the `trap` module `tick(delta)`: for each **armed** trap, query the enemy-tile seam
    (`EnemyManager.enemyAt` / `enemiesInTiles`, via the injected dep) for an enemy on the trap's tile;
    on a hit → play the **trigger (extend)** anim, apply flat `SPIKE_TRAP_DAMAGE` via `enemy.takeDamage`
    (routing through the normal kill path so death/corpse works), set `armed = false`, and settle on the
    **spent** frame. One trigger = one hit (no re-fire while spent).
  - Deterministic under `step()`: the check runs each tick, same-tile is exact.
  - Side effects: `EnemyManager` — add a tile-query helper only if `enemyAt`/`enemiesInTiles` don't
    already cover it (research says they do); damage/kill path (reuse `takeDamage` → `EnemyManager.killEnemy`).
  - Docs: `docs/STATUS.md` (trap trigger live).
  - Done when: Tier-2 scenario — place a trap, script an enemy onto its tile, `step()` → enemy `hp` drops
    by `SPIKE_TRAP_DAMAGE` and the trap `armed` flips to `false` (assert both); a second enemy on a spent
    trap takes no damage.

- [ ] **Step 4: Re-arm — `rearm` worker order + tap-to-rearm + dawn auto-enqueue** `[inline]`
  - Extend `src/systems/tasks.ts` `Action` union with `rearm` carrying `{trapId}`. Clone the `refuel`
    touchpoints in `GameScene.ts`: `enqueue` + `isRearmQueued`/`toggleRearm` de-dupe (mirror
    `isRefuelQueued`/`toggleRefuel`); `beginCurrent` rearm branch (resolve trap via 037's
    `structureById`, condition-abort if already armed, else `reachableAdjacent` stand tile + `pathTo`);
    dispatch switch → `runRearm`; `runRearm` executor that **condition-terminates** when `armed=true`
    (like refuel "topped up"); `describeActionTarget` label. Re-arm consumes **no resource** for MVP
    (worker-time only — flagged placeholder per decision #7).
  - `ScenePicker.actionAt`: a tap on a **spent** trap resolves to `{kind:'rearm', trapId}` (an armed
    trap's tap is a no-op or re-selects; never a move onto it — but note trap tiles are walkable, so
    guard the pick like the campfire pick guards its blocking tile).
  - **Dawn hook:** subscribe the trap system to `time:changed` (mirror `WaveDirector.onTimeChanged`,
    with a SHUTDOWN `off` in `wireBus`); on the night→`'day'` edge, auto-enqueue a `rearm` order for
    every **spent** trap (system-initiated). Confirm it composes with any pending player
    `build`/`refuel`/`rearm` orders (append, don't clobber the active order).
  - Side effects: `tasks.ts` union; `GameScene` dispatch + `describeActionTarget`; `ScenePicker`;
    `wireBus` subscription + teardown; interaction of system-initiated orders with the player queue.
  - Docs: `docs/STATUS.md`; note the daily re-arm loop is live (GAME-DESIGN "re-armed each morning") and
    that this is the first **system-initiated** worker order.
  - Done when: Tier-2 scenario — trigger a trap (spent), then `setDayPhase('night')`→`setDayPhase('day')`
    (or `step()` across the edge) → a `rearm` order auto-enqueues → the worker walks over and re-arms it
    → trap `armed` back to `true`. Separately: tapping a spent trap queues a `rearm` that re-arms it.

- [ ] **Step 5: Scenario API surface, `DebugState`, tests, tripwire & docs** `[inline]`
  - `testApi.ts`: add a scenario spec `traps` field (place via
    `finishSite(createBlueprint(c,r,'spike_trap'))`, optional seed of `armed`); expose a `DebugState`
    `traps: {col,row,armed}[]` field **appended at the END** of the interface + serializer (`:434-487`);
    update `tests/e2e/harness.ts` + the `refactor-tripwire` golden **together** (intentional bump).
    Consider a `rearmTrap(index)` DEV seam mirroring `feedCampfire`/`damageFire` for manual playtest.
  - Tests: Tier-1 for any new pure logic (e.g. same-tile trigger predicate if extracted); consolidate the
    Tier-2 scenarios from Steps 3–4 into a `tests/e2e/spike-trap.spec.ts`. Confirm `npm run smoke`.
  - Docs: `docs/ROADMAP.md` — mark **Step 3 (one trap) delivered**, note numeric tuning is deferred;
    `docs/STATUS.md` full entry; CLAUDE.md Status line if warranted; trim **plan 037** Steps 7–8 + the
    spike half of its Step 2 (record that this plan superseded them).
  - Side effects: the tripwire golden is the main gotcha — bump it deliberately, not reflexively.
  - Done when: all three tiers green (Vitest units, Playwright scenarios, boot canary) and the tripwire
    passes against the intentionally-updated golden.

## Out of scope

- **The StructureManager / behavior-registry foundation, destructible walls, and the gate** — all owned
  by **plan 037**; this plan assumes they've landed and only adds the `trap` behavior module.
- **Final numeric tuning** — trap damage, build cost, re-arm cost/economy vs wave DPS and funnel width;
  a later pass once the trap is felt against the live wave.
- **Re-arm resource cost** — MVP re-arms for worker-time only; a material cost is a tuning decision.
- **AoE / multi-tile traps** (the reserved `activationRange` proximity trigger), cooldown/always-on
  traps, and other trap types (snare/bear trap, bait/lure, fire trap, barrel, lightning, Archer turret)
  — assets exist but only the single-tile spike trap ships now.
- **Authored (map-file) trap placement** — traps are runtime-placed only, like the campfire; no new map
  object kind.
- **Line-paint trap placement UX** (mobile) and **crafting-station gating** of the trap buildable.
