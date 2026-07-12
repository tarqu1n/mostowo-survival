import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, state, captured } from './harness';

// Tier-2: the three mutually-exclusive input modes toggle correctly and broadcast 'mode:changed'
// (which UIScene mirrors for button highlight + Combat-control visibility).

test('Combat and Inspect toggles switch the authoritative mode, mutually exclusive', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [11, 20] });
  expect((await state(page)).mode).toBe('command');

  await emit(page, 'mode:combatToggle');
  expect((await state(page)).mode).toBe('combat');
  expect(await captured(page, 'mode:changed')).toBe('combat');

  await emit(page, 'mode:inspectToggle'); // Inspect replaces Combat (mutually exclusive)
  expect((await state(page)).mode).toBe('inspect');
  expect(await captured(page, 'mode:changed')).toBe('inspect');

  await emit(page, 'mode:inspectToggle'); // toggling the active mode returns to Command
  expect((await state(page)).mode).toBe('command');
});
