import { isInside } from '../../../systems/mapFormat';
import { cellsToChanges, floodFill, lineCells, rectCells } from '../../paintOps';
import { commandFromChanges } from '../shared';
import type { EditorSlice, EditorState } from '../types';

export const walkabilitySlice: EditorSlice<
  Pick<EditorState, 'paintWalkabilityLine' | 'fillWalkabilityFrom' | 'paintWalkabilityRect'>
> = (set, get) => ({
  // ---- collision / walkability (step 8) ----
  // Base-terrain passability only, gated by the shape mask like every other paint tool. No tile
  // layer is touched, so there's nothing to rebake — `pendingDirty: { layerIndex: 0, chunks: [] }`
  // reuses the existing narrow-rebake signal to mean "rebake nothing" (an empty chunk list is a
  // no-op loop in `EditorScene.onDocEdited`) instead of falling back to a full, pointless retile.

  paintWalkabilityLine: (fromCol, fromRow, toCol, toRow, strokeId, blocked) => {
    const map = get().map;
    if (!map) return;
    const value = blocked ? 1 : 0;
    const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
      isInside(map, col, row),
    );
    const changes = cellsToChanges(map.walkability.cells, map.meta.width, points, value);
    const cmd = commandFromChanges(map.walkability.cells, changes, value, strokeId);
    if (!cmd) return;
    set({ pendingDirty: { layerIndex: 0, chunks: [] } });
    get().applyCommand(cmd);
  },

  fillWalkabilityFrom: (col, row, blocked) => {
    const map = get().map;
    if (!map) return;
    const value = blocked ? 1 : 0;
    const changes = floodFill(
      map.walkability.cells,
      map.meta.width,
      map.meta.height,
      col,
      row,
      value,
      (c, r) => isInside(map, c, r),
    );
    const cmd = commandFromChanges(map.walkability.cells, changes, value);
    if (!cmd) return;
    set({ pendingDirty: { layerIndex: 0, chunks: [] } });
    get().applyCommand(cmd);
  },

  paintWalkabilityRect: (c0, r0, c1, r1, blocked) => {
    const map = get().map;
    if (!map) return;
    const value = blocked ? 1 : 0;
    const points = rectCells(c0, r0, c1, r1, (c, r) => isInside(map, c, r));
    const changes = cellsToChanges(map.walkability.cells, map.meta.width, points, value);
    const cmd = commandFromChanges(map.walkability.cells, changes, value);
    if (!cmd) return;
    set({ pendingDirty: { layerIndex: 0, chunks: [] } });
    get().applyCommand(cmd);
  },
});
