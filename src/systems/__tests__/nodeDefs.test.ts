import { describe, it, expect } from 'vitest';
import { parseNodeDefs, type NodeDefsFile } from '../nodeDefs';

/** A loose, mutable mirror of the raw JSON shape (like `RawFixture` in mapFormat.test.ts) —
 *  deliberately permissive so tests can inject invalid values without fighting the strict
 *  `AuthoredNodeDef`/`NodeSkinDef` types those values are meant to violate. */
interface RawSkinFixture {
  id: string;
  name?: string;
  asset: string;
  region?: { x: number; y: number; w: number; h: number };
  depleted?: { asset: string; region?: { x: number; y: number; w: number; h: number } };
  maxHp?: number;
  weight?: number;
  scale?: number;
  originX?: number;
  originY?: number;
}

interface RawDefFixture {
  id: string;
  name: string;
  maxHp: number;
  yieldItemId: string;
  yieldPerHit: number;
  regrowMs: number;
  blocksPath: boolean;
  harvestAnim?: string;
  loot?: unknown;
  oneShot?: unknown;
  clearLoot?: unknown;
  color: number;
  stumpColor: number;
  scale?: number;
  originX: number;
  originY: number;
  standOffsets?: number[][];
  skins: RawSkinFixture[];
}

interface RawFileFixture {
  version: number;
  defs: RawDefFixture[];
}

/** One tree-shaped def with two skins, modelled on the real `tree` entry in `src/data/nodes.ts`. */
function validRaw(): RawFileFixture {
  return {
    version: 1,
    defs: [
      {
        id: 'tree',
        name: 'Tree',
        maxHp: 3,
        yieldItemId: 'wood',
        yieldPerHit: 1,
        regrowMs: 15000,
        blocksPath: true,
        color: 0x2f5d34,
        stumpColor: 0x5a3f28,
        scale: 2,
        originX: 0.5,
        originY: 0.92,
        standOffsets: [
          [1, 0],
          [-1, 0],
          [0, 1],
        ],
        skins: [
          { id: 'pine', asset: 'pixel-crawler/pine.png' },
          {
            id: 'oak',
            name: 'Grand Oak',
            asset: 'pixel-crawler/oak.png',
            region: { x: 0, y: 0, w: 32, h: 48 },
            depleted: { asset: 'pixel-crawler/oak-stump.png' },
            maxHp: 6,
            weight: 2,
            scale: 1.5,
            originX: 0.5,
            originY: 0.9,
          },
        ],
      },
    ],
  };
}

/** Deep-clone the fixture and apply a mutator so each test starts from a known-valid baseline. */
function withRaw(mutate: (raw: RawFileFixture) => void): unknown {
  const raw = JSON.parse(JSON.stringify(validRaw())) as RawFileFixture;
  mutate(raw);
  return raw;
}

describe('parseNodeDefs', () => {
  it('accepts the valid fixture and returns a Record keyed by def id', () => {
    const result = parseNodeDefs(validRaw());
    expect(Object.keys(result)).toEqual(['tree']);
    const tree = result.tree;
    expect(tree.id).toBe('tree');
    expect(tree.name).toBe('Tree');
    expect(tree.maxHp).toBe(3);
    expect(tree.armour).toBe(0); // injected inert field
    expect(tree.speed).toBe(0); // injected inert field
    expect(tree.yieldItemId).toBe('wood');
    expect(tree.blocksPath).toBe(true);
    expect(tree.scale).toBe(2);
    expect(tree.originX).toBe(0.5);
    expect(tree.originY).toBe(0.92);
    expect(tree.standOffsets).toEqual([
      [1, 0],
      [-1, 0],
      [0, 1],
    ]);
    expect(tree.skins).toHaveLength(2);
  });

  it('defaults a skin weight to 1 when omitted, and passes through an explicit weight unchanged', () => {
    const result = parseNodeDefs(validRaw());
    const [pine, oak] = result.tree.skins;
    expect(pine.id).toBe('pine');
    expect(pine.weight).toBe(1); // omitted in the fixture -> defaulted
    expect(pine.scale).toBeUndefined(); // omitted per-skin -> inherits the def default (not defaulted here)
    expect(oak.id).toBe('oak');
    expect(oak.weight).toBe(2); // explicit in the fixture -> passed through
    expect(oak.region).toEqual({ x: 0, y: 0, w: 32, h: 48 });
    expect(oak.depleted).toEqual({ asset: 'pixel-crawler/oak-stump.png' });
    expect(oak.scale).toBe(1.5);
  });

  it('passes through optional per-skin name + maxHp overrides, omitting them when absent', () => {
    const result = parseNodeDefs(validRaw());
    const [pine, oak] = result.tree.skins;
    expect(pine.name).toBeUndefined(); // omitted -> inherit the id-based label
    expect(pine.maxHp).toBeUndefined(); // omitted -> inherit the def's maxHp
    expect(oak.name).toBe('Grand Oak');
    expect(oak.maxHp).toBe(6);
  });

  it('rejects a non-positive per-skin maxHp override', () => {
    const raw = withRaw((r) => {
      r.defs[0].skins[1].maxHp = 0;
    });
    expect(() => parseNodeDefs(raw)).toThrow(/skins\[1\]\.maxHp must be > 0/);
  });

  it('rejects a fractional per-skin maxHp override (HP is a whole hit count)', () => {
    const raw = withRaw((r) => {
      r.defs[0].skins[1].maxHp = 2.5;
    });
    expect(() => parseNodeDefs(raw)).toThrow(/skins\[1\]\.maxHp must be an integer/);
  });

  it('rejects a non-string per-skin name override', () => {
    const raw = withRaw((r) => {
      (r.defs[0].skins[1] as unknown as Record<string, unknown>).name = 42;
    });
    expect(() => parseNodeDefs(raw)).toThrow(/skins\[1\]\.name must be a string/);
  });

  it('defaults a def scale to 1.0 (native) when omitted', () => {
    const result = parseNodeDefs(withRaw((raw) => delete raw.defs[0].scale));
    expect(result.tree.scale).toBe(1);
  });

  it('rejects a non-object root', () => {
    expect(() => parseNodeDefs(null)).toThrow(/nodeDefs must be an object/);
    expect(() => parseNodeDefs('not an object')).toThrow(/nodeDefs must be an object/);
    expect(() => parseNodeDefs([])).toThrow(/nodeDefs must be an object/);
  });

  it('rejects an unsupported version (no migration path yet)', () => {
    const raw = withRaw((r) => {
      r.version = 2;
    });
    expect(() => parseNodeDefs(raw)).toThrow(/version 2 is not supported/);
  });

  it('rejects an unknown top-level key (strict, like parseMap)', () => {
    const raw = withRaw((r) => {
      (r as unknown as Record<string, unknown>).extra = true;
    });
    expect(() => parseNodeDefs(raw)).toThrow(/nodeDefs has unknown key "extra"/);
  });

  it('rejects an unknown key on a def (strict)', () => {
    const raw = withRaw((r) => {
      (r.defs[0] as unknown as Record<string, unknown>).extra = 'nope';
    });
    expect(() => parseNodeDefs(raw)).toThrow(/defs\[0\] has unknown key "extra"/);
  });

  it('rejects an unknown key on a skin (strict)', () => {
    const raw = withRaw((r) => {
      (r.defs[0].skins[0] as unknown as Record<string, unknown>).extra = 'nope';
    });
    expect(() => parseNodeDefs(raw)).toThrow(/skins\[0\] has unknown key "extra"/);
  });

  // "key≠id": NodeDefsFile.defs is an ARRAY (not a keyed object), so there's no separate input key
  // to mismatch against the def's own id — the check that applies here is deduping the returned
  // Record on `def.id` when two array entries declare the same id.
  it('rejects duplicate def ids (dedupe on the returned Record key)', () => {
    const raw = withRaw((r) => {
      r.defs.push({ ...r.defs[0] });
    });
    expect(() => parseNodeDefs(raw)).toThrow(/duplicate def id "tree"/);
  });

  it('rejects empty skins', () => {
    const raw = withRaw((r) => {
      r.defs[0].skins = [];
    });
    expect(() => parseNodeDefs(raw)).toThrow(/skins must be non-empty/);
  });

  it('rejects duplicate skin ids within a def', () => {
    const raw = withRaw((r) => {
      r.defs[0].skins[1].id = r.defs[0].skins[0].id;
    });
    expect(() => parseNodeDefs(raw)).toThrow(/duplicate skin id "pine"/);
  });

  it('rejects a non-positive skin weight', () => {
    const raw = withRaw((r) => {
      r.defs[0].skins[1].weight = 0;
    });
    expect(() => parseNodeDefs(raw)).toThrow(/skins\[1\]\.weight must be > 0/);
  });

  it('rejects a negative skin weight', () => {
    const raw = withRaw((r) => {
      r.defs[0].skins[1].weight = -3;
    });
    expect(() => parseNodeDefs(raw)).toThrow(/skins\[1\]\.weight must be > 0/);
  });

  it('rejects an out-of-range numeric field (negative maxHp)', () => {
    const raw = withRaw((r) => {
      r.defs[0].maxHp = -1;
    });
    expect(() => parseNodeDefs(raw)).toThrow(/maxHp must be > 0/);
  });

  it('rejects a non-positive regrowMs', () => {
    const raw = withRaw((r) => {
      r.defs[0].regrowMs = 0;
    });
    expect(() => parseNodeDefs(raw)).toThrow(/regrowMs must be > 0/);
  });

  it('rejects a yieldItemId that is not in ITEMS', () => {
    const raw = withRaw((r) => {
      r.defs[0].yieldItemId = 'unobtainium';
    });
    expect(() => parseNodeDefs(raw)).toThrow(/yieldItemId "unobtainium" is not a known item id/);
  });

  it("rejects a bad 'harvestAnim' value", () => {
    const raw = withRaw((r) => {
      r.defs[0].harvestAnim = 'smash';
    });
    expect(() => parseNodeDefs(raw)).toThrow(
      /harvestAnim must be 'chop', 'gather', 'mine' or 'salvage'/,
    );
  });

  it("accepts the 'mine' harvestAnim (rock's pickaxe swing, plan 021 step 6)", () => {
    const raw = withRaw((r) => {
      r.defs[0].harvestAnim = 'mine';
    });
    expect(parseNodeDefs(raw).tree.harvestAnim).toBe('mine');
  });

  it("rejects an unknown 'tile' key (retired in step 6 — now a strict unknown-key violation)", () => {
    const raw = withRaw((r) => {
      (r.defs[0] as unknown as Record<string, unknown>).tile = 'tree';
    });
    expect(() => parseNodeDefs(raw)).toThrow(/defs\[0\] has unknown key "tile"/);
  });

  it('rejects a decor region with a non-positive w/h on a skin', () => {
    const raw = withRaw((r) => {
      r.defs[0].skins[1].region = { x: 0, y: 0, w: 0, h: 1 };
    });
    expect(() => parseNodeDefs(raw)).toThrow(/region\.w must be > 0/);
  });

  it('rejects an empty def id', () => {
    const raw = withRaw((r) => {
      r.defs[0].id = '';
    });
    expect(() => parseNodeDefs(raw)).toThrow(/id must be a non-empty string/);
  });

  it('rejects an empty skin asset id (step 3: a skin must name a real catalog asset)', () => {
    const raw = withRaw((r) => {
      r.defs[0].skins[0].asset = '';
    });
    expect(() => parseNodeDefs(raw)).toThrow(/skins\[0\]\.asset must be a non-empty string/);
  });

  it('rejects an empty depleted asset id', () => {
    const raw = withRaw((r) => {
      r.defs[0].skins[1].depleted = { asset: '' };
    });
    expect(() => parseNodeDefs(raw)).toThrow(/depleted\.asset must be a non-empty string/);
  });

  it('type-checks NodeDefsFile as the expected input shape', () => {
    const file: NodeDefsFile = validRaw() as unknown as NodeDefsFile;
    expect(() => parseNodeDefs(file)).not.toThrow();
  });

  // ---- Salvage action: harvestAnim + loot table (predefined item set) ----

  it("accepts the 'salvage' harvestAnim (tent-wreck scavenge)", () => {
    const raw = withRaw((r) => {
      r.defs[0].harvestAnim = 'salvage';
    });
    expect(parseNodeDefs(raw).tree.harvestAnim).toBe('salvage');
  });

  it('parses a valid loot table through to the def, defaulting a drop weight to 1', () => {
    const raw = withRaw((r) => {
      r.defs[0].loot = {
        rolls: 2,
        drops: [
          { itemId: 'wood', min: 1, max: 3, weight: 2 },
          { itemId: 'stone', min: 1, max: 1 }, // weight omitted -> defaults to 1
        ],
      };
    });
    const { loot } = parseNodeDefs(raw).tree;
    expect(loot).toEqual({
      rolls: 2,
      drops: [
        { itemId: 'wood', min: 1, max: 3, weight: 2 },
        { itemId: 'stone', min: 1, max: 1, weight: 1 },
      ],
    });
  });

  it('leaves loot undefined when the def omits it', () => {
    expect(parseNodeDefs(validRaw()).tree.loot).toBeUndefined();
  });

  it('rejects a loot drop naming an unknown item id', () => {
    const raw = withRaw((r) => {
      r.defs[0].loot = { rolls: 1, drops: [{ itemId: 'unobtainium', min: 1, max: 1, weight: 1 }] };
    });
    expect(() => parseNodeDefs(raw)).toThrow(
      /loot\.drops\[0\]\.itemId "unobtainium" is not a known/,
    );
  });

  it('rejects a loot table with no drops', () => {
    const raw = withRaw((r) => {
      r.defs[0].loot = { rolls: 1, drops: [] };
    });
    expect(() => parseNodeDefs(raw)).toThrow(/loot\.drops must be non-empty/);
  });

  it('rejects rolls < 1', () => {
    const raw = withRaw((r) => {
      r.defs[0].loot = { rolls: 0, drops: [{ itemId: 'wood', min: 1, max: 1, weight: 1 }] };
    });
    expect(() => parseNodeDefs(raw)).toThrow(/loot\.rolls must be >= 1/);
  });

  it('rejects a drop with max < min', () => {
    const raw = withRaw((r) => {
      r.defs[0].loot = { rolls: 1, drops: [{ itemId: 'wood', min: 3, max: 1, weight: 1 }] };
    });
    expect(() => parseNodeDefs(raw)).toThrow(/loot\.drops\[0\]\.max must be >= min/);
  });

  it('rejects an unknown key on a loot drop', () => {
    const raw = withRaw((r) => {
      r.defs[0].loot = {
        rolls: 1,
        drops: [{ itemId: 'wood', min: 1, max: 1, weight: 1, chance: 0.5 }],
      };
    });
    expect(() => parseNodeDefs(raw)).toThrow(/loot\.drops\[0\] has unknown key "chance"/);
  });

  // ---- oneShot + clearLoot (salvage-node lifecycle, plan 047) ----

  it('carries oneShot:true through to the def', () => {
    const raw = withRaw((r) => {
      r.defs[0].oneShot = true;
    });
    expect(parseNodeDefs(raw).tree.oneShot).toBe(true);
  });

  it('leaves oneShot and clearLoot undefined when the def omits them', () => {
    const def = parseNodeDefs(validRaw()).tree;
    expect(def.oneShot).toBeUndefined();
    expect(def.clearLoot).toBeUndefined();
  });

  it('rejects a non-boolean oneShot', () => {
    const raw = withRaw((r) => {
      r.defs[0].oneShot = 'yes';
    });
    expect(() => parseNodeDefs(raw)).toThrow(/oneShot must be a boolean/);
  });

  it('parses a valid clearLoot table through to the def, defaulting a drop weight to 1', () => {
    const raw = withRaw((r) => {
      r.defs[0].clearLoot = {
        rolls: 1,
        drops: [
          { itemId: 'wood', min: 1, max: 2, weight: 2 },
          { itemId: 'stone', min: 1, max: 1 }, // weight omitted -> defaults to 1
        ],
      };
    });
    expect(parseNodeDefs(raw).tree.clearLoot).toEqual({
      rolls: 1,
      drops: [
        { itemId: 'wood', min: 1, max: 2, weight: 2 },
        { itemId: 'stone', min: 1, max: 1, weight: 1 },
      ],
    });
  });

  it('rejects a clearLoot drop naming an unknown item id', () => {
    const raw = withRaw((r) => {
      r.defs[0].clearLoot = {
        rolls: 1,
        drops: [{ itemId: 'unobtainium', min: 1, max: 1, weight: 1 }],
      };
    });
    expect(() => parseNodeDefs(raw)).toThrow(
      /clearLoot\.drops\[0\]\.itemId "unobtainium" is not a known/,
    );
  });

  it('rejects a clearLoot table with no drops', () => {
    const raw = withRaw((r) => {
      r.defs[0].clearLoot = { rolls: 1, drops: [] };
    });
    expect(() => parseNodeDefs(raw)).toThrow(/clearLoot\.drops must be non-empty/);
  });
});
