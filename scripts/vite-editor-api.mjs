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
 *
 * Deliberately dumb: no `parseMap`/`parseWorldLayout` here — the editor validates client-side
 * before every PUT (plan 014 step 4). It DOES sanitise `:id` against path traversal
 * (`[a-z0-9-]+` only) and regenerates `manifest.json` after every map/world write. That
 * regeneration is a plain-JS re-implementation of `generateManifest`
 * (`src/systems/worldLayout.ts`) — same shape, same id-sort — kept in sync by hand since this file
 * can't import TS; `worldLayout.ts`'s DEV assertion + tests guard the two staying identical.
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MAP_SUFFIX = '.map.json';
const ID_RE = /^[a-z0-9-]+$/;

function sanitiseId(id) {
  return typeof id === 'string' && ID_RE.test(id) ? id : null;
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
