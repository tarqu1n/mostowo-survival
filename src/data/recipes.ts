/**
 * Recipe catalogue (plan 048). Keyed by recipe id; add new craftable recipes here, not in gameplay
 * code — mirrors ITEMS/BUILDABLES. Each entry is crafted at a `station` buildable from a `cost` of
 * consumed items into a single `output` item/qty. No consumer yet: the `craft` worker order that
 * reads RECIPES lands in Step 6 — this module is data + validation only (see
 * `__tests__/data.test.ts`, which cross-checks every cost/output id against ITEMS and every
 * station against BUILDABLES, the same pattern already used for ITEMS/BUILDABLES/NODES).
 *
 * All three recipes craft at the `workbench` and reuse `CRAFT_BASE_MS` (config.ts) as their base
 * work-time — none is clearly slower/faster than the others yet, so a shared baseline keeps the
 * data simple until playtest says otherwise.
 */

import type { RecipeDef } from './types';
import { CRAFT_BASE_MS } from '../config';

export const RECIPES: Record<string, RecipeDef> = {
  brand: {
    id: 'brand',
    name: 'Brand',
    station: 'workbench',
    cost: { wood: 1, cloth: 1 },
    output: { itemId: 'brand', count: 1 },
    craftMs: CRAFT_BASE_MS,
  },
  bow: {
    id: 'bow',
    name: 'Bow',
    station: 'workbench',
    cost: { rope: 2, wood: 2 },
    output: { itemId: 'bow', count: 1 },
    craftMs: CRAFT_BASE_MS,
  },
  sword: {
    id: 'sword',
    name: 'Sword',
    station: 'workbench',
    cost: { wood: 2, stone: 1 },
    output: { itemId: 'sword', count: 1 },
    craftMs: CRAFT_BASE_MS,
  },
};
