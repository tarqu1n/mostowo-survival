# Code Smells — Cleanup Lens

Severity-ranked concrete smells found in `src/`. Tag `[fix]` = clear/mechanical;
`[log]` = contentious, needs a decision before touching. **Status** (recorded after the plan-043
pass): tag ≠ applied-state — several `[log]` structural splits were decided during planning/critique
and then executed in Phase 3, so the Tag cell also carries what actually landed (`✅ applied (Step N)`,
`◑ partial`, or `logged only`).

## High

|Severity|Smell|file:line|Tag|Note|
|---|---|---|---|---|
|High|`wireBus` twin on/off mirror: every subscription hand-repeated in an `off` block|`src/scenes/GameScene.ts:773-843`|[fix] ✅ applied (Step 14)|~26 pairs; drift risk. Table-drive one list, wire+SHUTDOWN-off from it. Done: one `subs` list drives both `on` + SHUTDOWN `off` (`GameScene.ts:806`).|
|High|Toggle/queue quartet: `isXQueued`/`toggleX` for harvest/refuel/deconstruct/rearm are near-identical, keyed only by kind+id field|`src/scenes/GameScene.ts:1244-1326`|[fix] ✅ applied (Step 14)|8 methods collapse to one predicate-driven pair. Done: `isOrderQueued`/`toggleOrder`/`orderTargetId` in `systems/orders.ts`.|
|High|Duplicated pan/zoom viewport: wheel-anchor + `pendingAnchor` re-anchor + pointer-pan logic copied between two components|`src/editor/panels/LibraryPanel.tsx:1367-1643` vs `src/editor/tabs/ObjectEditorTab.tsx:505-864`|[log] ✅ applied (Phase 2 + Steps 9–10)|Cross-file extraction into a shared hook; refactor scope is a judgment call. Decided + done: shared `hooks/usePanZoom`.|
|High|`editorStore.ts` god object (3662 lines): state + all actions + pure key helpers all in one module|`src/editor/store/editorStore.ts:1-3662`|[log] ✅ applied (Step 7)|Split by domain slice; large, contentious restructure. Decided + done: 3662→93 lines, 15 slices in `store/slices/`.|

## Medium

|Severity|Smell|file:line|Tag|Note|
|---|---|---|---|---|
|Medium|Twinned zoom consts + clamp: identical `1/8/0.5` + round-clamp under two names|`src/editor/panels/LibraryPanel.tsx:1358-1364` and `src/editor/tabs/ObjectEditorTab.tsx:438-444`|[fix] ✅ applied (Steps 9–10)|Hoist to one shared const set + `clampZoom`. Done: `ZOOM_MIN`/`ZOOM_STEP`/`clampZoom` in `editor/zoom.ts`.|
|Medium|Stray NUL byte (`\x00`) used as composite-key separator|`src/editor/store/editorStore.ts:971` (byte 61841)|[fix] ✅ applied (Step 7)|Invisible char; replace with a visible delimiter. Done: `store/shared.ts` builds the key with a visible pipe.|
|Medium|`EditorScene.ts` god object (2367 lines)|`src/editor/EditorScene.ts:1-2367`|[log] ✅ applied (Step 8)|Manager-extract further; large refactor. Decided + done: 2367→365 lines, controllers/renderers in `scene/`.|
|Medium|`GameScene.ts` god object (1965 lines) despite manager extraction|`src/scenes/GameScene.ts:1-1965`|[log] ◑ partial (Steps 11/14)|Task-queue + input-dispatch could move out. CombatController + order registry extracted (1965→1648); the task-loop spine is a deliberate keep (see STATUS).|
|Medium|`LibraryPanel.tsx` god component (1766 lines, multiple sub-pickers)|`src/editor/panels/LibraryPanel.tsx:1-1766`|[log] ✅ applied (Step 9)|Split `AtlasSheetPicker`/`AnimatedStripPicker`/`AssetReclassify` out. Decided + done: 1766→835 lines, `panels/library/`.|
|Medium|`ObjectEditorTab.tsx` god component (1129 lines)|`src/editor/tabs/ObjectEditorTab.tsx:1-1129`|[log] ✅ applied (Step 10)|`RegionsEditor` is a file's worth on its own. Decided + done: 1129→45 lines, `tabs/objectEditor/`.|

## Low

|Severity|Smell|file:line|Tag|Note|
|---|---|---|---|---|
|Low|Parked two-finger gesture behind `TWO_FINGER_GESTURE_ENABLED=false`; stranded gesture branch stays compiled|`src/editor/EditorScene.ts:72` (guard), `1766-1772` (dead branch)|[log] logged only|Known parked item — do not remove (out of scope).|
|Low|Parked portals: `PortalObject`s parsed-and-held, no transition consumer|`src/scenes/GameScene.ts:264-266`, `416-418`, `300`|[log] logged only|Known parked item (plan 019); out of scope.|
|Low|`assetSwatch.tsx` mixes module consts + pure helpers + leaf component|`src/editor/panels/assetSwatch.tsx:1-213`|[log] logged only|Cohesive today; splitting consts/helpers/component is a style call — left unsplit (open, carried past Step 16).|
|Low|Alpha-decode effect is an inline image-processing concern in a giant component|`src/editor/tabs/ObjectEditorTab.tsx:553-568`|[log] logged only|NOT duplicated (single occurrence in editor) — seed's "duplicated" framing was wrong. Extraction candidate only; not done.|
