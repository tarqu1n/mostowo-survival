# Code conventions

How the code is structured — the patterns each `src/` seam follows. For run/build/deploy/test
commands and the git/review workflow, see [WORKFLOW.md](WORKFLOW.md).

_To be firmed up as we go. Starting position:_

- **Data-driven design.** Items, recipes, buildings, resource nodes = data (TS/JSON), not
  hard-coded logic. Adding content should mean editing data, not writing new systems.
- **Systems over god-objects.** Keep inventory / crafting / time-of-day / resources as separate,
  testable modules.
- **Scenes:** Boot → Preload → Menu → Game (world) → UI overlay. Keep UI decoupled from world logic.
  The core-loop slice set the pattern: content is data in **`src/data/`** (`ITEMS`/`NODES`/`BUILDABLES`
  + `types.ts`), logic is small modules in **`src/systems/`** (`Inventory`, `grid`), and the HUD is a
  parallel **`UIScene`** launched over `GameScene` — not baked in. Cross-scene comms via
  `this.game.events` (`build:*`) + a shared instance in `this.registry` (the `Inventory`).
- **World-scene input gates on the HUD hit-region.** A scene-level `input.on('pointerdown')` fires for
  *every* tap, including ones over the overlay — so `GameScene` ignores pointers inside `UIScene`'s
  hit-region (`hudHitTest`) before routing move/chop/build. Route all pointer handlers (`down` + `move`)
  through one intent gate.
- **Tear down cross-scene listeners** in `this.events.once(SHUTDOWN, …)` — `game.events`/`registry`
  outlive a scene, so listeners double-register on restart otherwise.
- **Worker task system** (plan 002): units move via A* (`src/systems/pathfind.ts` — `findPath` returns
  `[]`=already-there / `null`=unreachable / a tile list; `reachableAdjacent` finds a stand-tile next to
  a target). Orders are a `TaskQueue` of `Action`s (`src/systems/tasks.ts`); **tap = act-now (replace),
  long-press ≥`LONGPRESS_MS` = append**, resolved on `pointerup` with a drag reject. Building is a timed
  on-site job: place a passable *blueprint* (wood reserved on placement), worker paths to a reachable
  adjacent tile and works `BUILD_MS`, then it becomes a blocking wall. `hudHitTest` is visibility-aware
  so hidden buttons don't swallow world taps. Pathing obstacles = completed walls + live trees.
- **Footprint vs hurtbox.** A creature's **footprint** (movement, occupancy, pathfinding) is always its
  single feet tile — logic keys off `col`/`row`, never the sprite transform. Its **hurtbox** (combat
  targeting: Punch/Inspect hit-tests, contact reach) is a separate, data-driven tile extent that can
  span more tiles to match a tall/wide sprite (`Hurtbox` in `src/data/types.ts`, pure helpers in
  `src/systems/hurtbox.ts`, consumed by `GameScene.zombieAt` + contact). New enemies just declare a
  `hurtbox` (omit → `DEFAULT_HURTBOX`, one tile); no targeting code changes. Keeps a ~2-tile sprite
  hittable by its drawn torso without letting it *occupy* two tiles.
- **Pixel art:** integer scaling only, `pixelArt: true`, nearest-neighbour; design at a fixed low base
  resolution and scale up. Actors render at native `render.scale = 1` and camera zoom is integer-only
  (both required for crisp nearest-neighbour — see [RENDERING.md](RENDERING.md)); size the world/props to
  the actor, never fractionally down-scale an actor to fit.
- Keep functions small; name for the domain (resource, node, recipe, stockpile), not the framework.
