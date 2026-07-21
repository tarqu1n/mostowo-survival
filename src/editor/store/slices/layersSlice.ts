import type { MapFile, TileLayer } from '../../../systems/mapFormat';
import { type Command } from '../history';
import type { EditorSlice, EditorState } from '../types';

/** Next auto `layer_NNNN` id — scans existing ids so re-adding after deletes never collides. */
function nextLayerId(map: MapFile): string {
  let max = 0;
  for (const layer of map.layers) {
    const m = /^layer_(\d+)$/.exec(layer.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `layer_${String(max + 1).padStart(4, '0')}`;
}

export const layersSlice: EditorSlice<
  Pick<
    EditorState,
    | 'activeLayerId'
    | 'hiddenLayerIds'
    | 'setActiveLayer'
    | 'toggleLayerVisibility'
    | 'addLayer'
    | 'renameLayer'
    | 'deleteLayer'
    | 'moveLayer'
    | 'toggleLayerOverhead'
  >
> = (set, get) => ({
  activeLayerId: null,
  hiddenLayerIds: [],
  setActiveLayer: (layerId) => set({ activeLayerId: layerId }),
  toggleLayerVisibility: (layerId) =>
    set((s): Partial<EditorState> => ({
      hiddenLayerIds: s.hiddenLayerIds.includes(layerId)
        ? s.hiddenLayerIds.filter((id) => id !== layerId)
        : [...s.hiddenLayerIds, layerId],
    })),
  // ---- layers ----

  addLayer: (name) => {
    const map = get().map;
    if (!map) return;
    const id = nextLayerId(map);
    const newLayer: TileLayer = {
      id,
      name: name?.trim() || 'New Layer',
      kind: 'tiles',
      overhead: false,
      cells: new Array<number>(map.meta.width * map.meta.height).fill(0),
    };
    const cmd: Command = {
      do: () => {
        map.layers.push(newLayer);
      },
      undo: () => {
        const i = map.layers.indexOf(newLayer);
        if (i >= 0) map.layers.splice(i, 1);
      },
    };
    get().applyCommand(cmd);
    set({ activeLayerId: id });
  },

  renameLayer: (layerId, name) => {
    const map = get().map;
    if (!map) return;
    const layer = map.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed === layer.name) return;
    const prev = layer.name;
    const cmd: Command = {
      do: () => {
        layer.name = trimmed;
      },
      undo: () => {
        layer.name = prev;
      },
    };
    get().applyCommand(cmd);
  },

  deleteLayer: (layerId) => {
    const map = get().map;
    if (!map) return;
    if (map.layers.length <= 1) return; // keep at least one layer to paint on
    const index = map.layers.findIndex((l) => l.id === layerId);
    if (index < 0) return;
    const [removed] = map.layers.slice(index, index + 1);
    const cmd: Command = {
      do: () => {
        map.layers.splice(index, 1);
      },
      undo: () => {
        map.layers.splice(index, 0, removed);
      },
    };
    get().applyCommand(cmd);
  },

  moveLayer: (layerId, direction) => {
    const map = get().map;
    if (!map) return;
    const index = map.layers.findIndex((l) => l.id === layerId);
    if (index < 0) return;
    const targetIndex = direction === 'forward' ? index + 1 : index - 1;
    if (targetIndex < 0 || targetIndex >= map.layers.length) return;
    const cmd: Command = {
      do: () => {
        const [l] = map.layers.splice(index, 1);
        map.layers.splice(targetIndex, 0, l);
      },
      undo: () => {
        const [l] = map.layers.splice(targetIndex, 1);
        map.layers.splice(index, 0, l);
      },
    };
    get().applyCommand(cmd);
  },

  toggleLayerOverhead: (layerId) => {
    const map = get().map;
    if (!map) return;
    const layer = map.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const prev = layer.overhead;
    const cmd: Command = {
      do: () => {
        layer.overhead = !prev;
      },
      undo: () => {
        layer.overhead = prev;
      },
    };
    get().applyCommand(cmd);
  },
});
