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
