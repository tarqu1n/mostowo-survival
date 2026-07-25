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
- **Demo:** `render_blob_patch` (a small disc+smooth mask autotiled via the same `blob_key` + the set's
  baked `mapping`, with `FULL`-key cells occasionally scattering `variants` for texture) — the blob
  equivalent of `render_depth_lake`'s lake, since blob sets don't have levels/transitions to render.
- Same self-tileability caveat as water: if the flattest-looking base tile isn't perfectly self-tileable,
  that's the same "looks plain" vs "is seamless" tradeoff — the blob method doesn't yet have a
  `fillAuthored` equivalent (only `depth` levels do); extend it the same way if it becomes visible.

## Files

- Baker: [`scripts/pixel-crawler/bake_edge_set.py`](../scripts/pixel-crawler/bake_edge_set.py) —
  derivation (blob + depth) + the reference generator/guard.
- Output: `public/assets/tilesets/pixel-crawler/edge-sets/{grass,water}.json` + `bake_edge_set_demo.png`.
- Blob terrains for the older `terrains.json` path: `scripts/pixel-crawler/gen_terrains.py`.
