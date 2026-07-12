# Day/Night Cycle + Hunger (Survival Slice)

> Status: **replanned 2026-07-12** (plan-feature rerun) — anchors re-verified against current
> `master`; scope updated for plans 005–010 landing since the first draft. Gate 1: Matt reviews this
> before `/critique-plan`. Do NOT execute yet.

## Replan note — what changed since the first draft (why this was re-planned)

The original plan 004 was written against post-combat `master` (plan 003). Plans **005–010** have
since landed or been written, and three of them reshape this slice. Confirmed with Matt on the rerun:

- **Plan 008 (inventory stacking) shipped a real inventory UI.** `Inventory` is now **slot/stack-backed**
  (`bag: Slot[]`, `maxStack`, spill, can fill up), `ItemDef` already carries `icon` + `maxStack`,
  `ResourceNodeDef` already uses **`yieldItemId`/`yieldPerHit`** (the old plan's Step 4 rename is
  *done*), a **stone item + rock node already exist** (the "add a node" template is proven), and there
  is already a **full `INVENTORY` grid `Panel` + a bottom hotbar** (`src/ui/SlotGrid.ts`) plus a UI kit
  (`src/ui/`: `Button`, `Panel`, `arrangeRow/Column/Grid`, `theme`). **→ The old Step 7 "Inventory +
  Equipped overlay" is dropped.** Matt's call: **reuse plan 008's `INVENTORY` panel** as the inventory
  view; build the new survival screen on the **UI kit `Panel`**, not hand-rolled rects.
- **Equipment (plan 010) is now its own written plan**, deferred to run *after* this slice. Matt's call:
  **drop the empty "Equipped" display shell** from this slice entirely — plan 010 owns all equipment UI
  (this also kills the "empty UI nothing consumes" smell 010's own critique flagged).
- **The map was doubled** (`MAP_WIDTH/HEIGHT = BASE_* × 2`; camera scrolls). The old plan's night-tint
  reasoning ("world is base-sized, so a world-space rect covers the viewport") is stale — but the **fog
  dim rect is already sized to `MAP_WIDTH×MAP_HEIGHT`**, so the night tint just mirrors *that* (map-sized,
  higher depth), not a base-sized rect.
- **The test harness is now three-tier** (plan 007). The old plan wired everything into `smoke.mjs`;
  that's retired for deterministic assertions. **→ Pure systems get Tier-1 unit tests; behaviour gets
  Tier-2 Playwright scenarios** via `window.game.__test` (`applyScenario`/`step(ms)`); Tier-3 `smoke`
  stays a boot canary only.
- **New, added by Matt on the rerun:** a **player "gathering" animation** — the pack ships a
  `Collect_Base` strip set (8 frames × 64px, Down/Side/Up — same rig as chop/Slice). Foraging the berry
  bush plays this **gather** anim instead of the chop swing.

Everything else in the original locked scope **still holds** (real-time clock + tint + phase/day state;
hunger→starvation→health cascade via combat's `damagePlayer`/`playerHp`; forageable berry bush + edible
berries; Health & Wellbeing screen with meters + stats + eat list; night = tint+phase only, no waves;
nothing persisted).

## Summary

The survival slice from GAME-DESIGN.md's MVP item 4 and the day/night pillar. Adds a **real-time
day/night clock** that auto-advances every frame, drives a full-screen **darkening tint** that smoothly
cross-fades across dawn/dusk, and exposes a readable **phase state** (`day`/`night`) + **day count**
other systems can query. Adds the **hunger** core need: a meter that ticks down with time and — at zero
— **starves the player**, draining the combat-owned health (plan 003) through its existing
`damagePlayer`/`scene.restart()` death path. Food enters the world as a new **edible `berries` item**
foraged from a new **berry-bush node** — a *walkable* resource node that reuses the tree/rock harvest
machinery but plays a new player **gather animation** (`Collect_Base`). Eating happens through a new
**Health & Wellbeing screen** — an in-HUD `Panel` (UI kit) showing the hunger + health meters, the
player's **stats** (combat's `CombatantStats`), and a "what's available to eat" list you tap to consume.
The **inventory view is plan 008's existing `INVENTORY` panel** (unchanged, not duplicated). Night is
**tint + phase only** this slice — no enemy spawning (waves layer on later via the phase state). Nothing
is persisted; all survival state resets on reload.

## Context & decisions

**Locked with Matt (do NOT re-litigate):**
- **Time model:** fixed real-time loop (continuous auto-advancing cycle, smooth tint). A production-speed
  cycle is untestable via wall-clock, so tests drive it through the **deterministic Tier-2 `step(ms)`
  API** (extend `ScenarioSpec` + `debugState()`), not `waitForTimeout`.
- **Night scope:** darkening tint + queryable phase state only. **No enemy waves this slice.**
- **Health:** builds on **plan 003 (combat), executed & on `master`**. Current in-code contract
  (re-verified): `private playerStats!: CombatantStats` (`GameScene.ts:170`, populated `:267-276`);
  `private playerHp` (`:171`, set to `playerStats.maxHp` at `:277`); `damagePlayer(amount)`
  (`:894-901` — clamps HP, emits `player:hpChanged { hp, maxHp }` at `:896`, and on `hp<=0` calls
  `this.scene.restart()`; no game-over screen, no save). **Starvation routes damage through
  `damagePlayer(...)`**, reusing that exact death path. `debugState()` (`:1447`) already returns
  `playerHp` (`:1472`) — tests read HP from there. `player:hpChanged` is emitted but **has no UI
  consumer yet** — the Wellbeing screen is its first. `playerStats` is a **private field, not on the
  registry** → GameScene must `registry.set('playerStats', this.playerStats)` (Step 8) for the stats
  rows.
- **Food source:** a new edible item (`berries`) **and** a forageable berry-bush node.
- **Persistence:** **runtime-only, none this slice.** No `localStorage` survival save (only `zoom`
  persists today). Real persistence lands with a full save system later.
- **Eat UX:** a **Health & Wellbeing screen** (not a bare eat button): meters for hunger + health, the
  player's **stats** (`playerStats`: maxHp/armour/speed/vision/strength/dex/dodge), and an edible-items
  list; tap an item to eat one unit.
- **Inventory UI:** **reuse plan 008's existing `INVENTORY` `Panel` + hotbar** — do **not** build a new
  inventory overlay. **No "Equipped" section** this slice (deferred to plan 010).
- **Gather animation:** wire the pack's `Collect_Base` strip as a new `gather` player state; play it
  while foraging a bush (bushes gather; trees/rocks chop).

**Codebase seams (anchors re-verified on the rerun; reconfirm the exact line before editing):**

- **Tick seam:** `GameScene.ts` `override update(_time, delta)` (**`:414`**; `time` unused, `delta` ms
  only). Structure: `:415` resets `this.chopping=false`, `:416` `syncGlowTransforms()`, `:417`
  `const action = this.queue.current`, `:418-426` **idle early-return branch** (no action → zero
  velocity + `updatePlayerAnim`/`updateVision`/`updateZombies` → `return`), `:427-437` switch
  (`move`/`harvest→runHarvest`/`build→runBuild`), `:438-440` tail. **Per-frame survival ticks (clock
  advance, hunger drain) must run whether or not a worker task is active → hoist them ABOVE the
  `if (!action)` at ~`:417`.** Accumulator precedent to mirror: `chopElapsed` (`:198`) in `runHarvest`
  (`:731-751`, `chopElapsed += delta; if >= CHOP_INTERVAL_MS { reset; chop() }` at `:746-749`);
  `site.progress` in `runBuild` (`:759-763`). **Large-delta guard:** on tab-refocus Phaser can hand a
  big `delta`; clamp the hunger drain to `[0,max]` and bound the starvation `while`-loop (decrements
  each iteration).
- **Night-tint precedent (the fog dim):** `create()` `:346` —
  `this.add.rectangle(MAP_WIDTH/2, MAP_HEIGHT/2, MAP_WIDTH, MAP_HEIGHT, 0x000000, 0.2).setDepth(5)
  .setMask(fogMask)`. The fog rect is **map-sized** (covers the whole scrollable world) at **depth 5**,
  masked to the vision hole. The night overlay **mirrors its size/centre** (`MAP_WIDTH×MAP_HEIGHT`,
  centred on the map — camera scrolls, so map-sized is correct) but: **no mask** (global dim), and a
  **higher depth so it dims actors too**. Depth map (current): ground 0, nodes/blueprints/walls 1,
  move-pips 4, fog 5, build-ghost 6, zombie 9, player 10. A global night dim sits at **depth 15**
  (above the player). **No `setInteractive`** (plain rects don't intercept pointers — keep it so).
  HUD stays bright (UIScene is a separate camera on top). Alpha-ramp model: `setAlpha(...)` per frame.
- **Inventory** (`src/systems/Inventory.ts`, plan-008 slot model): `bag: Slot[]` (`:39`,
  `Slot = {id,count}|null`), ctor `{capacity, maxStackOf}`. Methods: `get` `:48`, `add` `:61`,
  `canAccept` `:90`, `has` `:103`, `canAfford` `:108`, `spend(cost)` `:116`, `snapshot()` `:137`
  (→ `Record<string,number>` aggregate counts; **`spend` clears emptied slots — no lingering `0`
  keys**), `slots()` `:146`. Emits `'change'` with `snapshot()` after mutations (`:85/:132`). **There
  is no `remove` method — eating uses `spend({ [id]: 1 })`** (atomic across slots; returns whether it
  succeeded — confirm the return and guard with `canAfford` first). Config: `INVENTORY_SLOTS=20`,
  `HOTBAR_SLOTS=5`, `DEFAULT_MAX_STACK=50` (`config.ts:50-54`). Unit test lives at
  `src/systems/__tests__/Inventory.test.ts`.
- **Items/nodes/types:** `ItemDef` (`types.ts:7-15`) = `{id,name,color,maxStack,icon}` — **already has
  `icon`+`maxStack`; add `nutrition?: number`** (present ⇒ edible; hunger restored per unit). `ITEMS`
  (`items.ts:7-10`) has only `wood`,`stone` (both `maxStack:50`, `.png` icons). `ResourceNodeDef`
  (`types.ts:59-81`) = `{id,name,yieldItemId,yieldPerHit,regrowMs,color,stumpColor,tile:'tree'|'rock',
  tilesTall,originX,originY,standOffsets?}` — **uses `yieldItemId` (not `woodItemId`); has no
  `blocksPath`.** `NODES` (`nodes.ts:24-59`) has `tree`,`rock`. `tile` is a union `'tree'|'rock'`
  (`:70`) referencing tileset manifest `tiles` (`tileset.ts:47-56`) → a bush sprite needs the union +
  a manifest tile extended. Icons load as `icon:<id>` via `iconKey` (`tileset.ts:163`).
- **Harvest lifecycle (the forage template):** live nodes block their tile in `isBlocked`
  (`:446-447`, `t.alive && t.col===col && t.row===row` — **every live node blocks; no per-def
  opt-out today**). `runHarvest` (`:731-751`) accumulates then `chop()` does `hp-=1` +
  `this.inv.add(node.def.yieldItemId, node.def.yieldPerHit)` (the item-into-bag line to mirror) +
  stump tint on depletion + `time.delayedCall(regrowMs, …)` to regrow. Worker stands **adjacent** via
  `reachableAdjacent` (`:403` in original; reconfirm), never on the target tile. **Full-bag guard:**
  harvest aborts if the bag can't accept (plan 008, guarded in `beginCurrent`+`runHarvest`) — berries
  inherit this for free.
- **Player anim:** `PlayerState = 'idle'|'walk'|'chop'|'punch'` (`tileset.ts:21`); player actor strips
  `tileset.ts:100-123` (`render` `:101` = `{scale:1, originX:0.5, originY:0.78}`); anim-create loop
  `GameScene.ts:295-305` (`generateFrameNumbers`, `frameRate: isAction ? ACTION_ANIM_FRAMERATE(20) :
  10`); `updatePlayerAnim` `:490-493` (`state = chopping ? 'chop' : moving ? 'walk' : 'idle'`);
  `chopping` boolean flag (`:201`) set true in `runHarvest` while felling in place (`:744`), reset each
  frame (`:415`); one-shot `playPunchSwing()` `:500`. `Collect_Base` strips confirmed present:
  `Entities/Characters/Body_A/Animations/Collect_Base/Collect_{Down,Side,Up}-Sheet.png`, **8 frames ×
  64px** each (same as Slice/chop). `playerAnimKey(state,facing)` `:157`.
- **UIScene HUD** (`UIScene.ts`, `BASE_WIDTH=360 × BASE_HEIGHT=640`, UI kit in use `:19`): BUILD `:102`,
  build indicator `:111`, CANCEL `:124`, **ITEMS (inventory toggle)** `:137`, queue text `:147`,
  zoom row `:154-171`, FOLLOW `:180`, COMBAT+INSPECT toggles `:194-208`, combat movepad `:213-224`,
  PUNCH `:227`, **inspect stats `Panel`** `:239-249` (depth 20, dismissible), **inventory `Panel` +
  `SlotGrid`** `:295-305` (depth 20, dismissible, ITEMS-toggled), hotbar `SlotGrid` `:286-289`
  (hidden in combat). `hudElements` `:81` + `hudHitTest` `:332` (visible-only) — every interactive
  widget must be pushed. Registry read: `inventory` `:88`, `zoom` `:161`, `following` `:179`. Events
  subscribed `:310-316` (`build:modeChanged`,`tasks:changed`,`zoom:changed`,`camera:followChanged`,
  `mode:changed`,`inspect:show`,`inspect:hide`, + `inv 'change'`); **SHUTDOWN teardown** — every `.on`
  needs a matching `.off`. `Panel.addText(y, style)` adds centred rows; `SlotGrid`/`itemVisual(id)`
  (`:337`) render item **icons** (fallback colour swatch) — reuse for the edible list. **Reuse `Panel`
  for the Wellbeing screen** (same shape as the inspect/inventory panels). **No bar widget exists** —
  build a simple two-rect meter (bg rect + fg rect whose width scales with the value), like `site.rect`
  width feedback.
- **Cross-scene comms:** `registry` for initial-state reads; `game.events` for live updates. GameScene
  setters write **both** (`registry.set` + `emit('*:changed')`) so a scene restart re-seeds — mirror for
  new state (`dayPhase`,`dayCount`,`hunger`,`playerStats`). GameScene game-event handlers registered
  `:368-377` / torn down `:382` (e.g. `debug:regenTrees`) — the register/teardown block for a
  `needs:eat` listener.
- **Debug + tests:** only `debug:regenTrees` exists today (`:370`, method `:1083`). `debugState()`
  (`:1447-1478`) returns `{…, playerHp, mode, …}` — **add `hunger`, `dayPhase`, `dayCount`, `clockMs`**.
  `window.game.__test` (DEV-only, `:397-411`): `applyScenario(spec)`, `step(ms)` (fixed 1/60 s slices,
  zero wall-clock, `:1428`), `state()→debugState()`, `order/enqueue/inspect/blocked`; `ScenarioSpec`
  `:123-135` (player/facing/mode/wood/inventory/trees/rocks/zombies/walls/blueprints/rng) — **extend
  with `hunger?`, `startPhase?`/`clockMs?`, `bushes?`**. Tier-1 unit specs live beside systems in
  `src/systems/__tests__/*.test.ts`; Tier-2 scenarios in `tests/e2e/*.spec.ts` (+ `harness.ts`,
  `scenarios.ts`); Tier-3 `scripts/smoke.mjs` = boot canary (fails on any console error; no gameplay
  assertions — keep it green).
- **Config** (`config.ts`): `TILE_SIZE=16` (`:47`), `BASE_WIDTH=360/BASE_HEIGHT=640` (`:11-12`),
  `MAP_WIDTH=BASE_WIDTH*2 / MAP_HEIGHT=BASE_HEIGHT*2` (`:43-44`), `PLAYER_MAX_HP=10` (`:97`),
  `ACTION_ANIM_FRAMERATE=20`, `CHOP_INTERVAL_MS=400` (`:60`), `COLORS` palette `:115-123`. **No
  `DAY_MS/NIGHT_MS/HUNGER_*` yet** — all net-new here.

**Direction (README / GAME-DESIGN / DECISIONS):** mobile-first portrait touch, data-driven catalogs,
systems decoupled from Phaser (pure `src/systems/`), UI decoupled via `UIScene` + the `src/ui/` kit,
trunk-based on `master`, programmatic/placeholder art first. Hunger is a **core** Don't-Starve-style
pressure (constant, punishes hoarding); the Health & Wellbeing screen + "what's available to eat" are
stated design intent — this slice builds the first cut of both.

## Steps

- [ ] **Step 1: Day/night pure system + config + unit tests** `[delegate sonnet]`
  - New Phaser-free module `src/systems/daynight.ts` (alongside `tasks`/`pathfind`/`grid`):
    `export type DayPhase = 'day' | 'night'`; `cycleLengthMs()` = `DAY_MS + NIGHT_MS`;
    `phaseAt(cycleMs)` → `day` while `cycleMs < DAY_MS`, else `night`; `tintAlphaAt(cycleMs)` → `0`
    through the day, ramping to `NIGHT_MAX_ALPHA` at deep night, **cross-fading over `TWILIGHT_MS`** at
    each boundary (dusk: ramp `0→NIGHT_MAX_ALPHA` over the last `TWILIGHT_MS` of day; dawn: ramp
    `NIGHT_MAX_ALPHA→0` over the first `TWILIGHT_MS` of day); `dayCountForTotal(totalMs)` =
    `Math.floor(totalMs / cycleLengthMs()) + 1` (day 1 at t=0). **Pure of Phaser and of module-level
    mutable state — pass every value in.**
  - `config.ts`: add `DAY_MS = 120_000`, `NIGHT_MS = 90_000`, `TWILIGHT_MS = 8_000`,
    `NIGHT_MAX_ALPHA = 0.55`, and to `COLORS` add `night: 0x0a1020`. Tune-by-feel defaults (like the
    combat numbers) — pick these.
  - Tier-1 unit test `src/systems/__tests__/daynight.test.ts` (vitest, plain Node): `phaseAt` either
    side of the `DAY_MS` boundary; `tintAlphaAt` = 0 mid-day, `NIGHT_MAX_ALPHA` mid-night, and monotonic
    partial values across the twilight windows (assert the dusk/dawn endpoints + a midpoint);
    `dayCountForTotal` = 1 at 0, 2 after one full cycle.
  - Side effects: none (new module + config only; nothing imports it yet).
  - Docs: none (Step 11).
  - Done when: `npm test` green; the pure functions behave at day/night/twilight boundaries.

- [ ] **Step 2: Day/night clock + night tint overlay (GameScene)** `[inline]`
  - Fields: `private clockMs = 0`, `private dayPhase: DayPhase = 'day'`, `private dayCount = 1`,
    `private nightOverlay!: Phaser.GameObjects.Rectangle`.
  - In `create()`, after the fog overlay (`:346`), build the night rect **mirroring the fog rect's
    size/centre but map-sized, unmasked, higher depth**: `this.nightOverlay = this.add.rectangle(
    MAP_WIDTH/2, MAP_HEIGHT/2, MAP_WIDTH, MAP_HEIGHT, COLORS.night, 0).setDepth(15)`. **No `setMask`,
    no `setInteractive`.** Seed `registry.set('dayPhase','day')` / `set('dayCount',1)`.
  - At the **TOP of `update(_time, delta)`, above the `if (!action)` early-return (`~:417`)**:
    `this.clockMs += delta`; `const cycleMs = this.clockMs % cycleLengthMs()`;
    `this.nightOverlay.setAlpha(tintAlphaAt(cycleMs))`; compute `phaseAt(cycleMs)` +
    `dayCountForTotal(this.clockMs)`; when either differs from the stored field, update it,
    `registry.set('dayPhase'/'dayCount', …)` and `emit('time:changed', { phase, dayCount, cycleMs,
    tNorm: cycleMs / cycleLengthMs() })`.
  - Side effects: one always-per-frame `setAlpha` (negligible). Confirm the rect stays non-interactive
    (never eats pointers) and sits below `UIScene`. A dimmed build-ghost (depth 6) at night is fine.
  - Docs: none (Step 11).
  - Done when: `npm run build` green; running the game visibly darkens toward night and lightens toward
    day on a loop; `debugState()` (extended Step 10) will expose `clockMs`/`dayPhase`/`dayCount`.

- [ ] **Step 3: Day/night HUD readout (UIScene)** `[delegate sonnet]`
  - `UIScene.ts`: add a **passive** readout (plain text, **not** pushed to `hudElements`) showing phase
    + day, e.g. `Day 1 ☀` / `Day 1 ☾` (ASCII fallback `Day 1 [day]`/`[night]` if the glyph renders
    poorly at 12px). Place it in free space top-centre-ish (below the zoom row / above the build
    indicator — pick a slot that doesn't overlap existing widgets at 360px wide). Seed from
    `registry.get('dayPhase') ?? 'day'` + `get('dayCount') ?? 1` in `create()`.
  - Subscribe to `time:changed` in the listener block (`:310-316`), update the text in the handler,
    **add the matching `.off` in the SHUTDOWN block**.
  - Side effects: one more HUD element — verify no overlap with zoom/follow/build widgets.
  - Docs: none (Step 11).
  - Done when: build green; the readout flips day→night→day and increments the day each full cycle.

- [ ] **Step 4: Hunger pure system (needs.ts) + config + unit tests** `[delegate sonnet]`
  - New Phaser-free module `src/systems/needs.ts`: `drainHunger(current, deltaMs, drainPerSec, max)` →
    `clamp(current - drainPerSec*deltaMs/1000, 0, max)`; `feed(current, nutrition, max)` →
    `Math.min(max, current + nutrition)`; `isStarving(hunger)` → `hunger <= 0`.
  - `config.ts`: add `HUNGER_MAX = 100`, `HUNGER_DRAIN_PER_SEC = 0.4` (≈250 s full→empty, ~1.5 cycles;
    tune by feel), `STARVE_DAMAGE = 1`, `STARVE_DAMAGE_INTERVAL_MS = 2_000` (1 HP / 2 s while starving).
  - Tier-1 unit test `src/systems/__tests__/needs.test.ts`: `drainHunger` clamps at 0 for a huge
    `deltaMs` (large-delta guard) and never exceeds `max`; `feed` caps at `max`; `isStarving` true only
    at `<= 0`.
  - Side effects: none (new module + config; no caller yet — wired Step 8).
  - Docs: none (Step 11).
  - Done when: `npm test` green with the new needs specs.

- [ ] **Step 5: Forageable food — `berries` item + berry-bush node** `[inline]`
  - **Item:** `types.ts` — add `nutrition?: number` to `ItemDef` (optional, so `wood`/`stone` stay
    valid). `items.ts` — add `berries: { id:'berries', name:'Berries', color:0x7a2f4a, maxStack:50,
    icon:'berries.png', nutrition:25 }`. Add a **32×32 placeholder `berries.png`** under the same icons
    dir as `wood.png`/`stone.png` (match plan 008's placeholder convention; real art is plan 009's
    Gemini pipeline — do not block on it) and confirm it loads (Preload icon loop keys off `ITEMS`).
  - **Node def:** `types.ts` — add `blocksPath: boolean` and `harvestAnim?: 'chop' | 'gather'`
    (default `'chop'`) to `ResourceNodeDef`; extend the `tile` union to `'tree' | 'rock' | 'bush'`.
    `tileset.ts` — add a `bush` entry to the manifest `tiles` (`:47-56`) with a **placeholder sprite**
    (solid-colour rect/image the way a node without staged art is handled — mirror how `rock`/`tree`
    obtain their texture).
  - **Node data:** `nodes.ts` — add `berryBush: { id:'berryBush', name:'Berry Bush', yieldItemId:
    'berries', yieldPerHit:2, regrowMs:20_000, maxHp:1, blocksPath:false, harvestAnim:'gather',
    tile:'bush', color:<berry-green>, stumpColor:<picked>, tilesTall/originX/originY:<bush-sized,
    ~1 tile> }` (single-pick `maxHp:1`; include whatever inert stat/render fields the tree/rock entries
    carry — copy their shape).
  - **GameScene wiring:** honour `def.blocksPath` in `isBlocked` (`:446-447`) — gate the "node blocks
    this tile" test on `t.def.blocksPath` so a bush blocks **neither routing nor build-placement**;
    **audit every other `this.<nodes>.some/find/filter` site** (build-placement check, harvest
    hit-test) and gate on `blocksPath` where it means "obstacle". Spawn berry bushes at **fixed,
    deterministic tiles** (mirror the tree/rock spawn) — Tier-2 tests place/tap known bush tiles, so
    coords must be stable, not random. Prefer generalising to the existing node array/pipeline (bushes
    reuse `addTree`/`runHarvest`/`chop` unchanged, differing only by `def`); if that balloons, add a
    parallel array reusing the identical functions and note the duplication.
  - Side effects: making a node non-blocking touches **routing and build-placement** — verify (a) the
    worker routes **through** bush tiles, (b) it still harvests from a **reachable-adjacent** tile
    (`reachableAdjacent`), never on the target, (c) building over a bush tile is allowed and doesn't
    crash placement. Regrow reuses `delayedCall(regrowMs)`. Full-bag guard (plan 008) applies for free.
  - Docs: none (Step 11).
  - Done when: build green; tapping a bush routes the worker **through** other bush tiles (unlike
    trees), stands adjacent, harvests `berries` into the bag, depletes then regrows; building over a
    bush tile is permitted; `berries.png` loads without a console error.

- [ ] **Step 6: Player gathering animation (`Collect_Base`)** `[inline]`
  - `tileset.ts`: add `'gather'` to `PlayerState` (`:21`); add `gather: Record<Facing, StripAnim>` to
    the player actor pointing at `Entities/Characters/Body_A/Animations/Collect_Base/Collect_{Down,
    Side,Up}-Sheet.png`, `frameSize:64, frames:8` (verified) — mirror the `chop` block exactly. Update
    the `PlayerState` doc comment to note gather = in-place forage loop.
  - `GameScene.ts`: the anim-create loop (`:295-305`) iterates `PlayerState`, so `gather` anims build
    automatically — confirm its frameRate: treat it as a locomotion-style loop (`frameRate 10`) or a
    calmer action; pick one and keep it looping while foraging. Add a `gathering` flag mirroring
    `chopping` (`:201`, reset each frame `:415`): in `runHarvest`, set `this.gathering = true` (instead
    of `chopping`) when `action`'s node `def.harvestAnim === 'gather'`, else `this.chopping = true`.
    In `updatePlayerAnim` (`:490-493`), pick the in-place state: `gathering ? 'gather' : chopping ?
    'chop' : moving ? 'walk' : 'idle'` (gather/chop are mutually exclusive per frame).
  - Side effects: only the player render/anim path; trees/rocks keep chopping (`harvestAnim` defaults
    `'chop'`). Verify facing (Down/Side/Up + left-mirror via `flipX`) matches the chop path.
  - Docs: none (Step 11).
  - Done when: build green; foraging a bush plays the gather animation in the correct facing while the
    worker picks in place; chopping a tree/rock still plays the chop swing.

- [ ] **Step 7: Hunger wiring in GameScene (drain, starvation→health cascade, eat, stats registry)** `[inline]`
  - Fields: `private hunger = HUNGER_MAX`, `private starveElapsed = 0`. Seed `registry.set('hunger',
    HUNGER_MAX)` and `registry.set('playerStats', this.playerStats)` in `create()` (the latter surfaces
    combat's private stats for the Wellbeing rows).
  - At the **top of `update()`** (next to the Step 2 clock advance, above the early-return): drain
    `this.hunger = drainHunger(this.hunger, delta, HUNGER_DRAIN_PER_SEC, HUNGER_MAX)`; when the rounded
    displayed value changes, `emit('hunger:changed', { hunger: this.hunger, max: HUNGER_MAX })` +
    `registry.set('hunger', this.hunger)`. Starvation accumulator (mirrors the chop-interval idiom):
    `if (isStarving(this.hunger)) { this.starveElapsed += delta; while (this.starveElapsed >=
    STARVE_DAMAGE_INTERVAL_MS) { this.starveElapsed -= STARVE_DAMAGE_INTERVAL_MS;
    this.damagePlayer(STARVE_DAMAGE); } } else { this.starveElapsed = 0; }` — `damagePlayer` is plan
    003's method; integer damage keeps HP whole and reuses 003's `scene.restart()` death path (a fully
    starved player dies over time; restart re-inits `hunger = HUNGER_MAX` since it's a `create()`
    field).
  - Add `eat(itemId: string): boolean`: if `ITEMS[itemId]?.nutrition == null` **or**
    `!this.inv.canAfford({ [itemId]: 1 })` return `false`; else `this.inv.spend({ [itemId]: 1 })`
    (**use `spend` — there is no `remove`**), `this.hunger = feed(this.hunger, ITEMS[itemId].nutrition!,
    HUNGER_MAX)`, emit `hunger:changed` + `registry.set('hunger', …)`, return `true`. Wire a
    `needs:eat { itemId }` `game.events` listener in the register/teardown block (`:368-382`) calling
    `this.eat(itemId)` (matches the existing event-in pattern; Step 9's UI emits it).
  - Side effects: hunger ticks every frame regardless of worker state (above the early-return).
    Large-delta safety: `drainHunger` clamps and the `while` is bounded, so a big refocus `delta` at
    most deals a capped burst. `nutrition` (Step 5) exists so `eat` can read it.
  - Docs: none (Step 11).
  - Done when: build green; hunger falls over time (visible via Step 9 or `debugState`); forcing hunger
    to 0 ticks `playerHp` down every 2 s and eventually triggers 003's restart; `eat` raises hunger and
    spends one berry.

- [ ] **Step 8: Health & Wellbeing screen (UI-kit `Panel`: meters + stats + "what's available to eat")** `[inline]`
  - `UIScene.ts`: add a **STATUS** button (interactive `Button` from the kit, pushed to `hudElements`)
    in a free slot (e.g. near the ITEMS button / left column — avoid the combat movepad + Punch
    corners), toggling a new **Wellbeing `Panel`** (reuse the `Panel` primitive like the inspect/
    inventory panels — depth 20, `dismissible`). One overlay open at a time is the kit's existing
    behaviour; follow the inventory-panel toggle pattern. Panel body:
    - **Hunger meter:** label + a two-rect bar (bg rect + fg rect, `width = barWidth * hunger /
      HUNGER_MAX`; amber, turning red when `isStarving`/near-zero). Seed from `registry.get('hunger')
      ?? HUNGER_MAX`; live-update on `hunger:changed`.
    - **Health meter:** same two-rect bar. Seed lazily from `registry.get('playerStats').maxHp` (HP
      isn't on the registry — only `playerStats` is) and fill from the first `player:hpChanged { hp,
      maxHp }` event (the Wellbeing screen is this event's **first consumer**).
    - **Player stats:** read-only `label: value` rows from `registry.get('playerStats')` (maxHp,
      armour, speed, vision, strength, dex, dodge) — **reuse the inspect-panel stats display shape**
      (`Panel.addText`, mirroring `treeStats`/`zombieStats` rendering). Static this slice — read once.
    - **"What's available to eat":** iterate `ITEMS` for `nutrition != null`; render each with its live
      count (`this.inv.get(id)`) + nutrition, reusing `itemVisual(id)`/icon rendering. Each row
      interactive (kit `Button`) — tapping emits `needs:eat { itemId: id }` **only when count > 0**;
      count-0 rows render disabled/greyed. Refresh counts on the Inventory `'change'` event (subscribe
      to the instance like `refreshInventory`) and on `hunger:changed`.
  - **Teardown:** every new `.on` (`hunger:changed`, `player:hpChanged`, Inventory `'change'`) gets a
    matching `.off` in the UIScene SHUTDOWN block. While open, the panel's interactive rows/backdrop
    stay in `hudElements` (visibility-aware `hudHitTest` already ignores hidden ones when closed).
  - Side effects: reuses the existing `Panel` modal path (inspect/inventory already do this), so
    world-tap gating is proven — just confirm the STATUS button and edible rows are registered in
    `hudElements`. Verify layout within 360×640 and thumb-reachability.
  - Docs: none (Step 11).
  - Done when: build green; STATUS opens the screen with live hunger + health bars, the stat rows, and
    an edible list; tapping Berries (count>0) decrements the count, raises the hunger bar; bars track
    live as hunger drains and HP changes.

- [ ] **Step 9: Debug hooks + deterministic Tier-1/Tier-2 test coverage** `[inline]`
  - **`debugState()`** (`:1447-1478`): add `hunger`, `dayPhase`, `dayCount`, `clockMs` to the returned
    snapshot (leave `playerHp` — already there).
  - **Scenario API for deterministic drive:** extend `ScenarioSpec` (`:123-135`) with `hunger?: number`,
    a start-of-cycle control (`clockMs?: number` **or** `startPhase?: DayPhase`), and `bushes?:
    Array<{col,row}>`; have `applyScenario` seed `this.hunger`/`this.clockMs` and spawn bushes at the
    given tiles (mirroring how trees/rocks are seeded). The existing `step(ms)` (`:1428`) advances the
    top-of-`update` clock + hunger deterministically (zero wall-clock) — no new time hooks needed.
  - **Tier-2 scenarios** (`tests/e2e/`, reuse `harness.ts`/`scenarios.ts`; place entities adjacent so
    there's no multi-second walk; `retries:0`):
    - `survival-daynight.spec.ts`: `applyScenario` at day, `step` past `DAY_MS` → `state().dayPhase ===
      'night'` and the night-overlay alpha rose (assert via a `debugState`-exposed alpha or a queried
      value); `step` a full cycle → `dayCount` increments.
    - `survival-hunger.spec.ts`: seed low `hunger`, `step` → `hunger` fell; seed `hunger:0`, `step >
      STARVE_DAMAGE_INTERVAL_MS` → `state().playerHp` fell.
    - `survival-forage.spec.ts`: seed a bush adjacent to the worker, `order` a harvest, `step` the
      pick → `inventory.get('berries')` rose; then `emit('needs:eat',{itemId:'berries'})`, `step` →
      `hunger` rose and `berries` fell.
  - **Tier-3 `smoke`:** no new assertions — just confirm it stays **green** (the new bush/berries
    assets + gather anim must not throw a console error on boot).
  - Side effects: `debugState`/`ScenarioSpec` additions are DEV/test-only surface. If a temporary
    in-HUD "skip to night"/"starve" button helps manual play-testing, add it behind the existing TEMP
    `⟳ TREES` convention (dev-only) — optional, not required.
  - Docs: none (Step 11).
  - Done when: `npm test` + `npm run e2e` + `npm run smoke` all green with the new specs passing.

- [ ] **Step 10: Docs** `[delegate sonnet]`
  - `docs/STATUS.md`: add a **plan 004** block — day/night tint+phase, hunger core + starvation→health
    cascade (via combat's `damagePlayer`/`playerHp`), forageable berry bush + `berries` (gather anim),
    Health & Wellbeing screen (meters + stats + eat list), inventory reuses plan 008's panel; night =
    tint+phase only (waves later).
  - `CLAUDE.md` Status line + **Next:** move the "Next: survival systems (day/night, hunger)" pointer
    forward (survival slice landed; next is the enemy-night-waves / equipment queue).
  - `docs/GAME-DESIGN.md`: tick MVP slice item 4's "day/night tint + a survival meter" as ✅, leaving
    "short timed wave" as the remaining todo; terse note that the Hunger/Survival first cut is built
    (real-time cycle, hunger→health cascade, Wellbeing screen as the eat surface).
  - `docs/DECISIONS.md`: dated `[DECIDED]` entry — real-time day/night loop; night = tint+phase only
    this slice; hunger drains combat-owned `playerHp` on starvation; survival state **not** persisted;
    eat via the Wellbeing screen (also shows stats); **inventory reuses plan 008's panel and the
    Equipped section is deferred to plan 010** (no throwaway shell); bushes gather (new `Collect` player
    state) vs trees/rocks chop; `blocksPath` added to `ResourceNodeDef`.
  - `docs/ASSETS.md`: note the `Collect_Base` gather player state is now wired, and the `bush`/`berries`
    **placeholder** art (real art via plan 009's pipeline later).
  - `docs/CONVENTIONS.md`: brief note on the `needs`/`daynight` pure systems and the `harvestAnim`/
    `blocksPath` node-def flags if the conventions doc enumerates such patterns.
  - Side effects: docs only.
  - Done when: docs describe the shipped slice consistently; markdownlint clean.

## Out of scope

- **Enemy night waves / combat spawning** — night is tint + phase only; waves layer on later via the
  phase state this slice exposes.
- **Persistence / save-load** of survival (or any) game state — runtime-only this slice.
- **Equipment (equip/unequip, the "Equipped" UI section, stat effects, equippable item data)** —
  **entirely deferred to plan 010**; this slice ships no equipment shell.
- **A new inventory overlay** — plan 008's `INVENTORY` panel + hotbar is the inventory view; this slice
  does not duplicate it.
- **Additional needs** beyond hunger (warmth, energy, thirst) and the hunger→spoilage/cooking economy —
  hunger + the health cascade only; the Wellbeing screen is built to accommodate more needs later.
- **Cooking / food crafting / spoilage**, multiple food types beyond `berries`, and food from sources
  other than the berry bush.
- **Real day/night or bush/berries pixel art** — placeholder art only (real art = plan 009 pipeline).
- **NPC companion feeding**, and **daily narrative events** — separate designs, not this slice.
