import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  order,
  step,
  state,
  blocked,
  emit,
  wood,
  tileToClient,
} from './harness';
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

// Tier-2: build-mode input rework (plan 050 Step 3, the load-bearing change) — placement moved from
// pointer-DOWN to pointer-UP so a one-finger drag pans instead of dropping+charging for a tile on
// touch-down. Zooming to MIN_ZOOM pins the camera (whole map visible, no scroll room) so screen↔tile
// mapping stays fixed; the driven step() processes each queued pointer event deterministically.
test('build mode: a tap places+spends exactly one tile on release (nothing on down)', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, { player: [11, 20], wood: 10 }); // 10 wood; the wall costs 2
  for (let i = 0; i < 4; i++) await emit(page, 'zoom:delta', -0.5); // → MIN_ZOOM, static camera
  await emit(page, 'build:select', { id: 'wall' }); // enter build mode, wall selected

  const t = await tileToClient(page, 10, 20); // empty tile adjacent to the player → reachable

  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await step(page, 16); // process pointerdown → ARM only (ghost tracks; nothing placed/charged)
  expect((await state(page)).sites).toBe(0); // the load-bearing invariant: down does NOT place
  expect(await wood(page)).toBe(10); // …nor spend

  await page.mouse.up();
  await step(page, 16); // pointerup (never dragged) → single-tap placement resolves here
  const s = await state(page);
  expect(s.sites).toBe(1); // exactly one blueprint placed, on release
  expect(await wood(page)).toBe(8); // the wall's 2 wood spent exactly once
});

test('build mode: a one-finger drag pans and places/charges nothing', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [11, 20], wood: 10 });
  for (let i = 0; i < 4; i++) await emit(page, 'zoom:delta', -0.5); // → MIN_ZOOM
  await emit(page, 'build:select', { id: 'wall' });

  const a = await tileToClient(page, 10, 20);
  const b = await tileToClient(page, 2, 20); // 8 tiles away → well past DRAG_PX → a drag, not a tap

  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await step(page, 16); // ARM
  await page.mouse.move(b.x, b.y); // drag past DRAG_PX → classified as a pan
  await step(page, 16);
  await page.mouse.up();
  await step(page, 16); // pointerup after a drag → NO placement (the drag panned)
  const s = await state(page);
  expect(s.sites).toBe(0); // nothing placed
  expect(await wood(page)).toBe(10); // nothing charged
});
