import { describe, it, expect } from 'vitest';
import {
  parseMap,
  serializeMap,
  createEmptyMap,
  migrateMap,
  cellIndex,
  getCell,
  setCell,
  isInside,
  collectTextureSources,
  type MapFile,
} from '../mapFormat';

/** A loose, mutable mirror of the raw JSON shape — deliberately permissive (every object field
 *  covers all three `MapObject` kinds as optional) so tests can inject invalid values without
 *  fighting the strict `MapFile` types those values are meant to violate. */
interface RawObjectFixture {
  id: string;
  kind: string;
  ref?: string;
  col?: number;
  row?: number;
  asset?: string;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  depth?: number;
  collision?: { col: number; row: number; w: number; h: number };
  name?: string;
  rect?: { col: number; row: number; w: number; h: number };
  facing?: string;
}

interface RawFixture {
  meta: {
    schemaVersion: number;
    id: string;
    name: string;
    width: number;
    height: number;
    tileSize: number;
    favourites?: string[];
  };
  shape?: { cells: number[] };
  palette: Array<{
    pack: string;
    source: { kind: string; sheet?: string; frame?: number; path?: string };
  } | null>;
  layers: Array<{ id: string; name: string; kind: string; overhead: boolean; cells: number[] }>;
  terrain: unknown[];
  walkability: { cells: number[] };
  zones: {
    defs: Array<{ id: number; name: string; colour: string; favourites: string[] }>;
    cells: number[];
  };
  objects: RawObjectFixture[];
}

/**
 * 3x3 fixture exercising every section of the schema: shape (void at the bottom-right corner),
 * one palette entry, one tile layer, walkability, one zone, and one of each object kind. Index
 * layout (row-major, width 3): 0 1 2 / 3 4 5 / 6 7 8 — cell 8 (col2,row2) is void.
 */
function validRaw(): RawFixture {
  return {
    meta: { schemaVersion: 1, id: 'test-map', name: 'Test Map', width: 3, height: 3, tileSize: 16 },
    shape: { cells: [1, 1, 1, 1, 1, 1, 1, 1, 0] },
    palette: [
      null,
      {
        pack: 'pixel-crawler',
        source: { kind: 'sheetFrame', sheet: 'Environment/Tilesets/Floors_Tiles.png', frame: 252 },
      },
    ],
    layers: [
      {
        id: 'ground',
        name: 'Ground',
        kind: 'tiles',
        overhead: false,
        cells: [1, 1, 1, 1, 1, 1, 1, 1, 0],
      },
    ],
    terrain: [],
    walkability: { cells: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    zones: {
      defs: [{ id: 1, name: 'Camp', colour: '#88aa44', favourites: [] }],
      cells: [1, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    objects: [
      { id: 'node_0001', kind: 'node', ref: 'tree', col: 0, row: 1 },
      {
        id: 'decor_0001',
        kind: 'decor',
        asset: 'pixel-crawler/foo.png',
        x: 16,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
        depth: 0,
        collision: { col: 1, row: 0, w: 1, h: 1 },
      },
      {
        id: 'decor_0002',
        kind: 'decor',
        asset: 'pixel-crawler/foo.png',
        x: 32,
        y: 16,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
        depth: 0,
      },
      {
        id: 'portal_south',
        kind: 'portal',
        name: 'South road',
        rect: { col: 0, row: 0, w: 1, h: 1 },
        facing: 'down',
      },
    ],
  };
}

/** Deep-clone the fixture and apply a mutator so each test starts from a known-valid baseline. */
function withRaw(mutate: (raw: RawFixture) => void): unknown {
  const raw = JSON.parse(JSON.stringify(validRaw())) as RawFixture;
  mutate(raw);
  return raw;
}

describe('parseMap', () => {
  it('accepts the valid fixture', () => {
    expect(() => parseMap(validRaw())).not.toThrow();
  });

  it('round-trips through serializeMap -> JSON.parse -> parseMap', () => {
    const map = parseMap(validRaw());
    const json = serializeMap(map);
    const reparsed = parseMap(JSON.parse(json));
    expect(reparsed).toEqual(map);
  });

  it('serializeMap collapses each cells grid to one line per row', () => {
    const map = parseMap(validRaw());
    const json = serializeMap(map);
    // 3-wide grid rows render as "n,n,n" on their own line, not one number per line.
    expect(json).toMatch(/\n\s+1,1,1,?\n/);
  });

  describe('cells length invariant', () => {
    it('rejects a shape.cells array of the wrong length', () => {
      const raw = withRaw((r) => r.shape?.cells.pop());
      expect(() => parseMap(raw)).toThrow(/shape\.cells/);
    });

    it('rejects a layer cells array of the wrong length', () => {
      const raw = withRaw((r) => r.layers[0].cells.push(0));
      expect(() => parseMap(raw)).toThrow(/layers\[0\]\.cells/);
    });

    it('rejects a walkability.cells array of the wrong length', () => {
      const raw = withRaw((r) => r.walkability.cells.pop());
      expect(() => parseMap(raw)).toThrow(/walkability\.cells/);
    });

    it('rejects a zones.cells array of the wrong length', () => {
      const raw = withRaw((r) => r.zones.cells.pop());
      expect(() => parseMap(raw)).toThrow(/zones\.cells/);
    });
  });

  describe('palette index 0 reservation', () => {
    it('rejects a palette whose index 0 is not null', () => {
      const raw = withRaw((r) => {
        r.palette[0] = { pack: 'x', source: { kind: 'image', path: 'x.png' } };
      });
      expect(() => parseMap(raw)).toThrow(/palette\[0\].*null/);
    });

    it('rejects a palette with a null entry past index 0', () => {
      const raw = withRaw((r) => r.palette.push(null));
      expect(() => parseMap(raw)).toThrow(/palette\[2\].*not be null/);
    });
  });

  it('rejects a layer cell index >= palette.length', () => {
    const raw = withRaw((r) => {
      r.layers[0].cells[0] = 5; // palette only has index 0 (reserved) and 1
    });
    expect(() => parseMap(raw)).toThrow(/layers\[0\]\.cells\[0\]/);
  });

  it('rejects a zone cell id with no matching zones.defs entry', () => {
    const raw = withRaw((r) => {
      r.zones.cells[1] = 9; // no def with id 9
    });
    expect(() => parseMap(raw)).toThrow(/unknown zone id 9/);
  });

  it('rejects duplicate object ids', () => {
    const raw = withRaw((r) => {
      r.objects[1].id = r.objects[0].id;
    });
    expect(() => parseMap(raw)).toThrow(/duplicate object id/);
  });

  it("rejects a kind:'node' object with an empty ref", () => {
    const raw = withRaw((r) => {
      r.objects[0].ref = '';
    });
    expect(() => parseMap(raw)).toThrow(/ref must be a non-empty string/);
  });

  describe('void-consistency', () => {
    it('rejects a non-empty tile layer cell on a void cell', () => {
      const raw = withRaw((r) => {
        r.layers[0].cells[8] = 1; // cell 8 is void per shape.cells
      });
      expect(() => parseMap(raw)).toThrow(/void cell \(2,2\).*layer "ground"/);
    });

    it('rejects a non-zero zone id on a void cell', () => {
      const raw = withRaw((r) => {
        r.zones.cells[8] = 1;
      });
      expect(() => parseMap(raw)).toThrow(/void cell \(2,2\).*zone id/);
    });

    it('rejects an object footprint that overlaps a void cell', () => {
      const raw = withRaw((r) => {
        r.objects[0].col = 2;
        r.objects[0].row = 2; // the void cell
      });
      expect(() => parseMap(raw)).toThrow(/footprint cell \(2,2\).*outside the map or void/);
    });

    it('rejects an object footprint entirely outside the map bounds', () => {
      const raw = withRaw((r) => {
        r.objects[0].col = 99;
        r.objects[0].row = 99;
      });
      expect(() => parseMap(raw)).toThrow(/outside the map or void/);
    });
  });

  it('accepts a map with no shape (absent shape = all-inside)', () => {
    const raw = withRaw((r) => {
      delete r.shape;
      r.layers[0].cells[8] = 1; // now a legal, non-void cell
      r.zones.cells[8] = 0;
    });
    const map = parseMap(raw);
    expect(map.shape).toBeUndefined();
    expect(isInside(map, 2, 2)).toBe(true);
  });

  describe('meta.favourites', () => {
    it('round-trips a map WITH meta.favourites', () => {
      const raw = withRaw((r) => {
        r.meta.favourites = ['pixel-crawler/Environment/Tilesets/Floors_Tiles.png#252'];
      });
      const map = parseMap(raw);
      expect(map.meta.favourites).toEqual([
        'pixel-crawler/Environment/Tilesets/Floors_Tiles.png#252',
      ]);
      const json = serializeMap(map);
      const parsedJson = JSON.parse(json) as { meta: { favourites?: string[] } };
      expect(parsedJson.meta.favourites).toEqual(map.meta.favourites);
      const reparsed = parseMap(JSON.parse(json));
      expect(reparsed).toEqual(map);
    });

    it('round-trips a map WITHOUT meta.favourites, serializing without the key', () => {
      const map = parseMap(validRaw()); // the base fixture never sets favourites
      expect(map.meta.favourites).toBeUndefined();
      const json = serializeMap(map);
      const parsedJson = JSON.parse(json) as { meta: object };
      expect(Object.prototype.hasOwnProperty.call(parsedJson.meta, 'favourites')).toBe(false);
      const reparsed = parseMap(JSON.parse(json));
      expect(reparsed.meta.favourites).toBeUndefined();
      expect(reparsed).toEqual(map);
    });

    it('rejects a non-array meta.favourites', () => {
      const raw = withRaw((r) => {
        // @ts-expect-error deliberately invalid for the test
        r.meta.favourites = 'not-an-array';
      });
      expect(() => parseMap(raw)).toThrow(/favourites/);
    });
  });
});

describe('migrateMap', () => {
  it('passes a v1 map through unchanged (identity)', () => {
    expect(migrateMap(validRaw())).toEqual(parseMap(validRaw()));
  });

  it('throws on an unsupported schemaVersion', () => {
    const raw = withRaw((r) => {
      r.meta.schemaVersion = 2;
    });
    expect(() => migrateMap(raw)).toThrow(/unsupported schemaVersion/);
  });
});

describe('createEmptyMap', () => {
  it('produces a sane, immediately-valid empty map', () => {
    const map = createEmptyMap('blank', 'Blank', 4, 5);
    expect(() => parseMap(JSON.parse(serializeMap(map)))).not.toThrow();
    expect(map.shape).toBeUndefined();
    expect(map.meta.favourites).toBeUndefined();
    expect(map.palette).toEqual([null]);
    expect(map.layers).toHaveLength(1);
    expect(map.layers[0].cells).toHaveLength(20);
    expect(map.layers[0].cells.every((c) => c === 0)).toBe(true);
    expect(map.walkability.cells).toHaveLength(20);
    expect(map.zones.cells).toHaveLength(20);
    expect(map.objects).toHaveLength(0);
  });

  it('rejects a non-positive width or height', () => {
    expect(() => createEmptyMap('x', 'X', 0, 5)).toThrow();
    expect(() => createEmptyMap('x', 'X', 5, -1)).toThrow();
  });
});

describe('cell helpers', () => {
  it('cellIndex is row-major', () => {
    expect(cellIndex(0, 0, 3)).toBe(0);
    expect(cellIndex(2, 0, 3)).toBe(2);
    expect(cellIndex(0, 1, 3)).toBe(3);
  });

  it('getCell/setCell round-trip through cellIndex', () => {
    const cells = new Array<number>(9).fill(0);
    setCell(cells, 2, 1, 3, 7);
    expect(cells[cellIndex(2, 1, 3)]).toBe(7);
    expect(getCell(cells, 2, 1, 3)).toBe(7);
  });
});

describe('isInside', () => {
  it('is true everywhere for a map with no shape', () => {
    const map = createEmptyMap('x', 'X', 2, 2);
    expect(isInside(map, 0, 0)).toBe(true);
    expect(isInside(map, 1, 1)).toBe(true);
  });

  it('is false out of bounds even with no shape', () => {
    const map = createEmptyMap('x', 'X', 2, 2);
    expect(isInside(map, -1, 0)).toBe(false);
    expect(isInside(map, 2, 0)).toBe(false);
  });

  it('follows the shape mask when present', () => {
    const map = parseMap(validRaw());
    expect(isInside(map, 2, 2)).toBe(false); // void
    expect(isInside(map, 0, 0)).toBe(true);
  });
});

describe('collectTextureSources', () => {
  it('dedups palette entries and decor asset refs', () => {
    const map = parseMap(validRaw());
    const sources = collectTextureSources(map);

    const paletteSources = sources.filter((s) => s.kind === 'palette');
    const decorSources = sources.filter((s) => s.kind === 'decorAsset');

    // One real palette entry (index 0 is the reserved null slot).
    expect(paletteSources).toHaveLength(1);
    // Two decor objects share the same asset -> deduped to one.
    expect(decorSources).toHaveLength(1);
    expect(decorSources[0]).toEqual({ kind: 'decorAsset', asset: 'pixel-crawler/foo.png' });
  });

  it('returns no palette entries for a fresh empty map (only the reserved null slot)', () => {
    const map: MapFile = createEmptyMap('x', 'X', 2, 2);
    expect(collectTextureSources(map)).toEqual([]);
  });
});
