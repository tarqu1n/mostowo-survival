/**
 * Plan 052 Step 9 — the biome generator's single entry point: composes Step 7's `generateTerrain` and
 * Step 8's `generateScatter` into one `BiomeResult`, then applies the two cross-cutting concerns the
 * plan calls out that neither sub-generator can do on its own:
 *
 * - **Exclusion**: a caller-injected `existing` predicate pair (`isInside`/`isOccupied`, both
 *   region-local — see `BiomeGenExisting` doc) drops any tile edit or object placement that lands
 *   outside the map's void/shape mask or on top of something already there. Both are optional and
 *   default fully permissive, so a bare region with no map context (unit tests) works unchanged.
 *   Deliberately NOT a `MapFile` import — keeps this module decoupled/pure; Step 10 (which HAS a real
 *   `MapFile`) supplies the closures, translating region-local `(col,row)` to absolute map coordinates
 *   itself. This intentionally does NOT clip water's dual-grid overhang cells (`0..cols`/`0..rows`
 *   inclusive, per `terrain.ts`'s module doc) to the region's own bounds either — same reasoning: Step
 *   7 already declined to clip them, and the caller's `isInside` (evaluated at the true absolute
 *   position) is what correctly rejects a cell that's actually outside the map.
 * - **Edge-falloff**: SCATTER placements only (not terrain tile edits, which are a deterministic
 *   threshold fill, not a "density" concept) get probabilistically thinned the closer they are to the
 *   region's own border, via an independent seeded `Rng` stream (never the terrain/scatter generators'
 *   own streams) so a biome patch blends into its surroundings rather than reading as a hard rectangle.
 *
 * Deviates from the plan's original `generateBiome(region, biomeDef, seed, existing)` positional sketch
 * (predates Steps 7/8 landing): takes one input object (matching `terrain.ts`/`scatter.ts`'s own
 * convention) and an explicit `edgeSets` param, since Step 7 needs the loaded tile-edge-set catalog and
 * a pure module can't synthesize that itself.
 */

import type { Dims } from '../autotile';
import type { EdgeSet } from '../edgeSets';
import type { BiomeDef } from '../biomeDefs';
import { makeRng } from '../rng';
import { TILE_SIZE } from '../../config';
import { generateTerrain } from './terrain';
import { generateScatter } from './scatter';
import type { ScatterPlacement } from './scatter';
import type { BiomeResult } from './types';

export type { BiomeResult } from './types';
export type { TerrainLayer, TerrainCell, LayerRole } from './terrain';
export type { ScatterPlacement } from './scatter';

/** Region-local exclusion predicates the caller (Step 10) injects — see module doc. Both optional and
 *  default fully permissive. */
export interface BiomeGenExisting {
  /** `(col,row)` → true if inside the map's void/shape mask. Omitted ⇒ always true. */
  isInside?: (col: number, row: number) => boolean;
  /** `(col,row)` → true if this cell already holds something the biome must not overwrite. Omitted ⇒
   *  always false (nothing occupied). */
  isOccupied?: (col: number, row: number) => boolean;
}

export interface BiomeGenInput {
  region: Dims;
  biome: BiomeDef;
  seed: number;
  /** Every edge set `biome.terrain` references — see `TerrainGenInput.edgeSets`. */
  edgeSets: Record<string, EdgeSet>;
  existing?: BiomeGenExisting;
}

/** Width of the border band (in tiles) over which scatter density tapers from 0 (right at the region's
 *  edge) to full density (`FALLOFF_BAND_TILES` tiles or more in from every edge) — see module doc's
 *  edge-falloff bullet. A tunable generation-time constant, not part of `BiomeDef` schema (falloff is
 *  blending, not authored biome content). */
const FALLOFF_BAND_TILES = 3;

/** XORed into `seed` for the falloff thinning's own `Rng` stream — keeps it independent of (and never
 *  disturbed by, nor disturbing) `generateTerrain`/`generateScatter`'s own seeded streams. */
const FALLOFF_SEED_SALT = 0x9e3779b9;

function isFree(existing: BiomeGenExisting, col: number, row: number): boolean {
  const inside = existing.isInside ? existing.isInside(col, row) : true;
  if (!inside) return false;
  const occupied = existing.isOccupied ? existing.isOccupied(col, row) : false;
  return !occupied;
}

/** Region-local tile-space position of a placement — decor's `x`/`y` are pixels (see `scatter.ts`),
 *  converted back to (possibly fractional) tile coordinates for the exclusion/falloff checks below. */
function placementTile(placement: ScatterPlacement): { col: number; row: number } {
  return placement.kind === 'node'
    ? { col: placement.col, row: placement.row }
    : { col: placement.x / TILE_SIZE, row: placement.y / TILE_SIZE };
}

/** `clamp(distanceToNearestEdge / FALLOFF_BAND_TILES, 0, 1)` — 0 right at the region border, 1 once
 *  `FALLOFF_BAND_TILES` tiles or more in from every edge. */
function falloffFactor(region: Dims, col: number, row: number): number {
  const dist = Math.min(col, row, region.cols - 1 - col, region.rows - 1 - row);
  return Math.max(0, Math.min(1, dist / FALLOFF_BAND_TILES));
}

export function generateBiome(input: BiomeGenInput): BiomeResult {
  const { region, biome, seed, edgeSets, existing = {} } = input;

  const terrainResult = generateTerrain({ region, terrain: biome.terrain, seed, edgeSets });
  const scatterResult = generateScatter({
    region,
    layers: biome.scatter,
    field: biome.terrain.field,
    seed,
    cellEdgeSet: terrainResult.cellEdgeSet,
  });

  const tileEdits = terrainResult.layers.map((layer) => ({
    layerRole: layer.layerRole,
    cells: layer.cells.filter((cell) => isFree(existing, cell.col, cell.row)),
  }));

  const falloffRng = makeRng((seed ^ FALLOFF_SEED_SALT) >>> 0);
  const objects: ScatterPlacement[] = [];
  const counts: Record<string, number> = {};
  for (const placement of scatterResult.placements) {
    const { col, row } = placementTile(placement);
    if (!isFree(existing, Math.floor(col), Math.floor(row))) continue;
    if (falloffRng.nextFloat() >= falloffFactor(region, col, row)) continue;
    objects.push(placement);
    counts[placement.layerId] = (counts[placement.layerId] ?? 0) + 1;
  }

  return { tileEdits, objects, meta: { seed, counts } };
}
