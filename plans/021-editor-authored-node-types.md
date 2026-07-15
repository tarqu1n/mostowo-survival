# Editor-Authored Node Types (sprite variants, yield tiers & stumps)

> Status: planned — run /execute-plan to begin.

## Summary

Turn resource-node definitions from a compile-time TypeScript constant into **editor-authored,
persisted data**, and add a **Node Types authoring surface** to the dev-only Map Builder. In the
editor you can create / duplicate / delete node types, set their gameplay stats (HP, yield item &
amount, regrow, blocks-path), and manage a set of **skins** — interchangeable sprites picked from the
existing asset catalog. Each skin optionally carries a matching **depleted/stump sprite** shown while
the node is chopped-out, swapping back on regrow.

Three independent axes:
- **Tier (gameplay)** — different yields are different node *defs* (e.g. `tree` vs `treeLarge`). Created
  in-editor via a **Duplicate** action, so tiers are configurable by the user with no code.
- **Skin (aesthetics)** — one def carries N interchangeable sprites, same yield. Chosen per placed
  node, **weighted-random on placement with a picker/cycle override**, persisted on the map object.
- **State (runtime)** — live ↔ depleted(stump) ↔ regrow. Per-skin optional stump sprite; absent ⇒
  today's tint-to-`stumpColor` fallback. Never authored, never serialized on the map.

Old maps keep working with zero migration: absent `skin` ⇒ the def's first skin; the seeded
`tree`/`rock`/`berryBush` defs are byte-identical to today's.

## Context & decisions

Design settled with the `advisor` subagent over three rounds; user decisions captured via
AskUserQuestion.

**User decisions:**
- Configuration happens in an **editor UI**, not by editing data files (no code editing to add a
  tier or skin).
- Aesthetic skins: **weighted-random on placement, with manual override** (cycle/picker).
- Stumps: **per-model matching stumps** (each skin can carry its own depleted sprite).
- Tiers: **configurable by the user** — achieved via a Duplicate action on defs, not a hard-coded
  tier taxonomy.

**Architecture (advisor):**
- Node defs become authored data in a new **`nodes.json`** file alongside `world.json` (see
  `src/systems/mapRuntime.ts` for the sibling pattern). Read at boot, **eager-imported + fail-fast
  parsed** (defs are needed before any map loads). `src/data/nodes.ts` becomes a thin shim:
  `export const NODES = parseNodeDefs(nodesJson)` — so every existing importer
  (`ResourceNodeManager`, editor `LibraryPanel`, registry cross-checks) is untouched.
- **Skins reference the asset catalog** (`asset` id + optional `region` crop) exactly like
  `DecorObject` does (`src/systems/mapFormat.ts:144`), reusing the Library/region-picker machinery.
  The fixed `tiles.tree/rock/bush` manifest roles and `ResourceNodeDef.tile` are **retired**. The
  current `_derived/*.png` tree/rock/bush sprites stay as-is and are simply referenced as catalog
  assets — no re-extraction.
- **Tier stays a separate def** (not per-skin yield): every gameplay read keys off `tree.def.*`
  (`ResourceNodeManager.chop()` yield at ~`:152`, tasks, tooltips, future drops). A **Duplicate**
  action makes creating a tier cheap without splitting the source of truth.
- Sizing (`tilesTall`/`originX`/`originY`) moves off the gameplay identity into **def-level defaults
  with optional per-skin overrides** (skins from different sheets have different canvas padding).
  `standOffsets` **stays** on the def — it's gameplay (worker stand-tile adjacency, consumed at
  `src/scenes/GameScene.ts:713`), not art.
- Validation that was compile-time (`data.test.ts`: `yieldItemId ∈ ITEMS`) moves into
  **`parseNodeDefs`** (one source of truth), which is BOTH the boot-time fail-fast parser AND the
  editor form validator. Cross-file checks (map `ref` ∈ defs, `NodeObject.skin` ∈ def's skins, delete
  guard) live at the registry / world-integrity level where `ref` checking already lives (see the
  comment at `src/systems/mapFormat.ts:100`). `ITEMS` stays compile-time and importable.

**Files/patterns to mirror:**
- Runtime load pattern: `src/systems/mapRuntime.ts`.
- Pure parse/validate module pattern: `src/systems/mapFormat.ts` (`parseMap`), tested in
  `src/systems/__tests__/mapFormat.test.ts`.
- Per-instance authored art precedent: `DecorObject` (`asset`/`region`) in `mapFormat.ts:144`,
  rendered/edited via the catalog (`src/editor/catalog.ts` — `CatalogAsset`/`CatalogRegion`),
  scanned by `scripts/asset-catalog.mjs` (`npm run assets:catalog`).
- Editor per-instance inspector: `src/editor/panels/InspectorPanel.tsx` (`NodeFields` ~`:277`,
  `DecorFields`/`PortalFields` as control precedents; `updateNode` store action).
- Editor panels + Library picker: `src/editor/panels/LibraryPanel.tsx` (node palette is already
  `NODES`-driven, so it refreshes for free once the registry is authored).
- Shortcuts: `src/editor/shortcuts.ts` (docs-only `SHORTCUT_GROUPS`; **must** be kept in sync per
  its header rule and the project memory note); real key handling in `src/editor/EditorApp.tsx`
  (~`:56`) and `src/editor/EditorScene.ts`.
- Texture enumeration seam: `src/systems/mapFormat.ts:764` (`collectTextureSources` — decor asset
  refs already flow through it; node-skin assets get unioned in here).
- Sizing/render duplication to keep in lockstep: `ResourceNodeManager` (`addNode` ~`:95`,
  `nodeScale` ~`:116`, `chop` ~`:149`) AND `src/editor/EditorScene.ts` `placeNodeSprite` (~`:576`).
  `TreeNode` record type: `src/entities/types.ts:14`.

**No stated conflict with project direction** (CLAUDE.md / GAME-DESIGN.md): this deepens the
data-driven, editor-authored content pipeline the project already commits to.

**Guardrail (org policy):** editor writes only to local authored JSON in the repo; no live/prod
systems, no secrets. Standard local dev change.

## Steps

### Phase 1 — Registry extraction (zero behaviour change; independently shippable)

- [x] **Step 1: `AuthoredNodeDef` schema + `parseNodeDefs` validator** `[inline]`
  - Outcome: added pure `src/systems/nodeDefs.ts` (authored types `NodeSkinDef`/`AuthoredNodeDef`/`NodeDefsFile` + `parseNodeDefs`) and `src/systems/__tests__/nodeDefs.test.ts` (20 tests: valid file + every rejection case). `ResourceNodeDef`/`types.ts` unchanged. Deviations from plan text, both benign: (1) return type is `Record<string, ParsedNodeDef>` where `ParsedNodeDef extends ResourceNodeDef` adds normalised `skins: NormalizedNodeSkinDef[]` — assignable everywhere `ResourceNodeDef` is expected, but gives skins/weight-defaulting a concrete home (nothing in `ResourceNodeDef` has `skins` yet); later steps consuming skins will key off `ParsedNodeDef`. (2) Strict unknown-key rejection is genuinely implemented via an `expectNoExtraKeys` helper — note `parseMap` does NOT actually reject unknown keys today despite being cited as the "strict" model. Transitional `tile` passed through, `@deprecated transitional — removed in step 6`. Critique #5 folded in: `weight` defaults to 1, validated `>0` when present. tsc clean; full suite 547/547.
  - New pure module `src/systems/nodeDefs.ts` (no Phaser imports), mirroring `parseMap` in
    `src/systems/mapFormat.ts`. Define:
    - `NodeSkinDef { id: string; asset: string; region?: DecorRegion; depleted?: { asset: string; region?: DecorRegion }; weight?: number; tilesTall?: number; originX?: number; originY?: number }`
    - `AuthoredNodeDef { id; name; maxHp; yieldItemId; yieldPerHit; regrowMs; blocksPath; harvestAnim?; color; stumpColor; tile; tilesTall; originX; originY; standOffsets?; skins: NodeSkinDef[] }`
      - **`tile: 'tree' | 'rock' | 'bush'` is a TRANSITIONAL field** — it exists only so the objects
        `parseNodeDefs` returns still satisfy `ResourceNodeDef.tile` (required at `src/data/types.ts:80`,
        read by `EditorScene.placeNodeSprite`/preload at `EditorScene.ts:366,584` via
        `ACTIVE_TILESET.tiles[def.tile]`) while the render path is still manifest-role-based. It is
        **retired in Step 6** alongside the manifest roles, once every render path resolves skins→catalog.
        Marked `@deprecated`/`// transitional — removed in step 6` in the type.
    - `NodeDefsFile { version: 1; defs: AuthoredNodeDef[] }`
    - Reuse `DecorRegion` from `mapFormat.ts` (import the type). `harvestAnim` union matches
      today's `ResourceNodeDef` (`'chop' | 'gather'`; keep exactly what exists — check
      `src/data/types.ts`).
  - `parseNodeDefs(raw): Record<string, ResourceNodeDef>` validates and throws on: bad shape,
    duplicate def ids, key≠id, empty `skins`, duplicate skin ids within a def, non-positive
    `weight`, out-of-range numerics, **`yieldItemId ∉ ITEMS`** (import `ITEMS` from `src/data`).
    It injects the inert `armour: 0, speed: 0` fields, **passes the transitional `tile` through onto
    the returned object** (validated against `'tree' | 'rock' | 'bush'` while it exists), and maps
    `skins`/sizing appropriately so the returned objects satisfy existing `ResourceNodeDef` consumers
    unchanged through Phases 1–2. Export both `parseNodeDefs` and the raw authored types.
  - Decision pre-answers: if `version !== 1`, throw (no migration path yet). Unknown extra keys —
    reject (strict, like `parseMap`).
  - Side effects: `ResourceNodeDef` in `src/data/types.ts` keeps its current shape unchanged this
    step — including required `tile`/`tilesTall`/`originX`/`originY` — so nothing downstream breaks.
    Because `tile` is required and read at `EditorScene.ts:366,584` until Step 6, `parseNodeDefs`
    MUST populate it from the authored `tile`; the transitional field is the bridge that keeps
    Phase 1 rendering + typechecking with zero visual change. Step 6 retires `tile` from both the
    authored schema and `ResourceNodeDef`; Step 3 wires per-skin sizing.
  - Docs: none yet (Phase 3 docs pass covers file format).
  - Done when: `nodeDefs.ts` compiles; unit tests (add to a new `src/systems/__tests__/nodeDefs.test.ts`)
    cover a valid file + each rejection case; `npx tsc --noEmit` clean.

- [x] **Step 2: Seed `nodes.json` + make `nodes.ts` a shim; repoint data test** `[inline]`
  - Outcome: created `src/data/maps/nodes.json` (`version:1`, defs tree/rock/berryBush transcribed verbatim, each a single skin `id:"default"` pointing at the REAL catalog ids `pixel-crawler/_derived/{tree_pine,rock,bush}.png` — so Step 3's catalog check is already satisfied). `color`/`stumpColor` written as decimals (JSON has no hex): tree 3104052/5914408, rock 9079434/5921370, berryBush 4156724/4872762. Rewrote `src/data/nodes.ts` to the 2-line shim `export const NODES = parseNodeDefs(nodesJson)`; removed now-unused `TREE_BASE_STAND_OFFSETS` (values inlined into JSON). `data.test.ts` NODES block unchanged (already asserts against parsed data via the shim; added a clarifying comment only). All 6 `NODES` importers (testApi, GameScene, ResourceNodeManager, stats.test, EditorScene, LibraryPanel) untouched. Boot parity asserted via a throwaway toEqual test (parsed defs === old constants, field-for-field) — value-equal, not a live render. tsc clean; full suite 547/547.
  - Create `nodes.json` in the same directory as `world.json` (confirm path via
    `src/systems/mapRuntime.ts`; likely `src/data/maps/`). Author `version: 1` with `tree`, `rock`,
    `berryBush` transcribed **verbatim** from today's `src/data/nodes.ts` (same ids, stats,
    `standOffsets`, colors, **and the transitional `tile` role** — `'tree'`/`'rock'`/`'bush'`
    respectively). Each seeded def gets a single skin (`skins[0]`) whose `asset` points at
    the current sprite (see Step 3 for catalog wiring — for this step a placeholder skin referencing
    the existing `_derived` path is acceptable if the catalog isn't yet updated; otherwise fold
    Step 3's catalog check in here).
  - Rewrite `src/data/nodes.ts` to: `import nodesJson from '<path>/nodes.json'` +
    `export const NODES = parseNodeDefs(nodesJson)`. Keep `TREE_BASE_STAND_OFFSETS` if still
    referenced, or inline its values into the JSON.
  - Repoint `src/data/__tests__/data.test.ts` NODES block to assert against the parsed committed
    JSON (cross-refs still hold: key===id, `yieldItemId ∈ ITEMS`, positive numerics).
  - Side effects: **every** `NODES` importer must still typecheck unchanged (`ResourceNodeManager`,
    `LibraryPanel`, `EditorScene`, registry). Verify the game boots and renders identically.
  - Docs: none yet.
  - Done when: `npm test` green; game boots; trees/rocks/bushes render exactly as before; `NODES`
    importers untouched.

### Phase 2 — Skin model + runtime read path (zero visual change; independently shippable)

- [x] **Step 3: Wire skins to the asset catalog + seed skin sprites** `[inline]`
  - Outcome: verify-only for the catalog (critique #4 confirmed) — all three node sprites are present as `type:'object'` catalog assets with correct dims (`pixel-crawler/_derived/tree_pine.png` 37×76, `rock.png` 26×27, `bush.png` 28×24), and `CatalogAsset` in `src/editor/catalog.ts` already covers their shape. Seed skins already reference these ids (done in Step 2), so no `nodes.json` change and no re-extraction. No per-skin sizing overrides needed (sizing stays def-level). Code change: added `expectNonEmptyString` in `src/systems/nodeDefs.ts` and applied it to skin `asset` + `depleted.asset` (were plain `expectString`, permitting `""`); added 2 rejection tests (nodeDefs suite now 22). tsc clean; data test 23/23; nodeDefs 22/22.
  - Ensure `scripts/asset-catalog.mjs` includes the pack `_derived/` PNGs (tree/rock/bush) in the
    catalog scan; if absent, add them and re-run `npm run assets:catalog` to regenerate
    `public/assets/asset-catalog.json`. Verify `src/editor/catalog.ts` types cover them.
  - Update `nodes.json` seed skins so each def's `skins[0].asset` is the catalog id for its current
    `_derived` sprite (byte-identical visuals; NO re-extraction). Add per-skin sizing overrides only
    where needed.
  - Side effects: `parseNodeDefs` should (optionally, DEV-only) sanity-check that skin `asset` ids
    are non-empty strings; full catalog-existence cross-check belongs in the world-integrity test
    (Step 6) since the catalog isn't importable into the pure parser cheaply.
  - Docs: note in ASSETS.md deferred to Step 10 doc pass.
  - Done when: catalog contains the node sprites; `nodes.json` skins reference catalog ids; parse
    passes.

- [x] **Step 4: `NodeObject.skin` field — format + round-trip tests** `[delegate sonnet]`
  - Outcome: added optional `skin?: string` as the LAST field of `NodeObject` in `src/systems/mapFormat.ts`; node branch of `parseMapObject` reads it via `expectString` only when present and spreads it last (`...(skin !== undefined ? { skin } : {})`) — omit-when-absent, so legacy maps round-trip byte-identical. No non-empty guard (matches decor `asset` precedent; out of scope). Added a `node.skin (plan 021 step 4)` describe block in `mapFormat.test.ts`: legacy-no-skin byte-identical round-trip (asserts no `skin` key) + skinned-node survives parse→serialize→parse; also added `skin?` to the test's `RawObjectFixture`. No runtime consumer yet (Step 5). tsc clean; mapFormat 52 tests; full suite 551.
  - In `src/systems/mapFormat.ts`: add optional `skin?: string` to `NodeObject` (~`:97`). In the
    node branch of `parseMapObject` (~`:517`) parse it when present; **omit when absent** on
    serialize (follow the `DecorAnim`/`region` omit-when-absent discipline at ~`:530`) so legacy maps
    round-trip byte-identical. `serializeMap` is generic `JSON.stringify` — interface change is
    enough.
  - In `src/systems/__tests__/mapFormat.test.ts`: extend the fixture with (a) a legacy node (no
    `skin`) asserting byte-identical round-trip, and (b) a skinned node asserting `skin` survives
    round-trip.
  - Side effects: none at runtime yet (Step 5 consumes it).
  - Done when: both round-trip tests pass; `npm test` green.

- [x] **Step 5: Runtime skin + depleted-state rendering in `ResourceNodeManager`** `[inline]`
  - Outcome: `ResourceNodeManager` now renders nodes from their chosen skin via the shared decor resolver (zero visual change — seed skins resolve to the same `img--derived-*` texture key the retired manifest roles preload, so nothing re-loads). Changes: `addNode(def: ParsedNodeDef, col, row, skinId?)` resolves the skin (`resolveSkin`: id→match else `skins[0]`) and textures/sizes the sprite via new `applySkinAppearance` (+ `resolveSkinTexture` → `resolveDecorDraw`, + transitional `manifestFallbackTexture(def.tile)` for a non-resident asset, removed in step 6); `loadNodes` threads `obj.skin` through. `chop` deplete branch swaps to the skin's `depleted` sprite when present, else keeps today's `setScale(base).setTint(stumpColor)`; regrow calls `applySkinAppearance(...,'live')` + `clearTint()` uniformly. `nodeScale` gained an optional 3rd `skin?: {tilesTall?}` override arg — kept `def: ResourceNodeDef` so the `TaskGlowRenderer` deps seam (def-typed) is untouched. `TreeNode` gained `skin: string` and its `def` widened to `ParsedNodeDef` (`entities/types.ts`). `render/decorSprites.ts`: generalised `resolveDecorDraw`'s param from `DecorObject` to a new structural `DrawableRef {id,asset,region?,anim?}` (DecorObject still assignable — DecorManager/EditorScene/PreloadScene/tests untouched) so nodes reuse the region-subframe + drift-guard logic instead of duplicating it. `testApi` `addNode` Deps sig → `ParsedNodeDef`. Frame type widened to `string|number` (region names vs manifest indices). Verified: tsc clean (only pre-existing errors in Matt's WIP `NewMapDialog.tsx`, untouched); full unit suite 551/551; e2e chop/mine/glow/queue/inspect/refactor-tripwire 8/8 green (real browser — spawn/chop/deplete/regrow, tall-node hit-testing, glow radius, golden snapshot). **Not exercised: the `depleted`-sprite swap path — no seed skin carries a `depleted` yet (Step 10 content); only the tint fallback runs today. PreloadScene + editor render deliberately untouched (Step 6).**
  - `addNode(def, col, row, skinId?)`: resolve the skin (given id → that skin; absent/unknown →
    `skins[0]`), resolve its `asset`/`region` to a texture (mirror how decor resolves catalog
    asset+region to a texture key/frame — find the decor render path in
    `src/editor/EditorScene.ts`/game scene and reuse it). Apply per-skin sizing override falling
    back to def sizing in `nodeScale` (~`:116`). Store the resolved skin id on the `TreeNode` record
    (`src/entities/types.ts:14` — add `skin: string`).
  - `loadNodes` passes `obj.skin` through to `addNode`.
  - `chop` deplete branch (~`:149`): if the node's skin has a `depleted` sprite, `setTexture(...)` to
    it, `setOrigin`/rescale from the depleted appearance (its own `tilesTall`/origin or def default);
    else keep today's `setScale(base).setTint(stumpColor)` fallback. On regrow, restore the live
    sprite/scale/origin and `clearTint()`.
  - Side effects: `hasBlockingNode`/adjacency already filter on `alive` — a stump stays
    non-blocking/unclickable; verify no regression. Hit-testing (`pickSpriteAt`) follows new dims
    automatically.
  - Docs: mechanics numbers deferred to Step 10 (GAME-MECHANICS.md).
  - Done when: placing a node with a `skin` renders that skin; chopping a node with a depleted skin
    shows the stump then regrows to the live sprite; a skin without `depleted` shows the old tint;
    scenario/boot tests green.

- [x] **Step 6: Retire manifest node roles; extend texture enumeration; editor render parity** `[inline]`
  - Outcome: retired the transitional `tile` end-to-end — every render path now resolves skin→catalog. Removed `tiles.tree/rock/bush` from `src/data/tileset.ts` (interface + `PIXEL_CRAWLER_TILESET`), `ResourceNodeDef.tile` from `src/data/types.ts`, the transitional `tile` from `AuthoredNodeDef` + all its `parseNodeDefs` validation (`nodeDefs.ts`), and the `tile` key from all three defs in `src/data/maps/nodes.json`. **Deviation (necessary):** the rock's `'mine'` swing was previously inferred from `tile === 'rock'`; with `tile` gone, `harvestAnim` gained `'mine'` (`'chop' | 'gather' | 'mine'` in both `types.ts` and `nodeDefs.ts`), rock authored as `"harvestAnim": "mine"` in nodes.json, and `GameScene.ts:855` simplified to `tree.def.harvestAnim ?? 'chop'`. `ResourceNodeManager` dropped `manifestFallbackTexture`/`ACTIVE_TILESET`/`resolveTile` — `applySkinAppearance` now resolves skin→catalog only (DEV-warns + leaves texture if unresolved) and `addNode` seeds `add.image` with the resolved key or Phaser's `'__WHITE'`. `PreloadScene` deleted the 3-role node preload; `queueMapTextures` now unions each def's live+depleted skin assets — **PROD loads only map-referenced defs (plan-aligned); DEV loads EVERY def** (`import.meta.env.DEV`, dead-code-eliminated in prod) because the `__test` API + dev-menu randomiser place arbitrary defs at runtime and `test.map.json` has 0 nodes (this closed the real regression: runtime-added nodes had no resident texture → fell back to a 1×1 `__WHITE`, breaking alpha hit-testing). `EditorScene.queueTextures` + `placeNodeSprite` resolve skin→catalog via the shared `resolveDecorDraw` (marker fallback on unresolved), matching the game exactly. `LibraryPanel.nodePreviewUrl` now uses `def.skins[0].asset` (typed `ParsedNodeDef`). World-integrity test (`src/data/maps/__tests__/world.test.ts`) gained 2 checks: every placed node `ref` ∈ NODES + any authored `skin` ∈ that def's skins; every def skin (live+depleted) `asset` ∈ committed `asset-catalog.json`. `nodeDefs.test.ts`: dropped the tile fixture/field + bad-tile test, added `'mine'`-accepted + `tile`-now-a-strict-unknown-key tests, fixed the harvestAnim message. Grep clean of `def.tile`/`tiles.{tree,rock,bush}`. tsc clean, lint 0 errors (90 pre-existing `any` warnings in test files), full unit suite **582/582**, node e2e (chop/mine/inspect/glow/queue/refactor-tripwire) green. **Not fixed (out of scope, pre-existing):** `menu-start.spec.ts:38` hardcodes spawn `(22,40)` but committed `SPAWN_TILE=(21,33)` since plan 018 — stale test in Matt's active map/spawn area, flagged not touched. **Editor render parity is by-construction** (identical `resolveDecorDraw` + scale/origin as the game); not visually eyeballed this session — worth a quick `npm run editor` look.
  - Remove `tiles.tree/rock/bush` from `src/data/tileset.ts` (~`:128–138`, `:219`),
    `ResourceNodeDef.tile` from `src/data/types.ts`, the transitional `tile` from `AuthoredNodeDef`
    (with its `parseNodeDefs` validation), and the `tile` role from the seeded `nodes.json` (and any
    remaining references). After this step no def carries a `tile` — every render path resolves
    skin→catalog.
  - `PreloadScene`: delete the fixed 3-role node preload branch. Extend `collectTextureSources`
    (`src/systems/mapFormat.ts:764`) — or the preload's texture enumeration — to **union the catalog
    assets of every skin (live + depleted) of every def referenced by the loaded map**, so those
    textures load. Reuse the decor-asset enumeration already flowing through that seam.
  - `EditorScene.placeNodeSprite` (~`:576`): update to resolve skin→catalog asset the same way as
    Step 5 (keep editor preview == game render). Fall back to the existing `NODE_MARKER` on
    unresolved asset.
  - Add/extend the **world-integrity test** (the one added in plan 014 step 11 — grep for it): assert
    every map `NodeObject.ref` ∈ defs, every `NodeObject.skin` (when present) ∈ that def's skin ids,
    and every skin `asset`/`depleted.asset` exists in the committed asset catalog.
  - Side effects: anything else reading `def.tile` or `ACTIVE_TILESET.tiles.tree/rock/bush` must be
    updated — grep both. `ground`/`wall` roles are untouched.
  - Docs: ASSETS.md derived-file/manifest section — deferred to Step 10 doc pass, but note here that
    node art no longer flows through `tiles` roles.
  - Done when: game + editor render nodes identically to before via the catalog path;
    world-integrity + data tests green; no lingering `def.tile`/`tiles.tree` references
    (`grep` clean).

### Phase 3 — Authoring UI (independently shippable)

- [x] **Step 7: Node-defs registry state + persistence in the editor store** `[inline]`
  - Outcome: `editorStore.ts` now holds editable `nodeDefs: AuthoredNodeDef[]` (seeded from bundled `nodes.json`) + derived `nodeDefsParsed: Record<string,ParsedNodeDef>` (recomputed every commit) + `nodeDefsDirty`/`nodeDefsRevision` (mirror world's). Actions: `setNodeDefs`/`markNodeDefsSaved`, `createNodeDef`, `duplicateNodeDef(id)`, `updateNodeDef(id,patch)`, `deleteNodeDef(id)` (guarded), skin sub-actions `addSkin`/`updateSkin`/`removeSkin`/`moveSkin`. Every mutation validates via private `tryParseNodeDefs` = `parseNodeDefs({version:1,defs:candidate})` in try/catch — on throw it `toast.error`s the message and leaves state untouched (not wired to undo/history — nodes.json is its own file like world.json). **Delete/removeSkin guard limitation (allowed by brief):** only scans the *currently open* map's `kind:'node'` refs, not every committed map on disk — a def referenced only by a closed map could be deleted here, caught later by `world.test.ts`. `removeSkin` last-skin case needs no extra check (parseNodeDefs refuses empty `skins`). Persistence: net-new `GET/PUT /__editor/nodes` in `vite-editor-api.mjs` (reads/writes `src/data/maps/nodes.json`, **no** `regenerateManifest`; docstring updated) + `getNodes`/`putNodes` in `src/editor/api.ts` (mirror `getWorld`/`putWorld`); live-verified byte-identical round-trip, manifest untouched. **Side effect done (not deferred):** `LibraryPanel.tsx` + `EditorScene.ts` switched off boot-time `NODES` onto `useEditorStore(...).nodeDefsParsed`; new `src/editor/nodeDefsSource.ts` (`loadNodeDefs`, mirrors `catalogSource.ts`) wired into Library mount effect — authored defs appear without reload. New test `src/editor/store/__tests__/editorStoreNodeDefs.test.ts` (21 tests). tsc clean (incl. NewMapDialog.tsx), full suite 609/609, eslint 0 errors on touched files. docs/EDITOR.md NOT touched (Step 9). Files: `editorStore.ts`, `api.ts`, `vite-editor-api.mjs`, `EditorScene.ts`, `LibraryPanel.tsx`; new `nodeDefsSource.ts`, `editorStoreNodeDefs.test.ts`.
  - In `src/editor/store/editorStore.ts`: load node defs into editable store state (raw
    `AuthoredNodeDef[]`, not the parsed `ResourceNodeDef` map). Actions: `createNodeDef`,
    `duplicateNodeDef(id)` (deep-copy + fresh id/name), `updateNodeDef(id, patch)`,
    `deleteNodeDef(id)` **guarded** — refuse if any map still references it (reuse the world-integrity
    cross-ref), plus skin sub-actions (`addSkin`/`updateSkin`/`removeSkin`/reorder). Every mutation
    runs through `parseNodeDefs` (or a field-level equivalent) and refuses to commit invalid state.
  - **Persistence — net-new endpoint, not reuse.** There is no generic editor write channel:
    `world.json` and each `*.map.json` have their own bespoke, path-sanitized handlers in
    `scripts/vite-editor-api.mjs` (`GET/PUT /__editor/world`, `/__editor/maps/:id`). So:
    - Add a **`GET /__editor/nodes` + `PUT /__editor/nodes`** pair to `scripts/vite-editor-api.mjs`,
      mirroring the `/__editor/world` handler at `vite-editor-api.mjs:336–346` (read from / write body
      to `src/data/maps/nodes.json`, same JSON content-type + error handling). No manifest regen is
      needed (`nodes.json` isn't a map placement) — do NOT copy the `regenManifest` call. Keep the
      handler docstring's endpoint list (`vite-editor-api.mjs:8–15`) in sync.
    - Add editor-side `getNodes`/`putNodes` helpers to `src/editor/api.ts`, mirroring `getWorld`/
      `putWorld` (`api.ts:47–61`) against the new `/nodes` endpoint.
    Follow the documented persistence contract in docs/EDITOR.md and add `nodes.json` to it (the
    doc pass is Step 9).
  - Side effects: the runtime `NODES` map is derived from committed JSON at boot; in-editor the store
    is the live source. Ensure the palette + placement read from the store's parsed view so newly
    authored defs appear without reload.
  - Docs: deferred to Step 9/10 doc pass.
  - Done when: create/duplicate/delete/update node defs mutates store + writes `nodes.json`; delete
    guard blocks referenced defs; invalid edits are refused; round-trips through save/reload.

- [x] **Step 8: "Node Types" authoring panel (stats form + skin manager)** `[inline]`
  - Outcome: added a **central-pane tab** (not a sidebar panel — needs the real estate; mirrors `WorldViewTab`, permanent + non-closable, mounted-but-hidden via `invisible`): new `{id:'nodeTypes',kind:'nodeTypes'}` in the `EditorTab` union + initial `tabs` + `closeTab` guard (`editorStore.ts`), label/panel wiring in `EditorApp.tsx`. New `src/editor/tabs/NodeTypesTab.tsx` = def list (create/duplicate/delete, delete disabled+tooltip when referenced) + batched-draft stats form (name, HP, yield item dropdown from `ITEMS`, yield/hit, regrow, blocks-path, harvestAnim, color/stumpColor via hex↔decimal) with inline validation + gated "Save changes"; + skin manager (add/remove/reorder, live + optional depleted picker, weight, optional per-skin `tilesTall`/`originX`/`originY` overrides, `skins[0]` badged "Default"). New `src/editor/NodeSpritePickerDialog.tsx` = self-contained catalog picker (search→thumbnail grid→region-hotspot drill-in) producing `{asset,region?}` like `DecorObject` (reuses catalog data + `CatalogRegion`, no decor regression). New pure `src/editor/nodeTypesUi.ts` = `colorToHex`/`hexToColor`, `validateNodeDefPatch` (single choke point wrapping `parseNodeDefs` — no second validation source), `resolveSkinPreviewUrl`. **Two real bugs found+fixed while driving the browser:** (1) LibraryPanel crashed the whole editor on any def with an unresolved skin asset (fresh defs default to a placeholder) — `nodePreviewUrl` now delegates to `resolveSkinPreviewUrl` which never throws, tinted `?` fallback; (2) delete-guard `referencedDefIds` was memoized on `[map]` but `map` mutates in place, so the guard never recomputed after first placement — rekeyed on `docRevision`/`mapEpoch`. Palette side-effect verified: new/duplicated defs appear live without reload. Tests: new `src/editor/__tests__/nodeTypesUi.test.ts`, `libraryNodePreview.test.ts`, + `nodeTypes` block in `editorTabs.test.ts` (13 new). tsc clean, eslint 0 errors on touched files, full suite **625/625**. Full Playwright drive against real vite dev server: create→validation-error→duplicate→2nd skin→pick live+depleted→save (`PUT /__editor/nodes`)→reload persisted→appears in palette; place a node→its def delete disabled w/ tooltip while unplaced def stays deletable. `nodes.json` restored to committed 3-seed after test-saves (verified no diff). Files: `editorStore.ts`, `EditorApp.tsx`, `LibraryPanel.tsx`; new `NodeTypesTab.tsx`, `NodeSpritePickerDialog.tsx`, `nodeTypesUi.ts`, 2 test files + editorTabs.test.ts additions.
  - New editor panel/tab (mirror the structure of existing panels in `src/editor/panels/`). List all
    defs with create / **duplicate** / delete buttons (delete disabled w/ reason when referenced).
    Selecting a def opens a stats form (name, HP, yield item [dropdown from `ITEMS`], yield/hit,
    regrow, blocks-path, harvestAnim, colors) whose validation is derived from `parseNodeDefs` — show
    field errors, block save on invalid.
  - **Skin manager**: list skins for the def; add/remove/reorder; per-skin pick a **live** sprite and
    an optional **depleted** sprite by reusing the Library/region-picker machinery (thumbnails +
    `CatalogRegion` crop) that decor already uses; per-skin weight + optional sizing overrides.
    Make `skins[0]` visibly "the default".
  - Side effects: `LibraryPanel` node palette is already `NODES`-driven — confirm it reflects the
    live store registry (may need to point it at the store's parsed defs rather than the boot-time
    `NODES`).
  - Docs: deferred to Step 9 doc pass.
  - Done when: a user can build a new node type with multiple skins (live + stump) end-to-end in the
    UI, save, reload, and see it in the palette.

- [x] **Step 9: Placement skin roll + inspector override + cycle shortcut + docs** `[inline]`
  - Outcome: `placeNode` now rolls a **weighted-random** skin via `pickWeighted(def.skins)` and persists it on `NodeObject.skin` — but **omit-when-default**: only written when the roll ≠ `skins[0]`, so single-skin seeds (tree/rock/bush) place byte-identical to today and maps don't carry a redundant `skin:"default"` on every node (deviation from the plan's "always persist", justified inline in the comment). Inspector `NodeFields` (`InspectorPanel.tsx`) gained a **Skin `<Select>`** (mirrors `PortalFields`' facing select; subscribes to `nodeDefsParsed[obj.ref]`; shown only when the def has ≥2 skins; value falls back to `skins[0].id`; `skins[0]` labelled "(default)") wired to `updateNode({skin})`. `updateNode`'s patch type widened to `'col'|'row'|'skin'` and its undo `prev` now captures `skin`. New store action `cycleNodeSkin(id)` (interface + impl) advances the selected node's skin through `def.skins` (wraps; no-op for <2 skins; routes through `updateNode` so it's one undoable command). New **`S`** shortcut in `EditorApp.tsx` keydown (plain 's', map tab, single node selected — mirrors the `U` handler + input guard) calls it; added to `shortcuts.ts` "Selection & objects" group. `pickWeighted` value-imported into the store. Docs: **docs/EDITOR.md** gained a "Node Types (authored resource nodes)" section (panel + tier/skin/state axes + random-roll/inspector-override/`S`-cycle), a Node-defs entry in the file-formats list (`nodes.json` → `parseNodeDefs`), and a persistence-contract note on the `GET/PUT /__editor/nodes` handler. Tests: new "node skins (plan 021 step 9)" describe in `editorStoreObjects.test.ts` (5 tests — omit-default placement, varied roll over 80 placements, updateNode override+undo, cycle advance/wrap, single-skin no-op; resets the singleton `nodeDefs` to seed per test). tsc clean, eslint 0 on touched files, full unit suite **630/630** (+5). Editor boots clean in a real browser (Playwright: Node Types tab present, seed tree listed, 0 console errors); the deeper UI interaction is covered by the deterministic store tests + verbatim-mirrored UI patterns. **Not exercised in-browser this session:** placing many nodes to *see* varied skins (seed defs are single-skin — that's Step 10 content) and the live inspector-picker/`S`-cycle drive (logic unit-tested). Files: `editorStore.ts`, `EditorApp.tsx`, `InspectorPanel.tsx`, `shortcuts.ts`, `editorStoreObjects.test.ts`, `docs/EDITOR.md`.
  - Placement: when placing a node, roll a **weighted-random** skin (reuse `pickWeighted` from
    `tileset.ts:543`) and persist it on the `NodeObject.skin`. `placeNode` in the store (~`:1635`)
    gains the rolled skin.
  - Inspector: extend `NodeFields` in `src/editor/panels/InspectorPanel.tsx` (~`:277`) with a **skin
    picker** (a `<Select>` like `PortalFields`, options = the def's skins) that overrides the placed
    node's skin; widen the `updateNode` patch type to include `skin`.
  - Shortcut: add a **cycle-skin** key (acts on the selected node) in `src/editor/EditorApp.tsx`
    keydown (~`:56`, guard against typing in inputs) calling a store action. **Update
    `src/editor/shortcuts.ts` `SHORTCUT_GROUPS`** with the new entry (per the file's maintenance rule
    and the project memory note about keeping the in-app Shortcuts panel synced).
  - Docs: update **docs/EDITOR.md** — the new Node Types panel, skin picking (random + override +
    cycle shortcut), the `nodes.json` file in the map/world file-format section, and the persistence
    contract. Keep it terse/high-signal.
  - Side effects: `EditorApp` keydown already gates on active tab — ensure cycle-skin only fires with
    a node selected on the map tab.
  - Done when: placing many trees yields varied skins; selecting one lets you override via inspector
    and cycle via shortcut; the choice persists; docs/EDITOR.md + shortcuts panel reflect it.

### Phase 4 — Content (pure editor usage; doubles as acceptance test)

- [ ] **Step 10: Author tree tiers + aesthetic skins from the pack; docs pass** `[inline]`
  - Using the new UI: add aesthetic skins to `tree` from the pack tree sheets (Model_01/02/03 across
    sizes under `public/assets/tilesets/pixel-crawler/Environment/Props/Static/Trees/`), each with a
    matching stump/depleted sprite (per-model). Create one or more **yield tiers** via Duplicate
    (e.g. a large tree worth more wood) with its own skin set. Sprites are pulled via catalog
    region-crops — no `extract.py` runs needed; if any sheet needs splitting (e.g.
    `Model_03/Size_04-export.png` colour variants touch at the canopy, per ASSETS.md:276) note the
    `regions` override.
  - Tuning numbers (tier HP/yields, skin weights) recorded in **docs/GAME-MECHANICS.md**.
  - Docs: update **docs/ASSETS.md** — node art now flows through the asset catalog (not the
    `_derived`+manifest roles); document the new tree skins/tiers wiring and that the catalog scan
    covers `_derived/`.
  - Side effects: this commits a populated `nodes.json` — the world-integrity + data tests now guard
    real content.
  - Done when: a forest placed in the editor shows varied tree skins, chopping shows matching stumps,
    the large tier yields more wood in-game; GAME-MECHANICS.md + ASSETS.md updated; all tests green.

## Critique

Fresh-eyes review verdict: solid, well-sequenced, roadmap-aligned; two under-specified mechanics
**now resolved inline** (transitional `tile` handling; the net-new `nodes.json` endpoint). Three
low findings remain — fold in during the relevant step:

|#|Finding|Severity|Status|
|-|-------|--------|------|
|1|Phase 1/2 need a transitional source for the required `ResourceNodeDef.tile` that `AuthoredNodeDef` lacked.|Medium|**Resolved** — transitional `tile` field on the authored schema, passed through by `parseNodeDefs`, retired in Step 6.|
|2|Step 7 assumed a generic editor write channel; none exists (`world.json`/`*.map.json` have bespoke handlers).|Medium|**Resolved** — Step 7 now adds an explicit `GET/PUT /__editor/nodes` endpoint + `getNodes`/`putNodes`.|
|3|Node `ref`/`skin` cross-check is net-new in Step 6, not pre-existing (`parseMap` skips ref checks; `world.test.ts` doesn't import `NODES`).|Low|Open — treat the Step 6 world-integrity check as new work; 6→7 ordering already correct.|
|4|Step 3 "add `_derived` PNGs to catalog if absent" — they're already in `asset-catalog.json`.|Low|Open — downgrade that scan to verify-only.|
|5|`pickWeighted` (tileset.ts:543) requires `weight: number`; `NodeSkinDef.weight` is optional.|Low|Open — have `parseNodeDefs` default `weight` (e.g. 1).|

## Out of scope

- Rock/bush yield tiers and picked-clean bush states (mechanism supports them; content deferred).
- Runtime/save-game persistence of live/depleted node state (map files author the world at rest;
  mid-run state isn't persisted today — unchanged).
- A `family` grouping field for palette organisation (optional cosmetic follow-up).
- Any change to the `ground`/`wall` tileset roles or the pack-swap manifest seam for non-node art.
- Procedural placement of nodes (authoring only).
- `extract.py` changes beyond referencing existing/derived sheets via catalog region crops.
