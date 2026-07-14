# Map Builder

> Status: in progress — Steps 1–7c done (see their Outcome notes below); Steps 8 and 10 are
> unaffected by anything since and still stand as written.
>
> **Steps 9, 11, 12 updated 2026-07-14** in light of plans 017–019, landed after this plan was
> written (see the update note inside each step for detail):
> - **Step 9** rebuilds on [plan 017](017-editor-tabbed-central-pane.md)'s tab-strip architecture
>   (which removed the `view: 'map'|'world'` toolbar toggle this step was originally written
>   against) and is now a hard prerequisite for plan 019, not just a nice-to-have.
> - **Step 11 is superseded** by [plan 018](018-runtime-map-loader.md) (L0, deployed) for its core
>   scope, with real divergences (no `?map=` param, no procedural fallback — deleted) and real gaps
>   (`zoneAt`, the world-integrity test, `MapConnections`) still open; multi-map consumption is
>   [plan 019](019-l1-map-streaming.md) (planned).
> - **Step 12** needs re-targeting at the actual `test.map.json` (not `test-camp.map.json`) and its
>   content-authoring work is now gated by two concrete external blockers named in 018/019 (the
>   `HUNGER_LETHAL` stopgap and 019's second-placed-map prerequisite), not just a leisurely
>   feature-exercise pass. Some of its doc updates already landed piecemeal via 018.

## Summary

A dev-only, in-repo map editor: a React web UI (asset library, layer/zone/inspector panels,
filtering/search) wrapping a Phaser canvas that renders the map pixel-identically to the game via
the existing `resolveTile` seam. It paints tile layers (incl. an autotile terrain brush ported from
`scripts/pixel-crawler/autotile.py`), places/transforms/stacks scenery objects, paints walkability,
zones, and the map's **irregular shape mask**, has undo/redo, and saves versioned custom-JSON map
files into `src/data/maps/` via a Vite dev-server middleware. A **world view tab** positions maps
in a single **global tile coordinate space** (`world.json`) so irregular maps tessellate — the
foundation for seamless walk-across between areas and for cross-map AI (monsters chasing the
player across biomes) later. The game consumes maps through a **lazy registry** (one eager
generated manifest + per-map code-split chunks behind `loadMap`/`releaseMap`) — the structure
future map streaming needs — and the editor exports a **thumbnail PNG per map** so a future
world-map/fast-travel screen can draw the world without loading a single map file. V1 is done
when sample test maps authored in the tool load and render in `GameScene` (tiles, scenery, nodes,
walkability). This delivers the OPEN "map editor" decision
(docs/DECISIONS.md ~L422) and lays the file format for the DECIDED multi-map registry (~L564).

## Context & decisions

**User decisions (interrogation):**

- Editor = Phaser-rendered viewport inside the repo, second Vite page, dev-only (not in prod build).
- Tool chrome = **React** (user's explicit call: usability/filtering beats pure-Phaser UI). Phaser
  renders only the map viewport.
- Custom JSON schema, not Tiled.
- World shape: multi-map registry (already DECIDED — fast travel via boat/car), zones as named
  regions **within** a map. Zones do **not** get their own tileset palettes — instead each zone has
  an editor **favourites list** of catalog assets for quick access.
- Map sizes vary dramatically per map → format stores explicit `width`/`height`; no hardcoded size.
- **Maps are irregular shapes and must fit together**: each map has a per-tile shape mask, and a
  world layout positions every map in one shared global tile coordinate space.
- **Travel between adjacent maps will eventually be seamless walk-across** (neighbouring maps
  stream in, no load screen). The streaming engine work is NOT in this plan — v1 game loads one
  map at a time — but the data model must not block it.
- **A single global coordinate system spans the whole world** so entity AI can operate across map
  boundaries later (user requirement: monsters must be able to chase the player across biomes).
  All map data stays map-local; the world origin is the only offset; global queries go through a
  derived ownership index, never stored data.
- **An in-game world map screen (fast travel between areas) is coming later** — the world must be
  drawable without loading map files (solved via editor-exported thumbnails + `world.json`; fast
  travel itself needs nothing beyond portals + registry connections).
- **Memory performance**: maps and their associated objects must be loadable/releasable as the
  player walks around. The streaming engine work stays out of scope, but the registry is built
  lazy-first now so streaming needs no API rewrite later.
- **Per-map world state must persist across visits** (e.g. a quest opens a gate → the gate is
  still open next visit). Handled as a contract, not code, in this plan: see the persistence
  rules in advisor round 4 below.
- V1 scope: tile painting, scenery place/scale/rotate/stack, areas/zones, painted walkability,
  shape editing, undo/redo, the **world view tab** (drag-position maps, overlap/adjacency
  feedback), **and** the game loading an authored map end-to-end.
- Assets: commit only game-ready extracted art, per-pack folder + manifest (source/licence/tile
  size); raw packs stay out of the repo.
- Definition of done: tool works end-to-end + **test** maps render in-game. Authoring the real
  Mostowo camp map is a follow-up.

**Advisor decisions — round 1, core schema (record in DECISIONS.md as DECIDED in the final step):**

- **Per-map palette encoding**: map file carries an append-only `palette` array of
  TileSource-shaped entries; layer cells are small ints indexing it, `0` = empty. Editor must
  never renumber existing palette indices on save (append-only; unused-entry GC only as an
  explicit user action) or every save churns the whole grid diff.
- **Maps live in `src/data/maps/*.map.json`** + typed `src/data/maps/index.ts` registry; every
  JSON import is narrowed through a pure validator in `src/systems/` (single choke point).
- **Zones = per-tile uint8 zone-id layer** (0 = none) + `defs` array — same brush/undo/storage
  machinery as walkability; "what zone is this tile" is an array index.
- **Objects = one array with `kind` discriminator** (`node` | `decor` | `portal`), every object
  has a **stable string `id`** (quests/dialog/gates will reference "the car on map X" later).
- **Connections/unlock-gates live in the registry, not map files** — maps only expose named
  `portal` markers; the registry wires portal→portal with gate conditions (v1: placeholder
  structure only).
- **Autotile**: baked frame indices are canonical (game loader stays dumb and pixel-exact); an
  editor-only semantic terrain section is stored alongside so the brush stays re-editable; editor
  rebakes on save.
- **Walkability layer = base terrain passability only**; runtime obstacles (walls, nodes)
  composite over it at runtime exactly as today (`isBlocked` closure).

**Advisor decisions — round 2, shape & world layout:**

- **Shape = per-tile mask** (`shape.cells`, 0 = void, 1 = inside, within the width×height
  bounding box; absent ⇒ all-inside, which migrates rectangular maps for free). Void-consistency
  is a `parseMap` invariant, not editor courtesy: void ⇒ every layer cell 0, no objects/portals
  overlap void, zone id 0. All cells arrays stay full width×height including void — uniformity
  over compression. Void feeds `isBlocked` as blocked. If a bounding-box resize grows left/top,
  the same editor operation must shift the map's world origin to compensate.
- **World placement = separate `src/data/maps/world.json`**:
  `{ schemaVersion, placements: [{ mapId, origin: { col, row } }] }` in **signed integer global
  tile coords**, validated by a pure system module (same choke-point pattern as `parseMap`).
  Dragging maps in the world view edits exactly this one file — map JSON diffs never churn.
  "Which map owns global tile (c,r)" is a **derived index** built at load (bbox pre-filter →
  shape-mask check), never stored.
- **Validation strictness**: ERROR = two placed maps' inside cells overlap in world space
  (ownership uniqueness — the one thing streaming cannot tolerate), placement referencing a
  nonexistent mapId, structural invalidity. WARNING = seam walkability mismatch (walkable edge
  cell facing neighbour void/blocked — often an intentional cliff/fence), diagonal-only
  adjacency, island maps (legitimate — boat/car), map missing from world.json (unplaced/dev
  map). Editor surfaces warnings as badges; only errors fail loads.
- **Seams are implicit derived connections** — computed at registry load from world.json + shape
  masks + walkability; never authored (authored copies of derivable truth rot). Portals remain
  for non-adjacent travel (boat/car fast-travel).
- **Seamless-readiness format rules**: (1) map files NEVER reference other maps — cross-map
  references are always `{mapId, objectId}` pairs held in registry/world files; this keeps every
  map independently loadable, which is what streaming actually requires. (2) Decor pixel coords
  stay map-local (offset = origin × TILE_SIZE at load). (3) NO chunking metadata in the format
  (engine tuning knob, derive at load). (4) NO per-edge connector declarations (derivable).
- **Ghost borders in v1**: in the per-map editing view, render read-only, dimmed, toggleable
  ghost strips (~12 tiles deep) of placed neighbours at world offset — tile-level seam
  continuity is only authorable when the neighbour's actual tiles sit next to your brush.
  Strictly non-interactive, re-read on demand (no live cross-editor sync), degrade gracefully if
  a neighbour file is missing/invalid, clip to the strip (never bake whole neighbour maps).

**Advisor decisions — round 3, registry loading, world map screen & memory:**

- **Lazy registry from day one**: maps load via `import.meta.glob('./maps/*.map.json')` (per-map
  code-split chunks) behind `loadMap(id): Promise<MapFile>` (through `parseMap`, cached) and
  `releaseMap(id)` (evicts the parsed-JSON cache entry only — texture/GameObject teardown is
  engine work; the registry holds no scene knowledge). Rationale: async costs one `await` today,
  while a sync registry would force rewriting every call site when streaming lands — and the
  memory requirement is stated, not speculative. Per-map chunks also keep big maps out of the
  main bundle. The dev-menu map list reads the manifest and must never trigger loads. The editor
  keeps using the dev middleware, never this registry — no coupling.
- **Eager data = one generated manifest** (`src/data/maps/manifest.json`): world.json
  placements plus per-map `{id, name, width, height}` — bbox-accurate `mapAt` without loading
  any map file;
  exact shape checks only for maps already loaded (streaming triggers on bbox proximity; by the
  time tile-exact ownership matters, that map is in memory). The manifest is **generated by the
  editor middleware on every save** — hand-editing it is forbidden, same as cells — and a cheap
  DEV assertion at load checks a loaded map's meta matches its manifest row. If exact-eager
  lookup is ever needed, adding an RLE shape mask to the manifest is a regen, not reauthoring.
- **World map screen = committed thumbnails**: the editor exports a **1px-per-tile PNG** per map
  on **every** save (not just from the world view) to `public/assets/maps/thumbs/<id>.png` — a
  prod asset (it's game content, unlike the editor). The future world-map/fast-travel screen
  renders thumbnails at world.json origins, loading zero map files — the only approach
  compatible with the memory requirement. **Fast travel needs nothing new in the format**: a
  fast-travel node is a portal whose registry connection carries a travel kind/gate; per-map
  markers would duplicate the portal concept.
- **Memory-release enumeration**: pure `collectTextureSources(map)` walker — palette entries +
  decor asset refs in `mapFormat.ts`, with node-ref→texture resolution layered on in the
  registry (keeps `mapFormat.ts` dependency-light). This derived enumeration is what
  preload/refcount/release will consume; storing it in files would be denormalised derivable
  data. RenderTexture destruction, cross-map sheet refcounting, object pooling = engine work,
  out of scope.

**Advisor decisions — round 4, persistent per-map state (contract only — no code in this plan):**

- **Authored map files are immutable and never contain runtime state.** Persistent mutations
  (opened gate, looted container, …) are a **save-side overlay** keyed `{mapId, objectId}`,
  applied **above** the registry — `loadMap` → apply overlay → scene — so `loadMap` stays a pure
  authored-file fetch and the cache never holds mutated maps. The overlay's types/patch
  semantics are deliberately deferred to the save/quest plan (they're purely additive — no map
  file, registry API, or authored content changes when they arrive; designing patch semantics
  without the consumer in hand risks a guessed-wrong API the save plan then inherits).
- **Authoring rule (enforce in docs/EDITOR.md):** *anything that can change at runtime must be
  an object, never painted into tile layers.* Doors, gates, breakable barricades, lootable
  containers = objects with stable ids and `collision` footprints; tile layers are immutable
  scenery. A gate opening = overlay removes/patches the object → its footprint vanishes → tiles
  unblock via the existing `isBlocked` composition. Consequently walkability/zones/shape/tile
  cells are NEVER overlayable — no new mechanism needed, by design.
- Red flags recorded for the save plan: runtime-spawned objects will need an id namespace (e.g.
  `rt_` prefix) to avoid colliding with authored ids; `parseMap` stays strict (overlays never
  enter map files — don't tolerate unknown fields in anticipation); never author per-state tile
  variants (e.g. an "open gate" tile) next to a stateful object — per-state sprites belong to
  the future object/state model.

**Map file schema v1** (authoritative shape — step 1 implements):

```jsonc
{
  "meta": { "schemaVersion": 1, "id": "test-camp", "name": "Test Camp", "width": 45, "height": 80, "tileSize": 16 },
  "shape": { "cells": [ /* width*height row-major, 0 = void, 1 = inside; absent = all inside */ ] },
  "palette": [ /* index 0 reserved = empty; entries: { "pack": "pixel-crawler", "source": <TileSource> } */ ],
  "layers": [ /* ordered, render bottom→top */
    { "id": "ground", "name": "Ground", "kind": "tiles", "overhead": false, "cells": [ /* width*height row-major palette indices */ ] }
  ],
  "terrain": [ /* editor-only semantic autotile data: { "layerId", "terrainId", "cells": 0|1 mask } */ ],
  "walkability": { "cells": [ /* 0 = walkable (default), 1 = blocked */ ] },
  "zones": {
    "defs": [ { "id": 1, "name": "Camp", "colour": "#88aa44", "favourites": [ /* catalog asset ids */ ] } ],
    "cells": [ /* uint8 zone ids, 0 = none */ ]
  },
  "objects": [
    { "id": "node_0001", "kind": "node", "ref": "tree", "col": 10, "row": 12 },
    { "id": "decor_0001", "kind": "decor", "asset": "pixel-crawler/…", "x": 100, "y": 200,
      "scaleX": 1, "scaleY": 1, "rotation": 0, "flipX": false, "flipY": false, "depth": 0,
      "collision": { "col": 6, "row": 12, "w": 1, "h": 1 } },
    { "id": "portal_south", "kind": "portal", "name": "South road", "rect": { "col": 20, "row": 79, "w": 4, "h": 1 }, "facing": "down" }
  ]
}
```

**World layout schema v1** (`src/data/maps/world.json` — step 1 implements):

```jsonc
{
  "schemaVersion": 1,
  "placements": [
    { "mapId": "test-camp", "origin": { "col": 0, "row": 0 } },
    { "mapId": "test-forest", "origin": { "col": 45, "row": 12 } }
  ]
}
```

**Generated artifacts (committed, never hand-edited):** `src/data/maps/manifest.json`
(regenerated by the editor middleware on every map/world save; the game's ONLY eager map
import), `public/assets/maps/thumbs/<id>.png` (1px-per-tile thumbnails, exported on every map
save), `public/assets/asset-catalog.json` (regen via `npm run assets:catalog`).

**Key repo facts (from research — verify against live code, cite paths):**

- Tile seam to reuse verbatim: `src/data/tileset.ts` — `TileSource` union
  (`{kind:'image',path}` | `{kind:'sheetFrame',sheet,frame}`), `resolveTile()`, `sheetKey`,
  `tileImageKey`. `TILE_SIZE = 16` (`src/config.ts`). Terrain sheets are 25 cols → `frame = row*25 + col`.
- World today is hardcoded/procedural: `drawGround()` bakes weighted-random grass into
  `RenderTexture` chunks of `GROUND_CHUNK_ROWS = 32` rows using the **batch API**
  (`beginDraw…batchDrawFrame…endDraw` — per-tile drawFrame took ~25s once, DECISIONS.md ~L169);
  `spawnTrees()` places `NODES` at hardcoded `[col,row]`; no walkability grid is stored —
  `isBlocked(col,row)` (GameScene) = occupied walls set OR live node with `blocksPath`.
- Grid: `src/systems/grid.ts` (`worldToTile`, `tileToWorldCenter`, `tileKey`); A* in
  `src/systems/pathfind.ts` takes an `isBlocked` closure + `Dims`.
- Depth layers are fixed (ground 0, nodes/walls 1, fog 5, ghost 6, enemy 9, player 10, night 15) —
  authored decor needs to slot in around these; `overhead` tile layers render above the player.
- Vite is **single-entry** today (`index.html` → `src/main.ts`); `base` = `/mostowo-survival/` in
  prod. Editor page must NOT enter the prod build (`build.rollupOptions.input` stays index-only;
  `vite dev` serves extra `.html` files automatically).
- Assets: `public/assets/tilesets/<pack>/` — `pixel-crawler/` active (181 PNGs; grid tilesheets
  under `Environment/Tilesets/` @16px; `*-Sheet.png` animation strips; the rest multi-object
  sheets); `zombie-apocalypse/` retired; self-made/derived art in `pixel-crawler/_derived/`.
  Pack paths contain **spaces** → `encodeURI` URLs (see PreloadScene).
- Tests: Tier 1 = Vitest, plain Node, `src/**/__tests__/*.test.ts`, **no Phaser imports** in pure
  systems (mirror `src/systems/__tests__/grid.test.ts`). Tier 2 = Playwright e2e against the
  DEV-only `window.game.__test.applyScenario` seam (`tests/e2e/harness.ts`). Tier 3 = `npm run smoke`.
- Conventions: content is data in `src/data/`, logic is pure modules in `src/systems/`; pixel-art
  integer scale + nearest-neighbour; scenes communicate via `game.events` + `registry`; dev
  affordances go through the UIScene dev-menu pattern (`debug:*` events).
- `npm run check` = typecheck + lint + lint:md + format:check + test — every step must leave it green.
- **Plan 013 (GameScene OOP refactor) is planned but unexecuted** — step 11 below touches
  GameScene; whichever plan executes second must adapt to the other's changes.

**New dependencies** (step 4): `react`, `react-dom`, `@vitejs/plugin-react`, `zustand` (tiny
store bridging React ↔ Phaser), `@types/react`, `@types/react-dom`. All used only by the editor
entry, which is excluded from the game's prod build.

**Pixel-art vs free transforms:** decor `rotation` is stored in degrees; the editor snaps to 90°
steps by default (Shift = free rotate) and scale steps default to integers (free scale allowed) —
free values render nearest-neighbour and are the author's aesthetic call.

## Steps

- [x] **Step 1: Map format + world layout modules — types, validate, serialize, migrate** `[delegate sonnet]` (parallel: A)
  - Create `src/systems/mapFormat.ts` (pure, **no Phaser imports**): TypeScript types for the full
    map schema v1 in Context above (`MapFile`, `MapMeta`, `MapShape`, `TilePaletteEntry`,
    `TileLayer`, `MapObject` discriminated union, `ZoneDef`, …). Reuse/import the `TileSource`
    type from `src/data/tileset.ts` (type-only import is fine — it must not drag Phaser in;
    verify `tileset.ts` is Phaser-free first, else duplicate the type shape locally with a comment).
  - Export: `parseMap(json: unknown): MapFile` (validates shape + invariants, throws with a
    precise message on failure), `serializeMap(map: MapFile): string` (stable key order,
    2-space indent, cells arrays on compact single lines per row where practical — diff-friendly),
    `createEmptyMap(id, name, width, height): MapFile` (shape all-inside),
    `migrateMap(json): MapFile` (switch on `meta.schemaVersion`; v1 = identity, structure ready
    for v2+), cell helpers `cellIndex(col,row,width)`, `getCell`/`setCell`,
    `isInside(map, col, row)`, and `collectTextureSources(map)` (deduped union of palette
    entries + decor asset refs — the enumeration future preload/refcount/release consumes;
    node-ref→texture resolution is layered on in the registry, NOT here).
  - Map invariants to validate: cells arrays length === width*height (including `shape.cells`
    when present; absent shape ⇒ all-inside); palette index 0 unused/reserved; every cell index
    < palette.length; zone cell ids exist in `zones.defs`; object `id`s unique; `kind:'node'`
    `ref` values are non-empty strings (cross-check against `NODES` happens in the registry, not
    here); **void-consistency**: void cells have 0 in every tile layer, zone 0, and no
    object/portal footprint overlaps void.
  - Create `src/systems/worldLayout.ts` (pure): types for the world layout schema v1;
    `parseWorldLayout(json: unknown): WorldLayout`; `validateWorld(layout, maps:
    Record<string, MapFile>): { errors: string[], warnings: string[] }` implementing the
    ERROR/WARNING split from Context (overlap of inside cells = error; unknown mapId = error;
    seam walkability mismatch / diagonal-only adjacency / island / unplaced map = warnings);
    coordinate helpers `localToGlobal(origin, col, row)` / `globalToLocal(origin, gcol, grow)`;
    `buildWorldIndex(placements, metas, maps?)` → object answering
    `mapAt(gcol, grow): mapId | null` (bbox pre-filter from `{width,height}` metas; exact
    shape-mask check only for maps supplied/loaded) and `seams(mapId)` → derived adjacent-edge
    cell pairs. Also the manifest seam: `MapManifest` type (placements plus per-map
    `{id, name, width, height}`), `parseManifest(json)`, and pure
    `generateManifest(world, maps)` (the middleware re-implements generation in plain JS — keep
    the shape trivially simple; this pure version serves tests + the DEV consistency assertion).
    This module is the global-coordinate seam future cross-map AI (monster chases) paths through
    — keep it engine-agnostic.
  - Create `src/data/maps/` with a `README.md` stub (one paragraph: what lives here, "edit with
    the map editor, don't hand-edit cells or manifest.json"), an initial `world.json`
    (`schemaVersion: 1`, empty placements), and an initial empty `manifest.json`.
  - Unit tests `src/systems/__tests__/mapFormat.test.ts` + `worldLayout.test.ts` mirroring
    `grid.test.ts` style: round-trip serialize→parse; each invariant violation rejects (incl.
    void-consistency); migrate passes v1 through; empty-map factory sane; two overlapping
    placements error; seam-mismatch and island fixtures warn; `mapAt` resolves shaped edges
    correctly (a void cell inside a neighbour's bbox belongs to nobody) and answers bbox-level
    from metas alone; manifest round-trips and `generateManifest` output is deterministic;
    `collectTextureSources` dedups palette + decor refs.
  - Side effects: none — new files only.
  - Docs: none yet (final step writes docs/EDITOR.md).
  - Done when: `npm run check` green; tests cover round-trip + every invariant + the
    error/warning matrix.
  - Outcome: created `src/systems/mapFormat.ts` + `worldLayout.ts` (pure, Phaser-free;
    type-only `TileSource` import from `tileset.ts` + value `TILE_SIZE` from `config.ts`, both
    verified Phaser-free), tests `mapFormat.test.ts` (29) + `worldLayout.test.ts` (21), and
    `src/data/maps/{README.md,world.json,manifest.json}`. Palette index 0 is literal `null`
    (makes "reserved" structurally explicit). `serializeMap` = `JSON.stringify` (fields built in
    schema order so key order is stable) + a regex pass collapsing each `cells` grid to one
    compact row-per-line. Manifest shape = `{schemaVersion:1, placements:[], maps:[]}`.
    `validateWorld` seam/overlap checks walk inside-cells directly (no stored connections). No
    deviations. `npm run check` green (190 tests).

- [x] **Step 2: Asset pack manifests + catalog generator** `[delegate sonnet]` (parallel: A)
  - Hand-write `public/assets/tilesets/pixel-crawler/pack.json`: `{ id, name, author:
    "Anokolisa", sourceUrl, licence, tileSize: 16, rules }` where `rules` encode the pack's three
    load classes (from docs/ASSETS.md): paths matching `Environment/Tilesets/**` → grid tilesheet
    @16px; `*-Sheet.png` → animation strip (frame = sheet height); everything else → object image.
    Support an `overrides` map for exceptions and an `exclude` list. Include `_derived/` as
    object images with `origin: "self-made"`.
  - Create `public/assets/tilesets/mostowo-custom/` skeleton: `pack.json`
    (`licence: "original"`, same rules shape) + `.gitkeep` — the documented home for future
    self-made art.
  - Write `scripts/asset-catalog.mjs` (Node, no deps beyond `fs`/`path` + an image-size read —
    parse PNG IHDR directly, it's 8 bytes at a fixed offset; no new npm dep): scan each pack dir
    with a `pack.json`, apply its rules, and emit `public/assets/asset-catalog.json`:
    `{ generatedFrom, packs: [{id,name,licence,tileSize}], assets: [{ id, pack, type:
    "tile"|"strip"|"object", source: <TileSource-shaped>, w, h, frames?, category, tags[] }] }`.
    Asset `id` = `<pack>/<relative path>[#frame]` — stable across regens. `category` = first path
    segment(s) (e.g. `Environment/Tilesets`); `tags` = lowercased path words. For grid tilesheets
    emit ONE asset per sheet (`type:"tile"`, `frames` = count) — the editor expands frames itself;
    don't emit thousands of per-frame entries.
  - Add npm script `"assets:catalog": "node scripts/asset-catalog.mjs"`; commit the generated
    catalog (deterministic output: sort everything).
  - Side effects: `package.json` (script only — no dep changes; NOTE: step 4 also edits
    package.json, keep them sequential w.r.t. each other via the parallel grouping given).
  - Docs: docs/ASSETS.md — add a short "Pack manifests & asset catalog" section (what pack.json
    is, how to regen the catalog, where self-made art goes). Terse.
  - Done when: `npm run assets:catalog` runs clean, catalog JSON validates against its own shape,
    spot-check: grass tilesheet appears as one `tile` asset with correct frame count; `_derived/`
    objects present; `npm run check` green.
  - Outcome: created `pixel-crawler/pack.json` (rules: `tile`=`Environment/Tilesets/**`,
    `strip`=`**/*-Sheet.png`, `selfMade`=`_derived/**`; one `override` for Skeleton
    `Death-Sheet.png` 96px frames → 8, matching `tileset.ts`), `mostowo-custom/` skeleton
    (`pack.json` + `.gitkeep`), `scripts/asset-catalog.mjs` (Node builtins only; hand-rolled PNG
    IHDR read at byte 16/20; deterministic sort; `generatedFrom` = sorted pack ids, no
    timestamp), committed `public/assets/asset-catalog.json` (187 assets, 2 packs). Added
    `assets:catalog` npm script (no dep changes) + terse ASSETS.md section. Strips = horizontal,
    frame side = smaller image dim (documented in code). 19 unwired crafting-station sheets
    don't divide evenly → best-effort count + non-fatal `console.warn` (script exits 0). Verified
    `Floors_Tiles.png` → one `tile`, 650 frames (25×26); 6 `_derived/` objects present; double-run
    byte-identical. `npm run check` green.

- [x] **Step 3: Port the autotiler to TypeScript** `[delegate sonnet]` (parallel: A)
  - Read `scripts/pixel-crawler/autotile.py` and port its 8-neighbour "blob" logic to
    `src/systems/autotile.ts` (pure, no Phaser): `blobKey(mask, col, row)` (the 8-neighbour key
    with corner-suppression exactly as the Python does it), a mapping type from blob key → tile
    frame, and `paintMask(mask, dims, terrainMapping) → per-cell frame assignments`.
  - Keep the Python file untouched (it still serves the offline pipeline).
  - Unit tests `src/systems/__tests__/autotile.test.ts`: hand-computed fixtures — single cell,
    2×2 block, straight edge, inner corner, plus-shape — asserting exact keys/frames. Derive
    expected values by reading the Python logic (or running it) so TS matches Python
    cell-for-cell.
  - Side effects: none — new files only.
  - Docs: none (final step records the port in DECISIONS/STATUS).
  - Done when: tests pass with fixtures that demonstrably match the Python's output; `npm run check` green.
  - Outcome: created `src/systems/autotile.ts` (pure; `blobKey(mask,dims,col,row)` packs the
    Python's 8-neighbour tuple with identical corner-suppression, OOB = 0; `TerrainMapping` =
    `Record<number,number>`; `paintMask` mirrors Python's fallback tiers exact→cardinal→FULL→omit,
    deterministic lowest-key pick replacing Python's random variant since our mapping is one
    canonical frame per key; `Dims` reused type-only from `pathfind.ts`) + `autotile.test.ts` (11
    tests). Expected values were generated by running the untouched `autotile.py` (`blob_key`) on
    the same 6 fixtures — real Python output, not re-derived. Python file left untouched.
    `npm run check` green.

- [x] **Step 4: Editor entry — React shell, Vite wiring, save middleware** `[delegate sonnet]`
  - Add deps: `react`, `react-dom`, `zustand`; dev-deps: `@vitejs/plugin-react`, `@types/react`,
    `@types/react-dom`.
  - `editor.html` at repo root (Vite serves root `.html` files in dev automatically) →
    `src/editor/main.tsx`. React `createRoot`, minimal three-pane layout shell: left =
    Library placeholder, centre = viewport placeholder div, right = Inspector/Layers placeholder.
    Plain CSS (one `src/editor/editor.css`, dark theme, `image-rendering: pixelated` utility
    class). No game code imported yet.
  - `vite.config.ts`: add `@vitejs/plugin-react`; ensure prod build still bundles ONLY the game —
    set `build.rollupOptions.input` explicitly to `index.html`. Verify `npm run build` output
    contains no editor chunks and no React.
  - `tsconfig.json`: enable `"jsx": "react-jsx"`. Check `eslint.config.js` + lint-staged cover
    `.tsx` (add extensions where needed).
  - Write the dev middleware as a small inline Vite plugin (e.g. `scripts/vite-editor-api.mjs`,
    used from `vite.config.ts`, active in `serve` mode only): `GET /__editor/maps` → list ids from
    `src/data/maps/*.map.json`; `GET /__editor/maps/:id` → file contents; `PUT /__editor/maps/:id`
    → write body to `src/data/maps/<id>.map.json`; `GET`/`PUT /__editor/world` →
    `src/data/maps/world.json`; `PUT /__editor/maps/:id/thumb` (PNG body) →
    `public/assets/maps/thumbs/<id>.png`. After every map/world PUT the middleware
    **regenerates `src/data/maps/manifest.json`** (plain `fs`: read each map's `meta` +
    `world.json`, write sorted/deterministic output — plain JS re-implementation of the
    trivially simple shape; the pure `generateManifest` in `worldLayout.ts` guards it via
    tests/DEV assertion). Sanitise `:id` to `[a-z0-9-]+` — no path traversal. Map/world content
    is validated client-side before PUT (middleware stays dumb).
  - Add npm script `"editor": "vite --open /editor.html"`.
  - `src/editor/api.ts`: typed fetch wrappers for the endpoints.
  - Side effects: `package.json`/`package-lock.json`, `vite.config.ts`, `tsconfig.json`,
    `eslint.config.js` — all shared files; this step must run alone (not parallel). Confirm game
    still boots (`npm run smoke`) and `npm run build` stays editor-free.
  - Docs: docs/WORKFLOW.md — add `npm run editor` one-liner to the commands list.
  - Done when: `npm run editor` opens the shell; a curl round-trip PUT→GET on
    `/__editor/maps/test` and `/__editor/world` writes/reads files and regenerates
    `manifest.json`; a thumb PUT lands in `public/assets/maps/thumbs/`; `npm run build` +
    `npm run smoke` + `npm run check` green.
  - Outcome: deps resolved cleanly — React 19.2.7 + react-dom 19.2.7 + zustand 5.0.14 (deps),
    `@vitejs/plugin-react@4.7.0` pinned (latest 5.x/6.x require Vite 7/8, repo is on Vite 6) +
    `@types/react`/`@types/react-dom` (dev). Created `editor.html` (root, dev-only) →
    `src/editor/main.tsx` (three-pane placeholder shell, no game/Phaser import) +
    `src/editor/editor.css` (dark theme, `.pixelated` utility) + `src/editor/api.ts` (typed fetch
    wrappers). `scripts/vite-editor-api.mjs`: inline Vite plugin, plain Node/fs, implements the 6
    endpoints; `:id` sanitised to `[a-z0-9-]+` (verified curl path-traversal + bad-id both 400);
    manifest regen is a hand-kept plain-JS mirror of `generateManifest` (same shape/sort — verified
    byte-for-byte via a 3-map curl test: ids/maps sorted `aaa-map, test, zzz-map`). `vite.config.ts`
    switched to the function form of `defineConfig` to gate `editorApiPlugin()` on
    `command === 'serve'`, added `react()`, and pinned `build.rollupOptions.input: 'index.html'`.
    `tsconfig.json` +`"jsx": "react-jsx"`. `eslint.config.js`: both `src/**/*.ts`-scoped `files`
    globs extended to include `src/**/*.tsx` (base `tseslint.configs.recommended` already covered
    `.tsx`, no change needed there). `package.json`: `"editor": "vite --open /editor.html"` script,
    lint-staged `*.ts` → `*.{ts,tsx}`. Verified: `npm run build` output has no `editor.html`/React
    markers in the single `index-*.js` chunk (grepped for `createRoot`/`react-dom`/`__editor`/
    `EditorShell` — zero hits; bundle size unchanged, ~1.56 MB); `vite dev` serves `/editor.html`
    (200, React-refresh preamble present); full curl round-trip on maps/world/thumb + manifest
    regen verified, then `src/data/maps/{test,aaa-map,zzz-map}.map.json` and the thumb PNG deleted
    and `world.json`/`manifest.json` rewritten back to their committed empty content (zero `git
    diff`) — no stray test map survives. `npm run smoke` green against the already-built `dist/`.
    `npm test` (195) and `npm run lint`/`lint:md` green throughout. `npm run typecheck`/
    `format:check` were red at final check time only in files outside this step's scope
    (`src/scenes/build/BuildManager.ts`, `src/scenes/GameScene.ts`, `src/systems/base.ts` — a
    concurrent session's in-flight, uncommitted edit touching `BuildManagerDeps`; confirmed by an
    earlier clean `npm run typecheck` run before that edit landed, and by `git status` showing
    those files modified mid-session, not by this step). No files this step owns are implicated.

- [x] **Step 5: Editor store, history, and the Phaser viewport** `[delegate opus]`
  - `src/editor/store/history.ts` (pure, unit-testable): generic command stack —
    `apply(cmd)`, `undo()`, `redo()`, commands carry `do`/`undo` closures or patch pairs; coalesce
    consecutive paint strokes into one entry (stroke id). Tests in
    `src/editor/store/__tests__/history.test.ts` (Tier 1 — plain Node, no React/Phaser).
  - `src/editor/store/editorStore.ts` (zustand): `{ view ('map'|'world'), map: MapFile | null,
    mapId, dirty, world: WorldLayout, catalog, activeLayerId, activeTool
    ('pan'|'brush'|'eraser'|'fill'|'rect'|'select'|'collision'|'zone'|'shape'), brushAsset,
    selectedObjectIds, activeZoneId, overlays: {grid,walkability,zones,ghosts}, … }` + actions
    that route all document mutations through the history stack. React subscribes via hooks;
    Phaser reads via `store.getState()`/`subscribe` — the store is the single React↔Phaser
    bridge; neither imports the other.
  - `src/editor/PhaserViewport.tsx`: mounts a `Phaser.Game` (`pixelArt: true`, transparent
    background, parent = the centre div, `Phaser.AUTO`) running one `EditorScene`
    (`src/editor/EditorScene.ts`). Destroy on unmount.
  - `EditorScene`: on map load, queue-load every texture the palette + objects + catalog-browse
    need — palette/decor entries resolve through `resolveTile`/`sheetKey`/`tileImageKey` from
    `src/data/tileset.ts` with the same `encodeURI` handling as PreloadScene (extract a small
    shared helper if trivial, else mirror it). Render tile layers bottom→top (per-layer
    `RenderTexture` baked with the **batch API**, chunked by 32 rows like `drawGround` — rebake
    only dirty chunks on edits), then objects (images with transform), then overlay graphics
    (grid lines, hover cell). **Void cells render as a dark checker/hatch** and reject the hover
    cursor. Camera: wheel = zoom (integer steps ×1–×4 around cursor), middle-drag/space-drag =
    pan, clamped to map bounds + margin.
  - Toolbar (React, top bar): New (dialog: id/name/width/height → `createEmptyMap`), Open (list
    from `GET /__editor/maps`), Save (serialize → validate with `parseMap` → PUT; flash
    error toast on validation failure), Undo/Redo buttons + `Ctrl/Cmd+Z`/`Shift+Z` keys, dirty
    indicator, current map name, Map/World view switch (world view itself lands in step 9).
  - Side effects: none outside `src/editor/` (+ its tests).
  - Docs: none.
  - Done when: create a 45×80 empty map, save it, reopen it after reload; a hand-crafted map JSON
    with a few palette entries, a shaped (non-rectangular) mask, and one decor object renders
    correctly in the viewport (void hatched); pan/zoom feel right; history tests green;
    `npm run check` green.
  - Outcome: all in `src/editor/`. New: `store/history.ts` (pure generic command stack —
    `apply/undo/redo/clear/canUndo/canRedo`, `Command{do,undo,strokeId?}`, consecutive same-`strokeId`
    coalesce) + `store/__tests__/history.test.ts` (12 tests: apply/undo/redo, redo-invalidation,
    coalescing, 25-op unwind); `store/editorStore.ts` (zustand `subscribeWithSelector` — the single
    React↔Phaser bridge; all fields from the plan incl. full `activeTool` enum + `overlays`, plus
    `mapEpoch`/`docRevision` signals; `catalog` stubbed null till step 6; all doc mutations route
    through the history stack); `textureLoading.ts` (`tilesetAssetUrl` encodeURI mirror of
    PreloadScene + `parseAssetId`); `EditorScene.ts` (per-layer 32-row-chunked RenderTexture bake via
    batch API through `resolveTile`/`sheetKey`/`tileImageKey`; decor images; node/portal = labelled
    markers for now; void = dark checker+hatch, rejects hover; grid+hover overlays; wheel zoom ×1–×4
    around cursor, middle/space-drag pan, fit-on-load; failed textures logged+skipped);
    `PhaserViewport.tsx` (mounts Phaser.Game pixelArt/transparent/AUTO into centre div,
    StrictMode-safe destroy); `Toolbar.tsx`/`NewMapDialog.tsx`/`OpenMapDialog.tsx`/`Toast.tsx`/
    `EditorApp.tsx` (New→`createEmptyMap`, Open via `GET /__editor/maps`, Save serialize→`parseMap`→
    `putMap`+error toast, Undo/Redo buttons + Ctrl/Cmd+Z / Shift+Z keys, dirty dot, Map/World switch
    with World = step-9 placeholder). Modified: `main.tsx` (renders `EditorApp`), `editor.css`.
    Verified: history 12/12; programmatic save→reopen round-trip through the REAL middleware
    (createEmptyMap 45×80 → serialize → PUT → GET → parse, byte-identical + fixed-point, manifest
    regenerated), cleaned up to zero `src/data/maps/` diff; dev-server transforms the editor entry
    (React+Phaser+zustand) 200 OK; scoped gate green — `tsc --noEmit` exit 0, `eslint src/editor` 0
    errors (5 sanctioned Phaser-`on` warnings), `prettier --check src/editor` clean, `vitest` 207/207.
    ⚠ VISUAL acceptance (shaped map w/ palette+decor renders, void hatched, pan/zoom feel) NOT
    machine-verified — needs a human at `npm run editor`. Painting/dirty-chunk narrowing is stubbed
    for step 6 (`onDocEdited` full-rebakes with a seam comment).

- [x] **Step 6: Asset library panel + tile painting** `[delegate sonnet]`
  - `src/editor/panels/LibraryPanel.tsx`: loads `asset-catalog.json`; pack + category tree,
    text search over id/tags, favourites (per active zone — heart toggle writes into
    `zones.defs[activeZone].favourites`; a "Favourites" pseudo-category shows them; with no
    active zone, hearts write to a map-level favourites list in `meta` — add optional
    `meta.favourites: string[]` to the schema in `mapFormat.ts` with a test). Tile-type assets
    expand to a frame grid. Previews: CSS sprites from the pack PNGs
    (`image-rendering: pixelated`, `background-position` from frame index; sheets are 25 cols —
    read cols from catalog `w`/tileSize, don't hardcode). Clicking a tile frame sets
    `brushAsset`; clicking an object asset arms object-placement (step 7).
  - Painting in `EditorScene`: pointer → `worldToTile` (reuse `src/systems/grid.ts`) → tools:
    **brush** (drag paints; palette lookup: find-or-append the asset's TileSource in
    `map.palette` — never renumber), **eraser** (cell→0), **fill** (flood 4-connected same-value),
    **rect** (drag rectangle). **All paint tools skip void cells** (`isInside` guard; flood fill
    is bounded by the shape mask). All mutations go through store actions → history
    (stroke-coalesced); dirty-chunk rebake keeps painting smooth.
  - `src/editor/panels/LayersPanel.tsx`: list tile layers (bottom→top), select active, add/rename
    /delete/reorder, visibility eye, `overhead` checkbox. Deleting a layer = one undoable command.
  - Side effects: `src/systems/mapFormat.ts` (the optional `meta.favourites` addition + test).
  - Docs: none.
  - Done when: can find a tile via search, paint/erase/fill/rect on two layers, undo/redo a
    stroke, save→reopen preserves everything; painting refuses void cells; palette in saved JSON
    is append-only across repeated edits (verify by diffing two consecutive saves);
    `npm run check` green.
  - Outcome: `meta.favourites?: string[]` added to `MapMeta` (last field, parsed only when present,
    omitted from serialization when absent so old maps round-trip byte-identical) + 3 tests in
    `mapFormat.test.ts` (now 32). New pure, Phaser/React-free `src/editor/paintOps.ts` (`floodFill`,
    `rectCells`, `lineCells` Bresenham, `cellsToChanges`, `findOrAppendPaletteIndex` — append-only,
    never renumbers; generic over `cells[]`+dims+`isInside` so step 8 reuses it) + 23 tests. Store
    (`editorStore.ts`) gained paint actions (`paintLine`/`eraseLine`/`fillFrom`/`paintRectArea`),
    layer actions (`addLayer`/`renameLayer`/`deleteLayer`/`moveLayer`/`toggleLayerOverhead`/
    `toggleLayerVisibility`), `toggleFavourite`, catalog wiring (`setCatalog` + real `EditorCatalog`
    type), `armedObjectAsset` (step-7 stub), and `pendingDirty`/`consumePendingDirty` for narrow
    rebakes; +20 store tests. `EditorScene.ts` wires pointer paint (brush=coalesced stroke, eraser,
    fill, rect w/ live preview outline), consumes `pendingDirty` to rebake only touched chunks
    (full-rebake fallback for undo/redo/reorder), and hides layers via editor-only `hiddenLayerIds`
    (NOT map data). New `src/editor/catalog.ts` (types + fetch), `panels/LibraryPanel.tsx` (pack→
    flat-category tree, id/tag search, per-frame tile grid via CSS `background-position`, Favourites
    pseudo-category), `panels/LayersPanel.tsx` (top-first list, CRUD/reorder/overhead/eye), wired
    into `EditorApp.tsx` + a pan/brush/eraser/fill/rect tool strip in `Toolbar.tsx` + `editor.css`.
    Deviations: strip/object library previews are whole-image "contain" swatches (per-frame crops
    are step-7 object work); undo/redo deliberately does NOT bump `mapEpoch` (avoids camera reset) —
    reorder needs no special case because RT depth tracks array position, so the full per-chunk
    rebake fixes it. `npm run check` green (262 tests). NOT machine-verified (no React/DOM harness in
    this repo, per step 5): the live visual/interactive experience — needs a human at `npm run
    editor`. Palette-append-only + save→reopen data path WAS verified programmatically via the real
    dev middleware (two consecutive saves: palette grew append-only, earlier indices unchanged).

- [x] **Step 7: Scenery objects — place, transform, stack; portals** `[delegate sonnet]`
  - Placement: with an object asset armed, click in viewport places a `decor` object at pointer
    (snap-to-tile-centre toggle in toolbar, default ON via `snapToTileCenter` from
    `src/systems/grid.ts`; hold Alt = free px). Auto-id `decor_NNNN` (scan existing ids for max).
    A separate "Nodes" library section lists `NODES` entries (import from `src/data/nodes.ts`;
    render preview via the node's tileset role) and places `kind:'node'` objects at col/row.
    Placement on/overlapping void cells is rejected (matches the parseMap invariant).
  - Select tool: click picks topmost object under pointer (depth then insertion order — mirror
    the game's `pickSpriteAt` intent, simple bounds check is fine in-editor); shift-click
    multi-select; drag moves (snapped/free); Delete key removes.
  - `src/editor/panels/InspectorPanel.tsx`: numeric fields for x/y (or col/row for nodes),
    scaleX/Y, rotation, flipX/Y, depth; buttons: rotate ±90°, flip H/V, bring-forward/send-back
    (depth bump — this is how stacking order is controlled), duplicate. Rotation snaps 90° via
    buttons; the field accepts free degrees. Scale steps ±1 via buttons; field accepts floats.
  - Portals: a "Portal" tool draws a tile rect, prompts for name + facing → `kind:'portal'`
    object; rendered in-editor as a labelled outline.
  - All mutations undoable via the history stack.
  - Side effects: none outside `src/editor/`.
  - Docs: none.
  - Done when: place two decor objects overlapping, reorder their stacking, rotate one 90° and
    free-rotate another, place a `node:tree` and a portal; placement on void is refused;
    save→reopen preserves all; undo walks every operation back; `npm run check` green.
  - Outcome: implemented entirely within `src/editor/`. New: `objectOps.ts` (pure
    `objectFootprintCells`/`footprintIsValid` mirroring mapFormat's PRIVATE footprint logic — can't
    import it, editing mapFormat is out of scope — plus `nextObjectId` `<prefix>_NNNN` auto-id) +
    `__tests__/objectOps.test.ts` (11); `panels/InspectorPanel.tsx` (per-kind numeric fields +
    rotate±90 / flip H·V / bring-forward / send-back / duplicate / delete buttons; free rotation &
    float scale via the fields); `PortalDialog.tsx` (name + facing modal opened after a valid portal
    rect-drag); `store/__tests__/editorStoreObjects.test.ts` (19, incl. the full done-when scenario).
    Modified: `store/editorStore.ts` (`EditorTool` +`'place'`/`'portal'`; new
    `armedNodeRef`/`snapToTileCenter`/`pendingPortalRect`; a `reconcileSelection` helper wired into
    `applyCommand`/`undo`/`redo` so `selectedObjectIds` never dangles; 12 object actions —
    place/create-portal/translate/delete/duplicate/update{Decor,Node,Portal}/rotate/flip/bumpDepth —
    all void-gated via `footprintIsValid` and routed through the history stack); `EditorScene.ts`
    (object hit-test + selection-outline Graphics; select-tool click/shift-click/drag with
    live-preview → commit-and-validate on pointer-up → snap-back if the move lands on void; place-tool
    click places armed decor (snap default, Alt = free px) or node at col/row; portal tool
    rect-drag → `pendingPortalRect`; placed nodes render as their real tile-role sprite matching
    `ResourceNodeManager.addNode` sizing/origin, marker fallback); `Toolbar.tsx` (Select/Place/Portal
    buttons — Place disabled until armed — + a Snap checkbox); `EditorApp.tsx` (Delete/Backspace →
    `deleteObjects` with the same INPUT/TEXTAREA/SELECT guard as undo/redo; Inspector wired ABOVE
    Layers; PortalDialog rendered from `pendingPortalRect`); `panels/LibraryPanel.tsx` (a "Nodes"
    pseudo-category listing `NODES` with real tile-role previews; arming a decor/node switches to the
    Place tool, mirroring pickTile→Brush); `editor.css` (snap-toggle + inspector styles). Deviations:
    placement auto-selects the new object; duplicate offsets one tile but stacks at the original
    position if the offset would land on void; nodes aren't favouritable (favourites are catalog-asset
    ids, a different id space); drag follows the pointer continuously and snaps only on commit.
    Verified: 292/292 vitest (incl. 30 new step-7 tests), the done-when data-path scenario green
    (two overlapping decor placed, depth reordered, one 90° + one free-rotated, `node:'tree'` + portal
    added, `serializeMap`→`parseMap` round-trips byte-identical + passes void-consistency, a void
    placement refused, undo unwinds to empty), eslint `src/editor` 0 errors (5 sanctioned
    unbound-method warnings), prettier clean, `tsc --noEmit` zero errors under `src/editor/**`. NOT
    machine-verified (no React/DOM harness, per steps 5/6): the live click-through at `npm run editor`.
    ⚠ `npm run check` aggregate typecheck is RED **only** on `src/scenes/{GameScene,fx/TaskGlowRenderer}.ts`
    — a concurrent session's in-flight plan-016 `'refuel'` task work, outside this step's scope and
    untouched here.

- [x] **Step 7a: Atlas sprite regions + animated-decor data pipeline** `[delegate sonnet]`
  - **Why:** ~50 of 55 `object`-type catalog assets are actually multi-sprite ATLASES (e.g.
    `Environment/Props/Static/Furniture.png` 800×864, `Rocks.png`, tree sheets holding several
    variants); placing one drops the WHOLE sheet as one decor. Decision (with user + advisor,
    record in DECISIONS.md at the final step): do NOT physically split atlases into files (avoids
    committing hundreds of binaries, preserves the pack "re-download and drop in" principle, keeps
    atlas texture-sharing). Instead carry per-sprite **bounding-box metadata** and crop at render;
    a future build/stream step can bake only used regions into a per-map atlas WITHOUT touching
    authored data (the data model keeps that open by construction). Animation strips
    (`*-Sheet.png`, one sprite N frames) are placed as ANIMATED decor, not dumped whole.
  - Create `scripts/pixel-crawler/gen_regions.py` reusing `components()` from
    `scripts/pixel-crawler/objects.py` (leave objects.py untouched): for each multi-object `object`
    sheet, detect sprite bounding boxes and emit a committed sidecar
    `public/assets/tilesets/pixel-crawler/regions.json`. **Classify sheets by READING the
    `pack.json` `rules`** (the same source `asset-catalog.mjs` uses — do NOT re-derive a parallel
    NOT-Tilesets/NOT-`-Sheet` copy, or the two silently drift when a rule changes; critique #4):
    the sidecar is built for whatever the pack classifies as `object`. Sidecar shape:
    `{ schemaVersion:1, sheets: { "<relpath>": { params:{alphaThresh,gap,minArea},
    regions:[{ key:"<x>_<y>", x, y, w, h }] } } }`. Region `key = "${x}_${y}"` (coordinate-derived,
    NOT ordinal — stable across regens unless a sprite actually moves). Per-sheet detection-param
    overrides (and hand-authored region lists for pathological sheets where touching sprites merge)
    live in `pack.json` (a new `regionParams`/`regions` override map); the Python script reads them.
    Contributor regen: `python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog`.
  - Extend `scripts/asset-catalog.mjs` (stays no-npm-dep, never decodes pixels): merge
    `regions.json` — an `object` asset with **≥2 detected regions** gains `regions:[{key,x,y,w,h}]`
    (an atlas); **1 or no entry** stays a plain single object (a 37×76 tree keeps no `regions`).
    Validate the sidecar: every entry references an existing PNG; every region is in-bounds vs the
    IHDR w/h the script already reads (FATAL on OOB — a stale sidecar). Also emit explicit
    `frameWidth`/`frameHeight` on `strip` entries — but **fix the frame math (critique #1): a strip
    is a horizontal row of `frames`, so `frameHeight = sheet height` and `frameWidth = w / frames`,
    NOT the existing square/smaller-dim `stripFrames` guess** (that guess is provably wrong for the
    non-square strips 7b animates — `Fire_01` 128×48, the 19 crafting-station sheets step 2 flagged
    as not dividing evenly — and reproduces the flicker/"flying" slice bug `StripAnim.frameWidth`
    exists to fix, see `src/data/tileset.ts` L44-50). `frames` for a strip must come from a
    `pack.json` override where `w` isn't an integer multiple of the frame width (don't guess);
    warn non-fatally on an unresolved strip. The `anim` block stays the explicit
    `{frameWidth, frameHeight, frames, fps}` (what Phaser `load.spritesheet` consumes directly) —
    the alignment with `StripAnim` is the REASONING, not the field names: declare width AND height
    explicitly, never re-derive a square guess. Warn (non-fatal, like the existing strip warnings)
    when a large `object` PNG has no
    sidecar entry — the nudge to rerun the Python step. Never run detection on strips.
  - `src/systems/mapFormat.ts`: add optional `region?: { x, y, w, h }` and
    `anim?: { frameWidth, frameHeight, frames, fps }` to `DecorObject`, **mutually exclusive**
    (`parseMap` rejects both present). Validate ints; `x,y >= 0`, `w,h > 0`, `frames > 0`,
    `fps > 0`. Omit-when-absent on serialize (like `meta.favourites`) so existing maps round-trip
    byte-identical. **No `schemaVersion` bump** (additive optional fields; `migrateMap` stays
    identity). `objectFootprintCells` unchanged (footprint = `collision` rect else anchor tile);
    `collectTextureSources` unchanged (the SHEET stays the load/dedupe unit — add a code comment
    that used-region enumeration is a trivial future derived walk, don't build it; and note the
    known **mobile texture-memory risk** (critique #5): loading a whole atlas to draw one crop is
    fine for v1's tiny test map but is the point where region-baking earns its keep when the real
    Mostowo map lands — record it for that follow-up). Tests cover `region`/`anim` parse + the
    mutual-exclusion rejection + round-trip. **Content-drift note (critique #3):** the Node
    validation catches OOB but NOT a sprite that moved inside a same-size sheet, and `parseMap` is
    asset-blind by design — so document (in ASSETS.md) that re-running `gen_regions.py` is the only
    guard against content drift; the DEV-only region-bounds assert lives in `decorSprites`/loader
    (step 7b/11), not here.
  - `src/editor/catalog.ts`: add `regions?: [{ key, x, y, w, h }]` to `CatalogAsset` and
    `frameWidth?`/`frameHeight?` on strip entries; narrow them in `parseCatalog`.
  - Side effects: `public/assets/tilesets/pixel-crawler/pack.json` (region param/override map),
    regenerate + commit `public/assets/asset-catalog.json` (`npm run assets:catalog`), commit the
    new `regions.json`. Owns `mapFormat.ts` — do not run write-concurrent with step 8.
  - Docs: `docs/ASSETS.md` — short note (region sidecar, what it is, the two-command regen, "never
    hand-edit except pack.json overrides").
  - Done when: `python3 gen_regions.py && npm run assets:catalog` run clean and deterministic
    (double-run byte-identical); **eyeball the numbered `objects.py` preview for EVERY multi-object
    sheet the step-12 test map will draw from (not just 3 samples — critique #2), confirming
    detected regions map to real individual sprites; where detection merges near-touching sprites or
    splits a disjoint-part sprite, add a `pack.json` override and re-verify** — detection quality is
    the whole value of the feature, so exercise the override escape hatch here, not at authoring time;
    catalog + sidecar validate; `mapFormat` tests green; `npm run check` green.
  - Outcome: created `scripts/pixel-crawler/gen_regions.py` (reads `pack.json` `rules` — no parallel
    classification copy — and its new `regionParams`/`regions` override maps; reuses `components()`
    from `objects.py` untouched) and committed `public/assets/tilesets/pixel-crawler/regions.json`
    (56 sheets, coordinate-derived `"${x}_${y}"` keys, sorted, deterministic double-run verified byte
    for byte). Extended `asset-catalog.mjs`: `mergeRegions()` merges the sidecar into `object` assets
    (`regions` attached only at >=2, validated in-bounds — FATAL on OOB or a sidecar entry naming a
    non-current object asset — plus a non-fatal warn on a large `object` PNG missing a sidecar
    entry); replaced the old square/smaller-dim `stripFrames` guess with `stripFrameDims` — strips
    now emit `frameHeight = h`, `frameWidth = w/frames`, deriving `frames` only in the unambiguous
    square case (`w % h === 0`) and otherwise requiring a `pack.json` `frames` override (else warns
    and falls back to 1 unsliced frame) — fixed `Fire_01`/`Fire_02`/`Smoke`-Sheet.png (128×48, really
    4 frames of 32×48) via override, cutting divide-evenly warnings 19→16 (the rest are unwired
    crafting-station sheets, left as non-fatal warnings by design). `mapFormat.ts`: added
    `DecorRegion`/`DecorAnim` + optional `region?`/`anim?` on `DecorObject` (last fields, mutual
    exclusion enforced in `parseMapObject`, omit-when-absent mirrors `meta.favourites` exactly);
    `collectTextureSources` doc extended in place with the critique #3 (content-drift)/#5 (mobile
    memory) notes, no behaviour change. `catalog.ts` gained `CatalogRegion` + `regions?`/
    `frameWidth?`/`frameHeight?` on `CatalogAsset`. Eyeballed via `objects.py`'s numbered preview:
    `Furniture.png`, `Rocks.png`, `Resources.png`, `Esoteric.png`, `Tools.png`,
    `Trees/Model_03/Size_04-export.png`, `Vegetation.png`, `Bonfire.png` (object variant). Found +
    fixed via `pack.json` overrides: (1) `Rocks.png`/`Resources.png`/`Esoteric.png`/`Tools.png` each
    had a baked-in "PALETTE:" swatch-legend artifact in one corner that detection picked up as a
    sprite — `regions` override drops just that one box per sheet, keeping the rest verbatim; (2)
    `Trees/Model_03/Size_04-export.png`'s 4 colour variants touch at the canopy edges and merged into
    one 192×416 blob — a numpy column/row-sum check found the true seam (~4-6px pinch points) and the
    override splits it into 4 clean quadrants (visually re-verified, no clipping) plus the 3
    already-correct regions; (3) `Furniture.png` gets a `regionParams: {gap:0}` override (49→75
    regions, a real improvement) but still shows residual merges on this unusually dense,
    edge-to-edge-drawn atlas — documented as a known limitation for whoever authors decor from it,
    not fully resolved (hand-splitting the remaining ~15 clusters needs a real image-crop tool, out
    of proportion for this step); (4) `Vegetation.png` gets `regionParams: {minArea:20}` (89→120
    regions) — visually confirmed cleaner separation of small foliage/berry sprites, no bad splits.
    Also spot-checked `Resources.png` and `Environment/Structures/Stations/Bonfire/Bonfire.png` (the
    static object variant, not the animated `-Sheet.png` strip already wired to the campfire) beyond
    the required set: both show one or two remaining paired-item merges (e.g. two crates, two
    fire-pit variants, drawn touching) left un-overridden — flagged here, not fixed, since neither
    sheet is confirmed needed by the eventual step-12 test map and further hand-splitting has
    diminishing returns against this step's data-pipeline scope. `mapFormat.test.ts` gained a
    `decor region/anim` describe block:
    parse, int/positivity validation per field, mutual-exclusion rejection, and 3 round-trip tests
    (with region, with anim, and the base fixture WITHOUT either serializing with the keys absent) —
    42 tests total in that file, 307 across the suite. `npx tsc --noEmit` clean repo-wide (the
    plan-016 breakage this step was warned about had already been resolved by that concurrent session
    by the time this step ran); `eslint src/systems src/editor scripts` 0 errors; `prettier --check`
    clean on every file touched; `markdownlint-cli2` clean on `docs/ASSETS.md`. `docs/ASSETS.md` got
    a new "Atlas sprite regions" subsection (sidecar shape, two-command regen, the 3 concrete
    overrides above as examples, content-drift caveat).

- [x] **Step 7b: Library sprite-picker, region/animated placement + rendering** `[delegate sonnet]`
  - Create `src/render/decorSprites.ts` (Phaser-coupled, game-shared — `render/` already holds
    baked-texture helpers): given a `DecorObject` + its resolved texture key/URL, idempotently
    ensure the needed texture/sub-frame/anim exists and return the draw key/frame (or anim key).
    Region → `if (!tex.has(name)) tex.add(name, 0, x, y, w, h)` with `name = r${x}_${y}_${w}_${h}`,
    return that frame. Anim → `load.spritesheet(key,url,{frameWidth,frameHeight})` +
    `anims.create` with a deterministic deduped key (e.g.
    `decoranim:<asset>:<frameWidth>x<frameHeight>@<fps>`). This ONE helper is used by
    `EditorScene.ts` now and the step-11 game loader later — no divergent implementations, no
    editor-catalog dependency in the game (the `DecorObject` carries all metadata). Add a **DEV-only
    region-bounds assert here (critique #3)**: warn if a decor's `region` falls outside its resolved
    texture's real dimensions (the only place a moved-sprite content-drift becomes observable, since
    `parseMap` is asset-blind).
  - `src/editor/panels/LibraryPanel.tsx`: for atlas assets (have `regions`), render the whole sheet
    with absolutely-positioned clickable hotspot rects (scaled by the preview zoom) — clicking arms
    that region. Strip assets: an animated CSS `steps()` preview (`background-position` over
    `frames`, using `frameWidth`) — clicking arms the anim. Single objects unchanged. The click
    "show the whole sheet, click the sprite on it" UX is the user's explicit ask.
  - `src/editor/store/editorStore.ts`: extend the armed-object state so it carries the chosen
    `region?`/`anim?` alongside the `assetId` (e.g. `armedObjectAsset: { assetId, region?, anim? }
    | null`, or a parallel field — pick the cleaner; keep node arming separate). `placeDecor` writes
    `region`/`anim` into the new `DecorObject`. All still routed through history/undo + void-gated.
  - `src/editor/EditorScene.ts`: render decor through the shared `decorSprites` helper
    (region-crop + animated playback in-editor). `queueTextures` loads the SHEET (not per-region).
    **Remove only the DECOR branch of the interim `#frame` render path** in `EditorScene` (the
    TILE_SIZE spritesheet slice with the "catalog will supersede this" note) — **keep
    `parseAssetId`'s `#frame` parsing itself intact: tile painting depends on it**
    (`resolveBrushValue` in `editorStore.ts` → `parseAssetId` frame; critique #7). `#frame` stays
    valid for tile-type Library ids only. The untracked stray `src/data/maps/test.map.json` (uses the
    old whole-sheet decor) should be discarded, not migrated.
  - `src/editor/panels/InspectorPanel.tsx`: show `region` (read-only x/y/w/h) for a cropped decor;
    for an animated decor show its anim info **read-only** — placement stamps a fixed default `fps`
    (~8); do NOT add a per-instance editable fps field (critique #6: no consumer needs it, the game
    uses fixed anim-framerate constants). `fps` stays in the schema so the loader is
    catalog-independent, but it isn't a per-object authoring knob in v1.
  - Side effects: none outside `src/editor/` + the new `src/render/decorSprites.ts`. Depends on 7a.
  - Docs: none (final step writes docs/EDITOR.md).
  - Done when: place a single cropped sprite from `Furniture.png` and from `Rocks.png` — the viewport
    shows JUST that sprite, not the sheet; place an animated strip decor and it animates in-editor;
    save→reopen preserves `region`/`anim`; `parseMap` passes; undo walks it back; `npm run check`
    green. Live visual acceptance at `npm run editor` (no React/DOM harness — verify the data path
    programmatically as in steps 6/7, and state what a human must click).
  - Outcome: created `src/render/decorSprites.ts` (game-shared, Phaser-coupled, NO editor imports —
    only `Phaser` type-only + `DecorObject`/`DecorAnim` from `mapFormat` + `tileImageKey` from
    `tileset`) split into `queueDecorTexture` (load phase — whole SHEET as image for region, or
    `load.spritesheet` keyed by path+frame-dims for anim) and `resolveDecorDraw` (post-load — region
    registers sub-frame `r${x}_${y}_${w}_${h}` via `texture.add`, returns `{kind:'region',key,frame}`;
    anim dedupes an `anims` entry keyed `decoranim:<asset>:<w>x<h>@<fps>`, returns
    `{kind:'anim',key,animKey}`), sharing one `decorTextureKey`; DEV-only region-bounds `console.warn`
    on overflow vs real texture size (critique #3, the only observable content-drift point). The
    queue/resolve split was needed because Phaser spritesheet load is async and EditorScene's load
    lifecycle is two-phase (queue → start → COMPLETE → bake) — still one module, no divergent logic.
    `src/render/__tests__/decorSprites.test.ts` (5) covers the Phaser-free `decorTextureKey`
    determinism/uniqueness. `editorStore.ts`: `armedObjectAsset` became `ArmedObjectAsset`
    `{assetId, region?, anim?}` (node arming stays separate); `placeDecor` gained region/anim params
    and stamps `DECOR_ANIM_DEFAULT_FPS = 8` (exported) — no per-instance fps knob (critique #6).
    `EditorScene.ts` routes decor load+render through `decorSprites`; removed ONLY the interim
    `#frame`-sheet DECOR branch (tile `#frame` parsing in `parseAssetId`/`resolveBrushValue` left
    intact — critique #7). `LibraryPanel.tsx`: `AtlasSheetPicker` (whole sheet + absolutely-positioned
    clickable hotspot rects → arms that region) and `AnimatedStripPicker` (CSS `steps()` live preview →
    arms the anim); plain single objects unchanged. `InspectorPanel.tsx`: read-only Region (x/y/w/h) /
    Anim info lines. `editor.css`: atlas/strip picker styles + `lib-strip-play` keyframes.
    `editorStoreObjects.test.ts` +region/anim placeDecor coverage (writes, fps-stamp, void-refusal,
    `serializeMap`→`parseMap` byte-identical round-trip, undo). Strays cleaned: deleted
    `src/data/maps/test.map.json`, reverted `manifest.json` to empty committed state. Deviations:
    favouriting an atlas/strip falls back to whole-image (favourite ids carry no region/anim) — not in
    acceptance scope. Side effects confirmed via `git diff --stat`: only `src/editor/**` +
    `src/render/decorSprites.ts` (+test) changed, plus the two stray cleanups; plan-016 files
    untouched. `npm run check` fully green — typecheck/lint/lint:md/format clean, 317/317 tests.
    ⚠ NOT machine-verified (no React/DOM harness): the live click-through — a human must, at
    `npm run editor`: browse to `Furniture.png`/`Rocks.png` in the Library, confirm the whole sheet
    renders with hotspot outlines, click one, Place, click in the viewport → confirm ONLY that cropped
    sprite shows (not the sheet); pick an animatable `*-Sheet.png` strip, confirm its Library preview
    animates, place it, confirm it animates in-viewport; save→close→reopen → both still correct; undo
    both placements.

- [x] **Step 7c: Per-asset type override + grid-animation authoring** `[delegate sonnet]`
  - **Why:** filename/path classification in `pack.json` `rules` is lossy and the strip frame-math
    is single-horizontal-row only. Concrete failure: the furnace sheets (`Bricks_01-Sheet.png` etc.,
    64×96) are 2×2 **grid** animations (4 flame frames), match `*-Sheet.png` → `strip`, but
    `stripFrameDims` can't resolve `frames` (not square, no override) and falls back to 1 unsliced
    frame — so placing one drops the whole 2×2 sheet as one static decor (the "missed animation").
    Triaging ~55 `object` sheets + every strip by hand as a one-off isn't sensible; give the author
    an in-editor control to (a) force an asset's type and (b) describe its frame grid, driving the
    SAME two generators — no parallel classification store (critique #4). **Decision (with user +
    advisor, record in DECISIONS.md at the final step): frame-grid geometry is deterministic integer
    arithmetic over the sheet's known w/h, NOT an LLM/Claude-CLI job** — an LLM guessing frame counts
    is nondeterministic and re-opens the off-by-one flicker class `stripFrameDims` exists to fight;
    the author's eyes are the arbiter, a live grid overlay the aid.
  - **Override shape — extend the existing `pack.json` `overrides` map** (per-relpath; do NOT add a
    new store): add optional `type: "tile"|"strip"|"object"` (forces classification) and, for strips,
    optional `rows` (default 1) alongside the existing `frames`. `frames` stays = total frame count
    (unchanged meaning — all 8 existing overrides stay valid with `rows` defaulting to 1); do NOT
    introduce `cols`/`frameWidth`/`frameHeight` vocab that forks from what
    `DecorAnim`/`generateFrameNumbers` actually consume. Example:
    `"…/Bricks_01-Sheet.png": { "frames": 4, "rows": 2 }`.
  - **Both generators must consult `override.type` BEFORE classifying** (or they silently drift —
    critique #4):
    - `scripts/asset-catalog.mjs`: `buildAsset` classifies from `rules`, then the generic
      `{...asset, ...override}` merge runs AFTER the type-dependent branches — so a bare `type`
      override would relabel WITHOUT redoing frame math. Resolve `type = override.type ?? ruleType`
      first and branch on that. Fix `stripFrameDims` to grid math: `frameHeight = h/rows`,
      `cols = frames/rows`, `frameWidth = w/cols`; validate all three integer (non-fatal
      `console.warn` + fall back to 1 frame on non-integer, as today), `frames` still sourced from the
      override for non-square sheets.
    - `scripts/pixel-crawler/gen_regions.py` (~L114 `object_sheets`): classifies from `rules` only —
      apply the same `type = override.type ?? ruleType` so a `-Sheet.png` forced to `object` DOES get
      a region pass and a `.png` forced to `strip` is EXCLUDED from region detection. Mirror the
      one-liner in both with cross-referencing comments (like the existing `globToRegExp` mirror).
  - **No downstream schema change** (advisor-confirmed): `DecorObject.anim
    {frameWidth, frameHeight, frames, fps}` already expresses grids — Phaser `load.spritesheet` slices
    the whole image row-major into `frameWidth×frameHeight` cells and `frames` indexes 0..N-1 across
    rows — so `mapFormat.ts`, `decorSprites.ts`, and the game-loader path are UNTOUCHED. `CatalogAsset`
    needs no new field (the picker derives `cols = w/frameWidth`, `rows = h/frameHeight`). Only update
    the now-stale "a strip is one horizontal row" doc comment on `frameHeight` in
    `src/editor/catalog.ts` and the `stripFrameDims` header in `asset-catalog.mjs`.
  - **Editor → pipeline via the dev middleware** (the middleware runs the regen — the cross-device
    rule makes "run two terminal commands" a non-starter on a phone, and a `type` flip written to
    `pack.json` WITHOUT an immediate regen leaves the catalog regen broken since `mergeRegions` FATALs
    on a stale sidecar): new `PUT /__editor/asset-override` in `scripts/vite-editor-api.mjs` →
    sanitise pack id, patch the asset's entry in that pack's `pack.json`, then run the two generators
    IN ORDER as child processes with fixed argv, no shell, no user input in the command:
    `execFile('python3', [gen_regions.py])` then `execFile(process.execPath, [asset-catalog.mjs])`.
    Serialize concurrent requests (a simple in-flight promise queue). Pipe generator warnings back in
    the response. On `python3` `ENOENT`, return a structured error telling the user to run the two
    documented commands manually — that IS the graceful degrade to the dumb workflow. `src/editor/api.ts`:
    typed wrapper. Stays dev-only (`serve`-mode middleware) and never touches live/prod.
  - **Library UI** (`src/editor/panels/LibraryPanel.tsx`, the ONLY editor file 7c touches): a
    reclassify affordance on the selected asset — a popover with a `tile/strip/object` type dropdown
    and, when `strip`, `frames` + `rows` fields with a **live grid overlay on the full-sheet preview**
    that updates as you type (plus divisor-pair suggestion chips derived purely from `w`/`h` and
    `tileSize` multiples — arithmetic, no pixel decode). On commit → `PUT /__editor/asset-override` →
    on success refetch `asset-catalog.json` and `setCatalog` (LibraryPanel fetches once on mount with
    `[]` deps today — add an explicit refetch path). Also fix a doc-vs-behaviour bug here:
    `isAnimatableStrip` accepts `frames > 0`, so the unresolved `frames:1` fallback wrongly renders via
    `AnimatedStripPicker` and stamps a useless `anim {…, frames:1}` onto placed decor — require
    `frames >= 2` so a still-unresolved strip falls back to the plain `AssetCard`.
  - Known limitations to record: already-placed decor is a snapshot — fixing the catalog does NOT
    self-heal a furnace already placed in a map; it must be re-placed (no texture-key collision —
    `decorTextureKey` includes frame dims). Pixel-based grid AUTO-detect is deliberately deferred:
    connected-component detection is weak on animation sheets specifically (adjacent flame/smoke frames
    bleed across cell boundaries) and GCD is ambiguous (64×96 → 2×2 or 2×3?) — manual-entry-with-live-
    preview makes each sheet a ~5-second job; build detection later only if that proves painful.
  - Side effects: `public/assets/tilesets/pixel-crawler/pack.json` (type/rows overrides), regenerate +
    commit `regions.json` + `public/assets/asset-catalog.json`, `scripts/asset-catalog.mjs`,
    `scripts/pixel-crawler/gen_regions.py`, `scripts/vite-editor-api.mjs`, `src/editor/api.ts`,
    `src/editor/catalog.ts` (doc comment only), `src/editor/panels/LibraryPanel.tsx`. **Explicitly ZERO
    changes to `EditorScene.ts`, `editorStore.ts`, `mapFormat.ts`, `decorSprites.ts`** — keeps 7c's diff
    disjoint from step 8's painting work and independently revertible. Commit the just-landed 7a/7b
    surgically FIRST (concurrent-edit exposure).
  - Docs: `docs/ASSETS.md` — extend the pack-manifest / "Atlas sprite regions" section with the
    `type`/`rows` override keys and the in-editor reclassify flow (the preferred path; the two-command
    regen stays the fallback). If an editor shortcut is added, update the in-app Shortcuts panel
    (`src/editor/shortcuts.ts`).
  - Done when: in the editor, force `Bricks_01-Sheet.png` to a 2×2 grid (`frames:4, rows:2`) via the
    reclassify popover → the catalog regenerates through the middleware → the Library preview animates
    the 4 frames → placing it drops an ANIMATED furnace (not the whole sheet); force a mis-classified
    asset and see the other generator agree (a `-Sheet` forced to `object` gains regions; a `.png`
    forced to `strip` loses them); `python3 gen_regions.py && npm run assets:catalog` still run clean +
    deterministic (double-run byte-identical) and the committed `asset-catalog.json`/`regions.json`
    reflect the overrides; an unresolved strip (`frames` still 1) falls back to the plain card, not a
    1-frame anim; `npm run check` green.
  - Outcome: implemented entirely within the 7c file set (`git diff --stat` confirmed disjoint from
    the concurrent plan-016/crash-reporter work). `pack.json`: added the
    `Environment/Structures/Stations/Furnace/Bricks_01-Sheet.png` `{frames:4, rows:2}` override (the
    worked example). `asset-catalog.mjs`: resolves `type = override.type ?? ruleType` BEFORE the
    type-dependent branches (a bare `type` override now redoes frame math, not just relabels), and
    `stripFrameDims` rewritten to grid math (`frameHeight=h/rows`, `cols=frames/rows`,
    `frameWidth=w/cols`; `rows` defaults 1 → collapses to the old single-row math; a non-integer grid
    warns and falls back to 1 frame); `type`/`rows` stripped from the generic override merge (classification
    directives, not `CatalogAsset` fields). `gen_regions.py`: new `is_object_sheet()` mirrors the same
    `type = override.type ?? ruleType` one-liner (cross-ref comments like the `globToRegExp` mirror) so
    a `-Sheet.png` forced to `object` gets a region pass and a `.png` forced to `strip`/`tile` is
    excluded. `vite-editor-api.mjs`: new `PUT /__editor/asset-override` — sanitises packId/relPath/patch,
    merges into `pack.json` `overrides`, runs `gen_regions.py`→`assets:catalog` via `execFile` (fixed
    argv, no shell), serialized through an in-flight promise queue, returns generator output as
    `warnings`, structured 502 on `python3` ENOENT/failure (pack.json left patched = the documented
    degrade). `api.ts`: `putAssetOverride` typed wrapper. `catalog.ts`: doc-comment-only update (grid
    math; no field/behaviour change). `LibraryPanel.tsx`: `isAnimatableStrip` now `frames>=2` (an
    unresolved 1-frame strip falls back to the plain `AssetCard`, no bogus `anim{…,frames:1}` stamp);
    extracted `refetchCatalog` (cache-busted) as an explicit refetch path; new `AssetReclassify` ⚙
    popover (type dropdown; `frames`/`rows` fields for strip; live CSS-grid overlay recomputed per
    keystroke; `suggestGrids` `TILE_SIZE`-aligned divisor-pair chips) wired into
    `AssetCard`/`AtlasSheetPicker`/`AnimatedStripPicker`/`FavouriteItem`, inline styles only (no
    `editor.css` change). `docs/ASSETS.md`: new "Per-asset type/grid overrides + in-editor reclassify"
    subsection (override keys, furnace example, preferred in-editor flow + two-command fallback, known
    limits). No editor keyboard shortcut added → Shortcuts panel untouched. Verified (no React/DOM
    harness, per steps 5–7): `Bricks_01` catalog entry = `type:strip, frameWidth:32, frameHeight:48,
    frames:4` (64/2 × 96/2); both generators double-run byte-identical; cross-generator agreement
    live-tested (`-Sheet`→object gains regions; `.png`→strip loses them) then reverted to a clean
    baseline; middleware exercised end-to-end via a real `vite` dev server + curl (200 success, 3-way
    concurrent queue no corruption, 400/404 on bad packId/traversal/invalid patch, structured error on
    generator failure). `tsc --noEmit` exit 0; prettier/eslint clean on every 7c file; 317/317 tests
    green. Aggregate `npm run check` red ONLY on the concurrent session's untracked
    `src/debug/crashReporter.ts` (prettier) — outside 7c's scope, untouched here. Deviation: reclassify
    affordance not added to tile-sheet grids (`TileFrameGrid`) — tile misclassification isn't this
    step's target; the same component can be added later. HUMAN acceptance still needed at
    `npm run editor`: reclassify `Bricks_01` → `frames:4, rows:2`, watch the grid overlay + animated
    preview, place it → an animated furnace drops (not the whole sheet), save→reopen round-trips.

- [ ] **Step 8: Shape, walkability + zones painting** `[delegate sonnet]`
  - Generalise the step-6 paint pipeline over a "target grid" (tile layer / walkability / zones /
    shape) rather than duplicating tool code.
  - **Shape tool**: paints inside(1)/void(0) into `shape.cells`. Painting a cell void also clears
    every tile layer cell, zone id, and deletes/refuses overlapping objects at that cell — as ONE
    undoable command (keeps the void-consistency invariant true at all times, matching
    `parseMap`). Overlay: void hatch already renders (step 5); while the shape tool is active,
    show the mask boundary as a bright outline.
  - Collision tool: paints `walkability.cells` (brush/rect/fill shared). Overlay: red 40% tint on
    blocked cells, toggle in toolbar. This layer is **base terrain** passability only — decor
    `collision` footprints and nodes block at runtime on top of it (show their footprints hatched
    in the overlay for authoring clarity, read-only).
  - Zones: `src/editor/panels/ZonesPanel.tsx` — create/rename/recolour/delete zone defs (uint8
    ids, allocate lowest free); select active zone; zone brush paints `zones.cells` (inside cells
    only); overlay renders each zone as its colour at ~30% alpha + name label at region centroid.
    Deleting a zone def clears its cells (one undoable command). Per-zone favourites already
    wired (step 6).
  - Side effects: none outside `src/editor/`.
  - Docs: none.
  - Done when: carve a non-rectangular map shape (with tiles/objects present — verify the void
    paint clears them undoably), paint blocked cells and two coloured zones, toggle overlays, set
    per-zone favourites and see the Library favourites filter follow the active zone;
    save→reopen preserves; saved JSON passes `parseMap` void-consistency; undo works across
    shape/collision/zone edits; `npm run check` green.

- [ ] **Step 9: World view tab + neighbour ghost strips** `[delegate sonnet]`
  - **Update (plan 017 landed):** the `view: 'map'|'world'` toolbar toggle this step was written
    against no longer exists — plan 017 replaced it with a tab-strip architecture and already
    created a permanent, non-closable `world` tab (`editorStore.ts`'s `EditorTab` union); today
    `EditorApp.tsx` renders it as a placeholder `<div>World view — coming in step 9.</div>`
    (`EditorApp.tsx:223`). This step is now "build a
    `tabs/WorldViewTab.tsx` that replaces that placeholder," following the object-editor tab's
    pattern (mounted `position:absolute; inset:0` inside `.editor-tab-panels`, visibility-toggled
    via `.is-hidden`, never `display:none` — see plan 017 step 2) — there is no separate view-switch
    action to build; the tab strip is already the sole switcher. **Priority:** this step is now a
    hard prerequisite for [plan 019](019-l1-map-streaming.md) (L1 map streaming) — `world.json`'s
    `placements` array is still `[]`, and 019 cannot be verified end-to-end without at least the
    start map plus one authored neighbour placed adjacent to it via this UI.
  - **World view**: loads `world.json`
    (`GET /__editor/world`) + all map files; renders every placed map at its origin on a global
    grid — baked thumbnail of its tile layers (reuse the chunked bake at low zoom) clipped to its
    shape mask, plus name label. Unplaced maps sit in a side tray; dragging one onto the grid
    adds a placement. Dragging a map repositions it (snaps to whole tiles; live coordinates in a
    status bar).
  - Validation feedback, live while dragging (via `validateWorld` from
    `src/systems/worldLayout.ts`): overlapping inside cells = red highlight + error badge (Save
    disabled while any error exists); warnings (seam walkability mismatch, diagonal-only
    adjacency, islands) = amber badges with tooltip text, never blocking. Save writes ONLY
    `world.json` (`PUT /__editor/world`).
  - **Ghost strips in the per-map view**: when the open map is placed, render read-only dimmed
    strips (~12 tiles deep, alpha ~0.4) of each placed neighbour's tile layers at the correct
    world offset just outside the map's bounds — load neighbour files via `GET
    /__editor/maps/:id` on demand, clip strictly to the strip, never interactive, refresh on
    view-switch/reopen (no live sync), skip gracefully (with a small notice) if a neighbour file
    is missing or fails `parseMap`. Toggle lives in `overlays.ghosts`.
  - World-view edits (placements) go through the history stack like everything else.
  - **Thumbnail export**: extend the Save action (step 5 toolbar) so every successful map save
    also bakes a **1px-per-tile** PNG (tile layers bottom→top at 1/TILE_SIZE scale, clipped to
    the shape mask, void = transparent; snapshot an offscreen RenderTexture) and PUTs it to
    `/__editor/maps/:id/thumb`. The world view renders placed maps from these same bakes. Export
    happens on **every map save**, not only from the world view — thumbnails must never drift
    from content.
  - Side effects: none outside `src/editor/` (thumb PNGs land under `public/assets/maps/thumbs/`
    via the middleware).
  - Docs: none.
  - Done when: place two authored maps so their shaped edges interlock; overlap drag shows the
    red error state and blocks save; separating them saves a valid `world.json`; reopening map A
    shows map B's border tiles as a ghost strip exactly where they belong; toggling ghosts works;
    undo works for placement moves; saving a map writes/updates its thumb PNG at the right
    dimensions; `npm run check` green.

- [ ] **Step 10: Autotile terrain brush** `[delegate sonnet]`
  - Terrain definitions: add to the pixel-crawler `pack.json` (or a sibling `terrains.json` if
    cleaner — pick one, document in the file) at least one terrain (e.g. grass-over-dirt) naming
    the tilesheet + the blob-key→frame mapping the Python autotiler uses (port the mapping data
    from `scripts/pixel-crawler/autotile.py` / its config). Surface terrains in the Library as a
    "Terrains" category.
  - Terrain brush: painting writes a 0/1 mask into the map's editor-only `terrain` section for
    the active layer (inside cells only), then calls `paintMask` from `src/systems/autotile.ts`
    (step 3) to rebake affected cells (mask cell + 8 neighbours) into the layer's real `cells`
    via palette find-or-append. Erasing updates mask + rebakes. Undo covers mask + baked cells as
    one command.
  - On save, rebake terrain→cells in full (advisor rule: baked cells are canonical; semantic mask
    is editor-only convenience).
  - Side effects: `public/assets/tilesets/pixel-crawler/pack.json` (terrain defs), regenerate
    catalog if the generator surfaces terrains (`npm run assets:catalog`).
  - Docs: none.
  - Done when: drag the terrain brush and edges/corners resolve correctly (compare against a
    Python-autotiler reference output for the same mask); baked cells present in the saved
    JSON; a fresh open re-edits the same terrain seamlessly; `npm run check` green.

- [ ] **Step 11: Game loads authored maps** `[inline]`
  - **Update — superseded by [plan 018](018-runtime-map-loader.md) (deployed) for its core scope,
    with real divergences and real gaps left open.** Do not re-execute this step as originally
    written below — treat it as the historical spec, and pick up only the outstanding items.
    - **Landed (018):** a lazy registry exists at `src/systems/mapRuntime.ts` — **not**
      `src/data/maps/index.ts` as specced below (018's own "PATH DRIFT" note: the schema lives in
      `src/systems/mapFormat.ts`/`worldLayout.ts`). Eager `MANIFEST`/`WORLD`, lazy
      `loadMapFile(id)` via `import.meta.glob`, `originOf(id)`. Ground bakes via
      `groundRenderer.drawMapLayers` (mirrors `EditorScene.bakeChunk`); `ResourceNodeManager.loadNodes`
      hydrates `kind:'node'` objects; the new `DecorManager` renders `kind:'decor'` (region-cropped +
      animated, matching the editor); `mapWalkability.mapBlocks` composites map walkability + void
      into `isBlocked` alongside existing obstacle sources; dims/camera/physics bounds derive from
      `map.meta`, not `MAP_WIDTH`/`MAP_HEIGHT` (both consts, plus the fixed `BASE_ZONE`, were deleted
      in 018's Step A12 after a live-verify checkpoint). Portals parse-and-hold, no transition wiring.
      Live-verified at `npm run dev` (Playwright screenshot checkpoint), not just unit-tested.
    - **Diverges from the design below — accept it, don't fight it:** no `?map=<id>` query param and
      no dev-menu "LOAD MAP" button (018 hardcoded a single `START_MAP_ID` constant instead — a
      deliberate L0 scope cut); and **no procedural fallback was preserved** — the "else current
      procedural world unchanged" behaviour below was explicitly removed (018 Step A12 deleted
      `drawGround`/`spawnTrees`/the `MAP_WIDTH`/`MAP_HEIGHT`/`BASE_ZONE` consts as a one-way door
      after its checkpoint passed). The game always boots into the one authored map now.
    - **Still genuinely outstanding** (not done by 018 or 019): `zoneAt(col,row)` (zones have no
      runtime read path yet); the Tier-1 world-integrity test (`src/data/maps/__tests__/world.test.ts`);
      the `MapConnections` placeholder type; two tracked-not-fixed regressions from 018
      (`tests/e2e/survival-hunger.spec.ts`'s starve-HP assertion fails while `HUNGER_LETHAL=false`,
      and `scripts/smoke.mjs` has a click-timing race against the now-async `PreloadScene.create()`).
    - **Multi-map consumption** (global-coord `isBlocked`, streaming load/evict) is
      [plan 019](019-l1-map-streaming.md)'s scope — planned, not executed, blocked on plan 014 step 9
      landing a second real placement in `world.json`.
  - `src/data/maps/index.ts` — the **lazy registry** (advisor round 3): eagerly import ONLY
    `manifest.json` (→ `parseManifest`) and `world.json` (→ `parseWorldLayout`); map files load
    via `import.meta.glob('./maps/*.map.json')` per-map code-split chunks behind
    `loadMap(id): Promise<MapFile>` (→ `migrateMap`/`parseMap`, cached; cross-validate
    `kind:'node'` refs against `NODES` keys here, fail fast; DEV assertion that the loaded meta
    matches its manifest row) and `releaseMap(id)` (evicts the cache entry only — no scene
    knowledge). Also export `listMaps()`/`getMapMeta(id)` reading the manifest (must never
    trigger a map load), `resolveTextureSources(map)` (= `collectTextureSources` + node-ref→
    texture resolution via `NODES` and the tileset roles), and the `MapConnections` placeholder
    type `{ from: {mapId, portalId}, to: {mapId, portalId}, gate?: unknown }[]` (empty for now —
    the DECIDED registry model; seam-derived implicit connections and gate wiring are out of
    scope). Registry init runs structural world checks only (placement ids exist in the
    manifest); it must NOT load every map to validate.
  - Tier-1 **world integrity test** (`src/data/maps/__tests__/world.test.ts`): eagerly import
    ALL committed map files + `world.json` (test context may load everything), run `parseMap` on
    each and `validateWorld` across them, assert zero errors and print warnings — CI enforcement
    of world consistency without burdening game runtime.
  - GameScene integration (⚠ coordinate with plan 013's refactor if it has landed — adapt to
    whatever structure exists; the behaviours below are the contract):
    - Map selection: `?map=<id>` query param, else current procedural world unchanged (fallback
      preserved). Also add a dev-menu "LOAD MAP" button via the existing `debug:*` event pattern
      (UIScene → GameScene) listing ids from `listMaps()` (manifest-only — no loads). The scene
      `await`s `loadMap(id)` before building the world (async is one `await` in the create
      path; keep the flow simple).
    - Ground: bake authored tile layers bottom→top into the chunked RenderTexture path
      (reuse/extend `drawGround`'s batch-draw approach; non-overhead layers under entities,
      `overhead: true` layers on a texture at depth 12 — above player 10, below night 15).
    - Objects: `kind:'node'` → existing `addNode(NODES[ref], col, row)`; `kind:'decor'` → draw via
      the SHARED `src/render/decorSprites.ts` helper (step 7b) so region-cropped and `anim`ated decor
      render identically to the editor — `add.image`/sprite with stored transform at depth 1 + stored
      `depth` offset fraction (animated decor plays its anim); decor `collision` footprints, the map's
      `walkability.cells`, **and void shape cells** all feed `isBlocked` (compose with the existing
      occupied/nodes checks). `kind:'portal'` → no-op in v1 (log presence). `collectTextureSources`
      semantics unchanged (sheet = load unit).
    - Dims: the world/grid/camera bounds must come from `meta.width/height` (bounding box —
      void is just blocked, `Dims` stays rectangular for A*), not `MAP_WIDTH/HEIGHT` constants,
      when a map is loaded. All runtime coords stay map-local in v1; global coords
      (`localToGlobal` + the world index) are the documented seam for future streaming and
      cross-map monster pursuit — do not build engine support now.
    - Zones: expose `zoneAt(col,row)` on the scene (or a small pure helper in `src/systems/`) —
      unused by gameplay yet, but proves the data path.
  - Tier-2 e2e: a scenario spec loading `?map=test-camp` asserting via the `__test` seam that
    a known node exists at its authored tile, a known blocked cell reports blocked, and a void
    cell reports blocked.
  - Side effects: `src/scenes/GameScene.ts` (or its post-013 successors), `src/scenes/UIScene.ts`
    (dev menu button), `tests/e2e/`. Check the procedural path still works with no query param
    (`npm run smoke`).
  - Docs: none (final step).
  - Done when: `npm run dev` + `?map=test-camp` renders the authored test map — tiles, decor,
    harvestable nodes, blocked + void cells respected by worker pathing; no param = unchanged
    world; e2e + smoke + `npm run check` green.

- [ ] **Step 12: Author the test maps, write docs, record decisions** `[inline]`
  - **Update:** the map this step should exercise already exists as `src/data/maps/test.map.json`
    (not `test-camp.map.json` as named below) — retarget to it rather than authoring a fresh file,
    unless there's a reason to keep both. Content-authoring here is no longer just a leisurely
    feature-exercise pass; it's now blocking two concrete things named by later plans:
    1. **Plan 018's Phase-A content ship gate:** `test.map.json` currently has **zero** `node`
       objects, so the temporary `HUNGER_LETHAL=false` stopgap in `config.ts` can't be flipped back
       on (or removed) until this step authors real trees/rocks/a food source into it.
    2. **Plan 019's placement prerequisite:** `world.json`'s `placements` is still `[]`; 019 (L1
       streaming) cannot be verified end-to-end without at least `test.map.json` plus one authored
       neighbour placed adjacent to it — i.e. this step's "author `test-forest`, interlock shapes,
       place both" work below.
    Also, some of this step's doc updates already landed piecemeal via plan 018 — don't redo them:
    `docs/STATUS.md` already has a plan-018 row (add a plan-014 row alongside it, don't duplicate),
    `src/data/maps/README.md` was already rewritten to describe runtime consumption, and CLAUDE.md's
    `src/scenes` architecture-map line was already updated to mention `mapRuntime.ts`. Still
    genuinely outstanding: `docs/EDITOR.md` doesn't exist yet; `docs/DECISIONS.md`'s map-editor
    entry (~L563) is still `[OPEN]`, not moved to `[DECIDED]`; CLAUDE.md's docs index doesn't list
    `docs/EDITOR.md` yet.
  - Using the editor, author `src/data/maps/test-camp.map.json` exercising every feature: an
    irregular (non-rectangular) shape, tiles from ≥2 different sheets on ≥2 layers (one
    overhead), a terrain-brush patch, ≥3 decor objects (one rotated, one scaled, two stacked; **one
    region-cropped from a multi-sprite atlas and one animated strip decor** — proving the step-7a/7b
    path end-to-end), ≥2 resource nodes, a painted blocked region, 2 zones with favourites, 1 portal.
    Author a
    small second map (`test-forest`) whose shaped edge interlocks with test-camp; position both
    in the world view (clean validation, at least one seam) and confirm the ghost strip shows
    while editing. Verify each loads in-game via step 11's path.
  - Write `docs/EDITOR.md` (terse, token-lean): how to run (`npm run editor`), pane map, tools and
    shortcuts, map vs world view, the map + world file formats (point at
    `src/systems/mapFormat.ts` / `worldLayout.ts` as source of truth), palette append-only rule,
    void/shape rules, generated artifacts (manifest.json + thumbs — never hand-edit), the
    persistence contract (map files immutable; runtime state = future save overlay keyed
    `{mapId, objectId}`; **anything that can change at runtime must be an object, never painted
    into tile layers**), how packs/catalog work (point at ASSETS.md), how the game loads maps
    (lazy registry).
  - Update: `docs/DECISIONS.md` — move the map-editor OPEN entry (~L422) to DECIDED recording the
    outcomes (palette encoding, src/data/maps home, zone layer, object discriminator,
    portals-in-maps/graph-in-registry, React+Phaser hybrid, baked-canonical autotiles, shape
    mask + world.json global coordinate space, seamless walk-across direction + monsters-chase
    requirement, error/warning validation split, seams-as-derived-connections, lazy registry +
    generated manifest, committed thumbnails as the world-map-screen data source,
    fast-travel-needs-no-format-change, immutable map files + save-overlay persistence
    contract, the runtime-state-must-be-objects rule);
    `docs/STATUS.md` — add plan 014 row; `CLAUDE.md` — add docs/EDITOR.md to the docs index +
    mention the editor in Architecture map (one line each); `docs/GAME-DESIGN.md` — tick the
    map-editor tooling mention if present.
  - Side effects: none beyond listed docs + the new map JSONs + world.json.
  - Docs: this step IS the docs step.
  - Done when: both test maps play in-game; both have committed thumbs and consistent
    `manifest.json` rows (world integrity test green); docs read clean (`npm run lint:md`);
    DECISIONS/STATUS/CLAUDE.md updated; `npm run check` green.

## Critique

> Fresh-eyes review of the mid-execution additions (Steps 7a/7b + the 11/12 amendments),
> 2026-07-14. **No High findings — nothing blocks execution.** All findings below are folded into
> the step text above (each tagged `critique #N`).

**Verdict:** Metadata-not-split is the right call and the 7a/7b split is clean — proceed, but
resolve one Medium during 7a: the plan treated animation-strip frame dimensions as "already
computed," yet the catalog's smaller-dim heuristic is provably wrong for the exact non-square
sheets 7b targets for animated decor.

|#|Finding|Lens|Severity|Status|
|-|-------|----|--------|------|
|1|Strip `frameWidth`/`frameHeight` from the square/smaller-dim `stripFrames` guess is wrong for non-square strips (`Fire_01` 128×48, crafting-station sheets) — the exact animated-decor candidates; reproduces the flicker/"flying" slice bug.|Consistency / correctness|Medium|Folded into 7a: `frameHeight = height`, `frameWidth = w/frames`, `frames` via override, no square guess.|
|2|7a done-when spot-checked only 3 sheets; detection quality across ~50 atlases is the feature's whole value; escape hatches unexercised.|Gaps / correctness|Medium|Folded into 7a done-when: eyeball every sheet the test map uses; exercise the pack.json override here.|
|3|Region validation misses content-drift (a sprite moved inside a same-size sheet still validates); no bound-check of `DecorObject.region` vs real asset dims.|Gaps & risks|Medium|Folded: document regen-is-the-guard (ASSETS.md); DEV-only region-bounds assert in `decorSprites` (7b).|
|4|"Object sheet" classification would live in 3 places; `gen_regions` could silently drift from `pack.json` rules.|Consistency|Low|Folded into 7a: `gen_regions.py` reads the `pack.json` rules, not a re-derived copy.|
|5|Sheet-granular `collectTextureSources` loads a whole atlas to draw one crop — mild tension with the mobile memory goal; region-baking deferred by design.|Roadmap fit|Low|Folded: recorded as a known mobile-texture-memory risk for the real-Mostowo-map follow-up.|
|6|Per-decor editable `fps` is a knob no consumer needs (game uses fixed anim-framerate constants).|Right-sizing|Low|Folded into 7b: fixed default fps, no per-instance editable field; `fps` stays in schema for the loader.|
|7|"Remove the interim `#frame` decor path" risked stripping `#frame` from `parseAssetId`, which tile painting needs.|Executability|Low|Folded into 7b: keep `parseAssetId` `#frame`; remove only the decor render branch.|

**What the plan gets right:** embedding the full `region` rect on `DecorObject` (self-describing
maps, re-detection non-destructive); one shared `src/render/decorSprites.ts` for editor + game
(reuse like `resolveTile`, not runtime coupling); the no-npm-dep catalog rule respected; additive
optional fields with no schemaVersion bump (matching the `meta.favourites` precedent); the
7a(data)/7b(UI+render) split is a clean seam.

## Out of scope

- Authoring the **real** Mostowo camp map (follow-up task once the tool exists — needs the Google
  Maps reference under `docs/assets/reference/`).
- **Seamless streaming engine work** — loading/rendering neighbour maps at runtime, cross-border
  camera, entity handoff, and cross-map monster pursuit AI. The format + global coordinate
  system + world index built here are the enablers; the engine work is its own plan.
- Map registry **connections/unlock-gates/fast-travel gameplay** — schema placeholders only
  (portal objects + empty connections type + derived-seam concept); the world-graph system is
  its own plan.
- The **in-game world map screen** — its data source is ready (committed thumbnails placed at
  `world.json` origins, zero map files loaded); building the screen + fast-travel UX belongs to
  the world-graph plan.
- The **save system and map-state overlay** (persistent opened gates, looted containers, …) —
  the immutable-map + `{mapId, objectId}` overlay contract and the
  runtime-state-must-be-objects rule are recorded here; overlay types and implementation belong
  to the save/quest plan.
- Quests, dialog, discoverable interactables — enabled by stable object `id`s + the `kind`
  discriminator, not built.
- Multi-select marquee, copy/paste, animated-tile authoring, minimap, in-editor playtest button.
- Editor in the prod build / hosted anywhere — dev-server only, by design.
- Migrating the current procedural world away — it remains the no-param fallback.
- Porting `extract.py`/`objects.py` (offline extraction stays Python); only `autotile.py` logic
  is ported.
