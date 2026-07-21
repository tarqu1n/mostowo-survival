import { createEmptyMap } from '../../../systems/mapFormat';
import {
  getBrowse,
  getRecents,
  putBrowse,
  putRecents,
  pushRecent,
  type LibraryBrowseState,
} from '../../libraryViewStore';
import { history, reconcileActiveLayer, reconcileSelection, reconcileActiveZone } from '../shared';
import type { EditorCatalog, EditorSlice, EditorState, EditorTab } from '../types';

/** Empty Library browse state — the reset value when no map is open and the fallback when a map has
 *  no persisted browse. `search` is transient (store-only, never persisted; see `libraryViewStore`). */
const EMPTY_LIBRARY_BROWSE: LibraryBrowseState = {
  search: '',
  selectedPack: null,
  selectedCategory: null,
  expandedPacks: [],
};
/** Drop object tabs whose asset is gone from the fresh catalog, and re-point `activeTabId` if it
 *  pointed at a dropped tab. Net-new defensive code (NOT an existing reconcile pattern): a reclassify
 *  never changes an asset id, so this only fires if an asset file is removed/renamed on disk and the
 *  catalog regenerates without it. `map`/`world` are always kept; an object tab survives iff the
 *  catalog is non-null AND still lists its `assetId`. A null catalog (the initial/cleared state) keeps
 *  every tab unchanged — we don't nuke tabs just because the catalog hasn't loaded. A dropped active
 *  tab falls back to `'map'`. */
function reconcileTabs(
  tabs: EditorTab[],
  activeTabId: string,
  catalog: EditorCatalog,
): { tabs: EditorTab[]; activeTabId: string } {
  if (!catalog) return { tabs, activeTabId };
  const kept = tabs.filter(
    (t) => t.kind !== 'object' || catalog.assets.some((a) => a.id === t.assetId),
  );
  if (kept.length === tabs.length) return { tabs, activeTabId };
  const stillActive = kept.some((t) => t.id === activeTabId);
  return { tabs: kept, activeTabId: stillActive ? activeTabId : 'map' };
}

export const documentSlice: EditorSlice<
  Pick<
    EditorState,
    | 'tabs'
    | 'activeTabId'
    | 'map'
    | 'mapId'
    | 'dirty'
    | 'catalog'
    | 'libraryRecents'
    | 'libraryBrowse'
    | 'pendingDirty'
    | 'mapEpoch'
    | 'docRevision'
    | 'pointerGestureResetNonce'
    | 'canUndo'
    | 'canRedo'
    | 'bakeThumbnail'
    | 'zoomViewport'
    | 'newMap'
    | 'loadMap'
    | 'closeMap'
    | 'openObjectTab'
    | 'activateTab'
    | 'closeTab'
    | 'pushLibraryRecent'
    | 'patchLibraryBrowse'
    | 'setBakeThumbnail'
    | 'setZoomViewport'
    | 'resetPointerGesture'
    | 'setCatalog'
    | 'markSaved'
    | 'applyCommand'
    | 'undo'
    | 'redo'
    | 'consumePendingDirty'
  >
> = (set, get) => ({
  tabs: [
    { id: 'map', kind: 'map' },
    { id: 'world', kind: 'world' },
    { id: 'nodeTypes', kind: 'nodeTypes' },
  ],
  activeTabId: 'map',
  map: null,
  mapId: null,
  dirty: false,
  catalog: null,
  libraryRecents: [],
  libraryBrowse: EMPTY_LIBRARY_BROWSE,
  pendingDirty: null,
  mapEpoch: 0,
  docRevision: 0,
  pointerGestureResetNonce: 0,
  canUndo: false,
  canRedo: false,
  bakeThumbnail: null,
  zoomViewport: null,
  newMap: (id, name, width, height) => {
    const map = createEmptyMap(id, name, width, height);
    history.clear();
    const persistedBrowse = getBrowse(id);
    set((s) => ({
      map,
      mapId: id,
      activeLayerId: map.layers[0]?.id ?? null,
      // Plan 033 step 9: tile palettes are GLOBAL editor curation — a new map neither creates nor
      // resets them, so `tilePalettes`/`activeTilePaletteId` are deliberately left untouched here.
      palettePickMode: false,
      palettePickSelection: [],
      selectedObjectIds: [],
      regionSelection: null,
      activeZoneId: null,
      armedObjectAsset: null,
      armedNodeRef: null,
      pendingPortalRect: null,
      dirty: true, // freshly created — not yet on disk
      pendingDirty: null,
      underlay: null, // fresh doc — drop any prior underlay; hydrate restores if this id has one
      underlayRevision: s.underlayRevision + 1,
      // Library view-state (plan 030): hydrate this map's recents/browse (empty/default on a miss);
      // `search` always rehydrates blank (transient — never persisted).
      libraryRecents: getRecents(id),
      libraryBrowse: persistedBrowse ? { ...persistedBrowse, search: '' } : EMPTY_LIBRARY_BROWSE,
      mapEpoch: s.mapEpoch + 1,
      docRevision: 0,
      canUndo: false,
      canRedo: false,
    }));
    void get().hydrateUnderlay(id);
  },

  loadMap: (map, id) => {
    history.clear();
    const persistedBrowse = getBrowse(id);
    set((s) => ({
      map,
      mapId: id,
      activeLayerId: map.layers[0]?.id ?? null,
      // Plan 033 step 9: tile palettes are GLOBAL editor curation — opening a map neither migrates
      // nor resets them, so `tilePalettes`/`activeTilePaletteId` are deliberately left untouched here
      // (they persist across map switches).
      palettePickMode: false,
      palettePickSelection: [],
      selectedObjectIds: [],
      regionSelection: null,
      activeZoneId: null,
      armedObjectAsset: null,
      armedNodeRef: null,
      pendingPortalRect: null,
      dirty: false, // just read from disk
      pendingDirty: null,
      underlay: null, // swap maps → drop the old underlay; hydrate re-resolves this map's own
      underlayRevision: s.underlayRevision + 1,
      // Library view-state (plan 030): hydrate this map's recents/browse (empty/default on a miss);
      // `search` always rehydrates blank (transient — never persisted).
      libraryRecents: getRecents(id),
      libraryBrowse: persistedBrowse ? { ...persistedBrowse, search: '' } : EMPTY_LIBRARY_BROWSE,
      mapEpoch: s.mapEpoch + 1,
      docRevision: 0,
      canUndo: false,
      canRedo: false,
    }));
    void get().hydrateUnderlay(id);
  },

  closeMap: () => {
    history.clear();
    set((s) => ({
      map: null,
      mapId: null,
      activeLayerId: null,
      // Plan 033 step 9: tile palettes are GLOBAL — closing a map leaves `tilePalettes`/
      // `activeTilePaletteId` untouched (they aren't map data).
      palettePickMode: false,
      palettePickSelection: [],
      selectedObjectIds: [],
      regionSelection: null,
      activeZoneId: null,
      armedObjectAsset: null,
      armedNodeRef: null,
      pendingPortalRect: null,
      dirty: false,
      pendingDirty: null,
      underlay: null,
      underlayRevision: s.underlayRevision + 1,
      // Library view-state (plan 030): no map open ⇒ reset to defaults.
      libraryRecents: [],
      libraryBrowse: EMPTY_LIBRARY_BROWSE,
      mapEpoch: s.mapEpoch + 1,
      docRevision: 0,
      canUndo: false,
      canRedo: false,
    }));
  },

  openObjectTab: (assetId) =>
    set((s): Partial<EditorState> => {
      const id = `object:${assetId}`;
      const tab: EditorTab = { id, kind: 'object', assetId };
      const tabs = s.tabs.some((t) => t.id === id) ? s.tabs : [...s.tabs, tab];
      return { tabs, activeTabId: id };
    }),
  activateTab: (id) =>
    set((s): Partial<EditorState> => (s.tabs.some((t) => t.id === id) ? { activeTabId: id } : {})),
  closeTab: (id) =>
    set((s): Partial<EditorState> => {
      if (id === 'map' || id === 'world' || id === 'nodeTypes') return {}; // permanent tabs — never closed
      const index = s.tabs.findIndex((t) => t.id === id);
      if (index < 0) return {}; // not open — nothing to remove
      const tabs = s.tabs.filter((t) => t.id !== id);
      // Closing the active tab hands focus to its left neighbour (index − 1); everything else keeps
      // the current active tab. `?? 'map'` guards the (unreachable — index 0/1 are permanent) case
      // of closing the leftmost tab.
      const activeTabId = s.activeTabId === id ? (s.tabs[index - 1]?.id ?? 'map') : s.activeTabId;
      return { tabs, activeTabId };
    }),
  // ---- Library view-state (plan 030) ----
  pushLibraryRecent: (entry) => {
    const libraryRecents = pushRecent(get().libraryRecents, entry);
    set({ libraryRecents });
    const { mapId } = get();
    if (mapId) putRecents(mapId, libraryRecents);
  },
  patchLibraryBrowse: (partial) => {
    const libraryBrowse = { ...get().libraryBrowse, ...partial };
    set({ libraryBrowse });
    // `search` is transient — a search-only patch updates memory but never hits disk.
    const touchesPersisted =
      'selectedPack' in partial || 'selectedCategory' in partial || 'expandedPacks' in partial;
    const { mapId } = get();
    if (mapId && touchesPersisted) putBrowse(mapId, libraryBrowse);
  },
  setBakeThumbnail: (fn) => set({ bakeThumbnail: fn }),
  setZoomViewport: (fn) => set({ zoomViewport: fn }),
  resetPointerGesture: () =>
    set((s) => ({ pointerGestureResetNonce: s.pointerGestureResetNonce + 1 })),
  setCatalog: (catalog) =>
    set((s) => ({ catalog, ...reconcileTabs(s.tabs, s.activeTabId, catalog) })),
  markSaved: () => set({ dirty: false }),
  applyCommand: (cmd) => {
    history.apply(cmd);
    set((s) => ({
      dirty: true,
      docRevision: s.docRevision + 1,
      activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
      selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
      activeZoneId: reconcileActiveZone(s.map, s.activeZoneId),
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
    }));
    get().syncUnderlayFromSettings();
  },
  undo: () => {
    if (!history.undo()) return;
    get().syncUnderlayFromSettings();
    // A single shared stack spans map + world; the reverted entry's `domain` tag says which side
    // effects to bump (see history.ts / applyWorldCommand). `'map+world'` (plan 024's `resizeMap`,
    // a top/left resize of a PLACED map) bumps both sets in one go — it must be checked before the
    // plain `'world'` branch below (a distinct string, so either check order works, but matching
    // this order keeps the three cases readably distinct top-to-bottom: coupled, world-only, map).
    const domain = history.getLastDomain();
    if (domain === 'map+world') {
      set((s) => ({
        dirty: true,
        docRevision: s.docRevision + 1,
        pendingDirty: null,
        regionSelection: null, // region select isn't history-tracked — drop the box so it can't drift from the reverted content
        activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
        selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
        activeZoneId: reconcileActiveZone(s.map, s.activeZoneId),
        worldDirty: true,
        worldRevision: s.worldRevision + 1,
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
      return;
    }
    if (domain === 'world') {
      set((s) => ({
        worldDirty: true,
        worldRevision: s.worldRevision + 1,
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
      return;
    }
    set((s) => ({
      dirty: true,
      docRevision: s.docRevision + 1,
      pendingDirty: null, // a whole coalesced stroke reverted at once — fall back to a full rebake
      regionSelection: null, // region select isn't history-tracked — drop the box so it can't drift from the reverted content
      activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
      selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
      activeZoneId: reconcileActiveZone(s.map, s.activeZoneId),
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
    }));
  },

  redo: () => {
    if (!history.redo()) return;
    get().syncUnderlayFromSettings();
    const domain = history.getLastDomain();
    if (domain === 'map+world') {
      set((s) => ({
        dirty: true,
        docRevision: s.docRevision + 1,
        pendingDirty: null,
        regionSelection: null, // region select isn't history-tracked — drop the box so it can't drift from the reverted content
        activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
        selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
        activeZoneId: reconcileActiveZone(s.map, s.activeZoneId),
        worldDirty: true,
        worldRevision: s.worldRevision + 1,
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
      return;
    }
    if (domain === 'world') {
      set((s) => ({
        worldDirty: true,
        worldRevision: s.worldRevision + 1,
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      }));
      return;
    }
    set((s) => ({
      dirty: true,
      docRevision: s.docRevision + 1,
      pendingDirty: null,
      activeLayerId: reconcileActiveLayer(s.map, s.activeLayerId),
      selectedObjectIds: reconcileSelection(s.map, s.selectedObjectIds),
      activeZoneId: reconcileActiveZone(s.map, s.activeZoneId),
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
    }));
  },

  consumePendingDirty: () => {
    const { pendingDirty } = get();
    if (pendingDirty) set({ pendingDirty: null });
    return pendingDirty;
  },
});
