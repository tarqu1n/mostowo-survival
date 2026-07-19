# Combat Feel Rework — Telegraphed Skeleton, Mobile Controls, Bow, HP Bars

> Status: in review
> Split from plan 035 after critique (the roadmap-step-1 core; the boar + directional-actor pipeline is
> the sibling plan 035b, which depends on this one).

## Summary

Delivers [ROADMAP.md](../docs/ROADMAP.md) step 1's core on the **existing skeleton** (`kidZombie`) — no new
enemy, no actor-pipeline change. Makes player combat not-clunky and tuned to the "danger verb" thesis:
a **telegraphed skeleton attack** (a readable wind-up — the current contact-damage-only bite is *the* clunk
ROADMAP + GAME-DESIGN name), a **mobile control scheme** (movepad + an auto-surfacing Melee/Bow action
cluster), a **dev spawn-enemy button** for fight-testing, a **basic bow** (facing-biased auto-target,
highlighted target, coded stand-in anim, unlimited ammo), and **minimal monster HP bars**. Combat should
feel tense/exposed/committal: the player is fragile, melee roots you (heavy move-slow), the bow lets you
kite (light move-slow).

Design source of truth: [GAME-DESIGN.md](../docs/GAME-DESIGN.md) "Player combat — the danger verb" +
"Fighting controls (mobile)"; [decisions/gameplay.md](../docs/decisions/gameplay.md) 2026-07-19 combat entries.

## Context & decisions

**Locked in interrogation (plan 035):** bow anim = coded stand-in first (held bow sprite + coded
draw/release tween, like the Slice/Crush swings + monster weapon-swing); arrows = unlimited for now (reuse
the unused `rangedDamage` seam, `combat.ts:13`); auto-surface controls when an enemy is near **or** it's
night; **no dodge** (kiting is survivability), leave a Spell slot in the cluster.

**Critique fixes carried in (plan 035 critique):**
- **#1 (High):** the skeleton telegraph is in-scope here (Step 1), not deferred to the boar.
- **#2 (High):** auto-surface (Step 3) rebases the four mode-gated sites onto a `combatActive` predicate and
  asserts the movepad actually drives — no dead movepad.
- **#3/#5:** the boar + directional pipeline are removed to 035b, keeping this plan roadmap-aligned and sized.

**Key findings (mirror these):**
- **Mode state:** `GameScene.mode: 'command'|'combat'|'inspect'` (`GameScene.ts:80`), `setMode` (`:997`) —
  ⚠️ `setMode('combat')` calls `cancelAll()` (`:1001`). Movement is mode-gated at FOUR sites: per-frame
  movepad drive `if (mode==='combat')` (`:624`), `onCombatMove` early-return (`:1022`),
  PointerInputController drag-ownership (`:149`) + tap-dispatch (`:212`).
- **UIScene** is the single show/hide point for combat controls (`onModeChanged` `:944`): movepad (bespoke
  joystick, center `{300,540}` r40, `:126-131`/`:354-366`) + `combatAttackButton` (bottom-left,
  `variant:'danger'`, `onDown→emit('combat:attack')`, `:368-377`). Layout via `arrangeRow/Column` from
  `../ui` (`:333`,`:636`). Movepad sits right (x=300); a right-thumb cluster means moving the movepad left.
- **Player attack:** `PlayerState` incl. `attack` (sword, `tileset.ts:24`); `playerAnimKey` (`:513`); lock =
  **`attackLockUntil`** (`PlayerCharacter.ts:29`), set by `CombatFxManager.playAttackSwing` (`:237`). Press
  path: `combat:attack`→`GameScene.attack()` (`:953`)→facing tile→`enemyManager.enemyAt`→`resolveMeleeAttack`
  (`combat.ts:27`). (The old "punch" name is stale.)
- **Move-slow:** `ATTACK_MOVE_SLOW=0.2` (`config.ts:150`); `PlayerCharacter.effectiveMoveSpeed()` (`:61`)
  feeds BOTH pathfinder (`moveSpeed()` `:66`) and movepad (`GameScene.ts:625`). Single source.
- **Skeleton bite today:** caller-side contact hit + coded lunge in `MonsterCharacter.update` (`:198-217`),
  gated by `weapon.attackMs`/`CONTACT_DAMAGE_COOLDOWN_MS`; the `enemyAttacks` debug counter is incremented in
  `CombatFxManager.lungeAt` (`:181`). There is **no FSM attack state** (`MonsterMode` `monsterAI.ts:22`) —
  keep it that way; drive the wind-up caller-side.
- **HP bars:** player-only today (`updateHealthBar` `UIScene.ts:872`, on `player:hpChanged`). No
  enemy/floating bar exists — net-new. Anchor above the hurtbox (`systems/hurtbox.ts`, `Hurtbox` on
  `CombatantStats`): `sprite.y - hurtbox.height*TILE*scale`.
- **Target highlight:** a stroked rect re-synced each frame (mirror `TaskGlowRenderer.outlineCampfire`
  `:147-155` + `syncGlowTransforms` `:190`), NOT `bakeGlowTexture`/`addTreeGlow` (freezes on one frame,
  stale on a moving/animating target).
- **Dev menu:** `UIScene.create` dev block (`:421-467`): `⟳ RANDOMISE`→`emit('debug:randomise')`→
  `GameScene.randomiseWorld` (`:1063`, uses `pickTile(minPlayerDist)`); `GO NIGHT`→`debug:toggleTime`.
- **Tests:** `window.game.__test` (`testApi.ts`), `applyScenario` (`ScenarioSpec` `testTypes.ts:25`),
  `step(ms)`, `emit`. Mirror `tests/e2e/combat.spec.ts` + `scenarios.ts oneEnemy()` (`player:[10,10],
  enemies:[[12,10]]` = a kidZombie). ⚠️ **`DebugState` field order is a contract** — `refactor-tripwire.spec.ts`
  deep-equals a full snapshot, so **new debug fields go at the END and the tripwire snapshot updates in the
  same step.**

## Steps

- [x] **Step 1: Telegraphed skeleton attack** `[inline]` — resolves critique #1
  - Outcome: caller-side wind-up→strike in `MonsterCharacter.update` contact branch; new `windupUntil`
    field + `beginWindUp`/`endWindUp` env callbacks (wired EnemyManager→GameScene→CombatFxManager).
    Wind-up is **carved out of the tail of the existing cadence** (`cooldown - ENEMY_ATTACK_WINDUP_MS`
    gate) so enemy DPS is unchanged — telegraph is a pure readability layer; leaving contact mid-wind-up
    whiffs the strike. Tell = ramping warning tint (`ENEMY_WINDUP_TINT`, tint-only to avoid scale
    conflict with the flinch-squash) + the enemy freezing; strike still fires the existing forward
    lunge + weapon swing. New consts `ENEMY_ATTACK_WINDUP_MS=350`/`ENEMY_WINDUP_TINT` (config.ts).
    Added `enemyWindups` to `DebugState` (at END) + tripwire snapshot. Files: `config.ts`,
    `entities/MonsterCharacter.ts`, `scenes/fx/CombatFxManager.ts`, `scenes/world/EnemyManager.ts`,
    `scenes/GameScene.ts`, `scenes/testApi.ts`, `tests/e2e/combat.spec.ts` (new telegraph spec — drives
    slices finer than the wind-up so it's robust to the DEV clock's wall-clock-dependent origin),
    `tests/e2e/refactor-tripwire.spec.ts`. Verified: unit 788✓, combat+tripwire+monster e2e all green
    (incl. club/knife cadence unchanged), lint 0 errors, prettier clean. Telegraph tell (tint+freeze)
    is MVP-minimal — a pose/rear-back could be added at playtest; wind-up ms proposed 350, tune live.
  - Give the skeleton a readable **wind-up → strike**, replacing/upgrading the instant contact-bite. Keep
    `monsterAI` movement-only; drive the attack caller-side in `MonsterCharacter` contact logic (`:198-217`):
    on entering melee contact, enter a wind-up for `ENEMY_ATTACK_WINDUP_MS` (new `config.ts` const, propose
    ~350ms, playtest) with a clear tell (the existing coded lunge/`CombatFxManager` swing + a pose/flash),
    then apply `resolveMeleeAttack` damage on the strike, then recover/cooldown. The wind-up is the player's
    cue to disengage — the core "not clunky" fix.
  - Align to ROADMAP acceptance: "fight one skeleton" reads tense + readable.
  - Side effects: contact-damage cooldown interplay; `enemyAttacks` counter semantics (lunge vs real strike)
    — if a distinct counter is added, append to `DebugState` at END + update tripwire.
  - Docs: none (STATUS in Step 7).
  - Done when: `oneEnemy()` scenario shows the skeleton pausing in a wind-up before it bites (a window to
    escape) and damage landing on the strike; a Tier-2 spec asserts the wind-up delay + the hit (mirror
    `combat.spec.ts:56`).

- [x] **Step 2: Mobile control cluster + movement-slow** `[inline]`
  - Outcome: movepad moved to the **left thumb** (`movepadCenter` {300,540}→{60,540}); the old bottom-left
    `combatAttackButton` became a **right-thumb action cluster** — `combatMeleeButton` (MELEE, danger,
    `combat:attack`) / `combatBowButton` (BOW, `combat:bow`) / `combatSpellButton` (SPELL, reserved:
    `setDimmed(true)`, no handler), stacked bottom-right, all three toggled in `onModeChanged`. Cluster
    raised to clear the always-present bottom-right DEV button (its taps were being stolen). Move-slow:
    new `BOW_MOVE_SLOW=0.75`/`BOW_DRAW_MS=450` (config.ts) + `bowLockUntil` on PlayerCharacter;
    `effectiveMoveSpeed()` now picks melee-slow (root) → bow-slow (kite) → full. `combat:bow` is a
    Step-2 stub (`GameScene.bow` just sets `bowLockUntil`; real target/arrow/anim in Step 5). Files:
    `config.ts`, `entities/PlayerCharacter.ts`, `scenes/GameScene.ts`, `scenes/UIScene.ts`,
    `tests/e2e/combat.spec.ts` (new bow move-slow spec). Verified: typecheck clean, combat+follow e2e
    all green (12/12), **HUD layout confirmed by screenshot** (movepad left, MELEE/BOW/SPELL-dimmed
    cluster right, clear of DEV). NOTE: 4 pre-existing e2e failures (campfire tryPlace, death,
    menu-start, survival-hunger) + pre-existing markdownlint errors in the sibling `035` plan reproduce
    on clean master — unrelated to this work; flagged for Step 7.
  - Rework the combat HUD (`UIScene`): move the **movepad to the left** thumb; add a **right-thumb action
    cluster** via `arrangeColumn/Row` — a **Melee** button (rewire `combatAttackButton`→`combat:attack`,
    relabel MELEE) and a **Bow** button (`combat:bow`), with a reserved, disabled/hidden **third Spell slot**.
    All in `hudElements`.
  - Move-slow: keep melee heavy (`ATTACK_MOVE_SLOW=0.2`). Add `BOW_MOVE_SLOW` (propose ~0.75, playtest),
    applied in `effectiveMoveSpeed()` while a bow-fire is active (add a `bowLockUntil` gate mirroring
    `attackLockUntil`). The melee-vs-bow gap is where "ranged is safer" lives. `combat:bow` can be a stub
    this step (behaviour in Step 5); keep the Bow button visibly present.
  - Side effects: `onModeChanged` show/hide set now includes the cluster; `PointerInputController` hit-test
    gate (`hudElements`); tests asserting movepad/attack geometry (`combat.spec.ts:136`); `effectiveMoveSpeed`
    consumers.
  - Docs: none.
  - Done when: in combat, movepad is left and a Melee+Bow cluster is bottom-right (Spell slot reserved);
    melee slows movement hard; movepad-bypass + attack specs still pass.

- [x] **Step 3: Auto-surface combat controls (combatActive predicate)** `[inline]` — resolves critique #2
  - Outcome: `GameScene.combatActive` recomputed each frame (`updateCombatActive`, before movement
    gating) — true when a live enemy is within new `COMBAT_ACTIVE_RADIUS_TILES` (7, Chebyshev) of the
    player **OR** `survivalClock.dayPhase === 'night'`; emits `combat:activeChanged` only on a flip.
    **Never calls `setMode('combat')`** (would `cancelAll()` the queue). New `movepadDrives()` predicate
    (`mode==='combat' || combatActive`) is what the movepad drive rebases onto: the per-frame drive
    (idle branch) + a new **Option-A override** (`!action || (movepadDrives() && padHeld)`) so a held
    movepad drives the player even with an active task, WITHOUT clearing the queue (a pending order
    survives + resumes on release), and `onCombatMove`/`onCombatMoveEnd` gates. **Precedence decided
    (open question): movepad drives; taps still queue orders** — so the two PointerInputController sites
    (drag-ownership `:149`, tap-dispatch `:212`) intentionally stay `mode==='combat'`-gated (command-mode
    pan/queue-paint/tap-to-move stay live while surfaced; the movepad is already protected there by
    `downOnUI`, so no dead movepad and no hijacked camera — documented at the site). UIScene mirrors
    both `mode:changed` + `combat:activeChanged` via a shared `refreshCombatControls()`
    (movepad+cluster+hotbar-hide). buildWorld re-emits `combat:activeChanged` (false) so the persistent
    UIScene resyncs across a death-restart. Added `combatActive` to `DebugState` (at END) + tripwire
    snapshot + harness mirror (also back-filled the lagging `enemyWindups` mirror). Files: `config.ts`,
    `scenes/GameScene.ts`, `scenes/UIScene.ts`, `scenes/input/PointerInputController.ts` (comment only),
    `scenes/testApi.ts`, `tests/e2e/harness.ts`, `tests/e2e/refactor-tripwire.spec.ts`,
    `tests/e2e/combat.spec.ts` (2 new specs: enemy-near surfaces + movepad drives while a queued order
    survives; night surfaces at dusk / retracts at dawn). Verified: typecheck clean, lint 0 errors,
    unit 788✓, e2e combat.spec (13, incl. both new) + tripwire green, prettier clean. Full e2e sweep =
    45 pass / 5 fail, but ALL 5 (campfire-feed, campfire tryPlace, death, menu-start, survival-hunger)
    reproduce on clean master — pre-existing environmental flakiness in the real-RAF/timing/zone tests
    (campfire-feed confirmed 4/5-fail on clean baseline under `--repeat-each`); unrelated to this work.
  - Introduce a **`combatActive`** predicate driven each frame in `GameScene.update`: any live enemy within a
    radius of the player (iterate `enemyManager.all()` filter `alive`, distance vs player) **OR** night
    phase (`survivalClock`). **Rebase the four mode-gated movement sites onto `combatActive`** so the movepad
    genuinely drives while controls are surfaced — the per-frame drive (`:624`), `onCombatMove` (`:1022`),
    and PointerInputController drag-ownership (`:149`) + tap-dispatch (`:212`) — instead of raw
    `mode==='combat'`. **Do NOT auto-call `setMode('combat')`** (it `cancelAll()`s the task queue). Emit a
    visibility signal `UIScene` consumes to show/hide movepad + cluster. Reconcile command-mode tap-to-move
    being simultaneously live (define precedence: while `combatActive`, movepad drives; taps still queue
    orders — or gate taps as chosen during execution). The manual Combat toggle may remain as an override
    (default: keep).
  - Side effects: the four gate sites; interaction of manual mode + auto-visibility; the task queue must
    NEVER be cancelled by a reveal.
  - Docs: none.
  - Done when: an enemy walking into range surfaces the controls **and the movepad moves the player** (task
    queue intact); a night-start scenario surfaces them at dusk and retracts at dawn when no enemy is near.
    Tier-2 asserts BOTH triggers, that a pending move order survives, AND that the movepad drives while
    auto-surfaced.

- [x] **Step 4: Dev "SPAWN ENEMY" button** `[delegate]`
  - Outcome: UIScene dev-menu button `⟳ RANDOMISE` → `SPAWN ENEMY` (same slot/size/olive variant,
    `fontSize 11`), now emits `debug:spawnEnemy` (was `debug:randomise`); `GO NIGHT`/`GO DAY` +
    panel size (`dph`) untouched (1-for-1 swap). GameScene: `debug:spawnEnemy` → new
    `spawnEnemyNearPlayer()` wired on/off symmetrically in `wireBus`. `spawnEnemyNearPlayer` scans
    outward in Chebyshev rings from the player tile (dist 2→8, never 0/1) for the first empty tile
    passing bounds + `!isOccupied` + `!hasSiteTile` + `!isBlocked` (walkable), then
    `enemyManager.addEnemy('kidZombie', …)`; no-ops if boxed in. `randomiseWorld` + its
    `debug:randomise` bus wiring KEPT as-is (still bus-referenced; 035b reuses the scatter) — only the
    button stopped emitting it. No DebugState/test-API change; no new prod surface. Files:
    `scenes/UIScene.ts`, `scenes/GameScene.ts`. Verified (sub-agent + independent recheck): typecheck
    clean, lint 0 errors, prettier clean, `pnpm build` succeeds, `pnpm smoke` boot canary passed (Game
    - UI active, zero console/page errors). Delegated to a sub-agent; reverted incidental stray
    markdown-emphasis reformatting the agent's formatter run left in three unrelated docs so the commit
    stays scoped to the code.
  - Replace `⟳ RANDOMISE` (`UIScene.ts:449-456`) with a `SPAWN ENEMY` button emitting `debug:spawnEnemy`
    (keep `GO NIGHT`). In `GameScene`: register/teardown (`:474`/`:489`) → `spawnEnemyNearPlayer()` spawning
    `'kidZombie'` on a nearby empty tile (reuse `randomiseWorld`'s `pickTile`/min-dist, `:1073`/`:1103`).
    Keep `randomiseWorld` unless nothing references it. (Plan 035b will flip the default spawn to the boar.)
  - Side effects: dev-panel height `dph` (`:438`)/`devPanel.add` (`:466`). DEV-only, no prod impact.
  - Docs: none.
  - Done when: in `pnpm dev`, DEV menu → SPAWN ENEMY drops a skeleton next to the player to fight; no console
    errors.

- [x] **Step 5: The bow — auto-target, coded anim, highlight, ranged damage** `[inline]`
  - Outcome: `combat:bow` (`GameScene.bow`) now, on top of the Step-2 lock: picks a target via new
    `pickBowTarget()` — **facing-biased nearest** (live enemies within new `BOW_RANGE_TILES` (6,
    Euclidean); if any lie in the `lastFacing` hemisphere (positive dot) the nearest of those wins,
    else nearest in range) — faces it, flies a coded arrow tracer, and applies **ranged** damage via
    new `resolveRangedAttack` (`combat.ts`, base + `dex`; new `BOW_BASE_DAMAGE`=2, player dex 0 → 2/
    shot, kills a kidZombie in 2). **Hitscan** — the arrow is pure FX (`CombatFxManager.fireArrow`: a
    thin `BOW_ARROW_LEN_PX` dash tweened player→target over `BOW_ARROW_MS`, self-destroying), the
    chosen "light projectile". **Target highlight:** `CombatFxManager.syncBowTargetHighlight` — a
    single stroked rect (`COLORS.bowTarget`) re-hugging the target's bounds every frame (driven from
    `GameScene.syncBowTarget` in `update()`, above the movement early-return so it tracks while
    kiting); mirrors `outlineCampfire`, NOT a baked halo. New `bowTargetId` scene field, reconciled
    each frame (cleared on the target dying or leaving range), surfaced in `DebugState` (at END) +
    tripwire + harness mirror + reset in scenario `resetWorld` (new `clearBowTarget`/`getBowTargetId`
    test-API deps). `BOW_MOVE_SLOW` kite already lands via Step 2's `bowLockUntil`.
    **DEVIATION (flagged):** the "held bow sprite pinned via attachment.ts" body pose was NOT built —
    the player rig carries no per-frame hand anchors and the pack ships no bow art, so the *release
    body pose* reuses the existing Pierce (`attack`) strip as a coded stand-in during the draw window
    (new `bowLockUntil` branch in `PlayerCharacter.updateAnim`); the arrow tracer + highlight carry
    the ranged read. A real bow rig/art + arrow-nock anchors is a later polish pass (noted for Step 7 /
    playtest). New consts `BOW_RANGE_TILES`/`BOW_BASE_DAMAGE`/`BOW_ARROW_MS`/`BOW_ARROW_LEN_PX` +
    `COLORS.bowTarget`/`COLORS.arrow` (config.ts). Files: `config.ts`, `systems/combat.ts`,
    `entities/PlayerCharacter.ts`, `scenes/fx/CombatFxManager.ts`, `scenes/GameScene.ts`,
    `scenes/testApi.ts`, `systems/__tests__/combat.test.ts` (rangedDamage + resolveRangedAttack
    Tier-1), `tests/e2e/harness.ts`, `tests/e2e/refactor-tripwire.spec.ts`, `tests/e2e/combat.spec.ts`
    (2 new specs: facing-biased target selection; kill-from-range + target-clears-on-death). Verified:
    typecheck clean, lint 0 errors (96 pre-existing `any` warnings in test files only), unit 793✓
    (was 788 + 5 new combat), e2e combat.spec (14) + refactor-tripwire green (15/15), prettier clean
    on all touched files, `pnpm build` succeeds, boot canary passes with zero console/page errors (the
    click-to-start single-click flake is pre-existing + intermittent, unrelated). Bow range/damage/
    arrow feel proposed — playtest-tune.
  - Implement `combat:bow`: **facing-biased auto-target-nearest** (nearest live enemy in bow range, biased to
    `lastFacing`); fire applies `rangedDamage` (`combat.ts:13`) via a resolve mirroring `resolveMeleeAttack`.
    **Unlimited ammo.** Visual: a lightweight arrow projectile player→target (or hitscan + tracer if simpler)
    - a **coded draw/release** pose (held bow sprite pinned via `attachment.ts`, tween-animated — no new
    spritesheet). **Target highlight:** stroked rect hugging the target's bounds, re-synced each frame
    (mirror `outlineCampfire`+`syncGlowTransforms`); clears when the target dies/leaves range. Apply
    `BOW_MOVE_SLOW` during the fire (kite-able). Expose the current target id in `DebugState` (append at END
    - tripwire update).
  - Side effects: `combat.ts` (activate `rangedDamage`); `attachment.ts` (bow pin); a projectile/FX manager;
    `DebugState`/tripwire; depends on Step 2's Bow button + `bowLockUntil`.
  - Docs: none.
  - Done when: tapping Bow highlights + hits the nearest skeleton from range while you keep moving; melee
    still roots you; Tier-2 asserts auto-target selection + ranged damage + highlight tracking.

- [x] **Step 6: Minimal, attention-scoped monster HP bars** `[inline]`
  - Outcome: net-new floating HP bars, owned by `CombatFxManager.syncEnemyHealthBars(enemies,
    bowTargetId, playerTile)` (called each frame from `GameScene.update`, above the movement early-
    return so bars track on the idle/movepad path too). A pooled `{bg,fg}` rect pair per enemy id
    (mirrors the player's `updateHealthBar` — thin dark bg + green→red `fg`, `fg` left-anchored so
    `scaleX` drains from the right), anchored above the hurtbox (`sprite.y −
    hurtbox.height·TILE·scaleY − HP_BAR_GAP_PX`), depth 13/14. **Anti-clutter:** a bar shows for an
    enemy that is the **bow target** (persistent) OR was hit within `HP_BAR_SHOW_MS` (2500, brief →
    fades), capped to `HP_BAR_MAX_VISIBLE` (5) — target first, then nearest; bars for no-longer-shown
    enemies (dead/timed-out/evicted) are destroyed each frame. **On-hit reveal** is driven off a new
    `enemyHitAt` stamp written in the single `flashHit` choke point (both melee + bow route through
    it). **Near-death tell:** any live enemy below `HP_BAR_NEAR_DEATH_FRAC` (0.34) HP gets a slow
    **alpha throb** (`HP_BAR_NEAR_DEATH_ALPHA_MIN`..1 over `HP_BAR_NEAR_DEATH_PERIOD_MS`) — chosen
    over tint/scale because alpha is free on enemies (VisionController hides only the player; the
    flash/wind-up/flinch FX use pipeline/tint/scale, never alpha), so no FX conflict — readable even
    for a capped-out enemy with no bar. `cleanupActorFx` resets alpha→1 + drops the hit stamp so a
    killed enemy's corpse is solid + its bar clears; `resetCombatFx` destroys the pooled rects + clears
    the stamp map (RUNTIME destroy; SHUTDOWN double-destroy is a guarded no-op — plain rects, no
    physics body, so the Arcade-teardown-ordering caveat doesn't apply). Added `enemyHpBarsVisible` to
    `DebugState` (at END, `= fx.getVisibleHpBarCount()`, no new test-API dep — `fx` was already in the
    facade) + tripwire + harness mirror. New consts `HP_BAR_*` + `COLORS.hpBarBg/hpBarHigh/hpBarLow`
    (config.ts). Files: `config.ts`, `scenes/fx/CombatFxManager.ts`, `scenes/GameScene.ts`,
    `scenes/testApi.ts`, `tests/e2e/harness.ts`, `tests/e2e/refactor-tripwire.spec.ts`,
    `tests/e2e/combat.spec.ts` (2 new specs: on-hit reveal-then-fade + no-hit-no-bar;
    bow-target-persistent past the fade). Verified: typecheck clean, lint 0 errors, unit 793✓, e2e
    combat.spec (16, incl. both new) + refactor-tripwire green (17/17), prettier clean, `pnpm build`
    succeeds. HP_BAR_* sizes/timings/near-death frac proposed — playtest-tune.
  - Net-new floating HP bar above enemy hurtboxes (`sprite.y - hurtbox.height*TILE*scale`), thin/colour-only
    (mirror `updateHealthBar`'s green→red rect). Anti-clutter rules: the bow's **current target** (Step 5)
    shows its bar **persistently**; any enemy shows a **brief on-hit bar** fading after `HP_BAR_SHOW_MS`;
    **cap** rendered count (`HP_BAR_MAX_VISIBLE`, nearest/engaged). Add a **near-death sprite tell**
    (tint/throb below a HP fraction) so "almost dead" reads without a bar. Reuse the per-frame sync-loop.
  - Side effects: enemy update/teardown must destroy bars (RUNTIME-destroy vs SHUTDOWN caveat,
    `EnemyManager.ts:72-83`); ties to Step 5 target; optional `DebugState` field (append at END + tripwire).
  - Docs: none.
  - Done when: hitting the skeleton flashes a brief bar that fades; the bow's target keeps its bar; a swarm
    never exceeds the cap; near-death visible without a bar; Tier-2 asserts on-hit reveal + targeted-persistent.

- [x] **Step 7: Docs + full test sweep** `[inline]`
  - Outcome: docs updated — **STATUS.md** gained a "Combat feel rework (plan 035a)" section (all six
    pieces + config-knob pointers + the 035b split); **GAME-MECHANICS.md** gained a "Combat feel & the
    bow" section with the tuned numbers (`ENEMY_ATTACK_WINDUP_MS`, `ATTACK_MOVE_SLOW`/`BOW_MOVE_SLOW`,
    `COMBAT_ACTIVE_RADIUS_TILES`, `BOW_RANGE_TILES`/`BOW_BASE_DAMAGE`/`BOW_ARROW_*`, `HP_BAR_*`);
    **ROADMAP.md** step 1 got a progress note (035a delivered the core; **flagged stand-ins**: bow anim
    = Pierce-strip placeholder, arrows unlimited/no ammo resource; boar + directional pipeline → 035b);
    **decisions/gameplay.md** got an "Execution notes (plan 035a)" block under the combat-controls entry
    (bow-anim stand-in, hitscan+unlimited arrows, auto-surface never flips `mode`, near-death = alpha
    throb). Full three-tier sweep: **unit 793✓**, **e2e 49 pass / 5 fail** — the 5 (campfire tryPlace,
    campfire-feed, death, menu-start, survival-hunger) are **pre-existing environmental flakes**,
    **confirmed** by re-running them on the pre-035a base commit `53bba5c` (identical 5 fail / 7 pass)
    and by the fact that none touch this plan's code paths; combat.spec (18, incl. all 035a specs) +
    refactor-tripwire green. **smoke** boots clean (zero console/page errors; the single-click
    start-timing flake is pre-existing/intermittent). typecheck clean, `pnpm lint` 0 errors (96
    pre-existing `any` warnings in test files), prettier clean. **markdownlint:** the 035a docs are
    clean; pre-existing `MD060`/`MD049`/`MD004` drift in two UNTOUCHED files (`docs/LORE.md`, the `035`
    sibling plan) — present on the base commit, violating the config's explicit `tight`-table/`dash`
    rules — was cleared in a **separate housekeeping commit** (mechanical `--fix` only), so `pnpm
    lint:md` is now green. Plan status → `in review`.
  - Update [STATUS.md](../docs/STATUS.md) (telegraphed skeleton attack, mobile control cluster + auto-surface,
    bow + auto-target + highlight, monster HP bars). Note new `config.ts` knobs (`ENEMY_ATTACK_WINDUP_MS`,
    `BOW_MOVE_SLOW`, `HP_BAR_*`) in [GAME-MECHANICS.md](../docs/GAME-MECHANICS.md). Tick ROADMAP step 1
    progress (bow anim = coded stand-in; arrows unlimited — both flagged). Short
    [decisions/gameplay.md](../docs/decisions/gameplay.md) note if an execution-time decision diverged.
  - Run the full three-tier sweep (`pnpm test`, `pnpm e2e`, `pnpm smoke`) + lint/format/markdownlint; ensure
    the `refactor-tripwire` snapshot reflects every appended `DebugState` field.
  - Done when: docs updated, all tiers + lint green.

## Parallelisation

No parallel groups. Step 1 stands alone but Steps 2→3 chain (cluster → auto-surface), Step 5 needs Step 2's
Bow button, Step 6 needs Step 5's target. Only Step 4 is `[delegate]` but it shares `GameScene` writes with
others — run sequentially.

## Out of scope

- The boar + any 4-way directional-actor pipeline change (→ plan 035b).
- Ammo economy; a hand-authored bow spritesheet; spells; a dodge/block; noise-based aggro.
- The night wave / spawning system, traps, hunger-in-loop, campfire-heart, NPCs (later ROADMAP steps).

## Open questions (playtest-tuned or decided at execution)

- Skeleton wind-up ms + bow move-slow + bow range — starting values proposed; playtest-tune.
- Bow arrow projectile vs hitscan (lean: light projectile).
- Whether to keep the manual Combat-mode toggle once controls auto-surface (default: keep as override).
- Command-mode tap-to-move vs movepad precedence while `combatActive` (decide in Step 3).
