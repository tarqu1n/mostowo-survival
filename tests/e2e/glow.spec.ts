import { test, expect } from '@playwright/test';
import { startGame, applyScenario, enqueue, state, isWebGL } from './harness';

// Tier-2: queued-tree highlight. `pulsingTreeId` (the head-of-queue harvest) is renderer-independent;
// the outline PostFX (`outlinedTreeIds`) only attaches under WebGL — Canvas degrades to a marker rect
// (see GameScene.refreshQueueHighlights), so that assertion is gated on the live renderer.

test('queued trees are highlighted; the head of the harvest queue pulses', async ({ page }) => {
  await startGame(page);
  const { treeIds } = await applyScenario(page, { player: [3, 3], trees: [[5, 3], [7, 3]] });

  await enqueue(page, { kind: 'harvest', treeId: treeIds[0] });
  await enqueue(page, { kind: 'harvest', treeId: treeIds[1] });

  const s = await state(page);
  expect(s.pulsingTreeId).toBe(treeIds[0]); // first queued harvest is the head

  if (await isWebGL(page)) {
    expect(s.outlinedTreeIds).toEqual(expect.arrayContaining(treeIds));
    expect(s.outlinedTreeIds).toHaveLength(2);
  }
});
