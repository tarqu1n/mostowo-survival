# Editor Session Restore

> Status: planned (revised after critique) — run /execute-plan to begin.

## Summary

Make a mobile browser reload of the Map Builder lossless. When the phone discards the
backgrounded editor tab (or the user manually refreshes — now the norm since HMR is off on guppi),
the editor currently reboots to the empty "New or Open a map" state: you lose which map was open,
the camera pan/zoom, and the active tool/layer/tab. The map *data* is already safe (autocommit to
disk) and per-map library/underlay view-state already persists; this feature adds a small
`localStorage` session slice + a boot-time restore so a reload drops you back where you were.

The browser reload itself cannot be prevented (no web API opts a page out of tab eviction) — the
goal is to make it a non-event.

## Context & decisions

**User decisions (from planning):**
- **Restore trigger: on ANY reload.** Whenever a saved session exists, boot reopens the last map.
  A deliberate "Close map" clears the pointer, so it still gives a clean start. `document.wasDiscarded`
  is NOT used to gate restore (it would skip manual refreshes, which we specifically want to survive).
- **Camera memory: per-map.** Each map remembers its own camera view, keyed by map id — restored on
  every open of that map.
- **Tabs scope: active-tab-only.** Restore which *permanent* tab (map/world/nodeTypes) was active.
  Do NOT persist/reopen on-demand `object:<assetId>` tabs. A dangling active tab falls back to `map`.

**Revisions applied after critique (see `## Critique` at end):**
- **Camera persistence is fully scene-owned** (critique #6). `EditorScene` owns the camera and every
  gesture-settle point, so it BOTH reads the saved camera at build time and writes it on settle,
  talking to `sessionStore` directly. This removes the `readCamera` bridge, the `cameraSettleNonce`
  signal, and `pendingRestoreCamera` from the earlier draft — **the store gains no camera fields at
  all** — and eliminates the debounced-autosave-vs-async-buildScene race that could persist a
  default camera over a good one (critique #1/#2).
- **Storage split by restore-timing** (critique #5): two keys, each with exactly ONE writer, so no
  shared-key read-modify-write races and no cross-map contamination:
  - `mostowo-editor-session:last` → `{ mapId, activeTool?, activeLayerId?, activeTabId? }` — the whole
    boot-resume session (which map + the tool/layer/tab to restore *on resume only*). Written solely by
    the store-driven autosave. Always reflects the currently-open map's state; opening a different map
    overwrites it wholesale, so map B can never inherit map A's tool.
  - `mostowo-editor-session:camera:<mapId>` → `CameraState` — per-map camera. Written solely by
    `EditorScene` on gesture-settle; read solely by `EditorScene` in `buildScene`.
- Restored `activeLayerId` is **validated against the loaded map's layers** before applying (critique
  #3 — `setActiveLayer` is a bare `set`, it does NOT reconcile).
- Camera settle fires at **pinch / two-finger gesture end** too (critique #4 — the primary mobile
  zoom), not only pan-end / wheel / `zoomByStep`.
- The autosave debounce timer is **module-scoped** in `sessionSource.ts` so `flushSession` can clear
  it (critique #8).

**Architecture (mirrors existing seams — do not invent new patterns):**

- **Storage module** `src/editor/sessionStore.ts` (NEW) — Phaser-free, `MapFile`-free, exactly like
  `src/editor/libraryViewStore.ts`. Same `storage()` try/catch guard (`libraryViewStore.ts:51-57`),
  same `PREFIX` + key builders, same read=degrade-to-default / write=swallow-errors pattern
  (`libraryViewStore.ts:93-157`). Defines `CameraState` + `SessionLast` and exports them (same
  dependency direction as `libraryViewStore` types imported by the store / scene).

- **Orchestration module** `src/editor/sessionSource.ts` (NEW) — mirrors `src/editor/palettesSource.ts`
  (pairs `loadPalettes` + `installPaletteAutosave` + `putPalettes`). Holds `openMapById`,
  `restoreSession`, `installSessionAutosave`, `flushSession`. Writes ONLY the `last` record; never camera.

- **`EditorScene`** owns camera persistence end-to-end — no store bridge. Reads
  `getCamera(mapId)` in `buildScene` (restore-or-fit) and calls `putCamera(mapId, …)` on every
  settle. Importing a pure `sessionStore` helper from the scene is fine (one-way, no cycle).

**Key file:line references (from research — reverify on execution):**
- Boot mount effect (restore hook point): `EditorApp.tsx:294-320` (loads catalog/terrain/nodeDefs/
  palettes; `loadPalettes().finally(() => installPaletteAutosave())` is the load-then-subscribe shape).
- Manual open path: `OpenMapDialog.tsx:58` → `Toolbar.tsx:324-334` (`handleOpen`) → `getMap` (`api.ts:25`)
  → `migrateMap` → `store.loadMap(loaded, id)` (`editorStore.ts:1428-1460`).
- `loadMap` already rehydrates per-map view-state (`getRecents(id)`/`getBrowse(id)`) and bumps `mapEpoch`;
  sets `activeLayerId = map.layers[0]?.id ?? null` (the default a manual open keeps).
- Epoch→build chain: `EditorScene.ts:305-308` (mapEpoch sub) → `syncDocument()` `:413-421` →
  `loadTexturesThenBuild` (async texture load) → `buildScene` `:536-547` → `fitCamera(map)` `:541`/`:1553-1562`.
  `buildScene` reads the live `map`; `mapId` is already set on the store by the time it runs.
- `fitCamera` (`:1553-1562`) sets `cam.setBounds(...)` then `setZoom`/`centerOn`. **The restore branch
  must keep the `setBounds` line** (it makes scroll clamping correct); only override zoom/scroll.
- Zoom clamp: `MIN_ZOOM = 1`, `MAX_ZOOM = 4` (`:56-57`); camera = `this.cameras.main`, props
  `scrollX`/`scrollY`/`zoom`; zoom stepping integer-only (`zoomByStep` `:1583-1586`, `handleWheel`
  `:1570-1575`); pan-drag updates scroll ~`:1988-1990`; **two-finger/pinch gesture end in the
  pointer-up handler ~`:2103`** (reverify the exact line — this is the mobile-zoom settle site).
- `setActiveLayer` is a bare `set` at `editorStore.ts:1515` — **no reconcile** (critique #3); validate
  before calling. `reconcileTabs` (`:1178-1196`) early-returns while `catalog` is null, so applying
  `activeTabId` before catalog load is safe; `activateTab` no-ops on an unknown id.
- Bridge precedent (NOT used for camera anymore, but the install/teardown shape for reference):
  `zoomViewport`/`bakeThumbnail` store `editorStore.ts:432-446, 566-570, 1762-1763`; scene `:391,394`,
  teardown `:404-405`.
- Rename id-migration (must migrate the camera key + repoint the pointer): `renameMapState`
  (`editorStore.ts:678-689`), documented `docs/EDITOR.md:214-219`.
- Page Lifecycle usage is **greenfield** — no existing `visibilitychange`/`pagehide`/`freeze`/
  `wasDiscarded` usage anywhere in the repo.
- Tests to mirror: `src/editor/__tests__/libraryViewStore.test.ts` (pure module: `FakeStorage`,
  `vi.stubGlobal('localStorage', …)`, malformed→default, storage-unavailable→no-throw) and
  `src/editor/store/__tests__/editorStoreLibraryView.test.ts` (store reset via `newMap('scratch',…)`).
- Docs: `docs/EDITOR.md:200-224` "Persistence contract" (add a sibling paragraph + the rename list).

**Direction check (`CLAUDE.md` / `README.md`):** the game is worked on "from whatever device is to
hand (often on a phone, mid-journey, across many short sessions)"; the editor is "hosted always-on on
guppi for phone authoring." A lossless phone reload is squarely on that stated direction. It's editor
tooling, not game content — no conflict with the MVP roadmap.

## Steps

- [x] **Step 1: `sessionStore.ts` pure storage module + unit test** `[delegate]`
  - Outcome: created `src/editor/sessionStore.ts` (6 fns: `getLast`/`putLast`/`clearLast`/`getCamera`/`putCamera`/`clearCamera`; 2 types: `CameraState`, `SessionLast`) + `src/editor/__tests__/sessionStore.test.ts` (16 tests). Mirrored `libraryViewStore.ts` posture exactly (`storage()` guard, `PREFIX='mostowo-editor-session:'`, `LAST_KEY`, `cameraKey`). Used type-only `import type { EditorTool } from './store/editorStore'` — no lint cycle, `string` fallback not needed. Acceptance: 16/16 tests pass, `tsc --noEmit` + eslint + prettier all clean. Nothing imports it yet.
  - Create `src/editor/sessionStore.ts`, structurally copying `src/editor/libraryViewStore.ts`'s posture
    (Phaser-free, `MapFile`-free): the `storage()` guard, `PREFIX = 'mostowo-editor-session:'`, key
    builders `LAST_KEY = \`${PREFIX}last\`` and `cameraKey = (mapId) => \`${PREFIX}camera:${mapId}\``.
  - Export types: `CameraState = { scrollX: number; scrollY: number; zoom: number }` and
    `SessionLast = { mapId: string; activeTool?: EditorTool; activeLayerId?: string | null; activeTabId?:
    string }`. Import `EditorTool` as a type-only import from `./store/editorStore` (no runtime cycle;
    if a cycle is flagged by the linter, fall back to `activeTool?: string` and let callers narrow).
  - Functions (all with read=degrade-to-default, write=swallow-errors, per `libraryViewStore.ts:93-157`):
    `getLast(): SessionLast | null`, `putLast(last: SessionLast): void`, `clearLast(): void`,
    `getCamera(mapId: string): CameraState | null`, `putCamera(mapId: string, cam: CameraState): void`,
    `clearCamera(mapId: string): void`. Tolerate partial/missing fields on read; validate that a parsed
    `SessionLast` has a string `mapId` (else return null) and a parsed camera has three finite numbers
    (else return null).
  - Create `src/editor/__tests__/sessionStore.test.ts` mirroring `libraryViewStore.test.ts`: `FakeStorage`
    - `vi.stubGlobal`; round-trip both records; malformed raw → null/default; storage-unavailable
    (`vi.stubGlobal('localStorage', undefined)`) → getters return null, setters don't throw; `clear*`
    removes the key.
  - Side effects: none — new files, nothing imports them yet.
  - Docs: none (Step 7).
  - Done when: the six functions + two types export; `npm test` passes `sessionStore.test.ts`;
    lint/typecheck clean.

- [x] **Step 2: `EditorScene` — camera restore-on-build + scene-owned persist-on-settle** `[inline]`
  - Outcome: edited `src/editor/EditorScene.ts`. Imported `getCamera`/`putCamera` from `./sessionStore`. `buildScene` now calls new `restoreOrFitCamera(map)` instead of `fitCamera(map)`: reads `getCamera(mapId)`, applies saved zoom/scroll (clamped) over shared bounds, else fits. Extracted `setCameraBounds(map)` helper shared by `fitCamera` + restore (keeps the `setBounds` that scroll-clamping needs). Added `persistCamera()` (`putCamera` with `Math.round(zoom)`), wired into all four USER settle sites — reverified against live code: `handleWheel` end, `zoomByStep` end, pinch/two-finger end (`this.gesture = null` in `handlePointerUp`, ~:2103), and pan release (`dispatchToolPointerUp` `panning` branch, ~:2123 — NOT the per-frame `handlePointerMove` scroll at ~:1988 as the plan's ref implied). No store changes. Acceptance: `tsc --noEmit` clean; eslint 0 errors (5 pre-existing unbound-method warnings unchanged); full suite 777/777 pass. Behavioural camera check deferred to live (restore only reachable after steps 3–4).
  - In `src/editor/EditorScene.ts`, import `getCamera`, `putCamera` (and `type CameraState`) from
    `./sessionStore`, and `useEditorStore`.
  - **Restore-or-fit** in `buildScene` (`:536-547`): replace the unconditional `fitCamera(map)` (`:541`)
    with: read the current map id (`const mapId = useEditorStore.getState().mapId`); `const saved = mapId
    ? getCamera(mapId) : null;` if `saved`, apply it — run the same `cam.setBounds(...)` block from
    `fitCamera` (KEEP bounds), then `cam.setZoom(Phaser.Math.Clamp(saved.zoom, MIN_ZOOM, MAX_ZOOM))` and
    `cam.setScroll(saved.scrollX, saved.scrollY)` (Phaser clamps scroll to the bounds just set); else
    `fitCamera(map)`. Extract a private `applyRestoreCamera(map, saved)` if cleaner. This is the ONLY
    read site and it must NOT write (no persist feedback loop from a programmatic camera set).
  - **Persist-on-settle**: add a private `persistCamera()` — `const mapId = useEditorStore.getState().mapId;
    if (!mapId) return; const c = this.cameras.main; putCamera(mapId, { scrollX: c.scrollX, scrollY:
    c.scrollY, zoom: Math.round(c.zoom) });`. Call it at every USER camera-gesture settle (end of gesture,
    not per frame): the pan-drag pointer-up site (~`:1988-1990` release), `zoomByStep` (`:1583-1586`),
    `handleWheel` (`:1570-1575`), and the **two-finger/pinch gesture-end branch in the pointer-up handler
    (~`:2103` — reverify)**. Do not call it from `buildScene`/`fitCamera`/`applyRestoreCamera`
    (programmatic moves) or per-move-frame. Writing synchronously on settle means there's no camera
    debounce to flush and the saved camera is always current (closes critique #2 — no null-bridge write).
  - Side effects: no store changes at all in this step. StrictMode double-mount is irrelevant (no
    install/teardown bridge). Confirm `Math.round(zoom)` matches the integer-zoom invariant; confirm a
    brand-new map (no `camera:<id>` key) falls through to `fitCamera` (its fit is intentionally NOT
    persisted — absence of a key deterministically re-fits next load).
  - Docs: none (Step 7).
  - Done when: opening a map with no saved camera fits as before; with a seeded `camera:<id>` it lands at
    that scroll/zoom instead; panning / wheel-zoom / step-zoom / pinch-zoom each write the current camera
    to `camera:<id>` on release (verified by reading localStorage after the gesture).

- [x] **Step 3: `sessionSource.ts` — shared open, restore, autosave, flush** `[inline]`
  - Outcome: created `src/editor/sessionSource.ts` (mirrors `palettesSource.ts`). Exports `openMapById` (getMap→migrateMap→loadMap→bool; logs detail, caller toasts), `restoreSession` (reopens `last.mapId`, applies tool + no-op-safe tab + **layer validated against `map.layers`** per critique #3; stale pointer → `clearLast`), `installSessionAutosave` (subscribes a joined-string selector `mapId\u0000activeTool\u0000activeLayerId\u0000activeTabId` via `subscribeWithSelector`, 400ms module-scoped debounce → `writeNow`), `flushSession` (cancel timer + write now). Camera never touched here. Refactored `Toolbar.tsx` `handleOpen` to call `openMapById` (generic failure toast, reads `map.meta.name` for success); dropped now-unused `getMap`/`migrateMap` imports, added `openMapById`. Used the `\u0000` *escape* (not a raw NUL byte — that trips grep binary-detection) as the selector separator. Imports acyclic. Acceptance: `tsc` clean, eslint clean, 777/777 tests pass.
  - Create `src/editor/sessionSource.ts` (mirror `palettesSource.ts`). Imports: `useEditorStore`, `getMap`
    (`./api`), `migrateMap` (same source `Toolbar` uses), and `getLast`/`putLast`/`clearLast` from
    `./sessionStore`.
  - `export async function openMapById(id: string): Promise<boolean>` — the single open sequence for both
    the manual dialog and boot restore: `getMap(id)` → `migrateMap(raw)` →
    `useEditorStore.getState().loadMap(loaded, id)` → `true`; on fetch/parse failure → `false` (caller
    decides toast). Camera restore is automatic (Step 2's `buildScene`).
  - `export async function restoreSession(): Promise<void>` — `const last = getLast(); if (!last?.mapId)
    return; const ok = await openMapById(last.mapId); if (!ok) { clearLast(); return; }` then apply the
    session-scoped fields: `setActiveTool(last.activeTool)` if set; `activateTab(last.activeTabId)` if set
    (no-ops on unknown id); and for the layer, **validate first** (critique #3) —
    `const m = useEditorStore.getState().map; if (last.activeLayerId && m?.layers.some(l => l.id ===
    last.activeLayerId)) setActiveLayer(last.activeLayerId);` (else keep `loadMap`'s `layers[0]` default).
    No toast (silent resume).
  - `export function installSessionAutosave(): () => void` — mirror `installPaletteAutosave`
    (`palettesSource.ts:50-67`) with a **module-scoped** debounce timer (critique #8): subscribe (via the
    store's `subscribeWithSelector`) to the tuple `(s) => [s.mapId, s.activeTool, s.activeLayerId,
    s.activeTabId]` (array selector + shallow equality, or a joined-string selector). On change, debounce
    (~400 ms, `SESSION_AUTOSAVE_DEBOUNCE_MS`) then `writeNow()`. Returns the unsubscribe. **Camera is NOT
    in this tuple** and never written here.
  - Private `writeNow()`: `const s = useEditorStore.getState(); if (!s.mapId) { clearLast(); return; }
    putLast({ mapId: s.mapId, activeTool: s.activeTool, activeLayerId: s.activeLayerId, activeTabId:
    s.activeTabId });`
  - `export function flushSession(): void` — clear the module-scoped debounce timer, then `writeNow()`
    immediately (for the lifecycle listeners).
  - Refactor `Toolbar.tsx` `handleOpen` (`:324-334`) to call `openMapById(id)`, keeping its
    `toast.success`/`setShowOpen(false)`, plus a failure toast when it returns `false`. Single-sources the
    open sequence.
  - Side effects: `Toolbar.tsx` imports from `sessionSource`; confirm acyclic (`sessionSource` →
    `editorStore`/`api`/`sessionStore`; `Toolbar` → `sessionSource`). Verify the store exposes
    `subscribe(selector, listener)` (it uses `subscribeWithSelector` — `editorStore.ts:33`).
  - Docs: none (Step 7).
  - Done when: `openMapById` opens identically to the old `handleOpen`; `restoreSession()` with a seeded
    `last` opens the map and applies tool/validated-layer/tab; a stale pointer (getMap 404) clears `last`
    and no-ops; `installSessionAutosave` writes `last` on a tool/layer/tab/map change (debounced) and
    clears it when the map closes; `flushSession` writes immediately.

- [x] **Step 4: EditorApp boot wiring + Page Lifecycle flush** `[inline]`
  - Outcome: edited `src/editor/EditorApp.tsx` boot effect (the catalog/palettes loader effect). Added `import { restoreSession, installSessionAutosave, flushSession } from './sessionSource'`; `void restoreSession().finally(() => { unsubSession = installSessionAutosave(); })` (load-then-subscribe, mirroring palettes); registered `visibilitychange` (fires `flushSession` only when `document.visibilityState === 'hidden'`) + `pagehide` (`flushSession`) listeners; effect cleanup now also calls `unsubSession?.()` and removes both listeners, beside the existing `unsubPalettes?.()`. StrictMode double-mount is idempotent (re-open same map harmless); the `.finally`-assigned `unsubSession` dev-only double-subscribe is accepted per critique #7. Acceptance: `tsc` clean, eslint clean, 777/777 tests pass. Behavioural reload/flush/close checks deferred to live verification.
  - In `src/editor/EditorApp.tsx` boot effect (`:294-320`), alongside the existing loaders:
    - `let unsubSession: (() => void) | undefined; void restoreSession().finally(() => { unsubSession =
      installSessionAutosave(); });` (load-then-subscribe, like palettes).
    - Lifecycle flush so a discard/refresh mid-debounce still persists the `last` pointer/fields:
      `const onHide = () => { if (document.visibilityState === 'hidden') flushSession(); };`
      `window.addEventListener('visibilitychange', onHide);`
      `window.addEventListener('pagehide', flushSession);` (register both — `pagehide` is the most
      reliable pre-unload signal; `visibilitychange:hidden` the most reliable on iOS).
    - Cleanup (effect return): `unsubSession?.();
      window.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushSession);` beside the existing `unsubPalettes` cleanup.
  - Side effects: StrictMode double-mount runs the effect twice; restore is idempotent (re-opening the
    same map is harmless). Note (critique #7): because `unsubSession` is assigned inside `.finally()`, the
    first StrictMode cleanup may run before the assignment and leak one autosave subscription in DEV —
    this mirrors the existing `installPaletteAutosave` pattern and is dev-only + idempotent; accept it
    (do not add complexity to guard a dev-only double-subscribe). `document.wasDiscarded` is intentionally
    NOT used. Active-tab-only means no object-tab reconcile depends on catalog load, so restore ordering
    vs the async catalog/nodeDefs loads is safe.
  - Docs: none (Step 7).
  - Done when: a full reload with a saved session reopens the map at the saved camera with the saved
    tool/validated-layer/active-tab; simulating `visibilitychange`→hidden flushes the `last` record; a
    deliberate Close map → reload lands on the empty state.

- [x] **Step 5: rename + delete key migration** `[inline]`
  - Outcome: edited `src/editor/store/editorStore.ts`. Imported `getCamera`/`putCamera`/`clearCamera`/`getLast`/`putLast` from `../sessionStore`. In `renameMapState` (impl at :2352), added a migration block inside the existing `if (idChanged && oldId)` guard, mirroring the library view-state block: `getCamera(oldId)` → `putCamera(newId, …)` → `clearCamera(oldId)`, and `if (getLast()?.mapId === oldId) putLast({ ...last, mapId: newId })`. **Deviation (delete path):** the plan assumed a standalone map-delete affordance, but none exists — the only `deleteMap` caller is the rename flow's old-file cleanup (`EditMapDialog.tsx:131`), where `renameMapState` has *already* cleared `camera:<oldId>` and repointed `last`, so adding `clearCamera`/`clearLast` there would be redundant (camera) or actively wrong (`clearLast` would drop the now-correct newId pointer). Out-of-band deletion self-heals via the boot `getMap`-404 → `clearLast` path (Step 3). Nothing wired for delete. Acceptance: `tsc` clean, eslint clean, 777/777 tests pass (store-level migration test added in Step 6).
  - `renameMapState` (`editorStore.ts:678-689`) already migrates the underlay + library keys on an id
    change; in the id-changed branch add the camera key: `const cam = getCamera(oldId); if (cam)
    putCamera(newId, cam); clearCamera(oldId);` and repoint the session pointer if it named the old id:
    `const last = getLast(); if (last?.mapId === oldId) putLast({ ...last, mapId: newId });` (layer ids are
    unchanged by a rename, so `last.activeLayerId` stays valid). Import `getCamera`/`putCamera`/`clearCamera`
    /`getLast`/`putLast` from `../sessionStore`. Skip in a name-only (id-unchanged) rename, like the
    existing underlay/world migration.
  - Delete path: find the caller of `deleteMap` (`api.ts`) — the map-delete affordance — and after a
    successful delete, `clearCamera(id)` and, if `getLast()?.mapId === id`, `clearLast()`. (Boot restore
    also self-heals a dangling pointer via the getMap-404 path, so this is tidiness, not correctness-
    critical — still do it.)
  - Side effects: keep this step's edits to CODE only — the `docs/EDITOR.md` rename-migration list entry
    is in Step 7 (avoids two steps editing EDITOR.md).
  - Docs: none here (Step 7).
  - Done when: renaming an open map moves its `camera:<id>` key and repoints `last.mapId`; deleting a map
    clears its camera key and clears `last` if it named that map.

- [ ] **Step 6: store-level + source tests** `[delegate]`
  - `src/editor/store/__tests__/editorStoreSession.test.ts` (mirror `editorStoreLibraryView.test.ts`:
    `FakeStorage`, `vi.stubGlobal`, `reset()` opening a scratch map): `renameMapState` id-change migrates
    the `camera:<id>` key and repoints `last.mapId`; a name-only rename leaves keys untouched. (Camera
    restore-in-`buildScene` is Phaser and not unit-testable here — cover it by the Step 2 manual check /
    the boot canary if it exercises a map open.)
  - `src/editor/__tests__/sessionSource.test.ts`: with `getMap` mocked (`vi.mock('../api', …)`), assert
    `restoreSession()` opens the seeded `last.mapId` and applies tool + validated layer + active tab; a
    saved `activeLayerId` NOT in the map's layers is skipped (critique #3); a stale pointer (getMap
    rejects) clears `last`; `installSessionAutosave()` writes `last` after a tool change (advance fake
    timers past the debounce) and clears it on `closeMap`; `flushSession()` writes immediately without the
    debounce. Use `vi.useFakeTimers()` for the debounce assertions.
  - Side effects: none beyond test files.
  - Docs: none.
  - Done when: `npm test` passes the new suites with no flake.

- [ ] **Step 7: docs** `[delegate haiku]`
  - `docs/EDITOR.md` "Persistence contract" (`:200-224`): add a terse "Session restore (plan 034)"
    paragraph — keys `mostowo-editor-session:last` (`{mapId, activeTool?, activeLayerId?, activeTabId?}`,
    written by the store autosave) and `…:camera:<mapId>` (`CameraState`, written by `EditorScene` on
    gesture-settle, read in `buildScene`); restore-on-boot for ANY reload (reopens last map, applies
    camera + tool + validated layer + active-tab); per-map camera also restored on every manual open;
    a deliberate Close map clears the pointer; a `visibilitychange:hidden`/`pagehide` flush persists the
    `last` record before a discard. Add the `camera:<mapId>` key to the rename id-migration list
    (`:218-219`) and note delete clears it.
  - `docs/MOBILE-EDITOR-ACCESS.md`: one line tying session-restore to the phone workflow — a discarded/
    refreshed tab now resumes where you left off (pairs with the `EDITOR_NO_HMR` manual-refresh workflow).
  - Side effects: docs only; write-disjoint from all code steps.
  - Done when: both docs describe the slice; `markdownlint` (if wired) passes.

## Out of scope

- Reopening on-demand `object:<assetId>` tabs (active-tab-only decision).
- Restoring undo/redo history (not persisted; a reload starts a fresh history — unchanged).
- `document.wasDiscarded`-gated restore (decision: restore on any reload).
- Restoring session-scoped tool/layer/tab on a *manual* mid-session open of a different map (only the
  boot resume restores those; a manual open restores per-map camera only).
- Preventing the browser reload itself (no web API allows it).
- Any change to map data persistence / autocommit, or to the game runtime.

## Critique

> Recorded from the fresh-eyes review of the pre-revision draft. The revision above adopts #6
> (scene-owned camera — dissolves #1/#2) and #5 (storage split), and folds in #2/#3/#4/#8. Kept here
> for the execution context.

Verdict: Proceed, but resolve the camera-write timing race (High) and the three Medium
correctness/scope gaps before execution — the plan is well-researched and its seam-mirroring is
sound, but the debounced store-tuple autosave races the async scene build in ways that can corrupt
the very state it persists.

|#|Finding|Lens|Severity|Resolution|
|-|-------|----|--------|----------|
|1|Debounced autosave reads live camera via a bridge during the async `buildScene` window → can persist a default camera over the good saved value; corruption only shows on the *next* reload|gaps/race|High|RESOLVED — camera is now scene-owned (read in `buildScene`, written on settle); no store autosave path touches camera, so the race can't occur|
|2|On teardown `readCamera` is null → `{camera: readCamera?.()}` writes `camera: undefined`, wiping the save (possible on `pagehide`)|gaps|Medium|RESOLVED — no `readCamera` bridge; the scene writes real values synchronously on settle|
|3|Plan claimed `setActiveLayer` reconciles a dangling id — it doesn't (bare `set`); stale layer applied unguarded|correctness|Medium|FIXED — `restoreSession` validates the saved layer id against `map.layers` before `setActiveLayer`|
|4|Settle sites omitted pinch / two-finger gesture-end — the primary MOBILE zoom|gaps|Medium|FIXED — `persistCamera` also fires at the pinch gesture-end branch (~`EditorScene.ts:2103`)|
|5|Session-scoped tool/tab stored in the per-map record → opening B writes A's tool into B's record|consistency|Medium|RESOLVED — tool/layer/tab live on the single global `last` record (overwritten wholesale per open); only camera is per-map|
|6|Camera persistence could live entirely in `EditorScene`, dropping the bridge + nonce + the #1/#2 races|alternative|Medium|ADOPTED — see revision|
|7|`restoreSession().finally(() => unsub = …)` can leak one autosave subscription under StrictMode first-cleanup|consistency|Low|ACCEPTED — dev-only + idempotent, mirrors the existing palettes pattern; noted in Step 4|
|8|`flushSession` can only clear the debounce timer if it's module-scoped; template keeps it in-closure|executability|Low|FIXED — Step 3 specifies a module-scoped timer|
