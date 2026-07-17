#!/usr/bin/env python3
"""Ingest the CraftPix downloads into 4 themed packs under public/assets/tilesets/.

Consolidates 11 raw CraftPix downloads into 4 theme/type groups:
  craftpix-nature   — outdoor natural props (trees, bushes, rocks, rocky-area, crystals)
  craftpix-undead   — dark tilesets + horror objects (undead + cursed-land)
  craftpix-dungeon  — man-made props/structures (dungeon-objects, dungeon-props, guild-hall)
  craftpix-animals  — wildlife actors, directional sheets SLICED to per-direction strips

Only a subset of each download is taken (the pre-separated shadowed variant); see
docs/CRAFTPIX.md for the variant rule + per-pack record. Directional actor sheets
(animals, guild characters) are normalised to per-direction strips by slice.py so
the existing catalog/StripAnim pipeline handles them with no new schema.

Sources are the extracted CraftPix downloads (scratch stage + ~/Downloads). Raw
multi-row actor sheets are also copied under a `_src/` dir (excluded from the
catalog) so the slice step is re-runnable in-repo via slice.py.
"""
import json
import os
import re
import shutil

from slice import ANIMALS_DIRS, GUILD_DIRS, slice_columns, slice_directional

STAGE = ("/private/tmp/claude-502/-Users-matthew-langley-Work-mostowo-survival/"
         "5a901376-08be-4a80-a4a8-acbfad5056af/scratchpad/craftpix-stage")
TREES_HOME = os.path.expanduser(
    "~/Downloads/craftpix-net-385863-free-top-down-trees-pixel-art")
REPO = "/Users/matthew.langley/Work/mostowo-survival"
DEST_ROOT = os.path.join(REPO, "public/assets/tilesets")

DL = {
    "crystals": "craftpix-net-106469-top-down-crystals-pixel-art",
    "bushes": "craftpix-net-141354-free-top-down-bushes-pixel-art",
    "guild": "craftpix-net-189780-free-top-down-pixel-art-guild-hall-asset-pack",
    "dobjects": "craftpix-net-218281-free-pixel-art-dungeon-objects-asset-pack",
    "rockyarea": "craftpix-net-639143-free-rocky-area-objects-pixel-art",
    "dprops": "craftpix-net-665895-free-pixel-dungeon-props-and-objects-asset-pack",
    "undead": "craftpix-net-695666-free-undead-tileset-top-down-pixel-art",
    "animals": "craftpix-net-789196-free-top-down-hunt-animals-pixel-sprite-pack",
    "cursed": "craftpix-net-958568-free-cursed-land-top-down-pixel-art-tileset",
    "rocks": "craftpix-net-974061-free-rocks-and-stones-top-down-pixel-art",
    "chapel": "craftpix-net-477438-free-chapel-pixel-art-top-down-asset-pack",
    "workshop": "craftpix-net-692491-free-glassblowers-workshop-top-down-pixel-art-asset",
    "ruins": "craftpix-net-934618-free-top-down-ruins-pixel-art",
    "orc": "craftpix-net-363992-free-top-down-orc-game-character-pixel-art",
    "slime": "craftpix-net-788364-free-slime-mobs-pixel-art-top-down-sprite-pack",
    "home": "craftpix-net-654184-main-characters-home-free-top-down-pixel-art-asset",
    "magic": "craftpix-net-805745-free-magic-and-traps-top-down-pixel-art-asset",
}
LICENCE = ("Free for personal & commercial use, may be altered; assets may not be "
           "resold/redistributed standalone. See License.txt / "
           "https://craftpix.net/file-licenses/")


def png(key):
    return os.path.join(STAGE, DL[key], "PNG")


def pngdir_trees():
    return os.path.join(TREES_HOME, "PNG")


def content_root(key):
    """Some downloads nest under PNG/, some don't — return whichever holds art."""
    p = os.path.join(STAGE, DL[key], "PNG")
    return p if os.path.isdir(p) else os.path.join(STAGE, DL[key])


# ---- helpers ---------------------------------------------------------------
def copy_glob(src_dir, dest_dir, predicate=lambda f: True):
    os.makedirs(dest_dir, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(src_dir)):
        if f.lower().endswith(".png") and predicate(f):
            shutil.copy2(os.path.join(src_dir, f), os.path.join(dest_dir, f))
            n += 1
    return n


def copy_tree_png(src_dir, dest_dir):
    """Recursively copy every PNG under src_dir, preserving subfolders."""
    n = 0
    for dp, _dirs, fns in os.walk(src_dir):
        if "__MACOSX" in dp:
            continue
        for fn in fns:
            if not fn.lower().endswith(".png"):
                continue
            rel = os.path.relpath(dp, src_dir)
            out = dest_dir if rel == "." else os.path.join(dest_dir, rel)
            os.makedirs(out, exist_ok=True)
            shutil.copy2(os.path.join(dp, fn), os.path.join(out, fn))
            n += 1
    return n


def copy_named(src_dir, dest_dir, names):
    os.makedirs(dest_dir, exist_ok=True)
    n = 0
    for name in names:
        s = os.path.join(src_dir, name)
        if os.path.exists(s):
            shutil.copy2(s, os.path.join(dest_dir, name))
            n += 1
        else:
            print(f"    !! missing {name}")
    return n


def strip_suffix(fname):
    return re.sub(r"_with(out)?_shadow$", "", os.path.splitext(fname)[0]).strip()


def is_shadow_layer(fname):
    """A standalone shadow-only sprite (skip), not a `_without_shadow` art sheet."""
    stem = os.path.splitext(fname)[0].lower()
    return stem.startswith("shadow") or (
        stem.endswith("_shadow") and not stem.endswith("_without_shadow"))


def write_pack(pid, name, source_url, rules, exclude=None, overrides=None,
               licence_from=None):
    dest = os.path.join(DEST_ROOT, pid)
    pack = {
        "id": pid, "name": name, "author": "CraftPix.net",
        "sourceUrl": source_url, "licence": LICENCE, "tileSize": 16,
        "rules": rules, "overrides": overrides or {}, "exclude": exclude or [],
    }
    with open(os.path.join(dest, "pack.json"), "w") as fh:
        json.dump(pack, fh, indent=2)
        fh.write("\n")
    if licence_from:
        lic = os.path.join(png(licence_from), "..", "License.txt")
        if os.path.exists(lic):
            shutil.copy2(lic, os.path.join(dest, "License.txt"))


def slice_into(src_sheet, pack_id, src_rel_dir, out_rel_dir, base, cw, ch, dirs,
               overrides, *, by_column=False):
    """Copy raw sheet to `_src` (re-slice source) and write per-clip strips.

    `by_column=False` (default) slices ROWS into per-direction strips
    (`slice_directional`, rows = facings); `by_column=True` transposes COLUMNS
    into per-column horizontal strips (`slice_columns`, cols = separate anims,
    frames run top-to-bottom). Either way, records a `frames` override for any
    non-square-cell strip so the catalog plays the right frame count.
    """
    pack_dir = os.path.join(DEST_ROOT, pack_id)
    src_keep = os.path.join(pack_dir, src_rel_dir)
    os.makedirs(src_keep, exist_ok=True)
    shutil.copy2(src_sheet, os.path.join(src_keep, os.path.basename(src_sheet)))
    out_dir = os.path.join(pack_dir, out_rel_dir)
    cut = slice_columns if by_column else slice_directional
    for name, frames, non_square in cut(src_sheet, out_dir, base, cw, ch, dirs):
        if non_square:
            rel = os.path.join(out_rel_dir, name)
            overrides[rel] = {"frames": frames}


# ---- wipe old craftpix packs (the 11 flat ones + any prior 4-pack run) -----
for d in sorted(os.listdir(DEST_ROOT)):
    if d.startswith("craftpix"):
        shutil.rmtree(os.path.join(DEST_ROOT, d))

# ===========================================================================
# craftpix-nature — outdoor natural props (objects only)
# ===========================================================================
# No-shadow variants where they exist (nature props are shadowless like the
# wired pixel-crawler art). undead/cursed/rocky-area ship no clean no-shadow
# variant, so they stay shadowed — see docs/CRAFTPIX.md.
ROCK_RE = re.compile(r"^Rock[0-9]+_[0-9]+_no_shadow\.png$")
counts = {}
counts["Trees"] = copy_glob(os.path.join(pngdir_trees(), "Assets_separately/Trees"),
                            os.path.join(DEST_ROOT, "craftpix-nature", "Trees"))
counts["Bushes"] = copy_glob(os.path.join(png("bushes"), "Assets"),
                             os.path.join(DEST_ROOT, "craftpix-nature", "Bushes"))
counts["Crystals"] = copy_glob(os.path.join(png("crystals"), "Assets"),
                               os.path.join(DEST_ROOT, "craftpix-nature", "Crystals"))
counts["Rocks"] = copy_glob(os.path.join(png("rocks"), "Objects_separately"),
                            os.path.join(DEST_ROOT, "craftpix-nature", "Rocks"),
                            lambda f: bool(ROCK_RE.match(f)))
counts["RockyArea"] = copy_glob(os.path.join(png("rockyarea"), "Objects_separately"),
                                os.path.join(DEST_ROOT, "craftpix-nature", "RockyArea"),
                                lambda f: f.endswith("_grass_shadow.png"))
# Ruins: overgrown outdoor stone structures (variant-prop pack like trees/rocks).
counts["Ruins"] = copy_glob(os.path.join(png("ruins"), "Assets"),
                            os.path.join(DEST_ROOT, "craftpix-nature", "Ruins"))
write_pack("craftpix-nature", "CraftPix — Nature (trees, bushes, rocks, crystals)",
           "https://craftpix.net/freebies/free-top-down-trees-pixel-art/",
           {"tile": [], "strip": ["**/*-Sheet.png"]}, licence_from="bushes")
print("nature:", counts)

# ===========================================================================
# craftpix-undead — dark tilesets + horror objects (undead + cursed-land)
# ===========================================================================
copy_named(png("undead"), os.path.join(DEST_ROOT, "craftpix-undead", "Undead/Tiles"),
           ["Ground_rocks.png", "Water_coasts.png", "Details.png",
            "water_detilazation.png", "water_detilazation_v2.png"])
copy_named(png("undead"), os.path.join(DEST_ROOT, "craftpix-undead", "Undead/Fx"),
           [f"Animation{i}.png" for i in range(1, 7)])
un_obj = copy_glob(os.path.join(png("undead"), "Objects_separately"),
                   os.path.join(DEST_ROOT, "craftpix-undead", "Undead/Objects"))
copy_named(png("cursed"), os.path.join(DEST_ROOT, "craftpix-undead", "Cursed/Tiles"),
           ["Ground.png", "Water_coasts.png", "bridges.png", "spots.png",
            "details.png", "water_detilazation.png", "water_detilazation_v2.png"])
cu_obj = copy_glob(os.path.join(png("cursed"), "Objects_separetely"),
                   os.path.join(DEST_ROOT, "craftpix-undead", "Cursed/Objects"))
write_pack("craftpix-undead", "CraftPix — Undead & Cursed (tilesets + horror props)",
           "https://craftpix.net/freebies/free-undead-tileset-top-down-pixel-art/",
           {"tile": ["**/Tiles/**"], "strip": ["**/Fx/**", "**/*-Sheet.png"]},
           licence_from="undead")
print(f"undead: undead-objs={un_obj} cursed-objs={cu_obj}")

# ===========================================================================
# craftpix-dungeon — man-made props/structures (dungeon x2 + guild-hall)
# ===========================================================================
dungeon_overrides = {}
copy_named(png("dobjects"), os.path.join(DEST_ROOT, "craftpix-dungeon", "DungeonObjects"),
           ["pedestals.png", "supplies_objects.png", "Other_objects.png",
            "trap_saw.png", "trap_plate.png", "fire_trap.png"])
copy_named(png("dprops"), os.path.join(DEST_ROOT, "craftpix-dungeon", "DungeonProps"),
           ["Objects.png", "Arrow.png", "Bomb.png", "Cannon_main.png",
            "Guillotine.png", "Rotating_blades.png", "scull.png", "web.png",
            "Flasks_monsters.png"])
copy_named(png("guild"), os.path.join(DEST_ROOT, "craftpix-dungeon", "GuildHall/Env"),
           ["Exterior.png", "Walls_interior.png", "Walls_street.png",
            "Windows_doors.png", "Interior_objects.png", "Decorative_cracks.png"])
copy_named(png("guild"), os.path.join(DEST_ROOT, "craftpix-dungeon", "GuildHall/Fx"),
           ["Fire.png", "Flags_animation.png"])
# guild characters: multi-row -> sliced; single-row -> passthrough
GUILD_SLICE = [
    ("Citizen1_Idle_without_shadow.png", 32, 32),
    ("Citizen1_Walk_without_shadow.png", 32, 32),
    ("Citizen2_Idle_without_shadow.png", 32, 32),
    ("Citizen2_Walk_without_shadow.png", 32, 32),
    ("Fighter2_Idle_without_shadow.png", 32, 32),
    ("Fighter2_Walk_without_shadow.png", 32, 32),
    ("Fighter_sword_without_shadow.png", 64, 64),
    ("Mage1_without_shadow.png", 64, 52), ("Mage2_without_shadow.png", 64, 52),
    ("Mage3_without_shadow.png", 64, 52), ("Mage4_without_shadow.png", 64, 52),
    ("Attacked_Manequin1_without_shadow.png", 32, 32),
    ("Attacked_Manequin2_without_shadow.png", 32, 32),
    ("Attacked_Manequin3_without_shadow.png", 32, 32),
]
# Guildmaster/Reader ship only one form (no _without_shadow variant).
GUILD_PASSTHROUGH = ["Guildmaster.png", "Talking_person1_without_shadow.png",
                     "Talking_person2_without_shadow.png",
                     "Talking_people_without_shadow.png", "Reader1.png", "Reader2.png"]
for fname, cw, ch in GUILD_SLICE:
    slice_into(os.path.join(png("guild"), fname), "craftpix-dungeon",
               "GuildHall/_src", "GuildHall/Characters", strip_suffix(fname),
               cw, ch, GUILD_DIRS, dungeon_overrides)
copy_named(png("guild"), os.path.join(DEST_ROOT, "craftpix-dungeon", "GuildHall/Characters"),
           GUILD_PASSTHROUGH)
# Chapel — env sheets + static props + pre-separated character strips (CraftPix
# already ships these per-direction, so no slicing needed). Irregular "packed"
# sheets (Parishioner*_packed) + the Dragon are skipped.
dch = png("chapel")
copy_named(dch, os.path.join(DEST_ROOT, "craftpix-dungeon", "Chapel/Env"),
           ["Exterior.png", "Walls_Interior.png", "Walls_street.png",
            "Interior_objects.png", "Decorative_cracks.png"])
copy_named(os.path.join(dch, "Animation"),
           os.path.join(DEST_ROOT, "craftpix-dungeon", "Chapel/Props"),
           ["Altar.png", "Candelabra.png", "Candelabra_alternative_fit.png", "Candles.png"])
ch_chars = copy_glob(os.path.join(dch, "Animation_packed/Monks/Monks_without_shadow"),
                     os.path.join(DEST_ROOT, "craftpix-dungeon", "Chapel/Characters"))
ch_chars += copy_glob(os.path.join(dch, "Animation_packed/Priest"),
                      os.path.join(DEST_ROOT, "craftpix-dungeon", "Chapel/Characters"))
# Workshop — env sheets + fx animations + NPC strips (Customer/Seller are single
# rows; Master is a packed sheet, imported as-is to browse, tune grid in-editor).
dws = png("workshop")
copy_named(dws, os.path.join(DEST_ROOT, "craftpix-dungeon", "Workshop/Env"),
           ["Exterior_house.png", "Walls_interior.png", "Walls_street.png",
            "Interior_objects.png", "Forge.png", "Decorative_cracks.png"])
copy_named(dws, os.path.join(DEST_ROOT, "craftpix-dungeon", "Workshop/Fx"),
           ["Doors_windows_animations.png", "Light_animation.png"])
ws_chars = copy_named(dws, os.path.join(DEST_ROOT, "craftpix-dungeon", "Workshop/Characters"),
                      ["Customer_without_shadow.png", "Seller.png",
                       "Master_without_shadow.png", "Master_Idle_without_shadow.png"])
# Home — the player's base/home set (building sheets + ambient critter/tree anims).
dhome = content_root("home")
copy_named(dhome, os.path.join(DEST_ROOT, "craftpix-dungeon", "Home/Env"),
           ["exterior.png", "ground_grass_details.png", "house_details.png",
            "Interior.png", "walls_floor.png"])
copy_named(dhome, os.path.join(DEST_ROOT, "craftpix-dungeon", "Home/Fx"),
           ["bird_fly_animation.png", "bird_jump_animation.png", "cat_animation.png",
            "Smoke_animation.png"])
# Trees_animation.png packs 9 tree anims as VERTICAL columns (each column's 13
# sway frames run top-to-bottom) on a 9x13 grid of 64x80 cells — the opposite of
# our horizontal-strip model. Transpose each column into a per-tree horizontal
# strip (labels = 3 species x 3 sizes). Raw sheet kept under Home/Fx/_src.
TREE_LABELS = ["green_lg", "green_md", "green_sm", "apple_lg", "apple_md",
               "apple_sm", "dark_lg", "dark_md", "dark_sm"]
slice_into(os.path.join(dhome, "Trees_animation.png"), "craftpix-dungeon",
           "Home/Fx/_src", "Home/Fx", "Trees_animation", 64, 80, TREE_LABELS,
           dungeon_overrides, by_column=True)
# Magic & Traps — base-defense props (spikes, barricades w/ build-destroy, lightning,
# barrels). Numbered source folders renamed to clean names; kept as objects.
dmagic = content_root("magic")
n_traps = 0
for srcname, clean in {"1 Spikes": "Spikes", "2 Barricades": "Barricades",
                       "3 Lightning": "Lightning", "4 Barrel": "Barrel"}.items():
    s = os.path.join(dmagic, srcname)
    if os.path.isdir(s):
        n_traps += copy_tree_png(s, os.path.join(DEST_ROOT, "craftpix-dungeon", "Traps", clean))
print(f"chapel: chars={ch_chars}  workshop: chars={ws_chars}  home+traps: traps={n_traps}")
write_pack("craftpix-dungeon", "CraftPix — Structures, Props, NPCs & Defenses (dungeon, guild, chapel, workshop, home, traps)",
           "https://craftpix.net/freebies/free-pixel-art-dungeon-objects-asset-pack/",
           {"tile": [], "strip": ["**/Characters/**", "**/Fx/**", "**/*-Sheet.png"]},
           exclude=["**/_src/**"], overrides=dungeon_overrides, licence_from="dobjects")
print(f"dungeon: guild sliced={len(GUILD_SLICE)} passthrough={len(GUILD_PASSTHROUGH)} "
      f"overrides={len(dungeon_overrides)}")

# ===========================================================================
# craftpix-creatures — wildlife + mobs, directional sheets SLICED
# ===========================================================================
MOB_DIRS = ["down", "left", "right", "up"]  # humanoid/mob order (orc, slime)
# (src_dir, subfolder, cellW, cellH, dirs) — every directional actor source.
creature_groups = []
an_root = os.path.join(png("animals"), "Without_shadow")
for animal in sorted(os.listdir(an_root)):
    if os.path.isdir(os.path.join(an_root, animal)):
        creature_groups.append((os.path.join(an_root, animal), animal, 32, 32, ANIMALS_DIRS))
for oc in ["Orc1", "Orc2", "Orc3"]:
    d = os.path.join(content_root("orc"), oc, "Without_shadow")
    if os.path.isdir(d):
        creature_groups.append((d, oc, 64, 64, MOB_DIRS))
for sc in ["Slime1", "Slime2", "Slime3"]:
    d = os.path.join(content_root("slime"), sc, "Without_shadow")
    if os.path.isdir(d):
        creature_groups.append((d, sc, 64, 64, MOB_DIRS))

creatures_overrides = {}
n_sheets = 0
for src_dir, sub, cw, ch, dirs in creature_groups:
    for f in sorted(os.listdir(src_dir)):
        if not f.lower().endswith(".png") or is_shadow_layer(f):
            continue
        slice_into(os.path.join(src_dir, f), "craftpix-creatures",
                   f"_src/{sub}", sub, strip_suffix(f), cw, ch, dirs, creatures_overrides)
        n_sheets += 1
write_pack("craftpix-creatures", "CraftPix — Creatures (wildlife + mobs, sliced directional strips)",
           "https://craftpix.net/freebies/free-top-down-hunt-animals-pixel-sprite-pack/",
           {"tile": [], "strip": ["**/*.png"]},
           exclude=["**/_src/**"], overrides=creatures_overrides, licence_from="animals")
print(f"creatures: sheets sliced={n_sheets} overrides={len(creatures_overrides)}")
print("DONE")
