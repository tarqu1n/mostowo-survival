import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteBrowse,
  deleteRecents,
  getBrowse,
  getRecents,
  pushRecent,
  putBrowse,
  putRecents,
  RECENTS_CAP,
  recentIdentity,
  type LibraryBrowseState,
  type RecentEntry,
} from '../libraryViewStore';

/** Minimal in-memory `Storage` for the node test env (no jsdom). */
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

function useStorage(s: Storage | undefined) {
  vi.stubGlobal('localStorage', s);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const TILE: RecentEntry = { kind: 'tile', assetId: 'grass' };
const NODE: RecentEntry = { kind: 'node', ref: 'tree-01' };
const TERRAIN: RecentEntry = { kind: 'terrain', id: 'sand' };
const DECOR: RecentEntry = { kind: 'decor', assetId: 'sheet-a' };
const DECOR_REGION: RecentEntry = {
  kind: 'decor',
  assetId: 'sheet-a',
  region: { x: 0, y: 0, w: 16, h: 16 },
};

describe('recentIdentity', () => {
  it('distinguishes kinds and ids', () => {
    expect(recentIdentity(TILE)).not.toBe(recentIdentity(NODE));
    expect(recentIdentity(NODE)).not.toBe(recentIdentity(TERRAIN));
  });

  it('distinguishes a plain decor entry from a region-cropped one on the same sheet', () => {
    expect(recentIdentity(DECOR)).not.toBe(recentIdentity(DECOR_REGION));
  });

  it('is stable for equivalent entries', () => {
    expect(recentIdentity(TILE)).toBe(recentIdentity({ kind: 'tile', assetId: 'grass' }));
    expect(recentIdentity(DECOR_REGION)).toBe(
      recentIdentity({
        kind: 'decor',
        assetId: 'sheet-a',
        region: { x: 0, y: 0, w: 16, h: 16 },
      }),
    );
  });
});

describe('pushRecent', () => {
  it('adds a new entry to the front', () => {
    const result = pushRecent([TILE], NODE);
    expect(result).toEqual([NODE, TILE]);
  });

  it('moves an existing entry to the front instead of duplicating', () => {
    const result = pushRecent([TILE, NODE, TERRAIN], NODE);
    expect(result).toEqual([NODE, TILE, TERRAIN]);
    expect(result).toHaveLength(3);
  });

  it('does not mutate the input list', () => {
    const original = [TILE, NODE];
    const result = pushRecent(original, TERRAIN);
    expect(original).toEqual([TILE, NODE]);
    expect(result).not.toBe(original);
  });

  it('enforces the cap, dropping the oldest', () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < RECENTS_CAP + 5; i++) {
      list = pushRecent(list, { kind: 'tile', assetId: `t${i}` });
    }
    expect(list).toHaveLength(RECENTS_CAP);
    // Most recent pushed is at the front.
    expect(list[0]).toEqual({ kind: 'tile', assetId: `t${RECENTS_CAP + 4}` });
    // The oldest 5 were dropped.
    expect(list.find((e) => e.kind === 'tile' && e.assetId === 't0')).toBeUndefined();
  });

  it('respects a custom cap', () => {
    const result = pushRecent([TILE, NODE, TERRAIN], DECOR, 2);
    expect(result).toEqual([DECOR, TILE]);
  });
});

describe('libraryViewStore recents', () => {
  it('returns [] when storage is unavailable', () => {
    useStorage(undefined);
    expect(getRecents('camp')).toEqual([]);
    expect(() => putRecents('camp', [TILE])).not.toThrow();
    expect(() => deleteRecents('camp')).not.toThrow();
  });

  it('returns [] when nothing is stored', () => {
    useStorage(new FakeStorage());
    expect(getRecents('camp')).toEqual([]);
  });

  it('round-trips a recents list', () => {
    useStorage(new FakeStorage());
    const list = [NODE, TILE, TERRAIN];
    putRecents('camp', list);
    expect(getRecents('camp')).toEqual(list);
  });

  it('keys recents per map', () => {
    useStorage(new FakeStorage());
    putRecents('camp', [TILE]);
    putRecents('forest', [NODE]);
    expect(getRecents('camp')).toEqual([TILE]);
    expect(getRecents('forest')).toEqual([NODE]);
  });

  it('degrades to [] on malformed JSON', () => {
    const s = new FakeStorage();
    s.setItem('mostowo-editor-library:recents:camp', '{not json');
    useStorage(s);
    expect(getRecents('camp')).toEqual([]);
  });

  it('degrades to [] when the stored value is not an array', () => {
    const s = new FakeStorage();
    s.setItem('mostowo-editor-library:recents:camp', JSON.stringify({ foo: 'bar' }));
    useStorage(s);
    expect(getRecents('camp')).toEqual([]);
  });

  it('deletes recents', () => {
    useStorage(new FakeStorage());
    putRecents('camp', [TILE]);
    deleteRecents('camp');
    expect(getRecents('camp')).toEqual([]);
  });
});

describe('libraryViewStore browse state', () => {
  const STATE: LibraryBrowseState = {
    search: 'stone',
    selectedPack: 'pack-a',
    selectedCategory: 'decor',
    expandedPacks: ['pack-a', 'pack-b'],
  };

  it('returns null when storage is unavailable', () => {
    useStorage(undefined);
    expect(getBrowse('camp')).toBeNull();
    expect(() => putBrowse('camp', STATE)).not.toThrow();
    expect(() => deleteBrowse('camp')).not.toThrow();
  });

  it('returns null when nothing is stored', () => {
    useStorage(new FakeStorage());
    expect(getBrowse('camp')).toBeNull();
  });

  it('round-trips the persisted subset, omitting search', () => {
    useStorage(new FakeStorage());
    putBrowse('camp', STATE);
    const persisted = getBrowse('camp');
    expect(persisted).toEqual({
      selectedPack: 'pack-a',
      selectedCategory: 'decor',
      expandedPacks: ['pack-a', 'pack-b'],
    });
    expect(persisted).not.toHaveProperty('search');
  });

  it('does not write search to the underlying storage at all', () => {
    useStorage(new FakeStorage());
    putBrowse('camp', STATE);
    const raw = localStorage.getItem('mostowo-editor-library:browse:camp');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).not.toHaveProperty('search');
  });

  it('keys browse state per map', () => {
    useStorage(new FakeStorage());
    putBrowse('camp', STATE);
    putBrowse('forest', { ...STATE, selectedPack: 'pack-c' });
    expect(getBrowse('camp')?.selectedPack).toBe('pack-a');
    expect(getBrowse('forest')?.selectedPack).toBe('pack-c');
  });

  it('degrades to null on malformed JSON', () => {
    const s = new FakeStorage();
    s.setItem('mostowo-editor-library:browse:camp', '{not json');
    useStorage(s);
    expect(getBrowse('camp')).toBeNull();
  });

  it('degrades to null when the stored value is not an object', () => {
    const s = new FakeStorage();
    s.setItem('mostowo-editor-library:browse:camp', JSON.stringify('nope'));
    useStorage(s);
    expect(getBrowse('camp')).toBeNull();
  });

  it('deletes browse state', () => {
    useStorage(new FakeStorage());
    putBrowse('camp', STATE);
    deleteBrowse('camp');
    expect(getBrowse('camp')).toBeNull();
  });
});
