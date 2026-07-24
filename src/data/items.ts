/**
 * Item catalogue. Keyed by item id; add new items here, not in gameplay code.
 */

import { BRAND_DURABILITY } from '../config';
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
  // trail rations. Icons are Gemini-generated (scripts/gen-icons/), keyed `<id>.png` like the rest.
  cloth: { id: 'cloth', name: 'Cloth', color: 0xc9ba9a, maxStack: 50, icon: 'cloth.png' },
  cannedFood: {
    id: 'cannedFood',
    name: 'Canned Food',
    color: 0xb85c33,
    maxStack: 50,
    icon: 'cannedFood.png',
    nutrition: 40,
  },
  // Rope — a new salvage material (added to the salvagedTent loot table, plan 048 Step 1), inedible
  // like wood/stone. Feeds the `bow` recipe (Step 5).
  rope: { id: 'rope', name: 'Rope', color: 0xb5966a, maxStack: 50, icon: 'rope.png' },
  // Craftable recipe OUTPUTS (plan 048), now equippable (plan 049). Each is a single held tool/weapon
  // (`maxStack: 1`). `equip` marks the slot; the brand also carries `durability` — a consumable that
  // depletes in real time while equipped and is destroyed at 0 (bow/sword are permanent, no durability).
  brand: {
    id: 'brand',
    name: 'Brand',
    color: 0xd9822b,
    maxStack: 1,
    icon: 'brand.png',
    equip: 'offHand',
    durability: BRAND_DURABILITY,
  },
  bow: { id: 'bow', name: 'Bow', color: 0x8a5a2b, maxStack: 1, icon: 'bow.png', equip: 'ranged' },
  sword: {
    id: 'sword',
    name: 'Sword',
    color: 0xaab0b8,
    maxStack: 1,
    icon: 'sword.png',
    equip: 'mainHand',
  },
};
