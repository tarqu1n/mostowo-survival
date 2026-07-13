import { test, expect } from '@playwright/test';
import { startGame, applyScenario, tileToClient, held } from './harness';

// Real command-mode tap-to-feed (an input-resolution regression, like gestures.spec.ts — so it drives
// actual pointer clicks on a live RAF loop rather than the deterministic step() harness). The campfire
// is bottom-anchored + multi-tile, so its flame renders a tile ABOVE its foot tile; feeding resolves
// the fire via the forgiving sprite raycast (ScenePicker.campfireAt), NOT a bare worldToTile — so a
// tap anywhere on the fire feeds it. Guards the bug where tapping the flame fell through to a move
// order ("walked at it") because only the exact foot tile matched.
test('a command-mode tap on the campfire flame (above its foot tile) feeds it one wood', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, { player: [22, 44], campfires: [[22, 40]], inventory: { wood: 5 } });
  await page.waitForTimeout(250); // let the follow-cam settle on the player

  const woodBefore = await held(page, 'wood');
  const flame = await tileToClient(page, 22, 39); // one tile above the foot (40) — the old miss
  const foot = await tileToClient(page, 22, 40); // the foot tile — always worked

  await page.mouse.click(flame.x, flame.y);
  await page.waitForTimeout(120);
  expect(await held(page, 'wood')).toBe(woodBefore - 1); // the fix: a flame tap now feeds

  await page.mouse.click(foot.x, foot.y);
  await page.waitForTimeout(120);
  expect(await held(page, 'wood')).toBe(woodBefore - 2); // foot tap still feeds
});
