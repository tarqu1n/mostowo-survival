/**
 * Plan 052 Step 8 — the biome generator's scatter stage: per `scatter` layer (ground detail / foliage /
 * nodes / berries, `BiomeScatterLayer`), Poisson-disk-samples candidate points across the region at the
 * layer's `spacing`, thins them against a shared value/fbm noise **density field**, chooses a member via
 * `pickWeighted`, skips cells whose Step-7 edge-set assignment is in `avoidTerrains`, and optionally
 * drops a parent→children `clump`. Pure — no Phaser, no map mutation; Step 9's orchestrator composes
 * this with Step 7's `generateTerrain` and Step 10 bakes the result into a real `MapFile`.
 *
 * **Output coordinate contract (region-local — Step 9/10 translate to absolute map coordinates):**
 * `kind: 'node'` placements carry integer `col`/`row` (tile-addressed, matching `NodeObject`); Step 9
 * adds the region rect's own `col`/`row` origin. `kind: 'decor'` placements carry `x`/`y` already
 * converted to PIXELS (`TILE_SIZE`-scaled, sub-tile precision kept — matching `DecorObject.x`/`y`); Step
 * 9 adds the region rect's origin in pixels (`rect.col * TILE_SIZE`, `rect.row * TILE_SIZE`).
 *
 * **Field-seeding note (why this reproduces the SAME noise field as `terrain.ts`, not just a
 * similarly-tuned one):** `generateTerrain`'s `assignBands` does `makeRng(seed)` then `makeNoise2D(rng)`
 * as its very first action, before consuming any other randomness. `generateScatter` does the exact same
 * thing with the same `seed` — so as long as the caller (Step 9) passes the biome's ONE seed to both
 * calls (and the same `terrain.field` params, since `BiomeScatterLayer` carries no field of its own),
 * the two noise lattices are byte-identical. That's what makes this genuinely the "shared height/
 * moisture field" the plan's Summary describes as driving both terrain patches AND "clearings vs.
 * thickets" — not a separate lookalike field. The two calls then diverge into independent `Rng`
 * instances, so scatter's own downstream draws (Poisson, member picks, clumps) never disturb terrain's.
 */

import type { Dims } from '../autotile';
import type { Rng } from '../rng';
import { makeRng } from '../rng';
import type { Noise2D } from '../noise';
import { makeNoise2D } from '../noise';
import { poissonSample } from '../poisson';
import { pickWeighted } from '../../data/tileset';
import { TILE_SIZE } from '../../config';
import type { BiomeScatterLayer, BiomeScatterMember } from '../biomeDefs';

export type ScatterPlacement =
  | { kind: 'node'; ref: string; col: number; row: number; skin?: string }
  | { kind: 'decor'; asset: string; x: number; y: number };

export interface ScatterGenInput {
  region: Dims;
  /** Processed in array order — this IS the "layer stack order" the module doc + plan refer to. */
  layers: readonly BiomeScatterLayer[];
  /** The biome's shared height/moisture field params (`BiomeTerrain.field`) — see module doc's
   *  field-seeding note for why passing the SAME `seed` as `generateTerrain` reproduces the same field. */
  field: { scale: number; octaves: number };
  seed: number;
  /** Step 7's per-cell edge-set assignment (`TerrainGenResult.cellEdgeSet`, region-local row-major) —
   *  read for `avoidTerrains`. */
  cellEdgeSet: readonly string[];
}

export interface ScatterGenResult {
  /** In layer stack order; within a layer, each Poisson-sampled parent is immediately followed by its
   *  clump children (if any). */
  placements: ScatterPlacement[];
}

function edgeSetAt(
  cellEdgeSet: readonly string[],
  dims: Dims,
  col: number,
  row: number,
): string | undefined {
  if (col < 0 || col >= dims.cols || row < 0 || row >= dims.rows) return undefined;
  return cellEdgeSet[row * dims.cols + col];
}

function isAvoided(
  layer: BiomeScatterLayer,
  cellEdgeSet: readonly string[],
  dims: Dims,
  x: number,
  y: number,
): boolean {
  if (!layer.avoidTerrains || layer.avoidTerrains.length === 0) return false;
  const id = edgeSetAt(cellEdgeSet, dims, Math.floor(x), Math.floor(y));
  return id !== undefined && layer.avoidTerrains.includes(id);
}

function toPlacement(
  layer: BiomeScatterLayer,
  member: BiomeScatterMember,
  x: number,
  y: number,
): ScatterPlacement {
  if (layer.kind === 'node') {
    return {
      kind: 'node',
      ref: member.ref,
      col: Math.floor(x),
      row: Math.floor(y),
      ...(member.skin === undefined ? {} : { skin: member.skin }),
    };
  }
  return { kind: 'decor', asset: member.ref, x: x * TILE_SIZE, y: y * TILE_SIZE };
}

/** Rolls the parent→children `clump` (if the layer has one): a `chance` roll, then `count[0]..count[1]`
 *  children scattered within `radius` tiles of the parent at a random angle/distance — deliberately
 *  NOT re-checking Poisson spacing (clustering tighter than the layer's own `spacing` is the point) but
 *  still respecting the region bounds and `avoidTerrains`, dropped (not retried) when either fails. */
function generateClumpChildren(
  layer: BiomeScatterLayer,
  dims: Dims,
  cellEdgeSet: readonly string[],
  rng: Rng,
  parentX: number,
  parentY: number,
): ScatterPlacement[] {
  const clump = layer.clump;
  if (!clump) return [];
  if (rng.nextFloat() >= clump.chance) return [];

  const span = clump.count[1] - clump.count[0];
  const count = clump.count[0] + (span > 0 ? rng.nextInt(span + 1) : 0);
  const out: ScatterPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rng.nextFloat() * Math.PI * 2;
    const dist = rng.nextFloat() * clump.radius;
    const x = parentX + Math.cos(angle) * dist;
    const y = parentY + Math.sin(angle) * dist;
    if (x < 0 || x >= dims.cols || y < 0 || y >= dims.rows) continue; // out of region — drop, no retry
    if (isAvoided(layer, cellEdgeSet, dims, x, y)) continue;
    const member = pickWeighted(layer.members, rng.nextFloat);
    out.push(toPlacement(layer, member, x, y));
  }
  return out;
}

export function generateScatter(input: ScatterGenInput): ScatterGenResult {
  const { region, layers, field, seed, cellEdgeSet } = input;
  const rng = makeRng(seed);
  const noise: Noise2D = makeNoise2D(rng); // same seed => byte-identical to terrain.ts's field, see module doc

  const placements: ScatterPlacement[] = [];
  for (const layer of layers) {
    const points = poissonSample({
      width: region.cols,
      height: region.rows,
      radius: layer.spacing,
      rng,
      accept: (x, y) => {
        if (isAvoided(layer, cellEdgeSet, region, x, y)) return false;
        return noise.fbm(x, y, field) * layer.density;
      },
    });

    for (const point of points) {
      const member = pickWeighted(layer.members, rng.nextFloat);
      placements.push(toPlacement(layer, member, point.x, point.y));
      placements.push(...generateClumpChildren(layer, region, cellEdgeSet, rng, point.x, point.y));
    }
  }

  return { placements };
}
