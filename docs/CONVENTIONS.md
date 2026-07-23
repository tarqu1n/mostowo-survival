# Code conventions

How the code is structured — the patterns each `src/` seam follows. For run/build/deploy/test
commands and the git/review workflow, see [WORKFLOW.md](WORKFLOW.md). For tooling (lint/format/hooks),
naming conventions, and TS posture, see [STANDARDS.md](STANDARDS.md).

_To be firmed up as we go. Starting position:_

- **Data-driven design.** Items, recipes, buildings, resource nodes = data (TS/JSON), not
  hard-coded logic. Adding content should mean editing data, not writing new systems (e.g. a resource
  node's `blocksPath`/`harvestAnim` flags gate pathing/build-placement and pick chop vs gather, no
  per-species branch in code).
- **Systems over god-objects.** Keep inventory / crafting / time-of-day / resources as separate,
  testable modules (day/night and hunger are `systems/daynight`/`systems/needs` — pure, Phaser-free,
  unit-tested).
- **Scenes:** Boot → Preload → Menu → Game (world). Keep UI decoupled from world logic. The core-loop
  slice set the pattern: content is data in **`src/data/`** (`ITEMS`/`NODES`/`BUILDABLES` + `types.ts`),
  logic is small modules in **`src/systems/`** (`Inventory`, `grid`), and the HUD is **not a scene** —
  it's the DOM/React overlay in **`src/hud/`** (see the `src/hud/` seam below). Comms via
  `this.game.events` (`build:*`, `mode:*`, `inspect:*`, `npc:*`, …) + shared instances in
  `this.registry` (the `Inventory`, `playerStats`, `movepadHeld`).
- **The HUD gates its own taps via DOM `pointer-events`** (plan 046, replacing the old Phaser
  `hudHitTest`). `#hud-root` is `pointer-events:none`; interactive controls opt back in with `auto`, so
  a press on a control is consumed by the DOM and never reaches the Phaser canvas, while empty HUD space
  falls through to `GameScene`'s pointer handlers. The one HUD→world coupling left is the `movepadHeld`
  registry flag (the DOM movepad sets it while dragging, so world pan/tap stay suppressed mid-drive).
  Route all world pointer handlers (`down` + `move`) through one intent gate.
- **Tear down cross-scene listeners** in `this.events.once(SHUTDOWN, …)` — `game.events`/`registry`
  outlive a scene, so listeners double-register on restart otherwise.
- **Worker task system** (plan 002): units move via A* (`src/systems/pathfind.ts` — `findPath` returns
  `[]`=already-there / `null`=unreachable / a tile list; `reachableAdjacent` finds a stand-tile next to
  a target). Orders are a `TaskQueue` of `Action`s (`src/systems/tasks.ts`); **tap a tree = queue a chop
  (append; starts at once if idle, so tapping tree after tree batches a chop list), tap the ground =
  move-now (replace), long-press ≥`LONGPRESS_MS` = append either**, resolved on `pointerup` with a drag
  reject. Tapping an already-queued tree **toggles** it: first tap un-queues it (if it's the live chop,
  the worker advances to the next order); tap again to re-queue it at the **end** of the list. Building is a timed
  on-site job: place a passable _blueprint_ (wood reserved on placement), worker paths to a reachable
  adjacent tile and works `BUILD_MS`, then it becomes a blocking wall. HUD controls swallow their own
  taps via DOM `pointer-events` (see above), so world taps only fire over open canvas. Pathing obstacles
  = completed walls + live trees.
- **Order-kind registry (`src/systems/orders.ts`, plan 043) — the order-extension seam, mirroring
  `StructureManager`+`BUILDABLES`.** The per-kind _decision data_ for worker orders lives in one pure,
  Phaser-free module: `ORDER_META` (`Record<Action['kind'], {highlight, dedupeOnEnqueue}>`) plus generic
  `orderTargetId`/`sameOrderTarget`/`isOrderQueued`/`toggleOrder` over `Action`/`TaskQueue`. `GameScene`
  keeps only the scene-coupled halves as dispatch tables keyed by the same `Action['kind']`
  (`orderBeginners` = walk-to-stand-tile, `orderRunners` = per-frame). Adding an order kind is a data
  entry + two handlers — no more editing an `isXQueued`/`toggleX` quartet, `describeActionTarget`, and a
  `TaskGlowRenderer` highlight branch in lockstep. Pure ⇒ unit-tested directly
  (`systems/__tests__/orders.test.ts`). `wireBus()` is likewise one `[event, handler, ctx]` table iterated
  for both `on` and the SHUTDOWN `off`, so the two can't drift.
- **Footprint vs hurtbox.** A creature's **footprint** (movement, occupancy, pathfinding) is always its
  single feet tile — logic keys off `col`/`row`, never the sprite transform. Its **hurtbox** (combat
  targeting: Punch/Inspect hit-tests, contact reach) is a separate, data-driven tile extent that can
  span more tiles to match a tall/wide sprite (`Hurtbox` in `src/data/types.ts`, pure helpers in
  `src/systems/hurtbox.ts`, consumed by `GameScene.zombieAt` + contact). New enemies just declare a
  `hurtbox` (omit → `DEFAULT_HURTBOX`, one tile); no targeting code changes. Keeps a ~2-tile sprite
  hittable by its drawn torso without letting it _occupy_ two tiles.
- **Attacker shape vs defender hurtbox (plan 036).** A melee hit is **tile-set membership**, not physics:
  the attacker projects an `AttackShape` (`{reach, arc}`, data on a weapon) through pure
  `attackTiles(feet, facing, shape)` (`src/systems/hurtbox.ts`) into a set of target tiles; the defender
  owns its `hurtbox` tiles; a hit is the intersection (`EnemyManager.enemiesInTiles`). Both sides live in
  the same `col`/`row` space as footprint/pathfinding — deterministic, harness-testable, no AABB/pixel
  collision. New reach/area = new shape data, not new targeting code.
- **Pointer picking is a sprite raycast, not a tile lookup.** `GameScene.pickSpriteAt` resolves which
  world entity a tap landed on by walking the _drawn sprites_: a candidate is hit on its logical
  footprint (a node's foot tile, a zombie's hurtbox, a site's tile — so the base is always a reliable
  target even where the art is transparent between the feet) **or** on an opaque pixel of its sprite
  (`alphaHit` — a cheap AABB filter then a `getPixelAlpha` texel read). So a tall base-anchored pine is
  clickable up its whole trunk/canopy, not just its foot tile, and its transparent padding is _not_ a
  fat rectangular hitbox. Overlaps resolve by draw order — higher `depth` wins, ties break on
  display-list order (drawn later = on top) — so the sprite you see on top is the one you pick. Both
  `actionAt` (harvest vs move) and `inspectAt` route through it; combat (`zombieAt`) still keys off the
  hurtbox tiles, not the raycast.
- **Pixel art:** integer scaling only, `pixelArt: true`, nearest-neighbour; design at a fixed low base
  resolution and scale up. Actors render at native `render.scale = 1` and camera zoom is integer-only
  (both required for crisp nearest-neighbour — see [RENDERING.md](RENDERING.md)); size the world/props to
  the actor, never fractionally down-scale an actor to fit.
- **Entities layer (`src/entities/`, plan 013).** Actors that genuinely share state + behaviour are
  plain classes that _own_ their sprite — deliberately NOT `Phaser.GameObjects.Sprite` subclasses, so
  entity lifetime never entangles with the display list: `Character` (abstract — sprite, stats, hp,
  facing, path) → `PlayerCharacter` / `MonsterCharacter`. The hierarchy **stops there** — trees/build
  sites share no behaviour with each other or with `Character`, so they stay plain interfaces + typed
  stat adapters (`systems/stats.ts`), not a forced class tree (see [DECISIONS.md](DECISIONS.md),
  2026-07-11 and 2026-07-13: behaviour classes yes, data hierarchy no). Decision/effect split
  preserved: a pure system (`monsterAI`, `attachment`) _decides_; the entity _executes_ (e.g.
  `MonsterCharacter.update` runs the FSM's decision, never re-derives it).
- **Enemy rendering is a data discriminator, not a subclass (`EnemyDef.actorKind`, plan 035b).** A mob
  picks its render path from data: `'flip3'` (default/omitted) = one single-orientation Run strip with
  facing faked by `setFlipX` (skeleton — art in `ACTIVE_TILESET.actors.enemy`); `'dir4'` = a 4-way
  directional creature with a distinct strip per facing (`Facing4` = down/up/left/right, no flip), keyed
  by enemy `id` under `ACTIVE_TILESET.actors.directional` and animated via `dirEnemyAnimKey`. One
  `MonsterCharacter` handles both — the discriminator branches the anim/footprint selection, so adding a
  directional creature is a data + manifest entry, not a new actor class.
- **Manager pattern (`src/scenes/{build,combat,fx,hud,input,world}/`, `src/scenes/testApi.ts`, plans
  013/015/043).** Self-contained scene concerns — build placement (`BuildManager`), queue-glow rendering
  (`TaskGlowRenderer`), combat FX (`CombatFxManager`), player-combat orchestration
  (`combat/CombatController`, plan 043), pointer/camera gestures
  (`PointerInputController`), the DEV test API (`testApi.ts`), resource-node spawn/harvest/regrow
  (`ResourceNodeManager`), enemy spawn/AI-tick/kill (`EnemyManager`), the day/night+hunger clock
  (`SurvivalClock`), fog-of-war/vision (`VisionController`), and pointer-pick + tap-intent
  (`ScenePicker`) — extract into managers, not a growing GameScene: scene→manager is always a
  **direct method call**, never a `game.events` round-trip (the bus stays reserved for
  scene↔HUD comms); a manager's constructor takes the scene plus a **narrow deps object of closures**
  over exactly the scene state/methods it needs, never raw field access; there is **no
  manager↔manager coupling** — if two managers need each other's data, the scene mediates. Every
  manager registers its own `destroy()` on `Phaser.Scenes.Events.SHUTDOWN` (tween Maps/Sets are the
  known restart-leak hazard) — **except `ScenePicker`**, which owns nothing to tear down. `GameScene`
  stays the composition root and keeps the task-execution loop. One-shot setup that isn't stateful
  (no deps object, no teardown) stays a plain free function instead — e.g. `world/actorAnims.ts`'s
  `registerActorAnims` and `world/groundRenderer.ts`'s `drawGround`.
- **The HUD seam (`src/hud/`, plan 046) — a DOM/React overlay, NOT a Phaser scene.** The whole Phaser
  HUD (the old `UIScene` + `src/scenes/hud/*` + the `src/ui/*` kit) was replaced by a page-level React
  overlay mounted into `#hud-root` over the canvas (mirrors how `src/editor/` bridges React↔Phaser via
  a Zustand store, inverted so React floats above the canvas rather than hosting it). Layers:
  `store.ts` (Zustand — the one-way mirror of game state + the hotbar loadout); `bridge.ts`
  (`initBridge(bus, registry)` — the ONLY file touching `game.events`/`registry`: subscribes outbound
  events + registry keys → store setters, exposes a typed `emit(InboundEvent)` for HUD→world, and the
  `movepadHeld` flag); `GameHud.tsx` (composition root — canvas-rect coordinate mapping, the top
  cluster, the morphing command bar + hotbar + bottom-sheet drawers, and the inspect/companion/dev
  overlays); `components/*` are presentational (read `useHudStore`, emit via `bridge.emit`). **Lifecycle
  differs from the old per-scene UIScene:** the overlay is page-level and PERSISTS across a GameScene
  death→restart — the bridge never tears down on SHUTDOWN; it re-syncs the store from GameScene's
  restart re-emits (`buildWorld` tail) and rebinds the fresh registry `Inventory`. Tailwind is scoped
  under `#hud-root` (see STANDARDS). shadcn primitives are copied into `src/hud/ui/` (deliberately
  duplicated from `src/editor/ui/` for now).
- **Big pure modules split behind a barrel.** `systems/mapFormat/` is a directory
  (`schema`/`parse`/`serialize`/`resize`) with an `index.ts` re-export, so the `systems/mapFormat` import
  path and full export surface are unchanged for all consumers (plan 043) — the API-preserving split rule.
- **Editor store = composed Zustand slices (`src/editor/store/`, plan 043).** `editorStore.ts` is the
  barrel: one `create<EditorState>()(subscribeWithSelector(…))` composing ~15 domain slices
  (`store/slices/*`: document/tools/underlay/world/nodeDefs/resizeRename/paint/walkability/zones/shape/
  terrain/layers/favourites/tilePalettes/objects) + `store/shared.ts` (history + reconcile helpers). Each
  slice is `(set, get) => ({…})`; cross-domain actions route through the combined `get()`/`set()`.
  `EditorState` stays ONE interface, slices typed `EditorSlice<Pick<EditorState, …>>` so `create()`
  compile-verifies the Picks partition it. Pure command builders sit beside their `*Ops.ts`. The barrel
  re-exports the full surface (`useEditorStore` + selectors/consts/types) — consumers don't change.
- **Editor scene = composition root + controllers (`src/editor/scene/`, plan 043).** `EditorScene.ts`
  wires `EditorInputController` (pointer/gesture/keyboard/tool-dispatch) + `EditorCameraController` (both
  classes taking the scene, removing listeners in `destroy()` — fields are `inputController`/
  `cameraController`, _not_ `input`, which collides with Phaser's `Scene.input`) plus the free-fn
  renderers `textureBaker`/`overlaysRenderer`/`objectRenderer` + `scene/constants.ts`. Same rule as the
  game managers.
- **Shared editor viewport modules (plan 043).** One pan/zoom hook `hooks/usePanZoom(scale)` + pure
  `zoom.ts` (`ZOOM_MIN/MAX/STEP` + `clampZoom`), `regionGeometry.ts` (`normRect`/`resizeBox`/`clampN`),
  and `pixelAlpha.ts` (RGBA→alpha maths) unify what `LibraryPanel.AtlasSheetPicker` and
  `ObjectEditorTab.RegionsEditor` used to duplicate; the pure three are unit-tested
  (`editor/__tests__/regionGeometry.test.ts`).
- **Fx-teardown pattern** (`CombatFxManager`, `NodeFxManager` — the two exemplars). Tweens live in a
  `Map` keyed per sprite; restarting one `.stop()`s (never `.remove()`s) the prior tween before
  starting fresh, and every `onUpdate`/`onComplete` is `.active`-guarded. A scene-alive
  `reset()`/`clearAll()` **stops tweens and destroys** the transient sprites; the SHUTDOWN `destroy()`
  only stops tweens and **drops refs** (Phaser already tore the GameObjects down — never `.destroy()`
  there). Stop-before-clear ordering matters. Extraction trigger: when a spell/weapon/on-trigger fx
  feature arrives (the 3rd client), promote `NodeFxManager`'s transient-sprite machinery to a shared
  surface and consider a named-effect registry keyed from `src/data/` — decide against two real
  clients, not speculatively.
- Keep functions small; name for the domain (resource, node, recipe, stockpile), not the framework.
