import { test, expect } from '@playwright/test';
import { startGame, applyScenario, step, state, emit } from './harness';
import { HUNGER_DRAIN_PER_SEC, STARVE_DAMAGE_INTERVAL_MS } from '../../src/config';

// Tier-2: hunger drains through the REAL scene's per-frame tick and, at zero, routes STARVE_DAMAGE
// through combat's damagePlayer (plan 003) — proving the starvation→health cascade is wired. The
// clamp/feed/isStarving math is Tier-1 (needs.test.ts); here we drive the integrated loop via step().
//
// NOTE on step budget: step(ms) runs ms/(1000/60) full game-loop iterations synchronously over the
// whole (large) scene, so only a few seconds of game time fit the 30s test timeout — a literal "step
// a whole day" is impossible here. So, like survival-daynight, these specs step SHORT windows: the
// retune is pinned by *rate* (a full bar then lasts HUNGER_MAX / 0.15 ≈ 667s ≈ DAY_MS 660s ≈ one
// day, arithmetically), and the drain→starve cascade is exercised from a near-empty seed.

test('hunger drains over time', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { hunger: 40 });

  const before = await state(page);
  expect(before.hunger).toBeCloseTo(40, 0); // seeded ~40 (a couple real-time frames may nudge it)

  await step(page, 3000); // 0.15/s × 3s ≈ 0.45 drained

  const after = await state(page);
  expect(after.hunger).toBeLessThan(before.hunger);
});

// Pins the plan-041 retune rate (0.15/s, not the old 0.4/s): ~0.9 lost over 6s. At 0.15/s a full
// 100-pt bar empties in ~667s ≈ one 660s day — the "one food run per day" target. Flag-independent.
test('the retuned drain matches ~0.15/s (a full bar ≈ one day)', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { hunger: 100 });

  const before = (await state(page)).hunger;
  await step(page, 6000); // 6s — 360 fixed slices, inside the step budget

  const drained = before - (await state(page)).hunger;
  expect(drained).toBeGreaterThan(0.6); // excludes ~0 (no drain)
  expect(drained).toBeLessThan(1.4); // excludes the old 0.4/s rate (~2.4)
  expect(drained).toBeCloseTo(HUNGER_DRAIN_PER_SEC * 6, 1); // ≈ 0.9
});

test('a starving player loses HP', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { hunger: 0 }); // already starving

  const before = await state(page);
  const startHp = before.playerHp;
  expect(startHp).toBeGreaterThan(0);

  await step(page, STARVE_DAMAGE_INTERVAL_MS + 500); // past one starve-damage interval

  const after = await state(page);
  expect(after.playerHp).toBeLessThan(startHp);
});

// Roadmap Step-4 acceptance (HUNGER_LETHAL live), the "without eating" half: neglect drains the last
// of the bar to empty and then bleeds HP — the full drain→starve→cascade in one run. Seeded near
// empty so the whole arc fits the step budget (stays in the day phase — no night-wave confound).
test('neglecting food drains the bar to zero and then costs HP', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { hunger: 0.3 }); // a sliver left — empties ~2s in

  const startHp = (await state(page)).playerHp;
  expect(startHp).toBeGreaterThan(0);

  await step(page, 6000); // empties (~2s), then ~2 intervals of the 1 HP/2s starve cascade

  const after = await state(page);
  expect(after.hunger).toBe(0);
  expect(after.playerHp).toBeLessThan(startHp); // cascade fired
  expect(after.playerHp).toBeGreaterThan(0); // but not a full starve-out
});

// Roadmap Step-4 acceptance, the "with eating" half: eating a berry lifts the bar and keeps the
// player whole across the same span — no HP lost. Mirrors the eat wiring in survival-forage.spec.ts.
test('eating a berry relieves hunger and keeps the player off the starve cascade', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, { hunger: 3, inventory: { berries: 5 } });

  const startHp = (await state(page)).playerHp;

  await step(page, 3000); // drift down a little
  const beforeEat = (await state(page)).hunger;

  await emit(page, 'needs:eat', { itemId: 'berries' });
  const afterEat = (await state(page)).hunger;
  expect(afterEat).toBeGreaterThan(beforeEat); // eating relieves it

  await step(page, 3000);
  const after = await state(page);
  expect(after.hunger).toBeGreaterThan(0); // never bottomed out
  expect(after.playerHp).toBe(startHp); // so no HP lost
});
