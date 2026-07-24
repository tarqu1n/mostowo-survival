import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  step,
  state,
  blocked,
  workbenches,
  damageWorkbench,
  itemCount,
  enqueue,
  emit,
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
  await step(page, 500); // let the ring build anims settle + the mob close on the frontier bench

  const bench0 = (await workbenches(page))[0];
  expect(bench0).toBeTruthy();
  expect(bench0.hp).toBe(bench0.maxHp); // starts intact
  expect(await blocked(page, FRONTIER.col, FRONTIER.row)).toBe(true); // bench blocks its tile
  expect((await state(page)).playerHp).toBe(10); // walled off — not yet reachable

  // Phase 1 — the mob DAMAGES the bench over time (the HP path, not instant removal): drive slices
  // until a sampled reading shows the bench chipped below max while still standing.
  let benchDamaged = false;
  for (let i = 0; i < 40 && !benchDamaged; i++) {
    await step(page, 400);
    const b = (await workbenches(page))[0];
    if (b && b.hp < b.maxHp) benchDamaged = true;
  }
  expect(benchDamaged).toBe(true); // a night mob adjacent to the bench damaged it
  expect((await state(page)).playerHp).toBe(10); // still walled off while the bench stands

  // Phase 2 — destruction + ordering: knock the already-chipped bench to the brink, then let the mob
  // land the finishing blow. The player must stay unharmed until the bench is GONE (never reachable
  // through a standing bench), then get bitten once its tile frees.
  const b1 = (await workbenches(page))[0];
  expect(await damageWorkbench(page, 0, b1.hp - 1)).toBe(false); // leave 1 hp — not destroyed yet
  let benchGone = false;
  let hurtBeforeBreak = false;
  let playerHurt = false;
  for (let i = 0; i < 60 && !playerHurt; i++) {
    await step(page, 400);
    if ((await workbenches(page)).length === 0) benchGone = true;
    const hp = (await state(page)).playerHp;
    if (hp < 10 && !benchGone) hurtBeforeBreak = true;
    if (hp < 10) playerHurt = true;
  }

  expect(benchGone).toBe(true); // a lethal blow destroyed the bench
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

test('a queued craft at a healthy bench delivers the item to the pack (spending the cost)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await startGame(page);
  // Player adjacent to a full-hp bench, holding the brand recipe cost (wood + cloth) plus spare.
  const { workbenchIds } = await applyScenario(page, {
    player: PLAYER,
    workbenches: [[FRONTIER.col, FRONTIER.row]],
    inventory: { wood: 3, cloth: 3 },
  });
  expect(await itemCount(page, 'brand')).toBe(0);

  await enqueue(page, { kind: 'craft', benchId: workbenchIds[0], recipeId: 'brand' });

  // Drive step() until the brand arrives (walk-adjacent is trivial — already adjacent — then ~craftMs
  // of work at full-hp 1× rate). Budget well over CRAFT_BASE_MS (8s).
  let crafted = false;
  for (let i = 0; i < 40 && !crafted; i++) {
    await step(page, 500);
    if ((await itemCount(page, 'brand')) >= 1) crafted = true;
  }

  expect(crafted).toBe(true); // the brand was delivered to the pack
  expect(await itemCount(page, 'brand')).toBe(1);
  expect(await itemCount(page, 'wood')).toBe(2); // brand cost 1 wood…
  expect(await itemCount(page, 'cloth')).toBe(2); // …+ 1 cloth, spent at completion
  expect((await workbenches(page))[0].crafting).toBe(false); // craft cleared on completion
});

test('a damaged bench crafts slower than a healthy one, but never fully stalls', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await startGame(page);
  const { workbenchIds } = await applyScenario(page, {
    player: PLAYER,
    workbenches: [[FRONTIER.col, FRONTIER.row]],
    inventory: { wood: 3, cloth: 3 },
  });
  // Cripple the bench (maxHp 60 → 5). Its craft rate = Linear(0.4, 1, 5/60) ≈ 0.45×, so brand takes
  // ~CRAFT_BASE_MS/0.45 ≈ 17.8s vs 8s at full HP.
  expect(await damageWorkbench(page, 0, 55)).toBe(false);
  await enqueue(page, { kind: 'craft', benchId: workbenchIds[0], recipeId: 'brand' });

  // After a window that a HEALTHY bench would have finished in (9s > 8s craftMs) but a crippled one
  // would NOT (needs ~17.8s), the damaged craft is still in flight — no brand yet, still crafting.
  await step(page, 9000);
  expect(await itemCount(page, 'brand')).toBe(0); // slower — not done in the healthy-bench window
  expect((await workbenches(page))[0].crafting).toBe(true); // …but still progressing (not stalled)

  // Given more time it DOES complete — the rate floors at CRAFT_DAMAGED_MIN_FRAC, never zero.
  let crafted = false;
  for (let i = 0; i < 40 && !crafted; i++) {
    await step(page, 500);
    if ((await itemCount(page, 'brand')) >= 1) crafted = true;
  }
  expect(crafted).toBe(true); // a damaged bench still finishes eventually
});

test('the HUD craft-menu events (craft:queue / craft:repair) drive the real orders', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await startGame(page);
  const { workbenchIds } = await applyScenario(page, {
    player: PLAYER,
    workbenches: [[FRONTIER.col, FRONTIER.row]],
    inventory: { wood: 4, stone: 4 },
  });
  const benchId = workbenchIds[0];

  // `craft:queue` is exactly what CraftMenu emits on a recipe tap (via the bridge) — it must reach
  // GameScene's wireBus handler and enqueue the real craft order. Craft a sword (wood+stone).
  await emit(page, 'craft:queue', { benchId, recipeId: 'sword' });
  let crafted = false;
  for (let i = 0; i < 40 && !crafted; i++) {
    await step(page, 500);
    if ((await itemCount(page, 'sword')) >= 1) crafted = true;
  }
  expect(crafted).toBe(true); // the menu's craft:queue delivered the sword
  expect(await itemCount(page, 'wood')).toBe(2); // sword cost 2 wood + 1 stone, spent

  // `craft:repair` is what the menu's Repair button emits — damage the bench, then drive the repair.
  expect(await damageWorkbench(page, 0, 30)).toBe(false);
  const maxHp = (await workbenches(page))[0].maxHp;
  await emit(page, 'craft:repair', { benchId });
  let mended = false;
  for (let i = 0; i < 40 && !mended; i++) {
    await step(page, 500);
    if ((await workbenches(page))[0].hp >= maxHp) mended = true;
  }
  expect(mended).toBe(true); // the menu's craft:repair mended the bench to full
});
