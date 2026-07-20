import { test, expect } from '@playwright/test';
import { startGame, applyScenario, step, blocked, walls, damageWall } from './harness';

// Tier-2 (plan 037 chunk 2a): a wall is now a LIVE, 4-way, destructible structure (WallManager), not a
// static tile. A scenario-placed wall stands with full HP + a facing, blocks its tile, takes damage
// through the mob-attack seam (WallManager.takeDamage — driven here by the __test.damageWall seam, the
// path chunk 2c's enemy will use), and on a lethal blow is removed with its tile freed for pathing.
// Driven only by step(), so it's deterministic. Uses the small open-ground tiles the other build/chop
// specs place on (player [3,3]; [5,3] is where justATree stands a tree — proven walkable ground).

test('a placed wall is a live full-HP structure that blocks; a mob attack damages then destroys it, freeing its tile', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, { player: [3, 3], walls: [[5, 3]] });
  await step(page, 1000); // let the build anim play through + settle on the intact idle frame

  // Placed as a live structure with full HP + the default (down) placement facing.
  let w = await walls(page);
  expect(w.length).toBe(1);
  expect(w[0]).toMatchObject({ col: 5, row: 3, facing: 'down' });
  expect(w[0].hp).toBe(w[0].maxHp);
  expect(w[0].maxHp).toBeGreaterThan(0);
  expect(await blocked(page, 5, 3)).toBe(true); // a finished wall blocks its tile

  // A non-lethal blow lowers HP but the wall stands + keeps blocking (HP-stage render, not removal).
  const destroyed1 = await damageWall(page, 0, 3);
  expect(destroyed1).toBe(false);
  w = await walls(page);
  expect(w.length).toBe(1);
  expect(w[0].hp).toBe(w[0].maxHp - 3);
  expect(await blocked(page, 5, 3)).toBe(true);

  // A lethal blow destroys the wall + frees its tile: gone from the collection, tile passable again.
  const destroyed2 = await damageWall(page, 0, 999);
  expect(destroyed2).toBe(true);
  await step(page, 1000); // destroy anim + sprite cleanup
  expect((await walls(page)).length).toBe(0);
  expect(await blocked(page, 5, 3)).toBe(false); // tile freed for pathing/occupancy
});
