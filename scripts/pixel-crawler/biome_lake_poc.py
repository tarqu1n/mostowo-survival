#!/usr/bin/env python3
"""Plan 052 Step 2 SPIKE — proof-of-concept lake generator (dual-grid coast + pixel-adjacency).

Not wired into the game/editor yet; run it to regenerate the demo PNG and eyeball the approach.
This captures the outcome of the water-terrain spike so the exploration isn't lost in scratchpad.

Why NOT the blob autotiler (the rest of the terrain pipeline): the Pixel Crawler water/coast tiles
(Water_tiles.png) are OPAQUE — the land/water boundary is a COLOUR transition, not an alpha edge — so
`autotile.py`'s alpha-based `build_blob` classifies every water tile as a full fill and can't tile a
shore. Two techniques (both owner-directed) solve it:

  1. DUAL-GRID / marching-squares placement. Each *display* tile sits over a world-grid VERTEX and is
     chosen by its 4 corners (water/land) sampled from the mask -> 16 cases. Corner-driven placement
     gives correct INTERNAL and EXTERNAL corners for any lake outline, automatically. The 16-case ->
     tile map is derived from the art by classifying each island tile's 4 corner blocks (no hand map).

  2. PIXEL-ADJACENCY (Wang) test. Two tiles fit along a seam iff their touching pixel lines mostly
     agree: for A-left-of-B compare A's col-15 vs B's col-0 pixel-by-pixel; if > FRAC_TH of the
     orthogonal pairs differ beyond COLOR_TH, they don't fit. Known-good island seams score ~0-0.31;
     land-vs-water mismatches score 1.0 — a wide margin. Used here to VALIDATE every placed seam.

Fills (grass, water interior) are already all mutually edge-compatible, so adjacency can't reject any;
the fix for a natural surface is a clean BASE tile + SPARSE noise-driven accents (not random speckle).

Architecture note for the real feature: the case->frame map, the adjacency arrays, and the fill sets
are DETERMINISTIC and per-pixel expensive, so they get precomputed offline (here) and committed as
JSON; the editor/runtime does O(1) lookups and never touches pixels. Mirrors the gen_terrains.py flow.
"""
import os
import random
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from autotile import build_blob, disc, new_mask, smooth_mask, FULL  # noqa: E402
from compose import sheet, TILE  # noqa: E402

FLOORS = "Environment/Tilesets/Floors_Tiles.png"
WATER = "Environment/Tilesets/Water_tiles.png"
COLS = 25  # both sheets are 25 tiles wide (spike finding: Water_tiles.png IS 25, not "different")
COLOR_TH = 40   # per-pixel RGB distance to count two pixels as "different"
FRAC_TH = 0.85  # > this fraction of edge-pixel pairs differing => tiles do NOT fit in that orientation


def frame_tile(im, f):
    c, r = f % COLS, f // COLS
    return im.crop((c * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE))


def is_water_block(px):
    """Fraction of opaque pixels that read as water (blue) or foam (light blue-white) > 0.5."""
    r, g, b, a = px[:, :, 0], px[:, :, 1], px[:, :, 2], px[:, :, 3]
    op = a > 128
    w = ((b > r + 15) & (b > g - 10) & (b > 110)) | ((b > 180) & (g > 190) & (r > 150))
    return (w & op).sum() / max(op.sum(), 1) > 0.5


def build_case_map(warr):
    """Classify each island tile (rows 0-4) by its 4 corner blocks -> 16-case (NW,NE,SW,SE) map."""
    case2frame = {}
    for r in range(5):
        for c in range(16):
            t = warr[r * 16 : (r + 1) * 16, c * 16 : (c + 1) * 16]
            if (t[:, :, 3] > 128).mean() < 0.5:
                continue
            nw = is_water_block(t[0:6, 0:6])
            ne = is_water_block(t[0:6, 10:16])
            sw = is_water_block(t[10:16, 0:6])
            se = is_water_block(t[10:16, 10:16])
            case = (nw << 3) | (ne << 2) | (sw << 1) | se
            case2frame.setdefault(case, r * COLS + c)  # first-seen canonical
    return case2frame


def diff_frac(line_a, line_b):
    d = np.sqrt(((line_a[:, :3].astype(float) - line_b[:, :3]) ** 2).sum(1))
    return (d > COLOR_TH).mean()


def water_fill_variants(warr):
    """All-opaque water tiles (rows 5-13), sorted cleanest-first by internal RGB stddev."""
    fills = []
    for r in range(5, 14):
        for c in range(10):
            t = warr[r * 16 : (r + 1) * 16, c * 16 : (c + 1) * 16]
            if (t[:, :, 3] > 128).mean() > 0.99 and is_water_block(t):
                fills.append(r * COLS + c)
    fills.sort(key=lambda f: warr[(f // COLS) * 16 : (f // COLS) * 16 + 16, (f % COLS) * 16 : (f % COLS) * 16 + 16, :3].std())
    return fills


def main():
    root = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
    wim, fim = sheet(WATER), sheet(FLOORS)
    warr = np.asarray(wim).astype(float)

    case2frame = build_case_map(warr)
    fills = water_fill_variants(warr)
    water_base, water_accents = fills[0], fills[1:8]
    grass_table = build_blob(FLOORS, 0, 4, 0, 12)
    grass_fills = [r * COLS + c for (c, r) in grass_table[FULL]]
    grass_base = min(grass_fills)  # 251, the canonical grass fill
    grass_accents = [f for f in grass_fills if f != grass_base]

    # --- organic lake mask (main body + two bays) ---
    W, H = 26, 20
    mask = new_mask(W, H)
    disc(mask, 12, 10, 8, 6)
    disc(mask, 17, 7, 4, 3.5)
    disc(mask, 8, 13, 3.5, 3)
    mask = smooth_mask(mask, 2)
    flat = [1 if mask[y][x] else 0 for y in range(H) for x in range(W)]

    def water_at(x, y):
        return 0 <= x < W and 0 <= y < H and flat[y * W + x] == 1

    rng = random.Random(3)
    cv = Image.new("RGBA", (W * TILE, H * TILE))
    # grass base: clean base everywhere + ~10% sparse dark accents
    for y in range(H):
        for x in range(W):
            f = grass_base if rng.random() > 0.10 else rng.choice(grass_accents)
            cv.alpha_composite(frame_tile(fim, f), (x * TILE, y * TILE))
    # dual-grid coast + water interior (clean base + ~12% foam accents) on (W+1)x(H+1) vertices
    placed = {}
    for y in range(H + 1):
        for x in range(W + 1):
            nw, ne = water_at(x - 1, y - 1), water_at(x, y - 1)
            sw, se = water_at(x - 1, y), water_at(x, y)
            case = (nw << 3) | (ne << 2) | (sw << 1) | se
            if case == 0:
                continue  # all land -> grass base shows
            if case in (6, 9):
                case = 15  # saddle fallback -> water (avoid by mask smoothing in the real feature)
            if case == 15:
                f = water_base if rng.random() > 0.12 else rng.choice(water_accents)
            else:
                f = case2frame.get(case)
            if f is None:
                continue
            placed[(x, y)] = f
            cv.alpha_composite(frame_tile(wim, f), (x * TILE, y * TILE))

    out = os.path.join(root, "scripts", "pixel-crawler", "biome_lake_poc.png")
    cv.resize((W * TILE * 5, H * TILE * 5), Image.NEAREST).save(out)

    # validate every placed seam with the pixel-adjacency test
    def wpx(f):
        c, r = f % COLS, f // COLS
        return warr[r * 16 : (r + 1) * 16, c * 16 : (c + 1) * 16]

    worst, bad = 0.0, 0
    for (x, y), f in placed.items():
        for dx, dy, dirn in [(1, 0, "E"), (0, 1, "S")]:
            g = placed.get((x + dx, y + dy))
            if g is None:
                continue
            a, b = wpx(f), wpx(g)
            df = diff_frac(a[:, 15], b[:, 0]) if dirn == "E" else diff_frac(a[15, :], b[0, :])
            worst = max(worst, df)
            bad += df > FRAC_TH
    print(f"wrote {out}")
    print(f"cases covered: {sorted(case2frame)} (missing saddles {[x for x in range(16) if x not in case2frame]})")
    print(f"water fills: {len(fills)} | seam validation: worst={worst:.2f}, over {FRAC_TH}={bad}")


if __name__ == "__main__":
    main()
