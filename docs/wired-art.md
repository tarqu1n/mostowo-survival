# Wired art — the concrete art inventory

What art is actually wired into the game: the active Pixel Crawler tileset, the sprite-extraction pipeline, the frames swapped in (plan 005), and runtime weapon pinning (plan 011).

See also: [asset catalog & pack-manifest schema](assets-catalog.md) · [art-pipeline hub](ASSETS.md).

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
> (Retro Diffusion / PixelLab), the Gemini bespoke-asset pipeline, and **`style_match.py`** (snaps
> off-palette gen art onto the pack's look — reach for it whenever generated art's shape is right but
> the colours/shading are off) all live in the R&D log: [ASSET-EXPERIMENTS.md](ASSET-EXPERIMENTS.md).
