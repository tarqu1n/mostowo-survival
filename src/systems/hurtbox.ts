/**
 * Pure tile-space hurtbox helpers. A hurtbox is a creature's body extent in tiles for combat
 * *targeting* — distinct from its footprint (movement/occupancy), which is always the single feet
 * tile. Anchored at the feet tile, centred horizontally on the feet column and rising upward (lower
 * rows) to match how actors are drawn (feet at the bottom, body above). See `Hurtbox` in
 * `src/data/types.ts` for the size semantics; consumed by GameScene's Attack/Inspect/contact paths.
 */

import type { Hurtbox } from '../data/types';
import type { Cell } from './pathfind';

/** A single feet tile — the fallback when a combatant declares no hurtbox. */
export const DEFAULT_HURTBOX: Hurtbox = { width: 1, height: 1 };

/** Left/right column spread from the feet column (even widths extend one further right). */
function spread(width: number): { left: number; right: number } {
  return { left: Math.floor((width - 1) / 2), right: Math.ceil((width - 1) / 2) };
}

/** True if `target` lies within `box` anchored at `feet` (centred horizontally, rising upward). */
export function hurtboxContains(feet: Cell, box: Hurtbox, target: Cell): boolean {
  const { left, right } = spread(box.width);
  const dCol = target.col - feet.col;
  const dUp = feet.row - target.row; // north/up is positive
  return dCol >= -left && dCol <= right && dUp >= 0 && dUp <= box.height - 1;
}

/** Every tile `box` covers, anchored at `feet` (feet row down to `height-1` rows above). */
export function hurtboxTiles(feet: Cell, box: Hurtbox): Cell[] {
  const { left, right } = spread(box.width);
  const tiles: Cell[] = [];
  for (let dUp = 0; dUp < box.height; dUp++) {
    for (let dCol = -left; dCol <= right; dCol++) {
      tiles.push({ col: feet.col + dCol, row: feet.row - dUp });
    }
  }
  return tiles;
}
