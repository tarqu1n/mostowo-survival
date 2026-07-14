import { describe, it, expect } from 'vitest';
import { defaultZoneColour, nextFreeZoneId } from '../zoneOps';
import type { ZoneDef } from '../../systems/mapFormat';

function def(id: number): ZoneDef {
  return { id, name: `Zone ${id}`, colour: '#88aa44', favourites: [] };
}

describe('nextFreeZoneId', () => {
  it('returns 1 for an empty defs list', () => {
    expect(nextFreeZoneId([])).toBe(1);
  });

  it('returns the next id after the highest used, when ids are contiguous', () => {
    expect(nextFreeZoneId([def(1), def(2), def(3)])).toBe(4);
  });

  it('returns the LOWEST free id, not just max+1, when there is a gap', () => {
    expect(nextFreeZoneId([def(1), def(3), def(4)])).toBe(2);
  });

  it('is order-independent (unsorted defs)', () => {
    expect(nextFreeZoneId([def(5), def(1), def(3)])).toBe(2);
  });

  it('returns null when the full 1..255 id space is exhausted', () => {
    const defs = Array.from({ length: 255 }, (_, i) => def(i + 1));
    expect(nextFreeZoneId(defs)).toBeNull();
  });
});

describe('defaultZoneColour', () => {
  it('cycles through the palette deterministically by index', () => {
    const c0 = defaultZoneColour(0);
    const c1 = defaultZoneColour(1);
    expect(c0).not.toBe(c1);
    expect(c0).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('wraps around after exhausting the palette', () => {
    const paletteSize = 6; // matches DEFAULT_ZONE_COLOURS.length in zoneOps.ts
    expect(defaultZoneColour(0)).toBe(defaultZoneColour(paletteSize));
  });
});
