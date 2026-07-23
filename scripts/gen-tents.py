#!/usr/bin/env python3
"""Generate the destroyed-tent world sprites with Gemini ("Nano Banana",
gemini-2.5-flash-image), image-to-image, and post-process each to a committed PNG in the
`mostowo-custom` pack — the real art replacing the hand-baked placeholders (scripts/tent-art.mjs).

The game is TOP-DOWN, so the tents are drawn from the pack's high top-down oblique angle in
three orientations, >=3 each: diagonal (3/4), front (end-on, entrance to camera), side
(broadside, ridge horizontal). Realistic weathered colours only (cream, light blue, green, grey).

Why image-to-image (docs/AI-SPRITE-PIPELINE.md — the reference is what holds the output
on-model): an isolated pack ROOF chevron (Roofs.png) anchors the top-down camera + flat
pixel-art style for diagonal/front; 'side' anchors on a real pack BROADSIDE roof (the
horizontal-ridge back-roof of fantasy-tileset House_Hay_2.png) because the diagonal chevron +
the model's diagonal tent prior otherwise snap every 'side' prompt back to 3/4.

Pipeline per tent:  build reference(s)  ->  POST (references + prompt)  ->  raw ~1024px PNG to
scripts/.gen-icons/raw/ (gitignored)  ->  key out the flat magenta bg (+ nuke residual magenta)
->  crop to content  ->  downscale hard to TARGET_W (SIDE_W for broadside)  ->  quantise to
QUANTISE_COLOURS  ->  crisp silhouette outline  ->  write the live PNG. The depleted/harvested
swap is a separate `<id>_ruined.png` built by --ruined (image-to-image from the live sprite —
a fully-collapsed version); it is NOT derived here, so --reprocess never clobbers it.

Endpoint/auth/model are the locked ones (docs/gemini-pipeline.md). Needs GEMINI_API_KEY in
env (guppi/house-helper/.env, reachable over Tailscale — see MOBILE-EDITOR-ACCESS.md).
--dry-run composes prompts + writes references only (no key, no spend); --reprocess re-runs
post-processing on the saved live raws (no key, no spend); --ruined builds the destroyed state;
--only ID does one variant.
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
from PIL import Image, ImageDraw

ENDPOINT_TMPL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Image-to-image capable models on the key (verified via the models list endpoint):
#   gemini-2.5-flash-image (older/fast), gemini-3.1-flash-image (newer/fast),
#   gemini-3-pro-image ("Nano Banana Pro", best quality/adherence — the default).
# Imagen 4 (imagen-4.0-*) is text-to-image only (predict method), so it can't take our
# reference images and isn't wired here.
DEFAULT_MODEL = "gemini-3-pro-image"
ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "public/assets/tilesets/mostowo-custom/Environment/Props/Static"
RAW = ROOT / "scripts/.gen-icons/raw"
# A clean isolated chevron ROOF from the active pack, seen from the game's exact HIGH TOP-DOWN
# angle — the perspective + pixel-art-style anchor (the game is top-down, not side-on). Component
# bbox found via alpha connected-components on Roofs.png (see docs/wired-art.md salvage section).
ROOFS = ROOT / "public/assets/tilesets/pixel-crawler/Environment/Structures/Buildings/Roofs.png"
ROOF_BBOX = (272, 87, 368, 187)
# SIDE orientation anchor: a real pack BROADSIDE roof (horizontal ridge, one long slope seen from
# above) — replaces the hand-drawn silhouette (weak/unverified) and the red roof (which was actually
# front-on). This is the back building's roof in the fantasy-tileset hay house, the one genuine
# side-on/top-down roof in the pack set (owner-identified).
SIDE_ROOF = ROOT / "public/assets/tilesets/fantasy-tileset/Buildings/House_Hay_2.png"
SIDE_ROOF_BBOX = (3, 2, 82, 52)

TARGET_W = 64  # live sprite width in px (a ~6-person tent ≈ 4 tiles); height follows aspect
SIDE_W = 80    # side/broadside tents render low, so they're baked a bit wider (owner steer)
QUANTISE_COLOURS = 10  # flatten to ~pack colour-count (tree=11, rocks=7) — was 24, read too painterly
# Silhouette outline tone — the pack outlines props in a dark near-black; re-asserting a crisp 1px
# rim after the (soft) downscale is what makes the gen read as flat pixel art, not painterly.
OUTLINE = (24, 18, 14, 255)


def target_width(orient: str) -> int:
    return SIDE_W if orient == "side" else TARGET_W

# NB: top-down oblique, NOT the "slight three-quarter" of the item icons — the reference roof
# carries the angle; the text just has to stop the model reverting to a flat side elevation.
STYLE = (
    "Dark, grotty-but-cartoonish survival-horror GAME PIXEL ART, matching the reference's flat "
    "CHUNKY low-detail look: chunky bold readable shapes, strong near-black outline, flat muted "
    "slightly-grimy colours, simple flat shading — NO gradients, NO anti-aliasing, NO "
    "photorealism, NO fine noise. One single object, centred. No ground, no floor, no cast "
    "shadow, no text, no letters, no numbers, no border, no frame."
)
BG = (
    "CRITICAL BACKGROUND: one flat uniform PURE MAGENTA background hex #FF00FF, no gradient, "
    "texture or shadow, so it can be keyed to full transparency."
)
TOPDOWN = (
    "CRITICAL CAMERA: match the reference's HIGH TOP-DOWN oblique angle — you look DOWN onto the "
    "tent from above and in front, clearly seeing the ROOF/canvas slopes from above (like the "
    "reference roof), plus a little of the front face. A top-down RPG world prop — NOT an "
    "eye-level side photo, NOT a flat elevation."
)
DESTROYED = (
    "It is WRECKED / COLLAPSED: the ridge is snapped and caved in so the roof sags inward, the "
    "canvas is ripped with jagged holes, bent poles poke through, and slack guy-lines splay FLAT "
    "outward across the ground around the base. A dark torn entrance gapes open. Clearly abandoned "
    "and destroyed, not a neat pitched tent."
)

# How the tent is TURNED under that same top-down camera — the axis the ridge runs along.
ORIENT = {
    "diagonal": (
        "Orientation: the tent sits at a 3/4 DIAGONAL — its ridge line runs diagonally across the "
        "frame (about 45 degrees), so you see two roof-slopes and a front corner."
    ),
    "side": (
        "Orientation: BROADSIDE, seen from the game's HIGH TOP-DOWN angle (you still look DOWN onto "
        "the roof from above — NOT a flat eye-level side photo). The long ridge is a HORIZONTAL line "
        "across the upper third; below it the long near roof-slope faces down toward the camera as one "
        "wide panel; a sliver of the far roof-slope shows ABOVE the ridge (because you're looking "
        "down onto it); a small gable END sits at BOTH the far left AND far right, symmetric "
        "left-to-right. Clearly WIDER than tall (about 2:1), a long low tent. CRITICAL: do NOT rotate "
        "it to a 3/4 corner, and do NOT flatten it to a low eye-level side elevation — it is a "
        "top-down view of a tent lying broadside. Keep it a proper full tent, not squashed or "
        "deformed."
    ),
    "front": (
        "Orientation: the tent faces the viewer FRONT-ON / end-on — the ridge runs straight "
        "away from the camera, so it reads as a symmetric A-frame: the dark torn triangular ENTRANCE "
        "squarely faces the camera at the front, and the two roof-slopes recede away symmetrically "
        "to the left and right of a central ridge."
    ),
}

# id -> (orientation key, colour/material clause). Realistic weathered tent colours only:
# cream/off-white, light blue, green, grey (owner steer). >=3 per angle (owner steer).
VARIANTS = {
    # diagonal (3/4). wreck_4..7 are owner picks from a candidate batch (#4/#5/#6/#9).
    "tent_wreck_1": ("diagonal", "muted olive / forest-green weathered canvas"),
    "tent_wreck_2": ("diagonal", "faded light dusty-blue canvas"),
    "tent_wreck_3": ("diagonal", "weathered grey canvas"),
    "tent_wreck_4": ("diagonal", "dirty cream / off-white canvas"),
    "tent_wreck_5": ("diagonal", "dark forest-green canvas"),
    "tent_wreck_6": ("diagonal", "dirty khaki / tan canvas"),
    "tent_wreck_7": ("diagonal", "pale stone-grey canvas"),
    # front (end-on, entrance faces camera). front_3..6 are owner picks (#1/#3/#4/#7);
    # the original weak cream front_3 was replaced.
    "tent_front_1": ("front", "faded light dusty-blue canvas"),
    "tent_front_2": ("front", "weathered grey / stone-grey canvas"),
    "tent_front_3": ("front", "muted forest-green canvas"),
    "tent_front_4": ("front", "weathered grey canvas"),
    "tent_front_5": ("front", "dirty cream / off-white canvas"),
    "tent_front_6": ("front", "steel blue-grey canvas"),
    # side (broadside, ridge horizontal) — side_2/3/4 are owner picks (#1/#4/#6).
    "tent_side_1": ("side", "dirty cream / off-white canvas"),
    "tent_side_2": ("side", "muted forest-green canvas"),
    "tent_side_3": ("side", "muted green canvas"),
    "tent_side_4": ("side", "dirty khaki / tan canvas"),
}


def roof_ref_png() -> bytes:
    """The pack roof chevron, cropped + upscaled x3 on magenta — the top-down angle/style anchor."""
    im = Image.open(ROOFS).convert("RGBA").crop(ROOF_BBOX)
    up = im.resize((im.width * 3, im.height * 3), Image.NEAREST)
    canvas = Image.new("RGBA", up.size, (255, 0, 255, 255))
    canvas.alpha_composite(up)
    out = RAW / "_roof_ref.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out)
    return out.read_bytes()


def side_ref_png() -> bytes:
    """The SIDE orientation+style anchor: a real pack BROADSIDE roof (horizontal ridge, both slopes
    seen from above), cropped + upscaled x2 on magenta. Replaces the earlier hand-drawn silhouette
    (removed — it was weak and unverified). A genuine broadside roof both fixes the orientation and
    carries the pack's pixel-art style, so `side` needs only this one reference."""
    im = Image.open(SIDE_ROOF).convert("RGBA").crop(SIDE_ROOF_BBOX)
    up = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
    canvas = Image.new("RGBA", up.size, (255, 0, 255, 255))
    canvas.alpha_composite(up)
    out = RAW / "_side_ref.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out)
    return out.read_bytes()


# Optional per-id collapse flavour so same-orientation tents don't look like clones (owner: "different
# looking"). Appended to the prompt; empty/absent ids just use the base DESTROYED description.
FLAVOUR = {
    # Each mirrors its chosen candidate combo so a regen lands near the pick.
    "tent_wreck_4": "caved in at the peak with a big rip down the middle",
    "tent_wreck_5": "half collapsed, one whole end flattened to the ground",
    "tent_wreck_6": "twisted, canvas billowing loose off the bent frame",
    "tent_wreck_7": "slumped forward with broken poles poking through the tears",
    "tent_front_3": "symmetric A-frame with the entrance torn wide open",
    "tent_front_4": "the ridge sagging and the door flaps hanging",
    "tent_front_5": "a big vertical rip down the front, poles bent",
    "tent_front_6": "symmetric but shredded, holes torn across both panels",
    "tent_side_2": "one end caved flat to the ground, the other end a lopsided peak, ridge pole snapped in two",
    "tent_side_3": "flattened almost to the ground — just low humps of canvas and splayed guy-lines",
    "tent_side_4": "front wall collapsed forward, canvas draped over the entrance, one pole still upright at an angle",
}


def compose(orient: str, colour: str, flavour: str = "") -> str:
    subject = f"a large 6-person ridge camping tent in {colour}"
    if orient == "side":
        return (
            f"The attached image is a REFERENCE: a building's roof drawn from the game's angle — a "
            f"BROADSIDE roof with a HORIZONTAL ridge, both slopes seen from a high top-down angle. "
            f"Copy that SAME camera angle, that broadside horizontal-ridge orientation, and that flat "
            f"pixel-art style — but draw a wrecked fabric TENT, NOT a house and NOT roof tiles. "
            f"Draw {subject}. {ORIENT[orient]} {DESTROYED} {flavour} {STYLE} {BG}"
        )
    return (
        f"The attached image is a REFERENCE for the exact camera angle and pixel-art style of the "
        f"game: a ridged roof seen from a high top-down angle. Using that SAME angle and style, "
        f"draw {subject}. {ORIENT[orient]} {TOPDOWN} {DESTROYED} {flavour} {STYLE} {BG}"
    )


def images_for(orient: str) -> list[bytes]:
    """Reference image per orientation: side uses a real BROADSIDE roof (horizontal ridge); diagonal
    and front use the diagonal roof chevron. Both are real pack art — no hand-drawn guide."""
    return [side_ref_png()] if orient == "side" else [roof_ref_png()]


# ---- Ruined / "harvested" state (image-to-image from the LIVE sprite) ----------------------------
# After the tent is salvaged it swaps to a fully-DESTROYED sprite. We generate that from the tent's own
# live art (image-to-image) so the ruin keeps its colour/angle/footprint and reads as "this exact tent,
# now flattened". Written to `<id>_ruined.png` (NOT `_searched.png`, which --reprocess derives + would
# clobber). PROMPT IS STILL BEING DIALED IN — see docs/AI-SPRITE-PIPELINE.md.
RUIN = (
    "The attached image is a wrecked {colour} 6-person camping tent (flat pixel-art game prop, high "
    "top-down angle). Redraw this SAME tent now UTTERLY DESTROYED — no standing structure left at all: "
    "the whole tent has collapsed FLAT to the ground, the poles fully snapped and scattered, the canvas "
    "torn to shreds and lying in a flat crumpled tarp spread across the dirt with gaping holes. It "
    "should barely read as a tent — a flattened ruin of fabric and broken sticks, hardly rising off "
    "the ground. NO upright peak, NO recognisable roof — think a deflated, flattened wreck seen from "
    "above. KEEP the same {colour} canvas colour, the same high top-down angle, and roughly the same "
    "footprint/position so it can replace the standing wreck in place. {style} {bg}"
)


def ruin_ref_png(tid: str) -> bytes:
    """The live pack sprite, upscaled x8 (nearest) on magenta — the identity/colour/angle anchor for
    its ruined version (same upscaled-reference trick as the rogue)."""
    im = Image.open(PACK / f"{tid}.png").convert("RGBA")
    up = im.resize((im.width * 8, im.height * 8), Image.NEAREST)
    canvas = Image.new("RGBA", up.size, (255, 0, 255, 255))
    canvas.alpha_composite(up)
    out = RAW / f"_ruinref_{tid}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out)
    return out.read_bytes()


def compose_ruin(colour: str) -> str:
    return RUIN.format(colour=colour, style=STYLE, bg=BG)


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
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:1000]
        sys.exit(f"Gemini API HTTP {e.code}: {detail}")
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
    # Also nuke any residual magenta-ish fleck (R & B high, G low) the corner-key missed — no tent
    # material is magenta, so this is safe and clears stray anti-aliased key pixels near thin
    # guy-lines/pegs that fell just outside `tol`.
    r, g, b = out[:, :, 0], out[:, :, 1], out[:, :, 2]
    out[(r > 180) & (b > 180) & (g < 90), 3] = 0
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
    a = img.split()[3].point(lambda v: 255 if v > 110 else 0)  # hard alpha (crisp pixel edge)
    out = np.asarray(Image.merge("RGBA", (r, g, b, a))).copy()
    # Defensive: median-cut can mint a magenta-ish tone from bg pixels that blended into a dark
    # interior edge (a stray fleck near the entrance shadow). No tent material is magenta, so recolour
    # any such opaque pixel to the dark outline tone.
    rr, gg, bb, aa = out[:, :, 0], out[:, :, 1], out[:, :, 2], out[:, :, 3]
    # magenta/purple = both R and B elevated and roughly equal, with G low. No tent material fits this
    # (blues have b>r, khaki/cream have high g), so the threshold can be generous without eating hues.
    magenta = (rr > 110) & (bb > 110) & (gg < 90) & (np.abs(rr - bb) < 70) & (aa > 0)
    out[magenta] = OUTLINE
    return Image.fromarray(out, "RGBA")


def outline(img: Image.Image) -> Image.Image:
    """Re-assert a crisp 1px dark rim on the silhouette (pack convention). Every opaque pixel that
    borders transparency (or the image edge) is set to OUTLINE — this hardens the soft downscaled
    edge so the sprite reads as flat pixel art, matching the pack's dark-outlined props."""
    a = np.asarray(img.convert("RGBA")).copy()
    op = a[:, :, 3] > 110
    edge = np.zeros_like(op)
    edge[:-1, :] |= op[:-1, :] & ~op[1:, :]
    edge[1:, :] |= op[1:, :] & ~op[:-1, :]
    edge[:, :-1] |= op[:, :-1] & ~op[:, 1:]
    edge[:, 1:] |= op[:, 1:] & ~op[:, :-1]
    # opaque pixels sitting on the image border are silhouette too
    edge[0, :] |= op[0, :]; edge[-1, :] |= op[-1, :]; edge[:, 0] |= op[:, 0]; edge[:, -1] |= op[:, -1]
    a[edge] = OUTLINE
    return Image.fromarray(a, "RGBA")


def to_sprite(raw_png: Path, width: int = TARGET_W) -> Image.Image:
    img = key_out(Image.open(raw_png))
    img = crop_content(img)
    h = max(1, round(img.height * (width / img.width)))
    img = img.resize((width, h), Image.LANCZOS)
    return outline(quantise(img, QUANTISE_COLOURS))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", metavar="ID", help="generate just this one tent id")
    ap.add_argument("--dry-run", action="store_true",
                    help="compose prompts + write reference images only (no key, no spend)")
    ap.add_argument("--raw-only", action="store_true", help="keep raw PNGs, skip post-process")
    ap.add_argument("--reprocess", action="store_true",
                    help="re-run post-processing on the saved raw PNGs only (no API call, no spend)")
    ap.add_argument("--ruined", action="store_true",
                    help="build the fully-DESTROYED '<id>_ruined.png' from each LIVE sprite "
                         "(image-to-image); the salvaged/harvested depleted state. Reprocesses a saved "
                         "'<id>_ruined_raw.png' if present (no re-spend); else generates one")
    ap.add_argument("--regen", action="store_true",
                    help="with --ruined: force a fresh generation even if a saved raw exists")
    ap.add_argument("--model", default=DEFAULT_MODEL,
                    help=f"Gemini image model (default {DEFAULT_MODEL}; image-to-image capable ids: "
                         "gemini-3-pro-image, gemini-3.1-flash-image, gemini-2.5-flash-image)")
    args = ap.parse_args()

    ids = [args.only] if args.only else list(VARIANTS)
    unknown = [i for i in ids if i not in VARIANTS]
    if unknown:
        sys.exit(f"unknown id(s): {', '.join(unknown)}; known: {', '.join(VARIANTS)}")

    if args.dry_run:
        roof_ref_png()
        side_ref_png()
        for tid in ids:
            orient, colour = VARIANTS[tid]
            print(f"\n=== {tid} ({orient}) ===\n{compose(orient, colour)}")
        print(f"\n[dry-run] {len(ids)} prompt(s) composed; references written; no API call.")
        return

    if args.reprocess:
        for tid in ids:
            raw_png = RAW / f"{tid}.png"
            if not raw_png.exists():
                print(f"  skip {tid}: no saved raw at {raw_png.relative_to(ROOT)}")
                continue
            live = to_sprite(raw_png, target_width(VARIANTS[tid][0]))
            live.save(PACK / f"{tid}.png")
            print(f"  reprocessed {tid} -> {live.width}x{live.height}")
        return

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("Missing GEMINI_API_KEY (guppi/house-helper/.env, via Tailscale). --dry-run to test.")

    if args.ruined:
        for tid in ids:
            orient, colour = VARIANTS[tid]
            raw_png = RAW / f"{tid}_ruined_raw.png"
            # Reprocess a saved raw (no re-spend, preserves an already-approved ruin); else generate.
            if raw_png.exists() and not args.regen:
                print(f"\n=== {tid} RUINED ({orient}) — reprocess saved raw ===")
            else:
                print(f"\n=== {tid} RUINED ({orient}) — generate ===")
                raw_png.write_bytes(gemini_image(compose_ruin(colour), [ruin_ref_png(tid)], key, args.model))
            live = to_sprite(raw_png, target_width(orient))
            live.save(PACK / f"{tid}_ruined.png")
            print(f"  -> {tid}_ruined.png ({live.width}x{live.height})")
        return

    for tid in ids:
        orient, colour = VARIANTS[tid]
        print(f"\n=== {tid} ({orient}) ===")
        raw = gemini_image(compose(orient, colour, FLAVOUR.get(tid, "")), images_for(orient), key, args.model)
        raw_png = RAW / f"{tid}.png"
        raw_png.parent.mkdir(parents=True, exist_ok=True)
        raw_png.write_bytes(raw)
        print(f"  raw -> {raw_png.relative_to(ROOT)}")
        if args.raw_only:
            continue
        live = to_sprite(raw_png, target_width(orient))
        live.save(PACK / f"{tid}.png")
        print(f"  -> {tid}.png ({live.width}x{live.height}) — run --ruined for the depleted state")


if __name__ == "__main__":
    main()
