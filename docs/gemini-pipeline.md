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

## Character animation via image-to-image (Rogue attack — 2026-07-21)

The Rogue NPC (plan 042) ships no attack strip. We generated one with the same Gemini
endpoint but **image-to-image**: feed the model the Rogue's own idle sprite as an inline
image so it re-poses the *same* character instead of inventing one — this is what makes the
output actually match. A tuned single-row prompt ("one horizontal row of N equal frames,
one shared feet baseline, flat/chunky low-detail") yields a clean, ordered overhead-slash
strip (other approaches — recolour-graft onto Body_A, literal part-graft, self-inferred
whole-body transform — were tried first and read worse; Gemini won on character fidelity).

Two scripts under `scripts/pixel-crawler/`:

- **`gen_rogue_gemini.py`** — sends the idle sprite + prompt variants, saves raw ~1024px
  strips to the gitignored `scripts/.gen-icons/raw/` scratch. Needs `GEMINI_API_KEY`
  (fetch from guppi's `~/house-helper/.env`; `--dry-run` needs no key). Pick the best raw.
- **`process_gemini.py`** — turns a chosen raw strip into a committed pack-matching sheet:
  key out magenta → split the row into per-figure columns → **alpha-bleed defringe** (kills
  the anti-aliased magenta halo before downscaling) → one shared downscale to ~pack height →
  hard alpha → gentle colour-grade + shared palette quantise (the style-match that makes the
  HD gen read as pack art) → baseline-align. Runs anywhere (no key).

Only the processed sheet is committed (`_derived/rogue/Slice_Side-Sheet.png`, 5f @ 56px); the
raws stay gitignored scratch. Re-run `gen_rogue_gemini.py` (with the key) then
`process_gemini.py` to regenerate. **Not yet wired into the game** — asset only.
