#!/usr/bin/env python3
"""Ask Gemini ("Nano Banana", gemini-2.5-flash-image) to draw the PLAYER (Body_A) firing
a BOW, from the player's OWN idle sprite — image-to-image so the generated character
actually matches the pack body already on screen.

Second use of the AI sprite pipeline (docs/AI-SPRITE-PIPELINE.md; first use was the
Rogue attack strip). Two differences from the rogue run, both because this is the PLAYER:
  * 3-WAY — the player is directional (down/side/up) for every other action, and the bow
    currently reuses the 3-way Pierce strip as a stand-in, so we generate all three
    facings (one strip each). `--dir` selects; default is all three.
  * TAN not olive — Body_A is a warm skin/brown character, so the safe chroma key is
    MAGENTA #FF00FF (far from skin); green would be fine too but magenta is proven.

Each strip is a single horizontal row of 5 draw->release frames. Identity comes from the
attached idle reference (per direction); the text carries the bow poses. No pose-guide
image: the pack ships no bow motion to silhouette (Pierce is a thrust, which would bias
the arc), so this is prompt-only like the rogue `green5`/`row5a` variant, on magenta.

Raw ~1024px generations go to the gitignored scratch dir; downscale/keying/cel-shade is a
separate step (process_bow.py). Needs GEMINI_API_KEY in env (lives in
guppi/house-helper/.env, LAN-only). --dry-run prints prompts + writes the reference
images only (no key, no spend).
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
IDLE = {
    "side": ENT / "Characters/Body_A/Animations/Idle_Base/Idle_Side-Sheet.png",
    "down": ENT / "Characters/Body_A/Animations/Idle_Base/Idle_Down-Sheet.png",
    "up": ENT / "Characters/Body_A/Animations/Idle_Base/Idle_Up-Sheet.png",
}
RAW = ROOT / "scripts/.gen-icons/raw"

# Appearance anchor. The prompt also attaches the real idle sprite, which is what actually
# pins identity — this text just steers wording toward flat pixel art and names the bow.
# NB the Body_A base body is a BARE chibi humanoid (no clothing) — describe it as-is so the
# gen matches the on-screen player; wording a tunic/boots on would drift off-model.
CHAR = ("a small bare-skinned chibi humanoid: a big round head, tan skin, faint short brown "
        "hair, small green eyes, stubby arms and legs, no clothing. Dark, grotty-but-"
        "cartoonish survival-horror pixel art, chunky bold silhouette, strong near-black "
        "outline, flat muted shading, no gradients. They hold a simple wooden short bow and "
        "a thin arrow.")
FLAT = ("Match the reference's simple flat CHUNKY low-detail pixel-art look: flat blocky "
        "colours, minimal shading, big readable shapes — NOT high-detail, NOT painterly, "
        "no anti-aliasing, no gradients.")
# The chroma key MUST be far from the character's own colours. Body_A is tan/brown, so
# magenta (its opposite) keys out cleanly without eating skin (see AI-SPRITE-PIPELINE.md).
BG_MAGENTA = ("CRITICAL BACKGROUND: one flat uniform MAGENTA background hex #FF00FF, no "
              "gradient, shadow or ground. No text, no numbers, no border, no frame.")
STRIP = ("Lay them out as ONE HORIZONTAL ROW on one line — a sprite-sheet / film strip — "
         "left to right, all the SAME small size, feet on ONE shared ground baseline, with "
         "clear equal gaps between frames and nothing overlapping.")

# 5-frame draw->release arc, phrased per facing. Same beats each time (raise -> draw ->
# full draw -> loose -> follow-through) so the three strips read as one action from three
# angles; only the camera-relative wording changes.
FRAMES = {
    "side": ("side view facing RIGHT, the bow held out front in the left hand throughout: "
             "(1) standing at ready, bow raised in the left hand out front, arrow just "
             "nocked, string slack; (2) starting the draw — right hand pulling the string "
             "back, elbow rising, bow still held out front; (3) FULL DRAW — bow arm straight "
             "out front, string pulled all the way back to the cheek, body taut; (4) LOOSE — "
             "bow still out front in the left hand, string snapped forward, arrow leaving the "
             "bow; (5) follow-through, bow still held out front in the left hand, bow arm "
             "settling, string slack again"),
    "down": ("front view, the character stays SQUARE TO THE VIEWER (camera) the whole time — "
             "do NOT turn sideways, do NOT aim left or right, keep the body facing straight "
             "at the camera in every frame — with the bow held HORIZONTALLY across the body "
             "and the arrow pointing DOWN toward the viewer: (1) standing square-on, bow held "
             "low across the waist, arrow just nocked; (2) raising the bow to chest height, "
             "starting to draw, both elbows lifting out level and symmetric; (3) FULL DRAW, "
             "bow pushed toward the viewer at chest height, string drawn back, elbows wide and "
             "level; (4) LOOSE, string forward, arrow leaving toward the viewer; (5) follow-"
             "through, bow lowering, still square to the camera"),
    "up": ("back view facing AWAY from the viewer, aiming UPWARD/away: (1) standing seen from "
           "behind, bow raised, arrow just nocked; (2) starting the draw, drawing elbow "
           "lifting out to the side; (3) FULL DRAW, bow pushed up-and-away, string drawn "
           "back, shoulder blades tight; (4) LOOSE, string forward, arrow leaving away from "
           "the viewer; (5) follow-through, arms settling"),
}


def reference_png(direction: str) -> bytes:
    """Player idle frame 0 for this facing, upscaled x8 on magenta — the identity anchor
    the model re-poses into the bow frames (image-to-image keeps it the SAME character)."""
    im = (Image.open(IDLE[direction]).convert("RGBA").crop((0, 0, 64, 64))
          .resize((512, 512), Image.NEAREST))
    canvas = Image.new("RGBA", (512, 512), (255, 0, 255, 255))
    canvas.alpha_composite(im)
    out = RAW / f"_bow_reference_{direction}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out)
    return out.read_bytes()


# The model likes to drop the prop in the ready/recover frames. Force it to keep the bow in
# every frame (this fixed the side strip's missing-bow frames 4/5). Restated because the
# model doesn't reliably carry a constraint stated only once.
BOW_EVERY = ("CRITICAL: the character GRIPS the wooden bow in the bow hand and it is clearly "
             "VISIBLE in EVERY single frame — including the first (ready) and last (follow-"
             "through) frame. Never drop, stow, lower out of view, or omit the bow in any "
             "frame. Every frame must show the full bow.")


def prompt_for(direction: str) -> str:
    return (
        f"The attached image is the reference character: {CHAR} Redraw THIS EXACT same "
        f"character across 5 frames of firing a bow, {FRAMES[direction]}. Same character, "
        f"hair, clothes, colours and proportions in every frame. {BOW_EVERY} {STRIP} {FLAT} "
        f"{BG_MAGENTA}"
    )


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
    ap.add_argument("--dir", choices=list(IDLE), action="append",
                    help="facing(s) to generate (default: all three)")
    ap.add_argument("--samples", type=int, default=1,
                    help="stochastic samples per facing (keep the cleanest)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    dirs = args.dir or list(IDLE)
    key = None if args.dry_run else os.environ.get("GEMINI_API_KEY")
    if not args.dry_run and not key:
        sys.exit("Missing GEMINI_API_KEY in env.")
    for direction in dirs:
        ref = reference_png(direction)
        prompt = prompt_for(direction)
        print(f"=== {direction} ===  (1 reference image)")
        if args.dry_run:
            print(prompt)
            continue
        for s in range(args.samples):
            data = gemini(prompt, [ref], key)
            suffix = "" if args.samples == 1 else f"_{s}"
            out = RAW / f"bow_{direction}{suffix}.png"
            out.write_bytes(data)
            print(f"  raw -> {out.relative_to(ROOT)} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
