/**
 * Plan 052 Step 9 — the `BiomeResult` shape `generateBiome` (`index.ts`) returns: everything Step 10's
 * editor slice needs to bake a biome application into a real `MapFile` as one undoable batch. Pure
 * data, no Phaser. Region-local throughout (see `terrain.ts`/`scatter.ts` module docs) — Step 10
 * translates into absolute map coordinates using the region rect's own origin.
 *
 * Deviates from the plan's original pre-Step-7/8 sketch (`tileEdits: Array<{layerRole,frames}>`) now
 * that Steps 7/8 have landed with concrete types: `tileEdits` reuses Step 7's own `TerrainLayer[]`
 * (`{layerRole,cells}`, `cells: TerrainCell[]`) rather than a redundant near-identical shape, and
 * `objects` reuses Step 8's own `ScatterPlacement[]` (which now carries `layerId` so `meta.counts` can
 * be computed per scatter layer after exclusion/falloff).
 */

import type { TerrainLayer } from './terrain';
import type { ScatterPlacement } from './scatter';

export interface BiomeResult {
  tileEdits: TerrainLayer[];
  objects: ScatterPlacement[];
  meta: {
    seed: number;
    /** Final placement count per scatter layer id (`BiomeScatterLayer.id`), AFTER exclusion +
     *  edge-falloff — feeds Step 11's live count-estimate UI. */
    counts: Record<string, number>;
  };
}
