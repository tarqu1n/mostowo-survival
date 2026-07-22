#!/usr/bin/env python3
"""Ask Gemini ("Nano Banana", gemini-2.5-flash-image) to draw a Rogue ATTACK from the
Rogue's own idle sprite — image-to-image so the generated character actually matches.

Mirrors the item-icon pipeline's endpoint/auth (docs/gemini-pipeline.md) but sends the
Rogue idle sprite as an inline image alongside the text, so the model reskins the SAME
character into attack poses instead of inventing a new one. Raw ~1024px generations go
to the gitignored scratch dir; downscale/keying is a separate step (process_gemini.py).

Two upgrades on top of the first pass (see docs/AI-SPRITE-PIPELINE.md):
  * EDGES  — generate on a green (#00FF00) background with a 2px white outline buffer so
    the silhouette keys out cleanly (cleaner than magenta + defringe).
  * POSE   — optionally pass a second image, a POSE-GUIDE strip built from the Body_A
    slice motion, and ask the model to redraw the rogue in each pose. This is the
    lightweight Pose-Guider idea (Sprite Sheet Diffusion) — pose-conditioned frames read
    as a smoother, more coherent animation than independently-prompted poses.

Needs GEMINI_API_KEY in env (lives in guppi/house-helper/.env). --dry-run prints the
prompts and writes the reference/pose images only (no key, no spend).
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
IDLE = ENT / "Npc's/Rogue/Idle/Idle-Sheet.png"
SLICE = ENT / "Characters/Body_A/Animations/Slice_Base/Slice_Side-Sheet.png"
RAW = ROOT / "scripts/.gen-icons/raw"

CHAR = ("a small hooded rogue: baggy olive-green hooded cloak, face in deep shadow with "
        "two glowing pale-blue eyes and a wide purple grin, a bright orange sash belt, "
        "short stubby legs. Dark, grotty-but-cartoonish survival-horror pixel art, chunky "
        "bold silhouette, strong near-black outline, flat muted shading, no gradients.")
FLAT = ("Match the reference's simple flat CHUNKY low-detail pixel-art look: flat blocky "
        "colours, minimal shading, big readable shapes — NOT high-detail, NOT painterly, "
        "no anti-aliasing, no gradients.")
# Upgrade 1: green key + white outline buffer (roboticape) — keys out far cleaner than a
# magenta bg because edge AA blends into white, not into the character's colours.
BG_GREEN = ("CRITICAL BACKGROUND: one flat uniform PURE GREEN background hex #00FF00, no "
            "gradient, shadow or ground. CRITICAL EDGE: draw a clean 2px PURE WHITE outline "
            "wrapping the whole character so it separates cleanly from the green. No text, "
            "no numbers, no border, no frame.")
# The chroma key MUST be far from the character's own colours. The rogue is olive-GREEN,
# so a green key eats the cloak on keyout — magenta (its opposite) is the safe key here.
BG_MAGENTA = ("CRITICAL BACKGROUND: one flat uniform MAGENTA background hex #FF00FF, no "
              "gradient, shadow or ground. No text, no numbers, no border, no frame.")
STRIP = ("Lay them out as ONE HORIZONTAL ROW on one line — a sprite-sheet / film strip — "
         "left to right, all the SAME small size, feet on ONE shared ground baseline, with "
         "clear equal gaps between frames and nothing overlapping.")

FRAMES5 = ("(1) ready stance, dagger held low; (2) wind-up, leaning back with the dagger "
           "cocked back over the shoulder; (3) dagger raised high overhead; (4) slashing "
           "the dagger down diagonally in front, body lunging forward; (5) low "
           "follow-through after the strike")

# Body_A slice frames used as the pose guide (0-based), a smooth overhead-slash arc.
POSE_FRAMES = [0, 2, 3, 4, 5, 7]


def reference_png() -> bytes:
    """Rogue idle f0, upscaled x8 on magenta — a clear identity reference for the model."""
    im = Image.open(IDLE).convert("RGBA").crop((0, 0, 32, 32)).resize((256, 256), Image.NEAREST)
    canvas = Image.new("RGBA", (256, 256), (255, 0, 255, 255))
    canvas.alpha_composite(im)
    out = RAW / "_rogue_reference.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out)
    return out.read_bytes()


def pose_guide_png() -> bytes:
    """A left-to-right strip of Body_A slice poses as flat BLACK, BODY-ONLY silhouettes.

    Silhouettes (not the textured actor) so NO appearance leaks — the textured actor made
    the model copy its axe and bald head. And BODY-ONLY: the Body_A axe (grey/white blade
    + the white swing-arc) is dropped from the silhouette so its raised-WEAPON shape can't
    transfer either; the model then draws the rogue's own small dagger. Mirrors the paper's
    Pose-Guider = pose only; identity + weapon come from the reference/prompt."""
    sheet = Image.open(SLICE).convert("RGBA")
    px = sheet.load()
    fw = sheet.height
    cell = 150
    n = len(POSE_FRAMES)
    canvas = Image.new("RGBA", (cell * n, cell), (150, 150, 150, 255))
    for i, fi in enumerate(POSE_FRAMES):
        sil = Image.new("RGBA", (fw, fw), (0, 0, 0, 0))
        sp = sil.load()
        for y in range(fw):
            for x in range(fw):
                r, g, b, a = px[fi * fw + x, y]
                blade = max(r, g, b) - min(r, g, b) <= 24 and min(r, g, b) >= 45
                if a > 40 and not blade:            # body only — drop the axe/arc
                    sp[x, y] = (20, 20, 20, 255)
        canvas.alpha_composite(sil.resize((cell, cell), Image.NEAREST), (i * cell, 0))
    out = RAW / "_pose_guide.png"
    canvas.convert("RGB").save(out)
    return out.read_bytes()


VARIANTS = {
    # Upgrade 1 only: the proven row5a prompt, now on a green+white-outline background.
    "green5": (lambda: [reference_png()],
        f"The attached image is the reference character: {CHAR} Redraw THIS EXACT same "
        f"character across 5 frames of an OVERHEAD DAGGER SLASH, side view facing right: "
        f"{FRAMES5}. Same character, hood, colours and proportions in every frame. "
        f"{STRIP} {FLAT} {BG_GREEN}"),
    # Upgrade 2: pose-conditioned. Image 1 = identity, image 2 = the pose-guide strip.
    "pose": (lambda: [reference_png(), pose_guide_png()],
        f"Image 1 is the CHARACTER to draw: {CHAR} Image 2 is a POSE REFERENCE — a "
        f"left-to-right row of {len(POSE_FRAMES)} poses of an actor performing an overhead "
        f"dagger slash. Redraw the CHARACTER from image 1 in EACH of those {len(POSE_FRAMES)} "
        f"poses, in the same left-to-right order, holding a small dagger, as ONE horizontal "
        f"row of {len(POSE_FRAMES)} equal evenly-spaced frames on a shared feet baseline. "
        f"Copy ONLY the body pose and limb positions from image 2 — keep image 1's hood, "
        f"colours, proportions and style. {FLAT} {BG_MAGENTA}"),
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
        data = gemini(prompt, images, key)
        out = RAW / f"rogue_attack_{nm}.png"
        out.write_bytes(data)
        print(f"  raw -> {out.relative_to(ROOT)} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
