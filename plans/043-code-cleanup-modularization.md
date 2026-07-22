# Code Cleanup & Modularization

> Status: in progress — Phase 1–3 complete (Steps 1–13, all committed+pushed on `claude/plan-43-szlkkd`);
> Phase 4–6 (Steps 14–19) remaining. Resume with /execute-plan. See "Execution handoff" at the foot.

## Summary

A repo-wide cleanup pass: break the 7 files over ~1000 lines into cohesive modules, fix clear code
smells / competing standards (log the contentious ones), and re-architect the seams that resist
extension — all while keeping the tree green at every step. The work is decomposed along two axes so
it fans out to sub-agents: **review lenses** (smells / standards / perf / extensibility — Phase 1,
parallel) and **area splits** (one oversized file per lane — Phase 3, parallel). Re-architecture
(Action-kind registry, perf fixes, cost consolidation) runs sequentially after the splits, then the
`optimise-context` skill runs on the always-loaded context tree, then docs + a final gate. Lands as
one PR on `claude/code-cleanup-modularization-s487ra`.

## Context & decisions

**User decisions (from planning):**

- **Change policy: full rework allowed** — modularize AND re-architect for extensibility/perf even
  where semantics shift. Reconciled with the parallelism ask by splitting each area's work into a
  *behavior-preserving mechanical split* (delegate, parallel) and a later *re-architecture* pass
  (inline, sequential).
- **Scope: everything** — all 7 oversized files (editor + game) + a structural/standards review
  across `src/`.
- **Standards: fix the clear ones, log the rest** — unambiguous fixes applied; judgment-call /
  contentious ones recorded in `docs/cleanup/` for a later decision (portals-parked, the disabled
  two-finger gesture, and the game-bus-vs-editor-Zustand split are *log*, not *touch*).
- **Landing: one big PR** on `claude/code-cleanup-modularization-s487ra`. NB this deviates from the
  repo's usual "work on master, no PRs" (WORKFLOW.md) — intentional for this session.
- **Extensibility optimizes for: adding content · editor tooling · testability** — so newly-extracted
  pure logic gets unit tests, the editor store/scene get cleaner extension seams, and the game's
  order-handling gets a registry mirroring `StructureManager`.
- **Timing vs roadmap (resolves critique #4):** NPC (plan 042) is the sole remaining MVP item, and
  this cleanup is a deliberate *enabler* for it, not a detour — the Action-kind registry (Step 14),
  the `entities/`+`scenes/` manager seams freed up by the GameScene/UIScene splits, and the
  pure-module testability all directly de-risk and cheapen the NPC work (a companion needs new order
  kinds, an entity subclass, and HUD surface — exactly the seams this pass cleans). Sequencing
  cleanup first trades one focused refactor now for cheaper, safer feature work after.
- **Done bar: full gate every step** — `npm run check` (typecheck + lint + lint:md + format:check +
  unit) **and** `npm run e2e` **and** `npm run smoke` **and** `npm run build` (editor + game) all
  green. For sequential steps this holds before the step is complete; for the Phase-3 parallel lanes
  the whole-tree gate runs **at integration** (see Execution model). The tree is never left broken on
  the branch tip.
- **Execution model for the parallel lanes (resolves critique #1): worktree-per-lane + gate at
  merge.** The full gate is a *whole-tree* invariant — `e2e`/`smoke`/`build` compile and exercise the
  entire tree — so it cannot be asserted per-lane while sibling lanes are mid-refactor on the same
  tree. Run each Phase-3 lane in its **own git worktree** (spawn its sub-agent with `Agent`
  `isolation: "worktree"`), each lane self-checking with `npm run check` locally; then integrate
  lanes back **one at a time**, running the full gate (`check` + `e2e` + `smoke` + `build`) on each
  merge. Parallel *editing* keeps the speed win; *gating* stays honest. Fallback if worktrees aren't
  used: edits parallel on the branch, verification serialized at integration — same merge-then-gate
  discipline, just without isolation.

**Safety net (from research):** `tests/e2e/refactor-tripwire.spec.ts` asserts a full `debugState()`
snapshot across a scripted sequence — designed to stay green on pure code moves and fail on behavior
change. Plus ~25 Tier-1 system specs and 14 editor-store / 14 editor-ops specs cover the pure
modules. **Thin-coverage risk areas: `UIScene.ts` (no unit tests — only e2e/smoke) and all editor
`.tsx` components (no component tests — only store/ops logic is unit-tested).** Lanes touching those
lean on the tripwire + e2e + editor build; call it out in those lanes.

**The hard rule for every mechanical-split lane (Phase 3):** *preserve each module's public export
surface.* Consumers import `editorStore`, `mapFormat`, `GameScene`, etc. by their current paths — a
split must keep those import paths and exported names working (use a barrel `index.ts` that
re-exports, or keep the original file as the barrel). This is what makes the lanes write-disjoint and
safely parallel: no lane edits another lane's consumers.

**Patterns to mirror (CONVENTIONS.md / STANDARDS.md):**

- Managers get `(scene, narrow-deps-closure)`, scene↔manager is a **direct call** (bus reserved for
  scene↔UIScene), **no manager↔manager coupling**, each registers `destroy()` on SHUTDOWN; one-shot
  non-stateful setup stays a free function.
- `entities/` = domain-state+sprite classes (no scene dependency past construction); `scenes/<concern>/`
  = managers needing the scene at call time.
- Data-driven: adding content = editing `src/data/`, not writing systems. `StructureManager`
  (`world/StructureManager.ts`) is the reference extension registry (behavior module + `register` +
  data entry).
- Naming: systems lowercase-by-domain, class-exporting modules PascalCase, no default exports
  (already consistent — keep it), events `'namespace:action'`, registry keys flat lowerCamelCase.
- TS `strict`, no `any` without a why-comment, `readonly` data records, comments = constraints/why.
- Markdown is model-context → token-lean; markdownlint (not Prettier) owns `.md`.

**Proposed new module layout (confirm during execution):**

|Source|Splits into|
|---|---|
|`editor/store/editorStore.ts`|`store/slices/*.ts` (document/tabs, tools, underlay, world, nodeDefs, resize, paint-tiles, walkability, zones, shape, terrain, layers, palettes, objects) + pure helpers beside their `*Ops.ts`; `editorStore.ts` stays the `create()` barrel composing slices|
|`editor/EditorScene.ts`|`editor/scene/{EditorInputController,EditorCameraController,textureBaker,overlaysRenderer,objectRenderer}.ts`; `EditorScene.ts` stays composition root|
|`editor/panels/LibraryPanel.tsx`|`panels/library/{cards,AtlasSheetPicker,AnimatedStripPicker,AssetReclassify}.tsx`; consumes shared `usePanZoom`|
|`editor/tabs/ObjectEditorTab.tsx`|`tabs/objectEditor/{ObjectEditorForm,RegionsEditor}.tsx` + pure `editor/regionGeometry.ts`; consumes `usePanZoom` + alpha helper|
|`scenes/GameScene.ts`|`scenes/combat/CombatController.ts` (+ dev/randomise helper); Action-registry in Phase 4|
|`scenes/UIScene.ts`|`scenes/hud/*` per-widget builders/view classes (build-palette, wellbeing, hud-bars, combat-controls, inspect, dev-menu)|
|`systems/mapFormat.ts`|`systems/mapFormat/{schema,parse,serialize,resize}.ts` + `index.ts` barrel (keeps `systems/mapFormat` import path)|

**Shared extractions (Phase 2, consumed by Phase 3):** `editor/hooks/usePanZoom.ts` (unifies the
duplicated pan/zoom viewport in `LibraryPanel.AtlasSheetPicker` and `ObjectEditorTab.RegionsEditor`),
`editor/zoom.ts` (one set of zoom min/max/step + clamp, replacing the twinned `ATLAS_ZOOM_*` /
`REGION_ZOOM_*`), `editor/regionGeometry.ts` (pure `normRect`/`resizeBox`/`clampN` — testable),
`editor/pixelAlpha.ts` (one canvas alpha-opacity read, dedupes `ObjectEditorTab` decode).

## Steps

### Phase 1 — Review lenses (parallel: A) — read-only, each writes its own findings doc

- [x] **Step 1: Code-smells lens** `[delegate]` (parallel: A)
  - Outcome: wrote `docs/cleanup/smells.md` (14 findings: High 4 / Med 6 / Low 4; [fix] 4, [log] 10).
    Seed line-refs drifted — real locations: wireBus mirror `GameScene.ts:773-843`, toggle/queue quartet
    `:1244-1326` (8 methods), parked portals `:264-266`/`416-418`/`300`. Null byte confirmed at
    `editorStore.ts:971` (offset 61841). **Correction:** the seeded "duplicated alpha decode"
    (`ObjectEditorTab.tsx:553-568`) is a *single* occurrence, not a duplicate — logged as an extraction
    candidate only (affects Step 6/10 framing). No `any` types in `src/`.
  - Read `src/` and produce `docs/cleanup/smells.md`: a severity-ranked table of concrete smells with
    `file:line` refs (god objects, duplicated logic, dead/parked code, magic numbers). Seeded by
    research: `GameScene.wireBus()` 28-on/28-off mirror (`GameScene.ts:639-687`), the toggle/queue
    quartet (`GameScene.ts:1093-1152`), duplicated pan/zoom viewport
    (`LibraryPanel.tsx:1367-1643` vs `ObjectEditorTab.tsx:505-end`), twinned zoom consts
    (`LibraryPanel.tsx:1358-1364` / `ObjectEditorTab.tsx:438-441`), duplicated alpha decode
    (`ObjectEditorTab.tsx:555-568`), the `editorStore.ts` null byte at offset 61841,
    `TWO_FINGER_GESTURE_ENABLED=false` (`EditorScene.ts:72`), parked portals
    (`GameScene.ts:234-236`), `assetSwatch.tsx` mixing consts+helpers+component.
  - Each row tagged **[fix]** (clear, mechanical) or **[log]** (contentious / needs a decision), so
    Phase 3/4 know what to apply.
  - Side effects: none (read-only + new doc).
  - Docs: creates `docs/cleanup/smells.md`.
  - Done when: doc exists, every finding has a `file:line` and a fix/log tag.

- [x] **Step 2: Competing-standards / consistency lens** `[delegate]` (parallel: A)
  - Outcome: wrote `docs/cleanup/standards.md` (6 rows: 1 [fix], 5 [log]). Config-vs-data cost split
    CONFIRMED — `spike_trap` cost is `SPIKE_TRAP_COST` in `config.ts:545` imported into `buildables.ts:5,57`
    while wall/campfire costs are inline (`:16,:34`); recommended resolution = inline the `{wood:5}` into
    buildables (Step 16). Only [fix] is a stale STANDARDS.md event-namespace list. Editor `ui/` lowercase
    (shadcn) vs PascalCase split and game-bus-vs-Zustand both tagged [log]/accepted. src/ already clean on:
    no default exports, event-name/registry-key shapes, no manager↔manager coupling, no non-test `any`.
  - Produce `docs/cleanup/standards.md`: inconsistencies vs STANDARDS.md/CONVENTIONS.md — module
    patterns, naming drift, event/registry-key conventions, the two state paradigms (game
    `game.events`+`registry` vs editor Zustand — document as an accepted split, tag **[log]**),
    config-vs-data cost duplication (`config.ts` vs `data/buildables.ts:5`). Tag [fix]/[log] per row.
  - Side effects: none.
  - Docs: creates `docs/cleanup/standards.md`.
  - Done when: doc exists with tagged rows.

- [x] **Step 3: Performance lens** `[delegate]` (parallel: A)
  - Outcome: wrote `docs/cleanup/perf.md` (9 items: 5 safe, 4 needs-review). **Two seed corrections:**
    `enemyManager.all()` returns the raw backing array — NO allocation, no fix (`EnemyManager.ts:157-159`);
    `syncGlowTransforms` is unconditional but iterates only `glowSprites` (empty when idle) — low cost.
    The two applicable safe `[fix]` items for Step 15: guard `syncEnemyHealthBars` on
    `enemies.length===0 && hpBars.size===0` (must gate on hpBars too, else stale bars leak,
    `CombatFxManager.ts:432-438`) and guard `syncGlowTransforms` on `glowSprites.size===0`. Everything
    heavier (env/closure churn in `EnemyManager`/`MonsterCharacter`/companion snapshot) is needs-review/[log].
  - Produce `docs/cleanup/perf.md`: per-frame allocation/iteration and redundant-work audit of the
    `update()` path — `enemyManager.all()` array returns + `fx.syncEnemyHealthBars` iterating all
    enemies each frame (`GameScene.ts:838-900`), `taskGlowRenderer.syncGlowTransforms()` running
    unconditionally (`GameScene.ts:813`), any other hot-loop work. Each item: cost, safe fix,
    behavior-risk (safe/needs-review). Tag [fix]/[log].
  - Side effects: none.
  - Docs: creates `docs/cleanup/perf.md`.
  - Done when: doc lists hot-path items with a proposed safe fix + risk tag each.

- [x] **Step 4: Extensibility lens** `[delegate]` (parallel: A)
  - Outcome: wrote `docs/cleanup/extensibility.md`. Action-kind registry (Step 14): adding one order kind
    today touches **8-9 sites across 4 files** (not the seed's "3+") — `Action` union `tasks.ts:7-14`,
    `switch` `GameScene.ts:1045`, `runX`, `beginCurrent` `:1134-1224`, enqueue de-dupe `:1245-1259`,
    `isXQueued`/`toggleX` quartet `:1268-1326`, `describeActionTarget` `:307`, `TaskGlowRenderer` highlight
    `:71-102`, opt. `ScenePicker.actionAt`. Proposed `OrderRegistry` mirroring `StructureManager`
    (`register(key,module)` + `behavior<M>`) collapsing 8→1 registration. Other seams: editor `TOOL_DEFS`
    data table (lower priority). Testability targets: order-registry decision core + `regionGeometry.ts`
    (primary), `zoom.ts` pure, `pixelAlpha.ts` thin/optional.
  - Produce `docs/cleanup/extensibility.md`: spots that resist "edit data, not code", biased to the
    three chosen goals (adding content · editor tooling · testability). Seeded: the `update()`
    `switch(action.kind)` (`GameScene.ts:873`) + toggle/queue quartet needing edits in 3+ places for a
    new order kind → propose an **Action-kind registry mirroring `StructureManager`**; editor
    tool→filter static record (`editorStore.ts:160`); which extracted modules should gain unit tests.
  - Side effects: none.
  - Docs: creates `docs/cleanup/extensibility.md`.
  - Done when: doc proposes concrete extension seams + a testability target list.

### Phase 2 — Shared foundations (parallel: B) — new files only, no consumer rewiring yet

- [x] **Step 5: Extract shared pan/zoom hook + zoom constants** `[delegate]` (parallel: B)
  - Outcome: created `src/editor/zoom.ts` (`ZOOM_MIN=1`/`ZOOM_MAX=8`/`ZOOM_STEP=0.5` + `clampZoom`) and
    `src/editor/hooks/usePanZoom.ts`. API: `usePanZoom(scale: number): PanZoom` — `scale` is passed IN
    (the two call sites compute base fit-scale differently: AtlasSheetPicker from a fixed px budget,
    RegionsEditor from a ResizeObserver). Exposes both ready-made `onCanvasPointerDown/Move/Up` (for the
    pan-only AtlasSheetPicker, Step 9) AND low-level `isPanTrigger`/`beginPan`/`movePan`/`endPan` +
    `spaceHeld`/`isPanning`/`zoom`/`setZoom`/`viewportRef`/`hoveringRef` (for RegionsEditor's larger
    draw/move/resize/pan drag union + panMode toggle, Step 10). Pointer capture left to the caller. Files
    unused for now. `npm run check` + `npm run build` green.
  - Create `src/editor/hooks/usePanZoom.ts` (mirror `hooks/useIsCompact.ts` style) capturing the
    shared viewport logic (`spaceHeld`/`isPanning`/`pendingAnchor`/`hoveringRef`/`viewportRef`/
    `onCanvasPointerDown/Move/Up` + clamp) common to `AtlasSheetPicker` and `RegionsEditor`. Create
    `src/editor/zoom.ts` exporting one `ZOOM_MIN/MAX/STEP` + `clampZoom`. **Do not edit
    `LibraryPanel.tsx`/`ObjectEditorTab.tsx` yet** — Phase 3 lanes rewire them.
  - Side effects: new files are initially unused (dead until Phase 3) — that compiles/lints fine.
  - Docs: none yet (CONVENTIONS update lands in Step 18).
  - Done when: files exist, `npm run check` + editor build green.

- [x] **Step 6: Extract pure region-geometry + alpha-opacity helpers with tests** `[delegate]` (parallel: B)
  - Outcome: created `src/editor/regionGeometry.ts` (exports `Handle` type, `clampN`, `normRect`,
    `resizeBox`; `Box` re-imported from `./regions`; UI-coupled `HANDLES`/`HANDLE_POS` left in the
    component for Step 10), `src/editor/pixelAlpha.ts` (framework-free RGBA→alpha maths only —
    `extractAlphaChannel(img)` + `alphaAt(channel,x,y)`; the DOM/canvas half stays in the component
    effect, wired in Step 10), and `src/editor/__tests__/regionGeometry.test.ts` (**27 cases** incl.
    pixelAlpha via a synthetic Uint8ClampedArray — no real canvas needed). `npm run check` green with the
    27 new tests in the run; `npm run build` green. Source lifted verbatim in behaviour (Step-10 tripwire relies on it).
  - Create `src/editor/regionGeometry.ts` (pure `normRect`/`resizeBox`/`clampN` lifted from
    `ObjectEditorTab.tsx:447-480`) and `src/editor/pixelAlpha.ts` (one canvas alpha-opacity read,
    generalizing `ObjectEditorTab.tsx:555-568`). Add `src/editor/__tests__/regionGeometry.test.ts`
    (and a small `pixelAlpha` test if feasible without a real canvas) — serves the testability goal.
    New files only; no consumer edits yet.
  - Side effects: initially unused; wired in Step 10.
  - Docs: none yet.
  - Done when: files + unit test exist, `npm test` covers the geometry module, full gate green.

### Phase 3 — Area decomposition lanes (parallel: C) — one oversized file per lane, public API preserved

Each lane runs in its own worktree; the full gate runs at merge, not per-lane (see Execution model).
Steps 8–13 are `[delegate]` (mechanical, API-preserving). **Step 7 is `[inline]`** (judgment-heavy —
see #2) but still edits a disjoint file, so it runs concurrently in its own worktree alongside the
delegate lanes — just driven inline, not blind-delegated.

- [x] **Step 7: Split `editorStore.ts` into Zustand slices** `[delegate]` (parallel: C) — *delegated per user (was [inline])*
  - Outcome: `editorStore.ts` 3662 → **93 lines** (barrel: one `create<EditorState>()(subscribeWithSelector(...))`
    composing 15 slices + re-exporting the full surface). 15 `store/slices/*` by domain (document/tools/underlay/
    world/nodeDefs/resizeRename/paint/walkability/zones/shape/terrain/layers/favourites/tilePalettes/objects) +
    `store/shared.ts` (history stack + reconcile helpers + `paletteSlotRotationKey`) + `store/types.ts`
    (`EditorState` + exported types + `EditorSlice` factory alias). Pure helpers moved: `buildShapeCommand`→
    `shapeOps`, `buildTerrainCommand`→`terrainOps`, `batchCommand`→`objectOps` (`defaultAuthoredNodeDef` +
    `blobToDataUrl`/`imageSizeFromDataUrl` co-located in their owning slice — no matching Ops file).
    **Full 15-symbol export surface preserved** (`useEditorStore`, `paletteSlotRotationKey`,
    `PLACEHOLDER_SKIN_ASSET`, `DECOR_ANIM_DEFAULT_FPS` + 11 types); NO consumer edited. **Null byte** (offset
    61841 in `paletteSlotRotationKey`) → `|`; safe (transient in-memory Record key, never persisted). Judgment:
    `EditorState` kept as ONE interface, slices typed `EditorSlice<Pick<EditorState,…>>` so the `create()`
    compile-verifies the Picks partition it. Cross-slice `get()/set()` calls all route through the combined
    store (verified by the specs). tsc 0 errors; eslint clean; **450** store+ops tests pass.
  - **Not a pure mechanical move (critique #2):** the ~120 actions cross-call each other via
    `get()`/`set()` across domains, so slicing needs judgment to keep those cross-slice calls working
    (Zustand slice pattern: each slice is `(set, get) => ({...})`, composed in one `create()` —
    cross-domain calls go through the combined `get()`). **Before splitting, enumerate the FULL public
    export surface to preserve** — not just `useEditorStore` + `EditorState`, but every exported
    selector, helper, constant, and type re-exported from `editorStore` (grep its consumers first).
  - Carve `create<EditorState>()` into `src/editor/store/slices/*.ts` by domain (document/tabs,
    tools/brush/arm, underlay, world-layout, node-defs, resize/rename, paint-tiles, walkability,
    zones, shape/void, terrain, layers, favourites, tile-palettes, objects — seams at the research
    table's line ranges). Move the pure helper block (`buildShapeCommand`/`buildTerrainCommand`/
    `defaultAuthoredNodeDef`/`batchCommand`/`blobToDataUrl`/`imageSizeFromDataUrl`) beside their
    `*Ops.ts` modules. `editorStore.ts` becomes the barrel composing slices, re-exporting the full
    surface unchanged. **Remove the null byte at offset 61841.**
  - Side effects: `EditorScene.ts`, all `panels/`/`tabs/` consumers, and the 14 store specs import
    from `editorStore` — the enumerated surface must stay identical so none change. Run the full
    editor store suite.
  - Docs: none inline (Step 18 updates CONVENTIONS with the slice pattern).
  - Done when: `store/__tests__/*` all green, editor builds, gate green at merge, no consumer edits.

- [x] **Step 8: Split `EditorScene.ts` into controllers** `[delegate]` (parallel: C)
  - Outcome: `EditorScene.ts` 2367 → **370 lines**, export `class EditorScene` unchanged (consumer
    `PhaserViewport.tsx` untouched). New `src/editor/scene/`: `constants.ts`, `textureBaker.ts` (free fns:
    queue/bake layers+palettes+ghost+thumbnail), `objectRenderer.ts` (free fns: place/pick/clear decor+nodes),
    `overlaysRenderer.ts` (overlay/void/grid/walkability/zones/shape/hover draws + ghost/underlay
    orchestration), `EditorCameraController.ts` (class `(scene)`, wheel listener in ctor→`destroy()`),
    `EditorInputController.ts` (class `(scene)`, the 958-line pointer/gesture/keyboard/tool-dispatch chunk;
    listeners removed in `destroy()`). Parked `TWO_FINGER_GESTURE_ENABLED` kept as-is. **Behavior nuances
    (verify via editor e2e — no unit tests):** (1) controller fields named `inputController`/`cameraController`
    (can't be `input` — collides with Phaser's `Scene.input`); internal only. (2) `teardown()` now removes
    POINTER_*/wheel listeners via `destroy()` (original relied on Phaser auto-clean) — equivalent-or-safer,
    idempotent, matches repo `PointerInputController` idiom. tsc 0 errors; eslint clean (10 pre-existing
    `unbound-method` warns). Whole-tree gate at wave integration.
  - Extract into `src/editor/scene/`: `EditorInputController` (pointer/gesture + tool dispatch,
    `:1706-2366` — the biggest chunk), `EditorCameraController` (`:1562-1705`), `textureBaker`
    (`:463-700`,`:1392-1463`,`:1488`), `overlaysRenderer` (`:926-1260`), `objectRenderer`
    (`:700-858`), plus the constants block (`:63-128`) into a `scene/constants.ts`. `EditorScene.ts`
    stays the composition root wiring them. Behavior-preserving move only.
  - Side effects: editor-only; no game code touches this. Lean on the editor e2e/visual + build (no
    unit tests here — call out the risk). Keep `TWO_FINGER_GESTURE_ENABLED` gated code as-is (logged,
    not deleted).
  - Docs: none inline.
  - Done when: editor builds + boots, gestures/paint/camera still work via existing e2e, full gate green.

- [x] **Step 9: Split `LibraryPanel.tsx` + adopt shared pan/zoom** `[delegate]` (parallel: C)
  - Outcome: `LibraryPanel.tsx` 1766 → **835 lines**; exports unchanged (`LibraryPanel` + `PalettePickControls`;
    sole consumer `EditorApp.tsx` untouched). New `panels/library/`: `shared.ts` (PREVIEW_PX consts + libClass
    helpers + `isObjectRegion`), `cards.tsx` (`TileFrameGrid`/`NodeCard`/`TerrainCard`/`AssetCard`/`FavouriteItem`
    - internal `TileFrameButton`/`FavHeart`), `AtlasSheetPicker.tsx` (rewired to `usePanZoom`/`zoom.ts` — local
    `ATLAS_ZOOM_*`/pan-zoom state/handlers all removed), `AnimatedStripPicker.tsx` (+ `isAnimatableStrip`),
    `AssetReclassify.tsx`. **Flag for live check:** `usePanZoom(scale)` takes effective scale but returns `zoom`
    (lexical cycle) — resolved via React derived-state-during-render (mirror effective scale into `useState`,
    adjust in-render before paint). Behaviorally identical but the one spot to sanity-check in the editor (no
    component tests). Self-check: own files tsc+eslint clean. Whole-tree gate deferred to wave integration.
  - Move card components (`TileFrameGrid`/`TileFrameButton`/`NodeCard`/`TerrainCard`/`AssetCard`/
    `FavouriteItem`, `:930-1331`) → `panels/library/cards.tsx`; `AtlasSheetPicker` (`:1367-1643`) and
    `AnimatedStripPicker` (`:1644`) and `AssetReclassify` (`:1727`) → own files under
    `panels/library/`. Rewire `AtlasSheetPicker` to consume `usePanZoom` + `zoom.ts` from Step 5.
    `LibraryPanel.tsx` keeps its export + composes the pieces.
  - Side effects: only imports the Step-5 shared modules (read-only). No component tests exist — rely
    on editor build + manual-parity; keep props/behavior identical.
  - Docs: none inline.
  - Done when: editor builds, library panel + pickers render/behave as before, full gate green.

- [x] **Step 10: Split `ObjectEditorTab.tsx` + adopt shared helpers** `[delegate]` (parallel: C)
  - Outcome: `ObjectEditorTab.tsx` 1129 → **45 lines**, export unchanged (`EditorApp.tsx` untouched). New
    `tabs/objectEditor/`: `ObjectEditorForm.tsx` (reclassify form + `filenameOf`), `RegionsEditor.tsx` (regions
    canvas, rewired onto shared modules), `shared.tsx` (`ObjField`/`FormError`/`FormWarnings` + class strings).
    Adopted `regionGeometry.ts` (deleted local `clampN`/`normRect`/`resizeBox`/`Handle`; kept UI-coupled
    `HANDLES`/`HANDLE_POS`), `zoom.ts` (deleted `REGION_ZOOM_*`/`clampRegionZoom`), `pixelAlpha.ts` (inline
    packing loop → `extractAlphaChannel`), `usePanZoom` (deleted local space/pan state + wheel/re-anchor
    effects; `panTrigger = isPanTrigger(e) || (button 0 && panMode)`, `movePan` guarded at top of pointermove).
    tsc/eslint clean; regionGeometry 27/27. **KNOWN REGRESSION fixed in the next integration commit:**
    cursor-anchored wheel-zoom re-anchoring broke here (passed base fit-scale to `usePanZoom` whose re-anchor
    effect needs effective scale) — Step 9 had worked around it, so the two lanes were inconsistent; the
    follow-up commit reconciles the hook contract across both consumers.
  - Move `ObjectEditorForm` (`:128-427`) and `RegionsEditor` (`:505-end`) into
    `tabs/objectEditor/`. Rewire `RegionsEditor` to consume `usePanZoom`/`zoom.ts` (Step 5) and
    `regionGeometry.ts`/`pixelAlpha.ts` (Step 6), deleting the now-duplicated local copies.
    `ObjectEditorTab.tsx` keeps its export + composes.
  - Side effects: imports Step-5/6 shared modules (read-only). Region-editor logic is now partly
    unit-tested via Step 6; rely on that + editor build. Keep behavior identical.
  - Docs: none inline.
  - Done when: region editor drags/resizes/auto-detects as before, geometry unit tests green, full gate green.

- [x] **Step 11: Mechanical split of `GameScene.ts` (combat + dev)** `[delegate]` (parallel: C)
  - Outcome: `GameScene.ts` 1965 → **1727 lines** (−238; further trimmed by the Phase-4 Action-registry).
    `src/scenes/combat/CombatController.ts` (`attack`/`bow`/`pickBowTarget`/`syncBowTarget`/`damagePlayer`/
    `onPlayerHurt`/`killPlayer` + owns `bowTargetId`; `destroy()` on SHUTDOWN) with a narrow `deps` closure
    (`playerChar`/`rng`/`enemies`/`enemiesInTiles`/`killEnemy`/`playAttackSwing`/`flashHit`/`fireArrow`/
    `syncBowTargetHighlight`/`cleanupActorFx`/`cancelAll`). `src/scenes/world/DevWorldTools.ts` (DEV
    randomise/spawn helpers; stateless like ScenePicker). `wireBus()` combat:*/debug:* handlers repointed to
    the managers (SHUTDOWN offs matched). NO bus event/registry key changed; `window.game.__test` surface
    preserved. NO Phase-4 work. tsc clean project-wide; eslint 0 err (57 pre-existing unbound-method warns);
    374 system specs pass. Real guardrail = refactor-tripwire + combat/death/boar e2e (run at integration).
  - Extract combat (`attack`/`bow`/`pickBowTarget`/`syncBowTarget`/`damagePlayer`/`onPlayerHurt`/
    `killPlayer`, `:1342-1483`) into `src/scenes/combat/CombatController.ts` following the manager
    contract (`(scene, deps-closure)`, own `destroy()` on SHUTDOWN, direct calls only). Extract
    dev/randomise (`:1592-1687`) into a `scenes/world/` helper or manager. **Behavior-preserving move
    only** — the Action-registry, wireBus table, and perf fixes are Phase 4, NOT here (they'd conflict
    with this lane). `GameScene.ts` stays composition root + `update()` loop + `buildWorld()`.
  - Side effects: `buildWorld()` wiring gains the new manager; `wireBus()` combat handlers now
    delegate to `CombatController`. The refactor-tripwire + combat e2e are the guardrail.
  - Docs: none inline.
  - Done when: `refactor-tripwire.spec.ts` + combat/death/boar e2e green, full gate green.

- [x] **Step 12: Split `UIScene.ts` into per-widget builders** `[delegate]` (parallel: C)
  - Outcome: `UIScene.ts` 1389 → **352 lines**, still the composition root (keeps export, `hudHitTest`/
    `isMovepadHeld`, all bus on/off + inventory `'change'` sub + SHUTDOWN teardown, cross-widget state).
    11 `src/scenes/hud/` modules: `types.ts`, `HudBars`, `WellbeingPanel`, `InventoryWidget`, `BuildControls`,
    `CombatControls`, `InspectPanel`, `ModeControls`, `TopCenterControls`, `DevMenu`, `NpcAssignMenu` — each
    owns its GameObjects + `onXChanged` handlers; widgets push interactive els back via an `addHudElement`
    closure so the single `hudElements` hit-region list stays authoritative on UIScene. Widgets typed against
    `Phaser.Scene` (no circular import). **ALL 37 game.events + 7 registry keys byte-identical (diff-verified);
    every `on` matched by identical `off`.** tsc 0 errors; 911 unit tests pass; eslint clean (39 pre-existing
    unbound-method warns). Watch in smoke/e2e: movepad reset-on-hide reordered inside `setControlsVisible`
    (movepad-internal only), layout consts now replicated per-widget (pixel-identical). smoke + HUD e2e = net.
  - Break the ~490-line `create()` (`:180-672`) and the ~50 fields into `src/scenes/hud/` modules
    per widget — build-palette (+rotate), wellbeing panel (+eat rows), HUD bars (HP/food/fire),
    combat controls (movepad + action cluster), inspect panel, dev menu, mode indicators — each owning
    its builder + its update handlers (`onFireChanged`/`onHungerChanged`/…). `UIScene.ts` composes
    them and keeps the bus wiring. Use the manager placement rule (needs the scene → `scenes/hud/`);
    non-stateful one-shot builders may be free functions.
  - Side effects: **highest-risk lane — no UIScene unit tests.** Guardrail is `npm run smoke` (boot
    canary: reaches Game+UI, renders, zero console errors) + the HUD-touching e2e (mode/inspect/feed)
    - manual parity. Keep every `game.events` handler + registry key identical.
  - Docs: none inline.
  - Done when: smoke green (zero console errors), HUD e2e green, full gate green.

- [x] **Step 13: Split `mapFormat.ts` into schema/parse/serialize/resize** `[delegate]` (parallel: C)
  - Outcome: `src/systems/mapFormat.ts` → dir `src/systems/mapFormat/` with `schema.ts` (types +
    `ROW_DEPTH_DIVISOR`/`SUB_ROW_EPSILON`/`rowDepthOffset` + the pure cell helpers
    `cellIndex`/`getCell`/`setCell`/`isInside`, which sit between the schema/parse ranges and are
    consumed by both), `parse.ts` (`parseMap` + all `expect*`/`parse*` + `objectFootprintCells` +
    `validateVoidConsistency`), `serialize.ts` (`serializeMap`/`createEmptyMap` + private
    `collapseCellsArrays`), `resize.ts` (`planResize`/`applyResize`/`translateObject`/`migrateMap`/
    `collectTextureSources` + `MAX_MAP_DIM`/`MAP_ID_PATTERN`), and `index.ts` barrel. Public export
    surface byte-for-byte identical (three former privates `fail`/`expectRecord`/`objectFootprintCells`
    became cross-file exports on parse.ts but are NOT re-exported by the barrel). All 82 consumers import
    by path — **none edited**. `parseMapObject` dispatch-table: **logged, not done** (if-chain has
    fall-through error semantics a table couldn't preserve as a pure move). tsc + eslint clean; 138
    relevant specs green (mapFormat.test.ts 67, resize 28); build + smoke green. e2e deferred to Wave-1 integration.
  - Create `src/systems/mapFormat/` with `schema.ts` (types + `rowDepthOffset`, `:32-266`),
    `parse.ts` (`expect*`/`parse*`/`parseMap`/`validateVoidConsistency`, `:301-731`), `serialize.ts`
    (`collapseCellsArrays`/`serializeMap`/`createEmptyMap`, `:778-807`), `resize.ts`
    (`planResize`/`applyResize`/`translateObject` + `migrateMap` + `collectTextureSources`,
    `:871-1052`), and `index.ts` re-exporting everything so `systems/mapFormat` import path is
    unchanged. Consider a dispatch table for `parseMapObject` (`:588-666`) — only if it stays a pure
    move; otherwise log it.
  - Side effects: game runtime (`mapRuntime`) and the editor both import `mapFormat` — barrel keeps
    them working. `mapFormat.test.ts` (800 lines) is the guardrail; keep it green unchanged (or
    re-point imports to the barrel only).
  - Docs: none inline.
  - Done when: `mapFormat.test.ts` + resize/runtime/walkability/zones specs green, full gate green.

### Phase 4 — Re-architecture (sequential, inline) — judgment-heavy, runs after the splits

- [x] **Step 14: Action-kind registry for order handling** `[inline]`
  - Outcome: chose the **decision-core registry** (user, this session — over the full OrderBehavior
    registry) — pure/testable half in the registry, scene-coupled `begin`/`run` stay in the scene as
    dispatch tables. New `src/systems/orders.ts` (Phaser-free): `orderTargetId` (exhaustive switch),
    `sameOrderTarget`/`isOrderQueued`/`toggleOrder` (generic over `TaskQueue`), `ORDER_META`
    (`Record<Action['kind'], {highlight, dedupeOnEnqueue}>`). +14 unit tests
    (`systems/__tests__/orders.test.ts`, 925 total). In `GameScene`: the toggle/queue **quartet**
    (4 `isXQueued` + 4 `toggleX` = 8 methods) deleted → `enqueue` gates on `ORDER_META[kind].dedupeOnEnqueue`
    - generic `isOrderQueued`/`toggleOrder`; `describeActionTarget` collapsed to `orderTargetId(a) ?? …move`;
    `update()` switch → `orderRunners` dispatch table; `beginCurrent` if-chain → `orderBeginners` table
    - extracted `beginHarvest/beginRefuel/beginDeconstruct/beginRearm/beginBuild`; `wireBus()` 28-on/28-off
    mirror → one `subs` `[event,handler,ctx]` table iterated for both on + SHUTDOWN off (`never[]`-param
    typing, no `any`). `TaskGlowRenderer` highlight branch → data-driven `switch(ORDER_META[kind].highlight)`
    (the 3 structure-tending kinds fold to one `structure` case). **Behavior-critical guards preserved:**
    only harvest/refuel/deconstruct/rearm dedupe on enqueue (build/move append); repair stays
    companion-only + defensive. Net: adding a structure-tending order kind no longer touches the quartet,
    describe, or the highlight branch. Gates: `check` green (925 tests), `build` green, **refactor-tripwire
    green** (behavior identical), queue/glow/chop/build/campfire/wall-deconstruct/spike-trap/mode e2e green
    (campfire at `--workers=1` per handoff flake note), smoke green.
  - Replace the `update()` `switch(action.kind)` (`GameScene.ts:873`) and the near-identical
    toggle/queue quartet (`isHarvest/Refuel/Deconstruct/Rearm` + `toggle*`, `:1093-1152`) with a
    registry keyed by action kind, mirroring `StructureManager`'s `register`/`behavior<M>` pattern.
    Each order kind declares its `isQueued`/`toggle`/`run` behavior in one place → a new order kind is
    one registration, not edits in 3+ spots. Pure decision logic goes in a testable module; add unit
    tests (testability goal). Also convert `wireBus()` (`:639-687`) to a table-driven
    `[event, handler]` list so on/off can't drift.
  - Side effects: touches `GameScene.ts` + a new registry module (+ maybe `systems/tasks.ts`). Depends
    on Step 11 (combat already extracted). Behavior must stay identical — refactor-tripwire is the
    proof; the queue/glow/toggle e2e specs must stay green.
  - Docs: note the new registry as an extension seam in CONVENTIONS (Step 18).
  - Done when: tripwire + queue/glow e2e green, new registry unit-tested, full gate green.

- [x] **Step 15: Apply safe perf fixes from the perf lens** `[inline]`
  - Outcome: applied the two `safe` + `[fix]` items only (items 2 & 3 in `docs/cleanup/perf.md`; every
    other item is `[log]` or `needs-review` — left untouched). Item 2: no-work early-return at the top of
    `CombatFxManager.syncEnemyHealthBars` — `if (enemies.length === 0 && this.hpBars.size === 0) return;`
    (gates on `hpBars.size` too, so bars for enemies that died this frame still reach the destroy loop).
    Item 3: `if (this.glowSprites.size === 0) return;` at the top of `TaskGlowRenderer.syncGlowTransforms`.
    Both marked ✅ applied in perf.md. Gates: `check` green (925 tests), `build` green, **refactor-tripwire
    green** (frame-accurate snapshot unchanged), combat.spec (incl. the HP-bar reveal/persist tests) +
    death.spec green, smoke green (zero console errors). No visual regression.
  - Apply only the **safe** (behavior-preserving) items from `docs/cleanup/perf.md`: e.g. cache/reuse
    the enemy array instead of per-frame `enemyManager.all()` allocation, gate
    `taskGlowRenderer.syncGlowTransforms()` / `syncEnemyHealthBars` on there being something to do.
    Leave anything tagged needs-review as [log].
  - Side effects: `GameScene.update()` + the relevant managers. Depends on Steps 11 & 14. Guard with
    the tripwire (frame-accurate snapshot) — any behavior drift fails it.
  - Docs: mark applied items in `docs/cleanup/perf.md`.
  - Done when: tripwire green, no visual regression in smoke, full gate green.

- [x] **Step 16: Apply clear-fix standardizations; land the backlog** `[inline]`
  - Outcome: applied the two outstanding `[fix]` rows (every other smells/standards `[fix]` already
    landed in Steps 14 / 5·9·10 / 7). **(1) Cost consolidation (user-resolved `[log]`→`[fix]`):** inlined
    `spike_trap.cost = { wood: 5 }` onto the BUILDABLES entry beside `wall`/`campfire`, removed
    `SPIKE_TRAP_COST` + its import from `config.ts`/`buildables.ts`, updated the config doc-comment;
    `SPIKE_TRAP_DAMAGE`/`SPIKE_TRAP_TRIGGER_MS` stay in config (sole consumer was `buildables.ts`).
    **(2) Event-namespace doc (`[fix]`):** grep-verified the live namespace set and completed
    `docs/STANDARDS.md`'s enumeration — added `demolish`/`fire`/`npc`/`supply`; **kept `hunger`** (the
    finding's "code uses needs:*" was partial — `hunger:changed` IS live alongside `needs:eat`). Both
    marked ✅ in `standards.md`. **`assetSwatch.tsx` NOT split:** the smells lens tags it `[log]`
    ("cohesive today; splitting is a style call"), so under the "don't touch `[log]`" rule it's left as-is
    (the plan-body mention of it as a `[fix]` example predates the lens tag — reconciled to `[log]`). All
    other `[log]` items (parked portals, two-finger gesture, readonly-records posture, editor UI naming,
    game-bus-vs-Zustand, TS `any`) untouched. Gates: `check` green (925 tests), `build` green,
    **refactor-tripwire green**, build/campfire/wall/spike-trap e2e green (workers=1), smoke green.
  - **DECISION (user, this session): consolidate costs INTO data** — inline `spike_trap`'s `{wood:5}` into
    `src/data/buildables.ts` (matching `wall`/`campfire`), remove `SPIKE_TRAP_COST` from `config.ts` and update
    its consumers, leaving the non-cost trap tunables (`SPIKE_TRAP_DAMAGE`/`SPIKE_TRAP_TRIGGER_MS`) in config.
    (Standards lens tagged this `[log]`; user resolved it to `[fix]`.)
  - Apply the cross-cutting **[fix]** rows from `docs/cleanup/smells.md` + `standards.md` not already
    handled in a lane: split `assetSwatch.tsx` into consts/helpers/component, consolidate structure/
    tool **costs** into a single source (data `BUILDABLES` over `config.ts` — per the decision above),
    any remaining naming/consistency nits. Leave every **[log]** item recorded (parked
    portals, disabled two-finger gesture, game-bus-vs-Zustand split) — do not touch them.
  - Side effects: cost consolidation touches `config.ts` + `data/buildables.ts` + consumers — verify
    build costs unchanged in-game (e2e build spec).
  - Docs: finalize `docs/cleanup/*.md` (fix rows marked done, log rows retained).
  - Done when: build/campfire/wall/trap e2e green, full gate green.

### Phase 5 — optimise-context + docs (sequential, inline)

- [x] **Step 17: Run the `optimise-context` skill on the always-loaded context** `[inline]`
  - Outcome: the `optimise-context` skill is **not installed in this execution container** (empty plugin
    config, no hermes plugin present), so applied its documented principle by hand: keep CLAUDE.md a lean
    always-loaded index, don't shard the load-on-demand leaves (critique #3), update the architecture map to
    the post-refactor layout. Edited CLAUDE.md's map only — `src/systems/` now lists `orders` (Action-kind
    registry) + `mapFormat/` barrel; `src/scenes/` lists `combat/CombatController` + `hud/` per-widget
    builders (GameScene/UIScene = thin composition roots); `src/editor/` describes the Zustand
    `store/slices/*` composition, `scene/*` controllers, and shared `usePanZoom`/`zoom`/`regionGeometry`/
    `pixelAlpha` modules. **Standing cost:** 5.4 KB → 6.3 KB (90 lines) — the ~0.9 KB is the accurate map,
    not dead weight; leaves stay load-on-demand (zero standing cost) so no sharding. `lint:md` green (0
    errors, 84 files). markdown-is-model-context rule preserved (no Prettier on `.md`).
  - Invoke the `optimise-context` skill (hermes-dev plugin) on the **genuinely always-loaded** file:
    `CLAUDE.md` (loaded every turn). Its job is to minimise *standing* token cost — so the target is
    the always-loaded index, not the load-on-demand leaves. **Re-scoped per critique #3:** do NOT
    reflexively shard STATUS/GAME-DESIGN/EDITOR — CLAUDE.md's own rule is "load the one leaf a task
    needs", so those cost nothing until loaded and sharding them adds shards without cutting standing
    cost. CLAUDE.md is already lean (~5.4 KB), so this step is largely: let the skill validate it,
    trim any dead weight, and — the real work here — **update the architecture map to the
    post-refactor module layout** (new dirs, barrels, registry). Only shard a leaf if the skill judges a
    specific doc is being loaded so routinely it's effectively always-on; otherwise leave the leaves.
    **Preserve the markdown-is-model-context rule** (token-lean, markdownlint, no Prettier on `.md`).
    Runs after the refactor so the map reflects the final layout.
  - Side effects: touches `CLAUDE.md` (and `docs/README.md` only if the index map changes).
    `npm run lint:md` must stay green.
  - Docs: this step *is* the always-loaded-context work; leaf-doc content updates are Step 18.
  - Done when: `optimise-context` applied to CLAUDE.md, architecture map matches shipped structure,
    `lint:md` green, standing cost validated as reduced-or-already-minimal (with the rationale noted).

- [x] **Step 18: Update architecture docs to the new module layout** `[inline]`
  - Outcome: `CLAUDE.md` map already done in Step 17. Edited **`docs/CONVENTIONS.md`** — new bullets:
    order-kind registry (`systems/orders.ts`) as the order-extension seam mirroring
    `StructureManager`+`BUILDABLES`; HUD widgets (`scenes/hud/`); big-pure-module barrel (`mapFormat/`);
    editor Zustand slice composition (`store/slices/*`); editor scene controllers (`scene/*`, incl. the
    `inputController` vs Phaser `Scene.input` name gotcha); shared editor viewport modules
    (`usePanZoom`/`zoom`/`regionGeometry`/`pixelAlpha`); and updated the Manager-pattern header to
    `{build,combat,fx,hud,input,world}/` + `combat/CombatController`. **`docs/EDITOR.md`** — `mapFormat.ts`
    refs repointed to the `mapFormat/` barrel + `mapFormat/schema.ts`; added a terse "Code layout"
    pointer to CONVENTIONS. **`docs/STATUS.md`** — new "Code cleanup & modularization (plan 043)" section
    (splits table with real line counts, order registry, safe-perf, standards, testability; refactor-
    tripwire = the no-gameplay-change proof). Line counts verified against the tree (GameScene 1648).
    Terse/high-signal, no duplication (EDITOR points at CONVENTIONS). `lint:md` green (0 errors, 84 files).
  - Update `CLAUDE.md`'s architecture map, `docs/CONVENTIONS.md` (editor slice pattern, new
    `editor/scene/` + `scenes/hud/` + `scenes/combat/` dirs, `usePanZoom`/shared-editor modules, the
    Action-kind registry as the new order-extension seam, `mapFormat/` barrel), `docs/EDITOR.md`, and
    add a `docs/STATUS.md` entry noting the cleanup pass. Keep edits terse/high-signal.
  - Side effects: docs only. Depends on Steps 7–17 (describes their result).
  - Docs: the above files.
  - Done when: docs match the shipped structure, `lint:md` green.

### Phase 6 — Final gate

- [ ] **Step 19: Whole-branch verification** `[inline]`
  - Full sweep on the branch: `npm run check` + `npm run e2e` + `npm run smoke` + `npm run build`
    (game) + editor build, all green. Confirm no public-API drift broke a consumer, the
    refactor-tripwire snapshot is unchanged, and `docs/cleanup/*.md` accurately separates applied
    fixes from logged items. Prepare the single PR on `claude/code-cleanup-modularization-s487ra`.
  - Side effects: none (verification).
  - Docs: none.
  - Done when: every gate green; branch ready for one PR.

## Parallelisation summary

- **Group A** (Steps 1–4): 4 read-only lens agents → 4 disjoint findings docs. The two axes the user
  asked for start here (lenses).
- **Group B** (Steps 5–6): shared foundation modules, new files only — write-disjoint, no consumer
  edits, so no conflict with Group C.
- **Group C** (Steps 7–13): **the main fan-out** — 7 area lanes, one oversized file each, public API
  preserved so lanes never touch each other's consumers. 6 are `[delegate]`; Step 7 (editorStore) is
  `[inline]` but edits a disjoint file, so it runs concurrently in the same wave, just inline-driven.
  Each lane works in **its own worktree**; the whole-tree gate runs at **merge, one lane at a time**
  (not per-lane-in-place) — parallel editing, honest gating. This is the speed win, correctly scoped.
- Barrier before C: Group B must land first (C consumes the shared modules). Barrier before Phase 4:
  all of Group C must be merged + gated (Phase 4 re-touches `GameScene`/`config` that lanes own).
- **Phase 4** (14–16) and **Phase 5–6** (17–19) are sequential/inline — re-architecture and doc work
  that needs judgment and crosses lane boundaries.

## Out of scope

- Behavior/feature changes beyond the refactor's intent (no new gameplay).
- Touching **[log]**-tagged items: parked portal transitions, the disabled two-finger gesture, the
  game-bus-vs-editor-Zustand paradigm split (documented as accepted, not merged).
- Perf items tagged needs-review by the perf lens (logged for a later decision, not applied here).
- Splitting the ~1.4 MB Phaser vendor chunk (WORKFLOW.md: expected, not worth splitting).
- Any change to the deploy pipeline, asset pipeline, or the mobile-editor hosting on guppi.

## Critique

Fresh-eyes review (independent sub-agent, source-only). **Verdict:** Solid, well-researched plan with
accurate file/line facts and a genuinely sound behavior-preserving-split-vs-re-architecture
separation — but the "7 concurrent lanes on one branch" + "full gate every step" premise was
self-contradictory and had to be resolved before execution. Findings #1–#4 have been folded into the
plan above; #5–#6 are noted-only.

|#|Finding|Lens|Severity|Status|
|-|-------|----|--------|------|
|1|7 concurrent Phase-3 lanes on one shared branch can't each satisfy the whole-tree full-gate invariant — gates race on a shared tree|Executability/sequencing|High|**Resolved** — worktree-per-lane + gate-at-merge (Context: Execution model; Phase 3 header; Parallelisation summary)|
|2|editorStore split labelled mechanical but ~120 actions cross-call via get()/set(); higher-effort than a move, export surface broader than stated|Right-sizing / risk|Medium|**Resolved** — Step 7 reclassified `[inline]`, full export surface to be enumerated first|
|3|Step 17 sharding load-on-demand leaves (STATUS/GAME-DESIGN/EDITOR) adds shards without cutting standing cost|Operational / premise|Medium|**Resolved** — Step 17 re-scoped to always-loaded CLAUDE.md|
|4|19-step refactor delivers zero roadmap feature; NPC precedence unargued|Roadmap fit|Medium|**Resolved** — timing-vs-roadmap rationale added to Context|
|5|Seeded line ranges may have drifted (e.g. update() switch ~1343, plan cites :873)|Consistency|Low|Noted — treat ranges as indicative; "confirm during execution" already stated|
|6|One-PR-on-branch deviates from WORKFLOW's master/no-PR model|Consistency|Low|Noted — acknowledged in Context; deploy is master-triggered|

## Execution handoff (paused after Phase 3)

**Branch:** `claude/plan-43-szlkkd` (this session's pinned branch — supersedes the plan-summary's
`claude/code-cleanup-modularization-s487ra`). All Phase 1–3 work committed + pushed.

**Done:** Steps 1–13. Every oversized file split, public API preserved via barrels/composition roots;
`docs/cleanup/{smells,standards,perf,extensibility}.md` written. **Remaining:** Steps 14–19 (Phase 4–6).

**Resume order:** Step 14 (Action-kind registry — spec already in `docs/cleanup/extensibility.md`: the
`OrderBehavior` interface + ~9 current edit-sites) → 15 (apply ONLY `safe`-tagged rows from
`docs/cleanup/perf.md`) → 16 (standardizations; **cost consolidation → INTO data**, see Step 16) →
17 (optimise-context on CLAUDE.md) → 18 (docs) → 19 (final gate).

**Gate commands (this environment):**

- `npm run check` (typecheck+lint+lint:md+format:check+unit, ~8s, 911 tests) and `npm run build` — plain.
- `npm run smoke` and `npm run e2e` need a browser: prefix with
  `SMOKE_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (the pinned Playwright wants
  chromium-1228, absent; the config + smoke read this env var). `smoke` needs `npm run preview` running first.
- **No editor e2e exists.** To verify editor lanes at runtime, load `/editor.html` via Playwright (React
  mounts at `#editor-root`; assert zero console errors) against a `vite` dev server.
- **Two e2e specs are NOT real failures:** `menu-start` (fails identically on `master` — a pre-existing
  boot-timing-fragile test in this slower container) and `campfire-feed` (parallel-load flake — passes at
  `--workers=1`). A run of **104/106 with exactly those two red = green.** `refactor-tripwire.spec.ts` is the
  behavior-preservation guardrail; it must stay green.

**Landing note:** `master` has advanced since this branch forked (new berry-bush content etc.); Step 19 /
the single PR will need a rebase-or-merge decision. Deploy is master-triggered (WORKFLOW.md).
