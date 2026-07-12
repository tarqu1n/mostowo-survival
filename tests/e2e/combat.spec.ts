import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, step, state, captured } from './harness';
import { oneZombie } from './scenarios';

// Tier-2: the enemy AI + contact damage + Punch paths through the real scene. Damage/hit-chance math
// is Tier-1 (combat.ts); these prove the scene wires them to movement, cooldowns and the Punch input.

test('a chasing zombie closes distance and contact-damages the player', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, oneZombie()); // player [10,10], zombie two tiles east

  const before = (await state(page)).playerHp;
  await step(page, 4000); // aggro (within vision) → chase → adjacent → one contact hit
  const after = (await state(page)).playerHp;

  expect(after).toBeLessThan(before);
});

test('Punch kills an adjacent kid zombie in three hits', async ({ page }) => {
  await startGame(page);
  // Player facing right with the zombie on the adjacent tile; Combat mode so Punch is live.
  await applyScenario(page, { player: [10, 10], zombies: [[11, 10]], facing: 'right', mode: 'combat' });
  expect((await state(page)).zombies).toBe(1);

  // kidZombie maxHp 3, unarmed flat-1 damage → exactly three punches. dodge 0 → always hits.
  for (let i = 0; i < 3; i++) {
    await emit(page, 'combat:punch');
    await step(page, 100); // let the swing/kill resolve
  }
  expect((await state(page)).zombies).toBe(0);
});

test('Punch connects with a tall enemy body, not only its feet tile', async ({ page }) => {
  await startGame(page);
  // Zombie feet at row 10; its ~2-tile body (hurtbox height 2) overhangs UP into row 9. Player one
  // tile above that torso, facing down → Punch targets row 9, the torso tile (NOT the feet tile).
  // Without the body hurtbox this whiffs. No step() between punches, so the zombie stays on its
  // frame-0 tile (Punch resolves synchronously) — three flat-1 hits on maxHp 3 kill it.
  await applyScenario(page, { player: [10, 8], zombies: [[10, 10]], facing: 'down', mode: 'combat' });
  expect((await state(page)).zombies).toBe(1);

  for (let i = 0; i < 3; i++) await emit(page, 'combat:punch');
  expect((await state(page)).zombies).toBe(0);
});

test('a biting zombie plays an attack lunge and the player flashes on the hit', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, oneZombie()); // player [10,10], zombie two tiles east

  await step(page, 4000); // aggro → chase → adjacent → at least one bite lands
  const s = await state(page);
  // The skeleton has no attack strip, so the bite is a coded lunge — assert it fired, and that the
  // landed bite triggered the player's red-flash hit reaction (dodge 0, so the bite always connects).
  expect(s.zombieAttacks).toBeGreaterThan(0);
  expect(s.playerHitFlashes).toBeGreaterThan(0);
  // A landed bite also emits `player:hit` — the cue UIScene turns into the camera kick + damage vignette.
  expect(await captured(page, 'player:hit')).toBeTruthy();
});

test('punching a surviving zombie triggers its hit flash', async ({ page }) => {
  await startGame(page);
  // Adjacent zombie the player faces, Combat mode so Punch is live. kidZombie maxHp 3, flat-1 damage →
  // one punch leaves it alive, so the hit flash (not a death/destroy) is what we should see.
  await applyScenario(page, { player: [10, 10], zombies: [[11, 10]], facing: 'right', mode: 'combat' });

  await emit(page, 'combat:punch');
  await step(page, 50); // let the flash bookkeeping run a frame
  const s = await state(page);
  expect(s.zombies).toBe(1); // survived the single hit
  expect(s.zombieHitFlashes).toBeGreaterThan(0);
});

test('a punched-dead zombie leaves a lingering corpse playing its death collapse', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [10, 10], zombies: [[11, 10]], facing: 'right', mode: 'combat' });

  for (let i = 0; i < 3; i++) await emit(page, 'combat:punch'); // kidZombie maxHp 3, flat-1 → dead on the 3rd

  // Killed = out of the AI set immediately, but the sprite lingers as a corpse playing the one-shot
  // Death strip — it isn't destroyed on the same frame it dies (that was the old instant `destroy()`).
  const dead = await state(page);
  expect(dead.zombies).toBe(0);
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

  // Same drive, but begin a Punch swing first: the punch-lock window slows movement to ATTACK_MOVE_SLOW.
  await applyScenario(page, { player: [10, 10], mode: 'combat' });
  const startSlow = (await state(page)).px;
  await emit(page, 'combat:punch'); // starts the swing (~400ms lock), so 300ms of the drive is slowed
  await emit(page, 'combat:move', { dx: 1, dy: 0 });
  await step(page, 300);
  const slowDist = (await state(page)).px - startSlow;

  expect(fullDist).toBeGreaterThan(20); // sanity: it really moved at full speed
  expect(slowDist).toBeGreaterThan(0); // still creeps forward, not frozen
  expect(slowDist).toBeLessThan(fullDist * 0.35); // ~20% of normal (slack for the punch-lock edge)
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
