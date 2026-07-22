# Gemini item-icon pipeline

The operational pipeline for generating game assets (item icons) via Gemini image-gen on Matt's
guppi home server — endpoint, model, auth/LAN-key gate, and the run workflow. Related:
[`scripts/gen-icons/README.md`](../scripts/gen-icons/README.md) (run commands + how to add an item)
and [ASSETS.md](ASSETS.md) (art pipeline: active pack, extraction, what's wired, where assets live).

## Gemini asset generation (via guppi)

Matt's home server (**guppi** repo / Beelink) has a working Gemini image-gen setup we can mirror.
The API key is `GEMINI_API_KEY`, stored in `guppi/house-helper/.env` (**gitignored — never commit
it, and never write it into the repo or a build**).

**Getting the key from a cloud Claude session** (don't ask Matt to paste it): the sandbox can reach
guppi over the Tailnet using the `TAILSCALE_KEY`/`GUPPI_PASSWORD` env vars it already carries — follow
the verified shell recipe in [MOBILE-EDITOR-ACCESS.md](MOBILE-EDITOR-ACCESS.md#claude-getting-a-shell-on-guppi--working-on-the-build-there),
then read the key straight off the server, e.g.

```bash
gssh 'grep -h GEMINI_API_KEY /home/guppi/house-helper/.env'   # capture into this session's env only
```

Export it into the running shell for the generate step; keep it **in-memory** (never echo it into a
committed file, log, or preview). The Gemini endpoint itself is public Google — only the *key* needs
guppi, so once it's in env, generation runs from the sandbox like anywhere else.

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

## Character animation via image-to-image

This endpoint also generates **animated character sprites** (not just item icons) via
**image-to-image** — feed the character's own sprite as a reference so the model re-poses
the *same* character. First use: the Rogue attack strip (`gen_rogue_gemini.py` +
`process_gemini.py` under `scripts/pixel-crawler/`). Full reusable playbook, the
outline-first cel-shade processing, the failure ladder, and prior-art references:
**[AI-SPRITE-PIPELINE.md](AI-SPRITE-PIPELINE.md)**.
