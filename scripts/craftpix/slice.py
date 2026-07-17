#!/usr/bin/env python3
"""Slice a CraftPix directional sprite sheet into one horizontal strip per row.

CraftPix packs many actors as a single sheet whose ROWS are facing directions
and COLUMNS are animation frames (e.g. a 6x4 walk = 4 directional clips of 6
frames). The rest of this codebase models actor animation as "one file = one
horizontal strip = one clip" (the wired pixel-crawler actors ship separate
per-direction files). So we NORMALISE CraftPix sheets at ingest by cutting each
N x rows sheet into `rows` strips of `cols` frames — after which the existing
catalog/StripAnim pipeline handles them with no new schema (see docs/CRAFTPIX.md,
docs/DECISIONS.md).

The row->facing order is NOT global — it differs per pack (verified visually):
  animals: row 0..3 = up, down, left, right
  guild:   row 0..3 = down, left, right, up
so callers pass the `dirs` list explicitly. Left/right are near-mirrors; the
3-way (down/up/side + flipX) rig picks one side at wire time, so an L/R mix-up is
cosmetic until then.

A sliced strip is `cols*cell_w` wide x `cell_h` tall. When cell_w == cell_h the
catalog auto-detects `cols` frames from the strip height; when they differ
(e.g. the mage's 64x52 cells) the caller must record a `frames: cols` override in
pack.json. `slice_directional` returns per-strip frame counts so the ingest can
emit exactly the overrides that are needed and no more.
"""
from __future__ import annotations

import os
import sys

from PIL import Image

# Row-index -> facing. Verify L/R when an actor is actually wired.
ANIMALS_DIRS = ["up", "down", "left", "right"]
GUILD_DIRS = ["down", "left", "right", "up"]


def slice_directional(src, dest_dir, base, cell_w, cell_h, dirs):
    """Cut `src` into one `<base>_<dir>.png` strip per row.

    Returns [(rel_filename, cols, non_square)] so the caller can decide overrides.
    """
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    if w % cell_w or h % cell_h:
        raise ValueError(f"{src}: {w}x{h} not divisible by cell {cell_w}x{cell_h}")
    cols, rows = w // cell_w, h // cell_h
    if rows != len(dirs):
        raise ValueError(f"{src}: {rows} rows but {len(dirs)} dir labels {dirs}")
    os.makedirs(dest_dir, exist_ok=True)
    out = []
    strip_w = cols * cell_w
    for r, d in enumerate(dirs):
        crop = im.crop((0, r * cell_h, strip_w, (r + 1) * cell_h))
        name = f"{base}_{d}.png"
        crop.save(os.path.join(dest_dir, name))
        out.append((name, cols, cell_w != cell_h))
    return out


def slice_columns(src, dest_dir, base, cell_w, cell_h, labels):
    """Cut a COLUMN-animation sheet into one horizontal `<base>_<label>.png` strip per column.

    The complement of `slice_directional`: some CraftPix sheets (the Home/Fx
    ambient anims — trees, cat) pack each animation as a VERTICAL column with its
    frames running TOP-TO-BOTTOM, several such animations side by side. Our
    StripAnim model is one-file = one-HORIZONTAL-strip = one clip, so we transpose
    each column into a horizontal strip: column `c`'s `rows` frames become a
    `rows*cell_w` wide x `cell_h` tall strip, frame `r` placed at x = r*cell_w.

    `labels` names the columns left-to-right (e.g. tree species/size). Returns
    [(rel_filename, frames, non_square)] — mirroring `slice_directional` so the
    caller emits the same `frames` override for non-square cells (a transposed
    strip's cell keeps the source `cell_w`x`cell_h`, so trees' 64x80 cells need a
    `frames` override just like the mage's 64x52 rows do).
    """
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    if w % cell_w or h % cell_h:
        raise ValueError(f"{src}: {w}x{h} not divisible by cell {cell_w}x{cell_h}")
    cols, rows = w // cell_w, h // cell_h
    if cols != len(labels):
        raise ValueError(f"{src}: {cols} columns but {len(labels)} labels {labels}")
    os.makedirs(dest_dir, exist_ok=True)
    out = []
    for c, label in enumerate(labels):
        strip = Image.new("RGBA", (rows * cell_w, cell_h), (0, 0, 0, 0))
        for r in range(rows):
            cell = im.crop((c * cell_w, r * cell_h, (c + 1) * cell_w, (r + 1) * cell_h))
            strip.paste(cell, (r * cell_w, 0))
        name = f"{base}_{label}.png"
        strip.save(os.path.join(dest_dir, name))
        out.append((name, rows, cell_w != cell_h))
    return out


if __name__ == "__main__":
    # Manual re-slice from a committed _src sheet. Two modes:
    #   rows  (directional): slice.py <src.png> <dest> <base> <cellW> <cellH> up,down,left,right
    #   cols  (column anims): slice.py --columns <src.png> <dest> <base> <cellW> <cellH> lbl0,lbl1,...
    if sys.argv[1:2] == ["--columns"]:
        src, dest_dir, base, cw, ch, labels = sys.argv[2:8]
        fn, unit = slice_columns, "frames"
        rows_or_dirs = labels.split(",")
    else:
        src, dest_dir, base, cw, ch, dirs = sys.argv[1:7]
        fn, unit = slice_directional, "frames"
        rows_or_dirs = dirs.split(",")
    for name, n, non_square in fn(src, dest_dir, base, int(cw), int(ch), rows_or_dirs):
        flag = f"  (non-square: needs frames:{n})" if non_square else ""
        print(f"  wrote {name}  {unit}={n}{flag}")
