# Editor: Rotate Tileset Piece While Painting

> Status: in review

## Summary

Add the ability to **rotate a tileset piece in 90° steps while painting it** with the brush in the
dev-only Map Builder. The armed brush carries a pending rotation (0/90/180/270) that the user cycles
with the `R` key or two on-screen buttons (phone-friendly). A live, always-on **ghost preview** of
the armed tile — rotated to the pending angle — follows the cursor so the author sees the result
before clicking. A tile painted at a non-zero angle becomes a distinct palette entry (rotation is
encoded on `TilePaletteEntry`, keeping layer cells as plain palette indices and the palette
append-only). Both the editor and the game runtime render rotated tiles by switching the per-cell
blit from `batchDrawFrame` to `RenderTexture.stamp(..., { angle, skipBatch:true })`.

## Context & decisions

**Direction (CLAUDE.md / docs):** the editor is dev-only tooling that authors the custom-JSON maps
the game loads at runtime; real-area maps are hand-traced over an OSM reference underlay. Rotation is
a pure authoring-ergonomics improvement (lay a fence/path/roof tile in the orientation it's needed)
and must not change how legacy maps parse or render.

**Confirmed with user:**
- **Target = a tileset piece (tile)**, NOT decor and NOT resource nodes. (Decor already has rotation
  via the Inspector; nodes stay unrotated.)
- **90° steps only** (0→90→180→270→0). **No flip** this plan (flipX/flipY deferred).
- **Control = `R` key AND on-screen buttons** (repo is used on phones, so a key alone is
  insufficient).
- **Pending-tile only.** Rotating affects tiles painted *from now on*; already-painted cells are
  untouched unless repainted. No "rotate the cell under the cursor" behaviour.
- **Ghost preview shows only when a tileset piece is armed** (brush tool with a `brushAsset`).
  Eraser/other tools keep today's plain cell-outline hover.
- **Brush gesture only** for now. `fill` and `rect` stay axis-aligned (angle 0) this plan — see Out
  of scope.

**Research findings that shape the plan (file:line):**
- `TilePaletteEntry` = `{ pack, source }` only — [mapFormat.ts:44](../src/systems/mapFormat.ts). No
  orientation field today. `palette[0]` is reserved `null` (empty). Schema `meta.schemaVersion` is
  pinned to `1`; an **optional, omitted-when-absent** field needs **no** version bump (legacy maps
  parse unchanged) — mirror the `meta.favourites` / `decor.region` optional-field round-trip
  precedent.
- `serializeMap` = `JSON.stringify` relying on **field construction order** for stable diffs
  ([mapFormat.ts:715](../src/systems/mapFormat.ts)) — a new `rotation` field must be constructed
  **LAST** in both `parsePalette` and `findOrAppendPaletteIndex`, and omitted entirely when 0.
- **Palette dedup assumes `pack+source` uniqueness** — `findOrAppendPaletteIndex` +
  `tileSourceEquals` ([paintOps.ts:161-183](../src/editor/paintOps.ts)). Rotation must join the
  equality check so a rotated brush appends a *distinct* slot. This helper has **four callers** that
  must pass a default angle of `0`: brush `resolveBrushValue`
  ([editorStore.ts:681](../src/editor/store/editorStore.ts)), terrain `buildTerrainCommand`
  ([editorStore.ts:822](../src/editor/store/editorStore.ts)), and save-rebake
  `rebakeTerrainsForSave` ([editorStore.ts:2373](../src/editor/store/editorStore.ts)). The append is
  deliberately **not** in undo history (append-only contract) — keep that.
- **`batchDrawFrame` has NO angle param.** `RenderTexture.stamp(key, frame, x, y, { angle, originX,
  originY, skipBatch:true })` **does** support rotation inside an existing `beginDraw()/endDraw()`
  batch. A 90° rotation is pixel-exact (NEAREST filter fine). **No pre-rotated textures needed.**
  Four blit sites, all identical `batchDrawFrame(key, frame, col*TILE_SIZE, r*TILE_SIZE)`:
  editor `bakeChunk` ([EditorScene.ts:560](../src/editor/EditorScene.ts)), ghost strip
  ([EditorScene.ts:1148](../src/editor/EditorScene.ts)), thumbnail
  ([EditorScene.ts:1203](../src/editor/EditorScene.ts)), runtime `drawMapLayers`
  ([groundRenderer.ts:65](../src/scenes/world/groundRenderer.ts) — deliberately duplicated, NOT
  imported; keep it duplicated). `stamp` rotates about the origin, so draw at the tile **centre**
  (`col*TILE_SIZE + TILE_SIZE/2`) with `originX:0.5, originY:0.5`.
- **Hover is outline-only** — `updateHover` strokes a `Graphics` rect
  ([EditorScene.ts:888](../src/editor/EditorScene.ts)); there is **no** sprite-under-cursor today.
  The ghost preview is net-new: a `Phaser.GameObjects.Image` at a hover-level depth. Depth constants
  at [EditorScene.ts:56](../src/editor/EditorScene.ts) (`DEPTH_HOVER 9500`).
- **UX pattern to mirror** = the decor rotate buttons: two `<Button>`s calling
  `rotateObjects(ids, ±90)` ([InspectorPanel.tsx:88-105](../src/editor/panels/InspectorPanel.tsx)).
  Store state fields `activeTool`/`brushAsset`/`snapToTileCenter`/`paintMode` + setters live around
  [editorStore.ts:246](../src/editor/store/editorStore.ts) / :1184; a `brushRotation` field +
  `setBrushRotation`/`rotateBrush` action slots in beside them. `resolveBrushValue(map, brushAsset)`
  ([editorStore.ts:681](../src/editor/store/editorStore.ts)) takes no angle — signature must grow.
- **Keys** are wired in `EditorApp.tsx` (window keydown) + `EditorScene.ts` (Phaser input);
  `shortcuts.ts` is **doc-only** and must be kept in sync (see [editor shortcuts panel sync] memory).
  The `S` skin-cycle entry is the single-letter precedent.
- **Terrain autotile is orthogonal** — it picks pre-oriented frames from a sheet and bakes at angle
  0. It only *couples* via the shared `findOrAppendPaletteIndex` signature; passing `0` keeps it
  byte-identical.
- **Boot canary** `src/data/maps/__tests__/world.test.ts` runs `parseMap` on every committed map —
  the round-trip guard for the schema change.

**Central design decision (adopted): rotation on the palette entry.** Layer cells store only a
palette index — there is no per-cell orientation channel — so the angle must live on the entry. A
rotated tile = a distinct palette slot (`pack + source + rotation`). Grows the palette by up to ×4 in
the worst case; acceptable and consistent with the append-only model.

## Steps

- [x] **Step 1: Add optional `rotation` to `TilePaletteEntry` + parse/serialize round-trip** `[inline]`
  - Outcome: [mapFormat.ts](../src/systems/mapFormat.ts) only. Added `rotation?: 0|90|180|270` to
    `TilePaletteEntry` (constructed LAST, omitted when 0); added `parseRotation` guard (rejects
    non-90°-step values, e.g. 45); `parsePalette` reads + validates it. `serializeMap`,
    `tileSourceKey`/`collectTextureSources` unchanged (rotation-agnostic; texture dedup keys on
    `source` only). No `schemaVersion` bump. Verified: `rotation:90` round-trips; unrotated entry
    emits no `rotation` key (exactly one `"rotation"` in serialized text); `parseMap` rejects 45;
    `tsc --noEmit` clean; boot canary `world.test.ts` green (5 tests).
  - In [src/systems/mapFormat.ts](../src/systems/mapFormat.ts): add `rotation?: 0 | 90 | 180 | 270`
    to `TilePaletteEntry` (interface `:44`), documented as "clockwise degrees; absent = 0". In
    `parsePalette` (`:358`), parse it: read `obj.rotation` if present, validate it's one of
    `0|90|180|270` (fail otherwise), and **construct the returned entry with `rotation` LAST and only
    when non-zero** (omit the key when 0/absent) so legacy maps round-trip byte-identical. Add a small
    `parseRotation`-style guard next to the other `parse*` helpers.
  - Side effects: `serializeMap` (`:715`) needs no change if the field is omitted-when-0 and
    constructed last. Double-check `collectTextureSources`/`tileSourceKey` (`:938`) — these key on
    `source` only for **texture load** dedup (rotation shares the same texture), so they must stay
    rotation-agnostic. Do NOT bump `schemaVersion`.
  - Docs: none yet (schema doc points at the code per docs/EDITOR.md).
  - Done when: `TilePaletteEntry` carries optional `rotation`; a palette entry with `rotation:90`
    round-trips through `serializeMap → parseMap`; an entry with no rotation serializes with **no**
    `rotation` key; an invalid rotation (e.g. 45) is rejected by `parseMap`.

- [x] **Step 2: Thread rotation through `findOrAppendPaletteIndex` + its four callers** `[inline]`
  - Outcome: [paintOps.ts](../src/editor/paintOps.ts) — `findOrAppendPaletteIndex` grew a
    `rotation: 0|90|180|270 = 0` param; equality now also requires `(entry.rotation ?? 0) === rotation`;
    append constructs `rotation` LAST, omitted when 0. [editorStore.ts](../src/editor/store/editorStore.ts) —
    both terrain callers (`buildTerrainCommand` ~:822, `rebakeTerrainsForSave` ~:2378) pass explicit
    `0`. `tileSourceEquals` untouched. Brush caller `resolveBrushValue` deferred to Step 3. Verified:
    same `(pack,source,rotation)`→same index; omitted==explicit-0; rotation 90→distinct slot with
    `rotation:90`, angle-0 entry omits key; `tsc --noEmit` clean.
  - In [src/editor/paintOps.ts](../src/editor/paintOps.ts): change `findOrAppendPaletteIndex(map,
    pack, source)` → `(map, pack, source, rotation = 0)`. Extend the equality check so a slot matches
    only when `entry.pack === pack && tileSourceEquals(entry.source, source) && (entry.rotation ??
    0) === rotation`. Append with `rotation` constructed LAST and only when non-zero (mirror Step 1).
    Keep the "not in undo history" append behaviour and the module doc.
  - Update the three other callers to pass `0` explicitly (default is fine, but be explicit for
    grep-ability): terrain `buildTerrainCommand` ([editorStore.ts:822](../src/editor/store/editorStore.ts))
    and `rebakeTerrainsForSave` ([editorStore.ts:2373](../src/editor/store/editorStore.ts)). The brush
    caller `resolveBrushValue` is updated in Step 3.
  - Side effects: `tileSourceEquals` is unchanged (rotation compared in the caller, not inside it).
    Terrain stays angle-0 → byte-identical.
  - Docs: none.
  - Done when: `findOrAppendPaletteIndex` returns the **same** index for same `(pack, source,
    rotation)`, a **distinct** index for the same source at a different rotation, and terrain/rebake
    callers compile passing `0`.

- [x] **Step 3: Add `brushRotation` store state + `resolveBrushValue` angle + rotate actions** `[inline]`
  - Outcome: [editorStore.ts](../src/editor/store/editorStore.ts) only. Added `brushRotation: 0|90|180|270`
    state (init `0`, beside `brushAsset`), `setBrushRotation` + `rotateBrush(±90)` actions (wraps via
    `(((r+delta)%360)+360)%360`). `resolveBrushValue` grew a `rotation = 0` param passed to
    `findOrAppendPaletteIndex`. `paintLine` passes `get().brushRotation`; `fillFrom`/`paintRectArea`
    pass explicit `0`. `brushRotation` is STICKY — `setBrushAsset` does NOT reset it (commented).
    Verified: paintLine at rotation 90 appends one entry with `rotation:90`; `rotateBrush` cycles
    0→90→180→270→0 and −90 wraps to 270; fill/rect entries have no `rotation` key; `tsc` clean.
  - In [src/editor/store/editorStore.ts](../src/editor/store/editorStore.ts): add state
    `brushRotation: 0 | 90 | 180 | 270` (init `0`, beside `brushAsset` `:247`/`:1072`). Add actions
    `setBrushRotation(deg)` and `rotateBrush(delta: 90 | -90)` (the latter cycles mod 360 into the
    0/90/180/270 set), mirroring the `setPaintMode`/`setSnapToTileCenter` setter shape (`:1197`).
  - Change `resolveBrushValue(map, brushAsset)` (`:681`) → `resolveBrushValue(map, brushAsset,
    rotation)` and pass `rotation` into `findOrAppendPaletteIndex`. Update its brush callers so the
    **single-cell brush** path (`paintLine` `:1960`) passes `get().brushRotation`, while **`fillFrom`
    (`:1995`) and `paintRectArea` (`:2021`) pass `0`** (brush-only scope this plan — see Out of scope).
  - Decide: `brushRotation` is **sticky** across arming a new `brushAsset` (do not reset on
    `setBrushAsset`) — lets the author lay many rotated tiles of different assets without re-rotating.
  - Side effects: `resolveBrushValue` is only called from these paint actions; grep to confirm no
    other caller. `rotateObjects` (decor, `:2863`) is unrelated — do not touch it.
  - Docs: none (store is internal).
  - Done when: setting `brushRotation` then painting one cell appends/uses a palette entry whose
    `rotation` matches; `fill`/`rect` still paint angle-0 entries; `rotateBrush` cycles correctly and
    wraps 270→0.

- [x] **Step 4: Rotate tiles in all four bake sites (`batchDrawFrame` → `stamp`)** `[inline]`
  - Outcome: [EditorScene.ts](../src/editor/EditorScene.ts) (`bakeChunk`, ghost-strip bake, thumbnail
    `full` bake) + [groundRenderer.ts](../src/scenes/world/groundRenderer.ts) (`drawMapLayers`, kept
    duplicated). Each `batchDrawFrame(key, frame, x, y)` → `rt.stamp(key, frame, x + TILE_SIZE/2, y +
    TILE_SIZE/2, { angle: entry.rotation ?? 0, originX: 0.5, originY: 0.5, skipBatch: true })` inside
    the existing `beginDraw()/endDraw()`; `textures.exists` guard + NEAREST filter unchanged. Un-rotated
    is pixel-identical: `TILE_SIZE=16`, all committed palette sources are `sheetFrame` (16px frames),
    so centre-origin returns the top-left to the same pixel (verified — no odd-sized `image` tiles in
    committed maps). `tsc` clean; full suite green (639 tests). NOTE: visual verification of the
    *rotated* case deferred to the end-to-end check after Step 6 (no UI to arm rotation yet).
  - Replace the per-cell blit in each of the four sites so a rotated palette entry draws rotated.
    Pattern: read `const angle = entry.rotation ?? 0;` then
    `rt.stamp(key, frame, col*TILE_SIZE + TILE_SIZE/2, r*TILE_SIZE + TILE_SIZE/2, { angle, originX: 0.5, originY: 0.5, skipBatch: true })`
    inside the existing `beginDraw()/endDraw()`. When `angle === 0` you MAY keep `batchDrawFrame` for
    a hot-path fast path, but prefer one consistent `stamp` call to reduce divergence — measure only
    if bake perf regresses.
    - Editor `bakeChunk` [EditorScene.ts:560](../src/editor/EditorScene.ts)
    - Ghost strip bake [EditorScene.ts:1148](../src/editor/EditorScene.ts) (row/col vars are
      `dx/dy`-based there — keep the same centre offset)
    - Thumbnail bake [EditorScene.ts:1203](../src/editor/EditorScene.ts)
    - Runtime `drawMapLayers` [groundRenderer.ts:65](../src/scenes/world/groundRenderer.ts) — keep it
      **duplicated** (do not import the editor's; the guardrail in that file's doc `:16-33` is
      intentional).
  - Side effects: confirm `stamp`'s coordinate origin — since we pass `originX/Y:0.5` and draw at the
    tile centre, un-rotated tiles land in exactly the same pixels as `batchDrawFrame` at the
    top-left. Verify NEAREST filter is still applied after each RT (it is, per research). Watch the
    `textures.exists(key)` guard — keep it before `stamp`.
  - Docs: none.
  - Done when: a map with a `rotation:90` palette entry renders that tile rotated in the editor,
    ghost strips, thumbnail, and the running game; un-rotated maps render pixel-identical to before
    (spot-check the boot canary map visually via `npm run dev`).

- [x] **Step 5: Ghost preview of the armed rotated tile under the cursor** `[inline]`
  - Outcome: [EditorScene.ts](../src/editor/EditorScene.ts) only. Added `brushGhost` Image (created in
    `create()` after `hoverGfx`, same `DEPTH_HOVER`, non-interactive, draws atop the outline), plus
    `hoverTile` + `ghostTexturesRequested` fields and `BRUSH_GHOST_ALPHA=0.6`. New `refreshBrushGhost()`
    resolves the armed asset via `parseAssetId → TileSource → resolveTile`, centres the image on the
    hovered tile, `setOrigin(0.5)`/`setAngle(brushRotation)`/alpha 0.6, NEAREST filter; shows only for
    `brush` + armed asset + cursor inside, hidden otherwise. If the texture isn't loaded it's
    load-requested ONCE (COMPLETE re-runs the method; guard prevents a 404 loop). `updateHover` records
    `hoverTile` and calls it; subscriptions on `brushRotation`/`brushAsset` + the `activeTool` sub
    refresh it live; hidden in `clearRender` (:328) and `redrawOverlays` no-map path (:748). `tsc`
    clean; eslint 0 errors. NOTE: live visual check (hover preview + R-rotate) folded into the
    end-to-end verification after Step 6.
  - In [src/editor/EditorScene.ts](../src/editor/EditorScene.ts): add a `Phaser.GameObjects.Image`
    (create in `create()` beside `hoverGfx` `:206`, e.g. `brushGhost`, `setDepth(DEPTH_HOVER)`,
    `setVisible(false)`). In `updateHover` (`:888`) — or a sibling method it calls — when
    `activeTool === 'brush'` and `brushAsset` is set and the cell is `isInside`, resolve the armed
    asset's texture via the same `parseAssetId` → `TileSource` → `resolveTile` chain the store uses
    ([textureLoading.ts:20](../src/editor/textureLoading.ts) / `resolveBrushValue`), set the image's
    texture/frame, position it at the hovered tile **centre**, `setOrigin(0.5)`,
    `setAngle(brushRotation)`, a semi-transparent alpha (~0.6), and `setVisible(true)`. Otherwise
    hide it. Keep the existing outline stroke underneath.
  - The scene must react to `brushRotation`/`brushAsset` changes: subscribe to the store (the scene
    already reads store state — mirror how it observes `activeTool`/overlays; if it uses a
    `subscribe`, add these fields; otherwise update the ghost from the existing per-frame/hover hook).
    Ensure the ghost texture may not be loaded yet — guard with `textures.exists` and skip (the paint
    path already lazy-loads on paint; a missing preview simply doesn't show).
  - Side effects: clear/hide the ghost on tool switch away from brush, on map close, and in the
    existing `hoverGfx?.clear()` paths (`:328`, `:741`). Don't let the ghost intercept pointer events
    (`setInteractive` NOT called; images are non-interactive by default).
  - Docs: none.
  - Done when: arming a tile with the brush shows a translucent copy of it at the cursor; pressing
    `R` visibly rotates that preview in 90° steps; moving off-map or switching tools hides it; the
    tile paints at the previewed angle.

- [x] **Step 6: Wire the `R` shortcut + on-screen rotate buttons** `[inline]`
  - Outcome: [EditorApp.tsx](../src/editor/EditorApp.tsx) — `R`/`Shift+R` handler in the window keydown
    (map-tab + INPUT-guard already applied), gated to `activeTool==='brush' && brushAsset`, calls
    `rotateBrush(±90)`. [Toolbar.tsx](../src/editor/Toolbar.tsx) — a brush-only button group (`⟲ −90°` /
    angle label `{brushRotation}°` / `⟳ +90°`), disabled when no `brushAsset`, mirroring the decor
    rotate buttons; added `brushAsset`/`brushRotation` selectors. [shortcuts.ts](../src/editor/shortcuts.ts) —
    new "Tile painting" group with `R` (+90°, notes rotated=distinct palette entry) and `Shift + R`
    (−90°). Confirmed `R` was unbound anywhere prior. `tsc` + eslint clean; `npm run build` green.
    Live hover/rotate visual check pending (see final review).
  - **Key:** wire `R` (and optionally `Shift+R` for −90°) to `rotateBrush(90)` in the same place the
    editor handles single-letter tool keys — check `EditorApp.tsx` window keydown first, falling back
    to `EditorScene.ts` Phaser input (mirror the `S` skin-cycle handler). Gate it to when the brush
    tool is active (or make it harmlessly no-op otherwise). Respect the existing typing-in-input
    guard so `R` in a text field doesn't rotate.
  - **Buttons:** add two buttons (`⟲ -90°` / `⟳ +90°`) mirroring the decor rotate buttons
    ([InspectorPanel.tsx:88-105](../src/editor/panels/InspectorPanel.tsx)), calling
    `rotateBrush(-90)` / `rotateBrush(90)`. Place them in the Toolbar next to the paint-mode strip,
    shown only when `activeTool === 'brush'` (mirror the `PAINT_MODE_TOOLS.has(activeTool)`
    conditional at [Toolbar.tsx:256](../src/editor/Toolbar.tsx)). Show the current angle (e.g. a
    small `90°` label) so the state is legible on a phone. Disable when no `brushAsset` is armed.
  - **Shortcuts panel:** add an `R` entry (and Shift+R if added) to the relevant group in
    [src/editor/shortcuts.ts](../src/editor/shortcuts.ts) — the in-app panel is authoritative
    ([editor shortcuts panel sync] memory).
  - Side effects: ensure `R` isn't already bound (grep `shortcuts.ts` + the keydown handlers).
  - Docs: none here (EDITOR.md updated in Step 8).
  - Done when: `R` cycles the pending rotation with the brush active; the toolbar buttons do the same
    and show the current angle; both are reflected live in the ghost preview; the Shortcuts panel
    lists the new binding.

- [x] **Step 7: Tests** `[delegate sonnet]`
  - Outcome: 11 new `it` cases (tests only, no source touched). [paintOps.test.ts](../src/editor/__tests__/paintOps.test.ts) +3
    in the existing `findOrAppendPaletteIndex` block (same key→same index/no growth; different rotation→distinct;
    omitted vs explicit 0 equal). [mapFormat.test.ts](../src/systems/__tests__/mapFormat.test.ts) +3
    (rotation:90 round-trip; no-rotation entry has no `rotation` key via `hasOwnProperty` precedent; `parseMap`
    rejects 45). [editorStore.test.ts](../src/editor/store/__tests__/editorStore.test.ts) +5 (paintLine at 90 →
    cell entry `rotation:90` + palette +1; `rotateBrush` cycles both directions incl. 270→0 wrap; fill/rect stay
    angle-0) and added `setBrushRotation(0)` to the shared `reset()` helper (sticky-singleton hygiene). Full suite
    green: 50 files / 650 tests; `world.test.ts` boot canary passed.
  - **paintOps** ([src/editor/**tests**/paintOps.test.ts](../src/editor/__tests__/paintOps.test.ts),
    in the existing `describe('findOrAppendPaletteIndex')` block `:186`): same `(pack, source,
    rotation)` → same index; same source, **different** rotation → distinct index; `rotation` omitted
    vs explicit `0` treated as equal.
  - **mapFormat round-trip**
    ([src/systems/**tests**/mapFormat.test.ts](../src/systems/__tests__/mapFormat.test.ts)): a
    palette entry with `rotation:90` round-trips through `serializeMap → JSON.parse → parseMap`; an
    entry with no rotation serializes with no `rotation` key (byte-identical precedent = the
    `favourites`/`region` tests); `parseMap` rejects `rotation:45`.
  - **editorStore** ([src/editor/store/**tests**/editorStore.test.ts](../src/editor/store/__tests__/editorStore.test.ts)):
    set `brushRotation`, `paintLine` one cell → the painted cell's palette entry has that rotation and
    the palette grew by one; `rotateBrush` cycles 0→90→180→270→0; `fillFrom`/`paintRectArea` still
    produce angle-0 entries.
  - Side effects: none (pure/unit). Run `npm test` (or the project's vitest command per
    docs/WORKFLOW.md) — the `world.test.ts` boot canary must stay green (no committed map changed).
  - Done when: new tests pass and the full suite is green.

- [x] **Step 8: Docs — EDITOR.md tools/shortcuts note** `[delegate haiku]`
  - Outcome: [EDITOR.md](../docs/EDITOR.md) only. Added one terse **Brush tool** line under "Tools &
    shortcuts": rotate armed piece in 90° steps (points at the Shortcuts panel for keys/buttons, no
    duplication), rotated tile = distinct palette entry, ghost preview shows the pending angle, fill/rect
    stay angle-0.
  - In [docs/EDITOR.md](../docs/EDITOR.md): under "Tools & shortcuts" / the brush description, add one
    terse line: rotating the armed tileset piece in 90° steps (`R` / toolbar buttons), a rotated tile
    = a distinct palette entry, ghost preview shows the pending angle; note fill/rect are angle-0. Do
    not duplicate the shortcut binding (the Shortcuts panel is authoritative — just reference it).
  - Side effects: none.
  - Done when: EDITOR.md mentions tile rotation concisely and points at the Shortcuts panel for the
    key.

## Parallel groups

Steps 1→2→3→4 are a hard dependency chain (format → dedup → store → bake). Steps 5 and 6 both depend
on Step 3 but are largely disjoint; however both are `[inline]` (judgement + shared scene/UI
surface), so they run sequentially, not parallelised. Steps 7 and 8 are write-disjoint and both
`[delegate]`, but 7 depends on Steps 1–3 landing — run 7 then 8 (or 8 anytime after Step 6). No
`(parallel: X)` labels assigned.

## Out of scope

- **Flip (flipX/flipY).** Rotation only; the 8-orientation set is a later plan.
- **Rotating `fill` and `rect` gestures.** Brush-only this plan; `fill`/`rect` paint angle-0. (The
  `resolveBrushValue` signature already carries the angle, so extending them later is a one-line
  change per gesture.)
- **Rotating already-painted cells** (hover-and-rotate-in-place). Pending-tile only.
- **Rotating decor or resource nodes.** Decor already rotates via the Inspector; nodes stay
  unrotated.
- **Arbitrary/free angles.** 90° steps only.
- **Palette GC of now-unused rotated variants.** Consistent with today's append-only, GC-is-manual
  contract.
