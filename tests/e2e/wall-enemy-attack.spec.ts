import { test, expect } from '@playwright/test';
import { startGame, applyScenario, step, state, blocked, walls, enemyHps } from './harness';

// Tier-2 (plan 037 chunk 2c): a mob walled off from its objective attacks the blocking wall via the
// generic structure-target seam (the same seam the wave's fire-attack uses), and a `thorns` wall
// (the spiked palisade) bites the attacker back. Both scenarios ring the player with walls so the mob
// is genuinely walled off (no route around), then drive purely with step() — deterministic, since the
// wall never dodges (flat resolve) and thorns is a flat retaliation.
//
// Geometry uses the known-open row-10 band the combat/monster specs place on. A full 8-tile ring around
// the player leaves NO way in but through a wall; the mob's straight-line frontier wall is [11,10].

const PLAYER: [number, number] = [10, 10];
const RING: Array<[number, number]> = [
  [9, 9],
  [10, 9],
  [11, 9],
  [9, 10],
  [11, 10], // the east frontier wall the mob bashes to reach the player
  [9, 11],
  [10, 11],
  [11, 11],
];
const FRONTIER = { col: 11, row: 10 };
const wallAt = (ws: Awaited<ReturnType<typeof walls>>, col: number, row: number) =>
  ws.find((w) => w.col === col && w.row === row);

test('a mob walled off from the player bashes the blocking wall, then reaches the player once it breaks', async ({
  page,
}) => {
  test.setTimeout(60_000); // several ~1s strike cadences to fell a 12-HP wall + the close-in bite
  await startGame(page);
  // A boar (hp 5) chasing from just east of the ring: it survives the wall's thorns (4 hits × 1) while a
  // low-HP kidZombie would die to them (see the thorns test) — so THIS mob lives to break through.
  await applyScenario(page, {
    player: PLAYER,
    walls: RING,
    enemies: [{ at: [13, 10], id: 'boar', mode: 'chase' }],
  });
  await step(page, 1000); // let the ring's build anims settle (the mob may land an early blow in this window)

  // Full ring stands, the frontier wall still up + blocking, the player unharmed (walled off = not yet
  // reachable). The mob engages fast from two tiles out, so it may already have chipped the wall by now.
  let ws = await walls(page);
  expect(ws.length).toBe(RING.length);
  const frontier0 = wallAt(ws, FRONTIER.col, FRONTIER.row)!;
  expect(frontier0.hp).toBeGreaterThan(0);
  expect(await blocked(page, FRONTIER.col, FRONTIER.row)).toBe(true);
  expect((await state(page)).playerHp).toBe(10);

  // Drive in slices and watch the ORDERING: the frontier wall's HP falls, it is destroyed (gone + its
  // tile freed), and only THEN does the player start taking bites — never before the wall breaks.
  let wallDamaged = frontier0.hp < frontier0.maxHp;
  let wallGone = false;
  let hurtBeforeBreak = false;
  let playerHurt = false;
  for (let i = 0; i < 60 && !playerHurt; i++) {
    await step(page, 400);
    ws = await walls(page);
    const frontier = wallAt(ws, FRONTIER.col, FRONTIER.row);
    if (frontier && frontier.hp < frontier.maxHp) wallDamaged = true;
    if (!frontier) wallGone = true;
    const hp = (await state(page)).playerHp;
    if (hp < 10 && !wallGone) hurtBeforeBreak = true;
    if (hp < 10) playerHurt = true;
  }

  expect(wallDamaged).toBe(true); // the wall took damage over time (HP-stage, not instant removal)
  expect(wallGone).toBe(true); // …then a lethal blow removed it
  expect(await blocked(page, FRONTIER.col, FRONTIER.row)).toBe(false); // its tile freed for pathing
  expect(hurtBeforeBreak).toBe(false); // the player was never reachable while the wall stood
  expect(playerHurt).toBe(true); // once broken, the mob routed through and bit the player
});

test('a spiked (thorns) wall bites the attacker back — a low-HP mob dies to it before it breaks through', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await startGame(page);
  // A kidZombie (hp 3) walled off: the wall (`thorns: 1`) chips 1 HP per strike, so it dies on its 3rd
  // strike — before its ≤3 dmg/hit can fell the 12-HP wall. Proves thorns fire on the mob's OWN attack
  // and route through the kill path (a low-HP mob genuinely dies to the spiked palisade).
  await applyScenario(page, {
    player: PLAYER,
    walls: RING,
    enemies: [{ at: [13, 10], mode: 'chase' }],
  });
  await step(page, 200); // short — the mob is still closing on the wall, so it hasn't struck (full HP)

  expect((await state(page)).enemies).toBe(1);
  const startHp = (await enemyHps(page))[0];
  expect(startHp).toBe(3); // kidZombie full HP — not yet in contact with the wall

  // Watch the mob's HP fall as it strikes the wall, until it dies to thorns. Record the distinct HP
  // readings so we can assert a strictly-decreasing …→ 2 → 1 → dead sequence (thorns chip 1/strike).
  const seen: number[] = [startHp];
  let died = false;
  for (let i = 0; i < 60 && !died; i++) {
    await step(page, 400);
    const s = await state(page);
    if (s.enemies === 0) {
      died = true;
      break;
    }
    const hp = (await enemyHps(page))[0];
    if (hp !== seen[seen.length - 1]) seen.push(hp);
  }

  expect(died).toBe(true); // the mob died — to the wall's thorns, not to the player
  // HP fell one thorn-point at a time and never rose (retaliation only, no other damage source).
  for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThan(seen[i - 1]);
  expect(seen).toContain(2);
  expect(seen).toContain(1);

  // The wall still stands (the mob died before felling it) — thorns chipped the horde, the palisade held.
  const ws = await walls(page);
  const frontier = wallAt(ws, FRONTIER.col, FRONTIER.row);
  expect(frontier).toBeTruthy();
  expect(frontier!.hp).toBeGreaterThan(0);
  expect(await blocked(page, FRONTIER.col, FRONTIER.row)).toBe(true);
});
