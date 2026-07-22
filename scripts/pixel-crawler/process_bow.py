#!/usr/bin/env python3
"""Turn a Gemini-generated PLAYER bow strip into a pack-matching pixel sheet.

Second use of the process side of the AI sprite pipeline (docs/AI-SPRITE-PIPELINE.md;
process_gemini.py did the rogue). Same shape — keyout -> split -> defringe -> one shared
downscale -> baseline-align -> outline-first cel-shade -> GIF preview — retuned for the
PLAYER (Body_A):

  * GEOMETRY — Body_A frames are 64x64, the character ~30px tall with feet at y47
    (measured off the real idle sheet), not the rogue's 56px / y53. So a bow sheet drops
    in beside the player's existing idle/walk/attack strips with the SAME render footprint.
  * PALETTE — Body_A is one warm SKIN ramp (tan) + brown hair + green eyes, sampled from
    the real Idle_Side sheet. Unlike the rogue (olive cloak / grey blade / orange belt),
    there are no competing saturated materials: skin, hair and the wooden bow are all warm
    and are shaded off ONE brightness ramp (the bow lands on the dark end and reads as dark
    wood). Only the green eyes are re-injected as an accent.
  * ORDER — the strip is prompted in draw->release order (frames 1..5), so REORDER is
    identity; no re-sequencing like the rogue needed.

Input: a raw ~1024px magenta strip from gen_bow_gemini.py (`bow_<dir>.png`, or a numbered
sample). Output: `_derived/player/Bow_<Dir>-Sheet.png`. Raws are gitignored scratch — not
reproducible from the repo; re-run gen_bow_gemini.py (needs the key) to regenerate.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "public/assets/tilesets/pixel-crawler"
RAW = ROOT / "scripts/.gen-icons/raw"
OUT = PACK / "_derived/player"

BODY_H = 30       # target standing body height (px) — matches Body_A idle (measured y18-47)
FRAME_W, FRAME_H = 64, 64
BASELINE = 47     # feet y within the frame (Body_A content bottom)
KEY_TOL = 130     # high enough to also key the anti-aliased pink ring around the figure
# GIF preview plays at the in-game bow rate: the anim is registered one-shot over
# BOW_DRAW_MS (450ms) across 5 frames ~= 11fps. Keep in sync with actorAnims.ts / config.ts
# BOW_DRAW_MS so "too fast / too slow" is caught BEFORE wiring.
PREVIEW_FPS = 11
PREVIEW_SCALE = 6
PREVIEW_BG = (46, 46, 58)
# Output frame order per facing (0-based indices into the generated left-to-right row).
# The chosen raw strips: side's poses come out ready-late, so front-load the ready frame;
# down/up already read draw->release->recover left-to-right. Falls back to identity if a
# strip has a different frame count.
# Only `side` is generated via this pipeline (plan: ship the side bow mirrored L/R; the
# front/back facings keep the coded Pierce stand-in — the model can't hold a coherent bow
# firing toward/away from camera). side sample 3's frames read ready/draw/fulldraw/loose,
# and its 5th raw frame drops the bow, so reuse frame 0 (bow-in-hand ready) as the recover
# frame — keeps the bow visible in every frame and loops cleanly back to idle.
REORDER = {
    "side": [0, 1, 2, 3, 0],
}

# Cel-shade palette, sampled from Body_A Idle_Side. One warm ramp (deep->light) carries
# skin + hair + wooden bow (all warm; separated only by brightness); green eyes re-injected.
OUTLINE = (20, 20, 18)                                  # near-black outline + dark seams
WARM = [(118, 61, 43), (162, 101, 67), (217, 160, 102), (250, 200, 149)]  # #763d2b..#fac895
EYE = (76, 181, 40)                                     # idle green eye (#4cb528)

NEIGHBOURS = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]


def keyout(im):
    """Background-agnostic chroma key (shared with process_gemini.py): sample the corners
    for the bg (magenta here), key it out with a tolerance high enough to also take the
    anti-aliased ring. Green-bg white-buffer erosion is kept for parity but unused here."""
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
    """Reduce each connected blob in `mask` to a single pixel near its centroid (pins each
    eye to 1px rather than the 2-3px blob the downscale leaves)."""
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
    """Outline-first cel shade for the player: silhouette edge + dark seams black, then one
    warm ramp (skin/hair/wooden bow) filled by brightness, green eyes re-injected on top.
    Simpler than the rogue's multi-material split — the body has no competing accents."""
    hsv = np.asarray(sheet.convert("RGB").convert("HSV")).astype(np.int16)
    H, S, V = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    alpha = np.asarray(sheet.split()[3])
    M = alpha > 16
    out = np.zeros((*M.shape, 3), np.uint8)

    # green eyes: the one accent hue. Detected before the warm fill so a bright green
    # highlight doesn't get swept into the skin ramp.
    eyes = M & (H >= 70) & (H <= 150) & (S >= 60) & (V >= 60)
    warm = M & ~eyes

    # brightness thresholds from the warm PERCENTILES so the ramp adapts to the gen's
    # exposure (same trick as the rogue olive ramp; the main generalisation win).
    wv = V[warm]
    warm_thr = ([int(np.percentile(wv, p)) for p in (24, 46, 72)]
                if wv.size else [70, 110, 165])
    _fill_by_brightness(out, warm, V, WARM, warm_thr)

    void_cut = min(34, int(np.percentile(V[M], 6))) if M.any() else 34
    out[M & (V < void_cut)] = OUTLINE                      # dark seams
    bnd = np.zeros(M.shape, bool)                          # silhouette edge
    for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        bnd |= M & ~np.roll(np.roll(M, dy, 0), dx, 1)
    out[bnd] = OUTLINE

    out[eyes & ~bnd] = OUTLINE                             # blank eye blobs to void...
    out[_one_px_per_blob(eyes & ~bnd)] = EYE               # ...then pin 1px green each

    return Image.fromarray(np.dstack([out, np.where(M, 255, 0).astype(np.uint8)]), "RGBA")


def defringe(a, iters=4):
    """Bleed edge RGB outward into the transparent border so the downscale blends skin
    (not leftover magenta) at the silhouette edge. Alpha untouched."""
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


def _core_runs(count, thr):
    """Runs of columns whose opaque-pixel COUNT clears `thr` (the figure torsos)."""
    runs, x, W = [], 0, len(count)
    while x < W:
        if count[x] >= thr:
            x0 = x
            while x < W and count[x] >= thr:
                x += 1
            if x - x0 >= 6:                        # ignore thin specks
                runs.append((x0, x - 1))
        else:
            x += 1
    return runs


def split_figures(mask, expect):
    """Split the row into `expect` per-figure cells, robust to bows/arrows that bridge the
    gaps between figures (a plain any-opaque projection merges those — that gave a 3-wide
    'down' and 4-wide 'up'). A figure's torso is a TALL solid column; its bow/arrow limbs
    are only a few px tall, so thresholding each column by its opaque-pixel COUNT finds the
    torso cores while the thin props drop out. Cut at the midpoints between adjacent core
    centres so each figure keeps its own bow/arrow. Falls back to an equal split if the
    core count doesn't match `expect` (e.g. a pose whose torso density dips mid-body)."""
    count = mask.sum(0)
    W = mask.shape[1]
    thr = max(12, int(0.15 * count.max())) if count.max() else 12
    runs = _core_runs(count, thr)
    if len(runs) != expect:
        cols = np.where(count > 0)[0]
        if cols.size == 0:
            return []
        lo, hi = cols.min(), cols.max()
        step = (hi - lo + 1) / expect
        return [(int(lo + i * step), int(lo + (i + 1) * step) - 1) for i in range(expect)]
    centres = [(a + b) // 2 for a, b in runs]
    bounds = [0] + [(centres[i] + centres[i + 1]) // 2 for i in range(len(centres) - 1)] + [W]
    return [(bounds[i], bounds[i + 1] - 1) for i in range(len(centres))]


def build(direction, sample):
    suffix = "" if sample is None else f"_{sample}"
    src = RAW / f"bow_{direction}{suffix}.png"
    if not src.exists():
        raise SystemExit(f"missing raw strip {src.relative_to(ROOT)} — run gen_bow_gemini.py")
    a = keyout(Image.open(src))
    mask = a[:, :, 3] > 16
    expect = len(REORDER.get(direction, [])) or 5
    runs = split_figures(mask, expect)
    if len(runs) != expect:
        raise SystemExit(f"expected {expect} figures, split found {len(runs)}")

    figs = []
    for x0, x1 in runs:
        sub = a[:, x0:x1 + 1]
        yy = np.where((sub[:, :, 3] > 16).any(1))[0]
        figs.append(sub[yy.min():yy.max() + 1])

    heights = sorted(f.shape[0] for f in figs)
    ref = heights[len(heights) // 2]              # median (the standing frames)
    scale = BODY_H / ref

    want = REORDER.get(direction, list(range(len(figs))))
    order = want if len(figs) == len(want) else list(range(len(figs)))
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
        oy = BASELINE - fimg.height
        ox = i * FRAME_W + (FRAME_W - fimg.width) // 2
        sheet.alpha_composite(fimg, (ox, max(0, oy)))

    sheet = posterize_cel(sheet)
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / f"Bow_{direction.capitalize()}-Sheet.png"
    sheet.save(dst)
    print(f"wrote {dst.relative_to(ROOT)}  ({sheet.width}x{sheet.height}, {n} frames of {FRAME_W}x{FRAME_H})")
    write_preview(sheet, n, direction)
    return dst


def write_preview(sheet, n, direction):
    """Emit a looping GIF at the in-game bow rate (PREVIEW_FPS) so speed is judged before
    wiring. Gitignored scratch."""
    frames = []
    for i in range(n):
        fr = sheet.crop((i * FRAME_W, 0, i * FRAME_W + FRAME_W, FRAME_H))
        fr = fr.resize((FRAME_W * PREVIEW_SCALE, FRAME_H * PREVIEW_SCALE), Image.NEAREST)
        canvas = Image.new("RGBA", fr.size, PREVIEW_BG + (255,))
        canvas.alpha_composite(fr)
        frames.append(canvas.convert("P", palette=Image.ADAPTIVE))
    out = RAW.parent / f"bow_{direction}_preview.gif"
    out.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(out, save_all=True, append_images=frames[1:],
                   duration=round(1000 / PREVIEW_FPS), loop=0, disposal=2)
    print(f"preview -> {out.relative_to(ROOT)}  ({PREVIEW_FPS}fps, matches in-game)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", choices=["side", "down", "up"], required=True)
    ap.add_argument("--sample", type=int, default=None, help="numbered sample suffix, if any")
    args = ap.parse_args()
    build(args.dir, args.sample)
