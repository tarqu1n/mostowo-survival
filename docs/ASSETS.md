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

## Base tileset — chosen (2026-07-11)

**[Zombie Apocalypse Tileset](https://ittaimanero.itch.io/zombie-apocalypse-tileset)** by Ittai
Manero, staged at
[`public/assets/tilesets/zombie-apocalypse/`](../public/assets/tilesets/zombie-apocalypse/) (see
that folder's own `README.md` for the category index + Phaser loading notes). 16×16, matches
`TILE_SIZE`, on-theme (post-apoc scenery, zombies, weapons, UI). Beat the CC-BY-SA OpenGameArt
alternative on content breadth (environment + characters + items in one coherent pack vs.
terrain-only).

**Licence is not CC0** — free for personal + commercial use, credit appreciated, no redistributing
the assets themselves standalone. Full terms in that folder's `LICENSE.md`; keep it alongside the
assets if this repo or a build ever goes public.

**Wired into the Phaser loader:** ground/wall/tree tiles + the player's walk cycle landed first;
the kid zombie's walk + damaged-reaction frames followed (plan 003, the first enemy). Still
placeholder-tinted rather than fully styled (no hit-flash/VFX yet, per plan 003's out-of-scope
list) — the swappable-manifest approach in `src/data/tileset.ts` means trialling a different pack
is still just pointing `ACTIVE_TILESET` elsewhere.

<details>
<summary>Other candidates considered</summary>

Prefer **CC0 / Creative Commons Zero** (free commercial use, no attribution needed) where content
needs are equal. On itch.io, filter by CC0 + tags `tileset`, `top-down`, `zombies`, `pixel-art`.

- **Kenney** ([kenney.nl](https://kenney.nl)) — huge library of CC0 pixel/top-down packs. Reliable,
  consistent, genuinely free, but skews clean/colourful (tanks, shooters) rather than the grimy
  survival-horror mood — good CC0 fallback for UI/generic props, not the base environment look.
- **[Post-Apocalyptic 16×16 Tileset](https://opengameart.org/content/post-apocalyptic-16x16-tileset-update1)**
  (OpenGameArt, CC-BY-SA 3.0) — right mood, true open licence, but terrain-only (single PNG, no
  buildings/props/characters) — would need pairing with another pack.
- **RGS_Dev** CC0 top-down tileset template (16×16, colour variants) — good for prototyping, not
  evaluated in depth once Zombie Apocalypse covered the need.

Sources: [itch.io CC0 assets](https://itch.io/game-assets/assets-cc0) ·
[itch.io CC0 tilesets](https://itch.io/game-assets/assets-cc0/tag-tileset) ·
[itch.io free zombie assets](https://itch.io/game-assets/free/tag-zombies) ·
[itch.io pixel-art + zombies](https://itch.io/game-assets/tag-pixel-art/tag-zombies) ·
[Kenney](https://kenney.nl)

</details>

## AI pixel-art trials — Retro Diffusion & PixelLab

Two free-tier AI pixel-art services worth trialling alongside/against Gemini, since both are
purpose-built for pixel art (unlike a general image model, which needs heavy downscale/quantise
post-processing to look right). CLI wrappers + full API details:
[`scripts/gen-art/`](../scripts/gen-art/README.md).

- **Retro Diffusion** — has dedicated *tile* styles (`rd_tile__single_tile`, `rd_tile__tileset`,
  seamless `tile_x`/`tile_y` options) purpose-built for environment art, a real advantage over
  PixelLab for this pack's use case.
- **PixelLab** — `bitforge` model takes a `style_image` reference, potentially useful for matching
  new bespoke sprites to the Zombie Apocalypse pack's existing look. No dedicated tileset endpoint
  despite the marketing — same pixflux/bitforge endpoints, just prompted for tile-shaped subjects.

Compare a few equivalent prompts across both (+ Gemini) before settling on a default; see the
gen-art README's "What to compare" section.

### PixelLab trial #1 — tree / stump / forest floor (2026-07-11)

Tested whether PixelLab (`pixflux` model) can produce assets in the Zombie Apocalypse pack's style,
using the game's actual `tree`/stump resource-node concept as the subject. 3 fast generations spent
(37 of 40 free fast credits left; after that it's 5 slow/day). Outputs + a side-by-side comparison
sheet against the existing pack's tree/terrain tiles: `docs/assets/ai-tests/pixellab/`
(`tree.png`, `stump.png`, `forest-floor.png`, `comparison-sheet.png`).

One correction to the script's docstring: the free tier's canvas *minimum* is 32×32 (`pixflux`
rejects 16×16 with a 422 "Canvas must be size 32x32 area or larger") — generated at 32×32 and would
need downscaling to this repo's 16×16 `TILE_SIZE`, not just upscale-safe as assumed.

**Verdict: style mismatch, not a drop-in match for the pack.**

- **Tree / stump** — well-rendered individually (clean linework, readable silhouette, correct
  subject), but stylistically they read as soft, rounded, Stardew-Valley-ish farming-game icons:
  saturated colour, gentle shading, a single polished 32×32 illustration. The pack's tree is a
  spiky, high-contrast, near-monochrome silhouette built from several plain 16×16 modular pieces.
  Different composition philosophy (one painted icon vs. modular flat tiles) as well as different
  palette/rendering — dropping the PixelLab tree next to the pack's would visibly clash.
- **Forest floor — clear failure for this use case.** Asked for a seamless tileable ground texture;
  `pixflux` instead generated a single self-contained vignette (a circular leaf-pile motif with a
  hard edge), which tiles as an obvious repeating blob grid, not a continuous floor — visible in the
  3×3 tiled comparison. Confirms the README's note above: PixelLab has no dedicated tile endpoint,
  and prompting pixflux/bitforge for "tileable" doesn't reliably produce one. Retro Diffusion's
  `rd_tile__*` styles are the more promising path for ground/floor tiles specifically — worth
  trying there next before writing off AI-gen for environment tiles.

Bitforge's `style_image` reference (not exercised in this trial — `pixellab.mjs` doesn't wire it up
yet) is the more likely route to close the style gap for props like the tree/stump, by conditioning
on an actual pack sprite; plain pixflux + text prompting isn't enough to match a specific existing
pack's look.

## Gemini asset generation (via guppi)

Matt's home server (**guppi** repo / Beelink) has a working Gemini image-gen setup we can mirror.
The API key is `GEMINI_API_KEY`, stored in `guppi/house-helper/.env` (**gitignored — never commit
it**, and it's on the home LAN, not reachable from a cloud dev sandbox).

Reference implementation to copy from: **`guppi/house-helper/catalog_icons.py`**. Key facts:

- **Model:** `gemini-2.5-flash-image` (aka *"Nano Banana"*) — image generation.
- **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`
- **Auth:** header `x-goog-api-key: <GEMINI_API_KEY>`.
- Returns a ~1024px PNG (inline base64) on a solid background; guppi post-processes (square-crop →
  alpha key-out → resize). For pixel-art game assets we'd instead **downscale hard to the target
  pixel grid** (e.g. 16×16 / 32×32) with nearest-neighbour, and likely quantise the palette.

Practical workflow (proposed, to firm up when we start generating):

1. Write a tight prompt per asset — enforce the dark-grotty-but-funny style, transparent/flat
   background, top-down or item-icon framing, low detail suited to pixel downscaling.
2. Generate at high res via the endpoint above.
3. Downscale to the pixel grid + palette-quantise → sprite/atlas.
4. Commit the *processed* sprite (not the raw 1024px) into the repo's assets dir; note its origin.

> Because generation needs the LAN key, expect to run the generation step from a machine that can
> reach guppi (or with the key exported locally), then commit the resulting sprites so cloud/other
> devices just consume them.

## Where assets live (proposed)

- `public/assets/` (or `src/assets/`) — sprites/tilesets/atlases the game loads (path finalised with
  the Vite scaffold).
- `docs/assets/reference/` — reference material (e.g. the Google Maps screenshot of Mostowo).
- Licence notes travel with any third-party pack.
