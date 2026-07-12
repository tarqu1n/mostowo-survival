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
};
