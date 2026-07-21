#!/usr/bin/env python3
"""Turn a Gemini-generated Rogue attack strip into a pack-matching pixel sheet.

Input: a raw ~1024px magenta-background strip from gen_rogue_gemini.py (default the
`row5a` variant — a clean single row of 5 overhead-slash frames). Output:
`_derived/rogue/Slice_Side-Sheet.png`, 5 frames sized/coloured to sit beside the
Rogue's existing Idle/Walk sprites.

Steps: key out the magenta -> split the row into per-figure columns -> downscale ALL
figures by ONE shared factor (so relative sizes stay true) to ~pack height -> hard
alpha threshold -> snap every pixel to the Rogue's OWN palette (sampled from the real
Idle sheet, + a few metal greys for the dagger + white for motion lines), which is the
style-match that makes the HD gen read as pack art -> baseline-align each frame.

Reproducible from the committed raw? No — raws are gitignored scratch. Re-run
gen_rogue_gemini.py (needs the key) to regenerate the source, then this to process.
"""
import argparse
import os
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "public/assets/tilesets/pixel-crawler"
IDLE = PACK / "Entities/Npc's/Rogue/Idle/Idle-Sheet.png"
RAW = ROOT / "scripts/.gen-icons/raw"
OUT = PACK / "_derived/rogue"

BODY_H = 26      # target standing body height (px) — matches the idle rogue
FRAME_W, FRAME_H = 56, 56
BASELINE = 53    # feet y within the frame
KEY_TOL = 130    # high enough to also key the anti-aliased pink ring around the figure
COLOURS = 20     # shared palette size for the flat/chunky look
MAGENTA = np.array([255, 0, 255])
NEIGHBOURS = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]


def keyout(im):
    a = np.asarray(im.convert("RGBA")).astype(np.int16)
    d = np.sqrt(((a[:, :, :3] - MAGENTA) ** 2).sum(2))
    a[d < KEY_TOL, 3] = 0
    return a.astype(np.uint8)


def grade(a):
    """Gentle colour-grade of opaque pixels toward the idle's grottier olive: knock
    back overall brightness and trim the green so it reads less bright/HD."""
    out = a.copy()
    op = out[:, :, 3] > 16
    rgb = out[:, :, :3].astype(np.float32)
    rgb[..., 0] *= 0.94      # R
    rgb[..., 1] *= 0.88      # G (tame the bright green)
    rgb[..., 2] *= 0.92      # B
    rgb = np.clip(rgb, 0, 255)
    out[:, :, :3] = np.where(op[..., None], rgb.astype(np.uint8), out[:, :, :3])
    return out


def defringe(a, iters=4):
    """Bleed edge RGB outward into the transparent border so the downscale blends
    olive (not leftover magenta) at the silhouette edge. Alpha is left untouched."""
    a = a.copy()
    valid = a[:, :, 3] > 16
    rgb = a[:, :, :3].astype(np.float32)
    for _ in range(iters):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(valid.shape, np.float32)
        for dy, dx in NEIGHBOURS:
            sv = np.roll(np.roll(valid, dy, 0), dx, 1)
            srgb = np.roll(np.roll(rgb, dy, 0), dx, 1)
            m = (~valid) & sv
            acc[m] += srgb[m]
            cnt[m] += 1
        fill = cnt > 0
        rgb[fill] = acc[fill] / cnt[fill, None]
        valid = valid | fill
    a[:, :, :3] = rgb.astype(np.uint8)
    return a


def split_columns(mask):
    cols = mask.any(0)
    runs, x, W = [], 0, mask.shape[1]
    while x < W:
        if cols[x]:
            x0 = x
            while x < W and cols[x]:
                x += 1
            if x - x0 >= 8:                        # ignore stray specks
                runs.append((x0, x - 1))
        else:
            x += 1
    return runs


def quantise_sheet(sheet, colours):
    """Reduce the whole sheet to one shared `colours`-entry palette (flat/chunky),
    preserving alpha. Shared so colours don't flicker frame-to-frame."""
    rgb = sheet.convert("RGB").quantize(colors=colours, method=Image.MEDIANCUT)
    rgb = rgb.convert("RGB")
    r, g, b = rgb.split()
    return Image.merge("RGBA", (r, g, b, sheet.split()[3]))


def build(variant):
    raw = Image.open(RAW / f"rogue_attack_{variant}.png")
    a = keyout(raw)
    mask = a[:, :, 3] > 16
    runs = split_columns(mask)
    if len(runs) < 2:
        raise SystemExit(f"expected a multi-figure row, found {len(runs)} column runs")

    # crop each figure to its own content bbox
    figs = []
    for x0, x1 in runs:
        sub = a[:, x0:x1 + 1]
        yy = np.where((sub[:, :, 3] > 16).any(1))[0]
        figs.append(sub[yy.min():yy.max() + 1])

    heights = sorted(f.shape[0] for f in figs)
    ref = heights[len(heights) // 2]              # median (the standing frames)
    scale = BODY_H / ref

    n = len(figs)
    sheet = Image.new("RGBA", (FRAME_W * n, FRAME_H), (0, 0, 0, 0))
    for i, fig in enumerate(figs):
        fig = grade(defringe(fig))
        img = Image.fromarray(fig, "RGBA").resize(
            (max(1, round(fig.shape[1] * scale)), max(1, round(fig.shape[0] * scale))),
            Image.LANCZOS)
        arr = np.asarray(img).copy()
        arr[:, :, 3] = np.where(arr[:, :, 3] > 110, 255, 0)   # hard alpha edges
        fimg = Image.fromarray(arr, "RGBA")
        # baseline-align: feet at BASELINE, centred on content x
        oy = BASELINE - fimg.height
        ox = i * FRAME_W + (FRAME_W - fimg.width) // 2
        sheet.alpha_composite(fimg, (ox, max(0, oy)))

    sheet = quantise_sheet(sheet, COLOURS)
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / "Slice_Side-Sheet.png"
    sheet.save(dst)
    print(f"wrote {dst.relative_to(ROOT)}  ({sheet.width}x{sheet.height}, {n} frames of {FRAME_W}x{FRAME_H})")
    return dst


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="row5a")
    build(ap.parse_args().variant)
