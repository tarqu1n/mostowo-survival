/**
 * Order-kind registry: the pure, Phaser-free decision core for worker orders (plan 043 Step 14).
 *
 * A worker order's per-kind metadata used to be spread across ~9 sites in GameScene/fx/input (see
 * docs/cleanup/extensibility.md): a `switch`, an `isXQueued`/`toggleX` quartet, `describeActionTarget`,
 * and a `TaskGlowRenderer` highlight branch. This module concentrates the *data-driven* half of that
 * fan-out — the de-dupe target id, whether a kind de-dupes on enqueue, and how a queued order is
 * highlighted — mirroring how `StructureManager` + `BUILDABLES` split behaviour from data. The
 * scene-coupled halves (walk-to-stand-tile `begin`, per-frame `run`) stay in the scene as dispatch
 * tables keyed by the same `Action['kind']`.
 *
 * Everything here is pure over {@link Action}/{@link TaskQueue}, so it's unit-tested directly
 * (systems/__tests__/orders.test.ts) — the primary testability win of this cleanup pass.
 */
import type { Action } from './tasks';
import type { TaskQueue } from './tasks';

/**
 * The de-dupe / target key for an order: the id of the node or structure it acts on, or `null` for a
 * bare `move` (which has no target and so never de-dupes). Replaces the four near-identical target-id
 * reads in the toggle/queue quartet AND the `describeActionTarget` id branches — one exhaustive
 * selector instead of a field-name-per-kind spread.
 */
export function orderTargetId(a: Action): string | null {
  switch (a.kind) {
    case 'harvest':
      return a.treeId;
    case 'clear':
      return a.treeId;
    case 'refuel':
      return a.campfireId;
    case 'build':
      return a.siteId;
    case 'deconstruct':
      return a.wallId;
    case 'rearm':
      return a.trapId;
    case 'repair':
      return a.structureId;
    case 'move':
      return null;
  }
}

/** How the queue renderer draws a queued order of a given kind (collapses TaskGlowRenderer's per-kind
 *  branch set — the three structure-tending kinds all share the single `'structure'` outline). */
export type OrderHighlight = 'tree' | 'site' | 'structure' | 'move';

/** Per-kind order metadata — the registry the scene/renderer read instead of hard-coding per kind. */
export interface OrderMeta {
  /** How a queued order of this kind is highlighted. */
  readonly highlight: OrderHighlight;
  /** Whether enqueuing an order of this kind toggles an existing same-target order off (the quartet's
   *  behaviour). Only the four structure/node-tending kinds do; `build` and `move` always append (a
   *  double build order must NOT toggle off — the pre-refactor behaviour). */
  readonly dedupeOnEnqueue: boolean;
}

/**
 * The order-kind registry: one entry per {@link Action} kind. Adding a structure/node-tending order
 * kind is now a single entry here (plus its `Action` variant + a scene `begin`/`run` handler) rather
 * than edits scattered across the quartet, `describeActionTarget`, and the highlight branch.
 *
 * `repair` runs on BOTH queues: the companion mends walls on its own queue (plan 042 Step 5), and the
 * player mends a workbench on the player queue (plan 048 Step 4) — so it goes through the enqueue
 * de-dupe + `'structure'` highlight like the other structure-tending kinds.
 */
export const ORDER_META: Record<Action['kind'], OrderMeta> = {
  move: { highlight: 'move', dedupeOnEnqueue: false },
  harvest: { highlight: 'tree', dedupeOnEnqueue: true },
  clear: { highlight: 'tree', dedupeOnEnqueue: true },
  build: { highlight: 'site', dedupeOnEnqueue: false },
  refuel: { highlight: 'structure', dedupeOnEnqueue: true },
  deconstruct: { highlight: 'structure', dedupeOnEnqueue: true },
  rearm: { highlight: 'structure', dedupeOnEnqueue: true },
  repair: { highlight: 'structure', dedupeOnEnqueue: true },
};

/** Two orders address the same work: same kind AND same (non-null) target id. Never true for a
 *  `move` (no target). The generic form of the quartet's four `x.kind === … && x.id === id` tests. */
export function sameOrderTarget(a: Action, b: Action): boolean {
  const id = orderTargetId(a);
  return id !== null && b.kind === a.kind && orderTargetId(b) === id;
}

/** True if the queue already holds an order for `a`'s kind+target (current or pending) — the generic
 *  `isXQueued`. False for a `move` (null target). */
export function isOrderQueued(queue: TaskQueue, a: Action): boolean {
  return queue.all().some((x) => sameOrderTarget(x, a));
}

/**
 * Remove every order matching `a`'s kind+target (current and pending) — the generic `toggleX`.
 * Returns true when the CURRENT action changed, i.e. the caller must restart execution on the new
 * current (or go idle). A `move` (null target) matches nothing and removes nothing.
 */
export function toggleOrder(queue: TaskQueue, a: Action): boolean {
  return queue.removeWhere((x) => sameOrderTarget(x, a));
}
