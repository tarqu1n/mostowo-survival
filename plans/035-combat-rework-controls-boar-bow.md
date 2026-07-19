# Combat Rework #1 — Mobile Controls, the Boar, a Dev Spawn Button, and a Basic Bow

> Status: planned — run /execute-plan to begin.

## Summary

First build task off [ROADMAP.md](../docs/ROADMAP.md) step 1 (the combat-feel rework). Retunes player
combat to the "danger verb" thesis and makes it not-clunky on a phone: a **4-way-facing boar** mob with a
**real telegraphed attack** (the current skeleton has none — that's the core clunk), a **mobile control
scheme** (movepad + an auto-surfacing Melee/Bow action cluster), a **dev "spawn enemy" button** for
fight-testing, and a **basic bow** (facing-biased auto-target, highlighted target, coded stand-in anim,
unlimited ammo for now). Combat should feel **tense/exposed/committal**, not a power fantasy — the player
is fragile, melee roots you (heavy move-slow), the bow lets you kite (light move-slow). The art-blocked
bow is sequenced late so it stays separable.

Design source of truth: [GAME-DESIGN.md](../docs/GAME-DESIGN.md) "Player combat — the danger verb" +
"Fighting controls (mobile)"; [decisions/gameplay.md](../docs/decisions/gameplay.md) 2026-07-19 combat
entries.

## Context & decisions

**Locked in interrogation:**
- **Bow anim:** coded stand-in first (held bow sprite + coded draw/release tween, like the existing
  Slice/Crush swings + monster weapon-swing) — no new spritesheet; real anim later.
- **Arrows:** unlimited for now (this task is combat *feel*, not the ammo economy — that lands with the
  survival loop). Reuse the pre-wired-but-unused `rangedDamage` (`combat.ts:13`) + `dex` seam.
- **Boar:** *joins* as a second `EnemyDef`, becomes the **default dev spawn**; the skeleton (`kidZombie`)
  stays wired as proven plumbing + a regression anchor.
- **Auto-surface:** combat controls reveal when an enemy is near **or** it's night; retract when safe by day.
- **No dodge** in MVP (kiting is survivability); leave layout room in the cluster.

**Key findings from research (mirror these):**
- **Mode state:** `GameScene.mode: 'command'|'combat'|'inspect'` (`GameScene.ts:80`), `setMode` (`:997`).
  ⚠️ `setMode('combat')` calls `cancelAll()` (`:1001`) — so auto-surfacing must **separate control
  *visibility* from the input *mode*** (do NOT auto-call `setMode`, or every reveal nukes the task queue).
- **UIScene is the single show/hide point** for combat controls: `onModeChanged` (`UIScene.ts:944`). Movepad
  (bespoke joystick, center `{300,540}` r40, `:126-131`/`:354-366`) + the `combatAttackButton` kit `Button`
  (bottom-left, `variant:'danger'`, `onDown→emit('combat:attack')`, `:368-377`). Layout via `arrangeRow`/
  `arrangeColumn` from `../ui` (already used `:333`,`:636`). Movepad currently sits **right** (x=300); a
  right-thumb cluster means moving the movepad **left** and the cluster **right**.
- **Player attack:** `PlayerState` incl. `attack` (sword Pierce, `tileset.ts:24`); `playerAnimKey` (`:513`);
  lock is **`attackLockUntil`** (`PlayerCharacter.ts:29`), set by `CombatFxManager.playAttackSwing`
  (`:237`). Press path: `combat:attack`→`GameScene.attack()` (`:953`)→facing tile→`enemyManager.enemyAt`
  →`resolveMeleeAttack` (`combat.ts:27`). (The brief's "punch"/"punchLockUntil" names are **stale** — it's
  the sword "attack".)
- **Move-slow:** `ATTACK_MOVE_SLOW=0.2` (`config.ts:150`); `PlayerCharacter.effectiveMoveSpeed()` (`:61`)
  feeds BOTH pathfinder (`moveSpeed()` `:66`) and movepad (`GameScene.ts:625`). Single source.
- **Enemy actor pipeline is 3-way + flip, single global `actors.enemy`:** `registerActorAnims`
  (`actorAnims.ts:24`, enemy branch `:53-85` = 3 non-directional keys `enemy-walk/idle/death`,
  `tileset.ts:517-523`); `MonsterCharacter` (`entities/MonsterCharacter.ts`) hardcodes `actors.enemy`,
  fakes facing by `setFlipX(vx<0)` (`:264`), has a weapon/hand rig (`:281-333`). **A 4-way boar forces
  generalizing:** a directional enemy actor manifest, enemy-scoped anim keys, and directional selection in
  `MonsterCharacter.updateAnim/setFootprint/syncAttachments`.
- **No enemy attack FSM state:** `MonsterMode='idle'|'wander'|'patrol'|'chase'` (`monsterAI.ts:22`). Bite is
  a caller-side contact hit + coded lunge in `MonsterCharacter.update` (`:198-217`), gated by
  `weapon.attackMs`/`CONTACT_DAMAGE_COOLDOWN_MS`. `enemyAttacks` debug counter lives in
  `CombatFxManager.lungeAt` (`:181`).
- **Boar asset:** cataloged in `asset-catalog.json` (~72–95), sheets at
  `public/assets/tilesets/craftpix-creatures/Boar/<Action>_<dir>.png`, all **32px square frames** — Idle 4,
  Walk 6, Run 5, Attack 5, Hurt 4, Death 6; dirs down/left/right/up. NOT in any manifest/`ENEMIES` yet. ⚠️
  actor strips load **statically** in `PreloadScene` (`:106-130`) — boar strips must be added there or a dev
  spawn has no resident texture.
- **HP bars:** player-only today (`updateHealthBar` `UIScene.ts:872`, on `player:hpChanged`). **No
  enemy/floating bar exists** — net-new. Anchor above the hurtbox (`systems/hurtbox.ts`, `Hurtbox` on
  `CombatantStats`): `sprite.y - hurtbox.height*TILE*scale`.
- **Target highlight:** use a **stroked rect re-synced each frame** (mirror `TaskGlowRenderer.outlineCampfire`
  `:147-155` + the per-frame `syncGlowTransforms` `:190` loop) — NOT `bakeGlowTexture`/`addTreeGlow`, which
  freezes on one frame and looks stale on a moving/animating target.
- **Dev menu:** `UIScene.create` dev block (`:421-467`): `⟳ RANDOMISE`→`emit('debug:randomise')`→
  `GameScene.randomiseWorld` (`:1063`, uses `pickTile(minPlayerDist)`); `GO NIGHT`→`debug:toggleTime`.
- **Tests:** `window.game.__test` (`testApi.ts`), `applyScenario`(`ScenarioSpec` `testTypes.ts:25`, enemies
  accept `{at,id?,...}`), `step(ms)`, `emit`. Mirror `tests/e2e/combat.spec.ts` + `scenarios.ts oneEnemy()`.
  ⚠️ **`DebugState` field order is a contract** — the `refactor-tripwire.spec.ts` deep-equals a full
  snapshot, so **new debug fields go at the END and the tripwire snapshot is updated in the same step.**

**Direction check:** ROADMAP step 1 + the danger-verb thesis; this plan pulls directly toward the MVP loop.

## Steps

- [ ] **Step 1: Boar as a 4-way directional enemy** `[inline]`
  - Generalize the enemy actor pipeline for directional creatures alongside the existing flip-faked
    skeleton. Add a directional-enemy actor shape (per-state `Record<Facing4,StripAnim>`, `Facing4 =
    up/down/left/right`) in `tileset.ts`, keyed per enemy id (don't break the single skeleton `actors.enemy`).
    Extend `registerActorAnims` (`actorAnims.ts`) to register a directional enemy's `idle/walk/run/attack/
    hurt/death` × 4 dirs under **enemy-id-scoped** keys (skeleton keeps its global `enemy-*` keys). Add
    boar strips to the **static** enemy load in `PreloadScene` (`:106-130`).
  - Add `ENEMIES.boar` in `src/data/enemies.ts` (mirror `kidZombie`): stats tuned for a fast, dangerous
    charger (propose `maxHp` modest, `speed` higher than the zombie, `strength` for a solid bite,
    `hurtbox:{width:2,height:1}` — wide/short); **no `weaponPool`** (boar has a natural bite, not a held
    weapon — see Step 3). Mark it the default dev spawn (Step 2).
  - In `MonsterCharacter`: when the def is a directional actor, pick the strip from `lastFacing`/velocity
    (up/down/left/right) instead of `setFlipX`; skip the weapon/hand rig (`syncAttachments` `:281-333`) for
    weaponless mobs; adjust `setFootprint` for the boar's 32px frames.
  - Side effects: `actors.enemy` consumers, `MonsterCharacter.updateAnim/setFootprint/syncAttachments`,
    `PreloadScene` DEV vs prod texture scope. Keep `kidZombie` visually unchanged (regression via
    refactor-tripwire + `monster.spec.ts`).
  - Docs: none yet (STATUS in Step 8).
  - Done when: a scenario `enemies:[{at:[12,10],id:'boar'}]` spawns a boar that idles, walks toward the
    player with correct 4-way facing, and takes melee damage/dies; skeleton behaviour unchanged; existing
    `combat.spec.ts`/`monster.spec.ts` green.

- [ ] **Step 2: Dev "SPAWN ENEMY" button (boar)** `[delegate]`
  - Replace the `⟳ RANDOMISE` dev button (`UIScene.ts:449-456`) with a `SPAWN ENEMY` button emitting a new
    `debug:spawnEnemy` event (keep `GO NIGHT`). In `GameScene`: register/teardown the handler
    (`:474`/`:489` pattern) → new `spawnEnemyNearPlayer()` that spawns `'boar'` on a nearby empty tile
    (reuse `randomiseWorld`'s `pickTile`/min-dist logic, `:1073`/`:1103`). Keep `randomiseWorld` for now (or
    drop it if nothing else references it — check first; leave if unsure).
  - Side effects: dev-panel height `dph` (`:438`)/`devPanel.add` (`:466`); boar textures must be resident
    (Step 1 preload). DEV-only — dead-code-eliminated in prod, no prod impact.
  - Docs: none.
  - Done when: in a `pnpm dev` build, opening the DEV menu and tapping SPAWN ENEMY drops a boar next to the
    player that you can fight; no console errors.

- [ ] **Step 3: Boar telegraphed attack (real wind-up)** `[inline]`
  - Give the boar a **readable wind-up → strike** using its real Attack sheet, replacing the coded-lunge
    bite *for the boar* (skeleton keeps the coded lunge). Keep the pure `monsterAI` FSM movement-only; drive
    the attack as a caller-side phase in `MonsterCharacter` contact logic (`:198-217`): on entering melee
    contact, play the boar `attack` anim as a wind-up for `BOAR_ATTACK_WINDUP_MS`, then apply
    `resolveMeleeAttack` damage on the strike frame (a natural "tusk" attack: propose dmg/cadence consts in
    `config.ts`, playtest-tuned), then a recover/cooldown. The wind-up is the player's cue to disengage.
  - Add a debug counter for real attacks distinct from `enemyAttacks`/lunge (the lunge counter is in
    `CombatFxManager.lungeAt`) — append to `DebugState` **at the end** and update the tripwire snapshot.
  - Side effects: `MonsterCharacter.update` timing/state; contact-damage cooldown interplay; `CombatFxManager`
    if the boar needs a hurt-flinch (it has a Hurt sheet — optional). `DebugState`/refactor-tripwire.
  - Docs: none.
  - Done when: a scenario shows the boar pausing in a wind-up before it bites (a window to escape), damage
    lands on the strike, and a Tier-2 spec asserts the wind-up delay + the hit (mirror `combat.spec.ts:56`
    lunge/telegraph test).

- [ ] **Step 4: Mobile control cluster + movement-slow** `[inline]`
  - Rework the combat HUD (`UIScene`): move the **movepad to the left** thumb; add a **right-thumb action
    cluster** via `arrangeColumn`/`arrangeRow` — a **Melee** button (rewire the existing `combatAttackButton`
    → `combat:attack`, relabel MELEE) and a **Bow** button (`combat:bow`), laid out with a reserved
    **third slot** for a future Spell (render disabled/hidden in MVP). All in `hudElements`.
  - Move-slow: keep melee heavy (`ATTACK_MOVE_SLOW=0.2`). Add `BOW_MOVE_SLOW` (propose `~0.75`, playtest) and
    apply it in `effectiveMoveSpeed()` while a bow-fire is in progress (add a `bowLockUntil`-style gate
    mirroring `attackLockUntil`). The Melee-vs-Bow move-slow gap is where "ranged is safer" lives.
  - `combat:bow` handler can be a stub this step (no-op / logs) — behaviour lands in Step 6. Keep the Bow
    button visibly present so the layout is real.
  - Side effects: `onModeChanged` show/hide set now includes the cluster; `PointerInputController` hit-test
    gate (`hudElements`); any test asserting movepad/attack-button geometry (`combat.spec.ts:136` movepad
    bypass); `effectiveMoveSpeed` consumers.
  - Docs: none (GAME-DESIGN wiring in Step 8).
  - Done when: in combat, movepad is left and a Melee+Bow cluster is bottom-right (with room for a Spell
    slot); melee slows movement hard, and the movepad-bypass + attack specs still pass.

- [ ] **Step 5: Auto-surface combat controls** `[inline]`
  - Reveal/hide the combat controls automatically **without** switching input mode (do NOT call
    `setMode('combat')` — it `cancelAll()`s). Add a derived `combatControlsVisible` driven each frame in
    `GameScene.update` by: any live enemy within a radius of the player (iterate `enemyManager.all()` filter
    `alive`, distance vs `playerPos` — reuse the aggro-radius math) **OR** night phase (`survivalClock`).
    Retract when neither holds. Emit a `combat:controlsVisible` (or extend `mode:changed`) that `UIScene`
    consumes to show/hide the movepad + cluster; keep Command-mode tap-to-manage working underneath (the
    manual Combat toggle can remain as an override, or be removed if redundant — decide during execution,
    default: keep it).
  - Side effects: interaction between manual mode + auto-visibility (don't let them fight); `PointerInputController`
    tap handling while controls are visible but mode is still `command`; ensure the task queue is never
    cancelled by the reveal.
  - Docs: none.
  - Done when: a scenario with an enemy walking into range shows the controls appear (queue intact), and a
    night-start scenario shows them appear at dusk and retract at dawn when no enemy is near. Tier-2 spec
    asserts both triggers + that a pending move order survives the reveal.

- [ ] **Step 6: The bow — auto-target, coded anim, highlight, ranged damage** `[inline]`
  - Implement `combat:bow`: **facing-biased auto-target-nearest** — pick the nearest live enemy within bow
    range, biased toward `lastFacing` (reuse `enemyManager.all()` + distance/facing math). Fire applies
    `rangedDamage` (`combat.ts:13`, currently unused) via a resolve mirroring `resolveMeleeAttack`. **Unlimited
    ammo.** Visual: a lightweight arrow projectile from player to target (or hitscan + a tracer if simpler)
    + a **coded draw/release** player pose (reuse the coded-swing approach; a held bow sprite pinned via the
    `attachment.ts` anchor system, animated by a tween — no new spritesheet).
  - **Target highlight:** a stroked rect hugging the current target's bounds, re-synced each frame (mirror
    `TaskGlowRenderer.outlineCampfire` + `syncGlowTransforms`); clears when the target dies/leaves range.
  - Apply `BOW_MOVE_SLOW` (Step 4) during the fire so you can still kite.
  - Expose the current target id in `DebugState` (append at END + tripwire update) for test assertions.
  - Side effects: `combat.ts` (activate `rangedDamage` path); `attachment.ts` (bow pin); a new
    projectile/FX in `CombatFxManager` or a small manager; `DebugState`/refactor-tripwire; depends on Step 4's
    Bow button/event + `bowLockUntil`.
  - Docs: none.
  - Done when: in combat, tapping Bow highlights + hits the nearest enemy from range while you keep moving
    (kiting), melee still roots you, and a Tier-2 spec asserts auto-target selection + ranged damage + the
    highlight tracking.

- [ ] **Step 7: Minimal, attention-scoped monster HP bars** `[inline]`
  - Net-new floating HP bar above enemy hurtboxes (anchor `sprite.y - hurtbox.height*TILE*scale`), styled
    thin/colour-only (mirror `updateHealthBar`'s green→red rect, no heavy frame). Visibility rules to avoid
    mobile clutter: the **bow's current target** (Step 6) shows its bar **persistently**; any enemy shows a
    **brief bar on hit** that fades after `HP_BAR_SHOW_MS`; **cap** the number rendered at once
    (nearest/engaged only, propose `HP_BAR_MAX_VISIBLE`). Add a **near-death sprite tell** (e.g. tint/throb
    below a HP fraction) so "almost dead" reads without a bar. Reuse the per-frame sync-loop pattern
    (`syncGlowTransforms`).
  - Side effects: enemy update/teardown must destroy bars (mirror the `EnemyManager`/`TaskGlowRenderer`
    RUNTIME-destroy vs SHUTDOWN caveat, `EnemyManager.ts:72-83`); ties to Step 6 target; possible
    `DebugState` field for tests (append at END + tripwire).
  - Docs: none.
  - Done when: hitting a boar flashes a brief bar that fades; the bow's target keeps its bar; a swarm never
    renders more than the cap; near-death is visible without a bar; a Tier-2 spec asserts on-hit reveal +
    targeted-persistent.

- [ ] **Step 8: Docs + full test sweep** `[inline]`
  - Update [STATUS.md](../docs/STATUS.md) (new: boar mob + directional enemy actors, telegraphed attack,
    mobile control cluster + auto-surface, bow + auto-target + highlight, monster HP bars). Note the new
    `config.ts` knobs (`BOW_MOVE_SLOW`, boar attack/wind-up consts, HP-bar consts) in
    [GAME-MECHANICS.md](../docs/GAME-MECHANICS.md). Tick [ROADMAP.md](../docs/ROADMAP.md) step 1 progress
    (bow anim is a coded stand-in; arrows unlimited — both still flagged for later). Short
    [decisions/gameplay.md](../docs/decisions/gameplay.md) note if any execution-time decision diverged.
    Update [CONVENTIONS.md](../docs/CONVENTIONS.md) if the directional-enemy-actor pattern is reusable.
  - Run the full three-tier sweep (`pnpm test`, `pnpm e2e`, `pnpm smoke`) + lint/format/markdownlint; ensure
    the `refactor-tripwire` snapshot reflects every appended `DebugState` field.
  - Done when: docs updated, all tiers + lint green.

## Parallelisation

No parallel groups. Steps 2 and 3 both depend on Step 1 but both touch `GameScene`/`MonsterCharacter` (not
write-disjoint); Steps 4–7 form a dependency chain (cluster → auto-surface / bow → HP bars). All `[inline]`
except Step 2. Execute sequentially.

## Out of scope

- Ammo economy (arrows are unlimited); crafting/scavenging arrows.
- A hand-authored player bow/shoot spritesheet (coded stand-in only); spells; a dodge/block.
- Noise-based aggro (fighting pulls roamers) — thesis flavour, not built here.
- The night wave / spawning system, traps, hunger-in-loop, campfire-heart, NPCs (later ROADMAP steps).
- Retiring the skeleton (it stays as a regression anchor).

## Open questions (surface, decided at execution or by Matt)

- Boar stats + hurtbox size + bite dmg/cadence + wind-up ms — starting values proposed; **playtest-tune**.
- Bow: arrow **projectile vs hitscan** visual (lean: light projectile); bow range value.
- Melee `0.2` vs new `BOW_MOVE_SLOW ~0.75` exact numbers — playtest.
- Whether to keep the manual Combat-mode toggle once controls auto-surface (default: keep as override).

## Critique

**Verdict:** A well-researched, largely well-aligned plan, but two things should be resolved before
execution — it leaves the *skeleton* (the MVP night-wave enemy) un-telegraphed, which is the exact clunk
ROADMAP step 1 and GAME-DESIGN name as core, and its auto-surface mechanism as written would reveal a
non-functional movepad.

| # | Finding | Lens | Severity | Suggested action |
| - | ------- | ---- | -------- | ---------------- |
| 1 | Telegraph built only on a new boar; skeleton keeps its un-telegraphed coded lunge, yet ROADMAP step 1 + GAME-DESIGN name the *skeleton* telegraph as the core clunk and step 2's wave is skeletons | Roadmap fit | High | Add the coded skeleton wind-up in-scope (machinery exists in `CombatFxManager.lungeAt`), or confirm deferring it; align acceptance to ROADMAP's "fight one skeleton" test |
| 2 | Auto-surface "visibility only, don't call setMode" surfaces a dead movepad: `onCombatMove` (`:1022`), the per-frame drive (`:624`), and PointerInputController gates (`:149`,`:212`) are all keyed on `mode==='combat'`, not visibility | Gaps/risks | High | Rebase those execution gates onto a `combatActive` predicate (or split `setMode` to enter combat input without `cancelAll`); assert the movepad actually drives while auto-surfaced |
| 3 | Front-loads a full 4-way directional-actor pipeline refactor for a brand-new boar — costliest, least-aligned piece — ahead of de-clunking the existing skeleton | Alternatives | Medium | Do the skeleton coded-telegraph + controls + bow first; defer the boar/directional pipeline |
| 4 | Doesn't specify how `EnemyDef` selects its actor, nor the `TilesetManifest.actors` shape change (fixed `{player,enemy}` → id-keyed directional actors) | Consistency/exec | Medium | Nail the type model up front: an actor discriminator on `EnemyDef` + an id-keyed directional-actor map; keep skeleton on its global `enemy-*` keys |
| 5 | 8 steps / ~6 substantial features in one plan | Scope discipline | Medium | Split the separable bow + HP bars from the enemy/controls foundation |
| 6 | DebugState field-order + tripwire snapshot spread across steps | Consistency | Low | Adequately handled (append-at-end + same-step snapshot update); verify golden-scenario values |

**Detail — High #1 (skeleton stays clunky):** ROADMAP step 1 and GAME-DESIGN's danger-verb section
explicitly require the *skeleton* telegraph (coded wind-up tween + pose/flash) as the core de-clunk, and
step 2's night wave spawns skeletons — so shipping this rework with the boar telegraphed but the wave enemy
still un-telegraphed misses the point. Bring the skeleton coded wind-up in-scope (cheap; `lungeAt`
machinery exists) or get the deferral blessed.

**Detail — High #2 (auto-surface broken as written):** movement execution is mode-gated at four sites the
plan didn't cite — `:624` (per-frame drive), `:1022` (`onCombatMove`), `:149`/`:212` (PointerInputController).
"Toggle UIScene visibility, keep mode `command`" surfaces a movepad whose `combat:move` events the scene
discards — visible but dead. Introduce a `combatActive` predicate those sites read (or a `cancelAll`-free
`setMode` path), and add a "movepad drives the player while auto-surfaced" acceptance assertion.

**Resolution:** superseded — this plan is split into **035a** (skeleton telegraph + controls + bow + HP
bars, resolving #1/#2/#3/#5) and **035b** (boar + directional-actor pipeline, resolving #4). See the
[Superseded](#superseded) note below.

## Superseded

This monolithic plan was split following the critique above into two sequential plans; execute those, not
this file (retained only as the home of the critique + history):

- **[035a-combat-feel-skeleton-controls-bow.md](035a-combat-feel-skeleton-controls-bow.md)** — the
  roadmap step-1 core on the *existing* skeleton: telegraphed skeleton attack, mobile control cluster +
  auto-surface, dev spawn button, bow, monster HP bars. No new actor pipeline.
- **[035b-boar-directional-enemy.md](035b-boar-directional-enemy.md)** — the boar as a 4-way directional
  enemy: the actor-pipeline generalization + boar def/anims + its real telegraphed attack; makes the boar
  the default dev spawn. Depends on 035a.
