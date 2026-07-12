import { test, expect } from '@playwright/test';
import { startGame, applyScenario, order, step, state, blocked, emit } from './harness';
import { wallToRouteAround } from './scenarios';

// Tier-2: building + occupancy on the REAL grid (blueprint passable while unbuilt → worker builds it
// → solid blocking wall), and that the pathfinder respects that live grid.

test('a placed blueprint is passable until built, then becomes a blocking wall', async ({
  page,
}) => {
  await startGame(page);
  // Player adjacent to a single blueprint (stand tile is the player's own tile → builds in place).
  const { siteIds } = await applyScenario(page, { player: [3, 3], blueprints: [[4, 3]], wood: 0 });

  expect(await blocked(page, 4, 3)).toBe(false); // blueprint is passable while unbuilt
  const occBefore = (await state(page)).occupied;

  await order(page, { kind: 'build', siteId: siteIds[0] });
  await step(page, 4000); // BUILD_MS 2500 + a short approach

  expect(await blocked(page, 4, 3)).toBe(true); // finished wall now blocks
  expect((await state(page)).occupied).toBe(occBefore + 1);
});

test('a built wall blocks its tile and the pathfinder will not path onto it', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, wallToRouteAround()); // player [3,3], solid wall [5,5]

  expect(await blocked(page, 5, 5)).toBe(true);
  expect(await blocked(page, 6, 6)).toBe(false);

  // Ordering a move ONTO the wall is unreachable → the order drops immediately (no path, no move).
  await order(page, { kind: 'move', col: 5, row: 5 });
  const s = await state(page);
  expect(s.currentKind).toBeNull();
  expect(s.pcol).toBe(3);
  expect(s.prow).toBe(3);
});

test('Cancel clears the queue but leaves the blueprint standing (non-destructive)', async ({
  page,
}) => {
  await startGame(page);
  const { siteIds } = await applyScenario(page, { player: [3, 3], blueprints: [[4, 3]] });
  await order(page, { kind: 'build', siteId: siteIds[0] });
  expect((await state(page)).currentKind).toBe('build');

  await emit(page, 'tasks:cancel'); // HUD Cancel button
  const s = await state(page);
  expect(s.currentKind).toBeNull(); // queue cleared
  expect(s.pending).toBe(0);
  expect(s.sites).toBe(1); // blueprint survives
  expect(await blocked(page, 4, 3)).toBe(false); // still an unbuilt, passable blueprint
});
