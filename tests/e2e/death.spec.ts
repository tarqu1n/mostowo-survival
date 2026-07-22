import { test, expect } from '@playwright/test';
import { startGame, applyScenario, step, state } from './harness';
import { SPAWN_TILE } from '../../src/config';

// Tier-2: player death → scene restart. An enemy stood adjacent chips the player's HP down over
// repeated contact hits (1s cooldown each); at 0 HP GameScene.scene.restart() re-runs create(),
// resetting the world to its boot fixtures (player back at spawn centre, full HP, default spawns).
test('the player dying restarts the scene and resets the world', async ({ page }) => {
  // Heaviest test in the suite: 14000ms of driven `step()` = ~840 rendered frames. Under
  // fullyParallel contention on the headless SwiftShader renderer (fill-rate sensitive — see
  // docs/RENDERING.md) this runs near the default 30s budget; native-scale actors nudged it over.
  // The work is deterministic, just wall-clock-heavy, so give it headroom rather than hide a flake.
  // plan 045 Step 1 interim — reduced in Step 8 once stepLogic removes the render cost
  test.setTimeout(120_000);
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));

  await startGame(page);
  await applyScenario(page, { player: [11, 20], enemies: [[11, 21]] }); // enemy adjacent, aggroed instantly

  // 10 HP × 1 dmg on a 1s contact cooldown → ~10s to die, then the restart. Drive well past that.
  await step(page, 14000);

  expect(logs.some((l) => l.includes('restarting'))).toBe(true); // the death→restart signal
  const s = await state(page);
  expect(s.playerHp).toBe(10); // restarted at full HP
  expect(s.pcol).toBe(SPAWN_TILE.col); // player back at the authored spawn (plan 018 runtime map)
  expect(s.prow).toBe(SPAWN_TILE.row);
});
