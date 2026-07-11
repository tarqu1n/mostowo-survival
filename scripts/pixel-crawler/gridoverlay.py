#!/usr/bin/env python3
"""Overlay a numbered TILE grid on a sheet so I can read exact tile indices."""
import sys
from PIL import Image, ImageDraw, ImageFont

def overlay(path, out, tile=16, scale=6):
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    cols, rows = w // tile, h // tile
    # checkerboard bg so transparent tiles are visible
    bg = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    chk = Image.new("RGBA", (w, h))
    for y in range(h):
        for x in range(w):
            c = 90 if ((x // 8) + (y // 8)) % 2 else 130
            chk.putpixel((x, y), (c, c, c, 255))
    comp = Image.alpha_composite(chk, img)
    comp = comp.resize((w * scale, h * scale), Image.NEAREST)
    d = ImageDraw.Draw(comp)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 11)
    except Exception:
        font = ImageFont.load_default()
    ts = tile * scale
    for c in range(cols + 1):
        d.line([(c * ts, 0), (c * ts, rows * ts)], fill=(255, 0, 0, 160), width=1)
    for r in range(rows + 1):
        d.line([(0, r * ts), (cols * ts, r * ts)], fill=(255, 0, 0, 160), width=1)
    for r in range(rows):
        for c in range(cols):
            lbl = f"{c},{r}"
            d.text((c * ts + 2, r * ts + 1), lbl, fill=(255, 255, 0, 255), font=font)
            d.text((c * ts + 1, r * ts + 0), lbl, fill=(0, 0, 0, 255), font=font)
            d.text((c * ts + 2, r * ts + 1), lbl, fill=(255, 255, 0, 255), font=font)
    comp.save(out)
    print(f"{out}  ({cols}x{rows} tiles @ {tile}px)")

if __name__ == "__main__":
    overlay(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 16)
