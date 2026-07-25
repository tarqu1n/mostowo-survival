/**
 * Typed access to the generated **tile edge set** files (`public/assets/tilesets/pixel-crawler/
 * edge-sets/<id>.json`, `scripts/pixel-crawler/bake_edge_set.py`, `docs/BIOMES.md`) — plan 052 Step 7's
 * first consumer (per `biomeDefs.ts`'s module doc: "no typed edge-set-catalog loader exists yet
 * either — naturally Step 7's job"). Mirrors `terrainCatalog.ts`'s posture: a light structural narrow
 * (not a strict `parseBiomeDefs`-style validator), since these files are machine-generated and
 * committed, not hand-authored — re-run the baker if a shape assumption here ever breaks.
 *
 * Two methods, see `docs/BIOMES.md`'s "Two methods" table:
 * - **blob** (`grass`, `mud`): alpha-cutout autotile. `mapping[blobKey]` is a LIST of `[frame, rot]`
 *   OPTIONS (unlike the older, simpler `terrains.json`/`autotile.ts` `TerrainMapping`, which is one
 *   canonical frame per key with no rotation) — the baker keeps every rotation/option for edge variety,
 *   picked randomly at bake time (`biomeGen/terrain.ts`, Step 7). `surfaces[0].edged` is reserved for a
 *   future edge-matched (Wang) generator and unused by anything today — not modelled here.
 * - **depth** (`water`): opaque colour-ramp levels joined by dual-grid corner autotiles (`transitions`,
 *   one per adjacent level pair) + a land/water `coast` autotile + per-level `variants`. `generate`
 *   carries the lake generator's tuning (BFS distance bands, noise amp/scale/seed, scatter rate) — the
 *   generator itself is ported into `biomeGen/terrain.ts` using this codebase's shared seeded RNG
 *   (`rng.ts`/`noise.ts`), NOT NumPy, so it's deterministic-but-not-bit-identical to the offline demo.
 *   A level with no real sheet frame (`authored`/`fillAuthored`) carries `fillAsset` — a real committed
 *   PNG (`<id>-<levelName>-fill.png`, sibling to this JSON) for `TileSource{kind:'image'}` to reference;
 *   the demo's synthesized-rectangle pixels never touch the actual game.
 */

// ---- Blob method ----

/** `[frame, rotation]` — rotation is 0|90|180|270 degrees, matching `TilePaletteEntry.rotation`. */
export type FrameOption = [frame: number, rot: number];

export interface BlobSurface {
  role: string;
  walkable: boolean;
  /** The plain/default interior frame (drawn at rot 0 for a fully-surrounded cell most of the time). */
  base: number;
  accents: number[];
  /** Open (seam-safe in any rotation) `[frame, rot]` options — scattered as occasional accents over
   *  `base` for texture, and as the fallback pool for the fully-surrounded (`FULL_KEY`) case. */
  variants: FrameOption[];
}

export interface BlobEdgeSet {
  method: 'blob';
  id: string;
  name: string;
  pack: string;
  sheet: string;
  cols: number;
  /** 8-neighbour blob key (see `autotile.ts` `blobKey`) -> weighted-random `[frame, rot]` options. */
  mapping: Record<number, FrameOption[]>;
  surfaces: BlobSurface[];
}

// ---- Depth method ----

export interface DepthLevel {
  name: string;
  walkable: boolean;
  rgb: [number, number, number];
  /** A real sheet frame for this level's default background, or `null` when `fillAuthored`/`authored`
   *  (no such frame exists in the art — use `fillAsset` instead). */
  fill: number | null;
  /** The default background is `fillAsset` (a flat synthesized tile), but `variants` (real decorated
   *  frames) still scatter in as occasional accents. */
  fillAuthored?: boolean;
  /** No real frame at all for this level, ever — always `fillAsset`. */
  authored?: boolean;
  /** Real sheet frames (fill + surface decoration) scattered in per `generate.scatterRate`. */
  variants: number[];
  /** Relative filename (sibling to this edge-set's JSON, i.e. under the same `edge-sets/` dir) of a
   *  real, committed flat-colour PNG — present iff `authored` or `fillAuthored`. */
  fillAsset?: string;
}

export interface DepthTransitionBlock {
  /** Level index (into `DepthEdgeSet.levels`) on the "bright"/shallower side of this pair. */
  from: number;
  /** Level index on the "dark"/deeper side of this pair. */
  to: number;
  /** Corner case (4 bits, `1` where the corner is the shallower/`from` level, order NW NE SW SE) ->
   *  `[frame, rot]` options. */
  cases: Record<number, FrameOption[]>;
}

export interface DepthGenerate {
  /** Distance-from-shore (+ noise) thresholds quantising cells into levels; ascending, one fewer entry
   *  than `levels` (band `i` is `[bands[i-1], bands[i])`, band 0 below `bands[0]`). */
  bands: number[];
  noise: { amp: number; scale: number; seed: number };
  /** Chance a level's default background rolls a decorative variant instead of its plain fill. */
  scatterRate: number;
  distance: 'bfs';
}

export interface DepthEdgeSet {
  method: 'depth';
  id: string;
  name: string;
  pack: string;
  sheet: string;
  cols: number;
  /** Ordered shallowest -> deepest. */
  levels: DepthLevel[];
  /** Land-vs-water corner case (4 bits, `1` where the corner is water) -> `[frame, rot]` options. */
  coast: { cases: Record<number, FrameOption[]> };
  /** One entry per ADJACENT level pair. */
  transitions: DepthTransitionBlock[];
  generate: DepthGenerate;
}

export type EdgeSet = BlobEdgeSet | DepthEdgeSet;

// ---- Parsing (light structural narrow — see module doc) ----

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectFrameOptions(value: unknown, path: string): FrameOption[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value.map((opt, i) => {
    if (!Array.isArray(opt) || opt.length !== 2) {
      fail(`${path}[${i}] must be a [frame, rot] pair`);
    }
    const [frame, rot] = opt as unknown[];
    if (typeof frame !== 'number' || typeof rot !== 'number') {
      fail(`${path}[${i}] must be [number, number]`);
    }
    return [frame, rot] as FrameOption;
  });
}

function expectCaseMap(value: unknown, path: string): Record<number, FrameOption[]> {
  if (!isRecord(value)) fail(`${path} must be an object`);
  const out: Record<number, FrameOption[]> = {};
  for (const [key, opts] of Object.entries(value)) {
    const k = Number(key);
    if (!Number.isInteger(k)) fail(`${path} key "${key}" must be an integer`);
    out[k] = expectFrameOptions(opts, `${path}["${key}"]`);
  }
  return out;
}

function parseBlobSurface(value: unknown, path: string): BlobSurface {
  if (!isRecord(value)) fail(`${path} must be an object`);
  const { role, walkable, base, accents, variants } = value;
  if (typeof role !== 'string' || role.length === 0)
    fail(`${path}.role must be a non-empty string`);
  if (typeof walkable !== 'boolean') fail(`${path}.walkable must be a boolean`);
  if (typeof base !== 'number' || !Number.isInteger(base)) fail(`${path}.base must be an integer`);
  if (!Array.isArray(accents)) fail(`${path}.accents must be an array`);
  return {
    role,
    walkable,
    base,
    accents: accents as number[],
    variants: expectFrameOptions(variants, `${path}.variants`),
  };
}

function parseBlobEdgeSet(value: Record<string, unknown>, path: string): BlobEdgeSet {
  const { id, name, pack, sheet, cols, mapping, surfaces } = value;
  if (typeof id !== 'string' || id.length === 0) fail(`${path}.id must be a non-empty string`);
  if (typeof name !== 'string') fail(`${path}.name must be a string`);
  if (typeof pack !== 'string' || pack.length === 0)
    fail(`${path}.pack must be a non-empty string`);
  if (typeof sheet !== 'string' || sheet.length === 0)
    fail(`${path}.sheet must be a non-empty string`);
  if (typeof cols !== 'number' || !Number.isInteger(cols)) fail(`${path}.cols must be an integer`);
  if (!isRecord(mapping)) fail(`${path}.mapping must be an object`);
  if (!Array.isArray(surfaces) || surfaces.length === 0) {
    fail(`${path}.surfaces must be a non-empty array`);
  }
  const parsedMapping: Record<number, FrameOption[]> = {};
  for (const [key, opts] of Object.entries(mapping)) {
    const k = Number(key);
    if (!Number.isInteger(k) || k < 0 || k > 0xff)
      fail(`${path}.mapping key "${key}" must be 0..255`);
    parsedMapping[k] = expectFrameOptions(opts, `${path}.mapping["${key}"]`);
  }
  return {
    method: 'blob',
    id,
    name,
    pack,
    sheet,
    cols,
    mapping: parsedMapping,
    surfaces: surfaces.map((s, i) => parseBlobSurface(s, `${path}.surfaces[${i}]`)),
  };
}

function parseDepthLevel(value: unknown, path: string): DepthLevel {
  if (!isRecord(value)) fail(`${path} must be an object`);
  const { name, walkable, rgb, fill, fillAuthored, authored, variants, fillAsset } = value;
  if (typeof name !== 'string' || name.length === 0)
    fail(`${path}.name must be a non-empty string`);
  if (typeof walkable !== 'boolean') fail(`${path}.walkable must be a boolean`);
  if (!Array.isArray(rgb) || rgb.length !== 3) fail(`${path}.rgb must be a [r, g, b] triple`);
  if (
    fill !== null &&
    fill !== undefined &&
    (typeof fill !== 'number' || !Number.isInteger(fill))
  ) {
    fail(`${path}.fill must be an integer, null, or absent`);
  }
  if (!Array.isArray(variants)) fail(`${path}.variants must be an array`);
  const isAuthored = authored === true;
  const isFillAuthored = fillAuthored === true;
  if ((isAuthored || isFillAuthored) && typeof fillAsset !== 'string') {
    fail(`${path}.fillAsset must be a string when authored/fillAuthored is true`);
  }
  return {
    name,
    walkable,
    rgb: rgb as [number, number, number],
    fill: fill ?? null,
    variants: variants as number[],
    ...(isFillAuthored ? { fillAuthored: true } : {}),
    ...(isAuthored ? { authored: true } : {}),
    ...(typeof fillAsset === 'string' ? { fillAsset } : {}),
  };
}

function parseDepthTransition(value: unknown, path: string): DepthTransitionBlock {
  if (!isRecord(value)) fail(`${path} must be an object`);
  const { from, to, cases } = value;
  if (typeof from !== 'number' || !Number.isInteger(from)) fail(`${path}.from must be an integer`);
  if (typeof to !== 'number' || !Number.isInteger(to)) fail(`${path}.to must be an integer`);
  return { from, to, cases: expectCaseMap(cases, `${path}.cases`) };
}

function parseDepthGenerate(value: unknown, path: string): DepthGenerate {
  if (!isRecord(value)) fail(`${path} must be an object`);
  const { bands, noise, scatterRate, distance } = value;
  if (!Array.isArray(bands)) fail(`${path}.bands must be an array`);
  if (!isRecord(noise)) fail(`${path}.noise must be an object`);
  const { amp, scale, seed } = noise;
  if (typeof amp !== 'number') fail(`${path}.noise.amp must be a number`);
  if (typeof scale !== 'number') fail(`${path}.noise.scale must be a number`);
  if (typeof seed !== 'number') fail(`${path}.noise.seed must be a number`);
  if (typeof scatterRate !== 'number') fail(`${path}.scatterRate must be a number`);
  if (distance !== 'bfs') fail(`${path}.distance must be 'bfs'`);
  return { bands: bands as number[], noise: { amp, scale, seed }, scatterRate, distance };
}

function parseDepthEdgeSet(value: Record<string, unknown>, path: string): DepthEdgeSet {
  const { id, name, pack, sheet, cols, levels, coast, transitions, generate } = value;
  if (typeof id !== 'string' || id.length === 0) fail(`${path}.id must be a non-empty string`);
  if (typeof name !== 'string') fail(`${path}.name must be a string`);
  if (typeof pack !== 'string' || pack.length === 0)
    fail(`${path}.pack must be a non-empty string`);
  if (typeof sheet !== 'string' || sheet.length === 0)
    fail(`${path}.sheet must be a non-empty string`);
  if (typeof cols !== 'number' || !Number.isInteger(cols)) fail(`${path}.cols must be an integer`);
  if (!Array.isArray(levels) || levels.length < 2) {
    fail(`${path}.levels must be an array of at least 2 levels`);
  }
  if (!isRecord(coast)) fail(`${path}.coast must be an object`);
  if (!Array.isArray(transitions)) fail(`${path}.transitions must be an array`);
  return {
    method: 'depth',
    id,
    name,
    pack,
    sheet,
    cols,
    levels: levels.map((l, i) => parseDepthLevel(l, `${path}.levels[${i}]`)),
    coast: { cases: expectCaseMap(coast.cases, `${path}.coast.cases`) },
    transitions: transitions.map((t, i) => parseDepthTransition(t, `${path}.transitions[${i}]`)),
    generate: parseDepthGenerate(generate, `${path}.generate`),
  };
}

/** Narrow an unknown JSON value fetched from `edge-sets/<id>.json` into an `EdgeSet`. Throws with a
 *  short message on an unrecognisable shape (a regen that broke the baker, wrong file, etc). */
export function parseEdgeSet(json: unknown, path = 'edgeSet'): EdgeSet {
  if (!isRecord(json)) fail(`${path}: expected an object`);
  const { method } = json;
  if (method === 'blob') return parseBlobEdgeSet(json, path);
  if (method === 'depth') return parseDepthEdgeSet(json, path);
  fail(`${path}.method must be 'blob' or 'depth', got ${JSON.stringify(method)}`);
}
