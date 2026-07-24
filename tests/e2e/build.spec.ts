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
  runSelection,
  tileToClient,
} from './harness';
import { wallToRouteAround } from './scenarios';

/**
 * Arm the line tool and paint an axis-locked run of ghosts with a real pointer drag (plan 050 Step 6),
 * so a Step-7 commit spec exercises the true gesture→run→tally path. Camera must already be at MIN_ZOOM
 * (static, whole map visible) so screen↔tile mapping stays fixed; a single move to the far tile is
 * enough — BuildManager re-projects the whole straight line from the anchor regardless of the path. The
 * run STAYS pending on release (the line tool never commits on its own — that's the commit bar's job).
 */
async function paintRun(
  page: import('@playwright/test').Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await emit(page, 'build:lineTool', { on: true }); // arm the run-paint gesture
  const a = await tileToClient(page, from[0], from[1]);
  const b = await tileToClient(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await step(page, 16); // pointerdown → beginRun at the anchor tile
  await page.mouse.move(b.x, b.y);
  await step(page, 16); // drag to the far tile → extendRun re-projects the full straight line
  await page.mouse.up();
  await step(page, 16); // release ENDS the gesture; the run stays pending (no commit)
}

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

// Tier-2: Blueprint-Mode commit bar (plan 050 Step 7) — paint a run with the line tool (deferred, no
// spend), then Confirm commits ONLY the affordable subset (spends its cost, appends build orders) and
// Cancel drops the run with no spend. Camera pinned at MIN_ZOOM so screen↔tile mapping stays fixed.
test('commit bar: Confirm queues + spends exactly the affordable run subset, then builds', async ({
  page,
}) => {
  // Boot (~15s) + driving two serial worker builds in fixed 1/60s slices is heavy in wall-clock, so
  // give this build-through spec headroom over the default 30s per-test budget.
  test.setTimeout(60_000);
  await startGame(page);
  // 4 wood; the wall costs 2 → affords exactly 2 of a 5-tile run. Row 20 (cols 6–11) is open ground.
  await applyScenario(page, { player: [11, 20], wood: 4 });
  for (let i = 0; i < 4; i++) await emit(page, 'zoom:delta', -0.5); // → MIN_ZOOM, static camera
  await emit(page, 'build:select', { id: 'wall' }); // enter build mode, wall selected

  await paintRun(page, [10, 20], [6, 20]); // 5-tile horizontal run: cols 10,9,8,7,6

  // Live tally: the deferred run — 5 placeable tiles, only 2 affordable (4 wood / 2 each), nothing spent yet.
  const sel = await runSelection(page);
  expect(sel.tiles.length).toBe(5);
  expect(sel.placeableCount).toBe(5);
  expect(sel.affordableCount).toBe(2);
  expect(sel.totalCost).toEqual({ wood: 4 }); // 2 affordable × 2 wood
  expect((await state(page)).sites).toBe(0); // painting places NOTHING…
  expect(await wood(page)).toBe(4); // …and spends nothing

  await emit(page, 'build:commitRun'); // commit bar Confirm
  await step(page, 16);
  const committed = await state(page);
  expect(committed.sites).toBe(2); // exactly the affordable subset became blueprints
  expect(committed.pending + (committed.currentKind === 'build' ? 1 : 0)).toBe(2); // 2 build orders queued
  expect(await wood(page)).toBe(0); // spent exactly 2 × 2 = 4 wood, no more
  expect((await runSelection(page)).tiles.length).toBe(0); // run cleared on commit

  // Step the clock through both builds → each finishes into a blocking wall.
  await step(page, 16_000);
  const built = await state(page);
  expect(built.occupied).toBe(2); // both blueprints built out
  expect(await blocked(page, 10, 20)).toBe(true);
  expect(await blocked(page, 9, 20)).toBe(true);
});

test('commit bar: Cancel clears the pending run and spends nothing', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [11, 20], wood: 6 });
  for (let i = 0; i < 4; i++) await emit(page, 'zoom:delta', -0.5);
  await emit(page, 'build:select', { id: 'wall' });

  await paintRun(page, [10, 20], [6, 20]);
  expect((await runSelection(page)).tiles.length).toBe(5); // a run is pending

  await emit(page, 'build:cancelRun'); // commit bar Cancel
  await step(page, 16);
  const s = await state(page);
  expect((await runSelection(page)).tiles.length).toBe(0); // run dropped
  expect(s.sites).toBe(0); // no blueprints placed
  expect(await wood(page)).toBe(6); // nothing spent
});
