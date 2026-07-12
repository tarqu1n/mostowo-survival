# Buildable Campfire (+ generalised build system)

> Status: planned — run /critique-plan then /execute-plan to begin.

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
  day/night cycle is 210 s, so a full fire won't survive a whole cycle — deliberate upkeep pressure),
  `CAMPFIRE_FUEL_PER_WOOD = 30` (⇒ 4 wood refuels an empty fire). Fire starts **full** on completion.
- Light radius stored on the buildable as `light: 8` (tiles); scene converts to px via `TILE_SIZE`.

**Key findings from the repo sweep (files/patterns to mirror):**
- **Buildables** live in `src/data/buildables.ts` (currently only `wall`). Schema `BuildableDef`
  (`src/data/types.ts:94`) extends `ObjectStats`→`BaseStats` (`{ maxHp, armour, speed, vision? }`);
  it is thin (no sprite/footprint/light fields today). `src/data/nodes.ts` (`ResourceNodeDef`) is the
  fuller data-record-with-render-info pattern to borrow from.
- **Build flow (all in `src/scenes/GameScene.ts`)** and **hardcoded to the wall** in ~5 places:
  `updateGhost` (~1809), `placeOrEnqueueBuild` (~1828), `finishSite` (~1852, always materialises
  `ACTIVE_TILESET.tiles.wall`), UIScene affordability (`src/scenes/UIScene.ts:~485`), `stats.ts:18`.
  `BuildSite` (interface ~GameScene:104) and the `build` Action (`src/systems/tasks.ts:10`) carry **no
  `buildableId`** — must be added. Placeability gate is `tilePlaceable(col,row)` (~1796) — the hook
  for the base-zone check. Blueprint → worker `build` task → `finishSite` is the flow to reuse
  verbatim for the campfire.
- **Cost/Inventory:** `Inventory.canAfford(cost)` / `spend(cost)` (`src/systems/Inventory.ts`), cost
  is `Record<itemId, qty>`; cost is spent at *placement*, not completion. Items `wood` and `stone`
  both exist (`src/data/items.ts:8-9`); `stone` is the `rock` node yield.
- **No base-area concept exists** anywhere (confirmed). Spawn ≈ tile (22,40); grid helpers in
  `src/systems/grid.ts` (`worldToTile`, `tileToWorldCenter`, `tileKey`).
- **Day/night:** pure math in `src/systems/daynight.ts` (`phaseAt`, `tintAlphaAt`); scene state
  `this.dayPhase`/`this.clockMs`, `game.events` `'time:changed'`, registry `'dayPhase'`. Tunables in
  `config.ts:205-209`.
- **Lighting/vision ALREADY EXISTS** as a real-time (not persistent) system: `updateVision()`
  (~2202) fills a circle at the player into `this.fogShape` (a `Graphics`), which is an **inverted
  geometry mask** over a depth-5 `0x000000` alpha-0.2 dim rect (GameScene ~455-458) — so filled
  circles become *holes* (reveal). `inVisionRange(x,y)` (~2205) hides actors outside vision. The
  **night overlay** `this.nightOverlay` (created ~469, depth 15) is a single map-sized rect with
  **no mask** (fill alpha pinned at 1, opacity driven only by `setAlpha(tintAlphaAt(...))` —
  regression-prone, see commit `8b30725`). Reusable: `bakeGlowTexture` (`src/render/glowTexture.ts`)
  for a warm halo; `bakeVignetteTexture` for a soft disc. **No Phaser Lights2D / additive blend** is
  used anywhere — the established approach is masks + baked canvas textures.
- **Fire sprites exist but are NOT wired**: `public/assets/tilesets/pixel-crawler/Environment/
  Structures/Stations/Bonfire/` — cleanest is `Fire_01-Sheet.png` (128×48 = **4 frames of 32×48**,
  horizontal strip; loadable by the existing `loadStrip`). No texture key / anim registered.
  Manifest pattern: `TilesetManifest` (`src/data/tileset.ts:53-90`), `StripAnim` (38-44); preload
  `loadStrip` (`src/scenes/PreloadScene.ts:86-98`); anim registration in `GameScene.create()`
  (~386-417) via `anims.create({ ..., repeat: -1 })`.
- **World-object tracking:** GameScene fields `sites`, `walls` (StaticGroup), `occupied` (Set of
  `tileKey`), `siteTiles`; nodes anchored bottom & multi-tile-tall (`addNode` ~1506). Depth
  convention: world objects **depth 1**, fog dim rect 5, ghost 6, player 10, nightOverlay 15. A
  looping Phaser anim self-advances (no per-frame code needed for animation). No generic
  "structures with per-frame update" list exists — add `campfires: CampfireUnit[]`.
- **Tests (three-tier):** unit `src/**/__tests__/*.test.ts` (Vitest, no Phaser) — `daynight.test.ts`
  is the pure-helper template; `data.test.ts:69-104` already auto-covers new `BUILDABLES` entries
  (cost keys are real items, positive ints); `Inventory.test.ts:102` simulates a build spend. e2e
  `tests/e2e/*.spec.ts` (Playwright) over `window.game.__test`; `build.spec.ts` is the build
  template; `survival-daynight.spec.ts` / `glow.spec.ts` cover night/light. Seam: `ScenarioSpec`
  (~150-166) + `testApplyScenario` (~1925, walls via `finishSite(createBlueprint(...))`) +
  `debugState()` (~2079, already returns `nightAlpha`, `dayPhase`, `clockMs`); harness
  `DebugState` interface (`tests/e2e/harness.ts:10-38`).

**GameScene line numbers are approximate.** `src/scenes/GameScene.ts` is large and the line numbers
above are indicative only — every step touching it must **re-locate by symbol, not line number.**
(The plan-011 generic-monster work is already committed — `ca30c55` — and the working tree is clean,
so there is no in-progress work to clobber; its changes don't touch the build-path symbols this plan
edits. Earlier drafts warned of an uncommitted plan-011; that caveat is stale.)

## Steps

- [ ] **Step 1: Data & config foundation** `[delegate sonnet]`
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

- [ ] **Step 2: `isInBase` pure helper + unit test** `[delegate sonnet]` (parallel: A)
  - New `src/systems/base.ts` exporting `isInBase(col:number, row:number): boolean` that reads
    `BASE_ZONE` from `src/config.ts` and returns whether the tile is within the inclusive rectangle.
    Keep it Phaser-free and pure (mirror `src/systems/daynight.ts`). Also export a small
    `baseZoneTileRect()` (or the bounds) helper for any future outline rendering.
  - New `src/systems/__tests__/base.test.ts` mirroring `daynight.test.ts` structure: assert inside
    corners/centre true, just-outside each edge false, and a far tile false.
  - Side effects: none — new files only; depends on `BASE_ZONE` existing (Step 1).
  - Docs: none here.
  - Done when: `npm test` green including the new `base.test.ts`.

- [ ] **Step 3: Wire the campfire fire animation (asset manifest + preload)** `[delegate sonnet]` (parallel: A)
  - `src/data/tileset.ts` — register `Fire_01-Sheet.png` (path under
    `assets/tilesets/pixel-crawler/Environment/Structures/Stations/Bonfire/Fire_01-Sheet.png`,
    frameSize 32×48, 4 frames) as a looping station animation. Mirror the existing `StripAnim`
    (`actors`) shape and add a manifest slot for structures/stations if one doesn't exist; expose a
    key accessor mirroring `enemyWalkKey`/`playerAnimKey` (e.g. `campfireAnimKey()` returning
    `'campfire'`, matching the `animKey` used in Step 1).
  - `src/scenes/PreloadScene.ts` — load the sheet via the existing `loadStrip(key, strip)` path
    (uses `frameWidth ?? frameSize`; 32-wide frames slice correctly from the 128×48 horizontal strip).
  - Do **NOT** register the `anims.create` here — that lives in `GameScene.create()` and is done in
    Step 5 (avoids editing GameScene from a parallel step). This step only makes the texture load.
  - Side effects: `PreloadScene` loads one more asset; boot/smoke must still pass. The vertical
    `Bonfire.png` strip is unusable by the horizontal loader — **ignore it**, use `Fire_01-Sheet.png`.
  - Docs: note the newly-wired asset in `docs/ASSETS.md` (one terse line under stations).
  - Done when: the texture key loads without error on boot (`npm run dev` boots clean; smoke passes).

- [ ] **Step 4: Generalise the build path for multiple buildables + base-zone gate** `[inline]`
  - `src/scenes/GameScene.ts` (re-locate symbols; mind the plan-011 working-tree changes):
    - Add field `selectedBuildableId: string = 'wall'`.
    - `BuildSite` interface (~104): add `buildableId: string`.
    - `createBlueprint(col,row)` → `createBlueprint(col,row,buildableId)`, store it on the site.
    - `tilePlaceable(col,row)` → accept the target `def` (or read `BUILDABLES[selectedBuildableId]`);
      add `if (def.baseOnly && !isInBase(col,row)) return false;` (import from `src/systems/base.ts`).
      Treat missing `blocksPath` as `true` so the wall keeps blocking.
    - `updateGhost` / `placeOrEnqueueBuild`: use `BUILDABLES[this.selectedBuildableId]` for cost
      (`inv.canAfford`/`inv.spend`) and validity instead of the hardcoded `BUILDABLES.wall`.
    - `finishSite(site)`: branch on `site.buildableId`. `wall` (and any def **without** `animKey`) →
      current static-image path (`ACTIVE_TILESET.tiles[id]`) + static body + `occupied`. `campfire`
      (def **with** `animKey`) → delegate to the campfire materialiser added in Step 5 (for now,
      leave a clearly-marked hook/stub `materialiseCampfire(site)` that Step 5 fills in). Respect
      `def.blocksPath` for whether a static body + `occupied` entry is added.
    - Subscribe to a new `game.events` `'build:select'` (`{ id }`) → set `selectedBuildableId = id`
      and enter build mode; keep `build:toggle`/`build:modeChanged` working.
  - Side effects: `src/systems/stats.ts:18` references `BUILDABLES.wall` — verify it still resolves
    (leave as-is if generic). The `build` Action in `src/systems/tasks.ts` needs **no** change (it
    keys off `siteId`; the site now carries `buildableId`). Existing wall e2e (`build.spec.ts`) must
    still pass — default `selectedBuildableId='wall'` preserves current behaviour.
  - Docs: none here.
  - Done when: placing a wall still works end-to-end (existing `build.spec.ts` green); a campfire
    blueprint can be enqueued programmatically via the selected id and reaches the `finishSite` hook.

- [ ] **Step 5: Campfire runtime — unit, fuel, tap-to-feed, light + vision** `[inline]`
  - `src/scenes/GameScene.ts` (re-locate by symbol — line numbers indicative):
    - Register the looping campfire anim in `create()` (mirror existing `anims.create`, `repeat:-1`)
      using the key from Step 3.
    - Add `interface CampfireUnit { id:string; col:number; row:number; sprite:Phaser.GameObjects.Sprite;
      fuel:number; lit:boolean }` and field `campfires: CampfireUnit[] = []`.
    - Implement `materialiseCampfire(site)` (the Step-4 hook): create the animated sprite (bottom-
      anchored via `originY`, scaled to `tilesTall`, depth 1), play the campfire anim, add a static
      body + `occupied` entry (blocksPath), push a `CampfireUnit` with `fuel = CAMPFIRE_FUEL_MAX`,
      `lit = true`.
    - **Fuel drain** in `update(_,delta)`: for each campfire `c.fuel = Math.max(0, c.fuel -
      (delta/1000)*CAMPFIRE_FUEL_BURN_PER_SEC)`; `const wasLit = c.lit; c.lit = c.fuel > 0`. On
      lit→unlit stop the anim + dim the sprite (e.g. `setTint(0x555555)` / first frame); on unlit→lit
      resume anim + clear tint.
    - **Tap-to-feed — resolve in `onPointerUp`, `command` mode ONLY (NOT `onPointerDown`)** *(critique
      #1):* the order/harvest resolution lives in `onPointerUp` and the 3-mode input arbitration
      (command / combat / inspect) is settled architecture — feeding must live inside it, not bleed
      across modes. In `onPointerUp`, when the current mode is **command** and the pointer-up is a
      **short tap** (not a drag/pan — reuse the existing tap-vs-drag threshold), compute
      `worldToTile(pointer)`; if it matches a campfire's tile and `inv.get('wood') > 0`, then
      `inv.spend({ wood:1 })`, `c.fuel = Math.min(CAMPFIRE_FUEL_MAX, c.fuel + CAMPFIRE_FUEL_PER_WOOD)`,
      and **early-return before `actionAt`** so it doesn't also queue a move/harvest order. Do not
      alter combat/inspect arbitration. Optional: small floating "+wood" / spark feedback.
    - **Inspect coverage** *(critique #3):* add a `campfireStats` adapter and a `campfire` case to
      `inspectAt` so tapping a fire in **inspect** mode surfaces its stats (HP + current fuel / lit
      state), mirroring the existing `tree` / `site` cases — otherwise the fire is a dead object in
      inspect mode.
    - **Light + reveal (reuse existing mask pattern):**
      - *Reveal:* in `updateVision`, after the player circle, also `fillCircle` at each **lit**
        campfire (radius `def.light * TILE_SIZE`, i.e. `8*16=128`) into `this.fogShape` so the
        depth-5 dim rect is punched there. Generalise `inVisionRange(x,y)` to also return true when
        within any lit campfire's light radius, so enemies near the fire are **not** hidden.
      - *Night light:* give `this.nightOverlay` an **inverted geometry mask** sourced from a new
        `this.lightShape` `Graphics` (created once, alongside `fogShape`). Each frame clear it and
        `fillCircle` at each lit campfire (same radius). Mirror the fog mask exactly
        (`createGeometryMask()` + `setInvertAlpha(true)`). No lit campfires ⇒ empty shape ⇒ full
        night (unchanged). Do **not** touch the `nightOverlay` fill-alpha (keep it 1; opacity stays
        driven by `setAlpha` — see the `8b30725` regression).
      - Optional warm feel: bake a `COLORS.fireLight` halo via `bakeGlowTexture`/`bakeVignetteTexture`
        behind each fire — mark optional, skip if time-boxed.
  - Side effects: adding a mask to `nightOverlay` interacts with its existing `setAlpha` clock drive —
    verify night still darkens when no fire is lit, and that the lit hole tracks day/night alpha (the
    hole is only *visible* while the overlay is dark). Depth ordering: campfire sprite (1) sits under
    the nightOverlay (15); the mask cutout is what makes it readable at night. Confirm the fog reveal
    still centres on the player when no campfire exists, and that command-mode taps that are **not** on
    a fire still issue orders normally.
  - Docs: none here.
  - Done when: in `npm run dev` a built campfire animates; at night it clears darkness + reveals a
    circle around it; walking an enemy near a lit fire makes it visible; fuel visibly drains and the
    fire goes dark at 0; **in command mode, a short tap on the fire (wood in inventory) relights/
    refuels and decrements wood without issuing a move order**; tapping it in inspect mode shows its
    stats.

- [ ] **Step 6: Build menu / palette UI** `[inline]`
  - `src/scenes/UIScene.ts`: change the BUILD button to open a **palette Panel** listing every
    `BUILDABLES` entry (Wall, Campfire) using the existing UI kit (`Panel`, `Button`,
    `arrangeColumn`, `theme` from `src/ui/`). Each row shows the name + cost (e.g. "10🪨 10🪵" or text)
    and is **dimmed when `!inv.canAfford(def.cost)`** (read inventory from the registry as today).
    Selecting a row emits `game.events.emit('build:select', { id })` and closes the palette; GameScene
    (Step 4) enters build mode with that buildable. Pressing BUILD again / ESC closes/exits.
  - Depends on Step 4 (`build:select`) **and** Step 5 (the campfire materialiser now exists), so
    selecting Campfire builds a real, animated, light-emitting fire — no dead-spend window *(critique
    #5: runtime is sequenced before the palette that exposes it).*
  - Replace the current wall-specific affordability dimming (~UIScene:480-486) with per-row
    affordability in the palette; refresh rows on the inventory `'change'` event.
  - Side effects: `onBuildMode`/`build:modeChanged` reflection must still update the button state.
    Keep the palette above the HUD depth. Don't break the existing single-tap-to-build feel for walls
    (Wall is just the first palette row).
  - Docs: none here.
  - Done when: in `npm run dev`, BUILD opens a palette; picking Wall or Campfire enters build mode
    with the right ghost/cost and builds the correct structure; unaffordable rows are visibly dimmed.

- [ ] **Step 7: Test seam for campfires** `[inline]`
  - `src/scenes/GameScene.ts`: extend `ScenarioSpec` with `campfires?: Array<[number, number]>` (and
    optional `campfireFuel?: number`); in `testApplyScenario` place each by mirroring the wall path
    (`finishSite(createBlueprint(col,row,'campfire'))`, then set fuel if provided). Extend
    `debugState()` to return `campfires: this.campfires.map(c => ({ col:c.col, row:c.row,
    fuel:c.fuel, lit:c.lit }))`. Add a `game.events` debug hook `'debug:feedCampfire'` (`{ index }`)
    that runs the tap-feed logic, so an e2e can exercise refuelling deterministically.
  - **Placeability seam** *(critique #4):* add a DEV hook — `game.events` `'debug:tryPlace'`
    (`{ id, col, row }`) or a `window.game.__test.tryPlace(id,col,row)` method — that runs the **real**
    `tilePlaceable(col,row,def)` path (incl. the `isInBase` gate) and, if allowed, calls
    `placeOrEnqueueBuild`, recording whether placement was allowed (e.g. surfaced via `debugState`).
    This is required because `testApplyScenario` places campfires straight through
    `finishSite(createBlueprint(...))`, which **bypasses** `tilePlaceable`/`isInBase` — so without
    this seam the "blocked outside base" e2e (Step 8) has nothing to assert against.
  - `tests/e2e/harness.ts`: add the matching fields to the `DebugState` interface (10-38) and, if
    useful, small wrappers to read campfires / emit the feed + tryPlace events.
  - Side effects: `debugState` is DEV-only; ensure it stays cheap. Don't change existing fields.
  - Docs: none here.
  - Done when: `window.game.__test` exposes campfire scenario placement + `debugState().campfires`,
    verified via a quick `npm run dev` console poke or the Step-8 specs.

- [ ] **Step 8: Tests — unit + e2e** `[delegate sonnet]` (parallel: B)
  - Unit:
    - `src/data/__tests__/data.test.ts` — add a campfire-specific case: cost is exactly
      `{ stone:10, wood:10 }` and `light` is a positive number. (Generic invariants already cover it.)
    - `src/systems/__tests__/Inventory.test.ts` — mirror the wall build test with
      `spend({ stone:10, wood:10 })` (fund the inventory first, assert deduction + insufficient-funds
      rejection).
  - e2e (`tests/e2e/`, mirror `build.spec.ts` / `survival-daynight.spec.ts` / `glow.spec.ts`; use
    the Step-7 seam + `harness.ts` wrappers):
    - **Build in base:** place a campfire inside `BASE_ZONE` → blueprint then built campfire present
      in `debugState().campfires`.
    - **Blocked outside base:** via the Step-7 `debug:tryPlace` seam, try to place a campfire outside
      `BASE_ZONE` → placement rejected (records not-allowed, no site created, no spend), and a matching
      attempt **inside** the zone succeeds. (Pure `isInBase` logic is also unit-tested in Step 2.)
    - **Night light:** scenario with `startPhase:'night'` (or set `clockMs`) + a campfire → assert
      `nightAlpha > 0` yet the campfire is `lit`, and an enemy positioned within `light` radius is
      visible (mirror `glow.spec.ts`'s visibility assertions) while one outside stays hidden.
    - **Fuel drain / relight:** step the clock past `CAMPFIRE_FUEL_MAX / CAMPFIRE_FUEL_BURN_PER_SEC`
      seconds → campfire `lit:false`; emit `debug:feedCampfire` with wood funded → `fuel` increases,
      wood decremented, `lit:true`.
  - Side effects: may need a scenario fixture in `tests/e2e/scenarios.ts` (mirror `wallToRouteAround`).
    Keep specs deterministic (drive the clock, don't wait on wall-time).
  - Docs: none here.
  - Done when: `npm test` (unit) and the e2e suite are green.

- [ ] **Step 9: Docs — create `docs/GAME-MECHANICS.md` + index it** `[delegate sonnet]` (parallel: B)
  - **Create `docs/GAME-MECHANICS.md`** (no mechanics doc exists today — confirmed). Terse,
    high-signal, token-optimised. Sections:
    - *Buildables & build flow:* palette → place ghost (base-zone gate for `baseOnly`) → cost spent
      on placement → worker `build` task over `BUILD_MS` → materialise; buildables defined in
      `src/data/buildables.ts` (`BuildableDef`).
    - *Campfire:* cost 10 stone + 10 wood; base-zone only; **always burning once built**; fuel max
      120, burn 1/s, +30 per wood tapped, starts full; light + vision radius **8 tiles**; blocks
      path; **tap to feed wood**; dark at 0 fuel. All numbers cite `config.ts` constants.
    - *Base zone:* fixed rectangle `BASE_ZONE` in `config.ts` (tile bounds), **placeholder — expected
      to change** (dynamic/claimed base later); checked by `src/systems/base.ts` `isInBase`.
    - *Light/night interaction:* lit campfires cut inverted-mask holes in the night overlay + extend
      the vision reveal (`inVisionRange`); one-line pointer to docs/RENDERING.md for the mask
      technique.
  - Add a pointer in the **CLAUDE.md docs index**: `- [docs/GAME-MECHANICS.md](docs/GAME-MECHANICS.md)
    — tuned mechanics & numbers (costs, fuel, radii, base zone)`.
  - `docs/STATUS.md`: one line — plan 012 campfire + generalised build/palette landed.
  - `docs/DECISIONS.md`: two terse entries — (a) base zone is a **fixed rect for now**, will move to a
    dynamic/claimed base; (b) buildable selection via a **build palette** (chosen over cycle / per-
    buildable buttons).
  - Side effects: keep CLAUDE.md a lean index (one line only, per its own instruction).
  - Done when: `docs/GAME-MECHANICS.md` exists with the above, CLAUDE.md links it, STATUS/DECISIONS
    updated.

## Out of scope
- Worker-hauled refuelling / auto-refuel (chose tap-to-feed); proximity requirement for feeding
  (v1 feeds from the shared inventory on tap regardless of player distance).
- Any buildable beyond wall + campfire; a full buildable-category/tech system.
- Persistent fog-of-war (discovered-map memory) — the reveal here is the existing real-time vision
  circle, extended to the fire; nothing is "remembered" once out of range.
- Dynamic / player-claimed base zones, base-zone outline rendering while placing (optional nicety —
  drop if time-boxed), and gates/walls perimeter logic.
- Campfire secondary uses (cooking, warmth stat, morale) — light + vision only for v1.
- Additive/Lights2D lighting or a bespoke shader — reuse masks + baked textures per docs/RENDERING.md.

## Critique

*Independent fresh-eyes review (fresh sub-agent, uncontaminated by the planning conversation). All fixes below are already rolled into the steps above.*

**Verdict:** Solid, well-grounded plan — its riskiest technical bet (the inverted geometry mask on `nightOverlay`) holds up under source inspection, and every load-bearing factual claim checks out; cleared to execute after the tap-to-feed wiring + stale-caveat fixes, now applied.

|#|Finding|Severity|Resolution|
|-|-------|--------|----------|
|1|Tap-to-feed was placed in `onPointerDown` with an early-return, but order resolution lives in `onPointerUp` and was gated only on `!buildMode` — it would bleed into Combat/Inspect and fail to suppress the order.|Medium|✅ Step 5: resolved in `onPointerUp`, `command` mode only, as a short tap checked before `actionAt`.|
|2|The ⚠️ working-tree caveat was stale — tree is clean, plan-011 already committed (`ca30c55`), and its changes don't touch the build symbols.|Low|✅ Caveat corrected (re-locate by symbol; no in-progress work to clobber).|
|3|Campfire wasn't wired into Inspect — `inspectAt` only handled `tree`/`site`, so a fire was a dead object in inspect mode.|Low|✅ Step 5: added a `campfireStats` adapter + `campfire` inspect case.|
|4|"Blocked outside base" e2e had no seam — `testApplyScenario` places fires via `finishSite(createBlueprint(...))`, bypassing `tilePlaceable`/`isInBase`.|Low|✅ Step 7: added a `debug:tryPlace` placeability seam; Step 8 asserts rejection through it.|
|5|The palette (which exposes Campfire) preceded the materialiser, leaving a window where building a fire spent 20 resources into a no-op stub.|Low|✅ Reordered: campfire runtime is now Step 5, palette Step 6.|
|6|Campfire is sequenced ahead of CLAUDE.md's named "Next" (enemy night-waves + equipment queue).|Low|Kept by design — a fire that reveals approaching enemies is a natural precursor to night-waves; strong pillar fit. Owner's call.|

No High-severity findings — nothing blocked execution.
