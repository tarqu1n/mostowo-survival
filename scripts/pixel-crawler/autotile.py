#!/usr/bin/env python3
"""Real 8-neighbour blob autotiler for the Pixel Crawler floor blobs.

Each terrain block (grass, dirt, gravel, water) is a blob set: tiles carry rounded
outer corners, straight edges, and concave inner corners, with alpha on the sides
that meet 'not this terrain'. We classify every tile by its edge+corner alpha, turn
that into an 8-bit neighbour key, then paint any terrain mask by looking up the key
per cell. Multiple tiles per key -> picked deterministically for variety."""
import os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from compose import sheet, TILE

def _edges_corners(t):
    a = np.asarray(t)[:, :, 3].astype(float) / 255
    if a.mean() < 0.03:
        return None
    N = a[0:3, :].mean() > 0.55; S = a[13:16, :].mean() > 0.55
    W = a[:, 0:3].mean() > 0.55; E = a[:, 13:16].mean() > 0.55
    ca = a[0:3, 0:3].mean() > 0.55    # NW
    cb = a[0:3, 13:16].mean() > 0.55  # NE
    cc = a[13:16, 0:3].mean() > 0.55  # SW
    cd = a[13:16, 13:16].mean() > 0.55  # SE
    return N, S, W, E, ca, cb, cc, cd

def blob_key(N, S, W, E, ca, cb, cc, cd):
    """8-bit key: cardinals + diagonals (a diagonal only counts if both its
    adjacent cardinals connect AND the corner pixel is filled)."""
    nw = 1 if (N and W and ca) else 0
    ne = 1 if (N and E and cb) else 0
    sw = 1 if (S and W and cc) else 0
    se = 1 if (S and E and cd) else 0
    return (int(N), int(E), int(S), int(W), ne, se, sw, nw)

def _mean_rgb(t):
    a = np.asarray(t).astype(float)
    m = a[:, :, 3] > 128
    if m.sum() == 0:
        return None
    return a[:, :, :3][m].mean(axis=0)

def build_blob(rel, c0, c1, r0, r1, tol=48):
    """Build an 8-neighbour blob table, colour-gated to this terrain only.
    Target colour = median of the fully-opaque fills in the box; any tile whose
    opaque pixels stray > tol (RGB dist) is rejected (kills brick/grass bleed
    from an adjacent block sharing the bounding box)."""
    im = sheet(rel)
    cells = []
    fills = []
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            t = im.crop((c*TILE, r*TILE, (c+1)*TILE, (r+1)*TILE))
            ec = _edges_corners(t)
            if ec is None:
                continue
            rgb = _mean_rgb(t)
            cells.append((c, r, ec, rgb))
            if (np.asarray(t)[:, :, 3] > 250).mean() > 0.98:
                fills.append(rgb)
    target = None
    if fills:
        arr = np.array(fills)
        med = np.median(arr, axis=0)
        inliers = arr[np.linalg.norm(arr - med, axis=1) < 25]  # drop outlier terrains
        target = inliers.mean(axis=0) if len(inliers) else med
    table = {}
    for c, r, ec, rgb in cells:
        if target is not None and rgb is not None:
            if np.linalg.norm(rgb - target) > tol:
                continue
        table.setdefault(blob_key(*ec), []).append((c, r))
    return table

FULL = (1, 1, 1, 1, 1, 1, 1, 1)  # fully-surrounded interior fill

def pick(table, key, rng):
    """Look up a tile for an 8-neighbour key, with graceful fallback."""
    if key in table:
        opts = table[key]
        return opts[rng.randrange(len(opts))]
    # fallback: ignore diagonals, match cardinals only
    n, e, s, w = key[:4]
    cand = [v for k, v in table.items() if k[:4] == (n, e, s, w)]
    if cand:
        flat = [t for lst in cand for t in lst]
        return flat[rng.randrange(len(flat))]
    # last resort: full fill
    return table.get(FULL, [(0, 0)])[0]

def paint_mask(canvas, rel, table, mask, rng):
    """mask: 2D bool array [rows][cols]. Layer this terrain's blob over canvas."""
    im = sheet(rel)
    H = len(mask); W = len(mask[0])
    def m(y, x):
        return 0 <= y < H and 0 <= x < W and mask[y][x]
    for y in range(H):
        for x in range(W):
            if not mask[y][x]:
                continue
            N, S, Wd, E = m(y-1, x), m(y+1, x), m(y, x-1), m(y, x+1)
            key = blob_key(N, S, Wd, E,
                           m(y-1, x-1), m(y-1, x+1), m(y+1, x-1), m(y+1, x+1))
            c, r = pick(table, key, rng)
            canvas.alpha_composite(im.crop((c*TILE, r*TILE, (c+1)*TILE, (r+1)*TILE)),
                                   (x*TILE, y*TILE))

def new_mask(W, H, val=False):
    return [[val]*W for _ in range(H)]

def smooth_mask(mask, passes=2):
    """Majority (cellular-automata) smoothing: removes single-tile spurs and fills
    single-tile notches so blob edges read as clean organic curves."""
    H = len(mask); W = len(mask[0])
    for _ in range(passes):
        nxt = [[mask[y][x] for x in range(W)] for y in range(H)]
        for y in range(H):
            for x in range(W):
                n = sum(mask[yy][xx]
                        for yy in range(max(0,y-1), min(H,y+2))
                        for xx in range(max(0,x-1), min(W,x+2))
                        if (yy, xx) != (y, x))
                if n >= 5: nxt[y][x] = True
                elif n <= 2: nxt[y][x] = False
        mask = nxt
    return mask

def disc(mask, cx, cy, rx, ry):
    H = len(mask); W = len(mask[0])
    for y in range(H):
        for x in range(W):
            if ((x-cx)/rx)**2 + ((y-cy)/ry)**2 <= 1.0:
                mask[y][x] = True

if __name__ == "__main__":
    F = "Environment/Tilesets/Floors_Tiles.png"
    for name, box in [("GRASS", (0,4,0,12)), ("DIRT", (11,15,0,12)), ("GRAVEL", (5,9,0,12))]:
        tb = build_blob(F, *box)
        print(f"{name}: {len(tb)} keys, {sum(len(v) for v in tb.values())} tiles; "
              f"fill variants={len(tb.get(FULL, []))}")
