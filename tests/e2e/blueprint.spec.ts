import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  step,
  state,
  blocked,
  emit,
  wood,
  runSelection,
  tileToClient,
} from './harness';

/**
 * Tier-2: **Blueprint Mode** — the plan-050 build-experience overhaul (mirrors `gestures.spec.ts` +
 * the grid/occupancy `build.spec.ts`). Two halves:
 *  (a) **build-mode tap-vs-drag** (Step 3): placement moved from pointer-DOWN to pointer-UP, so a
 *      one-finger drag PANS instead of dropping+charging a tile on touch-down.
 *  (b) **line-tool run → commit bar** (Steps 6–7): arm the line tool, paint an axis-locked run of
 *      deferred ghosts (no spend), read the live tally, then Confirm commits ONLY the affordable
 *      subset (spends its cost, appends build orders) / Cancel drops it with no spend.
 *
 * Zooming to MIN_ZOOM pins the camera (whole map visible, no scroll room → follow never moves it) so
 * screen↔tile mapping stays fixed; the driven `step()` processes each queued pointer event
 * deterministically.
 */

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

// (a) build-mode input rework (plan 050 Step 3, the load-bearing change) — placement moved from
// pointer-DOWN to pointer-UP so a one-finger drag pans instead of dropping+charging for a tile on
// touch-down.
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

// (b) Blueprint-Mode commit bar (plan 050 Step 7) — paint a run with the line tool (deferred, no
// spend), then Confirm commits ONLY the affordable subset (spends its cost, appends build orders) and
// Cancel drops the run with no spend.
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
