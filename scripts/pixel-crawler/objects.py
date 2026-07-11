#!/usr/bin/env python3
"""Extract individual placeable objects from multi-object sheets via connected
components of opaque pixels (with gap tolerance), and preview them numbered."""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
from compose import PC, sheet, font

def components(rel, alpha_thresh=8, gap=1, min_area=40):
    im = np.asarray(sheet(rel))
    real = im[:, :, 3] > alpha_thresh          # true object pixels
    a = real.copy()
    if gap:                                     # dilate only to bridge tiny gaps
        from itertools import product
        for dy, dx in product(range(-gap, gap+1), repeat=2):
            a = a | np.roll(np.roll(real, dy, 0), dx, 1)
    H, W = a.shape
    lbl = np.zeros((H, W), int); cur = 0; boxes = []
    for sy in range(H):
        for sx in range(W):
            if a[sy, sx] and lbl[sy, sx] == 0:
                cur += 1; stack = [(sy, sx)]; lbl[sy, sx] = cur
                x0 = x1 = y0 = y1 = None
                while stack:
                    y, x = stack.pop()
                    if real[y, x]:              # tighten box on REAL pixels only
                        x0 = x if x0 is None else min(x0, x)
                        x1 = x if x1 is None else max(x1, x)
                        y0 = y if y0 is None else min(y0, y)
                        y1 = y if y1 is None else max(y1, y)
                    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny, nx = y+dy, x+dx
                        if 0 <= ny < H and 0 <= nx < W and a[ny, nx] and lbl[ny, nx] == 0:
                            lbl[ny, nx] = cur; stack.append((ny, nx))
                if x0 is not None and (x1-x0+1)*(y1-y0+1) >= min_area:
                    boxes.append((x0, y0, x1+1, y1+1))
    boxes.sort(key=lambda b: (round(b[1]/16), b[0]))
    return boxes

def crop(rel, box):
    return sheet(rel).crop(box)

def preview_components(rel, out, scale=4, cols=8, **kw):
    boxes = components(rel, **kw)
    imgs = [(f"{i}", crop(rel, b)) for i, b in enumerate(boxes)]
    maxw = max(i.width for _, i in imgs); maxh = max(i.height for _, i in imgs)
    cw, ch = maxw*scale, maxh*scale
    pad, labh = 6, 14
    rows = -(-len(imgs)//cols)
    W = cols*(cw+pad)+pad; H = rows*(ch+labh+pad)+pad
    canvas = Image.new("RGBA", (W, H), (35,35,45,255))
    d = ImageDraw.Draw(canvas); f = font(11)
    for i,(lbl,im) in enumerate(imgs):
        cx = pad+(i%cols)*(cw+pad); cy = pad+(i//cols)*(ch+labh+pad)
        d.rectangle([cx,cy,cx+cw,cy+ch], fill=(70,70,80,255))
        big = im.resize((im.width*scale, im.height*scale), Image.NEAREST)
        canvas.alpha_composite(big, (cx, cy))
        d.text((cx+1, cy+ch+1), f"{lbl}:{im.width}x{im.height}", fill=(255,240,120,255), font=f)
    canvas.save(out)
    print(f"{rel}: {len(boxes)} objects -> {out}")
    for i,b in enumerate(boxes):
        print(f"   [{i}] box={b} size={b[2]-b[0]}x{b[3]-b[1]}")

if __name__ == "__main__":
    g = os.path.join(os.path.dirname(__file__), "grids")
    jobs = [
        ("Environment/Props/Static/Trees/Model_02/Size_03.png", "obj_trees2.png", {}),
        ("Environment/Props/Static/Vegetation.png", "obj_veg.png", {"min_area":20}),
        ("Environment/Props/Static/Rocks.png", "obj_rocks.png", {}),
        ("Environment/Props/Static/Resources.png", "obj_resources.png", {"min_area":16}),
    ]
    for rel, out, kw in jobs:
        preview_components(rel, os.path.join(g, out), **kw)
