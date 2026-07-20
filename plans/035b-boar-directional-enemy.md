# The Boar — a 4-Way Directional Enemy

> Status: deployed
> Split from plan 035 after critique. **Depends on plan 035a** (the combat control cluster, bow, monster
> HP bars, dev spawn button, and telegraphed-enemy pattern must already exist — the boar plugs into them).

## Summary

Adds the CraftPix **boar** as a second enemy and, to do it properly, generalizes the enemy actor pipeline
from today's 3-way-plus-flip single skeleton to support **4-way directional creatures** (up/down/left/right,
distinct left & right sheets). The boar gets a **real telegraphed attack** from its actual Attack sheet
(richer than 035a's coded skeleton wind-up), and becomes the **default dev spawn**. The skeleton stays as a
regression anchor.

Design source of truth: [GAME-DESIGN.md](../docs/GAME-DESIGN.md) "Player combat — the danger verb";
[ROADMAP.md](../docs/ROADMAP.md) step 1.

## Context & decisions

**Locked (plan 035):** boar *joins* (doesn't replace) the skeleton and becomes the default dev spawn.

**Critique fix carried in (plan 035 critique #4, Medium):** pin the actor **type model up front** (Step 1) —
an actor discriminator on `EnemyDef` + an id-keyed directional-actor map — so this isn't a hacked branch.

**Key findings (mirror these):**
- **Boar asset — already cataloged.** `asset-catalog.json` (~72–95) has all 24 sheets; files at
  `public/assets/tilesets/craftpix-creatures/Boar/<Action>_<dir>.png`, all **32px square frames**: Idle 4,
  Walk 6, Run 5, Attack 5, Hurt 4, Death 6; dirs down/left/right/up. NOT in any manifest/`ENEMIES` yet. ⚠️
  actor strips load **statically** in `PreloadScene` (`:106-130`) — the boar's strips must be added there or
  a dev spawn has no resident texture.
- **Enemy actor pipeline is 3-way + flip, single global `actors.enemy`:** `registerActorAnims`
  (`actorAnims.ts:24`, enemy branch `:53-85` = 3 non-directional keys `enemy-walk/idle/death`,
  `tileset.ts:517-523`). `MonsterCharacter` (`entities/MonsterCharacter.ts`) hardcodes
  `ACTIVE_TILESET.actors.enemy`, fakes facing by `setFlipX(vx<0)` (`:264`), and has a weapon/hand rig
  (`:281-333`) the boar doesn't need. `TilesetManifest.actors` is a fixed `{player, enemy}` struct
  (`tileset.ts:157-166`).
- **`EnemyDef`** (`src/data/types.ts:125`) extends `CombatantStats` (+ id/name/color/weaponPool?); **no
  facing or actor field today** — that's the discriminator to add. Defs live in `src/data/enemies.ts`
  (`kidZombie` only, `:8`).
- **No FSM attack state** (`MonsterMode` `monsterAI.ts:22`); 035a introduced a caller-side wind-up in
  `MonsterCharacter` — the boar reuses that mechanism but plays its **real Attack anim** as the tell.
- **Dev spawn button** exists from 035a Step 4 (`debug:spawnEnemy` → `spawnEnemyNearPlayer`, currently
  spawns `kidZombie`).
- **Tests:** `applyScenario` enemies accept `{at,[id],...}` (`testTypes.ts:25`); mirror `combat.spec.ts` +
  `monster.spec.ts`. ⚠️ `DebugState` field order is a contract — append new fields at END + update the
  `refactor-tripwire` snapshot in the same step (boar-specific counters read 0 in the skeleton golden world —
  verify).

## Steps

- [x] **Step 1: Directional-enemy actor type model** `[inline]` — resolves critique #4
  - Outcome: `src/data/tileset.ts` — added `Facing4` + `DirEnemyState` types, `DirectionalEnemyActor`
    interface (render + idle/walk/run/attack/hurt/death, each `Record<Facing4, StripAnim>`), a
    `directional: Record<string, DirectionalEnemyActor>` field on `TilesetManifest.actors` (empty `{}`
    in `PIXEL_CRAWLER_TILESET`), and a `dirEnemyAnimKey(id, state, facing)` helper (`enemy-<id>-<state>-<facing>`).
    `src/data/types.ts` — added optional `EnemyDef.actorKind: 'flip3' | 'dir4'` (omitted ⇒ flip3, so
    `kidZombie`/skeleton untouched). Doc: directional-enemy discriminator pattern in `docs/CONVENTIONS.md`.
    No behaviour change. Verified: typecheck adds 0 new errors (only the pre-existing tsconfig `baseUrl`
    deprecation), full vitest suite 802/802 green (incl. monster.spec + data.test), refactor-tripwire e2e
    green, eslint + markdownlint clean.
  - Define the type model before wiring any boar: add an **actor discriminator to `EnemyDef`** (e.g.
    `actorKind: 'flip3' | 'dir4'` or an `actor` ref) so a def selects its rendering path; add an **id-keyed
    directional-actor map** to `TilesetManifest.actors` (a `Record<Facing4, StripAnim>` per state:
    idle/walk/run/attack/hurt/death) alongside the existing `enemy` struct. **Keep the skeleton on its global
    `enemy-*` keys and flip3 path unchanged.** No behaviour change yet — just the types + manifest entry
    shape, compiling, with the skeleton untouched.
  - Side effects: `TilesetManifest`/`ACTIVE_TILESET` consumers; `EnemyDef` consumers must default to the
    skeleton's kind so `kidZombie` is unaffected.
  - Docs: capture the directional-enemy-actor pattern in [CONVENTIONS.md](../docs/CONVENTIONS.md) if reusable.
  - Done when: types compile, skeleton renders/behaves identically (refactor-tripwire + `monster.spec.ts`
    green), and a boar manifest entry can be expressed (even if not yet loaded).

- [x] **Step 2: Wire the boar as a directional enemy** `[inline]`
  - Outcome: `src/data/enemies.ts` — added `ENEMIES.boar` (`actorKind:'dir4'`, maxHp 5, speed 70 > zombie's
    45, vision 100, strength 2, hurtbox `{2,1}` wide/short, no weaponPool). `src/data/tileset.ts` — added a
    `pack` field to `DirectionalEnemyActor` (boar lives in `craftpix-creatures`, not pixel-crawler), a
    `boarStrips` builder + the `directional.boar` manifest entry (render scale 1 / originY 0.82; Idle 4 /
    Walk 6 / Run 5 / Attack 5 / Hurt 4 / Death 6 × 4 dirs), and moved the pure `facing4FromVelocity` helper
    here (Phaser-free, unit-testable). `actorAnims.ts` — id-scoped dir4 anim registration (idle/walk/run loop;
    attack/hurt/death one-shot). `PreloadScene.ts` — static load of every dir4 strip via `tilesetAssetUrl`
    (cross-pack), unconditional like the skeleton. `MonsterCharacter.ts` — `dir4Actor` discriminator: dir4
    sprite/render/initial-strip in the constructor, weapon+hand rig gated to flip3 only, new `updateAnimDir4`
    (facing from velocity via `facing4FromVelocity`, run-on-chase/walk/idle, no flip), and dir4 guards in
    `syncAttachments`/`setFootprint`/`die` (Death strip on last facing). Tests: 4 new unit tests
    (`data.test.ts`: boar stats, dir4-def↔manifest lockstep, `dirEnemyAnimKey`, `facing4FromVelocity`) + new
    `tests/e2e/boar.spec.ts` (cross-pack strips+anims resident; chases+bites; 5 melee hits→corpse; bow hit).
    Verified: typecheck 0 new errors; vitest 806/806; boar e2e 4/4; skeleton regression e2e (combat + monster
    - refactor-tripwire) 22/22 green; eslint 0 errors; screenshot confirmed all 4 facings render on-tile.
  - Add `ENEMIES.boar` in `src/data/enemies.ts` (fast, dangerous charger: modest `maxHp`, higher `speed`
    than the zombie, `strength` for a solid bite, `hurtbox:{width:2,height:1}` — wide/short; `actorKind:
    'dir4'`; **no `weaponPool`** — natural bite in Step 3). Register the boar's anims (idle/walk/run/attack/
    hurt/death × 4 dirs) under **enemy-id-scoped keys** in `registerActorAnims`. Add the boar strips to the
    **static** enemy load in `PreloadScene` (`:106-130`). In `MonsterCharacter`: select the directional strip
    from `lastFacing`/velocity (not `setFlipX`), skip the weapon/hand rig for weaponless mobs, and set the
    boar's 32px footprint.
  - Side effects: `MonsterCharacter.updateAnim/setFootprint/syncAttachments` gain a dir4 path (guard the
    flip3 skeleton path); PreloadScene DEV-vs-prod texture scope.
  - Docs: none (STATUS in Step 5).
  - Done when: a scenario `enemies:[{at:[12,10],id:'boar'}]` spawns a boar that idles, walks toward the
    player with correct 4-way facing, takes melee/bow damage and dies (reusing 035a's HP bar + bow); skeleton
    unchanged.

- [x] **Step 3: Boar telegraphed attack (real Attack anim)** `[inline]`
  - Outcome: `src/config.ts` — added `BOAR_ATTACK_WINDUP_MS` (250ms, sized to the 5-frame Attack anim at
    20fps; punchier than the skeleton's 350). `MonsterCharacter.ts` — the contact-bite block now picks a
    per-instance `windupMs` (`dir4Actor ? BOAR_ATTACK_WINDUP_MS : ENEMY_ATTACK_WINDUP_MS`), reusing 035a's
    caller-side wind-up mechanism unchanged; `updateAnimDir4` plays the real `attack` sheet (one-shot, faced
    from `dir4Facing`) whenever `windupUntil > 0` — the animation IS the tell, on top of the shared tint.
    Strike lands on wind-up completion (damage + lunge), then back to idle/cooldown. Hurt-flinch left out
    (plan-optional, not in done-when). NO DebugState/tripwire change needed — the wind-up+strike is asserted
    via the existing `enemyWindups`/`enemyAttacks`/`playerHp` counters. Test: new Tier-2 spec in
    `boar.spec.ts` (mid-wind-up with player unhurt, then the strike bites) — the unarmed dir4 path.
    Verified: typecheck 0 new errors; vitest 806/806; boar e2e 5/5; skeleton wind-up regression (combat.spec)
    - refactor-tripwire green; eslint clean; screenshot caught the boar mid-wind-up in its Attack pose + tint.
  - Use the boar's real **Attack** sheet as the wind-up tell via 035a's caller-side attack mechanism in
    `MonsterCharacter`: play the boar `attack` anim as the wind-up (propose a boar-specific
    `BOAR_ATTACK_WINDUP_MS`, likely a punchier charge than the skeleton), damage on the strike frame, then a
    hurt-flinch (it has a Hurt sheet — optional) and cooldown. Distinct debug counter if needed (append to
    `DebugState` at END + tripwire).
  - Side effects: contact-cooldown interplay; `DebugState`/tripwire.
  - Docs: none.
  - Done when: the boar visibly winds up (its Attack anim) before biting, giving a window to disengage; a
    Tier-2 spec asserts the wind-up + strike.

- [x] **Step 4: Make the boar the default dev spawn** `[inline]` (was `[delegate]` — trivial one-liner
  with an embedded decision, faster inline than briefing a sub-agent)
  - Outcome: `src/scenes/GameScene.ts` — `spawnEnemyNearPlayer` now `addEnemy('boar', …)` instead of
    `'kidZombie'`. Single dev spawn (open question resolved): a second button needs a DEV-panel layout
    reshuffle (non-trivial), and the skeleton stays reachable via scenarios (all combat/monster e2e specs),
    so boar-as-single-dev-spawn per the plan's sanctioned fallback. Button label kept generic ('SPAWN
    ENEMY'). Verified: DEV `debug:spawnEnemy` → a boar (def id asserted `'boar'`, screenshot confirmed it
    renders + is fightable); typecheck 0 new errors, eslint 0 errors.
  - Update 035a's `spawnEnemyNearPlayer` to spawn `'boar'` by default (leave the skeleton reachable via a
    scenario / keep both if a second button is trivial — otherwise boar is fine as the single dev spawn).
  - Side effects: none beyond the handler.
  - Docs: none.
  - Done when: DEV menu → SPAWN ENEMY drops a boar; fighting it exercises the full loop (telegraph, melee,
    bow, HP bar).

- [x] **Step 5: Docs + test sweep** `[inline]`
  - Outcome: docs updated — `STATUS.md` (boar as a 2nd enemy + the `actorKind` flip3/dir4 directional-actor
    support + the boar's real-Attack-anim telegraph), `GAME-MECHANICS.md` (boar stats + `BOAR_ATTACK_WINDUP_MS`
    knob + `actors.directional.boar.render` footprint), `decisions/gameplay.md` (new dated entry: "Enemy
    rendering is a data discriminator, not a subclass"), plus the CONVENTIONS.md pattern note from Step 1.
    No `DebugState` field was appended across 035b (wind-up+strike assert on existing counters), so the
    refactor-tripwire golden needed no change. Full sweep: typecheck **0 errors** (the earlier tsconfig
    `baseUrl` deprecation no longer appears post-`npm ci`), vitest **806/806**, eslint **0 errors**,
    markdownlint **0 errors**. Full e2e: all combat/monster/boar/refactor-tripwire specs green; 5 specs fail
    (campfire, campfire-feed, death, menu-start, survival-hunger) but are **pre-existing** — verified failing
    identically on the base commit `3e1a679` (a container/timing issue on this runner), unrelated to 035b.
  - Update [STATUS.md](../docs/STATUS.md) (boar mob + directional-enemy actor support + boar telegraph). Note
    boar `config.ts` knobs in [GAME-MECHANICS.md](../docs/GAME-MECHANICS.md). Short
    [decisions/gameplay.md](../docs/decisions/gameplay.md) entry for the directional-actor generalization if
    it's a reusable architectural decision.
  - Full three-tier sweep + lint; refactor-tripwire snapshot reflects appended `DebugState` fields.
  - Done when: docs updated, all tiers + lint green.

## Parallelisation

No parallel groups — Steps 1→2→3→4 are a strict dependency chain (type model → wiring → attack → dev-spawn
flip). Only Step 4 is `[delegate]`.

## Out of scope

- Everything in plan 035a (must land first).
- Ammo economy, spells, dodge, noise-aggro; the night wave, traps, hunger-in-loop, campfire-heart, NPCs.
- Retiring the skeleton (kept as a regression anchor + second mob).

## Open questions (playtest-tuned or decided at execution)

- Boar stats + hurtbox + bite dmg/cadence + wind-up ms — starting values proposed; playtest-tune.
- ~~Whether to keep a separate skeleton dev-spawn alongside the boar (Step 4).~~ **Resolved:** boar is the
  single dev spawn (a 2nd button needs a panel-layout reshuffle); skeleton stays reachable via scenarios.
