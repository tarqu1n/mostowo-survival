# Extensibility Lens — testability targets

Pure, Phaser-free modules that Phase 2/3 extract and that should gain (or already warrant) unit
tests — the testability goal. Existing pure systems (`tasks`, `pathfind`, `combat`, `Inventory`,
`grid`, `mapFormat`, `wave`, `daynight`, needs/stats/baseSupply) are already covered under
`src/systems/__tests__`; the targets below are the NEW extractions.

See also [extensibility-seams.md](extensibility-seams.md) — the extension seams (registries) whose extraction creates several of these targets.

|Module|Origin|Pure?|What to test|
|-|-|-|-|
|Order-registry decision core (`isQueued`/`toggle`/`targetId`)|Step 14, new|yes (over `TaskQueue`, no Phaser)|enqueue-same-target toggles the order off; `toggle` removes both current+pending and signals restart when current changed; `targetId` extracts the right field per kind; `move` (null target) never de-dupes|
|`editor/regionGeometry.ts` (`normRect`/`resizeBox`/`clampN`)|Step 6, new|yes|corner-order normalization (all 4 orderings → same rect); `resizeBox` clamps to min size; `clampN` bounds + integer behavior. (Step 6 already plans this test — confirmed correct target.)|
|`editor/zoom.ts` (`clampZoom` + `ZOOM_MIN/MAX/STEP`)|Step 5, new|yes|clamp at min/max; step arithmetic stays within bounds; replaces twinned `ATLAS_/REGION_ZOOM_*` — one test guards both former call sites|
|`editor/pixelAlpha.ts`|Step 6, new|partial (needs a canvas)|thin/optional — a jsdom-canvas smoke test if feasible, else rely on the editor build (Step 6 already flags "if feasible without a real canvas")|
|dev/randomise helper|Step 11, new|only if the selection logic is lifted as a pure fn|if extracted pure (seed→layout choice), test deterministic selection; if it stays scene-bound, leave to the tripwire — do not force purity|

Not testability targets (coverage already exists / not pure): the `editorStore` slices (Step 7) are
Zustand slices covered by the 14 `store/__tests__` specs — keep those green rather than add new unit
tests; `mapFormat/*` (Step 13) is covered by `mapFormat.test.ts` — re-point imports, no new tests;
`CombatController` (Step 11), `EditorScene` controllers (Step 8), `UIScene` hud widgets (Step 12),
and all `.tsx` panels are scene/DOM-bound — they lean on the refactor-tripwire + e2e + smoke, as the
plan's thin-coverage note already states.

**Primary testability wins this pass:** the order-registry decision core (Seam 1) and
`regionGeometry` — both are freshly-extracted pure logic on a hot correctness path.
