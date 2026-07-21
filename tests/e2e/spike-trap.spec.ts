import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  step,
  state,
  traps,
  rearmTrap,
  enemyHps,
  moveEnemy,
  beginWave,
  enqueue,
  emit,
  blocked,
} from './harness';
import { SPIKE_TRAP_DAMAGE } from '../../src/config';

// Tier-2 (plan 040): the spike trap — the roadmap's "one trap". A scenario-placed trap is a LIVE
// structure (TrapBehavior, the third StructureManager behavior module) that stands ARMED on a WALKABLE
// tile (blocksPath:false — mobs walk ONTO it to fire it), triggers ONCE when an enemy stands on its
// tile (deals SPIKE_TRAP_DAMAGE through the normal kill path, then goes spent), and is re-armed by a
// worker order — a tap (rearmTrap seam) or the night→day dawn auto-enqueue (the first system-initiated
// order). Driven only by step()/emit, so deterministic. The trigger/rearm specs use the small
// open-ground tiles the build/chop specs proved walkable (player [3,3]); the live-wave acceptance uses
// the camp centre the wave spawns around.

const CENTRE = { col: 118, row: 140 }; // the camp — a lit hearth here is the wave's defended centre
const FAR_PLAYER: [number, number] = [60, 60]; // out of aggro/reach so the wave mob stays a clean target

test('a placed trap stands ARMED on a walkable tile (mobs can path onto it)', async ({ page }) => {
  await startGame(page);
  const { trapIds } = await applyScenario(page, { player: [3, 3], traps: [[6, 3]] });

  expect(trapIds.length).toBe(1);
  expect(await traps(page)).toEqual([{ col: 6, row: 3, armed: true }]);
  // blocksPath:false (decision #5) — the trap never joins the occupancy set, so its tile stays walkable
  // (that's how a mob gets onto it to trigger it).
  expect(await blocked(page, 6, 3)).toBe(false);
});

test('an enemy on an armed trap takes one hit and the trap goes spent (trigger-once)', async ({
  page,
}) => {
  await startGame(page);
  // Both enemies start OFF the trap: a step() stops the real-time RAF loop first, so the baseline hp
  // is read deterministically before any trigger (spawning an enemy ON the trap would let the brief
  // pre-first-step RAF window fire it before we could read a clean baseline).
  await applyScenario(page, {
    player: [3, 3],
    traps: [[6, 3]],
    enemies: [
      [10, 3],
      [12, 3],
    ],
  });

  await step(page, 50); // stop the RAF loop → deterministic from here; enemies off the trap, unhit
  const hpBefore = (await enemyHps(page))[0]; // kidZombie maxHp (3), full
  await moveEnemy(page, 0, 6, 3); // enemy0 steps onto the armed trap
  await step(page, 100); // structureManager.tick fires the armed trap on the enemy standing on it

  let s = await state(page);
  expect(s.traps[0].armed).toBe(false); // fired → spent
  expect((await enemyHps(page))[0]).toBe(hpBefore - SPIKE_TRAP_DAMAGE); // took exactly one hit, survived

  // Trigger-once: move enemy0 clear, then a SECOND enemy onto the now-spent trap takes NO damage.
  await moveEnemy(page, 0, 40, 40);
  await moveEnemy(page, 1, 6, 3);
  const hp1Before = (await enemyHps(page)).slice(-1)[0]; // enemy1 (last alive), full
  await step(page, 200);
  s = await state(page);
  expect(s.traps[0].armed).toBe(false); // still spent — no re-fire
  expect((await enemyHps(page)).slice(-1)[0]).toBe(hp1Before); // enemy1 unharmed by the spent trap
});

test('a rearm worker order (the tap path) re-primes a spent trap', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [4, 3], traps: [[6, 3]], enemies: [[6, 3]] });

  await step(page, 100); // enemy trips it → spent
  expect((await state(page)).traps[0].armed).toBe(false);
  await moveEnemy(page, 0, 40, 40); // clear the enemy so it doesn't re-trip / interfere with the rearm walk

  // rearmTrap enqueues the REAL rearm order (the order a tap on a spent trap enqueues) — walk adjacent →
  // re-prime. The player [4,3] is one tile from the trap, so the walk-and-rearm completes quickly.
  expect(await rearmTrap(page, 0)).toBe(true);
  await step(page, 2000);
  expect((await state(page)).traps[0].armed).toBe(true); // re-primed
});

test('the dawn edge auto-enqueues a rearm for every spent trap (system-initiated), appended behind a pending player order', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, { player: [4, 3], traps: [[6, 3]], enemies: [[6, 3]] });

  await step(page, 100); // enemy trips it → spent
  expect((await state(page)).traps[0].armed).toBe(false);
  await moveEnemy(page, 0, 40, 40); // clear the enemy so it doesn't interfere with the rearm walk

  // Give the worker a current PLAYER order first (a short move), so we can assert the dawn rearm
  // APPENDS behind it rather than clobbering it.
  await enqueue(page, { kind: 'move', col: 4, row: 4 });
  expect((await state(page)).currentKind).toBe('move');

  // Fire the dawn edge. `time:changed` is what SurvivalClock emits on the night→day flip; emitting it
  // directly drives the same rearmTrapsAtDawn handler deterministically (setDayPhase is a bare field
  // write that emits nothing, so it would NOT trigger the handler).
  await emit(page, 'time:changed', { phase: 'day' });
  const queued = await state(page);
  expect(queued.currentKind).toBe('move'); // the player's order was NOT clobbered…
  expect(queued.pending).toBe(1); // …the system-initiated rearm was appended behind it

  // Let the move finish, then the appended rearm becomes current: the worker walks over and re-arms.
  await step(page, 2000);
  expect((await state(page)).traps[0].armed).toBe(true);
});

// The ROADMAP Step 3 acceptance test (critique #4): drive the LIVE wave (beginWave, real WaveDirector
// spawn), put a real wave mob on a trap, and assert the trap dealt its hit — not a hand-scripted enemy.
// The mob is teleported onto the trap (moveEnemy) so the assertion doesn't hinge on the-moon's
// walkability between the spawn ring and the camp (the wave.spec flags that same uncertainty).
test('roadmap Step 3 acceptance: a live-wave mob that crosses a trap takes its hit', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, {
    player: FAR_PLAYER, // far → the wave mob never dies to the player; a clean damage assertion
    campfires: [[CENTRE.col, CENTRE.row]], // the lit hearth = the wave's defended centre
    traps: [[CENTRE.col, CENTRE.row - 2]], // on the treeline-facing approach to the fire
  });

  await beginWave(page); // real WaveDirector: one fire-seeking mob spawns immediately
  const before = await state(page);
  expect(before.enemies).toBeGreaterThanOrEqual(1);
  expect(before.traps[0].armed).toBe(true);
  const hpBefore = (await enemyHps(page))[0];

  await moveEnemy(page, 0, CENTRE.col, CENTRE.row - 2); // the live wave mob crosses onto the trap
  await step(page, 100);

  const after = await state(page);
  expect(after.traps[0].armed).toBe(false); // the wave tripped the trap
  expect((await enemyHps(page))[0]).toBe(hpBefore - SPIKE_TRAP_DAMAGE); // …dealing its hit to a wave mob
});
