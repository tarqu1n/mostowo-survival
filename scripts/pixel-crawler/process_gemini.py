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
# Output frame order (0-based indices into the generated left-to-right row). The raw
# strip's poses aren't the animation order we want; this re-sequences them. Owner call
# 2026-07-21: 3 2 4 5 1 (1-based) -> raised, wind-up, slash, follow-through, ready.
REORDER = [2, 1, 3, 4, 0]

# Cel-shade palette: outline-first, then flat fill by MATERIAL, shade chosen by
# brightness. Materials are classified from the gen's hue/saturation so the cloak's
# olive ramp and the (neutral) dagger greys never compete — the freckle bug came from
# a single nearest-colour snap where bright highlights fell onto the metal tones.
OUTLINE = (20, 20, 18)                    # black outline + face void (idle tone)
# Olive ramp skewed BRIGHT: (146,130,48) is the idle's dominant cloak tone (the
# "highlight green"); the darker entries are shadow only. Thresholds (below) keep the
# bulk of the cloak on the two lightest so it doesn't read as the shadow green.
OLIVE = [(55, 58, 32), (95, 86, 37), (146, 130, 48), (178, 158, 72)]
OLIVE_THRESH = [66, 96, 150]
METAL = [(70, 72, 78), (140, 143, 148), (205, 207, 212)]
ORANGE = [(181, 108, 48), (232, 150, 82)]  # belt / sash
EYE = (12, 152, 214)                       # idle glowing blue
MOUTH = (147, 45, 139)                     # idle purple grin

NEIGHBOURS = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]


def keyout(im):
    """Background-agnostic chroma key. Samples the corners for the bg colour (magenta or
    green), keys it out, and — when the bg is green (the white-outline-buffer variant) —
    erodes the near-white buffer ring inward so only the character's colour edge remains
    (interior whites like the blade aren't border-adjacent, so they survive)."""
    a = np.asarray(im.convert("RGBA")).astype(np.int16)
    h, w = a.shape[:2]
    corners = np.array([a[0, 0, :3], a[0, w - 1, :3], a[h - 1, 0, :3], a[h - 1, w - 1, :3]])
    bg = np.median(corners, axis=0)
    d = np.sqrt(((a[:, :, :3] - bg) ** 2).sum(2))
    a[d < KEY_TOL, 3] = 0
    if bg[1] > bg[0] + 40 and bg[1] > bg[2] + 40:          # green bg -> strip white buffer
        near_white = a[:, :, :3].min(2) > 180
        alpha = a[:, :, 3]
        for _ in range(4):
            adj = np.zeros(alpha.shape, bool)
            for dy, dx in NEIGHBOURS[:4]:
                adj |= np.roll(np.roll(alpha <= 16, dy, 0), dx, 1)
            alpha[near_white & (alpha > 16) & adj] = 0
    return a.astype(np.uint8)


def _one_px_per_blob(mask):
    """Reduce each connected blob in `mask` to a single pixel (nearest its centroid).
    Used to pin the eyes to 1px each rather than the 2-3px blobs the downscale leaves."""
    H, W = mask.shape
    seen = np.zeros_like(mask)
    out = np.zeros_like(mask)
    for sy in range(H):
        for sx in range(W):
            if not mask[sy, sx] or seen[sy, sx]:
                continue
            comp, stack = [], [(sy, sx)]
            seen[sy, sx] = True
            while stack:
                y, x = stack.pop()
                comp.append((y, x))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
            cy = sum(p[0] for p in comp) / len(comp)
            cx = sum(p[1] for p in comp) / len(comp)
            by, bx = min(comp, key=lambda p: (p[0] - cy) ** 2 + (p[1] - cx) ** 2)
            out[by, bx] = True
    return out


def _fill_by_brightness(out, mask, V, ramp, thresholds):
    """Paint `mask` pixels with a ramp colour chosen by brightness V (ascending
    thresholds; len == len(ramp) - 1)."""
    idx = np.zeros(V.shape, int)
    for t in thresholds:
        idx += (V >= t)
    for ci, colour in enumerate(ramp):
        out[mask & (idx == ci)] = colour


def posterize_cel(sheet):
    """Outline-first cel shade: draw the silhouette edge + dark internal seams black,
    then flat-fill interiors by material (olive cloak / grey blade / orange belt),
    shade picked by brightness. Kills the gen's texture and the freckle bug at once."""
    hsv = np.asarray(sheet.convert("RGB").convert("HSV")).astype(np.int16)
    H, S, V = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]  # 0..255 each
    alpha = np.asarray(sheet.split()[3])
    M = alpha > 16
    out = np.zeros((*M.shape, 3), np.uint8)

    # face accents: keep the gen's own blue-eye / purple-mouth pixels (they survive the
    # quantise under the void) and repaint them in the idle's exact tones, on top.
    eyes = M & (H >= 128) & (H <= 178) & (S >= 55) & (V >= 70)   # pale blue
    mouth = M & (H >= 188) & (H <= 232) & (S >= 55)              # purple/magenta

    # Classify by HUE, not just saturation: a desaturated gen (green-bg spill can drop the
    # cloud to S~30) must still read as olive, or it floods to grey. So warm-hued pixels
    # are cloak even when dull; metal is only genuinely neutral/cool low-sat pixels (blade).
    warm = (H >= 12) & (H <= 75)
    orange = M & warm & (H < 26) & (S >= 90)               # warm + low-hue + saturated -> belt
    metal = M & ~orange & ~warm & (S < 80)                 # neutral/cool + low-sat -> blade
    olive = M & ~orange & ~metal                           # all warm-hued (even dull) -> cloak

    # Brightness thresholds from the olive PERCENTILES (not fixed) so the ramp adapts to
    # whatever lighting the generation has — a darker gen won't collapse to shadow. Skewed
    # so the two lightest tones dominate (the pack's highlight green, not the shadow).
    ov = V[olive]
    olive_thr = ([int(np.percentile(ov, p)) for p in (24, 46, 72)]
                 if ov.size else OLIVE_THRESH)
    _fill_by_brightness(out, olive, V, OLIVE, olive_thr)
    _fill_by_brightness(out, metal, V, METAL, [110, 185])
    _fill_by_brightness(out, orange, V, ORANGE, [150])

    void_cut = min(34, int(np.percentile(V[M], 6))) if M.any() else 34
    out[M & (V < void_cut)] = OUTLINE                      # dark seams / face void
    bnd = np.zeros(M.shape, bool)                          # silhouette edge
    for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        bnd |= M & ~np.roll(np.roll(M, dy, 0), dx, 1)
    out[bnd] = OUTLINE

    # accents last, over the void. Eyes: blank the blob to void, then pin 1px each.
    out[eyes & ~bnd] = OUTLINE
    out[_one_px_per_blob(eyes & ~bnd)] = EYE
    out[mouth & ~bnd] = MOUTH

    return Image.fromarray(np.dstack([out, np.where(M, 255, 0).astype(np.uint8)]), "RGBA")


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

    # re-sequence to the desired animation order (guard against a differing count)
    order = REORDER if len(figs) == len(REORDER) else list(range(len(figs)))
    figs = [figs[i] for i in order]

    n = len(figs)
    sheet = Image.new("RGBA", (FRAME_W * n, FRAME_H), (0, 0, 0, 0))
    for i, fig in enumerate(figs):
        fig = defringe(fig)
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

    sheet = posterize_cel(sheet)                  # black outline + flat material fills
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / "Slice_Side-Sheet.png"
    sheet.save(dst)
    print(f"wrote {dst.relative_to(ROOT)}  ({sheet.width}x{sheet.height}, {n} frames of {FRAME_W}x{FRAME_H})")
    return dst


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="row5a")
    build(ap.parse_args().variant)
