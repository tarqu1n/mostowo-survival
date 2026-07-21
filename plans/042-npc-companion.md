# NPC Companion (labour + muscle)

> Status: planned — run /execute-plan to begin.

## Summary

Roadmap **Step 5 — the final MVP step** ([docs/ROADMAP.md](../docs/ROADMAP.md)). Add one AI companion
that works the base by **day** (a single reassignable role: **gather** to a base stockpile, or
**repair** damaged walls) and defends by **night** (holds/fights the wave using the monster combat
model; can be downed and auto-revives at dawn). Movement reuses the worker **A\* + `TaskQueue`**;
combat reuses the **monster FSM + `resolveMeleeAttack` + telegraphed `strikeContact`**. No recruit
quest — the companion is **dev-/scenario-spawned** for MVP. Player reassigns it through a
**click-to-open assignment menu** (a Day section and a Night section), also driveable from the
scenario API.

*Done when:* the NPC gathers (or repairs) by day, fights the wave by night, and you can switch its
role/posture — verified end-to-end by a scenario spec.

## Context & decisions

**Greenfield within a well-seamed codebase** — there is **no existing npc/companion/ally/worker
actor**; the "worker" is currently only `PlayerCharacter`, and `TaskQueue` + `pathfind` carry
"player now, NPC workers later" comments (`pathfind.ts:2`, `tasks.ts:1`). This plan adds a third
`Character` subclass and its manager.

**Locked answers (owner, this planning session):**
- **Day role — one assignable job** toggled between **Gather** (low carry cap) and **Repair walls**.
- **Gather sink = a new base-supply stockpile** anchored at the campfire (shared wood/rock counts).
  *Default (override at execution if wanted):* stockpile is **counts only**, **separate** from the
  player's carried inventory, shown in the HUD, **no withdraw UI** for MVP.
- **Repair** = restore HP to damaged wall segments; *default:* **consumes wood from the base
  stockpile** (can't repair when empty). Ties the two day roles together economically.
- **Night = holds + fights, can die → downed → auto-revive at dawn.**
- **Night postures (3): Guard-here point · Follow player · Refuel lights** (the last reuses the
  existing `refuel` action to keep the campfire fed).
- **Assignment menu** with a **Day section + Night section**; opened by **clicking the NPC**, and the
  same setters exposed through the **scenario API**.
- **Spawn: dev hook / scenario only** (auto-spawn-at-start is post-MVP).

**Patterns/files to mirror (from research):**
- Entity: `src/entities/Character.ts` (abstract base — owns sprite, `advancePath()`, `isStuck()`,
  `fitBody()`, facing; abstract `moveSpeed()`/`die()`), `PlayerCharacter.ts` (singular authored actor;
  hard-codes `CombatantStats` from `config.ts` constants), `MonsterCharacter.ts` (FSM executor +
  `update(env)` + `strikeContact()` telegraph at `:420`).
- Manager: `src/scenes/world/EnemyManager.ts` — collection + per-frame `update()` that builds a tick
  env, plus the **SHUTDOWN vs reset teardown discipline** (`:94-105`); built in `GameScene.buildWorld()`.
  New `CompanionManager` mirrors it; construct **after** the player (`GameScene.ts:423`).
- Tasks: `src/systems/tasks.ts` (`TaskQueue`, actor-agnostic `Action` union incl. `harvest`,`build`,
  `refuel`,`deconstruct`); the scene's executor loop `beginCurrent`/`completeCurrent`/`runHarvest`/
  `runRefuel` (`GameScene.ts:953-1294`) and the stand-adjacent pattern via
  `reachableAdjacent`+`pathTo`. **System-initiated order precedent:** `rearmTrapsAtDawn()`
  (`GameScene.ts:1294`).
- Pathfind: `src/systems/pathfind.ts` — `findPath`, `reachableAdjacent`; move with `Character.advancePath()`.
- Combat: `src/systems/combat.ts` — `resolveMeleeAttack(attacker,defender,base,rng)`,
  `objectAsDefender`. Monster FSM `src/systems/monsterAI.ts` — `stepMonster` + `MonsterState`;
  **its acquire/chase target is baked to the player** (`MonsterInputs.playerPos/playerTile`) — the one
  seam to generalise for ally-vs-enemy targeting (see Step 6).
- Structures: `src/scenes/world/StructureManager.ts` + `WallBehavior.ts`/`CampfireBehavior.ts`;
  `structureManager.structuresOf('wall')`, `wallAt`, `takeDamage`/`thornsOf`; scene helper
  `litHearth()` (`GameScene.ts:1322`) = the fire anchor. Repair needs a new `repair(id, amount)` op
  on `WallBehavior` (mirror `takeDamage`/`deconstruct`).
- Day/night: `SurvivalClock` is the sole emitter of `time:changed` (`{phase,dayCount,cycleMs,tNorm}`),
  subscribed centrally in `GameScene.wireBus()` (`:640`, each `.on` paired with a SHUTDOWN `.off`).
- Config/data: tuning constants in `src/config.ts` (player block `:149`); enemy stats in `ENEMIES`
  data. NPC follows the **player pattern** — a named `NPC_*` config block, not a data catalogue.
- Tests: `src/scenes/testApi.ts` (`applyScenario`/`step`/`debugState`, contract-frozen — **append**
  new `DebugState` fields at the END + bump the refactor-tripwire golden `testApi.ts:70-94`),
  `ScenarioSpec` (`testTypes.ts:25-63`), `__test` DEV seams. Mirror `tests/e2e/wave.spec.ts` (plan 038)
  and `tests/e2e/spike-trap.spec.ts` (plan 040). Unit tests use seeded `mulberry32` rng.

## Steps

- [ ] **Step 1: `NpcCharacter` entity + config + dev spawn** `[inline]`
  - Create `src/entities/NpcCharacter.ts` as a third `Character` subclass (mirror
    `PlayerCharacter.ts` construction: build the sprite, `scene.physics.add.existing`, pass a
    `CombatantStats` built from a new `NPC_*` block to `super`). Implement `moveSpeed()` and `die()`.
    Add an `NpcMode`/role state scaffold (day role: `'gather'|'repair'`; night posture:
    `'guard'|'follow'|'refuel'`; plus a `'downed'` flag) — behaviour lands in later steps; this step
    just gets it standing in the world and moving via `advancePath()`.
  - Add an `NPC_*` config block to `src/config.ts` near the player block: `NPC_MAX_HP`,
    `NPC_SPEED`, `NPC_VISION`, `NPC_HURTBOX`, `NPC_STRENGTH`, `NPC_CARRY_CAP` (low, e.g. 5),
    `NPC_ATTACK_WINDUP_MS` (reuse/parallel `ENEMY_ATTACK_WINDUP_MS`). Flag numbers as placeholder
    tuning (comment), following plan 040's config-placeholder convention.
  - Provide a **dev spawn seam** only (no auto-spawn): a `__test`/dev method to place the NPC at a
    tile. Full scenario/menu wiring comes in Steps 8–9; here just enough to see it in the world.
  - Side effects: `Character` abstract members must all be implemented or TS fails the build. Choose
    a sprite/texture already loaded in Preload (reuse the player or a Pixel Crawler actor sheet — do
    **not** add new art this step; note the stand-in like plan 035a's placeholder bow anim).
  - Docs: none yet (batched in Step 10).
  - Done when: a dev call spawns the NPC on the arena map, it renders, and `advancePath()` can walk
    it along a hand-set path without errors; `npm run build`/typecheck + lint clean.

- [ ] **Step 2: `CompanionManager`** `[inline]`
  - Create `src/scenes/world/CompanionManager.ts` mirroring `EnemyManager`: owns the single
    `NpcCharacter | null`, exposes `spawn(col,row)`, `get()`, `update(delta)` (builds a per-frame tick
    env like `EnemyManager.update()`), and **`reset()` vs `destroy()`** following the SHUTDOWN/physics
    teardown discipline (`EnemyManager.ts:94-105`).
  - Construct it in `GameScene.buildWorld()` **after** the player (`:423`) with a deps object of
    scene closures (grid dims, `isBlocked`, structure/queue accessors it will need in later steps).
    Call its `update()` from `GameScene.update()` and its teardown from the SHUTDOWN path.
  - Move the dev spawn seam from Step 1 to route through `CompanionManager.spawn()`.
  - Side effects: `buildWorld()` construction order is load-bearing (managers that must not touch
    player state build before the player; the NPC manager builds after). Add teardown symmetrically or
    the boot canary / scene-restart will leak physics bodies.
  - Docs: none yet.
  - Done when: NPC lifecycle is owned by the manager; spawn + a manual walk still works; scene
    restart (boot canary) is clean; typecheck + lint pass.

- [ ] **Step 3: Base-supply stockpile** `[inline]`
  - Add a **base-supply stockpile** = shared resource counts (at minimum `wood`, `rock`) anchored to
    the campfire, **separate** from the player's carried `Inventory`. Prefer a small pure module
    (e.g. `src/systems/baseSupply.ts` — a tiny store with `add(item,n)`/`take(item,n)→boolean`/
    `count(item)`) owned by the scene or `CompanionManager`, mirroring the `Inventory` system's
    pure-logic style. No withdraw UI (deferred).
  - Surface counts in the HUD via the existing `UIScene`/registry channel (mirror how wood/fuel are
    shown). Keep it minimal — a small readout.
  - Side effects: decide the deposit anchor = `litHearth()` tile. Ensure the store resets on
    `resetWorld()`/scene restart. If no lit hearth exists, deposits still succeed (store is global,
    the campfire is just the walk-to anchor for Step 4).
  - Docs: none yet.
  - Done when: a unit test drives `add`/`take` (incl. `take` failing when empty); HUD shows the
    counts; store clears on world reset.

- [ ] **Step 4: Day role — Gather (deposit to stockpile)** `[inline]`
  - Give the NPC its own day-work loop. Reuse `TaskQueue` + the stand-adjacent
    `reachableAdjacent`+`findPath` pattern. When role = `gather`: the NPC finds the nearest harvestable
    node (reuse `ResourceNodeManager` queries), paths adjacent, harvests on the same
    `CHOP_INTERVAL_MS` cadence, accumulates into a **carry buffer up to `NPC_CARRY_CAP`**, then paths
    to the campfire and **deposits into the base supply** (Step 3). Repeat while day + nodes remain.
  - Reuse the scene's harvest executor logic rather than duplicating it where practical — either
    extract a shared "worker driver" helper parameterised over a `Character`, or give the NPC a
    slimmed executor that calls the same lower-level ops. Prefer the smallest change that avoids
    copy-pasting `runHarvest`.
  - Side effects: two actors now harvest the same nodes — ensure node depletion/occupancy is
    consistent (a node being chopped by the player vs NPC). Reuse `isBlocked`/occupancy so they don't
    stack on the same tile. The NPC must not consume the player's queue (`GameScene.queue`) — it owns
    its own.
  - Docs: none yet.
  - Done when: a scenario spawns the NPC in `gather` role by day with nodes present → it chops and the
    base-supply count rises; asserted via `debugState` (Step 9 adds the fields, but a temporary
    assertion or unit-level check proves it here).

- [ ] **Step 5: Day role — Repair walls** `[inline]`
  - Add a `repair(id, amount)` op to `WallBehavior` (mirror `takeDamage`/`deconstruct`; clamp to
    `maxHp`, update sprite/visual state). When role = `repair`: NPC scans
    `structureManager.structuresOf('wall')` for segments with `hp < maxHp`, paths adjacent to the
    most-damaged, and repairs on a cadence (reuse `BUILD_MS` or a new `NPC_REPAIR_MS`), **consuming
    wood from the base supply per tick/amount** (can't start/continue if supply empty — go idle or
    fall through to gather? *default:* idle + surface nothing; note for tuning).
  - Reuse the same worker-driver/stand-adjacent path as Step 4.
  - Side effects: repair interacts with the wall siege loop (mobs damage walls at night; NPC repairs
    by day) — ensure repairing a wall at full HP is a no-op and doesn't thrash pathing. Confirm
    `WallState.hp/maxHp` is the field to read/write.
  - Docs: none yet.
  - Done when: a scenario places a damaged wall + NPC in `repair` role by day with wood in the supply
    → wall HP climbs back toward max and supply wood falls; empty supply → no repair.

- [ ] **Step 6: Night combat — fight, downed, auto-revive** `[inline]`
  - Give `NpcCharacter` an `update(env)` for night, modelled on `MonsterCharacter.update` + the
    `stepMonster` FSM, but **targeting the nearest live enemy** instead of the player. Generalise the
    FSM's baked target: either (a) parameterise `MonsterInputs` target from `playerPos/playerTile` to a
    generic `targetPos/targetTile` and feed the enemy, or (b) author a small companion stepper reusing
    the same acquire/chase/contact shape. Prefer (a) if it's a clean, low-risk rename; else (b).
  - Reuse the **telegraphed `strikeContact()`** wind-up and `resolveMeleeAttack` for the NPC's
    attacks; the NPC takes damage via `takeDamage()`; at `hp<=0` it enters **`downed`** (stays on the
    field, inert, distinct visual) rather than being removed.
  - Auto-revive: on the **dawn `time:changed` edge**, a downed NPC recovers (full or partial HP —
    *default full*) and resumes its day role.
  - Side effects: enemies currently target the player/fire only — decide whether mobs may also target
    the NPC (*default:* mobs keep targeting player/fire; the NPC engages them, taking contact/attack
    damage when adjacent — do **not** expand mob targeting this step to limit blast radius). Ensure the
    NPC is excluded from being its own target and from the player's auto-target.
  - Docs: none yet.
  - Done when: a night scenario with the NPC in a defend posture + wave mobs → NPC attacks and kills
    mobs, can be downed at 0 HP, and revives at the next dawn.

- [ ] **Step 7: Night postures + day/night role switch** `[inline]`
  - Implement the 3 night postures: **Guard-here** (hold at a set point/tile, engage mobs in range,
    return to post after), **Follow** (stay near the player, fight alongside), **Refuel lights**
    (path to the lit hearth and issue the existing `refuel` action to keep it fed; reuse
    `runRefuel`/the `refuel` `Action`). Guard point defaults to the NPC's current tile / nearest wall
    if none set.
  - Wire the **role switch to `time:changed`** in `GameScene.wireBus()` (one `.on`, paired `.off` in
    SHUTDOWN, exactly like `WaveDirector`/`rearmTrapsAtDawn`): night → adopt the night posture; day →
    resume the day role (gather/repair) + revive if downed.
  - Side effects: on a manual clock jump (`applyClock`) `time:changed` also fires — ensure the switch
    is idempotent. Refuel posture depends on a lit hearth existing; if none, hold near where the fire
    was. Follow posture must not path-thrash when the player stands still.
  - Docs: none yet.
  - Done when: toggling the clock day→night→day flips the NPC between its day role and each of the
    three postures correctly; refuel posture measurably slows fire-fuel decline.

- [ ] **Step 8: Assignment menu UI** `[inline]`
  - Add a click/tap handler on the NPC sprite that opens a small assignment menu (reuse the `src/ui`
    Container kit — `Panel`, `Button`, `arrangeColumn`; mirror an existing popover/menu if one exists)
    with a **Day section** (Gather / Repair) and a **Night section** (Guard here / Follow / Refuel
    lights). Selecting sets the corresponding NPC state; "Guard here" enters a one-tap
    place-the-guard-point mode. Respect the project's **input-gating** conventions
    ([docs/CONVENTIONS.md]) and the touch-first control scheme.
  - Side effects: must not conflict with existing world tap handling (build placement, node
    tapping) — gate so a click on the NPC is disambiguated. Close on outside tap / escape.
  - Docs: none yet.
  - Done when: clicking the NPC opens the menu; each option changes behaviour live; menu works at a
    touch/compact size.

- [ ] **Step 9: Scenario API + DebugState + e2e tests** `[inline]`
  - Extend `ScenarioSpec` (`testTypes.ts`) with a `companion` field (e.g. `{at:[col,row], dayRole?,
    nightPosture?, guardAt?, hp?, downed?}`); wire placement in `applyScenario` via
    `CompanionManager.spawn()` (mirror the `enemies` placement path). Add `__test` DEV setters for day
    role / night posture / guard point (mirror `rearmTrap`/`beginWave`).
  - **Append** companion fields to `DebugState` at the END (e.g. `companion:{col,row,dayRole,
    nightPosture,hp,downed,carry}` and `baseSupply:{wood,rock}`) and **bump the refactor-tripwire
    golden** in the same step (`testApi.ts:70-94`).
  - Write `tests/e2e/companion.spec.ts` covering the acceptance loop: (a) `gather` role by day →
    supply rises; (b) `repair` role → wall HP climbs / supply falls; (c) night posture → NPC fights &
    kills a wave mob; (d) downed at 0 HP → revives at dawn; (e) menu/API role switch takes effect.
    Follow the plan 038/040 spec structure (`applyScenario` → `beginWave`/clock control → assert
    `debugState`). Add unit tests for any new pure logic (base supply, target generalisation).
  - Side effects: the golden-snapshot tripwire will fail the suite if fields aren't appended at the
    end + golden not bumped — do both together.
  - Docs: none yet.
  - Done when: `npm test` (unit) + the Playwright scenario suite pass, including the new
    `companion.spec.ts`; the full roadmap acceptance loop is green end-to-end.

- [ ] **Step 10: Docs** `[delegate]`
  - Update, terse and high-signal:
    - `docs/ROADMAP.md` Step 5 — add a **"Progress — DELIVERED by [plan 042]"** block (mirror the
      Step 2/3 delivered blocks), noting scope calls: single assignable day role (gather↔repair),
      new base-supply stockpile (counts-only, separate from player inv), 3 night postures incl.
      refuel-lights, downed→auto-revive-at-dawn, dev-/scenario-spawn only (recruit quest stays
      post-MVP), and any flagged stand-ins (art placeholder, placeholder tuning numbers).
    - `docs/STATUS.md` — add an NPC-companion subsystem section (mirror the spike-trap/plan-040 entry).
    - `CLAUDE.md` Status paragraph + the **Next** roadmap arrow — mark NPC ✅ (this completes the MVP
      path); note the new `CompanionManager`/`NpcCharacter` seam in the architecture map line for
      `world/`.
    - `docs/DECISIONS.md` — log the settled calls (base-supply shape, repair-consumes-supply,
      downed/auto-revive, dev-spawn-only) with dates.
  - Side effects: keep CLAUDE.md a lean index (token-budget rule) — pointers, not prose.
  - Done when: docs reflect the shipped feature; CLAUDE.md/ROADMAP show the MVP path complete.

## Out of scope

- **Recruitment quest / Litrandil** (post-MVP), NPC traits/morale, multiple companions or an
  `NpcDef` catalogue (single authored actor for now).
- **Auto-spawn at game start** (dev-/scenario-spawn only this pass).
- **Withdraw/transfer UI** for the base supply; making it the single shared store (player inventory
  stays separate).
- **Chest buildables** / multiple stockpiles.
- **Numeric feel-tuning** of NPC stats, carry cap, repair rate/cost, gather rate — ship as flagged
  placeholders in `config.ts` for a later pass (per the plan-040 convention).
- **New NPC art/rig** — reuse an existing loaded sheet; a dedicated companion sprite is deferred.
- **Expanding mob targeting** to actively hunt the NPC (mobs keep targeting player/fire; the NPC
  engages them).
