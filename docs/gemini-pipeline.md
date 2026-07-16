# Gemini item-icon pipeline

The operational pipeline for generating game assets (item icons) via Gemini image-gen on Matt's
guppi home server — endpoint, model, auth/LAN-key gate, and the run workflow. Related:
[`scripts/gen-icons/README.md`](../scripts/gen-icons/README.md) (run commands + how to add an item)
and [ASSETS.md](ASSETS.md) (art pipeline: active pack, extraction, what's wired, where assets live).

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

**Item icons — this is now a real pipeline** (plan 009): [`scripts/gen-icons/`](../scripts/gen-icons/)
implements the 4-step workflow below for the game's item icons. A shared style preamble +
one subject line per item (`prompts.py`) keeps the set consistent; `generate.py` composes each
prompt, POSTs to the endpoint above, then PIL post-processes (key out the flat bg → square-crop →
nearest/lanczos downscale to **32×32** → optional palette quantise) into `public/assets/icons/`.
Raw ~1024px generations are gitignored scratch (`scripts/.gen-icons/`); only the processed 32×32
PNGs are committed. See that script's README for run commands and how to add an item. The steps it
automates:

1. Write a tight prompt per asset — enforce the dark-grotty-but-funny style, transparent/flat
   background, top-down or item-icon framing, low detail suited to pixel downscaling.
2. Generate at high res via the endpoint above.
3. Downscale to the pixel grid + palette-quantise → sprite/atlas.
4. Commit the *processed* sprite (not the raw 1024px) into the repo's assets dir; note its origin.

> Because generation needs the LAN key, run the generation step from a machine that can reach
> guppi — or with the key exported locally via **Tailscale** (the Gemini endpoint itself is a
> public Google API, so only the *key* needs the LAN) — then commit the resulting sprites so
> cloud/other devices just consume them. `--dry-run` composes prompts with no key and no spend.
> This pipeline currently targets **item icons**; non-item art (tiles/mobs/stations) has its own
> paths (the RD/PixelLab trials above, `scripts/pixel-crawler/` extraction).
