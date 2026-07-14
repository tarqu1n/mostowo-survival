/**
 * Pure base-zone math (see plan 014 Context & decisions; plan 018 A8 made the zone spawn-anchored).
 * `Rect` is a rectangular tile-bounds region that base-only buildables (e.g. the campfire) may be
 * placed within. No Phaser imports, no module-level mutable state, no config import — callers supply
 * the rect — mirrors systems/daynight.ts.
 */

/** Inclusive tile-bounds rectangle (min/max cols+rows). */
export interface Rect {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

/** Whether tile (col, row) falls inside `rect`, inclusive of both min and max on each axis. */
export function isInBase(rect: Rect, col: number, row: number): boolean {
  return col >= rect.minCol && col <= rect.maxCol && row >= rect.minRow && row <= rect.maxRow;
}

/** `rect`'s bounds, copied — for outline rendering later. */
export function baseZoneTileRect(rect: Rect): Rect {
  return { ...rect };
}

/**
 * A `size.w`×`size.h` tile rect centred on `spawn` (plan 018 A8 — replaces the old fixed `BASE_ZONE`
 * const, which was an absolute rect unrelated to spawn). Centring convention: `min = spawn -
 * floor(size/2)`, `max = min + size - 1`, so the rect always spans exactly `size` tiles on each axis.
 * For an ODD size (our case — `BASE_ZONE_SIZE = {w:21,h:27}`) this puts `spawn` exactly on the middle
 * tile. For an EVEN size the extra tile falls on the min (top/left) side of spawn rather than the max
 * side — spawn is not perfectly centred, but consistently biased.
 */
export function baseZoneFromSpawn(
  spawn: { col: number; row: number },
  size: { w: number; h: number },
): Rect {
  const minCol = spawn.col - Math.floor(size.w / 2);
  const minRow = spawn.row - Math.floor(size.h / 2);
  return {
    minCol,
    maxCol: minCol + size.w - 1,
    minRow,
    maxRow: minRow + size.h - 1,
  };
}
