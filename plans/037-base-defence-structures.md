# Base-Defence Structures — Destructible Walls, Gate & Spike Trap

> Status: planned — run /execute-plan to begin.

## Summary

Add the three base-defence buildables the night wave will be defended with: **destructible walls**,
a **gate** (walkable by the player/NPC, blocking to mobs), and a **spike trap** (a trigger-once
damage tile re-armed each morning). All three land on the existing `BuildManager`/`BUILDABLES` +
placement spine; the enabling move is generalising the campfire's bespoke runtime into a reusable
**`StructureManager` + behavior-module registry** (the architecture decision explicitly triggers this
"when buildable #2 with a `behavior` field lands" — walls/gate/trap are buildables #2/#3/#4). Enemy
target-selection gains a **structure seam** so a walled-off mob attacks the blocking wall; that same
seam is what the deferred night wave (roadmap Step 2) will reuse. Art is the CraftPix `craftpix-dungeon`
`Traps/Barricades/*` (walls + gate) and `Traps/Spikes/*` (trap).

**Milestones** (natural stopping points across the steps): **①** Step 1 — StructureManager foundation
(campfire migrated, no behaviour change). **②** Step 2 — art curation (pick the wall/gate/trap sprites
from the CraftPix set). **③** Steps 3–5 — destructible walls (data+art → player damages them → enemy
attacks a blocking wall). **④** Step 6 — gate. **⑤** Steps 7–8 — spike trap + re-arm loop. **⑥** Step 9
— scenario API, tests, tripwire, docs.

## Context & decisions

**Direction (ROADMAP.md / GAME-DESIGN.md):** roadmap Step 3 is "one trap", deliberately sequenced
*after* the night wave (Step 2) so it could be tuned against real wave pathing. This plan **pulls
defence structures ahead of the wave** at the user's request — the reasoning being that a wave needs
something to defend *with*. Consequence, locked: we build and **deterministically unit/scenario-test
the mechanics now** (structure HP, destruction, gate filtering, trap trigger, re-arm); **final numeric
tuning** (wall HP vs wave DPS, funnel width, trap damage) is **deferred to when the live wave exists**.
GAME-DESIGN "Traps": traps are *multipliers on walls* (funnel the wave into a kill-channel) and the two
committed rules — **trigger-once + re-armed by a queued worker order each morning** (reuse the
`refuel` order pattern), placed in the day phase at scarce cost.

**Locked design decisions (from planning):**

1. **Walls are destructible** (mobs can break through) — *not* indestructible-with-funnel-gap. Reverses
   the `buildables.ts:8` "indestructible this slice" code comment (a comment, not a settled decision —
   free to reverse).
2. **Gate = ally-permeable destructible barrier.** Always walkable by player/NPC, always blocking to
   mobs (a per-faction pathing filter), breakable like a wall. **No open/close toggle.**
3. **Spike trap = trigger-once, spent after firing, re-armed each morning** by a queued worker order
   (mirrors campfire refuel). Not always-on, not cooldown.
4. **Enemy dependency handled by "model + seam + scripted-enemy tests".** Build structure HP/destruction
   + a generic enemy structure-target seam now, proven via scenario-API scripted enemies; the full
   night-wave AI stays deferred. The seam is written generically (structure / player / future fire) so
   Step 2 (wave) wires into it rather than reworking it.
5. **This triggers the StructureManager generalisation now** (architecture decision, see below) — walls,
   gate and trap are behavior-modules, not three more bespoke managers.

**Key files & patterns to mirror (from repo sweep):**

- **Placement lifecycle:** `BuildManager.tryPlaceAt` (`src/scenes/build/BuildManager.ts:187`) →
  `createBlueprint` (`:207`) → worker `build` order → `GameScene.runBuild` (`GameScene.ts:942`) →
  **`BuildManager.finishSite` (`:247`)**. `finishSite` is the branch point: `blocksPath ?? true` adds
  the tile to the `walls` StaticGroup + `occupied` set (BuildManager is the **sole pathing/collision
  writer**); then `if (def.behavior)` → `deps.materialiseBuildable(site)` (live), else static-tile
  render via `resolveTile(ACTIVE_TILESET.tiles.wall)`.
- **The campfire route to generalise:** `materialiseBuildable: (site) => this.campfireManager.materialise(site)`
  (`GameScene.ts:383`) — hardcoded; becomes a `StructureManager` dispatch on `def.behavior`.
- **Model live buildable:** `src/scenes/world/CampfireManager.ts` — `materialise(site)` (`:88`),
  per-frame `tick(delta)` (`:144`), `lightSources()` (`:233`, the behavior-neutral light seam),
  `campfireById` (`:267`), and the **`reset()` (runtime, destroys sprites) vs `destroy()` (shutdown,
  drops refs only)** discipline (`:63–69`, `:297`, `:314`) — every new manager copies this.
- **Buildable data:** `src/data/buildables.ts`, `BuildableDef extends ObjectStats` (`types.ts:97`).
  `ObjectStats` gives `{maxHp, armour, speed, activationRange?}` — **`activationRange` (`types.ts:52`)
  exists and is documented "proximity trigger (traps etc.), unused this slice"** → the trap uses it.
  `maxHp` is currently display-only.
- **Pathfinding:** `findPath` (`src/systems/pathfind.ts:82`, 8-connected octile, `reachableAdjacent`
  `:158`). Impassability flows through the **`GameScene.isBlocked` composite** (`GameScene.ts:723`) =
  `buildManager.isOccupied || hasBlockingNode || decorManager.blocksAt || mapBlocks`. **No faction/owner
  concept on pathing today** — enemies call `findPath(..., env.isBlocked, ...)` with the *same*
  predicate as the player's worker (`MonsterCharacter.ts:279`). The gate needs a **split predicate**:
  a `mobIsBlocked` variant (gate = blocked) fed into `MonsterTickEnv.isBlocked` (built in
  `EnemyManager.ts:154`), while the player/worker predicate treats gate tiles passable.
- **Combat/damage:** `resolveMeleeAttack(attacker, defender, baseDmg, rng)` (`src/systems/combat.ts:28`)
  → `damageTaken = max(0, base+strength-armour)`. `defender` is `CombatantStats`; a structure is
  `ObjectStats` (no `strength/dex/dodge`) → needs a small **ObjectStats-as-defender adapter** (or widen
  the defender type). HP + `takeDamage` live on `Character` today; **`BuildSite` has no `hp`/`takeDamage`**
  — the runtime structure record gains them. Hurtbox helpers (`src/systems/hurtbox.ts`) are pure and
  reusable. **Plan 036 (weapon-reach-arc, tile-space `attackTiles`) is PLANNED, not executed** — hook
  structure damage into today's single-tile `GameScene.attack()` and leave a comment to fold into 036's
  `attackTiles` when it lands.
- **Enemy AI:** `src/scenes/world/EnemyManager.ts` + `src/entities/MonsterCharacter.ts` +
  `src/systems/monsterAI.ts` (`stepMonster` `:251`). Attack today is a **proximity contact-bite vs the
  player only** — `MonsterTickEnv` (`:57–78`) carries only player targets; the telegraphed wind-up/strike
  block (`MonsterCharacter.update` `:235`, `:249–265`) is fully reusable, **only target-selection changes**.
- **Scenario/test API:** `src/scenes/testApi.ts` — `applyScenario(spec)` (`:230`) places walls via
  `finishSite(createBlueprint(c,r,'wall'))` (`:270`), campfires via the `behavior` route (`:275`),
  enemies via `addEnemy` (`:299`, accepts `{at,id,mode,weaponId,patrolRoute}`); `step(ms)` (`:335`)
  drives deterministic 1/60s slices; clock seeding `setClockMs`/`setDayPhase`/`setDayCount`
  (`:308–318`). **Three tiers** (`docs/testing.md`): Tier-1 Vitest units, Tier-2 Playwright scenarios
  (`tests/e2e/*.spec.ts`, helpers `tests/e2e/harness.ts`), Tier-3 boot canary (`npm run smoke`).
  **`DebugState` tripwire** (`testApi.ts:35–81`, serializer `:394`): `refactor-tripwire.spec.ts`
  deep-equals a golden snapshot — **new fields go at the END** and require editing `testApi.ts` +
  `harness.ts` + the golden together.
- **Worker order pattern (→ trap re-arm):** `src/systems/tasks.ts` action union
  (`move|harvest|build|refuel`). The **`refuel` order is the template**: `enqueue({kind:'refuel',...})`
  (`GameScene.ts:851`) + `isRefuelQueued`/`toggleRefuel` (`:881`,`:888`); `beginCurrent` refuel branch
  (`:802`, resolves target + `reachableAdjacent` stand tile + `pathTo`); `runRefuel` executor (`:969`,
  **condition-terminates** — "topped up" or bag dry — not on target death); dispatch switch (`:698–711`);
  `describeActionTarget` (`:238`).
- **Art/rendering:** static buildables `resolveTile(source)` (`tileset.ts:574`); `TileSource` (`:36`)
  = `{kind:'image',path}` | `{kind:'sheetFrame',sheet,frame}`. Animated buildables use manifest
  `stations.*` StripAnims + key helpers (campfire flame = `Fire_01-Sheet.png`, sheet-swap in
  `applyFlame`). **Cross-pack loading precedent:** the boar loads from a different pack via a `pack`
  field (`tileset.ts:143`, `DirectionalEnemyActor.pack`) — the CraftPix barricades/spikes are
  `craftpix-dungeon`, not the active `pixel-crawler`, so they load the same cross-pack way.
- **Art candidates (catalogued in `public/assets/asset-catalog.json`, pack `craftpix-dungeon`, tileSize 16)
  — the final per-role pick is made in Step 2, not assumed here:**
  - Walls/gate → the `Traps/Barricades/` set: `{D,S,U}_{1..4}` (down/side/up facing × 4 style variants),
    each with a `_Build` and `_Destroy` companion (idle strips ~432×64, build/destroy ~216×64). **MVP uses
    front-facing `D_` only**; per-orientation (`S`/`U`) auto-orient is deferred. Wall vs gate must be two
    **visually distinct** variants. Fallback for the gate only if no barricade reads as one:
    `fantasy-tileset/Buildings/CityWall_Gate_1.png`.
  - Trap → the `Traps/Spikes/` set (`1..4`, ~192×32 animated extend/retract; armed-idle / trigger / spent).
  - **Not this plan** (same folder, noted so Step 2 records them for later): `Traps/Lightning`,
    `Traps/Barrel` (+ `Boom`), `Traps/Barricades/Archer` (turret with `Arrow` projectile).
  - Exact frame slicing (frame widths/counts for the multi-frame sheets) is resolved in Step 2 from the
    sheet dims + catalog `regions`/`frames`, so Step 3 consumes concrete numbers.
- **StructureManager generalisation (the load-bearing call):** `docs/decisions/architecture.md:42–72`
  (indexed `DECISIONS.md:97`) — *"Buildable runtime stays bespoke for now; generalise on buildable #2…
  a `StructureManager` owning a homogeneous `PlacedStructure[]` + a behavior registry
  (`register(behaviorId, module)`), each module with narrow deps + optional capability methods
  (`tick`/`onTap`/`light`/`stats`); `CampfireManager` dissolves into the first behavior module;
  `CampfireUnit → PlacedStructure`."* Already-neutralised seams that help: `lightSources()` (not
  `litCampfires`), the `behavior`-not-`animKey` discriminant, `campfireById` tolerating destroyed fires.

## Steps

- [ ] **Step 1: StructureManager generalisation — migrate the campfire** `[inline]`
  - Add `src/scenes/world/StructureManager.ts` owning `PlacedStructure[]` and a behavior registry:
    `register(behaviorId, module)` called in `GameScene.buildWorld()`. `PlacedStructure` = generic
    runtime record `{id, buildableId, behavior, col, row, hp, maxHp, sprite?, ...behaviorState}`
    (`CampfireUnit` collapses into it). A behavior module interface exposes **optional** capability
    methods: `materialise(site, struct)`, `tick(delta)`, `onTap(struct)`, `lightSources()`, `stats(struct)`,
    `reset()`, `destroy()`. `StructureManager.materialise(site)` dispatches on `def.behavior`.
  - Move all CampfireManager logic into a `campfire` behavior module (keep the file or relocate under a
    `structures/` folder — match existing `world/` layout). Preserve behaviour exactly: fuel drain,
    `lit` flips, `applyFlame` sheet-swap, `lightSources()`, `feedOne`/`feedAt`, `campfireById`.
  - Rewire: `materialiseBuildable` closure (`GameScene.ts:383`) → `structureManager.materialise(site)`;
    the scene's `tick` call; `lightSources()` consumers (SurvivalClock + VisionController) → aggregate
    over structures; `ScenePicker` tap routing → `structureManager` (keep campfire refuel-tap working);
    the refuel order's `campfireById` → `structureById`; `testApi.ts:275` campfire creation.
  - Copy the CampfireManager `reset()` (runtime, destroys sprites) vs `destroy()` (shutdown, drops refs)
    discipline verbatim.
  - Side effects: `GameScene.buildWorld` wiring; `SurvivalClock`/`VisionController` light route;
    `ScenePicker`; refuel order (`GameScene.ts:802`,`:969`); `testApi.ts` (campfire path); anything
    importing `CampfireManager` directly.
  - Docs: `docs/decisions/architecture.md` — mark the generalisation done (note the trigger fired here);
    `docs/STATUS.md` — StructureManager landed.
  - Done when: game boots; campfire builds, lights, drains, douses, and refuels **identically**; full
    Tier-1 + Tier-2 suites and `npm run smoke` pass; `refactor-tripwire` golden **unchanged** (no new
    `DebugState` field this step).

- [ ] **Step 2: Curate & choose the barricade / spike art assets** `[inline]`
  - Visually review the CraftPix candidates so the roles are pinned before any rendering code is written.
    There are lots of barricades (`{D,S,U}_{1..4}` × build/destroy) — don't pick blind. Render/inspect the
    sprites: prefer the repo's preview path (check `docs/README.md` art-pipeline + `scripts/` for a sheet
    previewer / contact-sheet tool; the guppi widget-shots harness is a *separate* repo — do not reach for
    it) and otherwise `Read` the PNGs directly under
    `public/assets/tilesets/craftpix-dungeon/Traps/{Barricades,Spikes}/`.
  - Decide and **record** (see Docs): (a) which barricade variant is the **wall** and which distinct
    variant is the **gate** — they must read as clearly different; (b) confirm the **spike** variant for the
    trap; (c) confirm **front-facing `D_` only** for MVP (walls/gate render one facing); (d) for each chosen
    sheet, the **exact frame slicing** — frame width, frame count, and which frames are build / idle /
    damage-stages / destroy (idle strips ~432×64, build/destroy ~216×64, spikes ~192×32; cross-check the
    catalog `regions`/`frames` and the pack `tileSize` 16). This removes all "start with X, swap later"
    guesswork from Steps 3/6/7.
  - Note the deferred siblings in the same folder (`Lightning`, `Barrel`+`Boom`, `Barricades/Archer` turret
    + `Arrow`) as catalogued future defence art so a later session doesn't re-discover them.
  - Side effects: none (no code) — pure decision + asset verification. Independent of Step 1, so it can be
    done first or alongside it.
  - Docs: create/extend an art-mapping note (an art-decisions shard under `docs/decisions/` or the art
    section referenced from `docs/README.md`) capturing the wall/gate/trap → file mappings, frame slicing,
    the front-facing-only MVP simplification, and the deferred siblings. This shard is the single source
    Step 3 (and later steps) reads the exact asset paths + frame data from.
  - Done when: the art shard names the exact wall, gate, and trap sprite files with verified frame slicing,
    and the wall/gate variants are confirmed visually distinct — enough that Step 3 needs no further art
    judgement.

- [ ] **Step 3: Destructible-wall data + CraftPix barricade art** `[inline]`
  - Rework `wall` in `src/data/buildables.ts`: add `behavior:'wall'` (now a live structure), keep
    `cost {wood:2}`, set a real `maxHp` (placeholder **40**, flagged for wave-time tuning), keep
    `blocksPath:true`. Add `animKey`/art references for the **wall barricade sprite chosen in Step 2**.
  - Register the cross-pack CraftPix barricade art (the idle/build/destroy sheets picked in Step 2)
    following the boar `pack`-field precedent (`tileset.ts:143`); add StripAnim manifest entries + key
    helpers mirroring the campfire flame setup, using the **frame slicing recorded in Step 2's art shard**
    (no re-deriving here). Ensure the **Preload** scene loads the new sheets.
  - Add a `wall` behavior module (StructureManager): on `materialise` play the **Build** anim → settle
    on the intact idle frame; expose a `takeDamage`/hp-stage render hook (used in Step 4) that swaps to a
    more-damaged idle frame as hp drops; on destruction play **Destroy** anim then remove.
  - `finishSite`: walls now take the `behavior` (live) route instead of the static-tile render — verify
    the static-wall branch is no longer used by `wall` (campfire is still the only other behavior).
  - Side effects: `src/data/tileset.ts` manifest; `Preload` asset list; `finishSite` branch usage;
    editor palette (walls may appear in the Map Builder — confirm nothing assumes the static render).
  - Docs: `docs/STATUS.md`; the art mapping already lives in Step 2's art shard — reference it, don't
    duplicate.
  - Done when: placing a wall in-scene plays the build animation and stands as a barricade sprite; a
    scenario can read the wall's `hp`/`maxHp`.

- [ ] **Step 4: Player can damage & destroy structures** `[inline]`
  - Give `PlacedStructure` a `takeDamage(amount)` and `hp`. Add an **ObjectStats-as-defender adapter**
    so `resolveMeleeAttack` accepts a structure (wrap `ObjectStats` with zeroed `strength/dex/dodge`, or
    widen the defender type in `combat.ts` — prefer the adapter to keep `combat.ts` pure and unchanged).
  - Extend `GameScene.attack()`: after the existing enemy-tile resolution, if the struck tile(s) hold a
    structure, apply damage via the adapter; on `hp<=0` call the structure's destroy (play Destroy anim,
    free the `occupied` tile through BuildManager, `repath()`). Leave a comment to fold this into plan
    036's `attackTiles` generator when 036 lands (today: single tile `feet+lastFacing`).
  - Side effects: `src/systems/combat.ts` (only if widening — prefer adapter in the structure layer);
    `GameScene.attack`; BuildManager occupied-tile release + `repath`.
  - Docs: none beyond STATUS if notable.
  - Done when: Tier-2 scenario — player attacks a wall repeatedly → `hp` drops per hit → wall destroyed
    → its tile becomes passable (assert via `state()` + a pathing check).

- [ ] **Step 5: Enemy attacks a blocking wall (structure target seam)** `[inline]`
  - Extend `MonsterTickEnv` with a generic **structure-target** channel + an `attackStructure(id, dmg)`
    callback (mirror `damagePlayer`). Written generically for structure / player / (future) fire so the
    night wave reuses it.
  - In `MonsterCharacter.update`/`monsterAI.stepMonster`: when a chasing enemy's `findPath` to the player
    returns `null` (walled off) — or a structure blocks the next step toward the target — select the
    adjacent blocking structure and **reuse the existing telegraphed wind-up/strike block** to damage it;
    on destruction the enemy repaths through. Keep the change minimal and target-selection generic.
  - Side effects: `EnemyManager.update` env construction (`EnemyManager.ts:154`); `monsterAI` FSM (add a
    "blocked → attack structure" transition if needed); `MonsterTickEnv` type.
  - Docs: `docs/STATUS.md`; note in the architecture/decisions log that this seam is the wave's future
    attack-target hook (avoids reworking it in roadmap Step 2, the night wave).
  - Done when: Tier-2 scenario — enemy spawned walled off from the player attacks the wall, destroys it,
    then reaches the player (assert wall hp→0 then enemy contact), driven by `step()` only.

- [ ] **Step 6: Gate — ally-permeable destructible barrier** `[inline]`
  - New `gate` buildable in `buildables.ts` (`behavior:'gate'`, or a `wall`-behavior flag `passableToAllies`
    — prefer a distinct `gate` entry for clarity), cost + `maxHp` set, destructible (reuses Steps 4–5),
    art = the **distinct gate barricade variant chosen in Step 2**.
  - Introduce the **split blocked predicate**: keep player/worker `GameScene.isBlocked` treating gate
    tiles as passable, and build a `mobIsBlocked` variant (gate tiles = blocked) fed into
    `MonsterTickEnv.isBlocked` (`EnemyManager.ts:154`). BuildManager `occupied` stays the single writer;
    the exemption is applied in the predicate layer, not by removing the gate from `occupied` (so combat
    still targets it). Document the two predicates clearly.
  - Side effects: `GameScene.isBlocked` composite + new `mobIsBlocked`; `EnemyManager` env; ensure the
    player's own pathing (worker A*) uses the ally predicate; Vision/lighting unaffected.
  - Docs: `docs/STATUS.md`; a decisions note on introducing per-faction pathing (first faction split).
  - Done when: Tier-2 scenario — player/worker paths through a gate tile; an enemy treats it as a wall
    (paths around, or attacks it via Step 5); once the gate is destroyed, both pass freely.

- [ ] **Step 7: Spike trap — trigger-once damage tile** `[inline]`
  - New `spike_trap` buildable: `behavior:'trap'`, `blocksPath:false`, cost set, damage placeholder
    (flagged for wave-time tuning), art = the **spike variant chosen in Step 2** with **armed-idle /
    trigger / spent** states (sheet-frame swap like the campfire flame). Use the existing `activationRange`
    field or exact same-tile detection.
  - Trap behavior module `tick`: query enemy tile-occupancy (via `EnemyManager`); when an enemy enters an
    **armed** trap's tile → play the trigger anim, apply damage to that enemy (adapter/`resolveMeleeAttack`
    or flat), set `armed=false` and show the spent visual. One trigger = one hit. Deterministic under `step()`.
  - Side effects: `EnemyManager` enemy-tile query helper (add if absent); damage application path;
    placement allowed in the day/base phase (mirror any campfire base-zone/placement rules as needed —
    trap is *not* `baseOnly`, it lines the funnel).
  - Docs: `docs/STATUS.md`.
  - Done when: Tier-2 scenario — place a trap, script an enemy onto its tile → enemy takes damage and the
    trap becomes **spent** (assert enemy hp drop + trap `armed=false`).

- [ ] **Step 8: Trap re-arm order + dawn auto-enqueue** `[inline]`
  - Add a `rearm` action to `src/systems/tasks.ts` (extend the union), mirroring `refuel`: `enqueue({kind:'rearm', trapId})`
    + `isRearmQueued`/`toggleRearm` de-dupe helpers; a `beginCurrent` rearm branch (resolve `structureById`
    the trap, `reachableAdjacent` stand tile, `pathTo`); a `runRearm` executor that **condition-terminates**
    when the trap is armed (like "topped up"). Tapping a **spent** trap queues a rearm order (`ScenePicker`).
  - Dawn hook: at the day-phase (dawn) transition (`SurvivalClock`/`systems/daynight.ts`), auto-enqueue a
    `rearm` order for every spent trap ("re-armed each morning").
  - Side effects: `tasks.ts` action union; `GameScene` dispatch switch (`:698–711`) + `describeActionTarget`
    (`:238`); `ScenePicker` tap; `SurvivalClock` dawn transition; make sure `rearm` interacts sanely with
    `build`/`refuel` queueing.
  - Docs: `docs/STATUS.md`; note the re-arm daily-loop is live (GAME-DESIGN "traps re-armed each morning").
  - Done when: Tier-2 scenario — trigger a trap (spent), `setDayPhase`/`step` to dawn → a rearm order is
    auto-enqueued → the worker re-arms it → trap `armed=true` again.

- [ ] **Step 9: Scenario API surface, tests, tripwire & docs** `[inline]`
  - `testApi.ts`: add scenario spec fields for `traps` and `gate` (walls already place via the existing
    `walls` field and are now destructible-agnostic); expose new `DebugState` fields (e.g. `structures`
    with hp, `traps` with `armed`) **appended at the END** of the interface + serializer (`:394`), and
    update `tests/e2e/harness.ts` + the `refactor-tripwire` golden together (intentional golden bump).
  - Tests: Tier-1 pure tests for any new pure logic (e.g. the ObjectStats-as-defender adapter, structure
    hp-stage frame selection); consolidate the Tier-2 scenario specs from Steps 4–8. Confirm `npm run smoke`.
  - Docs: `docs/ROADMAP.md` — mark Step 3 (trap) delivered, note it (+ walls/gate) was pulled ahead of the
    night wave and that numeric tuning is deferred to Step 2; `docs/STATUS.md`; `docs/GAME-DESIGN.md` /
    `docs/DECISIONS.md` touch-ups if the built behaviour refines the design; CLAUDE.md Status line if warranted.
  - Side effects: the tripwire golden is the main gotcha — update it deliberately, not reflexively.
  - Done when: all three tiers green (Vitest units, Playwright scenarios, boot canary) and the tripwire
    passes against the intentionally-updated golden.

## Out of scope

- **The night wave itself** (roadmap Step 2) — enemies pathing to the fire, wave spawns/escalation,
  fire-heart defense, loop-close. Only the reusable enemy structure-target *seam* is built here.
- **Final combat/tuning numbers** — wall HP vs wave DPS, funnel width, trap damage/cost economy; tuned
  once the live wave exists.
- **Directional wall orientation** (side/up `S`/`U` barricade art, auto-orient by neighbours) — MVP uses
  front-facing `D_` only.
- **Gate open/close toggle**, multiple gate widths, gate-as-interactable.
- **Additional traps** (snare/bear trap, bait/lure, fire trap, barrel, lightning, Archer barricade turret)
  — assets exist (`Traps/{Spikes,Lightning,Barrel,Barricades/Archer}`) but only the spike trap ships now.
- **Plan 036 (weapon reach/arc)** — structure damage hooks into today's single-tile attack; folding into
  `attackTiles` happens when 036 lands.
- **Line-paint trap placement UX** (mobile) and **crafting-station gating** of defence buildables.
