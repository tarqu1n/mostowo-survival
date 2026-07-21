import { test, expect, type Page } from '@playwright/test';
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
  moveEnemy,
  emit,
  order,
  type DebugState,
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

// Tier-2 (plan 042 Step 7): the companion NIGHT combat + downed + dawn revive, through the REAL scene.
// By night the companion runs its dedicated combat stepper (acquire nearest live enemy → chase →
// telegraphed strike, reusing resolveMeleeAttack + the weapon rig; NOT the monster FSM); at 0 HP it
// collapses to `downed` (inert, on the Death strip, sprite kept), and on the next dawn it revives at
// NPC_REVIVE_HP. Driven deterministically with step(). A lit campfire sits at the camp (the wave's
// defended centre) so the night wave converges THERE, far from the row-3 skirmish — keeping the
// companion's local fight a clean function of the mob(s) we place, not stray wave spawns.
const NPC_REVIVE_HP = 3; // mirrors config.ts (harness DebugState carries no consts)
const NPC_FOLLOW_RADIUS_TILES = 3; // mirrors config.ts (the `follow` posture's hold radius)
const CAMP: [number, number] = [118, 140]; // near SPAWN_TILE — the lit hearth = the wave's defended centre

/** Count of ALIVE enemies within `radius` tiles (Chebyshev) of the companion — the placed skirmish
 *  mob(s) only, since the wave converges on the far camp hearth. */
function enemiesNearCompanion(s: DebugState, radius: number): number {
  const c = s.companion!;
  return s.enemyTiles.filter(
    (t) => Math.max(Math.abs(t.col - c.col), Math.abs(t.row - c.row)) <= radius,
  ).length;
}

test('a night companion attacks and kills an adjacent mob', async ({ page }) => {
  test.setTimeout(60_000); // a live scene + a few strike/bite cadences — fill-rate-heavy under load
  await startGame(page);

  // Player at [3,3]; companion at [8,3] (full HP); a plain mob adjacent at [7,3], club-armed for a
  // deterministic bite. The mob's nearest threat is the companion (1 tile) over the player (4 tiles),
  // so it engages the NPC — and by NIGHT the NPC fights back (unlike the day-gather Step-6 spec).
  await applyScenario(page, {
    player: [3, 3],
    companion: { at: [8, 3] },
    enemies: [{ at: [7, 3], weaponId: 'club' }],
    campfires: [CAMP],
    startPhase: 'night',
  });

  const before = await state(page);
  expect(before.companion!.hp).toBe(8); // NPC_MAX_HP baseline
  expect(enemiesNearCompanion(before, 4)).toBe(1); // the one skirmish mob (wave is at the far camp)

  await step(page, 3000); // strike windup+cadence → 2 strikes (2 dmg each) kill the 3-HP mob

  const after = await state(page);
  expect(enemiesNearCompanion(after, 4)).toBe(0); // the adjacent mob was killed by the companion
  expect(after.companion!.downed).toBe(false); // the companion won the exchange (still up)
  expect(after.companion!.hp).toBeLessThan(8); // it took a bite or two in the real fight
  expect(after.companion!.hp).toBeGreaterThan(0);
});

test('a night companion is downed by real mob damage, then revives at the next dawn', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await startGame(page);

  // Seed the clock ~6s before dawn (cycle 900_000; dawn at 900_000 → clockMs 894_000 = night of day 1).
  // Companion seeded to 1 HP (a LOW STARTING HP — NOT a force-seeded `downed`), so a single real club
  // bite collapses it in-play. Player far so, once the NPC is down, the mob has no threat to chase.
  await applyScenario(page, {
    player: [3, 3],
    companion: { at: [8, 3], hp: 1 },
    enemies: [{ at: [7, 3], weaponId: 'club' }],
    campfires: [CAMP],
    clockMs: 894_000,
  });

  const seeded = await state(page);
  expect(seeded.dayPhase).toBe('night');
  expect(seeded.companion!.downed).toBe(false); // starts UP (not force-downed) — the bite must down it

  // A couple of bite cadences: the mob bites the 1-HP companion to 0 → downed (by real damage, in play).
  await step(page, 2500);
  const downed = await state(page);
  expect(downed.dayPhase).toBe('night'); // still night (2.5s < the ~6s to dawn)
  expect(downed.companion!.downed).toBe(true); // collapsed to downed by the mob's bite — no force-seed
  expect(downed.companion!.hp).toBeLessThanOrEqual(0); // 0-HP collapse, not a heal

  // Clear the skirmish mob (index 0 — placed before any wave spawn) far away so the revived companion
  // isn't immediately re-bitten, letting the dawn HP be read cleanly.
  await moveEnemy(page, 0, 200, 200);

  // Cross dawn (894_000 + 2500 + 5000 = 901_500 > 900_000) → the night→day edge revives the companion.
  await step(page, 5000);
  const dawn = await state(page);
  expect(dawn.dayPhase).toBe('day'); // survived into the next day…
  expect(dawn.companion!.downed).toBe(false); // …and the downed companion stood back up
  expect(dawn.companion!.hp).toBe(NPC_REVIVE_HP); // revived at NPC_REVIVE_HP
  expect(dawn.companion!.dayRole).toBe('gather'); // resumes its day role (default gather)
});

// Tier-2 (plan 042 Step 8): the three NIGHT POSTURES + the consolidated day/night role switch, through
// the REAL scene. Step 8 (a) branches night behaviour on `nightPosture` — guard (hold a post, engage in
// range, return), follow (trail the player, fight alongside, no thrash when the player is still), refuel
// (feed the lit hearth) — and (b) consolidates the day↔night handoff (revive + posture-adopt + day-role-
// resume) onto ONE idempotent `time:changed` listener (CompanionManager.onPhaseChanged). Driven
// deterministically with step(); the clock is flipped with the same `debug:toggleTime` dev event the
// menu uses (a manual `applyClock` jump, which also fires `time:changed` — exercising the idempotency).
// A lit CAMP hearth far from each skirmish is the wave's defended centre, so night spawns converge THERE
// and the local fight stays a clean function of the mob(s) we place (the Step-7 pattern).

test('toggling the clock day→night→day flips the companion between its day role and night posture', async ({
  page,
}) => {
  test.setTimeout(60_000); // a live scene + several driven-frame windows across two clock flips
  await startGame(page);

  // Companion in the proven-walkable row-3 band: `repair` by day (mends a wall in place — no hearth
  // walk, so the far CAMP hearth doesn't pull it away), `guard` by night (holds its post, does NOT
  // repair). The flip is read off the WALL: repair advances hp by DAY and is suspended by NIGHT. No
  // enemies here — the guard/follow/refuel COMBAT behaviour is covered by the dedicated specs below.
  await applyScenario(page, {
    player: [3, 3],
    companion: { at: [8, 3], dayRole: 'repair', nightPosture: 'guard', guardAt: [8, 3] },
    walls: [[6, 3]],
    campfires: [CAMP], // far → the night wave converges on the camp, never the row-3 wall
    startPhase: 'day',
    baseSupply: { wood: 40 },
  });
  await step(page, 1000); // let the wall's build anim settle on its intact idle frame
  await damageWall(page, 0, 10); // knock it well down so there's headroom to mend across all phases
  const hp0 = (await walls(page))[0].hp;

  // DAY: the repair day-role advances the wall.
  await step(page, 2500);
  expect((await state(page)).dayPhase).toBe('day');
  const hpDay1 = (await walls(page))[0].hp;
  expect(hpDay1).toBeGreaterThan(hp0); // repaired by day

  // Flip to NIGHT (manual clock jump — applyClock fires time:changed(night), driving onPhaseChanged).
  await emit(page, 'debug:toggleTime');
  expect((await state(page)).dayPhase).toBe('night');
  await damageWall(page, 0, 4); // re-damage: if repair were still running, hp would climb back
  const hpNight0 = (await walls(page))[0].hp;
  await step(page, 3000);
  const hpNight1 = (await walls(page))[0].hp;
  expect(hpNight1).toBe(hpNight0); // guard posture — repair is suspended, the wall is left untouched
  expect((await state(page)).companion!.downed).toBe(false); // nothing near it — it just holds post

  // Flip back to DAY: the day role RESUMES (the consolidated switch) — the wall advances once more.
  await emit(page, 'debug:toggleTime');
  expect((await state(page)).dayPhase).toBe('day');
  await step(page, 2500);
  const hpDay2 = (await walls(page))[0].hp;
  expect((await state(page)).companion!.dayRole).toBe('repair');
  expect(hpDay2).toBeGreaterThan(hpNight1); // repair resumed after the night
});

test('the consolidated day/night switch revives a downed companion on a manual dawn jump (idempotent)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await startGame(page);

  // Seeded straight into night with a downed companion (far CAMP hearth keeps the wave away from it).
  await applyScenario(page, {
    player: [3, 3],
    companion: { at: [8, 3], nightPosture: 'guard', guardAt: [8, 3], downed: true },
    campfires: [CAMP],
    startPhase: 'night',
  });
  await step(page, 200);
  expect((await state(page)).companion!.downed).toBe(true); // still down at night (no dawn yet)

  // Manual jump to DAY — applyClock fires time:changed(day); the single consolidated handler revives it.
  await emit(page, 'debug:toggleTime');
  await step(page, 200);
  const day = await state(page);
  expect(day.dayPhase).toBe('day');
  expect(day.companion!.downed).toBe(false); // revived on the dawn edge (through the time:changed path)
  expect(day.companion!.hp).toBe(NPC_REVIVE_HP);

  // Jump night→day again: the handler is idempotent — no double-revive, no re-heal, no re-collapse.
  await emit(page, 'debug:toggleTime'); // → night
  await step(page, 200);
  await emit(page, 'debug:toggleTime'); // → day
  await step(page, 200);
  const again = await state(page);
  expect(again.dayPhase).toBe('day');
  expect(again.companion!.downed).toBe(false);
  expect(again.companion!.hp).toBe(NPC_REVIVE_HP); // unchanged — the second dawn was a no-op (already up)
});

test('a night GUARD companion holds its post, engages a mob in range, and returns to post', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await startGame(page);

  // Companion posted at [8,3]; a club mob two tiles west at [6,3] (within NPC_VISION = 4 tiles), nearer
  // to the NPC (2) than to the player at [3,3] (3), so it engages the NPC. Far CAMP hearth = the wave's
  // defended centre → night spawns converge THERE, keeping this a clean function of the one placed mob.
  await applyScenario(page, {
    player: [3, 3],
    companion: { at: [8, 3], nightPosture: 'guard', guardAt: [8, 3] },
    enemies: [{ at: [6, 3], weaponId: 'club' }],
    campfires: [CAMP],
    startPhase: 'night',
  });

  const before = await state(page);
  expect(before.companion!.col).toBe(8); // posted where placed
  expect(enemiesNearCompanion(before, 5)).toBe(1); // the one skirmish mob (wave is at the far camp)

  await step(page, 4000); // engage + kill the mob, then walk back to post

  const after = await state(page);
  expect(enemiesNearCompanion(after, 5)).toBe(0); // the guard killed the mob that came into range
  expect(after.companion!.downed).toBe(false); // it won the exchange
  const c = after.companion!;
  expect(Math.max(Math.abs(c.col - 8), Math.abs(c.row - 3))).toBeLessThanOrEqual(1); // returned toward post
});

test('a night FOLLOW companion stays near the player as the player moves', async ({ page }) => {
  test.setTimeout(60_000);
  await startGame(page);

  // Player + companion in the row-3 band, follow posture; far CAMP hearth so the night wave stays away.
  // The companion starts a full 5 tiles from the player (beyond the follow radius) so it must trail.
  await applyScenario(page, {
    player: [7, 3],
    companion: { at: [8, 3], nightPosture: 'follow' },
    campfires: [CAMP],
    startPhase: 'night',
  });

  const before = await state(page);
  expect(before.companion!.col).toBe(8);

  // Walk the player west across the band; the follow companion trails it (a queued move runs at night
  // when no movepad is held — the movepad-precedence override only engages on an actual pad hold).
  await order(page, { kind: 'move', col: 3, row: 3 });
  await step(page, 6000);

  const after = await state(page);
  const cheb = Math.max(
    Math.abs(after.companion!.col - after.pcol),
    Math.abs(after.companion!.row - after.prow),
  );
  expect(after.pcol).toBe(3); // the player walked west to [3,3]
  expect(after.companion!.col).toBeLessThan(8); // the companion trailed it westward (it followed)
  expect(cheb).toBeLessThanOrEqual(NPC_FOLLOW_RADIUS_TILES + 1); // and ended within the follow radius
});

// refuel: with the NPC in refuel posture at night by a lit hearth, the fire's fuel ends HIGHER than an
// identical run whose base-supply pool is empty (the NPC stands at the fire but has nothing to feed it).
// Isolated by keeping the window short — the wave spawns ~14 tiles out and can't reach the hearth in it —
// so the only fuel deltas are natural burn (both runs) and the NPC's feeding (the fed run only).
const REFUEL_FUEL_START = 60; // a known mid level with headroom to rise and stay comfortably lit

async function fuelAfterRefuelWindow(page: Page, wood: number): Promise<number> {
  await applyScenario(page, {
    player: [3, 3], // far from the hearth → the LIT HEARTH is the wave's defended centre, not the player
    companion: { at: [CAMP[0], CAMP[1] + 1], nightPosture: 'refuel' }, // one tile from the CAMP hearth
    campfires: [CAMP],
    campfireFuel: REFUEL_FUEL_START,
    startPhase: 'night',
    baseSupply: { wood },
  });
  await step(page, 4000); // several feed cadences; the treeline spawns don't reach the fire this soon
  return (await state(page)).campfires[0].fuel;
}

test('a night REFUEL companion slows the fire-fuel decline (feeds the hearth from base supply)', async ({
  page,
}) => {
  test.setTimeout(90_000); // two live-scene windows
  await startGame(page);

  // Baseline: the SAME scenario with an EMPTY pool — the refuel NPC stands at the fire yet feeds nothing,
  // so only natural burn touches the fuel over the window.
  const baseline = await fuelAfterRefuelWindow(page, 0);
  // With wood in the pool the refuel NPC feeds the hearth each cadence, so its fuel ends far higher.
  const fed = await fuelAfterRefuelWindow(page, 20);

  expect(baseline).toBeLessThan(REFUEL_FUEL_START); // natural burn only → fuel fell
  expect(fed).toBeGreaterThan(baseline); // feeding measurably slowed (here reversed) the decline
});
