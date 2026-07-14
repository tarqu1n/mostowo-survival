/**
 * Pure map-side walkability check (plan 018 step A5). `Walkability.cells` is the map's BASE
 * terrain passability only — it composites UNDER runtime obstacles (buildings, live nodes, decor
 * footprints); the runtime `isBlocked` closure ORs `mapBlocks` in alongside those (wired at plan
 * 018 step A11). Phaser-free, no side effects.
 */

import { getCell, isInside, type MapFile } from './mapFormat';

/** True when `(col,row)` (map-local tile coords) is outside the map (bounds or void, per
 *  `isInside`) OR its `Walkability.cells` entry is blocked (`1`). */
export function mapBlocks(map: MapFile, col: number, row: number): boolean {
  if (!isInside(map, col, row)) return true;
  return getCell(map.walkability.cells, col, row, map.meta.width) === 1;
}
