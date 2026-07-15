# Editor: Resize Map

> Status: deployed

## Summary

Add a **Resize map** action to the dev-only Map Builder so a map can be expanded or shrunk after
creation. The user enters per-edge tile amounts (Top / Right / Bottom / Left; negative = crop that
edge); the dialog live-previews the resulting W×H and blocks Apply if the resize would push any
object (node/decor/portal) outside the new bounds. Applying remaps every `width*height` grid with the
implied offset, shifts object coordinates, is a single undoable command, and — for a map placed in
`world.json` — compensates the placement origin so existing content stays fixed in global space.

## Context & decisions

**Direction (CLAUDE.md / docs):** the editor is dev-only tooling that authors the custom-JSON maps
the game loads at runtime; real-area maps are hand-traced over an OSM reference underlay at 3m/tile
(see [map authoring workflow] memory). Resize must therefore keep a placed map's traced content
aligned in the world and keep the reference underlay aligned — a resize that silently slid content
would break that workflow.

**Confirmed with user:**
- **UX = per-edge amounts.** Dialog with four numeric inputs (Top/Right/Bottom/Left), each an
  add(+)/remove(−) tile count. Live-preview the resulting `W×H`. Reachable from the Toolbar next to
  New/Open/Save; disabled when no map is open.
- **Policy = block on object loss.** If any object footprint would fall outside the new bounds after
  the shift, disable Apply and show which/how-many. (Painted-cell loss on crop does *not* block — it
  gets a non-blocking confirm, since undo restores it.)

**Advisor-approved architecture (verified against the code):**
- Resize is a **single undoable command via `applyCommand`**, not a New/Open-style epoch reset. `do`/
  `undo` **swap array references** (+ `meta` dims + object coords), never mutate in place —
  `EditorScene` re-reads `map.layers[i].cells` every bake, so reference swaps are safe. Do **not** set
  `pendingDirty` for resize.
- The scene must **fully rebuild** on a dimension change (chunk RTs are sized from map dims).
  `onDocEdited` already falls back to `syncDocument()` when `chunkRTs.length !== map.layers.length`;
  extend that with a **baked-dims mismatch**. This fires for resize *and* its undo/redo (both bump
  `docRevision`). Known v1 side effect: the camera refits (recentres) on resize and on each undo/redo.
- **World-origin coupling:** when the map is placed in `world.json` **and** the resize adds/removes on
  the top or left edge (`dLeft || dTop`), fold a placement-origin shift of `(-dLeft, -dTop)` into the
  **same command**, tagged a new **dual domain `'map+world'`**; `undo()`/`redo()` grow a third branch
  that bumps **both** side-effect sets (`dirty`+`docRevision` **and** `worldDirty`+`worldRevision`).
  Right/bottom-only edits stay pure map commands (`domain` unset). Toast on such a resize that the
  world layout now has unsaved changes (Save Map ≠ Save World).
- **Underlay alignment:** `UnderlaySettings.offsetX/offsetY` are in **tiles** relative to local (0,0),
  so a top/left resize desyncs the traced reference. Shift persisted settings by `(+dLeft, +dTop)`
  **inside** the command's `do` (and back in `undo`) via `underlayStore.putSettings`, then bump
  `underlayRevision`; write the persisted blob even if the underlay isn't currently hydrated.
- **Terrain:** `terrain[].cells` masks remap like every other grid. Stale autotile *bakes* at a
  cropped edge self-heal via the existing pre-save `rebakeTerrainsForSave()` — document, don't diff.

**Patterns to mirror:**
- Grid model + `parseMap` invariants: `src/systems/mapFormat.ts` (`cellIndex`, `getCell`, `isInside`,
  `objectFootprintCells`, `createEmptyMap`, `validateVoidConsistency`).
- Undo commands + reconcilers + domain tagging: `src/editor/store/editorStore.ts` (`buildShapeCommand`,
  `applyCommand`, `applyWorldCommand`, `undo`/`redo`, `movePlacement`) and `src/editor/store/history.ts`.
- Dialog UI: `src/editor/NewMapDialog.tsx` (shadcn `Dialog`, `MAX_DIM=512`, `ID_PATTERN`, validation
  gating the primary button). Toolbar wiring: `src/editor/Toolbar.tsx` (`showNew` state + conditional
  render + `handleCreate`).
- Scene lifecycle: `src/editor/EditorScene.ts` (`syncDocument`, `onDocEdited`, `bakeAllLayers`,
  `fitCamera`, the `docRevision`/`mapEpoch` subscriptions ~L226-233).
- Native `window.confirm(...)` is an accepted precedent (`src/editor/panels/ReferencePanel.tsx`).

**Reconcilers are no-ops for resize** (object ids, layer ids, zone defs all survive), so
`reconcileSelection`/`reconcileActiveLayer`/`reconcileActiveZone` need no changes.

## Steps

- [x] **Step 1: Pure resize helpers + shared `MAX_MAP_DIM` (+ unit tests)** `[inline]`
  - Outcome: added `MAX_MAP_DIM=512`, `ResizeEdges`, `ResizePlan`, `planResize`, `applyResize` (+ private
    `translateObject`) to `src/systems/mapFormat.ts` near `createEmptyMap`; `NewMapDialog.tsx` now imports
    `MAX_MAP_DIM` (local `MAX_DIM` removed). `objectFootprintCells` left **unexported** — reused in-file by
    translating its returned cells by `(dLeft,dTop)` (equivalent to translating the object), so no other
    caller changed and `objectOps.ts`'s deliberate duplicate was untouched. New suite
    `src/systems/__tests__/mapFormat.resize.test.ts` (28 tests) covers expand/crop each edge, top+left shift
    of cell+object, offending-object block, throw-on-invalid, `discardsNonEmpty` layer/zone/walkability
    isolation + void-never-counts, absent-shape-stays-absent, present-shape remap, palette identity,
    non-mutation, round-trip parse. `npm test` 579/579 pass, `tsc --noEmit` + eslint clean.
  - In `src/systems/mapFormat.ts` add, near `createEmptyMap`:
    - `export const MAX_MAP_DIM = 512;`
    - `export interface ResizeEdges { top: number; right: number; bottom: number; left: number; }`
      (tiles; negative crops that edge).
    - `export interface ResizePlan { dLeft: number; dTop: number; newWidth: number; newHeight: number;
      dimsValid: boolean; offendingObjectIds: string[]; discardsNonEmpty: boolean; }`
    - `export function planResize(map: MapFile, edges: ResizeEdges): ResizePlan` — pure analysis for the
      dialog (no remap): `dLeft=left`, `dTop=top`, `newWidth=width+left+right`,
      `newHeight=height+top+bottom`; `dimsValid` = both in `1..MAX_MAP_DIM` (integers). For each object,
      translate its footprint (`node` by `(dLeft,dTop)` tiles; `portal.rect` by `(dLeft,dTop)`; `decor`
      anchor by `(dLeft*tileSize, dTop*tileSize)` px, then floor to tile / offset `collision`) and add
      its id to `offendingObjectIds` if any footprint cell leaves `[0,newWidth)×[0,newHeight)`. Set
      `discardsNonEmpty` when cropping removes any cell that is non-empty in a layer, non-zero in
      `zones`, or blocked (`1`) in `walkability` (void removal doesn't count). Reuse the
      `objectFootprintCells` logic (export it, or a small shared helper) rather than duplicating.
    - `export function applyResize(map: MapFile, edges: ResizeEdges): MapFile` — performs the remap and
      returns a NEW `MapFile` (fresh arrays; do not mutate the input). Throws if `!dimsValid` or
      `offendingObjectIds.length > 0` (guard — the dialog prevents this, the store double-checks). Remap
      every grid (`shape?.cells`, each `layers[].cells`, each `terrain[].cells`, `walkability.cells`,
      `zones.cells`) by copying old `(c,r)` → new `(c+dLeft, r+dTop)` when in new bounds; fill
      not-copied (newly added) cells with the grid's default (`shape`→`1`, layers/`zones`/`walkability`
      /terrain→`0`). **Keep `shape` absent if it was absent** (all-inside stays all-inside after a
      translate+crop). Copy `palette` unchanged. Translate object coords as above. Set new
      `meta.width/height`.
  - Import `MAX_MAP_DIM` into `NewMapDialog.tsx`, replacing its local `MAX_DIM` (single source).
  - **Tests** (`src/systems/__tests__/mapFormat.resize.test.ts`, vitest): expand each edge; crop each
    edge; a top+left expand shifts an interior cell and an object to the expected new index/coords;
    `planResize` flags an object cropped off the left edge (Apply-block); `applyResize` throws when
    given an offending spec; palette identity; `discardsNonEmpty` true only when a non-empty cell is
    cropped; absent-shape stays absent; present-shape remaps with new cells = inside; `parseMap` accepts
    the round-tripped `serializeMap(applyResize(...))` (void-consistency preserved); dims outside
    `1..512` → `dimsValid=false`.
  - Side effects: `objectFootprintCells` may need exporting — check no other caller breaks.
  - Docs: none here (see Step 5).
  - Done when: `npm test` passes the new suite; `applyResize` output re-parses cleanly.

- [x] **Step 2: Undoable `resizeMap` store action (map + optional world + underlay)** `[inline]`
  - Outcome: added `resizeMap(edges): boolean` to `EditorState` + store body in `editorStore.ts`. Bails on
    no map/mapId / `!dimsValid` / offending objects. ONE command captures old/new state snapshots and swaps
    arrays+dims+objects via an `applyState()` closure (mirrors `buildShapeCommand`). Command closures stay
    `set`-free: they only `putSettings` the shifted PERSISTED underlay offset (do +delta / undo restore
    captured base) and shift `placement.origin` by `(-dLeft,-dTop)` in place. **Advisor design adopted** over
    the plan's literal underlay text: new guarded `syncUnderlayFromSettings()` store method re-derives the
    LIVE `underlay` from persisted settings + bumps `underlayRevision` only on divergence — called at end of
    `applyCommand` and after `history.undo()/redo()`, so no `history.ts` change and no per-domain underlay
    special-casing. Routed via inlined `history.apply({...cmd, domain: coupled ? 'map+world' : undefined})` +
    hand-rolled `set` (parity with `applyWorldCommand`); toasts on coupled resize. **Folded in the store-side
    of Step 3:** `'map+world'` branch added to `undo()`/`redo()` (bumps BOTH map+world side-effect sets +
    `pendingDirty:null`). Module doc updated (dimension edit rides `docRevision` → scene baked-dims fallback).
    New `editorStoreResize.test.ts` (6 tests). `npm test` 588/588, `tsc` clean, lint clean.
  - Remaining for Step 3: `EditorScene.ts` baked-dims rebuild + camera refit, and `history.ts` doc-comment
    polish naming all three domain tags (functional undo/redo `'map+world'` branch is already done here).
  - In `src/editor/store/editorStore.ts` add `resizeMap(edges: ResizeEdges): boolean` to `EditorState`
    and implement it. Bail (return `false`) if no `map`/`mapId`, `!plan.dimsValid`, or
    `offendingObjectIds.length > 0`.
  - Build ONE `Command` whose `do` swaps in `applyResize`'s fresh arrays + `meta` dims + translated
    objects onto the live `map` (assign `map.meta.width/height`, `map.shape`, `map.layers[i].cells`,
    `map.terrain[i].cells`, `map.walkability.cells`, `map.zones.cells`, `map.objects`), capturing the
    prior references so `undo` restores them by reference (mirror `buildShapeCommand`'s captured-state
    style). Do **not** set `pendingDirty`.
  - **Underlay:** inside `do`, if `getSettings(mapId)` exists, `putSettings(mapId, {...s, offsetX:
    s.offsetX+dLeft, offsetY: s.offsetY+dTop})`; in `undo`, subtract. After apply, if `underlay` is live
    bump `underlayRevision` (the persisted blob is authoritative on next hydrate regardless).
  - **World coupling:** if the map is placed (`world.placements` has `mapId`) **and** `(dLeft || dTop)`,
    include the placement-origin shift `(-dLeft, -dTop)` in the same command's `do`/`undo` (mutate the
    placement in `world.placements` in place, like `movePlacement`) and route via
    `applyCommand`-with-`domain:'map+world'` (see Step 3). Then `toast(...)` noting world layout has
    unsaved changes. Otherwise route as a plain map command (no domain).
  - Because `applyCommand` hard-codes map side effects, either (a) add a small internal apply that
    accepts an optional domain, or (b) inline `history.apply({...cmd, domain})` + the correct `set(...)`.
    Match whichever keeps parity with `applyWorldCommand`.
  - Side effects: `newMap`/`loadMap`/`closeMap` already reset history — resize doesn't touch them.
    Confirm `reconcile*` helpers stay no-ops (they do). Ensure a right/bottom-only resize does NOT dirty
    `world`.
  - Docs: update the `editorStore.ts` module doc where it explains `mapEpoch` vs `docRevision` to note
    that a dimension-changing edit rides `docRevision` and relies on the scene's baked-dims fallback
    (Step 3).
  - Done when: calling `resizeMap` from a store test expands/crops the map, is undoable in one step, and
    a placed-map top/left resize shifts the placement origin and undoes cleanly. Add
    `src/editor/store/__tests__/editorStoreResize.test.ts` covering: map-only resize + undo; placed-map
    top/left resize shifts origin + sets `worldDirty` + undo restores both; underlay offset shift +
    undo; block returns `false` with offending objects.

- [x] **Step 3: Dual-domain undo/redo + scene baked-dims rebuild** `[inline]`
  - Outcome: dual-domain undo/redo (`'map+world'` branch) was already landed in Step 2. This step added the
    scene side: `EditorScene` gets `bakedWidth`/`bakedHeight` fields, set in `bakeAllLayers`; `onDocEdited`'s
    wholesale-rebuild guard now also fires on a baked-dims mismatch → `syncDocument()` (full RT rebuild +
    camera refit + ghost/underlay refresh), for a resize and its undo/redo (all bump `docRevision`). Verified
    the only `meta.width/height` writes are the resize command's `applyState` (grep), so no paint/layer edit
    trips the dims branch. `history.ts` module doc updated to name all three domain tags. `tsc` clean, full
    suite 588/588. Running-editor visual verification (grid rebuilds at new size, camera refits, ghost strips
    stay put on a left-grow) deferred to Step 4, since nothing can trigger a resize until the dialog exists.
  - `src/editor/store/history.ts` + `editorStore.ts`: extend the `domain` model to three tags —
    `undefined` (map), `'world'`, `'map+world'`. Update the "exactly one domain" doc comments in both
    files to name all three. In `undo()` and `redo()` add a branch for `getLastDomain() === 'map+world'`
    that bumps **both** `{ dirty, docRevision, reconcile* }` **and** `{ worldDirty, worldRevision }`
    (and `canUndo`/`canRedo`), and sets `pendingDirty: null` like the map branch.
  - `src/editor/EditorScene.ts`: record baked dims when the scene builds. Add private
    `bakedWidth`/`bakedHeight` (or reuse an existing built-map ref), set them in `bakeAllLayers`/
    `buildScene`. In `onDocEdited`, extend the existing wholesale-rebuild guard:
    `if (this.chunkRTs.length !== map.layers.length || this.bakedWidth !== map.meta.width ||
    this.bakedHeight !== map.meta.height) { this.syncDocument(); return; }`. Add a brief comment that
    this is what makes resize (and its undo/redo) trigger a full RT rebuild + camera refit.
  - Side effects: verify no other `docRevision` path (paint/layer edits) accidentally trips the dims
    branch (dims only change via resize). Confirm `syncDocument()` refreshes ghosts + underlay (it does).
  - Docs: none beyond the code comments above.
  - Done when: applying a resize in the running editor (`npm run editor`) rebuilds the grid at the new
    size and refits the camera; undo/redo restore size + view; a placed-map top/left resize keeps the
    neighbour ghost strips positioned correctly (grow left edge → ghosts don't move).

- [x] **Step 4: `ResizeMapDialog` + Toolbar wiring** `[inline]`
  - Outcome: new `src/editor/ResizeMapDialog.tsx` mirrors `NewMapDialog` (shadcn Dialog/Input/Label/Button,
    conditional-mount `open`, `onOpenChange`→`onCancel`). Four number inputs (2-col grid) Top/Right/Bottom/
    Left default 0; live `planResize` preview `W×H → newW×newH` (red when `!dimsValid`), a red "N object(s)
    would be cut off (ids)" line, and a `1..MAX_MAP_DIM` validation line. Apply enabled only when
    `dimsValid && !offending && anyEdge`; on Apply, `window.confirm` guards a `discardsNonEmpty` crop, then
    `resizeMap(edges)` → `toast.success` + close. `Toolbar.tsx`: `showResize` state + **Resize** button in the
    New/Open/Save group (`disabled={!map}`) + conditional `<ResizeMapDialog>`. **No keyboard shortcut added**
    (toolbar button only, per plan) → no `shortcuts.ts` change. `tsc`+eslint clean, `npm test` 588/588.
  - **Live verification (also covers Step 3):** Playwright smoke drove the real editor — New 20×15 → Resize
    (L+5,T+5,R+3) preview showed `20×15 → 28×20`, Apply applied it (grid rebuilt at new size, camera refit,
    "Resized to 28×20" toast), Ctrl+Z restored 20×15 (grid rebuilt + camera refit, Undo→disabled/Redo→enabled),
    zero console errors. Screenshots captured in scratchpad.
  - New `src/editor/ResizeMapDialog.tsx` mirroring `NewMapDialog.tsx` (shadcn `Dialog`/`Input`/`Label`/
    `Button`, `fieldClass`, conditional-mount `open`/`onOpenChange`→`onCancel`). Four number inputs
    Top/Right/Bottom/Left (default 0). Read the current map from the store; call `planResize(map, edges)`
    on every change to render: current `W×H → newW×newH` preview; a red "N objects would be cut off
    (id, id, …)" line when `offendingObjectIds.length`; a validation line when `!dimsValid`
    (`1..MAX_MAP_DIM`). Disable **Apply** unless `dimsValid && offendingObjectIds.length === 0` and at
    least one edge ≠ 0. On Apply, if `discardsNonEmpty`, `window.confirm("This crop discards painted
    tiles/zones/walkability outside the new bounds. Continue?")` before calling
    `useEditorStore.getState().resizeMap(edges)`; then close + `toast.success`.
  - `src/editor/Toolbar.tsx`: add a `showResize` state + a **Resize** `Button` in the New/Open/Save
    group, `disabled={!map}`; conditionally render `<ResizeMapDialog .../>` like `NewMapDialog`. Add a
    `handleResize`-style close/toast if needed (or inline).
  - Side effects: none beyond the toolbar group layout.
  - Docs: see Step 5.
  - Done when: the Resize button opens the dialog; preview + block/confirm behave; Apply resizes the
    open map; Cancel/Escape/overlay-click close without change.

- [x] **Step 5: Docs (+ shortcut sync if added)** `[delegate haiku]`
  - Outcome: `docs/EDITOR.md` — added a **Toolbar actions → Resize** bullet under "Tools & shortcuts"
    (per-edge deltas +add/−crop, live W×H, 1..512 bound, object-cut-off block, discard-confirm, single undo,
    placed-map top/left world-origin auto-shift → Save World separately, underlay re-align, toolbar-only no
    shortcut), reflowed to the doc's terse wrapped style; and a one-liner under "File formats → Map" that
    cropped-edge terrain autotile bakes self-heal on next Save via `rebakeTerrainsForSave()`. No keyboard
    shortcut was added in Step 4, so `src/editor/shortcuts.ts` + the in-app Shortcuts panel are untouched (no
    drift). `markdownlint-cli2` 0 errors.
  - `docs/EDITOR.md`: under **Tools & shortcuts** / **Layout** note the toolbar **Resize** action
    (per-edge tile deltas, negative = crop; blocked if it would cut objects; a placed map's world
    origin auto-shifts on top/left edits so content stays aligned; the reference underlay re-aligns
    automatically). Under **File formats** note that terrain autotile bakes at a cropped edge self-heal
    on the next Save via `rebakeTerrainsForSave()`. Keep edits terse/high-signal.
  - If Step 4 added a keyboard shortcut (it does NOT by default — the toolbar button is the entry
    point), update `src/editor/shortcuts.ts` + confirm the in-app Shortcuts panel; otherwise no change
    (note this explicitly so the reviewer isn't left wondering).
  - Done when: `docs/EDITOR.md` describes Resize accurately; no shortcut drift.

## Out of scope

- No keyboard shortcut for Resize (toolbar button only).
- No W×H+anchor UI (per-edge amounts only — user-decided).
- No auto-drop of objects on crop (blocked instead — user-decided); no per-object "keep/discard" picker.
- No terrain bake-diff inside the command (self-heals on Save).
- No change to the runtime map loader / `manifest.json` beyond what a normal Save already regenerates.
- No resize from the World tab (map-tab action; world origin is only compensated as a side effect).
