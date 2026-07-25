#!/usr/bin/env python3
"""Baker for **tile edge sets** (plan 052) — a tile edge set bundles, for one surface, its member
tiles + the data about which edges join + gameplay semantics (walkable) + accent groups, all derived
from the ART and committed as JSON so the editor/runtime does O(1) lookups and never touches pixels.

Two join methods, one schema (`method` gates the transition field):
  - **blob** (grass/dirt): the 8-neighbour alpha autotiler from `autotile.py` — `mapping` = blob-key ->
    frame. Edges are alpha (this-terrain vs not), so a mask paints straight into coherent edges/corners.
  - **dualgrid** (water): the coast tiles are OPAQUE (land/water is a COLOUR transition, no alpha edge),
    so the blob autotiler can't key them. Instead each display tile sits over a world-grid VERTEX and is
    chosen by its 4 CORNERS (water/land) -> 16 cases; `coast.cases` = case -> frame, auto-derived by
    classifying each coast tile's 4 corner blocks. (Spike write-up: plan 052 step 2 + biome_lake_poc.py.)

Both carry `surfaces[]`: the fill tiers with a clean `base` frame + noise-scattered `accents`, each
tagged `walkable`. Water splits into a LIGHT tier (shallow, walkable) and a DARK tier (deep, solid) —
the sheet's two water pools are median-brightness ~146-152 vs ~126-138, a clean split. `accents` are
kept only if they seam cleanly against the base under the pixel-adjacency (Wang) test (the "which
bubble tiles fit together" check) — the surviving set is what a generator may scatter without clashes.

Onboard a surface = add a config entry below + re-run. Writes one JSON per set under
`public/assets/tilesets/pixel-crawler/edge-sets/<id>.json`, plus a demo `bake_edge_set_demo.png` to
eyeball. Re-run: `python3 scripts/pixel-crawler/bake_edge_set.py`, then `npx prettier --write` the JSON.
"""
import json
import os
import random
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from autotile import build_blob, disc, new_mask, smooth_mask, FULL  # noqa: E402
from compose import sheet, TILE  # noqa: E402

PACK_ID = "pixel-crawler"
FLOORS = "Environment/Tilesets/Floors_Tiles.png"
WATER = "Environment/Tilesets/Water_tiles.png"
COLS = 25  # both sheets are 25 tiles wide; frame = row*COLS + col
COLOR_TH = 40   # per-pixel RGB distance counting two edge pixels as "different"
FRAC_TH = 0.85  # > this fraction of a seam's pixel pairs differing => the two tiles do NOT fit


# ----- shared pixel helpers -------------------------------------------------
def frame_tile(im, f):
    c, r = f % COLS, f // COLS
    return im.crop((c * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE))


def is_water_block(px):
    """Fraction of opaque pixels reading as water-blue or foam-white > 0.5 (mirrors the POC)."""
    r, g, b, a = px[:, :, 0], px[:, :, 1], px[:, :, 2], px[:, :, 3]
    op = a > 128
    w = ((b > r + 15) & (b > g - 10) & (b > 110)) | ((b > 180) & (g > 190) & (r > 150))
    return (w & op).sum() / max(op.sum(), 1) > 0.5


def tile_stats(arr, f):
    """(median brightness, RGB stddev) over a frame's opaque pixels — median = base water shade
    (bubble-outlier-proof), stddev = how decorated (flat fill is low, foam-heavy is high)."""
    c, r = f % COLS, f // COLS
    t = arr[r * TILE : (r + 1) * TILE, c * TILE : (c + 1) * TILE]
    op = t[:, :, 3] > 128
    rgb = t[:, :, :3][op]
    return float(np.median(rgb)), float(rgb.std())


def tile_mean_rgb(arr, f):
    c, r = f % COLS, f // COLS
    t = arr[r * TILE : (r + 1) * TILE, c * TILE : (c + 1) * TILE]
    op = t[:, :, 3] > 128
    return t[:, :, :3][op].mean(axis=0)


def pick_base_and_accents(arr, frames, accent_tol):
    """Choose a representative BASE tile + the accents that won't read as hard-edged patches.

    The base is the FLAT tile (low internal stddev, so it doesn't self-repeat visibly) whose MEAN
    COLOUR is closest to the group's mean — a centroid, not an extreme, so accents deviate from it
    symmetrically and minimally. An accent is kept only if its mean colour is within `accent_tol`
    (RGB dE) of the base: that is the "which tiles count as the same colour" knob — tightening it
    drops the shade outliers that show as blocky tile-boundary jumps when scattered. Returns
    (base, accents, dropped[(frame, dE)]) with accents ordered closest-shade-first."""
    means = {f: tile_mean_rgb(arr, f) for f in frames}
    stds = {f: tile_stats(arr, f)[1] for f in frames}
    group_mean = np.mean(list(means.values()), axis=0)
    med_std = float(np.median(list(stds.values())))
    flat = [f for f in frames if stds[f] <= med_std] or frames  # the flatter half (never empty)
    base = min(flat, key=lambda f: np.linalg.norm(means[f] - group_mean))
    base_mean = means[base]
    scored = sorted(((float(np.linalg.norm(means[f] - base_mean)), f) for f in frames if f != base))
    accents = [f for d, f in scored if d <= accent_tol]
    dropped = [(f, round(d, 1)) for d, f in scored if d > accent_tol]
    return base, accents, dropped


def diff_frac(line_a, line_b):
    d = np.sqrt(((line_a[:, :3].astype(float) - line_b[:, :3]) ** 2).sum(1))
    return float((d > COLOR_TH).mean())


def seam_fit(arr, fa, fb, dirn):
    """Worst-case not-fit fraction placing fb to the (E|S) of fa: compares the touching pixel lines."""
    a = frame_tile_arr(arr, fa)
    b = frame_tile_arr(arr, fb)
    return diff_frac(a[:, 15], b[:, 0]) if dirn == "E" else diff_frac(a[15, :], b[0, :])


def frame_tile_arr(arr, f):
    c, r = f % COLS, f // COLS
    return arr[r * TILE : (r + 1) * TILE, c * TILE : (c + 1) * TILE]


# ----- blob (grass/dirt) ----------------------------------------------------
N, E, S, W, NE, SE, SW, NW = 1 << 7, 1 << 6, 1 << 5, 1 << 4, 1 << 3, 1 << 2, 1 << 1, 1 << 0


def key_tuple_to_int(t):
    n, e, s, w, ne, se, sw, nw = t
    return (n * N) | (e * E) | (s * S) | (w * W) | (ne * NE) | (se * SE) | (sw * SW) | (nw * NW)


def build_blob_set(cfg):
    """Blob-method tile edge set: reuse autotile.py's classifier for the mapping (same as
    gen_terrains.py), then split the FULL-surround fills into a clean base + accents."""
    box = cfg["box"]
    table = build_blob(cfg["sheet"], *box)
    mapping = {}
    for key_tuple, options in table.items():
        c, r = min(options, key=lambda cr: (cr[1], cr[0]))  # canonical: lowest (row,col)
        mapping[key_tuple_to_int(key_tuple)] = r * COLS + c
    fills = sorted(r * COLS + c for (c, r) in table[FULL])
    arr = np.asarray(sheet(cfg["sheet"])).astype(float)
    base, accents, dropped = pick_base_and_accents(arr, fills, cfg["accent_tol"])
    surface = {"role": cfg["role"], "walkable": cfg["walkable"], "base": base, "accents": accents}
    doc = {
        "id": cfg["id"], "name": cfg["name"], "pack": PACK_ID, "sheet": cfg["sheet"], "cols": COLS,
        "method": "blob",
        "mapping": {str(k): v for k, v in sorted(mapping.items())},
        "surfaces": [surface],
    }
    return doc, {"ground": dropped}


# ----- dualgrid (water) -----------------------------------------------------
def build_coast_cases(arr, rows, cols):
    """Classify each opaque coast tile (grass-island-in-water) by its 4 corner blocks -> 16-case
    (NW<<3|NE<<2|SW<<1|SE) map. water-corner=1. First-seen canonical per case."""
    case2frame = {}
    for r in range(*rows):
        for c in range(*cols):
            t = frame_tile_arr(arr, r * COLS + c)
            if (t[:, :, 3] > 128).mean() < 0.5:
                continue
            nw = is_water_block(t[0:6, 0:6])
            ne = is_water_block(t[0:6, 10:16])
            sw = is_water_block(t[10:16, 0:6])
            se = is_water_block(t[10:16, 10:16])
            case = (nw << 3) | (ne << 2) | (sw << 1) | se
            if 0 < case < 15:  # 0 = all land (grass shows), 15 = all water (a fill's job)
                case2frame.setdefault(case, r * COLS + c)
    return case2frame


def water_surface(arr, frames, role, walkable, accent_tol):
    """Base = flat shade-centroid; accents = same-shade tiles (within accent_tol) that also seam
    cleanly vs the base. The colour gate kills the tile-boundary shade jumps; the seam gate is a
    belt-and-braces adjacency check (fills tile seamlessly, so it rarely bites)."""
    base, near, dropped = pick_base_and_accents(arr, frames, accent_tol)
    accents, rejected = [], list(dropped)
    for f in near:
        worst = max(seam_fit(arr, base, f, "E"), seam_fit(arr, f, base, "E"),
                    seam_fit(arr, base, f, "S"), seam_fit(arr, f, base, "S"))
        (accents if worst <= FRAC_TH else rejected).append(f if worst <= FRAC_TH else (f, round(worst, 2)))
    return {"role": role, "walkable": walkable, "base": base, "accents": accents}, rejected


def build_water_set(cfg):
    arr = np.asarray(sheet(cfg["sheet"])).astype(float)
    coast = build_coast_cases(arr, cfg["coast_rows"], cfg["coast_cols"])
    # fills: two physically separate opaque water pools — the LEFT pool (light_cols) is the lighter
    # water, the RIGHT pool (dark_cols) the darker. We classify by POOL MEMBERSHIP (the art's actual
    # two-water-type layout), NOT a per-tile brightness cut — foam shadows dip a light tile's median
    # below the split and would misfile it as deep. Brightness only validates the pools are ordered.
    light, dark = [], []
    for r in range(*cfg["fill_rows"]):
        for c in range(cfg["light_cols"][0], cfg["dark_cols"][1]):
            f = r * COLS + c
            t = frame_tile_arr(arr, f)
            if (t[:, :, 3] > 250).mean() < 0.98 or not is_water_block(t):
                continue
            (light if c < cfg["light_cols"][1] else dark).append(f)
    # Sanity: the pools' MEAN shade must separate (their rim tiles overlap — foam darkens the light
    # pool's border — so compare central tendency, not min/max). Guards a mis-set light_cols/dark_cols.
    mean_light = float(np.mean([tile_stats(arr, f)[0] for f in light]))
    mean_dark = float(np.mean([tile_stats(arr, f)[0] for f in dark]))
    if mean_light <= mean_dark + 5:
        raise SystemExit(f"water pools not brightness-separated (mean light={mean_light:.0f} "
                         f"dark={mean_dark:.0f}) — re-check light_cols/dark_cols before trusting walkability")
    shallow, rej_s = water_surface(arr, light, "shallow", True, cfg["accent_tol"])
    deep, rej_d = water_surface(arr, dark, "deep", False, cfg["accent_tol"])
    doc = {
        "id": cfg["id"], "name": cfg["name"], "pack": PACK_ID, "sheet": cfg["sheet"], "cols": COLS,
        "method": "dualgrid",
        "coast": {"cases": {str(k): v for k, v in sorted(coast.items())}},
        "surfaces": [shallow, deep],
    }
    return doc, {"shallow": rej_s, "deep": rej_d, "missing_cases": [x for x in range(1, 15) if x not in coast]}


# ----- config ---------------------------------------------------------------
# `accent_tol` = max RGB dE between an accent tile's mean colour and the base's before it's dropped as
# a shade outlier (the "same colour" knob — lower = flatter/cleaner, higher = more variety but risks
# blocky tile-boundary jumps). Grass tight (8): its two green variants sit ~18 apart, so 8 keeps one
# coherent shade. Water looser (9): keeps the subtle foam variety while cutting the worst patchwork.
SETS = [
    {"kind": "blob", "id": "grass", "name": "Grass", "sheet": FLOORS, "box": (0, 4, 0, 12),
     "role": "ground", "walkable": True, "accent_tol": 8},
    {"kind": "dualgrid", "id": "water", "name": "Water", "sheet": WATER,
     "coast_rows": (0, 5), "coast_cols": (0, 25), "fill_rows": (5, 15),
     "light_cols": (0, 5), "dark_cols": (5, 10), "accent_tol": 9},
]


def render_demo(root, sets):
    """One organic lake: grass surround -> dual-grid coast -> deep(solid) centre ringed by
    shallow(walkable), foam accents scattered. Eyeball the light/dark walkability split + seams."""
    grass = next(s for s in sets if s["id"] == "grass")
    water = next(s for s in sets if s["id"] == "water")
    fim, wim = sheet(FLOORS), sheet(WATER)
    W, H = 24, 18
    mask = new_mask(W, H)
    disc(mask, 12, 9, 7, 5.5)
    disc(mask, 16, 6, 3.5, 3)
    mask = smooth_mask(mask, 2)
    flat = [1 if mask[y][x] else 0 for y in range(H) for x in range(W)]

    def wet(x, y):
        return 0 <= x < W and 0 <= y < H and flat[y * W + x] == 1

    def deep_at(x, y):  # a cell is "deep" if all 4 neighbours are also water (interior)
        return wet(x, y) and all(wet(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))

    rng = random.Random(5)
    cv = Image.new("RGBA", (W * TILE, H * TILE))
    ga = grass["surfaces"][0]
    for y in range(H):
        for x in range(W):
            f = ga["base"] if rng.random() > 0.1 else rng.choice(ga["accents"])
            cv.alpha_composite(frame_tile(fim, f), (x * TILE, y * TILE))
    shallow = next(s for s in water["surfaces"] if s["role"] == "shallow")
    deep = next(s for s in water["surfaces"] if s["role"] == "deep")
    cases = {int(k): v for k, v in water["coast"]["cases"].items()}
    for y in range(H + 1):
        for x in range(W + 1):
            corners = (wet(x - 1, y - 1) << 3) | (wet(x, y - 1) << 2) | (wet(x - 1, y) << 1) | wet(x, y)
            if corners == 0:
                continue
            if corners == 15:
                surf = deep if deep_at(x, y) and deep_at(x - 1, y - 1) else shallow
                f = surf["base"] if rng.random() > 0.14 else rng.choice(surf["accents"])
            else:
                f = cases.get(corners if corners not in (6, 9) else 15)
                if f is None:
                    f = shallow["base"]
            cv.alpha_composite(frame_tile(wim, f), (x * TILE, y * TILE))
    out = os.path.join(root, "scripts", "pixel-crawler", "bake_edge_set_demo.png")
    cv.resize((W * TILE * 5, H * TILE * 5), Image.NEAREST).save(out)
    return out


def main():
    root = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
    out_dir = os.path.join(root, "public", "assets", "tilesets", PACK_ID, "edge-sets")
    os.makedirs(out_dir, exist_ok=True)
    built = []
    for cfg in SETS:
        if cfg["kind"] == "blob":
            doc, diag = build_blob_set(cfg)
        else:
            doc, diag = build_water_set(cfg)
        doc["_comment"] = (
            "GENERATED by scripts/pixel-crawler/bake_edge_set.py (plan 052) — do not hand-edit; "
            "re-run the baker. A tile edge set: member tiles + edge-join data + walkability + accents."
        )
        path = os.path.join(out_dir, f"{cfg['id']}.json")
        with open(path, "w") as fh:
            json.dump(doc, fh, indent=2)
            fh.write("\n")
        built.append(doc)
        surf = " ".join(f"{s['role']}(base={s['base']},{len(s['accents'])}acc," +
                        f"{'walk' if s['walkable'] else 'solid'})" for s in doc["surfaces"])
        extra = ""
        if doc["method"] == "dualgrid":
            extra = f" | coast cases={len(doc['coast']['cases'])} missing={diag['missing_cases']}"
        for s in doc["surfaces"]:
            dropped = diag.get(s["role"], [])
            if dropped:
                extra += f" | {s['role']} dropped {len(dropped)} shade-outlier(s)={dropped[:4]}"
        print(f"wrote {os.path.relpath(path, root)}: {surf}{extra}")
    demo = render_demo(root, built)
    print(f"wrote {os.path.relpath(demo, root)}")


if __name__ == "__main__":
    main()
