/**
 * Plan 052 Step 7 — the biome generator's terrain stage. Given a region, a `BiomeTerrain` (the shared
 * height/moisture field + its sorted threshold bands, `biomeDefs.ts`) and a seed, produces the baked
 * tile frames for that patch: a **base terrain** (e.g. grass) as an ALPHA-CUTOUT OVERLAY autotiled
 * against a mask, and every band (e.g. mud, water) painted on the **base** role underneath it. Pure —
 * no Phaser, no map mutation; the caller (Step 9's orchestrator, then Step 10) bakes the returned
 * frames into a real `MapFile`.
 *
 * **Why the base terrain is the OVERLAY, not the bands** (the "hole" technique, confirmed against the
 * hand-authored map — see `docs/BIOMES.md`'s "Worked example: muddy patches"): a band terrain (mud) is
 * a flat, opaque fill painted under its whole footprint; the base terrain's OWN alpha-cutout blob tiles
 * are painted on a layer ABOVE it, with a mask that's a HOLE wherever a band claims the cell — the
 * hole is what lets the band's flat fill show through, and the base terrain's semi-transparent edge
 * pixels are what blend the boundary. This generalises past the mud precedent to every band regardless
 * of its edge-set `method`: a `'blob'`-method band (mud) never runs its OWN autotiling in this
 * composition (no edge tiles, just its flat `surfaces[0].base` fill — the base terrain's edge tiles do
 * 100% of the visual blending); a `'depth'`-method band (water) is fully opaque and self-contained (its
 * own `coast` autotile already bakes a matching land shade into the tile art), so it also just paints
 * directly onto the base role, no hole/overlay trick needed for IT specifically.
 *
 * **Known visual caveat, not a correctness bug:** water's `coast` tiles are baked to colour-match
 * `grass` (see `docs/BIOMES.md`'s "Match the coast's terrain shade to the ground" gotcha). The Forest
 * preset's band order (water's `maxHeight` lower than mud's) means a pond's shore always borders MUD
 * cells, never grass directly — so the coast tile's baked-in shore shade may read as a slight mismatch
 * against mud. This doesn't affect tiling correctness (every corner case still resolves to a real
 * frame); it's a content-tuning call for whoever eyeballs the rendered Forest preset (e.g. reorder the
 * bands, or pick a `mud` shade closer to grass) — flagging it here rather than silently living with it.
 *
 * **RNG note:** this ports `bake_edge_set.py`'s `depth_field` (BFS distance + noise wobble + the
 * erode/de-saddle repair) and its dual-grid coast/transition/fill placement — the ALGORITHM and its
 * invariants (every 2x2 span ≤1 level apart post-repair, saddle cases eliminated, every corner case
 * resolves to a real frame) are ported faithfully. The RANDOMNESS underneath is NOT bit-identical to
 * the Python demo's `np.random.default_rng` (impractical to replicate without reimplementing NumPy's
 * PCG64/SeedSequence, and beside the point — this runs inside the editor against this codebase's own
 * shared seeded RNG, `rng.ts`/`noise.ts`, Steps 3-4 built exactly for this). One `Rng` is threaded
 * through the whole call in a fixed order, so the same `seed` always reproduces the same result.
 */

import type { Rng } from '../rng';
import { makeRng } from '../rng';
import { makeNoise2D } from '../noise';
import type { Dims, Mask } from '../autotile';
import { blobKey, FULL_KEY } from '../autotile';
import type { BiomeTerrain } from '../biomeDefs';
import type {
  BlobEdgeSet,
  DepthEdgeSet,
  DepthGenerate,
  DepthLevel,
  EdgeSet,
  FrameOption,
} from '../edgeSets';

export type LayerRole = 'base' | 'overlay';

/** One resolved tile placement. `col`/`row` are region-local — for a `'depth'`-method band these run
 *  `0..dims.cols` / `0..dims.rows` INCLUSIVE (the dual-grid render is one tile wider/taller than the
 *  region: each display tile sits over a mask VERTEX, not a mask cell — see module doc / Step 9 note).
 *  Every other role/method stays within `0..dims.cols-1` / `0..dims.rows-1`. Exactly one of `frame`/
 *  `imageAsset` is set. `edgeSetId` is what painted this cell — the caller resolves `pack`/`sheet` (for
 *  `frame`) from `edgeSets[edgeSetId]`, or builds a `TileSource{kind:'image'}` from `imageAsset`. */
export interface TerrainCell {
  col: number;
  row: number;
  rotation: 0 | 90 | 180 | 270;
  edgeSetId: string;
  frame?: number;
  imageAsset?: string;
}

export interface TerrainLayer {
  layerRole: LayerRole;
  cells: TerrainCell[];
}

export interface TerrainGenInput {
  region: Dims;
  terrain: BiomeTerrain;
  seed: number;
  /** Every edge set this terrain references (`terrain.base` + every `bands[].edgeSetId`), keyed by id. */
  edgeSets: Record<string, EdgeSet>;
}

export interface TerrainGenResult {
  layers: TerrainLayer[];
  /** Region-local, row-major (`row * region.cols + col`) — the edge-set id governing each cell (a
   *  band's, or `terrain.base` where no band applies). Step 8's `avoidTerrains` reads this directly. */
  cellEdgeSet: readonly string[];
}

function requireEdgeSet(edgeSets: Record<string, EdgeSet>, id: string, context: string): EdgeSet {
  const set = edgeSets[id];
  if (!set) fail(`${context}: no edge set registered for id ${JSON.stringify(id)}`);
  return set;
}

function fail(message: string): never {
  throw new Error(message);
}

// ---- 1. Shared height/moisture field -> per-cell band (edge-set id) assignment ----

function assignBands(dims: Dims, terrain: BiomeTerrain, rng: Rng): string[] {
  const noise = makeNoise2D(rng);
  const { scale, octaves } = terrain.field;
  const cellEdgeSet = new Array<string>(dims.cols * dims.rows);
  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      const n = noise.fbm(col, row, { octaves, scale });
      const band = terrain.bands.find((b) => n <= b.maxHeight);
      cellEdgeSet[row * dims.cols + col] = band ? band.edgeSetId : terrain.base;
    }
  }
  return cellEdgeSet;
}

function maskFor(cellEdgeSet: readonly string[], id: string): Mask {
  return cellEdgeSet.map((cell) => (cell === id ? 1 : 0));
}

// ---- 2. Base terrain overlay (blob method, hole-punched mask) ----

/** Chance a fully-surrounded interior cell rolls a decorative accent instead of the plain base tile —
 *  ported from `paint_blob_masked`'s default `scatter=0.3`, the value `render_grass_mud_demo` (the
 *  actual reference render of this exact technique) uses. */
const OVERLAY_INTERIOR_SCATTER = 0.3;

function paintBlobOverlay(
  mask: Mask,
  dims: Dims,
  set: BlobEdgeSet,
  edgeSetId: string,
  rng: Rng,
): TerrainCell[] {
  const surf = set.surfaces[0];
  const cells: TerrainCell[] = [];
  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      if (mask[row * dims.cols + col] !== 1) continue;
      const key = blobKey(mask, dims, col, row);
      let frame: number;
      let rot: 0 | 90 | 180 | 270;
      if (key === FULL_KEY) {
        if (rng.nextFloat() < OVERLAY_INTERIOR_SCATTER && surf.variants.length > 0) {
          [frame, rot] = pickOption(surf.variants, rng);
        } else {
          frame = surf.base;
          rot = 0;
        }
      } else {
        const options = set.mapping[key] ?? set.mapping[FULL_KEY];
        if (!options || options.length === 0) {
          fail(
            `edge set "${edgeSetId}": no mapping for blob key ${key} (and no FULL_KEY fallback)`,
          );
        }
        [frame, rot] = pickOption(options, rng);
      }
      cells.push({ col, row, frame, rotation: rot, edgeSetId });
    }
  }
  return cells;
}

// ---- 3. Blob-method BAND (mud): flat opaque fill, no autotiling — see module doc ----

function paintBlobFlatFill(
  mask: Mask,
  dims: Dims,
  set: BlobEdgeSet,
  edgeSetId: string,
): TerrainCell[] {
  const base = set.surfaces[0].base;
  const cells: TerrainCell[] = [];
  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      if (mask[row * dims.cols + col] === 1) {
        cells.push({ col, row, frame: base, rotation: 0, edgeSetId });
      }
    }
  }
  return cells;
}

// ---- 4. Depth-method BAND (water): ported lake generator ----

const CARDINAL_OFFSETS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** `for dx in (-1,0,1) for dy in (-1,0,1) if dx or dy` — exact iteration order matters (see module
 *  doc): the repair pass mutates in place mid-scan, so a neighbour visited earlier in this order can
 *  affect whether a later one in the SAME cell's scan still needs an update. */
const KING_OFFSETS: ReadonlyArray<[number, number]> = (() => {
  const out: [number, number][] = [];
  for (const dx of [-1, 0, 1]) {
    for (const dy of [-1, 0, 1]) {
      if (dx !== 0 || dy !== 0) out.push([dx, dy]);
    }
  }
  return out;
})();

/** Ported `depth_field`: BFS distance-from-shore + smooth noise wobble, quantised into level indices
 *  by `generate.bands`, then repaired (erode until every king-adjacent water pair differs by <=1 level,
 *  then lower any diagonal-saddle 2x2) until stable or 80 passes. Returns level index per cell
 *  (row-major), `-1` for non-water cells. */
function depthField(waterMask: Mask, dims: Dims, generate: DepthGenerate, rng: Rng): Int32Array {
  const { cols: w, rows: h } = dims;
  const isWater = (x: number, y: number): boolean => waterMask[y * w + x] === 1;

  const dist = new Int32Array(w * h).fill(Number.MAX_SAFE_INTEGER);
  const queue: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isWater(x, y)) {
        dist[y * w + x] = 0;
        queue.push(y * w + x);
      }
    }
  }
  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const x = idx % w;
    const y = (idx / w) | 0;
    for (const [dx, dy] of CARDINAL_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (dist[nIdx] > dist[idx] + 1) {
        dist[nIdx] = dist[idx] + 1;
        queue.push(nIdx);
      }
    }
  }

  const noise = makeNoise2D(rng);
  const { amp, scale } = generate.noise;
  const wobble = (x: number, y: number): number =>
    (noise.sample(x / scale, y / scale) * 2 - 1) * amp;

  const bands = generate.bands;
  const lv = new Int32Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isWater(x, y)) continue;
      const v = dist[y * w + x] + wobble(x, y);
      let level = 0;
      for (const b of bands) if (v >= b) level++;
      lv[y * w + x] = level;
    }
  }

  for (let iter = 0; iter < 80; iter++) {
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isWater(x, y)) continue;
        const idx = y * w + x;
        for (const [dx, dy] of KING_OFFSETS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || !isWater(nx, ny)) continue;
          const nIdx = ny * w + nx;
          if (lv[idx] - lv[nIdx] > 1) {
            lv[idx] = lv[nIdx] + 1;
            changed = true;
          }
        }
      }
    }
    let saddles = 0;
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const p: Array<[number, number]> = [
          [x, y],
          [x + 1, y],
          [x, y + 1],
          [x + 1, y + 1],
        ];
        if (!p.every(([cx, cy]) => isWater(cx, cy))) continue;
        const vals = p.map(([cx, cy]) => lv[cy * w + cx]);
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        if (hi - lo !== 1) continue;
        const isHi = vals.map((v) => v === hi);
        const saddle =
          (isHi[0] && isHi[3] && !isHi[1] && !isHi[2]) ||
          (isHi[1] && isHi[2] && !isHi[0] && !isHi[3]);
        if (saddle) {
          for (let i = 0; i < 4; i++) {
            if (isHi[i]) {
              const [cx, cy] = p[i];
              lv[cy * w + cx] = lo;
            }
          }
          saddles++;
        }
      }
    }
    if (!changed && saddles === 0) break;
  }
  return lv;
}

interface FillChoice {
  frame?: number;
  asset?: string;
  rot: 0 | 90 | 180 | 270;
}

const ROTATIONS: ReadonlyArray<0 | 90 | 180 | 270> = [0, 90, 180, 270];

function rotOf(rng: Rng): 0 | 90 | 180 | 270 {
  return ROTATIONS[rng.nextInt(4)];
}

function pickOption(options: FrameOption[], rng: Rng): [number, 0 | 90 | 180 | 270] {
  const [frame, quarterTurns] = rng.pick(options);
  return [frame, ROTATIONS[quarterTurns] ?? 0];
}

/** Ported `fill_img`: a level's default background (mostly its plain fill/synthesized asset, per
 *  `generate.scatterRate` occasionally a decorated real variant instead). */
function chooseFill(level: DepthLevel, generate: DepthGenerate, rng: Rng): FillChoice {
  if (level.authored) {
    if (!level.fillAsset) fail(`depth level "${level.name}" is authored but has no fillAsset`);
    return { asset: level.fillAsset, rot: 0 };
  }
  const pool = level.variants.length > 0 ? level.variants : level.fill !== null ? [level.fill] : [];
  if (rng.nextFloat() > generate.scatterRate || pool.length === 0) {
    if (level.fillAuthored) {
      if (!level.fillAsset)
        fail(`depth level "${level.name}" is fillAuthored but has no fillAsset`);
      return { asset: level.fillAsset, rot: 0 };
    }
    if (level.fill === null)
      fail(`depth level "${level.name}" has neither a fill frame nor fillAsset`);
    return { frame: level.fill, rot: rotOf(rng) };
  }
  return { frame: rng.pick(pool), rot: rotOf(rng) };
}

function fillCell(
  level: DepthLevel,
  generate: DepthGenerate,
  rng: Rng,
  col: number,
  row: number,
  edgeSetId: string,
): TerrainCell {
  const choice = chooseFill(level, generate, rng);
  return {
    col,
    row,
    edgeSetId,
    rotation: choice.rot,
    ...(choice.frame !== undefined ? { frame: choice.frame } : { imageAsset: choice.asset }),
  };
}

/** Ported `render_depth_lake`'s per-vertex placement loop: a **dual-grid** — each rendered tile sits
 *  over a mask VERTEX and is chosen by its 4 surrounding mask cells, so the output spans
 *  `0..dims.cols` x `0..dims.rows` INCLUSIVE (one wider/taller than the mask). Coast where the corners
 *  mix water/non-water, a transition autotile where they span two adjacent levels, a solid fill where
 *  all four agree — matching `docs/BIOMES.md`'s "Place" step. Every case that isn't an exact match
 *  falls back to a fill (never an unmapped/skipped cell) — the only true skip is "all four land",
 *  where nothing needs to be drawn at all. */
function paintDepthLake(
  mask: Mask,
  dims: Dims,
  set: DepthEdgeSet,
  edgeSetId: string,
  rng: Rng,
): TerrainCell[] {
  const { cols: w, rows: h } = dims;
  const lv = depthField(mask, dims, set.generate, rng);
  const levelAt = (x: number, y: number): number => {
    if (x < 0 || x >= w || y < 0 || y >= h) return -1;
    return mask[y * w + x] === 1 ? lv[y * w + x] : -1;
  };

  const cells: TerrainCell[] = [];
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x <= w; x++) {
      const cs = [levelAt(x - 1, y - 1), levelAt(x, y - 1), levelAt(x - 1, y), levelAt(x, y)]; // NW NE SW SE
      if (cs.every((c) => c === -1)) continue; // all land -> nothing here

      if (cs.some((c) => c === -1)) {
        const caseKey =
          (cs[0] !== -1 ? 8 : 0) |
          (cs[1] !== -1 ? 4 : 0) |
          (cs[2] !== -1 ? 2 : 0) |
          (cs[3] !== -1 ? 1 : 0);
        const opts = set.coast.cases[caseKey];
        if (opts && opts.length > 0) {
          const [frame, rot] = pickOption(opts, rng);
          cells.push({ col: x, row: y, frame, rotation: rot, edgeSetId });
        } else {
          cells.push(fillCell(set.levels[0], set.generate, rng, x, y, edgeSetId));
        }
        continue;
      }

      const lo = Math.min(...cs);
      const hi = Math.max(...cs);
      if (lo === hi) {
        cells.push(fillCell(set.levels[lo], set.generate, rng, x, y, edgeSetId));
      } else if (hi - lo === 1) {
        const caseKey =
          (cs[0] === lo ? 8 : 0) |
          (cs[1] === lo ? 4 : 0) |
          (cs[2] === lo ? 2 : 0) |
          (cs[3] === lo ? 1 : 0);
        const block = set.transitions.find((t) => t.from === lo && t.to === hi);
        const opts = block?.cases[caseKey];
        if (opts && opts.length > 0) {
          const [frame, rot] = pickOption(opts, rng);
          cells.push({ col: x, row: y, frame, rotation: rot, edgeSetId });
        } else {
          cells.push(fillCell(set.levels[hi], set.generate, rng, x, y, edgeSetId));
        }
      } else {
        // Spans >1 level — the repair pass should prevent this; fall back like the Python `invalid++`
        // branch rather than drop the cell.
        cells.push(fillCell(set.levels[hi], set.generate, rng, x, y, edgeSetId));
      }
    }
  }
  return cells;
}

// ---- Orchestration ----

export function generateTerrain(input: TerrainGenInput): TerrainGenResult {
  const { region, terrain, seed, edgeSets } = input;
  const rng = makeRng(seed);

  const cellEdgeSet = assignBands(region, terrain, rng);

  const baseSet = requireEdgeSet(edgeSets, terrain.base, 'terrain.base');
  if (baseSet.method !== 'blob') {
    fail(
      `terrain.base edge set "${terrain.base}" must use the 'blob' method (got ${baseSet.method})`,
    );
  }
  const overlayMask = maskFor(cellEdgeSet, terrain.base);
  const overlayCells = paintBlobOverlay(overlayMask, region, baseSet, terrain.base, rng);

  const baseCells: TerrainCell[] = [];
  for (const band of terrain.bands) {
    const set = requireEdgeSet(edgeSets, band.edgeSetId, `terrain.bands[${band.edgeSetId}]`);
    const mask = maskFor(cellEdgeSet, band.edgeSetId);
    if (set.method === 'blob') {
      baseCells.push(...paintBlobFlatFill(mask, region, set, band.edgeSetId));
    } else {
      baseCells.push(...paintDepthLake(mask, region, set, band.edgeSetId, rng));
    }
  }

  return {
    layers: [
      { layerRole: 'overlay', cells: overlayCells },
      { layerRole: 'base', cells: baseCells },
    ],
    cellEdgeSet,
  };
}
