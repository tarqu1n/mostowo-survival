# Editor: tiling palette + quick layer selector

> Status: planned — run /execute-plan to begin.

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

- [ ] **Step 1: Palette data model in the map file** `[inline]`
  - In `src/systems/mapFormat.ts`, add palette types and wire them into `MapMeta` (mirror how
    `favourites` is declared, defaulted, serialised, and parsed). Add:
    `TilePaletteSlot = { assetId: string; rotation?: number }` and
    `NamedTilePalette = { id: string; name: string; slots: TilePaletteSlot[] }`. Add to `MapMeta`:
    `tilePalettes?: NamedTilePalette[]` and `activeTilePaletteId?: string | null`.
  - Update the serialiser/parser (and any zod/manual validation) so absent fields **migrate
    cleanly**: a map with no `tilePalettes` parses to `[]` / `null` (do **not** synthesize a default
    palette here — the store handles ensuring one active palette exists, Step 2). Preserve unknown
    round-trip behaviour consistent with how `favourites` is handled.
  - Generate slot/palette ids with the same id scheme the format already uses for layers/zones
    (find the existing id helper; do not introduce a new random scheme).
  - Side effects: anything that reads/writes `MapMeta` or snapshots the map (thumbnailing, `putMap`,
    history serialisation if meta is included). Confirm palettes are **not** swept into undo/redo
    unless favourites are (match favourites' history treatment exactly).
  - Docs: none yet (covered in Step 7). Add a one-line comment on the new types.
  - Done when: `mapFormat` unit tests pass; a round-trip (parse→serialise) of a map with and without
    `tilePalettes` is lossless; typecheck clean.

- [ ] **Step 2: Store slice — palette state, actions, rehydration** `[inline]`
  - In `src/editor/store/editorStore.ts` add state read from the loaded map on `loadMap`/`newMap`
    (the `:1328-1358` rehydration region) and actions. Because `map` is mutated in place and meta
    persists with it, treat `map.meta.tilePalettes` as the source of truth and bump the existing
    dirty/revision counters (`pendingDirty`/`docRevision`/`mapEpoch` as appropriate) on every
    mutation so panels re-render and the map autocommits. Mirror how favourite/layer actions mark
    state dirty.
  - Actions to add:
    - `ensureActivePalette()` — internal: if no palettes exist, create one named `"Palette 1"` and
      set it active; if `activeTilePaletteId` dangles, reconcile to the first palette (mirror
      `reconcileActiveLayer`). Call on map load.
    - `addTilePalette(name?)` → creates a new empty named palette (`"Palette N"` default) and makes
      it active. Returns/sets active id.
    - `setActiveTilePalette(id)`.
    - `addTilesToActivePalette(entries: TilePaletteSlot[])` — bulk append (dedupe exact
      assetId+rotation duplicates); used by the Library "Add to palette" button.
    - `removeTilePaletteSlot(paletteId, index)`.
    - `selectPaletteSlot(slot)` — arm the brush from a slot: `setBrushAsset(slot.assetId)`, set
      `brushRotation` to `slot.rotation ?? 0`, and switch to the brush tool unless already on
      brush/rect (reuse the exact logic `pickTile` uses — factor a shared helper if clean, else
      replicate).
  - Also add transient (store-held, non-persisted) UI state for Library multi-select used in Step 4:
    `palettePickMode: boolean` and `palettePickSelection: string[]` (assetIds, or assetId#frame),
    with actions `togglePalettePickMode()`, `togglePalettePickTile(assetId)`, `clearPalettePick()`.
    Keep these in the store (not component state) so they survive compact `<Sheet>` unmount.
  - Side effects: `loadMap`/`newMap` rehydration; ensure `selectPaletteSlot` reuses the brush-arm
    path so tool-sync/library-filter side effects stay consistent. Confirm no interaction with
    `armObject`/`armNode`/`armTerrain` (palette is tiles-only).
  - Docs: none yet.
  - Done when: unit tests cover `addTilePalette`/`addTilesToActivePalette`/`selectPaletteSlot`/
    `removeTilePaletteSlot`/`ensureActivePalette` reconciliation; loading a map with saved palettes
    rehydrates them; adding a tile then reloading (via serialise round-trip) preserves it; typecheck
    + lint clean.

- [ ] **Step 3: Palette strip component** `[inline]`
  - New file `src/editor/panels/PaletteStrip.tsx` (mirror `RecentStrip` shape and `libSwatchClass`/
    `libLabelClass`/`headingClass` conventions). Renders:
    - A **palette switcher** — a compact `select.tsx` (or `dropdown-menu.tsx`) listing named
      palettes by name, bound to `activeTilePaletteId` → `setActiveTilePalette`; plus a "＋" button →
      `addTilePalette()`.
    - The **active palette's slots** as one-tap swatches. Each swatch renders the tile frame for its
      `assetId`(+rotation) using the smallest reusable Library swatch renderer (extract from
      `LibraryPanel.tsx` if it's currently inline — keep the extraction minimal and colocated).
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

- [ ] **Step 4: Library multi-select → Add to palette** `[inline]`
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
      mode — pick the less surprising: **exit** and toast "Added N tiles to <palette>"). Reuse
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

- [ ] **Step 5: Quick layer selector control** `[inline]`
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

- [ ] **Step 6: Wire palette strip + quick layer selector into both shells** `[inline]`
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

- [ ] **Step 7: Docs + shortcuts + status** `[delegate]`
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
