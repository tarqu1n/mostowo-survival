import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../editorStore';
import { getBrowse, getRecents, RECENTS_CAP, type RecentEntry } from '../../libraryViewStore';

/** Minimal in-memory `Storage` for the node test env (no jsdom) — mirrors the fake in
 *  `editorStoreRename.test.ts`. These tests exercise the store's recents/browse write-through and
 *  per-map hydration through the real `libraryViewStore` get/put, not a mock of them. */
class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

/** The store is a module-level singleton; reset localStorage + open a scratch map before each test. */
function reset(): void {
  vi.stubGlobal('localStorage', new FakeStorage());
  useEditorStore.getState().newMap('scratch', 'Scratch', 4, 4);
}

const store = () => useEditorStore.getState();

describe('editorStore: Library view-state (plan 030)', () => {
  beforeEach(() => reset());
  afterEach(() => vi.unstubAllGlobals());

  describe('pushLibraryRecent', () => {
    it('prepends new picks (most-recent-first) and writes through to localStorage', () => {
      store().pushLibraryRecent({ kind: 'tile', assetId: 'pack/a#0' });
      store().pushLibraryRecent({ kind: 'node', ref: 'tree' });

      expect(store().libraryRecents).toEqual([
        { kind: 'node', ref: 'tree' },
        { kind: 'tile', assetId: 'pack/a#0' },
      ]);
      // write-through: the open map's persisted recents mirror the in-memory list.
      expect(getRecents('scratch')).toEqual(store().libraryRecents);
    });

    it('dedupes by identity — re-picking an existing entry moves it to the front', () => {
      store().pushLibraryRecent({ kind: 'tile', assetId: 'pack/a#0' });
      store().pushLibraryRecent({ kind: 'tile', assetId: 'pack/b#0' });
      store().pushLibraryRecent({ kind: 'tile', assetId: 'pack/a#0' });

      expect(store().libraryRecents).toEqual([
        { kind: 'tile', assetId: 'pack/a#0' },
        { kind: 'tile', assetId: 'pack/b#0' },
      ]);
    });

    it('caps the list at RECENTS_CAP, dropping the oldest', () => {
      for (let i = 0; i < RECENTS_CAP + 5; i++) {
        store().pushLibraryRecent({ kind: 'tile', assetId: `pack/t${i}#0` });
      }
      const recents = store().libraryRecents;
      expect(recents).toHaveLength(RECENTS_CAP);
      expect(recents[0]).toEqual({ kind: 'tile', assetId: `pack/t${RECENTS_CAP + 4}#0` });
      // The five oldest fell off the end.
      expect(recents.some((r) => r.kind === 'tile' && r.assetId === 'pack/t0#0')).toBe(false);
    });

    it('updates in-memory state but writes nothing when no map is open', () => {
      store().closeMap();
      store().pushLibraryRecent({ kind: 'terrain', id: 'grass' });

      expect(store().libraryRecents).toEqual([{ kind: 'terrain', id: 'grass' }]);
      // No mapId ⇒ no key written. (getRecents on the closed scratch id stays empty too.)
      expect(getRecents('scratch')).toEqual([]);
    });
  });

  describe('patchLibraryBrowse', () => {
    it('merges the partial into the browse state', () => {
      store().patchLibraryBrowse({ selectedPack: 'nature', search: 'oak' });
      expect(store().libraryBrowse).toEqual({
        search: 'oak',
        selectedPack: 'nature',
        selectedCategory: null,
        expandedPacks: [],
      });
    });

    it('persists the browse subset (never search) on a persisted-field patch', () => {
      store().patchLibraryBrowse({ selectedCategory: 'trees', expandedPacks: ['nature'] });
      expect(getBrowse('scratch')).toEqual({
        selectedPack: null,
        selectedCategory: 'trees',
        expandedPacks: ['nature'],
      });
    });

    it('does NOT write to disk on a search-only patch (search is transient)', () => {
      store().patchLibraryBrowse({ search: 'oak' });
      expect(store().libraryBrowse.search).toBe('oak');
      expect(getBrowse('scratch')).toBeNull(); // nothing persisted
    });

    it('updates in-memory state but writes nothing when no map is open', () => {
      store().closeMap();
      store().patchLibraryBrowse({ selectedPack: 'nature' });
      expect(store().libraryBrowse.selectedPack).toBe('nature');
      expect(getBrowse('scratch')).toBeNull();
    });
  });

  describe('per-map isolation + hydration', () => {
    it('keeps recents/browse separate per map and rehydrates on re-open', () => {
      // Map A
      useEditorStore.getState().newMap('mapA', 'A', 4, 4);
      store().pushLibraryRecent({ kind: 'tile', assetId: 'pack/a#0' });
      store().patchLibraryBrowse({ selectedCategory: 'catA', expandedPacks: ['packA'] });

      // Map B — its own, independent state (starts empty).
      useEditorStore.getState().newMap('mapB', 'B', 4, 4);
      expect(store().libraryRecents).toEqual([]);
      expect(store().libraryBrowse.selectedCategory).toBeNull();
      store().pushLibraryRecent({ kind: 'node', ref: 'rock' });

      // Re-open A — its recents/browse come back from storage; search rehydrates blank.
      useEditorStore.getState().newMap('mapA', 'A', 4, 4);
      expect(store().libraryRecents).toEqual([{ kind: 'tile', assetId: 'pack/a#0' }]);
      expect(store().libraryBrowse).toEqual({
        search: '',
        selectedPack: null,
        selectedCategory: 'catA',
        expandedPacks: ['packA'],
      });
    });

    it('resets recents/browse to defaults on closeMap', () => {
      store().pushLibraryRecent({ kind: 'tile', assetId: 'pack/a#0' });
      store().patchLibraryBrowse({ selectedCategory: 'trees' });

      store().closeMap();

      expect(store().libraryRecents).toEqual([]);
      expect(store().libraryBrowse).toEqual({
        search: '',
        selectedPack: null,
        selectedCategory: null,
        expandedPacks: [],
      });
    });
  });

  describe('renameMapState migration', () => {
    it('moves recents + browse from old id to new id and leaves no orphaned keys', () => {
      store().pushLibraryRecent({ kind: 'tile', assetId: 'pack/a#0' });
      store().patchLibraryBrowse({ selectedCategory: 'trees', expandedPacks: ['nature'] });

      useEditorStore.getState().renameMapState('renamed', 'Renamed');

      const migratedRecents: RecentEntry[] = [{ kind: 'tile', assetId: 'pack/a#0' }];
      expect(getRecents('renamed')).toEqual(migratedRecents);
      expect(getBrowse('renamed')).toEqual({
        selectedPack: null,
        selectedCategory: 'trees',
        expandedPacks: ['nature'],
      });
      // old keys gone
      expect(getRecents('scratch')).toEqual([]);
      expect(getBrowse('scratch')).toBeNull();
    });
  });
});
