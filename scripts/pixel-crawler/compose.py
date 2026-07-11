#!/usr/bin/env python3
"""Compositor lib for Pixel Crawler demo maps + tile-identification previews."""
import os
from PIL import Image, ImageDraw, ImageFont

# Resolve the in-repo asset dir (scripts/pixel-crawler -> public/assets/tilesets/pixel-crawler)
PC = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..",
    "public", "assets", "tilesets", "pixel-crawler"))
TILE = 16
_cache = {}

def sheet(rel):
    if rel not in _cache:
        _cache[rel] = Image.open(os.path.join(PC, rel)).convert("RGBA")
    return _cache[rel]

def tile(rel, c, r, tw=1, th=1):
    """Grab a tw x th block of tiles starting at tile-col c, tile-row r."""
    im = sheet(rel)
    return im.crop((c*TILE, r*TILE, (c+tw)*TILE, (r+th)*TILE))

def font(sz=11):
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", sz)
    except Exception:
        return ImageFont.load_default()

def preview(items, out, cell=None, scale=8, cols=8, bg=(40,40,48,255)):
    """items = list of (label, PIL image). Lay out in a grid, scaled, labelled."""
    imgs = [(lbl, im) for lbl, im in items]
    cell = cell or max(im.width for _, im in imgs)
    cw, chh = cell*scale, cell*scale
    rows = -(-len(imgs)//cols)
    pad, labh = 6, 16
    W = cols*(cw+pad)+pad
    H = rows*(chh+labh+pad)+pad
    canvas = Image.new("RGBA", (W, H), bg)
    d = ImageDraw.Draw(canvas)
    f = font(11)
    for i,(lbl,im) in enumerate(imgs):
        cx = pad + (i%cols)*(cw+pad)
        cy = pad + (i//cols)*(chh+labh+pad)
        # checker
        for yy in range(0, chh, 8*scale):
            for xx in range(0, cw, 8*scale):
                sh = 60 if ((xx//(8*scale))+(yy//(8*scale)))%2 else 80
                d.rectangle([cx+xx,cy+yy,cx+xx+8*scale,cy+yy+8*scale], fill=(sh,sh,sh,255))
        big = im.resize((im.width*scale, im.height*scale), Image.NEAREST)
        canvas.alpha_composite(big, (cx, cy))
        d.text((cx+1, cy+chh+2), lbl, fill=(255,255,120,255), font=f)
    canvas.save(out)
    print("wrote", out, canvas.size)

if __name__ == "__main__":
    F = "Environment/Tilesets/Floors_Tiles.png"
    W = "Environment/Tilesets/Water_tiles.png"
    WA = "Environment/Tilesets/Wall_Tiles.png"
    DG = "Environment/Tilesets/Dungeon_Tiles.png"
    items = []
    for (c,r) in [(5,24),(0,24),(1,24),(6,14),(5,22),(6,19),(0,0),(2,7)]:
        items.append((f"F {c},{r}", tile(F,c,r)))
    for (c,r) in [(0,0),(5,0),(2,7),(1,7)]:
        items.append((f"W {c},{r}", tile(W,c,r)))
    for (c,r) in [(1,21),(2,20),(1,22)]:
        items.append((f"WA {c},{r}", tile(WA,c,r)))
    for (c,r) in [(8,1),(15,4),(10,8),(9,14)]:
        items.append((f"DG {c},{r}", tile(DG,c,r)))
    preview(items, os.path.join(os.path.dirname(__file__),"grids","fills_preview.png"), cell=16, scale=8, cols=8)
