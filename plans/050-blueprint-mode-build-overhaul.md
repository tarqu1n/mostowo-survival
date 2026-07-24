# Blueprint Mode — Build Experience Overhaul

> Status: planned — run /execute-plan to begin.

## Summary

Turn placement from "a green square, one tap per tile" into a proper **Blueprint Mode**: entering
build dims the world and lights a snap grid, the ghost becomes a **real textured, orientation-aware
sprite** of the structure, a **rotation ring** wraps the cursor (touch drag/flip + `R` keyboard
parity), and a **straight-run line-drag** paints a whole row/column of walls or traps in one gesture.
A **commit bar** in the thumb zone tallies the run's count + total cost + worker ETA behind one
Confirm; construction then plays a **scaffold → build → settle** arc with a **world-space progress
bar**. This is the "Option C" direction chosen from the three-option mockup, drawn mobile-first.

Solves the five gaps in today's build UX: (1) no image of the structure, (2) no rotation shown before
placement, (3) no build animation, (4) no progress bar, (5) one-tap-per-tile placement.

## Context & decisions

**Direction fit:** MVP path is complete; **base building** is a core pillar (CLAUDE.md / `docs/ROADMAP.md`).
This deepens the pillar's core interaction rather than adding a new system — squarely on-direction.

**Decisions taken in planning** (defaults chosen after the user deferred the question set — each is
cheap to change; revisit at critique or per-step execution):

- **Drag vs pan (mobile):** a **line-tool toggle** FAB in the thumb zone. Tool OFF → one-finger drag
  **pans the camera** (newly enabled in build mode — see below), tap places a single tile. Tool ON →
  one-finger drag **paints a straight run**. Pinch-zoom unchanged in both. Chosen over long-press
  because long-press is already the *command-mode* queue-paint gesture (`PointerInputController.ts:166-178`)
  and would collide, and because build mode currently has **no camera pan at all** (early return at
  `PointerInputController.ts:140-143` before the pan block) — the toggle cleanly restores pan.
- **Straight runs only:** a paint drag is **axis-locked** to the dominant axis (row or column) from
  the anchor tile. No L-shapes/rectangles (confirmed with user).
- **Affordability:** a run **queues only what's affordable**. Ghosts beyond the affordable count tint
  invalid; the commit bar reads e.g. "4 of 7 affordable"; Confirm queues just the affordable subset.
- **Deferred spend:** placing pending ghosts spends **nothing**; resources are spent at **Confirm**.
  This is a real behaviour change — today `tryPlaceAt` spends per tile immediately
  (`BuildManager.ts:207-213`). Single-tap placement keeps its existing immediate spend+enqueue.
- **Footprint:** **deferred, field stubbed.** All buildables (wall/campfire/spike_trap) are 1×1. Add a
  `footprint?` field to `BuildableDef` but implement **1×1 only**; multi-tile is a later plan.
- **Icons:** add an `icon?` field to `BuildableDef` and render `<img>` exactly as items do
  (`PackDrawer.tsx:90-97`, `public/assets/icons/`), with a **colour-swatch fallback** when `icon` is
  absent so mode logic never blocks on art. Real structure-icon PNGs baked in a dedicated step.
- **Blueprint Mode == build mode:** entering build mode *is* Blueprint Mode (dim + grid + ring); no
  separate sub-toggle. It stays mutually exclusive with demolish, wired manually as today.

**Key patterns/files to mirror** (from research; all `file:line` in repo):

- **Gesture engine:** `src/scenes/input/PointerInputController.ts` — the single class resolving all
  pointer mechanics via `PointerInputDeps` callbacks (`:23-44`). Build-down at `:127-129`; build-move
  (ghost only, early-returns before pan) at `:140-143`. **Command-mode queue-paint is the template**
  for drag-paint: `queuePainting`/`paintQueueAt`/`paintedThisGesture` (`:69-70,166-178,232-238`).
  Pinch at `:110-118,133-139,269-285`. Pointer-count bug (3rd finger) at `:241-243`.
- **Build wiring in scene:** `GameScene.ts` — `onBuildDown`/`onBuildMove` deps (`:671-675`),
  `enqueueBuild` dep (`:568`), `runBuild` accumulate→`finishSite` (`:1398-1409`), `wireBus()` event
  table (`:814-844`), mode booleans + hand-wired mutual exclusion (`:1615-1622,1647-1658`).
- **Placement core:** `src/scenes/build/BuildManager.ts` — ghost Rectangle (`:103-106`), `updateGhost`
  (`:174-183`, does **not** read facing today), `select`/`toggleBuild` (`:217-222,335-339`),
  `placeOrEnqueueBuild`/`tryPlaceAt` (`:186-213`), `createBlueprint` (stamps `facing`, `:255-267`),
  `finishSite` (`:280-310`).
- **Orientation art to reuse:** `src/scenes/world/StructureManager` + `WallBehavior.ts` — `orient`
  ∈ down|side|up, `barricadeBuildKey`/`barricadeDestroyKey` with `setFlipX` for `left` (`:88-94`),
  Build strip on materialise (`:98-105`).
- **World-space progress bar (ready to reuse):** `src/scenes/fx/NodeFxManager.ts` `showActionProgress`
  (`:456`) — the salvage/clear bar; **not yet wired to builds**.
- **Config:** `BUILD_MS = 2500` global (`config.ts:143`), `COLORS.ghostValid/ghostInvalid/blueprint/queued`
  (`:657-659`), zoom clamps (`:167-169`).
- **Data:** `BuildableDef` (`src/data/types.ts:140-175`, has `category`/`orientable`, no `icon`);
  entries in `src/data/buildables.ts`.
- **HUD seam:** `#hud-root` is `pointer-events:none`, controls opt in with `pointer-events-auto`
  (`CommandBar.tsx:86`). Bottom `ActionLayer` (`GameHud.tsx:111-143`) is where a commit bar/FAB
  belongs, mode-gated. HUD→world = new `InboundEvent` variant (`bridge.ts:80-106`) + `wireBus` row +
  handler. Combat buttons fire on `pointerdown` to survive a movepad hold (`CommandBar.tsx:46-60`) —
  the Confirm/FAB pressed mid-drag needs the same treatment. Full-screen effect precedent = DOM
  vignettes (`GameHud.tsx:186-240`).
- **Tasks/orders:** `systems/tasks.ts` (`append`/`all`), build order is batchable
  (`ORDER_META.build.dedupeOnEnqueue = false`, `orders.ts:72`); per-site data lives on `BuildSite`,
  not the `Action`. Single serial builder (the player).
- **Tests:** unit in `src/systems/__tests__/*.test.ts` (pure, no Phaser — mirror `tasks.test.ts`,
  `orders.test.ts`); scenario in `tests/e2e/*.spec.ts` via `window.game.__test` harness — mirror
  **`gestures.spec.ts`** (long-press→drag→multi-order, clock-stepped, camera pinned at MIN_ZOOM) and
  **`build.spec.ts`** (blueprint→build→blocking lifecycle). `applyScenario` seeds blueprints via
  `buildManager.createBlueprint` (`src/scenes/testApi.ts:362-363`).

**Constraints/gotchas to honour:** deferred spend is a genuine behaviour change (test the old
single-tap path still spends immediately); a paint drag re-hits the same tile every frame → need a
per-gesture tile `Set` like `paintedThisGesture`; big runs build slowly (one serial worker) — the ETA
must reflect `Σ buildTime` serial; keep any fetched image-gen key in-memory only (icons step).

## Steps

- [ ] **Step 1: Data model + per-buildable build time** `[delegate]`
  - `src/data/types.ts`: add optional fields to `BuildableDef` — `icon?: string` (PNG filename under
    `public/assets/icons/`), `buildTimeMs?: number`, `footprint?: { w: number; h: number }` (stub;
    default treated as `{w:1,h:1}`). Document each with a terse comment.
  - `src/data/buildables.ts`: populate `buildTimeMs` per entry (wall/campfire/spike_trap) using the
    current `BUILD_MS` (2500) as the default value so behaviour is unchanged; leave `icon` unset for
    now (fallback handles it); do not set `footprint` (implicit 1×1).
  - `src/scenes/GameScene.ts` `runBuild` (`~:1404-1406`): read `def.buildTimeMs ?? BUILD_MS` instead
    of the bare constant. Add a small pure helper `buildTimeFor(def)` in `BuildManager` or a systems
    module so it's unit-testable.
  - Side effects: `BUILD_MS` stays as the fallback default (do not delete). Grep for other `BUILD_MS`
    readers and confirm none regress.
  - Docs: none yet (STATUS/CONVENTIONS updated in Step 10).
  - Done when: `npm test` passes; a unit test asserts `buildTimeFor` returns the per-buildable value
    and falls back to `BUILD_MS`; game still builds each structure in the same time as before.

- [ ] **Step 2: Textured, orientation-aware ghost sprite** `[inline]`
  - Replace the flat `Phaser.GameObjects.Rectangle` ghost (`BuildManager.ts:103-106`) with a real
    structure sprite (a `Phaser.GameObjects.Sprite`/`Image` using the buildable's in-world texture/
    frame). `updateGhost` must now read `placeFacing` and set the frame + `setFlipX` reusing the exact
    `orient`/flip mapping in `WallBehavior.ts:88-94` (extract that mapping into a shared pure helper so
    ghost and behavior agree). Tint/alpha green for valid, red for invalid via existing
    `COLORS.ghostValid/ghostInvalid`; keep the 50% alpha feel.
  - For non-orientable buildables (campfire/trap) show the single frame, no facing arrow.
  - Side effects: `TaskGlowRenderer` outlines sites via `site.rect` — ensure the ghost swap doesn't
    break the *blueprint* rect (the ghost and the placed blueprint are distinct; only the ghost
    changes here). `finishSite`/`createBlueprint` untouched.
  - Docs: none.
  - Done when: entering build with the wall selected shows a wall-shaped ghost that visibly re-orients
    (and flips for `left`) as `build:rotate` fires; campfire/trap show their sprite; boot smoke passes.

- [ ] **Step 3: Blueprint Mode shell — dim + snap grid + pan enable** `[inline]`
  - Add a `blueprint`-mode signal. Simplest: reuse the existing `buildMode` boolean as the trigger
    (entering build = Blueprint Mode) and emit the already-wired `build:modeChanged`; **only add new
    surface for the visuals**, not a whole new mode enum, to match the ad-hoc precedent
    (`GameScene.ts:1647-1658`). Preserve build↔demolish mutual exclusion.
  - **Dim overlay:** a full-canvas dim while build mode is active. Prefer a DOM sibling in the HUD
    (`GameHud.tsx` ActionLayer area, gated on store `buildMode`) styled like the vignette layer
    (`:186-240`) so it needs no Phaser render changes; `pointer-events:none` so taps fall through.
  - **Snap grid:** a Phaser grid overlay (graphics/tile-sized lines) drawn over the buildable area
    while in build mode, using a new `COLORS.snapGrid` (add to `config.ts:652-669`). Show only within
    the current camera view for perf; hide on exit.
  - **Enable camera pan in build mode:** in `PointerInputController`, stop the unconditional early
    return for build-mode moves (`:140-143`) — when the line tool is **off** (Step 6 adds the flag;
    until then treat as off), a drag past `DRAG_PX` should pan via the existing pan block (`:180-195`).
    Keep pinch working.
  - Side effects: verify demolish mode does not inherit the dim/grid; confirm movepad gate
    (`isMovepadHeld`) still suppresses world pan.
  - Docs: none.
  - Done when: entering build dims the world + shows the snap grid; a drag pans the camera; leaving
    build restores everything; demolish is unaffected.

- [ ] **Step 4: Rotation ring control + `R`-key parity** `[inline]`
  - A HUD **rotation ring** rendered around the ghost/anchor (or a fixed thumb-reachable ring) that,
    on tap/drag of its quadrants, emits the existing `build:rotate` inbound event; light the current
    facing. Mirror the thumb-zone control pattern (`CommandBar.tsx` fight cluster) and
    `pointer-events-auto`. Only show when the selected buildable is `orientable`.
  - Keyboard parity: bind `R` (and optionally `Shift+R` reverse) in the scene's key handling to emit
    `build:rotate`, matching existing keybind patterns.
  - Side effects: `build:rotate` handler already exists (`BuildManager.rotatePlacement`) — no new
    world logic, just new emitters. Ensure the ring doesn't intercept paint drags (position/hit-area).
  - Docs: none.
  - Done when: the ring rotates the ghost on touch, `R` does the same on desktop, current facing is
    lit, and the ring hides for non-orientable buildables.

- [ ] **Step 5: Pending-run model + affordability (BuildManager)** `[inline]`
  - Add a **pending run** to `BuildManager`: an ordered list of `{col,row,facing}` for an in-progress
    straight run, plus methods `beginRun(anchor)`, `extendRun(tile)` (axis-lock to dominant axis vs
    anchor; dedupe repeats), `clearRun()`, and a selector returning `{ tiles, placeableCount,
    affordableCount, totalCost }`. Placeability reuses the existing `tilePlaceable` gate; affordability
    computes the running cumulative cost vs `Inventory` and marks the cutoff index.
  - Render each pending tile as a ghost (reuse Step 2 ghost sprite), tinted valid up to
    `affordableCount`, invalid beyond. **No spend, no blueprint** yet.
  - Keep single-tap placement (`placeOrEnqueueBuild`) as-is (immediate spend+enqueue) for one-offs.
  - Side effects: none outside BuildManager; keep the run state cleared on mode exit / select change.
  - Docs: none.
  - Done when: unit tests cover axis-lock (row vs column pick), dedupe, and the affordable-subset
    cutoff (e.g. 4-affordable of 7-placeable given N wood); no resources are spent by building a run.

- [ ] **Step 6: Line-tool toggle + straight-line drag paint (input)** `[inline]`
  - Add a **line-tool toggle** FAB to the build thumb zone (HUD), reflecting an armed flag over the
    bridge (new `InboundEvent` `build:lineTool` {on} + `wireBus` row + a scene/BuildManager flag).
  - In `PointerInputController`, when in build mode **and line tool armed**: `pointerdown` →
    `deps.onBuildRunBegin(pointer)`; `pointermove` → `deps.onBuildRunExtend(pointer)` painting each new
    tile via a per-gesture `Set` mirroring `paintedThisGesture` (`:70,232-238`); `pointerup` ends the
    gesture (run stays pending for commit). When line tool **off**, keep Step 3 behaviour (tap places
    one, drag pans). Wire the new deps in `GameScene` to the Step 5 `beginRun`/`extendRun`.
  - Side effects: respect pinch (checked first) and the movepad gate; ensure the 3rd-finger
    pointer-count caveat (`:241-243`) doesn't misfire a paint — document if untouched.
  - Docs: none.
  - Done when: with the tool armed, a drag paints an axis-locked run of ghosts (deduped, no double
    placement); with it off, drag pans; toggling updates the FAB state.

- [ ] **Step 7: Commit bar HUD + commit handler (deferred spend + batch enqueue)** `[inline]`
  - A **commit bar** in the thumb zone (ActionLayer, `buildMode`-gated) showing `<affordable> of
    <placeable>` count, total cost, and **worker ETA** (`Σ buildTime` of the affordable subset, serial),
    with **Confirm** and **Cancel**. Fire on `pointerdown` (survive movepad hold) like combat buttons.
  - New inbound events: `build:commitRun` and `build:cancelRun` (+ `wireBus` rows + handlers). Commit
    handler: for the affordable subset only — `spend` each cost, `createBlueprint`, `enqueueBuild`
    (each appends cleanly, `dedupeOnEnqueue:false`), then `clearRun()`. Cancel → `clearRun()`.
  - Store/bridge: surface the pending-run summary (count/cost/eta) outbound so the bar can render it —
    new outbound event `build:runChanged` → store field, set from BuildManager whenever the run changes.
  - Side effects: single-tap placement remains outside this flow. Confirm must not fire if the run is
    empty. Verify inventory decremented by exactly the affordable subset.
  - Docs: none.
  - Done when: painting a run shows the live tally; Confirm queues exactly the affordable tiles and
    spends their cost; Cancel clears with no spend; scenario test covers paint→commit→build.

- [ ] **Step 8: Construction arc + world-space progress bar** `[inline]`
  - Wire `NodeFxManager.showActionProgress` (`:456`) into `runBuild` (`GameScene.ts:1398-1409`) so an
    active build site shows a world-space progress bar tracking `site.progress / buildTime`; hide on
    `finishSite`.
  - Construction animation: show a **scaffold** treatment on the site while building (a simple sprite/
    tint/tween is fine — reuse the wall Build strip that already plays on materialise, plus a
    during-build shimmer), settling to the finished sprite on completion. Keep it cheap.
  - Side effects: ensure the bar is removed if a build is cancelled/blocked; don't leak fx on scene
    restart. The alpha-ramp on the blueprint rect (`GameScene.ts:~1405`) can stay or be replaced by
    the bar — pick one to avoid double feedback.
  - Docs: none.
  - Done when: building any structure shows a progress bar + scaffold that resolves into the built
    sprite; no fx leaks after completion or restart; smoke passes.

- [ ] **Step 9: Structure icons (art + HUD `<img>` rendering)** `[inline]`
  - Render `<img src={`/assets/icons/${def.icon}`}>` (with `image-rendering:pixelated`) wherever
    buildables show today — build catalog (`BuildCatalog.tsx:99-103`), hotbar (`Hotbar.tsx:189-191`
    TODO), command bar tray, and the new commit bar — **falling back to the existing colour swatch**
    when `def.icon` is unset.
  - Produce structure-icon PNGs into `public/assets/icons/` and set `icon` on each buildable. Prefer
    the existing offline icon pipeline (`scripts/gen-icons/`) or bake from the composited tileset
    frames (editor `textureBaker.ts:222-275` approach adapted to a small headless/one-off script).
    Fetching the Gemini key follows `docs/MOBILE-EDITOR-ACCESS.md`; **keep the key in-memory only,
    never commit or echo it.**
  - Side effects: confirm no broken-image flashes (fallback covers missing files); assets are
    committed under `public/`.
  - Docs: note the new icons in the art/assets pipeline pointer if one lists item icons.
  - Done when: catalog/hotbar/commit bar show real structure art; a buildable with no `icon` still
    renders via swatch; build passes.

- [ ] **Step 10: Tests + docs** `[inline]`
  - **Unit** (`src/systems/__tests__/`): finalise coverage for `buildTimeFor`, axis-lock, run dedupe,
    affordable-subset cutoff, and ETA (`Σ buildTime`). Mirror `tasks.test.ts`/`orders.test.ts` style.
  - **Scenario** (`tests/e2e/`): a new `blueprint.spec.ts` mirroring `gestures.spec.ts` +
    `build.spec.ts` — arm line tool, paint an axis-locked run (clock-stepped, camera at MIN_ZOOM),
    assert N pending ghosts + tally, Confirm, assert exactly the affordable subset became build orders
    and inventory dropped by their cost, step the clock through the builds, assert `finishSite`.
  - **Docs (terse):** `docs/STATUS.md` — add the Blueprint Mode build overhaul under the build
    subsystem. `docs/CONVENTIONS.md` — note the build seam additions (pending-run model, line-tool
    flag, new `build:*` events: `lineTool`/`commitRun`/`cancelRun`/`runChanged`). `docs/ROADMAP.md` —
    tick build-UX if listed. `CLAUDE.md` Status line — one clause, keep it lean.
  - Side effects: keep the outbound/inbound event list in `docs/` (mirrored from plan 046) in sync.
  - Done when: `npm test` + `npm run e2e` + `npm run smoke` green; docs reflect the new seams.

## Out of scope

- Multi-tile footprints (>1×1) — field stubbed only; real multi-tile placement/collision is a later plan.
- L-shaped / rectangle / freehand paint — straight runs (row/column) only.
- Multiple concurrent builders / assigning the NPC companion to blueprint batches — single serial
  builder stays; ETA reflects that.
- Landscape-specific tuning — portrait-first, as with plan 046.
- Reworking the command-mode queue-paint or demolish gestures.
- Fixing the pre-existing 3rd-finger pinch pointer-count bug (`PointerInputController.ts:241-243`).
