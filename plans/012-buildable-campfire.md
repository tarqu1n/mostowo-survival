# Buildable Campfire (+ generalised build system)

> Status: deployed — all 9 steps executed 2026-07-13 (post-013/015 architecture) + an advisor-reviewed
> buildable-runtime de-ossification pass. Build clean, unit 216/216, e2e green; committed (56e6862) and
> deployed to GitHub Pages. Awaiting live playtest feedback.

## Summary
Add the **campfire** — the first placeable structure beyond the wall — and, in the process,
generalise the wall-hardcoded build path so the game supports *multiple* buildables chosen from a
build menu. A campfire costs **10 stone + 10 wood**, can only be placed inside a fixed **base zone**,
renders as an animated fire, and while lit acts as a **light + vision source**: at night it punches a
lit hole in the darkness overlay and reveals actors (enemies) within its radius. It is **always
burning once built**, draining fuel continuously; the player **taps it to feed wood** and top the
fuel back up. When fuel hits zero it goes dark until refuelled.

This pulls in the project's **base-building / base-defense / survival** pillars (docs/GAME-DESIGN.md):
a lit, fuel-hungry fire you station defenders around is the first real base-defense structure and the
first standing survival-upkeep sink.

## Context & decisions

**User decisions (this planning session):**
- **Build picker:** a **build menu/palette** — BUILD opens a panel listing buildables with cost +
  affordability; pick one, then place. (Foundation for future buildables.)
- **Refuel:** **tap the fire to feed wood** from inventory (no new worker-task type).
- **Burn model:** **always burning once built** — drains fuel continuously (day and night); light /
  vision only *visibly* matters at night.
- **Light/reveal radius:** **8 tiles** ("beacon").
- **Base area:** a **fixed rectangular zone** for now (explicitly expected to change later).

**Tuning defaults chosen here (all live in `src/config.ts`, all tunable):**
- `BASE_ZONE = { minCol: 12, maxCol: 32, minRow: 26, maxRow: 52 }` — inclusive tile bounds, centred
  near the spawn/camp tile (~22,40), comfortably covering the camp cluster (cols 16–28, rows 28–45).
- `CAMPFIRE_FUEL_MAX = 120`, `CAMPFIRE_FUEL_BURN_PER_SEC = 1` (⇒ full tank ≈ 120 s of burn; the
  day/night cycle is `DAY_MS + NIGHT_MS = 120 + 90 = 210 s`, so a full fire won't survive a whole
  cycle — deliberate upkeep pressure), `CAMPFIRE_FUEL_PER_WOOD = 30` (⇒ 4 wood refuels an empty fire).
  Fire starts **full** on completion.
- Light radius stored on the buildable as `light: 8` (tiles); managers convert to px via `TILE_SIZE`
  (= 16 ⇒ `8*16 = 128` px). Note the player's own vision is only `PLAYER_START_VISION = 5` tiles, so a
  fire genuinely out-sees the worker.

**Refresh note (2026-07-13) — architecture drift since this plan was first written:**
Plans **013** and **015** decomposed the once-monolithic `GameScene` into narrow, dependency-injected
managers. This plan was authored against the old "everything in GameScene" layout, so its Steps 4/5/7
were re-pointed and its findings rewritten. The refresh was reviewed with the `advisor` subagent; its
two load-bearing decisions:
- **Decision A — campfires get their own `CampfireManager`** (`src/scenes/world/`), mirroring
  `EnemyManager`/`ResourceNodeManager`. A built campfire is a *live, per-frame-simulated* object (fuel
  drain, lit flips, anim/tint writes) — that's the world-manager shape, not `BuildManager`'s
  (placement lifecycle, then passive). Folding back into GameScene would reverse 013/015; overloading
  `BuildManager` would give it two lifecycles.
- **Decision B — lighting is scene-mediated, and the reveal is purely visual.** The night-overlay mask
  is wired via a single `litCampfires()` closure the scene hands to **both** `SurvivalClock` (overlay
  mask) and `VisionController` (fog reveal) — no manager↔manager edge. And enemies are **not**
  vision-gated in this plan: they're not gated today (only the player is), so "reveal enemies" means
  the night-overlay hole makes near-fire enemies *readable*, not a new `setVisible` stealth mechanic
  (that's deferred to the night-waves plan — see Out of scope). Tests assert the light **logic**
  (`inLight` + `nightAlpha`), never pixel brightness or enemy visibility.

**Key findings from the repo sweep (files/patterns to mirror — re-verified against the current tree):**
- **Buildables** live in `src/data/buildables.ts` (currently only `wall`). Schema `BuildableDef`
  (`src/data/types.ts:94`) extends `ObjectStats`→`BaseStats` (`{ maxHp, armour, speed, vision? }`);
  it is thin (`{ id, name, cost, color }` + the ObjectStats block, no sprite/footprint/light fields).
  `ResourceNodeDef` (same file, `:61`) is the fuller data-record-with-render-info pattern to borrow
  from (`tilesTall`/`originX`/`originY`/`blocksPath`/`standOffsets`).
- **Build flow now lives in `BuildManager`** (`src/scenes/build/BuildManager.ts`), NOT GameScene, and
  is still **wall-hardcoded** in a handful of places: deps `canAffordWall()`/`spendWallCost()`
  (`:30-33`), `createBlueprint(col,row)` takes no buildableId (`:159`), `finishSite()` always
  materialises `ACTIVE_TILESET.tiles.wall` (`:186`), `tilePlaceable(col,row)` has no def/base gate
  (`:117`). `BuildSite` (interface now in `src/entities/types.ts:29`) carries **no `buildableId`** —
  must be added. The `build` Action (`src/systems/tasks.ts`) keys off `siteId` and needs **no** change.
  Placeability gate `tilePlaceable` is the hook for the base-zone check. `BuildManager.reset()`
  destroys each `site.visual` (`:213`) — so the campfire sprite must **NOT** be stored on `site.visual`
  (double-destroy + writer-rule violation); `CampfireManager` owns it instead.
- **Cost/Inventory:** `Inventory.canAfford(cost)` / `spend(cost)` (`src/systems/Inventory.ts`), cost is
  `Record<itemId, qty>`; cost is spent at *placement*, not completion. Items `wood` and `stone` both
  exist (`src/data/items.ts`); `stone` is the `rock` node yield. GameScene wires `BuildManager`'s cost
  deps as closures over `this.inv` — generalising them to `canAfford(cost)`/`spend(cost)` mirrors
  `SurvivalClockDeps`, which already takes exactly those Inventory-shaped closures.
- **No base-area concept exists** anywhere (confirmed). Spawn ≈ tile (22,40); grid helpers in
  `src/systems/grid.ts` (`worldToTile`, `tileToWorldCenter`, `tileKey`, `tileToWorldCenter`).
- **Day/night:** pure math in `src/systems/daynight.ts` (`phaseAt`, `tintAlphaAt`, `cycleLengthMs`).
  State + the **`nightOverlay` rect now live on `SurvivalClock`** (`src/scenes/world/SurvivalClock.ts`),
  the *sole writer of the overlay's alpha* (its class doc asserts this). The overlay is **unmasked**
  today (depth 15, fill alpha pinned 1, opacity via `setAlpha(tintAlphaAt(...))` — the `8b30725`
  regression: do NOT touch the fill alpha). `toggleDayNight`/`applyClock` are its manual-jump path.
- **Fog/vision now lives on `VisionController`** (`src/scenes/fx/VisionController.ts`): `fogShape` (a
  hidden `Graphics`) is the source of an **inverted geometry mask** over a depth-5 `0x000000` alpha-0.2
  dim rect — filled circles become reveal holes. `update()` redraws the circle at the player each
  frame. **IMPORTANT: only the *player* is vision-gated** (`player.setVisible(inVisionRange(...))`);
  enemies are NOT hidden by vision at all today (the class doc says "only the player exists to apply
  this to today"). `inVisionRange` is private. Reusable halo bakers: `bakeGlowTexture` /
  `bakeVignetteTexture` (`src/render/glowTexture.ts`). **No Phaser Lights2D / additive blend** anywhere
  — masks + baked canvas textures are the house style (docs/RENDERING.md).
- **Fire sprites exist but are NOT wired**: `public/assets/tilesets/pixel-crawler/Environment/
  Structures/Stations/Bonfire/` — cleanest is `Fire_01-Sheet.png` (128×48 = **4 frames of 32×48**,
  horizontal strip; loadable by the existing `loadStrip`). No texture key / anim registered. Manifest
  pattern: `TilesetManifest` (`src/data/tileset.ts`), `StripAnim`; preload `loadStrip`
  (`src/scenes/PreloadScene.ts`); **anim registration now lives in `registerActorAnims`**
  (`src/scenes/world/actorAnims.ts`) — every `anims.create` is guarded by `anims.exists` (the anim
  manager is process-global across restarts), keyed off `ACTIVE_TILESET`.
- **Pointer/tap intent is split**: gesture mechanics (tap/pan/pinch/long-press) live in
  `PointerInputController` (`src/scenes/input/PointerInputController.ts`); the *intent* resolution
  (`actionAt`/`inspectAt` + the `pickSpriteAt` raycast) lives in `ScenePicker`
  (`src/scenes/input/ScenePicker.ts`). Command-mode taps route to GameScene's `onTap` dep closure
  (`GameScene.ts:292`) — and `PointerInputController` **only** calls `onTap` in `command` mode, so
  tap-to-feed placed there is already mode-gated for free. `PointerPick` union
  (`src/entities/types.ts:44`) is `tree|enemy|site`. Inspect adapters are pure fns in
  `src/systems/stats.ts` (`treeStats`/`wallStats`/`enemyStats`), rendered via `InspectableStats`
  (`{ name, maxHp, currentHp?, extra?: {label,value}[] }` — `wallStats` already uses `extra` for a
  Status row: the template for `campfireStats`'s fuel/lit rows).
- **World-object tracking:** managers own their collections (`ResourceNodeManager`/`EnemyManager`
  hold arrays; `BuildManager` holds `sites`/`occupied`/`siteTiles` + the walls `StaticGroup`).
  GameScene's composite `isBlocked = (c,r) => buildManager.isOccupied(c,r) ||
  resourceNodeManager.hasBlockingNode(c,r)`. Depth convention: world objects **depth 1**, fog dim rect
  5, ghost 6, player 10, nightOverlay 15. A looping Phaser anim self-advances (no per-frame code for
  animation). Add a new **`CampfireManager`** for the campfire collection + per-frame fuel/light.
- **Test API now lives in `src/scenes/testApi.ts`** (`TestApi` + `TestApiDeps` + the `DebugState`
  serializer). `applyScenario` places walls via
  `buildManager.finishSite(buildManager.createBlueprint(c,r))` — which **bypasses**
  `tilePlaceable`/`isInBase` (fine + intended for fixtures). `ScenarioSpec`/`ScenarioResult`/
  `GameTestApi` live in `src/entities/testTypes.ts`. **`DebugState` field order is a frozen contract**:
  `tests/e2e/refactor-tripwire.spec.ts` deep-equals a full inline snapshot (`:94`), so a new field must
  be **appended at the end** and the tripwire's expected object updated **in the same step**.
  `TestApi` *methods* (`inspect`, `isTileBlocked`, `step`) are NOT part of that deep-equal — new test
  seams should be methods, not `DebugState` fields, wherever possible.
- **Tests (three-tier):** unit `src/**/__tests__/*.test.ts` (Vitest, no Phaser) — `daynight.test.ts` /
  `needs.test.ts` are the pure-helper templates; `data.test.ts` already auto-covers new `BUILDABLES`
  entries (cost keys are real items, positive ints); `Inventory.test.ts` simulates a build spend. e2e
  `tests/e2e/*.spec.ts` (Playwright) over `window.game.__test`; `build.spec.ts` is the build template;
  `survival-daynight.spec.ts` covers night alpha. Harness `DebugState` mirror + wrappers in
  `tests/e2e/harness.ts`; fixtures in `tests/e2e/scenarios.ts`.

**Every reference above is a symbol, not a line number where possible.** `GameScene.ts` (~880 lines)
and the managers are stable but re-locate by symbol when editing.

## Steps

- [x] **Step 1: Data & config foundation** `[delegate sonnet]`
  - Outcome: extended `BuildableDef` with 6 optional fields (`light`/`baseOnly`/`blocksPath`/`animKey`/
    `tilesTall`/`originY`) in `src/data/types.ts`; added the `campfire` entry to `src/data/buildables.ts`;
    added `BASE_ZONE` + `CAMPFIRE_FUEL_MAX/BURN_PER_SEC/PER_WOOD` + `COLORS.fireLight` to `src/config.ts`.
    `npm run build` (tsc + vite) clean; `npm test` 190/190 (incl. data.test.ts invariants over the new
    entry). No deviations. `wall` untouched.
  - `src/data/types.ts` — extend `BuildableDef` with optional fields (keep `wall` valid with none of
    them set): `light?: number` (light/vision radius in **tiles**), `baseOnly?: boolean` (restrict
    placement to the base zone), `blocksPath?: boolean` (occupies its tile & blocks movement),
    `animKey?: string` (if present the buildable materialises as an animated sprite instead of a
    static tile), `tilesTall?: number` and `originY?: number` (bottom-anchored multi-tile render,
    mirroring `ResourceNodeDef`). Add a short doc comment on each.
  - `src/data/buildables.ts` — add:
    `campfire: { id:'campfire', name:'Campfire', cost:{ stone:10, wood:10 }, color:0xff7a2b, maxHp:20,
    armour:0, speed:0, light:8, baseOnly:true, blocksPath:true, animKey:'campfire', tilesTall:3,
    originY:1 }`. Leave `wall` unchanged (implicitly `blocksPath` true — Step 4 defaults it to true).
  - `src/config.ts` — add `BASE_ZONE = { minCol:12, maxCol:32, minRow:26, maxRow:52 }`,
    `CAMPFIRE_FUEL_MAX = 120`, `CAMPFIRE_FUEL_BURN_PER_SEC = 1`, `CAMPFIRE_FUEL_PER_WOOD = 30`. Add a
    warm `COLORS.fireLight` (e.g. `0xffb066`) for later glow use. Comment each as tunable.
  - Side effects: `data.test.ts` invariants auto-run against the new entry (cost keys must be real
    items — `stone`/`wood` are — and positive ints; both hold). No consumer reads the new optional
    fields until Steps 4/5, so this compiles standalone.
  - Docs: none here (docs consolidated in Step 9).
  - Done when: `npm run build`/typecheck passes and `npm test` (unit) is green with the campfire entry
    present.

- [x] **Step 2: `isInBase` pure helper + unit test** `[delegate sonnet]` (parallel: A)
  - Outcome: new `src/systems/base.ts` (`isInBase(col,row)` inclusive-rect check + `baseZoneTileRect()`)
    and `src/systems/__tests__/base.test.ts` (corners/centre/just-outside-each-edge/far). `npm test`
    195/195; build clean. Test asserts against derived `BASE_ZONE.*` bounds (not hardcoded literals) —
    matches daynight.test.ts convention.
  - New `src/systems/base.ts` exporting `isInBase(col:number, row:number): boolean` that reads
    `BASE_ZONE` from `src/config.ts` and returns whether the tile is within the inclusive rectangle.
    Keep it Phaser-free and pure (mirror `src/systems/daynight.ts`). Also export a small
    `baseZoneTileRect()` (or the bounds) helper for any future outline rendering.
  - New `src/systems/__tests__/base.test.ts` mirroring `daynight.test.ts` structure: assert inside
    corners/centre true, just-outside each edge false, and a far tile false.
  - Side effects: none — new files only; depends on `BASE_ZONE` existing (Step 1).
  - Docs: none here.
  - Done when: `npm test` green including the new `base.test.ts`.

- [x] **Step 3: Wire the campfire fire animation (asset manifest + preload)** `[delegate sonnet]` (parallel: A)
  - Outcome: added `stations: { campfire: StripAnim }` to `TilesetManifest` + the concrete entry
    (`Fire_01-Sheet.png`, `frameWidth:32, frameSize:48, frames:4`) to `PIXEL_CRAWLER_TILESET`, plus
    `campfireAnimKey()` returning `'campfire'` (matches buildables.animKey). `PreloadScene` loads it via
    `loadStrip` (no `anims.create` — deferred to Step 5). One line in `docs/ASSETS.md`. Asset confirmed
    128×48 on disk. Build clean, 195/195 unit, md-lint clean, **boot canary (smoke) PASSED**.
  - `src/data/tileset.ts` — register `Fire_01-Sheet.png` (path under
    `assets/tilesets/pixel-crawler/Environment/Structures/Stations/Bonfire/Fire_01-Sheet.png`) as a
    looping station animation. **Frame dims (critique #4):** the sheet is **128×48 = 4 frames of 32w ×
    48h**, and `loadStrip` uses `frameWidth` for width and `frameSize` for height — so specify
    `frameWidth: 32, frameSize: 48, frames: 4` (a bare `frameSize: 32` would clip each flame to 32×32).
    Mirror the existing `StripAnim` shape. **`TilesetManifest` is a strongly-typed interface with no
    stations slot today (critique #5)** — add the interface field (e.g. a `stations`/`campfire` strip)
    explicitly, plus a key accessor mirroring `enemyWalkKey`/`playerAnimKey` (e.g. `campfireAnimKey()`
    returning `'campfire'`, matching the `animKey` used in Step 1).
  - `src/scenes/PreloadScene.ts` — load the sheet via the existing `loadStrip(key, strip)` path
    (`frameWidth: 32`/`frameSize: 48` slice the 128×48 horizontal strip into 4 full-height frames).
  - Do **NOT** register the `anims.create` here — that lives in `registerActorAnims`
    (`src/scenes/world/actorAnims.ts`) and is done in Step 5 (keeps all anim registration in one place,
    guarded by `anims.exists`). This step only makes the texture load.
  - Side effects: `PreloadScene` loads one more asset; boot/smoke must still pass. The vertical
    `Bonfire.png` strip is unusable by the horizontal loader — **ignore it**, use `Fire_01-Sheet.png`.
  - Docs: note the newly-wired asset in `docs/ASSETS.md` (one terse line under stations).
  - Done when: the texture key loads without error on boot (`npm run dev` boots clean; smoke passes).

- [x] **Step 4: Generalise `BuildManager` for multiple buildables + base-zone gate** `[inline]`
  - Outcome: `BuildSite` gained `buildableId` (`entities/types.ts`). `BuildManager`: added
    `selectedBuildableId` (+ reset to `'wall'` in `reset()`), `select(id)` (enters build mode, emits
    `build:modeChanged`), pointer-free `tryPlaceAt(col,row)` seam (real `tilePlaceable` gate incl.
    `isInBase` base-zone check for `baseOnly`), generic `canAfford(cost)`/`spend(cost)` deps (replacing
    `canAffordWall`/`spendWallCost`) + `materialiseBuildable(site)` dep; `createBlueprint` takes an
    optional `buildableId`; `finishSite` branches on `animKey` (static wall tile vs `materialiseBuildable`
    hook) and adds body/occupancy gated on `blocksPath ?? true`. GameScene: dropped the now-unused
    `BUILDABLES` import, rewired deps (`canAfford`/`spend` + no-op `materialiseBuildable`), subscribed
    `build:select` → `onBuildSelect` → `buildManager.select`. Build clean; unit 195/195; **wall e2e
    `build.spec.ts` 3/3 green**. Deviation: static branch keeps `tiles.wall` (fixed-key manifest, not
    string-indexable) — noted in-code. Campfire visual verified in Step 5 (hook is a no-op here).
  - `src/entities/types.ts` — add `buildableId: string` to the `BuildSite` interface.
  - `src/scenes/build/BuildManager.ts` (re-locate by symbol):
    - Add field `selectedBuildableId = 'wall'` and a `select(id: string)` method (sets it + enters
      build mode: set `buildMode = true`, emit `build:modeChanged`). Wired by the scene to a new
      `game.events` `'build:select'` (Step 6). **Reset `selectedBuildableId = 'wall'` in
      `BuildManager.reset()`** (critique #2) so a `tryPlace('campfire',…)` can't leave the default
      pointed at `campfire` for a later `applyScenario`'s wall loop.
    - `createBlueprint(col, row, buildableId = this.selectedBuildableId)` — store `buildableId` on the
      site (needed by `applyScenario`'s campfire path in Step 7, hence the explicit arg).
    - `tilePlaceable(col, row)` → read `def = BUILDABLES[this.selectedBuildableId]`; add
      `if (def.baseOnly && !isInBase(col, row)) return false;` (import `isInBase` from
      `../../systems/base` — BuildManager already imports `systems/grid`+`pathfind` directly, so no dep
      needed). Everything else (bounds, occupancy, blocking-node, `reachableAdjacent` stand-tile)
      unchanged. Treat missing `blocksPath` as `true` where occupancy is decided.
    - Add a **pointer-free** `tryPlaceAt(col, row): boolean` holding the real placement logic
      (`tilePlaceable` → `canAfford` → `spend` → `createBlueprint` → `enqueueBuild`, returning whether a
      site was placed). `placeOrEnqueueBuild(pointer)` delegates to it (`worldToTile` then
      `tryPlaceAt`), keeping the existing "tap an existing blueprint re-enqueues it" branch. This method
      is the Step-7 test seam — **one** placement path, no parallel debug copy.
    - `updateGhost`/the cost checks: use `BUILDABLES[this.selectedBuildableId].cost` via the generic
      deps below (not the hardcoded wall cost).
    - `finishSite(site)`: branch on `def = BUILDABLES[site.buildableId]`. **No `animKey`** (wall) →
      current static path (`ACTIVE_TILESET.tiles[...]` image + static body + `occupied`). **Has
      `animKey`** (campfire) → `site.rect.setAlpha(0)` (hide the blueprint square, same as the wall
      path — critique #6), add the static body + `occupied` entry **here** gated on
      `def.blocksPath ?? true` (BuildManager stays the sole pathing/collision writer), then call a new
      dep `materialiseBuildable(site)` to hand the *visual* to CampfireManager. Do **NOT** set
      `site.visual` for the campfire (BuildManager.reset destroys `site.visual`).
  - `BuildManagerDeps`: replace `canAffordWall()`/`spendWallCost()` with generic `canAfford(cost:
    Record<string,number>): boolean` and `spend(cost: Record<string,number>): boolean` (mirroring
    `SurvivalClockDeps`); add `materialiseBuildable(site: BuildSite): void`.
  - `src/scenes/GameScene.ts` (`buildWorld` wiring block): update the `BuildManager` deps —
    `canAfford: (cost) => this.inv.canAfford(cost)`, `spend: (cost) => this.inv.spend(cost)`, and
    **for now a no-op `materialiseBuildable: () => {}`** (critique #1: `campfireManager` doesn't exist
    until Step 5, and no campfire visual is reachable yet — the palette is Step 6 — so a campfire built
    in this step is a legitimately-inert blocking tile until Step 5 replaces this closure with
    `(site) => this.campfireManager.materialise(site)`). Subscribe `game.events` `'build:select'` →
    `buildManager.select` in `wireBus` (+ matching SHUTDOWN `off`).
  - Side effects: `src/systems/stats.ts` `wallStats` still reads `BUILDABLES.wall` — unaffected. The
    `build` Action in `src/systems/tasks.ts` needs **no** change (keys off `siteId`). Existing wall e2e
    (`build.spec.ts`) must still pass — default `selectedBuildableId='wall'` + generic
    `canAfford`/`spend` preserve current behaviour.
  - Docs: none here.
  - Done when: placing a wall still works end-to-end (existing `build.spec.ts` green); a campfire
    blueprint can be enqueued via `select('campfire')` + `tryPlaceAt` and reaches the
    `materialiseBuildable` hook.

- [x] **Step 5: `CampfireManager` + runtime — fuel, tap-to-feed, light + vision** `[inline]`
  - Outcome: new pure `src/systems/campfire.ts` (`drainFuel`/`feedFuel`/`isLit`); `CampfireUnit` +
    `campfire` `PointerPick` variant in `entities/types.ts`; looping fire anim registered in
    `world/actorAnims.ts`; new `src/scenes/world/CampfireManager.ts` (owns the collection + sprites +
    fuel tick + `feedAt` + `litCampfires()`/`inLight()`, SHUTDOWN drop-refs-only). `ScenePicker` gained
    a `campfires()` dep + campfire pick (wins over its hidden site rect by draw order) + inspect case;
    `campfireStats` adapter in `stats.ts` (Fuel + Lit/Out rows). `SurvivalClock` gained a `lightShape`
    Graphics + inverted mask on `nightOverlay`, redrawn from `litCampfires()` each tick/applyClock (doc
    updated). `VisionController.update` fills the same lit circles into `fogShape` (player `setVisible`
    unchanged — Decision B). GameScene: constructed `campfireManager` (before VisionController), wired
    the real `materialiseBuildable`, `campfires()`/`litCampfires()` deps, `campfireManager.tick(delta)`
    above the early-return, and short-tap `feedAt` in `onTap` (imports `worldToTile`). Build clean; unit
    195/195; **full e2e 38/38** (night overlay still darkens + golden snapshot intact with no lit fires
    — the "byte-identical night" check; menu-start flaked under parallel load, passes solo). Campfire
    behaviour (animate/hole/drain/feed/inspect) is driven end-to-end in Steps 6–8.
  - **Pure helpers first** — new `src/systems/campfire.ts` (Phaser-free, mirror `daynight.ts`/
    `needs.ts`): `drainFuel(fuel, deltaMs, burnPerSec)`, `feedFuel(fuel, perWood, max)`,
    `isLit(fuel)`. CampfireManager just calls these (Step 8 unit-tests them).
  - `src/entities/types.ts`:
    - Add `interface CampfireUnit { id:string; col:number; row:number;
      sprite:Phaser.GameObjects.Sprite; fuel:number; lit:boolean }` (world-entity shapes live here
      alongside `BuildSite`/`TreeNode`).
    - Extend `PointerPick` with `| { kind:'campfire'; campfire: CampfireUnit }`.
  - `src/scenes/world/actorAnims.ts` (`registerActorAnims`): register the looping campfire anim
    (`repeat:-1`, guarded by `anims.exists`) using the key from Step 3, mirroring the existing
    `anims.create` calls.
  - **New `src/scenes/world/CampfireManager.ts`** — mirror `EnemyManager`'s structure (constructed
    fresh in `buildWorld`; SHUTDOWN handler that **only drops references**, never `.destroy()`s the
    sprite — Phaser tears GameObjects down first; see EnemyManager's SHUTDOWN-vs-physics doc). Owns
    `campfires: CampfireUnit[]`. API:
    - `materialise(site: BuildSite)`: create the animated sprite (bottom-anchored via `def.originY`,
      scaled to `def.tilesTall`, **depth 1**), play the campfire anim, push a `CampfireUnit`
      (`fuel = CAMPFIRE_FUEL_MAX`, `lit = true`). Does NOT touch body/occupancy (BuildManager did that).
    - `tick(delta)`: for each campfire `fuel = drainFuel(fuel, delta, CAMPFIRE_FUEL_BURN_PER_SEC)`;
      `const was = c.lit; c.lit = isLit(c.fuel)`. On lit→unlit stop the anim + `setTint(0x555555)`; on
      unlit→lit resume anim + `clearTint()`.
    - `feedAt(col, row): boolean`: find a campfire at that tile; `if (deps.spend({ wood:1 }))` (returns
      false/no-op when unaffordable) then `c.fuel = feedFuel(c.fuel, CAMPFIRE_FUEL_PER_WOOD,
      CAMPFIRE_FUEL_MAX)` and return true; else false.
    - `litCampfires(): readonly { x:number; y:number; radius:number }[]` — for each **lit** campfire,
      world-centre px + `def.light * TILE_SIZE`. `inLight(x, y): boolean` — within any lit radius.
    - `all()`, `campfireAt(col,row)`, `reset()` (destroy sprites + clear — RUNTIME path, like
      EnemyManager.clearAll), and the drop-refs-only `destroy()`.
    - `CampfireManagerDeps`: `spend(cost): boolean` (closure over `this.inv.spend`).
  - `src/scenes/GameScene.ts`:
    - Add `private campfireManager!: CampfireManager`; construct it in `buildWorld` (near
      `buildManager`) with `spend: (cost) => this.inv.spend(cost)`. **Replace Step 4's no-op
      `materialiseBuildable` dep** with `(site) => this.campfireManager.materialise(site)` (critique
      #1).
    - `update(_, delta)`: call `this.campfireManager.tick(delta)` right beside
      `this.survivalClock.tick(delta)` — **above** the no-action early-return (fuel drains whether or
      not a task runs), so lit-flips are visible same-frame (the fixed-step e2e depends on this).
    - `onTap` dep closure (`buildWorld`): compute `col/row = worldToTile(pointer.worldX/Y)`; **first**
      `if (this.campfireManager.feedAt(col, row)) return;` — then the existing
      `scenePicker.actionAt` → `order`/`enqueue`. Command-mode is already guaranteed (only `onTap`).
      Optional: a small "+wood"/spark flourish.
    - `scenePicker` deps: add `campfires: () => this.campfireManager.all()`.
    - `litCampfires` closure wired to **both** managers below: `() =>
      this.campfireManager.litCampfires()`.
  - `src/scenes/input/ScenePicker.ts`: add `campfires()` to `ScenePickerDeps`; in `pickSpriteAt`
    consider each campfire (foot-tile hit OR `alphaHit` on the fire sprite — same as a node); add a
    `campfire` case to `inspectAt` → `emit('inspect:show', campfireStats(pick.campfire))`. (The fire
    sprite is drawn after the site rect at the same depth, so it wins the pick tie-break naturally.)
  - `src/systems/stats.ts`: add `campfireStats(unit: CampfireUnit): InspectableStats` →
    `{ name:'Campfire', maxHp: BUILDABLES.campfire.maxHp, extra:[{label:'Fuel',
    value:`${Math.ceil(unit.fuel)}/${CAMPFIRE_FUEL_MAX}`}, {label:'Status', value: unit.lit ? 'Lit' :
    'Out'}] }` (import `CampfireUnit` from `entities/types`, `CAMPFIRE_FUEL_MAX` from config).
  - **Light + reveal (reuse the existing inverted-mask pattern):**
    - *Night light (SurvivalClock owns the overlay):* add `litCampfires()` to `SurvivalClockDeps`; in
      its constructor create a hidden `lightShape` `Graphics` + `createGeometryMask()` +
      `setInvertAlpha(true)` and apply it to `nightOverlay` (mirror VisionController's fog mask). In
      `tick()` **and** `applyClock()` clear `lightShape` and `fillCircle` at each `litCampfires()`
      entry. Keep the overlay fill alpha 1 (do NOT touch it — `8b30725`). Amend the class doc: it now
      owns the overlay's *alpha* **and** its *mask* + `lightShape` (same drop-refs-only SHUTDOWN rule).
    - *Vision reveal (VisionController owns fog):* add `litCampfires()` to `VisionControllerDeps`; in
      `update()`, after the player circle, `fillCircle` at each lit campfire into `fogShape`. Do **NOT**
      change `player.setVisible` (the player is always inside their own circle). Do **NOT** vision-gate
      enemies (Decision B — out of scope).
    - Optional warm feel: bake a `COLORS.fireLight` halo via `bakeGlowTexture`/`bakeVignetteTexture`
      behind each fire — mark optional, skip if time-boxed.
  - Side effects: with **no lit campfires** both light shapes are empty ⇒ zero holes ⇒ night behaviour
    byte-identical (existing `nightAlpha` / `survival-daynight` specs stay green — verify explicitly).
    Two managers each holding their own shape fed by the same `litCampfires()` source is correct, not
    duplication (the *data* is single-sourced). Depth: campfire sprite (1) under nightOverlay (15) —
    the mask cutout is what makes it readable at night. Confirm fog reveal still centres on the player
    when no campfire exists, and command-mode taps that are **not** on a fire still issue orders.
  - Docs: none here.
  - Done when: in `npm run dev` a built campfire animates; at night it clears a lit hole in the
    darkness and near-fire content (incl. enemies) is readable; fuel visibly drains and the fire goes
    dark at 0; **in command mode, a short tap on the fire (wood in inventory) relights/refuels and
    decrements wood without issuing a move order**; tapping it in inspect mode shows HP + fuel/lit.

- [x] **Step 6: Build menu / palette UI** `[inline]`
  - Outcome: `src/scenes/UIScene.ts` only. BUILD now calls `onBuildButton()` (opens/closes a centred,
    dismissible `buildPalette` Panel, or exits build mode when already toggled). New `buildBuildPalette()`
    builds one nested `Button` row per `BUILDABLES` entry (`buildableRowLabel` = "Wall   2 Wood" /
    "Campfire   10 Stone  10 Wood") via `arrangeColumn`; a row emits `build:select {id}` then closes the
    palette. `refreshBuildPalette()` dims unaffordable rows via `inv.canAfford(cost)`, called from
    `refreshInventory()` (replacing the old wall-only BUILD-label dimming). `onBuildMode(true)` force-closes
    the palette; ESC (`keydown-ESC` → `onEscape`) closes palette / exits build mode. Control hint updated
    "Build: walls" → "Build: menu". Added `arrangeColumn` + `BuildableDef` imports. Build clean; unit
    207/207; e2e build/inspect/menu-start 6/6. Verified live via throwaway screenshot spec (now deleted):
    palette renders, Wall bright + Campfire dimmed with wood-only funds, and picking Wall closes the
    palette + shows the BUILD MODE indicator with the button toggled. No deviations from plan.
  - `src/scenes/UIScene.ts`: change the BUILD button to open a **palette Panel** listing every
    `BUILDABLES` entry (Wall, Campfire) using the existing UI kit (`Panel`, `Button`, `arrangeColumn`,
    `theme` from `src/ui/`). Each row shows the name + cost (e.g. "10🪨 10🪵" or text) and is **dimmed
    when `!inv.canAfford(def.cost)`** (read inventory from the registry as today). Selecting a row emits
    `game.events.emit('build:select', { id })` and closes the palette; GameScene (Step 4) routes it to
    `buildManager.select(id)` (which enters build mode with that buildable). Pressing BUILD again / ESC
    closes/exits.
  - Depends on Step 4 (`build:select` + `select`) **and** Step 5 (the campfire materialiser now
    exists), so selecting Campfire builds a real, animated, light-emitting fire — no dead-spend window.
  - Replace the current wall-specific affordability dimming with per-row affordability in the palette;
    refresh rows on the inventory `'change'` event.
  - Side effects: the `build:modeChanged` reflection must still update the button state. Keep the
    palette above the HUD depth. Don't break the existing single-tap-to-build feel for walls (Wall is
    just the first palette row).
  - Docs: none here.
  - Done when: in `npm run dev`, BUILD opens a palette; picking Wall or Campfire enters build mode with
    the right ghost/cost and builds the correct structure; unaffordable rows are visibly dimmed.

- [x] **Step 7: Test seam for campfires** `[inline]`
  - Outcome: `DebugState` gained `campfires: {col,row,fuel,lit}[]` appended at the END (interface +
    serializer via `campfireManager.all()`); `refactor-tripwire.spec.ts` expected snapshot updated with
    `campfires: []` in the same step (still green). `TestApiDeps` gained `campfireManager` (+ `reset()` in
    `resetWorld`). New `TestApi` methods `tryPlace(id,col,row)` (select + real `tryPlaceAt` — exercises
    `tilePlaceable`/`isInBase`), `inLight(col,row)`, `feedCampfire(index)`. `applyScenario` now places
    `spec.campfires` via `finishSite(createBlueprint(c,r,'campfire'))` + seeds `spec.campfireFuel`, returns
    `campfireIds`; wall & blueprint loops now pass explicit `'wall'` (belt-and-suspenders, C2). `testTypes.ts`:
    `ScenarioSpec.campfires`/`campfireFuel`, `ScenarioResult.campfireIds`, `GameTestApi` +tryPlace/inLight/
    feedCampfire. `GameScene.installTestApi`: passed `campfireManager` + wired the 3 methods. `harness.ts`:
    mirrored `DebugState.campfires` + added `tryPlace`/`inLight`/`feedCampfire`/`campfires` wrappers. Build
    clean; unit 207/207; tripwire green; a throwaway seam spec (now deleted) confirmed placement, inLight
    near/far, the base-zone gate (outside=false/inside=true), and drain→feed relight + wood decrement. No
    deviations.
  - `src/scenes/testApi.ts`:
    - `DebugState`: **append** `campfires: { col:number; row:number; fuel:number; lit:boolean }[]` at
      the **end** of the interface AND the serializer (reads `campfireManager.all()`). Update
      `tests/e2e/refactor-tripwire.spec.ts`'s inline expected snapshot (`:94`) with `campfires: []` at
      the end **in this same step** — a deliberate contract extension (note it in the commit).
    - `TestApiDeps`: add `readonly campfireManager: CampfireManager` (stable ref — constructed once per
      `create()` before `installTestApi`, same rule as `buildManager`); add `campfireManager.reset()`
      to `resetWorld()`.
    - Add `TestApi` **methods** (NOT DebugState fields — mirroring `inspect`/`isTileBlocked`):
      - `tryPlace(id:string, col:number, row:number): boolean` → `buildManager.select(id)` +
        `buildManager.tryPlaceAt(col,row)` — exercises the **real** `tilePlaceable` incl. the `isInBase`
        gate, returning whether a site was placed.
      - `inLight(col:number, row:number): boolean` → `campfireManager.inLight(tileToWorldCenter(col),
        tileToWorldCenter(row))`.
      - `feedCampfire(index:number)` → run the real feed path on that campfire's tile
        (`campfireManager.feedAt(campfire.col, campfire.row)`).
  - `src/entities/testTypes.ts`:
    - `ScenarioSpec`: add `campfires?: Array<[number, number]>` and `campfireFuel?: number`.
    - `ScenarioResult`: add `campfireIds: string[]`.
    - `GameTestApi`: add `tryPlace`, `inLight`, `feedCampfire` to the surface.
  - `src/scenes/testApi.ts` `applyScenario`: place each campfire by mirroring the wall path
    (`buildManager.finishSite(buildManager.createBlueprint(c, r, 'campfire'))` — bypassing the gate is
    fine for fixtures), then if `spec.campfireFuel != null` set each new campfire's `fuel`. Return
    `campfireIds`. **Pass the id explicitly in BOTH loops** — `createBlueprint(c, r, 'wall')` in the
    wall loop and `…, 'campfire'` in the campfire loop (critique #2: don't rely on the default
    `selectedBuildableId`, which a prior `tryPlace` may have moved — belt-and-suspenders alongside the
    Step-4 `reset()` fix). **Drop the originally-planned `debug:tryPlace` / `debug:feedCampfire` events** — the
    `tryPlace`/`feedCampfire` methods above are synchronously returnable across the Playwright bridge.
  - `src/scenes/GameScene.installTestApi`: pass `campfireManager` into `TestApiDeps`; add
    `tryPlace`/`inLight`/`feedCampfire` to the installed `GameTestApi` object.
  - `tests/e2e/harness.ts`: mirror the new `DebugState.campfires` field; add wrappers (`tryPlace`,
    `inLight`, `feedCampfire`, and a campfire reader) matching the existing helper style.
  - Side effects: `debugState` stays DEV-only + cheap. Don't reorder existing fields.
  - Done when: `window.game.__test` exposes `tryPlace`/`inLight`/`feedCampfire` + scenario campfire
    placement + `state().campfires`, and the refactor-tripwire snapshot passes with the appended field.

- [x] **Step 8: Tests — unit + e2e** `[delegate sonnet]` (parallel: B)
  - Outcome: new `src/systems/__tests__/campfire.test.ts` (6 unit tests: drainFuel clamp/subtract,
    feedFuel clamp, isLit); `src/data/__tests__/data.test.ts` +1 campfire case (cost exactly
    `{stone:10,wood:10}`, `light>0`); `src/systems/__tests__/Inventory.test.ts` +2 cases (fund + spend
    `{stone:10,wood:10}` deducts both; single-resource shortfall atomically rejected). New
    `tests/e2e/campfire.spec.ts` (4 specs: build-in-base → `state().campfires`; blocked-outside /
    allowed-inside base zone via `tryPlace` with sites+inventory unchanged on reject; night reveal
    `nightAlpha>0` + `campfires[0].lit` + `inLight` near/far, NO enemy-visibility check; fuel drain to 0
    → douses → `feedCampfire` relights + decrements wood). No scenarios.ts fixture needed (inline specs
    self-contained). No non-test source touched. `npm test` **216/216**; full `npm run e2e` 42 specs green
    (one boot-timeout flake on the 5-worker full run — `inspect.spec.ts`, the documented MainMenu-tap race;
    passes on isolated re-run); build clean. No deviations.
  - Unit:
    - New `src/systems/__tests__/campfire.test.ts` — `drainFuel` clamps at 0 and subtracts
      `burnPerSec * s`; `feedFuel` clamps at max; `isLit` true iff fuel > 0. (Pure, no Phaser.)
    - `src/data/__tests__/data.test.ts` — add a campfire-specific case: cost is exactly
      `{ stone:10, wood:10 }` and `light` is a positive number. (Generic invariants already cover it.)
    - `src/systems/__tests__/Inventory.test.ts` — mirror the wall build test with
      `spend({ stone:10, wood:10 })` (fund the inventory first, assert deduction + insufficient-funds
      rejection).
  - e2e (`tests/e2e/`, mirror `build.spec.ts` / `survival-daynight.spec.ts`; use the Step-7 methods +
    `harness.ts` wrappers). Keep specs deterministic (drive the clock, don't wait on wall-time):
    - **Build in base:** `applyScenario` with a `campfires:[[c,r]]` inside `BASE_ZONE` → the campfire is
      present in `state().campfires`.
    - **Blocked outside base:** fund the inventory; `tryPlace('campfire', …)` **outside** `BASE_ZONE`
      → returns false, `state().sites` unchanged, inventory unchanged; a matching attempt **inside** the
      zone → true. **Position the scenario player so `reachableAdjacent` holds for both attempts** (the
      hidden determinism trap in `tilePlaceable` — an unreachable tile also returns false).
    - **Night reveal:** scenario with `startPhase:'night'` + one campfire → assert `nightAlpha > 0`,
      `campfires[0].lit === true`, `inLight(nearTile) === true`, `inLight(farTile) === false`. **No
      enemy-visibility assertion** (Decision B).
    - **Fuel drain / relight:** seed `campfireFuel: 1` and `step(~1200)` (≈1.2 s) → `campfires[0].lit
      === false`; then `feedCampfire(0)` with wood funded → `fuel` increases, wood decremented, `lit`
      true. (Seed low fuel + step ~1 s rather than stepping the full 120 s.)
  - Side effects: may need a scenario fixture in `tests/e2e/scenarios.ts`.
  - Docs: none here.
  - Done when: `npm test` (unit) and the e2e suite (incl. the refactor-tripwire) are green.

- [x] **Step 9: Docs — create `docs/GAME-MECHANICS.md` + index it** `[delegate sonnet]` (parallel: B)
  - Outcome: new `docs/GAME-MECHANICS.md` (4 sections: Buildables & build flow · Campfire · Base zone ·
    Light/night interaction — each citing `config.ts` constants + source files via relative md links).
    `CLAUDE.md` +1 docs-index line (verified single `+` line). `docs/STATUS.md` +terse plan-012 block;
    `docs/DECISIONS.md` +dated entry covering the four boundary calls (fixed-rect base zone placeholder;
    build palette over cycle/buttons; own `CampfireManager` + scene-mediated `litCampfires()` closure;
    enemy fog-gating deferred to night-waves). `npm run lint:md` 0 errors across 32 files. No source/test
    files modified. Side note: the agent flagged a "plan 014" typo in `buildables.ts`'s campfire comment
    (a Step-1 artifact) — fixed inline to "plan 012" during review.
  - **Create `docs/GAME-MECHANICS.md`** (no mechanics doc exists today — confirmed). Terse,
    high-signal, token-optimised. Sections:
    - *Buildables & build flow:* palette → `buildManager.select(id)` → place ghost (base-zone gate for
      `baseOnly`) → cost spent on placement → worker `build` task over `BUILD_MS` → `finishSite`
      materialises (static tile for a wall; `CampfireManager` sprite for an animated buildable).
      Buildables defined in `src/data/buildables.ts` (`BuildableDef`).
    - *Campfire:* cost 10 stone + 10 wood; base-zone only; **always burning once built**; fuel max 120,
      burn 1/s, +30 per wood tapped, starts full; light + vision radius **8 tiles**; blocks path; **tap
      to feed wood** (command mode); dark at 0 fuel. Owned by `src/scenes/world/CampfireManager.ts`;
      pure math in `src/systems/campfire.ts`. All numbers cite `config.ts` constants.
    - *Base zone:* fixed rectangle `BASE_ZONE` in `config.ts` (tile bounds), **placeholder — expected
      to change** (dynamic/claimed base later); checked by `src/systems/base.ts` `isInBase`.
    - *Light/night interaction:* lit campfires cut inverted-mask holes in the night overlay
      (`SurvivalClock`) + extend the vision reveal (`VisionController`), both fed by a single scene-
      mediated `litCampfires()` closure over `CampfireManager`. Note enemies are **not** fog-gated yet
      (deferred). One-line pointer to docs/RENDERING.md for the mask technique.
  - Add a pointer in the **CLAUDE.md docs index**: `- [docs/GAME-MECHANICS.md](docs/GAME-MECHANICS.md)
    — tuned mechanics & numbers (costs, fuel, radii, base zone)`.
  - `docs/STATUS.md`: one line — plan 012 campfire + generalised build/palette landed.
  - `docs/DECISIONS.md`: terse entries — (a) base zone is a **fixed rect for now**, will move to a
    dynamic/claimed base; (b) buildable selection via a **build palette** (chosen over cycle / per-
    buildable buttons); (c) campfires are their **own `CampfireManager`** (per the 013/015 manager
    pattern) and lighting is wired via a scene-mediated `litCampfires()` closure (no manager↔manager
    edge); (d) enemy fog-gating **deferred** to night-waves — this plan's reveal is purely the night-
    overlay hole.
  - Side effects: keep CLAUDE.md a lean index (one line only, per its own instruction).
  - Done when: `docs/GAME-MECHANICS.md` exists with the above, CLAUDE.md links it, STATUS/DECISIONS
    updated.

## Out of scope
- Worker-hauled refuelling / auto-refuel (chose tap-to-feed); proximity requirement for feeding
  (v1 feeds from the shared inventory on tap regardless of player distance).
- Any buildable beyond wall + campfire; a full buildable-category/tech system.
- **Enemy fog-gating** (hiding enemies outside player-vision / firelight) — enemies aren't vision-gated
  today; adding it is a new stealth/fog mechanic (combat targeting of unseen enemies, `pickSpriteAt`
  picking invisible things, monster specs reading `enemyTiles`) deferred to the **night-waves** plan.
  This plan's reveal is purely the night-overlay hole making near-fire enemies *readable*.
- Persistent fog-of-war (discovered-map memory) — the reveal here is the existing real-time vision
  circle, extended to the fire; nothing is "remembered" once out of range.
- Dynamic / player-claimed base zones, base-zone outline rendering while placing (optional nicety —
  drop if time-boxed), and gates/walls perimeter logic.
- Campfire secondary uses (cooking, warmth stat, morale) — light + vision only for v1.
- Additive/Lights2D lighting or a bespoke shader — reuse masks + baked textures per docs/RENDERING.md.

## Critique

*Original independent fresh-eyes review (fresh sub-agent, uncontaminated by the planning conversation),
plus the 2026-07-13 architecture-refresh review (advisor). All fixes are rolled into the steps above.*

**Verdict:** Solid, well-grounded plan. Its riskiest technical bet (the inverted geometry mask on
`nightOverlay`) holds up under source inspection and survives the 013/015 refactor — the overlay simply
moved to `SurvivalClock`, which gains the `lightShape` + mask. Cleared to execute after re-pointing
Steps 4/5/7 to the extracted managers and correcting the "reveal enemies" claim (both applied).

**Original findings (pre-refactor):**

|#|Finding|Severity|Resolution|
|-|-------|--------|----------|
|1|Tap-to-feed was placed in `onPointerDown` with an early-return, but order resolution lived elsewhere.|Medium|✅ Now in GameScene's `onTap` dep closure — command-mode only (PointerInputController only calls `onTap` in command mode), checked before `actionAt`.|
|2|Stale "uncommitted plan-011" working-tree caveat.|Low|✅ Removed; tree is clean.|
|3|Campfire wasn't wired into Inspect.|Low|✅ Step 5: `campfireStats` adapter + `campfire` case in `ScenePicker.inspectAt` + `PointerPick`.|
|4|"Blocked outside base" e2e had no seam (`applyScenario` bypasses `tilePlaceable`).|Low|✅ Step 7: `TestApi.tryPlace` runs the real `tilePlaceable`/`isInBase` via `BuildManager.tryPlaceAt`.|
|5|The palette exposed Campfire before the materialiser existed.|Low|✅ Runtime (Step 5) sequenced before the palette (Step 6).|
|6|Campfire sequenced ahead of CLAUDE.md's "Next" (night-waves).|Low|Kept by design — a fire that reveals approaching enemies is a natural precursor. Owner's call.|

**Refresh findings (2026-07-13, advisor):**

|#|Finding|Severity|Resolution|
|-|-------|--------|----------|
|R1|Steps 4/5/7 targeted GameScene symbols that 013/015 moved into `BuildManager`/`SurvivalClock`/`VisionController`/`ScenePicker`/`testApi`.|High (staleness)|✅ Every step re-pointed to the owning manager; findings block rewritten.|
|R2|Campfire ownership: original plan stuffed arrays into GameScene, reversing 013/015.|Medium|✅ Decision A: new `CampfireManager` (`scenes/world/`), mirroring EnemyManager. BuildManager stays the sole pathing/collision writer; the fire sprite is NOT stored on `site.visual` (double-destroy risk).|
|R3|"Reveal enemies via `inVisionRange`" assumed enemies are vision-gated — they aren't (only the player is).|Medium|✅ Decision B: reveal is purely the night-overlay hole (readability); enemy fog-gating deferred (Out of scope). Tests assert `inLight`/`nightAlpha`, never enemy visibility.|
|R4|`nightOverlay` mask needs campfire data but SurvivalClock owns the overlay ("ownership follows the writer"; no manager↔manager edge).|Medium|✅ Single scene-mediated `litCampfires()` closure handed to both SurvivalClock (overlay mask + `lightShape`) and VisionController (fog reveal).|
|R5|`DebugState` is a frozen contract (refactor-tripwire deep-equals it); test seams risked breaking it.|Low|✅ Step 7: `campfires` appended at the END + tripwire snapshot updated same-step; other seams are `TestApi` *methods* (not part of the deep-equal).|

**Pre-execution critique (2026-07-13, fresh Explore sub-agent — uncontaminated re-read of the refreshed
plan against source):** *Sound, accurate, and largely executable — the refresh's factual claims check
out against source (BuildManager still wall-hardcoded; SurvivalClock owns + sole-writes the unmasked
`nightOverlay`; VisionController gates only the player; `PointerInputController` calls `onTap`
command-mode-only; `DebugState` is a `.toEqual` frozen contract; `BuildManager.reset()` destroys
`site.visual`); Decisions A/B well-justified; no High findings.*

|#|Finding|Severity|Resolution|
|-|-------|--------|----------|
|C1|Step 4's `materialiseBuildable` dep forward-referenced `campfireManager` (introduced in Step 5), so Step 4 couldn't typecheck standalone.|Medium|✅ Step 4 now wires a no-op `materialiseBuildable: () => {}`; Step 5 replaces it with the real closure.|
|C2|`selectedBuildableId` wasn't reset, so a `tryPlace('campfire',…)` could make a later `applyScenario({walls})` build campfires.|Medium|✅ `BuildManager.reset()` resets it to `'wall'` (Step 4) AND `applyScenario` passes explicit ids in both loops (Step 7).|
|C3|Full generalised build system + palette lands ahead of the docs' "Next" (night-waves).|Low|Kept by design (owner-flagged, light/base-defense precursor) — same as original finding 6.|
|C4|Step 3 frame dims imprecise ("32×48"); `loadStrip` uses `frameWidth`(w)/`frameSize`(h).|Low|✅ Step 3: `frameWidth:32, frameSize:48, frames:4`.|
|C5|Step 3 understated the `TilesetManifest` edit (strongly-typed, no stations slot).|Low|✅ Step 3 calls out the interface field + `campfireAnimKey()` accessor.|
|C6|Campfire `finishSite` branch didn't hide the blueprint `site.rect`.|Low|✅ Step 4: `site.rect.setAlpha(0)` on the campfire path too.|

No blocking findings — cleared to execute.
