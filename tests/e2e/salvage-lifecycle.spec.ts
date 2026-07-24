import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  startGame,
  applyScenario,
  order,
  step,
  state,
  blocked,
  held,
  nodes,
  setNodeProgress,
  isWebGL,
} from './harness';
import { SALVAGE_MS, CLEAR_MS } from '../../src/config';

// Tier-2: the full wrecked-tent salvage → clear lifecycle (plan 047) through the REAL scene, driven
// deterministically. A `salvagedTent` is a `oneShot` node: SALVAGE it (a timed harvest) to roll its
// loot and leave a PERMANENT ruined husk that still blocks its tile, then CLEAR the husk (a longer
// timed action) to roll a little scrap, remove the node, and free the tile.
//
// The 20s/40s durations aren't driven in real time: at ~45ms/headless-frame, SALVAGE_MS (1200 fixed
// frames) + CLEAR_MS (2400) alone would blow the timeout, and the 600_000ms regrowMs (~36k frames) is
// hopeless. Instead the node's persistent `progressMs` accumulator is SEEDED to just under each
// threshold (the same tactic as `campfireFuel`, which seeds a fire near-empty rather than burning it
// down) so a short driven window crosses it — which doubles as a RESUME-from-persisted-progress check.
//
// Loot is rolled off Math.random (not the injected rng — see ResourceNodeManager.chop and
// GameScene.runClear), so this asserts loot RANGES, not exact counts; the roll math is Tier-1 in
// loot.test.ts. Every advance goes through __test.step (fixed 1/60s slices, no wall-clock).

// The items the salvage loot table can drop (nodes.json salvagedTent.loot; `rope` added plan 048).
const SALVAGE_ITEMS = ['cloth', 'wood', 'berries', 'cannedFood', 'rope'] as const;

async function totalHeld(page: Page, ids: readonly string[]): Promise<number> {
  let sum = 0;
  for (const id of ids) sum += await held(page, id);
  return sum;
}

test('salvage → ruin (no regrow) → clear: loot, tile blocked then freed, node removed', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await startGame(page);
  // Tent adjacent to the player, so no walk is driven — the timed accumulation is the point, not pathing.
  const { tentIds } = await applyScenario(page, { player: [3, 3], tents: [[4, 3]], inventory: {} });
  const tentId = tentIds[0];
  const [col, row] = [4, 3];

  // A live wrecked tent blocks its tile before anything happens (blocksPath).
  expect(await blocked(page, col, row)).toBe(true);

  // SALVAGE — seed the accumulator to just shy of SALVAGE_MS so a short driven window fells it once
  // (and proves the timed harvest resumes from persisted progress).
  expect(await setNodeProgress(page, tentId, SALVAGE_MS - 200)).toBe(true);
  await order(page, { kind: 'harvest', treeId: tentId });
  await step(page, 1000);

  // Loot credited: ≥2 items from the salvage table (2 rolls, each grants ≥1).
  expect(await totalHeld(page, SALVAGE_ITEMS)).toBeGreaterThanOrEqual(2);

  // The node is now a permanent ruined husk: present, !alive, oneShot, and STILL blocking its tile.
  let tent = (await nodes(page)).find((n) => n.id === tentId);
  expect(tent).toBeDefined();
  expect(tent?.alive).toBe(false);
  expect(tent?.oneShot).toBe(true);
  expect(await blocked(page, col, row)).toBe(true);
  expect((await state(page)).currentKind).toBeNull(); // salvage finished, queue drained

  // The ruin is permanent. A oneShot node never schedules a regrow (ResourceNodeManager guards the
  // regrow `delayedCall` on !oneShot), so driving time forward leaves it present-and-dead. Driving the
  // full regrowMs (600_000ms → ~36k fixed frames) is infeasible under headless fixed-step rendering, so
  // this drives a modest window as a persistence check; the no-regrow guarantee is structural.
  await step(page, 6000);
  tent = (await nodes(page)).find((n) => n.id === tentId);
  expect(tent).toBeDefined();
  expect(tent?.alive).toBe(false);

  // CLEAR — salvage reset the accumulator to 0 for this stage; seed it near CLEAR_MS and cross it.
  const scrapBefore = await totalHeld(page, ['cloth', 'wood', 'rope']);
  expect(await setNodeProgress(page, tentId, CLEAR_MS - 200)).toBe(true);
  await order(page, { kind: 'clear', treeId: tentId });

  // The queued clear glows its dead ruin like a queued harvest does a live node (plan 047 Step 7). The
  // outline PostFX only attaches under WebGL (Canvas degrades to a marker rect), so gate the assertion.
  if (await isWebGL(page)) {
    expect((await state(page)).outlinedTreeIds).toContain(tentId);
  }

  await step(page, 1000);

  // A little scrap credited: ≥1 more cloth/wood/rope from clearLoot (1 roll, grants ≥1).
  expect(await totalHeld(page, ['cloth', 'wood', 'rope'])).toBeGreaterThanOrEqual(scrapBefore + 1);

  // The node is gone from the world and its tile is freed for building/pathing.
  expect((await nodes(page)).find((n) => n.id === tentId)).toBeUndefined();
  expect(await blocked(page, col, row)).toBe(false);
  expect((await state(page)).currentKind).toBeNull();
});
