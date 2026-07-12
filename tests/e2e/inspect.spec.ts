import { test, expect } from '@playwright/test';
import { startGame, applyScenario, inspect, captured } from './harness';

// Tier-2: Inspect-mode hit-testing + the GameScene→UIScene 'inspect:show'/'inspect:hide' wiring
// (which stats reach the panel for each entity kind, and that empty ground dismisses it).

test('inspecting each entity kind shows its stats, empty ground hides the panel', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, {
    player: [3, 3],
    mode: 'inspect',
    trees: [[5, 3]],
    zombies: [[7, 3]],
    walls: [[9, 3]],
  });

  await inspect(page, 7, 3); // zombie (highest priority)
  expect(await captured(page, 'inspect:show')).toMatchObject({ name: 'Kid Zombie', maxHp: 3, currentHp: 3 });

  await inspect(page, 5, 3); // tree
  expect(await captured(page, 'inspect:show')).toMatchObject({ name: 'Tree', maxHp: 3 });

  await inspect(page, 9, 3); // wall (built)
  expect(await captured(page, 'inspect:show')).toMatchObject({ name: 'Wall' });

  // Empty ground emits 'inspect:hide'. Re-arm the capture so we detect this hide specifically.
  await page.evaluate(() => ((window as any).game.__captured['inspect:hide'] = null));
  await inspect(page, 1, 1);
  expect(await captured(page, 'inspect:hide')).toBe(true);
});
