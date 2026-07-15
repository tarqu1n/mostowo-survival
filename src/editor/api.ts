/**
 * Typed fetch wrappers for the editor's dev-only save API (`scripts/vite-editor-api.mjs`, wired
 * into `vite.config.ts` only in `serve` mode — never present in the prod build). No validation
 * here: the middleware stays dumb (plan 014 step 4), so callers run `parseMap`/`parseWorldLayout`
 * on a GET result and `serializeMap`/`JSON.stringify` before a PUT.
 */

const BASE = '/__editor';

async function expectOk(res: Response, action: string): Promise<Response> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${action} failed: ${res.status} ${res.statusText} ${body}`);
  }
  return res;
}

/** Map ids present in `src/data/maps/` (scans `*.map.json`, no map files loaded). */
export async function listMaps(): Promise<string[]> {
  const res = await expectOk(await fetch(`${BASE}/maps`), 'listMaps');
  return (await res.json()) as string[];
}

/** Raw JSON of `src/data/maps/<id>.map.json` — narrow with `parseMap`/`migrateMap` before use. */
export async function getMap(id: string): Promise<unknown> {
  const res = await expectOk(
    await fetch(`${BASE}/maps/${encodeURIComponent(id)}`),
    `getMap(${id})`,
  );
  return res.json();
}

/** Writes `json` (already `serializeMap`'d) to `src/data/maps/<id>.map.json`; the middleware
 *  regenerates `manifest.json` afterwards. */
export async function putMap(id: string, json: string): Promise<void> {
  await expectOk(
    await fetch(`${BASE}/maps/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    }),
    `putMap(${id})`,
  );
}

/** Deletes `src/data/maps/<id>.map.json`; the middleware also best-effort removes the map's thumb
 *  (`public/assets/maps/thumbs/<id>.png`) and regenerates `manifest.json` server-side. Does not
 *  touch `world.json` — callers must migrate any placement referencing `id` themselves. */
export async function deleteMap(id: string): Promise<void> {
  await expectOk(
    await fetch(`${BASE}/maps/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    `deleteMap(${id})`,
  );
}

/** Raw JSON of `src/data/maps/world.json` — narrow with `parseWorldLayout` before use. */
export async function getWorld(): Promise<unknown> {
  const res = await expectOk(await fetch(`${BASE}/world`), 'getWorld');
  return res.json();
}

/** Writes `json` to `src/data/maps/world.json`; the middleware regenerates `manifest.json`
 *  afterwards. */
export async function putWorld(json: string): Promise<void> {
  await expectOk(
    await fetch(`${BASE}/world`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    }),
    'putWorld',
  );
}

/** Raw JSON of `src/data/maps/nodes.json` (plan 021 step 7) — narrow with `parseNodeDefs` before
 *  use. A net-new endpoint, not a reuse of `getWorld`'s — `nodes.json` isn't a map placement, so the
 *  middleware never regenerates `manifest.json` around it (see `scripts/vite-editor-api.mjs`'s
 *  module doc). */
export async function getNodes(): Promise<unknown> {
  const res = await expectOk(await fetch(`${BASE}/nodes`), 'getNodes');
  return res.json();
}

/** Writes `json` to `src/data/maps/nodes.json`. No manifest regen (mirrors `getNodes`'s doc). */
export async function putNodes(json: string): Promise<void> {
  await expectOk(
    await fetch(`${BASE}/nodes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    }),
    'putNodes',
  );
}

/** Writes a 1px-per-tile thumbnail PNG to `public/assets/maps/thumbs/<id>.png`. */
export async function putThumb(id: string, png: Blob): Promise<void> {
  await expectOk(
    await fetch(`${BASE}/maps/${encodeURIComponent(id)}/thumb`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: png,
    }),
    `putThumb(${id})`,
  );
}

/** Reference-underlay tracing images (plan 022): dev-only, committed under
 *  `scripts/map-reference/out/`, served via `/__editor/map-references`. Names are the
 *  `<name>-reference.png` basenames with the suffix stripped. */
export async function listMapReferences(): Promise<string[]> {
  const res = await expectOk(await fetch(`${BASE}/map-references`), 'listMapReferences');
  return (await res.json()) as string[];
}

/** URL of a committed reference's tracing PNG — pass straight to Phaser `load.image` / `fetch`. */
export function mapReferenceImageUrl(name: string): string {
  return `${BASE}/map-references/${encodeURIComponent(name)}.png`;
}

/** Raw sidecar JSON for a reference, or `null` when absent (the `.json` is optional — a 404 is the
 *  "no sidecar" signal, not an error). `null` when absent, else raw JSON — narrow with `parseSidecar`
 *  before use. */
export async function getMapReferenceSidecar(name: string): Promise<unknown> {
  const res = await fetch(`${BASE}/map-references/${encodeURIComponent(name)}.json`);
  if (res.status === 404) return null;
  await expectOk(res, `getMapReferenceSidecar(${name})`);
  return res.json();
}

export interface CaptureResult {
  ok: true;
  name: string;
  grid: { w: number; h: number };
  image: { w: number; h: number };
}

/** Thrown by `captureMapReference` on an expected, actionable failure the caller branches on by
 *  `kind`: `'exists'` (409 — a reference with that name already exists; re-call with `overwrite:true`
 *  after the user confirms), `'busy'` (409 — another capture is already running), or `'other'` (any
 *  other failure, e.g. bad input 400 / capture 502). */
export class CaptureError extends Error {
  constructor(
    readonly kind: 'exists' | 'busy' | 'other',
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

/** Runs a server-side map-reference capture (`POST /__editor/map-references`, plan 023): the dev
 *  middleware runs `capture.mjs` (headless Chromium → an OSM raster slice) for `name` centered on
 *  `lat,lon` covering a square `radiusMetres` half-extent, writing `out/<name>-reference.{png,json}`
 *  so it appears in `listMapReferences()`. Radius → grid is computed server-side
 *  (`gridW=gridH=ceil(2·radiusMetres/3)`, 16 px/tile). Throws `CaptureError` on a 409 name-clash
 *  (`kind:'exists'` — pass `overwrite:true` to replace after confirming), a 409 `busy`, or any other
 *  failure (`kind:'other'`); resolves with the written grid/image dimensions on success. Does NOT
 *  refresh the reference list or load the underlay — that's the caller's job (mirrors `putMap`). */
export async function captureMapReference(opts: {
  name: string;
  lat: number;
  lon: number;
  radiusMetres: number;
  overwrite?: boolean;
}): Promise<CaptureResult> {
  const res = await fetch(`${BASE}/map-references`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    const err = body?.error;
    if (res.status === 409 && err === 'exists') {
      throw new CaptureError('exists', `reference "${opts.name}" already exists`);
    }
    if (res.status === 409 && err === 'busy') {
      throw new CaptureError('busy', 'a capture is already in progress — try again in a moment');
    }
    throw new CaptureError(
      'other',
      `captureMapReference failed: ${res.status} ${res.statusText} ${err ?? ''}`.trim(),
    );
  }
  return (await res.json()) as CaptureResult;
}

/** A `pack.json` `overrides[relPath]` patch (plan 014 step 7c) — merged server-side into any
 *  existing override for that asset, never a wholesale replace. `type` forces classification.
 *  Plan 017 step 6 decouples grid geometry from the played-frame set: when `cols` is present the
 *  resolved type is `strip` in **geometry mode** — `frames` is derived server-side as `cols*rows`
 *  (`rows` defaults to 1 if omitted) and is never itself authored; `omit` lists the row-major cell
 *  indices (`0..cols*rows-1`) to skip when playing, only meaningful alongside `cols`. `frames`/`rows`
 *  without `cols` remain the legacy welded shape (kept for older overrides — a strip authored before
 *  6.4, or a caller that hasn't migrated). */
export interface AssetOverridePatch {
  type?: 'tile' | 'strip' | 'object';
  frames?: number;
  rows?: number;
  cols?: number;
  omit?: number[];
}

export interface AssetOverrideResult {
  /** Every non-empty output line from both regen child processes (plan pipes generator warnings
   *  back verbatim) — includes each script's own "wrote ..." summary line, not just warnings. */
  warnings: string[];
}

/** A bare sprite bounding box — exactly the shape `pack.json`'s `regions[relPath]` stores (plan 014
 *  step 7a; the wire type for plan 017 step 4's in-app region editing). No `key`: that's a
 *  catalog-only, coordinate-derived field (`catalog.ts`'s `CatalogRegion`). */
export interface RegionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Patches `<pack>/pack.json`'s `overrides[relPath]` and reruns `gen_regions.py` +
 *  `assets:catalog` through the dev middleware (the in-editor "reclassify" affordance,
 *  `scripts/vite-editor-api.mjs`'s `/__editor/asset-override`). Concurrent PUTs are serialized
 *  server-side. On success the regenerated `asset-catalog.json` is already on disk — callers must
 *  refetch it (and `setCatalog`) themselves; this wrapper doesn't do it, mirroring how `putMap`
 *  doesn't re-fetch the map it just wrote. Throws on a generator failure (including the structured
 *  "python3 not found" graceful-degrade message — see the middleware's module doc) exactly like
 *  every other call here (`expectOk`). */
export async function putAssetOverride(
  packId: string,
  relPath: string,
  patch: AssetOverridePatch,
): Promise<AssetOverrideResult> {
  const res = await expectOk(
    await fetch(`${BASE}/asset-override`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId, relPath, patch }),
    }),
    `putAssetOverride(${packId}/${relPath})`,
  );
  return (await res.json()) as AssetOverrideResult;
}

/** Replaces `<pack>/pack.json`'s `regions[relPath]` with `regions` WHOLE-LIST (not a merge — it's the
 *  complete hand-authored sprite list, plan 017 step 4) and reruns `gen_regions.py` + `assets:catalog`
 *  through the dev middleware (`/__editor/asset-regions`). An EMPTY array deletes the key = fall back
 *  to auto-detection ("Reset to auto-detect"). Mirrors `putAssetOverride` exactly, including the
 *  refetch-is-the-caller's-job contract (run `loadCatalog` afterwards) and throwing on a generator
 *  failure (including the "python3 not found" graceful-degrade) via `expectOk`. The server clamps each
 *  rect in-bounds of the sheet PNG and rejects an out-of-bounds one, so a bad box can't reach
 *  `pack.json`. */
export async function putAssetRegions(
  packId: string,
  relPath: string,
  regions: RegionRect[],
): Promise<AssetOverrideResult> {
  const res = await expectOk(
    await fetch(`${BASE}/asset-regions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId, relPath, regions }),
    }),
    `putAssetRegions(${packId}/${relPath})`,
  );
  return (await res.json()) as AssetOverrideResult;
}
