/**
 * Typed access to the generated terrain-defs file (`public/assets/tilesets/pixel-crawler/terrains.json`,
 * plan 014 step 10) — the editor's terrain brush loads this to know which tilesheet + blob-key->frame
 * mapping each terrain bakes through (`src/systems/autotile.ts`'s `paintMask`, step 3). Mirrors
 * `catalog.ts`'s posture: a light structural narrow (not a strict `parseMap`-style validator) since the
 * file is machine-generated and committed (`python3 scripts/pixel-crawler/gen_terrains.py`), not
 * hand-authored.
 *
 * Terrain defs live in a SIBLING file to `pack.json`, not a `terrains` key inside it — see
 * `terrains.json`'s own `_comment` field for the reasoning (the mapping is one entry per 8-neighbour
 * blob key, dozens of entries, and would dwarf pack.json's hand-authored fields).
 */

import type { TerrainMapping } from '../systems/autotile';

export interface TerrainDef {
  /** Stable id the Library/store/store use to look this terrain up (e.g. `'grass'`). */
  id: string;
  /** Display name shown in the Library's Terrains category. */
  name: string;
  /** Tileset pack id the baked `sheetFrame` palette entries are sourced from (`TilePaletteEntry.pack`). */
  pack: string;
  /** Sheet-relative path the baked frames index into (a `TileSource.sheetFrame.sheet`). */
  sheet: string;
  /** The FULL_KEY (fully-surrounded interior) frame — also the Library's preview swatch frame. */
  fillFrame: number;
  /** blobKey(int) -> baked frame index, as `paintMask` (autotile.ts) consumes directly. */
  mapping: TerrainMapping;
}

export interface TerrainCatalog {
  terrains: TerrainDef[];
}

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTerrainDef(value: unknown, path: string): TerrainDef {
  if (!isRecord(value)) fail(`${path} must be an object`);
  const { id, name, pack, sheet, fillFrame, mapping } = value;
  if (typeof id !== 'string' || id.length === 0) fail(`${path}.id must be a non-empty string`);
  if (typeof name !== 'string') fail(`${path}.name must be a string`);
  if (typeof pack !== 'string' || pack.length === 0)
    fail(`${path}.pack must be a non-empty string`);
  if (typeof sheet !== 'string' || sheet.length === 0)
    fail(`${path}.sheet must be a non-empty string`);
  if (typeof fillFrame !== 'number' || !Number.isInteger(fillFrame)) {
    fail(`${path}.fillFrame must be an integer`);
  }
  if (!isRecord(mapping)) fail(`${path}.mapping must be an object`);
  const parsedMapping: Record<number, number> = {};
  for (const [key, frame] of Object.entries(mapping)) {
    const keyInt = Number(key);
    if (!Number.isInteger(keyInt) || keyInt < 0 || keyInt > 0xff) {
      fail(`${path}.mapping key "${key}" must be an integer in 0..255`);
    }
    if (typeof frame !== 'number' || !Number.isInteger(frame)) {
      fail(`${path}.mapping["${key}"] must be an integer frame index`);
    }
    parsedMapping[keyInt] = frame;
  }
  return { id, name, pack, sheet, fillFrame, mapping: parsedMapping };
}

/** Narrow an unknown JSON value fetched from `terrains.json` into `TerrainCatalog`. Throws with a
 *  short message on an unrecognisable shape (a regen that broke the generator, wrong file, etc). */
export function parseTerrainCatalog(json: unknown): TerrainCatalog {
  if (!isRecord(json)) fail('terrains.json: expected an object');
  const terrainsRaw = json.terrains;
  if (!Array.isArray(terrainsRaw)) fail('terrains.json: expected { terrains: [...] }');
  return { terrains: terrainsRaw.map((t, i) => parseTerrainDef(t, `terrains[${i}]`)) };
}
