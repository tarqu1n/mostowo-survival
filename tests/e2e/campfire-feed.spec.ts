import { test, expect } from '@playwright/test';
import { startGame, applyScenario, tileToClient, held, state, step } from './harness';

// Real command-mode tap-to-refuel (an input-resolution regression). Drives an ACTUAL pointer click on
// the flame, but fully deterministically (no wall-clock): the live loop is stopped up front, the
// follow-cam is settled with a driven frame (lerp=1 → snaps to the player, so screen↔tile mapping is
// fixed), the tap is processed via step() the way gestures.spec does, and the walk+tend runs in driven
// frames. Plan 016: a tap on a campfire no longer instant-feeds — it QUEUES a refuel worker order (walk
// adjacent, then tend). The campfire is bottom-anchored + multi-tile, so its flame renders a tile ABOVE
// its foot tile; ScenePicker column-hit-tests the whole tile stack, so a tap anywhere on the fire
// resolves to the fire (a `refuel` action), NOT a move. Guards the bug where tapping the flame fell
// through to a move order and "walked the worker into" the blocking fire tile.
test('a command-mode tap on the campfire flame queues a refuel and the worker tends it', async ({
  page,
}) => {
  await startGame(page);
  // Player seeded adjacent to the fire foot (22,40) so the tended walk is a fixed one tile — no
  // wall-clock real-time trek. Fire below full so a refuel has room to feed (a full fire refuses).
  await applyScenario(page, {
    player: [22, 41],
    campfires: [[22, 40]],
    campfireFuel: 30,
    inventory: { wood: 5 },
  });
  await step(page, 16); // stop the live loop + settle the follow-cam on the player (was waitForTimeout)

  const woodBefore = await held(page, 'wood');
  const flame = await tileToClient(page, 22, 39); // one tile ABOVE the foot (40) — the old fall-through

  // Self-healing flame tap (mirrors harness.bootIntoGame's retried menu tap): click, process it with a
  // driven step, and retry until the tap resolves to a QUEUED refuel — a too-early/dropped tap self-heals
  // instead of hanging on a wall-clock wait. A wrong fall-through to a move would never satisfy this and
  // would fail the gate below, so the regression still surfaces.
  let queued = false;
  for (let attempt = 0; attempt < 8 && !queued; attempt++) {
    await page.mouse.click(flame.x, flame.y);
    await step(page, 16);
    const s = await state(page);
    queued = s.currentKind === 'refuel' || s.pending > 0;
  }
  expect(queued).toBe(true);

  await step(page, 3000); // walk the one tile over + tend (one wood/s), all in driven frames

  // The flame tap resolved to the fire and tended it: wood was consumed and the fire's fuel rose.
  expect(await held(page, 'wood')).toBeLessThan(woodBefore);
  const s = await state(page);
  expect(s.campfires[0].fuel).toBeGreaterThan(30);
  // …and the worker never walked ONTO the fire's blocking tile (the "walks in and gets stuck" bug):
  // it stands adjacent, not on (22,40).
  expect(s.pcol === 22 && s.prow === 40).toBe(false);
});
