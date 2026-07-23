/**
 * Item catalogue. Keyed by item id; add new items here, not in gameplay code.
 */

import type { ItemDef } from './types';

export const ITEMS: Record<string, ItemDef> = {
  wood: { id: 'wood', name: 'Wood', color: 0x8a5a2b, maxStack: 50, icon: 'wood.png' },
  stone: { id: 'stone', name: 'Stone', color: 0x8a8a8a, maxStack: 50, icon: 'stone.png' },
  // Edible (nutrition set) — foraged from the berry bush, eaten via the Wellbeing screen (plan 004).
  berries: {
    id: 'berries',
    name: 'Berries',
    color: 0x7a2f4a,
    maxStack: 50,
    icon: 'berries.png',
    nutrition: 25,
  },
  // Salvage set — scavenged from a wrecked tent via the "salvage" action (loot table on the
  // `salvagedTent` node). `cloth` is a crafting/repair material (inedible); `cannedFood` is edible
  // trail rations. Both placeholder icons are baked by `scripts/tent-art.mjs`.
  cloth: { id: 'cloth', name: 'Cloth', color: 0xc9ba9a, maxStack: 50, icon: 'cloth.png' },
  cannedFood: {
    id: 'cannedFood',
    name: 'Canned Food',
    color: 0xb85c33,
    maxStack: 50,
    icon: 'canned_food.png',
    nutrition: 40,
  },
};
