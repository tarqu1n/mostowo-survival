/**
 * Tier-1 world-integrity check (plan 014 step 11). Unlike the game's lazy `mapRuntime` registry,
 * the test context may load EVERYTHING: eagerly import every committed `*.map.json` + `world.json`,
 * run `parseMap` on each, and `validateWorld` across them all. CI enforcement of world consistency
 * without burdening game runtime — any committed map that fails to parse, or any placement overlap /
 * unknown-mapId, fails the build. Warnings (seam mismatches, islands, unplaced maps) are printed,
 * not asserted (they're legitimate — see the ERROR/WARNING split in worldLayout.ts).
 */

import { describe, it, expect } from 'vitest';
import { migrateMap, type MapFile } from '../../../systems/mapFormat';
import { parseWorldLayout, validateWorld } from '../../../systems/worldLayout';
import { NODES } from '../../nodes';
import worldJson from '../world.json';
import catalogJson from '../../../../public/assets/asset-catalog.json';

// Eager glob — the whole map payload is fine to pull into the test bundle (not the game bundle).
const mapModules = import.meta.glob<unknown>('../*.map.json', {
  eager: true,
  import: 'default',
});

/** All committed maps keyed by their `meta.id`, each already narrowed through `migrateMap`. */
const maps: Record<string, MapFile> = {};
for (const raw of Object.values(mapModules)) {
  const map = migrateMap(raw);
  maps[map.meta.id] = map;
}

describe('world integrity', () => {
  it('has at least one committed map', () => {
    expect(Object.keys(maps).length).toBeGreaterThan(0);
  });

  it('every committed map parses', () => {
    // migrateMap above already threw on any invalid map; this documents the guarantee.
    for (const [id, map] of Object.entries(maps)) {
      expect(map.meta.id).toBe(id);
    }
  });

  it('world.json + all maps validate with zero errors', () => {
    const layout = parseWorldLayout(worldJson);
    const { errors, warnings } = validateWorld(layout, maps);
    if (warnings.length > 0) {
      console.warn(`[world integrity] ${warnings.length} warning(s):\n  ${warnings.join('\n  ')}`);
    }
    expect(errors).toEqual([]);
  });

  // Node registry cross-refs (plan 021 step 6). `parseMap` is NODES-blind (it validates a node
  // object's shape but not its `ref`/`skin` against the def registry — see NodeObject's doc), so
  // these committed-content checks live here, where the test context can import NODES + the catalog.
  it('every placed node references a known def, and any authored skin is one of that def’s skins', () => {
    for (const [mapId, map] of Object.entries(maps)) {
      for (const obj of map.objects) {
        if (obj.kind !== 'node') continue;
        const def = NODES[obj.ref];
        expect(def, `map "${mapId}" node "${obj.id}" ref "${obj.ref}" ∉ NODES`).toBeDefined();
        if (obj.skin !== undefined) {
          const skinIds = def.skins.map((s) => s.id);
          expect(
            skinIds,
            `map "${mapId}" node "${obj.id}" skin "${obj.skin}" ∉ def "${obj.ref}" skins [${skinIds.join(', ')}]`,
          ).toContain(obj.skin);
        }
      }
    }
  });

  it('every node-def skin (live + depleted) references an asset in the committed catalog', () => {
    const catalogIds = new Set(catalogJson.assets.map((a) => a.id));
    for (const def of Object.values(NODES)) {
      for (const skin of def.skins) {
        expect(
          catalogIds,
          `def "${def.id}" skin "${skin.id}" asset "${skin.asset}" ∉ catalog`,
        ).toContain(skin.asset);
        if (skin.depleted) {
          expect(
            catalogIds,
            `def "${def.id}" skin "${skin.id}" depleted asset "${skin.depleted.asset}" ∉ catalog`,
          ).toContain(skin.depleted.asset);
        }
      }
    }
  });
});
