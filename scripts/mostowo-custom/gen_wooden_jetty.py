#!/usr/bin/env python3
"""Generate the wooden-jetty tileset (mostowo-custom): plank pier tiles for building
jetties out over water.

WHY THIS EXISTS
    The pack ships no wooden deck/pier terrain. A jetty is a *placed structure* the
    player lays cell-by-cell over water, so — like the water_diagonal coast — each tile
    BAKES the surrounding water so it drops seamlessly onto the plain `#3e92d1` water the
    user paints around it. Full technique write-up: docs/TILE-AUTHORING.md.

WHAT IT PRODUCES
    A 16px tile sheet, 6 wide x 1 tall = 6 frames, at
    public/assets/tilesets/mostowo-custom/Environment/Tilesets/wooden_jetty.png

        frame 0  deckA   straight pier segment (clean)
        frame 1  deckB   straight variant (knots/wear)
        frame 2  deckC   straight variant
        frame 3  end     seaward cap: plank front lip + two mooring posts in the water
        frame 4  corner  outer L-bend (water on two adjacent sides; mitred boards)
        frame 5  root    landward butt: deck merges to full width to meet the bank

    BASE ORIENTATION: the pier runs VERTICALLY (north-south); planks run LENGTHWISE
    (vertical boards); water margins sit on the left/right long sides; "seaward" = top.
    Rotation is done in-editor (0/90/180/270, no flip).

WHY LENGTHWISE PLANKS (the rotation rule)
    Editor terrain paint rotates but does NOT flip. If boards ran ACROSS the pier, a 90-deg
    rotation would turn them 90-deg and they'd clash with an unrotated neighbour. LENGTHWISE
    boards (parallel to the pier axis) stay lengthwise under rotation — a vertical pier's
    vertical boards become a horizontal pier's horizontal boards — so one baked orientation
    covers all four directions cleanly. This is the jetty analogue of the coast set's
    "one global band" rule: pick the one geometry that survives the editor's transforms.

HOW IT TILES SEAMLESSLY
    1. WATER IDENTICAL TO THE PLAIN FILL. The baked water reuses the exact water_diagonal
       palette + fill (base `#3e92d1` + sparse accents), so jetty tiles sit invisibly on the
       water the user paints around them.
    2. FIXED DECK GEOMETRY. The plank surface, its lit/shadowed rims and the water margins
       sit at the SAME pixel columns in every straight/end/root frame, and boards run the
       full tile height with no butt-joint line, so a stacked run reads as one continuous
       length of decking with no seam.
    3. REGULAR DETAIL. Nails sit at fixed rows so they repeat tile-to-tile as even decking
       studs rather than drifting. Variants (deckB/deckC) only add knots/wear on TOP of the
       shared geometry, so they interchange freely with deckA in any order.

PALETTE
    Water sampled from Pixel Crawler Water_tiles.png (kept byte-identical to the plain
    water + the coast set). Wood sampled from the pack's barricade/spike art
    (craftpix-dungeon Traps/Barricades + Traps/Spikes) so the pier reads as the same
    timber the player already builds palisades and traps from.

USAGE
    python3 scripts/mostowo-custom/gen_wooden_jetty.py
    # New sheet -> add a `wooden_jetty` catalog entry (path + w/h/frames). See docs.
"""
from __future__ import annotations

import os
import random

from PIL import Image

T = 16  # tile size (matches TILE_SIZE / pack tileSize)

# --- water palette (identical to gen_water_diagonal.py, so fills are seamless) ---
WATER_BASE = (0x3E, 0x92, 0xD1)
WATER_ACC = [(0x41, 0x85, 0xCA), (0x44, 0x98, 0xD1)]
WATER_SHADOW = (0x2E, 0x6D, 0x9C)  # deck's cast shadow on the water (darker water)
FOAM = (0xA3, 0xC8, 0xEE)          # bright foam rim (post bases, lit deck edge sparkle)
FOAM2 = (0x7B, 0xAA, 0xDB)         # mid foam

# --- wood palette (sampled from craftpix-dungeon Traps/Barricades + Spikes) ---
PLANK_HI = (0xEB, 0x96, 0x61)   # lit plank face / top-left rim
PLANK_MID = (0xB5, 0x59, 0x45)  # plank body
PLANK_LO = (0x73, 0x4C, 0x44)   # plank shadow / board seam side
OUTLINE = (0x0C, 0x0F, 0x2A)    # pack's signature near-black navy outline
NAIL = (0x0C, 0x0F, 0x2A)       # nail stud

# --- deck geometry (base = vertical pier, lengthwise vertical boards) ---
DECK_L = 2          # first plank column (x)
DECK_R = 13         # last plank column (x); deck spans DECK_L..DECK_R inclusive (12px)
BOARD_W = 3         # plank width in px -> 4 boards across the 12px deck
NAIL_ROWS = (3, 12)  # y-rows carrying nail studs (fixed -> even decking under tiling)

OUT = os.path.join(
    os.path.dirname(__file__),
    "../../public/assets/tilesets/mostowo-custom/Environment/Tilesets/wooden_jetty.png",
)


def water_fill(seed):
    """Solid base water + sparse seeded ripple flecks. Matches the coast set's water()."""
    r = random.Random(seed)
    img = Image.new("RGBA", (T, T), WATER_BASE + (255,))
    p = img.load()
    for _ in range(int(T * T * 0.05)):
        x, y = r.randrange(T), r.randrange(T)
        p[x, y] = r.choice(WATER_ACC) + (255,)
    return img


def plank_col(x):
    """Cross-board shading for plank column x within the deck (DECK_L..DECK_R):
    lit-left / mid / shadow-right per board, so each 3px board reads rounded and the
    board-to-board LO->HI step draws the seam. DECK_L is the lit water-facing rim."""
    within = (x - DECK_L) % BOARD_W
    if within == 0:
        return PLANK_HI
    if within == 1:
        return PLANK_MID
    return PLANK_LO


def paint_deck_px(p, x, y, tx, ws, *, left=DECK_L, right=DECK_R):
    """Paint one deck-or-water pixel for a vertical-board deck spanning [left,right].
    Water outside the deck, with a solid 1px lit waterline on the left rim and the deck's
    cast shadow on the right rim (both SOLID lines so they tile with no drift). `ws` is the
    baked-water pixel source; `tx` the per-tile texture RNG."""
    if left <= x <= right:
        col = plank_col(x - left + DECK_L)
        if x == left:              # lit water-facing rim
            col = PLANK_HI
        elif x == right:           # shadow water-facing rim
            col = PLANK_LO
        if y in NAIL_ROWS and ((x - left) % BOARD_W) == 1:
            col = NAIL
        p[x, y] = col + (255,)
    elif x == left - 1:            # lit deck edge: bright waterline
        p[x, y] = FOAM2 + (255,)
    elif x == right + 1:           # shadow side: deck's cast shadow on the water
        p[x, y] = WATER_SHADOW + (255,)
    else:
        p[x, y] = ws[x, y]


def add_wear(p, tx, knots, specks):
    """Overlay seeded knots (a dark oval, board-centred) + a few isolated wear specks on an
    already-painted deck, without touching geometry, so variants interchange with the clean
    deck. Specks are kept sparse and single-pixel so they read as grain, not a scratch."""
    used = set()
    for _ in range(knots):
        kx = DECK_L + 1 + tx.randrange(4) * BOARD_W  # board centre (3,6,9,12)
        ky = tx.randint(5, 10)
        p[kx, ky] = OUTLINE + (255,)
        for dx, dy in ((1, 0), (0, 1), (-1, 0), (0, -1)):
            x, y = kx + dx, ky + dy
            if DECK_L < x < DECK_R and 0 <= y < T:
                p[x, y] = PLANK_LO + (255,)
        used.add((kx, ky))
    for _ in range(specks):
        sx = tx.randint(DECK_L + 1, DECK_R - 1)
        sy = tx.randrange(T)
        if sy in NAIL_ROWS or (sx, sy) in used:
            continue
        p[sx, sy] = PLANK_LO + (255,)


def make_deck(water_seed, tex_seed, knots=0, specks=0):
    """Straight vertical pier segment: lengthwise boards, water margins L/R."""
    ws = water_fill(water_seed).load()
    tx = random.Random(tex_seed)
    img = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    p = img.load()
    for y in range(T):
        for x in range(T):
            paint_deck_px(p, x, y, tx, ws)
    add_wear(p, tx, knots, specks)
    return img


def make_end(water_seed, tex_seed):
    """Seaward cap: water above a plank front lip, two mooring posts poking into the water,
    then a normal deck below. Rotates to cap any direction."""
    ws = water_fill(water_seed).load()
    tx = random.Random(tex_seed)
    front = 5  # y of the deck's front (lit) lip
    img = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    p = img.load()
    for y in range(T):
        for x in range(T):
            if y < front:
                p[x, y] = ws[x, y]            # open water in front of the cap
            elif y == front:
                # lit front lip across the deck; water margins keep their columns
                if DECK_L <= x <= DECK_R:
                    p[x, y] = PLANK_HI + (255,)
                else:
                    paint_deck_px(p, x, y, tx, ws)
            else:
                paint_deck_px(p, x, y, tx, ws)
    # two mooring posts standing in the water in front of the cap
    for px in (DECK_L + 1, DECK_R - 1):
        for y in range(1, front + 1):
            p[px, y] = (PLANK_MID if y > 1 else PLANK_HI) + (255,)
            p[px + 1, y] = OUTLINE + (255,)     # right-shadow edge of the post
        # foam ring at the post base
        for dx in (-1, 0, 1, 2):
            x = px + dx
            if 0 <= x < T:
                p[x, front] = (FOAM if (x + front) % 2 else FOAM2) + (255,)
    return img


def make_corner(water_seed, tex_seed):
    """Outer L-bend: arms exit the BOTTOM and RIGHT edges; water on the top+left sides.
    Boards mitre along the diagonal — vertical in the down arm, horizontal in the right
    arm. Rotates to every corner. Minor edge mismatch against straight neighbours is
    accepted (vanishes at game scale, per docs/TILE-AUTHORING.md)."""
    ws = water_fill(water_seed).load()
    tx = random.Random(tex_seed)
    img = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    p = img.load()
    for y in range(T):
        for x in range(T):
            on_deck = x >= DECK_L and y >= DECK_L      # water on top(y<2)+left(x<2)
            if not on_deck:
                if x == DECK_L - 1 and y >= DECK_L - 1:   # lit left rim: bright waterline
                    p[x, y] = FOAM2 + (255,)
                elif y == DECK_L - 1 and x >= DECK_L:     # lit top rim: bright waterline
                    p[x, y] = FOAM2 + (255,)
                else:
                    p[x, y] = ws[x, y]
                continue
            a, b = x - DECK_L, y - DECK_L
            if abs(a - b) <= 0:                          # 1px diagonal mitre seam
                col = OUTLINE
            elif a > b:                                  # down-arm field: vertical boards
                col = plank_col(x)
            else:                                        # right-arm field: horizontal boards
                col = plank_col(DECK_L + (b % BOARD_W))
            if x == DECK_L or y == DECK_L:               # lit rims on the two water sides
                col = PLANK_HI
            p[x, y] = col + (255,)
    return img


def make_root(water_seed, tex_seed):
    """Landward butt: a straight deck whose water margins close off over the last rows so
    the deck reaches full width to meet the bank (no water gap where it joins land).
    Also serves as a short standalone stub. Rotates to root from any direction."""
    ws = water_fill(water_seed).load()
    tx = random.Random(tex_seed)
    close = 13  # y from which the margins ramp closed to full-width deck
    img = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    p = img.load()
    for y in range(T):
        left = DECK_L if y < close else max(0, DECK_L - (y - close + 1))
        right = DECK_R if y < close else min(T - 1, DECK_R + (y - close + 1))
        for x in range(T):
            paint_deck_px(p, x, y, tx, ws, left=left, right=right)
    return img


def build_sheet():
    frames = [
        make_deck(10, 100),                        # 0 deckA clean
        make_deck(11, 101, knots=1, specks=3),     # 1 deckB
        make_deck(12, 102, knots=2, specks=5),     # 2 deckC
        make_end(13, 103),                         # 3 end cap
        make_corner(14, 104),                      # 4 corner
        make_root(15, 105),                        # 5 root
    ]
    cols = 6
    sheet = Image.new("RGBA", (cols * T, T), (0, 0, 0, 0))
    for i, t in enumerate(frames):
        sheet.paste(t, ((i % cols) * T, 0))
    return sheet


def main():
    sheet = build_sheet()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT)
    print(f"wrote {os.path.normpath(OUT)}  ({sheet.width}x{sheet.height}, 6 frames of {T}px)")
    print("NEW sheet: add a `wooden_jetty` entry to public/assets/asset-catalog.json "
          "(path + w=96 h=16 frames=6). See docs/TILE-AUTHORING.md.")


if __name__ == "__main__":
    main()
