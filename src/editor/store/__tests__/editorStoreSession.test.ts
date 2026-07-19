import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../editorStore';
import {
  getCamera,
  getLast,
  putCamera,
  putLast,
  type CameraState,
  type SessionLast,
} from '../../sessionStore';

/** Minimal in-memory `Storage` for the node test env (no jsdom) — mirrors the fake in
 *  `editorStoreLibraryView.test.ts`. These tests exercise `renameMapState`'s session-key migration
 *  through the real `sessionStore` get/put, not a mock of them. */
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

const CAMERA: CameraState = { scrollX: 128, scrollY: -64, zoom: 2 };
const LAST: SessionLast = {
  mapId: 'scratch',
  activeTool: 'brush',
  activeLayerId: 'ground',
  activeTabId: 'library',
};

describe('editorStore: session-restore key migration (plan 034)', () => {
  beforeEach(() => reset());
  afterEach(() => vi.unstubAllGlobals());

  describe('renameMapState — id change', () => {
    it('migrates the camera:<id> key and repoints last.mapId (other fields preserved)', () => {
      putCamera('scratch', CAMERA);
      putLast(LAST);

      useEditorStore.getState().renameMapState('renamed', 'Renamed');

      // camera:<id> key moved old → new, no orphan left behind.
      expect(getCamera('renamed')).toEqual(CAMERA);
      expect(getCamera('scratch')).toBeNull();
      // last pointer repointed at the new id; tool/layer/tab unchanged (layer ids survive a rename).
      expect(getLast()).toEqual({ ...LAST, mapId: 'renamed' });
      // the store itself now points at the new id.
      expect(store().mapId).toBe('renamed');
    });

    it('clears the old camera key even when there was no saved camera to migrate', () => {
      // No putCamera('scratch', …): a rename must still leave no stale old-id camera key.
      putLast(LAST);
      useEditorStore.getState().renameMapState('renamed', 'Renamed');
      expect(getCamera('scratch')).toBeNull();
      expect(getCamera('renamed')).toBeNull();
    });

    it('leaves last untouched when it points at a different map', () => {
      putCamera('scratch', CAMERA);
      putLast({ ...LAST, mapId: 'someOtherMap' });

      useEditorStore.getState().renameMapState('renamed', 'Renamed');

      // camera (keyed on the open map's id) still migrates…
      expect(getCamera('renamed')).toEqual(CAMERA);
      // …but the boot pointer, naming an unrelated map, is not repointed.
      expect(getLast()?.mapId).toBe('someOtherMap');
    });
  });

  describe('renameMapState — name-only (newId === oldId)', () => {
    it('leaves the camera + last keys untouched', () => {
      putCamera('scratch', CAMERA);
      putLast(LAST);

      useEditorStore.getState().renameMapState('scratch', 'A New Name');

      expect(getCamera('scratch')).toEqual(CAMERA);
      expect(getLast()).toEqual(LAST); // mapId unchanged, no migration
      expect(store().mapId).toBe('scratch');
    });
  });
});
