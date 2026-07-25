/**
 * Authored biome schema + a single validating choke point (`parseBiomeDefs`) for
 * `public/assets/tilesets/pixel-crawler/biomes.json` (plan 052 step 6). Pure — no Phaser, no editor
 * import — mirrors `nodeDefs.ts`'s style (`fail`/`expect*` helpers, strict `<path> <problem>` throw
 * messages, no unknown keys). Biomes are editor-only content, **fetched** like `terrains.json`/the new
 * `edge-sets/*.json` (not bundled like `nodes.json`) — see `biomeCatalogSource.ts`.
 *
 * `terrain.base`/`bands[].edgeSetId` name a **tile edge set** id (`public/assets/tilesets/
 * pixel-crawler/edge-sets/<id>.json`, `docs/BIOMES.md`) — NOT a `terrains.json` `TerrainDef` id. Plan
 * 052 Step 2 replaced the originally-proposed "overlay TerrainDef on a higher layer" model entirely: a
 * `depth`-method edge-set (water) carries its own embedded lake generator + dual-grid coast/transition
 * tiling, and a `blob`-method edge-set (grass, mud) is a plain alpha-cutout autotile — a patch band
 * doesn't encode `layer: 'base' | 'overlay'` itself (that was the dead overlay-pond model); the actual
 * layering mechanics per edge-set `method` are Step 7 (the terrain generator)'s job, which is the
 * consumer that loads `edge-sets/*.json` and knows how to apply each method (e.g. mud's own hard-won
 * finding that its patches paint as a hole in the *overlying* `grass` blob coverage, not the reverse —
 * see `docs/BIOMES.md`'s "Worked example: muddy patches"). This module only records *which* edge set
 * occupies a height band and in what order; it never touches pixels or edge-set JSON itself.
 *
 * Cross-validation is layered by what's actually available to a PURE module: scatter members with
 * `kind: 'node'` are checked against `NODES` (`src/data/nodes.ts`), which is bundled/compile-time
 * importable exactly like `nodeDefs.ts` checks `yieldItemId` against `ITEMS`. Decor asset refs and
 * edge-set ids are only fetched at editor runtime, so their existence is checked via an **optional**
 * `ValidationContext` the caller supplies once those catalogs are loaded (`biomeCatalogSource.ts`
 * passes the asset catalog's ids in) — omitting it (e.g. in unit tests) just skips that one check,
 * same graceful-degrade posture as the rest of the editor's catalog loading.
 */

import { NODES } from '../data/nodes';

// ---- Authored types (biome defs file schema v1) ----

/** One member of a scatter layer's weighted palette. `skin` selects a specific `NODES[ref]` skin id
 *  (only meaningful when the layer's `kind` is `'node'`; `ref` must be a `NODES` key). For
 *  `kind: 'decor'`, `ref` is an asset-catalog id (`CatalogAsset.id`, e.g. `craftpix-nature/Bushes/
 *  Fern1_3.png`) and `skin` is not allowed. */
export interface BiomeScatterMember {
  ref: string;
  /** Relative pick weight (see `pickWeighted`); must be a positive number. */
  weight: number;
  skin?: string;
}

/** Parent→children clustering (e.g. berry bushes) — after a member is placed, roll `chance` to also
 *  drop `count[0]..count[1]` more of the SAME layer's members within `radius` tiles of it. */
export interface BiomeScatterClump {
  /** Probability (0..1) a placed member spawns a clump. */
  chance: number;
  /** Max tile distance children may land from the parent. */
  radius: number;
  /** Inclusive `[min, max]` child count when a clump fires. */
  count: [number, number];
}

/** One scatter layer (ground detail / foliage / nodes / …), Poisson-sampled at `spacing` and thinned
 *  by the shared noise density field × `density`. */
export interface BiomeScatterLayer {
  id: string;
  kind: 'decor' | 'node';
  /** Poisson-disk minimum distance between placements, in tiles. */
  spacing: number;
  /** 0..1 multiplier against the noise density field (higher = denser). */
  density: number;
  members: BiomeScatterMember[];
  /** Edge-set ids (see module doc) whose cells this layer's placements must avoid — e.g. no trees on
   *  `water`. Omitted ⇒ no terrain exclusion. */
  avoidTerrains?: string[];
  clump?: BiomeScatterClump;
}

/** One threshold band in the shared height/moisture field, sorted ascending by `maxHeight`. A cell
 *  takes the first band (lowest `maxHeight`) that is `>=` its noise sample; a cell above every band's
 *  `maxHeight` takes `BiomeTerrain.base` instead. E.g. `[{water,0.22},{mud,0.38}]` → a pond ringed by
 *  mud, base terrain elsewhere. */
export interface BiomeTerrainBand {
  /** Tile-edge-set id (see module doc) — NOT a `terrains.json` `TerrainDef` id. */
  edgeSetId: string;
  /** Upper bound (exclusive of the next band up, inclusive of this one — see field doc), in `(0,1]`. */
  maxHeight: number;
}

export interface BiomeTerrain {
  /** Tile-edge-set id painted where no band applies (see module doc). */
  base: string;
  /** Shared height/moisture noise field params, fed to `noise.ts`'s `fbm(x,y,{octaves,scale})`. */
  field: { scale: number; octaves: number };
  /** Sorted ascending by `maxHeight` — see `BiomeTerrainBand` doc. May be empty (flat single-terrain
   *  biome). */
  bands: BiomeTerrainBand[];
}

export interface BiomeDef {
  id: string;
  name: string;
  /** Default seed used when the editor hasn't rolled its own; re-roll overrides this at apply time. */
  seed?: number;
  terrain: BiomeTerrain;
  scatter: BiomeScatterLayer[];
}

export interface BiomeDefsFile {
  version: 1;
  biomes: BiomeDef[];
}

/** Cross-catalog checks a pure module can't do on its own (see module doc) — supplied by the editor
 *  once the relevant fetched catalogs are loaded. Every field is optional; an absent field skips that
 *  check rather than failing closed, so unit tests can call `parseBiomeDefs` with no context at all. */
export interface BiomeValidationContext {
  /** Known asset-catalog ids (`CatalogAsset.id`) — checked against `kind: 'decor'` member `ref`s. */
  decorAssetIds?: ReadonlySet<string>;
  /** Known tile-edge-set ids (`edge-sets/<id>.json` basenames) — checked against `terrain.base` and
   *  `terrain.bands[].edgeSetId`. */
  edgeSetIds?: ReadonlySet<string>;
}

// ---- Parsing helpers (mirrors `nodeDefs.ts`'s style) ----

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path} must be an object`);
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(`${path} must be a string`);
  return value;
}

function expectNonEmptyString(value: unknown, path: string): string {
  const s = expectString(value, path);
  if (s.length === 0) fail(`${path} must be a non-empty string`);
  return s;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} must be a finite number`);
  return value;
}

function expectInt(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (!Number.isInteger(n)) fail(`${path} must be an integer`);
  return n;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value;
}

function expectNoExtraKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`${path} has unknown key "${key}"`);
  }
}

const SCATTER_MEMBER_KEYS = ['ref', 'weight', 'skin'] as const;

function parseScatterMember(
  value: unknown,
  path: string,
  kind: 'decor' | 'node',
  ctx: BiomeValidationContext,
): BiomeScatterMember {
  const obj = expectRecord(value, path);
  expectNoExtraKeys(obj, SCATTER_MEMBER_KEYS, path);

  const ref = expectNonEmptyString(obj.ref, `${path}.ref`);
  const weight = expectNumber(obj.weight, `${path}.weight`);
  if (weight <= 0) fail(`${path}.weight must be > 0 (got ${weight})`);

  const skin = obj.skin === undefined ? undefined : expectNonEmptyString(obj.skin, `${path}.skin`);
  if (skin !== undefined && kind !== 'node') {
    fail(`${path}.skin is only valid on a 'node' scatter layer`);
  }

  if (kind === 'node') {
    const nodeDef = NODES[ref];
    if (nodeDef === undefined) {
      fail(`${path}.ref ${JSON.stringify(ref)} is not a known node id (see src/data/nodes.ts)`);
    }
    if (skin !== undefined && !nodeDef.skins.some((s) => s.id === skin)) {
      fail(`${path}.skin ${JSON.stringify(skin)} is not a skin of node ${JSON.stringify(ref)}`);
    }
  } else if (ctx.decorAssetIds !== undefined && !ctx.decorAssetIds.has(ref)) {
    fail(`${path}.ref ${JSON.stringify(ref)} is not a known asset-catalog id`);
  }

  return { ref, weight, ...(skin === undefined ? {} : { skin }) };
}

const SCATTER_CLUMP_KEYS = ['chance', 'radius', 'count'] as const;

function parseScatterClump(value: unknown, path: string): BiomeScatterClump {
  const obj = expectRecord(value, path);
  expectNoExtraKeys(obj, SCATTER_CLUMP_KEYS, path);

  const chance = expectNumber(obj.chance, `${path}.chance`);
  if (chance < 0 || chance > 1) fail(`${path}.chance must be in [0,1] (got ${chance})`);

  const radius = expectNumber(obj.radius, `${path}.radius`);
  if (radius <= 0) fail(`${path}.radius must be > 0 (got ${radius})`);

  const countRaw = expectArray(obj.count, `${path}.count`);
  if (countRaw.length !== 2) fail(`${path}.count must be a [min, max] pair (length 2)`);
  const min = expectInt(countRaw[0], `${path}.count[0]`);
  const max = expectInt(countRaw[1], `${path}.count[1]`);
  if (min < 1) fail(`${path}.count[0] must be >= 1 (got ${min})`);
  if (max < min) fail(`${path}.count[1] must be >= count[0] (min ${min}, got ${max})`);

  return { chance, radius, count: [min, max] };
}

const SCATTER_LAYER_KEYS = [
  'id',
  'kind',
  'spacing',
  'density',
  'members',
  'avoidTerrains',
  'clump',
] as const;
const SCATTER_KINDS: ReadonlySet<string> = new Set(['decor', 'node']);

function parseScatterLayer(
  value: unknown,
  path: string,
  ctx: BiomeValidationContext,
): BiomeScatterLayer {
  const obj = expectRecord(value, path);
  expectNoExtraKeys(obj, SCATTER_LAYER_KEYS, path);

  const id = expectNonEmptyString(obj.id, `${path}.id`);

  const kindRaw = expectString(obj.kind, `${path}.kind`);
  if (!SCATTER_KINDS.has(kindRaw)) {
    fail(`${path}.kind must be 'decor' or 'node', got ${JSON.stringify(kindRaw)}`);
  }
  const kind = kindRaw as 'decor' | 'node';

  const spacing = expectNumber(obj.spacing, `${path}.spacing`);
  if (spacing <= 0) fail(`${path}.spacing must be > 0 (got ${spacing})`);

  const density = expectNumber(obj.density, `${path}.density`);
  if (density < 0 || density > 1) fail(`${path}.density must be in [0,1] (got ${density})`);

  const membersRaw = expectArray(obj.members, `${path}.members`);
  if (membersRaw.length === 0) fail(`${path}.members must be non-empty`);
  const members = membersRaw.map((m, i) =>
    parseScatterMember(m, `${path}.members[${i}]`, kind, ctx),
  );

  let avoidTerrains: string[] | undefined;
  if (obj.avoidTerrains !== undefined) {
    const raw = expectArray(obj.avoidTerrains, `${path}.avoidTerrains`);
    avoidTerrains = raw.map((t, i) => expectNonEmptyString(t, `${path}.avoidTerrains[${i}]`));
  }

  const clump = obj.clump === undefined ? undefined : parseScatterClump(obj.clump, `${path}.clump`);

  return {
    id,
    kind,
    spacing,
    density,
    members,
    ...(avoidTerrains === undefined ? {} : { avoidTerrains }),
    ...(clump === undefined ? {} : { clump }),
  };
}

function checkEdgeSetId(id: string, path: string, ctx: BiomeValidationContext): void {
  if (ctx.edgeSetIds !== undefined && !ctx.edgeSetIds.has(id)) {
    fail(`${path} ${JSON.stringify(id)} is not a known tile-edge-set id (see docs/BIOMES.md)`);
  }
}

const TERRAIN_BAND_KEYS = ['edgeSetId', 'maxHeight'] as const;

function parseTerrainBand(
  value: unknown,
  path: string,
  ctx: BiomeValidationContext,
): BiomeTerrainBand {
  const obj = expectRecord(value, path);
  expectNoExtraKeys(obj, TERRAIN_BAND_KEYS, path);

  const edgeSetId = expectNonEmptyString(obj.edgeSetId, `${path}.edgeSetId`);
  checkEdgeSetId(edgeSetId, `${path}.edgeSetId`, ctx);

  const maxHeight = expectNumber(obj.maxHeight, `${path}.maxHeight`);
  if (maxHeight <= 0 || maxHeight > 1)
    fail(`${path}.maxHeight must be in (0,1] (got ${maxHeight})`);

  return { edgeSetId, maxHeight };
}

const TERRAIN_FIELD_KEYS = ['scale', 'octaves'] as const;

function parseTerrainField(value: unknown, path: string): { scale: number; octaves: number } {
  const obj = expectRecord(value, path);
  expectNoExtraKeys(obj, TERRAIN_FIELD_KEYS, path);

  const scale = expectNumber(obj.scale, `${path}.scale`);
  if (scale <= 0) fail(`${path}.scale must be > 0 (got ${scale})`);

  const octaves = expectInt(obj.octaves, `${path}.octaves`);
  if (octaves < 1) fail(`${path}.octaves must be >= 1 (got ${octaves})`);

  return { scale, octaves };
}

const TERRAIN_KEYS = ['base', 'field', 'bands'] as const;

function parseTerrain(value: unknown, path: string, ctx: BiomeValidationContext): BiomeTerrain {
  const obj = expectRecord(value, path);
  expectNoExtraKeys(obj, TERRAIN_KEYS, path);

  const base = expectNonEmptyString(obj.base, `${path}.base`);
  checkEdgeSetId(base, `${path}.base`, ctx);

  const field = parseTerrainField(obj.field, `${path}.field`);

  const bandsRaw = expectArray(obj.bands, `${path}.bands`);
  const bands = bandsRaw.map((b, i) => parseTerrainBand(b, `${path}.bands[${i}]`, ctx));
  for (let i = 1; i < bands.length; i++) {
    if (bands[i].maxHeight <= bands[i - 1].maxHeight) {
      fail(
        `${path}.bands must be sorted strictly ascending by maxHeight ` +
          `(bands[${i - 1}].maxHeight=${bands[i - 1].maxHeight} >= bands[${i}].maxHeight=${bands[i].maxHeight})`,
      );
    }
  }

  return { base, field, bands };
}

const BIOME_DEF_KEYS = ['id', 'name', 'seed', 'terrain', 'scatter'] as const;

function parseBiomeDef(value: unknown, path: string, ctx: BiomeValidationContext): BiomeDef {
  const obj = expectRecord(value, path);
  expectNoExtraKeys(obj, BIOME_DEF_KEYS, path);

  const id = expectNonEmptyString(obj.id, `${path}.id`);
  const name = expectNonEmptyString(obj.name, `${path}.name`);
  const seed = obj.seed === undefined ? undefined : expectInt(obj.seed, `${path}.seed`);

  const terrain = parseTerrain(obj.terrain, `${path}.terrain`, ctx);

  const scatterRaw = expectArray(obj.scatter, `${path}.scatter`);
  const scatter = scatterRaw.map((s, i) => parseScatterLayer(s, `${path}.scatter[${i}]`, ctx));
  const seenLayerIds = new Set<string>();
  for (const layer of scatter) {
    if (seenLayerIds.has(layer.id))
      fail(`${path}.scatter has duplicate layer id ${JSON.stringify(layer.id)}`);
    seenLayerIds.add(layer.id);
  }

  return { id, name, ...(seed === undefined ? {} : { seed }), terrain, scatter };
}

/** `_comment` is an ignored, optional self-documentation key — the same convention `terrains.json`
 *  and `edge-sets/*.json` already use for hand-maintained JSON in this repo. */
const BIOME_DEFS_FILE_KEYS = ['version', 'biomes', '_comment'] as const;

/**
 * Validate + narrow an unknown JSON value (`biomes.json`) into a keyed `Record<id, BiomeDef>`. Throws
 * with a precise `<path> <problem>` message on the first violation. `ctx` supplies the optional
 * cross-catalog checks described in the module doc; omit it (e.g. in unit tests) to skip them. If
 * `version !== 1`, throws (no migration path yet, mirrors `parseNodeDefs`).
 */
export function parseBiomeDefs(
  raw: unknown,
  ctx: BiomeValidationContext = {},
): Record<string, BiomeDef> {
  const root = expectRecord(raw, 'biomeDefs');
  expectNoExtraKeys(root, BIOME_DEFS_FILE_KEYS, 'biomeDefs');

  const version = expectInt(root.version, 'biomeDefs.version');
  if (version !== 1) fail(`biomeDefs.version ${version} is not supported (no migration path yet)`);

  const biomesRaw = expectArray(root.biomes, 'biomeDefs.biomes');
  const result: Record<string, BiomeDef> = {};

  for (let i = 0; i < biomesRaw.length; i++) {
    const path = `biomeDefs.biomes[${i}]`;
    const def = parseBiomeDef(biomesRaw[i], path, ctx);
    if (result[def.id] !== undefined) {
      fail(`biomeDefs.biomes has duplicate biome id ${JSON.stringify(def.id)}`);
    }
    result[def.id] = def;
  }

  return result;
}
