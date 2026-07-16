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
    laid out 6 wide x 2 tall = 12 frames (row-major):

        row 0  frames 0-5   D0..D5   main diagonal (D0 clean, D1-D5 varied)
        row 1  frames 6-8   Wc0..Wc2 water-side connectors
               frames 9-11  Lc0..Lc2 land-side connectors

    Rotation is done in-editor (plan 26), so only one orientation is baked.

HOW IT TILES SEAMLESSLY (the two rules that must not be broken)
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

PALETTE is sampled from Pixel Crawler Water_tiles.png (kept identical to the plain
    water/grass tiles the user paints around the coast, so fill seams are invisible).

USAGE
    python3 scripts/mostowo-custom/gen_water_diagonal.py
    # then regen the editor catalog:
    python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog
"""
from __future__ import annotations

import math
import os
import random

from PIL import Image, ImageDraw

T = 16  # tile size (matches TILE_SIZE / pack tileSize)

# --- palette (sampled from Pixel Crawler Water_tiles.png) ---
GRASS_BASE = (0x33, 0x76, 0x04)
GRASS_ACC = [(0x32, 0x74, 0x04), (0x31, 0x70, 0x04), (0x33, 0x79, 0x03), (0x35, 0x7b, 0x05)]
WATER_BASE = (0x3e, 0x92, 0xd1)
WATER_ACC = [(0x41, 0x85, 0xca), (0x44, 0x98, 0xd1)]
FOAM = (0xa3, 0xc8, 0xee)
FOAM2 = (0x7b, 0xaa, 0xdb)
CLIFF = (0x9f, 0x6c, 0x3f)
CLIFF_DARK = (0x86, 0x59, 0x32)

# --- band geometry (in s = x+y units; perpendicular px ~= s / sqrt(2)) ---
FOAM_W = 2      # foam rim width, water side of the coast line
CLIFF_W = 4     # cliff/sand band width, land side. MUST be identical for every tile.

# tile-role centres (see module docstring, rule 1)
CENTRE_MAIN = 15
CENTRE_WATER_CONNECTOR = 31
CENTRE_LAND_CONNECTOR = -1

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


def make_tile(centre, water, grass, bump_seed=None, speckle_seed=None):
    """One 16px tile. `centre` selects the role (main/Wc/Lc). NW orientation:
    water on the small-(x+y) side (upper-left), land on the large side (lower-right)."""
    ws, gs = water.load(), grass.load()
    bf = bump_fn(bump_seed)
    sp = random.Random(speckle_seed) if speckle_seed is not None else None
    img = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    p = img.load()
    for y in range(T):
        for x in range(T):
            d = (x + y) - (centre + bf(x - y))
            if d < -FOAM_W:
                p[x, y] = ws[x, y]
            elif d < 0:
                p[x, y] = (FOAM if d < -FOAM_W * 0.5 else FOAM2) + (255,)
            elif d < CLIFF_W:
                col = CLIFF_DARK if d >= CLIFF_W - 1 else CLIFF
                if sp and col is CLIFF and sp.random() < 0.18:
                    col = CLIFF_DARK
                p[x, y] = col + (255,)
            else:
                p[x, y] = gs[x, y]
    return img


def build_sheet():
    # 6 main variations: D0 clean; D1-D5 varied bump + water + grass + sand speckle.
    main_cfg = [(None, None), (11, 101), (27, 202), (43, 303), (58, 404), (72, 505)]
    mains = [make_tile(CENTRE_MAIN, water_fill(10 + i), grass_fill(50 + i),
                       bump_seed=bp, speckle_seed=sp)
             for i, (bp, sp) in enumerate(main_cfg)]
    # 3 water connectors (varied water) + 3 land connectors (varied grass).
    wcs = [make_tile(CENTRE_WATER_CONNECTOR, water_fill(200 + i), grass_fill(0)) for i in range(3)]
    lcs = [make_tile(CENTRE_LAND_CONNECTOR, water_fill(0), grass_fill(300 + i)) for i in range(3)]

    cols = 6
    row1 = wcs + lcs
    sheet = Image.new("RGBA", (cols * T, 2 * T), (0, 0, 0, 0))
    for i, t in enumerate(mains):
        sheet.paste(t, ((i % cols) * T, 0))
    for i, t in enumerate(row1):
        sheet.paste(t, ((i % cols) * T, T))
    return sheet


def main():
    sheet = build_sheet()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT)
    print(f"wrote {os.path.normpath(OUT)}  ({sheet.width}x{sheet.height}, 12 frames of {T}px)")
    print("next: python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog")


if __name__ == "__main__":
    main()
