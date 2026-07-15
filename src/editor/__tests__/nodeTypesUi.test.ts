import { describe, expect, it } from 'vitest';
import nodesJson from '../../data/maps/nodes.json';
import type { AuthoredNodeDef, NodeDefsFile } from '../../systems/nodeDefs';
import { colorToHex, hexToColor, validateNodeDefPatch } from '../nodeTypesUi';

const SEED_DEFS = (nodesJson as NodeDefsFile).defs;

describe('colorToHex / hexToColor (plan 021 step 8)', () => {
  it('round-trips a decimal color through #rrggbb', () => {
    expect(colorToHex(0xff8040)).toBe('#ff8040');
    expect(hexToColor('#ff8040')).toBe(0xff8040);
  });

  it('pads short hex components with leading zeros', () => {
    expect(colorToHex(0x000102)).toBe('#000102');
    expect(colorToHex(0)).toBe('#000000');
  });

  it('clamps an out-of-range int into the 24-bit range rather than emitting a malformed string', () => {
    expect(colorToHex(0x1ffffff)).toBe('#ffffff');
    expect(colorToHex(-5)).toBe('#000000');
  });

  it('hexToColor tolerates a missing leading #', () => {
    expect(hexToColor('8a5a2b')).toBe(0x8a5a2b);
  });
});

describe('validateNodeDefPatch (plan 021 step 8)', () => {
  it('returns null for a valid patch', () => {
    const error = validateNodeDefPatch(SEED_DEFS, 'tree', { maxHp: 99 });
    expect(error).toBeNull();
  });

  it('surfaces the exact parseNodeDefs message for an invalid patch', () => {
    const error = validateNodeDefPatch(SEED_DEFS, 'tree', { maxHp: -1 });
    expect(error).toMatch(/maxHp must be > 0/);
  });

  it('rejects a yieldItemId not present in ITEMS', () => {
    const error = validateNodeDefPatch(SEED_DEFS, 'tree', { yieldItemId: 'not-a-real-item' });
    expect(error).toMatch(/not a known item id/);
  });

  it('does not mutate the input array (candidate is built via slice/spread)', () => {
    const before = JSON.stringify(SEED_DEFS);
    validateNodeDefPatch(SEED_DEFS, 'tree', { maxHp: -1 });
    expect(JSON.stringify(SEED_DEFS)).toBe(before);
  });

  it('reports "not found" for an unknown def id', () => {
    const error = validateNodeDefPatch(SEED_DEFS, 'nope', { maxHp: 5 });
    expect(error).toMatch(/not found/);
  });

  it('a name-only patch on a def with a valid rest-of-shape is still valid', () => {
    const treeDef = SEED_DEFS.find((d): d is AuthoredNodeDef => d.id === 'tree')!;
    expect(treeDef).toBeDefined();
    const error = validateNodeDefPatch(SEED_DEFS, 'tree', { name: 'Renamed tree' });
    expect(error).toBeNull();
  });
});
