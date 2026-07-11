#!/usr/bin/env python3
"""Classify each tile in a Floors terrain block by edge/corner alpha connectivity,
so we can reconstruct the blob-autotile template."""
import sys, os
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from compose import sheet, TILE

def sig(t):
    a = np.asarray(t)[:, :, 3].astype(float) / 255
    op = a.mean()
    if op < 0.03:
        return "····", op
    N = a[0:3, :].mean();  S = a[13:16, :].mean()
    W = a[:, 0:3].mean();  E = a[:, 13:16].mean()
    def b(v): return v > 0.55
    edges = "".join(c for c, v in zip("NSWE", (N, S, W, E)) if b(v))
    # corners: is the extreme 3x3 corner opaque?
    cor = ""
    for name,(ys,xs) in {"a":(slice(0,3),slice(0,3)), "b":(slice(0,3),slice(13,16)),
                          "c":(slice(13,16),slice(0,3)), "d":(slice(13,16),slice(13,16))}.items():
        if a[ys,xs].mean() > 0.55: cor += name
    return f"{edges:<4}|{cor}", op

def dump(rel, c0, c1, r0, r1, label):
    im = sheet(rel)
    print(f"\n### {label}  cols {c0}-{c1}, rows {r0}-{r1}")
    print("    " + "".join(f"{c:^11}" for c in range(c0, c1+1)))
    for r in range(r0, r1+1):
        cells = []
        for c in range(c0, c1+1):
            t = im.crop((c*TILE, r*TILE, (c+1)*TILE, (r+1)*TILE))
            s, op = sig(t)
            cells.append(f"{s:^11}")
        print(f"r{r:<2} " + "".join(cells))

if __name__ == "__main__":
    F = "Environment/Tilesets/Floors_Tiles.png"
    dump(F, 0, 5, 0, 12, "GRASS block")
    dump(F, 11, 15, 0, 12, "BROWN DIRT block")
    dump(F, 6, 10, 0, 12, "GREY GRAVEL block")
