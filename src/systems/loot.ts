/**
 * Loot tables — the pure, Phaser-free decision core for the "savage" action (scavenging a wrecked
 * tent for items from a predefined set, rather than a node's single fixed `yieldItemId`).
 *
 * A node whose def carries a {@link LootTable} rolls it per harvest hit instead of yielding one
 * fixed item: `rolls` independent weighted draws from `drops`, each granting a random quantity in
 * `[min, max]`. Kept pure over an injected `rng` (same `() => number` seam as `combat.ts`) so it's
 * unit-tested directly and stays deterministic in tests — see `systems/__tests__/loot.test.ts`.
 *
 * The authored JSON shape + validation live in `nodeDefs.ts` (`parseLootTable`, which also
 * cross-checks every `itemId` against `ITEMS`); this module is only the runtime roll.
 */

/** One entry in a loot table: an item and the quantity range a single draw of it grants. */
export interface LootDrop {
  /** Item id — cross-checked against `ITEMS` by `parseLootTable` (nodeDefs.ts). */
  readonly itemId: string;
  /** Inclusive minimum units this drop grants when picked (integer ≥ 1). */
  readonly min: number;
  /** Inclusive maximum units this drop grants when picked (integer ≥ min). */
  readonly max: number;
  /** Relative pick weight against the other drops (positive; mirrors `pickWeighted` in tileset.ts). */
  readonly weight: number;
}

/** A predefined item set a node hands out per harvest hit. `rolls` = how many independent weighted
 *  draws happen (so a single savage of a tent can grant several stacks). */
export interface LootTable {
  /** Independent weighted draws per harvest hit (integer ≥ 1). */
  readonly rolls: number;
  /** The predefined set drawn from; non-empty (enforced by `parseLootTable`). */
  readonly drops: readonly LootDrop[];
}

/** One granted stack from a roll. Callers credit these into an inventory (`inv.add(itemId, qty)`). */
export interface LootResult {
  readonly itemId: string;
  readonly qty: number;
}

/** Pick one drop by weight. `rng()` is expected in `[0, 1)`. Assumes a non-empty table with
 *  positive weights (guaranteed by `parseLootTable`); falls back to the last drop for a `rng` that
 *  returns exactly 1 (out of contract) rather than returning undefined. */
function pickDrop(drops: readonly LootDrop[], rng: () => number): LootDrop {
  const total = drops.reduce((sum, d) => sum + d.weight, 0);
  let roll = rng() * total;
  for (const d of drops) {
    roll -= d.weight;
    if (roll < 0) return d;
  }
  return drops[drops.length - 1];
}

/**
 * Roll a loot table into a list of granted stacks — `table.rolls` independent weighted draws, each
 * a quantity in its drop's `[min, max]` (inclusive). Same-item draws are MERGED into one stack so
 * the caller makes one `inv.add` per distinct item (and the result reads cleanly in tests/logs).
 * Pure over `rng` (defaults to `Math.random`, like `combat.ts`).
 */
export function rollLoot(table: LootTable, rng: () => number = Math.random): LootResult[] {
  const byItem = new Map<string, number>();
  for (let i = 0; i < table.rolls; i++) {
    const drop = pickDrop(table.drops, rng);
    const span = drop.max - drop.min + 1;
    const qty = drop.min + Math.floor(rng() * span);
    byItem.set(drop.itemId, (byItem.get(drop.itemId) ?? 0) + qty);
  }
  return [...byItem].map(([itemId, qty]) => ({ itemId, qty }));
}
