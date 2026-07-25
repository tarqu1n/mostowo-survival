#!/usr/bin/env python3
"""Ask Gemini ("Nano Banana", gemini-2.5-flash-image) to draw a BIGGER wooden crafting
WORKBENCH prop for the crafting station (plan 051 Step 6), image-to-image from the
current in-game workbench so the new one keeps the SAME top-down-oblique camera and the
pack's flat chunky palette — only bigger/sturdier (rendered ~2 tiles tall).

Fourth use of the AI sprite pipeline; a STATIC WORLD PROP like the tents/jetty
(docs/AI-SPRITE-PIPELINE.md § Static world-prop sprites). The hard part for a prop is
ORIENTATION + matching the flat palette, so — per the playbook — the orientation is
anchored by feeding the REAL current workbench sprite (its region crop, upscaled on
magenta) as the image-to-image reference; text alone won't hold a top-down oblique prop.

Two modes:
  * generate (default): call Gemini `--samples` times → raw ~1024px PNGs in the gitignored
    scratch dir (needs GEMINI_API_KEY in env, lives in guppi/house-helper/.env, LAN-only).
  * --reprocess: re-bake the committed sprite from the saved raws at the current settings
    (free, no key) — so palette/outline/size tuning never needs a regeneration.

Post-process (both the fresh raw and --reprocess): key out magenta -> autocrop to content
-> LANCZOS downscale to BODY_H tall (scale-1 at render: tilesTall*TILE_SIZE == BODY_H) ->
hard alpha threshold -> median-cut flatten to ~QUANTISE_COLOURS (bands the painterly
shading into flat pack-like regions while keeping the wood hue) -> 1px dark silhouette
outline (re-crisps the soft downscaled edge). Output:
`public/assets/tilesets/pixel-crawler/_derived/workbench/Workbench.png`.
"""
import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ENDPOINT = ("https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-2.5-flash-image:generateContent")
ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "public/assets/tilesets/pixel-crawler"
# The current in-game workbench (region crop authored in buildables.ts) — the orientation anchor.
CUR_SHEET = PACK / "Environment/Structures/Stations/Workbench/Workbench.png"
CUR_REGION = (0, 84, 32, 84 + 28)  # x0,y0,x1,y1 (buildables.ts workbench.objectSprite.region)
RAW = ROOT / "scripts/.gen-icons/raw"
OUT = PACK / "_derived/workbench/Workbench.png"

# Render target: buildables sets tilesTall:2, and WorkbenchBehavior scales the frame to
# TILE_SIZE*tilesTall == 16*2 == 32px tall. Bake to exactly that so render scale == 1.0
# (pixel-perfect, no Phaser resampling). Width follows the source aspect ratio.
BODY_H = 32
QUANTISE_COLOURS = 10   # median-cut flatten target — bands painterly shading to flat pack regions
KEY_TOL = 130           # magenta key tolerance (also eats the anti-aliased pink halo)
ALPHA_THRESH = 128      # hard 1-bit alpha after downscale — pixel-art crisp, no soft fringe
OUTLINE = (24, 20, 16)  # near-black silhouette outline re-asserted after the downscale

MAGENTA = ("CRITICAL BACKGROUND: one flat uniform MAGENTA background hex #FF00FF filling the "
           "whole image, no gradient, no shadow, no ground plane. No text, no numbers, no "
           "border, no frame, no UI.")
FLAT = ("Match the reference's simple flat CHUNKY low-detail pixel-art look: flat blocky "
        "colours, minimal banded shading, big readable shapes, strong near-black outline — "
        "NOT high-detail, NOT painterly, no anti-aliasing, no gradients, no photo-realism.")
PROP = (
    "The attached image is the reference: a small top-down-oblique wooden CRAFTING WORKBENCH "
    "in dark grotty survival-horror pixel art — a sturdy brown wooden carpenter's bench seen "
    "from above at a slight angle (you look DOWN onto its top and a little at its front legs). "
    "Redraw THIS EXACT same workbench, same camera angle and same flat wooden palette, but "
    "BIGGER, TALLER and STURDIER: a heavier thick-timber workbench with a taller pegboard / "
    "tool-rack standing up behind the bench top, more worn tools laid on and hanging from it "
    "(a hand saw, a claw hammer / mallet, a chisel, some cut wood planks and offcuts, maybe a "
    "small vice clamped to the front edge). Keep it ONE single free-standing prop, centred, "
    "facing the viewer the same way as the reference, feet/base on a shared bottom line. Grotty, "
    "well-used, dark-fantasy but a little funny."
)


def reference_png() -> bytes:
    """Current workbench region crop, upscaled x8 on magenta — the orientation/palette anchor."""
    im = Image.open(CUR_SHEET).convert("RGBA").crop(CUR_REGION)
    im = im.resize((im.width * 8, im.height * 8), Image.NEAREST)
    canvas = Image.new("RGBA", (512, 512), (255, 0, 255, 255))
    canvas.alpha_composite(im, ((512 - im.width) // 2, (512 - im.height) // 2))
    out = RAW / "_workbench_reference.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out)
    return out.read_bytes()


def gemini(prompt: str, images: list, key: str) -> bytes:
    parts = [{"text": prompt}]
    for img in images:
        parts.append({"inline_data": {"mime_type": "image/png",
                                      "data": base64.b64encode(img).decode()}})
    body = json.dumps({"contents": [{"parts": parts}]}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
        "Content-Type": "application/json", "x-goog-api-key": key})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            payload = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"Gemini HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:800]}")
    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    sys.exit(f"No image in response: {json.dumps(payload)[:600]}")


def key_magenta(im: Image.Image) -> Image.Image:
    """Make the flat magenta background transparent (tolerant enough to eat the pink halo)."""
    arr = np.asarray(im.convert("RGBA")).astype(int)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    is_key = (np.abs(r - 255) < KEY_TOL) & (g < KEY_TOL) & (np.abs(b - 255) < KEY_TOL)
    arr[is_key, 3] = 0
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def autocrop(im: Image.Image) -> Image.Image:
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > ALPHA_THRESH)
    if len(xs) == 0:
        return im
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def outline(im: Image.Image) -> Image.Image:
    """1px dark silhouette outline: any opaque pixel bordering transparency gets an outline
    ring drawn just outside it, re-crisping the soft LANCZOS edge to match the pack."""
    arr = np.asarray(im).copy()
    a = arr[..., 3] > ALPHA_THRESH
    ring = np.zeros_like(a)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ring |= np.roll(a, (dy, dx), (0, 1)) & ~a
    arr[ring] = (*OUTLINE, 255)
    return Image.fromarray(arr, "RGBA")


def process(raw: Image.Image) -> Image.Image:
    im = key_magenta(raw)
    im = autocrop(im)
    scale = BODY_H / im.height
    im = im.resize((max(1, round(im.width * scale)), BODY_H), Image.LANCZOS)
    arr = np.asarray(im).copy()
    arr[..., 3] = np.where(arr[..., 3] >= ALPHA_THRESH, 255, 0)  # hard alpha
    im = Image.fromarray(arr, "RGBA")
    # Median-cut flatten to a small palette (bands the painterly shading), preserving alpha.
    a = np.asarray(im)[..., 3]
    rgb = im.convert("RGB").quantize(colors=QUANTISE_COLOURS, method=Image.MEDIANCUT).convert("RGB")
    flat = np.dstack([np.asarray(rgb), a]).astype(np.uint8)
    flat[a < ALPHA_THRESH] = 0
    im = outline(Image.fromarray(flat, "RGBA"))
    return im


def save_previews(raws: list[Path]) -> None:
    """Contact sheet of each processed candidate at x6 on a dark tile bg, for owner pick."""
    tiles = []
    for p in raws:
        im = process(Image.open(p))
        im = im.resize((im.width * 6, im.height * 6), Image.NEAREST)
        tiles.append((p.stem, im))
    if not tiles:
        return
    pad, label_h = 10, 14
    w = sum(t[1].width for t in tiles) + pad * (len(tiles) + 1)
    h = max(t[1].height for t in tiles) + pad * 2 + label_h
    sheet = Image.new("RGBA", (w, h), (46, 46, 58, 255))
    x = pad
    for name, im in tiles:
        sheet.alpha_composite(im, (x, pad + label_h))
        x += im.width + pad
    out = ROOT / "scripts/.gen-icons/workbench_candidates.png"
    sheet.convert("RGB").save(out)
    print(f"  contact sheet -> {out.relative_to(ROOT)}")


def commit(raw: Path) -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    process(Image.open(raw)).save(OUT)
    print(f"  committed -> {OUT.relative_to(ROOT)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=3, help="stochastic candidates to generate")
    ap.add_argument("--reprocess", action="store_true",
                    help="re-bake previews from saved raws (no key/spend)")
    ap.add_argument("--commit", metavar="RAW",
                    help="process one saved raw (e.g. workbench_1) into the committed sprite")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.commit:
        commit(RAW / f"{args.commit}.png")
        return

    if args.reprocess:
        raws = sorted(RAW.glob("workbench_*.png"))
        if not raws:
            sys.exit("No saved raws (scripts/.gen-icons/raw/workbench_*.png) to reprocess.")
        save_previews(raws)
        return

    ref = reference_png()
    if args.dry_run:
        print(PROP, FLAT, MAGENTA, sep="\n\n")
        return
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("Missing GEMINI_API_KEY in env.")
    prompt = f"{PROP} {FLAT} {MAGENTA}"
    written = []
    for s in range(args.samples):
        data = gemini(prompt, [ref], key)
        out = RAW / f"workbench_{s}.png"
        out.write_bytes(data)
        written.append(out)
        print(f"  raw -> {out.relative_to(ROOT)} ({len(data)} bytes)")
    save_previews(written)


if __name__ == "__main__":
    main()
