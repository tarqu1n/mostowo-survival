import { ITEMS } from '@/data/items';
import { EQUIP_SLOTS, type EquipmentState } from '@/systems/Equipment';

/**
 * Presentational read-model for the equip UX (plan 049 Step 4), shared by the toolbar (`Hotbar`) and
 * the pack (`PackDrawer`) so the two never drift. Pure — no store/React deps; the components pass in
 * the mirrored `equipment` snapshot.
 */
export interface EquipView {
  /** True iff item `id` is currently worn in some slot (drives the yellow outline). */
  equipped: boolean;
  /** For an equipped consumable, its durability as a 0..1 fraction of its starting charge; `null` for a
   *  permanent item (bow/sword) or when the item isn't equipped (no bar drawn). */
  durabilityFrac: number | null;
}

const NONE: EquipView = { equipped: false, durabilityFrac: null };

/** Resolve how item `id` should render given the current {@link EquipmentState}. */
export function equipViewOf(equipment: EquipmentState, id: string): EquipView {
  for (const slot of EQUIP_SLOTS) {
    const worn = equipment[slot];
    if (worn?.id !== id) continue;
    const max = ITEMS[id]?.durability;
    // A permanent item (or a data gap) has no bar; a consumable clamps to 0..1 of its starting charge.
    const durabilityFrac =
      worn.durability !== null && max ? Math.max(0, Math.min(1, worn.durability / max)) : null;
    return { equipped: true, durabilityFrac };
  }
  return NONE;
}

/** True iff item `id` is equippable (has a declared `equip` slot) — the tap-to-toggle gate. */
export function isEquippable(id: string): boolean {
  return ITEMS[id]?.equip != null;
}
