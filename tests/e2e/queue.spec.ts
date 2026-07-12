import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, enqueue, step, state, tileToClient } from './harness';
import { twoTrees, threeTrees } from './scenarios';

// Tier-2: the reported queueing feel — tapping a second tree while the worker is chopping a first
// should QUEUE the second (fall in behind the current chop), not stop the first and re-target. Driven
// through the REAL pointer path (onPointerUp's tap decision), so it proves the tap-vs-queue routing,
// not just the underlying TaskQueue. MIN_ZOOM pins the camera (whole map visible, no scroll room →
// follow never moves it) so screen↔tile mapping stays fixed while the worker walks between taps.
test('tapping a second tree while harvesting the first queues it instead of interrupting', async ({
  page,
}) => {
  await startGame(page);
  const { treeIds } = await applyScenario(page, twoTrees());
  for (let i = 0; i < 4; i++) await emit(page, 'zoom:delta', -0.5); // → MIN_ZOOM, static camera

  // Quick tap on tree A → start harvesting it (the action is 'harvest' throughout the walk + chop).
  const a = await tileToClient(page, 5, 3);
  await page.mouse.click(a.x, a.y);
  await step(page, 200);
  let s = await state(page);
  expect(s.currentKind).toBe('harvest');
  expect(s.pending).toBe(0);
  expect(s.pulsingTreeId).toBe(treeIds[0]);

  // Quick tap on tree B mid-harvest → it should QUEUE behind A, leaving A as the live chop.
  const b = await tileToClient(page, 8, 3);
  await page.mouse.click(b.x, b.y);
  await step(page, 16);
  s = await state(page);
  expect(s.currentKind).toBe('harvest'); // still felling the first tree, not re-targeted
  expect(s.pending).toBe(1); // second tree queued behind it
  expect(s.pulsingTreeId).toBe(treeIds[0]); // head of queue is still tree A
  expect(s.outlinedTreeIds).toEqual(expect.arrayContaining([treeIds[0], treeIds[1]]));

  // Re-tapping the queued tree un-queues it (toggle off) — not a second chop order for it.
  await page.mouse.click(b.x, b.y);
  await step(page, 16);
  s = await state(page);
  expect(s.currentKind).toBe('harvest'); // the live chop is untouched
  expect(s.pending).toBe(0); // B removed from the queue
  expect(s.queuedTreeIds).toEqual([treeIds[0]]);

  // Tapping it once more re-queues it (toggle on), back behind the current chop.
  await page.mouse.click(b.x, b.y);
  await step(page, 16);
  s = await state(page);
  expect(s.pending).toBe(1);
  expect(s.queuedTreeIds).toEqual([treeIds[0], treeIds[1]]);
});

// Toggling a mid-list tree off then on moves it to the END of the queue, not back to its old slot —
// the re-queue is a plain append. Three trees give an unambiguous middle to pull out and re-add.
// Driven through the DEV `enqueue` seam (which the tap path routes into — proven in the spec above)
// so the queue-order assertions don't hinge on pixel-mapping every tile onto the canvas.
test('re-enqueuing an already-queued tree moves it to the end of the harvest queue', async ({
  page,
}) => {
  await startGame(page);
  const { treeIds } = await applyScenario(page, threeTrees());

  // Queue all three: the first becomes the live chop, B and C fall in behind it.
  for (const id of treeIds) await enqueue(page, { kind: 'harvest', treeId: id });
  await step(page, 16);
  let s = await state(page);
  expect(s.queuedTreeIds).toEqual([treeIds[0], treeIds[1], treeIds[2]]);

  // Re-enqueue the middle tree (B): first hit toggles it off…
  await enqueue(page, { kind: 'harvest', treeId: treeIds[1] });
  await step(page, 16);
  s = await state(page);
  expect(s.queuedTreeIds).toEqual([treeIds[0], treeIds[2]]);

  // …hit it again and it lands last, after C, not back in its old middle slot.
  await enqueue(page, { kind: 'harvest', treeId: treeIds[1] });
  await step(page, 16);
  s = await state(page);
  expect(s.queuedTreeIds).toEqual([treeIds[0], treeIds[2], treeIds[1]]);
});
