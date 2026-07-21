#!/usr/bin/env python3
"""Ask Gemini ("Nano Banana", gemini-2.5-flash-image) to draw a Rogue ATTACK from the
Rogue's own idle sprite — image-to-image so the generated character actually matches.

Mirrors the item-icon pipeline's endpoint/auth (docs/gemini-pipeline.md) but sends the
Rogue idle sprite as an inline image alongside the text, so the model reskins the SAME
character into attack poses instead of inventing a new one. Raw ~1024px generations go
to the gitignored scratch dir; downscale/keying is a separate step (process step in
rogue_attack.py / gen-icons).

Needs GEMINI_API_KEY in env (lives in guppi/house-helper/.env). --dry-run prints the
prompts and writes the reference image only (no key, no spend).
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
IDLE = ROOT / "public/assets/tilesets/pixel-crawler/Entities/Npc's/Rogue/Idle/Idle-Sheet.png"
RAW = ROOT / "scripts/.gen-icons/raw"

CHAR = ("a small hooded rogue: baggy olive-green hooded cloak, face in deep shadow with "
        "two glowing pale-blue eyes and a wide purple grin, a bright orange sash belt, "
        "short stubby legs. Dark, grotty-but-cartoonish survival-horror pixel art, chunky "
        "bold silhouette, strong near-black outline, flat muted shading, no gradients.")
BG = ("Solid flat uniform magenta background, hex #FF00FF, no shadow/gradient/ground, so "
      "it keys out to transparency. No text, no numbers, no border, no frame.")

FRAMES5 = ("(1) ready stance, dagger held low; (2) wind-up, leaning back with the dagger "
           "cocked back over the shoulder; (3) dagger raised high overhead; (4) slashing "
           "the dagger down diagonally in front, body lunging forward; (5) low "
           "follow-through after the strike")
STRIP = ("Lay them out as a SINGLE HORIZONTAL ROW on ONE line — a game sprite-sheet / film "
         "strip — left to right, all exactly the SAME small size, feet on ONE shared ground "
         "baseline, with clear equal gaps between frames and nothing overlapping.")
FLAT = ("Match the reference's simple flat CHUNKY low-detail pixel-art look: flat blocky "
        "colours, one bold near-black outline, minimal shading, big readable shapes — NOT "
        "high-detail, NOT painterly, no anti-aliasing, no gradients.")

VARIANTS = {
    # tuned single-row strips (main target) — a few variants to pick from
    "row5a": (f"The attached image is the reference character: {CHAR} Redraw THIS EXACT same "
              f"character across 5 frames of an OVERHEAD DAGGER SLASH, side view facing right: "
              f"{FRAMES5}. Same character, hood, colours and proportions in every frame. "
              f"{STRIP} {FLAT} {BG}"),
    "row5b": (f"The attached image is the reference character: {CHAR} {STRIP} Exactly 5 equal "
              f"frames showing an overhead dagger-slash attack cycle, side view facing right: "
              f"{FRAMES5}. Identical character and size in each frame. {FLAT} {BG}"),
    "row6": (f"The attached image is the reference character: {CHAR} Redraw THIS EXACT same "
             f"character across 6 frames of an overhead dagger-slash attack, side view facing "
             f"right: idle-ready, wind-up leaning back, dagger raised high, slash down, impact "
             f"lunge, recover. Same character/size every frame. {STRIP} {FLAT} {BG}"),
    "grid5": (f"The attached image is the reference character: {CHAR} A clean sprite-sheet of 5 "
              f"equal frames of an overhead dagger slash (side view, facing right): {FRAMES5}. "
              f"Uniform frame size, same character throughout. {FLAT} {BG}"),
}


def reference_png() -> bytes:
    """Rogue idle f0, upscaled x8 on magenta — a clear reference for the model."""
    im = Image.open(IDLE).convert("RGBA").crop((0, 0, 32, 32))
    im = im.resize((256, 256), Image.NEAREST)
    canvas = Image.new("RGBA", (256, 256), (255, 0, 255, 255))
    canvas.alpha_composite(im)
    out = RAW / "_rogue_reference.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out)
    return out.read_bytes()


def gemini(prompt: str, ref: bytes, key: str) -> bytes:
    body = json.dumps({"contents": [{"parts": [
        {"text": prompt},
        {"inline_data": {"mime_type": "image/png",
                         "data": base64.b64encode(ref).decode()}},
    ]}]}).encode()
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
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    names = args.only or list(VARIANTS)
    ref = reference_png()
    print(f"reference -> {(RAW/'_rogue_reference.png').relative_to(ROOT)}")
    if args.dry_run:
        for nm in names:
            print(f"\n=== {nm} ===\n{VARIANTS[nm]}")
        return
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("Missing GEMINI_API_KEY in env.")
    for nm in names:
        print(f"=== {nm} ===")
        data = gemini(VARIANTS[nm], ref, key)
        out = RAW / f"rogue_attack_{nm}.png"
        out.write_bytes(data)
        print(f"  raw -> {out.relative_to(ROOT)} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
