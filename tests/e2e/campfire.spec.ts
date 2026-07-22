import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  step,
  state,
  tryPlace,
  inLight,
  feedCampfire,
  damageFire,
  enqueue,
  held,
} from './harness';

// Tier-2: the campfire buildable end-to-end — fixture placement, the real tilePlaceable gate (plan
// 039: the base-claim is a lit hearth's bright core, with the fixed BASE_ZONE rect as the no-hearth
// bootstrap), the night-overlay reveal (nightAlpha/inLight — NOT enemy visibility, see plan 012 Out
// of scope), and the per-frame fuel drain + tap-to-feed relight. Most tiles below sit at [22,x] on
// open, reachable ground — campfire FIXTURES are force-placed by applyScenario (bypassing the gate)
// and inLight/fuel/refuel are relative to the fire wherever it is, so those scenarios don't care
// where BASE_ZONE is. The gate tests (tryPlace / the claim test) use real BASE_ZONE / claim coords
// around SPAWN_TILE {118,140} (rect: cols 108-128, rows 127-153) — see each test.

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

// Bootstrap path (plan 039): with NO lit hearth, `baseOnly` placement falls back to the fixed
// BASE_ZONE rect so the FIRST campfire can be built before any fire exists. Coords are around
// SPAWN_TILE {118,140} — rect cols 108-128, rows 127-153 — on open, reachable ground.
test('with no hearth, tryPlace falls back to the BASE_ZONE rect (bootstrap)', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [118, 141], inventory: { wood: 40, stone: 40 } });

  const before = await state(page);
  const woodBefore = await held(page, 'wood');
  const stoneBefore = await held(page, 'stone');

  // Outside BASE_ZONE (row 100 < minRow 127) — rejected by the bootstrap rect (no hearth yet).
  const placedOutside = await tryPlace(page, 'campfire', 118, 100);
  expect(placedOutside).toBe(false);

  const afterOutside = await state(page);
  expect(afterOutside.sites).toBe(before.sites);
  expect(await held(page, 'wood')).toBe(woodBefore);
  expect(await held(page, 'stone')).toBe(stoneBefore);

  // Inside BASE_ZONE, reachable from the player — accepted (the bootstrap first-fire placement).
  const placedInside = await tryPlace(page, 'campfire', 118, 138);
  expect(placedInside).toBe(true);
});

// Claim path (plan 039): once a hearth is LIT, the base-claim IS its bright core (radius ×
// CLAIM_LIGHT_FRAC, tighter than the full light radius) — NOT the BASE_ZONE rect. A `baseOnly`
// buildable places inside the core and is rejected just outside it (even where the fire still casts
// light), and the placeable area BREATHES with fuel — draining the fire shrinks the core so a tile
// that was claimable flips to rejected. Seeded at full fuel: light = 8 tiles, core = 8 × 0.7 ≈ 5.6.
test('with a lit hearth, tryPlace claims the bright core and shrinks with fuel', async ({
  page,
}) => {
  await startGame(page);
  // Full-fuel hearth: a tile 3 tiles out is inside the ~5.6-tile core; a tile 7 tiles out is lit but
  // OUTSIDE the core → rejected. Hearth at [118,138], player below it, on reachable spawn ground.
  await applyScenario(page, {
    player: [118, 141],
    campfires: [[118, 138]], // force-placed lit at full fuel (120) → claim is active
    inventory: { wood: 60, stone: 60 },
  });
  expect((await state(page)).campfires[0].lit).toBe(true);

  // 7 tiles above the hearth: within the light radius (≤8) but outside the bright core (>5.6).
  expect(await inLight(page, 118, 131)).toBe(true); // the fire DOES light it…
  expect(await tryPlace(page, 'campfire', 118, 131)).toBe(false); // …but it's outside the claim core

  // 3 tiles from the hearth: inside the bright core → placeable.
  expect(await tryPlace(page, 'campfire', 121, 138)).toBe(true);

  // Fuel shrinks the core: re-seed the same layout near-empty (still lit) and the tile 3 out that was
  // just claimable now falls outside the shrunken core → rejected.
  await applyScenario(page, {
    player: [118, 141],
    campfires: [[118, 138]],
    campfireFuel: 4, // lit but dim → light radius (and its core) contract toward the MIN_FRAC floor
    inventory: { wood: 60, stone: 60 },
  });
  expect((await state(page)).campfires[0].lit).toBe(true);
  expect(await tryPlace(page, 'campfire', 121, 138)).toBe(false); // core shrank past 3 tiles
});

// Plan 039 Step 3 (decision #7): the player emits a tiny RENDER light so full-dark night isn't
// blinding — but that light is NOT the base CLAIM (which is fires-only). A tile right by the player,
// far from any lit hearth, must still be REJECTED for a `baseOnly` build: standing somewhere never
// claims it. Guards against the player light ever leaking into the claim path.
test("the player's personal light does not grant baseOnly placement (render ≠ claim)", async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, {
    player: [118, 141],
    campfires: [[118, 118]], // a LIT hearth far away (~23 tiles) → claim path active, but not here
    inventory: { wood: 60, stone: 60 },
  });
  expect((await state(page)).campfires[0].lit).toBe(true);
  // A tile next to the player but ~25 tiles from the only hearth: outside its claim core → rejected,
  // even though the player's own render light sits right on it.
  expect(await tryPlace(page, 'campfire', 118, 143)).toBe(false);
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
    campfireFuel: 1, // near-empty — a short step exhausts it rather than the full ~300s tank
    inventory: { wood: 5 },
  });

  await step(page, 3000); // 1 fuel - 0.4/s * 3s -> clamped to 0 (burn retuned in plan 038 Step 2)

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

// Plan 038 Step 1: a mob attack on the fire-heart drains its FUEL (CampfireManager.damageFire — the
// same meter burn/feed use, decision #2: no separate integrity meter). Draining it to 0 knocks the
// light out (douses → dark) — but that is explicitly NOT a loss (decision #1): the run continues and
// feeding wood relights it. This is the mob→fire coupling Step 4's objective AI will call.
test("a mob attack (damageFire) knocks the fire's light out — dark, not a loss — then feeding relights it", async ({
  page,
}) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));

  await startGame(page);
  await applyScenario(page, {
    player: [22, 40],
    campfires: [[22, 38]],
    startPhase: 'night', // night → the fire's light hole is meaningful (inLight probes below)
    inventory: { wood: 5 },
  });

  const lit = await state(page);
  expect(lit.campfires[0].lit).toBe(true);
  expect(await inLight(page, 22, 39)).toBe(true); // full-fuel fire lights its surroundings

  // One heavy blow drains the whole tank → the fire douses inline (same path as a burn-out).
  expect(await damageFire(page, 0, 999)).toBe(true);
  // Run on for a beat: the loop keeps ticking, the fire stays out (no relight), and crucially nothing
  // restarts the scene — a knocked-out fire is a dire dark state, not a game-over.
  await step(page, 1000);

  const out = await state(page);
  expect(out.campfires[0].fuel).toBe(0);
  expect(out.campfires[0].lit).toBe(false);
  expect(await inLight(page, 22, 39)).toBe(false); // its light hole is gone → dark
  expect(out.playerDying).toBe(false);
  expect(logs.some((l) => l.includes('restarting'))).toBe(false); // NOT a loss — the run continues

  // Claw-back: feeding wood relights the knocked-out fire (the existing recovery path, no new logic).
  expect(await feedCampfire(page, 0)).toBe(true);
  const relit = await state(page);
  expect(relit.campfires[0].fuel).toBeGreaterThan(0);
  expect(relit.campfires[0].lit).toBe(true);
});

// Plan 016: refuel is a *queued worker order* (walk adjacent, then tend — like chop/mine), NOT the
// old instant tap-to-feed. Drives the real enqueue → beginCurrent → runRefuel path via a refuel Action.
test('a refuel order walks the worker to the fire, feeds it, then self-terminates', async ({
  page,
}) => {
  // plan 045 Step 1 interim — reduced in Step 8 once stepLogic removes the render cost
  test.setTimeout(60_000);
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
