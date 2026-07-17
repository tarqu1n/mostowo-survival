# Editor Mobile/Touch UX Rework (Library + Node Types)

> Status: in review — all 9 steps implemented; awaiting Matt's on-device (touch) verification.

## Summary

Two Map-Editor surfaces are painful on touch/phone; this plan reworks both.

**A. Library panel (Steps 1–6).** Closing the compact drawer destroys all browse state (a real bug —
the Radix `Sheet` unmounts `LibraryPanel`), tile taps land on the overlaid favourite heart instead of
picking, the drawer is a cramped 85vw/320px, and every paint trip means reopening and re-navigating
from scratch. This rework: (1) makes the compact drawer full-width, (2) persists browse state per-map
so reopen/reload returns you where you were, (3) closes the compact drawer on pick so you can paint
immediately, (4) adds an auto-tracked **Recent** strip (everything pickable; tiles grouped into one
scrollable swatch row), and (5) replaces heart-overlay favouriting on touch with **long-press to
favourite** (tap = pick). Also folds in **drill-down nav** on compact so the category tree and the
results grid each get full height instead of competing.

**B. Node Types tab (Steps 7–8).** The Node Types tab (`tabs/NodeTypesTab.tsx`) is a fixed two-pane
layout with a hard `w-[240px]` list column and no compact awareness at all, so on a phone the list eats
half the width and the editor is crushed. Rework it (on **both** desktop and compact — user's choice)
to a stacked layout: a **full-width collapsible "Node types" list at the top**; selecting an item
collapses the list and shows that def's controls (`NodeStatsForm` + `SkinManager`) **below** it; and the
**Skins** section becomes collapsible with the skin thumbnails shown in the collapsed summary bar.

## Context & decisions

**Confirmed product decisions (from the user):**
- Recent tracks **everything pickable** (tiles, decor/objects, atlas regions, animated strips, nodes,
  terrains) — but **all tiles are grouped together** into one horizontally-scrollable swatch row for
  easy scanning/picking, rather than one card per tile.
- Recent strip **and** persisted browse state apply to **both desktop and compact**.
- Recent + browse state are scoped **per-map** (keyed by mapId), persisted to localStorage. Favourites
  stay per-zone/per-map in the `MapFile` exactly as today (unchanged).
- Long-press favouriting is **compact/touch only**; desktop keeps the visible heart click.
- Auto-close on pick is **compact only** (desktop panel is docked, nothing to close).

**Patterns to mirror (from repo research — file:line):**
- **Store** (`src/editor/store/editorStore.ts`): single `create<EditorState>()(subscribeWithSelector(...))`
  singleton (`:1118`), flat interface, **no immer/persist/slices**. New editor VIEW state follows the
  simple-setter convention: field + doc comment in the interface, default in the initial-state object
  (`:1120-1169`), `setFoo: (foo) => set({ foo })` alongside `setBrushAsset`/`setActiveTool` (`:1263-1294`).
  View state must **NOT** go into `MapFile` (that's authored map content, immutable — `EDITOR.md:151-155`).
- **localStorage** is **hand-rolled**, no zustand `persist`. Canonical model = `src/editor/underlayStore.ts`:
  a `storage()` guard returning `globalThis.localStorage` or `null` in try/catch (`:36-44`), per-map keys
  under a `mostowo-editor-…:` prefix via helper fns (`:31-34`), every read degrades to `null`/`[]`,
  every write swallows errors (quota non-fatal), pure/Phaser-free, exported `get/put` functions called
  from store actions (not React). This is the template for the new persistence module.
- **mapId**: key per-map data on the **same map-identity accessor `underlayStore` already uses** — reuse
  whatever `underlayStore` per-map calls pass as `mapId` (find its call sites in the store's map
  open/new/close path and hydrate the new library state at the same points).
- **Toast**: `import { toast } from 'sonner';` — `toast.success('…')` / `toast('…', { duration })`.
  `Toaster` already mounted once in `EditorApp.tsx:461`.
- **Compact-close seam**: `LibraryPanel` takes **no props** today and talks to the app only through the
  store. Drawer open state is deliberately **local `useState` in `EditorApp`** (`:242-244`). Cleanest
  seam = add an optional `onPick?: () => void` prop to `LibraryPanel`, passed **only** from the compact
  Sheet render site as `onPick={() => setLibraryOpen(false)}`; desktop omits it (no-op). No new store
  surface, respects the local-state design note.
- **Recents id shapes / re-arm handlers** (all already in `LibraryPanel.tsx:276-313`):

  |Kind|Identity|Re-arm handler|Store field|
  |------|----------|----------------|-------------|
  |tile|`<pack>/<path>#frame`|`pickTile(assetId)`|`brushAsset`|
  |decor|`assetId` (+ `region?`/`anim?`, mutually exclusive)|`armObject`/`armRegion`/`armAnim`|`armedObjectAsset`|
  |node|node-def ref string|`armNode(ref)`|`armedNodeRef`|
  |terrain|`TerrainDef.id`|`armTerrain(id)`|`activeTerrainId`|

  Each handler also switches `activeTool` (brush/place/terrain). decor↔node arming is mutually exclusive.

- **Testing**: editor store changes are unit-tested; 10+ sibling files under `src/editor/store/__tests__/`
  (e.g. `editorStore.test.ts` covers favourites at `:251-274`). Convention: reset the singleton via
  `newMap('scratch', …)` in `beforeEach`; stub localStorage with a `FakeStorage`. `npm run check`
  (typecheck + lint + lint:md + format:check + test) gates everything.
- **CONVENTIONS**: pure Phaser-free logic in its own unit-tested module (`CONVENTIONS.md:14`); comments
  state constraints/why not what (`STANDARDS.md:48`); no `any` without a justifying comment.

**Existing structure touched:** `src/editor/panels/LibraryPanel.tsx` (heavy — steps 3/4/6 all edit it,
so they are sequential/write-shared), `src/editor/EditorApp.tsx` (drawer shell + onPick wiring), new
`src/editor/libraryViewStore.ts` (pure), `src/editor/store/editorStore.ts` (integration),
`src/editor/tabs/NodeTypesTab.tsx` (steps 7–8, layout reflow), tests.

## Steps

- [x] **Step 1: Pure library-view persistence + recents module** `[delegate sonnet]`
  - Outcome: created `src/editor/libraryViewStore.ts` (pure, Phaser-free, modelled on `underlayStore.ts`)
    and `src/editor/__tests__/libraryViewStore.test.ts` (23 tests). Exports: `RecentEntry`,
    `LibraryBrowseState`, `PersistedBrowse = Omit<…,'search'>`, `RECENTS_CAP=24`, `recentIdentity`,
    `pushRecent`, `getRecents`/`putRecents`/`deleteRecents`, `getBrowse`/`putBrowse`/`deleteBrowse`
    (delete helpers added early for Step 2's rename migration). `getBrowse` returns `PersistedBrowse|null`
    (never `search`); `putBrowse` takes full state but strips `search` before writing. `DecorRegion`/
    `DecorAnim` from `../systems/mapFormat`. Typecheck/lint/format/md clean on new files; the lone
    `mapRuntime.test.ts` failure is pre-existing (verified with changes stashed) + unrelated.
  - Create `src/editor/libraryViewStore.ts`, modelled closely on `underlayStore.ts` (same `storage()`
    guard + try/catch + swallow-on-error posture, Phaser-free, no `MapFile` import).
  - Types: `RecentEntry` discriminated union —
    `{ kind:'tile'; assetId:string } | { kind:'decor'; assetId:string; region?:DecorRegion; anim?:Omit<DecorAnim,'fps'> } | { kind:'node'; ref:string } | { kind:'terrain'; id:string }`
    (import `DecorRegion`/`DecorAnim` from `../systems/mapFormat` as `LibraryPanel.tsx` does).
  - Browse state — split what lives in memory from what persists (critique #4): the **store** field
    `LibraryBrowseState = { search:string; selectedPack:string|null; selectedCategory:string|null; expandedPacks:string[] }`,
    but the **persisted** shape `PersistedBrowse = Omit<LibraryBrowseState,'search'>` — `search` is
    transient (store-only, survives close/reopen within a session; NOT written to disk on every
    keystroke, does not survive reload). `getBrowse` returns a `PersistedBrowse | null`; the store
    rehydrates it with `search:''`.
  - Pure helpers: `recentIdentity(entry): string` (stable dedupe key — include kind + assetId +
    serialized region/anim for decor, so a plain object and a specific region crop of the same sheet are
    distinct); `pushRecent(list, entry, cap = RECENTS_CAP): RecentEntry[]` returning a **new** list,
    most-recent-first, deduped by identity (an existing entry moves to front), capped at `RECENTS_CAP`
    (const = 24).
  - Per-map persistence keyed under prefix `const PREFIX = 'mostowo-editor-library:'`, sub-keys
    `recentsKey(mapId)` = `…recents:<mapId>`, `browseKey(mapId)` = `…browse:<mapId>`. Exported
    `getRecents(mapId): RecentEntry[]` (→ `[]` on miss/corrupt), `putRecents(mapId, list)`,
    `getBrowse(mapId): LibraryBrowseState | null`, `putBrowse(mapId, state)`.
  - Side effects: none (pure module, not yet imported anywhere).
  - Docs: none yet (documented in Step 7).
  - Done when: `src/editor/__tests__/libraryViewStore.test.ts` (new) passes with a `FakeStorage` stub —
    covers dedupe-moves-to-front, cap enforcement, order, round-trip get/put, and graceful `[]`/`null`
    on absent + corrupt values. `npm run check` clean.

- [x] **Step 2: Integrate recents + browse state into the editor store** `[inline]`
  - Outcome: `editorStore.ts` — imported `libraryViewStore` get/put/delete + `pushRecent`; added
    `libraryRecents`/`libraryBrowse` interface fields (view-state doc comments) + `EMPTY_LIBRARY_BROWSE`
    const; defaults in initial-state; `pushLibraryRecent`/`patchLibraryBrowse` setters (both guard
    `mapId`; `patchLibraryBrowse` skips the disk write on a `search`-only patch). Hydrate from
    `getRecents(id)`/`getBrowse(id)` (rehydrated `search:''`) in `newMap`+`loadMap`; reset to defaults
    in `closeMap`. `renameMapState` now migrates recents+browse old→new (mirroring underlay) and deletes
    old keys. New `editorStoreLibraryView.test.ts` (11 tests) + existing rename tests pass (41 total).
    Typecheck/lint/format clean on all touched files. NOTE: full `npm run check` is currently blocked at
    typecheck by an UNRELATED untracked WIP file `src/scenes/fx/NodeFxManager.ts` (two TS6133 unused-var
    errors) — not touched by this plan; flagged to Matt.
  - Add to `EditorState` (with doc comments): `libraryRecents: RecentEntry[]` and
    `libraryBrowse: LibraryBrowseState`; defaults in the initial-state object (empty list; browse =
    `{ search:'', selectedPack:null, selectedCategory:null, expandedPacks:[] }`).
  - Actions (simple-setter convention): `pushLibraryRecent(entry: RecentEntry)` — computes new list via
    `pushRecent`, `set({ libraryRecents })`, and write-through `putRecents(mapId, …)`;
    `patchLibraryBrowse(partial: Partial<LibraryBrowseState>)` — merges, `set`, and write-through the
    persisted subset via `putBrowse` **only when `partial` touches a persisted field** (skip the disk
    write for `search`-only patches, per critique #4). **Both write-throughs must guard on `mapId` being
    non-null** (critique #7) — a pick with no map open updates in-memory state but writes nothing.
  - Hydration: hook the **same map open/new/close points where `hydrateUnderlay(mapId)` is called**
    (editorStore.ts `newMap`/`loadMap`/`closeMap` — mapId is set at `:1176/1199/1222`, hydrate at
    `:1192/1215`). Hydrate `libraryRecents`/`libraryBrowse` from `getRecents(mapId)`/`getBrowse(mapId)`
    (browse rehydrated with `search:''`; falls back to the empty default when `null`). On map close /
    no map, reset both to defaults.
  - **Rename migration (critique #1):** `renameMap` (editorStore.ts:2013) currently migrates only the
    underlay key. Add old→new migration for BOTH new keys, mirroring underlay's
    `getRecents(oldId)→putRecents(newId)→delete oldId` (and same for browse), so a rename+reload keeps
    recents/browse and leaves no orphaned `oldId` keys. Add `deleteRecents(mapId)`/`deleteBrowse(mapId)`
    to `libraryViewStore.ts` for this (extend Step 1's exports).
  - Side effects: map open/new/close now also load/reset library view state — verify no ordering issue
    with existing underlay hydration; verify `docRevision`/`mapEpoch` consumers unaffected (these are
    plain `set`s, no history/command involvement — recents/browse are view state, never undoable).
  - Docs: none (Step 7).
  - Done when: new `src/editor/store/__tests__/editorStoreLibraryView.test.ts` passes — push dedupe/cap,
    browse patch/merge, **per-map isolation** (two `newMap` ids keep separate recents/browse), and
    write-through to a `FakeStorage`. `npm run check` clean.

- [x] **Step 3: LibraryPanel reads browse state from store; records recents; onPick prop** `[inline]`
  - Outcome: `LibraryPanel.tsx` — dropped the 4 local `useState`s (search/selectedPack/selectedCategory/
    expandedPacks); now reads `libraryBrowse` from the store and writes via a `patchLibraryBrowse`
    wrapper (calls `getState()` to dodge the `unbound-method` lint + a needless subscription, matching
    the file's pick-handler convention). `expandedPacks` kept as `string[]`; a derived `expandedPackSet`
    memo does the O(1) lookup; `togglePack` rewritten to array add/remove. Search `onChange`, all three
    sentinel `TreeItem`s, and the pack-category `TreeItem` now patch the store. Added optional
    `onPick?: () => void` prop; each of the 6 pick handlers now also `pushLibraryRecent(<entry>)` +
    `onPick?.()`. Imported `LibraryBrowseState` type. Typecheck/lint(0 warnings)/format clean on the
    file; all 333 editor tests pass. Desktop unaffected (state just moved to the store).
  - Replace the four local `useState`s (`search`, `selectedPack`, `selectedCategory`, `expandedPacks` —
    `LibraryPanel.tsx:187-193`) with reads of `libraryBrowse` and writes via `patchLibraryBrowse`
    (search input `onChange`, `TreeItem` clicks, `togglePack`, the Favourites/Nodes/Terrains sentinels).
    Keep `expandedPacks` as a `string[]` in the store; adapt the `Set` toggle logic accordingly. Note
    `search` is store-only (Step 2's `patchLibraryBrowse` skips its disk write) — it survives close/reopen
    but not reload, by design (critique #4).
  - Add optional prop `onPick?: () => void`. In each pick handler (`pickTile`, `armObject`, `armRegion`,
    `armAnim`, `armNode`, `armTerrain`) — after the existing store call — also
    `useEditorStore.getState().pushLibraryRecent(<mapped RecentEntry>)` then `onPick?.()`.
  - Side effects: browse state now survives unmount (fixes the reset-on-close bug) for **all** render
    sites. Confirm desktop behaves identically (state simply lives in the store now). Confirm search +
    tree still filter correctly reading from store.
  - Docs: none (Step 7).
  - Done when: closing/reopening the drawer (and reload) preserves category/search/expanded; picking any
    kind adds it to `libraryRecents`; typecheck/lint clean. Manual: verify via `npm run check` + a driven
    editor session in Step 7's verification.

- [x] **Step 4: Recent strip UI (on a shared preview renderer)** `[inline]`
  - Outcome: `LibraryPanel.tsx` — extracted a shared `resolveRecentSwatch(entry, catalog,
    nodeDefsParsed, terrainCatalog)` (size-free `RecentSwatch` descriptor; `null` when the asset no
    longer resolves) + presentational `AssetSwatch({swatch, sizePx})` — the single home for the
    6-kind crop math (tile/terrain frame-crop, decor region/anim crop, plain-decor/node contain, node
    `color` fallback). `FavouriteItem`'s tile branch now sits on it (dropped ~15 lines of duplicate
    crop math; object branch left as-is per "don't over-refactor"). New `RecentStrip` renders top-of-
    panel (above search/nav), hidden when no recents: a "Recent" heading, all `tile` recents in ONE
    horizontally-scrollable swatch row, then decor/node/terrain in a second scroll row; each swatch is
    a button routing through the parent's existing pick handlers via an `onRearm(entry)` dispatcher (so
    a re-pick also moves-to-front + auto-closes compact). New consts `RECENT_SWATCH_PX=34` /
    `RECENT_SWATCH_PX_COMPACT=40` (compact bigger for touch target); imported `recentIdentity`/
    `RecentEntry`/`TerrainCatalog`; added `libraryRecents` selector. Unresolvable recents are skipped.
    Typecheck clean, eslint 0 errors, prettier-clean, 333/333 editor tests pass. Also fixed a
    pre-existing MD004 lint nit in Step 1's outcome text (a wrapped-line `+` bullet → `and`).
    Visual/driven check is
    bundled into Step 9. NOTE: full `npm run check` still blocked at `format:check` by 4 PRE-EXISTING
    drift files unrelated to this plan (`scripts/asset-catalog.mjs`, `scripts/vite-editor-api.mjs`,
    `src/debug/crashReporter.ts`, `src/systems/__tests__/mapFormat.resize.test.ts` — none touched by
    plan 030/031); left untouched.
  - **First, extract a shared swatch/preview renderer (critique #3)** so the strip doesn't duplicate the
    6-kind preview logic already spread across `FavouriteItem`/`TileFrameGrid`/`NodeCard`/`TerrainCard`.
    Add a small component (e.g. `AssetSwatch`) that, given a `RecentEntry` (or resolved asset + optional
    frame/region), renders the correct cropped preview, reusing the existing crop math. Refactor
    `FavouriteItem`'s resolve-and-render path to sit on it where practical (don't over-refactor working
    desktop code — the goal is one preview definition the strip can reuse, not a full rewrite). This
    extraction lands before the strip markup so Step 4 is reviewable as "renderer + strip".
  - New section rendered at the **top of the Library** (above the search box / nav), on both desktop and
    compact, hidden entirely when `libraryRecents` is empty. Heading e.g. "Recent".
  - **Tiles grouped**: all `kind:'tile'` recents render together in ONE horizontally-scrollable swatch
    row (reuse the per-frame crop swatch math from `TileFrameGrid`/`FavouriteItem`; small swatch size).
    Non-tile recents (decor/node/terrain) render after, as compact swatch buttons/cards.
  - Clicking a recent re-arms via the existing handlers (`pickTile`/`armObject`/`armRegion`/`armAnim`/
    `armNode`/`armTerrain`) — which means it also records a recent (moves to front) and calls `onPick`
    (auto-close on compact), consistent with picking from the main list. A recent whose asset no longer
    resolves in the catalog is skipped/shown as a small missing placeholder (mirror `FavouriteItem`'s
    guard), never a crash.
  - Side effects: shares the pick handlers from Step 3; ensure re-arming from Recent doesn't double-count
    oddly (moving to front is correct/expected).
  - Docs: none (Step 7).
  - Done when: recently-picked items appear top-of-panel, tiles grouped in one scroll row; tapping one
    re-selects it (and closes the drawer on compact). `npm run check` clean.

- [x] **Step 5: Full-width compact drawer + onPick wiring** `[delegate sonnet]`
  - Outcome: `EditorApp.tsx` — both compact-branch `SheetContent`s (Library + Inspector) changed from
    `w-[min(85vw,320px)] … sm:max-w-none` to `w-full max-w-none` (drawer sides preserved:
    Library `left`, Inspector `right`; added terse "why" comments). Compact Library render site now
    `<LibraryPanel onPick={() => setLibraryOpen(false)} />`; desktop docked site left bare (onPick
    undefined = no-op). No `LibraryPanel.tsx` change needed (Step 3's `onPick` already fires after all
    6 pick handlers). Scrim/X dismiss + edge-handle open buttons unaffected (only width classes + one
    prop touched). Typecheck clean (no `EditorApp` errors), eslint 0, prettier-clean, 333/333 editor
    tests pass. Same pre-existing `format:check` drift blocker as Step 4 (4 unrelated files) — untouched.
  - In `EditorApp.tsx` compact branch: change the Library `SheetContent` (`:404-407`) width from
    `w-[min(85vw,320px)] … sm:max-w-none` to full width (`w-full max-w-none`, side="left"). Apply the
    same full-width treatment to the Inspector `SheetContent` (`:418-421`) for consistency.
  - Pass `onPick={() => setLibraryOpen(false)}` to `<LibraryPanel />` at the compact render site
    (`:412`) only. Leave the desktop render site (`:445`) as bare `<LibraryPanel />`.
  - Side effects: full-bleed drawer covers the canvas while open — acceptable for a picker and the
    explicit ask; scrim/close (tap scrim, X button) still dismiss it. Verify the edge-handle open buttons
    still work and the drawer animates from the correct side.
  - Docs: none (Step 7).
  - Done when: compact Library/Inspector drawers are full-screen; picking a tile/decor/node/terrain
    auto-closes the Library drawer. `npm run check` clean.

- [x] **Step 6: Drill-down nav on compact + long-press favouriting** `[inline]`
  - Outcome: new `src/editor/hooks/useLongPress.ts` — pointer-event tap-vs-long-press arbitration (ONE
    gesture source; reuses existing `LONGPRESS_MS=350` from config, read-only import; `MOVE_CANCEL_PX=10`
    threshold; swallows the trailing synthetic click so a long-press never also picks — critique #2).
    `LibraryPanel.tsx`: (a) **drill-down** — `drilledIn = isCompact && no-search && selectedCategory!==null`;
    the tree `<nav>` is hidden when drilled in and its `max-h-[40vh]` cap is dropped on compact (drawer
    scrolls), with a `‹ Back` control (min-h-11) that clears the selection back to the tree; desktop
    layout unchanged. (b) **long-press favouriting (compact only)** — extracted `TileFrameButton` from
    `TileFrameGrid`'s map (hooks can't run in a loop); on compact it + `AssetCard` + `FavouriteItem`'s
    tile branch wire the hook (tap=pick/arm, long-press=toggle favourite + `toast`) and DROP the overlay
    `FavHeart` (the tap-thief); desktop keeps plain `onClick` + the visible heart, untouched. Extended
    the fix to `FavouriteItem`'s tile branch too (beyond the step's named TileFrameGrid+AssetCard) so
    "tapping a tile always picks it / no heart overlaps" holds in the Favourites view as well. Touch
    scroll-drag fires pointercancel/move-threshold → neither picks nor favourites. Per the plan, NO
    keyboard shortcut added, so `shortcuts.ts`/Shortcuts panel need no change. Typecheck fully clean,
    eslint 0, prettier-clean, 333/333 editor tests pass. Visual/driven check bundled into Step 9. Same
    pre-existing `format:check` drift blocker as Steps 4–5 (4 unrelated files) — untouched. No unit test
    for the hook (timer+pointer gesture; behavioural check is Step 9's driven session) — noted as a
    possible future add.
  - **Drill-down (compact only):** when `isCompact` and a real category/sentinel is selected, hide the
    tree `<nav>` (`:353`) and show the results grid full-height with a `‹ Back` control that clears the
    selection (`patchLibraryBrowse({ selectedCategory:null, selectedPack:null })`) back to the tree.
    Desktop keeps today's tree-above-list layout unchanged. Drop/relax the `max-h-[40vh]` nav cap on
    compact so the tree itself gets full height when shown.
  - **Long-press favourite (compact/touch only):** add a reusable `useLongPress` hook in
    `src/editor/hooks/`. On compact the hook **governs both gestures off pointer events** — it must NOT
    coexist with a live `onClick` pick (critique #2): pointerdown starts a ~500ms timer; if it fires
    before release → long-press = toggle favourite + `toast('♥ Favourited')`/`toast('Removed favourite')`,
    and set a ref flag so the **trailing synthetic `click` is suppressed** (swallow the next click /
    `preventDefault`), so a long-press can never also pick+arm+auto-close. Release before the timer with
    movement under a small threshold = tap = the normal pick (fired from pointerup, not a separate
    onClick). Pointer-move beyond the threshold or pointercancel/leave cancels the timer without
    favouriting or picking (so a scroll-drag over the grid does neither). Desktop keeps its plain
    `onClick` pick + visible `FavHeart` click, untouched — the hook is wired only on the compact path.
    - Apply to `TileFrameGrid` frame buttons and the card lists (`AssetCard`). On compact, do **NOT**
      render the overlay `FavHeart` on tile frames (that's the tap-thief — `:633-637`); long-press is the
      only favourite path there. For `AssetCard` on compact, likewise drop the inline heart in favour of
      long-press (or keep it but ensure it can't steal the primary tap — prefer dropping on compact for
      consistency). Desktop keeps the visible `FavHeart` click exactly as today.
  - Side effects: verify long-press doesn't fire during a scroll-drag over the grid (movement threshold
    cancels it); verify tap still reliably picks; ensure desktop pointer/mouse path is untouched. No
    keyboard shortcut is added, so `shortcuts.ts`/Shortcuts panel need **no** change (note this in the
    step so execution doesn't waste effort there).
  - Docs: none (Step 7).
  - Done when: on touch, tapping a tile always picks it, long-press favourites it with a toast, no heart
    overlaps the grid; selecting a category shows a full-height grid with a Back button. `npm run check`
    clean.

### Node Types tab (both desktop + compact)

- [x] **Step 7: Node Types tab — full-width collapsible list-on-top layout** `[inline]`
  - Outcome: `tabs/NodeTypesTab.tsx` — replaced the two-pane (`aside w-[240px]` + right pane) with a
    vertical stack (`flex h-full w-full flex-col`, applies to desktop AND compact): (1) a full-width
    collapsible "Node types" section on top — the def list + `+ New`, wrapped in a hand-rolled ▾/▸
    header mirroring LibraryPanel's pack expander; (2) the global "Save node types" bar; (3) the
    `min-h-0 flex-1 overflow-auto` controls area (`NodeStatsForm` + `SkinManager`) or the empty prompt.
    New `listExpanded` state + `listOpen = selected === null || listExpanded` (list forced open with
    nothing selected; toggle disabled then). New `selectDef(id)` collapses the list on select; wired
    into list-item click, `+ New`, and duplicate. Collapsed header shows `— {selected name}`. ALL
    existing behaviour preserved verbatim (selectedId + deleted-selection fallback effect, New/
    duplicate/delete actions, `referencedDefIds` delete-disable, save/dirty tracking) — layout only.
    Typecheck clean, eslint 0, prettier-clean, 333/333 editor tests pass. Visual/driven check bundled
    into Step 9. Same pre-existing `format:check` drift blocker as earlier steps — untouched.
  - Rework `NodeTypesTab` (`tabs/NodeTypesTab.tsx:96-215`) from the two-pane (`aside w-[240px]` + right
    pane) to a **vertical stack** that applies on both desktop and compact (user's choice):
    1. A **full-width collapsible "Node types" section at the top** — the existing list (`:115-173`) plus
       the `+ New` button, wrapped in a hand-rolled expand/collapse header (mirror `LibraryPanel`'s pack
       expander `▾`/`▸` at `LibraryPanel.tsx:386-400` — no shadcn Collapsible exists in `ui/`, so don't
       add a dependency).
    2. **Below it**, the selected def's controls: the save bar (`:177-200`), `NodeStatsForm`, `SkinManager`.
  - **Selection collapses the list** and reveals the controls below; the collapsed list header shows the
    current selection (e.g. `Node types — {selected name}`) and tapping it re-expands to switch. When
    nothing is selected the list stays expanded with the existing empty-state prompt.
  - Keep all existing behaviour intact: `selectedId` state + the deleted-selection fallback effect
    (`:57-65`), New/duplicate/delete actions, the `referencedDefIds` disable logic. This is a layout
    reflow, not a logic change.
  - Side effects: this tab renders in the main tab-content area (a full editor tab, NOT inside the
    Library/Inspector drawer), so it's independent of Steps 1–6. Verify it still fills its tab container
    (`h-full`/`min-h-0`/`overflow-auto` flow) and that the object-editor/world tabs are untouched.
    Desktop loses its side-by-side list; confirm that's acceptable per the user's "Both" choice.
  - Docs: none (Step 9).
  - Done when: the list is a full-width collapsible block on top; selecting an item collapses it and
    shows that def's stats + skins below; re-expanding lets you switch. Works at desktop and phone
    widths. `npm run check` clean.

- [x] **Step 8: Node Types tab — collapsible Skins section with thumbnail summary bar** `[inline]`
  - Outcome: `SkinManager` (`tabs/NodeTypesTab.tsx`) now collapsible via the same ▾/▸ header. Added
    `useIsCompact` import + `expanded` state defaulting to `!isCompact` (expanded desktop, collapsed
    compact; remounts per def via parent `key`). Header: toggle button (chevron + "Skins" + `({count})`);
    **collapsed** shows a horizontally-scrollable row of `SpriteThumb`s (each skin's live asset/region,
    degrades via SpriteThumb's existing unset/missing handling), kept OUTSIDE the toggle button so it
    scrolls on touch; **expanded** shows `+ Add skin` (ml-auto) + the full `SkinRow` list exactly as
    before. `NodeSpritePickerDialog` left ALWAYS mounted (not inside the expanded branch) so an open
    picker survives a toggle; committed edits live in the store so collapsing mid-edit loses nothing.
    Typecheck clean, eslint 0, prettier-clean, 333/333 editor tests pass. Visual/driven check bundled
    into Step 9. Same pre-existing `format:check` drift blocker — untouched.
  - Make `SkinManager` (`tabs/NodeTypesTab.tsx:547`) collapsible via the same hand-rolled expand/collapse
    header used in Step 7. **Collapsed:** the header bar shows a row of the def's skin thumbnails
    (reuse `SpriteThumb` at `:477`, rendering each skin's live `asset`/`region`) as an at-a-glance
    summary, plus the skin count. **Expanded:** the full `SkinRow` editor list (`:576-593`) exactly as
    today, plus the `+ Add skin` button and the `NodeSpritePickerDialog`.
  - Default state: expanded on desktop, collapsed on compact (so the phone view leads with the stats
    form and the skin summary bar, expandable on demand). Keep the `pickerFor` dialog state working
    whether collapsed or expanded (opening a picker from an expanded row is the only entry point;
    collapsing mid-edit must not lose committed skin edits — they live in the store, so it won't).
  - Side effects: `SpriteThumb` already handles the `PLACEHOLDER_SKIN_ASSET` "unset" and missing-asset
    cases (`:487-508`), so the summary bar degrades gracefully. Confirm the collapsed bar wraps/scrolls
    for a def with many skins rather than overflowing.
  - Docs: none (Step 9).
  - Done when: the Skins section collapses to a thumbnail summary bar and expands to the full editor;
    default open on desktop, collapsed on compact. `npm run check` clean.

- [x] **Step 9: Docs + end-to-end verification (both surfaces)** `[inline]`
  - Outcome: `docs/EDITOR.md` — added "Library on touch (plan 030)" (full-width drawers, auto-close on
    pick, Recent strip, drill-down, long-press favouriting) to the Touch/mobile section; a "Layout
    (plan 030)" note to Node Types (collapsible list-on-top + collapsible Skins); and the new
    `mostowo-editor-library:recents:<mapId>` / `…:browse:<mapId>` keys (with `search` excluded, rename
    migration, reset on close) to the Persistence contract. `docs/STATUS.md` — one-line plan-030 entry
    under the Map Builder section. Confirmed NO `shortcuts.ts`/Shortcuts-panel change (no keyboard
    shortcut added/changed across either surface). Reformatted 4 pre-existing prettier-drift files
    (Matt's call) so `npm run check` clears format:check. **`npm run check` state:** typecheck clean,
    eslint 0 errors (90 pre-existing warnings in test files), lint:md 0 errors, format:check fully
    clean, tests 702/703 — the ONE failure is `src/data/maps/__tests__/world.test.ts` (`the-moon`
    placement-origin drift in committed map data), pre-existing and unrelated to this editor-only plan
    (verified: no map/world data files in the working changes; same drift plan 031 flagged). Driven
    verification: **on-device touch check delegated to Matt** (long-press, full-width drawers, drill-
    down, tap-to-pick) — plan set to "in review" pending that.
  - Update `docs/EDITOR.md`: (a) the new per-map localStorage keys
    (`mostowo-editor-library:recents:<mapId>`, `…browse:<mapId>`) alongside the existing
    underlay-persistence note, and Library touch interactions (tap = pick, long-press = favourite;
    full-width drawers; auto-close on pick; Recent strip; drill-down nav); (b) the Node Types tab's new
    collapsible list-on-top + collapsible-Skins layout. Terse/high-signal per the docs token-budget rule.
  - Update `docs/STATUS.md` with a one-line entry for this editor mobile UX pass (mirror the existing
    plan-NNN status style; this is plan 030, covering Library + Node Types).
  - No `shortcuts.ts` change (no keyboard shortcut added/changed across either surface) — confirm and note.
  - Docs: the two files above only.
  - Done when: `npm run check` fully green, and a driven editor session (compact + desktop) confirms:
    Library — persist across close/reopen, full-width drawer, auto-close on pick, Recent strip with
    grouped tiles, long-press favourite; Node Types — collapsible list-on-top, select-collapses-shows-
    controls, collapsible Skins with thumbnail summary bar. Use the `verify`/`run` skill to drive it.

## Out of scope

- Any change to how favourites are stored (they stay per-zone/per-map in the `MapFile`, undoable).
- Changing desktop **Library** favouriting (keeps the visible heart click) or the desktop Library
  drawer/layout behaviour. (The Node Types tab layout DOES change on desktop — that's in scope per the
  user's "Both" choice.)
- Any change to Node-Types *logic* — stats validation, skin add/remove/reorder/weight, the sprite
  picker dialog, save/dirty tracking. Steps 7–8 are a layout reflow only.
- Other editor tabs (object-editor, world) — untouched.
- Procedural/game-side changes — this is editor-only (dev build), excluded from prod.
- A settings UI for RECENTS_CAP or clearing recents (fixed cap = 24; no manual clear this pass).
- Reworking the AtlasSheetPicker zoom/pan interactions (already compact-tuned).

## Critique

> Fresh-eyes review (critique-plan): solid, well-researched plan aligned with the project's cross-device
> tooling direction; no High blockers. Findings #1–#4 + #7 folded into the steps above; #5 resolved as
> "both drawers full-width" (user choice); #6 is informational.

|#|Finding|Severity|Resolution|
|-|-------|--------|----------|
|1|`renameMap` doesn't migrate the new recents/browse keys → data loss + orphaned keys on rename+reload|Medium|Folded into Step 2 (old→new migration mirroring underlay; `delete*` helpers added to Step 1)|
|2|Long-press coexisting with live `onClick` → long-press could also pick+arm+auto-close|Medium|Folded into Step 6 (hook governs both gestures off pointer events; suppress trailing synthetic click)|
|3|Recent strip re-implements 6-kind preview logic already in FavouriteItem/TileFrameGrid/cards|Medium|Folded into Step 4 (extract shared `AssetSwatch` renderer first)|
|4|Store-backed `search` write-through persists on every keystroke for marginal value|Low|Store-only search (user choice) — Steps 1–3 updated|
|5|Step 5 bundles Inspector full-width (outside the Library ask)|Low|Kept — user chose both drawers full-width|
|6|Editor mobile-UX not on a forward roadmap; justified by CLAUDE.md cross-device rule only|Low|Informational — no action|
|7|`pushLibraryRecent`/write-through assumes a non-null `mapId`|Low|Folded into Step 2 (guard on `mapId`)|
