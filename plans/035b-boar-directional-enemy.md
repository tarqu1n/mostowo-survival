# The Boar — a 4-Way Directional Enemy

> Status: planned — run /execute-plan to begin.
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

- [ ] **Step 1: Directional-enemy actor type model** `[inline]` — resolves critique #4
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

- [ ] **Step 2: Wire the boar as a directional enemy** `[inline]`
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

- [ ] **Step 3: Boar telegraphed attack (real Attack anim)** `[inline]`
  - Use the boar's real **Attack** sheet as the wind-up tell via 035a's caller-side attack mechanism in
    `MonsterCharacter`: play the boar `attack` anim as the wind-up (propose a boar-specific
    `BOAR_ATTACK_WINDUP_MS`, likely a punchier charge than the skeleton), damage on the strike frame, then a
    hurt-flinch (it has a Hurt sheet — optional) and cooldown. Distinct debug counter if needed (append to
    `DebugState` at END + tripwire).
  - Side effects: contact-cooldown interplay; `DebugState`/tripwire.
  - Docs: none.
  - Done when: the boar visibly winds up (its Attack anim) before biting, giving a window to disengage; a
    Tier-2 spec asserts the wind-up + strike.

- [ ] **Step 4: Make the boar the default dev spawn** `[delegate]`
  - Update 035a's `spawnEnemyNearPlayer` to spawn `'boar'` by default (leave the skeleton reachable via a
    scenario / keep both if a second button is trivial — otherwise boar is fine as the single dev spawn).
  - Side effects: none beyond the handler.
  - Docs: none.
  - Done when: DEV menu → SPAWN ENEMY drops a boar; fighting it exercises the full loop (telegraph, melee,
    bow, HP bar).

- [ ] **Step 5: Docs + test sweep** `[inline]`
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
- Whether to keep a separate skeleton dev-spawn alongside the boar (Step 4).
