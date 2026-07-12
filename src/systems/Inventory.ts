import { EventEmitter } from 'eventemitter3';

/**
 * Character inventory: a bag of item counts keyed by item id. Pure world logic, no scene deps.
 * Emits `'change'` (payload: {@link snapshot}) after any mutation so UI can react without polling.
 * Shared across scenes via `this.registry`; the UIScene subscribes to `'change'` directly.
 *
 * Extends `eventemitter3` directly (rather than `Phaser.Events.EventEmitter`, which is that same
 * package re-exported) so this file imports no Phaser — keeps it plain-Node testable. See
 * vitest.config.ts.
 */
export class Inventory extends EventEmitter {
  private readonly items = new Map<string, number>();

  /** Count held of `id` (0 if never added). */
  get(id: string): number {
    return this.items.get(id) ?? 0;
  }

  /** Add `n` of `id` (default 1), then emit `'change'`. */
  add(id: string, n = 1): void {
    this.items.set(id, this.get(id) + n);
    this.emit('change', this.snapshot());
  }

  /** True if at least `n` (default 1) of `id` is held. */
  has(id: string, n = 1): boolean {
    return this.get(id) >= n;
  }

  /** True iff every id in `cost` is held in at least the required amount. */
  canAfford(cost: Record<string, number>): boolean {
    return Object.entries(cost).every(([id, amount]) => this.get(id) >= amount);
  }

  /** Deduct `cost` atomically. No-op returning false if unaffordable; else emits `'change'` once and returns true. */
  spend(cost: Record<string, number>): boolean {
    if (!this.canAfford(cost)) return false;
    for (const [id, amount] of Object.entries(cost)) {
      this.items.set(id, this.get(id) - amount);
    }
    this.emit('change', this.snapshot());
    return true;
  }

  /** Plain-object copy of current counts (safe to hand to listeners). */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.items);
  }
}
