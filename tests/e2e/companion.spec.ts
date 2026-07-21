import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  state,
  companion,
  setNpcDayRole,
  setNpcNightPosture,
  step,
  walls,
  damageWall,
} from './harness';

// Tier-2 (plan 042 Step 2): the CompanionManager + scenario/DebugState scaffolding. Step 2 lands the
// manager + test harness ONLY — no gather/repair/guard/combat behaviour yet (Steps 4-8). So these
// specs assert lifecycle + round-trip, the thing downstream steps build their e2e on: a scenario can
// place the single companion and seed its scaffold state, `debugState().companion` reads it back, the
// `setNpc*` dev seams mutate it, and an absent companion reads back as null with a zeroed baseSupply.
// Driven with no step()/emit beyond the scenario apply, so it stays deterministic.

test('a scenario places the companion + reads its scaffold state back via debugState().companion', async ({
  page,
}) => {
  await startGame(page);

  await applyScenario(page, {
    player: [10, 10],
    companion: {
      at: [12, 10],
      dayRole: 'repair',
      nightPosture: 'guard',
      guardAt: [13, 10],
      hp: 5,
      downed: false,
    },
    baseSupply: { wood: 3, rock: 2 },
  });

  expect(await companion(page)).toEqual({
    col: 12,
    row: 10,
    dayRole: 'repair',
    nightPosture: 'guard',
    hp: 5,
    downed: false,
    carry: 0, // no gather behaviour yet — the buffer starts empty (Step 4+ fills it)
  });

  expect((await state(page)).baseSupply).toEqual({ wood: 3, rock: 2 });
});

test('a scenario with no companion reads back null + a zeroed baseSupply', async ({ page }) => {
  await startGame(page);

  await applyScenario(page, { player: [10, 10] });

  const s = await state(page);
  expect(s.companion).toBeNull();
  expect(s.baseSupply).toEqual({ wood: 0, rock: 0 });
});

test('the setNpc* dev seams mutate the placed companion (round-trips through debugState)', async ({
  page,
}) => {
  await startGame(page);

  await applyScenario(page, {
    player: [10, 10],
    companion: { at: [12, 10] }, // defaults: dayRole 'gather', nightPosture 'follow'
  });

  expect(await companion(page)).toMatchObject({ dayRole: 'gather', nightPosture: 'follow' });

  await setNpcDayRole(page, 'repair');
  await setNpcNightPosture(page, 'refuel');

  expect(await companion(page)).toMatchObject({ dayRole: 'repair', nightPosture: 'refuel' });
});

// Tier-2 (plan 042 Step 4): the companion's OWN gather loop through the REAL scene — its slimmed
// executor (own TaskQueue, never GameScene.queue) walks to the nearest wood/rock node, fells it via the
// shared ResourceNodeManager.chop path (yield redirected into its carry buffer, NOT the player's bag),
// then deposits the buffer into the shared base-supply pool. Driven deterministically with step().
test('a gather-role companion chops a tree by day and deposits wood into base supply', async ({
  page,
}) => {
  await startGame(page);

  // Player at [3,3]; companion two tiles east of a lone tree, in gather role, by day; empty stockpile.
  // No campfire in this scenario, so the deposit exercises the documented no-lit-hearth fallback
  // (the base-supply store is global — deposit in place). Coords sit in the proven-walkable row-3 band
  // the chop/queue specs use.
  await applyScenario(page, {
    player: [3, 3],
    companion: { at: [8, 3], dayRole: 'gather' },
    trees: [[6, 3]],
    startPhase: 'day',
    baseSupply: { wood: 0 },
  });

  // Baseline: nothing banked, nothing carried yet.
  expect((await state(page)).baseSupply).toEqual({ wood: 0, rock: 0 });

  // Short walk to the tree + 3 chop intervals (maxHp 3) + a deposit — well inside this budget.
  await step(page, 6000);

  const s = await state(page);
  expect(s.baseSupply.wood).toBeGreaterThan(0); // it chopped and banked wood
  expect(s.baseSupply.wood).toBe(3); // whole tree (maxHp 3 × 1 wood/hit) deposited
  expect(s.companion?.carry).toBe(0); // carry buffer emptied by the deposit (accrued, then reset)
  expect(s.baseSupply.rock).toBe(0); // gather only touched the wood node
});

// Tier-2 (plan 042 Step 5): the companion's `repair` day role through the REAL scene — the same slimmed
// executor's second branch. A repair-role NPC by day scans the walls for a damaged one, paths adjacent,
// and mends it on the NPC_REPAIR_MS cadence, consuming wood from base supply per tick. Wall placement +
// its full-HP start come from the scenario; the damage is seeded via the __test.damageWall seam (the
// path the night siege drives) and wall hp is read back via the standalone walls() seam (NOT DebugState,
// so the refactor-tripwire golden is untouched). Driven deterministically with step().
test('a repair-role companion mends a damaged wall by day, draining wood from base supply', async ({
  page,
}) => {
  test.setTimeout(60_000); // a live scene + a few hundred driven frames — fill-rate-heavy under load
  await startGame(page);

  // Player at [3,3]; companion two tiles east of a lone wall, in repair role, by day; wood in the pool.
  // Same proven-walkable row-3 band the gather/chop/wall specs use (wall at [6,3], companion at [8,3]).
  await applyScenario(page, {
    player: [3, 3],
    companion: { at: [8, 3], dayRole: 'repair' },
    walls: [[6, 3]],
    startPhase: 'day',
    baseSupply: { wood: 20 },
  });
  await step(page, 1000); // let the wall's build anim settle on the intact idle frame

  // Knock the wall down (maxHp 12 → 4) via the mob-attack seam, so it now needs mending.
  await damageWall(page, 0, 8);
  const before = await walls(page);
  expect(before[0].hp).toBe(before[0].maxHp - 8);
  const woodBefore = (await state(page)).baseSupply.wood;

  // Short walk to the wall (~1 tile) + several NPC_REPAIR_MS cadences — enough to mend it back to full
  // (8 hp deficit / 2 hp-per-tick = 4 ticks ≈ 1.6s, plus the walk; kept lean to stay inside the budget).
  await step(page, 3500);

  const after = await walls(page);
  const woodAfter = (await state(page)).baseSupply.wood;
  expect(after[0].hp).toBeGreaterThan(before[0].hp); // wall hp climbed toward max
  expect(after[0].hp).toBe(after[0].maxHp); // fully mended within the budget
  expect(woodAfter).toBeLessThan(woodBefore); // repair drained wood from the shared pool
  expect(woodAfter).toBe(woodBefore - 4); // 8 hp restored at NPC_REPAIR_HP_PER_TICK(2) = 4 ticks × 1 wood
});

// The other half of the economic tie: an empty base supply → no repair (goes idle, surfaces nothing).
test('a repair-role companion with an empty base supply does not repair the wall', async ({
  page,
}) => {
  test.setTimeout(60_000); // a live scene + a few hundred driven frames — fill-rate-heavy under load
  await startGame(page);

  await applyScenario(page, {
    player: [3, 3],
    companion: { at: [8, 3], dayRole: 'repair' },
    walls: [[6, 3]],
    startPhase: 'day',
    baseSupply: { wood: 0 }, // empty pool — nothing to mend with
  });
  await step(page, 1000);

  await damageWall(page, 0, 8);
  const hpBefore = (await walls(page))[0].hp;

  await step(page, 3500);

  expect((await walls(page))[0].hp).toBe(hpBefore); // no wood → the wall is left untouched
  expect((await state(page)).baseSupply.wood).toBe(0); // nothing withdrawn (idle, no error)
});

// Tier-2 (plan 042 Step 6): the NPC is now a valid mob threat. A mob adjacent to the companion acquires
// it (the NEAREST threat — nearer than the player here) and bites it, so its HP falls. The companion has
// no combat AI yet (Step 7), so it just stands and takes the hit — that's the point of this step's e2e.
// A gather-role companion by DAY with NO nodes to gather stands still (nothing to do), and day means no
// night wave, so the only enemy is the one we placed — deterministic. Driven with step().
test('a mob adjacent to the companion deals it damage (the NPC is a valid threat)', async ({
  page,
}) => {
  test.setTimeout(60_000); // a live scene + a mob's bite cadences — fill-rate-heavy under parallel load
  await startGame(page);

  // Companion at [8,3]; a plain mob one tile west at [7,3] (orthogonally adjacent → Chebyshev 1, in
  // melee contact at once). The player sits at [3,3]: within the mob's vision too, but the NPC (16px) is
  // nearer than the player (64px), so the nearest-threat pick lands on the NPC. Same proven-walkable
  // row-3 band the gather/repair specs use; no trees → the gather-role NPC stands idle and holds station.
  await applyScenario(page, {
    player: [3, 3],
    companion: { at: [8, 3], dayRole: 'gather' },
    enemies: [{ at: [7, 3] }],
    startPhase: 'day',
  });

  const before = (await companion(page))!;
  expect(before.hp).toBe(8); // NPC_MAX_HP — full-health baseline
  expect(before.col).toBe(8); // standing where it was placed (nothing to gather → holds station)

  await step(page, 3000); // a few ~1s bite cadences — enough for the mob to land hits

  const after = (await companion(page))!;
  expect(after.hp).toBeLessThan(before.hp); // the mob acquired + bit the NPC → its HP fell
});
