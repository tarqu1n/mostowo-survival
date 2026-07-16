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

Perpendicular profile, water → land: `water → foam(~1px) → cliff-lit(~3px) → cliff-shadow(1px) → grass`.

|role|hex|notes|
|---|---|---|
|water base|`#3e92d1`|plain island-surround water; sparse `#4185ca` ripple dots|
|water accent|`#4185ca`, `#4498d1`|ripple flecks|
|foam|`#a3c8ee` (bright), `#7baadb` (mid)|the pale rim between water and cliff|
|cliff lit|`#9f6c3f`|the sand/dirt band, water-facing|
|cliff shadow|`#865932`|1px line on the grass side|
|grass base|`#337604`|**byte-identical across all 4 island variations**|
|grass accent|`#327404`, `#317004`, `#337903`, `#357b05`|mottling|

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

## The generated tileset

- **Generator:** [`scripts/mostowo-custom/gen_water_diagonal.py`](../scripts/mostowo-custom/gen_water_diagonal.py)
  — pure synthesis (no source PNG dependency; palette hardcoded from the pack). This is the
  reproducible origin — regenerate/tweak from here.
- **Output:** `public/assets/tilesets/mostowo-custom/Environment/Tilesets/water_diagonal.png`
  — **96×32, 12 frames of 16px**, single orientation (NW-water; rotate in-editor, plan 26):

  |frames|role|
  |---|---|
  |0–5|main diagonals `D0`–`D5` (D0 clean, D1–D5 varied bumps + water/grass/sand textures)|
  |6–8|water connectors `Wc0`–`Wc2`|
  |9–11|land connectors `Lc0`–`Lc2`|

- **Placement in a map:** on a coast run, lay `Wc · D* · Lc` across three adjacent
  diagonals, pure water/grass beyond; pick any `D*/Wc*/Lc*` per cell for variety; rotate the
  whole set for the other three coast directions.

## Wiring a self-made tile into the editor (the mechanical recipe)

The `mostowo-custom` pack's rule classifies anything under `Environment/Tilesets/**` as a
16px `tile` sheet (frames = grid count), origin `self-made`. **No `pack.json` change needed**
for a clean 16px grid.

1. Write the sheet PNG under `public/assets/tilesets/mostowo-custom/Environment/Tilesets/`.
2. Regen (always both, in order):
   ```sh
   python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog
   ```
3. It now appears in the Map Builder Library (`npm run editor`) under `mostowo-custom`
   (search "water"/"diagonal"), placeable frame-by-frame.

`gen_regions.py` is a no-op for `tile` sheets (regions are only for multi-sprite `object`
atlases) but the catalog build expects the sidecar current, so run both. Never hand-edit
`asset-catalog.json` / `regions.json` — they're generated.

## Reusable recipe for the next terrain tile

1. **Map the pack** — classify cells, find the straightest edge, decide Wang vs blob set.
2. **Sample the cross-section** — palette + band widths from a clean edge column.
3. **Define one global band** `d = f(x,y) - centre`; pick the centres for main + connectors
   so the band is continuous across junctions.
4. **Synthesise fills** from the base colour + seeded accents (base identical to plain tiles).
5. **Vary via tapered bumps + speckle**, never via band width or corner crossing.
6. **Prove it tiles** — render a multi-tile run *and* zoom a seam before committing; the
   notch/pinch failure mode only shows when tiled, not on a single tile.
7. Ship: generator script (reproducible origin) + PNG under the pack + regen catalog.
