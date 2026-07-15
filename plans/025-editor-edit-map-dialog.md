# Editor: Edit Map Dialog (Rename + Resize)

> Status: deployed

## Summary

Replace the standalone **Resize** toolbar button with a single **Edit map** dialog that groups two
map-level operations: a new **Rename** (changes both `map.meta.name` and `map.meta.id`, the file key)
and the existing **Resize** (plan 024, unchanged behaviour). The two operations live in separate
sections of one dialog, each with its own Apply — because they have fundamentally different
semantics: Resize stays an in-doc, **undoable** command that persists via Save; Rename is an
**immediate, non-undoable disk migration** that (after a confirm) writes the map under the new id,
removes the old file, and migrates every store keyed by id (world.json placement, underlay settings,
thumbnail).

## Context & decisions

**Confirmed with user:**
- **Rename = full rename** — changes `meta.name` AND `meta.id`.
- **Timing = immediate, gated by a `window.confirm`.** On Apply, migrate on disk now; not undoable
  (reverse by renaming back). `window.confirm` is an accepted precedent (`ReferencePanel.tsx`,
  `ResizeMapDialog.tsx`).
- **Unsaved edits = save-current-then-migrate.** Apply serializes the *current in-memory* doc under
  the new id (so nothing is lost), then removes the old file and migrates refs.
- **Dialog shape = separate action per section.** One "Edit map" dialog, a Rename section (name + id,
  own Apply) and a Resize section (per-edge, own Apply). Resize behaviour is unchanged from plan 024.

**id-migration surface (from research — every store keyed by the map id):**
- **Map file** `src/data/maps/<id>.map.json` — the file key **is** the id in the filename, and
  `manifest.json`'s `maps[].id` is `map.meta.id`; they must change together
  (`scripts/vite-editor-api.mjs` `listMapIds` L204-209, `regenerateManifest` L262-274). Manifest regen
  **tolerates a removed map** (it just scans what's on disk). There is **no DELETE endpoint today** — a
  new one is needed.
- **world.json placement** — `MapPlacement = { mapId, origin }` (`worldLayout.ts:24-28`); `mapId` is
  the reference. `validateWorld` flags a placement pointing at a missing map as an ERROR
  (`worldLayout.ts:270-273`), so a rename must rewrite the matching `placement.mapId`. Placements are
  currently empty on disk (`world.json`), so the common case touches no world state. Only the
  **World** tab reads/writes world.json (`WorldViewTab.tsx` mount fetch L100-129, `handleSave`
  L320-335 via `putWorld`/`markWorldSaved`).
- **Underlay settings** — the ONLY per-mapId localStorage store: key
  `mostowo-editor-underlay:settings:<mapId>` (`underlayStore.ts:31-32`); `getSettings`/`putSettings`/
  `deleteSettings` (L57-90). **Images are keyed by reference name, NOT id** — no image migration
  needed. Migrate settings: read old → write new → delete old.
- **Thumbnail** `public/assets/maps/thumbs/<id>.png` — written by `putThumb(id, blob)`
  (`api.ts:87-96`, middleware L643-648). Re-export under the new id, delete the old.

**Two id fields must stay in sync:** the store keeps `mapId` (`editorStore.ts:204-205`) separate from
`map.meta.id`. `putMap` keys off `meta.id` (`Toolbar.tsx:132`) while underlay
(`getSettings(mapId)`/`syncUnderlayFromSettings` L1343) and ghost-neighbour lookup
(`EditorScene.ts:1037-1039`) key off store `mapId`. A rename **must update both**. The scene never
reads `meta.id`, so a pure id change needs no rebake — but React chrome (`Toolbar.tsx:320-322` reads
`map`/`mapId` selectors) needs a new `map` reference to re-render.

**ID validation:** `ID_PATTERN = /^[a-z0-9-]+$/` is declared locally in `NewMapDialog.tsx:16` (mirrors
the middleware's `ID_RE`). It is **not exported** and there is **no collision check** in
`NewMapDialog` — a rename must reject an id already returned by `listMaps()` (excluding the current
id). Extract the pattern to a shared export.

**Save flow to mirror** (`Toolbar.tsx:120-146`): `rebakeTerrainsForSave()` → `serializeMap` →
`parseMap(JSON.parse(json))` (validate exact bytes) → `putMap(meta.id, json)` → `markSaved()` →
`exportThumbnail(meta.id)` (bake via `bakeThumbnail` + `putThumb`, failure non-fatal). `markSaved`
sets `dirty:false` (`editorStore.ts:1377`).

**Patterns to mirror:** dialog UI + field validation gating the primary button —
`NewMapDialog.tsx`; per-edge resize form + `planResize` preview + Apply-gating + `window.confirm` crop
warning — `ResizeMapDialog.tsx`; toolbar `showX` state + conditional dialog render + async
`handleSave`/`handleOpen` orchestration — `Toolbar.tsx`; store command/coupling + underlay-settings +
world-placement + undo assertions in tests — `editorStore.ts` (`resizeMap`) and
`src/editor/store/__tests__/editorStoreResize.test.ts` (`FakeStorage` harness, `getSettings`/
`putSettings` assertions, coupled `map+world` undo).

**Shortcuts:** no change — Resize is toolbar-only (no shortcut), and the Edit map dialog stays
toolbar-only, matching that precedent (`shortcuts.ts` has no Resize/Rename entry; maintenance rule at
L6-15 only fires when a shortcut is added).

**Orchestration order (Rename Apply, after confirm) — write-new-before-delete-old so a failure never
orphans the live map:**
1. `oldId = mapId`; `rebakeTerrainsForSave()`.
2. Build `renamed = { ...map, meta: { ...map.meta, id: newId, name: newName } }`; `json =
   serializeMap(renamed)`; `parseMap(JSON.parse(json))` (validate).
3. `await putMap(newId, json)` (new file written first).
4. Commit in-memory state via the store action (below): set `map` (new ref) + `mapId = newId`,
   migrate underlay settings, rewrite any world placement `oldId→newId` + bump `worldRevision`,
   `dirty:false`. Returns `placementMigrated`.
5. Bake + `putThumb(newId)` (non-fatal on failure, like Save).
6. If `placementMigrated`: `await putWorld(serialize(world))` + `markWorldSaved()` (rename of a
   *placed* map also persists the World layout — surface this in the confirm text + a toast).
7. If `newId !== oldId`: `await deleteMap(oldId)` **last** (removes old map file + old thumb). A
   failure here is a non-fatal warning (orphaned old file), never a hard error — the new map is
   already good.
8. Success toast; keep the dialog open or close per section UX.

## Steps

- [x] **Step 1: Server DELETE endpoint + `deleteMap` api wrapper** `[delegate sonnet]` (parallel: A)
  - Outcome: `scripts/vite-editor-api.mjs` — added `rmSync` to the `node:fs` import; added a non-thumb `DELETE` branch in the map block (404 if `mapPath` missing, else `rmSync(mapPath)` + best-effort `rmSync` thumb + `regenerateManifest` + 200 `{ok:true}`; `world.json` untouched). `src/editor/api.ts` — added `export async function deleteMap(id)` mirroring `putMap`, doc-commented (removes thumb + regenerates manifest server-side). `tsc --noEmit` + eslint clean.
  - `scripts/vite-editor-api.mjs`: in the existing map block (regex `^\/__editor\/maps\/([^/]+)(\/thumb)?$`,
    ~L634-665) add a `req.method === 'DELETE'` branch for the **non-thumb** path: `sanitiseId` the id
    (already done at the top of the block), `const mapPath = join(mapsDir,`${id}${MAP_SUFFIX}`)`; if
    `!existsSync(mapPath)` respond 404 (mirror the map-GET 404 at L651-652); else
    `rmSync(mapPath)` (or `unlinkSync`), then best-effort delete the thumb
    `const thumbPath = join(thumbsDir,`${id}.png`); if (existsSync(thumbPath)) rmSync(thumbPath);`,
    then `regenerateManifest(mapsDir)` (mirror the PUT at L661) and `sendJson(res, 200, { ok: true })`.
    Import `rmSync`/`unlinkSync` from `node:fs` if not already imported. Do NOT touch `world.json` here
    (the client migrates the placement — matches the existing Save-Map-≠-Save-World split).
  - `src/editor/api.ts`: add `export async function deleteMap(id: string): Promise<void>` mirroring
    `putMap` (L35-44) — `fetch(`${BASE}/maps/${encodeURIComponent(id)}`, { method: 'DELETE' })` wrapped
    in `expectOk(...,`deleteMap(${id})`)`. Add a doc comment noting it also removes the thumb and
    regenerates the manifest server-side.
  - Side effects: `manifest.json` regenerates on delete; a stale `world.json` placement (if any) is NOT
    cleaned by this endpoint (client's job — see Step 4).
  - Docs: none in this step (covered in Step 5).
  - Done when: `tsc --noEmit` + eslint clean; a manual `DELETE /__editor/maps/<id>` removes the
    `.map.json` (+ thumb if present) and 404s for an unknown id.

- [x] **Step 2: Extract shared `MAP_ID_PATTERN`** `[delegate haiku]` (parallel: A)
  - Outcome: `src/systems/mapFormat.ts` — added `export const MAP_ID_PATTERN = /^[a-z0-9-]+$/;` near `MAX_MAP_DIM` with a one-line doc. `src/editor/NewMapDialog.tsx` — deleted the local `ID_PATTERN` + comment, imported `MAP_ID_PATTERN`, updated the `.test(id)` usage. Pure symbol move. `tsc --noEmit` + eslint clean; `npm test` 630 passed / 49 files.
  - `src/systems/mapFormat.ts`: near `MAX_MAP_DIM` add
    `export const MAP_ID_PATTERN = /^[a-z0-9-]+$/;` with a one-line doc (client mirror of the
    middleware's `ID_RE`; lowercase letters, digits, hyphens).
  - `src/editor/NewMapDialog.tsx`: delete the local `const ID_PATTERN = /^[a-z0-9-]+$/` (L16), import
    `MAP_ID_PATTERN` from `../systems/mapFormat`, and replace the `ID_PATTERN.test(id)` usage (L38).
  - Side effects: none — pure symbol move; behaviour identical.
  - Docs: none.
  - Done when: `NewMapDialog` compiles against the shared const; `tsc --noEmit` + eslint + existing
    tests clean.

- [x] **Step 3: Store `renameMapState` action + unit tests** `[inline]`
  - Outcome: `src/editor/store/editorStore.ts` — added `renameMapState(newId, newName): { placementMigrated }` (interface decl near `resizeMap`, impl right after `resizeMap`'s impl). No-op-returns-`{placementMigrated:false}` if `!map`; sets a new `map` ref with `meta.id/meta.name`, `mapId=newId`, `dirty:false`; on an id change migrates underlay settings (`getSettings`→`putSettings`→`deleteSettings`, `underlayRevision` bump) and rewrites the matching `world.placements` entry `mapId` in place (`worldDirty:true` + `worldRevision` bump). Not routed through history (documented why). New suite `src/editor/store/__tests__/editorStoreRename.test.ts` (7 tests, `FakeStorage` harness) covers new-ref/meta/mapId/dirty, underlay migrate + no-underlay no-op, placement migrate + not-placed, name-only leaves keys alone, and no-open-map guard. tsc + eslint clean; `npm test` 637 passed (50 files).
  - `src/editor/store/editorStore.ts`: add a synchronous action
    `renameMapState(newId: string, newName: string): { placementMigrated: boolean }` (declare in the
    state interface near `resizeMap` L470, implement near `resizeMap`'s impl). It does ONLY the
    in-memory + localStorage mutations (all disk IO stays in the component, Step 4). Behaviour:
    - No-op guard: if `!map` return `{ placementMigrated: false }`.
    - `const oldId = get().mapId`.
    - Set a **new** `map` reference: `{ ...map, meta: { ...map.meta, id: newId, name: newName } }`, set
      `mapId: newId`, `dirty: false` (the component writes to disk around this call).
    - **Underlay settings migration** (only if `newId !== oldId` and `oldId`): read
      `getSettings(oldId)`; if present, `putSettings(newId, settings)` then `deleteSettings(oldId)`;
      bump `underlayRevision` (mirror `resizeMap`'s underlay handling). If the underlay is currently
      hydrated its live state is unaffected — `mapId` now points at the migrated key.
    - **World placement migration** (only if `newId !== oldId`): find a `world.placements` entry with
      `mapId === oldId`; if found, rewrite its `mapId` to `newId` **in place** (mirror
      `movePlacement`'s in-place mutation), set `worldDirty: true`, bump `worldRevision`, and return
      `placementMigrated: true`. Otherwise `false`.
    - This action is deliberately NOT routed through `applyCommand`/history — a rename is not undoable
      (see Summary). Add a doc comment stating that and why (id is a filesystem key; reversed by
      renaming back).
  - Tests: new `src/editor/store/__tests__/editorStoreRename.test.ts` mirroring
    `editorStoreResize.test.ts` (`FakeStorage`, `vi.stubGlobal('localStorage', …)`, `reset()` doing
    `newMap` + `setWorld`). Assert: `map.meta.id`/`meta.name` updated and `map` is a new reference;
    `mapId === newId`; `getSettings(newId)` present + `getSettings(oldId)` gone when settings existed;
    world placement `mapId` migrated + `worldDirty` true + `placementMigrated` true when placed, and
    `placementMigrated` false + world untouched when not placed; name-only change (id unchanged) leaves
    underlay/world keys alone; `dirty` false after the call.
  - Side effects: `mapId` and `meta.id` now change together — verify no other reader assumes they were
    only set by `newMap`/`loadMap` (research found only underlay + ghost lookup use `mapId`, both fine
    post-migration).
  - Docs: none.
  - Done when: `npm test` green (new suite + full suite); `tsc --noEmit` + eslint clean.

- [x] **Step 4: `EditMapDialog` (Rename + Resize sections) + Toolbar wiring; remove `ResizeMapDialog`** `[inline]`
  - Outcome: new `src/editor/EditMapDialog.tsx` — one shadcn `Dialog` with a **Rename** section (Name + Id inputs pre-filled from `map.meta`, `MAP_ID_PATTERN` + non-empty-name gating, `listMaps()` mount fetch for a collision check excluding the current id, `window.confirm` gate, then the async orchestration: `rebakeTerrainsForSave` → build renamed doc → `serializeMap` → `parseMap` validate → `putMap(newId)` → `renameMapState` → bake+`putThumb(newId)` non-fatal → if placed `putWorld`+`markWorldSaved` → `deleteMap(oldId)` last, non-fatal warning; success + world-saved toasts) and a **Resize** section (plan-024 body moved in verbatim, own Apply). `src/editor/Toolbar.tsx` — `showResize`→`showEdit`, **Resize** button→**Edit** (`disabled={!map}`), import + conditional render swapped to `EditMapDialog` (thumbnail bake+PUT inlined in the dialog, warning-not-failure preserved). Deleted `src/editor/ResizeMapDialog.tsx` (grep confirmed only Toolbar imported it). tsc + eslint clean; `npm test` 637 passed (50 files). Live `npm run editor` smoke-test pending user (browser-only).
  - New `src/editor/EditMapDialog.tsx`: a single shadcn `Dialog` (mirror `ResizeMapDialog`'s
    conditional-mount contract — always `open`, `onOpenChange(false)`→`onCancel`) with two sections:
    - **Rename section:** `Name` + `Id` inputs pre-filled from `map.meta.name`/`map.meta.id`. Validate
      with `MAP_ID_PATTERN` (Step 2) + non-empty name. Fetch existing ids via `listMaps()` on mount
      (mirror `OpenMapDialog.tsx:22`) and reject a `newId` that collides with an existing id **other
      than the current one**. Apply-gating: valid id, non-empty name, and (`id` changed OR `name`
      changed), and no collision. The **Rename** button opens a `window.confirm` whose text states this
      writes to disk now, removes the old file, is **not undoable**, and (if the map is placed in the
      world) also saves the World layout. On confirm run the async orchestration from Context §
      "Orchestration order": `rebakeTerrainsForSave` → build renamed doc → `serializeMap` →
      `parseMap` validate → `putMap(newId)` → `renameMapState(newId,newName)` → bake+`putThumb(newId)`
      (non-fatal) → if `placementMigrated` `putWorld`+`markWorldSaved` → if id changed
      `deleteMap(oldId)` last (non-fatal warning on failure). Toast success (`Renamed to "<name>"
      (<id>).`) and, when placed, a second toast that the World layout was saved. All disk IO lives in
      this component (matches `Toolbar.handleSave`/`handleOpen` doing IO in the component, not the
      store).
    - **Resize section:** move the entire body of `ResizeMapDialog` verbatim (per-edge inputs,
      `planResize` preview, Apply-gating, the `window.confirm` crop warning, `resizeMap`) into this
      section with its own Apply button. No behaviour change.
    - Visually separate the two sections (a divider + section headings), each with its own primary
      button; a single shared Cancel/close.
  - `src/editor/Toolbar.tsx`: rename the `showResize` state → `showEdit`; replace the **Resize** button
    (L198-205) with an **Edit** button (`disabled={!map}`, same styling); swap the
    `import { ResizeMapDialog }` for `EditMapDialog` and the conditional render (L349)
    `{showEdit && <EditMapDialog onCancel={() => setShowEdit(false)} />}`. Extract the reusable
    thumbnail bake+PUT (currently `Toolbar.exportThumbnail` L149-158) into a place the dialog can call —
    simplest: export a small helper or inline the same 3 lines in the dialog (`bakeThumbnail` from the
    store + `putThumb`). Keep the "thumbnail failure is a warning, not a save failure" behaviour.
  - Delete `src/editor/ResizeMapDialog.tsx` (superseded). Grep for any other importers first
    (`grep -rn ResizeMapDialog src`) — expected only `Toolbar.tsx`.
  - Side effects: after a rename the Toolbar name/id display (L320-322) must reflect the new values —
    guaranteed because `renameMapState` sets a new `map` ref + new `mapId`, so the selectors re-render.
    The scene needs no rebake (never reads `meta.id`). Confirm the Resize section still triggers the
    scene's full rebuild on a dimension change (unchanged `resizeMap` path).
  - Docs: none (Step 5).
  - Done when: `npm run editor` — the toolbar shows **Edit** (not Resize); opening it shows both
    sections; a resize still works exactly as before; a rename (id change) with a confirm updates the
    toolbar name/id, writes `<newId>.map.json`, removes `<oldId>.map.json` + old thumb, migrates the
    underlay settings key, and (if placed) rewrites + saves the world placement; a name-only rename
    persists the new name; a colliding id is rejected before Apply. `tsc --noEmit` + eslint + `npm
    test` clean.

- [x] **Step 5: Docs** `[delegate sonnet]`
  - Outcome: `docs/EDITOR.md` — Layout toolbar sentence now lists New/Open/Save/**Edit**; the Toolbar-actions block's standalone **Resize** bullet is replaced by an **Edit map** (plan 025) bullet with a **Rename** sub-point (display name + id, confirm gate, collision + `/^[a-z0-9-]+$/` check, immediate non-undoable migration, reverse by renaming back) and a **Resize** sub-point (plan 024 prose kept verbatim); Reference-overlay section notes the underlay key migrates on rename; Generated-artifacts thumbnail bullet notes the rename re-bakes under the new id + removes the old `<id>.png`; Persistence-contract middleware line adds the new `DELETE /__editor/maps/:id`, plus a new "Rename id-migration contract" paragraph (write-new-before-delete-old sequence + underlay-key migration). No new shortcut noted. `grep` confirms the only remaining "Resize" mention is the Resize sub-section inside Edit map (no dangling standalone-button phrasing).
  - `docs/EDITOR.md`: update the toolbar layout summary (L20-22) and the Toolbar-actions block (which
    currently documents only **Resize**, L30-38) to describe the **Edit map** dialog: a Rename section
    (changes both the display name and the id) and a Resize section (unchanged, plan 024). Document the
    **id-migration / persistence contract** concisely in the persistence section (L89-96) and touch the
    generated-artifacts note (L81-87): renaming the id is an **immediate, non-undoable** disk migration
    that (after a confirm) writes `<newId>.map.json`, removes `<oldId>.map.json` and its thumb, migrates
    the underlay settings key `mostowo-editor-underlay:settings:<id>`, and — for a placed map — rewrites
    and **saves** its `world.json` placement. Keep edits terse/high-signal. Note no new shortcut
    (toolbar-only, matches Resize).
  - Side effects: none.
  - Done when: EDITOR.md reads correctly against the shipped dialog; no dangling references to a
    standalone Resize button.

## Out of scope

- Making the Rename operation undoable (it is an immediate disk migration by design; reverse by
  renaming back).
- Cleaning up `world.json` placements server-side on map delete (the client migrates the placement;
  the DELETE endpoint deliberately doesn't touch world.json, matching the Save-Map-≠-Save-World split).
- Any change to Resize behaviour beyond relocating its UI into the Edit map dialog.
- A dedicated keyboard shortcut for Edit map / Rename / Resize.
- Bulk rename or renaming a map that isn't the currently open one.
