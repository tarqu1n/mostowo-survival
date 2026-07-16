# Authoring custom terrain tiles

How we synthesise new terrain tiles that match a stock pack and tile seamlessly.
Written from the **water diagonal coast** job (first self-made terrain tile) — read
this before making more edge/transition tiles so you don't re-derive the hard parts.

Art pipeline overview lives in [ASSETS.md](ASSETS.md); this is the terrain-tile *how*.

## When you need this

A stock pack often doesn't ship the exact edge/corner/transition you want. The Pixel
Crawler `Water_tiles.png`, for example, is an **organic island-blob set**: it only
contains complete lumpy islands whose corners are rounded hand-drawn bulges — there is
**no clean 45° coast edge**, and its "corners" are not modular. When the pack has no tile
to pick, synthesise one from its palette rather than hand-drawing from scratch.

First move on any pack: **map it.** Classify every 16px cell by material
(water/foam/cliff/grass) to find the straightest edge segments and confirm whether it's a
clean Wang/9-slice set or an organic blob set. That decides everything below.

## The coast cross-section (Pixel Crawler water), sampled from the pack

Perpendicular profile, water → land: `water → foam(~1px) → wet-dirt lip(~1px) → mottled sand
band(~4-5px) → jagged grass edge`. The dirt band is **thick and heavily mottled**, not a flat
strip with a 1px shadow — matching it is what makes the self-made tile read as the same set (the
first pass drew a thin flat band and it stuck out; see the sampled straights at frames 50/56).

|role|hex|notes|
|---|---|---|
|water base|`#3e92d1`|plain island-surround water; sparse `#4185ca` ripple dots|
|water accent|`#4185ca`, `#4498d1`|ripple flecks|
|foam|`#a3c8ee` (bright), `#7baadb` (mid), `#cce3fb` (rare fleck)|the pale rim between water and cliff|
|wet dirt|`#6c4326`|**dark shadowed lip** right at the waterline (the wet foot of the cliff) — easy to miss, but the band looks flat/pasted-on without it|
|cliff lit|`#9f6c3f`|the sand/dirt band, water-facing|
|cliff shadow|`#865932`|mottled through the band **and** clustered on the grass-side edge (not a clean 1px line)|
|grass base|`#337604`|**byte-identical across all 4 island variations**|
|grass accent|`#327404`, `#317004`, `#337903`, `#357b05`|mottling|

The dirt band is measured at **~6px perpendicular** on the stock straights (N/E/W); the **south**
face is slightly thicker with more foam pooled at its base (a taller "cliff face"). We match the
west/north profile and rotate one symmetric tile for all four directions — at game scale the ~1px
south difference disappears under the jagged edge, and per-edge tiles aren't worth 4×-ing the set.

> The pack has **no grass/water texture variety to sample** (all island grass tiles are
> identical; the only water that matches the plain fill is the one `#3e92d1` shade — the
> deeper-water tiles are a different shade that clashes at fill seams). So variety is
> **synthesised**: solid base colour + seeded accent clusters. Keeping the base identical
> to the plain tiles is what makes the fill seamless against tiles the user paints around it.

## The two rules that make a diagonal tile tile seamlessly

These are the non-obvious bits — the whole job hinges on them.

1. **One global band, sliced per tile.** Don't draw the coast "corner-to-corner within
   each tile" — two such tiles only kiss at a point, and a thick band forms an **L-notch**
   at every junction (grass/water pokes through as a triangle). Instead define the coast as
   **one continuous diagonal stripe in global space** and render each tile as the slice of
   that stripe in its cell:

   ```
   d = (x + y) - centre          # <0 water side, >0 land side; band = profile(d)
   ```

   Then a coast needs **three tile roles at three shifted centres**, placed on three
   adjacent diagonals (cells where `col+row = k-1, k, k+1`):

   |role|centre|what shows in the cell|
   |---|---|---|
   |**main** `D`|`15`|band runs full corner-to-corner|
   |**water connector** `Wc`|`31`|mostly water; band only reaches the bottom-right corner|
   |**land connector** `Lc`|`-1`|mostly grass; band only reaches the top-left corner|

   The connectors are the fix the notch needed: they carry the band across the
   corner-to-corner junctions between main tiles. Pure water/grass tiles fill everything
   beyond `k±1`.

2. **Tapered bumps + constant band width.** To break uniformity, offset the line per tile
   (`centre + bump(x-y)`), but the bump **must window to 0 at the tile corners**
   (`|x-y| = 15`): `window = max(0, 1 - (a/15)²)`. That guarantees every variation
   enters/exits at the exact same corner pixels, so variations are freely interchangeable
   in any order. And the **cliff band width is constant across every tile** (`CLIFF_W`), or
   the band mismatches at seams.

Corollary: any number of main/connector *variations* interchange freely as long as they
share rule 1's centres and rule 2's corners + band width. Vary fills, bumps, and speckle;
never vary band width or corner crossing.

**Texturing without breaking seams (the mottle rule).** A flat band reads as pasted-on; the
stock band is heavily mottled with a jagged grass edge. To reproduce that *and* stay seamless:
mottle the band interior freely (per-tile-seeded noise over lit `#9f6c3f` / dark `#865932` /
wet `#6c4326` — small mismatches at seams are invisible, and stock's own mottle doesn't line up
tile-to-tile either), but treat the two **geometric edges** differently:
- the **waterline** (most visible against dark water) stays on the smooth windowed band — do
  **not** jitter it, or it breaks at the Wc/D/Lc junctions;
- the **grass edge** may be jittered per-pixel for an organic coast, but the jitter **must be
  multiplied by the same corner window** (`0` at `|x-y|=15`) so tiles still meet at the corners.

Keep the sand **flat** (a low dark-mottle ratio, ~18%); concentrate the dark on the grass-side
lip rather than scattering it through the band, or it reads noisy/over-pixelated next to the
stock straights (the stock sand is a near-solid lit run with dark only at the edges).

## Bends: joining the diagonal to the stock straight/corner tiles (rule 3)

The diagonal alone can't meet a purchased straight coast: its waterline exits at the tile
**corner** (`x+y=15`), but a stock vertical straight's waterline sits **mid-edge** (`x≈5`), so a
45°→90° turn leaves a step. Fix it with **bend tiles** that carry the coast across the corner.

A bend joins two coast segments at a vertex: a **diagonal branch** (`x+y=15`, so it butts a `D`
main) and a **straight branch** (waterline at `STRAIGHT_OFF=6`, i.e. water `x0–4` / foam `x5` /
dirt `x6–14` / grass `x15` — byte-matched to the stock straight edge). Render by **compositing
the two lines' signed distances**, not one scalar `d`:

- **convex** corner (land = the *intersection* of the two land sides): `d = min(d_diag, d_straight)`
- **concave** corner (land = the *union*): `d = max(d_diag, d_straight)`

`min`/`max` **auto-clips each segment at the vertex** — the inactive extension of a line always
loses the min/max — which is why a naïve single-line `d` misfills the far side of the vertex.
The straight branch is **axis-aligned, so 1px = 1 s-unit** (no `√2` scaling, or the straight band
renders ~6px and steps against the stock ~9px band). Bends use **no bumps** (clean line) so their
corner + straight-edge crossings match `D` and the stock exactly; vary them by fill only.

**Chirality:** editor terrain paint **rotates (0/90/180/270) but does not flip**, and a bend is
chiral, so both mirror chiralities are baked as separate frames: `Bx`/`Bv` meet a **vertical**
straight, `Bxt`/`Bvt` (their `x↔y` transposes) meet a **horizontal** one. Rotation covers the
other coast directions. (16 vertex geometries collapse to these 4 base frames under rotation.)

**Neighbour recipe** (place the bend, then its neighbours — differs slightly from a plain run):
- `Bx` (convex): below = stock straight · up-right = `D` run · up = `Wc` · right = `Lc` · left = plain water.
- `Bv` (concave): above = stock straight · down-left = `D` run · left = `Wc` · below = `Lc` · right = plain grass.

> **Stock isn't perfectly symmetric.** The stock **north** face has a thinner dirt band than
> west/east, so a bend meeting a *north* straight shows a slight width change at the vertex. We
> accept it (one symmetric set, rotated) rather than baking per-edge bends — it vanishes under the
> jagged edge at game scale.

## The generated tileset

- **Generator:** [`scripts/mostowo-custom/gen_water_diagonal.py`](../scripts/mostowo-custom/gen_water_diagonal.py)
  — pure synthesis (no source PNG dependency; palette hardcoded from the pack). This is the
  reproducible origin — regenerate/tweak from here.
- **Output:** `public/assets/tilesets/mostowo-custom/Environment/Tilesets/water_diagonal.png`
  — **96×48, 6×3 grid, 16 frames of 16px** used (2 cells blank), single orientation
  (NW-water; rotate in-editor, plan 26):

  |frames|role|
  |---|---|
  |0–5|main diagonals `D0`–`D5` (D0 clean, D1–D5 varied bumps + water/grass/sand textures)|
  |6–8|water connectors `Wc0`–`Wc2`|
  |9–11|land connectors `Lc0`–`Lc2`|
  |12–15|coast bends `Bx` `Bv` `Bxt` `Bvt` (see the bends section above)|
  |16–17|blank (6-wide grid, 16 frames → 2 spare cells)|

- **Placement in a map:** on a coast run, lay `Wc · D* · Lc` across three adjacent
  diagonals, pure water/grass beyond; pick any `D*/Wc*/Lc*` per cell for variety; rotate the
  whole set for the other three coast directions. Where a diagonal run turns into a stock
  straight/corner, drop in the matching **bend** (`Bx`/`Bv`/`Bxt`/`Bvt`, rotated) per the
  neighbour recipe above.
- **Frame COUNT is stable-append-only.** Frames 0–11 keep their indices (existing maps
  reference them); new roles are appended as **new rows, keeping 6 columns** — adding a column
  would renumber row-major indices and corrupt saved maps. A frame-count change (like this
  bends row) needs the `water_diagonal` catalog entry's `h`/`frames` bumped (see below); a
  pixel-only change needs neither a catalog nor a regions regen.

## Wiring a self-made tile into the editor (the mechanical recipe)

The `mostowo-custom` pack's rule classifies anything under `Environment/Tilesets/**` as a
16px `tile` sheet (frames = grid count), origin `self-made`. **No `pack.json` change needed**
for a clean 16px grid.

1. Write the sheet PNG under `public/assets/tilesets/mostowo-custom/Environment/Tilesets/`.
2. Make the catalog agree with the new sheet:
   - **Pixel-only change** (same frame count, e.g. retexturing existing frames): **nothing** —
     the catalog only stores the path + `w`/`h`/`frames`, none of which changed. Skip the regen.
   - **Frame-count change** (added/removed a row): the Library reads `frames` from the catalog,
     so bump the **one** `water_diagonal` entry in `public/assets/asset-catalog.json` (`h` to the
     new pixel height, `frames` to the new count). Prefer this surgical edit over the full
     `python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog` — that pipeline
     currently rewrites **every** pack's `regions.json`/catalog with an unrelated key-format
     drift (the committed sidecars are stale), burying your one change in ~4000 lines of churn.
3. It now appears in the Map Builder Library (`npm run editor`) under `mostowo-custom`
   (search "water"/"diagonal"), placeable frame-by-frame. (Hard-refresh if the editor is open —
   the sheet is a static asset and Vite may serve the cached PNG.)

`gen_regions.py` is a no-op for `tile` sheets (regions are only for multi-sprite `object`
atlases). Never hand-author region/frame *geometry* — it's generated; the `h`/`frames` bump
above is the one sanctioned catalog hand-edit (a value already derivable from the sheet size).

## Reusable recipe for the next terrain tile

1. **Map the pack** — classify cells, find the straightest edge, decide Wang vs blob set.
2. **Sample the cross-section by dumping actual pixels** — don't eyeball it. Read the hex of a
   straight edge row-by-row for the palette, the **band thickness**, and every sub-band (foam,
   wet lip, mottle, grass bleed). Match the band thickness: too thin and the tile stands out
   next to the stock straights even when the colours are right. Check all four edges — packs
   often draw a taller/foamier south face.
3. **Define one global band** `d = f(x,y) - centre`; pick the centres for main + connectors
   so the band is continuous across junctions.
4. **Synthesise fills** from the base colour + seeded accents (base identical to plain tiles),
   then **mottle the band** to match (see the mottle rule above) — jitter the grass edge with
   the corner window, never the waterline.
5. **Vary via tapered bumps + speckle**, never via band width or corner crossing.
6. **Prove it tiles** — render a multi-tile run *and* zoom a seam before committing; the
   notch/pinch failure mode only shows when tiled, not on a single tile. Also render the
   self-made tile **side-by-side with the stock straight** to judge the profile match.
7. Ship: generator script (reproducible origin) + PNG under the pack + regen catalog.
