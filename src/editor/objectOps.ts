/**
 * Pure object-authoring helpers for the map editor (plan 014 step 7). NO Phaser/React imports —
 * Tier-1 vitest-able (`__tests__/objectOps.test.ts`), mirroring `paintOps.ts`'s posture.
 *
 * `objectFootprintCells` deliberately DUPLICATES `mapFormat.ts`'s private (unexported)
 * `objectFootprintCells` — that function isn't part of `mapFormat.ts`'s public API and this step's
 * scope is "no changes outside src/editor/", so the void-consistency check the editor needs to gate
 * placement/move/duplicate on has to live here instead. Keep this in lockstep with
 * `src/systems/mapFormat.ts`'s `objectFootprintCells` if that invariant ever changes — both compute
 * exactly the same tile cells for exactly the same reason (parseMap's void-consistency invariant).
 */

import { isInside, type MapFile, type MapObject } from '../systems/mapFormat';
import { type Command } from './store/history';

export interface Cell {
  col: number;
  row: number;
}

function rectCells(rect: { col: number; row: number; w: number; h: number }): Cell[] {
  const cells: Cell[] = [];
  for (let dr = 0; dr < rect.h; dr++) {
    for (let dc = 0; dc < rect.w; dc++) cells.push({ col: rect.col + dc, row: rect.row + dr });
  }
  return cells;
}

/** Every tile cell an object/portal occupies, in map-local tile coords — mirrors mapFormat.ts's
 *  private `objectFootprintCells` exactly (see module doc). Cosmetic decor (no `collision`) is
 *  anchored by its pixel position floored to a tile. */
export function objectFootprintCells(obj: MapObject, tileSize: number): Cell[] {
  switch (obj.kind) {
    case 'node':
      return [{ col: obj.col, row: obj.row }];
    case 'portal':
      return rectCells(obj.rect);
    case 'decor':
      return obj.collision
        ? rectCells(obj.collision)
        : [{ col: Math.floor(obj.x / tileSize), row: Math.floor(obj.y / tileSize) }];
  }
}

/** True if every footprint cell of `obj` is inside the map (in bounds AND not void) — matches
 *  `parseMap`'s void-consistency invariant. Editor placement/move/duplicate all gate on this so a
 *  saved map can never fail that invariant. */
export function footprintIsValid(map: MapFile, obj: MapObject): boolean {
  return objectFootprintCells(obj, map.meta.tileSize).every(({ col, row }) =>
    isInside(map, col, row),
  );
}

/** Next auto `<prefix>_NNNN` object id, scanning `map.objects` (+ optional `extraIds`, e.g. ids
 *  already minted earlier in the same batch — see `duplicateObjects`) for the max so ids never
 *  collide within one multi-object operation and never collide with re-added ids after deletes. */
export function nextObjectId(
  map: MapFile,
  prefix: string,
  extraIds: readonly string[] = [],
): string {
  let max = 0;
  const re = new RegExp(`^${prefix}_(\\d+)$`);
  for (const obj of map.objects) {
    const m = re.exec(obj.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  for (const id of extraIds) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}_${String(max + 1).padStart(4, '0')}`;
}

/** Bundles several `{do,undo}` op pairs into ONE `Command` — `do` runs them in order, `undo` reverses
 *  them in REVERSE order (so a later op's undo, which may assume an earlier op's effect, unwinds
 *  first). Used by the multi-object batch actions (rotate/flip/depth-bump) so selecting N objects and
 *  pressing e.g. "rotate +90" is one undo step, not N. */
export function batchCommand(ops: Array<{ do: () => void; undo: () => void }>): Command {
  return {
    do: () => {
      for (const op of ops) op.do();
    },
    undo: () => {
      for (let i = ops.length - 1; i >= 0; i--) ops[i].undo();
    },
  };
}
