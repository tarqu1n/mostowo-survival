import { describe, it, expect, vi } from 'vitest';
import { Equipment } from '../Equipment';

// Pure-system tests (no Phaser, plain Node) mirroring Inventory.test.ts: the equip-slot state
// machine — empty default loadout, equip/unequip/swap bookkeeping, and the brand's drain-to-destroy.

describe('Equipment', () => {
  it('defaults to an empty loadout (all three slots null)', () => {
    const eq = new Equipment();
    expect(eq.get('mainHand')).toBeNull();
    expect(eq.get('ranged')).toBeNull();
    expect(eq.get('offHand')).toBeNull();
    expect(eq.snapshot()).toEqual({ mainHand: null, ranged: null, offHand: null });
  });

  it('equip puts an item in a slot and emits change', () => {
    const eq = new Equipment();
    const onChange = vi.fn();
    eq.on('change', onChange);
    eq.equip('mainHand', 'sword');
    expect(eq.get('mainHand')).toEqual({ id: 'sword', durability: null });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(eq.snapshot());
  });

  it('equip carries a starting durability for a consumable', () => {
    const eq = new Equipment();
    eq.equip('offHand', 'brand', 100);
    expect(eq.get('offHand')).toEqual({ id: 'brand', durability: 100 });
  });

  it('get returns a copy — mutating it does not corrupt internal state', () => {
    const eq = new Equipment();
    eq.equip('offHand', 'brand', 100);
    const got = eq.get('offHand')!;
    got.durability = 5;
    expect(eq.get('offHand')!.durability).toBe(100);
  });

  it('unequip clears the slot, returns the removed item, and emits change', () => {
    const eq = new Equipment();
    eq.equip('ranged', 'bow');
    const onChange = vi.fn();
    eq.on('change', onChange);
    const removed = eq.unequip('ranged');
    expect(removed).toEqual({ id: 'bow', durability: null });
    expect(eq.get('ranged')).toBeNull();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('unequip on an empty slot is a no-op that returns null and does not emit', () => {
    const eq = new Equipment();
    const onChange = vi.fn();
    eq.on('change', onChange);
    expect(eq.unequip('mainHand')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('swap: equipping over an occupied slot overwrites it (caller restashes the old one)', () => {
    const eq = new Equipment();
    eq.equip('mainHand', 'sword');
    eq.equip('mainHand', 'cleaver');
    expect(eq.get('mainHand')).toEqual({ id: 'cleaver', durability: null });
  });

  it('slotOf finds an equipped item and returns null for an unequipped one', () => {
    const eq = new Equipment();
    eq.equip('offHand', 'brand', 100);
    expect(eq.slotOf('brand')).toBe('offHand');
    expect(eq.slotOf('sword')).toBeNull();
  });

  it('drain reduces durability and returns ok while the brand survives', () => {
    const eq = new Equipment();
    eq.equip('offHand', 'brand', 100);
    expect(eq.drain('offHand', 30)).toBe('ok');
    expect(eq.get('offHand')!.durability).toBe(70);
  });

  it('drain to 0 destroys the item, clears the slot, and returns destroyed', () => {
    const eq = new Equipment();
    eq.equip('offHand', 'brand', 10);
    const onChange = vi.fn();
    eq.on('change', onChange);
    expect(eq.drain('offHand', 10)).toBe('destroyed');
    expect(eq.get('offHand')).toBeNull();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('drain overshooting past 0 still destroys (no negative durability lingers)', () => {
    const eq = new Equipment();
    eq.equip('offHand', 'brand', 5);
    expect(eq.drain('offHand', 999)).toBe('destroyed');
    expect(eq.get('offHand')).toBeNull();
  });

  it('drain is a no-op on a permanent item (durability null), an empty slot, or amount<=0', () => {
    const eq = new Equipment();
    eq.equip('mainHand', 'sword'); // permanent
    expect(eq.drain('mainHand', 50)).toBe('ok');
    expect(eq.get('mainHand')).toEqual({ id: 'sword', durability: null });
    expect(eq.drain('ranged', 50)).toBe('ok'); // empty slot
    eq.equip('offHand', 'brand', 100);
    const onChange = vi.fn();
    eq.on('change', onChange);
    expect(eq.drain('offHand', 0)).toBe('ok'); // amount<=0
    expect(eq.get('offHand')!.durability).toBe(100);
    expect(onChange).not.toHaveBeenCalled();
  });
});
