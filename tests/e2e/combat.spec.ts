import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, step, state } from './harness';
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
