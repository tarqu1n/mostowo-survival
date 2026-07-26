# Procedural Biome Generation (Editor)

> Status: planned — run /execute-plan to begin. Reviewed via /critique-plan (see `## Critique`);
> findings folded into the steps below.

## Summary

A dev-only **Map Builder** feature to **paint biomes** instead of hand-placing every tree, bush and
rock. Draw a rectangular region, pick a **biome preset** (first: **Forest**), and a **pure, seeded
generator** produces coherent layered content that **bakes into the canonical `MapFile`** (tiles +
objects) as one undoable command — the runtime then consumes it as ordinary hand-authored content
(no map-format change, no runtime awareness).

A biome is **data** (`BiomeDef` in `biomes.json`) — an ordered layer stack, each layer with a palette
of members and per-member weights + per-layer density/spacing (**authored in `biomes.json`** for v1;
an in-editor select/deselect/weight panel is v2). The stack: **base terrain → auto edge → ground
detail → foliage → nodes**, with a shared **height/moisture noise field** that carves **terrain
patches** (a **pond** at the lowest band, **mud** ringing it) and drives **clearings vs. thickets**.
Coherent edges come from the **existing blob autotiler** (`src/systems/autotile.ts`) — the generator
only produces masks; tiling is already solved offline. Scatter uses **Poisson-disk sampling**
(min-distance = the "space to move / see the ground" guarantee) modulated by the noise density field.

Proof is the generator itself: draw a region → generate a Forest → get walkable, natural-looking
forest with a pond+mud patch, edged correctly, re-rollable by seed, applied as one undo step.

## Context & decisions

**Owner decisions (settled with Matt — do NOT re-litigate):**

- **Region select:** rectangle-first, reusing the existing `RegionRect` + Select-tool marquee.
  Freeform/polygon/brush regions are out (v2).
- **Apply model:** **bake into the canonical `MapFile`** (tile `CellChange`s + `MapObject`s) as one
  `batchCommand`. No biome metadata persisted in the map; regeneration = undo + re-run. No
  map-format change.
- **v1 UX = apply-only** (critique #2): pick preset → set/re-roll seed → apply. **Re-roll = undo the
  previous apply (if any) → regenerate with a new seed → apply** — no separate ghost-preview infra.
  The rich *define*-mode panel (select/deselect/weight per layer in the UI) and a translucent
  before-commit **preview** are **v2**; v1 authors biome content by editing `biomes.json`.
- **Coherent tiling:** **config-driven offline generation** — extend `scripts/pixel-crawler/
  gen_terrains.py` to onboard multiple terrains; the editor calls the existing blob autotiler
  (`paintMask`), it grows **no tiling code of its own**. **Pairwise terrain→terrain blend tiles are
  out (v2)** — the overlay-edge trick below removes the need for v1.
- **Terrain patches:** a **shared height/moisture noise field** with **sorted threshold bands** —
  lowest band = **pond (water)**, next band = **mud**, rest = base **grass**. Gives the concentric
  pond→mud ring for free.
- **Overlay edges (SPIKE — see Step 2):** the Forest's **pond is intended to use `Water_tiles.png`**
  blob tiles, whose land-facing sides are believed **transparent** (designed to overlay) — so pond
  edges would bake onto a **layer above** the base and composite over grass/mud. **This is asserted by
  a code comment, not yet verified against the PNG** — Step 2 confirms it or takes the documented
  fallback. **Mud = the existing `dirt` terrain** (opaque, `Floors_Tiles.png`), baked into the base
  layer. **Mud's own layering direction (Step 2 follow-up finding, confirmed against the hand-authored
  map):** mud is NOT drawn as its own edge-tiled patch onto a grass base layer — it's the reverse. Mud
  is a flat, opaque **base** fill everywhere; `grass`'s own alpha-cutout blob tiles are the **overlay**,
  autotiled against a mask, and a "mud patch" is simply a hole in the grass coverage that lets the mud
  base show through. Step 7/9's mud band should bake this way (mud base layer, grass overlay layer with
  a hole), not the naively-symmetric way.
- **Density model:** two knobs — **per-layer density/spacing** (min-distance for node/foliage layers,
  coverage % for ground detail) + **per-entry weight** (`pickWeighted`).
- **Scatter:** **Poisson-disk (Bridson)** + a **value/fbm noise density field**, **seeded /
  deterministic** so re-roll is reproducible.

**Key findings from research — patterns/files to mirror (verified against the tree):**

- **Blob autotiler is done and terrain-count-agnostic.** `src/systems/autotile.ts`
  (`blobKey`/`paintMask`/`pickFrame`, `TerrainMapping`) consumes whatever `TerrainDef`s exist.
  `src/editor/terrainCatalog.ts` = `TerrainDef {id,name,pack,sheet,fillFrame,mapping}` loaded (via
  `terrainCatalogSource.ts`, **fetched** — out of the game bundle) from
  `public/assets/tilesets/pixel-crawler/terrains.json` (**only `grass` today**).
  `src/editor/terrainOps.ts` (`computeTerrainBake`/`buildTerrainCommand`) = mask→baked-cells glue.
- **Terrain onboarding pipeline** (offline Python → committed JSON → TS + parity test):
  `scripts/pixel-crawler/autotile.py` `build_blob(rel, c0,c1,r0,r1, tol=48)` reads a sheet box and
  returns `{blob_key: [(c,r),…]}`; its `__main__` **already defines `DIRT (11,15,0,12)` and
  `GRAVEL (5,9,0,12)` boxes** on `Floors_Tiles.png` (grass = `(0,4,0,12)`). **`COLS=25` in
  `gen_terrains.py` is Floors-specific** — `frame=row*COLS+col`, so onboarding a terrain from a
  *different* sheet needs **COLS per sheet** (a new field in the config tuple). `gen_terrains.py`
  wraps grass only → writes `terrains.json` + `src/editor/__tests__/fixtures/grass-terrain-parity.json`.
  `src/editor/__tests__/terrainOps.test.ts` suite 1 asserts TS `paintMask` reproduces the fixture
  (`resolveIndex = frame+1`). **Water lives in a separate sheet** `Water_tiles.png` (**no box exists**
  — discover via `scripts/pixel-crawler/gridoverlay.py`/`blob_map.py`), with a **different grid width**
  than 25, and its land-side transparency is **only asserted** (`autotile.py:3-7`), not verified.
- **Layers & draw order:** `MapFile.layers` ordered bottom→top; `src/scenes/world/groundRenderer.ts`
  `drawMapLayers` sets `depth = overhead ? OVERHEAD_LAYER_DEPTH(20) : layerIndex` — **later index draws
  over earlier**, so an overlay terrain = a **higher-index `TileLayer`**. The editor's `addLayer`
  appends to top → same ordering. `TerrainSection {layerId,terrainId,cells}` is **editor-only** (game
  reads baked `TileLayer.cells`); a terrain's **target layer is the editor's active layer at paint
  time**, not bound in the `TerrainDef`. No alpha field on palette/layer — transparency is the PNG's
  own pixels.
- **A `mulberry32` seeded-PRNG precedent already exists** — `stepMonster` threads an
  `rng: () => number` param and `monsterAI.test.ts` defines a private `mulberry32`. Consolidate that
  into the new shared util rather than inventing a second one. **No noise field exists** anywhere, and
  no PRNG/noise dep in `package.json` (we add none). `pickWeighted` (`src/data/tileset.ts:~881`) uses
  `Math.random()` and takes no RNG.
- **Map schema** (`src/systems/mapFormat/schema.ts`): `MapFile{meta,shape?,palette,layers,terrain,
  walkability,zones,objects}`; grids are flat row-major `number[]`, `cellIndex(col,row,w)=row*w+col`,
  `getCell/setCell/isInside` (isInside enforces void/shape). `TileLayer{id,name,cells,overhead}`,
  cells = palette indices (0 = empty). `MapObject = NodeObject|DecorObject|PortalObject`:
  `NodeObject{kind:'node',ref(NODES key),col,row,skin?,rotation?,depthBias?}` (tile-addressed),
  `DecorObject{kind:'decor',asset,x,y(px),scaleX/Y,rotation,flip,depth,collision?,region?|anim?}`.
  `parseMap` enforces void-consistency + palette validity — the acceptance bar for generated maps.
- **Node content** (`src/systems/nodeDefs.ts`, `src/data/maps/nodes.json`): ids `tree`, `rock`,
  `berryBush`/`berryBushMed`/`berryBushBig`, `salvagedTent`. `tree` carries **60 `ff_*` forest-floor
  skins**, weighted-rolled at placement → foliage variety is nearly free. Decor = pure art
  (`role:'object'` in `src/data/catalog.ts`).
- **Command/undo pattern:** everything routes through `history`/`applyCommand`
  (`src/editor/store/shared.ts`). Grid edits: `commandFromChanges(cells,changes,value,strokeId)`.
  Objects: `objectsSlice.ts` `placeNode`/`placeDecor` (gated on `footprintIsValid`, ids via
  `nextObjectId`), `batchCommand` bundles N ops into one undo step. Terrain: `buildTerrainCommand`
  (mask edit + rebake as one command). Signals: `mapEpoch` (full reload) vs `docRevision` (rebake) +
  `pendingDirty{layerIndex,chunks[]}`.
- **Editor extension points:** `EditorTool` union (`store/types.ts:40`), slice pattern
  (`store/slices/*`, composed in `editorStore.ts`), `TOOLS`/`PAINT_MODE_TOOLS` in `Toolbar.tsx:59`,
  pointer dispatch `switch(activeTool)` in `scene/EditorInputController.ts:~431` (+ marquee `~851`),
  panels in `panels/*` (shadcn primitives in `ui/*`), compact/touch shell (`hooks/useIsCompact.ts` +
  `ContextBar.tsx`). Region math: `regionOps.ts` (`RegionRect`,`normalizeRegion`) +
  `regionGeometry.ts` (`resizeBox`). Scatter precedent: `scenes/world/DevWorldTools.ts`
  `randomiseWorld()` (unseeded rejection sampling — we replace it with seeded Poisson).

**Direction (README/CLAUDE.md/docs/ROADMAP.md):** MVP path is complete; post-MVP crafting shipped;
roadmap ahead = more crafting/content, multi-map, richer enemies. A biome painter is **not explicitly
on the roadmap** — it is **enabling authoring tooling** (owner-approved) that accelerates the
forest/content the roadmap *does* want, and fits the "author on a phone via guppi" workflow (hence the
ContextBar requirement). Recorded as such in DECISIONS (Step 12). Dev-only; excluded from prod build;
no runtime/gameplay surface change.

**Proposed `BiomeDef` shape** (the extend-to-paint surface — executors refine field names in Step 6):

```ts
interface BiomeDef {
  id: string; name: string; seed?: number;          // default seed; re-roll overrides at apply
  terrain: {
    base: string;                                    // TerrainDef id, e.g. 'grass' → base layer
    field: { scale: number; octaves: number };       // shared height/moisture noise
    bands: Array<{ terrainId: string; layer: 'base' | 'overlay'; maxHeight: number }>;
    // sorted ascending by maxHeight; a cell takes the first band whose maxHeight ≥ its noise value.
    // e.g. [{water, overlay, 0.22}, {dirt(mud), base, 0.38}]  → pond ringed by mud, else base grass.
  };
  scatter: Array<{
    id: string; kind: 'decor' | 'node';
    spacing: number;                                 // Poisson min-distance in tiles (walk-gap knob)
    density: number;                                 // 0..1 vs the noise density field
    members: Array<{ ref: string; weight: number; skin?: string }>;  // pickWeighted(rng)
    avoidTerrains?: string[];                         // e.g. nodes avoid 'water'
    clump?: { chance: number; radius: number; count: [number, number] };  // parent→children (berries)
  }>;
}
```

**Testing (per docs/testing.md):** verify each step with a **targeted unit run** (`npm test <file>`)
or the **one** guarding spec — never the full `npm run e2e`/`check:all` mid-work (that's CI's job).

## Steps

- [x] **Step 1: Prove the tiling — generalise `gen_terrains.py` (per-sheet COLS), onboard `dirt`** `[inline]`
  - Outcome: `gen_terrains.py` refactored to a `TERRAINS` config list `(id,name,sheet,box,cols)` with a
    per-sheet `cols` field threaded into `canonical_mapping(table,cols)` (`frame=r*cols+c`); a
    `build_terrain()` helper emits one `TerrainDef` + one `<id>-terrain-parity.json` per terrain. Dirt
    onboarded (box `(11,15,0,12)`, `cols=25`, `fillFrame=11`, 10 mapping keys). Grass block is
    **byte-identical** to before the refactor (verified). Added hand-committed
    `fixtures/grass-terrain-def.snapshot.json` (NOT script-emitted) + a grass-invariance test asserting
    `terrains.json`'s grass entry deep-equals it. Parity test parameterised via `it.each` over
    `[grass,dirt]`. `npm test terrainOps` → 7 passed (2 parity + grass-invariance + 4 existing).
    Files touched: `scripts/pixel-crawler/gen_terrains.py`, `public/assets/.../terrains.json`
    (regenerated, +dirt), `src/editor/__tests__/fixtures/dirt-terrain-parity.json` (new),
    `src/editor/__tests__/fixtures/grass-terrain-def.snapshot.json` (new),
    `src/editor/__tests__/terrainOps.test.ts`. Editor Library auto-lists dirt (catalog maps `terrains[]`
    generically). Dirt fixture bakes 13/13 cells with 9 distinct frames = coherent edges/corners resolve
    (headless-equivalent of the "arm Dirt in editor" visual check).
  - Refactor `scripts/pixel-crawler/gen_terrains.py` to loop over a **list** of terrain configs
    `(id, name, sheet, box, cols)` — note the new **`cols`** field, so `frame = row*cols + col` is
    correct per sheet (Finding #1) — instead of the single hardcoded `GRASS_BOX`/`SHEET`/`COLS`.
    Append each `TerrainDef` to `terrains.json`'s `terrains[]` and emit a per-terrain parity fixture.
    Add **`dirt`** using the box already in `autotile.py:__main__` (`(11,15,0,12)`, sheet
    `Floors_Tiles.png`, `cols=25`). Re-run `python3 scripts/pixel-crawler/gen_terrains.py` then
    `npx prettier --write` `terrains.json` + fixtures. Parameterise `terrainOps.test.ts` suite 1 over
    `[{id:'grass',fixture},{id:'dirt',fixture}]`.
  - **Grass-invariance guard (Finding #4):** the parity fixture is regenerated by the same script, so
    it cannot detect grass drift on its own. Add a **separate** assertion that the committed
    `grass` `TerrainDef` block in `terrains.json` (its `fillFrame` + `mapping`) is **unchanged** — e.g.
    a small committed snapshot of the grass object diffed in a test, or a `git diff --exit-code` check
    on the grass block noted in the step. The refactor must not alter grass output.
  - Files: `scripts/pixel-crawler/gen_terrains.py`, `public/assets/tilesets/pixel-crawler/terrains.json`
    (regenerated), `src/editor/__tests__/fixtures/dirt-terrain-parity.json` (new), grass invariance
    snapshot (new), `src/editor/__tests__/terrainOps.test.ts`. Read (don't edit) `autotile.py`.
  - Side effects: `terrains.json` feeds `terrainCatalog.ts`; the editor Library auto-lists `dirt`.
  - Docs: none yet (Step 12 writes the onboarding recipe).
  - Done when: `npm test terrainOps` passes for grass **and** dirt; the grass-invariance check confirms
    grass is byte-identical; arming **Dirt** in the editor paints coherent edges + inner/outer corners.

- [x] **Step 2: Water tile edge set — depth dual-grid tiler + reusable baker/pipeline (LANDED)** `[inline]`
  - **LANDED 2026-07-25.** Went far beyond the original spike: the water sheet is a **depth ramp**
    (shallow/mid/deep opaque shade levels) joined by **corner dual-grid transition autotiles** + a coast
    autotile + surface-decoration fill variants. Baked by `scripts/pixel-crawler/bake_edge_set.py`
    (`method: "depth"`) → `edge-sets/water.json`, with a distance+noise depth-field generator (repaired
    to be always-tileable: king-Lipschitz erode + saddle-break) as the demo/guard (`invalid tiles = 0`).
    Corner/edge variety (all `[frame,rot]` options per case), authored solid deep, grass shade matched to
    coast (no halo). **Full reusable onboarding pipeline documented in [docs/BIOMES.md](../docs/BIOMES.md)**
    (so a fresh session can onboard the next sheet, e.g. muddy patches). Steps 6/7/10 (TS runtime/editor
    generator) still consume this data. **Original spike outcome + superseded checklist below, for record:**
  - **Follow-up landed same day, same file:** fixed a residual hard-edge bug in fill VARIANTS (a
    ripple/swirl decoration reaching a tile border, not just failing the 4-corner check —
    `is_solid_fill` now samples the border lines too). Along the way, found "looks plain" and "is
    perfectly self-tileable" are DIFFERENT, uncorrelated tile properties — chasing both by tightening a
    colour tolerance just swaps which tile wins, it never finds one that's both; the fix is
    **`fillAuthored`**, a synthesized flat default background (like a whole `authored` depth level, but
    keeping the level's normal scattered `variants`) — shipped on water's `shallow` level. **Then
    onboarded `mud` as a `blob` set** (NOT `depth` — it's alpha-cutout patches on grass, same method as
    `grass`; sheet box `(11,15,0,12)` in `Floors_Tiles.png`, the same region `gen_terrains.py` already
    calls `"dirt"` for the editor paintbrush). **Key finding for Step 7/9's terrain-patch generator:**
    the hand-authored map does NOT draw mud's own edge tiles onto a grass base — it's the other way
    round: **mud is always the flat opaque background** (painted everywhere, no edge art of its own
    needed), and **grass's own alpha-cutout blob tiles are always the layer on top**, autotiled against
    a mask; a mud patch is simply a hole in the grass coverage. Getting this backwards (mud cutting into
    grass) renders without error and looks *plausible* but isn't what the map actually does — check
    which terrain's tiles carry the real alpha before assuming a direction. Also generalized the blob
    method's corner/edge variety the same way water's transitions already had it (a case gets a LIST of
    `[frame,rot]` options, randomly chosen) for both `grass`'s blob edges and water's `coast` — BUT found
    `build_blob`'s own native classification already groups visually-inconsistent frames under one key
    (e.g. one copy has a baked-in edge shadow, a "duplicate" doesn't), so variety must stay to **one
    canonical frame per native key, then rotated** — mixing distinct native frames (even ones the
    classifier calls equivalent) reintroduces visible inconsistency. Coast corners now pool + rotate
    across cases that are true rotations of each other too, trading some lighting consistency (tufts
    can end up sideways on a rotated placement) for far less repetition — an explicit, owner-confirmed
    call, not an oversight. All of this is captured in `docs/BIOMES.md` gotchas for the next sheet.
  - **SPIKE OUTCOME (recorded 2026-07-25 — steps below to be rewritten around it before ticking):**
    All three unknowns resolved against the actual `Water_tiles.png`: (1) the water fill box isolates
    cleanly (`(0,4,5,13)`, colour-gated); (2) grid width is **`cols=25`** — *same* as Floors, NOT
    "≠25" as the plan assumed; (3) **land-side transparency FAILS** — the sheet is opaque water fills +
    land-islands-on-opaque-water, and `water_diagonal.png` is a tiny all-opaque coast strip, so **no
    water blob with transparent land-facing edges exists**. The **overlay-pond model is dead**, and so
    is the opaque flat-fill fallback (hard blocky edges — owner rejected on sight).
  - **New direction (owner-directed, replaces the blob approach for water):** a **dual-grid /
    marching-squares** coast tiler, **not** the alpha blob autotiler (which can't key on opaque
    colour-transition tiles). Each display tile sits over a world-grid *vertex* and is chosen by its 4
    **corners** (water/land) sampled from the mask → 16 cases; the case→tile map is auto-derived by
    classifying each island tile's 4 corner blocks. Seam correctness validated by a **pixel-adjacency
    (Wang) test** — two tiles fit iff their touching pixel lines mostly agree (`>0.85` different ⇒ no
    fit); known-good seams ~0–0.31, mismatches 1.0. **Adjacency arrays + case map are precomputed
    offline and committed as JSON** (like `terrains.json`); the editor does O(1) lookups, never touches
    pixels at runtime. Grass/dirt stay on the existing blob autotiler. Fills (grass, water interior)
    are all mutually edge-compatible, so the natural look comes from a **clean base tile + sparse
    noise-driven accents**, not adjacency. Proven end-to-end (organic lake, real grass base, correct
    internal/external corners) in **`scripts/pixel-crawler/biome_lake_poc.py`** (run it → demo PNG).
  - **Scope note:** this adopts a *second* autotile engine (dual-grid), which the plan's Out-of-scope
    listed as v2. Owner-approved as the v1 water tiler. Steps 1/6/7/10 + Out-of-scope + DECISIONS to be
    updated when this step is formally rewritten; keeping the spike prototype committed as the checkpoint.
  - **Original spike checklist (below) — superseded by the outcome above:**
  - **This is a de-risking spike, not routine execution (Finding #1).** Before any generator/editor
    work depends on the overlay-pond model, knock down three unknowns for `Water_tiles.png`:
    1. **Box isolation** — find the water blob's bounding box via `scripts/pixel-crawler/gridoverlay.py`
       - `blob_map.py`.
    2. **Grid width** — determine the sheet's `cols` (≠ 25) and feed it through the Step-1 `cols` field.
    3. **Land-side transparency** — **verify against the actual PNG** (inspect alpha on edge tiles, e.g.
       with the Python PIL tooling already used in `scripts/`) that water edges are transparent where
       they meet land. Do not rely on the code comment.
  - **If all three hold:** add `water` to the terrain list, regenerate `terrains.json` +
    `water-terrain-parity.json`, extend the parity test; record that water bakes onto a **higher-index
    layer**.
  - **If transparency or box isolation fails:** take the documented fallback — use the **opaque
    `water_diagonal.png` coast tiles** (or a hand-authored `mapping`) on the base layer, and **update
    the Forest preset + Step 7/10 accordingly** (pond becomes opaque, no overlay layer). Record the
    outcome in the step and in DECISIONS (Step 12).
  - Files: `scripts/pixel-crawler/gen_terrains.py` (+`terrains.json`), `water-terrain-parity.json`
    (new), `terrainOps.test.ts`; a throwaway PIL alpha-check script under `scripts/pixel-crawler/`.
  - Side effects: the chosen outcome (overlay vs opaque) is a **decision gate** for Steps 6/7/10 — do
    not start the generator chain until it's settled.
  - Docs: none yet.
  - Done when: water is onboarded with a passing parity test **and** the overlay-vs-opaque decision is
    recorded; if overlay, painting water on a higher layer shows grass through the coast (visual smoke).

- [x] **Step 3: Shared seeded PRNG (`src/systems/rng.ts`) + optional-RNG `pickWeighted`** `[delegate]`
  - Outcome: `src/systems/rng.ts` (new) exports `Rng{nextFloat,nextInt,pick}` + `makeRng(seed)`,
    byte-for-byte the same mulberry32 core as the old private `monsterAI.test.ts` function;
    `nextFloat` is a plain `() => number` so it drops into any existing `rng: () => number` param
    (e.g. `stepMonster`) with no signature changes. `src/systems/__tests__/rng.test.ts` (new, 8 tests):
    determinism, per-seed divergence, `nextFloat`/`nextInt` bounds, `pick` (incl. throw on empty), a
    pinned regression value guarding the algorithm. `pickWeighted` (`src/data/tileset.ts`) took an
    optional `rng: () => number = Math.random` param, threaded in place of the internal `Math.random()`
    call — existing single-arg callers (e.g. `objectsSlice.ts:97`) untouched. `monsterAI.test.ts`'s
    private `mulberry32` now delegates to `makeRng(seed).nextFloat` (dupe algorithm removed); its ~30
    `mulberry32(seed)` call sites were left as-is (kept the wrapper name) — a mechanical rewrite across
    all of them was judged unnecessary churn. `npm test rng` → 8/8 pass; `npm test data` (41+5, covers
    `pickWeighted` callers) and `npm test monsterAI` (29) still green; `tsc --noEmit` + eslint clean on
    touched files. Files touched: `src/systems/rng.ts` (new), `src/systems/__tests__/rng.test.ts` (new),
    `src/data/tileset.ts`, `src/systems/__tests__/monsterAI.test.ts`.
  - Add a pure seeded PRNG as `makeRng(seed): Rng` with `nextFloat()` (`[0,1)`), `nextInt(nExcl)`,
    `pick(array)` — **consolidating the existing private `mulberry32` from `monsterAI.test.ts`**
    (Finding #6) and matching the `rng: () => number` shape `stepMonster` already threads. No Phaser
    import. Add `src/systems/__tests__/rng.test.ts` (determinism + range bounds). Give `pickWeighted`
    (`src/data/tileset.ts`) an **optional** `rng?: () => number` param defaulting to `Math.random`.
  - Files: `src/systems/rng.ts` (new), `src/systems/__tests__/rng.test.ts` (new),
    `src/data/tileset.ts` (add optional param); optionally point `monsterAI.test.ts` at the shared
    `mulberry32` (don't change `stepMonster`'s signature).
  - Side effects: all existing `pickWeighted` callers keep working (param optional). Run the tileset +
    monsterAI unit tests to confirm no regression.
  - Docs: none.
  - Done when: `npm test rng` passes; existing unit tests still green.

- [x] **Step 4: Value/fbm noise field (`src/systems/noise.ts`)** `[delegate]` (parallel: A)
  - Outcome: `src/systems/noise.ts` (new) exports `Noise2D{sample,fbm}` + `makeNoise2D(rng: Rng)`. A
    fixed 256×256 lattice of random values is drawn from `rng.nextFloat()` once at construction (never
    per-sample, so `sample` is a pure function of `(x,y)`); `sample` hashes integer lattice coords
    (bitmask-wrapped) and bilinearly interpolates the four surrounding corners with a Perlin smoothstep
    fade (`6t^5-15t^4+10t^3`) for continuous `[0,1]` noise. `fbm(x,y,{octaves,scale})` sums octaves of
    `sample` at doubling frequency/halving amplitude, normalized back into `[0,1]`. No `poisson.ts`
    import (write-disjoint from the parallel Step 5). `src/systems/__tests__/noise.test.ts` (new, 8
    tests): determinism (same/fresh instances), per-seed divergence, range `[0,1]` for both
    `sample`/`fbm` across a grid, spatial continuity (small Δ → small value change), grid distinctness.
    `npm test noise` → 8/8 pass; `tsc --noEmit` + eslint clean. Files touched: `src/systems/noise.ts`
    (new), `src/systems/__tests__/noise.test.ts` (new).
  - Seeded 2D value-noise + fbm: `makeNoise2D(rng)` → `sample(x,y): number` in `[0,1]`, plus an fbm
    wrapper `(x,y,{octaves,scale}) → [0,1]`. Pure, Phaser-free, seeded via the Step-3 `Rng`. Unit-test
    determinism, range, and rough spatial continuity (adjacent samples close).
  - Files: `src/systems/noise.ts` (new), `src/systems/__tests__/noise.test.ts` (new). Imports `rng.ts`.
  - Side effects: none.
  - Docs: none.
  - Done when: `npm test noise` passes.

- [x] **Step 5: Poisson-disk sampler (`src/systems/poisson.ts`)** `[delegate]` (parallel: A)
  - Outcome: `src/systems/poisson.ts` (new) exports `PoissonPoint`, `PoissonAccept` (`(x,y) => boolean |
    number`), `PoissonSampleOptions{width,height,radius,rng,accept?}`, and `poissonSample(opts)`.
    Standard Bridson: a background grid (cell size `radius/√2`, ≤1 point/cell) for O(1) neighbour
    lookups, an active list, `k=30` candidates per active point sampled in the annulus
    `[radius,2·radius]`; `accept` returning a `boolean` is a hard keep/reject, a `number` is a
    keep-probability rolled against the injected `rng`. No `noise.ts` import (write-disjoint from the
    parallel Step 4 — density is entirely caller-supplied via `accept`). `src/systems/__tests__/
    poisson.test.ts` (new, 7 tests): minimum spacing (no pair closer than `radius`), determinism, hard
    - probabilistic `accept` thinning reduces count, points stay in-bounds. `npm test poisson` → 7/7
    pass; `tsc --noEmit` + eslint clean. Files touched: `src/systems/poisson.ts` (new),
    `src/systems/__tests__/poisson.test.ts` (new).
  - Bridson fast Poisson-disk sampling, seeded via the Step-3 `Rng`:
    `poissonSample({width,height,radius,rng,accept?})` → `Array<{x,y}>`, where `accept?(x,y)` (bool or
    `0..1` probability) thins points against a density field. `radius` = min distance (tiles).
    Unit-test: no two points closer than `radius`; determinism; `accept` thinning reduces count.
  - Files: `src/systems/poisson.ts` (new), `src/systems/__tests__/poisson.test.ts` (new). Imports
    `rng.ts` only (NOT `noise.ts` — density passed in; keeps this write-disjoint from Step 4).
  - Side effects: none.
  - Docs: none.
  - Done when: `npm test poisson` passes.

- [x] **Step 6: `BiomeDef` schema, catalog (public/assets) + Forest preset** `[inline]`
  - Outcome: **Schema reworked around Step 2's actual landed outcome, not the pre-Step-2 proposal**
    (executors are explicitly authorized to refine field names here). Step 2 replaced the
    "TerrainDef overlay on a higher layer" model entirely with per-edge-set methods (`depth` for
    water — its own embedded lake generator + dual-grid coast/transition tiling; `blob` for
    grass/mud — plain alpha-cutout autotile, with mud's hard-won finding that it paints as a hole in
    the *overlying* grass coverage, not the reverse). So `BiomeTerrainBand` dropped the dead
    `layer: 'base'|'overlay'` field and `bands[].terrainId`/`base` now name a **tile-edge-set id**
    (`edge-sets/<id>.json`, `docs/BIOMES.md`) — NOT a `terrains.json` `TerrainDef` id — since the
    layering mechanics per method are Step 7 (the generator)'s job, not the schema's. `src/systems/
    biomeDefs.ts` (new): `BiomeDef{id,name,seed?,terrain,scatter}`, `BiomeTerrain{base,field:{scale,
    octaves},bands:BiomeTerrainBand[]}` (bands sorted strictly ascending by `maxHeight∈(0,1]`),
    `BiomeScatterLayer{id,kind:'decor'|'node',spacing,density,members,avoidTerrains?,clump?}`,
    `parseBiomeDefs(raw, ctx?)` mirrors `parseNodeDefs`'s strict `fail`/`expect*`/no-extra-keys style.
    Cross-validation is layered by what a PURE module can actually check: `kind:'node'` member `ref`s
    (+ optional `skin`) validate against the bundled/compile-time `NODES` import directly (like
    `nodeDefs.ts` checks `ITEMS`); `kind:'decor'` refs and `terrain.base`/`bands[].edgeSetId` validate
    against an **optional** injected `BiomeValidationContext{decorAssetIds?,edgeSetIds?}` — omitting
    it (unit tests) just skips that check rather than failing closed. `src/editor/
    biomeCatalogSource.ts` (new) mirrors `terrainCatalogSource.ts`: fetches `biomes.json` cache-busted,
    passes the already-loaded asset catalog's ids as `decorAssetIds` (best-effort — `undefined` if the
    Library hasn't fetched it yet). It does **not** install into the Zustand store (no `biomeSlice`
    exists yet — that's Step 10) and doesn't thread `edgeSetIds` (no typed edge-set-catalog loader
    exists yet either — naturally Step 7's job, the first consumer that actually loads `edge-sets/
    *.json`); `terrain.base`/`bands[].edgeSetId` get shape validation only until then. `public/assets/
    tilesets/pixel-crawler/biomes.json` (new): the Forest preset — `base:'grass'`, `bands:[
    {water,0.22},{mud,0.38}]`; **4** scatter layers (the plan's 3-category description doesn't map
    1:1 onto the schema's one-`clump`-per-layer constraint, so `berries` split out from `nodes`):
    `groundDetail` (decor: 10 real, already-in-the-hand-authored-map `craftpix-nature/Bushes/
    Fern*`/`Bush_simple*` assets, spacing 1, density 0.7), `foliage` (node: `tree` with 5 different
    `ff_*` forest-floor skins — small/dense sapling dressing, spacing 2, density 0.5), `nodes` (node:
    `tree`(no skin override, rolls its own default skins) + `rock`, big spacing 5, density 0.35),
    `berries` (node: `berryBush`/`berryBushMed`/`berryBushBig`, spacing 8, density 0.15, `clump`).
    All four avoid `water`. `src/systems/__tests__/biomeDefs.test.ts` (new, 16 tests): valid-parse,
    every strict-rejection path (bad version/unknown key/duplicate id/band ordering/height bounds/
    weight/unknown node ref/unknown skin/skin-on-decor), both injected-context checks, and a real
    integration test statically importing the committed `biomes.json` and parsing it end-to-end.
    `npm test biomeDefs` → 16/16 pass; `tsc --noEmit` + eslint clean; manually confirmed `biomes.json`
    is servable at `/assets/tilesets/pixel-crawler/biomes.json` via a throwaway dev-server curl (no UI
    yet to click through — Step 11 adds that). Files touched: `src/systems/biomeDefs.ts` (new),
    `src/systems/__tests__/biomeDefs.test.ts` (new), `src/editor/biomeCatalogSource.ts` (new),
    `public/assets/tilesets/pixel-crawler/biomes.json` (new).
  - Put the **type + strict validator** in `src/systems/biomeDefs.ts` (pure, mirroring
    `src/systems/nodeDefs.ts` `parseNodeDefs` — fail loudly on bad refs/shape; keeps the pure generator
    free of editor imports). Put the **catalog JSON in `public/assets/tilesets/pixel-crawler/
    biomes.json`** and load it via an editor source module `src/editor/biomeCatalogSource.ts` mirroring
    `terrainCatalogSource.ts` (**fetched, not bundled** — Finding #3; biomes are editor-only like
    `terrains.json`, NOT bundled game content like `nodes.json`). Author the **Forest** preset per the
    Step-2 outcome: base `grass`; bands `water/dirt` (overlay or opaque per Step 2); scatter layers
    `groundDetail` (decor, small spacing, high density), `foliage` (ferns/tufts + `tree` `ff_*` skins),
    `nodes` (`tree` big spacing, `rock`, `berryBush*` with a `clump`), nodes `avoidTerrains:['water']`.
    Validate member `ref`s against `NODES`/catalog/`terrains.json`.
  - Files: `src/systems/biomeDefs.ts`, `src/systems/__tests__/biomeDefs.test.ts`,
    `src/editor/biomeCatalogSource.ts`, `public/assets/tilesets/pixel-crawler/biomes.json` (all new).
  - Side effects: none at runtime; being in `public/assets` + fetched, it stays out of the game bundle.
  - Docs: Step 12 documents authoring; leave a header comment pointing there.
  - Done when: `npm test biomeDefs` passes (valid Forest parses; a malformed def throws with a clear
    path); the editor can fetch + list the Forest preset.

- [x] **Step 7: Generator — terrain + height-band patches (`src/systems/biomeGen/terrain.ts`)** `[inline]`
  - Outcome: **This step's original text (above, kept for history) predates Steps 2/6's actual findings
    and was substantially stale** — there's no `TerrainDef.mapping`/`autotile.paintMask` path for bands
    any more (Step 6 replaced it with edge-set ids), and water's real `depth` method needed a genuine
    algorithm port, not a mask-autotile call. Landed, in order:
    1. **No typed edge-set loader existed yet** (`biomeDefs.ts`'s own module doc flagged this as Step
       7's job). New `src/systems/edgeSets.ts`: `BlobEdgeSet`/`DepthEdgeSet`/`EdgeSet` types +
       `parseEdgeSet`, a light structural narrow (mirrors `terrainCatalog.ts`'s posture, not
       `biomeDefs.ts`'s strict no-extra-keys style — these files are baker-generated, not hand-authored).
    2. **Production asset gap found + fixed at the source.** `water.json`'s `shallow`/`deep` levels
       (`fillAuthored`/`authored`) had NO real sheet frame — the offline demo only ever synthesized an
       in-memory flat-colour rectangle, never committed anywhere a real `TileSource` could reference.
       Extended `scripts/pixel-crawler/bake_edge_set.py` (`write_fill_asset` + a `main()` hook) to
       commit a real flat-colour PNG per authored/fillAuthored depth level
       (`edge-sets/<id>-<levelName>-fill.png`) and record it as the level's new `fillAsset` field,
       consumed via `TileSource{kind:'image'}` (no map-schema change needed — that `TileSource` variant
       already existed). Re-ran the baker: `water.json`'s diff is exactly the two new `fillAsset` fields
       (`grass.json`/`mud.json` byte-identical, `invalid tiles = 0` unchanged) — confirmed with the user
       before touching the Python pipeline (owner decision: extend the baker now, not defer).
    3. **`generateTerrain(region, terrain, seed, edgeSets)`** in the new `terrain.ts`: shared-noise band
       assignment (`noise.ts` `fbm`, first band whose `maxHeight >= n` else `terrain.base`) →
       `cellEdgeSet` (per-cell edge-set id, region-local row-major — Step 8's `avoidTerrains` input) →
       two layers. **The base terrain is always the OVERLAY, every band is always `base` role** — the
       "hole" technique confirmed in `docs/BIOMES.md` (mud paints as a flat opaque fill, no autotiling;
       the base terrain's own alpha-cutout blob mask has a hole wherever a band claims the cell)
       generalises past mud to ANY band regardless of its edge-set method: a `depth` band (water) is
       fully opaque and self-contained (own baked-in coast shore art), so it also just paints straight
       onto `base`, no hole needed for it specifically. Reused `autotile.ts`'s `blobKey`/`FULL_KEY` for
       the overlay's mask classification (same bit algorithm as the committed `mapping`'s keys); could
       NOT reuse `paintMask`/`pickFrame` (built for a different, simpler `terrains.json` mapping shape —
       the real `edge-sets/*.json` `mapping` is `blobKey -> [frame,rot][]`, weighted-random per option,
       not one canonical frame), so `terrain.ts` has its own picker (`pickOption`, `paintBlobOverlay`).
    4. **Water's `depth_field` + dual-grid coast/transition/fill placement ported from
       `bake_edge_set.py`** (BFS distance-from-shore, value-noise wobble, the erode/de-saddle repair
       loop, exact King-neighbour iteration order preserved since the repair mutates in place mid-scan)
       — see `terrain.ts`'s module doc "RNG note" for the explicit, user-confirmed scope of "port it
       faithfully": the ALGORITHM and its invariants are ported 1:1, but the randomness underneath uses
       this codebase's own seeded `rng.ts`/`noise.ts` (one `Rng` threaded through the whole call in a
       fixed order), not a re-implementation of NumPy's PCG64 — reproducing that bit-for-bit was judged
       impractical and beside the point (the whole point of Steps 3-5 was one shared seeded-RNG path).
       Water's dual-grid output is genuinely `(region.cols+1) x (region.rows+1)` tiles (one wider/taller
       than the mask — each rendered tile sits over a mask VERTEX) — per the user's confirmed call,
       `TerrainCell.col`/`.row` return these RAW overhang coordinates (`0..cols`/`0..rows` inclusive,
       region-local), left for Step 9/10 to clamp/translate, not clipped away here.
    5. **Known visual caveat, not a bug** (documented prominently in `terrain.ts`'s module doc): the
       Forest preset's band order (water's `maxHeight` below mud's) means the pond's shore always
       borders MUD, never grass directly — but water's `coast` tiles are baked to colour-match GRASS
       (`docs/BIOMES.md`'s own gotcha). Every corner case still resolves to a real frame (no tiling
       bug), but the shore's baked-in shade may read as a slight mismatch against mud — flagged for
       whoever eyeballs the rendered Forest preset (Step 11) to tune (reorder bands, or a mud shade
       closer to grass) rather than silently living with it.
    - Files: `src/systems/edgeSets.ts` + `__tests__/edgeSets.test.ts` (new), `src/systems/biomeGen/
      terrain.ts` + `__tests__/terrain.test.ts` (new), `scripts/pixel-crawler/bake_edge_set.py` (small
      addition), `public/assets/tilesets/pixel-crawler/edge-sets/water.json` (regenerated — `fillAsset`
      fields only), `edge-sets/water-shallow-fill.png` + `edge-sets/water-deep-fill.png` (new, committed
      assets).
    - Side effects: none at runtime (dev-only generator, not yet wired to the editor — Step 11). The
      two new PNGs ship in `public/assets`, same as every other tile sheet asset.
    - `npm test edgeSets terrain` → 16/16 pass (6 + 10); full suite `npx vitest run` → 1067/1067 pass;
      `tsc --noEmit` + eslint + prettier clean. Acceptance bar verified directly: fixed-seed determinism
      (`toEqual` on two full runs), the real Forest preset at a region/seed sampled to have all three
      terrains present shows water never directly adjacent to grass (concentric, confirmed 0/N such
      adjacencies) and dominated by one contiguous pool (>80% of water cells in the largest connected
      component — noise-thresholded bands can legitimately carve a second small puddle, so "predominantly
      one pool" is the honest bar, not "exactly one" for every seed), every painted cell across both
      layers resolves to exactly one of `frame`/`imageAsset` (no unmapped cells), plus targeted synthetic
      cases (fully-mud band, empty-bands flat biome, missing edge-set id, non-blob `terrain.base`).

- [x] **Step 8: Generator — scatter (`src/systems/biomeGen/scatter.ts`)** `[inline]`
  - Outcome: `generateScatter({region, layers, field, seed, cellEdgeSet})` in the new `scatter.ts`.
    Reproduces the plan's "shared height/moisture field drives clearings vs. thickets" literally, not
    just conceptually: it does `makeRng(seed)` → `makeNoise2D(rng)` as its very first action — exactly
    what `terrain.ts`'s `assignBands` does — so passing the SAME `seed` (and `terrain.field` params, via
    the new `field` input) as `generateTerrain` reproduces a byte-identical noise lattice; the two calls
    then diverge into independent `Rng` streams so scatter's own draws never disturb terrain's. Per
    layer (processed in array order = "layer stack order"): `poissonSample` at `layer.spacing`, with an
    `accept(x,y)` that hard-rejects cells whose Step-7 `cellEdgeSet` entry is in `avoidTerrains` and
    otherwise returns `noise.fbm(x,y,field) * layer.density` as a keep-probability; each accepted point
    picks a member via `pickWeighted(layer.members, rng.nextFloat)` and, if `layer.clump` is set, rolls
    a `chance` and scatters `count[0]..count[1]` children at a random angle/distance within `radius`
    tiles (dropped, not retried, if out of region bounds or on an avoided cell). Output is `ScatterPlacement`
    (`{kind:'node',ref,col,row,skin?}` int tile-addressed, or `{kind:'decor',asset,x,y}` PIXELS —
    `TILE_SIZE`-scaled from the continuous Poisson coordinate, sub-tile precision kept) — both
    **region-local**; Step 9 adds the region rect's own origin (tiles for node, `* TILE_SIZE` for decor).
    `src/systems/biomeGen/__tests__/scatter.test.ts` (new, 5 tests): determinism, min-spacing honoured
    (decor placements converted back to tile units), density thinning (0.05 vs 1.0 density, same seed),
    zero placements on an `avoidTerrains` cell region, and clumping (every non-parent placement lies
    within `radius` + flooring slack of a Poisson parent). `npm test biomeGen` (`npx vitest run
    biomeGen`) → 15/15 pass (5 new + 10 existing terrain tests); `tsc --noEmit` + eslint + prettier
    clean. Files touched: `src/systems/biomeGen/scatter.ts` (new),
    `src/systems/biomeGen/__tests__/scatter.test.ts` (new).
  - Per `scatter` layer: `poissonSample` at the layer's `spacing`, accept points against the noise
    density field × `layer.density`, choose a member with `pickWeighted(members, rng)`, honour
    `avoidTerrains` (skip cells whose band terrain is excluded — e.g. no trees in the pond) and `clump`
    (parent→children within `radius`). Emit **id-less** placements (`{kind:'node',ref,col,row,skin?}`
    or `{kind:'decor',asset,x,y,…}`) in layer stack order.
  - Files: `src/systems/biomeGen/scatter.ts` + `__tests__/scatter.test.ts` (new). Uses `poisson.ts`,
    `noise.ts`, `rng.ts`, `pickWeighted`; takes Step-7's per-cell terrain assignment for `avoidTerrains`.
  - Side effects: none. Support both decor assets and `tree` `ff_*` node skins for foliage.
  - Docs: none.
  - Done when: deterministic unit test — min-spacing honoured per layer; density field thins points in
    low-density areas; zero placements on `avoidTerrains` cells; clumping produces child clusters.

- [ ] **Step 9: Generator orchestrator + `BiomeResult` (`src/systems/biomeGen/index.ts`)** `[inline]`
  - Compose Steps 7+8 into `generateBiome(region, biomeDef, seed, existing): BiomeResult` where
    `BiomeResult = { tileEdits: Array<{layerRole:'base'|'overlay', frames}>, objects: id-less
    placements, meta:{seed, counts} }`. Apply **edge-falloff** (taper density near the region border)
    and **exclusion** (skip cells outside `isInside` void/shape, and cells already occupied by existing
    objects/tiles passed via `existing`). Define `BiomeResult` in `src/systems/biomeGen/types.ts`.
  - Files: `src/systems/biomeGen/index.ts`, `types.ts`, `__tests__/index.test.ts` (new).
  - Side effects: none (pure). Single entry point the editor calls.
  - Docs: none.
  - Done when: `npm test biomeGen` passes — same `(region,def,seed)` → identical `BiomeResult`; falloff
    reduces near-border density; excluded cells never receive edits/objects.

- [ ] **Step 10: Editor — apply a `BiomeResult` as one undoable batch (`store/slices/biomeSlice.ts`)** `[inline]`
  - Add a `biomeSlice` with `applyBiomeResult(result)`: resolve each `layerRole` to a real layer id
    (base = active/`ground` layer; **overlay** = a dedicated higher-index `TileLayer` via the editor's
    `addLayer`, created above the base only if the biome uses an overlay band), convert `frames` →
    palette indices via `findOrAppendPaletteIndex` → `CellChange[]`, and build **one** `batchCommand`
    combining all tile changes (per layer) + object inserts (mirroring `placeNode`/`placeDecor`, ids
    via `nextObjectId`, gated on `isInside` + `footprintIsValid`). Bump `docRevision` + set
    `pendingDirty` for touched layers/chunks. **The command must be a single atomic undo entry** — this
    is what makes re-roll (undo→regen→apply) clean in Step 11.
  - Files: `src/editor/store/slices/biomeSlice.ts` (new), composed in `editorStore.ts`; reuse
    `store/shared.ts` (`commandFromChanges`), `objectOps.ts` (`batchCommand`/`footprintIsValid`/
    `nextObjectId`), `paintOps.ts` (`findOrAppendPaletteIndex`), the layer-add path used by the layers
    panel.
  - Side effects: adding an overlay layer changes `map.layers` length — confirm `groundRenderer`
    depth-by-index still orders correctly and the layers panel reflects it. Palette appends are
    (by design) outside undo history — matches existing terrain/paint behaviour. Prefer reusing the
    base/`ground` layer when the biome has no overlay band, to avoid layer proliferation on repeated
    applies.
  - Docs: none.
  - Done when: applying a `BiomeResult` to a fixture map produces a map that **passes `parseMap`**
    (void-consistency, palette validity, no object on void), and a single **undo** fully reverts it
    (including any created overlay layer).

- [ ] **Step 11: Editor — `biome` tool + apply-only UI (region + preset + seed + re-roll + apply)** `[inline]`
  - Add `'biome'` to the `EditorTool` union; store state (active biome id, current seed, last-apply
    handle). Reuse the Select-tool **marquee** (`regionGeometry`/`RegionRect`) for the region. Add a
    Toolbar entry (`Toolbar.tsx` `TOOLS`) and pointer dispatch in `EditorInputController.ts`. Add a
    compact **apply panel** (`panels/BiomePanel.tsx`): preset picker (from the fetched catalog), seed
    input, and **Generate / Re-roll / Apply** buttons — **Re-roll = undo the previous apply (if this
    tool made one) → `generateBiome` with a new seed → `applyBiomeResult`** (no ghost-preview infra).
    Mirror the core actions in `ContextBar.tsx` for the **compact/touch** shell (phone authoring).
    Show a live/last **count estimate** from `BiomeResult.meta.counts`.
  - Files: `store/types.ts` (union), `biomeSlice.ts` (extend), `Toolbar.tsx`,
    `scene/EditorInputController.ts`, `panels/BiomePanel.tsx` (new), `ContextBar.tsx`; shadcn primitives
    from `ui/*`. Reuse `regionOps.ts`/`regionGeometry.ts`.
  - Side effects: honour `useIsCompact` (drawer vs panel). Guard re-roll so it only undoes *its own*
    last apply (don't blow away unrelated undo history) — track the applied command/epoch and no-op if
    the user did other edits since.
  - Docs: none (Step 12).
  - Done when: draw a region → pick Forest → Apply commits it as one undo step → Re-roll cleanly
    replaces it with a new layout → final Apply persists; usable in the compact shell (resize below the
    breakpoint to verify).

- [ ] **Step 12: Docs + DECISIONS** `[delegate]`
  - Concise, high-signal updates: `docs/STATUS.md` (+ biome generation), `docs/DECISIONS.md` (record:
    biome painter as **owner-approved off-roadmap enabling tooling** [Finding #5]; height-band patches;
    the **Step-2 overlay-vs-opaque water outcome**; config-driven terrain onboarding with **per-sheet
    COLS**; Poisson+noise scatter; bake-into-map; rectangle-first; **v1 apply-only, define-panel +
    ghost-preview deferred to v2**; pairwise-transitions=v2), `docs/CONVENTIONS.md` (the
    `src/systems/biomeGen/` pure-system seam + the editor biome-tool seam), a new `docs/BIOMES.md`
    (**how to onboard a terrain** via `gen_terrains.py` incl. per-sheet COLS + **how to define/extend a
    biome** by editing `biomes.json`), and the `CLAUDE.md` Status line. Update `docs/README.md` index
    for the new leaf.
  - Files: `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/CONVENTIONS.md`, `docs/BIOMES.md` (new),
    `docs/README.md`, `CLAUDE.md`.
  - Side effects: markdownlint (`.md` pre-commit hook) — keep within limits; verify links resolve.
  - Done when: docs updated, links valid, markdownlint clean.

## Parallelism

- **(parallel: A) — Steps 4 & 5** (`noise.ts`, `poisson.ts`): both `[delegate]`, both depend only on
  Step 3 (`rng.ts`), write-disjoint, no interdependency (Poisson takes density as a param, never
  imports `noise.ts`). Run concurrently after Step 3.
- All other steps are sequential: Steps 1–2 share the terrain-onboarding files (and Step 2 is a
  decision gate for the rest); Steps 6–11 form a dependency chain (data → generator → editor); Steps
  1, 2, 6–11 are `[inline]` (need judgement) and are never parallelised.

## Out of scope (v1)

- **Non-destructive ghost/preview overlay** (translucent render before commit) — v2. Re-roll uses
  undo→regenerate→apply instead.
- **In-editor define-mode panel** (select/deselect members + weight/density sliders in the UI) — v2.
  v1 authors biome content by editing `biomes.json`; the data model already supports the full surface.
- **Freeform/polygon/brush region select** (rectangle only).
- **Persisted biome regions / non-destructive re-generation** in the saved map (we bake into the
  `MapFile`; re-gen = undo + re-run).
- **Pairwise terrain→terrain blend tiles** (the 81-tile S-V3 case) — the transparent overlay-edge
  approach removes the need for v1.
- **Quarter-tile / RPG-Maker-A2 autotiling** and any second autotile engine — reuse the blob autotiler
  only.
- **Runtime/procedural generation in-game** — authoring-time editor tool; the game still boots
  authored maps.
- **Non-Forest biomes** (Swamp, Rocky, etc.) — the data model supports them; only Forest ships. Extra
  biomes are a `biomes.json` edit.

## Critique

> Independent fresh-eyes review (/critique-plan). Findings folded into the steps above.

**Verdict:** A genuinely well-researched, architecturally-aligned plan (pure Phaser-free systems,
faithful reuse of the blob autotiler and the command/undo/palette pipeline) — but it front-loaded an
uncertain water-onboarding spike underpinning a load-bearing decision, and over-built the editor UX
(ghost preview + full define-mode panel) for a one-biome v1; both addressed below.

|#|Finding|Severity|Resolution|
|-|-------|--------|----------|
|1|Water onboarding is an uncertain spike on a different sheet; `COLS=25` is Floors-specific so `frame=row*COLS+col` breaks for water; overlay-pond premise (land-side transparency) only asserted.|High|Step 2 rewritten as an explicit upfront spike with PNG-verified transparency, per-sheet `cols` in the config tuple (Step 1), and a documented opaque fallback + decision gate before the generator chain.|
|2|Editor UX over-built for v1: ghost preview had no render mechanism; re-roll can be undo→regen→apply; define-mode panel large yet in-memory-only with only Forest shipping.|Medium|v1 trimmed to apply-only (Step 11); ghost preview + define-mode panel moved to Out of scope (v2).|
|3|`biomes.json` in `src/data/maps/` would bundle it like game content; biomes are editor-only like `terrains.json`.|Medium|Step 6 moves it to `public/assets/…/biomes.json`, fetched via a `biomeCatalogSource.ts` mirroring `terrainCatalogSource.ts`.|
|4|Step 1 grass "byte-identical" guard was soft — the parity fixture regenerates with the script, so it can't detect grass drift.|Medium|Step 1 adds a separate grass-block invariance check on the committed `terrains.json`.|
|5|Biome painter isn't on the roadmap (post-MVP crafting/content, multi-map, richer enemies).|Medium|Proceeding as owner-approved off-roadmap enabling tooling; recorded in DECISIONS (Step 12).|
|6|"No seeded PRNG exists" was wrong — `mulberry32` already in `monsterAI.test.ts`, `stepMonster` threads an `rng` param.|Low|Step 3 consolidates that `mulberry32`; claim corrected in Context.|
