# Spike Trap — Trigger-Once Damage Tile, Re-Armed Each Morning

> Status: in review. **REVISED 2026-07-20 (premise refresh):** plan 037's
> **StructureManager + destructible walls have now LANDED** (items 2a–2c + 3), so the earlier "bespoke
> `TrapManager`, no 037 dependency" framing is **obsolete**. The trap now ships as the **third behavior
> module (`TrapBehavior`) in the landed `StructureManager` registry**, beside `CampfireBehavior` /
> `WallBehavior` — which is exactly the "fold in later against two real examples" this plan originally
> deferred. See the **REVISED note** at the top of Context & decisions. (037's walls+registry live on
> branch `claude/roadmap-after-plan-38-641k47`; execute this plan once that branch is merged/available —
> `StructureManager.ts`, `CampfireBehavior.ts`, `WallBehavior.ts` must exist and `CampfireManager.ts` /
> `WallManager.ts` must be gone.)

## Summary

Add the roadmap's **one trap** (ROADMAP Step 3): a **spike trap** buildable placed by day that sits
**armed** on a walkable tile, **triggers once** when an enemy steps onto it (deals a hit, then goes
**spent**), and is **re-armed each morning** by a queued worker order (mirroring the campfire refuel
order) plus a player tap-to-rearm. It ships on the **already-proven build/blueprint path** the roadmap
points at, via a new **`TrapBehavior` module registered in the landed `StructureManager`** (mirroring
`CampfireBehavior` / `WallBehavior`: `materialise` / `tick` / `reset`-vs-`destroy`, narrow deps). **No
bespoke manager and no `materialiseBuildable` edit** — `StructureManager.materialise` already dispatches
on `def.behavior` through its registry; the trap just adds `register('trap', trapBehavior)` in
`buildWorld()`. Numbers ship as **flagged placeholders** (damage / cost) for a later wave-tuning
pass; the wave (plan 038) is live, so the trap is validated against real wave pathing in tests but final
numeric tuning is out of scope here.

## Context & decisions

**REVISED 2026-07-20 — premise refresh (037 landed).** This plan was originally written + critiqued
while plan 037 was deferred, so it chose a **bespoke `TrapManager`** and dropped the 037 dependency
(old decision #1; critique findings #1/#2). Since then, 037's **walls-first resequence executed**: the
destructible 4-way wall (2a), player deconstruct (2b), mob-siege + thorns (2c), and the
**`StructureManager` + behavior-registry generalisation (item 3)** all landed — `CampfireManager` and
`WallManager` are **dissolved** into `CampfireBehavior` / `WallBehavior` modules, and
`materialiseBuildable` is now a **registry dispatch**. So the trap is now the **third behavior module**,
not a second bespoke manager — the exact "generalise later against two real examples" this plan deferred.
**What changed below:** decision #1 flipped (TrapBehavior module, not TrapManager); the "manager to
mirror" / "dispatch to generalise" key-files bullets and Step 2 retargeted to the registry; Step 1 now
**reuses the already-curated spike art** (037 picked `Traps/Spikes/2` in `docs/wired-art.md`, so don't
re-curate the variant — only finalise the armed/trigger/spent frame roles). Everything else (trigger-once,
re-arm order + dawn auto-enqueue, DebugState/tripwire, live-wave test) stands.

**Direction (ROADMAP.md / GAME-DESIGN.md):** ROADMAP Step 3 is "one trap", sequenced *after* the night
wave so it tunes against real wave pathing — the wave (plan 038) landed. The roadmap frames Step 3 as
reusing an existing capability ("walls already prove the build/blueprint path"); it does **not** call for
a StructureManager generalisation. GAME-DESIGN "Traps": traps are **multipliers on walls** (funnel the
wave into a kill-channel), **trigger-once + re-armed by a queued worker order each morning** (reuse the
`refuel` pattern), placed in the day phase at scarce cost. Owner decision 2026-07-20: **no separate
arena map — `the-moon` is the MVP map, evolved in place**; the trap is placed at runtime on it, exactly
like the campfire.

**Locked decisions (this planning session, incl. the 2026-07-20 critique resolution):**

1. **`TrapBehavior` module on the landed `StructureManager` — NOT a bespoke manager** *(flipped
   2026-07-20 — see the REVISED note above; supersedes the original "bespoke TrapManager, drop 037"
   decision, which was correct only while 037 was deferred).* The trap is a **behavior module**
   registered via `structureManager.register('trap', trapBehavior)` in `buildWorld()`, mirroring
   `CampfireBehavior` / `WallBehavior` (own typed state, `materialise` / `tick` / optional caps,
   `reset`-vs-`destroy` discipline). It is the **third real behavior** the generalisation now carries —
   the architecture decision's "generalise on buildable #2" trigger already fired (item 3, marked `[DONE]`
   in `docs/decisions/architecture.md`), so no new deviation to record; just add the module. **Do NOT**
   create a `TrapManager` or edit `materialiseBuildable` (the registry already dispatches on `behavior`).
2. **Placeholder numbers, tuning deferred.** Trap damage and build cost are flagged placeholders in
   `config.ts`; final tuning against wave DPS is a later pass (out of scope). Pick sensible starters
   (damage that meaningfully hurts a skeleton but doesn't one-shot a boar; cost in the scarce range).
3. **Trigger = same-tile, trigger-once.** An **armed** trap fires when an enemy occupies its tile
   (exact `col`/`row` match — enemies key off a single feet tile, so this is deterministic under
   `step()`). One trigger = one damage application, then `armed=false` (spent). Not AoE, not cooldown,
   not always-on. The reserved `ObjectStats.activationRange` field (`types.ts:69`) stays unused this
   slice (noted for a future AoE trap).
4. **Flat damage, trap is the aggressor.** Apply flat `SPIKE_TRAP_DAMAGE` to the enemy via its existing
   `Character.takeDamage` (routing the normal kill path) — **not** `resolveMeleeAttack` (a trap has no
   `strength`/`dex`).
5. **`blocksPath:false`, not `baseOnly`.** Mobs must be able to walk *onto* the trap (that's how it
   fires), so it never joins BuildManager's `occupied`/`walls` set. It is **not** `baseOnly` — it lines
   the funnel. (Aside: plan 039, which would make `baseOnly` = the lit radius, is **also only planned,
   not landed**; `baseOnly` today is still the fixed base rect. The trap isn't `baseOnly` either way, so
   this is non-load-bearing — just don't assume 039's behaviour.)
6. **Re-arm is a queued worker order + a dawn auto-enqueue.** Mirror `refuel` end-to-end for a new
   `rearm` action. "Each morning" = the **night→`'day'`** transition on `time:changed` (there is no
   separate `dawn` phase — `DayPhase` is only `'day'|'night'`). Re-arm **cost is a placeholder**: MVP
   re-arms for **worker-time only (no resource)**, flagged for tuning. Tapping a **spent** trap also
   queues a manual `rearm`.

**Key files & patterns to mirror (from repo sweep):**

- **Buildable data:** `src/data/buildables.ts` — `campfire` (`:22-37`) is the live-buildable template.
  `BuildableDef extends ObjectStats` (`types.ts:115-140`) — set `behavior:'trap'`, `blocksPath:false`,
  `cost`, `animKey`, placeholder `maxHp`. The `behavior` field is the live-vs-static discriminant.
- **Module to mirror:** `src/scenes/world/CampfireBehavior.ts` + `WallBehavior.ts` — copy the behavior-
  module shape for a new `TrapBehavior.ts`: `materialise(site, struct)`, per-frame `tick(delta)`, the tap
  seam, and the **`reset()` (runtime, destroys sprites) vs `destroy()` (shutdown, drops refs only)**
  discipline — the "fx-teardown pattern" (`docs/CONVENTIONS.md`). Narrow deps object of closures (mirror
  how the two existing modules take theirs); no module↔module coupling (`StructureManager`/scene mediates).
  Trap runtime state = a `TrapState` (`{armed}`) on `PlacedStructure<TrapState>`, mirroring
  `CampfireState`/`WallState` in `src/entities/types.ts`. **Read `StructureManager.ts` + the two existing
  modules for the exact interface** — any line refs elsewhere in this plan predate item 3 and are stale.
- **No dispatch edit needed:** `StructureManager.materialise(site)` already dispatches on
  `BUILDABLES[site.buildableId].behavior` through its registry (item 3). The whole wiring is
  `structureManager.register('trap', new TrapBehavior(deps))` in `buildWorld()`; `StructureManager.tick`
  already fans out to each module's `tick`, so the trap's per-frame trigger runs with no extra scene wiring.
  Do NOT reintroduce a hardcoded `materialiseBuildable` branch or a separate `trapManager.tick` call.
- **Enemy-on-tile query (trigger seam):** `EnemyManager.enemyAt(col,row)` (`:136-143`) /
  `enemiesInTiles(tiles)` (`:149-157`) exist — the trap `tick` queries these, then `enemy.takeDamage(...)`
  → normal kill path (`EnemyManager.killEnemy`). `TrapBehavior` gets a narrow dep closure for this,
  wired in `GameScene` (mirror how `CampfireBehavior`/`WallBehavior` take their deps).
- **Refuel → rearm order:** `src/systems/tasks.ts:7-11` `Action` union (add `rearm` carrying `{trapId}`).
  Clone the six refuel touchpoints in `GameScene.ts`: `ScenePicker.actionAt`
  (`src/scenes/input/ScenePicker.ts:60-65`), `enqueue`+`isRefuelQueued`/`toggleRefuel`
  (`:888-931`), `beginCurrent` refuel branch (`:839-857`), dispatch switch (`:745-746`), `runRefuel`
  executor (**condition-terminates** when armed — like "topped up"), `describeActionTarget`. **037 chunk
  2b already added a second refuel-mirror order (`deconstruct`)** — use refuel or deconstruct, whichever is
  the closest template. Structure lookup via the structures seam (`structureManager.byId` / the trap
  module's `byId`), mirroring how the refuel/deconstruct orders resolve their target.
- **Dawn hook:** `time:changed` `phase==='day'` transition — precedent `WaveDirector.onTimeChanged`
  (`src/scenes/world/WaveDirector.ts:95-98`), subscribed in `GameScene.wireBus` with a SHUTDOWN `off`.
  On the night→day edge, auto-enqueue a `rearm` per spent trap (new **system-initiated** worker order —
  verify it composes with player `build`/`refuel`/`rearm` queueing: append, don't clobber the active order).
- **Art (cross-pack):** the spike sheets are `craftpix-dungeon` (not the active `pixel-crawler`), loaded
  the cross-pack way the boar uses via a `pack` field (`tileset.ts:143`). Assets under
  `public/assets/tilesets/craftpix-dungeon/Traps/Spikes/` (`1..4`, ~192×32 animated extend/retract).
  `resolveTile`/`TileSource` (`tileset.ts:36`,`:574`); animated buildables use manifest `stations.*`
  StripAnims + key helpers (campfire flame `applyFlame` sheet-swap precedent).
- **Test/scenario API:** `src/scenes/testApi.ts` — place via `finishSite(createBlueprint(c,r,'spike_trap'))`
  then read back the trap state via the structures seam (`structureManager.structuresOf('trap')` / a
  `__test.traps()` helper like 037's `walls()`); scenario `enemies` accept `{at,...}` to script an enemy onto the
  trap tile; the live wave is drivable via **`beginWave()`** (`:406-408`) for the roadmap acceptance test;
  `step(ms)` (`:351-360`) deterministic. Fire-seam precedents `damageFire`/`beginWave` (`:397-408`).
  **`DebugState`** (`:37-89`): append `traps: {col,row,armed}[]` **at the END** + serializer (`:434-487`);
  update `testApi.ts` + `tests/e2e/harness.ts` + the `refactor-tripwire` golden **together** (deliberate
  bump). Config consts (`config.ts`, placeholders): `SPIKE_TRAP_DAMAGE`, `SPIKE_TRAP_COST`, trigger-anim
  timing.

## Steps

- [x] **Step 1: Confirm the spike art (variant already curated — do NOT re-pick)** `[inline]`
  - Outcome: Viewed `Traps/Spikes/2.png` (192×32, 6f×32×32; opaque-px profile f0=36 f1=94 f2=169 f3=156 f4=94 f5=36 confirms symmetric retract→extend→retract). Pinned frame roles in `docs/wired-art.md`: **armed=frame 1** (low/primed, visible — not the flush frame 0), **trigger=play armed→frame 2** (damage at peak), **spent=frame 2 held**, **re-arm=frame 2→1**. Frames 0,3–5 unused. No code touched.
  - The variant is **already chosen**: 037's art curation recorded **`Traps/Spikes/2` (wood-tone)** in
    `docs/wired-art.md` ("Base-defence structures (plan 037)"), frame geometry pinned — **6 frames ×
    32×32**, a symmetric retract→extend→retract: **frame 0 = retracted**, **frame 2 = full extend**.
    Reuse it; do not re-curate.
  - Left to finalise (037 explicitly deferred it): the **armed / trigger / spent** frame mapping. Mind the
    readability nuance flagged there — frame 0 is retracted/hidden, so "armed" likely wants a subtly-raised
    frame (not fully hidden) so a placed trap is visible. Decide: armed = which frame; trigger = play 0→2
    (extend, apply damage on the extend); spent = held-extended or a retracted/spent look. `Read`
    `public/assets/tilesets/craftpix-dungeon/Traps/Spikes/2.png` to make the call.
  - Side effects: none (no code). Docs: extend the `docs/wired-art.md` plan-037 spike entry (or add a
    plan-040 line) with the finalised armed/trigger/spent frame indices.
  - Done when: the frame roles are pinned so Step 2 needs no art judgement.

- [x] **Step 2: `spike_trap` buildable + `TrapBehavior` module** `[inline]`
  - Outcome: Added `spike_trap` to `buildables.ts` (`behavior:'trap'`, `blocksPath:false`, not `baseOnly`, `cost:SPIKE_TRAP_COST`, `maxHp:10` placeholder, `animKey:'spikeTrap'`, `originY:0.5` — a centred floor decal). Added `structures.spikeTrap` (pack + single 6f sheet) + `spikeTrapKey`/`spikeTrapExtendKey`/`SPIKE_TRAP_ARMED_FRAME`(1)/`SPIKE_TRAP_PEAK_FRAME`(2) to `tileset.ts`; PreloadScene loads it cross-pack; actorAnims registers the extend anim (frames 1→2, `duration:SPIKE_TRAP_TRIGGER_MS`). New `TrapBehavior.ts` (owns `TrapStructure[]`, materialise on armed frame, reset/destroy discipline, narrow `hurtEnemyOnTile` dep); `TrapState={armed}` in `entities/types.ts`. Registered `'trap'` in `buildWorld()` (no `materialiseBuildable`/tick edits). Config block (DAMAGE 2 / COST {wood:5} / TRIGGER_MS 120) added. `trapStats` in `stats.ts`. Build palette auto-lists it (`Object.values(BUILDABLES)`). Typecheck+lint+834 unit tests green; prod build compiles; placement e2e (`spike-trap.spec.ts` test 1) confirms armed on a walkable (unblocked) tile. Registry regression covered by tripwire + campfire/wall specs (the 2 campfire failures reproduce on master — pre-existing env/Chromium-1194 issues, not this plan).
  - Add `spike_trap` to `src/data/buildables.ts`: `behavior:'trap'`, `blocksPath:false`, **not**
    `baseOnly`, `cost` = placeholder `SPIKE_TRAP_COST` (scarce range, e.g. `{wood:5}` — flag for tuning),
    placeholder `maxHp`, `animKey` + art refs for the Step-1 spike (`Traps/Spikes/2`).
  - Register the cross-pack CraftPix spike art (boar `pack`-field precedent; mirror the barricade
    `structures.*` manifest entries 037 added): StripAnim entries + key helpers, using the Step 1 frame
    slicing. Ensure **PreloadScene** loads the sheet cross-pack (`tilesetAssetUrl`).
  - Add `src/scenes/world/TrapBehavior.ts` mirroring `CampfireBehavior`/`WallBehavior`: owns its
    `PlacedStructure<TrapState>[]`; `materialise(site, struct)` builds the sprite + sets `armed=true` on
    the armed frame; `tick(delta)` stub for now (trigger in Step 3); `all()`/`at()`/`byId()`; the
    **`reset()`/`destroy()` discipline copied verbatim**; a narrow deps closure for the enemy query Step 3
    needs. `TrapState` = `{ armed: boolean }` in `src/entities/types.ts` (mirror `CampfireState`/`WallState`).
  - Wire it: `structureManager.register('trap', new TrapBehavior(deps))` in `GameScene.buildWorld()`
    (beside the campfire/wall registrations). **No `materialiseBuildable` edit and no separate tick call** —
    `StructureManager.materialise` dispatches on `behavior` and `StructureManager.tick` fans out to the
    module (item 3). Any tap/pick routes through the existing generic `structures` pick path (ScenePicker,
    `tilesTall ?? 1`).
  - Add `SPIKE_TRAP_DAMAGE`, `SPIKE_TRAP_COST`, trigger-anim timing to `config.ts` under a "Trap tuning
    (placeholder — tune vs wave)" comment block.
  - Side effects: `src/data/tileset.ts` manifest; `PreloadScene` asset list; `buildWorld` registration;
    `finishSite` behavior route (trap takes the live/registry route, stays **off** `occupied` because
    `blocksPath:false`); build palette (trap appears in BUILD — confirm a non-blocking buildable
    places/affords correctly).
  - Docs: `docs/STATUS.md` (trap buildable + TrapBehavior module landed); reference Step 1's art note.
  - Done when: selecting `spike_trap` in BUILD and placing it builds a spike sprite standing **armed** on a
    walkable tile (enemies/player path across it); a scenario reads the trap's `armed` via the structures
    seam; campfire + walls still build identically (registry regression); `npm run smoke` green.

- [x] **Step 3: Trigger — armed trap damages an enemy on its tile, then spent** `[inline]`
  - Outcome: `TrapBehavior.tick` fires each armed trap on an enemy whose **feet tile** matches (exact `col/row` — decision #3; **deviated from the research pointer's `enemyAt`**, which is hurtbox-based and would also fire on a torso overlapping from the adjacent tile — not "standing on the spikes"). Damage routed via a new public `EnemyManager.hurtEnemy` (wraps the private thorns `hurtMonster` → normal hit-flash/kill path); on hit plays the extend anim + flips `armed=false` (holds the peak/spent frame). Added `EnemyManager.hurtEnemy`. Tier-2 (`spike-trap.spec.ts`): enemy on an armed trap loses exactly `SPIKE_TRAP_DAMAGE` and the trap goes spent; a second enemy on the spent trap takes no damage — both pass.
  - In `TrapBehavior.tick(delta)`: for each **armed** trap, query the enemy-tile seam (`EnemyManager.enemyAt`,
    via the injected dep) for an enemy on the trap's tile; on a hit → play the **trigger (extend)** anim,
    apply flat `SPIKE_TRAP_DAMAGE` via `enemy.takeDamage` (normal kill path), set `armed=false`, settle on
    the **spent** frame. One trigger = one hit (no re-fire while spent). Deterministic under `step()`.
  - Side effects: `EnemyManager` — reuse `enemyAt`/`enemiesInTiles` (already exist); damage/kill path.
  - Docs: `docs/STATUS.md` (trap trigger live).
  - Done when: Tier-2 scenario — place a trap, script an enemy onto its tile, `step()` → enemy `hp` drops
    by `SPIKE_TRAP_DAMAGE` and the trap `armed` flips to `false` (assert both); a second enemy on a spent
    trap takes no damage.

- [x] **Step 4: Re-arm — `rearm` worker order + tap-to-rearm + dawn auto-enqueue** `[inline]`
  - Outcome: Added `rearm{trapId}` to the `tasks.ts` `Action` union + cloned the refuel/deconstruct touchpoints in `GameScene` (`describeActionTarget`, dispatch→`runRearm`, `beginCurrent` rearm branch resolving the trap + standing adjacent, `enqueue` de-dupe, `isRearmQueued`/`toggleRearm`, `runRearm` condition-terminating when armed/gone) + a `rearm` branch in `TaskGlowRenderer` (outlines the trap). `ScenePicker.actionAt`: spent trap → `rearm`; armed trap falls through to a plain move (its tile is walkable — decision #5). `onTap` batches `rearm` like `refuel`. **Dawn hook** `GameScene.rearmTrapsAtDawn` subscribed to `time:changed` in `wireBus` (+ SHUTDOWN `off`): on `phase==='day'` it `enqueue`s a rearm for every spent trap — the first **system-initiated** order; reusing `enqueue` gives append-not-clobber + de-dupe for free. **Note:** the plan's `setDayPhase` suggestion emits nothing, so the test fires `time:changed{phase:'day'}` directly (the exact event SurvivalClock emits at dawn). Tier-2: tap-path (`rearmTrap` seam) re-arms; dawn edge auto-enqueues behind a pending player move (current unchanged, pending+1) and completes → armed — both pass.
  - Extend `src/systems/tasks.ts` `Action` union with `rearm` carrying `{trapId}`. Clone the `refuel`
    touchpoints in `GameScene.ts`: `enqueue` + `isRearmQueued`/`toggleRearm` de-dupe; `beginCurrent`
    rearm branch (resolve trap via the structures seam, condition-abort if already armed, else
    `reachableAdjacent` stand tile + `pathTo`); dispatch switch → `runRearm`; `runRearm` executor that
    **condition-terminates** when `armed=true` (like refuel "topped up"); `describeActionTarget` label.
    Re-arm consumes **no resource** for MVP (worker-time only — flagged placeholder per decision #6).
  - `ScenePicker.actionAt`: a tap on a **spent** trap resolves to `{kind:'rearm', trapId}`; an armed
    trap's tap is a no-op (guard like the campfire pick, though trap tiles are walkable).
  - **Dawn hook:** subscribe the trap system to `time:changed` (mirror `WaveDirector.onTimeChanged`, with
    a SHUTDOWN `off` in `wireBus`); on the night→`'day'` edge, auto-enqueue a `rearm` for every **spent**
    trap (system-initiated). Confirm it appends to (doesn't clobber) any pending player order.
  - Side effects: `tasks.ts` union; `GameScene` dispatch + `describeActionTarget`; `ScenePicker`;
    `wireBus` subscription + teardown; system-initiated vs player-queue interaction.
  - Docs: `docs/STATUS.md`; note the daily re-arm loop is live and that this is the first
    **system-initiated** worker order.
  - Done when: Tier-2 scenario — trigger a trap (spent), then `setDayPhase('night')`→`setDayPhase('day')`
    (or `step()` across the edge) → a `rearm` auto-enqueues → the worker walks over and re-arms it →
    `armed=true`. Separately: tapping a spent trap queues a `rearm` that re-arms it.

- [x] **Step 5: Scenario API, `DebugState`, tests (incl. live wave), tripwire & docs** `[inline]`
  - Outcome: `testApi.ts` — scenario `traps` placement (mirrors campfires) + `trapIds` in the result; `DebugState.traps: {col,row,armed}[]` appended at the END + serialized; `harness.ts` mirrors the field + adds `traps()`/`rearmTrap()` bridges; `testTypes.ts` gains `ScenarioSpec.traps`/`ScenarioResult.trapIds`/`GameTestApi.rearmTrap`; `GameScene.installTestApi` adds the `rearmTrap` bridge (enqueues the real order, like `deconstructWall`). Refactor-tripwire golden bumped with `traps: []` (deliberate). Tests: Tier-1 `trapStats` (armed/spent) in `stats.test.ts`; Tier-2 `spike-trap.spec.ts` (5 tests incl. the **live-wave acceptance** — `beginWave()` spawns a real mob, `moveEnemy` crosses it onto the trap, assert the trap fired + the wave mob took `SPIKE_TRAP_DAMAGE`; teleport avoids the-moon spawn→hearth walkability uncertainty the wave.spec flags). All 5 spike-trap + tripwire pass; 834+2 unit tests pass; prod build compiles; smoke boots with zero console/page errors (the smoke click-to-start + 2 campfire specs fail identically on master — pre-existing Chromium-1194 env issues). Docs: STATUS.md full entry, ROADMAP Step 3 ✅ (tuning deferred), CLAUDE.md Status + Next, wired-art.md (Step 1). No 037 edits / no architecture-deviation (037 item 3 already `[DONE]`).
  - `testApi.ts`: add a scenario spec `traps` field (place via `finishSite(createBlueprint(c,r,'spike_trap'))`,
    optional `armed` seed); append a `DebugState` `traps: {col,row,armed}[]` field **at the END** of the
    interface + serializer (`:434-487`); update `tests/e2e/harness.ts` + the `refactor-tripwire` golden
    **together** (intentional bump). Consider a `rearmTrap(index)` DEV seam mirroring `feedCampfire`/`damageFire`.
  - Tests: Tier-1 for any new pure logic (e.g. a same-tile trigger predicate if extracted); Tier-2
    scenarios from Steps 3–4 in `tests/e2e/spike-trap.spec.ts`. **Add the roadmap acceptance scenario:**
    place a trap on the wave's path, drive the **live wave** via `beginWave()`, `step()` to dawn, assert
    the trap damaged wave mobs (the roadmap's "run wave, assert trap damage" — not just a scripted single
    enemy). Confirm `npm run smoke`.
  - Docs: `docs/ROADMAP.md` — mark **Step 3 (one trap) delivered**, numeric tuning deferred;
    `docs/STATUS.md` full entry (trap = the third `StructureManager` behavior module); CLAUDE.md Status
    line if warranted. **No architecture-deviation to record** — 037 item 3 already landed the
    StructureManager generalisation and marked it `[DONE]` in `docs/decisions/architecture.md`; this plan
    just adds the third behavior module. Plan 037 has been finalised separately (walls + registry landed;
    gate deferred into the upgraded-walls work; trap carved out to this plan) — no edits to 037 needed here.
  - Side effects: the tripwire golden is the main gotcha — bump it deliberately, not reflexively.
  - Done when: all three tiers green (Vitest units, Playwright scenarios incl. the live-wave scenario, boot
    canary) and the tripwire passes against the intentionally-updated golden.

> **Post-deploy iteration (2026-07-21) — trigger animation visibility.** First cut used only a 2-frame
> slice (armed f1 → peak f2) drawn at the trap's ground depth, so the strike played *behind* the mob
> standing on it and was effectively invisible (owner feedback: "couldn't see it"). Fixed without
> changing any trap mechanics/state: the strike now plays the strip's **rise 0→2** (coil-then-slam) and
> the sprite jumps to a high depth (over mobs) for the strike beat, dropping back to ground depth once
> settled; re-arm plays the strip's **descent 2→4** (spikes visibly wind back down) then settles on the
> armed frame. So frames 0–4 are all used (f5 is a duplicate flush). The existing damage hit-flash on the
> struck mob is the dominant "it fired" cue; the raised spikes read secondarily. Verified in-engine via a
> 4-state capture (armed/strike/spent/re-armed). All gates stayed green (e2e assert state, not visuals).
> `TrapBehavior.ts` + `actorAnims.ts` + `tileset.ts` + `docs/wired-art.md`.
>
> **Follow-up (still not visible enough).** Owner declined switching to the brighter white/metal sheets
> (`Spikes/3`/`4`) — kept `Spikes/2` (wood-tone) and went bigger instead: the trap now renders **~2 tiles
> tall, bottom-anchored** (`tilesTall:2`/`originY:0.9`, native scale 1 vs the too-small 1-tile half-scale)
> plus a **×1.35 scale-punch on the strike**. Verified in-engine — the armed trap now reads as a clear
> spike cluster on the ground and the strike (mob hit-flash + spikes punching up over it) is unmistakable.
> `buildables.ts` + `TrapBehavior.ts` + `docs/wired-art.md`.

## Out of scope

- **The StructureManager / behavior-registry generalisation, destructible walls, and the gate** — plan
  037's territory. StructureManager + destructible walls **landed** (037 items 2a–2c + 3); the **gate** is
  deferred into the later upgraded-walls work (owner, 2026-07-20). This plan adds only the trap behavior
  module — the third real behavior the registry now carries.
- **Trimming / renumbering plan 037** — 037 is still deferred and its final shape is unsettled; only a
  one-line cross-reference note is added (Step 5). No front-loaded edits against a moving target.
- **Final numeric tuning** — trap damage, build cost, re-arm cost/economy vs wave DPS and funnel width;
  a later pass once the trap is felt against the live wave.
- **Re-arm resource cost** — MVP re-arms for worker-time only; a material cost is a tuning decision.
- **AoE / multi-tile traps** (the reserved `activationRange`), cooldown/always-on traps, and other trap
  types (snare/bear trap, bait/lure, fire trap, barrel, lightning, Archer turret) — assets exist but only
  the single-tile spike trap ships now.
- **Authored (map-file) trap placement** — traps are runtime-placed only, like the campfire; no new map
  object kind.
- **Line-paint trap placement UX** (mobile) and **crafting-station gating** of the trap buildable.

## Critique

> Independent fresh-eyes review (critique-plan), 2026-07-20. **Resolved** — the plan above was revised in
> response; recorded here for traceability.

**Verdict (of the *pre-revision* plan):** Well-researched and correctly scoped to the roadmap's "one
trap," but *blocked and built on sand* — it hard-depended on plans 037 and 039, neither of which has
landed; 037 is deferred with an unresolved critique.

|#|Finding|Lens|Severity|Resolution|
|-|-------|----|--------|----------|
|1|Core prerequisite (037 StructureManager + destructible `PlacedStructure`) doesn't exist; 037 deferred/unsettled — plan not executable as written.|Dependency risk|**High**|**Resolved** — dropped the 037 dependency; bespoke `TrapManager` instead (decision #1).|
|2|Roadmap Step 3 reuses the proven build path; 040 hard-coupled it to the contested 037 refactor rather than a bespoke live-buildable like `CampfireManager`.|Alternatives / roadmap fit|**High**|**Resolved** — owner chose the lighter `TrapManager` path; StructureManager generalisation consciously deferred to fold in both managers later.|
|3|Claimed plan 039 "has landed" — it's only planned (no STATUS entry).|Factual framing|Medium|**Resolved** — decision #5 corrected; trap isn't `baseOnly`, non-load-bearing.|
|4|Roadmap acceptance is "run wave, assert trap damage"; original tests only scripted a single enemy, never the live `WaveDirector`.|Test genuineness|Medium|**Resolved** — Step 5 adds a live-wave (`beginWave()`) acceptance scenario.|
|5|"Trim 037 Steps 7–8" assumed 037's current numbering; 037 is being split/resequenced.|Cross-plan coordination|Medium|**Resolved** — Step 5 now only adds a one-line cross-ref to 037; no front-loaded trim (Out of scope).|
|6|Dawn auto-enqueue is the first system-initiated worker order (new pattern).|Consistency|Low|Flagged in decision #6 / Step 4 — verify composition with the player queue at execution.|

**Post-note (2026-07-20, premise refresh):** findings #1/#2 were "resolved" by dropping the 037
dependency and going bespoke — correct *while 037 was deferred*. 037 has since **landed**
(StructureManager + walls), so that resolution is superseded: the trap is now a `TrapBehavior` module on
the landed registry (revised decision #1). Findings #3–#6 stand. The "first system-initiated worker
order" caveat (#6) may already be partly addressed — 037 chunk 2b added a `deconstruct` worker order, so
there are now two refuel-mirror orders to template from, though the dawn auto-enqueue is still
system-initiated and needs the composition check.
