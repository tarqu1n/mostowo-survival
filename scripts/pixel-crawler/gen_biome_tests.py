#!/usr/bin/env python3
"""**Test biome maps** — render whole biomes from the baked tile edge sets so the tiling AND the
scattered forest-floor object mix can both be judged by eye before any of it reaches the editor or the
game: a height field, threshold bands, autotiled boundaries, scattered fill variety, and (by default)
the real scatter-generated nodes/decor on top.

Mirrors the composition `src/systems/biomeGen/terrain.ts` landed (plan 052 Step 7), on purpose — same
model, same layering, so what shows up here is what the editor's biome tool will paint:
  1. a shared **height field** (fbm noise) per region,
  2. **bands** claim cells below their `maxHeight` (`biomes.json`'s `terrain.bands`), each painted as an
     opaque fill on the base layer — a `blob` band (mud) as its flat fill only, a `depth` band (water)
     as its own dual-grid coast/transition render,
  3. the **base terrain** on top as an ALPHA-CUTOUT OVERLAY, autotiled against a mask that is a HOLE
     wherever a band claimed the cell — the base's semi-transparent edge pixels are what blend every
     boundary (the "hole" technique; see docs/BIOMES.md "Worked example: muddy patches").

Every map is audited with `edge_compat.audit_canvas` — the same pairwise 1px-border test that built the
scatter pools, applied to the TERRAIN-ONLY pixels (before any object is composited — a tree or bush
legitimately straddles a tile boundary, which would make the 1px-border test meaningless if it ran
after compositing). `hard edges` must print 0 for every map; the `worst seam` column is the human-useful
number (an authored boundary scores well under the 0.85 break threshold, so a creeping worst-seam value
is the early warning that a band pairing is starting to read as a cut).

**Objects** (plan 052 Step 8/9 preview — see docs/BIOMES.md "Scatter preview") call the REAL shipped
`generateScatter` (src/systems/biomeGen/scatter.ts) via a tiny Node bridge (`scatter_bridge.ts`, run
through `vite-node`, the only TS-execution binary this repo has installed) rather than a second,
approximate reimplementation — so the density/spacing numbers on screen are the real ones. Only presets
whose entry names a `"biome"` (currently just `forest`, the one real `biomes.json` entry with a
`scatter` array) get objects; the others stay tiles-only and say so. `generateScatter` is called
directly, NOT `generateBiome` — so this does NOT replicate `index.ts`'s region-edge density falloff
(the taper that blends a biome PATCH into the surrounding map near its border): these test maps render
one full, standalone region rather than a patch dropped into a larger world, so tapering density at
its edges would misrepresent the real interior density as "this is what it looks like," which is
exactly what this tool exists to show honestly.

Run: `python3 scripts/pixel-crawler/gen_biome_tests.py [--preset forest] [--seed 3] [--scale 3]
[--no-objects]`
Writes (gitignored — eyeball artifacts): `scripts/pixel-crawler/.biome-tests/<preset>.png` + a
`contact.png` montage of them all. Re-run `bake_edge_set.py` first if the edge sets changed.
"""
import argparse
import json
import os
import random
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import edge_compat  # noqa: E402
from bake_edge_set import (  # noqa: E402
    PACK_ID,
    paint_blob_field,
    paint_blob_masked,
    paint_depth_water,
    seamless_base_tile,
    value_noise,
)
from autotile import smooth_mask  # noqa: E402
from compose import TILE, sheet as _sheet  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
EDGE_SETS = os.path.join(ROOT, "public", "assets", "tilesets", PACK_ID, "edge-sets")
ASSETS_DIR = os.path.join(ROOT, "public", "assets", "tilesets")
BIOMES_JSON = os.path.join(ASSETS_DIR, "pixel-crawler", "biomes.json")
NODES_JSON = os.path.join(ROOT, "src", "data", "maps", "nodes.json")
VITE_NODE = os.path.join(ROOT, "node_modules", ".bin", "vite-node")
SCATTER_BRIDGE = os.path.join(os.path.dirname(__file__), "scatter_bridge.ts")
OUT_DIR = os.path.join(os.path.dirname(__file__), ".biome-tests")

W, H = 44, 30  # tiles per test map
PAD = 4        # rendered then cropped off: a finite canvas has no "beyond the edge" neighbour, so the
               # base overlay's blob_key reads the canvas border as a coastline (see BIOMES.md gotcha)

# One entry per test map. `bands` are (edge-set id, maxHeight) ASCENDING by maxHeight — a cell belongs
# to the first band whose maxHeight it falls under, else to `base` (mirrors `biomeDefs.ts`'s sorted
# bands). `field` is the fbm height field. The set deliberately spans the pairings worth eyeballing:
# the shipped Forest preset, water bordering grass DIRECTLY (vs Forest, where mud always sits between —
# the coast-shade caveat flagged in biomeGen/terrain.ts), a wet map where water dominates, and the
# INVERTED layering (mud as the base terrain, grass as a band) to prove the composition isn't
# grass-specific.
PRESETS = {
    # the shipped Forest preset, verbatim from public/assets/tilesets/pixel-crawler/biomes.json.
    # `biome` names the biomes.json entry to pull `scatter` layers from for the objects pass — the
    # only preset that has one, since it's the only real biome authored with a scatter stack so far.
    "forest": {"base": "grass", "bands": [("water", 0.22), ("mud", 0.38)],
               "field": {"scale": 0.06, "octaves": 3}, "seed": 1, "biome": "forest"},
    "pond-in-grass": {"base": "grass", "bands": [("water", 0.24)],
                      "field": {"scale": 0.06, "octaves": 3}, "seed": 4},
    "marsh": {"base": "grass", "bands": [("water", 0.42), ("mud", 0.62)],
              "field": {"scale": 0.09, "octaves": 4}, "seed": 7},
    "dust-flats": {"base": "mud", "bands": [("water", 0.14), ("grass", 0.46)],
                   "field": {"scale": 0.07, "octaves": 3}, "seed": 11},
}

_biomes_cache = None
_node_defs_cache = None
_img_cache = {}


def load_biomes():
    """`biomes.json`'s `biomes[]`, keyed by id — lazy + cached (module-level, reused across presets)."""
    global _biomes_cache
    if _biomes_cache is None:
        with open(BIOMES_JSON) as fh:
            doc = json.load(fh)
        _biomes_cache = {b["id"]: b for b in doc["biomes"]}
    return _biomes_cache


def load_node_defs():
    """`nodes.json`'s `defs[]`, keyed by id — lazy + cached."""
    global _node_defs_cache
    if _node_defs_cache is None:
        with open(NODES_JSON) as fh:
            doc = json.load(fh)
        _node_defs_cache = {d["id"]: d for d in doc["defs"]}
    return _node_defs_cache


def load_image(rel_path):
    """Pack-relative asset path (e.g. `craftpix-nature/Bushes/Fern1_1.png`) -> cached RGBA `Image`."""
    img = _img_cache.get(rel_path)
    if img is None:
        img = Image.open(os.path.join(ASSETS_DIR, rel_path)).convert("RGBA")
        _img_cache[rel_path] = img
    return img


def resolve_node_skin(defn, skin_id):
    """`obj.skin !== undefined ? def.skins.find(s => s.id === obj.skin) : undefined) ?? def.skins[0]` —
    mirrors `objectRenderer.ts`'s `placeNodeSprite` exactly (an unspecified/unknown skin id, which is
    what an unadorned scatter member like `{ref:"tree",weight:4}` produces, always renders as
    `def.skins[0]` — NOT a weighted random pick; the per-skin `weight` field is for the editor's manual
    skin picker, unrelated to scatter placement)."""
    if skin_id is not None:
        for s in defn["skins"]:
            if s["id"] == skin_id:
                return s
    return defn["skins"][0]


def run_scatter(region_w, region_h, layers, field, seed, cell_edge_set):
    """Shells out to `scatter_bridge.ts` (via `vite-node`) to run the REAL `generateScatter` and
    returns its `placements` list. `layers`/`field` are passed through verbatim from `biomes.json`
    (already shaped exactly like `BiomeScatterLayer[]`/`BiomeTerrain.field`); `cell_edge_set` is this
    render's own REPAIRED, region-local (no PAD), row-major edge-set-id grid — see `render_preset`."""
    payload = {
        "region": {"cols": region_w, "rows": region_h},
        "layers": layers,
        "field": field,
        "seed": seed,
        "cellEdgeSet": cell_edge_set,
    }
    with tempfile.TemporaryDirectory() as td:
        in_path = os.path.join(td, "in.json")
        out_path = os.path.join(td, "out.json")
        with open(in_path, "w") as fh:
            json.dump(payload, fh)
        proc = subprocess.run(
            [VITE_NODE, SCATTER_BRIDGE, in_path, out_path],
            cwd=ROOT, capture_output=True, text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"scatter_bridge.ts failed:\n{proc.stdout}\n{proc.stderr}")
        with open(out_path) as fh:
            return json.load(fh)["placements"]


def composite_decor(cv, asset, x, y):
    """A `kind:'decor'` placement: the whole source image, centred at pixel `(x,y)` — matches
    `placeDecor`'s Phaser default origin (0.5, 0.5); scatter-generated decor never sets scale/rotation
    (see `scatter.ts`'s `toPlacement`), so there's nothing else to apply."""
    img = load_image(asset)
    left = round(x - img.width / 2)
    top = round(y - img.height / 2)
    cv.paste(img, (left, top), img)


def composite_node(cv, node_defs, ref, col, row, skin_id):
    """A `kind:'node'` placement: resolve its skin (`resolve_node_skin`), crop to the skin's `region`
    if it has one, scale by `skin.scale ?? def.scale` (default 1.0), then anchor at
    `(skin.originX ?? def.originX, skin.originY ?? def.originY)` positioned at the TILE CENTRE — matches
    `placeNodeSprite` exactly."""
    defn = node_defs.get(ref)
    if defn is None:
        return  # unknown node ref — shouldn't happen for an authored biome, skip rather than crash
    skin = resolve_node_skin(defn, skin_id)
    img = load_image(skin["asset"])
    region = skin.get("region")
    if region:
        img = img.crop((region["x"], region["y"], region["x"] + region["w"], region["y"] + region["h"]))
    scale = skin.get("scale", defn.get("scale", 1.0))
    if scale != 1.0:
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.NEAREST)
    origin_x = skin.get("originX", defn.get("originX", 0.5))
    origin_y = skin.get("originY", defn.get("originY", 0.5))
    cx, cy = (col + 0.5) * TILE, (row + 0.5) * TILE
    left = round(cx - origin_x * img.width)
    top = round(cy - origin_y * img.height)
    cv.paste(img, (left, top), img)


def _frame(arr, cols, f, rot=0):
    t = arr[(f // cols) * TILE : (f // cols + 1) * TILE, (f % cols) * TILE : (f % cols + 1) * TILE]
    return np.rot90(t, rot) if rot else t


def load_set(set_id):
    with open(os.path.join(EDGE_SETS, f"{set_id}.json")) as fh:
        return json.load(fh)


def height_field(w, h, field, seed):
    """fbm height in 0..1 — the same shared field `biomeDefs.ts`'s `BiomeTerrain.field` describes
    (`scale` = frequency per tile, so a scale of 0.06 is a ~16-tile wavelength; `octaves` add detail at
    halving amplitude). Min-max normalised, so a band's `maxHeight` is a fraction of THIS map's range
    and the same thresholds give comparable coverage across seeds."""
    total = np.zeros((h, w))
    amp = 1.0
    for o in range(field["octaves"]):
        cells = max(2, int(round(1.0 / (field["scale"] * (2 ** o)))))
        total += value_noise(h, w, seed * 131 + o, cells, amp)
        amp *= 0.5
    lo, hi = total.min(), total.max()
    return (total - lo) / (hi - lo if hi > lo else 1.0)


def band_of(hval, bands):
    """Index of the band claiming this height, or -1 for the base terrain."""
    for i, (_, max_h) in enumerate(bands):
        if hval <= max_h:
            return i
    return -1


def claim_field(field, bands, passes=2):
    """Per-cell band index (-1 = base) from the height field, with every band footprint **majority
    smoothed** (`autotile.smooth_mask`) before it's used. Returns `(claim, smoothed_cells)`.

    Smoothing is not cosmetic — it's what makes the footprints TILEABLE. A raw threshold over noise
    produces 1-cell spurs, 1-cell notches and diagonal-only touches everywhere along a band boundary,
    and no autotiler can resolve those: a blob set has no tile for a 1-wide finger (it falls back to
    the FULL fill, which is a hard cut), and a coast set's corner cases can't ring one either. The seam
    audit finds every one of them, and they're the residual hard edges left after `shore_collar`.

    Smooths the CUMULATIVE masks (`height <= band[i].maxHeight`), not each band in isolation: the bands
    are nested by construction (ascending `maxHeight`), so smoothing cumulatively and then re-deriving
    the claim keeps them nested — smoothing them independently can pull a lower band out from under a
    higher one and open a gap between the two."""
    h, w = field.shape
    cums, smoothed = [], 0
    for i, (_, max_h) in enumerate(bands):
        raw = [[bool(field[y][x] <= max_h) for x in range(w)] for y in range(h)]
        sm = smooth_mask(raw, passes)
        if cums:  # keep the nesting: a lower band may never escape the band above it
            sm = [[sm[y][x] or cums[-1][y][x] for x in range(w)] for y in range(h)]
        smoothed += sum(1 for y in range(h) for x in range(w) if sm[y][x] != raw[y][x])
        cums.append(sm)
    claim = [[-1] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            for i, cum in enumerate(cums):
                if cum[y][x]:
                    claim[y][x] = i
                    break
    return claim, smoothed


def remove_thin_strips(claim, base=-1, rounds=6):
    """Absorb 1-cell-wide strips of the BASE terrain into the band beside them. Returns cells moved.

    A blob set has no tile for "terrain here, not-terrain on both opposite sides": the sheet yields ~17
    distinct 8-neighbour keys, and `autotile.ts`'s fallback chain (exact key -> same cardinals -> FULL)
    covers 13 of the 16 cardinal combinations — the three it can't are exactly the thin ones (E|W with
    no N/S, N|S with no E/W, and fully isolated). Those land on the FULL interior fill, which draws a
    dead-straight, unblended terrain edge: the last hard edges left in the biome test maps after
    everything else was fixed, and the same defect would show anywhere else a 1-wide strip appears.

    Band footprints don't need this (a band is painted as a flat opaque fill and never autotiles in this
    composition), and water has its own repair, so this only ever touches base cells."""
    h, w = len(claim), len(claim[0])
    moved = 0
    for _ in range(rounds):
        changed = 0
        for y in range(h):
            for x in range(w):
                if claim[y][x] != base:
                    continue
                def at(cx, cy):
                    return claim[cy][cx] if 0 <= cx < w and 0 <= cy < h else base
                ns = (at(x, y - 1) != base and at(x, y + 1) != base)
                ew = (at(x - 1, y) != base and at(x + 1, y) != base)
                if not (ns or ew):
                    continue
                sides = [at(x, y - 1), at(x, y + 1)] if ns else [at(x - 1, y), at(x + 1, y)]
                claim[y][x] = max(set(sides), key=sides.count)
                changed += 1
        moved += changed
        if not changed:
            break
    return moved


def shore_terrain(depth_doc, candidates):
    """Which terrain a depth set's COAST tiles may actually butt against, derived with the same
    pairwise 1px-border test (`edge_compat`) rather than assumed — a coast tile bakes its own copy of
    the shore terrain into the tile, so its land-side border only fits ONE terrain's fill.

    Returns `(id, counts)`: the winner and the per-candidate count of coast borders that fit. For
    Pixel Crawler water this is decisive — 192 coast borders fit `grass`, 0 fit `mud` — and it is the
    reason `shore_collar` exists: drop a pond straight into a mud band and every coast tile's baked
    grass edge butts mud, which is a hard edge at every single one of those seams (a green ring around
    the pond), no matter how good the tiling underneath is."""
    warr = np.asarray(_sheet(depth_doc["sheet"])).astype(float)
    opp = {"N": "S", "S": "N", "E": "W", "W": "E"}
    fills = {}
    for cid, doc in candidates.items():
        if doc["method"] != "blob":
            continue
        arr = np.asarray(_sheet(doc["sheet"])).astype(float)
        fills[cid] = edge_compat.borders(_frame(arr, doc["cols"], doc["surfaces"][0]["base"]))
    counts = {cid: 0 for cid in fills}
    for opts in depth_doc["coast"]["cases"].values():
        for f, rot in opts:
            cb = edge_compat.borders(_frame(warr, depth_doc["cols"], f, rot))
            for side in ("N", "E", "S", "W"):
                hits = {cid: edge_compat.diff_frac(cb[side], fb[opp[side]]) for cid, fb in fills.items()}
                cid, d = min(hits.items(), key=lambda kv: kv[1])
                if d <= edge_compat.FIT_TH:
                    counts[cid] += 1
    best = max(counts, key=lambda cid: counts[cid]) if counts else None
    return best, counts


def clean_water_bodies(claim, water_idx, shore_idx, min_area=8, passes=2):
    """Smooth a depth band's footprint and delete the bodies too small to tile — the OTHER field repair
    a coast autotile needs, alongside `shore_collar`. Returns `(smoothed_cells, removed_bodies)`.

    Why: a raw height-band threshold drops 1- and 2-cell puddles and 1-cell necks all over the map, and
    the coast art cannot resolve those. A coast tile's OUTER border only reads as plain shore terrain
    when the ring is big enough for the corner cases to land on the tiles that were drawn for them
    (measure it: only ~19% of this sheet's coast-tile borders match `grass`'s fill directly — the rest
    are meant to butt other water/coast tiles). On a large smooth body every outer border ends up on a
    grass-matching tile and the audit reads 0 hard edges; on a 1-cell puddle the ring is nothing BUT
    corner cases, so its dirt-band edge butts plain grass and every one of those seams is a hard edge.
    So the fix is a field repair, not a tolerance: majority-smooth the footprint (`autotile.smooth_mask`'s
    rule, the same one the lake demo's mask uses), then remove any remaining body under `min_area`."""
    h, w = len(claim), len(claim[0])
    wet = [[claim[y][x] == water_idx for x in range(w)] for y in range(h)]
    smoothed = smooth_mask(wet, passes)
    moved = sum(1 for y in range(h) for x in range(w) if smoothed[y][x] != wet[y][x])
    seen, removed = [[False] * w for _ in range(h)], 0
    for y0 in range(h):
        for x0 in range(w):
            if not smoothed[y0][x0] or seen[y0][x0]:
                continue
            body, stack, seen[y0][x0] = [], [(x0, y0)], True
            while stack:  # 4-connected flood fill: a diagonal-only touch is two bodies, not one
                x, y = stack.pop()
                body.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and smoothed[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            if len(body) < min_area:
                removed += 1
                for x, y in body:
                    smoothed[y][x] = False
    for y in range(h):
        for x in range(w):
            if smoothed[y][x]:
                claim[y][x] = water_idx
            elif claim[y][x] == water_idx:
                claim[y][x] = shore_idx
    return moved, removed


def shore_collar(claim, water_idx, shore_idx, radius=2):
    """Force a collar of the water's SHORE TERRAIN around every water cell, overwriting whatever band
    the height field put there. Returns the number of cells moved.

    This is the terrain-adjacency counterpart of `depth_field`'s tileability repair: the pixels say
    water's coast art can only butt one terrain (`shore_terrain`), so the field is repaired to satisfy
    that constraint instead of the renderer producing seams and hoping nobody looks. `radius=2` because
    the depth render is a DUAL GRID — a water cell paints tiles over its four surrounding vertices, so
    coast tiles reach one cell beyond the mask, and the cells those coast tiles butt are one further
    out again."""
    h, w = len(claim), len(claim[0])
    moved = 0
    near = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if claim[y][x] != water_idx:
                continue
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w:
                        near[ny][nx] = True
    for y in range(h):
        for x in range(w):
            if near[y][x] and claim[y][x] not in (water_idx, shore_idx):
                claim[y][x] = shore_idx
                moved += 1
    return moved


def render_preset(name, preset, scale, seed_override=None, want_objects=True):
    seed = preset["seed"] if seed_override is None else seed_override
    rng = random.Random(seed)
    pw, ph = W + 2 * PAD, H + 2 * PAD
    base_doc = load_set(preset["base"])
    band_docs = [load_set(bid) for bid, _ in preset["bands"]]
    field = height_field(pw, ph, preset["field"], seed)
    claim, band_smoothed = claim_field(field, preset["bands"])
    # terrain-adjacency repair: a depth band's coast art only fits ONE terrain (see shore_terrain), so
    # give every water body a collar of it before anything is drawn.
    docs = {preset["base"]: base_doc, **{bid: d for (bid, _), d in zip(preset["bands"], band_docs)}}
    collared, cleaned, dropped = 0, band_smoothed, 0
    for i, doc in enumerate(band_docs):
        if doc["method"] != "depth":
            continue
        want, counts = shore_terrain(doc, docs)
        if want is None:
            continue
        shore_idx = next((j for j, (bid, _) in enumerate(preset["bands"]) if bid == want),
                         -1 if want == preset["base"] else None)
        if shore_idx is None:  # the preset doesn't even contain the terrain this water can shore onto
            print(f"  {name}: WARNING {preset['bands'][i][0]} coast fits '{want}' "
                  f"({counts}), which this preset never paints — expect hard shore edges")
            continue
        smoothed, removed = clean_water_bodies(claim, i, shore_idx)
        cleaned += smoothed
        dropped += removed
        collared += shore_collar(claim, i, shore_idx)
    cleaned += remove_thin_strips(claim)

    cv = Image.new("RGBA", (pw * TILE, ph * TILE))
    # 1) an opaque bottom layer everywhere. The LOWEST blob band's flat fill if there is one, else the
    #    base terrain's own flat fill — something opaque has to sit under the base overlay's
    #    semi-transparent edge pixels, or the boundary blends into nothing (see paint_blob_masked).
    under = next((d for d, (bid, _) in zip(band_docs, preset["bands"]) if d["method"] == "blob"), base_doc)
    under_tile = seamless_base_tile(under)
    for y in range(ph):
        for x in range(pw):
            cv.alpha_composite(under_tile, (x * TILE, y * TILE))
    # 2) the base terrain as the alpha-cutout OVERLAY: painted where NO band claimed the cell, so every
    #    band shows through the hole and the base's own edge tiles do the blending.
    # The hole is over the BLOB bands only. A DEPTH band's cells stay INSIDE the base mask even though
    # the band will paint over them, because the base terrain must not cut its own alpha edge against a
    # depth band: the depth set's coast tiles already contain the shore art (their own baked copy of the
    # shore terrain), and they get drawn on top. Hole them out and the base terrain puts an edge tile —
    # dirt lip and all — in every cell ringing the water, which is then what the coast tile has to butt.
    # Nothing in the coast art can answer that, so the shore seams all the way round: 52 hard edges on
    # the marsh preset, and the reason the baker's own lake demo never showed it (`render_depth_lake`
    # paints plain grass everywhere first, water second — this restores that ordering per-band).
    depth_bands = {i for i, d in enumerate(band_docs) if d["method"] == "depth"}
    mask = [[claim[y][x] == -1 or claim[y][x] in depth_bands for x in range(pw)] for y in range(ph)]
    base_forced = paint_blob_masked(cv, base_doc, rng, mask)
    # 3) any blob band that ISN'T the bottom layer (e.g. `dust-flats`' grass band) still needs its own
    #    fill inside its footprint, drawn over the bottom layer.
    for i, (doc, (bid, _)) in enumerate(zip(band_docs, preset["bands"])):
        if doc["method"] != "blob" or doc is under:
            continue
        sub = [[claim[y][x] == i for x in range(pw)] for y in range(ph)]
        base_forced += paint_blob_masked(cv, doc, rng, sub)
    # 4) depth bands LAST — opaque and self-contained (coast art included), so they simply overwrite.
    #    Order matters: the depth render is a DUAL GRID, so a water body's tiles overhang its mask by
    #    one cell to the right and bottom. Painting water BEFORE the base overlay let the overlay's own
    #    fill tiles land on top of that overhang, chopping the coast ring off along its left/top edge —
    #    a hard edge at every pond, and the exact failure the seam audit flagged first time round. The
    #    baker's own lake demo has always painted in this order (`render_depth_lake`); matching it is
    #    also why the audit can't be fooled here by "it looked fine at a glance".
    invalid = forced = 0
    for i, doc in enumerate(band_docs):
        if doc["method"] != "depth":
            continue
        wet = [[claim[y][x] == i for x in range(pw)] for y in range(ph)]
        if any(any(r) for r in wet):
            bad, no_fit = paint_depth_water(cv, doc, wet, rng)
            invalid += bad
            forced += no_fit

    cv = cv.crop((PAD * TILE, PAD * TILE, (PAD + W) * TILE, (PAD + H) * TILE))
    # Audit the TERRAIN-ONLY pixels — before any object is composited. A tree/bush legitimately spans a
    # tile boundary, so auditing after compositing would flag real art as a "hard edge" (see module doc).
    hard, worst, seams, scores = edge_compat.audit_canvas(cv)

    cover, cell_edge_set = {}, []
    for y in range(H):
        for x in range(W):
            b = claim[y + PAD][x + PAD]
            key = preset["base"] if b < 0 else preset["bands"][b][0]
            cover[key] = cover.get(key, 0) + 1
            cell_edge_set.append(key)  # region-local row-major — the ScatterGenInput.cellEdgeSet contract

    obj_counts = {}
    if want_objects and "biome" in preset:
        biome = load_biomes()[preset["biome"]]
        placements = run_scatter(W, H, biome["scatter"], preset["field"], seed, cell_edge_set)
        node_defs = load_node_defs()
        for p in placements:
            obj_counts[p["layerId"]] = obj_counts.get(p["layerId"], 0) + 1
            if p["kind"] == "decor":
                composite_decor(cv, p["asset"], p["x"], p["y"])
            else:
                composite_node(cv, node_defs, p["ref"], p["col"], p["row"], p.get("skin"))
    elif want_objects:
        print(f"  {name:14} no scatter layers authored for this preset (tiles only)")

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"{name}.png")
    big = cv.resize((W * TILE * scale, H * TILE * scale), Image.NEAREST)
    big.save(out)
    if hard:  # a second image with every hard seam struck through in magenta — where to LOOK
        marked = big.copy()
        d = ImageDraw.Draw(marked)
        for score, dirn, x, y in scores[:hard]:
            px, py = x * TILE * scale, y * TILE * scale
            if dirn == "V":
                d.line([(px, py), (px, py + TILE * scale)], fill=(255, 0, 200, 255), width=2)
            else:
                d.line([(px, py), (px + TILE * scale, py)], fill=(255, 0, 200, 255), width=2)
        marked.save(os.path.join(OUT_DIR, f"{name}-audit.png"))
    cov = " ".join(f"{k}={100 * v // (W * H)}%" for k, v in sorted(cover.items(), key=lambda kv: -kv[1]))
    # Attribute every hard edge to the TERRAIN PAIRING that produced it — the number alone says "this
    # map has seams", the tally says which two bands can't legally touch, which is the actionable fact.
    def label(cx, cy):
        cx, cy = min(max(cx, 0), W - 1) + PAD, min(max(cy, 0), H - 1) + PAD
        b = claim[cy][cx]
        return preset["base"] if b < 0 else preset["bands"][b][0]

    pairs = {}
    for score, dirn, x, y in scores:
        if score <= edge_compat.BREAK_TH:
            break
        a, b = (label(x - 1, y), label(x, y)) if dirn == "V" else (label(x, y - 1), label(x, y))
        key = "|".join(sorted((a, b)))
        pairs[key] = pairs.get(key, 0) + 1
    if pairs:
        print(f"  {name:14} hard-edge pairings: " +
              ", ".join(f"{k}={v}" for k, v in sorted(pairs.items(), key=lambda kv: -kv[1])))
    objs = ("  objects(" + ",".join(f"{k}={v}" for k, v in obj_counts.items()) + ")") if obj_counts else ""
    print(f"  {name:14} seed={seed:<3} {cov:34} repair(smooth={cleaned},drop={dropped},"
          f"collar={collared}) invalid={invalid} no-fit={forced + base_forced} "
          f"hard edges={hard}/{seams} worst={worst:.2f} p99={scores[len(scores) // 100][0]:.2f}"
          f"{objs}{'  <-- FAIL' if hard or invalid else ''}")
    return out, cv, hard, invalid, obj_counts


def contact_sheet(rendered, scale=2):
    """One montage of every test map — the artifact to actually look at (and reviewable on a phone)."""
    pad, hdr = 8, 14
    cw, ch = W * TILE * scale, H * TILE * scale
    cv = Image.new("RGBA", (cw + 2 * pad, len(rendered) * (ch + hdr + pad) + pad), (24, 24, 27, 255))
    draw = ImageDraw.Draw(cv)
    for i, (name, img, note) in enumerate(rendered):
        y = pad + i * (ch + hdr + pad)
        draw.text((pad, y + 2), f"{name}  {note}", fill=(228, 228, 231, 255))
        cv.alpha_composite(img.resize((cw, ch), Image.NEAREST), (pad, y + hdr))
    out = os.path.join(OUT_DIR, "contact.png")
    cv.save(out)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--preset", choices=sorted(PRESETS), action="append",
                    help="limit to one preset (repeatable); default: all")
    ap.add_argument("--seed", type=int, help="override every preset's seed (re-roll the maps)")
    ap.add_argument("--scale", type=int, default=3, help="nearest-neighbour upscale of the saved PNGs")
    ap.add_argument("--no-objects", action="store_true",
                    help="tiles only — skip the generateScatter pass (today's original output)")
    args = ap.parse_args()
    want_objects = not args.no_objects
    print(f"test biome maps ({W}x{H} tiles{'' if want_objects else ', tiles only — no nodes/decor'}):")
    rendered, fails = [], 0
    for name in args.preset or sorted(PRESETS):
        _, cv, hard, invalid, obj_counts = render_preset(
            name, PRESETS[name], args.scale, args.seed, want_objects)
        p = PRESETS[name]
        note = f"base={p['base']} bands={'+'.join(f'{b}<{h}' for b, h in p['bands'])}"
        if obj_counts:
            note += f" objects={sum(obj_counts.values())}"
        rendered.append((name, cv, note))
        fails += bool(hard or invalid)
    out = contact_sheet(rendered)
    print(f"\nwrote {os.path.relpath(OUT_DIR, ROOT)}/ ({len(rendered)} maps + "
          f"{os.path.basename(out)}){'  <-- ' + str(fails) + ' FAILED' if fails else ''}")


if __name__ == "__main__":
    main()
