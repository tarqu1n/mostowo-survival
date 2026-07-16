#!/usr/bin/env python3
"""Generate the water/grass 45-degree diagonal coast tileset (mostowo-custom).

WHY THIS EXISTS
    The Pixel Crawler `Water_tiles.png` is an *organic island-blob* set: it only
    ships complete lumpy islands whose corners are rounded, hand-drawn bulges.
    There is no clean 45-degree coast edge in it, so we synthesise one that
    matches the pack's palette and reads as a straight diagonal shoreline.

    Full technique write-up: docs/TILE-AUTHORING.md.

WHAT IT PRODUCES
    A single-orientation (NW-water) 16px tile sheet at
    public/assets/tilesets/mostowo-custom/Environment/Tilesets/water_diagonal.png
    laid out 6 wide x 3 tall = 18 cells, 16 used (row-major):

        row 0  frames 0-5   D0..D5   main diagonal (D0 clean, D1-D5 varied)
        row 1  frames 6-8   Wc0..Wc2 water-side connectors
               frames 9-11  Lc0..Lc2 land-side connectors
        row 2  frames 12-15 Bx Bv Bxt Bvt   coast BENDS (see below); 16-17 blank

    Rotation is done in-editor (plan 26), so only one orientation is baked.

HOW IT TILES SEAMLESSLY (the rules that must not be broken)
    1. GLOBAL BAND. The coast is one continuous diagonal stripe in *global* space,
       defined by  d = (x+y) - centre.  Each tile is just the slice of that stripe
       that falls in its 16x16 cell. The three tile roles are the same function at
       three shifted centres:
           main  centre = 15   (band runs corner-to-corner)
           Wc    centre = 31   (band only reaches the bottom-right corner)
           Lc    centre = -1   (band only reaches the top-left corner)
       A coast run places  Wc . D* . Lc  on three adjacent diagonals (cells where
       col+row = k-1, k, k+1), with pure water/grass beyond. The connectors carry
       the band across the corner-to-corner junctions between main tiles, so there
       is no L-notch / triangle where two main tiles only kiss at a point.
    2. TAPERED BUMPS. Per-tile line "bumps" (for organic variety) are multiplied by
       a window that is 0 at the tile corners (|x-y| = 15). So every variation
       enters/exits at the exact same corner pixels and stays interchangeable, and
       CLIFF_W is constant across ALL tiles so the band width matches at every seam.
    3. COMPOSITE SEGMENTS (bends). A bend joins the 45-deg diagonal (x+y=15, so it
       butts a D main) to a stock-aligned STRAIGHT branch (waterline at STRAIGHT_OFF,
       so it butts a purchased Water_tiles straight coast). Composite the two coast
       lines by signed distance: convex corner (land = intersection) -> d = min(dd,ds);
       concave corner (land = union) -> d = max(dd, ds). min/max auto-clips each
       segment at the vertex (the inactive extension always loses the min/max), which
       is why a naive single-line d misfills the far side of the vertex. The straight
       branch is axis-aligned so 1px == 1 s-unit (NO sqrt2 scaling, or the straight
       band comes out ~6px and steps against the stock ~9px band). Editor tiles rotate
       but do NOT flip, and a bend is chiral, so both mirror chiralities are baked:
       Bx/Bv meet a vertical straight, Bxt/Bvt (their transposes) a horizontal one.

PALETTE is sampled from Pixel Crawler Water_tiles.png (kept identical to the plain
    water/grass tiles the user paints around the coast, so fill seams are invisible).

USAGE
    python3 scripts/mostowo-custom/gen_water_diagonal.py
    # A pixel-only change needs no catalog regen; a frame-COUNT change (e.g. adding a
    # row) needs the water_diagonal catalog entry's h/frames bumped (see docs).
"""
from __future__ import annotations

import math
import os
import random

from PIL import Image

T = 16  # tile size (matches TILE_SIZE / pack tileSize)

# --- palette (sampled from Pixel Crawler Water_tiles.png) ---
GRASS_BASE = (0x33, 0x76, 0x04)
GRASS_ACC = [(0x32, 0x74, 0x04), (0x31, 0x70, 0x04), (0x33, 0x79, 0x03), (0x35, 0x7b, 0x05)]
WATER_BASE = (0x3e, 0x92, 0xd1)
WATER_ACC = [(0x41, 0x85, 0xca), (0x44, 0x98, 0xd1)]
FOAM = (0xa3, 0xc8, 0xee)       # bright foam rim
FOAM2 = (0x7b, 0xaa, 0xdb)      # mid foam (inner half of the rim)
FOAM_HI = (0xcc, 0xe3, 0xfb)    # rare bright foam fleck (seen in stock frame 56)
CLIFF = (0x9f, 0x6c, 0x3f)      # lit sand/dirt
CLIFF_DARK = (0x86, 0x59, 0x32) # dark dirt (mottle + grass-side shadow)
DIRT_WET = (0x6c, 0x43, 0x26)   # dark WET dirt at the waterline edge (stock's shadowed lip)

# --- band geometry (in s = x+y units; perpendicular px ~= s / sqrt(2)) ---
# Cross-section water->land, matched to the stock straight coast (frames 50/56):
#   water | foam(~1px) | wet-dirt lip | mottled sand band | jagged grass.
# Along a tile edge the diagonal band spans CLIFF_W px, set to equal the stock
# straight's ~9px HORIZONTAL dirt so the two sets read as one coast (also makes the
# bends taper-free at the vertex). MUST be identical for every tile (mains AND bends).
FOAM_W = 1.5    # foam rim width, water side of the coast line
WET_W = 2       # dark wet-dirt lip, land side of the waterline (stock's `6c4326` edge)
CLIFF_W = 9     # sand band width (waterline -> grass). MUST be identical for every tile.
JAG = 2.2       # extra s over which the sand jaggedly gives way to grass (organic edge)
# Sand mottle probabilities (per pixel): kept LOW so the band reads flat like the
# stock sand (a high dark ratio looks noisy/over-pixelated). Dark clusters instead on
# the grass-side lip (see paint_px), which is where the stock dark sits.
DARK_P = 0.18   # chance a band pixel is the dark dirt shade
WET_P = 0.03    # extra chance it's the wet shade (a few flecks through the band)

# tile-role centres (see module docstring, rule 1)
CENTRE_MAIN = 15
CENTRE_WATER_CONNECTOR = 31
CENTRE_LAND_CONNECTOR = -1
# A bend's straight branch (rule 3): dirt starts at this x/y, giving water x0-4 /
# foam x5 / dirt x6-14 / grass x15 == the stock straight coast edge. Axis-aligned.
STRAIGHT_OFF = 6

OUT = os.path.join(
    os.path.dirname(__file__),
    "../../public/assets/tilesets/mostowo-custom/Environment/Tilesets/water_diagonal.png",
)


def fill(base, accents, seed, density, cluster=2):
    """Solid `base` colour + seeded small accent clusters. Base is preserved so the
    fill is seamless against the pack's plain water/grass tiles."""
    r = random.Random(seed)
    img = Image.new("RGBA", (T, T), base + (255,))
    p = img.load()
    for _ in range(int(T * T * density)):
        cx, cy = r.randrange(T), r.randrange(T)
        col = r.choice(accents)
        for _ in range(r.randint(1, cluster)):
            x = min(T - 1, max(0, cx + r.randint(-1, 1)))
            y = min(T - 1, max(0, cy + r.randint(-1, 1)))
            p[x, y] = col + (255,)
    return img


def grass_fill(seed):
    return fill(GRASS_BASE, GRASS_ACC, seed, 0.16)


def water_fill(seed):
    return fill(WATER_BASE, WATER_ACC, seed, 0.05, cluster=1)


def bump_fn(seed):
    """Return f(a) giving the coast-line offset at along-diagonal position a=(x-y).
    Windowed to 0 at |a|=15 so tiles stay seamless (docstring rule 2)."""
    if seed is None:
        return lambda a: 0.0
    r = random.Random(seed)
    lobes = [(r.uniform(-10, 10), r.uniform(2.2, 4.0), r.uniform(-3.0, 3.0))
             for _ in range(r.randint(2, 3))]
    return lambda a: (max(0.0, 1 - (a / 15.0) ** 2)) * sum(
        amp * math.exp(-((a - mu) / sig) ** 2) for mu, sig, amp in lobes
    )


def paint_px(p, x, y, d, gedge, tx, ws, gs):
    """Paint one pixel from the signed coast distance `d` (s-units, water<0) and the
    per-pixel grass-edge threshold `gedge`. Shared by the mains and the bends so both
    render the exact same cross-section: foam rim -> dark WET-dirt lip -> mottled sand
    -> jagged grass. `tx` is the tile's texture RNG; `ws`/`gs` the water/grass fills."""
    if d < -FOAM_W:
        p[x, y] = ws[x, y]
    elif d < 0:                                  # foam rim
        col = FOAM if d < -FOAM_W * 0.5 else FOAM2
        if tx.random() < 0.06:
            col = FOAM_HI
        p[x, y] = col + (255,)
    elif d < WET_W:                              # dark wet-dirt lip, mottled
        p[x, y] = (DIRT_WET if tx.random() < 0.7 else CLIFF_DARK) + (255,)
    elif d < gedge:                              # mottled sand band (kept flat, see DARK_P)
        rr = tx.random()
        col = CLIFF_DARK if rr < DARK_P else DIRT_WET if rr < DARK_P + WET_P else CLIFF
        if d >= gedge - 1.5 and tx.random() < 0.55:  # shadow the grass-side lip
            col = CLIFF_DARK
        p[x, y] = col + (255,)
    else:                                        # grass, with a little dirt bleed
        if d < gedge + 1.2 and tx.random() < 0.22:
            p[x, y] = CLIFF_DARK + (255,)
        else:
            p[x, y] = gs[x, y]


def make_tile(centre, water, grass, bump_seed=None, tex_seed=None):
    """One 16px main/connector tile. `centre` selects the role (main/Wc/Lc). NW
    orientation: water on the small-(x+y) side (upper-left), land on the large side.

    `tex_seed` drives the mottle + a per-pixel grass-edge jitter that is windowed to 0
    at the tile corners (|x-y|=15) so every variation still enters/exits at the exact
    same corner pixels and stays interchangeable (docstring rule 2). Only the GRASS
    edge is jittered; the waterline stays on the smooth windowed band so it remains
    continuous across the Wc/D/Lc junctions."""
    ws, gs = water.load(), grass.load()
    bf = bump_fn(bump_seed)
    tx = random.Random(tex_seed if tex_seed is not None else 0)
    jitter = {}
    for x in range(T):
        for y in range(T):
            w = max(0.0, 1 - ((x - y) / 15.0) ** 2)
            jitter[(x, y)] = tx.uniform(-1.0, JAG) * w
    img = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    p = img.load()
    for y in range(T):
        for x in range(T):
            d = (x + y) - (centre + bf(x - y))
            paint_px(p, x, y, d, CLIFF_W + jitter[(x, y)], tx, ws, gs)
    return img


def make_bend(kind, water, grass, tex_seed=None):
    """A coast BEND tile (docstring rule 3): a 45-deg diagonal branch (x+y=15, butts a
    D main) meeting a stock-aligned straight branch (waterline at STRAIGHT_OFF, butts a
    stock straight). Composite the two coast lines: convex land = intersection ->
    d = min(dd, ds); concave land = union -> d = max(dd, ds). No bumps (clean line) so
    the corner + straight-edge crossings match D and the stock exactly; vary via fills
    only. `kind` in {Bx, Bv, Bxt, Bvt}: Bx/Bv meet a vertical straight, Bxt/Bvt (their
    x<->y transposes, needed because editor tiles rotate but don't flip) a horizontal
    one; Bx/Bxt are convex, Bv/Bvt concave. NW-water base orientation."""
    ws, gs = water.load(), grass.load()
    tx = random.Random(tex_seed if tex_seed is not None else 0)
    convex = kind in ("Bx", "Bxt")
    horizontal = kind in ("Bxt", "Bvt")
    img = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    p = img.load()
    for y in range(T):
        for x in range(T):
            dd = (x + y) - CENTRE_MAIN
            ds = (y if horizontal else x) - STRAIGHT_OFF
            d = min(dd, ds) if convex else max(dd, ds)
            paint_px(p, x, y, d, CLIFF_W, tx, ws, gs)
    return img


def build_sheet():
    # 6 main variations: D0 clean line; D1-D5 varied bump + water + grass + sand texture.
    main_cfg = [(None, None), (11, 101), (27, 202), (43, 303), (58, 404), (72, 505)]
    mains = [make_tile(CENTRE_MAIN, water_fill(10 + i), grass_fill(50 + i),
                       bump_seed=bp, tex_seed=ts)
             for i, (bp, ts) in enumerate(main_cfg)]
    # 3 water connectors (varied water) + 3 land connectors (varied grass).
    wcs = [make_tile(CENTRE_WATER_CONNECTOR, water_fill(200 + i), grass_fill(0),
                     tex_seed=600 + i) for i in range(3)]
    lcs = [make_tile(CENTRE_LAND_CONNECTOR, water_fill(0), grass_fill(300 + i),
                     tex_seed=700 + i) for i in range(3)]

    # 4 coast bends (frames 12-15). No bumps; vary by fill only. Cells 16-17 stay blank.
    bends = [make_bend(k, water_fill(20 + i), grass_fill(60 + i), tex_seed=800 + i)
             for i, k in enumerate(("Bx", "Bv", "Bxt", "Bvt"))]

    cols = 6
    row1 = wcs + lcs
    sheet = Image.new("RGBA", (cols * T, 3 * T), (0, 0, 0, 0))
    for i, t in enumerate(mains):
        sheet.paste(t, ((i % cols) * T, 0))
    for i, t in enumerate(row1):
        sheet.paste(t, ((i % cols) * T, T))
    for i, t in enumerate(bends):
        sheet.paste(t, ((i % cols) * T, 2 * T))
    return sheet


def main():
    sheet = build_sheet()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT)
    print(f"wrote {os.path.normpath(OUT)}  ({sheet.width}x{sheet.height}, 16 frames of {T}px)")
    print("frame COUNT changed (12->16): bump the water_diagonal catalog entry's "
          "h to 48 and frames to 16 (see docs/TILE-AUTHORING.md).")


if __name__ == "__main__":
    main()
