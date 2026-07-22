import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, step, captured } from './harness';

// Tier-2: camera follow-lock. A manual world drag (pan) breaks the follow-lock; the HUD FOLLOW
// button (camera:center) re-engages it. The drag uses fixed screen coords (no tile mapping), and each
// pointer action is processed by a driven step() rather than raced against the live RAF loop — the
// pan is a scene-clock-free gesture, so stepping (which also stops the loop) makes it deterministic
// under parallel load. Mirrors the gestures.spec pattern (pointer action → step to process).

test('a manual pan breaks follow-lock; FOLLOW re-engages it', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [11, 20] }); // DEFAULT_ZOOM has camera scroll room to pan

  // Drag across the world centre (clear of the HUD), far enough to count as a pan (> DRAG_PX = 12px).
  await page.mouse.move(240, 400);
  await page.mouse.down();
  await step(page, 16); // process pointerdown (also stops the live loop → deterministic from here)
  await page.mouse.move(240, 320, { steps: 6 });
  await step(page, 16); // process the drag → crosses DRAG_PX → pan breaks the follow-lock
  await page.mouse.up();
  await step(page, 16);
  expect(await captured(page, 'camera:followChanged')).toBe(false);

  await emit(page, 'camera:center'); // HUD FOLLOW button
  await step(page, 16);
  expect(await captured(page, 'camera:followChanged')).toBe(true);
});

// Tier-2: in Combat mode the movepad (tracked in UIScene) owns dragging, so a world drag must NOT
// pan the camera. Regression for "the camera is jumping around when changing direction": steering
// the movepad drags the thumb off the small pad, and that off-pad travel used to fall through to the
// camera-pan path, breaking the follow-lock and yanking the camera on every direction change.
test('Combat-mode dragging never pans the camera or breaks follow-lock', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [11, 20] });
  await emit(page, 'mode:combatToggle'); // enter Combat mode (movepad control)
  await step(page, 16);

  const following = () => page.evaluate(() => (window as any).game.registry.get('following'));
  expect(await following()).toBe(true);

  // Same clear-of-HUD drag that pans in Command mode (see above) — in Combat it must be a no-op.
  await page.mouse.move(240, 400);
  await page.mouse.down();
  await step(page, 16);
  await page.mouse.move(240, 320, { steps: 6 });
  await step(page, 16);
  await page.mouse.up();
  await step(page, 16);

  expect(await following()).toBe(true); // follow-lock intact — the drag never panned
  expect(await captured(page, 'camera:followChanged')).not.toBe(false);
});
