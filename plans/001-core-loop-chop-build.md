# Core Loop: Chop a Tree, Build a Wall

> Status: planned — run /execute-plan to begin.

## Summary

First playable slice of the core gameplay loop and the control/layout foundation to iterate on.
On the existing mobile-first Phaser scaffold, add: a **harvestable tree** the player fells by
**tapping it** (walks over, multi-hit chop, each hit yields **wood** into a **character inventory**,
tree → stump → regrows), a **minimal HUD** (wood count + Build button), and a **build mode** where
the player taps a grid tile to **place a wall** that spends wood and blocks movement. Placeholder art
only; data-driven items/nodes/buildables so content is cheap to add later.

This slice deliberately establishes the **interaction model + on-screen layout** so we can iterate on
feel before layering survival systems on top.

## Context & decisions

**Stack / scaffold to build on** (all authored this session):

- `src/config.ts` — `BASE_WIDTH=360`, `BASE_HEIGHT=640`, `TILE_SIZE=16`, `COLORS` palette. Add new
  tunables/colours here, don't scatter magic numbers.
- `src/main.ts` — Phaser game config; scene array `[BootScene, PreloadScene, MainMenuScene, GameScene]`,
  arcade physics (no gravity), `pixelArt`, `Scale.FIT`. New scenes get registered here.
- `src/scenes/GameScene.ts` — current world scene: checker ground, a tap-to-move player
  (`physics.moveTo` toward a `target` vector), a scroll-fixed HUD text. This is the file the
  interaction work extends. World bounds = viewport (no camera scroll this slice).
- `src/scenes/{Boot,Preload,MainMenu}Scene.ts` — pattern to mirror for a new scene (class extends
  `Phaser.Scene`, `super('Key')`, typed members, terse doc comment).

**Direction** (from `README.md` / `docs/GAME-DESIGN.md` / `docs/DECISIONS.md`): mobile-first (portrait,
touch, `Scale.FIT`); **data-driven** items/recipes/buildables/nodes (adding content = editing data,
not systems); **systems over god-objects** (separate inventory/grid modules); **UI decoupled from
world logic** (a parallel `UIScene` overlay, not HUD baked into `GameScene`); dark-grotty-but-funny
placeholder palette. Trunk-based: commit each step, push to `master` (auto-deploys).

**Decisions locked with the user for this slice:**

- **Controls:** tap the target directly — tap a tree → player walks to it and chops; in build mode,
  tap a tile to place. Minimal buttons.
- **Chopping:** multi-hit; tree has HP; each hit yields wood; at 0 HP → stump; regrows after a delay.
- **Building:** press **Build** (HUD) → build mode; a tile **ghost** shows valid/invalid; tap a valid
  tile to place a wall if affordable; wood is spent; wall blocks movement.
- **Base area:** none yet — build anywhere.

**Event bus:** use the global `this.game.events` emitter to decouple `GameScene` ↔ `UIScene`
(`inventory:changed`, `build:toggle`, `build:modeChanged`). Share the `Inventory` instance via
`this.registry`.

**Explicitly deferred (out of scope):** day/night, hunger/survival meters, NPCs, enemies, real art,
save persistence, camera/scrolling world, multiple maps.

## Steps

- [ ] **Step 1: Data-driven definitions (items, nodes, buildables)** `[delegate]` (parallel: A)
  - Create `src/data/types.ts` with interfaces: `ItemDef { id: string; name: string; color: number }`
    (`color` = placeholder icon colour); `ResourceNodeDef { id: string; name: string; maxHp: number;
    woodItemId: string; woodPerHit: number; regrowMs: number; color: number; stumpColor: number }`;
    `BuildableDef { id: string; name: string; cost: Record<string, number>; color: number }`.
  - Create `src/data/items.ts` → export `ITEMS: Record<string, ItemDef>` with `wood`
    (`{ id:'wood', name:'Wood', color: 0x8a5a2b }`).
  - Create `src/data/nodes.ts` → export `NODES: Record<string, ResourceNodeDef>` with `tree`
    (`maxHp:3, woodItemId:'wood', woodPerHit:1, regrowMs:15000, color:0x2f5d34, stumpColor:0x5a3f28`).
  - Create `src/data/buildables.ts` → export `BUILDABLES: Record<string, BuildableDef>` with `wall`
    (`{ id:'wall', name:'Wall', cost:{ wood:2 }, color:0x6b6b6b }`).
  - Mirror the terse-comment style of `src/config.ts`. Keep values as named consts, no magic numbers.
  - Side effects: none (new files, nothing imports them yet).
  - Docs: none.
  - Done when: `npm run typecheck` passes; the four modules export the typed records above.

- [ ] **Step 2: Inventory system** `[delegate]` (parallel: A)
  - Create `src/systems/Inventory.ts` — class `Inventory extends Phaser.Events.EventEmitter`.
    Internal `Map<string, number>`. Methods: `get(id): number`, `add(id, n=1): void`,
    `has(id, n=1): boolean`, `canAfford(cost: Record<string,number>): boolean`,
    `spend(cost: Record<string,number>): boolean` (returns false and no-ops if unaffordable),
    `snapshot(): Record<string, number>`. Emit `'change'` (with `snapshot()`) after any mutation.
  - Pure logic, no Phaser scene deps beyond `Phaser.Events.EventEmitter` (import `Phaser`).
  - Side effects: none yet (wired in Step 4).
  - Docs: none.
  - Done when: `npm run typecheck` passes; `spend` rejects unaffordable costs; `add`/`spend` emit `change`.

- [ ] **Step 3: Tile-grid utilities** `[delegate haiku]` (parallel: A)
  - Create `src/systems/grid.ts` — pure helpers over `TILE_SIZE` from `config.ts`:
    `worldToTile(px: number): number` → `Math.floor(px / TILE_SIZE)`;
    `tileToWorldCenter(tile: number): number` → `tile * TILE_SIZE + TILE_SIZE / 2`;
    `snapToTileCenter(px: number): number` → `tileToWorldCenter(worldToTile(px))`;
    `tileKey(col: number, row: number): string` → `` `${col},${row}` `` (for an occupancy set).
  - Side effects: none.
  - Docs: none.
  - Done when: `npm run typecheck` passes; snapping `x=20` with `TILE_SIZE=16` yields centre `24`.

- [ ] **Step 4: Trees + tap-to-chop in GameScene** `[inline]`
  - Extend `src/scenes/GameScene.ts`. Create the character `Inventory` (Step 2), store it via
    `this.registry.set('inventory', inv)`, and re-emit its `'change'` as
    `this.game.events.emit('inventory:changed', snapshot)` so the HUD can subscribe.
  - Spawn 2–3 **tree** nodes (from `NODES.tree`) as rectangles at fixed positions (tree `color`,
    ~`TILE_SIZE` square). Track each node's `hp` and alive/stump state. Keep them in an array.
  - **Refactor input routing** (this is the core of the slice): a single scene `pointerdown` handler
    that decides intent by what was tapped —
    (a) if the tap hits a live tree (point-in-bounds / distance test over the node list) → set a
    `pendingAction = { type:'chop', node }` and move the player toward a point just short of the tree;
    (b) otherwise → treat as a move (existing tap-to-move). Leave a clear seam for build mode (Step 6)
    to intercept taps first.
  - In `update`, when the player is within `INTERACT_RANGE` (add to `config.ts`, e.g. `TILE_SIZE*1.4`)
    of a `pendingAction.chop` target, stop moving and run the chop loop: every `CHOP_INTERVAL_MS`
    (config, ~400ms) reduce the tree's `hp` by 1 and `inv.add(woodItemId, woodPerHit)`; small visual
    tick (e.g. flash/scale). At `hp<=0` → convert to **stump** (recolour to `stumpColor`, mark
    non-interactable), clear `pendingAction`, and `this.time.delayedCall(regrowMs, …)` to restore it
    to a full live tree.
  - Add `INTERACT_RANGE`, `CHOP_INTERVAL_MS` (and any tree spawn coords if you prefer) to `config.ts`.
  - Side effects: changes the existing tap-to-move behaviour (now shared with chop routing) — verify
    plain ground taps still move the player. `pendingAction` must be cleared if the player taps
    elsewhere mid-approach.
  - Docs: none yet (batched into Step 7).
  - Done when: tapping a tree walks the player over and fells it in 3 hits, wood rises by 1 per hit
    (observe via a temporary log or the Step-5 HUD), tree becomes a stump and regrows after the delay;
    tapping open ground still moves the player.

- [ ] **Step 5: HUD overlay (UIScene) — wood count + Build button** `[inline]`
  - Create `src/scenes/UIScene.ts` (mirror the other scene classes). Runs **in parallel** over
    `GameScene`. It renders: a **wood counter** (icon swatch in `ITEMS.wood.color` + count, top area),
    a **Build** toggle button (tap target sized for touch), and a small **mode indicator**
    ("BUILD MODE — tap a tile / tap Build to cancel") shown only in build mode.
  - Wiring via `this.game.events`: on create, seed from `this.registry.get('inventory')?.snapshot()`;
    listen for `'inventory:changed'` → update the counter; listen for `'build:modeChanged'` (bool) →
    toggle the indicator + button pressed-state. The Build button emits `'build:toggle'`.
  - Register `UIScene` in `src/main.ts` scene array, and `this.scene.launch('UI')` from `GameScene`'s
    `create()` (launch = run alongside, not replace).
  - Side effects: touches `src/main.ts` (scene list) and `GameScene.create` (launch call). Ensure
    `UIScene` sits above `GameScene` in render order (launch after, or set depth).
  - Docs: none yet (batched into Step 7).
  - Done when: HUD shows live wood count that increments while chopping; tapping **Build** flips the
    indicator on/off (the mode is consumed in Step 6).

- [ ] **Step 6: Build mode + wall placement** `[inline]`
  - In `GameScene`, add a `buildMode: boolean`. Listen for `this.game.events.on('build:toggle', …)`
    to flip it and emit `'build:modeChanged'` back. Maintain an **occupancy set** of placed-wall tile
    keys (`grid.tileKey`).
  - While in build mode: intercept taps **before** the Step-4 routing. Show a **ghost** rectangle
    snapped to the tapped tile (`grid.snapToTileCenter`), coloured valid/invalid — invalid if the tile
    is already occupied, overlaps a live tree, or the player can't `inv.canAfford(BUILDABLES.wall.cost)`.
    On a tap on a **valid** tile: `inv.spend(cost)`, create a wall (rect in `wall.color`) as a member
    of a `physics.add.staticGroup()`, add the tile key to the occupancy set. Keep build mode on for
    repeated placement; tapping Build again exits (ghost hidden).
  - Add a `this.physics.add.collider(player, wallsGroup)` so walls **block movement**.
  - Side effects: build-mode tap interception must not leak into move/chop routing (and vice-versa);
    confirm exiting build mode restores normal tap-to-move/chop. Static bodies need
    `refreshBody()`/correct sizing after creation.
  - Docs: none yet (batched into Step 7).
  - Done when: in build mode, valid tiles place a wall and deduct 2 wood; unaffordable/occupied tiles
    are rejected (invalid ghost, no spend); the player collides with placed walls; exiting build mode
    returns to normal chopping/moving.

- [ ] **Step 7: Verify end-to-end + docs** `[inline]`
  - **Verify** via the headless smoke pattern in `docs/WORKFLOW.md` (`npm run build && npm run preview`
    + Chromium at `/opt/pw-browsers/`): drive tap→chop (assert wood count rises), toggle Build, place a
    wall (assert wood drops by 2), and confirm no console/runtime errors. Capture before/after
    screenshots to eyeball the HUD/layout.
  - **Docs (terse):** update `CLAUDE.md` **Status** (core-loop slice landed: chop→wood→inventory,
    build→wall); tick the relevant items in `docs/GAME-DESIGN.md` **MVP vertical slice**; add a one-line
    note in `docs/WORKFLOW.md` **Code conventions** pointing to the new `src/data/`, `src/systems/`,
    `UIScene` layout as the pattern to follow. Keep edits high-signal.
  - Side effects: none beyond docs.
  - Docs: as above.
  - Done when: smoke test green (chop adds wood, build spends wood, no errors); docs reflect the slice;
    changes committed and pushed to `master` (deploy auto-runs).

## Out of scope

Day/night cycle, hunger/survival meters, health & wellbeing view, NPC companions, enemies/combat,
daily narrative events, base storage/transfer, real pixel art or generated assets, save/load
persistence, camera-scrolling or multi-map world, a demarcated base zone. These layer on later slices.
