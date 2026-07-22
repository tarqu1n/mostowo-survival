import { test, expect } from '@playwright/test';
import { startGame, applyScenario, step, state } from './harness';
import { DAY_MS, NIGHT_MS, TWILIGHT_MS, NIGHT_MAX_ALPHA } from '../../src/config';

// Tier-2: the day/night clock advances through the REAL scene's per-frame survival tick (above the
// no-action early-return), driven deterministically via step(). The tint/phase/day math itself is
// Tier-1 (daynight.test.ts); these prove the clock is wired into update() and drives the overlay +
// derived phase/day state. Seed clockMs near a boundary so only a few driven slices cross it.

test('day flips to night and the night overlay darkens', async ({ page }) => {
  // plan 045 Step 1 interim — reduced in Step 8 once stepLogic removes the render cost
  test.setTimeout(60_000);
  await startGame(page);
  // Seed mid-day, just before the dusk cross-fade begins (overlay fully clear).
  await applyScenario(page, { clockMs: DAY_MS - TWILIGHT_MS - 100 });

  const before = await state(page);
  expect(before.dayPhase).toBe('day');
  expect(before.nightAlpha).toBeCloseTo(0, 2); // mid-day plateau: no dim

  // Step across the dusk ramp and past the DAY_MS boundary into deep night.
  await step(page, TWILIGHT_MS + 300);

  const after = await state(page);
  expect(after.dayPhase).toBe('night');
  expect(after.nightAlpha).toBeGreaterThan(before.nightAlpha);
  expect(after.nightAlpha).toBeCloseTo(NIGHT_MAX_ALPHA, 2); // deep night plateau
});

test('the day count increments after a full cycle', async ({ page }) => {
  await startGame(page);
  // Seed the tail of day 1's cycle (still night), just before it wraps to day 2's dawn.
  await applyScenario(page, { clockMs: DAY_MS + NIGHT_MS - 100 });

  const before = await state(page);
  expect(before.dayCount).toBe(1);
  expect(before.dayPhase).toBe('night');

  await step(page, 300); // cross the cycle boundary into day 2

  const after = await state(page);
  expect(after.dayCount).toBe(2);
  expect(after.dayPhase).toBe('day');
});
