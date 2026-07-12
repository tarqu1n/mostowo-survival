import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, captured } from './harness';

// Tier-2: camera follow-lock. A manual world drag (pan) breaks the follow-lock; the HUD FOLLOW
// button (camera:center) re-engages it. Driven with real pointer events on the running loop (no
// driven step — this is a wall-clock-free gesture: a quick drag, no gameplay timing asserted).

test('a manual pan breaks follow-lock; FOLLOW re-engages it', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [11, 20] }); // DEFAULT_ZOOM has camera scroll room to pan

  // Drag across the world centre (clear of the HUD), far enough to count as a pan (> DRAG_PX).
  await page.mouse.move(240, 400);
  await page.mouse.down();
  await page.mouse.move(240, 320, { steps: 6 });
  await page.mouse.up();
  expect(await captured(page, 'camera:followChanged')).toBe(false);

  await emit(page, 'camera:center'); // HUD FOLLOW button
  expect(await captured(page, 'camera:followChanged')).toBe(true);
});
