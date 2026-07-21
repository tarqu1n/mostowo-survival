/**
 * Pure shape/void-cascade helpers for the map editor (plan 014 step 8). NO Phaser/React imports —
 * Tier-1 vitest-able (`__tests__/shapeOps.test.ts`), mirroring `paintOps.ts`/`objectOps.ts`'s posture.
 *
 * The shape tool paints `shape.cells` (0 = void, 1 = inside). Painting a cell to INSIDE is a plain
 * cell-value change — no side effects. Painting a cell to VOID must, in the SAME undoable command,
 * also zero that cell in every tile layer, zero its zone id, and remove any object/portal whose
 * footprint overlaps it — otherwise a subsequent save would violate `parseMap`'s void-consistency
 * invariant (see `src/systems/mapFormat.ts`'s module doc). `computeVoidCascade` is the pure
 * calculation of exactly what those side effects are, given the map's CURRENT (pre-edit) state and
 * the set of cells about to be newly voided; the editor store applies it and builds the undo pair.
 */

import { cellIndex, type MapFile } from '../systems/mapFormat';
import { objectFootprintCells } from './objectOps';
import { cellsToChanges } from './paintOps';
import { type Command } from './store/history';

/** One tile-layer cell that must be zeroed because its cell is being voided. */
export interface CascadeTileChange {
  layerIndex: number;
  index: number;
  prev: number;
}

/** One zone cell that must be zeroed because its cell is being voided. */
export interface CascadeZoneChange {
  index: number;
  prev: number;
}

export interface VoidCascade {
  tileChanges: CascadeTileChange[];
  zoneChanges: CascadeZoneChange[];
  /** Indices into `map.objects` (ASCENDING) of every object whose footprint overlaps a newly-voided
   *  cell — a whole object is removed if ANY of its footprint cells is being voided, never patched. */
  removedObjectIndices: number[];
}

/**
 * Computes every side-effect a void-paint must apply, given the map's state BEFORE the edit and the
 * flat row-major indices of the cells about to become void (i.e. cells whose shape value is
 * transitioning 1→0 — callers should only pass cells that are ACTUALLY changing, not the whole brush
 * stroke, so an already-void cell repainted void contributes no redundant cascade entries). Read-only
 * — does not mutate `map`. Only cells that currently hold a non-empty/non-zero value are included in
 * the result (skips a no-op zero-to-zero write), keeping the resulting command's changes minimal.
 */
export function computeVoidCascade(map: MapFile, voidedIndices: ReadonlySet<number>): VoidCascade {
  const width = map.meta.width;
  const tileChanges: CascadeTileChange[] = [];
  for (let layerIndex = 0; layerIndex < map.layers.length; layerIndex++) {
    const cells = map.layers[layerIndex].cells;
    for (const index of voidedIndices) {
      const prev = cells[index];
      if (prev !== 0) tileChanges.push({ layerIndex, index, prev });
    }
  }

  const zoneChanges: CascadeZoneChange[] = [];
  for (const index of voidedIndices) {
    const prev = map.zones.cells[index];
    if (prev !== 0) zoneChanges.push({ index, prev });
  }

  const removedObjectIndices: number[] = [];
  map.objects.forEach((obj, i) => {
    const overlaps = objectFootprintCells(obj, map.meta.tileSize).some(({ col, row }) =>
      voidedIndices.has(cellIndex(col, row, width)),
    );
    if (overlaps) removedObjectIndices.push(i);
  });

  return { tileChanges, zoneChanges, removedObjectIndices };
}

/**
 * Builds the ONE undoable command for a shape-paint operation touching `points` (already filtered to
 * `inBounds`). `inside=true` is a plain cell-set (no cascade). `inside=false` computes
 * `computeVoidCascade` for exactly the cells that are NEWLY voided (i.e. currently `1`, per the
 * pre-edit `shapeCellsBase`) and bundles the tile-layer/zone zeroing + object removal into the same
 * command. Materializes `map.shape` (absent ⇒ all-inside) on first write; `hadShapeBefore` lets undo
 * restore the exact prior absent/present state. Returns `null` if nothing would change.
 */
export function buildShapeCommand(
  map: MapFile,
  points: ReadonlyArray<{ col: number; row: number }>,
  inside: boolean,
): Command | null {
  const width = map.meta.width;
  const height = map.meta.height;
  const hadShapeBefore = !!map.shape;
  const shapeCellsBase = map.shape
    ? map.shape.cells
    : (new Array(width * height).fill(1) as number[]);
  const value = inside ? 1 : 0;
  const changes = cellsToChanges(shapeCellsBase, width, points, value);
  if (changes.length === 0) return null;

  const cascade = inside ? null : computeVoidCascade(map, new Set(changes.map((c) => c.index)));
  const removedObjects = cascade
    ? cascade.removedObjectIndices.map((index) => ({ index, obj: map.objects[index] }))
    : [];

  return {
    do: () => {
      if (!map.shape) map.shape = { cells: shapeCellsBase.slice() };
      for (const c of changes) map.shape.cells[c.index] = value;
      if (cascade) {
        for (const tc of cascade.tileChanges) map.layers[tc.layerIndex].cells[tc.index] = 0;
        for (const zc of cascade.zoneChanges) map.zones.cells[zc.index] = 0;
        for (let i = removedObjects.length - 1; i >= 0; i--) {
          map.objects.splice(removedObjects[i].index, 1);
        }
      }
    },
    undo: () => {
      if (cascade) {
        for (const { index, obj } of removedObjects) map.objects.splice(index, 0, obj);
        for (const zc of cascade.zoneChanges) map.zones.cells[zc.index] = zc.prev;
        for (const tc of cascade.tileChanges) map.layers[tc.layerIndex].cells[tc.index] = tc.prev;
      }
      if (map.shape) {
        for (const c of changes) map.shape.cells[c.index] = c.prev;
      }
      if (!hadShapeBefore) map.shape = undefined;
    },
  };
}
