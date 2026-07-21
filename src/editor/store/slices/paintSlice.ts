import { isInside, type MapFile } from '../../../systems/mapFormat';
import { GROUND_CHUNK_ROWS } from '../../../config';
import {
  cellsToChanges,
  findOrAppendPaletteIndex,
  floodFill,
  lineCells,
  rectCells,
} from '../../paintOps';
import { parseAssetId } from '../../textureLoading';
import type { TileSource } from '../../../data/tileset';
import { commandFromChanges } from '../shared';
import type { EditorSlice, EditorState } from '../types';

/** Resolve the current `brushAsset` (a catalog id, optionally `#frame`) to a palette index in `map`,
 *  find-or-appending as needed (mutates `map.palette` directly — NOT part of the undo/redo history,
 *  see `findOrAppendPaletteIndex`'s doc). `rotation` (deg, default 0) selects a distinct palette slot
 *  for a rotated tile. No brush selected, or a malformed asset id, resolves to `0` (empty) — callers
 *  gate brush/rect on a brush being set in the UI; this is just a safe fallback. */
function resolveBrushValue(
  map: MapFile,
  brushAsset: string | null,
  rotation: 0 | 90 | 180 | 270 = 0,
): number {
  if (!brushAsset) return 0;
  try {
    const { pack, path, frame } = parseAssetId(brushAsset);
    const source: TileSource =
      frame === undefined ? { kind: 'image', path } : { kind: 'sheetFrame', sheet: path, frame };
    return findOrAppendPaletteIndex(map, pack, source, rotation);
  } catch (e) {
    console.warn(`[editor] invalid brushAsset "${brushAsset}": ${(e as Error).message}`);
    return 0;
  }
}

export const paintSlice: EditorSlice<
  Pick<EditorState, 'paintLine' | 'eraseLine' | 'fillFrom' | 'paintRectArea'>
> = (set, get) => ({
  // ---- painting ----

  paintLine: (fromCol, fromRow, toCol, toRow, strokeId) => {
    const { map, activeLayerId, brushAsset, brushRotation } = get();
    if (!map || !activeLayerId) return;
    const layerIndex = map.layers.findIndex((l) => l.id === activeLayerId);
    const layer = map.layers[layerIndex];
    if (!layer) return;
    // Brush gesture carries the pending rotation; fill/rect stay angle-0 this plan.
    const value = resolveBrushValue(map, brushAsset, brushRotation);
    const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
      isInside(map, col, row),
    );
    const changes = cellsToChanges(layer.cells, map.meta.width, points, value);
    const cmd = commandFromChanges(layer.cells, changes, value, strokeId);
    if (!cmd) return;
    const chunks = [...new Set(points.map(({ row }) => Math.floor(row / GROUND_CHUNK_ROWS)))];
    set({ pendingDirty: { layerIndex, chunks } });
    get().applyCommand(cmd);
  },

  eraseLine: (fromCol, fromRow, toCol, toRow, strokeId) => {
    const { map, activeLayerId } = get();
    if (!map || !activeLayerId) return;
    const layerIndex = map.layers.findIndex((l) => l.id === activeLayerId);
    const layer = map.layers[layerIndex];
    if (!layer) return;
    const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
      isInside(map, col, row),
    );
    const changes = cellsToChanges(layer.cells, map.meta.width, points, 0);
    const cmd = commandFromChanges(layer.cells, changes, 0, strokeId);
    if (!cmd) return;
    const chunks = [...new Set(points.map(({ row }) => Math.floor(row / GROUND_CHUNK_ROWS)))];
    set({ pendingDirty: { layerIndex, chunks } });
    get().applyCommand(cmd);
  },

  fillFrom: (col, row) => {
    const { map, activeLayerId, brushAsset } = get();
    if (!map || !activeLayerId) return;
    const layerIndex = map.layers.findIndex((l) => l.id === activeLayerId);
    const layer = map.layers[layerIndex];
    if (!layer) return;
    const value = resolveBrushValue(map, brushAsset, 0); // fill stays angle-0 (brush-only rotation this plan)
    const changes = floodFill(
      layer.cells,
      map.meta.width,
      map.meta.height,
      col,
      row,
      value,
      (c, r) => isInside(map, c, r),
    );
    const cmd = commandFromChanges(layer.cells, changes, value);
    if (!cmd) return;
    const width = map.meta.width;
    const chunks = [
      ...new Set(changes.map((c) => Math.floor(Math.floor(c.index / width) / GROUND_CHUNK_ROWS))),
    ];
    set({ pendingDirty: { layerIndex, chunks } });
    get().applyCommand(cmd);
  },

  paintRectArea: (c0, r0, c1, r1) => {
    const { map, activeLayerId, brushAsset } = get();
    if (!map || !activeLayerId) return;
    const layerIndex = map.layers.findIndex((l) => l.id === activeLayerId);
    const layer = map.layers[layerIndex];
    if (!layer) return;
    const value = resolveBrushValue(map, brushAsset, 0); // rect stays angle-0 (brush-only rotation this plan)
    const points = rectCells(c0, r0, c1, r1, (c, r) => isInside(map, c, r));
    const changes = cellsToChanges(layer.cells, map.meta.width, points, value);
    const cmd = commandFromChanges(layer.cells, changes, value);
    if (!cmd) return;
    const chunks = [...new Set(points.map(({ row }) => Math.floor(row / GROUND_CHUNK_ROWS)))];
    set({ pendingDirty: { layerIndex, chunks } });
    get().applyCommand(cmd);
  },
});
