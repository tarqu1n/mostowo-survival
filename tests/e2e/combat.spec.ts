import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, step, state, captured, order, moveEnemy } from './harness';
import { oneEnemy } from './scenarios';

// Tier-2: the enemy AI + contact damage + Attack paths through the real scene. Damage/hit-chance math
// is Tier-1 (combat.ts); these prove the scene wires them to movement, cooldowns and the Attack input.

test('a chasing enemy closes distance and contact-damages the player', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, oneEnemy()); // player [10,10], enemy two tiles east

  const before = (await state(page)).playerHp;
  await step(page, 4000); // aggro (within vision) → chase → adjacent → one contact hit
  const after = (await state(page)).playerHp;

  expect(after).toBeLessThan(before);
});

test('Attack kills an adjacent enemy in three hits', async ({ page }) => {
  await startGame(page);
  // Player facing right with the enemy on the adjacent tile; Combat mode so Attack is live.
  await applyScenario(page, {
    player: [10, 10],
    enemies: [[11, 10]],
    facing: 'right',
    mode: 'combat',
  });
  expect((await state(page)).enemies).toBe(1);

  // kidZombie maxHp 3, unarmed flat-1 damage → exactly three attacks. dodge 0 → always hits.
  for (let i = 0; i < 3; i++) {
    await emit(page, 'combat:attack');
    await step(page, 100); // let the swing/kill resolve
  }
  expect((await state(page)).enemies).toBe(0);
});

test('Attack connects with a tall enemy body, not only its feet tile', async ({ page }) => {
  await startGame(page);
  // Enemy feet at row 10; its ~2-tile body (hurtbox height 2) overhangs UP into row 9. Player one
  // tile above that torso, facing down → Attack targets row 9, the torso tile (NOT the feet tile).
  // Without the body hurtbox this whiffs. No step() between attacks, so the enemy stays on its
  // frame-0 tile (Attack resolves synchronously) — three flat-1 hits on maxHp 3 kill it.
  await applyScenario(page, {
    player: [10, 8],
    enemies: [[10, 10]],
    facing: 'down',
    mode: 'combat',
  });
  expect((await state(page)).enemies).toBe(1);

  for (let i = 0; i < 3; i++) await emit(page, 'combat:attack');
  expect((await state(page)).enemies).toBe(0);
});

test('a biting enemy plays an attack lunge and the player flashes on the hit', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, oneEnemy()); // player [10,10], enemy two tiles east

  await step(page, 4000); // aggro → chase → adjacent → at least one bite lands
  const s = await state(page);
  // The skeleton has no attack strip, so the bite is a coded lunge — assert it fired, and that the
  // landed bite triggered the player's red-flash hit reaction (dodge 0, so the bite always connects).
  expect(s.enemyAttacks).toBeGreaterThan(0);
  expect(s.playerHitFlashes).toBeGreaterThan(0);
  // A landed bite also emits `player:hit` — the cue UIScene turns into the camera kick + damage vignette.
  expect(await captured(page, 'player:hit')).toBeTruthy();
});

test('a skeleton telegraphs a wind-up before its bite lands (plan 035a)', async ({ page }) => {
  await startGame(page);
  // Enemy already adjacent + chasing with a club (dodge 0 → the bite always connects).
  await applyScenario(page, {
    player: [10, 10],
    enemies: [{ at: [11, 10], mode: 'chase', weaponId: 'club' }],
  });
  const before = (await state(page)).playerHp;

  // The bite is now telegraphed: the enemy freezes in a wind-up (ENEMY_ATTACK_WINDUP_MS, 350) before
  // the strike lands. Drive in slices finer than the wind-up and prove the ordering holds regardless
  // of exactly when the cadence gate opens (the DEV clock's absolute origin is wall-clock-dependent):
  // at some slice the enemy is mid-wind-up with the player still unhurt, and only later does HP drop.
  let sawWindupBeforeDamage = false;
  let damageLanded = false;
  for (let i = 0; i < 40 && !damageLanded; i++) {
    await step(page, 100);
    const s = await state(page);
    if (s.enemyWindups > 0 && s.playerHp === before) sawWindupBeforeDamage = true; // telegraphing, not yet bitten
    if (s.playerHp < before) damageLanded = true;
  }
  expect(sawWindupBeforeDamage).toBe(true); // a readable wind-up ran with no damage yet — the window to disengage
  expect(damageLanded).toBe(true); // the strike eventually landed the bite
});

test('attacking a surviving enemy triggers its hit flash', async ({ page }) => {
  await startGame(page);
  // Adjacent enemy the player faces, Combat mode so Attack is live. kidZombie maxHp 3, flat-1 damage →
  // one attack leaves it alive, so the hit flash (not a death/destroy) is what we should see.
  await applyScenario(page, {
    player: [10, 10],
    enemies: [[11, 10]],
    facing: 'right',
    mode: 'combat',
  });

  await emit(page, 'combat:attack');
  await step(page, 50); // let the flash bookkeeping run a frame
  const s = await state(page);
  expect(s.enemies).toBe(1); // survived the single hit
  expect(s.enemyHitFlashes).toBeGreaterThan(0);
});

test('a killed enemy leaves a lingering corpse playing its death collapse', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, {
    player: [10, 10],
    enemies: [[11, 10]],
    facing: 'right',
    mode: 'combat',
  });

  for (let i = 0; i < 3; i++) await emit(page, 'combat:attack'); // kidZombie maxHp 3, flat-1 → dead on the 3rd

  // Killed = out of the AI set immediately, but the sprite lingers as a corpse playing the one-shot
  // Death strip — it isn't destroyed on the same frame it dies (that was the old instant `destroy()`).
  const dead = await state(page);
  expect(dead.enemies).toBe(0);
  expect(dead.corpses).toBe(1);

  // The corpse holds its settled final frame for a long linger (currently 5 min), so it's still
  // present well past the ~1s collapse — it does not vanish on animation end.
  await step(page, 2000);
  expect((await state(page)).corpses).toBe(1);
});

test('attacking slows the player — a mid-swing movepad drive covers far less ground', async ({
  page,
}) => {
  await startGame(page);

  // Baseline: drive east for 300ms at full speed (no swing in progress).
  await applyScenario(page, { player: [10, 10], mode: 'combat' });
  const startFull = (await state(page)).px;
  await emit(page, 'combat:move', { dx: 1, dy: 0 });
  await step(page, 300);
  const fullDist = (await state(page)).px - startFull;

  // Same drive, but begin a Attack swing first: the attack-lock window slows movement to ATTACK_MOVE_SLOW.
  await applyScenario(page, { player: [10, 10], mode: 'combat' });
  const startSlow = (await state(page)).px;
  await emit(page, 'combat:attack'); // starts the swing (~400ms lock), so 300ms of the drive is slowed
  await emit(page, 'combat:move', { dx: 1, dy: 0 });
  await step(page, 300);
  const slowDist = (await state(page)).px - startSlow;

  expect(fullDist).toBeGreaterThan(20); // sanity: it really moved at full speed
  expect(slowDist).toBeGreaterThan(0); // still creeps forward, not frozen
  expect(slowDist).toBeLessThan(fullDist * 0.35); // ~20% of normal (slack for the attack-lock edge)
});

test('firing the bow slows the player only lightly — kite-able, unlike melee (plan 035a)', async ({
  page,
}) => {
  await startGame(page);

  // Baseline: drive east for 300ms at full speed.
  await applyScenario(page, { player: [10, 10], mode: 'combat' });
  const startFull = (await state(page)).px;
  await emit(page, 'combat:move', { dx: 1, dy: 0 });
  await step(page, 300);
  const fullDist = (await state(page)).px - startFull;

  // Same drive after firing the bow: the bow-fire lock slows movement only to BOW_MOVE_SLOW (0.75) —
  // you keep kiting. Contrast the melee test above (~0.2, near-rooted).
  await applyScenario(page, { player: [10, 10], mode: 'combat' });
  const startBow = (await state(page)).px;
  await emit(page, 'combat:bow'); // BOW_DRAW_MS lock (~450ms) covers the whole 300ms drive
  await emit(page, 'combat:move', { dx: 1, dy: 0 });
  await step(page, 300);
  const bowDist = (await state(page)).px - startBow;

  expect(fullDist).toBeGreaterThan(20); // sanity: full speed really moved
  expect(bowDist).toBeLessThan(fullDist * 0.95); // it IS slowed while shooting
  expect(bowDist).toBeGreaterThan(fullDist * 0.55); // but far lighter than melee's ~0.2 — still kiting
});

test('the bow auto-targets the nearest enemy in the facing direction (plan 035a)', async ({
  page,
}) => {
  await startGame(page);
  // Player faces right. One enemy east (in the facing hemisphere), one south (off-facing) — both well
  // within bow range (BOW_RANGE_TILES 6). Facing-bias must lock the eastward one, not the southward.
  const { enemyIds } = await applyScenario(page, {
    player: [10, 10],
    facing: 'right',
    mode: 'combat',
    enemies: [
      [13, 10],
      [10, 13],
    ],
  });

  await emit(page, 'combat:bow');
  await step(page, 50); // resolve the shot + one frame of syncBowTarget
  const s = await state(page);
  expect(s.bowTargetId).toBe(enemyIds[0]); // the eastward enemy (spec order), not the southward one
  expect(s.enemyHitFlashes).toBeGreaterThan(0); // the target took a ranged hit (kidZombie hp3, bow 2 → survived)
});

test('the bow kills an enemy from range while the player stays put, then clears its target (plan 035a)', async ({
  page,
}) => {
  await startGame(page);
  // Enemy 5 tiles north — inside bow range (6), never adjacent. Player faces up, no movepad drive, so
  // the player never closes the gap: the whole kill lands at range.
  await applyScenario(page, {
    player: [10, 10],
    facing: 'up',
    mode: 'combat',
    enemies: [[10, 5]],
  });
  expect((await state(page)).enemies).toBe(1);

  // kidZombie maxHp 3, bow BOW_BASE_DAMAGE 2 (player dex 0), dodge 0 → two arrows kill it.
  await emit(page, 'combat:bow');
  await step(page, 100);
  expect((await state(page)).enemies).toBe(1); // first shot: 3 → 1, still alive

  await emit(page, 'combat:bow');
  await step(page, 100);
  const s = await state(page);
  expect(s.enemies).toBe(0); // second shot killed it from range
  expect(s.pcol).toBe(10); // player never moved to melee — the fight was purely ranged
  expect(s.prow).toBe(10);
  expect(s.bowTargetId).toBeNull(); // the auto-target cleared when it died (highlight hides with it)
});

test('hitting an enemy reveals a brief HP bar that fades; no hit → no bar (plan 035a)', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, {
    player: [10, 10],
    enemies: [[11, 10]],
    facing: 'right',
    mode: 'combat',
  });
  await step(page, 50);
  expect((await state(page)).enemyHpBarsVisible).toBe(0); // un-hit, not a bow target → no bar

  await emit(page, 'combat:attack'); // one melee hit (kidZombie hp3 − 1 = 2, survives)
  await step(page, 50);
  expect((await state(page)).enemyHpBarsVisible).toBeGreaterThanOrEqual(1); // on-hit bar revealed

  // Past HP_BAR_SHOW_MS (2500) with no further hits → the brief bar fades out (enemy still alive,
  // not the bow target, HP 2/3 so not near-death — nothing keeps the bar up).
  await step(page, 2800);
  const s = await state(page);
  expect(s.enemies).toBe(1); // still alive — the bar dropped on timeout, not on death
  expect(s.enemyHpBarsVisible).toBe(0);
});

test('the bow target keeps its HP bar persistently, past the on-hit fade (plan 035a)', async ({
  page,
}) => {
  await startGame(page);
  // Enemy 5 tiles north, in bow range; player faces up. One bow shot (2 dmg) leaves it alive.
  await applyScenario(page, {
    player: [10, 10],
    facing: 'up',
    mode: 'combat',
    enemies: [[10, 5]],
  });

  await emit(page, 'combat:bow');
  await step(page, 50);
  let s = await state(page);
  expect(s.bowTargetId).not.toBeNull(); // locked as the bow target
  expect(s.enemyHpBarsVisible).toBeGreaterThanOrEqual(1);

  // Well past HP_BAR_SHOW_MS: an on-hit-only bar would have faded, but the bow TARGET keeps its bar.
  await step(page, 2800);
  s = await state(page);
  expect(s.enemies).toBe(1); // survived the single shot
  expect(s.bowTargetId).not.toBeNull(); // still the target (alive + in range)
  expect(s.enemyHpBarsVisible).toBeGreaterThanOrEqual(1); // persistent target bar
});

test('an enemy near surfaces combat controls, and the movepad drives while a queued order survives (plan 035a)', async ({
  page,
}) => {
  await startGame(page);
  // Command mode (default). Enemy 3 tiles east — inside COMBAT_ACTIVE_RADIUS_TILES (7).
  await applyScenario(page, { player: [10, 10], enemies: [[13, 10]] });
  await step(page, 50); // one frame so update() recomputes combatActive
  let s = await state(page);
  expect(s.combatActive).toBe(true); // enemy-near trigger surfaced the controls
  expect(s.mode).toBe('command'); // NOT auto-switched to Combat mode (that would cancel the queue)

  // Queue a move order far south; the auto-surface reveal must NOT cancel it.
  await order(page, { kind: 'move', col: 10, row: 20 });
  expect((await state(page)).currentKind).toBe('move');

  // The movepad drives the player directly while auto-surfaced (command mode + combatActive) — proving
  // there's no dead movepad (critique #2). It overrides the pathing order for the frames it's held,
  // but the order still survives in the queue (chosen precedence: movepad drives, taps still queue).
  const before = (await state(page)).px;
  await emit(page, 'combat:move', { dx: 1, dy: 0 });
  await step(page, 300);
  s = await state(page);
  expect(s.px).toBeGreaterThan(before); // moved east under movepad control
  expect(s.currentKind).toBe('move'); // the pending move order survived the reveal + the pad drive
});

test('night surfaces combat controls at dusk and retracts at dawn when no enemy is near (plan 035a)', async ({
  page,
}) => {
  await startGame(page);
  // Night start, no enemies anywhere — the night trigger alone must surface the controls.
  await applyScenario(page, { player: [10, 10], startPhase: 'night' });
  await step(page, 50); // one frame so update() recomputes combatActive
  let s = await state(page);
  expect(s.dayPhase).toBe('night');
  expect(s.combatActive).toBe(true); // night trigger

  // Flip to day (dev toggle) with no enemy near → the predicate retracts.
  await emit(page, 'debug:toggleTime'); // night -> day
  await step(page, 50);
  s = await state(page);
  expect(s.dayPhase).toBe('day');
  expect(s.combatActive).toBe(false); // retracted at dawn — no enemy near, daytime
});

test('the movepad drives the player directly, bypassing the pathfinder', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [10, 10], mode: 'combat' });

  // A movepad vector sets velocity directly (no task queue, no path) — the player just translates.
  await emit(page, 'combat:move', { dx: 1, dy: 0 });
  await step(page, 800);
  const s = await state(page);
  expect(s.pcol).toBeGreaterThan(10); // moved east
  expect(s.currentKind).toBeNull(); // no task/path was involved
});

test('the auto-surface predicate has hysteresis — an enemy at the boundary does not flicker the controls (plan 035b playtest fix)', async ({
  page,
}) => {
  await startGame(page);
  // Enemy exactly at COMBAT_ACTIVE_RADIUS_TILES (7) east of the player → the controls engage.
  await applyScenario(page, { player: [10, 10], enemies: [[17, 10]] });
  await step(page, 50);
  expect((await state(page)).combatActive).toBe(true);

  // Relocate the enemy to 8 tiles away: past the activation radius (7) but inside the release band
  // (7 + COMBAT_ACTIVE_HYSTERESIS_TILES = 10). WITHOUT hysteresis this would drop combatActive every
  // frame it crossed the line; WITH it, the controls hold. (One frame can't clobber the injected
  // tile — col/row only snap on reaching a waypoint, and updateCombatActive reads before the AI moves.)
  expect(await moveEnemy(page, 0, 18, 10)).toBe(true);
  await step(page, 16);
  expect((await state(page)).combatActive).toBe(true);

  // 11 tiles away: finally beyond the release radius (10) → the controls retract.
  await moveEnemy(page, 0, 21, 10);
  await step(page, 16);
  expect((await state(page)).combatActive).toBe(false);
});
