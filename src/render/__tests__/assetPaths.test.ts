import { describe, it, expect } from 'vitest';
import { parseAssetId, tilesetAssetUrl } from '../assetPaths';

/**
 * Tier-1 coverage for the runtime copy of the editor's asset-id/URL helpers (plan 018 step A1) —
 * mirrors how `EditorScene`/`LibraryPanel` exercise `parseAssetId`/`tilesetAssetUrl` in
 * `src/editor/`, but against the editor-free `src/render/assetPaths.ts` duplicate so the runtime
 * map loader never imports `src/editor/*`.
 */
describe('parseAssetId', () => {
  it('splits a real pixel-crawler decor asset id into pack + path', () => {
    // Matches a decor `asset` field as authored in src/data/maps/test.map.json.
    const id = 'pixel-crawler/Environment/Props/Static/Rocks.png';
    expect(parseAssetId(id)).toEqual({
      pack: 'pixel-crawler',
      path: 'Environment/Props/Static/Rocks.png',
      frame: undefined,
    });
  });

  it('extracts a trailing #frame suffix as a numeric frame, stripped from path', () => {
    const id = 'pixel-crawler/Environment/Tilesets/Grass.png#12';
    expect(parseAssetId(id)).toEqual({
      pack: 'pixel-crawler',
      path: 'Environment/Tilesets/Grass.png',
      frame: 12,
    });
  });

  it('throws on an id missing a "<pack>/…" prefix', () => {
    expect(() => parseAssetId('no-slash-here')).toThrow(/missing a/);
  });

  it('throws on an id with an empty path after the pack', () => {
    expect(() => parseAssetId('pixel-crawler/')).toThrow(/empty path/);
  });
});

describe('tilesetAssetUrl', () => {
  it('builds a pack-relative, encodeURI-escaped tileset URL', () => {
    const url = tilesetAssetUrl('pixel-crawler', 'Environment/Props/Static/Rocks.png');
    expect(url).toBe('/assets/tilesets/pixel-crawler/Environment/Props/Static/Rocks.png');
  });

  it('escapes spaces in the relative path (some pack paths contain spaces)', () => {
    const url = tilesetAssetUrl('pixel-crawler', 'Environment/Props/Static/Rock 01.png');
    expect(url).toBe('/assets/tilesets/pixel-crawler/Environment/Props/Static/Rock%2001.png');
  });

  it('round-trips with parseAssetId: pack+path from a parsed id resolve to a valid tileset URL', () => {
    const { pack, path } = parseAssetId('pixel-crawler/Environment/Props/Static/Rocks.png');
    expect(tilesetAssetUrl(pack, path)).toBe(
      '/assets/tilesets/pixel-crawler/Environment/Props/Static/Rocks.png',
    );
  });
});
