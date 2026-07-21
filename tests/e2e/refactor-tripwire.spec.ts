import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, step, state } from './harness';
import type { DebugState } from './harness';
import { ATTACK_COOLDOWN_MS } from '../../src/config';

// Plan 013 Step 2: the refactor tripwire. Steps 3–6 relocate large chunks of GameScene (CombatFxManager,
// Character/PlayerCharacter/MonsterCharacter, PointerInputController, BuildManager/TaskGlowRenderer/
// TestApi) — all *behaviour-preserving*. This spec is the cheap alarm: build one rich, fully
// deterministic world (two trees, a rock, a built wall, an armed adjacent enemy), drive a fixed,
// scripted sequence of combat + time (no wall-clock waits — every advance goes through __test.step),
// and assert a FULL snapshot of debugState() against an inline expected object. If a later step's move
// accidentally changes behaviour, this fails; if it only moves code, it stays green.
//
// Determinism: both combatants have dodge 0, so hitChance() is 100 and every resolveMeleeAttack roll
// hits regardless of Math.random's draw (systems/combat.ts: `rng()*100 >= hitChance` never holds for
// rng in [0,1) when hitChance is 100) — damage amounts have no randomness of their own. `weaponId` is
// forced (the scenario API would otherwise roll a random weapon from the pool via Math.random).
//
// Float discipline: discrete fields (tiles, counts, modes, ids, hp, mode strings) are compared exactly;
// float-carrying fields (px/py, hunger, clockMs, nightAlpha) are rounded to a fixed precision first, so
// Steps 3–6 relocating movement/tween math can't trip this on last-bit float drift. Verified stable
// across 3 repeated runs (sub-0.1ms/sub-0.001 jitter only, from the DEV clock's brief pre-first-step RAF
// window — see testStep/testApplyScenario — well inside the rounding below).

/**
 * Round the float-carrying fields to a fixed precision; discrete fields pass through unchanged.
 * `clockMs` buckets to the nearest 50ms (not just rounded to an integer): the DEV fixed-step clock
 * (testStep/testClock) carries a sub-2ms jitter from the brief real-RAF window before the very first
 * `__test.step` call stops the loop (see testStep/testApplyScenario) — plenty to flip a plain
 * `Math.round` across an integer boundary run to run. A 50ms bucket comfortably absorbs it.
 */
function normalize(s: DebugState) {
  return {
    ...s,
    px: Math.round(s.px),
    py: Math.round(s.py),
    hunger: Number(s.hunger.toFixed(1)),
    clockMs: Math.round(s.clockMs / 50) * 50,
    nightAlpha: Number(s.nightAlpha.toFixed(3)),
  };
}

test('golden debugState() snapshot survives a scripted world + combat sequence', async ({
  page,
}) => {
  await startGame(page);

  await applyScenario(page, {
    player: [10, 10],
    facing: 'right',
    mode: 'combat',
    wood: 0,
    trees: [
      [10, 7],
      [10, 13],
    ],
    rocks: [[6, 10]],
    walls: [[14, 10]],
    enemies: [{ at: [11, 10], mode: 'chase', weaponId: 'club' }],
    hunger: 62,
    clockMs: 20_000,
  });

  // The enemy is already adjacent + 'chase' with a club (1500ms bite cooldown, lastContactAt starts at
  // 0 against the DEV fixed-step clock, which itself starts near 0 — see testStep). Driving past 1500ms
  // guarantees exactly one contact bite lands (club: 2 base + kidZombie strength 1 = 3 dmg, dodge 0 →
  // always hits) before we start fighting back, so the golden snapshot exercises a real landed bite
  // (playerHp, playerHitFlashes, enemyAttacks) alongside the player's own attack (deliberately well past
  // the cooldown threshold, not right at it, so this doesn't hinge on which sub-tick crosses it).
  await step(page, 1600);

  // Three player attacks on the adjacent enemy (kidZombie maxHp 3, unarmed 1 dmg/hit, dodge 0 → exactly
  // 3 hits to kill). Each is spaced just past ATTACK_COOLDOWN_MS — the melee cooldown ignores presses
  // inside the window, so tighter gaps would drop the 2nd/3rd swing. The cooldown-paced fight now runs
  // long enough that a SECOND club bite lands mid-fight (enemyAttacks 2, playerHitFlashes 2, playerHp
  // 4 = 10 − 2×3) — that's the honest new pacing, and it's deterministic on the fixed-step clock. The
  // killing 3rd hit skips the enemy's hit-flash (attack() only flashes a hit the target *survives* —
  // see GameScene.attack), so enemyHitFlashes still lands on 2.
  await emit(page, 'combat:attack');
  await step(page, ATTACK_COOLDOWN_MS + 20);
  await emit(page, 'combat:attack');
  await step(page, ATTACK_COOLDOWN_MS + 20);
  await emit(page, 'combat:attack');
  await step(page, 50);

  // Let every FX tween (hit-flash ~260ms, lunge/weapon-swing yoyos ~240–280ms) fully settle before the
  // snapshot, so tween-progress fields land on their rest values instead of mid-tween floats. Several
  // SMALLER step() calls, not one big one: a single very large `step(ms)` runs its many fixed sub-ticks
  // in one synchronous batch with no boundary for Phaser's tween-manager to flush a just-completed
  // tween's onComplete, so the hit-flash's Expo.easeOut tail can still read a small nonzero residual at
  // the end of one giant step even though real driven time is well past its 260ms duration (observed:
  // reliably settles to exactly 0 within ~600ms when driven in ≤200ms increments, per monster.spec's
  // patrol test using the same looped-step pattern) — this loop is ~3x that observed worst case.
  for (let i = 0; i < 10; i++) await step(page, 200);

  const snapshot = normalize(await state(page));

  expect(snapshot).toEqual({
    currentKind: null,
    pending: 0,
    pathLen: 0,
    sites: 1, // the one built wall (a finished BuildSite counts here too, not only unbuilt blueprints)
    buildMode: false,
    occupied: 1, // the wall's tile
    pcol: 10,
    prow: 10,
    px: 168, // player never moved — tileToWorldCenter(10) = 10*16 + 8
    py: 168,
    enemies: 0, // killed by the 3rd player attack
    enemyModes: [],
    enemyTiles: [],
    enemyWeapons: [],
    corpses: 1, // the killed enemy's death-collapse corpse (5-minute TEMP linger — see killEnemy)
    playerHp: 4, // 10 - two landed club bites (2×3: 2 base + kidZombie strength 1, armour 0) over the cooldown-paced fight
    playerDying: false,
    playerFlash: 0, // hit-flash tween (260ms) long settled by the final 10x200ms settle loop
    playerHitFlashes: 2, // the two landed club bites
    enemyHitFlashes: 2, // hits #1 and #2 (survived); the killing #3 skips flashHit
    enemyAttacks: 2, // two club bites land during the now longer, cooldown-paced fight
    mode: 'combat',
    hunger: 60.2, // 62 − HUNGER_DRAIN_PER_SEC (0.4/s) × the 4.5s of driven time (rounded, see normalize)
    dayPhase: 'day',
    dayCount: 1,
    clockMs: 24500, // 20_000 + 1600 + (420*2 + 50) + 10*200, bucketed to the nearest 50 (see normalize)
    nightAlpha: 0, // still deep in day 1 (DAY_MS 120_000), no twilight tint yet
    outlinedTreeIds: [],
    pulsingTreeId: null,
    queuedTreeIds: [],
    campfires: [], // plan 012: appended to DebugState; this scenario places no campfires
    enemyWindups: 0, // plan 035a: enemy dead by snapshot time — no wind-up in progress
    combatActive: false, // plan 035a Step 3: enemy dead + day-1 daytime → auto-surface predicate off
    bowTargetId: null, // plan 035a Step 5: this scenario never fires the bow → no target
    enemyHpBarsVisible: 0, // plan 035a Step 6: enemy dead + long settle → its bar dropped, none left
    waveActive: false, // plan 038 Step 7: day-1 daytime scenario (clockMs 20_000) → no night wave
    waveSpawns: 0, // no wave ran → nothing spawned
    enemyKinds: [], // the one scripted enemy is dead by snapshot time → no live enemies
    traps: [], // plan 040: appended to DebugState; this scenario places no spike traps
  });
});
