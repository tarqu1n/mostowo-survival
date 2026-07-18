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
 *   GET  /__editor/nodes           -> src/data/maps/nodes.json contents
 *   PUT  /__editor/nodes           -> writes body to nodes.json (NO manifest regen — not a placement)
 *   GET  /__editor/palettes        -> src/data/maps/palettes.json (global editor tile palettes; no manifest regen)
 *   PUT  /__editor/palettes        -> writes body to palettes.json (NO manifest regen — editor curation, not a placement)
 *   PUT  /__editor/maps/:id/thumb  -> writes PNG body to public/assets/maps/thumbs/<id>.png
 *   PUT  /__editor/asset-override  -> patches a pack.json asset override, reruns the asset pipeline
 *   PUT  /__editor/asset-regions   -> replaces a pack.json regions list, reruns the asset pipeline
 *   GET  /__editor/map-references          -> string[] of reference names (scripts/map-reference/out/*-reference.png)
 *   GET  /__editor/map-references/:name.png  -> raw tracing PNG (reference underlay, plan 022)
 *   GET  /__editor/map-references/:name.json -> raw sidecar JSON (optional; 404 = no sidecar)
 *   POST /__editor/map-references          -> runs capture.mjs server-side ({name,lat,lon,radiusMetres,
 *                                             overwrite?} → OSM slice), writes out/<name>-reference.{png,json},
 *                                             returns {ok,name,grid,image} (plan 023)
 *   DELETE /__editor/map-references/:name  -> removes out/<name>-reference.{png,json} (sidecar best-effort)
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
 *
 * `POST /__editor/map-references` (plan 023) is the in-editor "Capture new reference" backend: it runs
 * `capture.mjs` server-side (headless Chromium → an OSM raster slice at a fixed 3 m/tile, 16 px/tile)
 * for a `{name, lat, lon, radiusMetres, overwrite?}` body, writing `out/<name>-reference.{png,json}`.
 * A square radius maps to the grid as `gridW = gridH = ceil(2·radiusMetres / 3)`. This is a dev-only,
 * SUPERVISED, user-initiated action (a Capture button click) — never an auto-pilot connection — and it
 * hits openstreetmap.org from the dev-server host, so it keeps the capture tool's polite identifying
 * User-Agent and pinned MapLibre version (see `capture.mjs`); coordinate-in, OSM-out only, never Google
 * imagery. `capture.mjs` is imported LAZILY (dynamic `import()` inside the handler, not at the top of
 * this file) because it statically pulls in `playwright` (a devDependency) — and `vite.config.ts`
 * imports THIS module at config-load time for prod builds too, where devDeps may be absent. A
 * name-clash without `overwrite:true` is a 409 `exists`; a second concurrent capture is a 409 `busy`
 * (serialised by the module-level `captureInFlight` flag); a capture that throws is a 502.
 *
 * Auto-commit-on-save (opt-in, `EDITOR_AUTOCOMMIT=1`): when set, a successful mutating request
 * schedules a debounced `git add`/`commit`/`push` of the editor's output paths — the "every Save
 * lands on GitHub" workflow for authoring from a phone against an ephemeral dev host. Off by
 * default (normal desktop dev never auto-pushes). See the block above `editorApiPlugin` and
 * docs/MOBILE-EDITOR-ACCESS.md.
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
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

const MAP_SUFFIX = '.map.json';
const ID_RE = /^[a-z0-9-]+$/;
const PACK_ID_RE = /^[a-z0-9-]+$/;
const OVERRIDE_TYPES = new Set(['tile', 'strip', 'object']);
const MANUAL_REGEN_HINT = 'python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog';

// Capture geometry (plan 023): fixed 3 m/tile, 16 px/tile (== TILE_SIZE), matching the capture tool
// defaults so an editor-captured reference drops onto the Map Builder grid 1:1. A square radius (m)
// → grid: gridW = gridH = ceil(2·radius / metresPerTile). Cap the radius so a fat-fingered value
// can't ask headless Chromium to render a gigantic map (and hammer the OSM tile server).
const MAP_REFERENCE_M_PER_TILE = 3;
const MAP_REFERENCE_PX_PER_TILE = 16;
const MAP_REFERENCE_MAX_RADIUS_M = 5000;
const MAP_REFERENCE_MAPLIBRE_VERSION = '4.7.1';

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
 *  plus an optional `role` (plan 017 step 4; `role` added plan 028) — mirrors `sanitiseOverridePatch`'s
 *  all-or-nothing posture: returns `null` if the input isn't an array, or ANY rect is non-integer, has
 *  `x<0/y<0/w<1/h<1`, falls outside the `sheetW`×`sheetH` sheet, or carries a `role` other than
 *  `undefined`/`'object'` — so a malformed/out-of-bounds/unsupported-role box can never reach the
 *  written `pack.json`. Reads x/y/w/h plus `role` (ignoring any other stray keys like the catalog's
 *  `key`); a missing `role` is passed through as absent (no default written), keeping a pure-object
 *  sheet's round-tripped `pack.json` byte-identical. An empty array is VALID (the caller uses it to
 *  delete the override). */
function sanitiseRegions(regions, sheetW, sheetH) {
  if (!Array.isArray(regions)) return null;
  const out = [];
  for (const r of regions) {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return null;
    const { x, y, w, h, role } = r;
    if (![x, y, w, h].every(Number.isInteger)) return null;
    if (x < 0 || y < 0 || w < 1 || h < 1) return null;
    if (x + w > sheetW || y + h > sheetH) return null;
    if (role !== undefined && role !== 'object') return null;
    out.push({ x, y, w, h, ...(role ? { role } : {}) });
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

function sendRawFile(res, filePath, contentType) {
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.end(readFileSync(filePath));
}

const REFERENCE_PNG_SUFFIX = '-reference.png';

/** Reference-underlay tracing images live under `scripts/map-reference/out/` as committed dev
 *  artifacts (plan 022 step 1) — list the available reference *names* by scanning for
 *  `*-reference.png` and stripping the suffix (matching `<name>-reference.{png,json}` the capture
 *  tool writes). Missing dir ⇒ empty list (the tool may not have been run yet). */
function listMapReferences(referencesDir) {
  if (!existsSync(referencesDir)) return [];
  return readdirSync(referencesDir)
    .filter((f) => f.endsWith(REFERENCE_PNG_SUFFIX))
    .map((f) => f.slice(0, -REFERENCE_PNG_SUFFIX.length))
    .sort((a, b) => a.localeCompare(b));
}

// A capture launches headless Chromium and fetches OSM tiles — heavy, and two overlapping runs would
// fight over the same `out/<name>-reference.*` files. A single in-flight boolean serialises them: a
// second concurrent POST gets a 409 `busy` (simpler than the `enqueueRegen` promise queue, and a
// human clicking Capture twice wants a clear "wait", not a silent queue). Module-scoped so it holds
// across requests for the lifetime of the dev server.
let captureInFlight = false;

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

// ---------------------------------------------------------------------------
// Auto-commit-on-save (opt-in: EDITOR_AUTOCOMMIT=1) — the phone workflow.
// When enabled, every SUCCESSFUL editor mutation (map/world/nodes/thumb/pack/
// reference write or delete) stages the editor's output files, commits them, and
// — unless EDITOR_AUTOCOMMIT_PUSH=0 — pushes the current branch. Debounced, so the
// 2+ requests a single Save fires (map JSON + thumbnail) coalesce into ONE commit;
// serialized through `autocommitQueue`, so a burst of saves can never race git.
// OFF by default: plain `npm run editor` for local desktop dev never auto-pushes.
// Rationale/usage: docs/MOBILE-EDITOR-ACCESS.md.
// ---------------------------------------------------------------------------
const AUTOCOMMIT = process.env.EDITOR_AUTOCOMMIT === '1';
const AUTOCOMMIT_PUSH = process.env.EDITOR_AUTOCOMMIT_PUSH !== '0';
const AUTOCOMMIT_DEBOUNCE_MS = Number(process.env.EDITOR_AUTOCOMMIT_DEBOUNCE_MS ?? 1500);
// Only ever stage the editor's OWN output — never unrelated working-tree edits. A pathspec-scoped
// `git add` + `git commit -- <paths>` keeps autosave commits to exactly these trees.
const AUTOCOMMIT_PATHS = [
  'src/data/maps',
  'public/assets/maps/thumbs',
  'public/assets/asset-catalog.json',
  'public/assets/tilesets',
  'scripts/map-reference/out',
];

let autocommitTimer = null;
const autocommitLabels = new Set();
let autocommitQueue = Promise.resolve();
let autocommitIdentityEnsured = false;

/** Commits need an author. If the repo (or its global config) has none — common in a fresh cloud
 *  container — set a local, clearly-automated identity so the autosave commit doesn't fail. A repo
 *  that already has an identity configured is left untouched. */
async function ensureGitIdentity(root) {
  if (autocommitIdentityEnsured) return;
  const email = await execFileAsync('git', ['config', 'user.email'], { cwd: root });
  if (!email.ok || !email.stdout.trim()) {
    await execFileAsync('git', ['config', 'user.email', 'editor@mostowo.local'], { cwd: root });
    await execFileAsync('git', ['config', 'user.name', 'Mostowo Map Builder'], { cwd: root });
  }
  autocommitIdentityEnsured = true;
}

/** Stage → commit → (optionally) push the editor's output paths. Never throws: a git failure is
 *  logged and swallowed so a save's HTTP response (already sent) and the dev server stay healthy.
 *  A commit lands even if the push later fails (network) — the work is at least durable in local
 *  history, and the next successful save's push carries it up. */
async function runAutoCommit(root, labels) {
  const git = (args) => execFileAsync('git', args, { cwd: root });
  try {
    await ensureGitIdentity(root);
    // Only stage paths that exist: `git add -- <pathspec>` aborts (staging nothing) if ANY pathspec
    // matches no file — and some editor outputs are optional (e.g. scripts/map-reference/out only
    // exists once a reference has been captured). `-A` so deletions (a deleted map) stage too. An
    // existing-but-empty dir is fine for `git add` (unlike `git commit -- <dir>`, which errors).
    const paths = AUTOCOMMIT_PATHS.filter((p) => existsSync(join(root, p)));
    if (paths.length === 0) return;
    await git(['add', '-A', '--', ...paths]);
    // Commit the EXACT staged files (never directory pathspecs): `git commit -- <dir>` errors on a
    // dir with no tracked files and can sweep in unrelated pre-staged content. `--name-only` lists
    // real staged files (adds, mods, AND deletions) scoped to our paths — commit precisely those.
    const namesOut = await git(['diff', '--cached', '--name-only', '-z', '--', ...paths]);
    const names = namesOut.stdout.split('\0').filter(Boolean);
    if (names.length === 0) return; // nothing changed (e.g. a save that rewrote identical bytes)
    const message = `editor: autosave\n\n${labels.join('\n')}`;
    const commit = await git(['commit', '-m', message, '--', ...names]);
    if (!commit.ok) {
      console.warn('[editor autocommit] commit failed:', commit.stderr.trim() || commit.stdout.trim());
      return;
    }
    console.log('[editor autocommit] committed:', labels.join(', '));
    if (AUTOCOMMIT_PUSH) await pushWithRebase(git, labels);
  } catch (err) {
    // e.g. git not on PATH (ENOENT). Never break the editor over a bookkeeping step.
    console.warn('[editor autocommit] skipped:', err && err.message ? err.message : String(err));
  }
}

/** Push the just-made autosave commit, self-healing a diverged branch (option B):
 *  1. `git push`. If it's a clean fast-forward, done.
 *  2. If it's rejected *non-fast-forward* (the remote branch moved — another device/session/web
 *     edit pushed), `git pull --rebase --autostash` to replay this commit on top of the remote,
 *     then push again. This succeeds whenever the remote touched *different* files (the common case).
 *  3. If the rebase hits a real content conflict on the same file, `git rebase --abort` to restore a
 *     clean, committed state (nothing lost — the commit is still in local history) and log LOUDLY so
 *     a human reconciles rather than an unattended process silently mis-merging map JSON.
 *  A non-rejection push failure (e.g. transient network) is just logged; the next save retries. */
async function pushWithRebase(git, labels) {
  const push = await git(['push', 'origin', 'HEAD']);
  if (push.ok) {
    console.log('[editor autocommit] pushed to origin');
    return;
  }
  const rejected = /non-fast-forward|fetch first|\[rejected\]|Updates were rejected/i.test(
    push.stderr,
  );
  if (!rejected) {
    console.warn('[editor autocommit] push failed (saved locally, will retry next save):', push.stderr.trim());
    return;
  }
  // Diverged remote — replay our commit on top of it.
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  console.warn(`[editor autocommit] remote moved; rebasing autosave onto origin/${branch}…`);
  const rebase = await git(['pull', '--rebase', '--autostash', 'origin', branch]);
  if (!rebase.ok) {
    await git(['rebase', '--abort']); // best-effort; harmless if no rebase is in progress
    console.warn(
      `[editor autocommit] ⚠ branch DIVERGED with a conflicting change on the same file — auto-rebase aborted. ` +
        `Your save is committed locally (safe) but NOT pushed. Reconcile origin/${branch} (pull/rebase) before further saves can push.`,
    );
    return;
  }
  const push2 = await git(['push', 'origin', 'HEAD']);
  if (push2.ok) {
    console.log(`[editor autocommit] rebased onto origin/${branch} and pushed:`, labels.join(', '));
  } else {
    console.warn('[editor autocommit] push still failing after rebase (will retry next save):', push2.stderr.trim());
  }
}

/** Debounce editor mutations into one commit and chain them through a queue so no two git runs
 *  overlap. Called from the middleware's `res.finish` hook on any 2xx editor mutation. */
function scheduleAutoCommit(root, label) {
  if (!AUTOCOMMIT) return;
  autocommitLabels.add(label);
  if (autocommitTimer) clearTimeout(autocommitTimer);
  autocommitTimer = setTimeout(() => {
    autocommitTimer = null;
    const labels = [...autocommitLabels];
    autocommitLabels.clear();
    autocommitQueue = autocommitQueue.then(
      () => runAutoCommit(root, labels),
      () => runAutoCommit(root, labels),
    );
  }, AUTOCOMMIT_DEBOUNCE_MS);
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
      const nodesPath = join(mapsDir, 'nodes.json');
      const palettesPath = join(mapsDir, 'palettes.json');
      const thumbsDir = join(root, 'public/assets/maps/thumbs');
      const tilesetsDir = join(root, 'public/assets/tilesets');
      const referencesDir = join(root, 'scripts/map-reference/out');

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname;
        if (!path.startsWith('/__editor/')) {
          next();
          return;
        }

        // Auto-commit-on-save (opt-in): once a mutating editor request has responded 2xx, its file
        // writes are on disk — schedule a debounced stage/commit/push. Registered generically here
        // so every current + future `/__editor/*` mutation is covered without touching each handler.
        if (AUTOCOMMIT && (req.method === 'PUT' || req.method === 'POST' || req.method === 'DELETE')) {
          res.once('finish', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              scheduleAutoCommit(root, `${req.method} ${path}`);
            }
          });
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

          if (path === '/__editor/nodes') {
            // Node defs (plan 021 step 7) — a net-new endpoint, NOT a reuse of `/world`'s handler:
            // `nodes.json` isn't a map placement, so a write here does NOT regenerate `manifest.json`
            // (see module doc's endpoint list).
            if (req.method === 'GET') {
              if (!existsSync(nodesPath)) {
                sendJson(res, 404, { error: 'nodes.json not found' });
                return;
              }
              sendRawJsonFile(res, nodesPath);
              return;
            }
            if (req.method === 'PUT') {
              writeFileSync(nodesPath, await readBody(req));
              sendJson(res, 200, { ok: true });
              return;
            }
          }

          if (path === '/__editor/palettes') {
            // Global editor tile palettes (plan 033 step 9) — the editor's curated quick-access trays,
            // moved OUT of per-map files into one cross-map file. Mirrors `/nodes`: NOT a map placement,
            // so a write here does NOT regenerate `manifest.json` (see module doc's endpoint list).
            if (req.method === 'GET') {
              if (!existsSync(palettesPath)) {
                sendJson(res, 404, { error: 'palettes.json not found' });
                return;
              }
              sendRawJsonFile(res, palettesPath);
              return;
            }
            if (req.method === 'PUT') {
              writeFileSync(palettesPath, await readBody(req));
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

          if (path === '/__editor/map-references' && req.method === 'GET') {
            sendJson(res, 200, listMapReferences(referencesDir));
            return;
          }

          if (path === '/__editor/map-references' && req.method === 'POST') {
            let payload;
            try {
              payload = JSON.parse((await readBody(req)).toString('utf8'));
            } catch {
              sendJson(res, 400, { error: 'invalid JSON body' });
              return;
            }
            const name = sanitiseId(payload?.name);
            const { lat, lon, radiusMetres } = payload ?? {};
            if (!name) {
              sendJson(res, 400, {
                error: 'invalid name — lowercase letters, digits, hyphens only',
              });
              return;
            }
            if (
              !Number.isFinite(lat) ||
              lat < -90 ||
              lat > 90 ||
              !Number.isFinite(lon) ||
              lon < -180 ||
              lon > 180 ||
              !Number.isFinite(radiusMetres) ||
              radiusMetres <= 0 ||
              radiusMetres > MAP_REFERENCE_MAX_RADIUS_M
            ) {
              sendJson(res, 400, {
                error: `invalid coordinate/radius — lat∈[-90,90], lon∈[-180,180], radiusMetres∈(0,${MAP_REFERENCE_MAX_RADIUS_M}]`,
              });
              return;
            }

            const overwrite = payload?.overwrite === true;
            if (existsSync(join(referencesDir, `${name}-reference.png`)) && !overwrite) {
              sendJson(res, 409, { error: 'exists', name });
              return;
            }
            if (captureInFlight) {
              sendJson(res, 409, { error: 'busy' });
              return;
            }

            const grid = Math.ceil((2 * radiusMetres) / MAP_REFERENCE_M_PER_TILE);
            captureInFlight = true;
            try {
              // Dynamic import (NOT a top-of-file import): `capture.mjs` statically imports
              // `playwright` (a devDependency). vite.config.ts imports THIS module at config-load
              // time for BOTH `serve` and `build`, so a static import would pull playwright into every
              // prod build — breaking CI where devDeps aren't installed. Importing lazily here keeps it
              // strictly to the dev-serve, user-initiated capture path. The specifier resolves relative
              // to this file (scripts/) → scripts/map-reference/capture.mjs.
              const { capture } = await import('./map-reference/capture.mjs');
              const cap = await capture({
                name,
                centerLat: lat,
                centerLon: lon,
                gridW: grid,
                gridH: grid,
                metresPerTile: MAP_REFERENCE_M_PER_TILE,
                pxPerTile: MAP_REFERENCE_PX_PER_TILE,
                maplibreVersion: MAP_REFERENCE_MAPLIBRE_VERSION,
              });
              sendJson(res, 200, {
                ok: true,
                name,
                grid: { w: grid, h: grid },
                image: cap.sidecar.image,
              });
            } catch (e) {
              sendJson(res, 502, { error: String((e && e.message) || e) });
            } finally {
              captureInFlight = false;
            }
            return;
          }

          // DELETE a committed reference by bare name (no extension — that path is the GET-only
          // asset route below). Removes the PNG + the optional sidecar; a missing PNG is a 404.
          const refDeleteMatch = /^\/__editor\/map-references\/([^/]+)$/.exec(path);
          if (refDeleteMatch && req.method === 'DELETE') {
            const name = sanitiseId(refDeleteMatch[1]);
            if (!name) {
              sendJson(res, 400, { error: 'invalid reference name' });
              return;
            }
            const pngPath = join(referencesDir, `${name}-reference.png`);
            if (!existsSync(pngPath)) {
              sendJson(res, 404, { error: `reference "${name}" not found` });
              return;
            }
            rmSync(pngPath);
            // Best-effort: the .json sidecar is optional (may never have been written).
            const sidecarPath = join(referencesDir, `${name}-reference.json`);
            if (existsSync(sidecarPath)) {
              rmSync(sidecarPath);
            }
            sendJson(res, 200, { ok: true });
            return;
          }

          const refMatch = /^\/__editor\/map-references\/([^/]+)\.(png|json)$/.exec(path);
          if (refMatch && req.method === 'GET') {
            const name = sanitiseId(refMatch[1]);
            const ext = refMatch[2];
            if (!name) {
              sendJson(res, 400, { error: 'invalid reference name' });
              return;
            }
            const refPath = join(referencesDir, `${name}-reference.${ext}`);
            if (!existsSync(refPath)) {
              // The .json sidecar is optional — a 404 here is the "no sidecar" signal.
              sendJson(res, 404, { error: `reference "${name}.${ext}" not found` });
              return;
            }
            if (ext === 'png') {
              sendRawFile(res, refPath, 'image/png');
            } else {
              sendRawJsonFile(res, refPath);
            }
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
            if (!isThumb && req.method === 'DELETE') {
              if (!existsSync(mapPath)) {
                sendJson(res, 404, { error: `map "${id}" not found` });
                return;
              }
              rmSync(mapPath);
              // Best-effort: a map may not have a thumb yet.
              const thumbPath = join(thumbsDir, `${id}.png`);
              if (existsSync(thumbPath)) {
                rmSync(thumbPath);
              }
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
