import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, cameraZoom, captured } from './harness';

// Tier-2: camera zoom clamps to [MIN_ZOOM, MAX_ZOOM] and broadcasts the clamped value the HUD
// readout mirrors. Driven via the zoom:delta event the HUD ± buttons emit.

test('zoom clamps to the max and broadcasts the clamped value', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [11, 20] });

  // Push well past MAX_ZOOM (3) in ZOOM_STEP (0.5) increments.
  for (let i = 0; i < 8; i++) await emit(page, 'zoom:delta', 0.5);
  expect(await cameraZoom(page)).toBe(3);
  expect(await captured(page, 'zoom:changed')).toBe(3); // the value the readout shows

  // And clamps to MIN_ZOOM (1) going the other way.
  for (let i = 0; i < 8; i++) await emit(page, 'zoom:delta', -0.5);
  expect(await cameraZoom(page)).toBe(1);
  expect(await captured(page, 'zoom:changed')).toBe(1);
});
