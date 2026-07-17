# Editor Library: role-based placement filtering

> Status: deployed

## Summary

The Map Builder's Library panel (`src/editor/panels/LibraryPanel.tsx`) groups assets only by
pack → folder-category, with no type or semantic filter. Character/monster/NPC sprites therefore
pile into the object-placement picker and clutter the palette while building maps. This feature adds
a **semantic `role`** to each catalog asset — `tile | object | actor | mixed` — orthogonal to the
existing structural `type`, and adds **tool-synced filter toggles** to the Library so the palette
shows only what's relevant to the current tool (tiles while tiling, objects while placing) and hides
actors until a dedicated NPC/monster editor exists. The `role: 'actor'` signal also becomes the
future actor editor's palette source, mirroring how the existing Nodes pseudo-category works.

## Context & decisions

**Existing shape (verified):**

- Assets carry a purely **structural** `type: 'tile' | 'strip' | 'object'` — `src/editor/catalog.ts:21`
  (`CatalogAssetType`); the `CatalogAsset` interface is `~src/editor/catalog.ts:49-88`. Classified in
  `scripts/asset-catalog.mjs` (~lines 236-248) by filename-glob `rules` in each `pack.json`
  (`rules.tile` / `rules.strip`, else `object`), with a per-path `overrides[relPath].type` escape hatch.
- The Library groups by pack → category (`categoriesByPack` in `LibraryPanel.tsx`); `type` is used
  **only to pick the render widget**, never to include/exclude. The tile brush already refuses
  anything that isn't `type:'tile'`; the `place` tool arms `object` + `strip` assets — this is where
  actors currently land.
- `category` is just the asset's parent folder path; `tags` are mechanical filename tokens. Neither
  carries semantic meaning. There is **no** existing actor/character signal anywhere.
- Actor content today: whole packs `craftpix-creatures` (~272 strips), `bat-fur` (15), `small-bat`
  (15); plus NPC folders inside mixed packs — `craftpix-dungeon` (`*/Characters`) and `zelda-like`
  (`Entities/Characters`, `Entities/Npcs`). Docs already flag actors as "browsable but need wiring —
  not catalog-placeable decor" (`docs/assets-catalog.md`, `docs/CRAFTPIX.md`).

**Decisions (my recommendations — Matt to confirm/adjust; safe defaults chosen so execution isn't blocked):**

1. **`role` is orthogonal to `type`.** Keep `type` for rendering/mechanics (a creature stays a
   `strip` so it still animates in the future editor); `role` governs *palette visibility only*.
   New type: `export type CatalogAssetRole = 'tile' | 'object' | 'actor' | 'mixed'`.
2. **Default `role` from `type`** at generation: `tile → 'tile'`, `strip`/`object → 'object'`.
   `role` is **emitted on every asset** (default computed) so consumers never branch on absence.
3. **Actors are tagged via a new `rules.actor` glob list in `pack.json`** (sibling to
   `rules.tile`/`rules.strip`), plus per-path `overrides[relPath].role`. `mixed` is a manual escape
   hatch (via `rules.mixed` or `overrides.role`) for a sheet that legitimately belongs in both tile
   and object palettes — it shows under **both** filters.
4. **Precedence** when computing role: `overrides.role` › `rules.actor` › `rules.mixed` › default-from-type.
5. **Library filter = three toggles `[Tiles] [Objects] [Actors]`** that **auto-sync to the active
   tool** (brush/rect/fill/eraser → Tiles; place → Objects) but allow **manual override**; **Actors
   OFF by default**. `mixed` assets appear under both Tiles and Objects. The Nodes pseudo-category
   shows under Objects, Terrains under Tiles (they aren't raw catalog assets).
6. **Hand off nothing structural to a new tool** — this is filtering only; the actor editor is a
   later, separate plan. This plan just stops actors cluttering placement and lays the `role` rail.

**Patterns to mirror:** `CatalogRegion.role` (plan 028) for adding a semantic field to the catalog;
the Nodes / Terrains pseudo-categories as curated, non-raw-catalog palettes; `editorStore` for
tool/UI state; the deterministic, no-timestamp, byte-identical-regen guarantee in the header of
`scripts/asset-catalog.mjs` (must be preserved — `role` is deterministic).

**Shared-generator note:** plan 033 (asset service worker) also edits `scripts/asset-catalog.mjs`
and `src/editor/catalog.ts` and regenerates `public/assets/asset-catalog.json`. Whichever plan runs
second must rebase its generator edits on the first and re-run `npm run assets:catalog`.

## Steps

- [x] **Step 1: Add `role` to the catalog schema + generator** `[delegate sonnet]`
  - Outcome: `role: CatalogAssetRole` (`'tile'|'object'|'actor'`, `mixed` dropped per critique #1) added to
    `src/editor/catalog.ts`; `scripts/asset-catalog.mjs` parses `rules.actor` + `overrides.role` with precedence
    `overrides.role › rules.actor › type-default`; regenerated `public/assets/asset-catalog.json` (all 1603 assets
    gained `role`, byte-identical on re-run, all type-derived defaults since no pack declares `rules.actor` yet);
    doc note in `docs/assets-catalog.md`; three test fixtures updated for the now-required field. typecheck/test/lint green.
  - `src/editor/catalog.ts`: add `export type CatalogAssetRole = 'tile' | 'object' | 'actor' | 'mixed'`
    and a required `role: CatalogAssetRole` field on `CatalogAsset`.
  - `scripts/asset-catalog.mjs`: parse `rules.actor` and `rules.mixed` glob lists exactly like the
    existing `rules.tile`/`rules.strip` (`matchesAny` + `globToRegExp`); support
    `overrides[relPath].role`; compute `role` per the precedence in decision #4 and emit it on every
    asset object. Extend the `pack.json`-shape doc comment and the validation block (the one that
    checks `type ∈ {tile,strip,object}`) to validate `role ∈ {tile,object,actor,mixed}`.
  - Keep generation deterministic (no timestamps/RNG; sorted output) so an unchanged tree regenerates
    byte-identical.
  - Side effects: regenerating rewrites **all** of `public/assets/asset-catalog.json` (every entry
    gains `role`) — expected; commit the regenerated file. The editor refetches the catalog
    cache-busted (`catalogSource.ts`), so no stale-cache concern. No pack yet defines `rules.actor`,
    so every asset resolves to its default role after this step — safe.
  - Docs: `docs/assets-catalog.md` — document `role`, the `rules.actor`/`rules.mixed` globs, and
    `overrides.role`, terse.
  - Done when: `npm run assets:catalog` run twice produces byte-identical output; every asset has a
    valid `role`; with no `rules.actor` defined yet, roles are exactly the type-derived defaults;
    `npm run typecheck` passes.

- [x] **Step 2: Tag the actor packs/folders in `pack.json`** `[delegate sonnet]` (parallel: A)
  - Outcome: added `rules.actor` to 5 packs — `craftpix-creatures`/`bat-fur`/`small-bat` (`**/*.png`),
    `craftpix-dungeon` (`**/Characters/**`), `zelda-like` (`Entities/Characters/**`, `Entities/Npcs/**`).
    Regenerated catalog: role counts object 1565→1137, +428 actor (272 creatures, 15+15 bats, 124 dungeon
    Characters, 2 zelda Characters/Npcs); props (`DungeonProps`/`Traps` 95, zelda `Environment/Props` 1) stayed
    `object`. Byte-identical on re-run; catalog test 7/7. No source files touched (write-disjoint from Step 3).
  - Add `rules.actor` to the actor packs' `public/assets/tilesets/<pack>/pack.json`:
    `craftpix-creatures` → `["**/*.png"]`; `bat-fur` → `["**/*.png"]`; `small-bat` → `["**/*.png"]`;
    `craftpix-dungeon` → `["**/Characters/**"]`; `zelda-like` →
    `["Entities/Characters/**", "Entities/Npcs/**"]`. (These are the shipped defaults from research —
    tune per pack if a sweep shows misclassified decor.)
  - Regenerate: `npm run assets:catalog`; spot-check counts (creatures/bat packs fully `actor`;
    dungeon/zelda props stay `object`).
  - Depends on Step 1 (needs `rules.actor` support). Write-disjoint from Step 3.
  - Side effects: rewrites `public/assets/asset-catalog.json` (roles now include `actor`).
  - Docs: none beyond Step 1.
  - Done when: catalog shows the creature/bat packs as `role:'actor'` and the dungeon/zelda `Characters`/`Npcs`
    folders as `actor`, while genuine props (e.g. `DungeonProps`, `Traps`) remain `object`.

- [x] **Step 3: Library filter toggles + tool sync** `[delegate sonnet]` (parallel: A)
  - Outcome: `editorStore.ts` — `libraryRoleFilter` (default `'tile'`) + `libraryRoleFilterOverridden` state,
    `setLibraryRoleFilter` action, `TOOL_LIBRARY_FILTER` map (brush/rect/fill/eraser/terrain→tile, place→object,
    all others keep current); `setActiveTool` auto-syncs unless overridden, resets override each switch; `actor`
    never auto-selected. `LibraryPanel.tsx` — `[Tiles][Objects][Actors]` chips; `categoriesByPack`/`visibleAssets`
    (search + category paths), Recent & Favourites all role-filtered; empty categories/packs hidden; Nodes gated to
    object, Terrains to tile; actor-click guard early-returns in `armObject`/`armRegion`/`armAnim` so actors can't be
    armed for placement (comment explains why); already-armed asset survives filter change. New test suite (8 tests).
    typecheck clean, lint 0 errors, 715 tests pass.
  - `src/editor/store/editorStore.ts`: add library-role-filter state (active filter: `tile` | `object`
    | `actor`) + a manual-override flag + actions. Wire tool changes to auto-set the filter
    (brush/rect/fill/eraser → `tile`; place → `object`) unless the user manually overrode since the
    last tool switch; reset the override flag on tool change. Actors are never auto-selected; default
    filter state hides `actor`.
  - `src/editor/panels/LibraryPanel.tsx`: render `[Tiles] [Objects] [Actors]` toggle chips near the
    top of the panel; filter `visibleAssets` and `categoriesByPack` by `role` (a `mixed` asset
    matches both `tile` and `object` filters). Keep the Nodes pseudo-category under the Objects
    filter and Terrains under Tiles. Preserve existing pick/arm behaviour (`pickTile`,
    `armObject`/`armRegion`/`armAnim`, `armNode`, `armTerrain`).
  - Depends on Step 1 (needs `role` in the type). Independent of Step 2's data. Write-disjoint from
    Step 2 (touches store + panel, not `pack.json`/catalog).
  - Side effects: interacts with the tool-switch path; confirm switching tools doesn't strand an
    armed asset that's now filtered out (define: keep the armed asset even if its role is hidden —
    filtering affects the browse list, not what's already armed).
  - Docs: none (behaviour documented in Step 4's editor-doc note).
  - Done when: switching brush↔place changes which assets the Library shows; actors are hidden by
    default; toggling a chip overrides until the next tool switch; `mixed` assets show under both.

- [x] **Step 4: Verify + document** `[inline]`
  - Outcome: `npm run build` (tsc + vite) green; `npm run lint` 0 errors (90 pre-existing `tests/e2e` warnings).
    Headless Playwright drive of the editor confirmed all behaviours against real catalog data: default filter =
    Tiles (actors hidden); Tiles shows only tiles (actor query 0, tile 15, object 0), Objects only objects
    (actor 0, object 16, tile 0), Actors only actors (actor 15, tile 0, object 0); zero console errors. (The
    `mixed`-under-both check was dropped with the `mixed` role.) Docs: role-filter note added to `docs/EDITOR.md`
    - one-line entry in `docs/STATUS.md`; `role` schema already documented in `docs/assets-catalog.md` (Step 1).
  - `npm run build` (typecheck + build) and `npm run lint` green. Drive the editor (`npm run editor`):
    confirm tiling shows only tiles, placing shows only objects, creatures are hidden until Actors is
    toggled on, and a `mixed`-tagged asset shows under both.
  - Docs: add a short note to the editor doc (`docs/EDITOR.md` if present, else `docs/assets-catalog.md`)
    describing the role filter + how `pack.json` `rules.actor` controls it. `docs/STATUS.md` gets a
    one-line entry under the editor subsystem.
  - Done when: build+lint green, manual drive confirms all four behaviours, docs updated.

## Out of scope

- The actual NPC/monster/actor editor (a later plan) — this only tags actors and hides them from
  placement.
- Re-foldering or renaming packs; changing the pack→category tree structure.
- Any change to how assets render or animate (`type` stays the rendering signal).
- Auto-classifying actors by heuristic — actor-ness is declared explicitly in `pack.json`, not guessed.

## Critique

> Fresh-eyes review (independent sub-agent, uncontaminated by the planning conversation).

**Verdict:** Sound, well-grounded, reversible editor-QoL plan — safe to execute, but trim the unused
`mixed` role and pin down two under-specified interactions (role-filter × category-tree, and
tool→filter mapping) first; no blockers.

|#|Finding|Lens|Severity|Suggested action|
|---|---------|------|----------|------------------|
|1|`role:'mixed'` is unused in v1 (Step 2 tags nothing mixed) and overlaps plan-028's region-level `role` that already solves "tile-and-object sheet"|Alternatives / Scope|Medium|Drop `mixed` from v1; add it only when a real asset needs it|
|2|Role filter × pack→category tree under-specified: categories mix roles (e.g. `craftpix-dungeon` = Characters + props); tree/search/Favourites/Recent behaviour under filters undefined|Gaps|Medium|Define per-surface: hide empty categories? filter search results? do Recent/Favourites bypass?|
|3|Tool→filter auto-sync only maps brush/rect/fill/eraser→Tiles and place→Objects; the other ~7 tools (pan/select/zone/collision/shape/**terrain**/portal/eyedropper) unmapped|Gaps / Executability|Medium|Specify mapping (esp. `terrain`→Tiles) or an explicit "keep last filter" rule|
|4|New asset-level `role` collides in name with existing `CatalogRegion.role` (plan 028), different value sets — confusion risk|Cross-cutting|Medium|Document the two `role`s' distinct scopes; consider a clearer field name|
|5|Toggling Actors ON still routes an actor click through `armAnim`/`armObject`→place, making actors placeable-as-decor — what docs warn against; no guard|Gaps / Consistency|Medium|Define what an actor click does (no-op/preview-only?) or accept + document|
|6|"Actor rail for a future actor editor" is speculative — no actor/NPC editor on any roadmap doc; only the decluttering value is real today|Roadmap / Right-sizing|Medium|Frame plan purely as declutter; don't over-invest in the rail (reinforces #1)|
|7|Step 3 done-when isn't observable until Step 2 tags actors; parallel:A is write-disjoint but Step 3 acceptance has a data dependency on Step 2|Sequencing|Low|Soften Step 3 done-when to mechanism-only; verify end-state in Step 4|
|8|Every future actor-containing pack must remember `rules.actor` or actors re-leak into placement|Operational|Low|Note in `docs/assets-catalog.md` pack-ingest checklist|
|9|Making `role` a required field forces `CatalogAsset` test fixtures/constructors to add it|Right-sizing|Low|Typecheck catches it; just budget for it|

**Primary focus:** resolve findings 2 and 3 (filter × category-tree, tool→filter interactions — the
substance of Step 3, currently vague enough to cause rework) and cut `mixed` (finding 1) before
execution. The rest are safe to address in-flight. Schema change + 1.13 MB regen are additive and
reversible; parallel:A grouping is genuinely dependency-safe.
