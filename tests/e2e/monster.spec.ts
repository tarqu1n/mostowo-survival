import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, step, state } from './harness';
import { oneEnemy } from './scenarios';

// Tier-2: the monster AI FSM (systems/monsterAI) wired through the real GameScene — the Phase-A
// review gate. The FSM's decision logic is unit-tested in isolation (systems/__tests__/monsterAI);
// these prove the scene drives it end-to-end: radius acquire → chase, distance-only give-up past the
// drop radius, and a patrol route cycling its waypoints. Mode + tiles are read from debugState.

test('a monster within vision acquires and enters chase', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, oneEnemy()); // player [10,10], enemy two tiles east (32px ≤ 80px vision)

  await step(page, 500); // one AI tick is enough — acquire is immediate within radius
  const s = await state(page);
  expect(s.enemies).toBe(1);
  expect(s.enemyModes).toContain('chase');
});

test('a chasing monster gives up when the player escapes past the drop radius', async ({ page }) => {
  await startGame(page);
  // Enemy spawned already chasing, 8 tiles (128px) south of the player — INSIDE the drop radius
  // (MONSTER_CHASE_DROP_RADIUS_PX 200px) but OUTSIDE vision (80px). So it's a genuine in-band chase
  // that an idle monster would NOT have acquired at this range — asserting 'chase' below distinguishes
  // the two. Combat mode so we can drive the (2× faster) player away on the movepad.
  await applyScenario(page, { player: [10, 40], mode: 'combat', enemies: [{ at: [10, 48], mode: 'chase' }] });

  await step(page, 100); // stops the live RAF loop + settles one deterministic tick
  expect((await state(page)).enemyModes).toEqual(['chase']); // still chasing at 128px (an idle monster wouldn't be)

  // Sprint north, away from the pursuer. Player 90px/s vs enemy 45px/s → the gap opens ~45px/s and
  // soon exceeds the 200px drop radius, so distance-only de-aggro fires.
  await emit(page, 'combat:move', { dx: 0, dy: -1 });
  await step(page, 4000);

  expect((await state(page)).enemyModes).not.toContain('chase'); // lost the scent → gave up
});

test('a patrol-route monster cycles its waypoints', async ({ page }) => {
  await startGame(page);
  // Player far away (never within the 80px vision), so the monster stays calm and patrols. Route is a
  // 2-tile horizontal hop on the known-clear row-10 band; it spawns ON waypoint 0 (the natural authoring
  // pattern) to also exercise the same-tile-first-waypoint path.
  await applyScenario(page, {
    player: [40, 40],
    enemies: [{ at: [10, 10], patrolRoute: [[10, 10], [12, 10]] }],
  });

  const cols: number[] = [];
  const modes: string[] = [];
  for (let i = 0; i < 24; i++) {
    await step(page, 400); // ~9.6s total — several out-and-back cycles (pause 1s + ~0.7s travel each leg)
    const s = await state(page);
    cols.push(s.enemyTiles[0].col);
    modes.push(s.enemyModes[0]);
  }

  expect(modes).toContain('patrol'); // it actually entered patrol
  expect(modes).not.toContain('chase'); // never spotted the far player
  // Reached the far waypoint (col 12) and later returned toward the near one (col 10) → a full cycle,
  // proving it advances waypoints rather than stalling on its start tile.
  const firstAt12 = cols.indexOf(12);
  expect(firstAt12).toBeGreaterThanOrEqual(0);
  expect(cols.slice(firstAt12).some((c) => c <= 10)).toBe(true);
  // Critique #3 drift check: the Idle-bob footprint swap (32px@2 ↔ 64px Run) fires during every
  // waypoint pause, but the monster's contact tile never leaves its route — the swap is display-only.
  expect(cols.every((c) => c >= 10 && c <= 12)).toBe(true);
});

test('a club bite removes more HP per hit than a knife bite', async ({ page }) => {
  await startGame(page);
  // Spawn 2 tiles east (like oneEnemy), NOT adjacent: the enemy closes under step()'s control before
  // biting, so the pre-step() RAF loop can't land — and can't runaway-kill — the player. Every bite
  // hits (dodge 0) for base + kidZombie strength(1): club 3, knife 2. Measure per-bite as
  // damage / enemyAttacks (exact per bite, so robust to how many bites land in the window).
  const MAX_HP = 10;
  await applyScenario(page, { player: [10, 10], enemies: [{ at: [12, 10], mode: 'chase', weaponId: 'club' }] });
  expect((await state(page)).enemyWeapons).toEqual(['club']); // the scenario override equipped the club
  await step(page, 1500); // closes (~0.7s) then lands ≥1 bite; under 2× the club cadence
  const club = await state(page);
  expect(club.enemyAttacks).toBeGreaterThan(0);
  const clubPerBite = (MAX_HP - club.playerHp) / club.enemyAttacks;

  await applyScenario(page, { player: [10, 10], enemies: [{ at: [12, 10], mode: 'chase', weaponId: 'knife' }] });
  await step(page, 1500);
  const knife = await state(page);
  expect(knife.enemyAttacks).toBeGreaterThan(0);
  const knifePerBite = (MAX_HP - knife.playerHp) / knife.enemyAttacks;

  expect(clubPerBite).toBe(3);
  expect(knifePerBite).toBe(2);
  expect(clubPerBite).toBeGreaterThan(knifePerBite);
});

test('a knife bites more often than a club over the same window (cadence)', async ({ page }) => {
  await startGame(page);
  // Spawn 2 tiles east (as above) so the closing walk is under step() control. Over a ~2.5s window of
  // contact: knife (750ms) lands ~3 bites, club (1500ms) ~2. Count via enemyAttacks (incremented per
  // bite in enemyLungeAt; applyScenario zeroes it). Neither total kills the 10-HP player.
  await applyScenario(page, { player: [10, 10], enemies: [{ at: [12, 10], mode: 'chase', weaponId: 'knife' }] });
  await step(page, 2500);
  const knifeBites = (await state(page)).enemyAttacks;

  await applyScenario(page, { player: [10, 10], enemies: [{ at: [12, 10], mode: 'chase', weaponId: 'club' }] });
  await step(page, 2500);
  const clubBites = (await state(page)).enemyAttacks;

  expect(knifeBites).toBeGreaterThan(clubBites); // shorter cadence → more bites in the same window
});
