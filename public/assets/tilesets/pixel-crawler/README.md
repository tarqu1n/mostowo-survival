# Pixel Crawler — Free Pack (v2.11)

Candidate replacement base art for Mostowo Survival — see [`docs/ASSETS.md`](../../../../docs/ASSETS.md)
for where this fits the art pipeline. A **top-down 16×16 medieval-fantasy RPG** pack by
**Anokolisa** (a.k.a. AnomalyPixel).

- **Source:** <https://anokolisa.itch.io/free-pixel-art-asset-pack-topdown-tileset-rpg-16x16-sprites>
- **Licence:** [`Terms.txt`](./Terms.txt) (author's own terms). Summary: free for commercial/study/any
  project; may be freely altered; **credit optional but appreciated**; **may not be resold** as a
  standalone or final-product asset (only the author may sell the art). Keep `Terms.txt` alongside
  these files if this repo/build goes public. Anokolisa sells larger paid packs in the same style —
  if this one works out, more can be slotted in beside it (same grid, same conventions).

## ⚠️ Theme note (read before wiring in)

This is **medieval fantasy** (knights, orcs, skeletons, taverns, anvils, bonfires), **not** the
current zombie-apocalypse art. It was chosen for its **higher art quality and better-fitting style**,
accepting that it's **not grim-dark enough yet** — the plan is to push it darker later by adding
grimmer tiles/props/recolours and lighting (see `demo2_camp_night.png` below for a proof that a
fire-lit night pass gets most of the way there in-engine). Treat orcs/skeletons as stand-ins that
can be reskinned to the survival/zombie fiction, or lean into a light re-theme. This is a swap of the
*art*, not (yet) a decision to change the game's story.

## Grid & frame sizes

| Thing | Size | Notes |
|---|---|---|
| **Terrain tiles** | **16×16** | matches this repo's `TILE_SIZE` in `src/config.ts` |
| **Mobs & NPCs** (Orc/Skeleton/Knight/Rogue/Wizzard) | **32×32** frames | 2 tiles tall; horizontal `-Sheet.png` strips |
| **Body_A player base** | **64×64** frames | big canvas w/ padding for weapon-swing arcs |
| **Citizen_F NPCs** (Peasant/Tavern) | **64×64** frames | as Body_A |
| **Props / trees / structures** | multi-tile objects | whole sprites, not single tiles |

## What's here (181 PNGs)

Only the **PNGs** the game loads were copied in — **the `.aseprite` editable source was left out**
(repo convention; matches how the zombie pack dropped its `.psd`s). Re-extract the original itch.io
zip if you need to hand-edit/recolour layers.

**Two things are aseprite-only and therefore MISSING from this copy:**
- `Icons/Resources.aseprite` — the item/resource **icon** sheet has no PNG export. Needs Aseprite
  (`aseprite -b Resources.aseprite --save-as ...`) to get PNGs.
- `Entities/Characters/New_Version/` — a newer player character, aseprite-only. Body_A (below) is the
  usable player base.

### Entities (85 PNGs)

- **`Characters/Body_A/Animations/`** — the **player base body** (a nude/skin base designed to be
  layered under equipment), 14 animation states as `<State>_<Dir>-Sheet.png` strips (64×64 frames):
  `Idle Walk Run Death Hit` + actions `Collect Crush Fishing Pierce Slice Watering` + carrying set
  `Carry_Idle/Run/Walk`. Directions: `Down / Side / Up` (flip Side for left/right).
- **`Mobs/`** — 8 enemies as `Idle / Run / Death` strips (32×32): **Orc Crew** = Orc, Orc-Rogue,
  Orc-Shaman, Orc-Warrior; **Skeleton Crew** = Skeleton-Base, -Mage, -Rogue, -Warrior.
- **`Npc's/`** — `Knight`, `Rogue`, `Wizzard` (32×32, Idle/Run/Death) and **`Citizen_F/`**
  (64×64: `Peasant_A`, `Tavern_A`, `Tavern_B` with Idle/Walk + `_Hold` variants).

### Environment (92 PNGs)

- **`Tilesets/`** — the **blob autotiles** (see below): `Floors_Tiles`, `Wall_Tiles`,
  `Wall_Variations`, `Water_tiles`, `Dungeon_Tiles`.
- **`Props/Static/`** — multi-object sheets: `Trees/` (Model_01–03 × Size_02–05), `Vegetation`
  (bushes, ferns, flowers, mushrooms, **collectible gems**), `Rocks` (boulders → pebbles + blue
  crystals), `Resources` (**coal/ore, logs, planks, straw, crates** — survival-crafting drops),
  `Furniture`, `Tools`, `Farm`, `Meat`, `Dungeon_Props`, `Esoteric`, `Shadows`.
- **`Props/Animated/`** — `Pan_01–05` frame strips.
- **`Structures/Buildings/`** — modular `Walls` (log/brick/plaster + windows), `Roofs`, `Props`,
  `Interior/`.
- **`Structures/Stations/`** — crafting stations, many animated: `Bonfire/` (+ `Fire`, `Smoke`),
  `Cooking Station/` (`Cooker`, `Grill`, `Butchery`), `Anvil`, `Furnace`, `Alchemy`, `Sawmill`
  (Level_1–3), `Workbench`. Great fit for the base-building pillar.

### Weapons (3) — `Bone.png`, `Wood.png`, `Hands.png` (multi-object sheets of weapon sprites).

### MockUps (1) — `Tavern.png`, the **author's own example map**. Open this first to see the
intended look and how interiors/exteriors are stitched.

## How the pieces stitch together

### 1. Terrain = "blob" autotiles

`Floors_Tiles`, `Wall_Tiles`, `Water_tiles`, `Dungeon_Tiles` are **blob autotile templates**, not
flat tile rows. Each terrain is a ring/patch where border tiles carry the rounded edge and the
*fully-surrounded centre* tile is the seamless fill. Pick the centre tile for solid fills; use the
edge/corner tiles where two terrains meet. Numbered grids for reading exact indices:
[`docs/assets/pixel-crawler/reference/`](../../../../docs/assets/pixel-crawler/reference/)
(`floors-blob-grid.png`, `walls-blob-grid.png`, `dungeon-grid.png`).

**Verified seamless fill tiles** (col,row @16px), ready to drop as solid ground:

| Terrain | Sheet | (col,row) |
|---|---|---|
| Grass | `Floors_Tiles` | **(2,10)** |
| Dirt / sand path | `Floors_Tiles` | **(5,24)** |
| Snow | `Floors_Tiles` | (1,24) |
| Water | `Water_tiles` | **(2,7)** |
| Stone-wall (brown) | `Wall_Tiles` | (2,20) top · (2,22) floor |
| Dungeon floor (brick) | `Dungeon_Tiles` | (9,14) · dark (8,1) |

`Floors_Tiles` stacks four terrains left→right (grass · grey gravel · brown dirt · grey brick) with
snow + sand blobs and solid-fill rows lower down. `Water_tiles` top row = grass↔water shore islands;
below = solid water. `Wall_Tiles`/`Wall_Variations` are top-down **cliff/plateau** blobs in 3 colour
variants (brown/grey/dark) with grass + water/snow footings.

**Assembling an enclosed room:** `Wall_Tiles` rows **20–24** are a *concave* set (walls facing inward
around a dark floor). Tiling corner/edge/floor cells from that block makes an arbitrary-size walled
room — this is exactly how `demo3_ruins.png` was built (`pit_room()` in the compositor).

**Autotiler (implemented):** [`scripts/pixel-crawler/autotile.py`](../../../../scripts/pixel-crawler/autotile.py)
classifies each blob tile by its edge+corner **alpha connectivity** into an **8-neighbour key**, then
paints any terrain mask by looking the key up per cell (multiple tiles per key → picked for variety;
graceful fallback for gaps). Terrain block bounds it uses: **grass** `Floors` cols 0–4, **dirt**
`Floors` cols 11–15, both rows 0–12. It **colour-gates** each block (drops any tile whose opaque
pixels stray from the terrain's median colour) so an adjacent block sharing the bounding box (e.g. the
grey brick beside the brown dirt) can't bleed in. Layering model: paint an opaque **grass base** (its
6 fill variants at cols 1–3 give natural variation), then paint **dirt on top** — dirt's blob edges
carry alpha, so they blend over grass with smooth rounded edges *and* concave inner corners. The demo
maps use this; the grass/dirt transitions there are real autotiling, not hand-painted.

### 2. Props / trees / rocks = whole objects on shared sheets

`Vegetation.png`, `Rocks.png`, `Resources.png`, `Trees/*` etc. pack **many independent objects** into
one PNG. Extract each by **connected-component bounding box** (opaque-pixel islands) rather than a
fixed grid — sizes vary (a boulder is 28×43, a pebble 8×6, a tree ~37×76). The compositor's
`objects.components()` does this; numbered contact sheets with every object's index + pixel size are in
[`reference/`](../../../../docs/assets/pixel-crawler/reference/) (`objects-trees/vegetation/rocks/resources.png`).
Handy indices: Trees Model_02/Size_03 → `0,1`=teal pine, `3,4`=green pine, `2`=dead tree; Rocks →
`1,4`=boulders, `46,47`=blue crystals; Resources → `1`=coal, `17`=log, `20`=plank, `23`=straw,
`29`=crate.

### 3. Characters / mobs / animated stations = horizontal frame strips

Anything named `*-Sheet.png` is a left-to-right animation strip. Frame count = `width / frameHeight`
(frames are square for mobs/Body_A; some stations aren't — check dims). Load with Phaser's
`load.spritesheet(key, path, { frameWidth, frameHeight })`, then `anims.create()`. Static multi-object
sheets (e.g. `Cooker_01.png`, `Anvil.png`) use `load.image` + component extraction.

## Using in Phaser (mirrors the zombie pack)

- Files live under `public/…`, so Vite serves them at
  `<BASE_URL>assets/tilesets/pixel-crawler/…` — respect the `base` in `vite.config.ts`, don't hardcode
  a leading `/`.
- **Don't bulk-load all 181 files.** Cherry-pick per feature: `load.image` for a fill tile / static
  prop, `load.spritesheet` for an animation strip. Consider packing the frames you actually use into a
  `load.atlas` once the set is known.
- The existing swappable manifest in `src/data/tileset.ts` (`ACTIVE_TILESET`) is the seam — point it
  here to trial the pack without touching game logic.

## Demos (stitched by me to prove coherent use)

Rendered scenes built **only** from this pack's real tiles/objects (no repainting):
[`docs/assets/pixel-crawler/demos/`](../../../../docs/assets/pixel-crawler/demos/)

1. **`demo1_camp_day.png`** — a big forest clearing: **autotiled** grass (6 fill variants, natural
   variation) with a **smooth-edged dirt path + camp clearing** (real blob transitions, rounded outer
   *and* concave inner corners), a naturally-thinning **forest border** of size/colour-varied trees, a
   survivor by a bonfire + cooking pot + workbench with chopped logs/planks/crate/coal (the wood→base
   loop), plus scattered tufts/flowers/mushrooms/rocks.
2. **`demo2_camp_night.png`** — same map through a **grim-dark night pass** (cool darken + warm fire
   glow + vignette): the "safe ring of firelight in a dark forest" survival mood. Shows how far a
   lighting layer gets us toward the grim tone in-engine.
3. **`demo3_ruins.png`** — a walled **stone enclosure** (blob wall autotiles) in an autotiled forest
   clearing, a lone knight cornered by skeletons + orcs with crystals and rubble — the game's core
   conflict, fantasy-reskinned.

Regenerate on any machine (needs `python3` + `pillow` + `numpy`):
`python3 scripts/pixel-crawler/compose_demos.py` — see
[`scripts/pixel-crawler/README.md`](../../../../scripts/pixel-crawler/README.md).
