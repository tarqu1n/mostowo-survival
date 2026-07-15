# Assets & Art Pipeline

How we make and manage art. Direction lives in [GAME-DESIGN.md](GAME-DESIGN.md#art-direction);
this is the *how*.

## Art direction (summary)

**Slightly dark and grotty, but humorous.** Grimy survival-horror palette, comic item/enemy visuals,
visual gags. Readable at small pixel sizes. Consistent base resolution + nearest-neighbour scaling.

## Approach (phased)

1. **Placeholder-first.** Coloured rects / programmatic tiles so mechanics get built fast (decided —
   see DECISIONS.md). Art is *not* on the critical path for the MVP slice.
2. **Free CC0 tilesets** to make it look game-like quickly without drawing everything (see shortlist).
3. **Gemini-generated bespoke assets** for characterful, on-theme items/enemies where stock art
   doesn't fit the dark-comic identity.

## Zombie Apocalypse tileset — retired, reference fallback (2026-07-11)

**[Zombie Apocalypse Tileset](https://ittaimanero.itch.io/zombie-apocalypse-tileset)** by Ittai
Manero, staged at
[`public/assets/tilesets/zombie-apocalypse/`](../public/assets/tilesets/zombie-apocalypse/) (see
that folder's own `README.md` for the category index + Phaser loading notes). Was the original
chosen base tileset — 16×16, matches `TILE_SIZE`, on-theme (post-apoc scenery, zombies, weapons,
UI) — and wired in through plan 003: ground/wall/tree tiles, the player's walk cycle, the kid
zombie's walk + damaged-reaction frames.

**Retired by plan 005**: `ACTIVE_TILESET` now points at Pixel Crawler (below); the
`ZOMBIE_APOCALYPSE_TILESET` const was removed from `src/data/tileset.ts` (git history + this doc
retain the record). Files **stay under `public/assets/tilesets/zombie-apocalypse/`** as
reference/fallback art — not deleted, just unwired. Escape hatch to make it runnable again under
the new strip-only actor-anim schema (montage its per-frame PNGs into horizontal strips) is noted
in DECISIONS.md — not done.

Licence is not CC0 — free for personal + commercial use, credit appreciated, no redistributing the
assets themselves standalone. Full terms in that folder's `LICENSE.md`; keep it alongside the
assets if this repo or a build ever goes public.

## Active tileset — Pixel Crawler (wired in, plan 005)

**[Pixel Crawler — Free Pack
v2.11](https://anokolisa.itch.io/free-pixel-art-asset-pack-topdown-tileset-rpg-16x16-sprites)** by
Anokolisa is the **active** pack: `src/data/tileset.ts` exports `PIXEL_CRAWLER_TILESET` and
`ACTIVE_TILESET = PIXEL_CRAWLER_TILESET`. Staged at
[`public/assets/tilesets/pixel-crawler/`](../public/assets/tilesets/pixel-crawler/) — **that
folder's `README.md` is the full index** (grid sizes, category counts, blob-autotile fill tiles,
object-extraction indices, Phaser loading). Downloaded, unzipped (PNGs only; `.aseprite` source
left out per convention), visually catalogued, and **stitched into 3 demo maps** to prove coherent
use: [`docs/assets/pixel-crawler/demos/`](assets/pixel-crawler/demos/).

Decision context (why it replaced the zombie pack):

- **Style fits better** than the zombie pack and is higher quality — *accepted trade-off:* it's
  **medieval-fantasy** themed (knights/orcs/skeletons/anvils/bonfires), not zombie/modern.
- Matt's call (2026-07-11): keep this art even though it's **not grim-dark enough yet**; darken it
  *later* by adding grimmer tiles/props/recolours + lighting. `demo2_camp_night.png` is a proof that a
  fire-lit night pass gets most of the way there in-engine. So: swap the *art*, treat the fantasy mobs
  as reskinnable stand-ins — not (yet) a story change.
- 16×16 terrain grid (matches `TILE_SIZE`), 32×32 mobs/NPCs, 64×64 layerable player base + crafting
  **stations** (bonfire/cooking/anvil/sawmill/workbench) that suit the base-building pillar.
- **If it works out, buy more of Anokolisa's paid packs** in the same style (same grid/conventions).
- Licence (`Terms.txt`): free commercial use, alter freely, credit optional, **no reselling the assets
  standalone**.

Reproducible tooling for the catalogue/demos: [`scripts/pixel-crawler/`](../scripts/pixel-crawler/).

### Sprite extraction pipeline

Every Pixel Crawler PNG loads one of 3 ways — mechanical rule, no per-file judgement calls:

|Class|Rule|Load|
|---|---|---|
|**Grid tilesheet**|under `Environment/Tilesets/`|`load.spritesheet` @ 16px, address by frame index|
|**Animation strip**|filename ends `-Sheet.png`|`load.spritesheet` @ frameSize = sheet height|
|**Multi-object sheet**|everything else (`Props/Static/*`, static `Structures/{Stations,Buildings}` props, `Weapons/*`)|can't grid-slice — extract the one object you want by connected-component bbox → a derived PNG|

**Detection** (run this whenever the pack updates or you add a new sheet): a file that is *not*
`*-Sheet.png` and *not* under `Environment/Tilesets/` is a multi-object candidate. Run `--scan`;
**>1 varying-size connected component ⇒ multi-object, needs extraction** before it can be used
in-game (a single component ⇒ already a clean static prop, `load.image` in-place, no extraction
needed).

**Tooling:** [`scripts/pixel-crawler/extract.py`](../scripts/pixel-crawler/extract.py) wraps
`objects.py`'s `components()`/`crop()`/`preview_components()`.

```sh
# Preview a sheet's components (index · bbox · pixel size) before picking one.
python3 scripts/pixel-crawler/extract.py --list "Environment/Props/Static/Trees/Model_02/Size_03.png"

# Crop component <index> and save under public/assets/tilesets/pixel-crawler/<out-rel>.
python3 scripts/pixel-crawler/extract.py "Environment/Props/Static/Trees/Model_02/Size_03.png" 3 _derived/tree_pine.png

# Walk the whole pack (or a subdir) and flag every multi-object sheet — report-only, extracts nothing.
python3 scripts/pixel-crawler/extract.py --scan
```

All three accept `--alpha-thresh` / `--gap` / `--min-area` if a component comes out merged or split
(same tunables as `objects.components()`).

**Rescan-when-assets-change procedure:** after dropping in an updated/re-downloaded pack (files stay
in place, same names — see the load-in-place rule below), re-run `--scan`, diff against the manifest
below, and extract any *newly*-flagged multi-object sheet you actually need for a feature. Don't
extract speculatively — only what's wired into the game.

**Load-in-place rule:** the pack's own folder/file names are never changed, so a re-downloaded pack
drops straight back in. The only new files this pipeline adds live under `_derived/` (a `_`-prefixed
dir a pack re-extract won't clobber) — reproducible any time via the commands above, so nothing there
needs to be treated as precious.

**Derived-file manifest** (`output ← source sheet · component index`):

|Output|Source sheet|Index|
|---|---|---|
|`_derived/tree_pine.png`|`Environment/Props/Static/Trees/Model_02/Size_03.png`|3|
|`_derived/rock.png`|`Environment/Props/Static/Rocks.png`|5|
|`_derived/weapons/club.png`|`Weapons/Bone/Bone.png`|1 (bone mace, grip at bottom; `sips -Z 40` → 7×40)|
|`_derived/weapons/knife.png`|`Weapons/Bone/Bone.png`|7 (bone dagger, grip at bottom; `sips -Z 18` → 4×18)|
|`_derived/hand.png`|`Weapons/Hands/Hands.png`|4 (brown gloved fist, 8×7 — the **off** hand; a leather-glove look chosen over the tan idx-0 fist, which read as bare human skin on a skeleton. Sheet has 6 styles × L/R pairs: idx 0/2 tan fist/palm, 4/6 brown fist/palm, 8/10 green orc fist/palm. See "Weapon attachment" below)|
|`_derived/hand_open.png`|`Weapons/Hands/Hands.png`|7 (brown open palm, 7×6 — the **main** (weapon-gripping) hand, distinct from the off-hand fist so the pair isn't two identical hands; tilted 14° in-engine to wrap the raised weapon. See "Weapon attachment" below)|

> The two bone weapons are extracted big (80/27px) then downscaled to sit proportionately on the
> ~30px skeleton (club distinctly larger than the knife). They draw at integer scale 1 from these
> baked sizes — the one exception to "no non-integer scaling" is this one-time downsample bake, not a
> per-frame draw scale. Regenerate: re-run `extract.py` (idx 1 / 7) then the `sips -Z` above.

The rock is wired as the `rock` tile role (`ACTIVE_TILESET.tiles.rock`), rendering the `rock`
resource node that yields stone (plan 008). Other multi-object sheets (`Vegetation`, `Resources`,
`Furniture`, `Tools`, …) are future candidates per `--scan` — not extracted this pass.

### The art swap — concrete frames wired (plan 005)

The game-facing narrative (this section is the *what got wired*; extraction mechanics are above,
not repeated here):

- **Ground:** `Floors_Tiles.png` frames 252/251/253 (weighted, grass).
- **Wall:** `Wall_Tiles.png` frame **83** (grey stone fill, grid (8,3)) — corrects the plan's
  original guess of frame 502/(2,20), which turned out to be a dark dungeon fill, not grey stone.
- **Tree:** `_derived/tree_pine.png` (extracted per the pipeline above).
- **Player:** Body_A Idle/Walk strips × Down/Side/Up (64px frames) — full 3-way directional
  facing; Side art faces right, mirrored `flipX` for left, driven by `lastFacing`.
- **Player action swings** (added post-005): each maps to the Body_A melee motion that reads right
  for the job — **chop** = `Slice_Base` (side-swing axe, loops while felling a tree), **mine** =
  `Crush_Base` (overhead smash → pickaxe on a rock, loops while mining), **punch** = `Pierce_Base`
  (weapon thrust → the character holds a sword, so it's the combat swing, one-shot per Punch press)
  — each ×Down/Side/Up, 8×64px. `Pierce` ships its up strip as `Pierce_Top-Sheet.png` (not `_Up`),
  captured in the manifest's explicit paths. The Body_A rig ships no literal chop/mine/punch strip,
  so these are the closest motions, treated as reskinnable stand-ins. Wired as `PlayerState`s
  (`idle`|`walk`|`chop`|`mine`|`punch`) sharing the one `playerAnimKey`/render footprint; action
  swings run at `ACTION_ANIM_FRAMERATE` (config) so a hit lands ≈ once per `CHOP_INTERVAL_MS`.
  GameScene picks chop vs mine from the harvested node's `tile` role (rock → mine, else chop).
- **Enemy** (kid zombie data id, unchanged): Skeleton (Base) `Run/Run-Sheet.png` (64px, 6 frames)
  stands in for the sprite; single-orientation, frame 0 = idle, flips by movement-x only — mob
  sheets in this pack ship no directional variants. Its `Death/Death-Sheet.png` is wired too — a
  one-shot collapse played on kill (`enemyDeathKey`), single-orientation like Run. **Its cells are
  96×64, not 64² like Run** (the collapse needs horizontal room): the skeleton is centred in a wider
  frame, so it's declared `frameSize: 64, frameWidth: 96, frames: 8`. Slicing it at the square 64 (the
  first wiring did) lands the cuts *between* real frames — every 3rd slice is empty (flicker) and the
  content jumps left/right (apparent "flying"); `StripAnim.frameWidth` exists for exactly this. The
  pack ships **no skeleton attack strip**, so a zombie's bite is a coded lunge, not a sprite anim (see
  docs/RENDERING.md / the combat-feedback STATUS entry).
- **Player gather swing (added in plan 004):** a new `gather` `PlayerState` maps to the pack's
  `Collect_Base` strips (`Collect_{Down,Side,Up}-Sheet.png`, 8×64px) — foraging a berry bush plays
  this, distinct from the chop/mine swings above.
- **Death collapse (both actors):** the player's `death` `PlayerState` maps to `Death_Base`
  (`Death_{Down,Side,Up}-Sheet.png`, 8×64px, 3-way — `up` ships as `Death_Up`, not the `_Top` oddity
  `Pierce` has), a one-shot collapse held on its last downed frame while the scene restarts; the
  skeleton uses its single-orientation `Death-Sheet.png` (above). Both are one-shot (`repeat: 0`) at a
  slower `DEATH_ANIM_FRAMERATE` so they read as a fall, not a twitch.

- **Campfire station (plan 012):** `Environment/Structures/Stations/Bonfire/Fire_01-Sheet.png`
  (128×48 = 4 frames of 32w×48h; the vertical `Bonfire.png` in the same folder can't be strip-sliced)
  wired as the looping `campfire` texture (`campfireAnimKey()`, `TilesetManifest.stations.campfire`) —
  texture load only this step; the `anims.create` registration is a later plan-012 step.

**Berry *bush* is still placeholder art (plan 004), not a Pixel Crawler frame:**
`_derived/bush.png` is baked by `scripts/placeholder-art.mjs` (same coloured-rect-placeholder
pattern as plan 008's item icons). The **`berries` item icon is now real** — Gemini-generated via
the plan 009 pipeline (see "Item icons" below). The bush is a world prop, not an item icon, so it's
out of scope for `scripts/gen-icons/` and still awaits the environment-art path.

Manifest schema reshaped to roles: a `TileSource` union (`{kind:'image'}` standalone PNGs,
`{kind:'sheetFrame'}` indexed frames of a 16px-sliced sheet) plus `StripAnim`/`ActorRender` for
actors — see `src/data/tileset.ts`.

Verified: `npm run build` clean, `npm run smoke` (33/33, no console errors), manual screenshot
check of grass/tree/wall/directional-player/skeleton.

### Weapon attachment (runtime pinning, plan 011)

Monster weapons (club/knife) are held via **runtime anchor-pinning**, not baked per-frame art.
`StripAnim.anchors` (`src/data/tileset.ts`) carries per-frame `AttachPoint {x,y,rot?}` arrays in the
frame's own pixel space, keyed by slot — `mainHand` (the weapon-gripping hand) and `offHand` (the
free hand). The enemy's `idle` (4 frames, 32px canvas) and `walk`/Run (6 frames, 64px canvas) strips
each carry their own set, since an anchor array is only meaningful relative to a specific strip's
frames. Every tick the pure `weaponTransform` (`src/systems/attachment.ts`) resolves the active
frame's anchor through the strip's render footprint into a world-px offset/angle, and
`GameScene.syncZombieAttachments` repositions the pinned sprites — every update tick, not on
`animationupdate`, because lunge/veer tweens slide the sprite between frame changes.
Swapping/randomising a weapon is then just re-pointing which sprite is pinned — zero baked art per
weapon. The attack "swing" is a coded tween (rotate the pinned weapon about its grip = the mainHand
anchor, so the gripping fist stays put) rather than a sprite animation, since the pack ships no mob
attack strip — see `WEAPON_SWING_*` in `config.ts`.

**Hand layer.** The Base skeleton's own hands are unreadable nubs (crossed-forearm pixels that
vanish at game scale — the pack's promo art composites visible hands + weapons on top). So two
**distinct** hands (`actors.enemy.hand`) are pinned to the anchors every tick, so the pair reads as a
real left + right instead of two identical fists (the bug the single-image version had): the **off
hand** is the brown gloved fist (`_derived/hand.png`, idx 4 — reads as the correct hand, thumb on the
outside, un-flipped, so `offFlip` is left off); the **main hand** is an **open grip** (`mainSource` =
`_derived/hand_open.png`, idx 7) that wraps the raised weapon, tilted by `mainRot` (14°, negated with
the body) to follow the blade. `mainHand` grips the weapon (drawn over it via `mainZ`); `offHand` is the free fist beside the
body (`offZ`). The main hand sits at the SAME anchor as the weapon, so it stays put while the weapon
arcs about it. Both hands render whether or not the mob is armed; they're destroyed with the weapon on
death (the 96px Death strip carries no anchors). The `mainHand` anchor `rot` also leans the resting
weapon forward off the skull, so it reads as held-out, not held-to-the-face.

Weapon **ART** (source image — extracted per the pipeline above, see the `club`/`knife` derived-file
rows in the manifest table above — plus grip `pivot` and draw `z`) lives in the manifest
(`actors.enemy.weapons`); weapon **GAMEPLAY** (damage, attack cadence) lives solely in
`src/data/weapons.ts` (`MONSTER_WEAPONS`), joined by a shared weapon id — no stat duplicated in the
art manifest.

**Idle footprint:** the skeleton's Idle sheet is 128×32 = 4 frames of 32px, half the 64px Run
canvas, so it's wired with its own `StripAnim.render` override (`scale:2`, low `originY`) instead of
inheriting the actor default — see the `ActorRender`/`StripAnim.render` doc in `tileset.ts`.

Full decision rationale (this supersedes plan 010's anchor-stamp tool for rigid attachments) —
[DECISIONS.md](DECISIONS.md).

> **Sourcing / generating new art?** The tileset candidates weighed up, the AI-gen service trials
> (Retro Diffusion / PixelLab), and the Gemini bespoke-asset pipeline live in the R&D log:
> [ASSET-EXPERIMENTS.md](ASSET-EXPERIMENTS.md).

## Pack manifests & asset catalog

Every pack dir under `public/assets/tilesets/<pack>/` carries a `pack.json`: `id`, `name`, `author`,
`sourceUrl`, `licence`, `tileSize`, plus `rules` (glob patterns) encoding the 3 load classes above —
`tile` (`Environment/Tilesets/**`), `strip` (`**/*-Sheet.png`), everything else defaults to `object` —
and a `selfMade` rule (tags `_derived/**` etc as `origin: "self-made"`). `overrides` (exact relative
path → partial field patch) and `exclude` (globs, dropped entirely) are the per-pack escape hatches
for the odd sheet the mechanical rule gets wrong (e.g. the skeleton Death-Sheet's `frameWidth`
exception above needs a `frames` override).

`npm run assets:catalog` (`scripts/asset-catalog.mjs`, Node built-ins only — no image-parsing dep,
PNG width/height read straight off the IHDR chunk) walks every `pack.json`'d dir and regenerates the
**committed** `public/assets/asset-catalog.json` the Map Builder editor's Library panel browses.
Deterministic (packs/assets/tags all sorted, no timestamp) — re-running with no pack changes produces
a byte-identical file. Never hand-edit the catalog; re-run the script after adding/removing pack
files or editing a `pack.json`.

`public/assets/tilesets/mostowo-custom/` is the (currently-empty) skeleton home for future self-made
art — same `pack.json` shape, `licence: "original"`.

### Additional Anokolisa packs (ingested for the editor Library)

Nine more **paid** Anokolisa packs (bought on the "if it works out, buy more" note above) are staged
alongside the free pack, each in its own `public/assets/tilesets/<id>/`: `castle-environment`, `cave`,
`desert`, `fairy-forest`, `forge`, `garden-environment`, `hideout`, `library`, `sewer`. They're
**ingested into the asset catalog** — browsable/placeable in the Map Builder Library. What that
unlocks depends on the asset kind:

- **Terrain + props/decor are usable in-game *now*, via map authoring** — no code change. `ACTIVE_TILESET`
  (still `pixel-crawler`) is only the *base* load; `PreloadScene.queueMapTextures` additionally loads
  every palette source + placed decor a loaded map references, honouring each entry's own `pack`
  (`tilesetAssetUrl(pack, …)`). So paint a `fairy-forest` tile / drop a `cave` prop into a map, save it,
  and the game loads those textures at boot. They're just invisible until some authored map references
  them.
- **Enemies need code+data wiring** — mobs aren't catalog-placeable map objects; they're spawned AI
  actors defined in typed data + an `ActorRender`/`StripAnim` manifest (frame counts, anchors) + spawn
  logic + `anims.create` (the plan-005/011 skeleton pattern). Ingesting an enemy pack makes its sheets
  *available*; making one actually spawn is a per-enemy feature step.

Two Anokolisa **mob packs** are ingested the same way — `bat-fur` and `small-bat` (directional
Idle/Move/Attack/Death/Hit × Down/Side/Up strips, a richer rig than the free pack's single-orientation
skeleton). Being enemies, they fall under the wiring caveat above. (Their downloads shipped **no
`Terms.txt`** — licence assumed to match the other Anokolisa packs; confirm before any public release.)

These paid packs use a **different internal layout** than the free pack, so each carries its own tuned
`pack.json` (not the free pack's rules): terrain lives at `Assets/{Tiles,Ground,Sand,Water}.png`
(classed `tile`, all 16-px-aligned) rather than `Environment/Tilesets/**`; enemy anims are the usual
`**/*-Sheet.png` strips (Idle/Run/Death/Hit); `Weapons/**`, `Assets/Props.png`, `Assets/Tree.png`,
`Assets/Light.png`/`Shadown.png` fall to `object` (region-detected atlases). Ingestion dropped the
non-game files via `exclude`: `Social/**` (promo covers/mockups), `**/*.png~` (editor backups),
`**/*.gif`, `**/*.aseprite` (source, per the PNG-only convention). Frame counts on the enemy strips are
left to auto-detection for now — tune any that read wrong via the in-editor object editor (plan 017)
when a pack is actually wired in.

**Licence (paid):** same author terms as the free pack but **purchased** — free to use/alter in any
project, credit optional, but the raw assets may **not** be resold or redistributed standalone, even
altered (each pack's `Terms.txt` travels with it). If this repo/build ever goes public, the raw pack
PNGs should not ship in a form that amounts to redistributing the paid assets.

**Multi-pack region generation:** `scripts/pixel-crawler/gen_regions.py` now walks **every** pack dir
carrying a `pack.json` (matching `asset-catalog.mjs`), writing one `regions.json` per pack; an optional
pack-id argv restricts the run. It previously only did `pixel-crawler`. The two-command regen
(`python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog`) is unchanged and now covers
all packs at once.

### Atlas sprite regions (plan 014 step 7a)

Most `object`-type sheets are actually multi-sprite ATLASES (e.g. `Furniture.png` 800×864 holds ~50
placeable props). Rather than physically splitting a sheet into one file per sprite, each pack's
committed `regions.json` sidecar (`public/assets/tilesets/<pack>/regions.json`) carries per-sprite
bounding boxes, detected by connected-components analysis; `asset-catalog.mjs` merges these in so a
`CatalogAsset` with >=2 regions gets a `regions: [{key,x,y,w,h}]` array (0 or 1 stays a plain single
object). Editor/game crop the chosen region at render — the sheet stays the load/dedupe unit
(`collectTextureSources` doc in `mapFormat.ts` has the mobile-memory trade-off this implies).

**Regen (always both, in order):**
```
python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog
```
Never hand-edit `regions.json` — it's generated, like the catalog itself. The only hand-authored
inputs are two escape-hatch maps in that pack's `pack.json`: `regionParams` (per-sheet detection
tuning — `alphaThresh`/`gap`/`minArea`) and `regions` (a verbatim per-sheet region list, for sheets
where no amount of tuning gets it right — e.g. touching sprites that merge, or a false-positive
non-sprite region). Both keyed by the sheet's relative path. Concrete examples already in
`pixel-crawler/pack.json`: `Rocks.png`/`Resources.png`/`Esoteric.png`/`Tools.png` each had a baked-in
"PALETTE:" swatch legend in one corner that connected-components happily detects as a "sprite" — the
`regions` override drops just that one box; `Trees/Model_03/Size_04-export.png`'s four colour
variants touch at the canopy edges and detect as one merged blob — the override splits it into its
four (plus the already-correct dead-tree/stump) regions.

**In-editor region editing (plan 017 step 4):** the `regions` list no longer has to be hand-authored
in `pack.json`. Open an `object` asset's tab in the Map Builder (`npm run editor`) — its body is a
**Regions** editor overlaying the sheet: drag to draw a box, click to select (with a live x/y/w/h
readout + Delete), drag the body/handles to move/resize, and **grid-slice** a selected box into a
cols×rows grid of equal cells (one action splits a whole merged crop/seed row — the motivating
`Farm.png` case detection can't). **Save regions** `PUT`s `/__editor/asset-regions`
(`scripts/vite-editor-api.mjs`), which **whole-list replaces** `pack.json`'s `regions[relPath]` (the
server clamps every rect in-bounds of the sheet PNG and rejects an out-of-bounds one) then reruns
both generators server-side, serialised, with the same `python3`-ENOENT graceful degrade as
`/__editor/asset-override`. **Reset to auto-detect** saves an EMPTY list, which deletes the key so
the sheet falls back to connected-component detection. (Picking `object` in the type dropdown for a
strip/tile asset makes the Regions editor reachable; Save then forces the `object` type override
first.)

**Content-drift caveat:** the catalog build validates a sidecar region is in-bounds for its sheet
(fatal if not — a stale sidecar after a sheet shrunk), but it can't detect a sprite that moved
*within* a same-size sheet. Re-running `gen_regions.py` after editing ANY pack PNG is the only guard
— there's no automatic staleness check for that case (by design: this module reads pixels, `parseMap`
deliberately doesn't).

### Per-asset type/grid overrides + in-editor reclassify (plan 014 step 7c)

`pack.json` `rules`-based classification (filename/path glob → `tile`/`strip`/`object`) is
mechanical and sometimes wrong — e.g. the furnace sheets (`Bricks_01-Sheet.png` etc., 64×96) match
`*-Sheet.png` → `strip` by filename, but they're 2×2 **grid** animations (4 flame frames arranged in
a square, not one horizontal row), which the filename rule can't express. Two `overrides[relPath]`
keys fix this, consumed by **both** generators before classification (never after — a bare `type`
override redoes the frame/region math, it doesn't just relabel a stale asset):

- **`type: "tile" | "strip" | "object"`** — forces classification, overriding the `rules` glob
  match. A `-Sheet.png` forced to `object` gets a `gen_regions.py` detection pass (and gains
  `regions` if it detects ≥2 sprites); a `.png` forced to `strip` is excluded from detection.
- **`rows`** (strip-only, default `1`) — LEGACY mode: turns the existing `frames` override into a
  GRID: with `rows` rows, `frameHeight = h / rows`, `cols = frames / rows`, `frameWidth = w / cols`.
  `rows: 1` (the default) collapses back to the original single-horizontal-row math, so every
  pre-existing `frames`-only override still means exactly what it always did.
- **`cols` + `omit`** (strip-only, plan 017 step 6) — GEOMETRY mode, which **decouples the grid from
  the played frames**. With `cols` present, `frameWidth = w / cols`, `frameHeight = h / rows` (rows
  default `1`); the total cell count is `cols * rows`, and that is what the catalog's `frames` now
  means. `omit: number[]` lists cell indices (row-major, `0..cols*rows-1`) to SKIP, so the played set
  is every cell minus `omit`, ascending. This expresses a sheet whose grid has blank cells — e.g. the
  Alchemy table `Alchemy_Table_01-Sheet.png` (192×704) is a 2×11 = 22-cell grid whose blank 22nd cell
  is `"cols": 2, "rows": 11, "omit": [21]` → 21 played frames. In geometry mode `frames` is NOT
  authored (it's derived from `cols*rows`); the server rejects an `omit` that skips every cell. Legacy
  `frames`(+`rows`) overrides regenerate byte-for-byte — geometry mode is purely additive.

Example — the furnace fix (legacy mode): `"Environment/Structures/Stations/Furnace/
Bricks_01-Sheet.png": { "frames": 4, "rows": 2 }` → `frameHeight = 96/2 = 48`, `cols = 4/2 = 2`,
`frameWidth = 64/2 = 32`. The same grid in geometry mode: `{ "cols": 2, "rows": 2 }`.

**Preferred path — the in-editor object-editor tab** (Library panel ⚙, plan 017): click the ⚙ on any
non-tile asset card to open its full-size object-editor tab with a `type` dropdown (the `strip` option
is labelled **"Animated strip"**) and, for a strip, free-entry **Columns**/**Rows** fields with a live
grid overlay on the full sheet (updates as you type — pure arithmetic on `w`/`h`, no pixel decode) plus
divisor-pair suggestion chips, and a per-frame preview where **clicking a cell toggles whether it's
omitted** (the geometry-mode `omit` authoring above). Committing `PUT`s
`/__editor/asset-override` (`scripts/vite-editor-api.mjs`, dev-only middleware), which patches
`pack.json` and reruns **both** generators server-side, in order (`gen_regions.py` then
`assets:catalog` — the sidecar must be current before the catalog build reads it), serialized so two
overlapping reclassifies can't race. On success the Library refetches the catalog immediately — no
page reload, no manual terminal step. If `python3` isn't on `PATH`, the endpoint still saves the
`pack.json` patch and returns a structured error naming the fallback below (the override isn't lost,
only the regen needs finishing by hand).

**Fallback — the two-command regen** (same as the Atlas sprite regions section above): edit
`pack.json` by hand, then `python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog`.

**Known limitation:** already-placed decor is a catalog SNAPSHOT — a furnace already dropped into a
map before its sheet was reclassified does not retroactively animate; delete and re-place it (no
texture-key collision either way, since `decorTextureKey` includes the frame dims). Pixel-based
auto-detection of a strip's grid is deliberately out of scope — connected-component detection is
weak on animation sheets specifically, and the grid itself is ambiguous from pixels alone (64×96
could be 2×2 or 2×3) — manual entry with a live preview is the v1 approach.

## Item icons (Gemini pipeline, plan 009)

Inventory **item icons** live at [`public/assets/icons/`](../public/assets/icons/) as **32×32
transparent PNGs**, one per item, named `<item-id>.png` (matches `ITEMS[*].icon` in
`src/data/items.ts`; loaded as `icon:<id>`, with the item's `color` rect as fallback if a key is
missing). They're generated from prompts, not hand-drawn:

- **Source of truth** = the prompt manifest in [`scripts/gen-icons/prompts.py`](../scripts/gen-icons/prompts.py)
  — a shared style preamble + one subject line per item. Regenerate any icon from there; that's the
  reproducible origin (per the "commit the processed sprite + note its origin" convention).
- **Pipeline:** [`scripts/gen-icons/`](../scripts/gen-icons/) — Gemini (`gemini-2.5-flash-image`)
  generates ~1024px, then PIL keys out the flat background → square-crops → downscales to 32×32 →
  optional palette quantise. Full R&D context + endpoint/auth in
  [ASSET-EXPERIMENTS.md](ASSET-EXPERIMENTS.md#gemini-asset-generation-via-guppi); run commands and
  "how to add an item" in that script's README.
- **Placeholder → real flow:** plan 008 shipped coloured-rect placeholder PNGs so the inventory UI
  worked immediately; plan 009 replaces them with generated art. Generation is **gated on
  `GEMINI_API_KEY`** (LAN-only, via Tailscale), so it's a run-when-reachable step, not part of the
  build — the game stays green on whatever icons are committed.

> **Origins:** `wood`, `stone`, `berries` are all **Gemini-generated** (plan 009,
> `gemini-2.5-flash-image`) via `scripts/gen-icons/` — regenerate/tweak from `prompts.py`, the
> reproducible source. No item icons remain as plan-008 placeholders.

## Where assets live

- `public/assets/` — sprites/tilesets/atlases the game loads (Vite serves it from the site root;
  packs are staged under `public/assets/tilesets/<pack>/`, pipeline-derived PNGs under `_derived/`).
- `docs/assets/reference/` — reference material (e.g. the Google Maps screenshot of Mostowo).
- Licence notes travel with any third-party pack.
