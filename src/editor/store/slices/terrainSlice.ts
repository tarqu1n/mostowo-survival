import { isInside } from '../../../systems/mapFormat';
import { findOrAppendPaletteIndex, floodFill, lineCells, rectCells } from '../../paintOps';
import { buildTerrainCommand, computeTerrainBake } from '../../terrainOps';
import type { Dims } from '../../../systems/autotile';
import type { EditorSlice, EditorState } from '../types';

export const terrainSlice: EditorSlice<
  Pick<
    EditorState,
    | 'terrainCatalog'
    | 'activeTerrainId'
    | 'setTerrainCatalog'
    | 'setActiveTerrainId'
    | 'paintTerrainLine'
    | 'fillTerrainFrom'
    | 'paintTerrainRect'
    | 'rebakeTerrainsForSave'
  >
> = (set, get) => ({
  terrainCatalog: null,
  activeTerrainId: null,
  setTerrainCatalog: (terrainCatalog) => set({ terrainCatalog }),
  setActiveTerrainId: (activeTerrainId) => set({ activeTerrainId }),
  // ---- terrain (step 10) ----
  // A terrain paint/erase always requires an armed terrain (`activeTerrainId`) — unlike the zone
  // tool's "erase clears regardless of which zone owned the cell", terrain sections are keyed by
  // (layerId, terrainId) so erasing needs to know WHICH section's mask/bake to touch, same as
  // painting does. Every path clears `pendingDirty` (forces EditorScene's full chunked-rebake
  // fallback) rather than narrowing to a chunk list: a terrain rebake's affected cells can span the
  // touched cell's whole 8-neighbour ring, potentially crossing a chunk boundary — see terrainOps.ts's
  // module doc for why the bake itself always sweeps the full mask regardless.

  paintTerrainLine: (fromCol, fromRow, toCol, toRow, strokeId, on) => {
    const { map, activeLayerId, activeTerrainId, terrainCatalog } = get();
    if (!map || !activeLayerId) return;
    if (activeTerrainId === null) {
      console.warn('[editor] terrain brush: no active terrain armed — pick one in the Library');
      return;
    }
    const layer = map.layers.find((l) => l.id === activeLayerId);
    const terrainDef = terrainCatalog?.terrains.find((t) => t.id === activeTerrainId);
    if (!layer || !terrainDef) return;
    const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
      isInside(map, col, row),
    );
    const cmd = buildTerrainCommand(map, layer, activeTerrainId, terrainDef, points, on);
    if (!cmd) return;
    cmd.strokeId = strokeId;
    set({ pendingDirty: null });
    get().applyCommand(cmd);
  },

  fillTerrainFrom: (col, row, on) => {
    const { map, activeLayerId, activeTerrainId, terrainCatalog } = get();
    if (!map || !activeLayerId) return;
    if (activeTerrainId === null) {
      console.warn('[editor] terrain fill: no active terrain armed — pick one in the Library');
      return;
    }
    const layer = map.layers.find((l) => l.id === activeLayerId);
    const terrainDef = terrainCatalog?.terrains.find((t) => t.id === activeTerrainId);
    if (!layer || !terrainDef) return;
    const width = map.meta.width;
    const height = map.meta.height;
    const section = map.terrain.find(
      (t) => t.layerId === activeLayerId && t.terrainId === activeTerrainId,
    );
    const baseCells = section ? section.cells : (new Array(width * height).fill(0) as number[]);
    const changes = floodFill(baseCells, width, height, col, row, on ? 1 : 0, (c, r) =>
      isInside(map, c, r),
    );
    if (changes.length === 0) return;
    const points = changes.map((c) => ({
      col: c.index % width,
      row: Math.floor(c.index / width),
    }));
    const cmd = buildTerrainCommand(map, layer, activeTerrainId, terrainDef, points, on);
    if (!cmd) return;
    set({ pendingDirty: null });
    get().applyCommand(cmd);
  },

  paintTerrainRect: (c0, r0, c1, r1, on) => {
    const { map, activeLayerId, activeTerrainId, terrainCatalog } = get();
    if (!map || !activeLayerId) return;
    if (activeTerrainId === null) {
      console.warn('[editor] terrain rect: no active terrain armed — pick one in the Library');
      return;
    }
    const layer = map.layers.find((l) => l.id === activeLayerId);
    const terrainDef = terrainCatalog?.terrains.find((t) => t.id === activeTerrainId);
    if (!layer || !terrainDef) return;
    const points = rectCells(c0, r0, c1, r1, (c, r) => isInside(map, c, r));
    const cmd = buildTerrainCommand(map, layer, activeTerrainId, terrainDef, points, on);
    if (!cmd) return;
    set({ pendingDirty: null });
    get().applyCommand(cmd);
  },

  rebakeTerrainsForSave: () => {
    const { map, terrainCatalog } = get();
    if (!map) return false;
    const dims: Dims = { cols: map.meta.width, rows: map.meta.height };
    let changed = false;
    for (const section of map.terrain) {
      const layer = map.layers.find((l) => l.id === section.layerId);
      if (!layer) continue; // orphaned section (its layer was deleted) — nothing to bake into
      const terrainDef = terrainCatalog?.terrains.find((t) => t.id === section.terrainId);
      if (!terrainDef) continue; // unknown terrain id (catalog not loaded, or a stale id) — skip, don't crash
      const resolveIndex = (frame: number): number =>
        findOrAppendPaletteIndex(
          map,
          terrainDef.pack,
          {
            kind: 'sheetFrame',
            sheet: terrainDef.sheet,
            frame,
          },
          0, // terrain autotile always bakes at angle 0 (brush-only rotation this plan)
        );
      const bakeChanges = computeTerrainBake(
        section.cells,
        dims,
        terrainDef.mapping,
        new Set(),
        layer.cells,
        resolveIndex,
      );
      for (const c of bakeChanges) layer.cells[c.index] = c.next;
      if (bakeChanges.length > 0) changed = true;
    }
    if (changed) set((s) => ({ docRevision: s.docRevision + 1, pendingDirty: null }));
    return changed;
  },
});
