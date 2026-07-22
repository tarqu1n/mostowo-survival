import { test, expect } from '@playwright/test';
import { startGame, applyScenario, order, step, state, emit, held } from './harness';

// Tier-2: the full food loop through the REAL scene — the worker forages a (non-blocking) berry bush
// into the bag, then eating a berry via the `needs:eat` event spends it and raises hunger. Reuses the
// harvest machinery (bush = another resource node, plan 004 Step 5) and the eat wiring (Step 7).

test('worker forages a bush for berries, then eats one to restore hunger', async ({ page }) => {
  await startGame(page);
  await step(page, 16); // stop the live RAF loop BEFORE setup — the whole forage runs in driven frames
  // Bush one tile to the east of the worker; seed hunger mid-range so a berry visibly raises it.
  const { bushIds } = await applyScenario(page, { player: [3, 3], bushes: [[5, 3]], hunger: 40 });

  await order(page, { kind: 'harvest', treeId: bushIds[0] });
  await step(page, 4000); // adjacent bush: a short walk + one gather (maxHp 1 × yieldPerHit 2)

  expect(await held(page, 'berries')).toBe(2);
  const fedFrom = (await state(page)).hunger;

  await emit(page, 'needs:eat', { itemId: 'berries' });

  expect(await held(page, 'berries')).toBe(1); // one berry spent
  expect((await state(page)).hunger).toBeGreaterThan(fedFrom); // nutrition restored
});
