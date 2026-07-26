# Tile Edge Sets — the biome tiling pipeline

How we turn a raw tileset sheet into a **tile edge set**: committed JSON that says which tiles exist,
which of their edges/corners join, what's walkable, and how to scatter them — so the editor/runtime
does O(1) lookups and never touches pixels. The baker is
[`scripts/pixel-crawler/bake_edge_set.py`](../scripts/pixel-crawler/bake_edge_set.py); outputs land in
`public/assets/tilesets/pixel-crawler/edge-sets/<id>.json` plus a `bake_edge_set_demo.png`.

> **Onboarding a new sheet (e.g. muddy patches) from a fresh chat?** Read this whole doc first, then
> jump to [Onboarding a new sheet](#onboarding-a-new-sheet-step-by-step). The
> [Gotchas](#gotchas--hard-won-lessons) are the things that cost hours the first time — don't skip them.

## Two methods

Which one a sheet uses depends on how its tiles express an edge:

|Method|Use when|Edge is…|Example|Emits|
|---|---|---|---|---|
|**blob**|tiles have **alpha** edges (terrain vs transparent)|an alpha cutout|grass, dirt|`mapping` (blob-key → frame) + one `surfaces[]` fill|
|**depth**|tiles are **opaque**; a boundary is a **colour** transition|a colour ramp|water, mud|`levels[]` + `coast` + `transitions[]` + `generate`|

The blob method is the 8-neighbour autotiler from `autotile.py` (same one `gen_terrains.py` uses). The
rest of this doc is the **depth** method, which is the harder, richer one.

## The depth method

A depth set is an **ordered ramp of near-uniform shade LEVELS** (e.g. `shallow < mid < deep`) joined by
**corner dual-grid transition autotiles**, plus a **coast** autotile against the surrounding terrain,
plus per-level **solid fill variants**. Every display tile sits over a world-grid **vertex** and is
chosen by the level on its **four corners** — exactly like a marching-squares / dual-grid autotiler,
but the "materials" are adjacent depth levels instead of on/off.

### The pieces

- **Levels** — each a near-uniform opaque shade with a base `fill` frame, a `walkable` flag, and an
  `rgb`. A level with no fill tile in the art is `authored`: a flat synthesized tile of its shade. A
  level whose sheet fill tile is decorated rather than plain-looking can instead set `fillAuthored`: the
  default background is a flat synthesized tile (like `authored`) while its normal scattered-variants
  pool (ripples, rings, …) is kept intact — see [Gotchas](#gotchas--hard-won-lessons).
- **Transitions** — one **corner autotile per adjacent level pair** (shallow↔mid, mid↔deep). Each maps
  a **case** (4 corner bits, `1` where the corner is the shallower level, order `NW NE SW SE`) to a
  **list** of `[frame, rot]` options. A handful of base tiles, in their 4 rotations, cover ~13 of 16
  cases; the two **saddle** cases (`6`, `9`) have no tile and are engineered away (see below).
- **Coast** — a land-vs-water corner autotile (case = corner bits, `1` where the corner is water) →
  `[frame, rot]` list. Multi-option across the sheet's repeated coast blocks, but **not rotated** (coast
  art is directional: grass tufts hang down, lighting is top-down).
- **Fill variants** — extra solid tiles of a level's shade with **interior** decoration (ripples,
  swirls) that get scattered for texture. These live **only in the surface rows** of the sheet.

### The generator (distance + noise, repaired)

`generate` params drive the lake/patch generator (`depth_field` + `render_depth_lake` in the baker are
the reference implementation and the acceptance guard):

1. **Depth field** — for each water cell, `distance-from-shore` (BFS) + smooth value noise, quantised by
   `bands`. Mostly distance (concentric depth); noise wobbles the band boundaries so it isn't uniform.
2. **Repair** — make the field tileable. Two passes, both **monotone-lowering** (so they always
   terminate): **erode** until every king-adjacent (8-neighbour) cell pair differs by ≤1 level ⇒ every
   2×2 spans ≤1 level ⇒ an adjacent-level transition tile always exists; then **break saddles** (lower
   the diagonal high pair of any checkerboard 2×2). After repair, **every 2×2 is tileable**.
3. **Place** — at each vertex read the 4 corner levels: all-land → skip; some land → coast; all one
   level → a scattered fill variant; two adjacent levels → the transition case, **random option** for
   variety.

The guard: the demo MUST print `invalid tiles = 0`. Non-zero means the field produced a corner pattern
with no tile — a repair or coverage bug.

## Onboarding a new sheet, step by step

### 1. Map the sheet layout

Open the sheet zoomed with frame numbers (`frame = row*cols + col`). Identify:

- **Coast block(s)** — the terrain-in-water (or terrain-in-mud) tiles giving the shore. Note their
  `rows`/`cols` range.
- **Transition block(s)** — the opaque ramp autotiles. Each block is **one adjacent level pair**. Note
  each block's `box = (c0, c1, r0, r1)` and which two levels it joins (bright = shallower).
- **Surface rows** — where the solid decorative fills live (for Pixel Crawler water: rows 0–1, the
  water around the island tops). These become `variant_rows`.
- **Level count** and order (shallow→deep). Which deepest level has no fill tile (→ `authored`).

Handy checks while mapping (adapt in a scratch script — see the baker's helpers `corner_shades`,
`kmeans2`, `block_centroids`, `build_corner_map`):

- Per-block 2-means on corner colours gives that block's two level shades — verify they separate.
- Run `build_corner_map` on a candidate block and print `{case: len(options)}`: you want ~13 non-saddle
  cases covered, several options each. Missing non-saddle cases mean the block box is wrong or a fill
  got mis-slotted — check the tiles by eye before trusting it.

### 2. Add a config entry

Add to `SETS` in the baker (fields in [Config reference](#config-reference)). Levels shallow→deep,
one `blocks` entry per transition pair, `variant_rows` = the surface rows, deepest level `authored` if
it has no fill tile.

### 3. Run + verify

```bash
python3 scripts/pixel-crawler/bake_edge_set.py
npx prettier --write public/assets/tilesets/pixel-crawler/edge-sets/*.json
```

- Console must say `transitions all cases covered` (or list only saddles) and `invalid tiles = 0`.
- Open `scripts/pixel-crawler/bake_edge_set_demo.png` — check: no hard seams, no stray decoration in
  flat fill, coast tiles the shore cleanly, depth reads correctly (shallow at the edge).

### 4. Tune (config only, then re-run)

- Depth zones too uniform → raise `noise.amp`; too broken → lower it. Patch size → `noise.scale`.
- Band thicknesses → `bands` (e.g. widen the mid band by pushing the deep threshold out).
- Texture density → `scatterRate`.
- Deep too flat/light → give the `authored` deep level a darker `rgb`, or point it at a real dark fill.

## Config reference

A `SETS` entry (`kind` selects the builder):

```python
# blob
{"kind": "blob", "id": "grass", "name": "Grass", "sheet": FLOORS, "box": (c0, c1, r0, r1),
 "role": "ground", "walkable": True,
 "accent_tol": 8,          # max RGB dE an accent's mean may sit from base before dropped (shade knob)
 "edge_th": EDGE_TH,       # rotation-variety edge-class floor (auto-relaxes per sheet)
 "prefer": "bright"}       # pick the bright/dark shade cluster when a sheet has two (else centroid)

# depth
{"kind": "depth", "id": "water", "name": "Water", "sheet": WATER,
 "coast_rows": (0, 5), "coast_cols": (0, 25),          # where the coast (terrain-vs-water) tiles are
 "blocks": [                                           # one per ADJACENT level pair, bright = shallower
     {"box": (0, 5, 5, 15), "bright": 0, "dark": 1},   # shallow(0) <-> mid(1)
     {"box": (5, 10, 5, 15), "bright": 1, "dark": 2},  # mid(1) <-> deep(2)
 ],
 "variant_rows": (0, 2),                               # rows holding SOLID surface-decoration fills
 "level_meta": [                                       # shallow -> deep
     {"name": "shallow", "walkable": True, "fillAuthored": True},  # flat synth BACKGROUND, real variants
     {"name": "mid", "walkable": False},
     {"name": "deep", "walkable": False, "authored": True},  # authored = flat synth tile of its shade
 ],
 "generate": {"bands": [2.5, 8.5],                     # distance+noise thresholds: <2.5=L, <8.5=M, else D
              "noise": {"amp": 3.0, "scale": 4, "seed": 5},
              "scatterRate": 0.35, "distance": "bfs"}}
```

## Gotchas — hard-won lessons

- **Classify per-block 2-material, not one global N-way split.** Adjacent water levels are only ~14 RGB
  apart (foam adds noise); a global split mislabels. Each transition block contains exactly its own two
  shades, so a binary k-means per block is robust. The shared middle level's shade is averaged across
  the blocks that touch it.
- **Collect ALL `[frame, rot]` per case, not the first.** A few base tiles rotate to cover most cases;
  keeping every option (and every rotation — they read a little differently) is what gives placement
  variety. `setdefault(...).append(...)`, never `setdefault(..., first)`.
- **Saddle cases (6, 9) don't exist in the art and aren't needed.** They're the checkerboard 2×2s. The
  depth-field **repair** guarantees they never occur, so no tile is required. Don't hunt for them.
- **Solid fill variants come ONLY from `variant_rows`.** The transition-block rows contain **bubble-edge**
  pieces (a foam/shade feature on one edge) — scattering those as solids drops a stray line into flat
  fill. Interior-only decoration (ripple/swirl) in the surface rows is what you want. `is_solid_fill`
  also requires the four corners to **agree** within a tight threshold (`<8`, since adjacent levels sit
  ~14 apart) so a transition tile can't sneak in as a "solid".
- **The base fill can live outside the surface rows.** Mid's plain fill sits in a transition block, so
  base fills are searched across the whole sheet (flattest solid of the shade); only *decoration* is
  restricted to `variant_rows`.
- **Match the coast's terrain shade to the ground.** The coast tiles bake their own copy of the ground
  terrain (grass); if your ground uses a different shade you get a halo at every shoreline. Pick the
  ground shade to match (see the blob `prefer` knob).
- **A missing deep fill → author it.** Synthesize a flat tile of the shade the transitions actually lead
  to (the deep-side centroid), so it seams. Its contrast is only as dark as the art goes unless you
  supply a genuinely darker tile.
- **Calibrate "fits" by eye, then encode the rule.** Same-shade tiles fit; a cross-shade step never does
  (regardless of the dE number) — which is *why* levels are joined by transition tiles, not scattered
  together. If tuning a threshold, show a spectrum of pairs and get a human verdict.
- **Corner agreement alone doesn't catch an edge-touching variant.** A ripple/swirl whose decoration
  reaches a BORDER (not just a corner) still passes the 4-corner check — corners never touch it — but
  seams as a hard cut where the decoration doesn't continue into the neighbour. `is_solid_fill` also
  samples the four 1px border lines and requires them within `edge_tol` of the level centroid. Since
  rotation only relabels which border is N/E/S/W (it doesn't move the decoration off the tile), a frame
  that fails is bad in **every** rotation — no per-rotation bookkeeping needed, just drop the frame.
- **"Looks plain" and "is perfectly self-tileable" are different properties — don't assume the flattest
  candidate is the seamless one.** Tightening `is_solid_fill`'s tolerance to find a "purer" default
  background doesn't work the way it sounds: on Pixel Crawler water, the flattest-LOOKING shallow tile
  (lowest internal stddev) still isn't itself perfectly self-tileable — 4 of its own 16 border pixels
  differ from their opposite-edge counterpart by ~6/255 (measure it directly: render the tile against a
  copy of itself, `np.max(np.abs(edge_lines(t)['E'] - edge_lines(t)['W']))`, not just "does it look
  flat"). The tiles that ARE perfectly self-seamless (0/255) at that tolerance turn out to be the more
  decorated ones (rings) instead. Tightening the tolerance to chase both properties at once just swaps
  which tile wins — past a cliff around `edge_tol≈5.6` on this sheet it flips straight from the plain
  tile to a decorated one, with **no** gradual middle ground (every value from there up to 8 is
  identical). If you want a plain-looking, zero-diff default background, don't tune the tolerance for
  it — set `fillAuthored` on that level instead (a flat synthesized tile as the default; its normal
  `variants` pool, tolerance-filtered as above, still scatters in as occasional decorated accents).

## Worked example: muddy patches (`mud`, onboarded)

Muddy patches turned out simpler than the water plan below originally guessed — the art isn't an opaque
depth ramp at all, it's **irregular alpha-cutout blobs on grass**, i.e. the SAME method as `grass`, not
`depth`:

- **Method:** `blob`, not `depth`. There's no shade ramp to key off (mud doesn't get "deeper"); it's one
  terrain, alpha-cut against transparency, exactly like grass.
- **Sheet region:** `Floors_Tiles.png`, box `(11, 15, 0, 12)` — this is the SAME region already onboarded
  as `"dirt"` for the editor's terrain paintbrush (`gen_terrains.py`'s `TERRAINS` list); the tile-edge-set
  baker just derives its OWN `mud.json` from it for procedural scatter, same asset, different consumer.
  Found by rendering the actual authored map (`src/data/maps/the-moon.map.json`) around a hand-painted
  mud patch, reading which palette entries it used, then cross-checking `gen_terrains.py`'s existing
  config for the authoritative box rather than eyeballing one.
- **Config** = a `blob` SETS entry exactly like `grass`'s, pointed at the mud box: `{"kind": "blob", "id":
  "mud", ..., "box": (11, 15, 0, 12)}`.
- **Layering matches how the hand-authored map actually does it — and it ISN'T symmetric.** Mud is
  always the full, OPAQUE bottom layer (its `seamless_base_tile`, painted everywhere — mud never uses
  its OWN `mapping`/edge tiles for this); grass's OWN alpha-cutout blob tiles are always the layer on
  top, autotiled via `blob_key` against a mask. A "mud patch" is grass covering ~everywhere EXCEPT a
  small hole (`disc_mask(..., hole=True)`) — the hole is what reveals the mud underneath. A "grass patch
  in mud" is the same mechanism with the mask inverted (grass covers only a small disc). Both are
  `render_grass_mud_demo` (`hole=True`/`hole=False`) — grass's blob tiles do 100% of the cutting either
  way; mud's own edge/corner art (baked into `mud.json` regardless, for other uses) never enters into
  this specific technique at all. Getting this backwards (mud's own edge tiles cutting into a grass
  background) LOOKS plausible and renders without error, but isn't what the game's map actually paints —
  when adding a new patch-style biome, check which terrain's tiles are the ones with real alpha in the
  hand-authored map before assuming either direction.
- **A finite demo canvas fakes a seam blob autotiling won't have in-game.** `blob_key` reads "off the
  edge of the mask array" as false (not-this-terrain), so a biome that's meant to cover ~everywhere
  reads its own canvas border as a coastline in a small demo — pad the render by a few tiles on every
  side and crop the padding off afterwards (`render_grass_mud_demo`'s `PAD`) rather than mistake it for
  a real bug.
- Same self-tileability caveat as water applies to mud's OWN base fill too (measure it — see the "looks
  plain" gotcha above) — irrelevant to the patch technique above (which never draws mud's edge tiles),
  but matters if mud's own `mapping` gets used directly elsewhere.

## The 1px edge test — tile compatibility, groups, and the seam audit

Everything above decides which tile goes where by **shape** (alpha blob keys, 4-corner depth cases).
That's necessary but not sufficient: two shape-correct neighbours can still have touching borders that
don't continue each other, which is what a "hard edge" is. The rule that catches it is one comparison,
in [`scripts/pixel-crawler/edge_compat.py`](../scripts/pixel-crawler/edge_compat.py): lay the two tiles'
**touching 1px borders** side by side and count how many of the 16 pixel pairs disagree
(`A` may sit left of `B` iff `A.E ≈ B.W`; above iff `A.S ≈ B.N`).

Two thresholds, because "may these be interchangeable fill?" and "is this rendered seam a cut?" are
different questions:

|rule|knobs|used for|
|---|---|---|
|**tight / group**|`COLOR_TH=8`, `FIT_TH=0` (every pixel must match)|compatibility **groups** — a set of `(frame, rot)` placements that are mutually placeable in *any* arrangement, so scattering them can't seam. `variants` in every baked set is now the group containing that set's base tile; `groups` carries the rest.|
|**loose / audit**|`BREAK_COLOR_TH=40`, `BREAK_TH=0.85`|`audit_canvas` — scores every internal seam of a FINISHED render and counts **hard edges**. Authored boundaries (a coastline, a grass edge into mud) score ≲0.5; a wrong neighbour scores 1.00, so 0.85 separates them with a wide margin (the spike measured known-good island seams at 0.00–0.31).|

Both are per-pixel RGB**A** — "opaque here, transparent there" is exactly the kind of disagreement that
shows as a hard edge on the alpha-cutout sheets.

**Three places it's applied.** Together these are what got the test biome maps to `hard edges = 0`:

1. **Bake time — pool + option filtering.** `compat_pool`/`compat_frames` build the scatter pools as
   groups (auto-relaxing `colorTh` per sheet, as the old edge-class floor did). `filter_coast_by_shore`
   drops coast options whose LAND-facing borders don't fit the shore terrain's fill; `prune_coast_arcs`
   then runs arc consistency over the case map (drop any option some border no legal neighbour can
   answer); `filter_blob_mapping` drops options whose interior-facing borders carry boundary art.
2. **Placement time — `edge_compat.pick_placement`.** Among a case's options, pick one that also seams
   against the already-final neighbours (composited first, so alpha tiles are judged on the pixels they
   actually produce), at random among ties so variety survives. Counts `forced`/`no-fit` when nothing
   fits — don't hide those, they measure a set's real coverage.
3. **Field repair — before anything is drawn.** Some shapes have no tiling at all in this art, so the
   FIELD is repaired rather than the tolerance loosened (same posture as `depth_field`'s erode/de-saddle):
   majority-smooth every band footprint, delete water bodies under ~8 cells, force a **shore collar** of
   the coast's own shore terrain around water, and absorb 1-cell-wide base strips.

### Hard-won lessons from the audit (each was a visible defect)

- **A depth band must keep the base terrain UNDER it, not a hole.** Holing water out of the base
  overlay makes the base cut its own alpha edge round the pond — dirt lip and all — and the coast tile
  then has to butt that. Nothing in the coast art can; it seams all the way round (52 hard edges on the
  marsh preset). Paint plain base everywhere, opaque depth tiles on top (what `render_depth_lake` always
  did). Blob bands DO get the hole — that's the mud-patch technique.
- **Water can only shore onto the terrain its coast art was drawn against.** Measured, not assumed
  (`shore_terrain`): 192 of this sheet's coast borders fit `grass`, 0 fit `mud`. A pond dropped into a
  mud band gets a green ring. Hence the collar.
- **The `pickFrame` fallback chain matters.** exact key → same cardinals → FULL. Skip the middle step and
  a boundary becomes a plain interior tile: a dead-straight, unblended terrain edge.
- **Three cardinal combinations have no tile at all** (E|W, N|S, isolated) — the 1-wide strips. Repair
  the field; there is nothing to place there.
- **Interior-border fidelity has to be scored RELATIVELY.** No edge tile in this pack has a perfectly
  plain interior border (best scores 0.25–0.56 — the lip is drawn to run across tile boundaries), so an
  absolute rule empties every key and collapses edge variety to one option.
- **Dual-grid tiles overhang their mask** by one cell right/bottom. That's why the collar is 2 cells,
  why the biome renderer paints depth bands last, and why placement checks E/S only where this pass
  won't repaint them.

### Tools

- **`gen_tile_groups.py`** — sweeps a whole sheet with the tight rule and reports the **groups of tiles
  that go together**, largest first, with a rendered field per group (a group is a clique, so any
  arrangement of it is seam-free) plus a labelled contact sheet. This is how to find a new biome's
  palette from pixels instead of by eye: at `--color-th 14` the Floors sheet resolves into grass, two
  dirt shades, sand, snow/ice and stone-floor palettes. Outputs to `.tile-groups/` (gitignored).
- **`gen_biome_tests.py`** — renders whole **test biome maps, tiles only** (height field → bands →
  autotiled boundaries → scatter; no nodes, no decor), mirroring `biomeGen/terrain.ts`'s composition.
  Each map prints coverage, the field repairs applied, `invalid`/`no-fit`, and the seam audit, plus a
  per-pairing tally of any hard edges and a `<preset>-audit.png` with every hard seam struck through in
  magenta. `--seed` re-rolls, `--preset` narrows. Outputs to `.biome-tests/` (gitignored).
  **Acceptance bar: `hard edges = 0` on every preset** (currently holds for all four across seeds).

> **Not yet ported to TypeScript** — tracked as **plan 052 Step 10a**. `src/systems/biomeGen/terrain.ts`
> (Step 7) still has the pre-audit composition: it holes the base overlay out under depth bands, has no
> shore collar, and no smoothing/thin-strip/small-body repair — i.e. the defects listed above are still
> live in the editor's biome tool, and Step 11's UI shouldn't be judged on looks until Step 10a lands.
> Placement-time matching needs the pixels, so the TS side wants the *pruned* option lists the baker now
> emits rather than its own matcher; what it does need is the composition ORDER and the FIELD REPAIRS,
> which are pure mask work.

## Files

- Baker: [`scripts/pixel-crawler/bake_edge_set.py`](../scripts/pixel-crawler/bake_edge_set.py) —
  derivation (blob + depth) + the reference generator/guard.
- Edge test: [`scripts/pixel-crawler/edge_compat.py`](../scripts/pixel-crawler/edge_compat.py) — the
  pairwise 1px-border rule, groups, matched placement, canvas audit (shared by everything below).
- Group discovery: [`scripts/pixel-crawler/gen_tile_groups.py`](../scripts/pixel-crawler/gen_tile_groups.py).
- Test biome maps: [`scripts/pixel-crawler/gen_biome_tests.py`](../scripts/pixel-crawler/gen_biome_tests.py).
- Output: `public/assets/tilesets/pixel-crawler/edge-sets/{grass,mud,water}.json` + `bake_edge_set_demo*.png`.
- Blob terrains for the older `terrains.json` path: `scripts/pixel-crawler/gen_terrains.py`.
