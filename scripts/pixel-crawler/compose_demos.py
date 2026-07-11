#!/usr/bin/env python3
"""Reference-quality demo maps: big, autotiled terrain (smooth edges + corners +
varied grass), depth-sorted objects, dense tree borders. Everything from real
Pixel Crawler tiles/objects."""
import os, random
import numpy as np
from PIL import Image, ImageDraw
from compose import sheet, tile, TILE, PC
from objects import components
from autotile import (build_blob, paint_mask, new_mask, smooth_mask, disc, FULL)

OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "docs", "assets", "pixel-crawler", "demos"))
os.makedirs(OUT, exist_ok=True)

F = "Environment/Tilesets/Floors_Tiles.png"
VEG = "Environment/Props/Static/Vegetation.png"
ROCKS = "Environment/Props/Static/Rocks.png"
RES = "Environment/Props/Static/Resources.png"
BONF = "Environment/Structures/Stations/Bonfire/Bonfire_01-Sheet.png"
FIRE = "Environment/Structures/Stations/Bonfire/Fire_01-Sheet.png"
COOK = "Environment/Structures/Stations/Cooking Station/Cooker/Cooker_01.png"
WORK = "Environment/Structures/Stations/Workbench/Workbench.png"
PEAS = "Entities/Npc's/Citizen_F/Peasant_A/Idle/Idle-Sheet.png"
KNIGHT = "Entities/Npc's/Knight/Idle/Idle-Sheet.png"
SKELE = "Entities/Mobs/Skeleton Crew/Skeleton - Base/Idle/Idle-Sheet.png"
SKMAGE = "Entities/Mobs/Skeleton Crew/Skeleton - Mage/Idle/Idle-Sheet.png"
ORC = "Entities/Mobs/Orc Crew/Orc/Idle/Idle-Sheet.png"
ORCW = "Entities/Mobs/Orc Crew/Orc - Warrior/Idle/Idle-Sheet.png"
WALL = "Environment/Tilesets/Wall_Tiles.png"

GRASS = build_blob(F, 0, 4, 0, 12)
DIRT = build_blob(F, 11, 15, 0, 12)

_oc = {}
def obj(rel, i, **kw):
    k = (rel, tuple(sorted(kw.items())))
    if k not in _oc:
        _oc[k] = components(rel, **kw)
    return sheet(rel).crop(_oc[k][i])

def frame(rel, idx, fw, fh):
    im = sheet(rel).crop((idx*fw, 0, (idx+1)*fw, fh))
    bb = im.getbbox()
    return im.crop(bb) if bb else im

# ---- tree palette (varied models), scaled to a uniform-ish base height ----
def _scale_to_h(spr, h):
    w = max(1, round(spr.width * h / spr.height))
    return spr.resize((w, h), Image.NEAREST)

def tree_palette(rng, base_h=(60, 84)):
    """A pool of tree sprites from several models, each scaled to ~base_h px tall
    (base-pixel space) so no single tree dwarfs the map."""
    raw = []
    for rel, idxs in [
        ("Environment/Props/Static/Trees/Model_02/Size_03.png", [0, 3, 4]),
        ("Environment/Props/Static/Trees/Model_02/Size_04.png", [0, 1]),
        ("Environment/Props/Static/Trees/Model_01/Size_03.png", [0, 1]),
        ("Environment/Props/Static/Trees/Model_03/Size_03.png", [0]),
    ]:
        try:
            comps = components(rel)
            for i in idxs:
                if i < len(comps):
                    spr = sheet(rel).crop(comps[i])
                    if spr.width > 20 and spr.height > 40:
                        raw.append(spr)
        except Exception:
            pass
    # pre-bake a few scaled variants of each
    pool = []
    for spr in raw:
        for _ in range(3):
            pool.append(_scale_to_h(spr, rng.randint(*base_h)))
    return pool

class Scene:
    def __init__(self, W, H, rng, base_bg=(24, 20, 16, 255)):
        self.W, self.H, self.rng = W, H, rng
        self.canvas = Image.new("RGBA", (W*TILE, H*TILE), base_bg)
        self.objs = []  # (sort_y, x_left, top_y, sprite)

    def paint(self, rel, table, mask):
        paint_mask(self.canvas, rel, table, mask, self.rng)

    def add(self, spr, cx, feet_y, sort_bias=0, shadow=True):
        if shadow:
            self._shadow(cx, feet_y, max(8, int(spr.width*0.7)))
        self.objs.append((feet_y + sort_bias, int(cx - spr.width/2),
                          int(feet_y - spr.height), spr))

    def _shadow(self, cx, feet_y, w):
        h = max(5, w//3)
        s = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(s).ellipse([0, 0, w-1, h-1], fill=(0, 0, 0, 70))
        self.canvas.alpha_composite(s, (int(cx-w/2), int(feet_y-h*0.55)))

    def scatter(self, sprites, n, region=None, avoid=None):
        x0, y0, x1, y1 = region or (0, 0, self.W*TILE, self.H*TILE)
        for _ in range(n):
            x = self.rng.randint(x0, x1); y = self.rng.randint(y0, y1)
            if avoid and avoid(x, y):
                continue
            spr = self.rng.choice(sprites)
            self.canvas.alpha_composite(spr, (x, y))  # flat detail, no depth sort

    def flush(self, name, scale=2):
        for sort_y, x, y, spr in sorted(self.objs, key=lambda o: o[0]):
            self.canvas.alpha_composite(spr, (x, y))
        big = self.canvas.resize((self.canvas.width*scale, self.canvas.height*scale),
                                 Image.NEAREST)
        p = os.path.join(OUT, name)
        big.convert("RGB").save(p)
        print("wrote", p, big.size)
        return p

def tree_border(sc, trees, thickness=4):
    """A forest ring around the map that THINS toward the open field: dense at the
    very edge, sparse at the inner boundary. Trees on the outer ring have feet near
    (or past) the edge so canopies frame it; depth-sorted for correct overlap."""
    W, H, rng = sc.W, sc.H, sc.rng
    def T(): return rng.choice(trees)
    for ty in range(-1, H + 2):
        for tx in range(-1, W + 2):
            d = min(tx, ty, W - 1 - tx, H - 1 - ty)  # tiles from nearest edge
            if d >= thickness:
                continue
            prob = [0.95, 0.7, 0.4, 0.2][max(0, min(3, d))]
            if rng.random() > prob:
                continue
            x = tx*TILE + rng.randint(-5, 5)
            # push outer-ring trees slightly past the edge so they read as "off-map"
            y = ty*TILE + rng.randint(-3, 6) + TILE
            sc.add(T(), x, y, shadow=False)

# ---------------- detail sprite sets ----------------
def details(rng):
    tufts = [obj(VEG, i, min_area=20) for i in (26, 30, 31, 32, 33, 45, 46, 52, 53)]
    flowers = [obj(VEG, i, min_area=20) for i in (28, 29)]
    mush = [obj(VEG, i, min_area=20) for i in (73, 74, 75, 76, 77)]
    bushes = [obj(VEG, i, min_area=20) for i in (21, 22, 23, 24, 25)]
    ferns = [obj(VEG, i, min_area=20) for i in (27, 49)]
    return tufts, flowers, mush, bushes, ferns

# ================= DEMO 1: BIG FOREST CAMP (DAY) =================
def demo_camp():
    W, H = 46, 34
    rng = random.Random(11)
    sc = Scene(W, H, rng)
    # grass base (varied) everywhere
    sc.paint(F, GRASS, new_mask(W, H, True))
    # dirt camp clearing (smoothed organic disc) + a path up to the treeline
    dm = new_mask(W, H)
    disc(dm, 23, 21, 9, 6)
    for y in range(0, 22):            # path north
        for x in range(21, 25): dm[y][x] = True
    dm = smooth_mask(dm, 2)
    sc.paint(F, DIRT, dm)
    def on_dirt(px, py):
        tx, ty = px//TILE, py//TILE
        return 0 <= ty < H and 0 <= tx < W and dm[ty][tx]

    tufts, flowers, mush, bushes, ferns = details(rng)
    trees = tree_palette(rng)
    # clustered grass detail (denser near treeline, sparse on open grass), keep off dirt
    sc.scatter(tufts, 260, avoid=lambda x, y: on_dirt(x, y))
    sc.scatter(flowers, 40, avoid=lambda x, y: on_dirt(x, y))
    sc.scatter(mush, 22, region=(0, 0, W*TILE, 10*TILE))
    # tree ring
    tree_border(sc, trees, thickness=4)
    # bushes/ferns just inside the treeline
    for _ in range(26):
        edge = rng.choice(["t", "b", "l", "r"])
        if edge == "t": x, y = rng.randint(30, W*TILE-30), rng.randint(34, 64)
        elif edge == "b": x, y = rng.randint(30, W*TILE-30), rng.randint(H*TILE-60, H*TILE-30)
        elif edge == "l": x, y = rng.randint(34, 70), rng.randint(40, H*TILE-40)
        else: x, y = rng.randint(W*TILE-70, W*TILE-34), rng.randint(40, H*TILE-40)
        sc.add(rng.choice(bushes+ferns), x, y, shadow=False)
    # rocks around the clearing
    for (x, y) in [(150, 150), (600, 380), (250, 430), (560, 200)]:
        sc.add(obj(ROCKS, rng.choice([1, 4, 31])), x, y)
    for (x, y) in [(200, 250), (520, 300), (300, 180)]:
        sc.add(obj(ROCKS, rng.choice([2, 5])), x, y, shadow=False)
    # --- the camp in the clearing (clearing centre ~ tile 23,21 -> px 368,336) ---
    cxp, cyp = 23*TILE, 21*TILE
    # felled stumps + logs telling the wood-gathering story
    sc.add(obj(RES, 17, min_area=16), cxp-70, cyp-40, shadow=False)   # log
    sc.add(obj(RES, 20, min_area=16), cxp-58, cyp-24, shadow=False)   # plank
    sc.add(obj(RES, 29, min_area=16), cxp-96, cyp+10)                 # crate
    sc.add(obj(RES, 23, min_area=16), cxp+70, cyp+8, shadow=False)    # straw
    sc.add(obj(RES, 1, min_area=16), cxp+20, cyp+42, shadow=False)    # coal
    sc.add(frame(BONF, 0, 32, 32), cxp, cyp, shadow=False)
    sc.add(frame(FIRE, 0, 32, 48), cxp, cyp-1, sort_bias=2, shadow=False)
    sc.add(sheet(COOK), cxp+64, cyp+14)
    sc.add(frame(WORK, 0, 64, 88) if False else obj(WORK, 0), cxp-64, cyp+30)  # workbench
    sc.add(frame(PEAS, 0, 64, 64), cxp-26, cyp-6)     # survivor by fire
    sc.add(frame(KNIGHT, 0, 32, 32), cxp+40, cyp-8)   # guard
    return sc.flush("demo1_camp_day.png")

# ================= DEMO 2: SAME CAMP, GRIM NIGHT =================
def grimdark(day, glow):
    a = np.asarray(day.convert("RGB")).astype(np.float32)
    a *= np.array([0.30, 0.36, 0.55])
    Hh, Ww, _ = a.shape
    yy, xx = np.mgrid[0:Hh, 0:Ww]
    g = np.zeros((Hh, Ww), np.float32)
    for gx, gy, rad, s in glow:
        d = np.sqrt((xx-gx)**2 + (yy-gy)**2)
        g += s*np.clip(1-d/rad, 0, 1)**2
    a += np.clip(g, 0, 1)[..., None]*np.array([255, 150, 60])*0.9
    cx, cy = Ww/2, Hh/2
    d = np.sqrt((xx-cx)**2+(yy-cy)**2)/np.sqrt(cx**2+cy**2)
    a *= (1-0.5*np.clip(d-0.35, 0, 1))[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

def demo_night(day_path):
    day = Image.open(day_path)
    s = 2
    night = grimdark(day, [(23*TILE*s, 21*TILE*s, 210*s, 1.7)])
    p = os.path.join(OUT, "demo2_camp_night.png")
    night.save(p); print("wrote", p, night.size); return p

# ================= DEMO 3: STONE-RUIN SKIRMISH (bigger) =================
PIT = dict(tl=(0,20), top=(2,20), tr=(5,20), l=(0,22), r=(5,22),
           bl=(0,24), bot=(2,24), br=(5,24), floor=(2,22))
def demo_ruins():
    W, H = 40, 30
    rng = random.Random(4)
    sc = Scene(W, H, rng)
    sc.paint(F, GRASS, new_mask(W, H, True))
    tufts, flowers, mush, bushes, ferns = details(rng)
    trees = tree_palette(rng)
    sc.scatter(tufts, 180)
    tree_border(sc, trees, thickness=4)
    # ruined enclosure built from Wall_Tiles concave pit set
    x0, y0, x1, y1 = 10, 8, 30, 22
    for ty in range(y0, y1+1):
        for tx in range(x0, x1+1):
            L, R, Tp, B = tx == x0, tx == x1, ty == y0, ty == y1
            cr = (PIT['tl'] if Tp and L else PIT['tr'] if Tp and R else
                  PIT['bl'] if B and L else PIT['br'] if B and R else
                  PIT['top'] if Tp else PIT['bot'] if B else
                  PIT['l'] if L else PIT['r'] if R else PIT['floor'])
            sc.canvas.alpha_composite(tile(WALL, *cr), (tx*TILE, ty*TILE))
    fx, fy = 20*TILE, 15*TILE
    sc.add(obj(ROCKS, 4), fx-120, fy-30); sc.add(obj(ROCKS, 5), fx+150, fy+40, shadow=False)
    sc.add(obj(ROCKS, 46), fx+120, fy-40, shadow=False)
    sc.add(obj(ROCKS, 47), fx+134, fy-34, shadow=False)
    sc.add(frame(BONF, 0, 32, 32), fx-40, fy-20, shadow=False)
    sc.add(frame(FIRE, 0, 32, 48), fx-40, fy-21, sort_bias=2, shadow=False)
    sc.add(frame(KNIGHT, 0, 32, 32), fx-10, fy+6)
    sc.add(frame(SKELE, 0, 32, 32), fx+70, fy-6)
    sc.add(frame(SKMAGE, 0, 32, 32), fx+110, fy+30)
    sc.add(frame(ORC, 0, 32, 32), fx+30, fy+50)
    sc.add(frame(ORCW, 0, 32, 32), fx-90, fy+30)
    return sc.flush("demo3_ruins.png")

if __name__ == "__main__":
    p1 = demo_camp()
    demo_night(p1)
    demo_ruins()
    print("done")
