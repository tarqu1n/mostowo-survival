# Editor: tabbed central pane + object-editor tab

## Summary

Convert the map editor's central pane from a single `view: 'map' | 'world'` toggle into a **tabbed
container**. The Map (and future World) view is a permanent, non-closable tab; the Library's ⚙
"reclassify" affordance opens a full-size **object-editor tab** on demand (one per asset), which the
user can switch between and close.

This replaces the cramped `AssetReclassify` popover (plan 014 step 7c), which keeps clipping off the
screen edges (left, and off the bottom) and has no room to render a correct preview. The full-size
object-editor tab fixes both: no clipping, and enough room for a **correctly cropped frame-grid
preview** — the current tiny library swatch renders multi-row strips (e.g. a 2×2 furnace sheet,
`rows > 1`) wrong because its animation math assumes a single horizontal row.

The full-size tab also earns its keep for `object` atlas sheets: it hosts a **manual region editor**
(step 4) so tightly-packed sprites the connected-component detector can't separate (e.g. Farm.png's
touching crop rows) can be split by hand — writing `pack.json`'s existing `regions` override and
rerunning the asset pipeline, the same server seam the reclassify uses.

> Interim stopgap already landed on `master` (not this plan): the popover was made `position:fixed`
> and viewport-clamped, the Type dropdown label reads "tileset", and `TileFrameGrid` got a ⚙ so a
> tileset can be reclassified back. **This plan removes that popover entirely** — treat those edits as
> throwaway scaffolding, not code to preserve.

## Context & decisions

Verified against the current tree (`src/editor/`):

- **`view` is read in exactly two files** — `EditorApp.tsx` (renders the central pane) and
  `Toolbar.tsx` (the Map/World toggle). `EditorScene`, `InspectorPanel`, and the rest never touch it.
  So replacing `view`/`setView`/`EditorView` is low-risk; delete the type outright rather than aliasing.
- **The Phaser game is expensive and stateful.** `PhaserViewport.tsx` creates one `Phaser.Game`
  (`Scale.RESIZE`) on mount and `destroy(true)` on unmount; `EditorScene` holds live baked
  RenderTextures and subscribes to the store directly. It must **survive** tab switches — never
  unmount when an object tab is active.
- **Hide with `visibility:hidden`, not `display:none`.** Make the central pane `position:relative`
  and render every tab panel as an absolutely-positioned child filling it (`inset:0`); inactive
  panels get `visibility:hidden; pointer-events:none`. `visibility:hidden` keeps the host's layout
  size, so the `Scale.RESIZE` canvas never collapses to 0×0 (which `display:none` would cause —
  shrinking the canvas, risking zero-size framebuffer errors, and needing a manual `scale.refresh()`
  on re-show). This makes the whole canvas-resize problem class disappear.
- **Deterministic tab ids** make dedupe free: `map` / `world` / `object:<assetId>`. `openObjectTab`
  is find-or-append-then-activate. Object tabs are cheap React and stay mounted (visibility-toggled)
  until closed, so their uncommitted draft edits survive a switch to Map and back for free.
- **Reconcile object tabs on catalog refetch.** Apply regenerates the catalog server-side; an
  object tab can dangle on a removed/renamed asset id. Mirror the store's existing
  `reconcileActiveLayer`/selection reconciliation inside `setCatalog`: auto-close object tabs whose
  `assetId` is gone (and re-activate a neighbour if the active tab was the one dropped). The tab
  component also renders a graceful "asset no longer in catalog" state as a belt-and-braces guard.
- **Global shortcuts must be gated on the map tab.** `EditorApp`'s window `keydown` (undo/redo,
  Delete = delete selected map objects, arrow-nudge) currently fires regardless of what's focused.
  With an object tab active, pressing Delete would silently mutate the *map document*. Gate the whole
  handler on `activeTab.kind === 'map'` (checked via `getState()` inside the handler). This is the
  single biggest correctness risk in the change.
- **Draft edit state stays local to the tab component**, not the store — it's an uncommitted form
  whose canonical truth is server-side `pack.json`, surfaced by the post-Apply catalog refetch.
- **Relationship to plan 014 step 9** ("World view tab + neighbour ghost strips"): that step's world
  view becomes the `world` tab kind here — this plan is the infrastructure it will ride on. World
  stays a placeholder panel until then; nothing in step 9 is pulled forward.

## Steps

> **Step boundaries revised per critique (findings #2–#4):** the `view`→tabs refactor and its
> `EditorApp` consumer land together in step 1 (so each step typechecks green); a minimal object tab
> plus the ⚙ wiring land in step 2 (so its switch/close acceptance is actually exercisable); the Toolbar
> Map/World toggle is kept as a behaviour-identical rename in step 1 and **removed** in step 2 once
> the tab strip is the single switcher (no duplicate control).

- [x] **Step 1: `view` → tabs refactor in the store + its two consumers (behaviour-identical, +tests)** `[delegate sonnet]`
  - Outcome: `editorStore.ts` — deleted `EditorView`/`view`/`setView`; added `EditorTab` union
    (`map`/`world`/`object:<assetId>`), `tabs`+`activeTabId` state, `openObjectTab`/`activateTab`/
    `closeTab`, and a module-private pure `reconcileTabs` (null-catalog-safe, drops object tabs whose
    asset vanished, re-points a dropped active tab to `map`) wired into `setCatalog`. `EditorApp.tsx`
    branches the central pane on the active tab's `kind`; `Toolbar.tsx` Map/World → `activateTab`.
    New `store/__tests__/editorTabs.test.ts` (10 tests). Verified: `tsc --noEmit` exit 0, `eslint
    src/editor` 0 errors (5 pre-existing `EditorScene` warnings), prettier clean, `vitest` 327/327.
    (Pre-existing, out of scope: `npm run check`'s `format:check` fails on `src/debug/crashReporter.ts`
    — fails on HEAD too, untouched.)
  - `src/editor/store/editorStore.ts`: delete `EditorView`, `view`, and `setView`. Add:
    - `EditorTab = { id: 'map'; kind: 'map' } | { id: 'world'; kind: 'world' } | { id: string;
      kind: 'object'; assetId: string }` (object tab id = `object:<assetId>`).
    - State `tabs: EditorTab[]` (default `[{id:'map',kind:'map'}, {id:'world',kind:'world'}]`) and
      `activeTabId: string` (default `'map'`).
    - Actions: `openObjectTab(assetId)` (find-or-append `object:<assetId>`, then activate);
      `activateTab(id)`; `closeTab(id)` (no-op for `map`/`world`; if closing the active tab, activate
      the left neighbour, falling back to `map`).
    - `setCatalog` reconciliation: drop object tabs whose `assetId` is absent from the new catalog;
      if the active tab was dropped, re-activate a neighbour (→ `map` at worst). Note: this is net-new
      defensive code (a reclassify never changes an asset id, so it only fires if a file is
      removed/renamed on disk) — NOT mirroring an existing reconcile pattern (crit #5).
  - **Update both `view` consumers in the same step so the tree stays green (crit #2):**
    - `src/editor/EditorApp.tsx`: the central `<main>` branches on the active tab's `kind` instead of
      `view` (still just map/world/placeholder — no tab strip, no object panels yet).
    - `src/editor/Toolbar.tsx`: the existing Map/World group calls `activateTab('map'|'world')` and
      lights from `activeTabId` — a pure rename, kept as the switcher until step 2 replaces it.
  - Tests: `src/editor/store/__tests__/editorTabs.test.ts` (Tier 1, plain Node) — open/dedupe,
    activate, close, close-active-activates-neighbour, map/world un-closable, setCatalog drops a
    stale object tab and re-activates a neighbour.
  - Side effects: none outside `src/editor/` (+ tests).
  - Done when: tab unit tests green; `npm run check` green; app still renders + Map/World still switch
    (behaviour identical to before).

- [x] **Step 2: Central-pane tab strip + visibility-toggled panels + minimal object tab + ⚙ wiring** `[delegate opus]`
  - Outcome: `EditorApp.tsx` — central `<main>` is now a `role=tablist` tab strip (Map/World/object
    chips; object chips have a ✕ + middle-click close) over `.editor-tab-panels`, with EVERY tab's
    panel mounted as `position:absolute; inset:0` and inactive ones hidden via `.is-hidden`
    (`visibility:hidden; pointer-events:none` — never `display:none`, so the `Scale.RESIZE` Phaser
    canvas survives switches). `<PhaserViewport/>` is always-mounted in the Map panel. Global keydown
    (undo/redo/Delete/nudge) early-returns unless `activeTabId === 'map'`. New
    `tabs/ObjectEditorTab.tsx` (minimal placeholder: id/size/type + "step 3" note + missing-asset
    state). `LibraryPanel.tsx` — `AssetReclassify` reduced to a thin ⚙ that calls `openObjectTab`
    (popover + interim positioning/label/state deleted; `onReclassified` prop dropped from all 5 call
    sites). `Toolbar.tsx` — Map/World toggle removed (tab strip is the sole switcher). `editor.css` —
    tab-strip/chip/panel styles. Verified: `tsc --noEmit` exit 0, `eslint src/editor` 0 errors,
    prettier clean, `vitest` 327/327. ⚠ VISUAL acceptance (canvas survives switch, no flicker;
    shortcut gate; open/dedupe/close tabs) NOT machine-verified — needs a human at `npm run editor`.
  - `src/editor/EditorApp.tsx`: add a tab strip (one chip per tab: label + a ✕ close on object tabs;
    click = `activateTab`, middle-click or ✕ = `closeTab`) above a `position:relative` panel area.
    Render **all** tabs' panels as absolutely positioned `inset:0` children; the active one visible,
    the rest `visibility:hidden; pointer-events:none`.
    - The **map panel is always mounted**: `<PhaserViewport/>` (untouched — its StrictMode-safe
      destroy effect stays) plus the "New or Open a map to begin" hint overlaid when `!map`.
    - The **world panel** is the existing placeholder.
    - **Object panels**: a **minimal `ObjectEditorTab` placeholder** (shows the asset id + a "reclassify
      UI lands in step 3" note) per open object tab — enough to make switch/close real now; fleshed
      out in step 3.
  - Wire the ⚙ in `LibraryPanel.tsx` to call `openObjectTab(asset.id)` (temporary: alongside the
    existing popover, or the popover ⚙ swapped to open a tab — either way the switch/close flow is
    exercisable at end of step 2; the popover is fully removed in step 3).
  - **Remove the Toolbar Map/World toggle** — the tab strip is now the single switcher (crit #4).
  - Gate the global `keydown` handler in `EditorApp` on `getState().activeTabId === 'map'` (early
    return) so undo/redo/Delete/nudge never touch the map document from another tab (top risk).
  - `src/editor/editor.css`: tab strip styling (reuse the dark palette / toolbar-button look);
    absolute-fill panel container.
  - Side effects: none outside `src/editor/`.
  - Done when (VISUAL — needs a human at `npm run editor`, justified: this is canvas-survival + focus
    behaviour that unit tests can't observe): open an object tab from a ⚙, switch Map ↔ it ↔ back with
    the map staying rendered (no canvas flicker/resize), close it and return focus sensibly; Delete
    while an object tab is active does NOT delete selected map objects; `npm run check` green.

- [x] **Step 3: Flesh out the object-editor tab (reclassify + correct preview); extract helpers; retire the popover** `[delegate sonnet]`
  - Outcome: new `src/editor/reclassify.ts` (pure `suggestGrids`/`reclassifyGrid`/`seedFrames`/
    `seedRows`/`reclassifyPatch`/`assetRelPath`/`applyReclassify` — the `putAssetOverride` plumbing) and
    `src/editor/catalogSource.ts` (`loadCatalog`: cache-busted fetch → `parseCatalog` → `setCatalog`,
    returns the parsed catalog). `LibraryPanel.tsx` now reads `catalog` straight from the store and its
    mount effect calls `loadCatalog`, so a tab's Apply refreshes the Library live off one fetch (local
    `catalog` state + `refetchCatalog`/`parseCatalog`/`useCallback` removed). `ObjectEditorTab.tsx`
    replaces the placeholder: type dropdown, frames/rows + suggested-grid chips, a live grid overlay on
    a large sheet preview, and the fix — a correctly cropped per-frame preview (`col=i%cols`,
    `row=floor(i/cols)`); Apply → `applyReclassify` → `loadCatalog`, draft re-seeded from the fresh
    entry via a value-keyed effect; missing-asset state kept. `editor.css` — object-form styles. The
    step-2 `AssetReclassify` was already the thin ⚙ (popover retired then), so nothing left to delete.
    New `src/editor/__tests__/reclassify.test.ts` (11 tests, incl. the 2×2 furnace grid). Verified:
    `tsc --noEmit` exit 0, `eslint src` 0 errors (63 pre-existing warnings), prettier clean on changed
    files, `vitest` 338/338. ⚠ VISUAL acceptance (correct 2×2 preview, Library updates live on Apply)
    NOT machine-verified — needs a human at `npm run editor`. (Pre-existing, out of scope: `npm run
    check`'s `format:check` still fails only on `src/debug/crashReporter.ts`, untouched.)
  - Extract from `src/editor/panels/LibraryPanel.tsx` into reusable units (keep behaviour identical):
    - the catalog fetch/cache-busted-refetch (currently the fetch-on-mount effect + `onReclassified`
      refetch) into a shared helper both the Library and the tab's Apply call → `setCatalog`;
    - `suggestGrids`, the frames/rows grid math, and the `putAssetOverride` plumbing out of
      `AssetReclassify` into pure helpers (e.g. `src/editor/reclassify.ts`).
  - `src/editor/tabs/ObjectEditorTab.tsx`: replace the step-2 placeholder — looks up its asset from
    `catalog` by `assetId` (renders an "asset no longer in catalog" state if the lookup fails).
    Full-size layout: `type` dropdown (tileset/strip/object), frames/rows fields + suggested-grid
    chips, a **live grid overlay on a large sheet preview**, and — the fix — a **correctly cropped
    per-frame grid preview** (`col = i % cols`, `row = floor(i / cols)`; no single-row assumption).
    Apply → `putAssetOverride` → shared refetch → `setCatalog`; draft type/frames/rows are local React
    state, re-derived from the fresh catalog entry after Apply.
  - `LibraryPanel.tsx`: every ⚙ (`AssetCard`, `TileFrameGrid`, `AtlasSheetPicker`,
    `AnimatedStripPicker`) calls `openObjectTab(asset.id)` and nothing else. **Delete `AssetReclassify`
    (the popover) and its interim `position:fixed`/clamp/label/`TileFrameGrid`-⚙ scaffolding.**
  - Side effects: none outside `src/editor/`.
  - Done when: ⚙ on any asset opens/focuses its object tab; reclassifying a 2×2 (`rows:2`) furnace
    sheet shows a correct 2×2 cropped preview (not the squished/mis-laid-out swatch); Apply updates
    the Library live; `npm run check` green.

- [x] **Step 4: Manual region editing in the object-editor tab** `[delegate opus]`
  - Outcome: server `scripts/vite-editor-api.mjs` — new `PUT /__editor/asset-regions` (`{packId,relPath,
    regions:[{x,y,w,h}]}`); `sanitiseRegions` mirrors `sanitiseOverridePatch` (all-or-nothing: integer
    rects, `x/y>=0`, `w/h>=1`, in-bounds) validated against the sheet's IHDR dims read by an inline
    `readPngSize` (deliberately NOT importing `asset-catalog.mjs`, which runs its build on import — fs
    import extended with `openSync/readSync/closeSync`); whole-list replace of `pack.regions[relPath]`,
    empty array `delete`s the key (→ auto-detect), then the same serialised `enqueueRegen` + 502/python3-
    ENOENT graceful-degrade as `asset-override`; `regionParams` untouched; module-doc endpoint list +
    a paragraph added. Client `src/editor/api.ts` — `putAssetRegions` + `RegionRect` (same refetch-is-
    caller's-job contract as `putAssetOverride`). New pure `src/editor/regions.ts` (`sliceBox`/`seedRegions`
    /`sanitiseClientRegions` + `Box`) + `src/editor/__tests__/regions.test.ts` (10 tests). UI
    `src/editor/tabs/ObjectEditorTab.tsx` — tab body now type-conditional: draft `type==='object'` renders
    a new `RegionsEditor` (zoomable sheet reusing `AtlasSheetPicker`'s scale/wheel math — copied, not
    extracted, so `LibraryPanel.tsx` is untouched; draw-drag / click-select+live x/y/w/h inputs / move+8
    resize handles / Delete-Backspace canvas-local key / cols×rows grid-slice; Save→`sanitiseClientRegions`
    →`putAssetRegions`→`loadCatalog`, Reset→`putAssetRegions([])`; if the persisted asset isn't yet
    `object` a `{type:'object'}` override is PUT first); `strip`/`tile` keep the step-3 frame-grid preview.
    `src/editor/editor.css` — `editor-region-*` styles. `docs/ASSETS.md` — in-editor region-editing note.
    No global shortcut added (Delete is canvas-local), so `shortcuts.ts`/Shortcuts panel unchanged.
    Verified: `eslint src` 0 errors / 63 pre-existing warnings (mine clean), `vitest` 370/370, prettier
    clean on the 7 changed files. ⚠ `tsc --noEmit` reports 2 errors BUT both are in `src/scenes/GameScene.ts`
    (Matt's concurrent plan 018/019 `worldPx` dep change — out of scope, not the editor changes). ⚠ VISUAL
    acceptance (Farm.png grid-slice → Save → Library shows new regions → Reset) NOT machine-verified — needs
    a human at `npm run editor`.
  - Why: tightly-packed/touching sprites (e.g. `Environment/Props/Static/Farm.png`'s crop rows and
    seed-jar columns) can't be split by the connected-component detector (`scripts/pixel-crawler/objects.py`
    `components()`): where two sprites touch there's no transparent pixel to cut on, and detection can't
    tell a merged cluster from one legitimately-large sprite (the Farm sheet's wooden railings/rock cluster
    are correct single boxes — dropping `gap` to 0 or adding a projection/XY-cut split provably doesn't
    separate the touching ones). `pack.json`'s `regions: {"<relPath>": [{x,y,w,h}]}` override already
    replaces detection VERBATIM (Rocks/Resources/Esoteric/Tools use it today) — this makes that list
    editable in-app instead of hand-authored, folding into this plan's object-editor tab rather than a
    separate panel.
  - Builds on step 3's full-size sheet preview in `ObjectEditorTab`. For `type:object` assets the tab body
    is a **Regions** editor; `strip`/`tile` keep step 3's frame-grid preview (the type dropdown switches
    between them — one tab, type-conditional body).
  - **Server** (`scripts/vite-editor-api.mjs`): new `PUT /__editor/asset-regions` — body
    `{packId, relPath, regions:[{x,y,w,h}]}`. Add `sanitiseRegions` mirroring `sanitiseOverridePatch`:
    array of integer rects, each `x>=0, y>=0, w>0, h>0` AND in-bounds of the sheet (read the PNG w/h the
    way `asset-catalog.mjs`'s `readPngSize` does, or validate against the sheet size — reject out-of-bounds
    so a bad box can't reach `pack.json`). Reuse `sanitisePackId`/`sanitiseRelPath`. Write
    `pack.regions[relPath] = regions` (WHOLE-list replace, not a merge — it's the complete hand-authored
    list; an empty array DELETES the key = fall back to auto-detection), then `enqueueRegen(root)` —
    identical serialised pipeline + python3-ENOENT graceful-degrade as `/__editor/asset-override`. Extend
    the module doc's endpoint list.
  - **Client** (`src/editor/api.ts`): `putAssetRegions(packId, relPath, regions): Promise<AssetOverrideResult>`,
    mirroring `putAssetOverride` (same refetch-is-caller's-job contract).
  - **UI** (`src/editor/tabs/ObjectEditorTab.tsx`): seed editable boxes from the asset's current `regions`
    (catalog); if it has none, seed with one box covering the whole sheet (subdivide from there). Reuse
    `AtlasSheetPicker`'s zoomable-sheet + absolutely-positioned-box render (extract the shared bits if
    cheap), made editable:
    - **draw**: drag on empty sheet → new box;
    - **select + delete**: click a box to select (live x/y/w/h readout); Delete/✕ removes it;
    - **move + resize**: drag body to move, corner/edge handles to resize;
    - **grid-slice**: with a box selected, enter cols×rows → replace it with that grid of equal cells
      (one action splits a whole merged crop row — the motivating case).
    **Save regions** → `putAssetRegions` → shared step-3 catalog refetch → `setCatalog` (tab re-derives
    boxes from the fresh entry). **Reset to auto-detect** saves an empty list (clears the override).
  - **Docs**: `docs/ASSETS.md` regions section — note in-app editing writes `pack.json` `regions`; if a
    shortcut is added, update `src/editor/shortcuts.ts` AND the in-app Shortcuts panel (project rule).
  - Side effects: `scripts/vite-editor-api.mjs`, `src/editor/api.ts`, `src/editor/tabs/`, `docs/ASSETS.md`
    — no game-runtime code.
  - Done when (VISUAL — human at `npm run editor`): open Farm.png's object tab, grid-slice a merged crop
    row into individual crops + hand-fix a couple of boxes, Save, and the Library atlas picker shows the new
    individual regions (clickable to arm for placement); Reset restores auto-detection; `npm run check` green.

- [ ] **Step 5: Polish + docs** `[inline]`
  - Close affordances finalised (✕ + middle-click), missing-asset tab state confirmed. Optional:
    `game.loop.sleep()`/`wake()` on map-tab deactivate/activate to stop rendering a hidden canvas
    (skip if not worth it).
  - If any tab keyboard shortcut is added (e.g. `Ctrl+W` to close the active tab), update
    `src/editor/shortcuts.ts` **and** the in-app Shortcuts panel (project rule: they must stay in
    sync).
  - `docs/STATUS.md`: one line for the tabbed central pane + object-editor tab (incl. manual region
    editing for tightly-packed atlas sheets).
  - Done when: `npm run check` green; a human confirms the flow end-to-end at `npm run editor`.

- [x] **Step 6: Animated-strip authoring — free cols×rows grid + arbitrary frame omission** `[delegate — sub-steps]`
  - Outcome: all 7 sub-steps landed (each verified independently green). **6.1** `scripts/asset-catalog.mjs`:
    `stripFrameDims` gained `cols`+`omit` (geometry mode: `frames=cols*rows`, sanitised `omit`; legacy
    `frames`/`rows` mode unchanged), override-merge now also `delete`s `patch.cols`/`.omit`, `assertValidCatalog`
    validates `omit`; `main()` guarded (`process.argv[1]===fileURLToPath`) + `stripFrameDims` exported so it's
    importable; new `scripts/__tests__/asset-catalog.test.mjs` (7 cases); `vitest.config.ts` `include` extended
    with `scripts/**/*.test.mjs`; byte-identical catalog reconfirmed. **6.2** `scripts/vite-editor-api.mjs`:
    `sanitiseOverridePatch` accepts `cols`(int≥1)/`omit`(ints≥0, only with `cols`) + cross-field guard (indices
    `<cells`, played `≥1`); new `scripts/__tests__/vite-editor-api.test.mjs` (18 cases). **6.3** (game-runtime)
    `src/systems/mapFormat.ts` + `src/render/decorSprites.ts`: `DecorAnim` gained `omit?`; `parseDecorAnim`
    validates (ints≥0, unique, `<frames`, played≥1); renderer plays `[0..frames-1]` minus omit and folds
    `frames`+omit signature into the ANIM cache key (TEXTURE key stays geometry-only); legacy anim maps round-trip
    byte-identical; +15 tests. **6.4** `src/editor/reclassify.ts`: `seedCols`/`seedOmit`; `reclassifyGrid(asset,
    type,cols,rows,omit)` → `{cols,frameWidth,frameHeight,frames,played,valid}`; `reclassifyPatch`/`applyReclassify`
    take cols+omit (never write `frames`); `CatalogAsset.omit?` + `AssetOverridePatch.cols?/omit?` added; minimal
    compile-shim kept ObjectEditorTab green; `reclassify.test.ts` → 20 cases. **6.5**
    `src/editor/tabs/ObjectEditorTab.tsx` + `editor.css`: Type option label → "Animated strip"; free Columns/Rows
    inputs; per-frame preview renders ALL cells with click-to-toggle `omit` (dimmed/crossed); `omitInRange` guards
    stale indices; Apply disabled on non-integer grid or `<1` played cell. **6.6** `editorStore.ts` (doc-only — the
    fps-spread already threads `omit`) + `LibraryPanel.tsx`: `AnimatedStripPicker` passes `omit` when arming, static
    first-frame swatch when `rows>1` or `omit` non-empty; `isAnimatableStrip` unchanged; +1 store test. **6.7**
    (inline) `docs/ASSETS.md` (cols/omit geometry mode + object-editor-tab UI), `catalog.ts` `CatalogAssetType`
    doc (the `'strip'` token displays as "Animated strip"), `docs/STATUS.md` plan-017 entry. No editor shortcut
    added ⇒ `shortcuts.ts`/Shortcuts panel untouched. Verified: `tsc --noEmit` clean, `eslint` clean on changed
    files, `prettier` clean on changed files, `vitest` 427/427. ⚠ VISUAL acceptance (reclassify the 192×704
    Alchemy sheet → cols2/rows11/omit[21] → 21-frame preview; place → animates 21 frames; a mid-grid omit; catalog
    diff touches only that asset) NOT machine-verified — needs a human at `npm run editor`. Pre-existing/concurrent,
    out of scope: `npm run check`'s `format:check` fails on `src/debug/crashReporter.ts` (fails on HEAD too), and
    `lint:md` fails on the untracked `plans/020-editor-tailwind-shadcn.md` (Matt's concurrent work).
  - **Goal:** the Object Editor's `strip` (relabelled **"Animated strip"**) authoring can't express real
    sheets. Today the override is `{type:'strip', frames, rows}` and the catalog builder derives
    `cols = frames / rows` — so `frames` is BOTH the grid-cell count AND the animation length, welded
    together. A sheet whose grid is 2 cols × 11 rows but whose **last cell is blank** (the motivating
    case: `Environment/Structures/Stations/Alchemy/Alchemy_Table_01-Sheet.png`, 192×704 = 22 cells, 21
    real frames) is inexpressible: geometry wants cols=2/rows=11 → 22 cells, but `frames:21` gives
    `cols = 21/11`, non-integer, so `stripFrameDims` collapses it to "1 unsliced frame". Fix by
    **decoupling grid geometry from the played-frame set**: author `cols`×`rows` freely, and omit ANY
    cells (not just trailing — explicit user choice over trailing-only).
  - **Data model** (settled with the advisor; backward-compatible — the committed catalog and existing
    `pack.json` strip overrides regenerate byte-for-byte, never migrate them):
    - **`pack.json` override** becomes `{ type:'strip', cols?, rows?, omit? }`:
      - `cols` present → **geometry mode**: `frameWidth = w/cols`, `frameHeight = h/rows` (rows default
        1); total cells `= cols*rows`; `omit: number[]` = cell indices (row-major, `0..cols*rows-1`)
        to skip. `frames` is NOT authored here — it's derived.
      - `cols` absent → **legacy mode**: today's `cols = frames/rows` path, unchanged, no `omit`. This
        is the whole backward-compat story — existing `{frames:4}` / `{frames:4, rows:2}` entries hit
        this branch and regenerate identically.
    - **`CatalogAsset` (`src/editor/catalog.ts`)**: `frames` is redefined to mean **total grid cells
      (`cols*rows`)** — a no-op for all existing data (today `frames === cols*rows` always, since no
      omission exists yet), so the committed catalog stays valid. Add `omit?: number[]` (skipped
      cells). `cols`/`rows` remain recoverable as `w/frameWidth` / `h/frameHeight` — no new geometry
      field needed.
    - **Played set** (every consumer): `[0..frames-1]` minus `omit`, ascending. `omit` absent/empty ⇒
      identical to today's `start:0 → end:frames-1`.
  - **Seams (ordered sub-steps, each independently green):**
    - **6.1 Catalog builder + tests** `[delegate sonnet]` — `scripts/asset-catalog.mjs` `stripFrameDims`
      gains a `colsOverride` + `omitOverride`: geometry mode when `cols` given (validate `frameWidth`/
      `frameHeight`/`frames=cols*rows` integer, sanitise `omit` to unique ints in `[0,frames)`, warn +
      fall back to 1 unsliced frame on a bad grid, same as today); legacy mode otherwise. Return
      `{frameWidth, frameHeight, frames, omit}` and set all four on the asset explicitly.
      **Advisor trap #1:** the override-merge (`asset-catalog.mjs:238`, `delete patch.type/.rows`) must
      also `delete patch.cols` **and** `delete patch.omit`, or `cols`/`omit` leak into the committed
      catalog as undocumented keys — `omit` is set from `stripFrameDims`'s *sanitised* output, not the
      raw patch. Extend the module-doc override comment (line ~14). New cases in the catalog-builder
      tests (2×11 with `omit:[21]`; a mid-grid omit; legacy still byte-identical).
    - **6.2 Server sanitiser** `[delegate sonnet]` — `scripts/vite-editor-api.mjs`
      `sanitiseOverridePatch`: accept integer `cols >= 1`; accept `omit` as an array of ints `>= 0`;
      cross-field check when `cols`+`rows` present — every `omit` index `< cols*rows`, and played count
      (`cols*rows - unique(omit)`) `>= 1` (reject "omit everything"). Keep the existing `frames`/`rows`
      validation for legacy callers. Extend the module doc.
    - **6.3 Runtime schema + renderer** `[delegate opus]` — **this is the sub-step that reaches
      game-runtime code** (unlike steps 1–5's editor-only scope — call it out in the STATUS line):
      - `src/systems/mapFormat.ts`: add optional `omit?: number[]` to `DecorAnim`; `parseDecorAnim`
        validates (array of ints `>= 0`, unique, each `< frames`). `frames` stays required/`>0`.
      - `src/render/decorSprites.ts` `resolveDecorDraw`: when `omit` is non-empty,
        `generateFrameNumbers(key, { frames: played })` (the ascending kept-list) instead of
        `{start:0, end:frames-1}`. **Advisor trap #2:** the anim cache key
        (`decoranim:${asset}:${fw}x${fh}@${fps}`) carries no frame info — once `frames`/`omit` vary
        independently of geometry, two placements of the same asset can silently share the wrong anim.
        Fold `frames` **and** an `omit` signature into the key.
    - **6.4 Reclassify helpers + tests** `[delegate sonnet]` — `src/editor/reclassify.ts`: add
      `seedCols` (`w/frameWidth`, mirror of `seedRows`) and `seedOmit` (`asset.omit ?? []`);
      `reclassifyGrid` takes `cols` + `omit` as inputs (stop deriving `cols=frames/rows`), returns the
      cols/dims/validity + the played-cell list for the preview; `reclassifyPatch` writes
      `{type, cols, rows, ...(omit.length ? {omit} : {})}` (never `frames` in geometry mode — keep
      pack.json lean/self-documenting); `applyReclassify` signature → `(asset, type, cols, rows, omit)`.
      `suggestGrids` chips become cols+rows shortcuts (clear `omit`). Update `reclassify.test.ts`.
    - **6.5 Object Editor tab UI** `[delegate opus]` — `src/editor/tabs/ObjectEditorTab.tsx`: dropdown
      option label `strip` → **"Animated strip"** (value stays `'strip'`); replace the Frames/Rows
      inputs with **free-entry Columns/Rows**; render the per-frame preview as **all `cols*rows` cells**
      where **clicking a cell toggles its `omit` membership** (omitted cells dimmed/crossed — the
      arbitrary-omission UI); grid overlay uses `cols`×`rows`; disable Apply if `<1` cell would play or
      the grid is non-integer. Apply → `applyReclassify(asset, type, cols, rows, omit)` → `loadCatalog`;
      re-seed effect deps gain the cols-derived value + an `omit` signature.
    - **6.6 Editor store + Library card** `[delegate sonnet]` — `editorStore.ts`: `ArmedObjectAsset.anim`
      / `placeObjectAt` carry `omit` through (still `Omit<DecorAnim,'fps'>`). `LibraryPanel.tsx`:
      `AnimatedStripPicker` passes `omit` when arming; its CSS `steps()` preview is single-horizontal-row
      math (`frames*dispW` travel) — **fall back to a static first-frame swatch when `rows>1` or `omit`
      is non-empty** (the true animated preview lives in the tab). `isAnimatableStrip`'s `frames>=2`
      gate is unchanged (correct on total-cells).
    - **6.7 Docs + labels** `[inline]` — `docs/ASSETS.md` (strip section: cols/rows + omit authoring),
      the `CatalogAssetType` doc comment (note the `'strip'` token displays as "Animated strip"), and
      `docs/STATUS.md` line. No editor keyboard shortcut added ⇒ `shortcuts.ts`/Shortcuts panel
      untouched (but re-check the project rule if one is added).
  - **Rename decision:** label-only. `'strip'` is baked into `pack.json` `rules`, the committed catalog,
    `OVERRIDE_TYPES`, `CatalogAssetType`, and `scripts/pixel-crawler/objects.py`; renaming the token
    end-to-end is pure churn across committed data for zero behaviour change. Map `'strip'` →
    "Animated strip" only at the display layer.
  - **Side effects:** unlike steps 1–5, this step DOES touch game-runtime code — `src/systems/mapFormat.ts`
    and `src/render/decorSprites.ts` (6.3) — plus `scripts/asset-catalog.mjs`, `scripts/vite-editor-api.mjs`,
    and `src/editor/*`. No change to `EditorScene`/pathfinding/placement transforms.
  - **Done when** (VISUAL — human at `npm run editor`): reclassify the 192×704 Alchemy_Table_01 sheet to
    `cols:2, rows:11`, click-omit the blank 22nd cell, Apply → the tab preview shows a correct 21-frame
    2×11 grid; place it → the decor animates through 21 frames (no blank flash); the committed
    `asset-catalog.json` diff touches ONLY that asset (proves backward-compat); a mid-grid omit also
    plays correctly; `npm run check` green.

## Out of scope

- The World view itself (still a placeholder — plan 014 step 9 turns the `world` tab into real
  content).
- Persisting open tabs across reloads (tabs reset to `[map, world]` on load).
- Drag-to-reorder tabs, tab overflow/scroll UI (only a handful open in practice).
- Any change to how assets are placed/rendered in the map (`EditorScene`, decor pipeline).

## Critique

**Verdict:** Technically sound and the code claims check out, but it commits to a heavyweight
"convert the whole central pane to a tab container" solution for what is essentially a
clipping/preview-room bug the editor's existing modal-dialog pattern already solves — and the first
three steps are carved at seams that don't each stay green independently. *(Finding #1 is answered by
an explicit product decision made after the critique: the user wants MULTIPLE concurrent
object-editors they can switch between and close — which a single modal cannot provide. Proceeding
with tabs; steps revised to fix the executability findings below.)*

|#|Finding|Lens|Severity|Suggested action|
|-|-------|----|--------|----------------|
|1|Tabbed-pane rebuild is heavier than the stated goal needs; the editor already has 4 modal dialogs that fix clipping + preview room with no state surgery. Roadmap claim ("rides on 014 step 9's world tab") is overstated — step 9 works with the existing `map`/`world` toggle.|Alternatives / right-sizing / roadmap|High|**Resolved by user intent:** multiple switchable/closable editors are explicitly wanted; a modal can't do that. Proceed with tabs.|
|2|Step 1 deletes `view`/`setView`/`EditorView` but scopes to `editorStore.ts`+`Toolbar.tsx` only — yet `EditorApp.tsx:28` still reads `s.view`, so step 1's "check green" is unachievable (typecheck breaks).|Executability / reversibility|Medium|Fold the `EditorApp` central-pane change into step 1 (done in revision).|
|3|Step 2's acceptance ("switch Map ↔ an object tab and back") can't be exercised — nothing calls `openObjectTab` until step 3 wires the ⚙.|Executability / sequencing|Medium|Merge the object-tab wiring so step 2's visual check is real (done in revision).|
|4|`map`/`world` would appear twice: as the kept Toolbar view-switch buttons AND as chips in the new tab strip — two controls for one action.|Consistency / right-sizing|Medium|Pick one surface (revision: Toolbar toggle drops out; the tab strip is the switcher).|
|5|`setCatalog` has no existing "reconcile-on-load" precedent (those fire on apply/undo/redo), and a reclassify never changes an asset `id`, so the "dangling object tab" guard is largely hypothetical.|Consistency / right-sizing|Low|Keep the guard as cheap defence (only fires if a file is removed/renamed on disk); don't describe it as mirroring an existing pattern.|
|6|Tabs cover only the centre pane; the right Inspector stays map-scoped, so a selected map object is still editable via the Inspector while an object tab is active (only the global `keydown` is gated).|Gaps|Low|Note the limitation; optionally mute the Inspector when a non-map tab is active.|

*Primary focus: #1 is resolved by explicit user intent (tabs wanted). #2 is the immediate executability
fix; #3/#4 follow. #5/#6 are noted, not blocking.*
