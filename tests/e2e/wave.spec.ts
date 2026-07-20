import { test, expect } from '@playwright/test';
import { startGame, applyScenario, step, state, beginWave, blocked } from './harness';

// Tier-2: the night wave (plan 038 Step 3). WaveDirector meters skeleton spawns from the "treeline" (a
// band off the defended centre — the lit hearth) during a wave, started by the night phase edge, the
// first-tick reconcile (a scenario seeded into night), or the dev/test force seam `beginWave`.
//
// Assertions are rng- and geography-agnostic on purpose: spec `rng` can't cross the Playwright bridge
// (so spawn tiles are Math.random), and on the-moon the biased treeline direction can be void, so a
// spawn may fall back to the nearest walkable tile. So we assert the invariants — spawns are WALKABLE,
// LOCAL to the defended centre (within the spawn band), PACED (metered, not a burst), and never happen
// by day without a trigger — not exact tiles. WAVE_SPAWN_RADIUS(14)+SPREAD(10)+margin = 26.
//
// The player sits FAR from the camp so the spawned skeletons (which still target the player in Step 3 —
// objective AI is Step 4) neither reach nor are reached, keeping the enemy count a clean function of
// the spawn schedule (no deaths/restarts mid-test).
const SPAWN_BAND_MAX = 26;
const CENTRE = { col: 118, row: 140 }; // near SPAWN_TILE — the lit hearth = the defended centre
const FAR_PLAYER: [number, number] = [60, 60]; // ~80 tiles away — out of aggro/reach for the step windows

test('no skeletons spawn during the day (the wave never triggers by daylight)', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, { player: FAR_PLAYER, campfires: [[CENTRE.col, CENTRE.row]] }); // day (default)

  expect((await state(page)).enemies).toBe(0); // scenario placed none; day reconcile starts no wave
  await step(page, 5000); // driven day time
  expect((await state(page)).enemies).toBe(0); // still none — no wave by day
});

test('beginWave starts a paced wave of walkable spawns local to the camp', async ({ page }) => {
  test.setTimeout(120_000); // steps ~1320 fixed frames to cross the first (trickle) spawn interval
  await startGame(page);
  await applyScenario(page, { player: FAR_PLAYER, campfires: [[CENTRE.col, CENTRE.row]] });

  await beginWave(page);
  const first = await state(page);
  expect(first.enemies).toBe(1); // a wave begins with exactly one immediate spawn (metered, not a burst)

  // That first spawn (unmoved) is on a WALKABLE tile, LOCAL to the defended centre (within the spawn
  // band), and not on the centre itself.
  const t = first.enemyTiles[0];
  expect(await blocked(page, t.col, t.row)).toBe(false);
  const cheb = Math.max(Math.abs(t.col - CENTRE.col), Math.abs(t.row - CENTRE.row));
  expect(cheb).toBeGreaterThanOrEqual(1);
  expect(cheb).toBeLessThanOrEqual(SPAWN_BAND_MAX);

  // PACED over time: crossing the first ~20s trickle interval adds a spawn or two — a metered trickle,
  // not the whole night's worth at once.
  await step(page, 22000);
  const later = await state(page);
  expect(later.enemies).toBeGreaterThanOrEqual(2);
  expect(later.enemies).toBeLessThanOrEqual(4);
});

test('a wave auto-starts when the clock is seeded straight into night (first-tick reconcile)', async ({
  page,
}) => {
  await startGame(page);
  // Seeded directly into night → SurvivalClock emits no `time:changed`, so the WaveDirector must
  // reconcile the phase on its first tick and start the wave anyway (plan 038 critique #1) — with no
  // beginWave() call here, a spawn appearing proves the reconcile path.
  await applyScenario(page, {
    player: FAR_PLAYER,
    campfires: [[CENTRE.col, CENTRE.row]],
    startPhase: 'night',
  });

  await step(page, 1000); // first driven tick reconciles phase === 'night' → begins the wave
  expect((await state(page)).enemies).toBeGreaterThanOrEqual(1);
});

// Plan 038 Step 4: objective-target AI. A wave mob (objective 'fire') with no player near paths to &
// attacks the fire — draining its fuel (CampfireManager.damageFire). Placed directly ADJACENT to the
// fire so the assertion doesn't depend on the-moon's walkability between spawn and hearth.
test('a fire-seeking mob with no player near attacks the fire (drains its fuel)', async ({
  page,
}) => {
  await startGame(page);
  const { campfireIds } = await applyScenario(page, {
    player: FAR_PLAYER, // ~80 tiles away → the mob never acquires the player, so it stays on the fire
    campfires: [[CENTRE.col, CENTRE.row]],
    campfireFuel: 100, // a known, comfortably-lit level so the attack drain is unambiguous
    startPhase: 'night',
    enemies: [{ at: [CENTRE.col, CENTRE.row + 1], objective: 'fire' }], // adjacent (Chebyshev 1)
  });
  expect(campfireIds.length).toBe(1);

  const before = (await state(page)).campfires[0].fuel;
  await step(page, 6000); // several ~1s strike cadences of WAVE_FIRE_ATTACK_DAMAGE each

  const s = await state(page);
  expect(s.enemyModes[0]).toBe('seek'); // seeking + striking the fire (never chasing — player is far)
  expect(s.campfires[0].fuel).toBeLessThan(before - 8); // fuel drained well past mere natural burn
  expect(s.campfires[0].lit).toBe(true); // 100 fuel doesn't fully douse in 6s — still lit (not a loss)
});

// Plan 038 Step 5: loop-close + per-night escalation. Surviving a night rolls into a harder one —
// keyed off the in-game day count. Seed the clock straight into the night of day 1 vs day 2 and compare
// the opening rush (cheap + deterministic; a full two-night run is far too many frames to step).
// clockMs for the night of day N = DAY_MS (660_000) + (N-1)·cycleLength (900_000).
test('later nights escalate — the opening rush grows (loop-close)', async ({ page }) => {
  await startGame(page);

  await applyScenario(page, {
    player: FAR_PLAYER,
    campfires: [[CENTRE.col, CENTRE.row]],
    clockMs: 660_000, // night of day 1
  });
  await step(page, 200); // first-tick reconcile → begins the wave with day-1's opening burst
  const night1 = (await state(page)).enemies;

  await applyScenario(page, {
    player: FAR_PLAYER,
    campfires: [[CENTRE.col, CENTRE.row]],
    clockMs: 1_560_000, // night of day 2
  });
  await step(page, 200);
  const night2 = (await state(page)).enemies;

  expect(night1).toBe(1); // day-1 baseline opening burst
  expect(night2).toBeGreaterThan(night1); // day 2 opens with a bigger rush
});

// The player-aggro roaming-pull preempts the fire objective: a wave mob next to the player fights the
// PLAYER instead of walking past to the fire.
test('a fire-seeking mob next to the player chases the player instead of the fire', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, {
    player: [CENTRE.col, CENTRE.row + 5], // by the camp, away from the hearth tile
    campfires: [[CENTRE.col, CENTRE.row]],
    campfireFuel: 100,
    startPhase: 'night',
    enemies: [{ at: [CENTRE.col, CENTRE.row + 6], objective: 'fire' }], // adjacent to the player
  });

  const before = (await state(page)).campfires[0].fuel;
  await step(page, 3000); // short — enough to acquire + a bite or two, not enough to kill the player

  const s = await state(page);
  expect(s.enemyModes[0]).toBe('chase'); // player-acquire preempted the fire objective
  expect(s.playerHp).toBeLessThan(10); // it's biting the player…
  expect(s.campfires[0].fuel).toBeGreaterThan(before - 5); // …not the fire (only natural burn touched it)
});
