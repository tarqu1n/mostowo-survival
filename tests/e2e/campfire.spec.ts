import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  step,
  state,
  tryPlace,
  inLight,
  feedCampfire,
  enqueue,
  held,
} from './harness';

// Tier-2: the campfire buildable end-to-end — fixture placement, the real tilePlaceable/isInBase
// gate, the night-overlay reveal (nightAlpha/inLight — NOT enemy visibility, see plan 012 Out of
// scope), and the per-frame fuel drain + tap-to-feed relight. Player/campfire tiles below are inside
// BASE_ZONE (config.ts: minCol 12/maxCol 32/minRow 26/maxRow 52) on open, reachable ground, so
// `reachableAdjacent` (the hidden determinism trap in tilePlaceable) holds for every scenario here.

test('a campfire fixture placed inside the base zone appears in state().campfires', async ({
  page,
}) => {
  await startGame(page);
  const { campfireIds } = await applyScenario(page, {
    player: [22, 40],
    campfires: [[22, 38]],
  });

  expect(campfireIds.length).toBe(1);
  const s = await state(page);
  expect(s.campfires.length).toBe(1);
  expect(s.campfires[0]).toMatchObject({ col: 22, row: 38 });
});

test('tryPlace is blocked outside the base zone and allowed inside it', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [22, 40], inventory: { wood: 40, stone: 40 } });

  const before = await state(page);
  const woodBefore = await held(page, 'wood');
  const stoneBefore = await held(page, 'stone');

  // Outside BASE_ZONE (row 5 < minRow 26) — rejected by the isInBase gate.
  const placedOutside = await tryPlace(page, 'campfire', 22, 5);
  expect(placedOutside).toBe(false);

  const afterOutside = await state(page);
  expect(afterOutside.sites).toBe(before.sites);
  expect(await held(page, 'wood')).toBe(woodBefore);
  expect(await held(page, 'stone')).toBe(stoneBefore);

  // Inside BASE_ZONE, reachable from the player — accepted.
  const placedInside = await tryPlace(page, 'campfire', 22, 42);
  expect(placedInside).toBe(true);
});

test('night reveals a hole around a lit campfire (nightAlpha + inLight), no enemy-visibility check', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, {
    player: [22, 40],
    campfires: [[22, 38]],
    startPhase: 'night',
  });

  const s = await state(page);
  expect(s.nightAlpha).toBeGreaterThan(0);
  expect(s.campfires[0].lit).toBe(true);
  expect(await inLight(page, 22, 39)).toBe(true); // adjacent to the fire
  expect(await inLight(page, 22, 5)).toBe(false); // far away
});

test('fuel drains to 0 (douses) then feeding wood relights it', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, {
    player: [22, 40],
    campfires: [[22, 38]],
    campfireFuel: 1, // near-empty — a short step exhausts it rather than the full ~120s tank
    inventory: { wood: 5 },
  });

  await step(page, 1200); // 1 fuel - 1/s * 1.2s -> clamped to 0

  const drained = await state(page);
  expect(drained.campfires[0].fuel).toBe(0);
  expect(drained.campfires[0].lit).toBe(false);

  const woodBefore = await held(page, 'wood');
  const fed = await feedCampfire(page, 0);
  expect(fed).toBe(true);

  const relit = await state(page);
  expect(relit.campfires[0].fuel).toBeGreaterThan(0);
  expect(relit.campfires[0].lit).toBe(true);
  expect(await held(page, 'wood')).toBe(woodBefore - 1);
});

// Plan 016: refuel is a *queued worker order* (walk adjacent, then tend — like chop/mine), NOT the
// old instant tap-to-feed. Drives the real enqueue → beginCurrent → runRefuel path via a refuel Action.
test('a refuel order walks the worker to the fire, feeds it, then self-terminates', async ({
  page,
}) => {
  await startGame(page);
  const { campfireIds } = await applyScenario(page, {
    player: [22, 40],
    campfires: [[22, 38]], // 2 tiles above the worker, inside BASE_ZONE
    campfireFuel: 10, // low but lit — needs several woods to top up
    inventory: { wood: 5 },
  });

  await enqueue(page, { kind: 'refuel', campfireId: campfireIds[0] });
  expect((await state(page)).currentKind).toBe('refuel'); // it's a real queued order

  await step(page, 6000); // walk (~0.2s) + feed one wood/s until topped up

  const s = await state(page);
  expect(s.currentKind).toBeNull(); // order self-terminated (no spin)
  expect(s.pending).toBe(0);
  expect(s.campfires[0].fuel).toBeGreaterThan(60); // fed well up from 10
  expect(s.campfires[0].lit).toBe(true);
  expect(await held(page, 'wood')).toBeLessThan(5); // wood consumed
  // Worker ended on a tile ADJACENT to the fire, never on its blocking tile (the "walks in and gets
  // stuck" bug): Chebyshev distance 1 from (22,38), and not the fire tile itself.
  expect(Math.max(Math.abs(s.pcol - 22), Math.abs(s.prow - 38))).toBe(1);
});

test('a refuel order aborts (does not spin) when the bag runs dry mid-tend', async ({ page }) => {
  await startGame(page);
  const { campfireIds } = await applyScenario(page, {
    player: [22, 40],
    campfires: [[22, 38]],
    campfireFuel: 10,
    inventory: { wood: 1 }, // only enough for a single feed
  });

  await enqueue(page, { kind: 'refuel', campfireId: campfireIds[0] });
  await step(page, 6000);

  const s = await state(page);
  expect(s.currentKind).toBeNull(); // terminated, not stuck swinging on a fire it can't feed
  expect(await held(page, 'wood')).toBe(0); // spent the one wood it had
  expect(s.campfires[0].fuel).toBeGreaterThan(10); // that one feed still landed
});

// Plan 016: the light radius lerps with fuel, so a dying fire throws less light. inLight() reads the
// live radius, so the same probe tile is lit by a full fire but dark once the fire burns low.
test('the lit radius shrinks as fuel drops', async ({ page }) => {
  await startGame(page);

  // Full tank: the 8-tile reach covers a probe 5 tiles away.
  await applyScenario(page, { player: [22, 45], campfires: [[22, 38]], campfireFuel: 120 });
  expect(await inLight(page, 22, 33)).toBe(true);

  // Near-empty (still lit): the reach shrinks below 5 tiles, so the same probe is now dark — but the
  // fire still lights its immediate surroundings.
  await applyScenario(page, { player: [22, 45], campfires: [[22, 38]], campfireFuel: 12 });
  expect(await inLight(page, 22, 33)).toBe(false);
  expect(await inLight(page, 22, 37)).toBe(true);
});
