#!/usr/bin/env python3
"""**Pixel-adjacency (Wang) edge compatibility** — the 1px-border test that decides which tiles may
sit next to which, promoted out of the `biome_lake_poc.py` spike into the shared module the baker,
the group-discovery tool and the biome test renders all use.

The primitive is one comparison: two tiles touch along a seam, so lay their **touching 1px border
lines** side by side and count how many of the 16 pixel pairs disagree. `A` may sit LEFT of `B` iff
`A`'s east column matches `B`'s west column; ABOVE `B` iff `A`'s south row matches `B`'s north row
(`borders()` orients the lines so those comparisons are index-aligned). Nothing else about the tiles
is consulted — no shade classification, no alpha keying, no hand-authored Wang IDs.

**Two thresholds, because "may these tiles be interchangeable fill?" and "is this rendered seam a
hard edge?" are different questions** (both were conflated in the spike, which only ever asked the
second one, and only as a post-hoc print):

  - **tight / GROUP rule** (`COLOR_TH=8`, `FIT_TH=0.0`): every one of the 16 pixel pairs must agree
    within a per-pixel RGBA distance of 8. This is the rule that builds **compatibility groups** — a
    group is a set of `(frame, rotation)` placements where *every* member can sit next to *every*
    member (itself included) in *either* direction, so a generator may scatter them in any
    arrangement and cannot produce a seam. 8 is deliberately tighter than the shade gap between two
    variants of the same terrain in this pack (~14 RGB): a looser value re-admits the whole-tile
    SHADE STEP that reads as a patchwork of squares even though every individual border "matched".
  - **loose / AUDIT rule** (`BREAK_COLOR_TH=40`, `BREAK_TH=0.85`): a seam counts as a **hard edge**
    only when >85% of its pixel pairs differ by >40. Authored boundaries (a coastline, a grass edge
    cutting into mud) legitimately differ along a seam — the spike measured known-good island seams
    at 0.00–0.31 and a land-against-water mismatch at 1.00, so 0.85 separates "the art meant this
    boundary" from "the wrong tile got shoved next to this one" with a wide margin. This is the rule
    `audit_canvas` applies to a finished render, which is why it works on LAYERED output (blob
    cutouts composited over an opaque base) where no per-cell frame list describes the pixels.

Both rules are per-pixel RGB**A** (4-channel): for the alpha-cutout blob sheets, "opaque here vs
transparent there" is exactly the kind of disagreement that shows as a hard edge, so alpha belongs in
the distance rather than being dropped.

Callers pass plain `16x16x4` numpy tile arrays (already rotated) — this module never knows about
sheets, frame numbers or `cols`, so it stays testable and reusable across packs.
"""
import numpy as np

# tight / GROUP rule — see module doc
COLOR_TH = 8  # per-pixel RGBA distance below which two touching pixels count as the SAME colour
FIT_TH = 0.0  # max fraction of the touching pixel pairs allowed to disagree (0 = all 16 must match)

# loose / AUDIT rule — see module doc
BREAK_COLOR_TH = 40  # per-pixel RGBA distance above which two touching pixels count as DIFFERENT
BREAK_TH = 0.85      # fraction of a seam's pixel pairs differing beyond that => a HARD EDGE


def borders(t):
    """A tile's 4 one-pixel borders as RGBA float arrays, oriented so a shared seam compares
    index-by-index: `E` (top->bottom) meets a right-neighbour's `W`, `S` (left->right) meets a
    bottom-neighbour's `N`. So A is placeable left-of B iff `A.E ~= B.W`, above B iff `A.S ~= B.N`."""
    t = t.astype(float)
    if t.shape[2] == 3:  # tolerate RGB input by treating it as fully opaque
        t = np.dstack([t, np.full(t.shape[:2], 255.0)])
    return {"N": t[0, :, :4], "S": t[-1, :, :4], "W": t[:, 0, :4], "E": t[:, -1, :4]}


def diff_frac(line_a, line_b, color_th=COLOR_TH):
    """Fraction of the touching pixel pairs that DISAGREE — the one number the whole module rests on.
    0.0 = every pixel along the seam matches within `color_th`; 1.0 = none of them do."""
    d = np.sqrt(((np.asarray(line_a, float) - np.asarray(line_b, float)) ** 2).sum(-1))
    return float((d > color_th).mean())


def fits(a, b, color_th=COLOR_TH, fit_th=FIT_TH):
    """Can tile `a` sit left-of AND above tile `b`? (the two seams a raster placement actually makes).
    Returns `(h_ok, v_ok)`; `a` and `b` are `16x16x4` arrays, already rotated by the caller."""
    ba, bb = borders(a), borders(b)
    return (diff_frac(ba["E"], bb["W"], color_th) <= fit_th,
            diff_frac(ba["S"], bb["N"], color_th) <= fit_th)


def fit_matrices(tiles, color_th=COLOR_TH):
    """Vectorised all-pairs `diff_frac` over a pool of tiles -> `(H, V)` float matrices where
    `H[i, j]` scores tile i placed LEFT OF tile j and `V[i, j]` scores i placed ABOVE j. Both are
    directional (`H[i, j] != H[j, i]` in general), and the diagonal is the tile against ITSELF —
    which matters, because a scattered fill tile's most common neighbour is another copy of itself.

    Sheet-wide pools run to a few hundred placements (~150k ordered pairs), hence the one big
    broadcast instead of a Python double loop."""
    bs = [borders(t) for t in tiles]
    E = np.array([b["E"] for b in bs])
    W = np.array([b["W"] for b in bs])
    S = np.array([b["S"] for b in bs])
    N = np.array([b["N"] for b in bs])

    def frac(A, B):  # (n,16,4) x (n,16,4) -> (n,n) fraction of the 16 pairs differing
        d = np.sqrt(((A[:, None, :, :] - B[None, :, :, :]) ** 2).sum(-1))
        return (d > color_th).mean(-1)

    return frac(E, W), frac(S, N)


def compat_graph(H, V, fit_th=FIT_TH):
    """`(adj, self_ok)` from the fit matrices: `adj[i, j]` iff i and j may be adjacent in EVERY
    arrangement (i left-of j, j left-of i, i above j, j above i) — the symmetric relation a
    scatter-anywhere pool needs — and `self_ok[i]` iff the tile tiles against ITSELF.

    Self-tiling is a hard prerequisite for group membership, not a nicety: at a tight `color_th`
    most of this pack's tiles fail it (their own opposite borders differ by a few units), which is
    the same fact `bake_edge_set.make_seamless` exists to work around for the ONE chosen background
    tile. A tile that can't neighbour a copy of itself can't be scattered into a field of itself."""
    ok_h, ok_v = H <= fit_th, V <= fit_th
    adj = ok_h & ok_h.T & ok_v & ok_v.T
    self_ok = np.array([ok_h[i, i] and ok_v[i, i] for i in range(len(H))])
    return adj, self_ok


def compat_groups(adj, self_ok):
    """Maximal **compatibility groups** = maximal cliques of `adj` restricted to self-tiling members.
    Every pair inside a group is mutually placeable in any arrangement, so ANY random arrangement of
    a group's members is seam-free by construction — that's what makes a group usable directly as a
    generator's scatter pool with no per-placement checking at runtime.

    Greedy (seed with each member in descending-degree order, then absorb whatever still fits all of
    the current members, in that same order) rather than exact Bron-Kerbosch: the pools are tiny and
    the greedy run is deterministic, so the baked output is reproducible. Returns index tuples,
    deduped, largest first (ties broken by index order so the result is stable across runs)."""
    n = len(self_ok)
    degree = (adj & self_ok[None, :] & self_ok[:, None]).sum(1)
    order = sorted(range(n), key=lambda i: (-int(degree[i]), i))
    seen, out = set(), []
    for seed in order:
        if not self_ok[seed]:
            continue
        g = [seed]
        for cand in order:
            if cand == seed or not self_ok[cand]:
                continue
            if all(adj[cand, m] and adj[m, cand] for m in g):
                g.append(cand)
        key = tuple(sorted(g))
        if key not in seen:
            seen.add(key)
            out.append(key)
    out.sort(key=lambda g: (-len(g), g))
    return out


def group_for(adj, self_ok, member):
    """The largest compatibility group CONTAINING `member` (index), or `[member]` when it doesn't
    even tile against itself. What a baked set needs: the scatter pool is not "the biggest group on
    the sheet", it's "the biggest group that includes the base tile this terrain is built around"."""
    for g in compat_groups(adj, self_ok):
        if member in g:
            return list(g)
    return [member]


# ----- edge-matched placement -----------------------------------------------
def pick_placement(canvas, x, y, candidates, rng, tile=16, sides=("W", "N"),
                   color_th=BREAK_COLOR_TH, break_th=BREAK_TH):
    """Pick the candidate tile that seams cleanly against what is ALREADY on the canvas to the LEFT and
    ABOVE cell `(x, y)` — the placement-time half of the 1px test. Returns `(index, score, forced)`.

    Why this is needed even when every autotile case resolves to a real frame: an autotiler picks a tile
    by SHAPE (which corners/neighbours are this terrain), and a case usually has several options for
    variety. Two adjacent cells can each pick a shape-correct option whose touching borders still
    disagree — the art has more variation along an edge than the case system models. The case map can't
    fix that on its own (it's a property of the PAIR, not of either tile), so the choice has to consider
    the neighbour that was already placed. Raster order makes that cheap: left and top are final.

    Candidates are composited onto a copy of the canvas cell before scoring, so alpha-cutout tiles are
    judged on the pixels they would actually produce, not on their own semi-transparent borders. Among
    candidates that tie (typically several with a perfect 0.0) one is chosen at random, so this keeps the
    variety the option lists exist for — it only ever removes the choices that would seam. `forced` is
    True when NO candidate cleared `break_th`, i.e. the art simply has no tile that fits there; count
    those in the caller rather than hiding them, they're the honest measure of a set's coverage.

    `sides` says which neighbours to score against. `W`/`N` are the raster-order default (already
    placed, so final). Pass `E`/`S` as well for a cell whose right/bottom neighbour is ALREADY FINAL
    from an earlier layer and will not be overdrawn — e.g. a water body's right/bottom shore butts grass
    tiles painted in the previous pass, and leaving those two sides unchecked is precisely how a hard
    edge survives a "matched" placement (it was the residual failure in the biome test maps: every
    pond's left/top shore clean, its right/bottom shore seaming). Do NOT include a side whose neighbour
    this same pass will paint later — that compares against pixels about to be replaced."""
    from PIL import Image  # local: keeps this module import-light for the pure-numpy callers

    cw, ch = canvas.size
    nb = {}
    if "W" in sides and x > 0:
        nb["W"] = ("E", np.asarray(canvas.crop(((x - 1) * tile, y * tile, x * tile, (y + 1) * tile))))
    if "N" in sides and y > 0:
        nb["N"] = ("S", np.asarray(canvas.crop((x * tile, (y - 1) * tile, (x + 1) * tile, y * tile))))
    if "E" in sides and (x + 2) * tile <= cw:
        nb["E"] = ("W", np.asarray(canvas.crop(((x + 1) * tile, y * tile, (x + 2) * tile, (y + 1) * tile))))
    if "S" in sides and (y + 2) * tile <= ch:
        nb["S"] = ("N", np.asarray(canvas.crop((x * tile, (y + 1) * tile, (x + 1) * tile, (y + 2) * tile))))
    if not nb:
        return rng.randrange(len(candidates)) if len(candidates) > 1 else 0, 0.0, False
    box = (x * tile, y * tile, min((x + 1) * tile, cw), min((y + 1) * tile, ch))
    under = canvas.crop(box)
    scored = []
    for i, cand in enumerate(candidates):
        cell = Image.new("RGBA", (tile, tile))
        cell.alpha_composite(under)
        cell.alpha_composite(cand if cand.size == (tile, tile) else cand.crop((0, 0, tile, tile)))
        b = borders(np.asarray(cell))
        s = 0.0
        for side, (their_side, arr) in nb.items():
            s = max(s, diff_frac(borders(arr)[their_side], b[side], color_th))
        scored.append((s, i))
    best = min(s for s, _ in scored)
    tied = [i for s, i in scored if s <= max(best, 0.0)]
    return rng.choice(tied), best, best > break_th


# ----- auditing a finished render -------------------------------------------
def audit_canvas(im, tile=16, color_th=BREAK_COLOR_TH, break_th=BREAK_TH):
    """Walk every internal tile seam of a RENDERED map and score it with the same 1px comparison —
    the acceptance guard for a biome render. Reports `(hard, worst, total, scores)`: how many seams
    read as HARD EDGES (>`break_th` of their pixel pairs differing beyond `color_th`), the worst
    single score, the seam count, and the sorted score list for eyeballing the distribution.

    Audits PIXELS, not a placement list, so it covers layered composites (blob alpha cutouts over an
    opaque base) where no per-cell frame describes what's actually on screen — and it catches a bad
    seam introduced by the compositing itself, not just by a wrong frame choice. Uses the LOOSE rule
    (see module doc): authored boundaries score well under 0.85, a genuinely wrong neighbour ~1.0."""
    a = np.asarray(im).astype(float)
    if a.shape[2] == 3:
        a = np.dstack([a, np.full(a.shape[:2], 255.0)])
    h, w = a.shape[0] // tile, a.shape[1] // tile
    scores = []
    for x in range(1, w):  # vertical seams: column left of the boundary vs column right of it
        col = x * tile
        for y in range(h):
            ys = slice(y * tile, (y + 1) * tile)
            scores.append((diff_frac(a[ys, col - 1, :4], a[ys, col, :4], color_th), "V", x, y))
    for y in range(1, h):  # horizontal seams
        row = y * tile
        for x in range(w):
            xs = slice(x * tile, (x + 1) * tile)
            scores.append((diff_frac(a[row - 1, xs, :4], a[row, xs, :4], color_th), "H", x, y))
    scores.sort(reverse=True)
    hard = [s for s in scores if s[0] > break_th]
    worst = scores[0][0] if scores else 0.0
    return len(hard), worst, len(scores), scores
