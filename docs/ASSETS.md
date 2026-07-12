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

| Class | Rule | Load |
|---|---|---|
| **Grid tilesheet** | under `Environment/Tilesets/` | `load.spritesheet` @ 16px, address by frame index |
| **Animation strip** | filename ends `-Sheet.png` | `load.spritesheet` @ frameSize = sheet height |
| **Multi-object sheet** | everything else (`Props/Static/*`, static `Structures/{Stations,Buildings}` props, `Weapons/*`) | can't grid-slice — extract the one object you want by connected-component bbox → a derived PNG |

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

| Output | Source sheet | Index |
|---|---|---|
| `_derived/tree_pine.png` | `Environment/Props/Static/Trees/Model_02/Size_03.png` | 3 |
| `_derived/rock.png` | `Environment/Props/Static/Rocks.png` | 5 |

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
  sheets in this pack ship no directional variants.
- **Player gather swing (added in plan 004):** a new `gather` `PlayerState` maps to the pack's
  `Collect_Base` strips (`Collect_{Down,Side,Up}-Sheet.png`, 8×64px) — foraging a berry bush plays
  this, distinct from the chop/mine swings above.

**Berry bush + berries are placeholder art (plan 004), not Pixel Crawler frames:**
`icons/berries.png` + `_derived/bush.png` are baked by `scripts/placeholder-art.mjs` (same
coloured-rect-placeholder pattern as plan 008's item icons) — real art for both rides the plan 009
Gemini pipeline later.

Manifest schema reshaped to roles: a `TileSource` union (`{kind:'image'}` standalone PNGs,
`{kind:'sheetFrame'}` indexed frames of a 16px-sliced sheet) plus `StripAnim`/`ActorRender` for
actors — see `src/data/tileset.ts`.

Verified: `npm run build` clean, `npm run smoke` (33/33, no console errors), manual screenshot
check of grass/tree/wall/directional-player/skeleton.

> **Sourcing / generating new art?** The tileset candidates weighed up, the AI-gen service trials
> (Retro Diffusion / PixelLab), and the Gemini bespoke-asset pipeline live in the R&D log:
> [ASSET-EXPERIMENTS.md](ASSET-EXPERIMENTS.md).

## Where assets live

- `public/assets/` — sprites/tilesets/atlases the game loads (Vite serves it from the site root;
  packs are staged under `public/assets/tilesets/<pack>/`, pipeline-derived PNGs under `_derived/`).
- `docs/assets/reference/` — reference material (e.g. the Google Maps screenshot of Mostowo).
- Licence notes travel with any third-party pack.
