#!/usr/bin/env python3
"""Ask Gemini ("Nano Banana", gemini-2.5-flash-image) to draw a NEW character — the
"Baby Gunner": a chunky cartoon baby mercenary who sucks a dummy (pacifier) and hauls an
oversized minigun — in the Pixel Crawler pack's chunky flat style.

Brand-new characters have no in-pack reference, so identity would normally drift
(docs/AI-SPRITE-PIPELINE.md). We anchor the *style + proportions* on the player Body_A idle
frame (passed image-to-image) while the prompt fully describes the new subject — the reference
carries "chunky pack look, this size, feet baseline", the text carries "who it is".

Raw ~1024px generations go to the gitignored scratch dir; downscale/keying is process_babygun.py.
Needs GEMINI_API_KEY in env (lives in guppi/house-helper/.env). --dry-run writes only the
reference image (no key, no spend).
"""
import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

ENDPOINT = ("https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-2.5-flash-image:generateContent")
ROOT = Path(__file__).resolve().parents[2]
ENT = ROOT / "public/assets/tilesets/pixel-crawler/Entities"
IDLE_DOWN = ENT / "Characters/Body_A/Animations/Idle_Base/Idle_Down-Sheet.png"
IDLE_SIDE = ENT / "Characters/Body_A/Animations/Idle_Base/Idle_Side-Sheet.png"
RAW = ROOT / "scripts/.gen-icons/raw"

CHAR = ("a chunky cartoon BABY mercenary. HUGE round bald baby head with fat cheeks and big "
        "eyes, a white ROUND BABY DUMMY / PACIFIER plugged in his mouth (round plastic shield "
        "with a teat), wearing a grubby pale-blue baby onesie / romper with a bulging nappy, "
        "tiny stubby arms and short stubby legs. He grimly hauls a MASSIVE oversized black "
        "metal MINIGUN — a six-barrel rotary gatling gun with a round ammo drum — far too big "
        "for his little body, gripped in both stubby hands at hip height, barrels pointing "
        "forward. Dark, grotty-but-cartoonish survival-horror pixel art, chunky bold "
        "silhouette, strong near-black outline, flat muted shading, no gradients.")
FLAT = ("Match the reference's simple flat CHUNKY low-detail pixel-art look and SIZE: flat "
        "blocky colours, minimal shading, big readable shapes, same small character height as "
        "the reference — NOT high-detail, NOT painterly, no anti-aliasing, no gradients.")
# Magenta key — far from the baby's pale-blue/skin/black-gun colours, so keyout is clean.
BG_MAGENTA = ("CRITICAL BACKGROUND: one flat uniform MAGENTA background hex #FF00FF, no "
              "gradient, shadow or ground. No text, no numbers, no border, no frame.")
STRIP = ("Lay them out as ONE HORIZONTAL ROW on one line — a sprite-sheet / film strip — "
         "left to right, all the SAME small size, feet on ONE shared ground baseline, with "
         "clear equal gaps between frames and nothing overlapping.")
DUMMY_EVERY = ("The white DUMMY/PACIFIER is plugged in his mouth and the MINIGUN is gripped in "
               "both hands — BOTH VISIBLE in EVERY frame, including the first and the last.")

# Front-facing (down) idle → fire cycle.
FRAMES_DOWN = ("(1) idle stand facing the viewer, minigun held level at the hip; (2) bracing, "
               "barrels beginning to spin, leaning slightly back into the weapon; (3) FIRING — "
               "muzzle flash at the barrels, body shoved back by recoil, cheeks puffed round "
               "the dummy; (4) settle back to the idle stand")
# Side profile (facing right) idle → fire cycle.
FRAMES_SIDE = ("(1) idle stand in profile facing right, minigun held level at the hip; "
               "(2) bracing, back foot planted, barrels spinning up; (3) FIRING to the right — "
               "muzzle flash, recoil shoving him back left; (4) settle back to the idle stand")


def reference_png(sheet: Path) -> bytes:
    """Player idle f0, upscaled x8 on magenta — a style + proportion + size anchor."""
    im = Image.open(sheet).convert("RGBA").crop((0, 0, 64, 64)).resize((512, 512), Image.NEAREST)
    canvas = Image.new("RGBA", (512, 512), (255, 0, 255, 255))
    canvas.alpha_composite(im)
    out = RAW / f"_babygun_ref_{sheet.parent.name}_{sheet.stem}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out)
    return out.read_bytes()


# One big hero portrait (single frame) for presentation, plus the two game strips.
VARIANTS = {
    "hero": (lambda: [reference_png(IDLE_DOWN)],
        f"The attached image shows the ART STYLE, camera angle and character SIZE to match. "
        f"Draw a SINGLE character, centred, facing the viewer: {CHAR} {DUMMY_EVERY} "
        f"Draw just ONE character (no strip, no frames). {FLAT} {BG_MAGENTA}"),
    "down": (lambda: [reference_png(IDLE_DOWN)],
        f"The attached image shows the ART STYLE, camera angle and character SIZE to match. "
        f"Draw a NEW character across 4 frames of a minigun fire cycle, facing the viewer "
        f"(front view): {FRAMES_DOWN}. The character is: {CHAR} Same character, dummy, onesie, "
        f"minigun, colours and proportions in every frame. {DUMMY_EVERY} {STRIP} {FLAT} {BG_MAGENTA}"),
    "side": (lambda: [reference_png(IDLE_SIDE)],
        f"The attached image shows the ART STYLE, camera angle and character SIZE to match. "
        f"Draw a NEW character across 4 frames of a minigun fire cycle, side profile facing "
        f"right: {FRAMES_SIDE}. The character is: {CHAR} Same character, dummy, onesie, minigun, "
        f"colours and proportions in every frame. {DUMMY_EVERY} {STRIP} {FLAT} {BG_MAGENTA}"),
}


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
        sys.exit(f"Gemini HTTP {e.code}: {e.read().decode('utf-8','replace')[:800]}")
    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    sys.exit(f"No image in response: {json.dumps(payload)[:600]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=VARIANTS, action="append")
    ap.add_argument("--n", type=int, default=1, help="candidates per variant")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    names = args.only or list(VARIANTS)
    key = None if args.dry_run else os.environ.get("GEMINI_API_KEY")
    if not args.dry_run and not key:
        sys.exit("Missing GEMINI_API_KEY in env.")
    for nm in names:
        make_images, prompt = VARIANTS[nm]
        images = make_images()
        print(f"=== {nm} ===  ({len(images)} input image(s))")
        if args.dry_run:
            print(prompt)
            continue
        for i in range(args.n):
            data = gemini(prompt, images, key)
            out = RAW / (f"babygun_{nm}.png" if args.n == 1 else f"babygun_{nm}_{i+1}.png")
            out.write_bytes(data)
            print(f"  raw -> {out.relative_to(ROOT)} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
