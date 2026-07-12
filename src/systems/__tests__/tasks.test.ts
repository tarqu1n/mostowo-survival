import { describe, it, expect } from 'vitest';
import { TaskQueue, type Action } from '../tasks';

const move = (col: number, row: number): Action => ({ kind: 'move', col, row });
const harvest = (treeId: string): Action => ({ kind: 'harvest', treeId });
const build = (siteId: string): Action => ({ kind: 'build', siteId });

describe('TaskQueue', () => {
  it('all() is empty when nothing is queued', () => {
    const q = new TaskQueue();
    expect(q.all()).toEqual([]);
    expect(q.current).toBeNull();
    expect(q.pending).toBe(0);
  });

  it('all() equals [current, ...pending]', () => {
    const q = new TaskQueue();
    q.append(move(1, 1));
    q.append(harvest('t1'));
    q.append(build('s1'));
    expect(q.all()).toEqual([move(1, 1), harvest('t1'), build('s1')]);
  });

  it('replace() clears pending and sets current', () => {
    const q = new TaskQueue();
    q.append(move(1, 1));
    q.append(harvest('t1'));
    expect(q.pending).toBe(1);

    q.replace(build('s1'));
    expect(q.current).toEqual(build('s1'));
    expect(q.pending).toBe(0);
    expect(q.all()).toEqual([build('s1')]);
  });

  it('append() sets current when idle, else pushes to pending', () => {
    const q = new TaskQueue();
    q.append(move(1, 1));
    expect(q.current).toEqual(move(1, 1));
    expect(q.pending).toBe(0);

    q.append(harvest('t1'));
    expect(q.current).toEqual(move(1, 1));
    expect(q.pending).toBe(1);
  });

  it('next() shifts pending into current and returns it, null when drained', () => {
    const q = new TaskQueue();
    q.append(move(1, 1));
    q.append(harvest('t1'));

    const n1 = q.next();
    expect(n1).toEqual(harvest('t1'));
    expect(q.current).toEqual(harvest('t1'));
    expect(q.pending).toBe(0);

    const n2 = q.next();
    expect(n2).toBeNull();
    expect(q.current).toBeNull();
  });

  it('clear() empties both current and pending', () => {
    const q = new TaskQueue();
    q.append(move(1, 1));
    q.append(harvest('t1'));
    q.clear();
    expect(q.current).toBeNull();
    expect(q.pending).toBe(0);
    expect(q.all()).toEqual([]);
  });

  it('walks a realistic sequence: replace, append x2, next, next, clear', () => {
    const q = new TaskQueue();

    q.replace(move(0, 0));
    expect(q.current).toEqual(move(0, 0));
    expect(q.pending).toBe(0);

    q.append(harvest('t1'));
    expect(q.current).toEqual(move(0, 0));
    expect(q.pending).toBe(1);

    q.append(build('s1'));
    expect(q.current).toEqual(move(0, 0));
    expect(q.pending).toBe(2);

    const first = q.next();
    expect(first).toEqual(harvest('t1'));
    expect(q.pending).toBe(1);

    const second = q.next();
    expect(second).toEqual(build('s1'));
    expect(q.pending).toBe(0);

    q.clear();
    expect(q.current).toBeNull();
    expect(q.pending).toBe(0);
    expect(q.all()).toEqual([]);
  });
});
