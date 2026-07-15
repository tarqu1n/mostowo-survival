#!/usr/bin/env python3
"""One-off generator (plan 014 step 10) — derives a TS-consumable blob-key -> frame mapping for the
Pixel Crawler GRASS terrain from the SAME real pixel-classification `autotile.py`'s `build_blob` uses
to build its (randomised-variety) paint table. `autotile.py` itself is left untouched, same rule step 3
followed for `autotile.ts` — this reuses its function, it doesn't fork its logic.

Writes:
  - public/assets/tilesets/pixel-crawler/terrains.json — committed terrain defs the editor's terrain
    brush loads at runtime (a sibling of pack.json rather than a `terrains` key inside it: the mapping
    is one entry per 8-neighbour blob key — dozens of entries — and keeping it out of pack.json keeps
    that file's hand-authored fields (rules/overrides/regions) readable; documented again in the
    written file's own `_comment` field).
  - src/editor/__tests__/fixtures/grass-terrain-parity.json — a committed mask + its expected baked
    frames, computed by this SAME script via a plain-Python re-implementation of the blob-key lookup +
    fallback (`pick_frame`/`blob_key_int` below). `terrainOps.test.ts` asserts the TS `paintMask`
    (src/systems/autotile.ts, step 3) reproduces this exactly given the generated mapping — that's the
    plan's "compare against a Python-autotiler reference output" acceptance bar.

Re-run after any Floors_Tiles.png change: `python3 scripts/pixel-crawler/gen_terrains.py`, then
`npx prettier --write` the two JSON outputs above (this script's plain `json.dump` formatting isn't
Prettier-clean — `npm run format:check` will flag both files otherwise).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from autotile import build_blob, FULL  # noqa: E402  (path insert must precede this import)

PACK_ID = "pixel-crawler"
SHEET = "Environment/Tilesets/Floors_Tiles.png"
COLS = 25  # Floors_Tiles.png sheet width in tiles — frame = row*COLS + col (see data/tileset.ts doc)
GRASS_BOX = (0, 4, 0, 12)  # (c0, c1, r0, r1), matches autotile.py's __main__ GRASS entry

# Bit weights MUST mirror src/systems/autotile.ts exactly: MSB->LSB N,E,S,W,NE,SE,SW,NW.
N, E, S, W, NE, SE, SW, NW = 1 << 7, 1 << 6, 1 << 5, 1 << 4, 1 << 3, 1 << 2, 1 << 1, 1 << 0
CARDINAL_MASK = N | E | S | W
FULL_KEY_INT = N | E | S | W | NE | SE | SW | NW  # 0xff, mirrors autotile.ts's FULL_KEY


def key_tuple_to_int(t):
    """Convert autotile.py's blob_key() tuple (N,E,S,W,ne,se,sw,nw) to the packed int TS uses — the
    tuple's element order maps 1:1 onto the MSB->LSB bit positions above."""
    n, e, s, w, ne, se, sw, nw = t
    return (n * N) | (e * E) | (s * S) | (w * W) | (ne * NE) | (se * SE) | (sw * SW) | (nw * NW)


def canonical_mapping(table):
    """table: {blob_key_tuple: [(c,r), ...]} from build_blob. Pick the LOWEST (row,col) option per key
    — deterministic. Python's own `pick()` instead picks randomly among a key's options for visual
    variety; a terrain MAPPING (this generator's output) carries exactly one canonical frame per key,
    so determinism replaces the RNG (mirrors autotile.ts's `pickFrame` doc)."""
    mapping = {}
    for key_tuple, options in table.items():
        c, r = min(options, key=lambda cr: (cr[1], cr[0]))
        mapping[key_tuple_to_int(key_tuple)] = r * COLS + c
    return mapping


def pick_frame(mapping, key_int):
    """Plain-Python mirror of `src/systems/autotile.ts`'s `pickFrame` — exact-key match, else the
    lowest-keyed entry sharing the same cardinals (diagonals ignored), else FULL_KEY, else `None`.
    Used ONLY to compute the parity fixture's expected output below, so the fixture is derived
    independently of (but by the exact same rule as) the TS implementation it's meant to check."""
    if key_int in mapping:
        return mapping[key_int]
    cardinals = key_int & CARDINAL_MASK
    fallback_key = next((k for k in sorted(mapping) if (k & CARDINAL_MASK) == cardinals), None)
    if fallback_key is not None:
        return mapping[fallback_key]
    return mapping.get(FULL_KEY_INT)


def blob_key_int(mask, cols, rows, col, row):
    """Plain-Python mirror of `src/systems/autotile.ts`'s `blobKey` — see that module's doc for the
    corner-suppression rule (a diagonal only counts if both adjacent cardinals AND the diagonal cell
    are all set)."""

    def is_set(c, r):
        return 0 <= c < cols and 0 <= r < rows and mask[r * cols + c] == 1

    n, s, w, e = is_set(col, row - 1), is_set(col, row + 1), is_set(col - 1, row), is_set(col + 1, row)
    nw = n and w and is_set(col - 1, row - 1)
    ne = n and e and is_set(col + 1, row - 1)
    sw = s and w and is_set(col - 1, row + 1)
    se = s and e and is_set(col + 1, row + 1)
    key = 0
    if n:
        key |= N
    if e:
        key |= E
    if s:
        key |= S
    if w:
        key |= W
    if ne:
        key |= NE
    if se:
        key |= SE
    if sw:
        key |= SW
    if nw:
        key |= NW
    return key


def paint_mask_frames(mask, cols, rows, mapping):
    """Plain-Python mirror of `src/systems/autotile.ts`'s `paintMask` — bakes every mask==1 cell to a
    frame via `pick_frame`, omitting a cell entirely if no tier resolves it."""
    out = []
    for row in range(rows):
        for col in range(cols):
            if mask[row * cols + col] != 1:
                continue
            frame = pick_frame(mapping, blob_key_int(mask, cols, rows, col, row))
            if frame is not None:
                out.append({"col": col, "row": row, "frame": frame})
    return out


def main():
    root = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))

    grass_table = build_blob(SHEET, *GRASS_BOX)
    mapping = canonical_mapping(grass_table)
    fill_frame = mapping.get(key_tuple_to_int(FULL))
    if fill_frame is None:
        raise SystemExit("grass table has no FULL-surround entry — cannot pick a fillFrame")

    terrains_doc = {
        "_comment": (
            "Terrain defs live in this sibling file, not pack.json (plan 014 step 10 decision: the "
            "mapping is one entry per 8-neighbour blob key -- dozens of entries -- and keeping it out "
            "of pack.json keeps that file's hand-authored fields readable). Generated by "
            "scripts/pixel-crawler/gen_terrains.py -- do not hand-edit `mapping`; re-run the script "
            "after any Floors_Tiles.png change."
        ),
        "terrains": [
            {
                "id": "grass",
                "name": "Grass",
                "pack": PACK_ID,
                "sheet": SHEET,
                "fillFrame": fill_frame,
                "mapping": {str(k): v for k, v in sorted(mapping.items())},
            }
        ],
    }
    out_path = os.path.join(root, "public", "assets", "tilesets", "pixel-crawler", "terrains.json")
    with open(out_path, "w") as f:
        json.dump(terrains_doc, f, indent=2)
        f.write("\n")
    print(f"wrote {out_path} ({len(mapping)} mapping keys, fillFrame={fill_frame})")

    # ---- Parity fixture: a small hand-authored mask exercising straight edges, outer corners, an
    # inner corner, and a full-surround cell, baked with the exact same pick_frame rule the generated
    # mapping above encodes. `terrainOps.test.ts` asserts the TS `paintMask` reproduces this exactly.
    cols, rows = 6, 6
    # prettier-ignore
    mask = [
        0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 0, 0,
        0, 1, 1, 1, 1, 0,
        0, 1, 1, 1, 1, 0,
        0, 0, 1, 1, 0, 0,
        0, 0, 0, 0, 0, 0,
    ]
    expected = paint_mask_frames(mask, cols, rows, mapping)
    fixture = {"dims": {"cols": cols, "rows": rows}, "mask": mask, "expected": expected}
    fixture_path = os.path.join(
        root, "src", "editor", "__tests__", "fixtures", "grass-terrain-parity.json"
    )
    os.makedirs(os.path.dirname(fixture_path), exist_ok=True)
    with open(fixture_path, "w") as f:
        json.dump(fixture, f, indent=2)
        f.write("\n")
    print(f"wrote {fixture_path} ({len(expected)} baked cells)")


if __name__ == "__main__":
    main()
