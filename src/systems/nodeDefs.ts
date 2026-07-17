/**
 * Authored resource-node schema + a single validating choke point (`parseNodeDefs`) for the
 * `nodeDefs.json` file that will (a later step) replace the compile-time `src/data/nodes.ts`
 * constant (plan 021 step 1). Pure — no Phaser. Mirrors `parseMap`'s style in `mapFormat.ts`:
 * small typed helper validators, descriptive `<path> <problem>` throw messages, strict rejection of
 * unknown keys.
 *
 * This step is zero-behaviour-change: `ResourceNodeDef` (src/data/types.ts) is untouched, and this
 * module doesn't wire into anything yet — it just defines the authored shape and its validator so a
 * later step can eager-import `nodeDefs.json`, fail-fast parse it, and shim `src/data/nodes.ts` to
 * `export const NODES = parseNodeDefs(nodesJson)`.
 */

import type { DecorRegion } from './mapFormat';
import type { ResourceNodeDef } from '../data/types';
import { ITEMS } from '../data/items';

// ---- Authored types (node defs file schema v1) ----

/** One renderable "look" for a node def. Sizing fields are per-skin OVERRIDES of the def-level
 *  defaults (`AuthoredNodeDef.scale`/`originX`/`originY`) — omitted here means "use the def's
 *  default", wired by a later step (plan 021 step 3). `weight` is optional on input (defaults to 1
 *  — see `pickWeighted` in `src/data/tileset.ts`, which requires a concrete `weight: number`); when
 *  present it must be a positive number. */
export interface NodeSkinDef {
  id: string;
  /** Optional display-name override — the Node Types panel and Inspector label a skin by this when
   *  present, else fall back to its `id`. Purely cosmetic (labelling), never gameplay. */
  name?: string;
  /** Asset-catalog id (same id space as `DecorObject.asset` in `mapFormat.ts`). */
  asset: string;
  /** Static atlas-sprite crop into `asset`'s source PNG — same shape as `DecorObject.region`. */
  region?: DecorRegion;
  /** Alternate look while this node instance is depleted (post-harvest, pre-regrow). */
  depleted?: { asset: string; region?: DecorRegion };
  /** Per-skin max-HP OVERRIDE (a node's HP = its total harvest hits, so a smaller tree with a lower
   *  `maxHp` yields less wood over its life). Omitted ⇒ inherit the def's `maxHp`; must be a positive
   *  integer when present (HP is a whole hit count). Applied at spawn/regrow by `ResourceNodeManager`
   *  (see its `addNode`). */
  maxHp?: number;
  /** Relative random-pick weight (see `pickWeighted`); omitted ⇒ defaults to 1. */
  weight?: number;
  /** Display-scale override (see `AuthoredNodeDef.scale`); omitted ⇒ inherit the def's default. */
  scale?: number;
  originX?: number;
  originY?: number;
}

/**
 * An authored resource-node definition (a tree, a rock, a berry bush — see
 * `src/data/nodes.ts` for the current compile-time equivalents this will replace).
 */
export interface AuthoredNodeDef {
  id: string;
  name: string;
  maxHp: number;
  /** Item id produced per hit — cross-checked against `ITEMS` (`src/data/items.ts`) by
   *  `parseNodeDefs`, not left to a separate compile-time test (folds in the old
   *  `data.test.ts: yieldItemId ∈ ITEMS` check — see module doc). */
  yieldItemId: string;
  yieldPerHit: number;
  regrowMs: number;
  blocksPath: boolean;
  harvestAnim?: 'chop' | 'gather' | 'mine';
  color: number;
  stumpColor: number;
  /** Def-level display scale (a multiplier on the source sprite's native pixels — the pack is
   *  authored at the game's `TILE_SIZE`, so `1.0` = native, artist-intended size + crisp pixels).
   *  Optional on input, defaulting to `1.0`; a skin's own `scale` overrides it (step 3). */
  scale?: number;
  originX: number;
  originY: number;
  /** Neighbour offsets the worker may stand on to harvest this node (gameplay — stays on the def,
   *  not per-skin). See `ResourceNodeDef.standOffsets` doc. */
  standOffsets?: ReadonlyArray<readonly [number, number]>;
  skins: NodeSkinDef[];
}

export interface NodeDefsFile {
  version: 1;
  defs: AuthoredNodeDef[];
}

/** `NodeSkinDef` with `weight` normalised to a concrete number (defaulted to 1 when the authored
 *  skin omits it) — see `NodeSkinDef.weight` doc. */
export type NormalizedNodeSkinDef = Omit<NodeSkinDef, 'weight'> & { weight: number };

/**
 * What `parseNodeDefs` actually returns per def: every `ResourceNodeDef` field (so existing
 * consumers — `ResourceNodeManager`, the editor `LibraryPanel`, registry cross-checks — keep
 * typechecking against `Record<string, ResourceNodeDef>` unchanged through Phases 1–2) PLUS the
 * normalised `skins`, which nothing reads yet but a later placement/render step will (plan 021
 * steps 3+). Additive-only over `ResourceNodeDef`, so `Record<string, ParsedNodeDef>` is assignable
 * wherever `Record<string, ResourceNodeDef>` is expected.
 */
export interface ParsedNodeDef extends ResourceNodeDef {
  skins: NormalizedNodeSkinDef[];
}

// ---- Parsing helpers (throw with a precise `<path> <problem>` message — mirrors mapFormat.ts) ----

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

/** A string that must also be non-empty — used for catalog `asset` ids (step 3: a skin must name a
 *  real catalog asset, never `""`). */
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

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(`${path} must be a boolean`);
  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value;
}

/** Strict (like `parseMap` is documented to be): reject any key on `obj` not in `allowed`. */
function expectNoExtraKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`${path} has unknown key "${key}"`);
  }
}

const DECOR_REGION_KEYS = ['x', 'y', 'w', 'h'] as const;

function parseDecorRegion(value: unknown, path: string): DecorRegion {
  const obj = expectRecord(value, path);
  expectNoExtraKeys(obj, DECOR_REGION_KEYS, path);
  const x = expectInt(obj.x, `${path}.x`);
  const y = expectInt(obj.y, `${path}.y`);
  const w = expectInt(obj.w, `${path}.w`);
  const h = expectInt(obj.h, `${path}.h`);
  if (x < 0) fail(`${path}.x must be >= 0`);
  if (y < 0) fail(`${path}.y must be >= 0`);
  if (w <= 0) fail(`${path}.w must be > 0`);
  if (h <= 0) fail(`${path}.h must be > 0`);
  return { x, y, w, h };
}

const DEPLETED_KEYS = ['asset', 'region'] as const;

function parseDepleted(value: unknown, path: string): { asset: string; region?: DecorRegion } {
  const obj = expectRecord(value, path);
  expectNoExtraKeys(obj, DEPLETED_KEYS, path);
  const asset = expectNonEmptyString(obj.asset, `${path}.asset`);
  const region =
    obj.region === undefined ? undefined : parseDecorRegion(obj.region, `${path}.region`);
  return { asset, ...(region === undefined ? {} : { region }) };
}

const NODE_SKIN_KEYS = [
  'id',
  'name',
  'asset',
  'region',
  'depleted',
  'maxHp',
  'weight',
  'scale',
  'originX',
  'originY',
] as const;

function parseNodeSkin(value: unknown, path: string): NormalizedNodeSkinDef {
  const obj = expectRecord(value, path);
  expectNoExtraKeys(obj, NODE_SKIN_KEYS, path);

  const id = expectString(obj.id, `${path}.id`);
  if (id.length === 0) fail(`${path}.id must be a non-empty string`);
  const name = obj.name === undefined ? undefined : expectString(obj.name, `${path}.name`);
  const asset = expectNonEmptyString(obj.asset, `${path}.asset`);

  const region =
    obj.region === undefined ? undefined : parseDecorRegion(obj.region, `${path}.region`);
  const depleted =
    obj.depleted === undefined ? undefined : parseDepleted(obj.depleted, `${path}.depleted`);

  // weight is optional on input; default to 1 so a later weighted-random placement step always has
  // a concrete number to work with (critique finding #5 — pickWeighted requires `weight: number`).
  let weight = 1;
  if (obj.weight !== undefined) {
    weight = expectNumber(obj.weight, `${path}.weight`);
    if (weight <= 0) fail(`${path}.weight must be > 0 (got ${weight})`);
  }

  const maxHp = obj.maxHp === undefined ? undefined : expectInt(obj.maxHp, `${path}.maxHp`);
  if (maxHp !== undefined && maxHp <= 0) fail(`${path}.maxHp must be > 0 (got ${maxHp})`);

  const scale = obj.scale === undefined ? undefined : expectNumber(obj.scale, `${path}.scale`);
  if (scale !== undefined && scale <= 0) fail(`${path}.scale must be > 0 (got ${scale})`);
  const originX =
    obj.originX === undefined ? undefined : expectNumber(obj.originX, `${path}.originX`);
  const originY =
    obj.originY === undefined ? undefined : expectNumber(obj.originY, `${path}.originY`);

  return {
    id,
    ...(name === undefined ? {} : { name }),
    asset,
    ...(region === undefined ? {} : { region }),
    ...(depleted === undefined ? {} : { depleted }),
    ...(maxHp === undefined ? {} : { maxHp }),
    weight,
    ...(scale === undefined ? {} : { scale }),
    ...(originX === undefined ? {} : { originX }),
    ...(originY === undefined ? {} : { originY }),
  };
}

function parseStandOffsets(value: unknown, path: string): ReadonlyArray<readonly [number, number]> {
  const arr = expectArray(value, path);
  return arr.map((entry, i) => {
    const pairPath = `${path}[${i}]`;
    const pair = expectArray(entry, pairPath);
    if (pair.length !== 2) fail(`${pairPath} must be a [dx, dy] pair (length 2)`);
    const dx = expectInt(pair[0], `${pairPath}[0]`);
    const dy = expectInt(pair[1], `${pairPath}[1]`);
    return [dx, dy] as const;
  });
}

const HARVEST_ANIM_VALUES: ReadonlySet<string> = new Set(['chop', 'gather', 'mine']);

const AUTHORED_NODE_DEF_KEYS = [
  'id',
  'name',
  'maxHp',
  'yieldItemId',
  'yieldPerHit',
  'regrowMs',
  'blocksPath',
  'harvestAnim',
  'color',
  'stumpColor',
  'scale',
  'originX',
  'originY',
  'standOffsets',
  'skins',
] as const;

function parseAuthoredNodeDef(
  value: unknown,
  path: string,
): { def: AuthoredNodeDef; skins: NormalizedNodeSkinDef[] } {
  const obj = expectRecord(value, path);
  expectNoExtraKeys(obj, AUTHORED_NODE_DEF_KEYS, path);

  const id = expectString(obj.id, `${path}.id`);
  if (id.length === 0) fail(`${path}.id must be a non-empty string`);
  const name = expectString(obj.name, `${path}.name`);

  const maxHp = expectNumber(obj.maxHp, `${path}.maxHp`);
  if (maxHp <= 0) fail(`${path}.maxHp must be > 0 (got ${maxHp})`);

  const yieldItemId = expectString(obj.yieldItemId, `${path}.yieldItemId`);
  if (!(yieldItemId in ITEMS)) {
    fail(
      `${path}.yieldItemId ${JSON.stringify(yieldItemId)} is not a known item id (see src/data/items.ts)`,
    );
  }

  const yieldPerHit = expectNumber(obj.yieldPerHit, `${path}.yieldPerHit`);
  if (yieldPerHit <= 0) fail(`${path}.yieldPerHit must be > 0 (got ${yieldPerHit})`);

  const regrowMs = expectNumber(obj.regrowMs, `${path}.regrowMs`);
  if (regrowMs <= 0) fail(`${path}.regrowMs must be > 0 (got ${regrowMs})`);

  const blocksPath = expectBoolean(obj.blocksPath, `${path}.blocksPath`);

  let harvestAnim: 'chop' | 'gather' | 'mine' | undefined;
  if (obj.harvestAnim !== undefined) {
    const raw = expectString(obj.harvestAnim, `${path}.harvestAnim`);
    if (!HARVEST_ANIM_VALUES.has(raw)) {
      fail(`${path}.harvestAnim must be 'chop', 'gather' or 'mine', got ${JSON.stringify(raw)}`);
    }
    harvestAnim = raw as 'chop' | 'gather' | 'mine';
  }

  const color = expectInt(obj.color, `${path}.color`);
  const stumpColor = expectInt(obj.stumpColor, `${path}.stumpColor`);

  // Optional on input, defaulting to native (1.0) — the pack is authored at the game's TILE_SIZE.
  const scale = obj.scale === undefined ? 1 : expectNumber(obj.scale, `${path}.scale`);
  if (scale <= 0) fail(`${path}.scale must be > 0 (got ${scale})`);

  const originX = expectNumber(obj.originX, `${path}.originX`);
  const originY = expectNumber(obj.originY, `${path}.originY`);

  const standOffsets =
    obj.standOffsets === undefined
      ? undefined
      : parseStandOffsets(obj.standOffsets, `${path}.standOffsets`);

  const skinsRaw = expectArray(obj.skins, `${path}.skins`);
  if (skinsRaw.length === 0) fail(`${path}.skins must be non-empty`);
  const skins = skinsRaw.map((s, i) => parseNodeSkin(s, `${path}.skins[${i}]`));
  const seenSkinIds = new Set<string>();
  for (const skin of skins) {
    if (seenSkinIds.has(skin.id))
      fail(`${path}.skins has duplicate skin id ${JSON.stringify(skin.id)}`);
    seenSkinIds.add(skin.id);
  }

  const def: AuthoredNodeDef = {
    id,
    name,
    maxHp,
    yieldItemId,
    yieldPerHit,
    regrowMs,
    blocksPath,
    ...(harvestAnim === undefined ? {} : { harvestAnim }),
    color,
    stumpColor,
    scale,
    originX,
    originY,
    ...(standOffsets === undefined ? {} : { standOffsets }),
    skins,
  };

  return { def, skins };
}

const NODE_DEFS_FILE_KEYS = ['version', 'defs'] as const;

/**
 * Validate + narrow an unknown JSON value into a keyed `Record<id, ParsedNodeDef>` (id ⇐ def id;
 * the input's `defs` is an ARRAY — plan says "key≠id" from the schema note refers to the returned
 * Record's key matching the def's own id, so dedupe/keying happens here on `def.id`, not on a
 * separate input key). Throws with a precise message on the first violation. Injects the inert
 * `armour: 0, speed: 0` fields (see `src/data/nodes.ts` — same inert convention already in use) so
 * every field required by `ResourceNodeDef` (src/data/types.ts) is present. Node art resolves per
 * skin via the catalog render path (plan 021 step 6) — there is no longer a manifest tile role. If
 * `version !== 1`, throws (no migration path yet, mirrors `parseMap`'s `migrateMap`-only-does-v1
 * posture for now).
 */
export function parseNodeDefs(raw: unknown): Record<string, ParsedNodeDef> {
  const root = expectRecord(raw, 'nodeDefs');
  expectNoExtraKeys(root, NODE_DEFS_FILE_KEYS, 'nodeDefs');

  const version = expectInt(root.version, 'nodeDefs.version');
  if (version !== 1) fail(`nodeDefs.version ${version} is not supported (no migration path yet)`);

  const defsRaw = expectArray(root.defs, 'nodeDefs.defs');
  const result: Record<string, ParsedNodeDef> = {};

  for (let i = 0; i < defsRaw.length; i++) {
    const path = `nodeDefs.defs[${i}]`;
    const { def, skins } = parseAuthoredNodeDef(defsRaw[i], path);
    if (result[def.id] !== undefined) {
      fail(`nodeDefs.defs has duplicate def id ${JSON.stringify(def.id)}`);
    }
    result[def.id] = {
      id: def.id,
      name: def.name,
      maxHp: def.maxHp,
      armour: 0, // inert for objects — see plan 003 Context & decisions / src/data/nodes.ts
      speed: 0, // inert for objects
      yieldItemId: def.yieldItemId,
      yieldPerHit: def.yieldPerHit,
      regrowMs: def.regrowMs,
      color: def.color,
      stumpColor: def.stumpColor,
      blocksPath: def.blocksPath,
      ...(def.harvestAnim === undefined ? {} : { harvestAnim: def.harvestAnim }),
      scale: def.scale ?? 1,
      originX: def.originX,
      originY: def.originY,
      ...(def.standOffsets === undefined ? {} : { standOffsets: def.standOffsets }),
      skins,
    };
  }

  return result;
}
