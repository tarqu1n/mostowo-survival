/**
 * Worker task system: pure types and queue logic for NPC scheduling.
 * No side effects or Phaser imports; wired into the game scene by Step 3.
 */

/** An action in a worker's task queue: move, harvest, build, refuel, deconstruct, rearm, repair, or clear. */
export type Action =
  | { kind: 'move'; col: number; row: number } // path to the tile and stop
  | { kind: 'harvest'; treeId: string } // path adjacent to the tree, chop until felled
  | { kind: 'build'; siteId: string } // path adjacent to the blueprint, work until built
  | { kind: 'refuel'; campfireId: string } // path adjacent to the fire, feed wood until topped up / out
  | { kind: 'deconstruct'; wallId: string } // path adjacent to the wall, remove it + refund (plan 037 2b)
  | { kind: 'rearm'; trapId: string } // path adjacent to the spent trap, re-prime it (plan 040)
  | { kind: 'repair'; structureId: string } // path adjacent to a damaged structure, mend it on a cadence (wall: companion, plan 042 Step 5; workbench: player, plan 048 Step 4)
  | { kind: 'clear'; treeId: string }; // path adjacent to a depleted oneShot node, clear the husk to free the tile (plan 047)

/** Queue holding a current action and pending actions for a worker. */
export class TaskQueue {
  private queue: Action[] = [];
  private _current: Action | null = null;

  /**
   * Replace the entire queue with a single action. Clears any pending items.
   */
  replace(a: Action): void {
    this.queue = [];
    this._current = a;
  }

  /**
   * Append an action to the queue. If nothing is current, sets it as current; otherwise queues it.
   */
  append(a: Action): void {
    if (this._current === null) {
      this._current = a;
    } else {
      this.queue.push(a);
    }
  }

  /**
   * Remove every action (current and pending) matching `match`. If the current action is removed,
   * the next pending action shifts into current (as `next()` would). Returns true when the current
   * action changed — i.e. the caller must restart execution on the new current (or go idle).
   */
  removeWhere(match: (a: Action) => boolean): boolean {
    const currentRemoved = this._current !== null && match(this._current);
    this.queue = this.queue.filter((a) => !match(a));
    if (currentRemoved) this._current = this.queue.shift() ?? null;
    return currentRemoved;
  }

  /**
   * Shift the next queued action into current and return it. Returns null if drained.
   */
  next(): Action | null {
    this._current = this.queue.shift() ?? null;
    return this._current;
  }

  /**
   * Clear the queue and current action.
   */
  clear(): void {
    this.queue = [];
    this._current = null;
  }

  /**
   * Count of pending actions (queue length, excluding current).
   */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * The action currently being executed, or null if none.
   */
  get current(): Action | null {
    return this._current;
  }

  /**
   * All active actions in order: the current one (if any) followed by the pending queue.
   * Used to render queue highlights.
   */
  all(): Action[] {
    return this._current ? [this._current, ...this.queue] : [...this.queue];
  }
}
