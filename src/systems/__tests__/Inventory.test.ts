import { describe, it, expect, vi } from 'vitest';
import { Inventory } from '../Inventory';

// Plain-Node tests: Inventory imports eventemitter3 directly (not `phaser`), so this file must
// never import `phaser` or rely on jsdom. See vitest.config.ts.

describe('Inventory', () => {
  describe('add / get accounting', () => {
    it('starts every item at 0', () => {
      const inv = new Inventory();
      expect(inv.get('wood')).toBe(0);
    });

    it('add defaults to 1', () => {
      const inv = new Inventory();
      inv.add('wood');
      expect(inv.get('wood')).toBe(1);
    });

    it('add accumulates across multiple calls', () => {
      const inv = new Inventory();
      inv.add('wood', 2);
      inv.add('wood', 3);
      expect(inv.get('wood')).toBe(5);
    });

    it('tracks independent item ids separately', () => {
      const inv = new Inventory();
      inv.add('wood', 4);
      inv.add('stone', 1);
      expect(inv.get('wood')).toBe(4);
      expect(inv.get('stone')).toBe(1);
    });
  });

  describe('has / canAfford', () => {
    it('has defaults to requiring at least 1', () => {
      const inv = new Inventory();
      expect(inv.has('wood')).toBe(false);
      inv.add('wood');
      expect(inv.has('wood')).toBe(true);
    });

    it('has respects an explicit amount', () => {
      const inv = new Inventory();
      inv.add('wood', 2);
      expect(inv.has('wood', 2)).toBe(true);
      expect(inv.has('wood', 3)).toBe(false);
    });

    it('canAfford is true only when every cost entry is met', () => {
      const inv = new Inventory();
      inv.add('wood', 2);
      inv.add('stone', 1);
      expect(inv.canAfford({ wood: 2, stone: 1 })).toBe(true);
      expect(inv.canAfford({ wood: 2, stone: 2 })).toBe(false);
    });

    it('canAfford is true for an empty cost', () => {
      const inv = new Inventory();
      expect(inv.canAfford({})).toBe(true);
    });
  });

  describe('spend', () => {
    it('deducts atomically and returns true when affordable', () => {
      const inv = new Inventory();
      inv.add('wood', 5);
      const ok = inv.spend({ wood: 2 });
      expect(ok).toBe(true);
      expect(inv.get('wood')).toBe(3);
    });

    it('returns false and is a no-op when unaffordable', () => {
      const inv = new Inventory();
      inv.add('wood', 1);
      const ok = inv.spend({ wood: 2 });
      expect(ok).toBe(false);
      expect(inv.get('wood')).toBe(1);
    });

    it('leaves every item untouched (atomic) when only one of several costs is unaffordable', () => {
      const inv = new Inventory();
      inv.add('wood', 5);
      inv.add('stone', 0);
      const ok = inv.spend({ wood: 2, stone: 1 });
      expect(ok).toBe(false);
      expect(inv.get('wood')).toBe(5);
      expect(inv.get('stone')).toBe(0);
    });
  });

  describe('wood accounting behind chop-yield and blueprint-spend', () => {
    it('accumulates wood from repeated chop-yield adds then spends it on a blueprint cost', () => {
      const inv = new Inventory();
      // Simulate 3 chop hits at woodPerHit: 1 (see src/data/nodes.ts NODES.tree).
      inv.add('wood', 1);
      inv.add('wood', 1);
      inv.add('wood', 1);
      expect(inv.get('wood')).toBe(3);

      // Simulate a wall build (see src/data/buildables.ts BUILDABLES.wall.cost = { wood: 2 }).
      expect(inv.canAfford({ wood: 2 })).toBe(true);
      const ok = inv.spend({ wood: 2 });
      expect(ok).toBe(true);
      expect(inv.get('wood')).toBe(1);
    });

    it('refuses a blueprint spend once wood drops below the cost', () => {
      const inv = new Inventory();
      inv.add('wood', 1);
      expect(inv.canAfford({ wood: 2 })).toBe(false);
      expect(inv.spend({ wood: 2 })).toBe(false);
      expect(inv.get('wood')).toBe(1);
    });
  });

  describe("'change' event", () => {
    it('fires on add, with the snapshot as payload', () => {
      const inv = new Inventory();
      const listener = vi.fn();
      inv.on('change', listener);

      inv.add('wood', 2);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ wood: 2 });
    });

    it('fires on a successful spend, with the post-spend snapshot as payload', () => {
      const inv = new Inventory();
      inv.add('wood', 5);
      const listener = vi.fn();
      inv.on('change', listener);

      const ok = inv.spend({ wood: 2 });

      expect(ok).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ wood: 3 });
    });

    it('does not fire on a failed (unaffordable) spend', () => {
      const inv = new Inventory();
      inv.add('wood', 1);
      const listener = vi.fn();
      inv.on('change', listener);

      const ok = inv.spend({ wood: 2 });

      expect(ok).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
