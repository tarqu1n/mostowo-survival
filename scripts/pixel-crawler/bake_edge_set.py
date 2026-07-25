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
    shade (the shade the transitions actually lead to, so it seams).

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
from autotile import build_blob, disc, new_mask, smooth_mask, FULL  # noqa: E402
from compose import sheet, TILE  # noqa: E402

PACK_ID = "pixel-crawler"
FLOORS = "Environment/Tilesets/Floors_Tiles.png"
WATER = "Environment/Tilesets/Water_tiles.png"
COLS = 25  # both sheets are 25 tiles wide; frame = row*COLS + col
EDGE_TH = 12    # max per-pixel RGB dist between two 1px borders for them to be the SAME edge class
                # (the seam knob: tiles only sit adjacent if their touching edges share a class)


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


def edge_contiguity(arr, base, frames, edge_th):
    """Map every (tile, rotation)'s four borders to EDGE CLASSES so contiguity is 'equal class ==
    joins seamlessly'. Classes are greedy-clustered by max per-pixel RGB distance <= edge_th, seeded
    from the base's own border so class 0 is the plain-water 'open' edge. Returns:
      - variants: [[frame, rot], ...] — the OPEN placements (all 4 borders class 0). Any two are
        mutually adjacent-safe in any rotation, so scattering these (rotations included) can never
        make a border shade-step — the fix for the whole-tile-shade seams a 1px test alone misses.
      - edged:    [[frame, rot, [n,e,s,w]], ...] — placements with a non-open border (a shade/foam
        edge), carrying their per-side classes for a future edge-MATCHED (Wang) generator.
      - classes:  total distinct edge classes seen.
    Rotations use np.rot90(k) so N/E/S/W are recomputed from the rotated tile — no manual permutation.
    """
    reps = [edge_lines(frame_arr(arr, base))["N"]]  # class 0 = base's plain border

    def classify(line):
        for i, rep in enumerate(reps):
            if np.max(np.sqrt(((line - rep) ** 2).sum(1))) <= edge_th:
                return i
        reps.append(line)
        return len(reps) - 1

    variants, edged = [], []
    for f in frames:
        for rot in range(4):
            e = edge_lines(frame_arr(arr, f, rot))
            ids = [classify(e[s]) for s in ("N", "E", "S", "W")]
            if all(i == 0 for i in ids):
                variants.append([f, rot])
            else:
                edged.append([f, rot, ids])
    return variants, edged, len(reps)


def with_edges(arr, surface, edge_th):
    """Augment a fill surface with its rotation-aware edge-contiguity map (see edge_contiguity).

    edge_th is a FLOOR, auto-relaxed per sheet: water borders are uniform (a tight 12 cleanly
    separates the blue shade-steps), but grass borders carry blade texture that a tight threshold
    shatters — so we widen edge_th until the base itself is 'open' (its own four borders collapse to
    one class) and a healthy open set exists. Records the effective threshold in `_edgeTh`."""
    frames = [surface["base"]] + surface["accents"]
    th = edge_th
    while True:
        variants, edged, classes = edge_contiguity(arr, surface["base"], frames, th)
        base_open = any(v[0] == surface["base"] for v in variants)  # base appears in some rotation
        if (base_open and len(variants) >= max(4, len(frames))) or th >= 60:
            break
        th += 6
    if not variants:  # last-ditch: scatter the base unrotated so downstream never sees an empty pool
        variants = [[surface["base"], 0]]
    surface["rotations"] = True
    surface["variants"] = variants  # open (seam-safe) placements to scatter, [frame, rot]
    surface["edged"] = edged        # non-open placements + their edge classes, for matched placement
    surface["_edgeClasses"] = classes
    surface["_edgeTh"] = th
    return surface


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
    base, accents, dropped = pick_base_and_accents(arr, fills, cfg["accent_tol"], cfg.get("prefer"))
    surface = {"role": cfg["role"], "walkable": cfg["walkable"], "base": base, "accents": accents}
    with_edges(arr, surface, cfg["edge_th"])
    doc = {
        "id": cfg["id"], "name": cfg["name"], "pack": PACK_ID, "sheet": cfg["sheet"], "cols": COLS,
        "method": "blob",
        "mapping": {str(k): v for k, v in sorted(mapping.items())},
        "surfaces": [surface],
    }
    return doc, {"ground": dropped}


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


def build_coast_map(arr, rows, cols):
    """Land-vs-water corner dual-grid (the shore). case = corner bits (1 where corner is WATER; land
    corner => the shallowest level shows) -> LIST of [frame, 0]. Multi-option across the sheet's repeated
    coast blocks (their variants), but NOT rotated: coast art is directional (grass tufts, top-light)."""
    cmap = {}
    for r in range(*rows):
        for c in range(*cols):
            t = frame_tile_arr(arr, r * COLS + c)
            if (t[:, :, 3] > 128).mean() < 0.5:
                continue
            nw, ne = is_water_block(t[0:6, 0:6]), is_water_block(t[0:6, 10:16])
            sw, se = is_water_block(t[10:16, 0:6]), is_water_block(t[10:16, 10:16])
            case = (nw << 3) | (ne << 2) | (sw << 1) | se
            if 0 < case < 15:  # 0 = all land (only grass shows), 15 = all water (a fill's job)
                cmap.setdefault(case, []).append([r * COLS + c, 0])
    return cmap


def is_solid_fill(arr, f, centroids, tol=5, edge_tol=5):
    """A SOLID fill variant (a flat level shade + optional INTERIOR decoration like a ripple/swirl):
    opaque, single shade (its 4 corners agree AND its 4 borders read as plain level shade), and its
    mean matches some level centroid. Generic (no per-colour test) so it works for any depth sheet.
    NOTE: the decorative variants live only in the surface rows (`variant_rows`); the transition-block
    rows hold bubble-EDGE pieces that must NOT be scattered as solids (their edge feature would drop a
    stray line into flat fill). The BORDER check is what catches the rest of that same failure mode
    within variant_rows itself: a ripple/swirl whose decoration reaches a border (or a rotation that
    puts it there) has agreeing CORNERS (the corners never touch it) but a border pixel far from the
    level's shade — scattered next to a plain neighbour, that border shows as a hard seam where the
    decoration is cut off instead of staying interior. `edge_tol` mirrors the corner tolerance: on
    Pixel Crawler water, in-bounds decoration keeps every border within ~6 of the centroid while an
    edge-touching one spikes to ~16, so 8 cleanly separates the two without dropping the good variants
    (calibrated by eye against the demo — see docs/BIOMES.md gotchas)."""
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


def build_depth_set(cfg):
    """Derive a depth tile edge set from `cfg` (see SETS + docs/BIOMES.md for the fields)."""
    arr = np.asarray(sheet(cfg["sheet"])).astype(float)
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
    # 3) coast (land <-> the shallowest level)
    coast = build_coast_map(arr, cfg["coast_rows"], cfg["coast_cols"])
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
     "role": "ground", "walkable": True, "accent_tol": 8, "edge_th": EDGE_TH, "prefer": "bright"},
    {"kind": "depth", "id": "water", "name": "Water", "sheet": WATER,
     "coast_rows": (0, 5), "coast_cols": (0, 25),
     "blocks": [
         {"box": (0, 5, 5, 15), "bright": 0, "dark": 1},   # cols 0-4 rows 5-14: shallow(L) <-> mid(M)
         {"box": (5, 10, 5, 15), "bright": 1, "dark": 2},  # cols 5-9 rows 5-14: mid(M) <-> deep(D)
     ],
     "variant_rows": (0, 2),                                # surface decorations (ripple/swirl) live in rows 0-1
     "level_meta": [
         {"name": "shallow", "walkable": True},
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


def render_depth_lake(root, grass_doc, depth_doc):
    """Bake one organic lake: grass surround -> coast -> concentric-ish L/M/D depth (distance+noise),
    autotiled by the corner maps with per-case random tile+rotation, per-level fill-variant scatter, and
    the authored solid deep centre. `invalid` MUST be 0 (every 2x2 tileable) — that's the guard."""
    fim, wim = sheet(grass_doc["sheet"]), sheet(depth_doc["sheet"])
    gen, levels = depth_doc["generate"], depth_doc["levels"]
    rng = random.Random(gen["noise"]["seed"])
    W, H = 30, 22
    mask = new_mask(W, H)
    disc(mask, 15, 11, 11, 9)
    disc(mask, 23, 6, 4, 3.5)
    mask = smooth_mask(mask, 2)
    water = [[bool(mask[y][x]) for x in range(W)] for y in range(H)]
    lv = depth_field(water, W, H, gen)
    coast = {int(k): v for k, v in depth_doc["coast"]["cases"].items()}
    trans = {(t["from"], t["to"]): {int(k): v for k, v in t["cases"].items()} for t in depth_doc["transitions"]}
    solid = {i: Image.new("RGBA", (TILE, TILE), tuple(levels[i]["rgb"]) + (255,)) for i in range(len(levels))}

    def fill_img(i):
        meta = levels[i]
        if meta.get("authored"):
            return solid[i]
        pool = meta["variants"] or [meta["fill"]]
        f = meta["fill"] if rng.random() > gen["scatterRate"] else rng.choice(pool)
        return frame_tile(wim, f, rng.randrange(4))

    def lvl(x, y):
        return lv[y][x] if (0 <= x < W and 0 <= y < H and water[y][x]) else -1

    cv = Image.new("RGBA", (W * TILE, H * TILE))
    g = grass_doc["surfaces"][0]
    for y in range(H):
        for x in range(W):
            gf, gr = (g["base"], rng.randrange(4)) if rng.random() < 0.75 else tuple(rng.choice(g["variants"]))
            cv.alpha_composite(frame_tile(fim, gf, gr), (x * TILE, y * TILE))
    invalid = 0
    for y in range(H + 1):
        for x in range(W + 1):
            cs = [lvl(x - 1, y - 1), lvl(x, y - 1), lvl(x - 1, y), lvl(x, y)]  # NW NE SW SE cells
            if all(c == -1 for c in cs):
                continue
            if any(c == -1 for c in cs):                       # shore: land-vs-water coast autotile
                case = sum((1 if cs[i] != -1 else 0) << b for i, b in enumerate((3, 2, 1, 0)))
                opts = coast.get(case)
                img = frame_tile(wim, *rng.choice(opts)) if opts else fill_img(0)
            else:
                lo, hi = min(cs), max(cs)
                if lo == hi:                                   # single level -> solid fill (scatter)
                    img = fill_img(lo)
                elif hi - lo == 1:                             # adjacent-level transition autotile
                    case = sum((1 if cs[i] == lo else 0) << b for i, b in enumerate((3, 2, 1, 0)))
                    opts = trans.get((lo, hi), {}).get(case)
                    if opts:
                        img = frame_tile(wim, *rng.choice(opts))
                    else:
                        img, invalid = fill_img(hi), invalid + 1
                else:                                          # spans 2 levels (repair should prevent)
                    img, invalid = fill_img(hi), invalid + 1
            cv.alpha_composite(img, (x * TILE, y * TILE))
    out = os.path.join(root, "scripts", "pixel-crawler", "bake_edge_set_demo.png")
    cv.resize((W * TILE * 4, H * TILE * 4), Image.NEAREST).save(out)
    return out, invalid


def main():
    root = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
    out_dir = os.path.join(root, "public", "assets", "tilesets", PACK_ID, "edge-sets")
    os.makedirs(out_dir, exist_ok=True)
    built = {}
    for cfg in SETS:
        doc, diag = build_blob_set(cfg) if cfg["kind"] == "blob" else build_depth_set(cfg)
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
            print(f"wrote {rel}: blob {s['role']} base={s['base']} {len(s['accents'])}acc {len(s['variants'])}open-rot")
        else:
            lvls = " ".join(
                f"{lv['name']}({'authored' if lv.get('authored') else 'fill=' + str(lv.get('fill'))},"
                f"{len(lv['variants'])}var,{'walk' if lv['walkable'] else 'solid'})" for lv in doc["levels"])
            miss = "; ".join(f"{k} miss={v}" for k, v in diag["missing"].items() if v) or "all cases covered"
            print(f"wrote {rel}: depth [{lvls}] | coast {len(doc['coast']['cases'])} cases | transitions {miss}")
    demo, invalid = render_depth_lake(root, built["grass"], built["water"])
    print(f"wrote {os.path.relpath(demo, root)}  (invalid tiles = {invalid}{'  <-- FAIL' if invalid else ''})")


if __name__ == "__main__":
    main()
