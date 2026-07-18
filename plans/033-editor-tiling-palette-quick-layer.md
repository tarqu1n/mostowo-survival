# Editor: tiling palette + quick layer selector

> Status: deployed

## Summary

Tile-layout authoring in the Map Builder is a high-friction loop: open the Library, scroll to a
tile, close the Library, paint, open the Inspector → Layers tab to change the active layer, reopen
the Library (which has scrolled back to the top), find the next tile, repeat. This feature removes
that loop by augmenting the existing **brush** workflow (no new tool/mode) with two always-visible
surfaces: (1) a **tile palette** the user fills by multi-selecting several tiles from the Library at
once, then one-tap switches between while painting, and (2) a **quick layer selector** — a compact
cycle/dropdown control bound to `activeLayerId` — so switching the paint layer no longer needs the
Inspector→Layers drawer round-trip. Palettes are **named, multiple, and persisted in the map file**
so they travel across devices via the editor's autocommit (matching the cross-device phone-authoring
rule and the existing `MapMeta.favourites` precedent).

## Context & decisions

Research verified against the codebase (paths absolute under `/home/user/mostowo-survival`).

**Locked design decisions (from interrogation):**

1. **Enhance the existing brush** — no new `EditorTool`. The palette and layer selector are surfaces
   that drive the existing `brushAsset` / `brushRotation` / `activeLayerId` state. Selecting a
   palette slot arms the brush exactly like `pickTile` does today.
2. **Palettes persist in the map file** (not localStorage) so they sync across devices via
   autocommit. Multiple **named** palettes; one active at a time. Minimal management: an active
   palette + a switcher + a "＋ new palette" affordance. Rename/delete are out of scope for now
   (edit the file directly). Precedent: `MapMeta.favourites` already lives in the map file.
   **Only the palette *structure* (`tilePalettes`) persists in `MapMeta`.** The *active-palette
   pointer* is **editor view-state** (store-only, not persisted), reconciled to the first palette on
   load and after any history move — exactly like `activeLayerId` (`store:299`, reconciled by
   `reconcileActiveLayer` `:864`), which is deliberately **not** in the map file. This avoids
   dirtying/autocommitting the map on every palette switch.
3. **Palette slots store the tile only** — `{ assetId, rotation }` (i.e. `brushAsset` + `brushRotation`).
   **Not** palette indices (those are per-map, append-only, derived lazily via
   `findOrAppendPaletteIndex`). Layer is **not** bound per slot — the layer selector is independent.
4. **Quick-switch is click/tap only** (no number-key or cycle-key hotkeys) — touch-first, since the
   editor is used heavily on a phone.
5. **Multi-select from Library = explicit toggle + Add** — a "select for palette" toggle in the
   Library; tap several tiles to check them; an "Add to palette" button drops them all into the
   active palette.
6. **Quick layer selector = compact cycle/dropdown** — a single small control showing the current
   layer name; tap cycles to the next layer, with a dropdown to jump directly. Reuses
   `activeLayerId` + `setActiveLayer`.
7. **Mutation mechanism (mirror favourites exactly).** Palette *structure* edits (add palette, add
   tiles, remove slot) route through **`applyCommand`** — which is what `addFavourite`/etc. do
   (`store:2805-2841`); `applyCommand` (`:1687-1699`) sets `dirty:true` + `docRevision+1` and
   registers undo/redo. So structural palette edits are **undoable** (consistent with favourites) and
   trigger a re-render + autocommit. The **active-palette switch** is a **direct `set`** (like
   `setActiveLayer` `:1416`), **not** a history command and **not** dirty. **Never** bump `mapEpoch`
   (documented `:9-11` as full-document-replaced → full texture reload/bake/camera-fit) or
   `pendingDirty` (the paint-chunk-narrowing signal) for palette edits — both are wrong signals for a
   meta edit. Transient Library multi-select state (Step 4) is plain store view-state — no command,
   no dirty.

**Key existing shapes to mirror (verified):**

- **Store:** one Zustand store `src/editor/store/editorStore.ts` (`create<EditorState & Actions>()(subscribeWithSelector(...))`).
  `map` is mutated **in place**; panels subscribe to `docRevision`/`mapEpoch` counters as re-render
  triggers and read `useEditorStore.getState().map` fresh in render. Actions are stable; components
  call `useEditorStore.getState().foo()`. Undo/redo is a command stack (`store/history.ts`).
- **Brush arm path:** `LibraryPanel.tsx` `pickTile(assetId)` (~`:644-653`) → `setBrushAsset(assetId)`,
  switch to brush tool unless already brush/rect, `pushLibraryRecent(...)`, `onPick?.()`. Tile state
  = `brushAsset: string | null` (catalog id, optionally `#frame`) + `brushRotation`.
- **Recent strip** (`libraryRecents` + `RecentEntry` union + `pushLibraryRecent` + `RecentStrip`
  around `LibraryPanel.tsx:420`) is the **closest existing analogue** to a palette — a per-map,
  persisted, one-tap re-pick strip. The palette generalises it (curated + named + multiple).
- **Layers:** `TileLayer` in `src/systems/mapFormat.ts:54-62`; layers stored bottom→top. Active layer
  = `activeLayerId: string | null` (`store:299`), setter `setActiveLayer` (`store:1416`),
  reconciled by `reconcileActiveLayer` (`store:864`). Today changed only via `LayersPanel.tsx`
  (`setActiveLayer(layer.id)` `:116`) — a tab inside the right `InspectorTabs`.
- **Map file model & persistence:** `src/systems/mapFormat.ts` (`MapFile`, `MapMeta`, serialise/
  parse). `MapMeta.favourites` already stores editor curation in the map file. IO via
  `src/editor/api.ts` (`getMap`/`putMap`). Map load/new rehydration lives in the store around
  `:1328-1358`. Saving a dirty map autocommits (editor `EDITOR_AUTOCOMMIT=1`).
- **Shells:** desktop = docked `react-resizable-panels` (Library left aside, `CenterPane`, fixed
  280px right aside with `InspectorTabs`) — `EditorApp.tsx:498`. Compact (`hooks/useIsCompact.ts`,
  `(max-width:960px), (pointer:coarse) and (max-width:1200px)`) = full-bleed `CenterPane` +
  Library/Inspector as `<Sheet>` drawers that **unmount content on close** (root cause of the
  Library scroll reset) + bottom `ContextBar.tsx` + `SelectionBar`. **Any palette/multi-select UI
  state must live in the store, not local `useState`, to survive drawer teardown.**
- **UI kit** (`src/editor/ui/`): `button.tsx` (`secondary`/`ghost`/`outline`; sizes `sm`/`icon-xs`/
  `icon-lg`), `select.tsx`, `dropdown-menu.tsx`, `dialog.tsx`, `tooltip.tsx`, `separator.tsx`,
  `input.tsx`, `PanelBarButton.tsx`. Shared Library class strings `libLabelClass`/`libSwatchClass`/
  `libCardClass` (`LibraryPanel.tsx:130-139`); heading treatment `headingClass`
  (`LayersPanel.tsx:23`). Styling via `editor.css` `@theme` tokens (`--color-raised`/`-surface`/
  `-active`/`-gold`/`-selection`…). `src/editor/lib/utils.ts` exports `cn`.
- **Tile swatch rendering:** the Library renders tile frames as swatches (`AtlasSheetPicker` /
  `TileFrameGrid` / per-frame `libSwatchClass` cards). The palette must render a swatch from an
  `assetId` (+ rotation) — reuse whatever swatch/thumbnail primitive the Library uses for a single
  frame (find the smallest reusable renderer; extract it if it's inline).

**Friction / gotchas to respect:**

- Palette stores `assetId`+`rotation`, never palette indices.
- No multi-tile/NxM stamp patterns — one tile per slot (out of scope).
- Compact drawers unmount → store-held UI state only.
- `reconcileActiveLayer` already keeps `activeLayerId` valid across history moves — the quick
  selector just needs to read it and call `setActiveLayer`; don't duplicate reconciliation.
- Adding a keyboard binding requires editing **both** `EditorApp.tsx`'s window handler and
  `shortcuts.ts` — but this feature is **click-only**, so no new bindings unless we add optional
  layer-cycle keys (kept out unless trivial).

## Steps

- [x] **Step 1: Palette data model in the map file** `[inline]`
  - Outcome: Added `TilePaletteSlot`/`NamedTilePalette` types + `MapMeta.tilePalettes?` (new LAST field, after `favourites`) in `src/systems/mapFormat.ts`; omit-when-absent on both parse (`parseTilePalettes` helper, only read when present) and serialise (return-spread `...(tilePalettes === undefined ? {} : { tilePalettes })`), mirroring `favourites` — no `activeTilePaletteId` (store-only). Only one meta parse path (`parseMeta`); the plan's `:475-480` pointer was `parseZoneDef`'s per-zone favourites, unrelated. No id minting here (belongs to Step 2's store, reusing the `prefix_NNNN` scheme). Tests: added 6-test `meta.tilePalettes` block to `mapFormat.test.ts` (legacy byte-identical round-trip, with-palettes lossless, key-order, rejects). Verified: typecheck clean; 72 mapFormat tests pass.
  - In `src/systems/mapFormat.ts`, add palette types and wire **only the palette structure** into
    `MapMeta` (mirror how `favourites` is declared, serialised, and parsed). Add:
    `TilePaletteSlot = { assetId: string; rotation?: number }` and
    `NamedTilePalette = { id: string; name: string; slots: TilePaletteSlot[] }`. Add to `MapMeta`:
    `tilePalettes?: NamedTilePalette[]` **only**. Do **not** add `activeTilePaletteId` to `MapMeta` —
    the active-palette pointer is editor view-state and lives in the store (Step 2), like
    `activeLayerId`.
  - **Preserve the byte-identical legacy round-trip.** `serializeMap`/`parseMeta` must follow the
    `favourites` pattern **exactly** (see `mapFormat.ts` ~`:389`): when `tilePalettes` is absent,
    **omit the key entirely** on serialise — do **not** materialise `tilePalettes: []` in `parseMeta`,
    or `serializeMap` will re-emit it and break the guaranteed lossless round-trip for legacy maps.
    Defaulting to `[]` happens at the **read sites in the store** (via `?? []`), not in the parser.
  - Generate slot/palette ids with the same id scheme the format already uses for layers/zones
    (find the existing id helper; do not introduce a new random scheme).
  - Side effects: anything that reads/writes `MapMeta` or snapshots the map (thumbnailing, `putMap`,
    history serialisation if meta is included). Palette *structure* IS map data (persisted, and — per
    Step 2 — undoable via `applyCommand`, matching favourites); the active pointer is not.
  - Docs: none yet (covered in Step 7). Add a one-line comment on the new types.
  - Done when: `mapFormat` unit tests pass; parse→serialise of a **legacy** map (no `tilePalettes`
    key) is **byte-identical** (key stays absent); a map **with** `tilePalettes` round-trips
    losslessly; typecheck clean.

- [x] **Step 2: Store slice — palette state, actions, rehydration** `[inline]`
  - Outcome: All in `src/editor/store/editorStore.ts` + new `src/editor/store/__tests__/editorStoreTilePalettes.test.ts` (16 tests). Added `activeTilePaletteId` view-state + transient `palettePickMode`/`palettePickSelection`. Structural edits (`addTilePalette`/`addTilesToActivePalette`/`removeTilePaletteSlot`) build a `Command{do,undo}` and route through `applyCommand` (favourites template → undoable + dirty + `docRevision+1`, no `mapEpoch`/`pendingDirty`); read `map.meta.tilePalettes ?? []` at all read sites, array only materialised inside a command's `do` (lazy first-palette creation in `addTilesToActivePalette`). `setActiveTilePalette` = direct `set` (no dirty), new-palette-active also a separate `set` outside the command. Ids via `nextTilePaletteId` (clone of `nextLayerId`'s `palette_NNNN` scan-for-max). `selectPaletteSlot` replicates `pickTile`'s store-level brush-arm (setBrushAsset + setBrushRotation + tool-switch unless brush/rect) — replicated not shared because `pickTile` also does component-only `pushLibraryRecent`/`onPick`. `reconcileActiveTilePalette` is a read-only fn wired alongside every `reconcileActiveLayer` site (applyCommand, undo/redo branches, resize) + load/new/close paths. Verified: typecheck clean; 196 store tests pass (0 regressions); eslint clean on changed files. Deviation: undoing the first palette-add leaves `tilePalettes=[]` (mirrors favourites; legacy-clean guarantee holds since load never runs a command — test-verified).
  - In `src/editor/store/editorStore.ts`. `map.meta.tilePalettes` is the persisted source of truth
    (read fresh from `getState().map` in render bodies, per repo convention). Add **one** piece of
    store view-state: `activeTilePaletteId: string | null` (default `null`) — **not** persisted to the
    map file, reconciled like `activeLayerId`.
  - **Mutation mechanism — follow favourites, not a counter bump.** Structural palette edits MUST go
    through **`applyCommand`** exactly as `addFavourite`/etc. do (`store:2805-2841`) — building a
    `Command` that mutates `map.meta.tilePalettes` in place; `applyCommand` (`:1687-1699`) then sets
    `dirty:true`, bumps `docRevision`, and registers undo/redo. **Do not** touch `mapEpoch` or
    `pendingDirty` for any palette action (both are wrong signals for a meta edit — see decision #7).
  - Actions to add:
    - `reconcileActiveTilePalette()` — internal, mirrors `reconcileActiveLayer` (`:864`): if
      `activeTilePaletteId` is null or dangles, set it to the **first** palette's id (or `null` when
      there are none). Call on map load and after every history move (wire into the same place
      `reconcileActiveLayer` is called).
    - `addTilePalette(name?)` — **applyCommand**: append a new empty named palette (`"Palette N"`
      default, N = count+1) to `map.meta.tilePalettes` (creating the array if absent). Then, as a
      separate direct `set` (not part of the command), make it the active palette.
    - `setActiveTilePalette(id)` — **direct `set`** of `activeTilePaletteId` only (like
      `setActiveLayer`): no command, no dirty, no counters.
    - `addTilesToActivePalette(entries: TilePaletteSlot[])` — **applyCommand**. **Lazy creation:** if
      no palettes exist, create `"Palette 1"` as part of this flow and make it active (so legacy maps
      are *not* migrated/dirtied merely by being opened — a palette is only ever written when the user
      actually adds tiles). Bulk-append `entries` to the active palette, deduping exact
      `assetId`+`rotation` duplicates. Used by the Library "Add to palette" button.
    - `removeTilePaletteSlot(paletteId, index)` — **applyCommand**: remove the slot.
    - `selectPaletteSlot(slot)` — arm the brush from a slot: `setBrushAsset(slot.assetId)`, set
      `brushRotation` to `slot.rotation ?? 0`, and switch to the brush tool unless already on
      brush/rect (reuse the exact logic `pickTile` uses — factor a shared helper if clean, else
      replicate). This is a brush-arm, **not** a palette mutation — no command/dirty.
  - **Rehydration:** on `loadMap`/`newMap` (`:1328-1358`) do **not** create any palette; just call
    `reconcileActiveTilePalette()` so the pointer targets the first existing palette (or stays `null`
    for a map with none). `map.meta.tilePalettes` is already loaded with the map.
  - Also add transient (store-held, non-persisted, **no command/dirty**) UI state for Library
    multi-select used in Step 4: `palettePickMode: boolean` and `palettePickSelection: string[]`
    (assetIds, or `assetId#frame`), with actions `togglePalettePickMode()`,
    `togglePalettePickTile(assetId)`, `clearPalettePick()`. Keep these in the store (not component
    state) so they survive compact `<Sheet>` unmount.
  - Side effects: wire `reconcileActiveTilePalette` into the load path **and** the post-history-move
    path alongside `reconcileActiveLayer` (undoing an `addTilePalette` must not leave a dangling
    pointer). Ensure `selectPaletteSlot` reuses the brush-arm path so tool-sync/library-filter side
    effects stay consistent. Confirm no interaction with `armObject`/`armNode`/`armTerrain` (palette
    is tiles-only).
  - Docs: none yet.
  - Done when: unit tests cover `addTilePalette`/`addTilesToActivePalette` (incl. **lazy first-palette
    creation**)/`selectPaletteSlot`/`removeTilePaletteSlot`/`reconcileActiveTilePalette`; **undo**
    reverses a structural palette edit (proves it went through `applyCommand`); switching the active
    palette does **not** mark the map dirty; opening a legacy map (no `tilePalettes`) leaves it clean
    (not dirtied/migrated); adding a tile then serialise→parse preserves it; typecheck + lint clean.

- [x] **Step 3: Palette strip component** `[inline]`
  - Outcome: Extracted the swatch renderer out of `LibraryPanel.tsx` into new shared `src/editor/panels/assetSwatch.tsx` (exports `RecentSwatch` type, `AssetSwatch`, `resolveRecentSwatch`, `nodePreviewUrl`, `EMPTY_NODE_DEFS`, `TERRAIN_SHEET_COLS_FALLBACK`) — LibraryPanel imports them back, behaviour identical (RecentStrip/Favourites unchanged). New `src/editor/panels/PaletteStrip.tsx`: shadcn `Select` switcher bound to `activeTilePaletteId`→`setActiveTilePalette` + "＋" (`addTilePalette`); slots rendered via shared `AssetSwatch`/`resolveRecentSwatch({kind:'tile',assetId})`, tap→`selectPaletteSlot`; active slot ringed when `brushAsset`+`brushRotation` match (`rotation ?? 0`); per-slot remove ✕ (hover on desktop, stacked `min-h-11` ≥44px button on compact via `useIsCompact()`); empty states for no-palettes ("＋ New palette", respects lazy creation) and empty-palette ("Add tiles from the Library"). Subscribes to `docRevision`/`mapEpoch`, reads `map.meta.tilePalettes` fresh from `getState()`. Not yet mounted (Step 6). Verified: typecheck clean; 377 editor tests pass (no regression from extraction); eslint clean. No component render-test harness in repo, so no unit test (per fallback).
  - New file `src/editor/panels/PaletteStrip.tsx` (mirror `RecentStrip` shape and `libSwatchClass`/
    `libLabelClass`/`headingClass` conventions). Renders:
    - A **palette switcher** — a compact `select.tsx` (or `dropdown-menu.tsx`) listing named
      palettes by name, bound to `activeTilePaletteId` → `setActiveTilePalette`; plus a "＋" button →
      `addTilePalette()`.
    - The **active palette's slots** as one-tap swatches. **Reuse the existing swatch renderer** the
      Recent strip uses (`AssetSwatch` / `resolveRecentSwatch` + `libSwatchClass`) rather than
      reimplementing frame rendering, so palette and Library swatches can't drift. If that renderer is
      currently private to `LibraryPanel.tsx`, export/extract it minimally.
      Tapping a slot → `selectPaletteSlot(slot)`. The slot matching the current `brushAsset` +
      `brushRotation` is highlighted (`--color-active`/`--color-selection`), mirroring how
      `RecentStrip`/Library shows the active pick.
    - A per-slot remove affordance (small ✕ on hover / always-visible at ≥44px tap target on
      compact via `useIsCompact()`), → `removeTilePaletteSlot`.
    - An empty state when the active palette has no slots ("Add tiles from the Library").
  - Subscribe to `docRevision`/`mapEpoch` for re-render and read `map`/palette state fresh from
    `getState()` in the render body (repo convention — see any panel module doc).
  - Side effects: none beyond store reads/writes. Ensure compact tap targets ≥44px (match
    `LayersPanel.tsx` compact branches).
  - Docs: none yet.
  - Done when: rendered in isolation (or once wired in Step 6) the strip lists palettes, switches
    them, shows slots, highlights the active tile, tap-selects (arms brush), and removes slots;
    typecheck + lint clean.

- [x] **Step 4: Library multi-select → Add to palette** `[inline]`
  - Outcome: All in `src/editor/panels/LibraryPanel.tsx`. New `PalettePickControls` (under the role-filter chips): a "Select for palette" toggle (`palettePickMode`/`togglePalettePickMode`, flips `outline`→filled `default` + "● Selecting tiles" label + hint line when active) and an "Add to palette (N)" button (disabled at 0). Branched CENTRALLY inside `pickTile`: when `palettePickMode`, call `togglePalettePickTile(assetId)` and return before any brush-arm (also skips `onPick?.()` so the compact drawer stays open) — this one funnel covers every tile-frame surface (`TileFrameGrid`/`TileFrameButton`, Favourites tile cards, Recent tile re-arm). Selected overlay: `border-selection` ring + tint + ✓ badge on `TileFrameButton`/`FavouriteItem` tiles whose id is in `palettePickSelection` (read via selectors, re-renders on toggle). Add flow maps selection → `{assetId}` slots (rotation omitted = 0, byte-identical), calls `addTilesToActivePalette`, resolves active-palette name AFTER (lazy "Palette 1" may have been created), toasts via already-used `sonner`, exits via `togglePalettePickMode()` (clears selection). Object/node/terrain arm paths (`armObject`/`armRegion`/`armAnim`/`armNode`/`armTerrain`) untouched — only the tile path branches; non-pick `pickTile` unchanged. Verified: typecheck clean; eslint clean; 377 editor tests pass.
  - In `src/editor/panels/LibraryPanel.tsx`, add a **"select for palette"** toggle
    (a `button.tsx` `outline`/`ghost` near the existing role-filter chips ~`:480-485`) bound to
    `palettePickMode`/`togglePalettePickMode`. While active:
    - Tile swatches show a check/selected overlay driven by `palettePickSelection`; tapping a tile
      calls `togglePalettePickTile(assetId)` **instead of** `pickTile` (branch inside the swatch's
      click handler on `palettePickMode`). Only tile-role/`type:'tile'` frames are selectable
      (objects/actors ignore the toggle — they can't go in a tile palette).
    - Show an **"Add to palette (N)"** button (disabled when N=0) that calls
      `addTilesToActivePalette(...)` mapping the selection to `{assetId, rotation}` slots (rotation 0
      unless the id carries one), then `clearPalettePick()` and exits pick mode (or stays in pick
      mode — pick the less surprising: **exit** and toast "Added N tiles to `<palette>`"). Reuse
      `sonner.tsx` toast if the Library already toasts elsewhere; otherwise skip the toast.
  - Keep `palettePickMode` visually distinct so the user knows taps won't paint. Ensure leaving the
    Library (compact drawer close) does **not** lose the selection (state is in the store).
  - Side effects: the swatch click handler is shared across pack grids — branch centrally so every
    tile-frame surface honours pick mode. Verify object/node/terrain arm paths are untouched.
    Verify normal (non-pick) behaviour of `pickTile` is unchanged when `palettePickMode` is false.
  - Docs: none yet.
  - Done when: toggling pick mode lets you multi-select several tiles across categories, "Add to
    palette" fills the active palette (verified in the Step 3 strip), selection survives a compact
    drawer close/reopen; normal picking still works when the toggle is off; typecheck + lint clean.

- [x] **Step 5: Quick layer selector control** `[inline]`
  - Outcome: New `src/editor/ui/QuickLayerSelect.tsx` (chose `ui/` — small composed controls like `RotationWheel`/`SkinThumb` live there). Primary button (secondary variant) shows the active layer name (fallback "No layer"), tap cycles `(i+1) % length` over `[...map.layers].reverse()` (top-first like LayersPanel) with wrap; disabled when `<2` layers; null/stale active selects `presented[0]`. Secondary chevron `DropdownMenu` of `DropdownMenuCheckboxItem`s (top-first, `checked` on active) → `setActiveLayer`. Subscribes to `activeLayerId`+`docRevision`/`mapEpoch`, reads `getState().map` fresh; no reconciliation duplicated. Compact: `h-11`/`size-11`/`min-h-11` (≥44px) via `useIsCompact()`. No keyboard bindings. Not yet mounted (Step 6). Verified: typecheck clean; eslint clean. No render-test harness in repo → no unit test (per fallback). Ran concurrently with Step 3 (write-disjoint, single new file, no shared-file edits).
  - New file `src/editor/ui/QuickLayerSelect.tsx` (or `panels/QuickLayerSelect.tsx` to match where
    small controls live). A compact control bound to `activeLayerId` / `setActiveLayer`:
    - Primary affordance: a button showing the **current layer name** (fall back to "No layer" when
      `activeLayerId` is null); tapping **cycles** to the next layer (wrap around; respect the
      bottom→top order but present top-first like `LayersPanel`). Include a small overhead/eye hint
      only if trivial — otherwise just the name.
    - Secondary affordance: a `dropdown-menu.tsx`/`select.tsx` (chevron) to jump directly to any
      layer by name (top-first list, active one checked).
  - Read layers fresh from `getState().map.layers`; subscribe to `docRevision`/`mapEpoch`. Handle
    zero/one-layer maps gracefully (disable cycle when <2 layers).
  - Side effects: none beyond `setActiveLayer` (which is already reconciled). Do not add keyboard
    bindings (click-only per decision) — so no `EditorApp.tsx`/`shortcuts.ts` edits.
  - Docs: none yet.
  - Done when: the control shows the active layer, cycling and direct-select both call
    `setActiveLayer` and update the highlighted layer everywhere (LayersPanel stays in sync);
    typecheck + lint clean.

- [x] **Step 6: Wire palette strip + quick layer selector into both shells** `[inline]`
  - Outcome: `src/editor/EditorApp.tsx` + `src/editor/ContextBar.tsx`. Gate `showTilingBar = activeTabId === 'map' && !!map` (Map tab only — not further gated to brush, since the palette doubles as a reference while placing too). Desktop: wrapped `CenterPane` inside `ResizablePanel id="center"` in a `flex h-full min-h-0 flex-col`, CenterPane kept in a `relative min-h-0 flex-1` wrapper (canvas viewport never collapses), with a `flex-none` bar beneath holding `<QuickLayerSelect/>` + `<PaletteStrip/>` (palette in `min-w-0 flex-1 overflow-x-auto`). `ResizablePanelGroup` persisted-layout props untouched (wrap is inside the center panel). Compact: `<PaletteStrip/>` inserted as a `flex-none overflow-x-auto` strip between the viewport div and `<SelectionBar/>` (stacks above SelectionBar+ContextBar, outside canvas, no Library-drawer dependency; SelectionBar self-hides so no collision); `<QuickLayerSelect/>` added to `ContextBar.tsx`'s `activeTool === 'brush'` cluster (tiling controls, inherits component's ≥44px compact sizing). Non-map tabs hide both bars. Verified: typecheck clean; eslint clean; 377 editor tests pass. Runtime editor drive + boot canary deferred to final review.
  - Mount `PaletteStrip` and `QuickLayerSelect` so they're **always visible while tiling**, in both
    shells (`src/editor/EditorApp.tsx`, and `src/editor/ContextBar.tsx` for compact):
    - **Desktop:** place the palette strip + quick layer selector as a slim bar directly under the
      `CenterPane` viewport (or docked at the bottom of the Library aside — choose whichever keeps
      the map unobstructed and the palette one-glance reachable while painting; a bar under the
      viewport is preferred so it doesn't depend on the Library being open). Keep it out of the way
      when the active tool isn't a tile-paint tool if that reads cleaner — but default to
      always-visible.
    - **Compact:** surface the quick layer selector in `ContextBar.tsx` (it already hosts per-tool
      controls) and the palette strip as a thin always-visible strip above the ContextBar (so it
      doesn't require opening the Library drawer). Ensure it doesn't collide with `SelectionBar`
      when a selection exists (stack or hide per existing ContextBar layout rules).
  - Follow the `invisible pointer-events-none` (not `display:none`) rule if any hide/show interacts
    with the Phaser `Scale.RESIZE` canvas region (see `EditorApp.tsx:124` comment) — but these bars
    are outside the canvas, so plain conditional mount is fine as long as the viewport isn't
    collapsed.
  - Side effects: shared shell files — verify desktop resizable layout and compact ContextBar
    spacing/scroll still behave; check the bar reflows on the `useIsCompact` breakpoint. Verify no
    regression to the persisted `mostowo-editor-layout` split.
  - Docs: none yet.
  - Done when: on both desktop and a compact/touch viewport, the palette and layer selector are
    visible during painting, filling a palette from the Library then one-tap switching tiles works
    end-to-end without opening the Inspector, and changing the layer via the quick selector paints
    onto the chosen layer; typecheck + lint clean; boot canary passes.

- [x] **Step 7: Docs + shortcuts + status** `[delegate]`
  - Outcome: Extended `docs/EDITOR.md` (the canonical Map Builder UX doc, already linked from `docs/README.md`) with a terse "Tiling palette & quick layer selector (plan 033)" subsection (workflow + key facts: named/per-map/persisted-in-`MapMeta.tilePalettes`; fill via Library "Select for palette" → "Add to palette"; one-tap to arm; undoable structure edits vs view-state active pointer; rename/delete-by-file; quick layer selector cycles/jumps; click-only). Added a plan-033 line to `docs/STATUS.md`'s Map Builder editor section. `MOBILE-EDITOR-ACCESS.md` left alone (it's about running the editor on a phone, not UI surfaces). `src/editor/shortcuts.ts` confirmed untouched by plan 033 (click-only feature). Verified: markdownlint 0 errors; EDITOR.md discoverable from README. No `CLAUDE.md` edit.
  - Update `docs/` for the editor's tiling workflow. Add a short subsection (terse, high-signal)
    describing the tiling palette (named, per-map, persisted in the map file; fill via Library
    "select for palette" → Add; one-tap switch) and the quick layer selector. Put it wherever the
    editor UX is documented — check `docs/README.md`'s art/editor pipeline links and the mobile
    editor doc (`docs/MOBILE-EDITOR-ACCESS.md`) for the compact surface; add to the most relevant
    leaf, don't inline into root `CLAUDE.md`.
  - If `src/editor/shortcuts.ts` gained any binding (it should **not**, feature is click-only),
    document it; otherwise leave `shortcuts.ts` untouched.
  - Add a one-line entry to `docs/STATUS.md` under the editor section noting the tiling palette +
    quick layer selector landed.
  - Side effects: none (docs only).
  - Docs: this step is the docs.
  - Done when: markdownlint passes (repo has a pre-commit md lint hook); the new workflow is
    discoverable from `docs/README.md`; `STATUS.md` mentions the feature.

- [x] **Step 8: Mobile compact-layout polish** `[inline]`
  - Outcome: `QuickLayerSelect.tsx` — primary button now shows the layer **number** (0-based, top-first) instead of the name (name in tooltip/aria-label + dropdown); compact renders **number-only** (chevron dropdown desktop-only, since the ContextBar is space-tight and direct selection stays in Inspector→Layers); wrapper `shrink-0` so it never compresses. `PanelBarButton.tsx` — Library/Inspector bottom-bar buttons are now **icon-only** (`size-12`, label kept in aria-label/title) to free ContextBar width. `PaletteStrip.tsx` — dropped its own "PALETTE"/"Palette" title row (the Select trigger already shows the name + built-in down-arrow), reclaiming a row on compact + desktop. Verified via editor drive at 390px phone viewport: ContextBar tool-cluster went from 15px→74px so the number button is fully visible (was clipped to a sliver); layer number cycles 2→0 (0-based wrap); palette fill/switch/remove all work; desktop shows "N ▾" + dropdown; zero console errors; typecheck + lint clean; 377 editor tests pass. Updated `docs/EDITOR.md` layer-selector description.
  - Follow-up (phone feedback): the full-width "＋ Select for palette" button wasted the top of the touch Library, so `PalettePickControls` is now a small **palette+plus icon toggle** (exported from `LibraryPanel.tsx`). On compact it lives in the **Library drawer's bottom bar** on the right (mirroring the Library close-toggle on the left, wired in `EditorApp.tsx`); on desktop it stays a small icon in the Library panel. Entering pick mode toasts a hint (replacing the inline hint line); "Add (N)" appears beside the toggle while picking. Verified on both viewports: full-width button gone, pick→select→Add works, zero console errors.
  - Added during review after driving the compact/touch shell (390px phone): the tiling bars were
    functional (zero console errors, ≥44px targets) but cramped — the ContextBar's quick layer
    selector clipped when the row overflowed, and the palette strip was tall (own "PALETTE" title +
    the `Palette N ▾` switcher + slots). User design direction:
  - **QuickLayerSelect → tiny number-cycle button** (`src/editor/ui/QuickLayerSelect.tsx`): the
    primary button shows the active layer's **number** (its 1-based position in the top-first
    presentation order) instead of the full name — super small, so it stops overflowing/clipping the
    compact ContextBar. Tap still cycles (wrap, disabled `<2` layers). Keep the chevron dropdown
    (names, active checked) for direct jump, and put the full layer name in the button's `title`/
    `aria-label` so the number stays legible.
  - **PaletteStrip → drop its own title** (`src/editor/panels/PaletteStrip.tsx`): remove the
    uppercase "PALETTE"/"Palette" label row in both the empty and populated states. The `Select`
    trigger already shows the palette name + a built-in down-arrow (`ChevronDownIcon`), which IS the
    switcher the user wants — so the name+arrow stands alone with no redundant heading, reclaiming a
    row of height on compact (and desktop).
  - Side effects: both are shared by desktop + compact; re-verify desktop still reads well (the
    number is fine there too; name is in the tooltip). No store/data changes. No new keyboard
    bindings.
  - Docs: update the `docs/EDITOR.md` subsection if the number-based layer control changes the
    described interaction ("shows the current layer name" → "shows the layer number; name in the
    dropdown/tooltip").
  - Done when: on a 390px phone the quick layer selector no longer clips and the palette strip is
    shorter, both still work (cycle layers, switch/fill/arm palette), desktop unaffected; typecheck +
    lint clean; re-verified via the editor drive with zero console errors.

## Out of scope

- Multi-tile / NxM stamp brushes or pattern-fill (palette holds single tiles only; `brushAsset` is a
  single scalar today and extending the paint pipeline for patterns is a separate feature).
- Binding a layer per palette slot (decided: layer selector is independent of the palette).
- Renaming and deleting palettes from the UI (create + switch + add/remove slots only; rename/delete
  by editing the map file for now).
- Keyboard/number-key or cycle-key quick-switch (click/tap only).
- Drag-and-drop reordering of palette slots.
- Fixing the Library's underlying DOM scroll-reset-on-reopen in general (the palette makes it
  irrelevant for the tiling loop; a persisted `scrollTop` is a separate nicety).
- Global (cross-map) palettes — palettes are per-map (travel with the map file via autocommit).

## Critique

Fresh-eyes review (independent sub-agent). **Verdict:** sound, well-researched plan that fits the
project's dev-tooling direction; no High findings. Three Medium mechanism imprecisions in Steps 1–2
were **resolved in-plan** (see decision #7 and the revised Steps 1–2); two Low items noted.

|#|Finding|Severity|Resolution|
|-|-------|--------|----------|
|1|"Bump `pendingDirty`/`docRevision`/`mapEpoch`" contradicts the favourites precedent (favourites route through `applyCommand`); undo treatment of active-palette switch unresolved.|Medium|**Fixed** — decision #7 + Step 2: structural edits go through `applyCommand` (undoable + dirty + `docRevision`, like favourites); active-palette switch is a direct `set` like `setActiveLayer`; never touch `mapEpoch`/`pendingDirty`.|
|2|"Absent field parses to `[]`/`null`" risks materialising empty arrays into `MapMeta`, breaking the byte-identical legacy round-trip.|Medium|**Fixed** — Step 1: omit the key when absent (match `favourites` ~`:389`); default with `?? []` at store read sites, never in `parseMeta`.|
|3|`ensureActivePalette()` on load creates "Palette 1" + dirties every legacy map; persisting `activeTilePaletteId` dirties on every switch → autocommit churn.|Medium|**Fixed** — Step 2: lazy first-palette creation (only on first "Add to palette"); active pointer is store view-state (not in `MapMeta`), reconciled like `activeLayerId`.|
|4|Multiple *named* palettes but no rename/delete UI is an awkward partial.|Low|**Accepted as-is** — user chose to keep multiple named palettes; rename/delete stay out of scope.|
|5|`PaletteStrip` duplicates `RecentStrip` swatch rendering.|Low|**Fixed** — Step 3: reuse `AssetSwatch`/`resolveRecentSwatch`/`libSwatchClass` instead of reimplementing.|
