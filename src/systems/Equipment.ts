import { EventEmitter } from 'eventemitter3';
import type { EquipSlot } from '../data/types';

/** One equipped item. `durability` is `null` for a permanent equippable (bow/sword), a number for a
 *  consumable that drains while equipped (the brand). `null` slot = nothing equipped there. */
export type EquippedItem = { id: string; durability: number | null };

/** The full three-slot loadout: every {@link EquipSlot} maps to an {@link EquippedItem} or `null`. */
export type EquipmentState = Record<EquipSlot, EquippedItem | null>;

/** The three equip slots, in HUD display order. Single source for iteration/reset. */
export const EQUIP_SLOTS: readonly EquipSlot[] = ['mainHand', 'ranged', 'offHand'];

/** Result of {@link Equipment.drain}: `'ok'` if the slot survives, `'destroyed'` if it hit 0 and cleared. */
export type DrainResult = 'ok' | 'destroyed';

/**
 * The player's three equip slots (plan 049): `mainHand` (melee), `ranged` (bow gate), `offHand`
 * (brand). Pure world logic, no scene deps — mirrors {@link Inventory} exactly: extends `eventemitter3`
 * directly (imports no Phaser, stays plain-Node testable) and emits `'change'` (payload:
 * {@link snapshot}) after any real mutation so the HUD reacts without polling.
 *
 * Data-agnostic on purpose: it does NOT import the item catalogue, so it cannot check that an item's
 * declared `equip` slot matches the slot it's put in — the caller (the scene equip-toggle) owns that,
 * plus the bag↔slot bookkeeping (spend/add on equip, restash-or-discard on unequip). This class only
 * owns *which id + how much durability* sits in each slot. The default loadout is **all empty**
 * (unarmed melee, no ranged, empty off hand).
 */
export class Equipment extends EventEmitter {
  private readonly slots: EquipmentState = { mainHand: null, ranged: null, offHand: null };

  /** The item in `slot`, or `null`. Returns a copy — mutating it won't touch internal state. */
  get(slot: EquipSlot): EquippedItem | null {
    const item = this.slots[slot];
    return item ? { ...item } : null;
  }

  /**
   * Put item `id` in `slot` with optional starting `durability` (omit/`null` = permanent). Overwrites
   * whatever was there (the caller restashes the old item first). Always emits `'change'`.
   */
  equip(slot: EquipSlot, id: string, durability: number | null = null): void {
    this.slots[slot] = { id, durability };
    this.emit('change', this.snapshot());
  }

  /** Clear `slot`, returning the item that was there (or `null`). Emits `'change'` only if it held one. */
  unequip(slot: EquipSlot): EquippedItem | null {
    const removed = this.slots[slot];
    if (!removed) return null;
    this.slots[slot] = null;
    this.emit('change', this.snapshot());
    return removed;
  }

  /**
   * Deplete the durability of the item in `slot` by `amount`. No-op returning `'ok'` if the slot is
   * empty or holds a permanent item (`durability === null`). At/below 0 the slot is cleared and
   * `'destroyed'` is returned. Emits `'change'` on any real mutation.
   *
   * Called per-frame (plan 049 Step 6): it emits every drain so a HUD bar can animate, so callers that
   * forward to the (React) store should throttle that forward — the scene owns that, not this class.
   */
  drain(slot: EquipSlot, amount: number): DrainResult {
    const item = this.slots[slot];
    if (!item || item.durability === null || amount <= 0) return 'ok';
    item.durability -= amount;
    if (item.durability <= 0) {
      this.slots[slot] = null;
      this.emit('change', this.snapshot());
      return 'destroyed';
    }
    this.emit('change', this.snapshot());
    return 'ok';
  }

  /** The slot currently holding item `id`, or `null` if it isn't equipped anywhere. */
  slotOf(id: string): EquipSlot | null {
    for (const slot of EQUIP_SLOTS) {
      if (this.slots[slot]?.id === id) return slot;
    }
    return null;
  }

  /** Plain-object copy of the full loadout (safe to hand to listeners / mirror into the store). */
  snapshot(): EquipmentState {
    return {
      mainHand: this.slots.mainHand ? { ...this.slots.mainHand } : null,
      ranged: this.slots.ranged ? { ...this.slots.ranged } : null,
      offHand: this.slots.offHand ? { ...this.slots.offHand } : null,
    };
  }
}
