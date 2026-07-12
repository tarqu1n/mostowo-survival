# gen-art — AI pixel-art trial scripts

Small CLI wrappers to try **Retro Diffusion** and **PixelLab** — two AI pixel-art generators with
free tiers — for bespoke/environment sprites, as an alternative/complement to the Gemini pipeline
already planned in [`docs/ASSET-EXPERIMENTS.md`](../../docs/ASSET-EXPERIMENTS.md#gemini-asset-generation-via-guppi). No
deps: plain Node 22 `fetch` + `fs`, same style as `scripts/smoke.mjs`.

## Setup

1. Sign up and grab an API key:
   - Retro Diffusion: <https://www.retrodiffusion.ai/app/devtools> (keys start `rdpk-`, 50 free
     credits to start, max 5 keys/account).
   - PixelLab: <https://www.pixellab.ai/> → sign up, no card required for the free tier.
2. Export the keys for your shell session (**never commit them** — `.env` is gitignored):
   ```bash
   export RETRODIFFUSION_API_KEY=rdpk-...
   export PIXELLAB_API_KEY=...
   ```

## Run

```bash
# Retro Diffusion — dedicated tile styles (rd_tile__*) are the interesting bit for environment art
node scripts/gen-art/retrodiffusion.mjs \
  --prompt "mossy stone brick wall" --style rd_tile__single_tile \
  --out scripts/.gen-art/rd-wall.png

# same prompt, seamless-tiling variant
node scripts/gen-art/retrodiffusion.mjs \
  --prompt "dirt path" --style rd_tile__tileset --tile-x --tile-y \
  --out scripts/.gen-art/rd-dirt-tileset.png

# PixelLab — pixflux is general-purpose; bitforge takes a --style-image reference (not yet wired
# into this script — add if we want to match the Zombie Apocalypse pack's look)
node scripts/gen-art/pixellab.mjs \
  --description "mossy stone brick wall, top down" \
  --out scripts/.gen-art/pl-wall.png

# free dry-run cost check before spending RD credits
node scripts/gen-art/retrodiffusion.mjs --prompt "test" --check-cost
```

Outputs default to `scripts/.gen-art/` (gitignored — these are throwaway trial images, not the
processed/committed sprites). Pass `--out <path>` to save somewhere else, e.g. under
`docs/assets/ai-tests/<service>/` if you want to keep a comparison set to eyeball side-by-side —
those *would* be worth committing (small, and useful evidence for the "which service/style wins"
decision), unlike scratch iterations.

## What to compare

Both services are hitting the same TILE_SIZE=16 target as the Zombie Apocalypse base pack. Worth
generating the same 3-4 subjects (a wall/floor tile, a prop, an item icon) through both plus Gemini,
side by side, before picking a default AI tool. Retro Diffusion's `rd_tile__*` styles are
purpose-built for tileable environment art — a real API advantage PixelLab doesn't have a dedicated
endpoint for (PixelLab's tileset marketing claim isn't backed by a separate API endpoint as of this
writing — you'd prompt pixflux/bitforge with tile-shaped descriptions instead). Record the outcome
in `docs/ASSETS.md`.

## API reference (as verified 2026-07-11)

**Retro Diffusion** — `POST https://api.retrodiffusion.ai/v1/inferences`, header `X-RD-Token`.
Key params: `prompt`, `prompt_style`, `width`/`height` (16-512), `num_images`, `seed`, `tile_x`/
`tile_y`, `remove_bg`, `check_cost`. Returns `base64_images[]` + `balance_cost`/`remaining_balance`.
Tile styles: `rd_tile__tileset`, `rd_tile__tileset_advanced`, `rd_tile__single_tile`,
`rd_tile__tile_variation`, `rd_tile__tile_object`, `rd_tile__scene_object`. Full style list and
examples: <https://github.com/Retro-Diffusion/api-examples>.

**PixelLab** — `POST https://api.pixellab.ai/v1/generate-image-pixflux` (general) or
`/generate-image-bitforge` (style-guided, takes `style_image`), header `Authorization: Bearer
<token>`. Key params: `description`, `negative_description`, `image_size: {width, height}`,
`outline`/`shading`/`detail`/`view`/`direction` enums, `isometric`, `no_background`, `seed`. No
dedicated tileset endpoint despite the tileset-generation marketing — prompt for tile-shaped
subjects instead. Free tier caps canvas at 200×200 (per pixellab.ai pricing page, unverified against
an actual account — confirm once signed up). Full schema:
<https://api.pixellab.ai/v1/openapi.json> / interactive docs at <https://api.pixellab.ai/v1/docs>.
