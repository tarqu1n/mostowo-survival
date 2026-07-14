/**
 * Dev-only Vite middleware backing the Map Builder editor's save API (plan 014 step 4). Wired into
 * `vite.config.ts`'s `plugins` array, gated to `command === 'serve'` — the production build never
 * sees it, and the editor entry itself is excluded from `build.rollupOptions.input`. Plain JS
 * (Node builtins only, mirrors `scripts/asset-catalog.mjs`'s posture) since `vite.config.ts`
 * imports it directly and this file must load before any TS toolchain is involved.
 *
 * Endpoints (all under `/__editor/`):
 *   GET  /__editor/maps            -> string[] of map ids (scans src/data/maps/*.map.json)
 *   GET  /__editor/maps/:id        -> raw file contents (map JSON)
 *   PUT  /__editor/maps/:id        -> writes body to src/data/maps/<id>.map.json, regens manifest
 *   GET  /__editor/world           -> src/data/maps/world.json contents
 *   PUT  /__editor/world           -> writes body to world.json, regens manifest
 *   PUT  /__editor/maps/:id/thumb  -> writes PNG body to public/assets/maps/thumbs/<id>.png
 *   PUT  /__editor/asset-override  -> patches a pack.json asset override, reruns the asset pipeline
 *   PUT  /__editor/asset-regions   -> replaces a pack.json regions list, reruns the asset pipeline
 *
 * Deliberately dumb: no `parseMap`/`parseWorldLayout` here — the editor validates client-side
 * before every PUT (plan 014 step 4). It DOES sanitise `:id` against path traversal
 * (`[a-z0-9-]+` only) and regenerates `manifest.json` after every map/world write. That
 * regeneration is a plain-JS re-implementation of `generateManifest`
 * (`src/systems/worldLayout.ts`) — same shape, same id-sort — kept in sync by hand since this file
 * can't import TS; `worldLayout.ts`'s DEV assertion + tests guard the two staying identical.
 *
 * `/__editor/asset-override` (plan 014 step 7c) is the in-editor "reclassify" affordance's backend:
 * it patches `<pack>/pack.json`'s `overrides[relPath]` (merged into any existing entry, never
 * replaced wholesale) then reruns BOTH generators, in order, as child processes —
 * `gen_regions.py` first (asset-catalog.mjs's `mergeRegions` FATALs on a sidecar that's gone stale
 * relative to a just-changed `pack.json`, so the order matters), then `assets:catalog`. Since plan
 * 017 step 6, a `type:'strip'` patch also understands `cols`/`omit` (geometry mode: `frames` is
 * derived as `cols*rows` by the catalog builder, not authored; `omit` lists cell indices to skip)
 * alongside the legacy `frames`/`rows` fields — see `sanitiseOverridePatch` below for the exact
 * validation. Fixed argv
 * arrays, no shell (`execFile`, never `exec`) — the request body only ever supplies a pack id/relative
 * path/patch, sanitised below, never a literal command. Concurrent PUTs are serialized through
 * `enqueueRegen` (a simple in-flight promise queue) so two overlapping reclassifies can't race two
 * regens over the same `pack.json`/`regions.json`/`asset-catalog.json`. On `python3` ENOENT (not
 * installed / not on PATH), the pack.json patch is already written to disk — that IS the graceful
 * degrade: the response tells the caller to finish the regen with the two documented commands
 * (`python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog`) rather than silently
 * leaving a stale catalog.
 *
 * `/__editor/asset-regions` (plan 017 step 4) is the in-editor Regions editor's backend: it REPLACES
 * `<pack>/pack.json`'s `regions[relPath]` with the caller's complete hand-authored sprite list
 * (whole-list, not a merge — an empty array DELETES the key, restoring auto-detection), then reruns
 * the same serialised `gen_regions.py` + `assets:catalog` pipeline with the identical python3-ENOENT
 * graceful degrade. `sanitiseRegions` rejects a list unless every rect is integer, `x>=0/y>=0/w>0/h>0`
 * AND in-bounds of the sheet PNG (its width/height read straight off the IHDR chunk by `readPngSize`,
 * mirroring `asset-catalog.mjs` — NEVER importing that module, which runs its whole build on import),
 * so a bad box can't reach `pack.json`. Deliberately does NOT touch the separate `regionParams` key.
 */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

const MAP_SUFFIX = '.map.json';
const ID_RE = /^[a-z0-9-]+$/;
const PACK_ID_RE = /^[a-z0-9-]+$/;
const OVERRIDE_TYPES = new Set(['tile', 'strip', 'object']);
const MANUAL_REGEN_HINT = 'python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog';

function sanitiseId(id) {
  return typeof id === 'string' && ID_RE.test(id) ? id : null;
}

function sanitisePackId(id) {
  return typeof id === 'string' && PACK_ID_RE.test(id) ? id : null;
}

/** POSIX-relative, no leading slash, no `..` segment — the same escape-hatch shape
 *  `scripts/asset-catalog.mjs`/`gen_regions.py` key `pack.json`'s `overrides` by. */
function sanitiseRelPath(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.startsWith('/')) return null;
  if (relPath.split('/').some((seg) => seg === '' || seg === '..')) return null;
  return relPath;
}

/** Narrows an untrusted PUT body's `patch` down to exactly the fields `pack.json` `overrides`
 *  entries understand (plan 014 step 7c: `type`/`frames`/`rows`; plan 017 step 6: `cols`/`omit` for
 *  `type:'strip'` geometry mode) — returns `null` on anything else, so a malformed/unexpected field
 *  can never reach the written `pack.json`. `frames`/`rows` (legacy strip mode, unchanged) and
 *  `cols`/`omit` (geometry mode) are each validated independently — a client is expected to send one
 *  shape or the other, never both, and the catalog builder (`asset-catalog.mjs`) ignores `frames`
 *  when `cols` is present, so this function doesn't try to reconcile them. `cols` is the strip's
 *  column count (`frameWidth = w/cols`); `omit` (only accepted alongside `cols`) is an array of
 *  cell indices, row-major `0..cols*rows-1` (rows defaulting to 1), to drop from the played frame
 *  set — rejected if any index is out of range, or if it would omit every cell (played count must
 *  stay `>= 1`). The array itself is passed through unsanitised beyond int/range checks; dedupe/sort
 *  is the catalog builder's job (plan 017 step 6.1). */
export function sanitiseOverridePatch(patch) {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return null;
  const out = {};
  if (patch.type !== undefined) {
    if (!OVERRIDE_TYPES.has(patch.type)) return null;
    out.type = patch.type;
  }
  if (patch.frames !== undefined) {
    if (!Number.isInteger(patch.frames) || patch.frames < 1) return null;
    out.frames = patch.frames;
  }
  if (patch.rows !== undefined) {
    if (!Number.isInteger(patch.rows) || patch.rows < 1) return null;
    out.rows = patch.rows;
  }
  if (patch.cols !== undefined) {
    if (!Number.isInteger(patch.cols) || patch.cols < 1) return null;
    out.cols = patch.cols;
  }
  if (patch.omit !== undefined) {
    if (patch.cols === undefined) return null;
    if (!Array.isArray(patch.omit) || !patch.omit.every((i) => Number.isInteger(i) && i >= 0)) {
      return null;
    }
    out.omit = patch.omit;
  }
  if (patch.cols !== undefined && patch.omit !== undefined) {
    const cells = patch.cols * (patch.rows ?? 1);
    if (patch.omit.some((i) => i >= cells)) return null;
    if (cells - new Set(patch.omit).size < 1) return null;
  }
  if (Object.keys(out).length === 0) return null;
  return out;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads a PNG's pixel dimensions straight off its IHDR chunk (the first 24 bytes: 8-byte signature,
 *  then the IHDR length/type/width/height), the same way `scripts/asset-catalog.mjs`'s `readPngSize`
 *  does — WITHOUT importing that module (it runs its entire catalog build on import). Throws on a
 *  short read or a bad signature so a non-PNG / truncated file can't yield a bogus bound. */
function readPngSize(pngPath) {
  const fd = openSync(pngPath, 'r');
  try {
    const header = Buffer.alloc(24);
    const read = readSync(fd, header, 0, 24, 0);
    if (read < 24 || !header.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new Error(`not a PNG: ${pngPath}`);
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    closeSync(fd);
  }
}

/** Narrows an untrusted PUT body's `regions` down to a clean array of bare `{x,y,w,h}` integer rects
 *  (plan 017 step 4) — mirrors `sanitiseOverridePatch`'s all-or-nothing posture: returns `null` if the
 *  input isn't an array, or ANY rect is non-integer, has `x<0/y<0/w<1/h<1`, or falls outside the
 *  `sheetW`×`sheetH` sheet — so a malformed/out-of-bounds box can never reach the written `pack.json`.
 *  Reads only x/y/w/h (ignoring any stray keys like the catalog's `key`). An empty array is VALID
 *  (the caller uses it to delete the override). */
function sanitiseRegions(regions, sheetW, sheetH) {
  if (!Array.isArray(regions)) return null;
  const out = [];
  for (const r of regions) {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return null;
    const { x, y, w, h } = r;
    if (![x, y, w, h].every(Number.isInteger)) return null;
    if (x < 0 || y < 0 || w < 1 || h < 1) return null;
    if (x + w > sheetW || y + h > sheetH) return null;
    out.push({ x, y, w, h });
  }
  return out;
}

function listMapIds(mapsDir) {
  return readdirSync(mapsDir)
    .filter((f) => f.endsWith(MAP_SUFFIX))
    .map((f) => f.slice(0, -MAP_SUFFIX.length))
    .sort((a, b) => a.localeCompare(b));
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function sendRawJsonFile(res, filePath) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(readFileSync(filePath, 'utf8'));
}

/** Plain-JS mirror of `generateManifest` (src/systems/worldLayout.ts): same
 *  `{schemaVersion, placements, maps}` shape, placements + maps both sorted by id for
 *  deterministic, diff-friendly output. Reads straight off disk — no validation (see module doc). */
function regenerateManifest(mapsDir) {
  const world = JSON.parse(readFileSync(join(mapsDir, 'world.json'), 'utf8'));
  const placements = [...world.placements].sort((a, b) => a.mapId.localeCompare(b.mapId));

  const maps = listMapIds(mapsDir).map((id) => {
    const map = JSON.parse(readFileSync(join(mapsDir, `${id}${MAP_SUFFIX}`), 'utf8'));
    const { id: metaId, name, width, height } = map.meta;
    return { id: metaId, name, width, height };
  });

  const manifest = { schemaVersion: 1, placements, maps };
  writeFileSync(join(mapsDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** `execFile` as a promise — fixed argv array, no shell (see module doc's no-shell-injection note).
 *  Resolves with stdout+stderr even on a non-zero exit (a generator's own validation FATAL is still
 *  useful output to relay to the caller); rejects only on a spawn failure (e.g. `python3` ENOENT). */
function execFileAsync(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, options, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') {
        reject(err);
        return;
      }
      resolvePromise({ ok: !err, stdout, stderr });
    });
  });
}

/** Runs `gen_regions.py` then `assets:catalog`, IN ORDER (see module doc), collecting every
 *  non-empty output line from both as `warnings` to relay back to the editor. Returns
 *  `{ok: true, warnings}` on a clean double-generator run, `{ok: false, error, warnings}` on either
 *  generator failing (including a structured message when `python3` isn't on PATH — the documented
 *  graceful degrade). Never throws. */
async function runAssetGenerators(root) {
  const warnings = [];
  const collect = (stdout, stderr) => {
    for (const line of `${stdout}\n${stderr}`.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) warnings.push(trimmed);
    }
  };

  let regions;
  try {
    regions = await execFileAsync('python3', [join(root, 'scripts/pixel-crawler/gen_regions.py')], {
      cwd: root,
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        ok: false,
        error: `python3 not found on PATH — finish the regen manually: ${MANUAL_REGEN_HINT}`,
        warnings,
      };
    }
    return { ok: false, error: `gen_regions.py failed to run: ${err.message}`, warnings };
  }
  collect(regions.stdout, regions.stderr);
  if (!regions.ok) {
    return {
      ok: false,
      error: `gen_regions.py exited with an error — finish the regen manually: ${MANUAL_REGEN_HINT}`,
      warnings,
    };
  }

  let catalog;
  try {
    catalog = await execFileAsync(process.execPath, [join(root, 'scripts/asset-catalog.mjs')], {
      cwd: root,
    });
  } catch (err) {
    return { ok: false, error: `asset-catalog.mjs failed to run: ${err.message}`, warnings };
  }
  collect(catalog.stdout, catalog.stderr);
  if (!catalog.ok) {
    return {
      ok: false,
      error: `npm run assets:catalog exited with an error — finish the regen manually: ${MANUAL_REGEN_HINT}`,
      warnings,
    };
  }

  return { ok: true, warnings };
}

/** Serializes concurrent asset-pipeline regens (plan 014 step 7c: two overlapping reclassify PUTs
 *  must never run two `gen_regions.py`/`assets:catalog` pairs at once over the same files) — each
 *  call chains off the previous one's settlement, win or lose, so the queue itself never gets stuck
 *  in a rejected state. */
let regenQueue = Promise.resolve();
function enqueueRegen(root) {
  const run = regenQueue.then(
    () => runAssetGenerators(root),
    () => runAssetGenerators(root),
  );
  regenQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Vite plugin factory — `configureServer` only fires under `vite dev` (preview uses a separate
 *  `configurePreviewServer` hook this plugin doesn't implement, and build never starts a server),
 *  so this is inert outside the dev server regardless of how it's gated in `vite.config.ts`. */
export function editorApiPlugin() {
  return {
    name: 'mostowo-editor-api',
    configureServer(server) {
      const root = server.config.root;
      const mapsDir = join(root, 'src/data/maps');
      const worldPath = join(mapsDir, 'world.json');
      const thumbsDir = join(root, 'public/assets/maps/thumbs');
      const tilesetsDir = join(root, 'public/assets/tilesets');

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname;
        if (!path.startsWith('/__editor/')) {
          next();
          return;
        }

        try {
          if (path === '/__editor/maps' && req.method === 'GET') {
            sendJson(res, 200, listMapIds(mapsDir));
            return;
          }

          if (path === '/__editor/world') {
            if (req.method === 'GET') {
              if (!existsSync(worldPath)) {
                sendJson(res, 404, { error: 'world.json not found' });
                return;
              }
              sendRawJsonFile(res, worldPath);
              return;
            }
            if (req.method === 'PUT') {
              writeFileSync(worldPath, await readBody(req));
              regenerateManifest(mapsDir);
              sendJson(res, 200, { ok: true });
              return;
            }
          }

          if (path === '/__editor/asset-override' && req.method === 'PUT') {
            let payload;
            try {
              payload = JSON.parse((await readBody(req)).toString('utf8'));
            } catch {
              sendJson(res, 400, { error: 'invalid JSON body' });
              return;
            }
            const packId = sanitisePackId(payload?.packId);
            const relPath = sanitiseRelPath(payload?.relPath);
            const patch = sanitiseOverridePatch(payload?.patch);
            if (!packId || !relPath || !patch) {
              sendJson(res, 400, { error: 'invalid packId/relPath/patch' });
              return;
            }
            const packJsonPath = join(tilesetsDir, packId, 'pack.json');
            if (!existsSync(packJsonPath)) {
              sendJson(res, 404, { error: `pack "${packId}" not found` });
              return;
            }

            const pack = JSON.parse(readFileSync(packJsonPath, 'utf8'));
            pack.overrides = pack.overrides ?? {};
            pack.overrides[relPath] = { ...(pack.overrides[relPath] ?? {}), ...patch };
            writeFileSync(packJsonPath, `${JSON.stringify(pack, null, 2)}\n`);

            // The pack.json patch above is already durable at this point — a generator failure
            // below (including python3 ENOENT) is reported to the caller as the documented
            // graceful degrade (see module doc), never rolled back: the override the author just
            // set is real, only the regen needs finishing by hand.
            const result = await enqueueRegen(root);
            if (!result.ok) {
              sendJson(res, 502, { error: result.error, warnings: result.warnings });
              return;
            }
            sendJson(res, 200, { ok: true, warnings: result.warnings });
            return;
          }

          if (path === '/__editor/asset-regions' && req.method === 'PUT') {
            let payload;
            try {
              payload = JSON.parse((await readBody(req)).toString('utf8'));
            } catch {
              sendJson(res, 400, { error: 'invalid JSON body' });
              return;
            }
            const packId = sanitisePackId(payload?.packId);
            const relPath = sanitiseRelPath(payload?.relPath);
            if (!packId || !relPath || !Array.isArray(payload?.regions)) {
              sendJson(res, 400, { error: 'invalid packId/relPath/regions' });
              return;
            }
            const packJsonPath = join(tilesetsDir, packId, 'pack.json');
            if (!existsSync(packJsonPath)) {
              sendJson(res, 404, { error: `pack "${packId}" not found` });
              return;
            }
            const pngPath = join(tilesetsDir, packId, relPath);
            if (!existsSync(pngPath)) {
              sendJson(res, 404, { error: `sheet "${relPath}" not found in pack "${packId}"` });
              return;
            }
            let sheet;
            try {
              sheet = readPngSize(pngPath);
            } catch (e) {
              sendJson(res, 400, { error: `could not read sheet PNG: ${e.message}` });
              return;
            }
            const regions = sanitiseRegions(payload.regions, sheet.width, sheet.height);
            if (regions === null) {
              sendJson(res, 400, {
                error: `invalid regions — each must be an integer {x,y,w,h} with x/y>=0, w/h>0, in-bounds of ${sheet.width}×${sheet.height}`,
              });
              return;
            }

            const pack = JSON.parse(readFileSync(packJsonPath, 'utf8'));
            pack.regions = pack.regions ?? {};
            // Whole-list replace (NOT a merge): the caller sends the complete hand-authored list. An
            // empty list deletes the key so the sheet falls back to connected-component detection.
            if (regions.length === 0) {
              delete pack.regions[relPath];
            } else {
              pack.regions[relPath] = regions;
            }
            writeFileSync(packJsonPath, `${JSON.stringify(pack, null, 2)}\n`);

            // As with /__editor/asset-override: the pack.json write above is already durable, so a
            // generator failure below (incl. python3 ENOENT) is reported as the documented graceful
            // degrade, never rolled back — only the regen needs finishing by hand.
            const result = await enqueueRegen(root);
            if (!result.ok) {
              sendJson(res, 502, { error: result.error, warnings: result.warnings });
              return;
            }
            sendJson(res, 200, { ok: true, warnings: result.warnings });
            return;
          }

          const mapMatch = /^\/__editor\/maps\/([^/]+)(\/thumb)?$/.exec(path);
          if (mapMatch) {
            const id = sanitiseId(mapMatch[1]);
            const isThumb = Boolean(mapMatch[2]);
            if (!id) {
              sendJson(res, 400, { error: 'invalid map id' });
              return;
            }

            if (isThumb && req.method === 'PUT') {
              mkdirSync(thumbsDir, { recursive: true });
              writeFileSync(join(thumbsDir, `${id}.png`), await readBody(req));
              sendJson(res, 200, { ok: true });
              return;
            }

            const mapPath = join(mapsDir, `${id}${MAP_SUFFIX}`);
            if (!isThumb && req.method === 'GET') {
              if (!existsSync(mapPath)) {
                sendJson(res, 404, { error: `map "${id}" not found` });
                return;
              }
              sendRawJsonFile(res, mapPath);
              return;
            }
            if (!isThumb && req.method === 'PUT') {
              writeFileSync(mapPath, await readBody(req));
              regenerateManifest(mapsDir);
              sendJson(res, 200, { ok: true });
              return;
            }
          }

          next();
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
