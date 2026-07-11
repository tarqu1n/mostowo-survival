# Worker Task System: pathfinding, queued orders, timed construction

> Status: planned — run /execute-plan to begin.

## Summary

Upgrade the core loop from "one action at a time, straight-line movement" into a **worker task
system**: the player unit **pathfinds around obstacles** (A* on the tile grid), works through a
**queue of orders** (plain tap = act now / clear queue; long-press = append), and **construction
becomes a timed job a worker performs on site** — placing a wall drops a passable *blueprint* and
enqueues a build task; the worker walks to it and works for a few seconds before it becomes a solid,
blocking wall. This is the foundation the NPC companions (GAME-DESIGN.md) will plug into: the same
unit + task-queue + pathfinding machinery drives a worker whether it's the player or an NPC.

Builds directly on plan 001 (chop→wood→`Inventory`, build→wall, `UIScene` HUD, `src/data`/`src/systems`).

## Context & decisions

**Scaffold to build on** (post plan-001):

- `src/scenes/GameScene.ts` — owns the player, a single `pointerdown`/`pointermove` intent gate
  (UI-guard → build seam → tree-hit → move), `pendingChop`, straight-line `physics.moveTo` toward a
  `target`, an `occupied` `Set<tileKey>` of placed walls (static group), and the `trees[]` array
  (`TreeNode { rect, def, hp, alive, col, row }`). **This file is the main site of the refactor.**
- `src/systems/grid.ts` — `worldToTile` / `tileToWorldCenter` / `snapToTileCenter` / `tileKey`.
- `src/systems/Inventory.ts` — shared via `registry`; `canAfford` / `spend` / `add` / `'change'`.
- `src/scenes/UIScene.ts` — HUD overlay; wood counter, Build toggle, mode indicator, `hudHitTest()`.
- `src/config.ts` — `TILE_SIZE=16`, `BASE_WIDTH=360` (22 cols), `BASE_HEIGHT=640` (40 rows),
  `INTERACT_RANGE`, `CHOP_INTERVAL_MS`, `COLORS`.
- `scripts/smoke.mjs` — headless driver; reads `window.game` (registry inventory, `GameScene` state).

**Direction** (README / GAME-DESIGN / DECISIONS): mobile-first touch; **data-driven**; **systems over
god-objects** (pathfinding + task queue are their own modules, reusable for NPCs); UI decoupled;
trunk-based (commit each step, push to `master`, auto-deploys).

**Decisions locked with the user for this slice:**

- **Queue interaction:** **plain tap = act now** (clear the queue and start this order immediately);
  **long-press (≥ `LONGPRESS_MS`) = append** the order to the queue. One order queue per worker,
  executed FIFO. Drag-to-move is dropped (tap / long-press only).
- **Pathfinding obstacles:** **completed walls AND live trees block.** The worker routes around them;
  stumps (felled trees) are passable. **Blueprints (in-progress construction) are passable** — they
  only become blocking once the wall completes.
- **Building takes time + a worker:** placing (build mode) drops a **passable blueprint**, **reserves
  the wood immediately** (spent at placement), and **enqueues a `build` task**. The worker paths to a
  tile adjacent to the blueprint and works for `BUILD_MS` (progress shown) before it solidifies into a
  blocking wall. Placing several blueprints queues several build jobs (build orders always append).
- **Cancel is non-destructive to materials:** a **Cancel** HUD button clears the *task queue* but
  leaves any placed blueprints standing; re-entering build mode and tapping an existing blueprint
  **re-enqueues** its build. (No demolish/refund this slice.)

**Task model:** a discriminated union `Action`:

- `{ kind: 'move', col, row }` — path to the tile and stop.
- `{ kind: 'harvest', treeId }` — path to a walkable tile adjacent to the tree, then chop until felled.
- `{ kind: 'build', siteId }` — path to a walkable tile adjacent to the blueprint, then work `BUILD_MS`
  until it completes.

The worker holds `current: Action | null` + `queue: Action[]`. On completion of `current`, shift the
next from `queue`. Plain tap → `queue=[]; current=<action>` (recompute path). Long-press → `queue.push`.

## Steps

- [ ] **Step 1: A* pathfinding module** `[delegate]` (parallel: A)
  - Create `src/systems/pathfind.ts` — pure, no Phaser. Export
    `findPath(start: {col:number;row:number}, goal: {col:number;row:number},
    isBlocked: (col:number, row:number) => boolean,
    dims: {cols:number; rows:number}): Array<{col:number;row:number}> | null`.
  - **8-connectivity**, disallowing diagonal moves that cut between two blocked orthogonal corners
    (no squeezing through wall diagonals). Octile distance heuristic. **Return contract (Findings 1/7):**
    if `start === goal` return `[]` (already there → caller treats as "arrived, act now"); if `goal` is
    blocked or unreachable return `null` (caller drops/skips or picks another adjacent tile). A found
    route returns a non-empty tile list, **never including `start`** (the sequence to step *to*, ending
    at `goal`). Callers MUST branch these three cases explicitly.
  - Also export a small helper `reachableAdjacent(from, tile, isBlocked, dims): {col,row} | null` (or
    let callers iterate) — of `tile`'s 8 neighbours, return the walkable one with the shortest
    **successful** `findPath` from `from`, else `null`. This is what harvest/build use to stand next to
    a target, so "no reachable adjacent tile" is detectable (Finding 1), not a silent stall.
  - Keep the public surface to `findPath` + `reachableAdjacent`; anything else (neighbour iteration,
    diagonal-corner test, octile helper) stays internal. No magic numbers — costs as consts
    (`STRAIGHT=1`, `DIAGONAL≈1.41421`).
  - Side effects: none (new file, nothing imports it yet).
  - Docs: none.
  - Done when: `npm run typecheck` passes; a hand-traced case works — on a 5×5 open grid,
    `findPath({0,0},{2,0}, ()=>false, {cols:5,rows:5})` returns a 2-length path ending at `{2,0}`; with
    a vertical wall blocking col 1 rows 0–1 but open at row 2, the path detours down and back up
    (length > 2) rather than returning null; `findPath(p,p,…)` returns `[]`; a fully-walled goal
    returns `null`; `reachableAdjacent` returns a neighbour for an open target and `null` when the
    target is ringed by blocked tiles.

- [ ] **Step 2: Task types + queue helper** `[delegate haiku]` (parallel: A)
  - Create `src/systems/tasks.ts` — pure types + a tiny queue. Export the `Action` discriminated union
    (exactly the three kinds in **Task model** above) and a `TaskQueue` class holding
    `current: Action | null` and a private `Action[]`. Methods: `replace(a: Action)` (clear queue +
    set current), `append(a: Action)` (if no current, set current; else push), `next(): Action | null`
    (shift into current, return it; sets current to null when empty), `clear()` (empty queue + current),
    `get pending(): number` (queue length, excluding current), `get current()`.
  - No Phaser import; pure data. Mirror the terse-comment style of `src/config.ts`.
  - Side effects: none (wired in Step 3).
  - Docs: none.
  - Done when: `npm run typecheck` passes; `replace` drops queued items; `append` fills `current` first
    then queues; `next` advances and returns `null` when drained.

- [ ] **Step 3: Path-following movement + obstacle grid** `[inline]`
  - In `GameScene`, add `gridDims = { cols: floor(BASE_WIDTH/TILE_SIZE), rows: floor(BASE_HEIGHT/TILE_SIZE) }`
    and an `isBlocked(col,row)` that returns true for **occupied wall tiles** and **live-tree tiles**
    (blueprints excluded — added in Step 5). Expose it as a bound method so `findPath` can take it.
  - Replace straight-line `moveTo(target)` with **waypoint following**: hold `path: {col,row}[]` and a
    `pathIndex`. Given a goal tile, call `findPath(playerTile, goal, isBlocked, gridDims)`; store it.
    In `update`, `moveTo` the current waypoint's world centre; when within a small epsilon, advance
    `pathIndex`; at the end, snap and stop. If `findPath` returns `null`, do nothing (drop the order).
  - Keep `INTERACT_RANGE`/chop logic but drive movement through the path, not a raw vector target.
  - **Re-path on world change:** when a wall completes (Step 5) or a tree state flips, if the moving
    worker's remaining path now crosses a blocked tile, recompute from the current tile to the goal.
  - Handle the `findPath` contract (Finding 7): `[]` = already at the goal tile (stop, done); `null` =
    unreachable (drop the order); a list = follow it.
  - Add `LONGPRESS_MS` (config, ~350) now (used in Step 4).
  - Side effects: rewrites the movement core; the old `target` vector + drag-to-move are removed.
    Verify the player still reaches open-ground taps and now steps around a manually-placed wall.
  - Docs: none yet (batched into Step 7).
  - Done when: with a wall in the straight-line path between player and a tapped tile, the player
    visibly detours around it and arrives; tapping open ground still arrives directly.

- [ ] **Step 4: Task queue + tap/long-press input** `[inline]`
  - Introduce a `TaskQueue` (Step 2) in `GameScene`. **Unify the pointer gate across down AND up
    (Finding 3):** the **UI-guard** (`hudHitTest`) runs on **both** `pointerdown` and `pointerup` (a tap
    over the HUD is never a world order). **Build placement stays on `pointerdown`** (Step 5, always
    `append`). **Move/harvest resolve on `pointerup`** using `pointer.getDuration()` — `< LONGPRESS_MS`
    → `queue.replace(action)`; `>= LONGPRESS_MS` → `queue.append(action)` — and only if the pointer
    didn't drag (down→up distance over a few px is rejected, not treated as an order). In build mode,
    `pointerup` does nothing for move/harvest (build owns the gesture).
  - Order construction: a tap on a **live tree** → `{kind:'harvest', treeId}`; otherwise
    `{kind:'move', col,row}`. (Build orders are made in Step 5, always via `append`.)
  - **Executor:** a single `runCurrent(delta)` in `update` that switches on `current.kind`:
    `move` → follow path (branch `[]`/`null`/list per Finding 7), done when arrived; `harvest` → use
    `reachableAdjacent(playerTile, treeTile, isBlocked, dims)` to pick a **reachable** neighbour to
    stand on (Findings 1/6 — handles the worker already standing on/next to the tree), path there, run
    the chop loop until felled, then done; **if `reachableAdjacent` returns `null`, skip the task**
    (don't stall) and emit `tasks:changed`. When an action finishes, `queue.next()` and recompute its
    path. Clear `current` when the queue drains. A `harvest` whose tree is already a stump completes
    immediately.
  - Assign each tree a stable `id` (e.g. `tree-<i>`) so a task can reference it after regrow.
  - Side effects: replaces `pendingChop` with the task executor; ensure chopping still yields wood and
    that switching orders mid-chop (plain tap elsewhere) cleanly abandons the chop.
  - Docs: none yet.
  - Done when: long-pressing three spots queues three moves the worker visits in order; a plain tap
    mid-queue cancels the rest and goes there now; tapping a tree still walks over (around obstacles)
    and fells it; wood rises per hit.

- [ ] **Step 5: Timed construction — blueprints + build task** `[inline]`
  - Model a construction **site**: `{ id, col, row, rect, progress:number, done:boolean }`. In build
    mode, a valid tap: `inv.spend(BUILDABLES.wall.cost)` (reserve), create a **translucent blueprint
    rect** (passable; `COLORS.blueprint`, low alpha) snapped to the tile, add the site to a `sites[]`
    array and its tile to a `siteTiles` set, and `queue.append({kind:'build', siteId})`. **Do not** add
    it to `occupied`/`isBlocked` yet (blueprints are passable). **Ghost validity** now also rejects
    tiles that already hold a site **and tiles with no reachable adjacent walkable tile** from the
    worker (Finding 4 — `reachableAdjacent(playerTile, tile, isBlocked, dims) === null` ⇒ invalid, no
    spend), so you can't blueprint into an unreachable spot and strand the wood.
  - **Build executor** (`current.kind === 'build'`): pick a stand-on tile via
    `reachableAdjacent(playerTile, siteTile, isBlocked, dims)` (Findings 1/6 — the worker may be
    standing on the passable blueprint tile itself, so it steps to a neighbour first); if it returns
    `null` (site walled off after placement), **skip the task** + emit `tasks:changed` (don't stall,
    blueprint stays for a later re-enqueue). Otherwise path there, accumulate `progress += delta` until
    `>= BUILD_MS` (config), reflecting progress visually (ramp the blueprint's alpha / fill toward the
    finished wall colour). On completion: mark `done`, recolour to `BUILDABLES.wall.color` at full
    alpha, create the **static wall body** (as in 001), add the tile to `occupied` so `isBlocked` now
    returns true (wall materialises on the tile the worker just vacated), and **re-path** the worker if
    its remaining route now crosses it. Finish the task.
  - **Re-enqueue support:** in build mode, tapping an **existing un-built blueprint** appends a fresh
    `build` task for it (so Cancel is non-destructive). Tapping a done wall does nothing.
  - Add `BUILD_MS` (config, ~2500) and `COLORS.blueprint`.
  - Side effects: wall creation moves from "instant on tap" to "on build completion"; confirm the
    collider still blocks the finished wall and that a half-built blueprint does not block movement.
  - Docs: none yet.
  - Done when: placing a wall shows a blueprint immediately and deducts 2 wood, the worker walks over
    and — after ~`BUILD_MS` of on-site work — it becomes a solid wall that blocks movement; placing two
    blueprints builds them in sequence; Cancel (Step 6) leaves blueprints standing and re-tapping one
    resumes building it.

- [ ] **Step 6: HUD — Cancel + queue indicator** `[inline]`
  - In `UIScene`: add a **Cancel** button (touch-sized; emits `'tasks:cancel'` on the game bus) and a
    small **queue indicator** (e.g. "▶ move · +2 queued" or a count) driven by a `'tasks:changed'`
    event the `GameScene` emits when `current`/`pending` change. Include the Cancel button rect in
    `hudHitTest`. Tear down the new listeners in `shutdown`.
  - In `GameScene`: on `'tasks:cancel'` → `queue.clear()` and stop the worker (halt velocity, drop
    path); emit `'tasks:changed'` after every queue mutation (replace/append/next/clear) with
    `{ current: current?.kind ?? null, pending }`.
  - Side effects: touches `UIScene` layout + `GameScene` queue mutations; keep the indicator legible on
    a phone (don't overlap the wood counter / Build button).
  - Docs: none yet.
  - Done when: the indicator reflects the live current action + queued count; Cancel empties the queue
    and stops the worker without deleting placed blueprints.

- [ ] **Step 7: Verify end-to-end + docs** `[inline]`
  - **Extend `scripts/smoke.mjs`:** add a **`longPressBase(bx,by)` helper** (Finding 5) — `mouse.move`
    to the point, `mouse.down()`, wait `> LONGPRESS_MS`, `mouse.up()` — since a plain `click` is a
    *replace*, not an *append*, and can't build a queue. Then: (a) place a wall directly between the
    player and a target, order a move past it, and assert the player ends adjacent to the goal (path
    detoured, not stuck against the wall); (b) `longPressBase` two tiles and assert `queue.pending`
    reaches 2 and drains to 0; (c) place a blueprint, assert wood drops by 2 immediately, that the tile
    is **not** blocking while building (`isBlocked` false / a route still crosses it), and that after
    ~`BUILD_MS` it becomes blocking; (d) Cancel clears the queue (`pending===0`) but `sites.length`
    still counts the placed blueprint. Keep the existing chop/build/no-console-error assertions. Expose
    the state the asserts need on the `GameScene` instance / via `window.game` (e.g. a `debugState()`
    returning `{ pending, pathLen, sites, buildMode, occupied }`).
  - **Docs (terse):** update `CLAUDE.md` **Status** (worker task system: pathfinding + queued orders +
    timed construction); note the new `src/systems/pathfind.ts` + `tasks.ts` and the tap/long-press +
    blueprint conventions in `docs/WORKFLOW.md`; add a line to `docs/GAME-DESIGN.md` noting the worker/
    task/pathfinding core is in place (the seam NPC companions will use).
  - Side effects: none beyond docs.
  - Done when: `npm run smoke` green (pathing detour, queue drains, timed build blocks after
    completion, Cancel non-destructive, no console errors); docs updated; committed + pushed to
    `master` (deploy auto-runs).

## Critique

Fresh-eyes review before execution. **Verdict:** right shape and roadmap-aligned (pathfinding +
task-queue + timed construction is a genuine base-builder core, the queue UX is exercised this slice,
and it fixes the current straight-line-into-wall bug) — no hard High, but correctness gaps around
"reachable adjacent tile", the down/up input split, and a smoke test that can't exercise the queue.
Fixes folded into Steps 1/3/4/5/7 below.

| # | Finding | Severity | Fixed in |
| - | ------- | -------- | -------- |
| 1 | Harvest/build pick the nearest *unblocked* neighbour but never check it's *reachable*; an un-completable task silently stalls the whole FIFO queue. | Medium | Steps 1+4+5: pick the adjacent tile by a successful `findPath` (iterate the 8 candidates); if none reachable, **skip** the task + emit `tasks:changed` — never stall. |
| 2 | Heavy worker infra lands ahead of documented next slices (trap + night wave; day/night, hunger) while NPCs are still "draft" — speculative-generality risk. | Medium | Accepted: user-directed detour; fixes the real wall-collision bug + exercises the queue. Sequence day/night + hunger next. |
| 3 | Down/up split under-specified: move/harvest resolve on `pointerup`, build on `pointerdown`, but the `hudHitTest` guard + build seam currently live only in `onPointerDown`. | Medium | Steps 3+4: one unified gate — UI-guard on **both** down & up; build placement on **down** (always append); move/harvest on **up** with a drag-distance reject. |
| 4 | Reserve-wood-at-placement + passable blueprint + no refund ⇒ a walled-off blueprint is dead wood and the worker can stall. | Medium | Step 5: reject placement (invalid ghost, no spend) unless the tile has a **reachable adjacent** tile at placement time; dynamic walling-off later is escaped via Cancel (reserve-no-refund is user-locked). |
| 5 | Step 7 smoke can't exercise the queue: `mouse.click` = short duration = *replace*; no long-press helper. | Medium | Step 7: add a `longPressBase` helper (`down` → hold ≥`LONGPRESS_MS` → `up`); expose `queue.pending`/`path.length`/`sites.length`. |
| 6 | Blueprint placed on the worker's own tile — adjacent-tile pathing + completion ordering undefined. | Low | Steps 4+5: adjacent-tile selection handles "worker on the build/target tile" (it steps to a neighbour first; wall materialises on the vacated tile). |
| 7 | `findPath` `[]` (goal===start, already there) vs `null` (unreachable) must be handled distinctly by executors. | Low | Steps 1+4: contract fixed — `[]` = arrived/act-now, `null` = drop; executors branch explicitly. |

## Out of scope

Demolishing/refunding blueprints, wall HP/damage, multiple worker units / NPC companions (this slice
only wires the *reusable* machinery — no second unit yet), diagonal-aware smoothing of the rendered
path, dynamic obstacles that move, day/night, hunger/survival, enemies, save persistence,
camera-scrolling world. These layer on later slices.
