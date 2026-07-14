# Runtime Map Loader (L0 — boot into one authored map)

> Status: in review
> Follow-up: **L1 adjacent-ring streaming is split into [plan 019](019-l1-map-streaming.md)** (per
> critique #3) — run this plan first, ship it, then 019 once a second map is placed.

## Summary

Make the running game **consume authored map data** (`src/data/maps/*.map.json` + `world.json` +
`manifest.json`) instead of generating its world procedurally. This plan is L0 only: a **big-bang
switch** so the game boots straight into one authored start map, rendering its tile layers, decor,
resource nodes, walkability, and a spawn-anchored base zone, then **deleting the procedural
`buildWorld` guts** — but only after a live checkpoint (per critique #2). Adjacent-ring streaming
("L1") is [plan 019](019-l1-map-streaming.md).

The authoring + storage + arrangement layer is already built and tested (`mapFormat.ts`,
`worldLayout.ts`, the editor, `manifest.json`). This plan is **100% the runtime consumption side** —
it consumes the existing schema as-is and touches no editor code and no schema.

## Phase-A ship gate (read first — from critique #1)

`test.map.json` has **zero `node` objects** (all 6 objects are decor) and sparse ground. Every push
to `master` auto-builds + deploys to GitHub Pages (`.github/workflows/deploy.yml`, DECISIONS
2026-07-11), so completing the big-bang and pushing would put an **unplayable** world live: no
wood/stone/**food** while `SurvivalClock` drains hunger → guaranteed starve-out. Two mitigations,
both required before this plan ships to trunk:

1. **Content ship gate (external, editor):** the start map must carry authored `node` content — at
   minimum a few trees + rocks + a **food source** (berry bush) — authored via the editor, before
   Phase A is considered shippable. This is the same *class* of external content prerequisite that
   plan 019 names for its second map; name it, don't hand-wave it.
2. **Code stopgap (this plan, Step A2 + A9):** a temporary `HUNGER_LETHAL` config flag gates the
   hunger→HP drain, defaulting **off** during Phase-A execution so any intermediate trunk push can't
   deploy a starve-out before the content gate is met. Flipped on (or removed) once the start map has
   food — tracked in Out of scope as cleanup.

## Context & decisions

### Locked decisions (from design discussion + follow-up Q&A)
1. **Delivery.** `manifest.json` + `world.json` are **eager-imported** at boot; each map is a **lazy
   per-map chunk** via `import.meta.glob('../data/maps/*.map.json', { import: 'default' })`. No
   `public/` copy, no backend (static site). Keep a DEV staleness assertion: for each *loaded* map,
   its `manifest.maps` entry (`width/height/name`) must match its parsed `meta`.
2. **Streaming = L1, built on L0.** This plan delivers **L0** = load/instantiate one map cleanly. L1
   (active map + bbox-adjacent ring, seam-crossing load/evict) is [plan 019](019-l1-map-streaming.md).
   L0 is a strict subset and must not bake in single-map-only assumptions that 019 would have to rip
   out (use global tile coords + `originOf` offsets throughout, even though L0 loads one map at 0,0).
3. **Big-bang switchover.** Replace procedural generation in `buildWorld` and the fixed
   `MAP_WIDTH`/`MAP_HEIGHT` world bounds; boot straight into the start map. Camera/physics bounds
   derive from loaded map geometry. **The procedural code is deleted only in a post-verify cleanup
   step (A12), not at the moment of switch** (critique #2 — keep a fallback until the authored path
   is live-verified).
4. **Spawn.** HARDCODE start map id + spawn tile in `config.ts`. Authored-spawn-in-editor is an
   explicit LATER step — out of scope.
5. **Base zone.** Constant-*size* rect ANCHORED at the spawn tile (spawn-relative), replacing the
   fixed-absolute `BASE_ZONE`.
6. **Content model (Q&A).** Resource nodes hydrate ONLY from authored `node` objects; enemies stay
   **procedural**, re-based on the loaded map's geometry (not map-authored). **Portals: parse-and-hold
   only, no transition wiring** (and `test.map.json` has 0 portals — nothing to exercise this cut).

### Key facts from the integration sweep (mirror these; all verified against source)
- **`test.map.json` is a dimensional drop-in**: 45×80 tiles = `MAP_WIDTH/16 (720/16=45) × MAP_HEIGHT/16
  (1280/16=80)`. Its palette uses `Floors_Tiles.png` frame 252, which PreloadScene **already loads**
  (a ground source) — so the start map's *tile layers* need no new texture loads. Its 6 decor sheets
  (`Environment/Props/Static/Rocks.png` ×5 region-crops + `.../Bonfire/Bonfire_02-Sheet.png` ×1 anim)
  are **NOT preloaded** and must be loaded on demand.
- **`config.ts`**: `MAP_WIDTH=720` (L43), `MAP_HEIGHT=1280` (L44), `TILE_SIZE=16` (L47),
  `GROUND_CHUNK_ROWS=32` (L60), `BASE_ZONE={minCol:12,maxCol:32,minRow:26,maxRow:52}` (L245, inclusive
  → extent 21×27). `MAP_WIDTH/HEIGHT` imported by 6 modules.
- **`GameScene.buildWorld()`** = L227-393; construction order is load-bearing (managers built before
  the player, must not touch player state in their ctor). **`gridDims` is a class FIELD INITIALIZER**
  (L147-150) computed once per scene *instance* from `MAP_WIDTH/TILE_SIZE` — Phaser reuses the
  instance across death-restarts, so per-map dims must move this into `buildWorld()` and re-thread to
  `EnemyManager` (dep `dims()`), `BuildManager` (dep `dims()`), pathfind, `randomiseWorld` (L985),
  `TestApi` (L456).
- **`MAP_WIDTH`/`HEIGHT` call sites**: `PlayerCharacter.ts:37` (spawn = map center),
  `GameScene.ts:148-149` (gridDims), `:272` (physics bounds), `:361` (camera bounds),
  `groundRenderer.ts:27-28` (bake cols/rows), `VisionController.ts:72` (full-map fog rect),
  `SurvivalClock.ts:105` (full-map night rect).
- **Ground rendering precedent**: `groundRenderer.drawGround(scene)` is single-role procedural (baked
  RTs in `GROUND_CHUNK_ROWS` chunks at depth 0). The **data-driven precedent to mirror** is the
  editor's `EditorScene.bakeAllLayers` (L350-367) / `bakeChunk` (L370-398): iterate `map.layers` →
  `layer.cells[cellIndex(col,row,width)]` → `map.palette[idx]` → `resolveTile(entry.source)` →
  `rt.batchDrawFrame(...)`, one RT set per layer at `setDepth(layerIndex)`, `NEAREST` filter. Must
  honor `TileLayer.overhead` (above actors) which `drawGround` cannot express.
- **Decor rendering precedent**: `src/render/decorSprites.ts` is engine-shared / editor-free:
  `decorTextureKey`, `queueDecorTexture` (idempotent `load.spritesheet`/`load.image`),
  `resolveDecorDraw → {kind:'whole'|'region'|'anim'}` (region = `texture.add(frame,0,x,y,w,h)` crop;
  anim = `anims.create`). `EditorScene.placeDecor` (L431-459) is the draw pattern to mirror. **Flag**:
  `placeDecor` uses `parseAssetId` + `tilesetAssetUrl` from **`src/editor/textureLoading.ts`** — the
  runtime path needs them but MUST NOT import editor → duplicate into a shared runtime module.
- **Resource nodes**: `ResourceNodeManager.addNode(def,col,row)` is the clean inversion point;
  `spawnTrees()` (L71-99) is a hardcoded list. `NodeObject` = `{ref,col,row}`, `ref` a `NODES` key;
  **`parseMap` does NOT validate `ref`** → the loader owns unknown-ref handling. Nodes *produce*
  blocking data (`hasBlockingNode`); they don't read a grid.
- **Pathfinding**: `findPath(start,goal,isBlocked,dims)` where **`isBlocked` is a callback
  `(col,row)=>boolean`, not an array**. Runtime walkability is the closure `GameScene.isBlocked`
  (L587-588) = `buildManager.isOccupied || resourceNodeManager.hasBlockingNode`. The map's
  `Walkability.cells` (`0`=walkable/`1`=blocked) composites *under* runtime obstacles — extend the
  closure, no pathfinder signature change.
- **Base zone**: `isInBase(col,row)` (`base.ts:10`) reads `BASE_ZONE` directly; only consumer is
  `BuildManager.tilePlaceable` (`:133`). `baseZoneTileRect()` is unused by any renderer.
- **Textures**: `PreloadScene.preload()` loads only fixed `ACTIVE_TILESET` roles.
  `collectTextureSources(map)` (`mapFormat.ts:752`) enumerates the deduped palette-source + decor-asset
  union. On-demand loading = the editor's async pattern: queue → `load.start()` → await
  `Phaser.Loader.Events.COMPLETE` → draw (`EditorScene.loadTexturesThenBuild:201-213`). **`buildWorld`
  is fully synchronous today** — mitigate by preloading the known start map's textures up-front in
  PreloadScene so `buildWorld` stays synchronous.
- **Tests**: pure vitest, no Phaser/DOM harness (`mapFormat.test.ts` style). Phaser-coupled rendering
  is exercised live at `npm run editor`/`npm run dev`, not unit-tested. Split new code so pure parts
  (walkability compositing, dims, node/decor resolution) are unit-tested and rendering stays live.

### Guardrail (hard)
Another chat is concurrently editing `src/editor/*`. Every step stays on the runtime/consumption side
(`src/scenes`, `src/entities`, `src/systems`, `src/render`). **Do not modify any `src/editor/*` file
and do not change any schema in `mapFormat.ts` / `worldLayout.ts`.** Where a helper only exists under
`src/editor/`, DUPLICATE it into a shared runtime module (consolidation is a future cleanup).

### Direction check
Per `CLAUDE.md` + `docs/GAME-DESIGN.md`, the game is a data-driven, decoupled-scene survival builder
whose "Next" milestone is enemy night-waves + the equipment queue; a real world made of authored,
streamable maps is the substrate those sit on. This feature converts the already-built authoring seam
into a live runtime, directly serving that direction.

---

## Steps

- [x] **Step A1: Shared asset-path helpers (duplicated, no editor edit)** `[delegate sonnet]` (parallel: A)
  - Create `src/render/assetPaths.ts` exporting `parseAssetId` and `tilesetAssetUrl`, copied
    **verbatim** from `src/editor/textureLoading.ts` (L10, L20). Pure functions. Header comment:
    "Duplicated from editor to keep the runtime decor path editor-free (guardrail, plan 018);
    consolidate once the concurrent editor work settles."
  - Add `src/render/__tests__/assetPaths.test.ts` mirroring editor behaviour for a `pixel-crawler/...` id.
  - Side effects: NONE — new file only; do **not** touch `src/editor/textureLoading.ts`.
  - Done when: both helpers exported with a passing unit test; no editor file changed.
  - Outcome: Created `src/render/assetPaths.ts` (`parseAssetId`/`tilesetAssetUrl` verbatim from
    `src/editor/textureLoading.ts`; only "dep" is Vite's `import.meta.env.BASE_URL`) + 7-test
    `src/render/__tests__/assetPaths.test.ts`. Full suite 345 tests pass, tsc clean, no editor file touched.

- [x] **Step A2: Start-map / spawn / base-zone / hunger config constants** `[delegate haiku]` (parallel: A)
  - In `src/config.ts` add: `START_MAP_ID = 'test'`; `SPAWN_TILE = { col: 21, row: 33 }` (inside
    `test.map.json`'s floor patch); `BASE_ZONE_SIZE = { w: 21, h: 27 }` (current `BASE_ZONE` extent);
    and the stopgap flag `HUNGER_LETHAL = false` with a comment: "TEMP stopgap (plan 018 critique #1):
    the start map has no food nodes yet and trunk auto-deploys; keep hunger non-lethal until authored
    food lands, then set true / remove." Leave `BASE_ZONE`/`MAP_WIDTH`/`MAP_HEIGHT` in place (removed in
    A12).
  - Side effects: none yet (consts unused until A8/A9/A11).
  - Done when: constants exist and typecheck.
  - Outcome: Added `HUNGER_LETHAL=false`, `START_MAP_ID='test'`, `SPAWN_TILE={col:21,row:33}`,
    `BASE_ZONE_SIZE={w:21,h:27}` to `src/config.ts` (~L240-253) with the exact stopgap comment;
    `BASE_ZONE`/`MAP_WIDTH`/`MAP_HEIGHT` left intact; tsc clean.

- [x] **Step A3: Runtime map registry (eager manifest/world + lazy per-map chunks)** `[delegate sonnet]` (parallel: A)
  - Create `src/systems/mapRuntime.ts` (Phaser-free). Eager-import `../data/maps/manifest.json` +
    `../data/maps/world.json`, narrowing via `parseManifest`/`parseWorldLayout`. Lazy loader via
    `import.meta.glob('../data/maps/*.map.json', { import: 'default' })`, keyed by id. Export:
    - `MANIFEST`, `WORLD` (parsed at module load).
    - `WORLD_INDEX = buildWorldIndex(MANIFEST.placements, metas)` — `metas` from `MANIFEST.maps`.
    - `originOf(mapId): {col,row}` — the placement origin, or `{col:0,row:0}` if unplaced (the start
      map may be unplaced in L0). **Note for 019:** this fallback is L0-only; document that L1 requires
      real placements (see plan 019 prereq).
    - `async loadMapFile(id): Promise<MapFile>` — dynamic-import → `migrateMap`/`parseMap`. In DEV,
      assert the map's `MANIFEST.maps` entry matches its parsed `meta` (`width/height/name`); precise
      `console.warn` on mismatch (do NOT call `generateManifest` — it needs all maps).
  - Unit test: `loadMapFile('test')` resolves a parsed `MapFile`; `originOf('test')` → `{0,0}`.
  - Done when: exports resolve; test passes.
  - Outcome: Created `src/systems/mapRuntime.ts` + `src/systems/__tests__/mapRuntime.test.ts` (6 tests
    pass, incl. real `import.meta.glob` dynamic import under vitest — no env limitation). **PATH DRIFT:
    schema lives in `src/systems/mapFormat.ts` + `src/systems/worldLayout.ts`, NOT `src/data/`** — later
    steps must import from there. `buildWorldIndex(placements, metas)` matches sketch; `loadMapFile` uses
    `migrateMap` (mirrors editor `Toolbar.tsx` call site). **Deviation:** `originOf` reads
    `WORLD.placements` (authoritative `world.json`) not `MANIFEST.placements`; both eager-parsed & exported.
    `test` is unplaced (`placements: []`) so `originOf('test')` → `{0,0}` via L0 fallback. Full suite 355 pass.

- [x] **Step A4: Data-driven layer/palette renderer (added alongside; old path kept)** `[delegate sonnet]` (parallel: A)
  - In `src/scenes/world/groundRenderer.ts` **add** `drawMapLayers(scene, map: MapFile, originPx:
    {x,y}): void` mirroring `EditorScene.bakeChunk` (read-only ref): per `layer` in `map.layers`, bake
    `GROUND_CHUNK_ROWS`-tall RT chunks; per cell read `layer.cells[cellIndex(col,row,map.meta.width)]`,
    skip `0`, `map.palette[idx]` → `resolveTile(entry.source)` → `rt.batchDrawFrame(key,frame,
    originPx.x+col*TILE_SIZE, originPx.y+row*TILE_SIZE)`; depth from layer order; `layer.overhead` →
    above-actor depth; `NEAREST`. **Do NOT delete the old `drawGround`** — leave it in place as the
    fallback until A11 live-verifies and A12 removes it (critique #2).
  - Side effects: none yet (new function; wired in A11).
  - Done when: `drawMapLayers(scene, test, {x:0,y:0})` renders ground + second layer identically to the
    editor Map view (verified live once A11 wires it).
  - Outcome: Added `drawMapLayers(scene, map, originPx)` to `src/scenes/world/groundRenderer.ts` (73 lines,
    `drawGround` byte-untouched). Mirrors editor `bakeChunk`: `GROUND_CHUNK_ROWS` chunks, `cellIndex`
    (from `src/systems/mapFormat.ts`), `resolveTile`, skip palette idx 0, `batchDrawFrame`, NEAREST.
    Global coords via RT positioned at `originPx`. **Note:** editor has no overhead-depth precedent, so used
    `OVERHEAD_LAYER_DEPTH=20` (above actors ~11; but also above night-overlay depth 15 — revisit at A11).
    Added `textures.exists` guard. tsc + eslint clean; live render deferred to A11.

- [x] **Step A5: Pure walkability-composite helper** `[delegate sonnet]` (parallel: A)
  - Create `src/systems/mapWalkability.ts` exporting `mapBlocks(map, col, row): boolean` = `true` when
    `!isInside(map,col,row)` OR `getCell(map.walkability.cells,col,row,map.meta.width) === 1`. Pure.
  - Unit tests (`mapFormat.test.ts` style): inside-walkable → false, inside-blocked → true, oob → true.
  - Done when: helper + tests pass.
  - Outcome: Created `src/systems/mapWalkability.ts` (`mapBlocks` = two-line composition of `isInside` +
    `getCell` reused from `src/systems/mapFormat.ts`) + `src/systems/__tests__/mapWalkability.test.ts`
    (4 tests: walkable/blocked/oob-neg/oob-beyond). Confirmed `map.walkability.cells` matches plan. Full
    suite 349 pass, tsc clean.

- [x] **Step A6: ResourceNodeManager hydrates from `node` objects (added alongside)** `[delegate sonnet]` (parallel: A)
  - In `src/scenes/world/ResourceNodeManager.ts` add `loadNodes(objects: NodeObject[]): void` calling
    `addNode(NODES[obj.ref], obj.col, obj.row)` per object; unknown `NODES[obj.ref]` → precise
    `console.warn` + skip (loader owns unknown-ref handling). **Keep `spawnTrees()` in place** as the
    fallback until A12 (critique #2). Filter to `kind==='node'` at the A11 call site.
  - Side effects: `hasBlockingNode` unchanged; `spawnTrees` call replaced in A11.
  - Done when: `loadNodes([...])` instantiates known refs and DEV-warns (no crash) on unknown refs.
  - Outcome: Added `loadNodes(objects: NodeObject[])` to `src/scenes/world/ResourceNodeManager.ts` (looks up
    `NODES[obj.ref]` from `src/data/nodes.ts` = `Record<string,ResourceNodeDef>`, matches `addNode` def;
    DEV-warns + skips unknown ref, no throw). `NodeObject` = `{id,kind:'node',ref,col,row}` from
    `src/systems/mapFormat.ts`. No kind-filter inside (pre-filtered at A11). `spawnTrees`/`hasBlockingNode`
    untouched. **No unit test:** ResourceNodeManager imports Phaser at module scope → fails under the repo's
    node-env vitest (project convention: no Phaser in tests); verified via tsc + logic walkthrough. 355 pass.

- [x] **Step A7: Runtime decor manager (net-new)** `[delegate sonnet]` (parallel: B)
  - Create `src/scenes/world/DecorManager.ts` rendering `decor` objects, mirroring
    `EditorScene.placeDecor` (read-only ref) but importing ONLY `src/render/decorSprites.ts` +
    `src/render/assetPaths.ts` (A1) — never `src/editor`. Per object: `parseAssetId(obj.asset)` → url via
    `tilesetAssetUrl` → `resolveDecorDraw` → add `image`/`sprite` per `draw.kind`, then
    `setScale/setAngle/setFlip/setDepth(DEPTH_OBJECTS + obj.depth)`, at `(originPx.x+obj.x,
    originPx.y+obj.y)`. If `obj.collision` present, register its footprint into a `blocksAt(col,row)`
    set (analogous to `hasBlockingNode`). Assumes textures preloaded (A10). Construction
    side-effect-free; expose `render(objects: DecorObject[], originPx)`.
  - Side effects: adds a blocked-cell source to composite in A11; reuse the scene's `DEPTH_OBJECTS`.
  - Done when: `test.map.json`'s **6 decor render correctly — 5 `Rocks` region-crops (region branch) +
    1 animated `Bonfire_02-Sheet` (anim branch)**; both render branches verified live; collision
    footprints (if any) block pathing.
  - Outcome: Created `src/scenes/world/DecorManager.ts` (`render(objects, originPx)` + `blocksAt(col,row)`,
    ctor side-effect-free) + `__tests__/DecorManager.test.ts` (3 tests on pure `footprintCells` helper).
    `DecorObject` = `{id,kind:'decor',asset,x,y,scaleX,scaleY,rotation(deg),flipX,flipY,depth,collision?,region?,anim?}`;
    `collision` = `{col,row,w,h}` map-local → translated to GLOBAL blocked cells. Mirrors `placeDecor`
    region/anim/whole branches via `resolveDecorDraw`. **Deviations for A11:** (1) only `parseAssetId` used,
    NOT `tilesetAssetUrl` (placeDecor doesn't either — url is A10's `queueDecorTexture` job); (2) **no runtime
    `DEPTH_OBJECTS` exists** — used local `DEPTH_OBJECTS=1`; A4 used `OVERHEAD_LAYER_DEPTH=20` — **A11 should
    reconcile decor/overhead depth values.** `test.map.json` decor have no collision (footprint logic
    unit-verified, not live). tsc clean for the file; live 6-decor render deferred to A11. 370 tests pass.

- [x] **Step A8: Spawn-anchored, constant-size base zone** `[delegate sonnet]` (parallel: B)
  - In `src/systems/base.ts`, change `isInBase(col,row)` and `baseZoneTileRect()` to take a `rect`
    parameter (stay pure); add `baseZoneFromSpawn(spawn, size)` returning a rect **centred on** the
    spawn tile. Update the sole consumer `BuildManager.tilePlaceable` (`:133`) to pass the computed rect
    (threaded via a closure/dep from `GameScene`, mirroring the `dims()` dep pattern).
  - Side effects: `BASE_ZONE` const becomes unused (removed in A12). Update `base.test.ts` to the
    parameterised signatures + cover `baseZoneFromSpawn` centring.
  - Docs: `docs/GAME-MECHANICS.md` — if it states base-zone bounds, update to "constant size anchored
    at spawn (`BASE_ZONE_SIZE`)". Terse.
  - Done when: base-zone gating uses a rect centred on `SPAWN_TILE`; tests pass.
  - Outcome: `src/systems/base.ts` now pure: `isInBase(rect,col,row)`, `baseZoneTileRect(rect)`,
    `baseZoneFromSpawn(spawn,size)` (centred; `min=spawn-floor(size/2)`, `max=min+size-1`; verified
    `({col:21,row:33},{w:21,h:27})` → `{minCol:11,maxCol:31,minRow:20,maxRow:46}`). **BuildManager lives at
    `src/scenes/build/BuildManager.ts`** and now imports `SPAWN_TILE`/`BASE_ZONE_SIZE` and **self-computes+caches
    `baseZoneRect` at construction** (config-computed, NOT a threaded dep — kept GameScene untouched &
    compiling). **A11 note:** base-zone threading is already effectively done via config-compute; A11 need not
    thread it unless it wants a runtime-varying rect. `base.test.ts` updated + centring test added;
    `docs/GAME-MECHANICS.md` base-zone section updated. `BASE_ZONE` const left intact (A12). Tests pass.

- [x] **Step A9: SurvivalClock/VisionController — injected extent + hunger stopgap** `[delegate sonnet]` (parallel: B)
  - `VisionController` (`:72`) and `SurvivalClock` (`:105`) build full-map rects from
    `MAP_WIDTH/HEIGHT`. Change both to accept the world pixel extent via ctor/deps (`worldPx:{w,h}`) and
    size their fog/night rects from it; drop the `MAP_WIDTH/HEIGHT` imports.
  - **Also (critique #1 stopgap):** in `SurvivalClock`, guard the hunger→HP lethal drain behind
    `HUNGER_LETHAL` (A2) — when `false`, hunger still ticks/displays but does not reduce HP. Keep it a
    single clearly-commented guard so it's trivial to remove later.
  - Side effects: construction sites (`:370`, `:380`) pass `worldPx` — wired in A11.
  - Done when: both compile against injected `worldPx`; with `HUNGER_LETHAL=false` the player cannot
    starve to death; no `MAP_WIDTH/HEIGHT` import remains in these two files.
  - Outcome: **Paths: `src/scenes/fx/VisionController.ts` + `src/scenes/world/SurvivalClock.ts`.** Added
    `worldPx:{w,h}` as a plain field on `VisionControllerDeps` + `SurvivalClockDeps`; fog/night rects now
    sized from it; `MAP_WIDTH/HEIGHT` imports removed from both (grep-confirmed gone). `HUNGER_LETHAL` guard
    wraps ONLY the starvation HP drain in `SurvivalClock.tick()` (hunger still ticks/displays). **A11 must
    pass `worldPx` at GameScene ctor sites :370 (VisionController) + :380 (SurvivalClock)** — these are the
    only 2 tsc errors in the tree now. No SurvivalClock/VisionController tests existed. 370 tests pass.

- [x] **Step A10: Preload the start map's textures (async lifecycle, with error guard)** `[inline]`
  - In `src/scenes/PreloadScene.ts`, after `ACTIVE_TILESET`: `loadMapFile(START_MAP_ID)` (A3), stash in
    registry (`registry.set('startMap', map)`), and for each `collectTextureSources(map)` entry not
    already queued/loaded, queue it — palette sources through the existing `resolveTile`/`sheetKey`/
    `tileImageKey` keys, decor assets through `queueDecorTexture` (via A1 helpers). Keeps `buildWorld`
    synchronous. Mirror `EditorScene.loadTexturesThenBuild` (`:201-213`) for the queue→`COMPLETE`→proceed
    shape; guard already-present keys with `textures.exists`.
  - **Error handling (critique #2):** wrap the async import/`parseMap` in try/catch — on failure, do NOT
    hang Preload; surface a clear error via the existing on-screen crash reporter (see
    `18fbbfc feat(debug): on-screen crash reporter`) / a visible message, so a bad map is diagnosable
    rather than a black screen.
  - Side effects: `GameScene` now reads `registry.get('startMap')`. This is the one create()-lifecycle
    change — keep it contained to PreloadScene.
  - Done when: booting loads `test.map.json` + its decor sheets before `GameScene.create`, no
    missing-texture warnings; a deliberately-broken map id surfaces a visible error instead of hanging.
  - Outcome: `src/scenes/PreloadScene.ts` — `create()` now drives an async `loadStartMapThenContinue()`
    (map load + a 2nd texture batch) before starting MainMenu, since `loadMapFile` is async but Phaser's
    `preload()` is sync; keeps `buildWorld` synchronous. Map stashed at `registry.set('startMap', map)`.
    New `queueMapTextures(map)` mirrors `EditorScene.queueTextures` (palette + decor, deduped, guarded by
    `textures.exists`/`seen`). **Deviation:** iterates `map.palette` directly rather than
    `collectTextureSources(map)` — the latter's `TextureSourceRef` drops each entry's `pack`, which is
    needed to build palette URLs; same effect, correct URLs. Node objects need no queue (tile-role
    sprites already preloaded). Error path: a failed `loadMapFile` is re-thrown → the always-on crash
    reporter's global `unhandledrejection` handler shows the copyable overlay (no hang). tsc adds no new
    errors (only A9's pending `worldPx` at GameScene:370/:380 remain, resolved in A11); eslint clean; 370
    tests pass. **Live boot verification deferred to A11's checkpoint** — nothing consumes
    `registry.get('startMap')` and the tree doesn't fully typecheck until A11 wires `worldPx`.

- [x] **Step A11: `buildWorld` big-bang integration (wire new path; old path still present)** `[inline]`
  - Rewrite `GameScene.buildWorld()` to be data-driven for one map, **without yet deleting the
    procedural functions** (A12 does that after live verify):
    - `const map = registry.get('startMap')` (A10); `const origin = originOf(START_MAP_ID)` →
      `originPx = {x: origin.col*TILE_SIZE, y: origin.row*TILE_SIZE}`.
    - **Move `gridDims` out of the field initializer** (delete L147-150 init) and compute it in
      `buildWorld` from `map.meta` (`{cols:map.meta.width, rows:map.meta.height}`); assign the instance
      field so `EnemyManager`/`BuildManager`/pathfind/`randomiseWorld`/`TestApi` keep reading it (runs
      each restart at `:167`).
    - Call `drawMapLayers(this, map, originPx)` (A4) instead of `drawGround(this)`.
    - Construct `DecorManager` (A7); `render(map.objects.filter(o=>o.kind==='decor'), originPx)`.
    - `resourceNodeManager.loadNodes(map.objects.filter(o=>o.kind==='node'))` (A6) instead of
      `spawnTrees()`.
    - Keep `EnemyManager` procedural: keep `spawnEnemies()` but re-base its hardcoded
      `addEnemy('kidZombie',22,50)` onto a tile walkable in the start map (verify against walkability).
    - Spawn the player at `SPAWN_TILE`: construct `PlayerCharacter` at `tileToWorldCenter(SPAWN_TILE) +
      originPx` instead of `MAP_WIDTH/2,MAP_HEIGHT/2` (`PlayerCharacter.ts:37` — pass an explicit spawn
      position into the ctor rather than importing config there).
    - Physics + camera bounds from map geometry at `:272`/`:361`
      (`origin*TILE_SIZE, map.meta.width*TILE_SIZE, map.meta.height*TILE_SIZE`).
    - Pass `worldPx = {w:map.meta.width*TILE_SIZE, h:map.meta.height*TILE_SIZE}` into `VisionController`
      - `SurvivalClock` (A9).
    - Compute `baseZoneFromSpawn(SPAWN_TILE, BASE_ZONE_SIZE)` (A8); thread into `BuildManager`.
    - Extend the `isBlocked` closure (`:587`): `buildManager.isOccupied(c,r) ||
      resourceNodeManager.hasBlockingNode(c,r) || decorManager.blocksAt(c,r) ||
      mapBlocks(map, c-origin.col, r-origin.row)` (A5 — note local-coord offset).
    - **Portals**: `map.objects.filter(o=>o.kind==='portal')` parsed/stored; NO transition behaviour.
  - Side effects to check: `TestApi` (`:456`) + `randomiseWorld` (`:985`) still see the map-derived
    `gridDims` and scatter within the map's walkable area; death-restart (`:167`) recomputes `gridDims`
    cleanly; UIScene launch unchanged.
  - **Verify checkpoint (critique #2):** `npm run dev` and confirm live — ground + all 6 decor render,
    player spawns at `SPAWN_TILE` on walkable ground, pathfinding respects map walkability + decor
    footprints, base zone sits around spawn, one enemy on walkable ground, `HUNGER_LETHAL=false` so no
    starve-out. **Do not proceed to A12 until this passes.**
  - Done when: the checkpoint above is green; the old procedural functions still exist but are no longer
    called.
  - Outcome: `GameScene.buildWorld()` is now data-driven for the one authored map. **Files:**
    `src/scenes/GameScene.ts` (imports: `START_MAP_ID`/`SPAWN_TILE` replace `MAP_WIDTH`/`MAP_HEIGHT`;
    added `tileToWorldCenter`, `originOf`, `mapBlocks`, `drawMapLayers`, `DecorManager`, map-object
    types; dropped `drawGround` import). `gridDims` moved out of the field initializer to a
    per-(re)start compute in `buildWorld` from `map.meta`. New fields `startMap`/`mapOrigin`/
    `decorManager`/`portals`. buildWorld reads `registry.get('startMap')`, computes `originPx`/`worldPx`,
    `drawMapLayers` (not `drawGround`), `loadNodes(node objs)` (not `spawnTrees`), constructs+renders
    `DecorManager`, holds `portals` (no wiring), spawns `PlayerCharacter` at `SPAWN_TILE+originPx`
    (ctor now takes an explicit `spawn` — `src/entities/PlayerCharacter.ts`, `MAP_WIDTH/HEIGHT` dropped),
    physics+camera bounds from `originPx`/`worldPx`, passes `worldPx` into VisionController+SurvivalClock
    (fixes A9's 2 pending tsc errors). `isBlocked` closure extended with `decorManager.blocksAt` +
    `mapBlocks(startMap, col-origin, row-origin)`. `portals` count added to the crash-context snapshot
    (a genuine read — TS flags write-only private fields). **Enemy NOT re-based:** `EnemyManager`
    `addEnemy('kidZombie',22,50)` left as-is — (22,50) is walkable in test.map.json (all 3600 cells
    walkable). tsc clean, eslint 0 errors (90 pre-existing warnings), 377 unit tests pass; prod `npm run
    build` emits `test.map` as a **separate lazy chunk** (import.meta.glob works in prod).
    **Live checkpoint (vite dev, Playwright drive+screenshot) — GREEN:** Game+UI active, zero
    console/page errors; player at (21,33)=`SPAWN_TILE` (px 344,536); camera bounds 720×1280 from
    `map.meta`; all **6 decor rendered** (5 Rocks + animated Bonfire, visually confirmed); 1 enemy at
    (22,50) walkable; walkability composited (in-bounds walkable, both OOB probes blocked, no-collision
    decor tiles walkable); **HUNGER_LETHAL=false confirmed** — hunger 0 + step past starve interval → HP
    holds at 10, not dying. **e2e note (not gated on deploy):** `deploy.yml` runs only `npm run test` +
    `npm run build`, NOT e2e/smoke, so trunk auto-deploy is safe. But `npm run e2e`'s
    `survival-hunger.spec.ts` "a starving player loses HP" now FAILS by design (A9 stopgap disables the
    starve→HP drain) — surfaced for a decision (skip-until-food vs leave); tracked with the Out-of-scope
    HUNGER_LETHAL flip. Also: the **boot canary `scripts/smoke.mjs` fails** — its single un-retried
    canvas click races the now-async `PreloadScene.create()` (MainMenu starts a tick later); no boot
    error, purely a click-timing regression. Needs the e2e `bootIntoGame` wait-for-MainMenu-active +
    retry treatment.

- [x] **Step A12: Delete procedural remnants + docs (post-verify cleanup, one-way door)** `[inline]`
  - **Only after A11's live checkpoint passes.** Remove the now-dead procedural code: old `drawGround`
    body in `groundRenderer.ts`, `ResourceNodeManager.spawnTrees()`, and the now-unused
    `MAP_WIDTH`/`MAP_HEIGHT`/`BASE_ZONE` consts in `config.ts` (grep to confirm zero remaining
    importers before deleting each). Re-run the A11 checkpoint after removal to confirm nothing
    regressed.
  - Docs: `docs/STATUS.md` — one line that the game now boots into an authored map (plan 018).
    `src/data/maps/README.md` — update "the game loads" to reflect runtime consumption now exists.
    `CLAUDE.md` architecture map — adjust the `src/scenes` line from procedural to map-driven world
    load. All edits terse.
  - Done when: no procedural world-gen path or dead const remains; `npm run build` + `npm test` + lint
    pass; live checkpoint still green.
  - Outcome: Deleted `drawGround` (body + doc) from `src/scenes/world/groundRenderer.ts` and its now-dead
    `MAP_WIDTH`/`MAP_HEIGHT`/`ACTIVE_TILESET`/`pickWeighted` imports; deleted `ResourceNodeManager.spawnTrees()`;
    deleted the `MAP_WIDTH`/`MAP_HEIGHT` consts (+ doc) and the fixed-bounds `BASE_ZONE` const (+ doc) from
    `src/config.ts`. Grep-confirmed **zero real importers** before each delete — all surviving mentions are
    explanatory comments (editor's "mirroring drawGround" comment left untouched per guardrail). Also swept
    stale comments referencing the deleted symbols in `groundRenderer.ts`/`ResourceNodeManager.ts`/`GameScene.ts`
    and fixed the `config.BASE_ZONE` → `BASE_ZONE_SIZE` doc ref in `src/data/types.ts`. Docs: added a plan-018
    section to `docs/STATUS.md`, rewrote the `src/data/maps/README.md` intro (runtime consumption now exists),
    and updated the `CLAUDE.md` `src/scenes` line (boots into an authored map via `mapRuntime.ts`, not procedural).
    **Verify:** tsc clean, eslint 0 errors (90 pre-existing `any` warnings in tests), 377 unit tests pass,
    `npm run build` green with `test.map` still a separate lazy chunk (`dist/assets/test.map-*.js`). **Live
    checkpoint re-run (temp Playwright spec, since removed) — GREEN:** boots into `test.map`, player at
    (21,33)=`SPAWN_TILE`, camera bounds 720×1280 from `map.meta`, walkability composited (OOB blocked / authored
    tile walkable), ≥1 enemy, ground + decor render (screenshot confirmed), zero console/page errors.

### Parallelism
- **Group A** (A1–A6): all new files or isolated single-file edits, write-disjoint
  (`assetPaths.ts` / `config.ts` / `mapRuntime.ts` / `groundRenderer.ts` / `mapWalkability.ts` /
  `ResourceNodeManager.ts`), no cross-deps → concurrent.
- **Group B** (A7–A9): write-disjoint (`DecorManager.ts` / `base.ts`+`BuildManager.ts`+`base.test.ts` /
  `VisionController.ts`+`SurvivalClock.ts`), each depends only on Group A → concurrent after A.
- A10 → A11 → A12 are sequential `[inline]` (async lifecycle → integration → gated cleanup).

## Out of scope
- **Any `src/editor/*` change** and **any schema change** to `mapFormat.ts` / `worldLayout.ts`.
- **L1 adjacent-ring streaming** — [plan 019](019-l1-map-streaming.md).
- **Authored player-spawn / start-map-in-editor** — spawn stays a hardcoded `config.ts` constant.
- **Enemy authoring in maps** — enemies remain procedural.
- **Portal transitions** — parse-and-hold only.
- **Removing the `HUNGER_LETHAL` stopgap** — flip on / delete once the start map has authored food
  nodes (paired with the Phase-A content ship gate). Tracked, not done here.
- **De-duplicating `parseAssetId`/`tilesetAssetUrl`** back into one shared home with the editor
  (deferred until the concurrent editor work settles).
- **Base-zone bounds authored from map `Zones`** — spawn-relative constant-size for now.

## Critique

> Independent fresh-eyes review (pre-execution). Verdict + severity table below; findings #1–#5 have
> been folded into the steps above (gate + stopgap for #1; error-guard + A11/A12 verify-before-delete
> for #2; L1 split to plan 019 for #3; #4 reconciled in plan 019's prereq; #5 fixed in A7).

**Verdict:** The approach is right and roadmap-aligned (exactly the authored-map substrate
DECISIONS/GAME-DESIGN call for) and the integration sweep is accurate — but Phase A as originally
written booted an unplayable, node-less, starving world straight to auto-deploy, and a few cross-phase
gaps needed closing before execution.

|#|Finding|Lens|Severity|Resolution|
|-|-------|----|--------|----------|
|1|`test.map.json` has 0 `node` objects; after the big-bang there's no wood/stone/**food** while hunger ticks → guaranteed starve-out, auto-deployed live. Never named as a Phase-A prerequisite.|Gaps/risks · roadmap|**High**|Phase-A content ship gate (authored starter nodes) + `HUNGER_LETHAL` stopgap (A2/A9).|
|2|Big-bang deleted the whole procedural path with no fallback/error path; async preload throw hangs Preload; mis-render has no fallback. One-way door on auto-deploy trunk.|Reversibility|**Medium**|A10 error guard; A4/A6 keep old path; A11 live checkpoint before A12 deletes.|
|3|L0+L1 in one plan; Phase B can't be verified end-to-end without out-of-scope content (a placed second map).|Scope discipline|**Medium**|Split L1 into [plan 019](019-l1-map-streaming.md).|
|4|Empty `world.json` placements → `mapAt` returns `null` everywhere → B2 "unowned→blocked" freezes the player; B needs the start map itself placed, contradicting `originOf`'s unplaced fallback.|Cross-cutting consistency|**Medium**|Reconciled in plan 019: placement prereq + single-unplaced-map fallback.|
|5|A7 said "7 Rocks" decor — actually 6: 5 Rocks region-crops + 1 animated Bonfire sheet (distinct anim branch).|Executability|**Low**|A7 acceptance corrected to 6 decor across both region + anim branches.|
