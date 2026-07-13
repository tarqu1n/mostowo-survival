# Map Builder

> Status: planned — run /execute-plan to begin.

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

- [ ] **Step 5: Editor store, history, and the Phaser viewport** `[delegate opus]`
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

- [ ] **Step 6: Asset library panel + tile painting** `[delegate sonnet]`
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

- [ ] **Step 7: Scenery objects — place, transform, stack; portals** `[delegate sonnet]`
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
  - **World view** (`view: 'world'` — switch from step 5's toolbar): loads `world.json`
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
    - Objects: `kind:'node'` → existing `addNode(NODES[ref], col, row)`; `kind:'decor'` →
      `add.image` with stored transform at depth 1 + stored `depth` offset fraction; decor
      `collision` footprints, the map's `walkability.cells`, **and void shape cells** all feed
      `isBlocked` (compose with the existing occupied/nodes checks). `kind:'portal'` → no-op in
      v1 (log presence).
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
  - Using the editor, author `src/data/maps/test-camp.map.json` exercising every feature: an
    irregular (non-rectangular) shape, tiles from ≥2 different sheets on ≥2 layers (one
    overhead), a terrain-brush patch, ≥3 decor objects (one rotated, one scaled, two stacked),
    ≥2 resource nodes, a painted blocked region, 2 zones with favourites, 1 portal. Author a
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
