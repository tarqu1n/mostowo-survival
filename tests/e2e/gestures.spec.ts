import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, step, state, tileToClient } from './harness';

// Tier-2: the long-press → queue-paint gesture, made deterministic by the driven step. The paint
// gate is scene-clock based (`this.time.now - pressStart >= LONGPRESS_MS`, unlike the wall-clock
// pointer.getDuration used for tap-vs-append), so advancing the clock with step() crosses the
// threshold with zero wall-clock. Zooming to MIN_ZOOM pins the camera (whole map visible, no scroll
// room → follow never moves it), so screen↔tile mapping stays fixed across the whole gesture.
test('holding then dragging paints multiple queued orders in one gesture', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [11, 20] });
  for (let i = 0; i < 4; i++) await emit(page, 'zoom:delta', -0.5); // → MIN_ZOOM, static camera

  const a = await tileToClient(page, 8, 20);
  const b = await tileToClient(page, 6, 20);

  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await step(page, 16); // process pointerdown → pressStart = scene clock now (also stops the loop)
  await step(page, 400); // advance the scene clock past LONGPRESS_MS (350) with no wall-clock

  await page.mouse.move(a.x, a.y); // first move past the threshold → enter paint, append tile A
  await step(page, 16);
  await page.mouse.move(b.x, b.y); // drag onto tile B → append it too
  await step(page, 16);
  await page.mouse.up();
  await step(page, 16);

  // Two distinct tiles painted in one continuous press: the first became current (worker was idle),
  // the second is pending — a tap could only ever produce one order, so this is the paint path.
  const s = await state(page);
  expect(s.currentKind).toBe('move');
  expect(s.pending).toBe(1);
});
