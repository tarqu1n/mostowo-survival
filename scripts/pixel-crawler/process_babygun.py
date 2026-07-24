#!/usr/bin/env python3
"""Turn a Gemini-generated BABY GUNNER strip / hero into pack-matching pixel sprites.

Fourth-ish use of the process side of the AI sprite pipeline (docs/AI-SPRITE-PIPELINE.md).
Unlike the rogue/player (one warm ramp, outline-first cel-shade), the Baby Gunner is a
MULTI-MATERIAL subject — tan skin, pale-blue onesie, white dummy, black minigun, green
eyes, yellow muzzle flash — so we follow the STATIC-PROP playbook instead of a single-ramp
cel-shade: keep the generation's OWN colours, flatten them by COUNT (median-cut quantise),
then re-assert a crisp 1px dark outline after the downscale. Snapping to one ramp would
crush the blue onesie / white dummy / green eyes into skin.

Shape: keyout (magenta) -> density-based figure split (the wide minigun bridges the gaps
between frames, so an any-opaque projection merges them — threshold columns by opaque COUNT
to find the torso cores, same trick as the bow) -> defringe -> one shared downscale ->
baseline-align -> median-cut flatten + outline. Emits the committed sheet, a transparent
hero PNG, a big zoomed contact sheet, and a looping GIF preview (all but the sheet/hero are
gitignored scratch).

Input: raw ~1024px magenta PNGs from gen_babygun_gemini.py in scripts/.gen-icons/raw/.
Output: _derived/babygun/Idle_Down-Sheet.png + hero.png. Raws are gitignored — re-run the
gen script (needs GEMINI_API_KEY) to regenerate.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "public/assets/tilesets/pixel-crawler"
RAW = ROOT / "scripts/.gen-icons/raw"
OUT = PACK / "_derived/babygun"
SCRATCH = ROOT / "scripts/.gen-icons"

BODY_H = 40        # target figure height (px) — the baby+gun read a touch bigger than a
                   # plain Body_A (30px) because the minigun dominates the silhouette
FRAME_W, FRAME_H = 96, 64   # wider than the 64px pack frame so the oversized gun fits
BASELINE = 54      # feet y within the frame
KEY_TOL = 130      # high enough to also key the anti-aliased pink ring
QUANTISE_COLOURS = 14   # flatten the painterly gen to ~this many flat regions (multi-material)
OUTLINE = (20, 20, 18)  # near-black re-outline tone, matches the pack's dark-outlined art
PREVIEW_FPS = 10
PREVIEW_SCALE = 5
PREVIEW_BG = (46, 46, 58)

NEIGHBOURS = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]


def keyout(im):
    a = np.asarray(im.convert("RGBA")).astype(np.int16)
    h, w = a.shape[:2]
    corners = np.array([a[0, 0, :3], a[0, w - 1, :3], a[h - 1, 0, :3], a[h - 1, w - 1, :3]])
    bg = np.median(corners, axis=0)
    d = np.sqrt(((a[:, :, :3] - bg) ** 2).sum(2))
    a[d < KEY_TOL, 3] = 0
    return a.astype(np.uint8)


def defringe(a, iters=4):
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
    runs, x, W = [], 0, len(count)
    while x < W:
        if count[x] >= thr:
            x0 = x
            while x < W and count[x] >= thr:
                x += 1
            if x - x0 >= 6:
                runs.append((x0, x - 1))
        else:
            x += 1
    return runs


def split_figures(mask, expect):
    """Split the row into `expect` figures via opaque-pixel COUNT per column (torsos are
    tall solid columns; the minigun barrels are only a few px tall and drop out), cutting at
    midpoints between torso cores. Falls back to an equal split if the core count is off."""
    count = mask.sum(0)
    W = mask.shape[1]
    thr = max(12, int(0.30 * count.max())) if count.max() else 12
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


def flatten_and_outline(img):
    """Median-cut flatten the figure's own colours to QUANTISE_COLOURS flat regions (keeps
    skin/blue/white/black/green/flash), hard-threshold alpha, then re-assert a 1px dark
    silhouette outline so it reads as pixel art next to the pack's dark-outlined sprites."""
    arr = np.asarray(img).copy()
    alpha = arr[:, :, 3]
    M = alpha > 110
    rgb = Image.fromarray(arr[:, :, :3], "RGB").quantize(
        colors=QUANTISE_COLOURS, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGB")
    out = np.dstack([np.asarray(rgb), np.where(M, 255, 0).astype(np.uint8)])
    # kill any stray magenta the quantiser may have minted near dark interiors
    r, g, b = out[:, :, 0], out[:, :, 1], out[:, :, 2]
    stray = (r > 180) & (b > 180) & (g < 110)
    out[stray] = (*OUTLINE, 255)
    # re-outline: every opaque pixel bordering transparency -> dark tone
    bnd = np.zeros(M.shape, bool)
    for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        bnd |= M & ~np.roll(np.roll(M, dy, 0), dx, 1)
    out[bnd] = (*OUTLINE, 255)
    out[~M] = (0, 0, 0, 0)
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def _figures_from_raw(src, expect):
    a = keyout(Image.open(src))
    mask = a[:, :, 3] > 16
    runs = split_figures(mask, expect)
    figs = []
    for x0, x1 in runs:
        sub = a[:, x0:x1 + 1]
        cols = np.where((sub[:, :, 3] > 16).any(0))[0]
        rows = np.where((sub[:, :, 3] > 16).any(1))[0]
        if cols.size == 0 or rows.size == 0:
            continue
        figs.append(sub[rows.min():rows.max() + 1, cols.min():cols.max() + 1])
    return figs


def _despeckle(img, min_px=10):
    """Drop tiny disconnected opaque components (stray flash sparks / split-bleed slivers
    that land in a neighbouring cell) while keeping the body and the large muzzle flash."""
    arr = np.asarray(img).copy()
    M = arr[:, :, 3] > 16
    H, W = M.shape
    seen = np.zeros_like(M)
    for sy in range(H):
        for sx in range(W):
            if not M[sy, sx] or seen[sy, sx]:
                continue
            comp, stack = [], [(sy, sx)]
            seen[sy, sx] = True
            while stack:
                y, x = stack.pop()
                comp.append((y, x))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < H and 0 <= nx < W and M[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
            if len(comp) < min_px:
                for y, x in comp:
                    arr[y, x] = (0, 0, 0, 0)
    return Image.fromarray(arr, "RGBA")


def _place(fig, scale):
    fig = defringe(fig)
    img = Image.fromarray(fig, "RGBA").resize(
        (max(1, round(fig.shape[1] * scale)), max(1, round(fig.shape[0] * scale))),
        Image.LANCZOS)
    arr = np.asarray(img).copy()
    arr[:, :, 3] = np.where(arr[:, :, 3] > 110, 255, 0)
    return _despeckle(flatten_and_outline(Image.fromarray(arr, "RGBA")))


def build_strip(name, expect):
    src = RAW / f"babygun_{name}.png"
    if not src.exists():
        raise SystemExit(f"missing {src.relative_to(ROOT)} — run gen_babygun_gemini.py")
    figs = _figures_from_raw(src, expect)
    if len(figs) != expect:
        raise SystemExit(f"{name}: expected {expect} figures, split found {len(figs)}")
    ref = sorted(f.shape[0] for f in figs)[len(figs) // 2]
    scale = BODY_H / ref
    n = len(figs)
    sheet = Image.new("RGBA", (FRAME_W * n, FRAME_H), (0, 0, 0, 0))
    for i, fig in enumerate(figs):
        fimg = _place(fig, scale)
        oy = BASELINE - fimg.height
        ox = i * FRAME_W + (FRAME_W - fimg.width) // 2
        sheet.alpha_composite(fimg, (ox, max(0, oy)))
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / "Idle_Down-Sheet.png"
    sheet.save(dst)
    print(f"wrote {dst.relative_to(ROOT)}  ({sheet.width}x{sheet.height}, {n} frames of {FRAME_W}x{FRAME_H})")
    write_preview(sheet, n, name)
    write_contact(sheet, n, name)
    return dst


def build_hero(name="hero"):
    src = RAW / f"babygun_{name}.png"
    if not src.exists():
        raise SystemExit(f"missing {src.relative_to(ROOT)} — run gen_babygun_gemini.py")
    a = keyout(Image.open(src))
    rows = np.where((a[:, :, 3] > 16).any(1))[0]
    cols = np.where((a[:, :, 3] > 16).any(0))[0]
    fig = a[rows.min():rows.max() + 1, cols.min():cols.max() + 1]
    scale = (BODY_H + 12) / fig.shape[0]
    fimg = _place(fig, scale)
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / "hero.png"
    fimg.save(dst)
    print(f"wrote {dst.relative_to(ROOT)}  ({fimg.width}x{fimg.height})")
    return dst


def write_preview(sheet, n, name):
    frames = []
    for i in range(n):
        fr = sheet.crop((i * FRAME_W, 0, i * FRAME_W + FRAME_W, FRAME_H))
        fr = fr.resize((FRAME_W * PREVIEW_SCALE, FRAME_H * PREVIEW_SCALE), Image.NEAREST)
        canvas = Image.new("RGBA", fr.size, PREVIEW_BG + (255,))
        canvas.alpha_composite(fr)
        frames.append(canvas.convert("P", palette=Image.ADAPTIVE))
    out = SCRATCH / f"babygun_{name}_preview.gif"
    out.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(out, save_all=True, append_images=frames[1:],
                   duration=round(1000 / PREVIEW_FPS), loop=0, disposal=2)
    print(f"preview -> {out.relative_to(ROOT)}  ({PREVIEW_FPS}fps)")


def write_contact(sheet, n, name):
    """A big zoomed left-to-right contact sheet PNG for at-a-glance review."""
    scale = 5
    strip = sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST)
    canvas = Image.new("RGBA", strip.size, PREVIEW_BG + (255,))
    canvas.alpha_composite(strip)
    out = SCRATCH / f"babygun_{name}_contact.png"
    canvas.convert("RGB").save(out)
    print(f"contact -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--strip", default="down", help="strip variant name (default down)")
    ap.add_argument("--frames", type=int, default=4)
    ap.add_argument("--hero", action="store_true", help="also process the hero portrait")
    args = ap.parse_args()
    build_strip(args.strip, args.frames)
    if args.hero:
        build_hero()
