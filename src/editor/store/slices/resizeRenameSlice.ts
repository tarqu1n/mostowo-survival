import { applyResize, planResize } from '../../../systems/mapFormat';
import { toast } from 'sonner';
import { deleteSettings, getSettings, putSettings } from '../../underlayStore';
import {
  deleteBrowse,
  deleteRecents,
  getBrowse,
  getRecents,
  putBrowse,
  putRecents,
} from '../../libraryViewStore';
import { clearCamera, getCamera, getLast, putCamera, putLast } from '../../sessionStore';
import { history, reconcileActiveLayer, reconcileSelection, reconcileActiveZone } from '../shared';
import { type Command } from '../history';
import type { EditorSlice, EditorState } from '../types';

export const resizeRenameSlice: EditorSlice<Pick<EditorState, 'resizeMap' | 'renameMapState'>> = (
  set,
  get,
) => ({
  // ---- resize (plan 024 step 2) ----

  resizeMap: (edges) => {
    const { map, mapId, world } = get();
    if (!map || !mapId) return false;
    const plan = planResize(map, edges);
    if (!plan.dimsValid || plan.offendingObjectIds.length > 0) return false;
    const { dLeft, dTop } = plan;
    const resized = applyResize(map, edges);

    // Capture prior array/ref state (mirrors `buildShapeCommand`'s captured-prior-reference style)
    // so `undo` is a cheap reference-restore, never a re-derivation.
    const oldState = {
      width: map.meta.width,
      height: map.meta.height,
      shape: map.shape,
      layerCells: map.layers.map((l) => l.cells),
      terrainCells: map.terrain.map((t) => t.cells),
      walk: map.walkability.cells,
      zones: map.zones.cells,
      objects: map.objects,
    };
    const newState = {
      width: resized.meta.width,
      height: resized.meta.height,
      shape: resized.shape,
      layerCells: resized.layers.map((l) => l.cells),
      terrainCells: resized.terrain.map((t) => t.cells),
      walk: resized.walkability.cells,
      zones: resized.zones.cells,
      objects: resized.objects,
    };
    const applyState = (st: typeof oldState): void => {
      map.meta.width = st.width;
      map.meta.height = st.height;
      map.shape = st.shape;
      map.layers.forEach((l, i) => {
        l.cells = st.layerCells[i];
      });
      map.terrain.forEach((t, i) => {
        t.cells = st.terrainCells[i];
      });
      map.walkability.cells = st.walk;
      map.zones.cells = st.zones;
      map.objects = st.objects;
    };

    // Underlay: shift the PERSISTED offset (not the live cache — `syncUnderlayFromSettings` picks
    // that up after `applyCommand`) even if this map's underlay isn't currently hydrated, so a
    // later `hydrateUnderlay` on this map resolves the already-corrected offset.
    const baseSettings = getSettings(mapId);
    const shiftUnderlay = !!baseSettings && (dLeft !== 0 || dTop !== 0);

    // World coupling: only a top/left edit moves the origin, and only if this map is placed.
    const placement =
      dLeft !== 0 || dTop !== 0 ? world.placements.find((p) => p.mapId === mapId) : undefined;
    const prevOrigin = placement ? { col: placement.origin.col, row: placement.origin.row } : null;
    const coupled = !!placement;

    const cmd: Command = {
      do: () => {
        applyState(newState);
        if (shiftUnderlay && baseSettings) {
          putSettings(mapId, {
            ...baseSettings,
            offsetX: baseSettings.offsetX + dLeft,
            offsetY: baseSettings.offsetY + dTop,
          });
        }
        if (placement && prevOrigin) {
          placement.origin = { col: prevOrigin.col - dLeft, row: prevOrigin.row - dTop };
        }
      },
      undo: () => {
        applyState(oldState);
        if (shiftUnderlay && baseSettings) {
          putSettings(mapId, baseSettings);
        }
        if (placement && prevOrigin) {
          placement.origin = { col: prevOrigin.col, row: prevOrigin.row };
        }
      },
    };

    // `applyCommand`/`applyWorldCommand` each hard-code ONE domain's side effects; a resize can need
    // BOTH at once, so this inlines `history.apply` with the conditional `domain` tag (mirroring
    // `applyWorldCommand`'s own inline style) rather than forcing either of those two through a
    // domain they don't own.
    history.apply({ ...cmd, domain: coupled ? 'map+world' : undefined });
    get().syncUnderlayFromSettings();
    set((s) => ({
      dirty: true,
      docRevision: s.docRevision + 1,
      regionSelection: null, // a crop/grow can leave the box off the new bounds — drop it
      activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
      selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
      activeZoneId: reconcileActiveZone(s.map, s.activeZoneId),
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      ...(coupled ? { worldDirty: true, worldRevision: s.worldRevision + 1 } : {}),
    }));
    if (coupled) {
      toast.info('Map resized — world layout has unsaved changes (Save World separately).');
    }
    return true;
  },

  renameMapState: (newId, newName) => {
    const { map, mapId: oldId, world } = get();
    if (!map) return { placementMigrated: false };

    const idChanged = newId !== oldId;

    // Underlay settings migration (only on an id change, and only if the old id had settings).
    let underlayMigrated = false;
    if (idChanged && oldId) {
      const settings = getSettings(oldId);
      if (settings) {
        putSettings(newId, settings);
        deleteSettings(oldId);
        underlayMigrated = true;
      }
    }

    // Library view-state migration (plan 030): move recents + browse from old→new id so a
    // rename+reload keeps them and leaves no orphaned `oldId` keys (mirrors the underlay above).
    // In-memory `libraryRecents`/`libraryBrowse` are unchanged by a rename — only the persistence
    // key moves. Both `get*` degrade to empty/null, so an absent value just deletes nothing.
    if (idChanged && oldId) {
      const recents = getRecents(oldId);
      if (recents.length) {
        putRecents(newId, recents);
        deleteRecents(oldId);
      }
      const browse = getBrowse(oldId);
      if (browse) {
        putBrowse(newId, { ...browse, search: '' });
        deleteBrowse(oldId);
      }
    }

    // Session-restore key migration (plan 034), same shape as above: move the per-map camera to the
    // new id, and repoint the boot-resume pointer if it named the old id (layer ids are unchanged by
    // a rename, so `last.activeLayerId` stays valid). Only on an id change.
    if (idChanged && oldId) {
      const cam = getCamera(oldId);
      if (cam) putCamera(newId, cam);
      clearCamera(oldId);
      const last = getLast();
      if (last?.mapId === oldId) putLast({ ...last, mapId: newId });
    }

    // World placement migration: rewrite the matching placement's mapId in place (mirrors
    // `movePlacement`'s in-place mutation) so the World tab sees the same array reference.
    let placementMigrated = false;
    if (idChanged) {
      const placement = world.placements.find((p) => p.mapId === oldId);
      if (placement) {
        placement.mapId = newId;
        placementMigrated = true;
      }
    }

    set((s) => ({
      map: s.map ? { ...s.map, meta: { ...s.map.meta, id: newId, name: newName } } : s.map,
      mapId: newId,
      dirty: false,
      ...(underlayMigrated ? { underlayRevision: s.underlayRevision + 1 } : {}),
      ...(placementMigrated ? { worldDirty: true, worldRevision: s.worldRevision + 1 } : {}),
    }));

    return { placementMigrated };
  },
});
