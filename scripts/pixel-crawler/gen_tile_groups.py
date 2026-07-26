#!/usr/bin/env python3
"""**Sheet-wide tile compatibility groups** — sweep a whole tileset sheet with the pairwise 1px-border
test (`edge_compat`) and report the GROUPS of tiles that can be placed next to each other with no hard
edge, so a human can see which tiles "go together" before any biome is authored around them.

Where `bake_edge_set.py` asks a narrow question (given the frames autotile.py already classified as
this terrain's fills, which of them may I scatter together?), this asks the open one: **across the
entire sheet, which tiles form mutually-compatible sets at all?** That's the tile-group discovery
step — the answer is a shortlist of candidate biome palettes derived from pixels rather than guessed
by eye, and the frames it names are what a `SETS` entry / `BiomeDef` band should then be built from.

Only **fully opaque** frames are considered: an alpha-cutout frame is an autotiler EDGE piece (its
seam behaviour is the mask's business, handled by the blob `mapping`), not a candidate biome fill.

Run: `python3 scripts/pixel-crawler/gen_tile_groups.py [--color-th 8] [--top 6]`
Writes (all gitignored — these are eyeball artifacts, not committed data):
  - `scripts/pixel-crawler/.tile-groups/<sheet>-groups.json`  every group + its frames
  - `scripts/pixel-crawler/.tile-groups/<sheet>-group<NN>.png` a random field of that group's
    placements (seeded) — a group is a clique, so ANY arrangement of it is seam-free; the render is
    the visual proof + shows what the group actually looks like as ground.
Each render is re-audited with `edge_compat.audit_canvas`; `hard edges` must print 0.
"""
import argparse
import json
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import edge_compat  # noqa: E402
from compose import sheet, TILE  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(os.path.dirname(__file__), ".tile-groups")

# The sheets worth sweeping (label -> path under public/assets/tilesets/pixel-crawler/).
SHEETS = {
    "floors": "Environment/Tilesets/Floors_Tiles.png",
    "water": "Environment/Tilesets/Water_tiles.png",
}
FIELD_W, FIELD_H = 14, 10  # tiles per group-preview render
SCALE = 4


def opaque_frames(arr, cols):
    """Every fully-opaque frame index on the sheet — the biome-fill candidates (see module doc)."""
    rows = arr.shape[0] // TILE
    out = []
    for r in range(rows):
        for c in range(cols):
            t = arr[r * TILE : (r + 1) * TILE, c * TILE : (c + 1) * TILE]
            if t.shape[2] < 4 or (t[:, :, 3] > 250).all():
                out.append(r * cols + c)
    return out


def frame_arr(arr, cols, f, rot=0):
    c, r = f % cols, f // cols
    t = arr[r * TILE : (r + 1) * TILE, c * TILE : (c + 1) * TILE]
    return np.rot90(t, rot) if rot else t


def dedupe_by_frames(groups, placements):
    """Collapse groups that cover the SAME FRAME SET (they differ only in which rotations of those
    frames made the clique) down to the largest one — otherwise the report is eight near-identical
    rows of the same palette and the genuinely distinct palettes get pushed off the shortlist."""
    best = {}
    for g in groups:
        key = tuple(sorted({placements[i][0] for i in g}))
        if key not in best or len(g) > len(best[key]):
            best[key] = g
    return sorted(best.values(), key=lambda g: (-len(g), g))


def render_field(im, cols, group, placements, seed, w=FIELD_W, h=FIELD_H):
    """A random w x h field drawn ONLY from `group` — the visual proof that the group is seam-free
    (and what it reads as at ground scale). Seeded so re-runs are comparable."""
    rng = random.Random(seed)
    cv = Image.new("RGBA", (w * TILE, h * TILE))
    for y in range(h):
        for x in range(w):
            f, rot = placements[rng.choice(group)]
            t = im.crop(((f % cols) * TILE, (f // cols) * TILE,
                         (f % cols + 1) * TILE, (f // cols + 1) * TILE))
            if rot:
                t = Image.fromarray(np.rot90(np.asarray(t), rot))
            cv.alpha_composite(t, (x * TILE, y * TILE))
    return cv


def contact_sheet(label, previews, cell_w, cell_h):
    """Montage the per-group previews into ONE labelled image — the artifact to actually look at (and
    the only practical way to review a sheet's palettes on a phone, per the repo's cross-device rule).
    Row order matches the printed report, so `group 03` in the console is the tile marked `03` here."""
    per_row = 2
    pad, hdr = 8, 14
    rows = (len(previews) + per_row - 1) // per_row
    cv = Image.new("RGBA", (per_row * (cell_w + pad) + pad, rows * (cell_h + hdr + pad) + pad),
                   (24, 24, 27, 255))
    draw = ImageDraw.Draw(cv)
    for i, (n, img, note) in enumerate(previews):
        x = pad + (i % per_row) * (cell_w + pad)
        y = pad + (i // per_row) * (cell_h + hdr + pad)
        draw.text((x, y + 2), f"{n:02d}  {note}", fill=(228, 228, 231, 255))
        cv.alpha_composite(img.convert("RGBA"), (x, y + hdr))
    out = os.path.join(OUT_DIR, f"{label}-contact.png")
    cv.save(out)
    return out


def sweep(label, path, color_th, top):
    im = sheet(path)
    arr = np.asarray(im).astype(float)
    cols = arr.shape[1] // TILE
    frames = opaque_frames(arr, cols)
    placements = [(f, rot) for f in frames for rot in range(4)]
    tiles = [frame_arr(arr, cols, f, rot) for f, rot in placements]
    H, V = edge_compat.fit_matrices(tiles, color_th)
    adj, self_ok = edge_compat.compat_graph(H, V)
    groups = dedupe_by_frames(edge_compat.compat_groups(adj, self_ok), placements)
    print(f"\n### {label} ({path})")
    print(f"  {len(frames)} opaque frames -> {len(placements)} placements, "
          f"{int(self_ok.sum())} self-tileable at colorTh={color_th}; {len(groups)} distinct groups")
    os.makedirs(OUT_DIR, exist_ok=True)
    report, previews = [], []
    for n, g in enumerate(groups[:top]):
        fs = sorted({placements[i][0] for i in g})
        cv = render_field(im, cols, list(g), placements, seed=100 + n)
        hard, worst, seams, _ = edge_compat.audit_canvas(cv)
        name = f"{label}-group{n:02d}.png"
        big = cv.resize((cv.width * SCALE, cv.height * SCALE), Image.NEAREST)
        big.save(os.path.join(OUT_DIR, name))
        previews.append((n, big.resize((cv.width * 2, cv.height * 2), Image.NEAREST),
                         f"{len(fs)} frames {fs[:6]}{'...' if len(fs) > 6 else ''}"))
        rc = sorted({(f // cols, f % cols) for f in fs})
        print(f"  group {n:02d}: {len(g):3} placements, {len(fs):2} frames {fs[:12]}"
              f"{'...' if len(fs) > 12 else ''}  rows {sorted({r for r, _ in rc})}"
              f"  -> {name} (hard edges = {hard}/{seams}, worst = {worst:.2f}"
              f"{'  <-- FAIL' if hard else ''})")
        report.append({"group": n, "placements": [list(placements[i]) for i in g], "frames": fs,
                       "preview": name, "hardEdges": hard, "worstSeam": round(worst, 3)})
    if previews:
        sheet_out = contact_sheet(label, previews, FIELD_W * TILE * 2, FIELD_H * TILE * 2)
        print(f"  contact sheet: {os.path.relpath(sheet_out, ROOT)}")
    with open(os.path.join(OUT_DIR, f"{label}-groups.json"), "w") as fh:
        json.dump({"sheet": path, "cols": cols, "colorTh": color_th, "fitTh": edge_compat.FIT_TH,
                   "opaqueFrames": len(frames), "selfTileable": int(self_ok.sum()),
                   "groups": report}, fh, indent=2)
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--color-th", type=int, default=edge_compat.COLOR_TH,
                    help="per-pixel RGBA distance two touching pixels may differ by and still count "
                         "as matching (default: edge_compat.COLOR_TH). Raise it to merge shades, "
                         "lower it for stricter groups.")
    ap.add_argument("--top", type=int, default=6, help="how many groups to render per sheet")
    ap.add_argument("--sheet", choices=sorted(SHEETS), action="append",
                    help="limit to one sheet (repeatable); default: all")
    args = ap.parse_args()
    for label in args.sheet or sorted(SHEETS):
        sweep(label, SHEETS[label], args.color_th, args.top)
    print(f"\nwrote {os.path.relpath(OUT_DIR, ROOT)}/ (previews + groups.json)")


if __name__ == "__main__":
    main()
