#!/usr/bin/env python3
"""Generate wooden-JETTY world-prop sprites with Gemini ("Nano Banana Pro",
gemini-3-pro-image), image-to-image, and post-process each to a committed PNG in the
`mostowo-custom` pack. A placeable pier OBJECT (not a seamless tile) — the static-prop
playbook from the destroyed tents (docs/AI-SPRITE-PIPELINE.md § Static world-prop sprites),
applied to the real Mostowo jetty.

WHY OBJECTS-IN-ORIENTATIONS (not tiles): a 16px seamless tileset flattened the jetty's
character out; a top-down prop baked per orientation keeps the weathered look and drops into
the world like the tents/trees. The editor rotates tiles but an oblique prop doesn't rotate
cleanly, so — like the tents — each orientation is baked as its own frame.

TWO reference images per generation (the tents lesson: the reference carries what text can't):
  1. a PHOTO of the real jetty (gitignored scratch, personal — NEVER committed) → its
     weathered silver-grey rustic plank CHARACTER;
  2. an isolated pack ROOF chevron (Roofs.png) seen from the game's high top-down oblique
     angle → the CAMERA ANGLE + flat pixel-art STYLE (text alone can't hold top-down; the
     photo is eye-level and would otherwise pull the output to a side view).

Pipeline per jetty:  build refs → POST(refs + prompt) → raw ~1024px to scripts/.gen-icons/raw/
(gitignored) → key out flat magenta bg → crop to content → downscale to TARGET_W → quantise
(KEEPS the gen's own weathered greys — no palette snap) → crisp 1px outline → write the PNG.

Endpoint/auth/model are the locked ones (docs/gemini-pipeline.md). Needs GEMINI_API_KEY in env
(guppi/house-helper/.env over Tailscale — see docs/MOBILE-EDITOR-ACCESS.md). --dry-run composes
prompts + writes refs (no key/spend); --reprocess re-bakes saved raws (no key/spend); --only ID.
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

ENDPOINT_TMPL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-3-pro-image"  # Nano Banana Pro — best adherence (see gen-tents.py)

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "public/assets/tilesets/mostowo-custom/Environment/Props/Static"
RAW = ROOT / "scripts/.gen-icons/raw"
PHOTO_REF = RAW / "_jetty_photo_ref.png"   # personal photo — gitignored, never committed
# Pack roof chevron from the game's exact high top-down angle — the perspective + pixel-style
# anchor (shared with gen-tents.py; bbox from Roofs.png alpha components).
ROOFS = ROOT / "public/assets/tilesets/pixel-crawler/Environment/Structures/Buildings/Roofs.png"
ROOF_BBOX = (272, 87, 368, 187)

TARGET_W = 60        # live sprite width (a short pier ≈ 3.75 tiles); height follows aspect
SIDE_W = 64          # broadside pier ≈ 4 tiles wide
VERT_W = 26          # vertical pier is tall + NARROW — bake by a small width so height stays sane
QUANTISE_COLOURS = 10
OUTLINE = (22, 20, 26, 255)  # pack dark near-black rim, faintly cool (weathered grey wood)

STYLE = (
    "Dark, grotty-but-cartoonish survival-horror GAME PIXEL ART, matching reference image 2's "
    "flat CHUNKY low-detail look: chunky bold readable shapes, strong near-black outline, flat "
    "muted slightly-grimy colours, simple flat shading — NO gradients, NO anti-aliasing, NO "
    "photorealism, NO fine noise. One single object, centred. No water, no ground, no plants, "
    "no cast shadow, no text, no letters, no numbers, no border, no frame."
)
BG = (
    "CRITICAL BACKGROUND: one flat uniform PURE MAGENTA background hex #FF00FF, no gradient, "
    "texture or shadow, so it can be keyed to full transparency."
)
TOPDOWN = (
    "CRITICAL CAMERA: match reference image 2's HIGH TOP-DOWN oblique angle — you look DOWN onto "
    "the jetty from above and slightly in front, seeing the plank deck surface from above. A "
    "top-down RPG world prop — NOT an eye-level photo, NOT a flat side elevation."
)
SUBJECT = (
    "a short rustic wooden JETTY / fishing pier: a narrow plank walkway platform built from "
    "WEATHERED SILVER-GREY timber boards with small dark gaps between the planks, the boards "
    "running along its length, a few stubby wooden support posts, low and flat, NO railings — "
    "old, worn and weathered like reference image 1"
)

ORIENT = {
    "diagonal": (
        "Orientation: the pier sits at a 3/4 DIAGONAL — it runs diagonally across the frame (about "
        "45 degrees), so you see the plank deck from above and one weathered side edge with its "
        "support posts; one end is the near land end, the far end juts out over where the water "
        "would be."
    ),
    "side": (
        "Orientation: BROADSIDE, seen from the game's HIGH TOP-DOWN angle — the pier runs as a long "
        "HORIZONTAL plank deck across the frame; you look DOWN onto the deck boards (which run "
        "left-to-right along its length) and see the low front edge with a couple of support posts "
        "below it. Clearly WIDER than tall (about 3:1), a long low walkway. Do NOT rotate it to a 3/4 "
        "corner and do NOT flatten it to an eye-level side view."
    ),
    "end": (
        "Orientation: END-ON — the pier runs straight AWAY from the camera into the distance, so the "
        "plank deck recedes as a narrow strip narrowing slightly toward the far end; the near end "
        "(closest to camera) shows the front edge and two support posts, the boards running away from "
        "you toward the far end."
    ),
    "vertical": (
        "Orientation: the pier runs straight UP-AND-DOWN the frame — a long narrow plank deck stood "
        "VERTICALLY, seen from the game's HIGH TOP-DOWN angle (you look DOWN onto the deck boards from "
        "above). The deck boards run left-to-right ACROSS the width; a row of stubby support posts runs "
        "down one long side. Clearly TALLER than wide (about 1:3), a long low straight walkway. CRITICAL: "
        "do NOT let it recede to a far vanishing point (it is NOT an end-on view), and do NOT rotate it "
        "to a diagonal — it is a flat straight up-and-down walkway, the same deck as the broadside but "
        "turned 90 degrees."
    ),
}

# id -> (orientation, flavour clause). The SHIPPED set, picked from the first candidate batch.
# `end` orientation is intentionally NOT shipped: like the tents' hard angle, an end-on pier came
# out malformed (folded into a roof-like peak) — reuse a rotated `diagonal` in-map for piers heading
# away from camera. Also dropped from the batch: a buoy variant (the red float barely read; make it a
# separate prop if wanted) and a 2nd broadside (drifted to a square platform). Regenerate the shipped
# set with `python3 scripts/gen-jetty.py`; the ORIENT dict still carries `end` for future attempts.
VARIANTS = {
    "jetty_diagonal_1": ("diagonal", ""),  # short clean pier
    "jetty_diagonal_2": ("diagonal", "a couple of planks slightly warped/uneven, one board darker and rotten"),  # long hero
    "jetty_side_1": ("side", ""),          # wide broadside walkway (horizontal)
    "jetty_vertical_1": ("vertical", ""),  # up-down walkway
    "jetty_vertical_2": ("vertical", "a couple of planks slightly warped, one board darker and rotten"),
}


def roof_ref_png() -> bytes:
    """Pack roof chevron, cropped + upscaled x3 on magenta — the top-down angle/style anchor."""
    im = Image.open(ROOFS).convert("RGBA").crop(ROOF_BBOX)
    up = im.resize((im.width * 3, im.height * 3), Image.NEAREST)
    canvas = Image.new("RGBA", up.size, (255, 0, 255, 255))
    canvas.alpha_composite(up)
    out = RAW / "_roof_ref.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out)
    return out.read_bytes()


def photo_ref_png() -> bytes:
    """The upright jetty photo, downscaled to a sane reference size. Personal — kept in the
    gitignored scratch dir, fed to the model as image 1, never committed."""
    if not PHOTO_REF.exists():
        sys.exit(f"missing photo reference at {PHOTO_REF} — drop the upright jetty photo there.")
    im = Image.open(PHOTO_REF).convert("RGB")
    im.thumbnail((768, 768))
    return _png_bytes(im)


def _png_bytes(im: Image.Image) -> bytes:
    from io import BytesIO
    buf = BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def compose(orient: str, flavour: str = "") -> str:
    extra = f" {flavour}." if flavour else ""
    return (
        "Reference image 1 is a PHOTO of a real weathered wooden jetty — recreate ITS character "
        "(silver-grey rustic worn planks, simple low build). Reference image 2 is a pack roof drawn "
        "from the game's high top-down angle in flat pixel art — match image 2's CAMERA ANGLE and "
        f"pixel-art STYLE. Draw {SUBJECT}.{extra} {ORIENT[orient]} {TOPDOWN} {STYLE} {BG}"
    )


def images_for() -> list[bytes]:
    return [photo_ref_png(), roof_ref_png()]


def gemini_image(prompt: str, images: list[bytes], api_key: str, model: str) -> bytes:
    parts: list[dict] = [{"text": prompt}]
    for img in images:
        parts.append({"inline_data": {"mime_type": "image/png",
                                      "data": base64.b64encode(img).decode()}})
    body = json.dumps({"contents": [{"parts": parts}]}).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT_TMPL.format(model=model), data=body, method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        sys.exit(f"Gemini API HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:1000]}")
    except urllib.error.URLError as e:
        sys.exit(f"Could not reach the Gemini endpoint ({e.reason}).")
    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    sys.exit(f"No image in Gemini response: {json.dumps(payload)[:800]}")


def key_out(img: Image.Image, tol: int = 100) -> Image.Image:
    img = img.convert("RGBA")
    arr = np.asarray(img).astype(np.int16)
    h, w = arr.shape[:2]
    corners = np.array([arr[0, 0, :3], arr[0, w - 1, :3], arr[h - 1, 0, :3], arr[h - 1, w - 1, :3]])
    bg = np.median(corners, axis=0)
    dist = np.sqrt(((arr[:, :, :3] - bg) ** 2).sum(axis=2))
    out = arr.copy()
    out[dist < tol, 3] = 0
    r, g, b = out[:, :, 0], out[:, :, 1], out[:, :, 2]
    out[(r > 180) & (b > 180) & (g < 90), 3] = 0  # nuke residual magenta the corner-key missed
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def crop_content(img: Image.Image) -> Image.Image:
    arr = np.asarray(img)
    ys, xs = np.where(arr[:, :, 3] > 12)
    if len(xs) == 0:
        return img
    return img.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def quantise(img: Image.Image, colours: int) -> Image.Image:
    rgb = img.convert("RGB").quantize(colors=colours, method=Image.MEDIANCUT).convert("RGB")
    r, g, b = rgb.split()
    a = img.split()[3].point(lambda v: 255 if v > 110 else 0)
    out = np.asarray(Image.merge("RGBA", (r, g, b, a))).copy()
    rr, gg, bb, aa = (out[:, :, i].astype(np.int16) for i in range(4))
    # Magenta/purple contamination (bg bleeding through the plank gaps): the ONLY pixels here
    # where BOTH red and blue exceed green — natural weathered wood is warm/neutral (green is
    # never the smallest channel by a margin). Recolour them to the sprite's dominant wood tone
    # rather than punching holes, so the deck stays solid.
    purple = (rr > gg + 12) & (bb > gg + 12) & (aa > 0)
    if purple.any():
        opaque = out[(aa > 0) & ~purple][:, :3]
        if len(opaque):
            cols, counts = np.unique(opaque, axis=0, return_counts=True)
            out[purple, :3] = cols[counts.argmax()]
    return Image.fromarray(out, "RGBA")


def outline(img: Image.Image) -> Image.Image:
    a = np.asarray(img.convert("RGBA")).copy()
    op = a[:, :, 3] > 110
    edge = np.zeros_like(op)
    edge[:-1, :] |= op[:-1, :] & ~op[1:, :]
    edge[1:, :] |= op[1:, :] & ~op[:-1, :]
    edge[:, :-1] |= op[:, :-1] & ~op[:, 1:]
    edge[:, 1:] |= op[:, 1:] & ~op[:, :-1]
    edge[0, :] |= op[0, :]; edge[-1, :] |= op[-1, :]; edge[:, 0] |= op[:, 0]; edge[:, -1] |= op[:, -1]
    a[edge] = OUTLINE
    return Image.fromarray(a, "RGBA")


def to_sprite(raw_png: Path, width: int) -> Image.Image:
    img = crop_content(key_out(Image.open(raw_png)))
    h = max(1, round(img.height * (width / img.width)))
    img = img.resize((width, h), Image.LANCZOS)
    return outline(quantise(img, QUANTISE_COLOURS))


def target_width(orient: str) -> int:
    return {"side": SIDE_W, "vertical": VERT_W}.get(orient, TARGET_W)


def contact_sheet(ids: list[str]) -> None:
    """Tile the baked sprites on a checkerboard for eyeballing (gitignored scratch)."""
    imgs = [(i, Image.open(PACK / f"{i}.png").convert("RGBA")) for i in ids
            if (PACK / f"{i}.png").exists()]
    if not imgs:
        return
    k = 3
    cell = max(max(im.width, im.height) for _, im in imgs) * k + 24
    cols = 3
    rows = (len(imgs) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (40, 42, 48, 255))
    for idx, (name, im) in enumerate(imgs):
        up = im.resize((im.width * k, im.height * k), Image.NEAREST)
        cx = (idx % cols) * cell + (cell - up.width) // 2
        cy = (idx // cols) * cell + (cell - up.height) // 2
        sheet.alpha_composite(up, (cx, cy))
    out = ROOT / "scripts/.gen-icons/jetty_candidates.png"
    sheet.save(out)
    print(f"  contact sheet -> {out.relative_to(ROOT)} ({sheet.width}x{sheet.height})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", metavar="ID", help="generate just this one jetty id")
    ap.add_argument("--dry-run", action="store_true", help="compose prompts + write refs (no key)")
    ap.add_argument("--reprocess", action="store_true", help="re-bake saved raws (no key, no spend)")
    ap.add_argument("--model", default=DEFAULT_MODEL, help=f"Gemini model (default {DEFAULT_MODEL})")
    args = ap.parse_args()

    ids = [args.only] if args.only else list(VARIANTS)
    unknown = [i for i in ids if i not in VARIANTS]
    if unknown:
        sys.exit(f"unknown id(s): {', '.join(unknown)}; known: {', '.join(VARIANTS)}")

    if args.dry_run:
        roof_ref_png()
        for tid in ids:
            orient, flavour = VARIANTS[tid]
            print(f"\n=== {tid} ({orient}) ===\n{compose(orient, flavour)}")
        print(f"\n[dry-run] {len(ids)} prompt(s); refs written; no API call.")
        return

    if args.reprocess:
        for tid in ids:
            raw_png = RAW / f"{tid}.png"
            if not raw_png.exists():
                print(f"  skip {tid}: no saved raw"); continue
            live = to_sprite(raw_png, target_width(VARIANTS[tid][0]))
            PACK.mkdir(parents=True, exist_ok=True)
            live.save(PACK / f"{tid}.png")
            print(f"  reprocessed {tid} -> {live.width}x{live.height}")
        contact_sheet(ids)
        return

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("Missing GEMINI_API_KEY (guppi/house-helper/.env, via Tailscale). --dry-run to test.")
    PACK.mkdir(parents=True, exist_ok=True)
    for tid in ids:
        orient, flavour = VARIANTS[tid]
        print(f"\n=== {tid} ({orient}) ===")
        raw = gemini_image(compose(orient, flavour), images_for(), key, args.model)
        raw_png = RAW / f"{tid}.png"
        raw_png.write_bytes(raw)
        print(f"  raw -> {raw_png.relative_to(ROOT)}")
        live = to_sprite(raw_png, target_width(orient))
        live.save(PACK / f"{tid}.png")
        print(f"  -> {tid}.png ({live.width}x{live.height})")
    contact_sheet(ids)


if __name__ == "__main__":
    main()
