import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  step,
  state,
  blocked,
  workbenches,
  damageWorkbench,
  enqueue,
} from './harness';

// Tier-2 (plan 048 Step 4): the workbench is a live HP structure like the wall — a walled-off mob
// bashes it through the generic structure-target seam (the same seam the wall uses), and the PLAYER
// mends it with a `repair` worker order (walk-adjacent → tend on a cadence → hp back to max). Both
// scenarios drive purely with step() — deterministic, since the bench never dodges (flat resolve) and
// repair restores a flat amount per cadence beat. Geometry uses the known-open row-10 band.

const PLAYER: [number, number] = [10, 10];
// Ring the player with walls, leaving the east frontier tile [11,10] for the WORKBENCH — so a mob
// chasing from the east is walled off and bashes the bench (not a wall) to reach the player.
const WALL_RING: Array<[number, number]> = [
  [9, 9],
  [10, 9],
  [11, 9],
  [9, 10],
  [9, 11],
  [10, 11],
  [11, 11],
];
const FRONTIER = { col: 11, row: 10 };

test('a mob walled off by a workbench bashes it, destroys it, then reaches the player', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await startGame(page);
  await applyScenario(page, {
    player: PLAYER,
    walls: WALL_RING,
    workbenches: [[FRONTIER.col, FRONTIER.row]],
    enemies: [{ at: [13, 10], id: 'boar', mode: 'chase' }],
  });
  // Pre-damage the bench low (maxHp 60) so a lethal break is observable within the step budget — the
  // point of THIS test is the mob→bench damage + destruction wiring, not felling a full 60 HP.
  expect(await damageWorkbench(page, 0, 55)).toBe(false); // hp 60 → 5, not destroyed
  await step(page, 500); // let the ring build anims settle

  let benches = await workbenches(page);
  expect(benches.length).toBe(1);
  const bench0 = benches[0];
  expect(bench0.hp).toBeGreaterThan(0);
  expect(bench0.hp).toBeLessThan(bench0.maxHp); // the pre-damage landed
  expect(await blocked(page, FRONTIER.col, FRONTIER.row)).toBe(true); // bench blocks its tile
  expect((await state(page)).playerHp).toBe(10); // walled off — not yet reachable

  // Drive in slices: the bench's HP falls to the mob's bashes, it is destroyed (gone + tile freed), and
  // only THEN does the player start taking bites — never before the bench breaks.
  let benchDamaged = false;
  let benchGone = false;
  let hurtBeforeBreak = false;
  let playerHurt = false;
  for (let i = 0; i < 60 && !playerHurt; i++) {
    await step(page, 400);
    benches = await workbenches(page);
    const b = benches[0];
    if (b && b.hp < bench0.hp) benchDamaged = true;
    if (!b) benchGone = true;
    const hp = (await state(page)).playerHp;
    if (hp < 10 && !benchGone) hurtBeforeBreak = true;
    if (hp < 10) playerHurt = true;
  }

  expect(benchDamaged).toBe(true); // the mob chipped the bench over time (HP path, not instant)
  expect(benchGone).toBe(true); // …then a lethal blow destroyed it
  expect(await blocked(page, FRONTIER.col, FRONTIER.row)).toBe(false); // its tile freed for pathing
  expect(hurtBeforeBreak).toBe(false); // the player was never reachable while the bench stood
  expect(playerHurt).toBe(true); // once broken, the mob routed through and bit the player
});

test('a player repair order mends a damaged workbench back to full HP', async ({ page }) => {
  test.setTimeout(60_000);
  await startGame(page);
  // Player next to a lone bench in the open — no enemies, deterministic. The bench blocks its own tile,
  // so the player stands on an adjacent tile ([10,10] is adjacent to the bench at [11,10]).
  const { workbenchIds } = await applyScenario(page, {
    player: PLAYER,
    workbenches: [[FRONTIER.col, FRONTIER.row]],
  });
  expect(workbenchIds.length).toBe(1);

  // Knock it down to a fraction of maxHp, then queue the real player repair order.
  expect(await damageWorkbench(page, 0, 40)).toBe(false); // 60 → 20
  let benches = await workbenches(page);
  const maxHp = benches[0].maxHp;
  expect(benches[0].hp).toBe(maxHp - 40);
  expect(benches[0].crafting).toBe(false);

  await enqueue(page, { kind: 'repair', structureId: workbenchIds[0] });

  // Drive step() until the bench is mended (walk-adjacent, then tend on the repair cadence). Watch that
  // HP rises monotonically toward max and the bench is never destroyed by repair.
  let mended = false;
  let prevHp = benches[0].hp;
  for (let i = 0; i < 60 && !mended; i++) {
    await step(page, 500);
    benches = await workbenches(page);
    expect(benches.length).toBe(1); // repair never removes the bench
    const hp = benches[0].hp;
    expect(hp).toBeGreaterThanOrEqual(prevHp); // monotonic — repair only restores
    prevHp = hp;
    if (hp >= maxHp) mended = true;
  }

  expect(mended).toBe(true); // the queued repair restored the bench to full HP
  expect((await workbenches(page))[0].hp).toBe(maxHp);
});
