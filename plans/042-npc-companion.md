# NPC Companion (labour + muscle)

> Status: planned — run /execute-plan to begin.

## Summary

Roadmap **Step 5 — the final MVP step** ([docs/ROADMAP.md](../docs/ROADMAP.md)). Add one AI companion
that works the base by **day** (a single reassignable role: **gather** to a base stockpile, or
**repair** damaged walls) and defends by **night** (holds/fights the wave using the monster combat
model; mobs can aggro it, so it can be **downed** and **auto-revives at dawn**). Movement reuses the
worker **A\* + `TaskQueue`**; combat reuses **`resolveMeleeAttack` + the telegraphed `strikeContact`
lunge + the weapon-pin rig**. No recruit quest — the companion is **dev-/scenario-spawned** for MVP.
Player reassigns it through a **click-to-open assignment menu** (a Day section and a Night section),
also driveable from the scenario API.

*Done when:* the NPC gathers (or repairs) by day, fights the wave by night (can be downed, revives at
dawn), and you can switch its role/posture — verified end-to-end by a scenario spec.

## Context & decisions

**Greenfield within a well-seamed codebase** — there is **no existing npc/companion/ally/worker
actor**; the "worker" is currently only `PlayerCharacter`, and `TaskQueue` + `pathfind` carry
"player now, NPC workers later" comments (`pathfind.ts:2`, `tasks.ts:1`). This plan adds a third
`Character` subclass and its manager.

**Locked answers (owner, this planning session):**
- **Day role — one assignable job** toggled between **Gather** (low carry cap) and **Repair walls**.
- **Gather sink = a new `baseSupply` module** anchored at the campfire (shared wood/rock counts),
  **counts-only**, **separate** from the player's carried inventory, shown in the HUD, **no withdraw
  UI**. *(Owner reaffirmed a purpose-built module over reusing `Inventory` — critique #3.)*
- **Repair** = restore HP to damaged wall segments, **consuming wood from the base stockpile** (can't
  repair when empty). Ties the two day roles together economically.
- **Night = holds + fights; mobs can aggro the NPC → it can be downed → auto-revives at dawn.**
  *(Owner chose the fuller "mobs can target the NPC" threat model over invulnerable/contact-only —
  critique #1. This is what makes downed/revive reachable in real play, not just via test seeding.)*
- **Night postures (3): Guard-here point · Follow player · Refuel lights** (the last reuses the
  existing `refuel` action to keep the campfire fed).
- **Assignment menu** with a **Day section + Night section**; opened by **clicking the NPC**, and the
  same setters exposed through the **scenario API**.
- **Spawn: dev hook / scenario only** (auto-spawn-at-start is post-MVP).
- **Full scope retained** — owner reaffirmed all of the above after the critique flagged it as beyond
  the roadmap's minimal Step-5 line (critique #2). Steps are sequenced so the **roadmap spine**
  (gather↔repair + a hold posture + combat) lands and is testable **first**, with the stockpile HUD,
  follow/refuel postures, downed/revive, and the click-menu as later additive steps.
- **Sprite = Pixel Crawler `Rogue`** (`Entities/Npc's/Rogue/{Idle,Run,Death}-Sheet.png`) — an unused,
  on-style, visually **distinct** humanoid (addresses readability critique #7). It is **flip3-shaped
  like the wired skeleton** (Idle 32px×4f, Run 64px×6f, Death 32px×12f, single-orientation, `side`
  mirrored via `flipX`). It has **no attack strip** — but neither does the skeleton; the NPC's attack
  reads via the **weapon-pin rig + `strikeContact` lunge**, exactly as the skeleton's does. The Death
  strip provides the downed/revive visual.

**Critique resolutions folded into the steps below** (full critique in `## Critique`): #1 → Step 6
generalises mob targeting to nearest-threat of `{player, NPC}`; #3 → separate `baseSupply` kept
(Step 3); #4 → NPC combat uses a **dedicated companion stepper**, not a rename of the player-baked
monster FSM (Step 7); #5 → NPC gets its **own slimmed task executor** reusing the pure pieces
(`TaskQueue`/`findPath`/`reachableAdjacent`), the shipped ~350-line player scene-loop is **not
refactored** (Step 4); #6 → scenario spawn + `DebugState` fields land **early** (Step 2) so every
behaviour step has a genuine e2e check; #7 → distinct Rogue sprite (Step 1); #8 → extra postures kept
under the owner's full-scope call.

**Patterns/files to mirror (from research):**
- Entity: `src/entities/Character.ts` (abstract base — owns sprite, `advancePath()`, `isStuck()`,
  `fitBody()`, facing; abstract `moveSpeed()`/`die()`), `PlayerCharacter.ts` (singular authored actor;
  hard-codes `CombatantStats` from `config.ts` constants), `MonsterCharacter.ts` (FSM executor +
  `update(env)` + `strikeContact()` telegraph `:420` + the weapon/hand pin rig, plan 011).
- Sprite wiring: `src/data/tileset.ts` (`ACTIVE_TILESET.actors` — add an NPC entry mirroring the
  `enemy`/skeleton flip3 struct + a `npcAnimKey`), `src/scenes/PreloadScene.ts` (`loadStrip` block,
  `:126-128` for the skeleton), `src/scenes/*/actorAnims.ts` (`anims.create` registration). Keys
  `npc-rogue-{idle,walk,death}` (map the sheet's "Run" to a `walk` state).
- Manager: `src/scenes/world/EnemyManager.ts` — collection + per-frame `update()` that builds a tick
  env, plus the **SHUTDOWN vs reset teardown discipline** (`:94-105`); built in `GameScene.buildWorld()`.
  New `CompanionManager` mirrors it; construct **after** the player (`GameScene.ts:423`).
- Tasks: `src/systems/tasks.ts` (`TaskQueue`, actor-agnostic `Action` union incl. `harvest`,`build`,
  `refuel`,`deconstruct`); the scene's executor loop `beginCurrent`/`completeCurrent`/`runHarvest`/
  `runRefuel` (`GameScene.ts:953-1294`) and the stand-adjacent pattern via
  `reachableAdjacent`+`pathTo` — **reference for the NPC's own executor, not to be refactored**.
  **System-initiated order precedent:** `rearmTrapsAtDawn()` (`GameScene.ts:1294`).
- Pathfind: `src/systems/pathfind.ts` — `findPath`, `reachableAdjacent`; move with `Character.advancePath()`.
- Combat: `src/systems/combat.ts` — `resolveMeleeAttack(attacker,defender,base,rng)`,
  `objectAsDefender`. Monster FSM `src/systems/monsterAI.ts` — `stepMonster` + `MonsterState` +
  `MonsterInputs` (**player-target baked in as `playerPos/playerTile`** — generalised in Step 6).
- Structures: `src/scenes/world/StructureManager.ts` + `WallBehavior.ts`/`CampfireBehavior.ts`;
  `structureManager.structuresOf('wall')`, `wallAt`, `takeDamage`/`thornsOf`; scene helper
  `litHearth()` (`GameScene.ts:1322`) = the fire anchor. Repair needs a new `repair(id, amount)` op
  on `WallBehavior` (mirror `takeDamage`/`deconstruct`).
- Day/night: `SurvivalClock` is the sole emitter of `time:changed` (`{phase,dayCount,cycleMs,tNorm}`),
  subscribed centrally in `GameScene.wireBus()` (`:640`, each `.on` paired with a SHUTDOWN `.off`).
- Config/data: tuning constants in `src/config.ts` (player block `:149`). NPC follows the **player
  pattern** — a named `NPC_*` config block, not a data catalogue.
- Tests: `src/scenes/testApi.ts` (`applyScenario`/`step`/`debugState`, contract-frozen — **append**
  new `DebugState` fields at the END + bump the refactor-tripwire golden `testApi.ts:70-94`),
  `ScenarioSpec` (`testTypes.ts:25-63`), `__test` DEV seams. Mirror `tests/e2e/wave.spec.ts` (plan 038)
  and `tests/e2e/spike-trap.spec.ts` (plan 040). Unit tests use seeded `mulberry32` rng.

## Steps

- [x] **Step 1: `NpcCharacter` entity + Rogue sprite + config** `[inline]`
  - Outcome: Wired Rogue sprite (`NpcState`+`npc` manifest entry in `src/data/tileset.ts`, `npcAnimKey` helper, keys `npc-rogue-{idle,walk,death}`; `loadStrip` in `PreloadScene.ts`; anims in `world/actorAnims.ts`). New `src/entities/NpcCharacter.ts` (3rd `Character` subclass; `moveSpeed`/`die`; carries `MELEE_WEAPONS.cleaver` on the skeleton weapon-pin rig; role/posture/`downed` scaffold defaults). `NPC_*` block in `config.ts` (all placeholder-flagged: HP8/SPD80/VIS×4/CARRY5/windup300/repair400/revive3/hurtbox1×2/weapon `cleaver`). Temp dev seam in `GameScene.ts` (`spawnCompanion`/`spawnNpcNearPlayer`/`tickDevNpc`, `debug:spawnNpc` bus event) — superseded by `CompanionManager` in Step 2. `npcAnimKey` is facing-less (single-orientation, `flipX`) with an ignored `_facing?` for call-site symmetry. `assets:catalog` not needed (actor loader reads strip paths directly). Build/typecheck/lint clean; `npm test` 838 pass.
  - Wire the **Rogue** sprite: add an NPC actor entry to `ACTIVE_TILESET.actors` in `src/data/tileset.ts`
    mirroring the skeleton/`enemy` flip3 struct (states `idle` 4f @32px, `walk`←Run 6f @64px, `death`
    12f @32px; single-orientation, `side` mirrored via `flipX`); add a `npcAnimKey(state,facing)`
    helper + texture-key constants; add a `loadStrip` block to `PreloadScene.ts` (mirror `:126-128`)
    and `anims.create` registration in `actorAnims.ts`. Keys `npc-rogue-{idle,walk,death}`.
  - Create `src/entities/NpcCharacter.ts` as a third `Character` subclass (mirror `PlayerCharacter.ts`
    construction: build the sprite, `scene.physics.add.existing`, pass a `CombatantStats` from a new
    `NPC_*` config block to `super`). Implement `moveSpeed()` + `die()`. Give it a melee weapon from
    `MELEE_WEAPONS` + the **weapon/hand pin rig** (reuse the skeleton's attachment approach) so its
    attack reads without an attack strip. Add role/posture/`downed` state scaffold (day:
    `'gather'|'repair'`; night: `'guard'|'follow'|'refuel'`; `downed:boolean`) — behaviour lands later.
  - Add an `NPC_*` block to `src/config.ts` near the player block: `NPC_MAX_HP`, `NPC_SPEED`,
    `NPC_VISION`, `NPC_HURTBOX`, `NPC_STRENGTH`, `NPC_CARRY_CAP` (low, e.g. 5), `NPC_ATTACK_WINDUP_MS`,
    `NPC_REPAIR_MS`, `NPC_REVIVE_HP`. Flag the numbers as placeholder tuning (comment), per plan 040.
  - Provide a temporary dev spawn seam to place the NPC at a tile (superseded by `CompanionManager`
    in Step 2).
  - Side effects: all `Character` abstract members must be implemented or the build fails. Assets must
    exist under the active pack — verify the Rogue sheet paths before wiring; regenerate the catalog
    (`npm run assets:catalog`) if the loader needs it.
  - Docs: none yet (batched in Step 11).
  - Done when: a dev call spawns the Rogue on the arena map, it renders idle/walk/death anims, and
    `advancePath()` walks it along a hand-set path; `npm run build`/typecheck + lint clean.

- [ ] **Step 2: `CompanionManager` + test scaffolding (early, so downstream steps are testable)** `[inline]`
  - Create `src/scenes/world/CompanionManager.ts` mirroring `EnemyManager`: owns the single
    `NpcCharacter | null`, `spawn(col,row)`, `get()`, `update(delta)` (builds a per-frame tick env),
    and **`reset()` vs `destroy()`** following the SHUTDOWN/physics teardown discipline
    (`EnemyManager.ts:94-105`). Construct in `GameScene.buildWorld()` **after** the player (`:423`);
    call `update()` from `GameScene.update()` and teardown from SHUTDOWN. Route the dev spawn through it.
  - **Scenario + DebugState scaffolding now** (resolves critique #6): extend `ScenarioSpec`
    (`testTypes.ts`) with `companion?: {at:[col,row], dayRole?, nightPosture?, guardAt?, hp?, downed?}`
    and `baseSupply?: {wood?,rock?}`; wire placement in `applyScenario` via `CompanionManager.spawn()`
    (mirror the `enemies` path). **Append** to `DebugState` (at the END): `companion:{col,row,dayRole,
    nightPosture,hp,downed,carry}` and `baseSupply:{wood,rock}`; **bump the refactor-tripwire golden**
    in the same step (`testApi.ts:70-94`). Add `__test` setters `setNpcDayRole`/`setNpcNightPosture`/
    `setNpcGuardPoint` (mirror `rearmTrap`).
  - Side effects: `buildWorld()` order is load-bearing (NPC manager after the player). Add teardown
    symmetrically or the boot canary / scene-restart leaks physics bodies. Golden-snapshot tripwire
    fails the suite if fields aren't appended-at-end + golden bumped — do both together.
  - Docs: none yet.
  - Done when: NPC lifecycle owned by the manager; a scenario can place the NPC and read it back via
    `debugState().companion`; scene restart (boot canary) clean; typecheck + lint + existing tests pass.

- [ ] **Step 3: `baseSupply` stockpile + HUD** `[inline]`
  - Add `src/systems/baseSupply.ts` — a small pure store (`add(item,n)`, `take(item,n)→boolean`,
    `count(item)`) for shared resource counts (`wood`, `rock`), owned by the scene/`CompanionManager`,
    anchored to `litHearth()` as the walk-to deposit tile. Separate from the player `Inventory`
    (owner-reaffirmed, critique #3). Surface counts in the HUD via the existing `UIScene`/registry
    channel (mirror wood/fuel readouts). Reset on `resetWorld()`.
  - Side effects: if no lit hearth exists, deposits still succeed (store is global; the hearth is only
    the walk-to anchor for Step 4).
  - Docs: none yet.
  - Done when: a unit test drives `add`/`take` (incl. `take` failing when empty); HUD shows counts;
    store clears on world reset; `debugState().baseSupply` reflects it.

- [ ] **Step 4: Day role — Gather (own executor → deposit to stockpile)** `[inline]`
  - Give the NPC its **own slimmed task loop** (resolves critique #5 — do **not** refactor the player's
    scene executor): the NPC owns a `TaskQueue` and a small executor that reuses the pure pieces
    (`findPath`, `reachableAdjacent`, the `CHOP_INTERVAL_MS` cadence). When role = `gather`: find the
    nearest harvestable node (reuse `ResourceNodeManager` queries), path adjacent, harvest into a carry
    buffer up to `NPC_CARRY_CAP`, then path to the hearth and **deposit into `baseSupply`**. Repeat
    while day + nodes remain.
  - Side effects: two actors now harvest the same nodes — reuse `isBlocked`/occupancy so they don't
    stack, and keep node depletion consistent (player vs NPC chopping the same node). The NPC must
    **not** touch `GameScene.queue` (the player's) — it owns its own queue.
  - Docs: none yet.
  - Done when: a scenario spawns the NPC in `gather` role by day with nodes present → it chops and
    `debugState().baseSupply.wood` rises; asserted in an e2e spec (scaffolding from Step 2).

- [ ] **Step 5: Day role — Repair walls** `[inline]`
  - Add `repair(id, amount)` to `WallBehavior` (mirror `takeDamage`/`deconstruct`; clamp to `maxHp`,
    update visual). When role = `repair`: NPC scans `structureManager.structuresOf('wall')` for
    `hp < maxHp`, paths adjacent to the most-damaged, repairs on `NPC_REPAIR_MS` cadence **consuming
    wood from `baseSupply`** per tick; if supply empty → go idle (surface nothing). Reuse the Step-4
    executor/stand-adjacent path.
  - Side effects: interacts with the wall siege loop (mobs damage walls at night; NPC repairs by day).
    Repairing a full-HP wall is a no-op (don't thrash pathing). Confirm `WallState.hp/maxHp` fields.
  - Docs: none yet.
  - Done when: a scenario places a damaged wall + NPC in `repair` role by day with wood in supply →
    wall HP climbs toward max and supply wood falls; empty supply → no repair. E2e-asserted.

- [ ] **Step 6: Generalise mob threat-targeting to `{player, NPC}`** `[inline]`
  - Resolves critique #1. Generalise the monster FSM's baked player target: change `MonsterInputs`
    from `playerPos/playerTile/playerBodyTiles/playerStats` to a **list/nearest-threat** abstraction
    (e.g. `threats: {pos,tile,bodyTiles,stats,kind}[]`), and update `stepMonster` acquire/veer/
    de-aggro/chase to pick the **nearest eligible threat within vision**. Update `MonsterCharacter.update`
    so the `chase`+contact damage branch damages **whichever threat it's engaging** (player or NPC),
    and update the env built in `EnemyManager.update()` to supply both. `seek`(fire)/`siege`(wall)
    branches are unchanged.
  - Side effects: **regression-critical** — this touches the shipped wave/combat path. The NPC must be
    excluded from targeting itself and from the player's own auto-target. `seeksFire`/player-preempt
    ordering in `stepMonster` must still hold (a threat present preempts fire-seek exactly as the
    player did). Keep the `MonsterInputs` change minimal + typed so `monsterAI.test.ts` updates are
    mechanical.
  - Docs: none yet.
  - Done when: unit tests — a mob with only the player present behaves as before (regression); with an
    NPC nearer, it acquires the NPC. E2e — a mob adjacent to the NPC deals it damage.

- [ ] **Step 7: NPC night combat + downed + auto-revive** `[inline]`
  - Give `NpcCharacter` a **dedicated companion combat stepper** (resolves critique #4 — a small
    stepper reusing the acquire/chase/contact *shape*, targeting the **nearest live enemy** via
    `EnemyManager` queries; **not** a rename of the player-baked monster FSM). Reuse the telegraphed
    `strikeContact()` wind-up (`NPC_ATTACK_WINDUP_MS`) + `resolveMeleeAttack` + the weapon-pin rig
    from Step 1. NPC takes damage via `takeDamage()` (now reachable, Step 6); at `hp<=0` → **`downed`**
    (stays on field, inert, distinct visual using the Death strip) rather than removed.
  - Auto-revive: on the **dawn `time:changed` edge**, a downed NPC recovers to `NPC_REVIVE_HP` and
    resumes its day role.
  - Side effects: exclude the NPC from being its own/enemy-of-enemy target; ensure a downed NPC is not
    a valid mob threat (Step 6) so mobs don't pile on a corpse.
  - Docs: none yet.
  - Done when: a night scenario with the NPC in a defend posture + wave mobs → NPC attacks & kills
    mobs, can be **downed** by mob damage in real play, and **revives at the next dawn**. E2e-asserted
    (the acceptance no longer depends on force-seeding `hp=0`).

- [ ] **Step 8: Night postures + day/night role switch** `[inline]`
  - Implement the 3 postures: **Guard-here** (hold at a set tile, engage mobs in range, return to post),
    **Follow** (stay near the player, fight alongside — no path-thrash when the player is still),
    **Refuel lights** (path to the lit hearth and issue the existing `refuel` `Action`; reuse
    `runRefuel` semantics). Guard point defaults to the NPC's current tile / nearest wall.
  - Wire the role switch to `time:changed` in `GameScene.wireBus()` (one `.on`, paired `.off` in
    SHUTDOWN, like `WaveDirector`): night → adopt night posture; day → resume day role + revive if
    downed. Must be **idempotent** (a manual `applyClock` jump also fires `time:changed`).
  - Side effects: refuel posture depends on a lit hearth; if none, hold where the fire was.
  - Docs: none yet.
  - Done when: toggling the clock day→night→day flips the NPC between its day role and each posture;
    refuel posture measurably slows fire-fuel decline. E2e-asserted.

- [ ] **Step 9: Assignment menu UI** `[inline]`
  - Add a click/tap handler on the NPC sprite opening a small menu (reuse the `src/ui` kit — `Panel`,
    `Button`, `arrangeColumn`; mirror an existing popover if present) with a **Day section**
    (Gather / Repair) and a **Night section** (Guard here / Follow / Refuel lights). "Guard here"
    enters a one-tap place-the-point mode. Respect input-gating conventions ([docs/CONVENTIONS.md]) +
    the touch-first scheme.
  - Side effects: disambiguate a click on the NPC from world tap handling (build placement, node
    tapping). Close on outside tap / escape. Setters go through the same path as the Step-2 `__test`
    seams.
  - Docs: none yet.
  - Done when: clicking the NPC opens the menu; each option changes behaviour live; works at compact/touch size.

- [ ] **Step 10: Full e2e acceptance spec + unit sweep** `[inline]`
  - Write `tests/e2e/companion.spec.ts` covering the whole loop end-to-end (harness fields already
    exist from Step 2): (a) `gather` → supply rises; (b) `repair` → wall HP climbs / supply falls;
    (c) night posture → NPC fights & kills a wave mob; (d) NPC **downed by real mob damage** → revives
    at dawn; (e) menu/API role switch takes effect. Follow the plan 038/040 spec structure
    (`applyScenario` → `beginWave`/clock control → assert `debugState`). Add/confirm unit tests for the
    new pure logic (`baseSupply`, the `MonsterInputs` threat generalisation, the companion stepper).
  - Side effects: this is the roadmap acceptance gate for Step 5 — it must pass without force-seeding
    the downed state (proves the mechanic engages in play).
  - Docs: none yet.
  - Done when: `npm test` (unit) + the Playwright suite pass, including `companion.spec.ts`; the full
    roadmap acceptance loop is green end-to-end.

- [ ] **Step 11: Docs** `[delegate]`
  - Terse, high-signal updates:
    - `docs/ROADMAP.md` Step 5 — add a **"Progress — DELIVERED by [plan 042]"** block (mirror Step 2/3),
      noting the scope calls: single assignable day role (gather↔repair), separate `baseSupply`
      stockpile, 3 night postures incl. refuel-lights, **mobs-aggro-NPC → downed → auto-revive-at-dawn**,
      Rogue sprite, dev-/scenario-spawn only (recruit quest post-MVP), and flagged placeholder tuning.
    - `docs/STATUS.md` — add an NPC-companion subsystem section (mirror the plan-040 entry).
    - `CLAUDE.md` Status paragraph + the **Next** roadmap arrow — mark NPC ✅ (MVP path complete); note
      the new `CompanionManager`/`NpcCharacter` seam in the `world/` architecture line.
    - `docs/DECISIONS.md` — log the settled calls (separate baseSupply, repair-consumes-supply,
      mobs-aggro-NPC + downed/auto-revive, Rogue sprite, dev-spawn-only, full scope) with dates.
  - Side effects: keep CLAUDE.md a lean index (token-budget rule) — pointers, not prose.
  - Done when: docs reflect the shipped feature; CLAUDE.md/ROADMAP show the MVP path complete.

## Out of scope

- **Recruitment quest / Litrandil** (post-MVP), NPC traits/morale, multiple companions or an
  `NpcDef` catalogue (single authored actor for now).
- **Auto-spawn at game start** (dev-/scenario-spawn only this pass).
- **Withdraw/transfer UI** for the base supply; making it the single shared store (player inventory
  stays separate).
- **Chest buildables** / multiple stockpiles.
- **Numeric feel-tuning** of NPC stats, carry cap, repair rate/cost, gather rate, revive HP — ship as
  flagged placeholders in `config.ts` for a later pass (per the plan-040 convention).
- **New NPC art/rig** — the Rogue sheet ships no attack strip; the attack reads via the weapon-pin +
  lunge (a bespoke NPC attack animation is deferred).

## Critique

> **Verdict:** Well-researched and pattern-faithful, but two things must be resolved before execution
> — the owner-locked "downed → auto-revive" night mechanic is unreachable under the plan's own combat
> rules, and the scope has ballooned well past the roadmap's final-MVP-closing step. **Both resolved
> by owner decision (this session) and folded into the steps above.**

|#|Finding|Severity|Resolution|
|-|-------|--------|----------|
|1|Mobs damage only player/fire/structure; the NPC could never be downed in real play, so downed/revive + its acceptance test only fire by force-seeding `hp=0`.|**High**|**Owner: mobs can aggro the NPC.** Step 6 generalises mob targeting to nearest-of-{player, NPC}; Step 7/10 downed is reachable without seeding.|
|2|Scope exceeds ROADMAP Step 5 (2 day roles + repair economy, 3 postures, stockpile+HUD, downed/revive, click-menu; 11 steps to close the MVP).|**High**|**Owner: keep full scope.** Steps re-sequenced so the roadmap spine lands + is testable first; extras are additive tail steps.|
|3|New `baseSupply` duplicates `Inventory`; dual-wood economy.|Medium|**Owner: keep separate `baseSupply`** (Step 3) for a clean base-vs-carried split.|
|4|"Rename the player-baked FSM" underrates how baked player-targeting is.|Medium|Step 7 uses a **dedicated companion stepper**; Step 6 does the (separate, minimal) mob-side generalisation.|
|5|Worker-driver-vs-slimmed-executor left unresolved; refactoring the ~350-line player loop risks regression.|Medium|Step 4 commits: NPC gets its **own slimmed executor**; the shipped player loop is **not** refactored.|
|6|Acceptance backloaded — Steps 4–7 asserted via `debugState` fields not added until the end.|Medium|Scenario + `DebugState` scaffolding moved **early to Step 2**; every behaviour step now has a real e2e check.|
|7|Art stand-in looked like the enemy wave — hurts night readability.|Low|**Rogue sprite** (Step 1) — distinct, on-style, already in the active pack.|
|8|Follow / Refuel-lights postures exceed the roadmap's "hold near campfire/wall."|Low|Kept under the owner's full-scope call (#2).|
