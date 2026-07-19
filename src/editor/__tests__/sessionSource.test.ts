import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreSession, installSessionAutosave, flushSession } from '../sessionSource';
import { useEditorStore } from '../store/editorStore';
import { clearLast, getLast, putLast } from '../sessionStore';
import { createEmptyMap } from '../../systems/mapFormat';
import type { MapFile } from '../../systems/mapFormat';
import { getMap } from '../api';

/**
 * `sessionSource` is the boot-resume orchestrator. We drive the REAL `useEditorStore` so
 * `loadMap`/`setActiveTool`/`activateTab`/`setActiveLayer` actually mutate state we can assert, and
 * mock only the two collaborators at the module edge:
 *   - `../api` → a controllable `getMap` `vi.fn()` (resolve = map on disk, reject = stale pointer).
 *   - `../../systems/mapFormat`'s `migrateMap` → identity, so the test is about `sessionSource`, not
 *     the migrator (the raw we feed `getMap` is already a valid `MapFile`). `createEmptyMap` and the
 *     rest of the module stay real.
 */
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, getMap: vi.fn() };
});
vi.mock('../../systems/mapFormat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../systems/mapFormat')>();
  return { ...actual, migrateMap: (raw: unknown) => raw as MapFile };
});

const getMapMock = vi.mocked(getMap);

/** Minimal in-memory `Storage` for the node test env (no jsdom) — same fake as the sibling suites. */
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

/** A map with two layers so the validated-layer path has both a present id (`overhead`) and, by
 *  omission, an absent one to exercise the skip. `createEmptyMap` seeds a single `ground` layer. */
function twoLayerMap(id: string): MapFile {
  const map = createEmptyMap(id, id, 4, 4);
  map.layers.push({ ...map.layers[0], id: 'overhead', name: 'Overhead', overhead: true });
  return map;
}

const store = () => useEditorStore.getState();

describe('sessionSource (plan 034)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new FakeStorage());
    getMapMock.mockReset();
    // Deterministic baseline: no map open, a tool/tab distinct from what the tests restore, so a
    // restore that changes them is observable. `closeMap` doesn't touch tool/tab, hence the explicit set.
    store().closeMap();
    store().setActiveTool('pan');
    store().activateTab('map');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('restoreSession', () => {
    it('opens the seeded last.mapId and applies tool + validated layer + active tab', async () => {
      getMapMock.mockResolvedValueOnce(twoLayerMap('camp'));
      putLast({
        mapId: 'camp',
        activeTool: 'brush',
        activeLayerId: 'overhead', // present in the map → applied
        activeTabId: 'world',
      });

      await restoreSession();

      expect(getMapMock).toHaveBeenCalledWith('camp');
      expect(store().mapId).toBe('camp');
      expect(store().activeTool).toBe('brush');
      expect(store().activeTabId).toBe('world');
      expect(store().activeLayerId).toBe('overhead');
    });

    it('skips a saved activeLayerId that is not one of the map’s layers (critique #3)', async () => {
      getMapMock.mockResolvedValueOnce(twoLayerMap('camp'));
      putLast({ mapId: 'camp', activeLayerId: 'ghost-layer' });

      await restoreSession();

      expect(store().mapId).toBe('camp');
      // `loadMap` defaults activeLayerId to layers[0] (`ground`); the dangling id is ignored, not applied.
      expect(store().activeLayerId).toBe('ground');
    });

    it('does nothing when there is no saved session', async () => {
      await restoreSession();
      expect(getMapMock).not.toHaveBeenCalled();
      expect(store().mapId).toBeNull();
    });

    it('clears the pointer and self-heals when the map is gone (getMap rejects)', async () => {
      getMapMock.mockRejectedValueOnce(new Error('404'));
      putLast({ mapId: 'deleted-map', activeTool: 'brush' });

      await restoreSession();

      expect(getMapMock).toHaveBeenCalledWith('deleted-map');
      expect(getLast()).toBeNull(); // stale pointer cleared
      expect(store().mapId).toBeNull(); // nothing loaded
    });
  });

  describe('installSessionAutosave', () => {
    it('debounces a tool change into a single `last` write', () => {
      vi.useFakeTimers();
      store().loadMap(twoLayerMap('camp'), 'camp');
      clearLast();
      const unsubscribe = installSessionAutosave();

      store().setActiveTool('eraser');
      // Nothing written yet — the write is debounced.
      expect(getLast()).toBeNull();

      vi.advanceTimersByTime(400);
      expect(getLast()).toEqual({
        mapId: 'camp',
        activeTool: 'eraser',
        activeLayerId: 'ground',
        activeTabId: 'map',
      });

      unsubscribe();
    });

    it('clears `last` when the map is closed', () => {
      vi.useFakeTimers();
      store().loadMap(twoLayerMap('camp'), 'camp');
      putLast({ mapId: 'camp', activeTool: 'brush' });
      const unsubscribe = installSessionAutosave();

      store().closeMap();
      vi.advanceTimersByTime(400);

      expect(getLast()).toBeNull();
      unsubscribe();
    });
  });

  describe('flushSession', () => {
    it('writes immediately, without waiting for the debounce', () => {
      vi.useFakeTimers();
      store().loadMap(twoLayerMap('camp'), 'camp');
      clearLast();
      const unsubscribe = installSessionAutosave();

      store().setActiveTool('fill');
      // A debounced write is pending but not yet flushed.
      expect(getLast()).toBeNull();

      flushSession();
      // Written synchronously — no timer advance needed.
      expect(getLast()?.activeTool).toBe('fill');

      // And the pending timer was cancelled, so advancing doesn't double-write / change anything.
      vi.advanceTimersByTime(400);
      expect(getLast()?.activeTool).toBe('fill');

      unsubscribe();
    });
  });
});
