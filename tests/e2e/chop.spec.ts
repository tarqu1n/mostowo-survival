import { test, expect } from '@playwright/test';
import { startGame, applyScenario, order, step, state, wood } from './harness';
import { justATree } from './scenarios';

// Tier-2: the chop→wood loop through the REAL scene (worker pathfinds to the tree's base and fells
// it over multiple hits), driven deterministically. The yield math itself is Tier-1 (Inventory +
// node hp); this proves the integrated walk+chop resolves under the driven loop.
test('worker walks to a tree and chops it into wood', async ({ page }) => {
  await startGame(page);
  const { treeIds } = await applyScenario(page, justATree());

  await order(page, { kind: 'harvest', treeId: treeIds[0] });
  await step(page, 6000); // adjacent tree: a short walk + 3 chop intervals

  expect(await wood(page)).toBe(3); // maxHp 3 × woodPerHit 1
  const s = await state(page);
  expect(s.currentKind).toBeNull(); // queue drained once felled
});
