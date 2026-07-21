import { history } from '../shared';
import { type Command } from '../history';
import type { MapPlacement, WorldLayout } from '../../../systems/worldLayout';
import type { EditorSlice, EditorState } from '../types';

const EMPTY_WORLD: WorldLayout = { schemaVersion: 1, placements: [] };

export const worldSlice: EditorSlice<
  Pick<
    EditorState,
    | 'world'
    | 'worldRevision'
    | 'worldDirty'
    | 'setWorld'
    | 'markWorldSaved'
    | 'applyWorldCommand'
    | 'addPlacement'
    | 'movePlacement'
    | 'removePlacement'
  >
> = (set, get) => ({
  world: EMPTY_WORLD,
  worldRevision: 0,
  worldDirty: false,
  setWorld: (world) =>
    set((s) => ({ world, worldDirty: false, worldRevision: s.worldRevision + 1 })),
  markWorldSaved: () => set({ worldDirty: false }),
  applyWorldCommand: (cmd) => {
    history.apply({ ...cmd, domain: 'world' });
    set((s) => ({
      worldDirty: true,
      worldRevision: s.worldRevision + 1,
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
    }));
  },
  // ---- world layout (step 9) ----
  // `world.placements` is mutated IN PLACE (the command closures capture the live array), exactly
  // like `map` is — so undo/redo restore it without replacing the `world` object reference. The
  // World tab mounts once for the app's lifetime (all tabs stay mounted, hidden via CSS) and seeds
  // `world` from disk exactly once via `setWorld`, so these captured references never go stale.

  addPlacement: (mapId, origin) => {
    const world = get().world;
    if (world.placements.some((p) => p.mapId === mapId)) return false;
    const placement: MapPlacement = { mapId, origin: { col: origin.col, row: origin.row } };
    const cmd: Command = {
      do: () => {
        world.placements.push(placement);
      },
      undo: () => {
        const i = world.placements.indexOf(placement);
        if (i >= 0) world.placements.splice(i, 1);
      },
    };
    get().applyWorldCommand(cmd);
    return true;
  },

  movePlacement: (mapId, origin, strokeId) => {
    const world = get().world;
    const placement = world.placements.find((p) => p.mapId === mapId);
    if (!placement) return false;
    if (placement.origin.col === origin.col && placement.origin.row === origin.row) return false;
    const prev = { col: placement.origin.col, row: placement.origin.row };
    const next = { col: origin.col, row: origin.row };
    const cmd: Command = {
      strokeId,
      do: () => {
        placement.origin = { ...next };
      },
      undo: () => {
        placement.origin = { ...prev };
      },
    };
    get().applyWorldCommand(cmd);
    return true;
  },

  removePlacement: (mapId) => {
    const world = get().world;
    const index = world.placements.findIndex((p) => p.mapId === mapId);
    if (index < 0) return false;
    const removed = world.placements[index];
    const cmd: Command = {
      do: () => {
        world.placements.splice(index, 1);
      },
      undo: () => {
        world.placements.splice(index, 0, removed);
      },
    };
    get().applyWorldCommand(cmd);
    return true;
  },
});
