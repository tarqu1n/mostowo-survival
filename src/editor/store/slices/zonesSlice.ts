import { isInside, type ZoneDef } from '../../../systems/mapFormat';
import { cellsToChanges, floodFill, lineCells, rectCells, type CellChange } from '../../paintOps';
import { defaultZoneColour, nextFreeZoneId } from '../../zoneOps';
import { commandFromChanges } from '../shared';
import { type Command } from '../history';
import type { EditorSlice, EditorState } from '../types';

export const zonesSlice: EditorSlice<
  Pick<
    EditorState,
    | 'activeZoneId'
    | 'setActiveZoneId'
    | 'createZone'
    | 'renameZone'
    | 'recolourZone'
    | 'deleteZone'
    | 'paintZoneLine'
    | 'fillZoneFrom'
    | 'paintZoneRect'
  >
> = (set, get) => ({
  activeZoneId: null,
  setActiveZoneId: (activeZoneId) => set({ activeZoneId }),
  // ---- zones (step 8) ----

  createZone: () => {
    const map = get().map;
    if (!map) return null;
    const id = nextFreeZoneId(map.zones.defs);
    if (id === null) {
      console.warn('[editor] cannot create zone — id space exhausted (255 zones)');
      return null;
    }
    const def: ZoneDef = {
      id,
      name: `Zone ${id}`,
      colour: defaultZoneColour(map.zones.defs.length),
      favourites: [],
    };
    const cmd: Command = {
      do: () => {
        map.zones.defs.push(def);
      },
      undo: () => {
        const i = map.zones.defs.indexOf(def);
        if (i >= 0) map.zones.defs.splice(i, 1);
      },
    };
    get().applyCommand(cmd);
    set({ activeZoneId: id });
    return id;
  },

  renameZone: (id, name) => {
    const map = get().map;
    if (!map) return;
    const def = map.zones.defs.find((z) => z.id === id);
    if (!def) return;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed === def.name) return;
    const prev = def.name;
    const cmd: Command = {
      do: () => {
        def.name = trimmed;
      },
      undo: () => {
        def.name = prev;
      },
    };
    get().applyCommand(cmd);
  },

  recolourZone: (id, colour) => {
    const map = get().map;
    if (!map) return;
    const def = map.zones.defs.find((z) => z.id === id);
    if (!def || def.colour === colour) return;
    const prev = def.colour;
    const cmd: Command = {
      do: () => {
        def.colour = colour;
      },
      undo: () => {
        def.colour = prev;
      },
    };
    get().applyCommand(cmd);
  },

  deleteZone: (id) => {
    const map = get().map;
    if (!map) return;
    const defIndex = map.zones.defs.findIndex((z) => z.id === id);
    if (defIndex < 0) return;
    const removedDef = map.zones.defs[defIndex];
    const cellChanges: CellChange[] = [];
    map.zones.cells.forEach((v, index) => {
      if (v === id) cellChanges.push({ index, prev: v });
    });
    const cmd: Command = {
      do: () => {
        map.zones.defs.splice(defIndex, 1);
        for (const c of cellChanges) map.zones.cells[c.index] = 0;
      },
      undo: () => {
        map.zones.defs.splice(defIndex, 0, removedDef);
        for (const c of cellChanges) map.zones.cells[c.index] = c.prev;
      },
    };
    // `applyCommand` reconciles `activeZoneId` to `null` automatically if it pointed at the
    // just-removed def (see `reconcileActiveZone`) — no separate deselect step needed here.
    get().applyCommand(cmd);
  },

  paintZoneLine: (fromCol, fromRow, toCol, toRow, strokeId, paint) => {
    const { map, activeZoneId } = get();
    if (!map) return;
    if (paint && activeZoneId === null) {
      console.warn('[editor] zone brush: no active zone selected — arm one in the Zones panel');
      return;
    }
    const value = paint ? (activeZoneId as number) : 0;
    const points = lineCells(fromCol, fromRow, toCol, toRow).filter(({ col, row }) =>
      isInside(map, col, row),
    );
    const changes = cellsToChanges(map.zones.cells, map.meta.width, points, value);
    const cmd = commandFromChanges(map.zones.cells, changes, value, strokeId);
    if (!cmd) return;
    set({ pendingDirty: { layerIndex: 0, chunks: [] } });
    get().applyCommand(cmd);
  },

  fillZoneFrom: (col, row, paint) => {
    const { map, activeZoneId } = get();
    if (!map) return;
    if (paint && activeZoneId === null) {
      console.warn('[editor] zone fill: no active zone selected — arm one in the Zones panel');
      return;
    }
    const value = paint ? (activeZoneId as number) : 0;
    const changes = floodFill(
      map.zones.cells,
      map.meta.width,
      map.meta.height,
      col,
      row,
      value,
      (c, r) => isInside(map, c, r),
    );
    const cmd = commandFromChanges(map.zones.cells, changes, value);
    if (!cmd) return;
    set({ pendingDirty: { layerIndex: 0, chunks: [] } });
    get().applyCommand(cmd);
  },

  paintZoneRect: (c0, r0, c1, r1, paint) => {
    const { map, activeZoneId } = get();
    if (!map) return;
    if (paint && activeZoneId === null) {
      console.warn('[editor] zone rect: no active zone selected — arm one in the Zones panel');
      return;
    }
    const value = paint ? (activeZoneId as number) : 0;
    const points = rectCells(c0, r0, c1, r1, (c, r) => isInside(map, c, r));
    const changes = cellsToChanges(map.zones.cells, map.meta.width, points, value);
    const cmd = commandFromChanges(map.zones.cells, changes, value);
    if (!cmd) return;
    set({ pendingDirty: { layerIndex: 0, chunks: [] } });
    get().applyCommand(cmd);
  },
});
