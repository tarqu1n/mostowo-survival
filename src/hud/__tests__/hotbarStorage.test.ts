import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HUD_HOTBAR_SLOTS } from '@/config';
import { loadHotbar, saveHotbar } from '../hotbarStorage';
import type { HotbarSlot } from '../store';

/**
 * Node-pure persistence tests (plan 046 Step 11). A Map-backed fake `localStorage` stands in for the
 * browser store. Covers the round-trip, slot-length normalisation, stale-id tolerance, and the
 * "malformed → treated as absent, never throws" guard.
 */

class FakeStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  clear(): void {
    this.m.clear();
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

const SAVE = 'the-moon';
const KEY = `mostowo-hud:hotbar:${SAVE}`;

beforeEach(() => {
  vi.stubGlobal('localStorage', new FakeStorage());
});

describe('loadHotbar / saveHotbar', () => {
  it('returns null when nothing is stored', () => {
    expect(loadHotbar(SAVE)).toBeNull();
  });

  it('round-trips a loadout, normalised to HUD_HOTBAR_SLOTS slots', () => {
    const slots: HotbarSlot[] = [
      { kind: 'item', id: 'wood' },
      null,
      { kind: 'buildable', id: 'wall' },
    ];
    saveHotbar(SAVE, slots);
    const loaded = loadHotbar(SAVE);
    expect(loaded).toHaveLength(HUD_HOTBAR_SLOTS);
    expect(loaded?.[0]).toEqual({ kind: 'item', id: 'wood' });
    expect(loaded?.[1]).toBeNull();
    expect(loaded?.[2]).toEqual({ kind: 'buildable', id: 'wall' });
    expect(loaded?.[3]).toBeNull(); // padded out to full length
  });

  it('drops entries whose id no longer resolves (stale after a content change), keeping the slot', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { kind: 'item', id: 'wood' },
        { kind: 'item', id: 'obsolete-item' },
        { kind: 'buildable', id: 'ghost-structure' },
      ]),
    );
    const loaded = loadHotbar(SAVE);
    expect(loaded?.[0]).toEqual({ kind: 'item', id: 'wood' });
    expect(loaded?.[1]).toBeNull(); // unknown item → empty slot
    expect(loaded?.[2]).toBeNull(); // unknown buildable → empty slot
  });

  it('treats malformed records as absent (never throws)', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadHotbar(SAVE)).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(loadHotbar(SAVE)).toBeNull();
  });

  it('coerces malformed slot elements to empty slots', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { kind: 'weapon', id: 'sword' },
        { id: 'wood' },
        'garbage',
        { kind: 'item' },
      ]),
    );
    expect(loadHotbar(SAVE)).toEqual(new Array<HotbarSlot>(HUD_HOTBAR_SLOTS).fill(null));
  });
});
