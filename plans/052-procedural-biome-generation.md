# Procedural Biome Generation (Editor)

> Status: planned — run /execute-plan to begin.

## Summary

A dev-only **Map Builder** feature to **paint biomes** instead of hand-placing every tree, bush and
rock. Draw a rectangular region, pick a **biome preset** (first: **Forest**), and a **pure, seeded
generator** produces coherent layered content that **bakes into the canonical `MapFile`** (tiles +
objects) as one undoable command — the runtime then consumes it as ordinary hand-authored content
(no map-format change, no runtime awareness).

A biome is **data** (`BiomeDef` in `biomes.json`) — an ordered layer stack, each layer with a
palette of members you **select/deselect** and **weight**, plus per-layer **density/spacing**. The
stack: **base terrain → auto edge → ground detail → foliage → nodes**, with a shared **height/moisture
noise field** that carves **terrain patches** (a **pond** at the lowest band, **mud** ringing it) and
drives **clearings vs. thickets**. Coherent edges come from the **existing blob autotiler**
(`src/systems/autotile.ts`) — the generator only produces masks; tiling is already solved offline.
Scatter uses **Poisson-disk sampling** (min-distance = the "space to move / see the ground"
guarantee) modulated by the noise density field.

Proof is the generator itself: draw a region → generate a Forest → get walkable, natural-looking
forest with a pond+mud patch, edged correctly, re-rollable by seed, applied as one undo step.

## Context & decisions

**Owner decisions (settled with Matt — do NOT re-litigate):**

- **Region select:** rectangle-first, reusing the existing `RegionRect` + Select-tool marquee.
  Freeform/polygon/brush regions are out (v2).
- **Apply model:** **bake into the canonical `MapFile`** (tile `CellChange`s + `MapObject`s) as one
  `batchCommand`. No biome metadata persisted in the map; regeneration = undo + re-run. No
  map-format change.
- **Define vs. apply:** *defining* a biome is rich (select/deselect/weight per layer); *applying* is
  simple (pick preset + seed + re-roll + preview + apply).
- **Coherent tiling:** **config-driven offline generation** — extend `scripts/pixel-crawler/
  gen_terrains.py` to onboard multiple terrains; the editor calls the existing blob autotiler
  (`paintMask`), it grows **no tiling code of its own**. **Pairwise terrain→terrain blend tiles are
  out (v2)** — the overlay-edge trick below removes the need for v1.
- **Terrain patches:** a **shared height/moisture noise field** with **sorted threshold bands** —
  lowest band = **pond (water)**, next band = **mud**, rest = base **grass**. Gives the concentric
  pond→mud ring for free.
- **Overlay edges:** the Forest's **pond uses `Water_tiles.png`** blob tiles, whose land-facing sides
  are **transparent** (designed to overlay) — so pond edges bake onto a **layer above** the base and
  composite over grass/mud. **Mud = the existing `dirt` terrain** (opaque, `Floors_Tiles.png`), baked
  into the base layer.
- **Density model:** two knobs — **per-layer density/spacing** (min-distance for node/foliage layers,
  coverage % for ground detail) + **per-entry weight** (`pickWeighted`).
- **Scatter:** **Poisson-disk (Bridson)** + a **Perlin/value noise density field**, **seeded /
  deterministic** so re-roll is reproducible.

**Key findings from research — patterns/files to mirror (verified against the tree):**

- **Blob autotiler is done and terrain-count-agnostic.** `src/systems/autotile.ts`
  (`blobKey`/`paintMask`/`pickFrame`, `TerrainMapping`) consumes whatever `TerrainDef`s exist.
  `src/editor/terrainCatalog.ts` = `TerrainDef {id,name,pack,sheet,fillFrame,mapping}` loaded from
  `public/assets/tilesets/pixel-crawler/terrains.json` (**only `grass` today**).
  `src/editor/terrainOps.ts` (`computeTerrainBake`/`buildTerrainCommand`) = mask→baked-cells glue.
- **Terrain onboarding pipeline** (offline Python → committed JSON → TS + parity test):
  `scripts/pixel-crawler/autotile.py` `build_blob(rel, c0,c1,r0,r1, tol=48)` reads a sheet box and
  returns `{blob_key: [(c,r),…]}`; its `__main__` **already defines `DIRT (11,15,0,12)` and
  `GRAVEL (5,9,0,12)` boxes** (grass = `(0,4,0,12)`, `COLS=25`, `frame=row*25+col`).
  `scripts/pixel-crawler/gen_terrains.py` wraps grass only → writes `terrains.json` +
  `src/editor/__tests__/fixtures/grass-terrain-parity.json`. `src/editor/__tests__/terrainOps.test.ts`
  suite 1 asserts TS `paintMask` reproduces the fixture (`resolveIndex = frame+1`). Water lives in a
  **separate sheet** `Water_tiles.png` (no box yet — discover via `scripts/pixel-crawler/
  gridoverlay.py`/`blob_map.py`); its edge tiles are **transparent on land sides** (per
  `autotile.py:3-7`).
- **Layers & draw order:** `MapFile.layers` ordered bottom→top; `src/scenes/world/groundRenderer.ts`
  `drawMapLayers` sets `depth = overhead ? OVERHEAD_LAYER_DEPTH(20) : layerIndex` — **later index draws
  over earlier**, so an overlay terrain = a **higher-index `TileLayer`**. `TerrainSection
  {layerId,terrainId,cells}` is **editor-only** (game reads baked `TileLayer.cells`); a terrain's
  **target layer is the editor's active layer at paint time**, not bound in the `TerrainDef`. No
  alpha field on palette/layer — transparency is the PNG's own pixels.
- **No noise, no seeded PRNG exist** anywhere (`src/` is all `Math.random()`; no dep in
  `package.json`). `pickWeighted` (`src/data/tileset.ts:~881`) uses `Math.random()` and takes no RNG.
  Both a seeded PRNG and a noise field must be **added** as pure `src/systems/` modules (vitest-able,
  Phaser-free, matching `autotile.ts`).
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
  `randomiseWorld()` (unseeded rejection sampling).

**Direction (README/CLAUDE.md/ROADMAP):** MVP path is complete; post-MVP crafting shipped. Game
premise = "by day scavenge the camp/forest". A biome painter is **content-authoring tooling** that
accelerates building those forests — aligned with the data-driven / pure-system / decoupled-scene
architecture and the "author on a phone via guppi" workflow (hence the ContextBar requirement). No
runtime/gameplay surface changes; dev-only, excluded from prod build.

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

**Testing (per CLAUDE.md):** verify each step with a **targeted unit run** (`npm test <file>`) or the
**one** guarding spec — never the full `npm run e2e`/`check:all` mid-work (that's CI's job).

## Steps

- [ ] **Step 1: Prove the tiling — generalise `gen_terrains.py`, onboard `dirt`, parity-test it** `[inline]`
  - Refactor `scripts/pixel-crawler/gen_terrains.py` to loop over a **list** of terrain configs
    `(id, name, sheet, box)` instead of the single hardcoded `GRASS_BOX`/`SHEET`, appending each
    `TerrainDef` to `terrains.json`'s `terrains[]` and emitting a per-terrain parity fixture. Add
    **`dirt`** using the box already in `autotile.py:__main__` (`(11,15,0,12)`, sheet
    `Floors_Tiles.png`). Re-run `python3 scripts/pixel-crawler/gen_terrains.py` then
    `npx prettier --write` `terrains.json` + the fixtures. Parameterise `terrainOps.test.ts` suite 1
    over `[{id:'grass',fixture},{id:'dirt',fixture}]`.
  - Files: `scripts/pixel-crawler/gen_terrains.py`, `public/assets/tilesets/pixel-crawler/terrains.json`
    (regenerated), `src/editor/__tests__/fixtures/dirt-terrain-parity.json` (new),
    `src/editor/__tests__/terrainOps.test.ts`. Read (don't edit) `autotile.py` for `build_blob`/boxes.
  - Side effects: `terrains.json` is loaded by `terrainCatalog.ts`; the editor Library auto-lists the
    new `dirt` terrain — confirm it appears and paints. Grass mapping/frames must be **byte-identical**
    after the refactor (regression guard).
  - Docs: none yet (Step 13 writes the onboarding recipe).
  - Done when: `npm test terrainOps` passes for grass **and** dirt; arming **Dirt** in the editor and
    painting a blob shows coherent straight edges, outer + inner corners (visual smoke).

- [ ] **Step 2: Onboard the `water` terrain as a transparent overlay** `[inline]`
  - Discover the water blob's bounding box in `Water_tiles.png` using
    `scripts/pixel-crawler/gridoverlay.py` + `blob_map.py`, add a `water` entry (sheet
    `Environment/Tilesets/Water_tiles.png`) to the Step-1 terrain list, regenerate `terrains.json` +
    a `water-terrain-parity.json` fixture, and extend the parameterised parity test. Water's edge
    tiles are **transparent on land sides** — record (in the `TerrainDef`/a comment) that water must
    bake onto a **layer above** the base so grass shows through the coast.
  - Files: same as Step 1 (generator, `terrains.json`, new `water-terrain-parity.json`,
    `terrainOps.test.ts`).
  - Side effects: none at runtime (dev data). If the water box can't be cleanly isolated by colour,
    fall back to a hand-authored `mapping` for water and note it in the file's `_comment`.
  - Docs: none yet.
  - Done when: water parity test passes; painting water on a **higher-index layer** over grass in the
    editor shows grass through the transparent coast (visual smoke).

- [ ] **Step 3: Seeded PRNG (`src/systems/rng.ts`) + optional-RNG `pickWeighted`** `[delegate]`
  - Add a pure seeded PRNG (mulberry32) as `makeRng(seed): Rng` with `nextFloat()` (`[0,1)`),
    `nextInt(nExcl)`, `pick(array)`. No Phaser import. Add `src/systems/__tests__/rng.test.ts`
    asserting determinism (same seed → same sequence) and range bounds. Give `pickWeighted`
    (`src/data/tileset.ts`) an **optional** `rng?: () => number` param defaulting to `Math.random`.
  - Files: `src/systems/rng.ts` (new), `src/systems/__tests__/rng.test.ts` (new),
    `src/data/tileset.ts` (add optional param).
  - Side effects: all existing `pickWeighted` callers keep working (param optional) — do **not** change
    call sites. Run the tileset/existing unit tests to confirm no regression.
  - Docs: none.
  - Done when: `npm test rng` passes; existing unit tests still green.

- [ ] **Step 4: Value/fbm noise field (`src/systems/noise.ts`)** `[delegate]` (parallel: A)
  - Add a seeded 2D value-noise + fbm field: `makeNoise2D(rng)` → `sample(x, y): number` in `[0,1]`,
    plus an fbm wrapper `(x,y,{octaves,scale}) → [0,1]`. Pure, Phaser-free, seeded via the Step-3
    `Rng`. Unit test determinism, output range, and rough spatial continuity (adjacent samples close).
  - Files: `src/systems/noise.ts` (new), `src/systems/__tests__/noise.test.ts` (new). Imports
    `src/systems/rng.ts`.
  - Side effects: none (new module).
  - Docs: none.
  - Done when: `npm test noise` passes.

- [ ] **Step 5: Poisson-disk sampler (`src/systems/poisson.ts`)** `[delegate]` (parallel: A)
  - Implement Bridson fast Poisson-disk sampling, seeded via the Step-3 `Rng`:
    `poissonSample({width,height,radius,rng,accept?})` → `Array<{x,y}>`, where `accept?(x,y): boolean`
    (or a `0..1` probability) lets a caller reject/thin points against a density field. `radius` = min
    distance between points (in tiles). Unit-test: no two points closer than `radius`; determinism;
    `accept` thinning reduces count.
  - Files: `src/systems/poisson.ts` (new), `src/systems/__tests__/poisson.test.ts` (new). Imports
    `src/systems/rng.ts` only (NOT `noise.ts` — density is passed in, keeping this write-disjoint from
    Step 4).
  - Side effects: none (new module).
  - Docs: none.
  - Done when: `npm test poisson` passes.

- [ ] **Step 6: `BiomeDef` schema, catalog + Forest preset** `[inline]`
  - Add `src/data/biomes.ts` (typed access) + `src/data/maps/biomes.json` (catalog, mirroring
    `nodes.json`) + a strict validator `src/systems/biomeDefs.ts` (mirror `parseNodeDefs` in
    `src/systems/nodeDefs.ts` — fail loudly on bad refs/shape). Encode the `BiomeDef` shape from
    Context. Author the **Forest** preset: base `grass`; height bands `water(overlay,~0.22)` +
    `dirt(base,~0.38)`; scatter layers `groundDetail` (decor, small spacing, high density),
    `foliage` (ferns/tufts + `tree` `ff_*` skins), `nodes` (`tree` big spacing, `rock`, `berryBush*`
    with a `clump`), nodes `avoidTerrains:['water']`. Validate member `ref`s exist against
    `NODES`/catalog/`terrains.json`.
  - Files: `src/data/biomes.ts`, `src/data/maps/biomes.json`, `src/systems/biomeDefs.ts`,
    `src/systems/__tests__/biomeDefs.test.ts` (all new).
  - Side effects: none at runtime (editor/generator-only data). Ensure the file isn't pulled into the
    game bundle unnecessarily.
  - Docs: Step 13 documents authoring; leave a header comment pointing there.
  - Done when: `npm test biomeDefs` passes (valid Forest parses; a malformed def throws with a clear
    path).

- [ ] **Step 7: Generator — terrain + height-band patches (`src/systems/biomeGen/terrain.ts`)** `[inline]`
  - Given `(region, biomeDef, seed)`: build the shared height field (Step-4 noise, `biomeDef.terrain.
    field`), assign each in-region cell the first band whose `maxHeight ≥ noise` (else base terrain),
    producing a **0/1 mask per terrain**. Autotile each mask via its `TerrainDef.mapping` using
    `autotile.paintMask` → per-cell frames, tagged with the band's `layer` role (`'base'|'overlay'`).
    Return a structured terrain result (frames per layer role) — no map mutation here (pure).
  - Files: `src/systems/biomeGen/terrain.ts` + `src/systems/biomeGen/__tests__/terrain.test.ts` (new).
    Uses `noise.ts`, `autotile.ts` (`paintMask`), and reads `terrains.json` mappings (inject the
    catalog, don't fetch).
  - Side effects: none (pure). The `overlay` role is a logical tag; Step 10 resolves it to a real
    layer.
  - Docs: none.
  - Done when: deterministic unit test — a fixed seed yields stable masks; the water band forms a
    contiguous low pool with the mud band ringing it (concentric); edge frames resolve (no unmapped
    cells beyond the fallback tiers).

- [ ] **Step 8: Generator — scatter (`src/systems/biomeGen/scatter.ts`)** `[inline]`
  - For each `scatter` layer: run `poissonSample` at the layer's `spacing`, accept points against the
    noise **density field** × `layer.density` (clearings/thickets), choose a member with
    `pickWeighted(members, rng)`, honour `avoidTerrains` (skip cells whose band terrain is excluded,
    e.g. no trees in the pond) and `clump` (parent→children within `radius`). Emit **id-less**
    placements — `{kind:'node', ref, col, row, skin?}` or `{kind:'decor', asset, x, y, …}` — in the
    layer's stack order.
  - Files: `src/systems/biomeGen/scatter.ts` + `__tests__/scatter.test.ts` (new). Uses `poisson.ts`,
    `noise.ts`, `rng.ts`, `pickWeighted`. Takes the Step-7 per-cell terrain assignment as input for
    `avoidTerrains`.
  - Side effects: none (pure). Foliage may use both decor assets and `tree` `ff_*` node skins — support
    both `kind`s.
  - Docs: none.
  - Done when: deterministic unit test — min-spacing honoured per layer (no two nodes closer than
    `spacing`); density field visibly thins points in low-density areas; zero node/foliage placements
    land on `avoidTerrains` cells; clumping produces child clusters.

- [ ] **Step 9: Generator orchestrator + `BiomeResult` (`src/systems/biomeGen/index.ts`)** `[inline]`
  - Compose Steps 7+8 into `generateBiome(region, biomeDef, seed, existing): BiomeResult`, where
    `BiomeResult = { tileEdits: Array<{layerRole:'base'|'overlay', frames}>, objects: id-less
    placements, meta:{seed, counts} }`. Apply **edge-falloff** (taper density near the region border so
    the biome blends rather than hard-cutting) and **exclusion** (skip cells outside `isInside`
    void/shape, and cells already occupied by existing objects/tiles passed in via `existing`). Define
    the `BiomeResult` type in a shared `src/systems/biomeGen/types.ts`.
  - Files: `src/systems/biomeGen/index.ts`, `src/systems/biomeGen/types.ts`,
    `src/systems/biomeGen/__tests__/index.test.ts` (new).
  - Side effects: none (pure). This is the single entry point the editor calls.
  - Done when: `npm test biomeGen` passes — same `(region,def,seed)` → identical `BiomeResult`
    (determinism); falloff reduces near-border density; excluded cells never receive edits/objects.

- [ ] **Step 10: Editor — apply a `BiomeResult` as one undoable batch (`store/slices/biomeSlice.ts`)** `[inline]`
  - Add a `biomeSlice` with `applyBiomeResult(result)`: resolve each `layerRole` to a real layer id
    (base = active/`ground` layer; **overlay** = a dedicated higher-index `TileLayer`, created above the
    base if absent), convert `frames` → palette indices via `findOrAppendPaletteIndex` →
    `CellChange[]`, and build **one** `batchCommand` combining all tile changes (per layer) + object
    inserts (mirroring `placeNode`/`placeDecor`, ids via `nextObjectId`, gated on `isInside` +
    `footprintIsValid`). Bump `docRevision` + set `pendingDirty` for the touched layers/chunks.
  - Files: `src/editor/store/slices/biomeSlice.ts` (new), composed in `store/editorStore.ts`; reuse
    `store/shared.ts` (`commandFromChanges`), `objectOps.ts` (`batchCommand`,`footprintIsValid`,
    `nextObjectId`), `paintOps.ts` (`findOrAppendPaletteIndex`), `serialize.ts`/layer helpers for
    creating the overlay layer.
  - Side effects: creating a new overlay layer changes `map.layers` length — verify `groundRenderer`
    depth-by-index still orders correctly and the layers panel reflects it. Palette appends are (by
    design) outside undo history — matches existing terrain/paint behaviour.
  - Docs: none.
  - Done when: applying a `BiomeResult` to a fixture map produces a map that **passes `parseMap`**
    (void-consistency, palette validity, no object on void), and a single **undo** fully reverts it.

- [ ] **Step 11: Editor — `biome` tool: region + generate/seed/re-roll + non-destructive preview** `[inline]`
  - Add `'biome'` to the `EditorTool` union; store state (active biome id, seed, last `BiomeResult`).
    Reuse the Select-tool **marquee** (`regionGeometry.resizeBox`/`RegionRect`) for the region.
    Wire pointer dispatch in `EditorInputController.ts` (region drag) and a Toolbar entry
    (`Toolbar.tsx` `TOOLS`). On generate, call `generateBiome(...)` and render a **translucent preview
    overlay** in `EditorScene` (ghost tiles/objects, NOT written to the map). **Re-roll** = new seed →
    regenerate preview. **Apply** = Step-10 `applyBiomeResult` + clear preview.
  - Files: `src/editor/store/types.ts` (union), `biomeSlice.ts` (Step 10, extend), `Toolbar.tsx`,
    `scene/EditorInputController.ts`, `scene/*` (a preview render controller). Reuse
    `regionOps.ts`/`regionGeometry.ts`.
  - Side effects: preview must respect DOM `pointer-events` gating; ensure switching tools/regions
    clears the preview so it can't be applied stale.
  - Docs: none.
  - Done when: draw a region → pick Forest → preview renders over the region → re-roll changes the
    layout → Apply commits it as one undo step; no preview state leaks after apply/cancel.

- [ ] **Step 12: Editor — Biome panel + ContextBar (define + apply UI)** `[inline]`
  - Add `panels/BiomePanel.tsx`: **define** mode (per-layer sections — member **chips** to
    select/deselect with a **weight** stepper; layer **density/spacing** sliders; terrain-band editor;
    an "add selection to layer" action reusing the **Library/favourites**) and **apply** mode (preset
    picker, seed input, generate/re-roll/apply buttons, a **live count estimate**). Add the biome case
    to `ContextBar.tsx` so the core actions (generate / re-roll / apply / density) work on the
    **compact/touch** shell. Edits to a `BiomeDef` write back to the in-memory catalog (persisting to
    `biomes.json` from the editor is optional/v2 — note it).
  - Files: `src/editor/panels/BiomePanel.tsx` (new), `ContextBar.tsx`, biome slice actions; shadcn
    primitives from `src/editor/ui/*`.
  - Side effects: honour `useIsCompact` (drawer vs panel). Keep the panel read/writes off the Phaser
    thread (store-only), per the bridge rule.
  - Docs: none (Step 13).
  - Done when: a biome def can be built/tweaked in the panel and drives generation; the flow is usable
    in the compact shell (drawer + ContextBar) — validated by resizing below the breakpoint.

- [ ] **Step 13: Docs** `[delegate]`
  - Concise, high-signal updates: `docs/STATUS.md` (+ biome generation), `docs/DECISIONS.md` (settled:
    height-band patches, overlay edges, config-driven terrain onboarding, Poisson+noise, bake-into-map,
    rectangle-first, pairwise-transitions=v2), `docs/CONVENTIONS.md` (the `src/systems/biomeGen/`
    pure-system seam + editor biome tool seam), a new `docs/BIOMES.md` (**how to onboard a terrain** via
    `gen_terrains.py` + **how to define/extend a biome** in `biomes.json`), and the `CLAUDE.md` Status
    line. Update `docs/README.md` index if a new leaf is added.
  - Files: `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/CONVENTIONS.md`, `docs/BIOMES.md` (new),
    `docs/README.md`, `CLAUDE.md`.
  - Side effects: markdownlint (`.md` pre-commit hook) — keep within limits; verify links resolve.
  - Done when: docs updated, links valid, markdownlint clean.

## Parallelism

- **(parallel: A) — Steps 4 & 5** (`noise.ts`, `poisson.ts`): both `[delegate]`, both depend only on
  Step 3 (`rng.ts`), write-disjoint, no interdependency (Poisson takes density as a param, never
  imports `noise.ts`). Run concurrently after Step 3.
- All other steps are sequential: Steps 1–2 share the terrain-onboarding files; Steps 6–12 form a
  dependency chain (data → generator → editor); Steps 1, 2, 6–12 are `[inline]` (need judgement) and
  are never parallelised.

## Out of scope (v1)

- **Freeform/polygon/brush region select** (rectangle only).
- **Persisted biome regions / non-destructive re-generation** in the saved map (we bake into the
  `MapFile`; re-gen = undo + re-run).
- **Pairwise terrain→terrain blend tiles** (the 81-tile S-V3 case) — the transparent overlay-edge
  approach removes the need for v1.
- **Quarter-tile / RPG-Maker-A2 autotiling** and any second autotile engine — we reuse the existing
  blob autotiler only.
- **Runtime/procedural generation in-game** — this is an authoring-time editor tool; the game still
  boots authored maps.
- **Non-Forest biomes** (Swamp, Rocky, etc.) — the data model supports them; only Forest ships. Extra
  biomes are then a `biomes.json` edit.
- **Saving `BiomeDef` edits back to `biomes.json` from the editor UI** (define-mode edits are
  in-memory in v1).
