import { describe, expect, it } from 'vitest';
import { resolveSkinPreviewUrl } from '../nodeTypesUi';
import { PLACEHOLDER_SKIN_ASSET } from '../store/editorStore';
import type { ParsedNodeDef } from '../../systems/nodeDefs';

/** Regression coverage for a real crash found driving the Node Types panel end-to-end (plan 021 step
 *  8): `LibraryPanel`'s node-preview resolver used to call `parseAssetId` unguarded, which THROWS for
 *  a skin whose `asset` isn't a resolvable `<pack>/path` id — exactly the state of
 *  `PLACEHOLDER_SKIN_ASSET`, which is what every freshly-created node def starts with until its
 *  author picks a real sprite in the Node Types panel. That throw happened mid-render inside
 *  `LibraryPanel`'s "Nodes" category map, and with no React error boundary around it, took the WHOLE
 *  editor to a blank page — not just a broken swatch for the one unfinished def. The fix
 *  (`resolveSkinPreviewUrl`) lives in `nodeTypesUi.ts` rather than `LibraryPanel.tsx` itself so it can
 *  be unit-tested without giving that component file a stray non-component export (which broke Vite
 *  Fast Refresh on every edit — see that function's doc). */

function baseDef(overrides: Partial<ParsedNodeDef> = {}): ParsedNodeDef {
  return {
    id: 'test',
    name: 'Test',
    maxHp: 10,
    armour: 0,
    speed: 0,
    yieldItemId: 'wood',
    yieldPerHit: 1,
    regrowMs: 1000,
    color: 0xff0000,
    stumpColor: 0x808080,
    blocksPath: true,
    tilesTall: 1,
    originX: 0.5,
    originY: 1,
    skins: [{ id: 'default', asset: 'pack/tree.png', weight: 1 }],
    ...overrides,
  };
}

describe('resolveSkinPreviewUrl (plan 021 step 8 regression)', () => {
  it('resolves a normal <pack>/path skin asset to a URL', () => {
    const def = baseDef();
    const url = resolveSkinPreviewUrl(def.skins[0].asset);
    expect(url).toContain('pack/tree.png');
  });

  it('returns null (never throws) for the unassigned-skin placeholder', () => {
    expect(() => resolveSkinPreviewUrl(PLACEHOLDER_SKIN_ASSET)).not.toThrow();
    expect(resolveSkinPreviewUrl(PLACEHOLDER_SKIN_ASSET)).toBeNull();
  });

  it('returns null (never throws) for any other malformed asset id', () => {
    expect(() => resolveSkinPreviewUrl('no-slash-at-all')).not.toThrow();
    expect(resolveSkinPreviewUrl('no-slash-at-all')).toBeNull();
  });
});
