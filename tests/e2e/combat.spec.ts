import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, step, state, captured } from './harness';
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
  await applyScenario(page, { player: [10, 10], enemies: [[11, 10]], facing: 'right', mode: 'combat' });
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
  await applyScenario(page, { player: [10, 8], enemies: [[10, 10]], facing: 'down', mode: 'combat' });
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

test('attacking a surviving enemy triggers its hit flash', async ({ page }) => {
  await startGame(page);
  // Adjacent enemy the player faces, Combat mode so Attack is live. kidZombie maxHp 3, flat-1 damage →
  // one attack leaves it alive, so the hit flash (not a death/destroy) is what we should see.
  await applyScenario(page, { player: [10, 10], enemies: [[11, 10]], facing: 'right', mode: 'combat' });

  await emit(page, 'combat:attack');
  await step(page, 50); // let the flash bookkeeping run a frame
  const s = await state(page);
  expect(s.enemies).toBe(1); // survived the single hit
  expect(s.enemyHitFlashes).toBeGreaterThan(0);
});

test('a killed enemy leaves a lingering corpse playing its death collapse', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [10, 10], enemies: [[11, 10]], facing: 'right', mode: 'combat' });

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

test('attacking slows the player — a mid-swing movepad drive covers far less ground', async ({ page }) => {
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
