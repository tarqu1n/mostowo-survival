import { test, expect } from '@playwright/test';
import { startGame, applyScenario, order, step, state, held } from './harness';
import { justARock } from './scenarios';

// Tier-2: a rock is just another resource node (plan 008 Step 3). This proves the generalised
// harvest loop — worker pathfinds to the rock, mines it over its hp, and stone accrues — works with
// the same machinery as the tree chop, driven deterministically. The yield math itself is Tier-1.
test('worker walks to a rock and mines it into stone', async ({ page }) => {
  await startGame(page);
  const { rockIds } = await applyScenario(page, justARock());

  await order(page, { kind: 'harvest', treeId: rockIds[0] });
  await step(page, 6000); // adjacent rock: a short walk + rock.maxHp (4) mine intervals

  expect(await held(page, 'stone')).toBe(4); // rock.maxHp 4 × yieldPerHit 1
  const s = await state(page);
  expect(s.currentKind).toBeNull(); // queue drained once the rock is depleted
});
