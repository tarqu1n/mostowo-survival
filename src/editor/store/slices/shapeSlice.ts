import { floodFill, lineCells, rectCells } from '../../paintOps';
import { buildShapeCommand } from '../../shapeOps';
import type { MapFile } from '../../../systems/mapFormat';
import type { EditorSlice, EditorState } from '../types';

/** In-bounds check that deliberately ignores the shape mask — used ONLY by the shape tool itself
 *  (painting the mask can't be gated by the mask it's editing; every other paint tool gates on the
 *  real `isInside`, which DOES respect it). */
function inBounds(map: MapFile, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < map.meta.width && row < map.meta.height;
}

export const shapeSlice: EditorSlice<
  Pick<EditorState, 'paintShapeLine' | 'fillShapeFrom' | 'paintShapeRect'>
> = (set, get) => ({
  // ---- shape (step 8) ----
  // Deliberately NOT gated by `isInside` — see `buildShapeCommand`'s doc. A shape edit can touch
  // every tile layer at once (the void cascade), so it explicitly clears `pendingDirty` to force
  // `onDocEdited`'s full chunked rebake fallback rather than narrowing to one layer.

  paintShapeLine: (fromCol, fromRow, toCol, toRow, strokeId, inside) => {
    const map = get().map;
    if (!map) return;
    const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
      inBounds(map, col, row),
    );
    const cmd = buildShapeCommand(map, points, inside);
    if (!cmd) return;
    cmd.strokeId = strokeId;
    set({ pendingDirty: null });
    get().applyCommand(cmd);
  },

  fillShapeFrom: (col, row, inside) => {
    const map = get().map;
    if (!map) return;
    // Flood fill bounded only by map bounds (not the mask it's editing) — matches every other
    // shape operation's `inBounds` gate.
    const width = map.meta.width;
    const height = map.meta.height;
    const baseCells = map.shape ? map.shape.cells : (new Array(width * height).fill(1) as number[]);
    const changes = floodFill(baseCells, width, height, col, row, inside ? 1 : 0, () => true);
    if (changes.length === 0) return;
    const points = changes.map((c) => ({
      col: c.index % width,
      row: Math.floor(c.index / width),
    }));
    const cmd = buildShapeCommand(map, points, inside);
    if (!cmd) return;
    set({ pendingDirty: null });
    get().applyCommand(cmd);
  },

  paintShapeRect: (c0, r0, c1, r1, inside) => {
    const map = get().map;
    if (!map) return;
    const points = rectCells(c0, r0, c1, r1, (c, r) => inBounds(map, c, r));
    const cmd = buildShapeCommand(map, points, inside);
    if (!cmd) return;
    set({ pendingDirty: null });
    get().applyCommand(cmd);
  },
});
