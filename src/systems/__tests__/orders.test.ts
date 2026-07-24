import { describe, it, expect } from 'vitest';
import { orderTargetId, sameOrderTarget, isOrderQueued, toggleOrder, ORDER_META } from '../orders';
import { TaskQueue } from '../tasks';
import type { Action } from '../tasks';

// Plain-Node tests: orders + tasks are pure (no `phaser`, no jsdom). See vitest.config.ts.

const harvest = (treeId: string): Action => ({ kind: 'harvest', treeId });
const clear = (treeId: string): Action => ({ kind: 'clear', treeId });
const refuel = (campfireId: string): Action => ({ kind: 'refuel', campfireId });
const rearm = (trapId: string): Action => ({ kind: 'rearm', trapId });
const deconstruct = (wallId: string): Action => ({ kind: 'deconstruct', wallId });
const build = (siteId: string): Action => ({ kind: 'build', siteId });
const move = (col: number, row: number): Action => ({ kind: 'move', col, row });

describe('orderTargetId', () => {
  it('extracts the target id per kind', () => {
    expect(orderTargetId(harvest('t1'))).toBe('t1');
    expect(orderTargetId(clear('t1'))).toBe('t1');
    expect(orderTargetId(refuel('c1'))).toBe('c1');
    expect(orderTargetId(build('s1'))).toBe('s1');
    expect(orderTargetId(deconstruct('w1'))).toBe('w1');
    expect(orderTargetId(rearm('r1'))).toBe('r1');
    expect(orderTargetId({ kind: 'repair', structureId: 'w9' })).toBe('w9');
  });

  it('is null for a move (no target)', () => {
    expect(orderTargetId(move(3, 4))).toBeNull();
  });
});

describe('sameOrderTarget', () => {
  it('true only for same kind AND same target id', () => {
    expect(sameOrderTarget(harvest('t1'), harvest('t1'))).toBe(true);
    expect(sameOrderTarget(harvest('t1'), harvest('t2'))).toBe(false);
  });

  it('false across kinds even when ids coincide', () => {
    // a wall id shared by deconstruct + repair must not collide
    expect(sameOrderTarget(deconstruct('w1'), { kind: 'repair', structureId: 'w1' })).toBe(false);
  });

  it('a move never matches (null target)', () => {
    expect(sameOrderTarget(move(1, 1), move(1, 1))).toBe(false);
    expect(sameOrderTarget(harvest('t1'), move(1, 1))).toBe(false);
  });
});

describe('ORDER_META', () => {
  it('build and move do NOT de-dupe on enqueue; every tending kind does', () => {
    // The behaviour-preservation invariant: build + move APPEND (a double build order must not toggle
    // off, a move never de-dupes); every node/structure-tending kind toggles a same-target duplicate.
    const noDedupe = (Object.keys(ORDER_META) as Action['kind'][]).filter(
      (k) => !ORDER_META[k].dedupeOnEnqueue,
    );
    expect(noDedupe.sort()).toEqual(['build', 'move']);
  });

  it('classifies highlights, folding the three structure-tending kinds together', () => {
    expect(ORDER_META.harvest.highlight).toBe('tree');
    expect(ORDER_META.clear.highlight).toBe('tree');
    expect(ORDER_META.build.highlight).toBe('site');
    expect(ORDER_META.move.highlight).toBe('move');
    for (const k of ['refuel', 'deconstruct', 'rearm'] as const)
      expect(ORDER_META[k].highlight).toBe('structure');
  });
});

describe('isOrderQueued', () => {
  it('detects a matching current order', () => {
    const q = new TaskQueue();
    q.append(harvest('t1'));
    expect(isOrderQueued(q, harvest('t1'))).toBe(true);
    expect(isOrderQueued(q, harvest('t2'))).toBe(false);
  });

  it('detects a matching clear order by target', () => {
    const q = new TaskQueue();
    q.append(clear('t1'));
    expect(isOrderQueued(q, clear('t1'))).toBe(true);
    expect(isOrderQueued(q, clear('t2'))).toBe(false);
  });

  it('detects a matching pending order (behind a current)', () => {
    const q = new TaskQueue();
    q.append(move(0, 0)); // current
    q.append(refuel('c1')); // pending
    expect(isOrderQueued(q, refuel('c1'))).toBe(true);
  });

  it('a move is never considered queued (null target)', () => {
    const q = new TaskQueue();
    q.append(move(2, 2));
    expect(isOrderQueued(q, move(2, 2))).toBe(false);
  });
});

describe('toggleOrder', () => {
  it('removes a pending order and reports the current unchanged', () => {
    const q = new TaskQueue();
    q.append(harvest('t1')); // current
    q.append(harvest('t2')); // pending
    expect(toggleOrder(q, harvest('t2'))).toBe(false); // current not touched
    expect(q.all().map((a) => orderTargetId(a))).toEqual(['t1']);
  });

  it('removes the current order, reports the change, and shifts the next up', () => {
    const q = new TaskQueue();
    q.append(harvest('t1')); // current
    q.append(harvest('t2')); // pending
    expect(toggleOrder(q, harvest('t1'))).toBe(true); // current removed → restart
    expect(q.current).toEqual(harvest('t2'));
  });

  it('removes both a current and a pending order of the same target', () => {
    const q = new TaskQueue();
    q.append(refuel('c1')); // current
    q.append(move(0, 0)); // pending
    q.append(refuel('c1')); // duplicate pending
    expect(toggleOrder(q, refuel('c1'))).toBe(true);
    expect(q.all()).toEqual([move(0, 0)]);
  });

  it('re-tapping a clear order toggles it off (the cancel path)', () => {
    const q = new TaskQueue();
    q.append(clear('t1')); // current
    expect(toggleOrder(q, clear('t1'))).toBe(true); // current removed → restart / idle
    expect(q.current).toBeNull();
  });

  it('a move toggles nothing (null target matches nothing)', () => {
    const q = new TaskQueue();
    q.append(move(1, 1));
    expect(toggleOrder(q, move(1, 1))).toBe(false);
    expect(q.pending + (q.current ? 1 : 0)).toBe(1);
  });
});
