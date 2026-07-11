#!/usr/bin/env python3
"""Find seamless 'fill' tiles: fully opaque + self-tiling (left~right, top~bottom edges)."""
import sys
from PIL import Image
import numpy as np

def seamless(path, tile=16, topn=12):
    im = np.asarray(Image.open(path).convert("RGBA")).astype(int)
    H, W, _ = im.shape
    cols, rows = W // tile, H // tile
    out = []
    for r in range(rows):
        for c in range(cols):
            t = im[r*tile:(r+1)*tile, c*tile:(c+1)*tile, :]
            a = t[:, :, 3]
            opaque = (a > 250).mean()
            if opaque < 0.999:
                continue
            rgb = t[:, :, :3]
            # wrap continuity: compare last col->first col, last row->first row
            dh = np.abs(rgb[:, -1, :] - rgb[:, 0, :]).mean()
            dv = np.abs(rgb[-1, :, :] - rgb[0, :, :]).mean()
            var = rgb.std()
            out.append((round(dh+dv,1), c, r, round(var,1)))
    out.sort()
    print(f"\n### {path.split('/')[-1]}  ({cols}x{rows} tiles)  — best seamless fills (edgediff, col,row, colorvar):")
    for s, c, r, v in out[:topn]:
        print(f"   ({c},{r})  edgediff={s}  var={v}")

for p in sys.argv[1:]:
    seamless(p)
