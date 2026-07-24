# Blueprint Mode — Build Experience Overhaul

> Status: planned — run /execute-plan to begin.

## Summary

Turn placement from "a green square, one tap per tile" into a proper **Blueprint Mode**: entering
build dims the world and lights a snap grid, the ghost becomes a **real textured, orientation-aware
sprite** of the structure, a **rotation ring** wraps the cursor (touch + `R` keyboard parity), and a
**straight-run line-drag** paints a whole row/column of walls or traps in one gesture. A **commit bar**
in the thumb zone tallies the run's count + total cost + worker ETA behind one Confirm; construction
then plays a **scaffold → build → settle** arc with a **world-space progress bar**. Drawn mobile-first.

This is the **Blueprint Mode** direction — the third of three build-UI mockups explored for this
overhaul ([docs/build-ui-options.html](../docs/build-ui-options.html)). It is about the **build
interaction**, and is distinct from the HUD-skeleton A/B/C in [`docs/ui-overhaul/`](../docs/ui-overhaul/README.md)
(where *Twin Grip* was rejected and *Field Kit* shipped as plan 046) — do not conflate the two "C"s.

Solves the five gaps in today's build UX: (1) no image of the structure, (2) no rotation shown before
placement, (3) no build animation, (4) no progress bar, (5) one-tap-per-tile placement.

## Context & decisions

**Direction fit:** MVP path is complete; **base building** is a core pillar (CLAUDE.md / `docs/ROADMAP.md`).
`docs/ROADMAP.md`'s post-MVP list is content/systems (crafting, recruitment, hearth, more enemies) —
build-UX polish is *not* on the scheduled list, but it directly fulfils the documented UI intent
(`docs/ui-overhaul/` §4 flow + principle 8: "ghost + snap + confirm, place again"). Treated here as
the confirmed next focus; Step 11 records that decision in `docs/DECISIONS.md` + `docs/ROADMAP.md` so
it is on the record (CLAUDE.md mandates recording reusable decisions).

**Decisions taken in planning** (defaults chosen after the user deferred the question set; each cheap
to change):

- **Placement resolves on pointer *up*, not down** *(fixes critique #1)*. Today build placement fires
  on `pointerdown` (`GameScene.ts:671-674` `onBuildDown` → `placeOrEnqueueBuild`), which makes
  "tap places / drag pans" impossible — a pan would drop **and charge for** a tile on touch-down, and
  `onPointerUp` currently early-returns for build mode (`PointerInputController.ts:209`). Fix: on down,
  **arm** (update ghost + record anchor, no placement); classify the gesture on move (drag past
  `DRAG_PX` → pan or paint) and on up (never dragged → single-tap placement). This is Step 3 and must
  land before pan is enabled.
- **Drag vs pan (mobile):** a **line-tool toggle** FAB in the thumb zone. Tool OFF → one-finger drag
  **pans the camera** (newly enabled in build mode), tap places a single tile (on release). Tool ON →
  one-finger drag **paints a straight run**. Pinch-zoom unchanged in both. Chosen over long-press
  because long-press is already the *command-mode* queue-paint gesture (`PointerInputController.ts:166-178`)
  — and that command-mode paint/tap-order block must be **gated off for build mode** when the build
  early-returns are removed (Step 3), or a build-mode move would fall through into it.
- **Spend semantics — deliberately split** *(addresses critique #4)*. A **single tap** places and
  spends **immediately on release** (one action). A **run** paints pending ghosts (spends nothing) and
  defers spend to **Confirm**. This asymmetry is intentional, not an oversight: the user's own "no
  multiple clicks for a single item" constraint means a lone placement must **not** require a separate
  Confirm, whereas a batch warrants a review/commit step. Both paths share the same placeability/ghost
  code (Step 5's run model wraps a single tile as a length-1 run for rendering/validity); only the
  spend+enqueue trigger differs.
- **Straight runs only:** a paint drag is **axis-locked** to the dominant axis (row or column) from
  the anchor tile. No L-shapes/rectangles (confirmed with user).
- **Affordability:** a run **queues only what's affordable**. Ghosts beyond the affordable count tint
  invalid; the commit bar reads e.g. "4 of 7 affordable"; Confirm queues just the affordable subset.
- **Footprint:** **deferred, field stubbed.** All buildables (wall/campfire/spike_trap) are 1×1. Add a
  `footprint?` field to `BuildableDef` but implement **1×1 only**; multi-tile is a later plan.
- **Icons:** add an `icon?` field to `BuildableDef` and render `<img>` as items do
  (`PackDrawer.tsx:90-97`, `public/assets/icons/`), with a **colour-swatch fallback** when `icon` is
  absent so mode logic never blocks on art. Real structure-icon PNGs are a **separable follow-up**
  (Step 10) — the fallback fully de-risks the interaction work.
- **Blueprint Mode == build mode:** entering build mode *is* Blueprint Mode (dim + grid + ring); no
  separate sub-toggle. Stays mutually exclusive with demolish, wired manually as today.

**Key patterns/files to mirror** (from research; all `file:line` in repo):

- **Gesture engine:** `src/scenes/input/PointerInputController.ts` — one class resolving all pointer
  mechanics via `PointerInputDeps` callbacks (`:23-44`). Build-down (places today) `:127-129`;
  build-move (ghost only, early-returns before pan) `:140-143`; `onPointerUp` build early-return
  `:209`. **Command-mode queue-paint is the drag-paint template**: `queuePainting`/`paintQueueAt`/
  `paintedThisGesture` (`:69-70,166-178,232-238`). Pan `:180-195`; pinch `:110-118,133-139,269-285`.
  Pointer-count caveat (3rd finger) `:241-243`.
- **Build wiring in scene:** `GameScene.ts` — `onBuildDown`/`onBuildMove` deps (`:671-675`),
  `enqueueBuild` dep (`:568`), `runBuild` accumulate→`finishSite` (`:1398-1409`), `wireBus()` table
  (`:814-844`), mode booleans + hand-wired mutual exclusion (`:1615-1622,1647-1658`).
- **Placement core:** `src/scenes/build/BuildManager.ts` — ghost Rectangle (`:103-106`), `updateGhost`
  (`:174-183`, does **not** read facing today), `select`/`toggleBuild` (`:217-222,335-339`),
  `placeOrEnqueueBuild`/`tryPlaceAt` (spends per tile, `:186-213`), `createBlueprint` (stamps `facing`,
  `:255-267`), `finishSite` (`:280-310`).
- **Orientation art to reuse:** `WallBehavior.ts` — `orient` ∈ down|side|up, `barricadeBuildKey`/
  `barricadeDestroyKey` with `setFlipX` for `left` (`:88-94`), Build strip on materialise (`:98-105`).
- **World-space progress bar (ready to reuse):** `src/scenes/fx/NodeFxManager.ts` `showActionProgress`
  (`:456`) — takes an **Image/Sprite** to anchor to (salvage/clear bar); not yet wired to builds.
- **Config:** `BUILD_MS = 2500` global (`config.ts:143`), `COLORS.ghostValid/ghostInvalid/blueprint/
  queued` (`:657-659`), zoom clamps (`:167-169`).
- **Data:** `BuildableDef` (`src/data/types.ts:140-175`, has `category`/`orientable`, no `icon`);
  entries in `src/data/buildables.ts`.
- **HUD seam:** `#hud-root` is `pointer-events:none`, controls opt in with `pointer-events-auto`
  (`CommandBar.tsx:86`). Bottom `ActionLayer` (`GameHud.tsx:111-143`) is where a commit bar/FAB
  belongs, mode-gated. HUD→world = new `InboundEvent` variant (`bridge.ts:80-106`) + `wireBus` row +
  handler. Combat buttons fire on `pointerdown` to survive a movepad hold (`CommandBar.tsx:46-60`) —
  the Confirm/FAB pressed mid-drag needs the same treatment. Full-screen effect precedent = DOM
  vignettes (`GameHud.tsx:186-240`).
- **Tasks/orders:** `systems/tasks.ts` (`append`/`all`), build order batchable
  (`ORDER_META.build.dedupeOnEnqueue = false`, `orders.ts:72`); per-site data lives on `BuildSite`,
  not the `Action`. Single serial builder (the player) — ETA must be `Σ buildTime` serial.
- **Tests:** unit in `src/systems/__tests__/*.test.ts` (pure, no Phaser — mirror `tasks.test.ts`,
  `orders.test.ts`); scenario in `tests/e2e/*.spec.ts` via `window.game.__test` — mirror
  **`gestures.spec.ts`** (long-press→drag→multi-order, clock-stepped, camera pinned at MIN_ZOOM) and
  **`build.spec.ts`** (blueprint→build→blocking lifecycle). `applyScenario` seeds blueprints via
  `buildManager.createBlueprint` (`src/scenes/testApi.ts:362-363`).

**Constraints/gotchas:** placement-timing move (down→up) is the riskiest change — it touches the
single most load-bearing input path; do it first (Step 3) and lean on the scenario harness. A paint
drag re-hits the same tile every frame → per-gesture tile `Set` like `paintedThisGesture`. Big runs
build slowly (one serial worker). Keep any fetched image-gen key in-memory only (Step 10).

## Steps

- [x] **Step 1: Data model + per-buildable build time** `[delegate]`
  - Outcome: added `icon?`/`buildTimeMs?`/`footprint?` (stub) to `BuildableDef` (`src/data/types.ts`); set `buildTimeMs: 2500` on all 4 entries (`src/data/buildables.ts`); new pure module `src/systems/buildTime.ts` (`buildTimeFor(def) => def.buildTimeMs ?? BUILD_MS`) + `src/systems/__tests__/buildTime.test.ts` (4 cases); `runBuild` in `GameScene.ts` now routes through `buildTimeFor` (dropped direct `BUILD_MS` import). Only remaining `BUILD_MS` readers: its def in `config.ts` + the fallback in `buildTime.ts`. `npm test` 996 pass; typecheck clean. No deviations.
  - `src/data/types.ts`: add optional `BuildableDef` fields — `icon?: string` (PNG under
    `public/assets/icons/`), `buildTimeMs?: number`, `footprint?: { w: number; h: number }` (stub;
    absent ⇒ treated as `{w:1,h:1}`). Terse comment each.
  - `src/data/buildables.ts`: set `buildTimeMs` per entry to the current `BUILD_MS` (2500) so timing is
    unchanged; leave `icon` unset (fallback handles it); no `footprint` (implicit 1×1).
  - Add a pure helper `buildTimeFor(def)` (in a systems module) and use it in `runBuild`
    (`GameScene.ts:~1404-1406`) as `def.buildTimeMs ?? BUILD_MS`. Keep `BUILD_MS` as the fallback.
  - Side effects: grep other `BUILD_MS` readers; confirm none regress.
  - Docs: none yet (Step 11).
  - Done when: `npm test` passes; a unit test asserts `buildTimeFor` returns the per-buildable value
    and falls back to `BUILD_MS`; every structure builds in the same time as before.

- [x] **Step 2: Textured, orientation-aware ghost sprite** `[inline]`
  - Outcome: ghost is now a `Phaser.GameObjects.Sprite` (was `Rectangle`) in `BuildManager.ts` via new `applyGhostAppearance()` (called from constructor/`select`/`rotatePlacement`/`reset`/`updateGhost`), tinted valid/invalid at 0.5 alpha. New `src/scenes/build/ghostTexture.ts` (`ghostTextureFor(scene, buildableId, facing)`) resolves each buildable's in-world texture/frame/flip (wall→`barricadeDestroyKey`, workbench→`resolveDecorDraw`, campfire→`campfireBaseKey`, trap→`spikeTrapKey`). Facing→(orient,flipX) mapping extracted to new pure `src/systems/wallOrientation.ts` and `WallBehavior.ts` refactored to use it (byte-for-byte identical). `createBlueprint`/`TaskGlowRenderer` untouched. typecheck clean, 996 unit pass, build + smoke canary pass. Minor: also handled workbench ghost (plan named only campfire/trap); campfire ghost preview slightly larger than in-world (didn't duplicate CampfireBehavior private constants) — cosmetic, acceptable.
  - Replace the flat `Rectangle` ghost (`BuildManager.ts:103-106`) with a real structure sprite
    (`Sprite`/`Image` using the buildable's in-world texture/frame). `updateGhost` reads `placeFacing`
    and sets frame + `setFlipX`, reusing the exact `orient`/flip mapping in `WallBehavior.ts:88-94` —
    **extract that mapping into a shared pure helper** so ghost and behavior can't drift. Valid/invalid
    via `COLORS.ghostValid/ghostInvalid` tint at ~50% alpha. Non-orientable (campfire/trap) show the
    single frame.
  - Side effects: the *blueprint* rect (`createBlueprint`) and `TaskGlowRenderer` (outlines `site.rect`)
    are unchanged — only the pre-placement ghost changes.
  - Docs: none.
  - Done when: the wall ghost is wall-shaped and re-orients (flips for `left`) as `build:rotate` fires;
    campfire/trap show their sprite; boot smoke passes.

- [x] **Step 3: Build-mode input rework — pointer-up tap, pan enable, gate command-paint** `[inline]`
  *(critique #1 — the load-bearing change; do first, before any pan/paint UX)*
  - Outcome: `PointerInputController.ts` — `onBuildDown` now arms only (`updateGhost`, no spend); new `onBuildUp` dep does single-tap place+spend on release ONLY if never dragged (guarded by `isPanning`). Build-move early-return removed → build-mode drag falls through to the shared pan block; command-mode long-press/queue-paint block gated `if (!buildMode && getMode()==='command')`. `GameScene.ts` deps rewired (`onBuildDown: updateGhost`, `onBuildUp: placeOrEnqueueBuild`). Movepad gate + pinch preserved. Two new specs in `tests/e2e/build.spec.ts` (tap places 1 on release / drag pans+charges nothing) PASS; `gestures.spec.ts` still passes (command-mode byte-for-byte). typecheck clean, 996 unit pass. Deviation: no separate anchor-tile field (reused `isPanning`); movepad gate also applied to build-mode pointer-up for consistency.
  - Move single-tap placement from `pointerdown` to `pointerup`: split the build deps so `onBuildDown`
    only **arms** (update ghost, record anchor tile, no placement/spend); add `onBuildUp` that resolves
    a **single-tap placement** (existing immediate spend+enqueue via `placeOrEnqueueBuild`) **only if
    the gesture never became a drag**. Rework the build-mode early-return in `onPointerUp`
    (`PointerInputController.ts:209`).
  - Enable one-finger **camera pan** in build mode: stop the unconditional early return at
    `PointerInputController.ts:140-143` so a build-mode drag past `DRAG_PX` reaches the pan block
    (`:180-195`) when the line tool is off (treat as off until Step 6).
  - **Gate the command-mode long-press/queue-paint & tap-order block (`:166-178`) OFF for build mode**
    so a build-mode move can't fall through into it.
  - Side effects: highest-risk step — the tap/drag classifier affects every build interaction. Verify
    the movepad gate (`isMovepadHeld`) still suppresses world pan; verify command-mode gestures are
    byte-for-byte unchanged.
  - Docs: none.
  - Done when: in build mode a drag **pans without placing or charging**; a tap places+spends exactly
    one tile **on release**; command-mode tap-to-order and long-press paint are unaffected; scenario
    test covers tap-vs-drag in build mode.

- [x] **Step 4: Blueprint Mode visuals — dim overlay + snap grid** `[inline]`
  - Outcome: DOM dim layer `BuildDim` in `GameHud.tsx` (gated on the pre-existing store `buildMode`, `pointer-events:none`, vignette-style transition, testid `hud-build-dim`); Phaser snap grid in `BuildManager` (`snapGrid` Graphics depth 5, `syncSnapGrid()` culls to `cameras.main.worldView` + redraws each frame from `GameScene.update()`, cleared/hidden on mode exit, torn down in `reset()`/`destroy()`). New `COLORS.snapGrid` + `BUILD_DIM_COLOR/ALPHA/MS` config consts. Demolish shows neither (dim gates on `buildMode`, grid on `buildManager.buildMode`; demolish never sets it). typecheck clean, 996 unit pass, smoke canary pass. Deviation: added 3 `BUILD_DIM_*` config consts beyond the named `snapGrid` (matches config-driven vignette convention).
  - Reuse the existing `buildMode` boolean as the trigger (entering build = Blueprint Mode), emitting
    the already-wired `build:modeChanged`; add only the visual surface, matching the ad-hoc mode
    precedent (`GameScene.ts:1647-1658`). Preserve build↔demolish mutual exclusion.
  - **Dim overlay:** full-canvas dim while build mode is active — a DOM sibling in the HUD
    (`GameHud.tsx` ActionLayer, gated on store `buildMode`), styled like the vignette layer
    (`:186-240`), `pointer-events:none` so taps fall through.
  - **Snap grid:** a Phaser grid overlay over the buildable area while in build mode, new
    `COLORS.snapGrid` (`config.ts:652-669`); draw only within the camera view; hide on exit.
  - Side effects: demolish must not inherit dim/grid.
  - Docs: none.
  - Done when: entering build dims the world + shows the grid; leaving restores both; demolish clean.

- [x] **Step 5: Pending-run model + affordability (BuildManager)** `[inline]`
  - Outcome: new pure `src/systems/buildRun.ts` (`runAxis`, `runTiles` axis-locked + inherently deduped, `selectRun` → `{tiles, placeableCount, affordableCount, totalCost, etaMs}`; affordable = cumulative-cost prefix, eta = affordableCount × buildTime serial) + 13 unit tests (`buildRun.test.ts`). `BuildManager` holds `runAnchor`/`pendingTiles`/`runGhosts` pool with `beginRun`/`extendRun`(recomputes full line)/`clearRun`/`runSelection()`; `applyGhostAppearance` refactored to shared `applyAppearanceTo` so pool + hover ghost can't drift; pending tiles rendered valid iff `i < affordableCount && placeable[i]`. Run cleared on mode exit/select/reset; pool destroyed on SHUTDOWN. NO spend/blueprint. New `heldCounts()` dep → `inv.snapshot()`. typecheck clean, 1009 unit pass, smoke pass.
  - Add a **pending run** to `BuildManager`: ordered `{col,row,facing}` list + `beginRun(anchor)`,
    `extendRun(tile)` (axis-lock to dominant axis vs anchor; dedupe repeats), `clearRun()`, and a
    selector `{ tiles, placeableCount, affordableCount, totalCost, etaMs }` (eta = `Σ buildTimeFor`
    over the affordable subset, serial). Placeability reuses `tilePlaceable`; affordability walks
    cumulative cost vs `Inventory`. A single tile is a length-1 run for rendering/validity (shared
    code with Step 3's tap path). Render each pending tile as a Step-2 ghost, valid up to
    `affordableCount`, invalid beyond. **No spend, no blueprint yet.**
  - Side effects: contained to BuildManager; clear the run on mode exit / select change.
  - Docs: none.
  - Done when: unit tests cover axis-lock (row vs column), dedupe, affordable-subset cutoff, and eta;
    building a run spends no resources.

- [x] **Step 6: Line-tool toggle + straight-line drag paint (input)** `[inline]`
  - Outcome: `lineTool` flag lives on `GameScene` (source of truth), read by `PointerInputController` via new `isLineTool()` dep (mirrors `isBuildMode`). New deps `onBuildRunBegin`/`onBuildRunExtend` → `BuildManager.beginRun`/`extendRun` (pointer→tile via `worldToTile`). Armed build-mode gesture: down→beginRun, move→`paintRunAt` (per-gesture `runExtendedThisGesture` Set dedupes new tiles, mirrors `paintedThisGesture`; returns before pan classifier), up→ends gesture, run stays pending (no commit). Tool-off = byte-for-byte Step-3 path. New `build:lineTool {on}` inbound + `build:lineToolChanged` outbound (`bridge.ts`/`store.ts`); new `LineToolFab.tsx` in `GameHud` ActionLayer, gated on `buildMode`, fires on pointerdown, mirrors store state. Pinch checked first, movepad gate applies. typecheck clean, 1009 unit pass, smoke pass. Note for Step 7: an armed single tap begins a length-1 pending run (committed via the commit bar).
  - Add a **line-tool toggle** FAB to the build thumb zone (new `InboundEvent` `build:lineTool` {on} +
    `wireBus` row + a flag). When build mode + tool armed: `pointerdown` → `onBuildRunBegin`;
    `pointermove` → `onBuildRunExtend` painting each new tile via a per-gesture `Set` mirroring
    `paintedThisGesture` (`:70,232-238`); `pointerup` ends the gesture (run stays pending). When tool
    off, keep Step 3 behaviour (tap places on up, drag pans). Wire deps to Step 5's `beginRun`/
    `extendRun`.
  - Side effects: respect pinch (checked first) and the movepad gate; note the 3rd-finger caveat
    (`:241-243`) is pre-existing and out of scope.
  - Docs: none.
  - Done when: armed → drag paints an axis-locked, deduped run of ghosts; off → drag pans; the FAB
    reflects state.

- [x] **Step 7: Commit bar HUD + commit handler (deferred spend, batch enqueue)** `[inline]`
  - Outcome: `BuildManager.commitRun()` (spends + `createBlueprint` + `enqueueBuild` for the affordable-prefix ∩ placeable subset, then `clearRun`; no-ops on empty run) + `emitRunChanged()` on every run mutation. New outbound `build:runChanged` → store `runTally` (`RunTally`); new inbound `build:commitRun`/`build:cancelRun` (`bridge.ts` union + `wireBus` rows → `commitRun`/`clearRun`). New `src/hud/components/CommitBar.tsx` in `GameHud` ActionLayer, gated `buildMode && runTally.tileCount>0`, shows `<affordable> of <placeable>` + cost + ~Ns ETA, Confirm/Cancel fire on pointerdown. Single-tap path untouched. `runSelection()` added to `__test` surface. New `paintRun` helper + 2 commit-bar specs in `build.spec.ts`. typecheck clean, 1009 unit pass, all 7 `build.spec.ts` e2e pass. Deviation: commits affordable∩placeable (matches valid-tint preview, prevents blueprinting unplaceable tiles); smoke not run (needs separate preview server) — real-browser e2e exercised the path instead.
  - **Commit bar** in the thumb zone (ActionLayer, `buildMode`-gated), showing `<affordable> of
    <placeable>` count, total cost, and worker **ETA** from Step 5's selector, with **Confirm** +
    **Cancel**; fire on `pointerdown` (survive movepad hold) like combat buttons.
  - New inbound events `build:commitRun` + `build:cancelRun` (+ `wireBus` rows + handlers). Commit: for
    the affordable subset only — `spend` each cost, `createBlueprint`, `enqueueBuild` (appends cleanly,
    `dedupeOnEnqueue:false`), then `clearRun()`. Cancel → `clearRun()`.
  - Outbound `build:runChanged` → store field so the bar renders the live tally; set from BuildManager
    whenever the run changes.
  - Side effects: single-tap placement (Step 3) stays outside this flow; Confirm no-ops on an empty
    run; verify inventory drops by exactly the affordable subset.
  - Docs: none.
  - Done when: painting a run shows the live tally; Confirm queues exactly the affordable tiles and
    spends their cost; Cancel clears with no spend; scenario test covers paint→commit→build.

- [x] **Step 8: Rotation ring control + `R`-key parity** `[inline]`
  - Outcome: new `src/hud/components/RotationRing.tsx` — fixed thumb-zone compass (3×3 grid, 4 quadrant buttons fire on pointerdown), rendered in `GameHud` ActionLayer gated `buildMode && orientable` (orientable already in store), highlights the current facing. `facing` added to store via new outbound `build:facingChanged` (emitted by `BuildManager` on rotate/select/reset + GameScene restart; mirrors the `lineToolChanged`/`runChanged` pattern). Drag-safe: wrapper `pointer-events-none`, only buttons opt back in. `R`/`Shift+R` bound in `wireBus()` (first Game-scene key binding), gated to build mode → `build:rotate`. `rotatePlacement` + `build:rotate` payload extended backward-compatibly: no-arg = forward cycle (legacy CommandBar button unchanged), `{dir:-1}` reverse, `{to}` jump (ring uses `{to}` for a directional compass). typecheck clean, 1009 unit pass; smoke deferred to Step 11 (preview-server dependent).
  - A **fixed, thumb-reachable** rotation ring in the HUD (not tracking the moving world ghost — avoids
    per-frame world→screen mapping, critique #7) whose quadrants emit the existing `build:rotate`;
    light the current facing. Mirror the fight-cluster thumb pattern (`CommandBar.tsx:202-224`),
    `pointer-events-auto`. Show only when the selected buildable is `orientable`.
  - Bind `R` (optionally `Shift+R` reverse) in scene key handling to emit `build:rotate`.
  - Side effects: `build:rotate` handler already exists (`rotatePlacement`) — emitters only. Ensure the
    ring doesn't intercept paint drags.
  - Docs: none.
  - Done when: the ring rotates the ghost on touch, `R` on desktop, facing is lit, hidden for
    non-orientable buildables.

- [x] **Step 9: Construction arc + world-space progress bar** `[inline]`
  - Outcome: `BuildSite.scaffold` field (`src/entities/types.ts`); `BuildManager` lazily creates one scaffold Sprite per active build (`ensureScaffold`, positioned at tile center, depth-sorted, alpha 0.7, textured via the shared `applyAppearanceTo`/`ghostTextureFor` path — no new art), settles it in `finishSite` (structure's own Build strip), destroys via `clearScaffold`/`clearScaffolds`/`reset`. `runBuild` (`GameScene.ts`) anchors `NodeFxManager.showActionProgress` to the scaffold sprite (not the `Rectangle` — critique #5), driven by `site.progress / buildTimeFor(def)`, hidden on completion; old blueprint-rect alpha-ramp deleted (single feedback). Leak teardown at the `beginCurrent` chokepoint (`clearScaffolds` + `hideAllActionProgress`) covers cancel/block/switch, plus reset/SHUTDOWN. typecheck clean, 1009 unit pass, 7/7 `build.spec.ts` e2e pass. No deviations from intent.
  - Add a **scaffold sprite** (an `Image`/`Sprite`) on the site while building, and wire
    `NodeFxManager.showActionProgress` **anchored to that scaffold sprite** (not `site.rect`, which is
    a `Rectangle` — critique #5) tracking `site.progress / buildTimeFor(def)`; hide on `finishSite`,
    settling into the finished sprite (reuse the wall Build strip). Keep it cheap.
  - Side effects: remove the bar if a build is cancelled/blocked; no fx leak on scene restart. Pick
    **one** progress feedback — the bar — and drop the old alpha-ramp on the blueprint rect
    (`GameScene.ts:~1405`) to avoid double feedback.
  - Docs: none.
  - Done when: building shows a progress bar + scaffold resolving into the built sprite; no fx leaks;
    smoke passes.

- [~] **Step 10: Structure icons (separable follow-up)** `[inline]` — CODE PART DONE; icon-art generation DEFERRED (follow-up)
  - Outcome (code part): new shared `src/hud/components/BuildableIcon.tsx` (`{def, className?, fallback}` — renders pixel-crisp `<img src={iconUrl(def.icon)}>` when `icon` set, else the caller's `fallback`). Wired into `BuildCatalog.tsx` (icon vs colour swatch), `Hotbar.tsx` `SlotContent` (icon vs name text; dropped stale TODO), `CommandBar.tsx` build tray chip (icon-only slot, `null` fallback). `CommitBar.tsx` skipped — `RunTally` has no buildable identity, no natural slot. No buildable sets `icon` yet, so visuals are byte-for-byte unchanged; the `<img>` path activates once icon files land. typecheck clean, 1009 unit pass, build compiles.
  - DEFERRED (not done): generating structure-icon PNGs into `public/assets/icons/` via the Gemini pipeline over Tailscale/guppi + setting `icon` per buildable + the art/assets doc pointer. Left as a separate follow-up (per session decision to avoid external-service connection here); swatch fallback fully covers the gap.
  - Render `<img src={`/assets/icons/${def.icon}`}>` (`image-rendering:pixelated`) wherever buildables
    show — build catalog (`BuildCatalog.tsx:99-103`), hotbar (`Hotbar.tsx:189-191` TODO), command-bar
    tray, commit bar — **falling back to the colour swatch** when `def.icon` is unset.
  - Produce structure-icon PNGs into `public/assets/icons/` and set `icon` per buildable, via the
    existing offline pipeline (`scripts/gen-icons/`) or a baked tileset-frame render (adapt editor
    `textureBaker.ts:222-275`). Fetching the Gemini key follows `docs/MOBILE-EDITOR-ACCESS.md` — **keep
    it in-memory only, never commit or echo it.**
  - Side effects: this step is orthogonal to the interaction overhaul and carries the only external-dep
    risk; it can ship after Steps 1–9 without blocking them (swatch fallback covers missing icons).
  - Docs: note new icons in the art/assets pointer if one lists item icons.
  - Done when: catalog/hotbar/commit bar show real art; a buildable with no `icon` still renders a
    swatch; build passes.

- [ ] **Step 11: Tests + docs** `[inline]`
  - **Unit** (`src/systems/__tests__/`): finalise `buildTimeFor`, axis-lock, run dedupe,
    affordable-subset cutoff, ETA. Mirror `tasks.test.ts`/`orders.test.ts`.
  - **Scenario** (`tests/e2e/blueprint.spec.ts`): mirror `gestures.spec.ts` + `build.spec.ts` — assert
    (a) build-mode tap-vs-drag (tap places one on release, drag pans, no charge on pan); (b) arm line
    tool, paint an axis-locked run (clock-stepped, camera at MIN_ZOOM), N pending ghosts + tally;
    Confirm → exactly the affordable subset become build orders and inventory drops by their cost; step
    through the builds → `finishSite`.
  - **Docs (terse):** `docs/STATUS.md` — Blueprint Mode overhaul under the build subsystem;
    `docs/CONVENTIONS.md` — build-seam additions (pending-run model, pointer-up placement, line-tool
    flag, new `build:*` events `lineTool`/`commitRun`/`cancelRun`/`runChanged`); `docs/DECISIONS.md` +
    `docs/ROADMAP.md` — record build-UX as the chosen focus + link `docs/build-ui-options.html`
    (critique #2/#3); `CLAUDE.md` Status — one lean clause.
  - Side effects: keep the outbound/inbound event list in `docs/` in sync.
  - Done when: `npm test` + `npm run e2e` + `npm run smoke` green; docs reflect the new seams.

## Out of scope

- Multi-tile footprints (>1×1) — field stubbed only; real placement/collision is a later plan.
- L-shaped / rectangle / freehand paint — straight runs (row/column) only.
- Multiple concurrent builders / assigning the NPC companion to blueprint batches — single serial
  builder stays; ETA reflects that.
- Landscape-specific tuning — portrait-first, as with plan 046.
- Reworking command-mode queue-paint or demolish gestures (only gating them off in build mode).
- Fixing the pre-existing 3rd-finger pinch pointer-count bug (`PointerInputController.ts:241-243`).

## Critique

> Reviewed by a fresh sub-agent (critique-plan) after the first draft; findings below were folded into
> the plan above. **Verdict:** on-theme and factually well-grounded, but the original draft was blocked
> by one real defect — the "tap places / drag pans" model was incompatible with today's
> place-on-*pointerdown* architecture, with no step migrating it — plus a mis-named direction and a
> spend inconsistency.

|#|Finding|Severity|Resolution in this plan|
|-|-------|--------|-----------------------|
|1|Placement fires on `pointerdown` (`GameScene.ts:671-674`); "tap places / drag pans" can't hold — a pan first places+charges a tile; no step moved placement to pointerup.|High|**New Step 3** moves placement to pointer-up (resolve only if not a drag), reworks the `:209` return, enables pan, and gates command-paint off for build mode.|
|2|"Option C" premise not recorded in-repo; collides with the **rejected** *Twin Grip* (C) in `docs/ui-overhaul/`.|Medium|Mockup committed to `docs/build-ui-options.html`; Summary renamed to "Blueprint Mode" and disambiguated; decision recorded in Step 11.|
|3|Build-UX polish is off the scheduled post-MVP roadmap list.|Medium|Acknowledged in Direction fit; defensible via documented ui-overhaul intent; Step 11 records it in ROADMAP/DECISIONS.|
|4|Two divergent spend semantics (tap immediate vs run deferred).|Medium|Kept, but made **deliberate + documented** (single tap must be one action per the user's "no multiple clicks" rule); both share placeability/ghost code.|
|5|Step 8 progress bar anchored to a `Rectangle` (`site.rect`) but `showActionProgress` needs an `Image`.|Low|Step 9 anchors the bar to the new **scaffold Image/Sprite**.|
|6|Icons step (Gemini key over Tailscale) is orthogonal + the only ext-dep risk.|Low|Split into its own follow-up **Step 10**; swatch fallback de-risks Steps 1–9.|
|7|Rotation ring "around the ghost" (DOM) needs per-frame world→screen tracking.|Low|Step 8 commits to the **fixed thumb-reachable** ring.|
