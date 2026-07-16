# Asset R&D log — tileset candidates & AI generation

The exploratory record behind the art pipeline: stock tilesets weighed up, AI-gen services trialled,
and the Gemini bespoke-asset pipeline. Loaded when **revisiting how to source or generate art**, not
when wiring an already-chosen sprite — for that (active pack, extraction, what's wired, where assets
live) see [ASSETS.md](ASSETS.md).

## Other tileset candidates considered

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

## Style-matching generated art to the pack — `style_match.py`

**The tool for "the gen art's shape is right but the palette/shading is off."** Any generator (RD,
PixelLab, Gemini) gives brighter, more painterly, higher-colour-count output than Anokolisa's tight,
muted, flat-banded wood art with its dark-brown (not black) outline. Rather than re-prompt forever,
run the sprite through a post-process that snaps it onto the pack's actual look:
[`scripts/mostowo-custom/style_match.py`](../scripts/mostowo-custom/style_match.py).

Pipeline (each pass is a lever, all reproducible):

1. **flatten** — median-cut to `--bands` colours (default 10), killing painterly gradients → flat
   pixel-art bands.
2. **snap** — remap every band to the nearest colour in a palette **auto-extracted from the pack's
   own wood/foliage sprites** (perceptual redmean distance), so the output uses *only* in-game
   colours. Warm browns + natural foliage greens are kept (moss survives); grey coal / teal gems in
   the same source sheets are filtered out.
3. **outline** — recolour the dark silhouette edge from black → the pack's darkest wood tone (skip
   with `--no-outline`).
4. **grimy** — OPTIONAL global desaturate + darken toward the dark-&-grotty direction (`--grimy`,
   off by default).

```sh
# preview without overwriting, then apply in place
python3 scripts/mostowo-custom/style_match.py sprite.png --out-dir /tmp/preview
python3 scripts/mostowo-custom/style_match.py a.png b.png            # in place
python3 scripts/mostowo-custom/style_match.py a.png --bands 14 --grimy
```

Dials when a result reads wrong: **higher `--bands`** retains more tones (less flattening — use if a
detail like moss got absorbed); `--grimy` knocks back anything still too bright/saturated; `--sources`
repoints the palette at different pack sheets (default is the pixel-crawler wood set) for non-wood
assets. First real use: the three `log_pile*` props — before/after and full origin chain in
[ASSETS.md](ASSETS.md) (the mostowo-custom self-made-art section).

## Gemini asset generation (via guppi)

→ [the operational Gemini item-icon pipeline (endpoint, key, workflow)](gemini-pipeline.md)
