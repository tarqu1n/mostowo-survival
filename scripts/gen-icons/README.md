# gen-icons — item-icon generation pipeline

Generates the game's **item icons** with Gemini (*"Nano Banana"*, `gemini-2.5-flash-image`)
and post-processes each to a committed **32×32 transparent PNG** under
[`public/assets/icons/`](../../public/assets/icons/), replacing plan 008's placeholder
rects with real art. Consistency across the set comes from a **shared style preamble +
one subject line per item** ([`prompts.py`](prompts.py)) — adding an item is one line.

Python (PIL + numpy, stdlib `urllib`) — matches the Gemini reference impl and the existing
[`scripts/pixel-crawler/`](../pixel-crawler/) PIL tooling. Endpoint/model/auth are documented
in [`docs/ASSET-EXPERIMENTS.md`](../../docs/ASSET-EXPERIMENTS.md#gemini-asset-generation-via-guppi).

## Setup

Generation needs `GEMINI_API_KEY`, which lives in `guppi/house-helper/.env` on Matt's home
LAN (**gitignored — never commit it**; `.env*` is covered). The Gemini endpoint itself is a
public Google API, so only the *key* needs the LAN:

- On a machine that can reach **guppi** (or over **Tailscale**), read the key from
  `guppi/house-helper/.env`.
- Export it for the shell session — never commit it:
  ```bash
  export GEMINI_API_KEY=...
  ```

`--dry-run` needs no key (composes and prints prompts, no API call, no spend).

### Running it from a Claude cloud session (verified 2026-07-24)

Two gotchas make the naive run fail, so capture them here rather than rediscover them:

1. **Each Bash tool call is a fresh shell** — shell state does not persist. So the key-fetch and
   the `generate.py` call must be in **one** invocation, or the exported `GEMINI_API_KEY` is gone by
   the next call.
2. **The sandbox ships without the Python image deps** (`numpy`, `pillow`) — install them first.

The end-to-end sequence that works:

```bash
# 1. Python deps (neither numpy nor pillow is preinstalled in the sandbox)
pip install -q numpy pillow

# 2. Join the Tailnet + define `gssh` — full bring-up (install tailscale, userspace networking +
#    SOCKS5 proxy, sshpass) is in docs/MOBILE-EDITOR-ACCESS.md. Then, in ONE shell, fetch the key
#    into env and generate — the key never touches disk, a log, or a preview:
export GEMINI_API_KEY="$(gssh 'grep -E "^GEMINI_API_KEY=" /home/guppi/house-helper/.env | cut -d= -f2- | tr -d "\r\n"')"
[ -n "$GEMINI_API_KEY" ] || { echo "key not loaded"; exit 1; }   # never echo the value itself
python3 scripts/gen-icons/generate.py            # all items — or --only <id>
```

If `urllib` hits a TLS error reaching `generativelanguage.googleapis.com` through the agent proxy,
`export SSL_CERT_FILE=/root/.ccr/ca-bundle.crt` before generating (see `/root/.ccr/README.md`).

## Run

```bash
# Compose + print every item's prompt — no key, no API call, no spend. Start here.
python3 scripts/gen-icons/generate.py --dry-run

# Generate + post-process all icons (needs GEMINI_API_KEY).
python3 scripts/gen-icons/generate.py

# Regenerate one item after tweaking its subject line in prompts.py.
python3 scripts/gen-icons/generate.py --only wood

# Generate raw ~1024px PNGs only (skip post-process) to eyeball before downscaling.
python3 scripts/gen-icons/generate.py --raw-only

# Tuning knobs for post-processing:
#   --tolerance N   background key-out colour distance (default 45)
#   --resample box|lanczos|nearest   downscale filter (default lanczos)
#   --quantise N    reduce the palette to N colours
python3 scripts/gen-icons/generate.py --only stone --quantise 16
```

Raw ~1024px generations go to `scripts/.gen-icons/raw/` (**gitignored scratch** — throwaway).
Only the **processed 32×32 PNGs** in `public/assets/icons/` are committed. If the game can't
find an icon it falls back to the item's `color` rect, so a missing/failed icon never breaks
the build.

## Style rules (the shared preamble enforces these)

Dark-grotty-but-funny · a **single** centred item filling the frame · slight top-down 3/4
item-icon framing · chunky, bold, readable silhouette that survives a hard 32×32 downscale ·
limited muted palette + strong dark outline · **no text, no border, no drop shadow, no ground**
· flat solid chroma-key (magenta) background so it keys out cleanly to transparency.

Keep the preamble identical across all items — that shared verbatim block is what makes the
set look like one family. Tune **individual** icons via their subject line; only touch the
preamble when the *whole* set needs to shift.

## Adding a new item

1. Add the item to `ITEMS` in `src/data/items.ts` with `icon: '<id>.png'` (plan 008 pattern).
2. Add **one line** to `SUBJECTS` in [`prompts.py`](prompts.py), keyed by that same `<id>`.
3. `python3 scripts/gen-icons/generate.py --only <id>`, eyeball at game scale, iterate on the
   subject line, then commit the processed `public/assets/icons/<id>.png` and note its origin
   in [`docs/ASSETS.md`](../../docs/ASSETS.md) (the manifest here is the reproducible source).

## API reference

`POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`,
header `x-goog-api-key: <GEMINI_API_KEY>`. Request body: `{"contents":[{"parts":[{"text": <prompt>}]}]}`.
The reply carries the image inline as base64 (`candidates[].content.parts[].inlineData.data`) —
a ~1024px PNG on a solid background, which this pipeline keys out → crops → downscales.
