#!/usr/bin/env python3
"""Baker for **tile edge sets** (plan 052) — derives, for a tileset, the member tiles + which
edges/corners join + gameplay semantics (walkable) + fill variants, and commits it as JSON so the
editor/runtime does O(1) lookups and never touches pixels. **Full onboarding pipeline (how to fit a new
sheet — e.g. muddy patches — to a method, step by step): docs/BIOMES.md. Read it before adding a set.**

Two methods (`method` in the emitted JSON):
  - **blob** (grass/dirt): the 8-neighbour ALPHA autotiler from `autotile.py`. Tile edges are alpha
    (this-terrain vs not), so a painted mask resolves straight into coherent edges/corners. Emits
    `mapping` (blob-key -> frame) + one `surfaces[]` fill (base + accents, with a rotation-variety map).
  - **depth** (water/mud): the tiles are OPAQUE — a level boundary is a COLOUR transition, not an alpha
    edge — so the blob autotiler can't key them. A depth set is an ordered ramp of near-uniform shade
    LEVELS (e.g. shallow < mid < deep) joined by CORNER dual-grid transition autotiles (one per adjacent
    level pair) + a COAST autotile (land vs the shallowest level) + per-level SOLID fill variants
    (surface decoration). Every display tile sits over a world-grid VERTEX and is chosen by the level on
    its 4 CORNERS. Emits `levels[]`, `coast.cases`, `transitions[]` (each case -> LIST of [frame,rot]
    options for variety), and `generate` params for the depth-field lake generator.

Key facts the depth method encodes (learned onboarding Pixel Crawler water, plan 052):
  - Classify per-BLOCK 2-material (each block holds exactly its two shades), not one global N-way split
    — the levels are only a few RGB apart, so a global split is noise.
  - Collect ALL (frame, rotation) per corner case: a few base tiles rotate to cover ~13/16 cases, and
    keeping every option gives placement variety. Saddle cases (6, 9) have no tile; the depth field is
    repaired so they never occur.
  - Solid fill variants come ONLY from the surface rows (`variant_rows`); the transition-block rows are
    bubble-EDGE pieces, wrong to scatter as solids.
  - A level with no fill tile in the art (deepest water) is `authored` = a flat synthesized tile of its
    shade (the shade the transitions actually lead to, so it seams). An `authored`/`fillAuthored` level's
    flat tile is also a REAL committed PNG asset (`<id>-<levelName>-fill.png`, referenced by the level's
    `fillAsset`), not just an `rgb` triple — plan 052 Step 7 needed a real `TileSource{kind:'image'}` to
    bake into `TileLayer.cells`, since the demo's synthesized rectangle only ever existed in memory.
  - "Looks plain" and "is perfectly self-tileable" are DIFFERENT properties that don't correlate — the
    flattest-looking candidate tile is rarely the one whose own opposite borders are pixel-identical.
    A level whose default background should look plain sets `fillAuthored` (a flat synthesized tile,
    same idea as a whole `authored` level but keeping its normal scattered variants pool) instead of
    loosening the eligibility tolerance to chase a tile that's both — that just re-admits edge-touching
    decoration (the original bug this baker exists to avoid).

Onboard a set = add a config entry to SETS + re-run. Writes one JSON per set under
`public/assets/tilesets/pixel-crawler/edge-sets/<id>.json` + a demo `bake_edge_set_demo.png` (the
acceptance guard: it MUST report `invalid tiles = 0`). Re-run:
`python3 scripts/pixel-crawler/bake_edge_set.py`, then `npx prettier --write` the JSON outputs.
"""
import json
import os
import random
import sys
from collections import deque

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import edge_compat  # noqa: E402
from autotile import build_blob, blob_key, disc, new_mask, smooth_mask, FULL  # noqa: E402
from compose import sheet, TILE  # noqa: E402

PACK_ID = "pixel-crawler"
FLOORS = "Environment/Tilesets/Floors_Tiles.png"
WATER = "Environment/Tilesets/Water_tiles.png"
COLS = 25  # both sheets are 25 tiles wide; frame = row*COLS + col
# The seam knob lives in `edge_compat` now (COLOR_TH/FIT_TH — the pairwise 1px-border test that
# decides which tiles may sit next to which). A set may raise its own floor via `compat_th`.


# ----- shared pixel helpers -------------------------------------------------
def frame_tile(im, f, rot=0):
    c, r = f % COLS, f // COLS
    t = im.crop((c * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE))
    return t if rot == 0 else Image.fromarray(np.rot90(np.asarray(t), rot))


def frame_arr(arr, f, rot=0):
    c, r = f % COLS, f // COLS
    t = arr[r * TILE : (r + 1) * TILE, c * TILE : (c + 1) * TILE]
    return t if rot == 0 else np.rot90(t, rot)


def edge_lines(t):
    """The 4 one-pixel borders of a tile as RGB int arrays, oriented so a shared seam compares
    directly: East (top->bottom) meets a right-neighbour's West; South (left->right) meets a
    bottom-neighbour's North. So A is placeable left-of B iff A.E == B.W, above B iff A.S == B.N."""
    t = t[:, :, :3].astype(int)
    return {"N": t[0, :], "S": t[15, :], "W": t[:, 0], "E": t[:, 15]}


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


def pick_base_and_accents(arr, frames, accent_tol, prefer=None):
    """Choose a representative BASE tile + the accents that won't read as hard-edged patches.

    The base is the FLAT tile (low internal stddev, so it doesn't self-repeat visibly) whose MEAN
    COLOUR is closest to the mean of the chosen cluster — a centroid, not an extreme, so accents
    deviate from it symmetrically and minimally. An accent is kept only if its mean colour is within
    `accent_tol` (RGB dE) of the base: that is the "which tiles count as the same colour" knob —
    tightening it drops the shade outliers that show as blocky tile-boundary jumps when scattered.

    `prefer` picks WHICH shade cluster when a sheet has two (e.g. Floors grass has a dark and a bright
    variant ~14 apart): 'bright'/'dark' restrict the base to the upper/lower brightness half, else the
    base is the whole-group centroid. Grass uses 'bright' so the ground matches the grass baked into
    Water_tiles.png's coast tiles (dE ~1) — otherwise a dark ground haloes bright-grass shorelines.
    Returns (base, accents, dropped[(frame, dE)]) with accents ordered closest-shade-first."""
    means = {f: tile_mean_rgb(arr, f) for f in frames}
    stds = {f: tile_stats(arr, f)[1] for f in frames}
    brt = {f: tile_stats(arr, f)[0] for f in frames}
    pool = frames
    if prefer in ("bright", "dark") and len(frames) > 2:
        med_brt = float(np.median(list(brt.values())))
        pool = [f for f in frames if (brt[f] >= med_brt) == (prefer == "bright")] or frames
    group_mean = np.mean([means[f] for f in pool], axis=0)
    med_std = float(np.median([stds[f] for f in pool]))
    flat = [f for f in pool if stds[f] <= med_std] or pool  # the flatter half (never empty)
    base = min(flat, key=lambda f: np.linalg.norm(means[f] - group_mean))
    base_mean = means[base]
    scored = sorted(((float(np.linalg.norm(means[f] - base_mean)), f) for f in frames if f != base))
    accents = [f for d, f in scored if d <= accent_tol]
    dropped = [(f, round(d, 1)) for d, f in scored if d > accent_tol]
    return base, accents, dropped


def compat_pool(arr, frames, member, color_th=edge_compat.COLOR_TH, min_size=4):
    """Run the pairwise 1px-border test (`edge_compat`) over `frames` x 4 rotations and return
      (pool, groups, color_th, self_tileable)
    where `pool` is the largest COMPATIBILITY GROUP containing `member` — the placements a generator
    may scatter in ANY arrangement without making a seam, because every pair in a group is mutually
    placeable in both directions (see `edge_compat.compat_groups`) — and `groups` is every group
    found, for a future edge-MATCHED (Wang) generator that wants the alternatives too.

    Replaces the older single-representative "edge class" heuristic (every border compared against
    the BASE tile's own border, tiles whose four borders all landed in class 0 declared mutually
    safe). That was a proxy for this: comparing each tile to one representative can't see that two
    NON-base tiles disagree with each other, and it gave no answer at all for the tiles it rejected.
    The pairwise matrix answers the actual question for every pair, and the groups fall out of it.

    `color_th` is a FLOOR, auto-relaxed per sheet exactly as the old `edge_th` was and for the same
    reason: water borders are near-uniform so a tight threshold separates the shade steps cleanly,
    but grass/mud borders carry blade and clod texture that a tight threshold shatters into
    singleton groups. Widen until the group around `member` is a usable size."""
    placements = [(f, rot) for f in frames for rot in range(4)]
    tiles = [frame_arr(arr, f, rot) for f, rot in placements]
    idx = placements.index((member, 0))
    th = color_th
    while True:
        H, V = edge_compat.fit_matrices(tiles, th)
        adj, self_ok = edge_compat.compat_graph(H, V)
        groups = edge_compat.compat_groups(adj, self_ok)
        pool = next((list(g) for g in groups if idx in g), None)
        if (pool and len(pool) >= min(min_size, len(placements))) or th >= 40:
            break
        th += 2
    if not pool:  # last-ditch: scatter the base unrotated so downstream never sees an empty pool
        pool, groups = [idx], []
    return ([list(placements[i]) for i in pool],
            [[list(placements[i]) for i in g] for g in groups],
            th, int(self_ok.sum()))


def with_edges(arr, surface, color_th):
    """Augment a fill surface with the pairwise-edge scatter pool + the groups it came from
    (`compat_pool`). `variants` stays the same shape downstream consumers already read (a list of
    `[frame, rot]` placements to scatter), it's just now provably seam-free as a SET rather than
    seam-free against the base tile alone. `_compat` records the effective threshold and pool sizes
    so a bake's tightness is visible in the committed JSON."""
    frames = [surface["base"]] + surface["accents"]
    variants, groups, th, self_ok = compat_pool(arr, frames, surface["base"], color_th)
    surface["rotations"] = True
    surface["variants"] = variants          # the base's compatibility group — the scatter pool
    surface["groups"] = groups              # every group found, for a future edge-matched generator
    surface["_compat"] = {"colorTh": th, "fitTh": edge_compat.FIT_TH,
                          "placements": len(frames) * 4, "selfTileable": self_ok,
                          "groups": [len(g) for g in groups]}
    return surface


def make_seamless_arr(t):
    """`make_seamless` on a raw numpy tile (see that function for why the edges are COPIED, not blended)
    — the form the pixel comparisons want, since the interior fill a border is judged against is the
    seam-corrected base tile the painters actually draw, not the raw sheet frame."""
    a = np.array(t)
    a[:, -1] = a[:, 0]
    a[-1, :] = a[0, :]
    return a


def make_seamless(im):
    """Force a tile to self-tile with a provably zero-diff seam: copy its own LEFT edge onto its RIGHT
    edge and its own TOP edge onto its BOTTOM edge (col -1 := col 0, row -1 := row 0). A literal copy,
    not a blend — the source art is a 2-colour dither/noise pattern, so blending would invent a colour
    that doesn't belong. Operates on the full RGBA array (`np.array(im)` keeps whatever channels `im`
    has), so alpha travels with the copy too — relevant for blob FULL tiles, which are the fully-solid
    (alpha=255 everywhere) interior piece of an alpha-cutout terrain, not a plain opaque photo like
    water's. Two side-by-side (or stacked) copies of the SAME corrected tile then always meet with an
    identical border, by construction — this is what a colour-distance TOLERANCE can never guarantee,
    because the sheet's flattest-looking tile (lowest internal stddev) still usually isn't itself
    perfectly self-tileable (see docs/BIOMES.md gotchas): the properties don't correlate, so make the
    chosen tile seamless directly instead of hunting for one that's already both flat and seamless."""
    a = np.array(im)
    a[:, -1] = a[:, 0]
    a[-1, :] = a[0, :]
    return Image.fromarray(a)


_seamless_cache = {}


def seamless_base_tile(doc):
    """The `doc`'s primary surface `base` frame, corrected via `make_seamless` and cached per set id —
    the tile to use for a biome's DEFAULT background (flat-looking, zero self-diff), as opposed to its
    `variants` (occasional scattered accents, allowed to differ — that's the point of scattering them)."""
    if doc["id"] not in _seamless_cache:
        surf = doc["surfaces"][0]
        _seamless_cache[doc["id"]] = make_seamless(frame_tile(sheet(doc["sheet"]), surf["base"], 0))
    return _seamless_cache[doc["id"]]


def frame_tile_arr(arr, f):
    c, r = f % COLS, f // COLS
    return arr[r * TILE : (r + 1) * TILE, c * TILE : (c + 1) * TILE]


# ----- blob (grass/dirt) ----------------------------------------------------
N, E, S, W, NE, SE, SW, NW = 1 << 7, 1 << 6, 1 << 5, 1 << 4, 1 << 3, 1 << 2, 1 << 1, 1 << 0


def key_tuple_to_int(t):
    n, e, s, w, ne, se, sw, nw = t
    return (n * N) | (e * E) | (s * S) | (w * W) | (ne * NE) | (se * SE) | (sw * SW) | (nw * NW)


def rotate_blob_key(key_tuple, rot):
    """Rotate an 8-neighbour blob key the same way `np.rot90` rotates the TILE PIXELS it describes, by
    laying the 8 neighbours (+ an unused centre) into a 3x3 grid and rotating that — so a tile classified
    for one key, drawn at `rot`, is a valid (frame, rot) OPTION for whatever key its pixels rotate INTO,
    not just its own native (rot=0) key. This is what gives blob edges/corners the same "collect every
    rotation, not just the first" variety the depth method's transition autotiles already have (see
    `build_corner_map`) — a single canonical frame per case was the actual cause of the harder-edged
    corners: one frame is one frame's worth of shading, no matter how good a fit its shape is."""
    n, e, s, w, ne, se, sw, nw = key_tuple
    grid = np.array([[nw, n, ne], [w, 0, e], [sw, s, se]])
    g = np.rot90(grid, rot)
    (nw2, n2, ne2), (w2, _, e2), (sw2, s2, se2) = g
    return (int(n2), int(e2), int(s2), int(w2), int(ne2), int(se2), int(sw2), int(nw2))


def filter_blob_mapping(arr, mapping, base_tile, tol=0.1):
    """Drop blob-mapping options whose INTERIOR-FACING borders don't read as plain terrain, scoring them
    against the set's own base fill with the 1px test. Returns `(mapping, dropped, best_kept)`.

    The invariant this enforces: if a key says "the cell on my north IS this terrain", then the tile's
    north border must look like plain terrain, because the neighbour there will be a plain interior fill
    (or another edge tile whose facing border satisfies the same rule) — so any two tiles agreeing on
    their shared cell agree on their shared border too, which is what makes the whole autotiled field
    seam-free by construction.

    Why options violate it at all: `build_blob` classifies frames by ALPHA sampling, and
    `rotate_blob_key` then re-uses a frame in every rotation whose key its pixels satisfy. Both are
    shape-level tests — they don't look at what the tile's border pixels actually ARE. Pixel Crawler's
    grass has edge tiles carrying a baked-in dirt lip that runs right to a border which the key claims
    is interior: place one next to a plain grass tile and the lip is cut off dead, a 1px brown line
    against green. That's the single most visible hard edge the biome test maps found, and no amount of
    placement-time matching fixes it (the interior neighbour has nothing to vary — it's the base fill).

    The rule is RELATIVE, not absolute, and that's a measured decision, not a fudge: on this pack NO edge
    tile has a perfectly plain interior border (best scores run 0.25–0.56 — the dirt lip always spills a
    few pixels along the borders the key calls interior), because the lip is drawn to run CONTINUOUSLY
    along a coastline across tile boundaries. Applied absolutely, the rule would empty every non-FULL key
    and collapse edge variety to one option each. So each key keeps every option within `tol` of ITS OWN
    best score: the worst offenders (a border that is entirely lip — the 1px brown line against green)
    go, the equally-good alternatives all stay. A lip that spills a little is fine anyway: the audit's
    break threshold sits at 0.85, well above these, and the neighbour usually continues the lip."""
    plain = edge_compat.borders(base_tile)
    opp = {"N": "S", "S": "N", "W": "E", "E": "W"}
    bits = {"N": N, "E": E, "S": S, "W": W}
    out, dropped = {}, 0
    for key, opts in mapping.items():
        scored = []
        for f, rot in opts:
            tb = edge_compat.borders(frame_arr(arr, f, rot))
            worst = 0.0
            for side, bit in bits.items():
                if key & bit:  # this side faces INTERIOR terrain -> its border must read as plain
                    worst = max(worst, edge_compat.diff_frac(tb[side], plain[opp[side]]))
            scored.append((worst, [f, rot]))
        floor = min(s for s, _ in scored)
        keep = [o for s, o in scored if s <= max(edge_compat.FIT_TH, floor + tol)]
        dropped += len(opts) - len(keep)
        out[key] = keep
    return out, dropped


def build_blob_set(cfg):
    """Blob-method tile edge set: reuse autotile.py's classifier for the mapping (same as
    gen_terrains.py) — ONE canonical frame per NATIVE key (`build_blob` already groups several
    same-shaped frames under one key, e.g. grass's key (1,1,0,1,1,0,0,1) lists frames 2, 3, 29, 127,
    128, 154 as interchangeable; they're only alpha-equivalent, NOT visually interchangeable — some
    carry a baked-in edge shadow and some don't, so picking a canonical one keeps that consistent) —
    then rotate THAT SAME single frame into whichever OTHER cases its pixels also satisfy
    (`rotate_blob_key`), so each case still gets a LIST of [frame, rot] options for variety (matching
    how the depth method's transition autotiles work), just never mixing distinct native frames
    together. Finally split the FULL-surround fills into a clean base + accents."""
    box = cfg["box"]
    table = build_blob(cfg["sheet"], *box)
    mapping = {}
    for key_tuple, options in table.items():
        c, r = min(options, key=lambda cr: (cr[1], cr[0]))  # canonical: lowest (row,col)
        f = r * COLS + c
        for rot in range(4):
            rkey = key_tuple_to_int(rotate_blob_key(key_tuple, rot))
            opt = [f, rot]
            if opt not in mapping.setdefault(rkey, []):
                mapping[rkey].append(opt)
    fills = sorted(r * COLS + c for (c, r) in table[FULL])
    arr = np.asarray(sheet(cfg["sheet"])).astype(float)
    base, accents, dropped = pick_base_and_accents(arr, fills, cfg["accent_tol"], cfg.get("prefer"))
    surface = {"role": cfg["role"], "walkable": cfg["walkable"], "base": base, "accents": accents}
    with_edges(arr, surface, cfg.get("compat_th", edge_compat.COLOR_TH))
    # options must also be faithful to their own key's interior sides (see filter_blob_mapping)
    mapping, opt_dropped = filter_blob_mapping(arr, mapping, make_seamless_arr(frame_arr(arr, base)))
    doc = {
        "id": cfg["id"], "name": cfg["name"], "pack": PACK_ID, "sheet": cfg["sheet"], "cols": COLS,
        "method": "blob",
        "mapping": {str(k): v for k, v in sorted(mapping.items())},
        "surfaces": [surface],
    }
    return doc, {"ground": dropped, "optionsDropped": opt_dropped}


# ----- depth method (water / mud): opaque shade-ramp with corner dual-grid transitions -----------
# The tiles here are OPAQUE — a level boundary is a COLOUR transition, not an alpha edge — so the blob
# autotiler (which keys on alpha) can't tile them. Instead a depth set has ordered LEVELS (near-uniform
# shades, e.g. shallow<mid<deep), joined by CORNER dual-grid transition autotiles (one per adjacent
# level pair) plus a COAST autotile (land vs the shallowest level), and per-level SOLID fill variants
# (surface decoration). Every display tile is chosen by the level on its four CORNERS. Full onboarding
# recipe (how to fit a new sheet like muddy patches to this): docs/BIOMES.md.
def corner_shades(arr, f, rot=0):
    """Mean RGB of a tile's 4 corner blocks (NW, NE, SW, SE), optionally rotated k*90deg (np.rot90)."""
    c, r = f % COLS, f // COLS
    t = arr[r * TILE : (r + 1) * TILE, c * TILE : (c + 1) * TILE, :3]
    if rot:
        t = np.rot90(t, rot)
    g = lambda ys, xs: t[ys, xs].reshape(-1, 3).mean(0)  # noqa: E731
    return [g(slice(0, 5), slice(0, 5)), g(slice(0, 5), slice(11, 16)),
            g(slice(11, 16), slice(0, 5)), g(slice(11, 16), slice(11, 16))]


def kmeans2(pts):
    """2-means on RGB points -> (bright, dark) centroids (bright = higher mean channel). Robust when
    two levels are only a few RGB apart and foam adds noise — a per-BLOCK binary split beats a global
    N-way one, because each transition block contains exactly its own two shades."""
    pts = np.asarray(pts, float)
    a, b = pts[pts.mean(1).argmax()], pts[pts.mean(1).argmin()]
    for _ in range(25):
        da, db = np.linalg.norm(pts - a, axis=1), np.linalg.norm(pts - b, axis=1)
        A, B = pts[da <= db], pts[da > db]
        if len(A):
            a = A.mean(0)
        if len(B):
            b = B.mean(0)
    return (a, b) if a.mean() >= b.mean() else (b, a)


def opaque_fill(arr, f):
    c, r = f % COLS, f // COLS
    return (arr[r * TILE : (r + 1) * TILE, c * TILE : (c + 1) * TILE, 3] > 250).mean() > 0.98


def block_centroids(arr, box):
    """(bright, dark) shades of one transition BLOCK, via 2-means over all its opaque tiles' corners."""
    c0, c1, r0, r1 = box
    corners = [v for r in range(r0, r1) for c in range(c0, c1) if opaque_fill(arr, r * COLS + c)
               for v in corner_shades(arr, r * COLS + c)]
    return kmeans2(corners)


def build_corner_map(arr, box, bright, dark):
    """A 2-material corner dual-grid autotile. case = 4 corner bits (1 where corner == bright/shallower;
    order NW NE SW SE) -> LIST of [frame, rot] that produce it. ALL options are collected (including
    every rotation), so the several corner/edge variants — and their rotations, which read a little
    differently — all get used at render for variety. Saddle cases 6 & 9 usually stay empty (no tile in
    the art); the depth-field repair keeps them from ever occurring."""
    c0, c1, r0, r1 = box
    cmap = {}
    for r in range(r0, r1):
        for c in range(c0, c1):
            f = r * COLS + c
            if not opaque_fill(arr, f):
                continue
            for rot in range(4):
                bits = 0
                for i, v in enumerate(corner_shades(arr, f, rot)):
                    bits |= (1 if np.linalg.norm(v - bright) <= np.linalg.norm(v - dark) else 0) << (3 - i)
                if 0 < bits < 15:  # 0/15 = all-one-level = a fill, not a transition
                    cmap.setdefault(bits, []).append([f, rot])
    return cmap


def rotate_corner_case(case, rot):
    """Rotate a 4-bit corner case (NW NE / SW SE) the same way `np.rot90` rotates the TILE PIXELS it
    describes — lay the 4 corners into a 2x2 grid and rotate that, mirroring `rotate_blob_key`'s trick
    for the 8-neighbour case. Used to find which OTHER case a coast tile's pixels also satisfy once
    rotated, so cases that are pure rotations of each other (found by testing, not assumed) can share
    options instead of each only ever drawing from its own native tiles."""
    nw, ne, sw, se = (case >> 3) & 1, (case >> 2) & 1, (case >> 1) & 1, case & 1
    grid = np.array([[nw, ne], [sw, se]])
    g = np.rot90(grid, rot)
    (nw2, ne2), (sw2, se2) = g
    return (int(nw2) << 3) | (int(ne2) << 2) | (int(sw2) << 1) | int(se2)


def build_coast_map(arr, rows, cols, shore=None):
    """Land-vs-water corner dual-grid (the shore). case = corner bits (1 where corner is WATER; land
    corner => the shallowest level shows) -> LIST of [frame, rot] options. Multi-option across the
    sheet's repeated coast blocks AND across rotation (`rotate_corner_case`): a tile also contributes to
    whichever OTHER case its pixels satisfy once rotated, not just its own native (rot=0) case — more
    variety than only ever drawing the one tile that's natively that shape. NOTE: coast art can be
    directional (grass tufts hang down, light from the top in some pieces) — this shares tiles across
    ANY rotation that produces a valid case regardless, so a rotated placement may show tufts hanging
    sideways/upward; that's a real trade of lighting consistency for less repetition, not an oversight."""
    cmap = {}
    for r in range(*rows):
        for c in range(*cols):
            f = r * COLS + c
            t = frame_tile_arr(arr, f)
            if (t[:, :, 3] > 128).mean() < 0.5:
                continue
            nw, ne = is_water_block(t[0:6, 0:6]), is_water_block(t[0:6, 10:16])
            sw, se = is_water_block(t[10:16, 0:6]), is_water_block(t[10:16, 10:16])
            case = (nw << 3) | (ne << 2) | (sw << 1) | se
            if 0 < case < 15:  # 0 = all land (only grass shows), 15 = all water (a fill's job)
                for rot in range(4):
                    rcase = rotate_corner_case(case, rot)
                    opt = [f, rot]
                    if opt not in cmap.setdefault(rcase, []):
                        cmap[rcase].append(opt)
    return cmap if shore is None else filter_coast_by_shore(arr, cmap, shore)


# Which corner bits (order NW NE SW SE, `1` = water) sit either end of each border of a coast tile — so
# a border with BOTH corners on land is a LAND-FACING border, the one that has to butt the shore
# terrain's plain fill. A border with one water corner is a mixed edge: it meets another coast/water
# tile, not the shore, so it's none of the shore filter's business.
_SIDE_CORNERS = {"N": (0, 1), "S": (2, 3), "W": (0, 2), "E": (1, 3)}
_OPP_SIDE = {"N": "S", "S": "N", "W": "E", "E": "W"}


def _neighbour_cases(case, side):
    """Every corner case a neighbour on `side` could legally have, given the two corner values the two
    tiles SHARE along that border (dual grid: adjacent tiles agree on the two cells between them).
    Includes case 0 (all land) and 15 (all water), which are painted by fills rather than the case map."""
    nw, ne, sw, se = (case >> 3) & 1, (case >> 2) & 1, (case >> 1) & 1, case & 1
    need = {  # (neighbour corner index, required value) pairs; corners indexed NW=3, NE=2, SW=1, SE=0
        "W": ((2, nw), (0, sw)),  # our NW/SW are the west neighbour's NE/SE
        "E": ((3, ne), (1, se)),
        "N": ((1, nw), (0, ne)),  # our NW/NE are the north neighbour's SW/SE
        "S": ((3, sw), (2, se)),
    }[side]
    return [d for d in range(16) if all(((d >> bit) & 1) == val for bit, val in need)]


def prune_coast_arcs(arr, cmap, fills, rounds=8):
    """Prune coast options until every option can be CONTINUED — arc consistency over the 1px-border
    test. Returns `(pruned_map, dropped_count)`.

    Why this is needed on top of `filter_coast_by_shore`: that one only checks the borders facing the
    shore terrain. A coast tile's MIXED borders (one land corner, one water corner) meet another coast
    tile, and this sheet's coast is an organic island set, not a modular Wang set — the tiles were drawn
    as whole islands, so two shape-correct neighbours can have borders that simply don't continue each
    other. Placement then hits a cell where NO option fits (the `forced`/`no-fit` counters), and a forced
    placement is a hard edge. So drop, iteratively, every option that has some border no legal neighbour
    can answer: for each side, work out which cases could sit there (`_neighbour_cases`, including the
    all-land/all-water fills via `fills`) and require at least one still-surviving option of one of them
    to fit. Repeat to a fixpoint — dropping an option can strand the option that depended on it.

    Arc consistency doesn't PROVE a greedy raster placement can never dead-end (that would need
    backtracking or a full constraint solve), but it removes the dead ends this art actually produces —
    measure the difference in the biome test maps' `no-fit` and `hard edges` counters, don't assume it."""
    opts = {c: [tuple(o) for o in v] for c, v in cmap.items()}
    borders = {}

    def bset(case, opt):
        if (case, opt) not in borders:
            borders[(case, opt)] = edge_compat.borders(frame_arr(arr, opt[0], opt[1]))
        return borders[(case, opt)]

    opp = {"W": "E", "E": "W", "N": "S", "S": "N"}
    dropped, frozen = 0, set()
    for _ in range(rounds):
        removed = 0
        for case in list(opts):
            if case in frozen:  # a case whose options ALL failed keeps them (see below) — don't re-test
                continue        # it every round, or the loop never reaches a fixpoint
            keep = []
            for opt in opts[case]:
                ok = True
                for side in ("W", "E", "N", "S"):
                    mine = bset(case, opt)[side]
                    found = False
                    for d in _neighbour_cases(case, side):
                        if d in fills:  # all-land / all-water: a flat fill tile, not a case option
                            theirs = [edge_compat.borders(fills[d])[opp[side]]]
                        else:
                            theirs = [bset(d, o)[opp[side]] for o in opts.get(d, [])]
                        if any(edge_compat.diff_frac(mine, t) <= edge_compat.FIT_TH for t in theirs):
                            found = True
                            break
                    if not found:
                        ok = False
                        break
                if ok:
                    keep.append(opt)
            if keep:  # never empty a case: an unfillable case would fall back to a raw fill, which is a
                removed += len(opts[case]) - len(keep)  # guaranteed hard edge — worse than an imperfect
                opts[case] = keep                       # option, so keep what there is and freeze it
            else:
                frozen.add(case)
        dropped += removed
        if not removed:
            break
    return {c: [list(o) for o in v] for c, v in opts.items()}, dropped


def filter_coast_by_shore(arr, cmap, shore):
    """Drop coast options whose LAND-FACING borders don't actually fit the shore terrain's fill, using
    the pairwise 1px test (`edge_compat`). `shore` is the shore terrain's base tile as an array.

    This is the coast-side counterpart of the scatter pools' compatibility groups, and it exists because
    the rotate-and-pool variety pass (`rotate_corner_case`) can hand a case a tile whose land edge only
    reads as plain shore in its ORIGINAL orientation: this coast art is directional (the sand/dirt band
    is thicker on the south face, grass tufts hang down), so a rotated option can put the dirt band
    against what should be an unbroken grass border. Rendered, that's a hard cut running along the
    inland side of the shore — which is precisely what the biome test maps' seam audit reported before
    this filter existed (52 hard edges along the marsh preset's shorelines, none of them visible as a
    "tiling" bug: every corner case still resolved to a real frame)."""
    shore_borders = edge_compat.borders(shore)
    out = {}
    for case, opts in cmap.items():
        keep = []
        for f, rot in opts:
            tb = edge_compat.borders(frame_arr(arr, f, rot))
            ok = True
            for side, (ca, cb) in _SIDE_CORNERS.items():
                land = not (case >> (3 - ca)) & 1 and not (case >> (3 - cb)) & 1
                if land and edge_compat.diff_frac(tb[side], shore_borders[_OPP_SIDE[side]]) > edge_compat.FIT_TH:
                    ok = False
                    break
            if ok:
                keep.append([f, rot])
        if keep:
            out[case] = keep
    return out


def is_solid_fill(arr, f, centroids, tol=5, edge_tol=5):
    """A SOLID fill CANDIDATE (a flat level shade + optional INTERIOR decoration like a ripple/swirl):
    opaque, single shade (its 4 corners agree AND its 4 borders read as plain level shade), and its
    mean matches some level centroid. Generic (no per-colour test) so it works for any depth sheet.
    NOTE: the decorative variants live only in the surface rows (`variant_rows`); the transition-block
    rows hold bubble-EDGE pieces that must NOT be scattered as solids (their edge feature would drop a
    stray line into flat fill). The BORDER check is what catches the rest of that same failure mode
    within variant_rows itself: a ripple/swirl whose decoration reaches a border (or a rotation that
    puts it there) has agreeing CORNERS (the corners never touch it) but a border pixel far from the
    level's shade — scattered next to a plain neighbour, that border shows as a hard seam where the
    decoration is cut off instead of staying interior.

    `tol`/`edge_tol` at 5 are deliberately tight — tight enough that the sheet's flattest-LOOKING tile
    (lowest internal stddev) usually fails it, because that tile still isn't perfectly self-tileable (a
    few of its own border pixels differ from their opposite-edge counterpart by ~6/255 — see
    docs/BIOMES.md gotchas). What passes at 5 is instead whichever tile is genuinely self-seamless
    (0/255 self-diff), which on Pixel Crawler water turns out to be one of the more decorated (ring)
    tiles, not the plain-looking one. That's fine — this function only decides what's ELIGIBLE to
    scatter as a variant; a level that wants its default background to look plain, not decorated, should
    set `fillAuthored` (see `build_depth_set`) rather than loosening this tolerance, because loosening it
    just re-admits tiles whose decoration touches a border (the original bug)."""
    if not opaque_fill(arr, f):
        return False
    cs = corner_shades(arr, f)
    if max(np.linalg.norm(a - b) for a in cs for b in cs) >= 8:  # corners must AGREE (adjacent levels
        return False                                             # sit ~14 apart, so >=8 catches a band)
    centroid = min(centroids, key=lambda c: np.linalg.norm(tile_mean_rgb(arr, f) - c))
    if np.linalg.norm(tile_mean_rgb(arr, f) - centroid) >= tol:
        return False
    edges = edge_lines(frame_arr(arr, f))
    return max(np.linalg.norm(edges[s].astype(float) - centroid, axis=1).max() for s in edges) < edge_tol


def compat_frames(arr, frames, member, color_th=edge_compat.COLOR_TH):
    """The `frames` filter for a pool whose consumer picks a frame AND a free rotation (a depth
    level's `variants`: the JSON carries bare frame numbers and both the demo and `biomeGen/terrain.ts`
    draw them at `randrange(4)`). Since any rotation may be drawn next to any other, a frame only
    stays if ALL FOUR of its rotations sit in one compatibility group together with the level's base
    fill — anything less and the generator could pick the one rotation pair that seams.

    Returns `(kept, dropped, color_th)`. Same auto-relaxed floor as `compat_pool`."""
    if not frames:
        return [], [], color_th
    member = member if member in frames else frames[0]
    placements = [(f, rot) for f in frames for rot in range(4)]
    tiles = [frame_arr(arr, f, rot) for f, rot in placements]
    th = color_th
    while True:
        H, V = edge_compat.fit_matrices(tiles, th)
        adj, self_ok = edge_compat.compat_graph(H, V)
        group = set(edge_compat.group_for(adj, self_ok, placements.index((member, 0))))
        kept = [f for f in frames if all(placements.index((f, r)) in group for r in range(4))]
        if member in kept or th >= 40:
            break
        th += 2
    return kept, [f for f in frames if f not in kept], th


def build_depth_set(cfg, built=None):
    """Derive a depth tile edge set from `cfg` (see SETS + docs/BIOMES.md for the fields). `built` maps
    already-baked set id -> doc, so a `shore` set id in the config can supply the terrain fill the coast
    tiles must butt (see `filter_coast_by_shore`) — hence SETS lists the shore terrain BEFORE the depth
    set that shores onto it."""
    arr = np.asarray(sheet(cfg["sheet"])).astype(float)
    compat_diag = {}
    nlev = len(cfg["level_meta"])
    # 1) level shades: 2-means each adjacent-pair BLOCK, then average the shade of any level shared
    #    across blocks (the mid level is the dark side of block A and the bright side of block B).
    shade_acc = {i: [] for i in range(nlev)}
    block_shades = []
    for blk in cfg["blocks"]:
        bright, dark = block_centroids(arr, blk["box"])
        shade_acc[blk["bright"]].append(bright)
        shade_acc[blk["dark"]].append(dark)
        block_shades.append((bright, dark))
    centroids = [np.mean(shade_acc[i], axis=0) if shade_acc[i] else np.array(cfg["level_meta"][i]["rgb"])
                 for i in range(nlev)]
    # 2) one transition autotile per adjacent-level block
    transitions = []
    for blk, (bright, dark) in zip(cfg["blocks"], block_shades):
        cmap = build_corner_map(arr, blk["box"], bright, dark)
        transitions.append({"from": blk["bright"], "to": blk["dark"],
                            "cases": {str(k): v for k, v in sorted(cmap.items())}})
    # 3) coast (land <-> the shallowest level), with its options filtered to those that actually fit the
    #    shore terrain's fill (`filter_coast_by_shore`)
    shore_tile = None
    shore_id = cfg.get("shore")
    if shore_id:
        shore_doc = (built or {}).get(shore_id)
        if shore_doc is None:
            raise SystemExit(f"{cfg['id']}: shore set '{shore_id}' must be baked before it in SETS")
        shore_arr = np.asarray(sheet(shore_doc["sheet"])).astype(float)
        shore_tile = frame_arr(shore_arr, shore_doc["surfaces"][0]["base"])
    coast_all = build_coast_map(arr, cfg["coast_rows"], cfg["coast_cols"])
    coast = build_coast_map(arr, cfg["coast_rows"], cfg["coast_cols"], shore_tile)
    coast_pruned = 0
    if shore_tile is not None:
        # the two "cases" the case map never holds, needed as arc-consistency neighbours: all-land is the
        # shore terrain's fill, all-water is the shallowest level's flat fill (what fill_img draws).
        shallow_rgb = tuple(int(x) for x in centroids[0])
        fills = {0: shore_tile,
                 15: np.dstack([np.full((TILE, TILE), c, float) for c in shallow_rgb]
                               + [np.full((TILE, TILE), 255.0)])}
        coast, coast_pruned = prune_coast_arcs(arr, coast, fills)
    # 4) per-level fills. The BASE fill is the flattest solid tile of the level's shade found ANYWHERE
    #    (mid's plain fill sits in a transition block, not the surface rows). DECORATIVE variants
    #    (ripple/swirl) are collected ONLY from `variant_rows` — the transition rows hold bubble-EDGE
    #    pieces, wrong to scatter as solids. A level's `variants` = its base fill + its surface decorations.
    def level_of(f):
        return int(np.argmin([np.linalg.norm(tile_mean_rgb(arr, f) - c) for c in centroids]))
    n_rows = np.asarray(sheet(cfg["sheet"])).shape[0] // TILE
    all_solids = [r * COLS + c for r in range(n_rows) for c in range(COLS)
                  if is_solid_fill(arr, r * COLS + c, centroids)]
    decor = {i: [] for i in range(nlev)}
    for r in range(*cfg["variant_rows"]):
        for c in range(COLS):
            f = r * COLS + c
            if is_solid_fill(arr, f, centroids):
                decor[level_of(f)].append(f)
    # 5) assemble levels (a level may be `authored` = a flat synthesized tile of its shade, for a depth
    #    with no distinct fill tile in the sheet — e.g. the deepest water)
    levels = []
    for i, meta in enumerate(cfg["level_meta"]):
        rgb = [int(x) for x in centroids[i]]
        if meta.get("authored"):
            levels.append({"name": meta["name"], "walkable": meta["walkable"], "rgb": rgb, "authored": True, "variants": []})
            continue
        cand = [f for f in all_solids if level_of(f) == i]
        base = min(cand, key=lambda f: tile_stats(arr, f)[1]) if cand else None
        vs = ([base] if base is not None else []) + [f for f in decor[i] if f != base]
        vs, dropped_vs, vs_th = compat_frames(arr, vs, base)  # 1px-edge filter, see compat_frames
        compat_diag[meta["name"]] = {"dropped": dropped_vs, "colorTh": vs_th}
        if meta.get("fillAuthored"):
            # the DEFAULT background is a pure synthesized flat tile of the level's shade (same idea as
            # a whole `authored` level, just for the fill only) — its decorative candidates (ripple/ring,
            # including whatever frame would otherwise have been `fill`) stay in `variants` as occasional
            # scattered accents instead of being the everyday background.
            levels.append({"name": meta["name"], "walkable": meta["walkable"], "rgb": rgb,
                           "fill": None, "fillAuthored": True, "variants": vs})
        else:
            levels.append({"name": meta["name"], "walkable": meta["walkable"], "rgb": rgb,
                           "fill": base, "variants": vs})
    doc = {
        "id": cfg["id"], "name": cfg["name"], "pack": PACK_ID, "sheet": cfg["sheet"], "cols": COLS,
        "method": "depth",
        "levels": levels,
        "coast": {"cases": {str(k): v for k, v in sorted(coast.items())}},
        "transitions": transitions,
        "generate": cfg["generate"],
    }
    diag = {"levels": {meta["name"]: len(lv.get("variants", [])) for meta, lv in zip(cfg["level_meta"], levels)},
            "compat": compat_diag,
            "coastShore": (shore_id, sum(len(v) for v in coast.values()),
                           sum(len(v) for v in coast_all.values()), coast_pruned),
            "missing": {f"{t['from']}->{t['to']}": [x for x in range(1, 15) if x not in (6, 9) and str(x) not in t["cases"]]
                        for t in transitions}}
    return doc, diag


# ----- config ---------------------------------------------------------------
# blob (grass): `accent_tol` = max RGB dE an accent's mean may sit from the base before it's dropped as
# a shade outlier (grass has a dark + bright green variant ~14 apart; 8 keeps one shade). `prefer` picks
# the bright cluster so the ground matches the grass baked into the water coast tiles (no shore halo).
#
# depth (water): `blocks` = the adjacent-level transition autotiles as (box=(c0,c1,r0,r1), bright/dark
# level indices). `variant_rows` = the sheet rows holding SOLID surface-decoration fills (NOT the
# transition rows). `level_meta` orders the levels shallow->deep (walkable flag; `authored` = synthesize
# a flat tile of the level's shade, for a depth with no fill tile in the art). `generate` params drive
# the demo/runtime lake generator. Full field-by-field recipe + how to onboard a new sheet: docs/BIOMES.md.
SETS = [
    {"kind": "blob", "id": "grass", "name": "Grass", "sheet": FLOORS, "box": (0, 4, 0, 12),
     "role": "ground", "walkable": True, "accent_tol": 8, "prefer": "bright"},
    {"kind": "blob", "id": "mud", "name": "Mud", "sheet": FLOORS, "box": (11, 15, 0, 12),
     "role": "ground", "walkable": True, "accent_tol": 8},
    {"kind": "depth", "id": "water", "name": "Water", "sheet": WATER,
     "shore": "grass",                                      # the terrain its coast tiles may butt
     "coast_rows": (0, 5), "coast_cols": (0, 25),
     "blocks": [
         {"box": (0, 5, 5, 15), "bright": 0, "dark": 1},   # cols 0-4 rows 5-14: shallow(L) <-> mid(M)
         {"box": (5, 10, 5, 15), "bright": 1, "dark": 2},  # cols 5-9 rows 5-14: mid(M) <-> deep(D)
     ],
     "variant_rows": (0, 2),                                # surface decorations (ripple/swirl) live in rows 0-1
     "level_meta": [
         {"name": "shallow", "walkable": True, "fillAuthored": True},
         {"name": "mid", "walkable": False},
         {"name": "deep", "walkable": False, "authored": True},
     ],
     "generate": {"bands": [2.5, 8.5], "noise": {"amp": 3.0, "scale": 4, "seed": 5},
                  "scatterRate": 0.35, "distance": "bfs"}},
]


# ----- depth generator (reference implementation: powers the demo + is the acceptance guard) -----
def value_noise(H, W, seed, scale, amp):
    """Smooth value noise in ~[-amp, amp]: a coarse random grid, bilinearly upsampled."""
    rr = np.random.default_rng(seed)
    g = rr.uniform(-1, 1, (H // scale + 2, W // scale + 2))
    out = np.zeros((H, W))
    for y in range(H):
        for x in range(W):
            gy, gx = y / scale, x / scale
            y0, x0, fy, fx = int(gy), int(gx), gy - int(gy), gx - int(gx)
            out[y, x] = ((g[y0, x0]*(1-fx) + g[y0, x0+1]*fx)*(1-fy)
                         + (g[y0+1, x0]*(1-fx) + g[y0+1, x0+1]*fx)*fy)
    return out * amp


def depth_field(water, W, H, gen):
    """Per-cell depth LEVEL for a water body. distance-from-shore (BFS) + smooth noise (mostly distance,
    noise wobbles the bands), quantised by `bands`, then REPAIRED to be tileable: erode until every
    king-adjacent pair differs by <=1 level (=> every 2x2 spans <=1, so a transition tile always exists),
    and lower any saddle 2x2. Both passes only LOWER cells (bounded at 0) so the loop always terminates."""
    d = [[10**9] * W for _ in range(H)]
    dq = deque()
    for y in range(H):
        for x in range(W):
            if not water[y][x]:
                d[y][x] = 0
                dq.append((x, y))
    while dq:
        x, y = dq.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and d[ny][nx] > d[y][x] + 1:
                d[ny][nx] = d[y][x] + 1
                dq.append((nx, ny))
    noise = value_noise(H, W, gen["noise"]["seed"], gen["noise"]["scale"], gen["noise"]["amp"])
    bands = gen["bands"]
    lv = [[-1] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if water[y][x]:
                lv[y][x] = sum(1 for b in bands if d[y][x] + noise[y, x] >= b)  # 0..len(bands)
    kings = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy]

    def neigh(x, y):
        for dx, dy in kings:
            if 0 <= x + dx < W and 0 <= y + dy < H and water[y + dy][x + dx]:
                yield x + dx, y + dy

    for _ in range(80):
        changed = False
        for y in range(H):
            for x in range(W):
                if not water[y][x]:
                    continue
                for nx, ny in neigh(x, y):
                    if lv[y][x] - lv[ny][nx] > 1:
                        lv[y][x] = lv[ny][nx] + 1
                        changed = True
        saddles = 0
        for y in range(H - 1):
            for x in range(W - 1):
                p = [(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)]  # NW NE SW SE
                if not all(water[cy][cx] for cx, cy in p):
                    continue
                vals = [lv[cy][cx] for cx, cy in p]
                lo, hi = min(vals), max(vals)
                if hi - lo == 1 and {i for i, v in enumerate(vals) if v == hi} in ({0, 3}, {1, 2}):
                    for i in (i for i, v in enumerate(vals) if v == hi):
                        cx, cy = p[i]
                        lv[cy][cx] = lo
                    saddles += 1
        if not changed and saddles == 0:
            break
    return lv


def paint_blob_field(cv, blob_doc, rng, w, h, ox=0, oy=0, scatter=0.25):
    """Fill a w x h tile rectangle (at canvas offset ox, oy) with this blob set's plain biome: its
    SEAMLESS base tile (see `seamless_base_tile`) at rot=0 so adjacent cells are bit-identical, with an
    occasional (`scatter` chance) accent variant (open rotation) dropped in for texture — the blob
    equivalent of a depth level's `fill_img` (plain default + scattered decor), used both as a lake
    demo's grass backdrop and as a two-layer patch demo's full background layer."""
    im = sheet(blob_doc["sheet"])
    surf = blob_doc["surfaces"][0]
    base_img = seamless_base_tile(blob_doc)
    for y in range(h):
        for x in range(w):
            img = base_img
            if rng.random() < scatter and surf["variants"]:
                f, r = tuple(rng.choice(surf["variants"]))
                img = frame_tile(im, f, r)
            cv.alpha_composite(img, ((ox + x) * TILE, (oy + y) * TILE))


def disc_mask(w, h, rx_frac=0.32, ry_frac=0.32, hole=False):
    """A smoothed disc mask sized to w x h tiles. `hole=False`: True only inside the disc (a small
    PATCH). `hole=True`: True everywhere EXCEPT the disc (a small HOLE in an otherwise-full mask) — the
    disc is built and smoothed the same way either way, then complemented, so the hole's edge reads as
    the same clean organic curve as a patch's edge, just inside-out."""
    base = new_mask(w, h, False)
    disc(base, w / 2, h / 2, w * rx_frac, h * ry_frac)
    base = smooth_mask(base, 2)
    if hole:
        return [[not base[y][x] for x in range(w)] for y in range(h)]
    return base


def paint_blob_masked(cv, blob_doc, rng, mask, ox=0, oy=0, scatter=0.3):
    """Composite `blob_doc`'s OWN alpha-cutout blob tiles onto `cv` wherever `mask` is True, autotiled
    per-cell via the 8-neighbour `blob_key` read from `mask` itself + the set's baked `mapping` (a LIST
    of [frame, rot] options per case, randomly chosen — see `rotate_blob_key`). Wherever `mask` is
    False, nothing is drawn — whatever `cv`
    already carries there (the OTHER terrain's full opaque fill, painted first) just shows straight
    through, and at the mask's boundary this set's own semi-transparent edge tiles blend into it. Put
    the full, opaque background down first, always — this only ever adds a layer on top of it, never
    the reverse. Fully-surrounded interior cells use the SEAMLESS base tile (`seamless_base_tile`) with
    an occasional scattered accent for texture, mirroring `fill_img`'s scatterRate idea for a blob set."""
    h_t = len(mask)
    w_t = len(mask[0]) if h_t else 0
    im = sheet(blob_doc["sheet"])
    mapping = {int(k): v for k, v in blob_doc["mapping"].items()}
    surf = blob_doc["surfaces"][0]
    full_key = key_tuple_to_int(FULL)
    cardinal_mask = N | E | S | W
    base_img = seamless_base_tile(blob_doc)
    forced = 0

    def options_for(key):
        """`src/systems/autotile.ts`'s `pickFrame` rule: exact key, else the lowest-keyed entry sharing
        the same CARDINALS (diagonals ignored), else the FULL fill. The middle step matters — the sheet
        only yields ~17 distinct keys, so most of the 256 possible neighbourhoods are unmapped, and
        dropping straight to FULL draws a plain interior tile where a boundary belongs: a dead-straight
        terrain edge with no blend at all (4 of the marsh preset's hard edges were exactly this)."""
        if key in mapping:
            return mapping[key]
        cardinals = key & cardinal_mask
        alt = next((k for k in sorted(mapping) if (k & cardinal_mask) == cardinals), None)
        return mapping[alt] if alt is not None else mapping[full_key]

    def m(y, x):
        return 0 <= y < h_t and 0 <= x < w_t and mask[y][x]

    for y in range(h_t):
        for x in range(w_t):
            if not mask[y][x]:
                continue
            key = key_tuple_to_int(blob_key(m(y - 1, x), m(y + 1, x), m(y, x - 1), m(y, x + 1),
                                             m(y - 1, x - 1), m(y - 1, x + 1), m(y + 1, x - 1), m(y + 1, x + 1)))
            if key == full_key:
                img = base_img
                if rng.random() < scatter and surf["variants"]:
                    f, r = tuple(rng.choice(surf["variants"]))
                    img = frame_tile(im, f, r)
            else:
                # EDGE-MATCHED choice among the case's options: shape-correct isn't enough, the picked
                # option also has to seam against the neighbours already placed (see pick_placement).
                opts = options_for(key)
                cands = [frame_tile(im, f, r) for f, r in opts]
                i, _score, forced_here = edge_compat.pick_placement(cv, ox + x, oy + y, cands, rng)
                img = cands[i]
                forced += forced_here
            cv.alpha_composite(img, ((ox + x) * TILE, (oy + y) * TILE))
    return forced


def render_grass_mud_demo(root, grass_doc, mud_doc, out_name, hole, W=20, H=16, seed=7):
    """Two-LAYER demo matching how the hand-authored map actually does it: mud is the full, opaque
    BOTTOM layer everywhere (its seamless base tile — mud never gets its own edge/corner art in this
    technique, no `mapping` lookup at all), and grass's OWN alpha-cutout blob tiles are the layer on
    top, painted only where `mask` says grass — mud shows through directly wherever grass is absent AND
    through grass's semi-transparent edge pixels at the boundary. `hole=True`: grass covers ~everywhere
    except a small disc, so the disc reads as a mud patch (a hole in the grass coverage) — the actual
    hand-authored technique. `hole=False`: grass covers only a small disc, so the disc reads as a grass
    patch in an otherwise-mud field — the mirror case, same mechanism, mask inverted."""
    rng = random.Random(seed)
    # Render PAD tiles larger on every side, then crop it off: a finite canvas has no "beyond the edge"
    # neighbour, so blob_key reads the canvas border itself as a coastline (grass coasting out into
    # nothing) — a real seam in the demo image, but not in-game, where the biome just continues past the
    # viewport. Padding renders that artifact OUTSIDE the visible crop instead of pretending it away.
    PAD = 3
    PW, PH = W + 2 * PAD, H + 2 * PAD
    cv = Image.new("RGBA", (PW * TILE, PH * TILE))
    mud_base = seamless_base_tile(mud_doc)
    for y in range(PH):
        for x in range(PW):
            cv.alpha_composite(mud_base, (x * TILE, y * TILE))
    rx_frac = 0.22 if hole else 0.32
    mask = disc_mask(PW, PH, rx_frac * W / PW, rx_frac * H / PH, hole=hole)
    paint_blob_masked(cv, grass_doc, rng, mask)
    # crop the padding off at 1x, THEN audit + upscale: the seam audit must see real tile pixels at
    # their real size (and must not see the padded border's fake coastline — see PAD above).
    cv = cv.crop((PAD * TILE, PAD * TILE, (PAD + W) * TILE, (PAD + H) * TILE))
    hard, worst, seams, _ = edge_compat.audit_canvas(cv)
    out = os.path.join(root, "scripts", "pixel-crawler", out_name)
    cv.resize((W * TILE * 4, H * TILE * 4), Image.NEAREST).save(out)
    return out, hard, worst, seams


def paint_depth_water(cv, depth_doc, water, rng, ox=0, oy=0, forced_log=None):
    """Paint a depth set's water body over `cv` from a boolean `water[y][x]` mask: coast at the shore,
    dual-grid corner transitions between adjacent depth levels, scattered fill variants inside a level,
    and the authored solid for a level with no art. Returns the `invalid` count — vertices whose 4
    corner levels have no tile — which MUST be 0 (the depth field's repair guarantees it); a non-zero
    count is a repair or coverage bug, and it's the acceptance guard for every render that uses this.

    Extracted from `render_depth_lake` so the biome test renders (`gen_biome_tests.py`) place ponds
    with the SAME code path the baker's own guard exercises — a second implementation of this loop
    would be a second thing to keep correct. Note the (W+1) x (H+1) vertex sweep: dual-grid tiles sit
    over grid VERTICES, so a body's tiles overhang its mask by one cell on the right/bottom."""
    wim = sheet(depth_doc["sheet"])
    gen, levels = depth_doc["generate"], depth_doc["levels"]
    H, W = len(water), len(water[0])
    lv = depth_field(water, W, H, gen)
    coast = {int(k): v for k, v in depth_doc["coast"]["cases"].items()}
    trans = {(t["from"], t["to"]): {int(k): v for k, v in t["cases"].items()} for t in depth_doc["transitions"]}
    solid = {i: Image.new("RGBA", (TILE, TILE), tuple(levels[i]["rgb"]) + (255,)) for i in range(len(levels))}

    def fill_img(i):
        meta = levels[i]
        if meta.get("authored"):
            return solid[i]
        pool = meta["variants"] or ([meta["fill"]] if meta.get("fill") is not None else [])
        if rng.random() > gen["scatterRate"] or not pool:
            return solid[i] if meta.get("fillAuthored") else frame_tile(wim, meta["fill"], rng.randrange(4))
        f = rng.choice(pool)
        return frame_tile(wim, f, rng.randrange(4))

    def lvl(x, y):
        return lv[y][x] if (0 <= x < W and 0 <= y < H and water[y][x]) else -1

    forced = [0]

    def drawn(vx, vy):
        """Does this pass paint a tile at vertex (vx, vy)? True iff any of its 4 corner cells is water —
        the same test the placement loop below uses. Tells `matched` which neighbours are already FINAL
        (painted by an earlier layer, e.g. the shore's grass tiles) versus about to be overwritten."""
        return any(lvl(vx + dx - 1, vy + dy - 1) != -1 for dy in (0, 1) for dx in (0, 1))

    def matched(opts, cx, cy, vx, vy, case=None, kind=""):
        """Pick an autotile option that also SEAMS against its already-final neighbours, not just any
        shape-correct one (see edge_compat.pick_placement) — the coast/transition art varies more along
        an edge than the 16 corner cases model, so two shape-correct neighbours can still disagree.
        W/N are always final (raster order); E/S are only final where this pass won't paint them, which
        is exactly the water body's right/bottom shore against the land tiles underneath."""
        sides = ["W", "N"] + [s for s, (dx, dy) in (("E", (1, 0)), ("S", (0, 1))) if not drawn(vx + dx, vy + dy)]
        cands = [frame_tile(wim, f, r) for f, r in opts]
        i, score, was_forced = edge_compat.pick_placement(cv, cx, cy, cands, rng, sides=tuple(sides))
        forced[0] += was_forced
        if was_forced and forced_log is not None:  # diagnostics: WHICH case/sides the art can't continue
            forced_log.append({"kind": kind, "case": case, "sides": tuple(sides),
                               "options": len(opts), "score": round(score, 2), "cell": (cx, cy)})
        return cands[i]

    invalid = 0
    for y in range(H + 1):
        for x in range(W + 1):
            cs = [lvl(x - 1, y - 1), lvl(x, y - 1), lvl(x - 1, y), lvl(x, y)]  # NW NE SW SE cells
            if all(c == -1 for c in cs):
                continue
            if any(c == -1 for c in cs):                       # shore: land-vs-water coast autotile
                case = sum((1 if cs[i] != -1 else 0) << b for i, b in enumerate((3, 2, 1, 0)))
                opts = coast.get(case)
                img = matched(opts, ox + x, oy + y, x, y, case, "coast") if opts else fill_img(0)
            else:
                lo, hi = min(cs), max(cs)
                if lo == hi:                                   # single level -> solid fill (scatter)
                    img = fill_img(lo)
                elif hi - lo == 1:                             # adjacent-level transition autotile
                    case = sum((1 if cs[i] == lo else 0) << b for i, b in enumerate((3, 2, 1, 0)))
                    opts = trans.get((lo, hi), {}).get(case)
                    if opts:
                        img = matched(opts, ox + x, oy + y, x, y, case, f"trans{lo}{hi}")
                    else:
                        img, invalid = fill_img(hi), invalid + 1
                else:                                          # spans 2 levels (repair should prevent)
                    img, invalid = fill_img(hi), invalid + 1
            cv.alpha_composite(img, ((ox + x) * TILE, (oy + y) * TILE))
    return invalid, forced[0]


def render_depth_lake(root, grass_doc, depth_doc):
    """Bake one organic lake: grass surround -> coast -> concentric-ish L/M/D depth (distance+noise),
    autotiled by the corner maps with per-case random tile+rotation, per-level fill-variant scatter, and
    the authored solid deep centre. `invalid` MUST be 0 (every 2x2 tileable) — that's the guard."""
    gen = depth_doc["generate"]
    rng = random.Random(gen["noise"]["seed"])
    W, H = 30, 22
    mask = new_mask(W, H)
    disc(mask, 15, 11, 6, 5)
    disc(mask, 23, 6, 2, 1.5)
    mask = smooth_mask(mask, 2)
    water = [[bool(mask[y][x]) for x in range(W)] for y in range(H)]
    cv = Image.new("RGBA", (W * TILE, H * TILE))
    paint_blob_field(cv, grass_doc, rng, W, H, scatter=0.25)
    invalid, forced = paint_depth_water(cv, depth_doc, water, rng)
    hard, worst, seams, _ = edge_compat.audit_canvas(cv)
    out = os.path.join(root, "scripts", "pixel-crawler", "bake_edge_set_demo.png")
    cv.resize((W * TILE * 4, H * TILE * 4), Image.NEAREST).save(out)
    return out, invalid, forced, hard, worst, seams


def write_fill_asset(rgb, out_dir, out_name):
    """Synthesize a flat, opaque `rgb` 16x16 PNG and save it as `out_dir/out_name` — the REAL,
    game-usable tile an `authored`/`fillAuthored` depth level's default background points at
    (`TileSource{kind:'image'}`). The offline demo (`render_depth_lake`) only ever needed pixels for
    a preview PNG (a synthesized `Image.new` rectangle, never committed); the actual game bakes frame
    references into `TileLayer.cells`, so a level with no real sheet fill needs a real asset file to
    reference, not just an `rgb` triple — this is that asset."""
    Image.new("RGBA", (TILE, TILE), tuple(rgb) + (255,)).save(os.path.join(out_dir, out_name))


def main():
    root = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
    out_dir = os.path.join(root, "public", "assets", "tilesets", PACK_ID, "edge-sets")
    os.makedirs(out_dir, exist_ok=True)
    built = {}
    for cfg in SETS:
        doc, diag = build_blob_set(cfg) if cfg["kind"] == "blob" else build_depth_set(cfg, built)
        if doc["method"] == "depth":
            for lv in doc["levels"]:
                if lv.get("authored") or lv.get("fillAuthored"):
                    asset_name = f"{doc['id']}-{lv['name']}-fill.png"
                    write_fill_asset(lv["rgb"], out_dir, asset_name)
                    lv["fillAsset"] = asset_name
        doc["_comment"] = (
            "GENERATED by scripts/pixel-crawler/bake_edge_set.py (plan 052) — do not hand-edit; re-run "
            "the baker. Tile edge set: member tiles + which edges/corners join + walkability + variants. "
            "Onboarding pipeline for a new sheet: docs/BIOMES.md."
        )
        path = os.path.join(out_dir, f"{cfg['id']}.json")
        with open(path, "w") as fh:
            json.dump(doc, fh, indent=2)
            fh.write("\n")
        built[cfg["id"]] = doc
        rel = os.path.relpath(path, root)
        if doc["method"] == "blob":
            s = doc["surfaces"][0]
            cp = s["_compat"]
            print(f"wrote {rel}: blob {s['role']} base={s['base']} {len(s['accents'])}acc "
                  f"{diag['optionsDropped']}opt-dropped "
                  f"{len(s['variants'])}compat-rot of {cp['placements']} "
                  f"(colorTh={cp['colorTh']}, {len(s['groups'])} groups {cp['groups'][:6]})")
        else:
            def fill_desc(lv):
                if lv.get("authored"):
                    return "authored"
                if lv.get("fillAuthored"):
                    return "fillAuthored"
                return f"fill={lv.get('fill')}"
            lvls = " ".join(
                f"{lv['name']}({fill_desc(lv)},"
                f"{len(lv['variants'])}var,{'walk' if lv['walkable'] else 'solid'})" for lv in doc["levels"])
            miss = "; ".join(f"{k} miss={v}" for k, v in diag["missing"].items() if v) or "all cases covered"
            sid, kept, total, pruned = diag["coastShore"]
            shore_note = (f", {kept}/{total} options fit shore '{sid}' (arc-prune dropped {pruned})"
                          if sid else "")
            print(f"wrote {rel}: depth [{lvls}] | coast {len(doc['coast']['cases'])} cases{shore_note} "
                  f"| transitions {miss}")
            drops = "; ".join(f"{k} dropped={v['dropped']}@{v['colorTh']}"
                              for k, v in diag["compat"].items() if v["dropped"])
            if drops:
                print(f"  1px-edge filter: {drops}")

    def seam_line(hard, worst, seams):
        return (f"hard edges = {hard}/{seams}, worst seam = {worst:.2f}"
                f"{'  <-- FAIL' if hard else ''}")

    demo, invalid, forced, hard, worst, seams = render_depth_lake(root, built["grass"], built["water"])
    print(f"wrote {os.path.relpath(demo, root)}  (invalid tiles = {invalid}, forced = {forced}"
          f"{'  <-- FAIL' if invalid else ''}; {seam_line(hard, worst, seams)})")
    if "mud" in built:
        for name, hole in (("bake_edge_set_demo_mud_patch.png", True),
                           ("bake_edge_set_demo_grass_patch.png", False)):
            d, hard, worst, seams = render_grass_mud_demo(root, built["grass"], built["mud"], name, hole=hole)
            print(f"wrote {os.path.relpath(d, root)}  ({seam_line(hard, worst, seams)})")


if __name__ == "__main__":
    main()
