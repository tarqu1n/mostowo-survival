import { describe, it, expect } from 'vitest';
import { ITEMS } from '../items';
import { NODES } from '../nodes';
import { BUILDABLES } from '../buildables';
import { ENEMIES } from '../enemies';
import { MONSTER_WEAPONS } from '../weapons';
import { ACTIVE_TILESET } from '../tileset';

// Pure-data invariant tests: catch a data-edit regression (a typo'd item id, a stat that breaks
// an assumption another test suite relies on) cheaply, without touching Phaser or the systems
// that consume this data. These modules import no Phaser, so this runs in plain Node.

describe('ITEMS', () => {
  it('every entry is keyed by its own id', () => {
    for (const [key, item] of Object.entries(ITEMS)) {
      expect(item.id).toBe(key);
    }
  });

  it('every maxStack is a positive integer', () => {
    for (const item of Object.values(ITEMS)) {
      expect(Number.isInteger(item.maxStack)).toBe(true);
      expect(item.maxStack).toBeGreaterThan(0);
    }
  });

  it('every icon is a non-empty filename', () => {
    for (const item of Object.values(ITEMS)) {
      expect(typeof item.icon).toBe('string');
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('NODES', () => {
  it('every entry is keyed by its own id', () => {
    for (const [key, node] of Object.entries(NODES)) {
      expect(node.id).toBe(key);
    }
  });

  it('every yieldItemId references a real item', () => {
    for (const node of Object.values(NODES)) {
      expect(ITEMS[node.yieldItemId]).toBeDefined();
    }
  });

  it('maxHp is a sane positive integer', () => {
    for (const node of Object.values(NODES)) {
      expect(Number.isInteger(node.maxHp)).toBe(true);
      expect(node.maxHp).toBeGreaterThan(0);
    }
  });

  it('yieldPerHit, regrowMs and tilesTall are positive', () => {
    for (const node of Object.values(NODES)) {
      expect(node.yieldPerHit).toBeGreaterThan(0);
      expect(node.regrowMs).toBeGreaterThan(0);
      expect(node.tilesTall).toBeGreaterThan(0);
    }
  });

  it("tree.id === 'tree' and yields wood; rock.id === 'rock' and yields stone", () => {
    expect(NODES.tree.id).toBe('tree');
    expect(NODES.tree.yieldItemId).toBe('wood');
    expect(NODES.rock.id).toBe('rock');
    expect(NODES.rock.yieldItemId).toBe('stone');
  });
});

describe('BUILDABLES', () => {
  it('every entry is keyed by its own id', () => {
    for (const [key, buildable] of Object.entries(BUILDABLES)) {
      expect(buildable.id).toBe(key);
    }
  });

  it('every cost key references a real item id', () => {
    for (const buildable of Object.values(BUILDABLES)) {
      for (const itemId of Object.keys(buildable.cost)) {
        expect(ITEMS[itemId]).toBeDefined();
      }
    }
  });

  it('every cost amount is a positive integer', () => {
    for (const buildable of Object.values(BUILDABLES)) {
      for (const amount of Object.values(buildable.cost)) {
        expect(Number.isInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThan(0);
      }
    }
  });

  it('maxHp is a sane positive integer', () => {
    for (const buildable of Object.values(BUILDABLES)) {
      expect(Number.isInteger(buildable.maxHp)).toBe(true);
      expect(buildable.maxHp).toBeGreaterThan(0);
    }
  });

  it("wall costs wood, and ITEMS.wood exists", () => {
    expect(BUILDABLES.wall.cost.wood).toBeGreaterThan(0);
    expect(ITEMS.wood).toBeDefined();
  });
});

describe('ENEMIES', () => {
  it('every entry is keyed by its own id', () => {
    for (const [key, enemy] of Object.entries(ENEMIES)) {
      expect(enemy.id).toBe(key);
    }
  });

  it('speed and vision are positive where defined', () => {
    for (const enemy of Object.values(ENEMIES)) {
      expect(enemy.speed).toBeGreaterThan(0);
      if (enemy.vision !== undefined) {
        expect(enemy.vision).toBeGreaterThan(0);
      }
    }
  });

  it('maxHp is a sane positive integer', () => {
    for (const enemy of Object.values(ENEMIES)) {
      expect(Number.isInteger(enemy.maxHp)).toBe(true);
      expect(enemy.maxHp).toBeGreaterThan(0);
    }
  });

  it('kidZombie has the maxHp/strength values the combat unit tests assume a 3-hit kill on', () => {
    // Pinned so a data edit that changes the kid zombie's effective toughness is caught here,
    // not silently in an unrelated combat test failure.
    expect(ENEMIES.kidZombie.maxHp).toBe(3);
    expect(ENEMIES.kidZombie.strength).toBe(1);
    expect(ENEMIES.kidZombie.armour).toBe(0);
    expect(ENEMIES.kidZombie.dodge).toBe(0);
  });
});

describe('monster weapons + attach anchors', () => {
  const enemy = ACTIVE_TILESET.actors.enemy;
  const enemyStrips = [enemy.idle, enemy.walk, enemy.death];

  it('every enemy strip hand anchor set has exactly one anchor per frame', () => {
    // Anchors are meaningless except per-frame; a length mismatch would pin a weapon/fist to a stale
    // frame. Both slots (mainHand grip + offHand free) are asserted. Cheap, co-located on the strip.
    for (const strip of enemyStrips) {
      for (const anchors of [strip.anchors?.mainHand, strip.anchors?.offHand]) {
        if (anchors) expect(anchors.length).toBe(strip.frames);
      }
    }
  });

  it('the hand mitt art resolves and the strips that grip it carry both hand slots', () => {
    // The fists are layered every tick — missing art would render nothing; a strip with a mainHand
    // (weapon-gripping) anchor but no offHand would show a one-handed skeleton.
    expect(enemy.hand.source.kind).toBe('image');
    for (const strip of [enemy.idle, enemy.walk]) {
      expect(strip.anchors?.mainHand, 'gripping strip missing mainHand').toBeDefined();
      expect(strip.anchors?.offHand, 'gripping strip missing offHand').toBeDefined();
    }
  });

  it('every weaponPool id resolves in BOTH the stats catalogue and the manifest art catalogue', () => {
    for (const e of Object.values(ENEMIES)) {
      for (const id of e.weaponPool ?? []) {
        expect(MONSTER_WEAPONS[id], `missing stats for weapon '${id}'`).toBeDefined();
        expect(enemy.weapons[id], `missing art for weapon '${id}'`).toBeDefined();
      }
    }
  });

  it('every manifest weapon scale, when set, is an integer (crisp at integer zoom)', () => {
    for (const art of Object.values(enemy.weapons)) {
      if (art.scale !== undefined) expect(Number.isInteger(art.scale)).toBe(true);
    }
  });

  it('MONSTER_WEAPONS entries are keyed by their own id with positive damage + cadence', () => {
    for (const [key, w] of Object.entries(MONSTER_WEAPONS)) {
      expect(w.id).toBe(key);
      expect(w.damage).toBeGreaterThan(0);
      expect(w.attackMs).toBeGreaterThan(0);
    }
  });
});
