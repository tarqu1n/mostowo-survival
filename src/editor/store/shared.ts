/**
 * Store-internal shared helpers for the editor Zustand slices (plan 043 step 7). Not part of the
 * public `editorStore` surface except `paletteSlotRotationKey`, which the barrel re-exports. The
 * single `HistoryStack` instance lives here so every slice observes the same undo timeline.
 */
import { HistoryStack, type Command } from './history';
import type { MapFile } from '../../systems/mapFormat';
import type { CellChange } from '../paintOps';

// One history stack for the single editor document. Encapsulated here (not exported): the slices are
// the only things that mutate it; React/Phaser observe via `docRevision`/`canUndo`/`canRedo`.
export const history = new HistoryStack();

/** If `activeLayerId` no longer names a layer in `map` (deleted, or an undo removed it), fall back to
 *  the first layer, or `null` for an empty layer set. Called after every history-stack move so the
 *  active-layer selection never dangles. */
export function reconcileActiveLayer(
  map: MapFile | null,
  activeLayerId: string | null,
): string | null {
  if (!map) return null;
  if (activeLayerId && map.layers.some((l) => l.id === activeLayerId)) return activeLayerId;
  return map.layers[0]?.id ?? null;
}

/** Filters `ids` down to ones that still name an object in `map` — called after every history-stack
 *  move (mirrors `reconcileActiveLayer`) so `selectedObjectIds` never dangles on a deleted/undone
 *  object. Deliberately only DROPS stale ids; it never re-adds one (e.g. undoing a delete restores
 *  the object to `map.objects` but does not restore its prior selection — there's no stale reference
 *  to clean up in that direction). */
export function reconcileSelection(map: MapFile | null, ids: string[]): string[] {
  if (!map) return [];
  const existing = new Set(map.objects.map((o) => o.id));
  return ids.filter((id) => existing.has(id));
}

/** Falls back to `null` if `activeZoneId` no longer names a zone def (a delete, or an undo/redo that
 *  crossed a zone's creation/deletion) — called after every history-stack move (mirrors
 *  `reconcileActiveLayer`/`reconcileSelection`). This isn't just tidiness: `paintZoneLine`/`Rect`/
 *  `fillZoneFrom` paint the RAW `activeZoneId` value into `zones.cells` when `paint` is true, so a
 *  dangling id would let the zone tool write a cell value with no matching `zones.defs` entry —
 *  exactly what `parseMap`'s zone-id invariant rejects. */
export function reconcileActiveZone(
  map: MapFile | null,
  activeZoneId: number | null,
): number | null {
  if (!map || activeZoneId === null) return null;
  return map.zones.defs.some((z) => z.id === activeZoneId) ? activeZoneId : null;
}

/** Builds a plain `{index}->value` undoable Command from a pre-computed `CellChange` list — shared by
 *  every target-grid paint action (tile layers, walkability, zones; step 8 generalises the step-6
 *  tile-paint pipeline over "which cells array" rather than duplicating this do/undo pair per
 *  target). Shape painting does NOT use this directly — it needs the extra void-consistency cascade,
 *  see `buildShapeCommand`. Returns `null` (nothing to apply) when `changes` is empty. */
export function commandFromChanges(
  cells: number[],
  changes: CellChange[],
  value: number,
  strokeId?: string,
): Command | null {
  if (changes.length === 0) return null;
  return {
    strokeId,
    do: () => {
      for (const c of changes) cells[c.index] = value;
    },
    undo: () => {
      for (const c of changes) cells[c.index] = c.prev;
    },
  };
}

/** Stable key for the per-slot working-rotation memory (`paletteSlotRotations`). Scoped by palette +
 *  the slot's OWN identity (`assetId` + its stored/base rotation), so the same tile in two palettes
 *  remembers its angle independently and the key never shifts as the working rotation changes. */
export function paletteSlotRotationKey(
  paletteId: string | null,
  slot: { assetId: string; rotation?: number },
): string {
  return `${paletteId ?? ''}|${slot.assetId}#${slot.rotation ?? 0}`;
}
