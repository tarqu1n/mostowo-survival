# Gemini Item-Icon Generation Pipeline

> Status: in review — pipeline built (Step 1) + real icons generated & verified (Step 2). Both steps
> committed locally to `master` (plan-009 files only; push held pending concurrent plan-014 WIP).

## Summary

Stand up a **repeatable, consistent** pipeline that generates the game's **item icons** with Gemini
("Nano Banana", `gemini-2.5-flash-image`) and replaces plan 008's placeholder PNGs with real art. The
consistency comes from a **shared style preamble + a per-item prompt manifest** (adding an item = one
line), and a fixed post-process: generate high-res → key out background → square-crop → **nearest-
neighbour downscale to 32×32** → optional palette quantise → commit the processed PNG. Built as **Python**
(matches the Gemini reference `guppi/house-helper/catalog_icons.py` and the existing `scripts/pixel-crawler/`
PIL tooling). Generation is **gated on the `GEMINI_API_KEY`**, which lives on Matt's LAN
(`guppi/house-helper/.env`) — reachable via **Tailscale**; the Gemini endpoint itself is a public Google
API, so only the key needs the LAN. The pipeline is decoupled from gameplay: the game already ships green
on 008's placeholders, so this can run whenever the key is reachable.

## Context & decisions

**Locked with Matt (do NOT re-litigate):**

- **Model / endpoint / auth:** `gemini-2.5-flash-image`, `POST
  https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`, header
  `x-goog-api-key: <GEMINI_API_KEY>` (see `docs/ASSET-EXPERIMENTS.md` "Gemini asset generation").
- **Icons at 32×32**, transparent background, matching the game's dark-grotty-but-funny identity.
- **Item set = wood + stone** (whatever `ITEMS` in 008 defines); the manifest is built to extend.
- **Python** pipeline under `scripts/gen-icons/` (not Node) — consistent with the reference impl + the PIL
  tooling already in `scripts/pixel-crawler/`.
- **Secret hygiene:** key is **env-only, never committed**; `.gitignore` already covers `.env*`. Only the
  **processed 32×32 PNGs** are committed; raw ~1024px generations are gitignored scratch.

**Patterns/files to mirror (from research):**

- `scripts/gen-art/README.md` + `lib.mjs` — CLI shape, `requireEnv`-style clear error when the key is
  unset, `--flag value` arg parsing, outputs defaulting to a gitignored scratch dir. Mirror the README
  structure and the "raw is scratch / processed is committed" split.
- `scripts/pixel-crawler/objects.py` — established PIL/numpy usage in this repo (components/crop); reuse the
  same idioms for key-out/crop/downscale.
- `docs/ASSET-EXPERIMENTS.md` "Gemini asset generation (via guppi)" — the documented endpoint/model/auth +
  the proposed 4-step workflow this plan makes real. `docs/ASSETS.md` — where committed assets live and how
  origins are noted.
- Plan 008: `ITEMS[*].icon` filenames (`public/assets/icons/<id>.png`) are the exact targets to overwrite;
  `iconKey(id)` loads them; UI falls back to the item `color` rect if a key is missing.

## Steps

- [x] **Step 1: Build the pipeline (script + prompt manifest + docs)** `[inline]`
  - Outcome: Added `scripts/gen-icons/` — `prompts.py` (shared `STYLE_PREAMBLE` + `SUBJECTS`
    manifest for `wood`/`stone`/`berries`; adding an item = one line), `generate.py` (compose →
    Gemini POST via stdlib `urllib` → raw scratch → PIL key-out/square-crop/downscale-to-32×32 →
    icons; flags `--dry-run`/`--only`/`--raw-only`/`--tolerance`/`--resample`/`--quantise`), and a
    `README.md` mirroring `gen-art`. `.gitignore` now covers `scripts/.gen-icons/`. Docs updated:
    `docs/ASSETS.md` new "Item icons" section, `docs/ASSET-EXPERIMENTS.md` Gemini section promoted
    to the real pipeline. Acceptance check ✓: `--dry-run` prints all 3 composed prompts, no API
    call; unknown-id and missing-key paths both error cleanly with no spend.
  - **Deviations:** (1) item set is `wood`/`stone`/`berries` (008 shipped 3 icon'd items, not just
    wood+stone) — per the plan's "only current ITEMS" rule. (2) Downscale defaults to `lanczos`
    (area-average, reads cleaner going 1024→32) with `--resample nearest` still available, rather
    than nearest-by-default as the plan text said. (3) Used stdlib `urllib` not `requests` (zero
    extra dep, works cross-machine). **Commit deferred to check-in:** working tree has concurrent
    plan-014 (map-builder) WIP, incl. shared edits to `docs/ASSETS.md` — commit only plan-009 files.
  - New `scripts/gen-icons/`:
    - `prompts.py` (or `prompts.json`) — a **shared style preamble** (dark-grotty-but-funny; single centred
      item; flat/solid keyable background; chunky readable silhouette; limited palette; slight top-down 3/4
      item-icon framing; **no text / no border**; composed to survive a hard 32×32 downscale) **+ one
      subject line per item** (`wood`, `stone`, …). Adding an item = one line. This is the "consistent set
      of prompts" — the preamble is shared verbatim across every item.
    - `generate.py` — read the manifest, compose `preamble + subject` per item, POST to the endpoint above
      with `x-goog-api-key: $GEMINI_API_KEY` (read from env; **clear error if unset**, mirroring
      `gen-art/lib.mjs requireEnv`). Save raw ~1024px PNG (inline base64 in the response) to
      `scripts/.gen-icons/raw/<id>.png` (gitignored), then **PIL post-process**: key out the background to
      alpha → square-crop to content → **nearest-neighbour downscale to 32×32** → optional palette quantise
      → write `public/assets/icons/<id>.png`. Flags: `--only <id>` (regen one), `--dry-run` (compose +
      print prompts, no API call, no spend), `--raw-only` (generate but skip post-process for eyeballing).
    - `README.md` — mirror `scripts/gen-art/README.md`: the **Tailscale/LAN-key** note (key from
      `guppi/house-helper/.env`, never commit), setup/run commands, the **style rules**, the "raw gitignored
      / processed 32×32 committed" split, and "how to add a new item" (one manifest line).
  - `.gitignore`: add `scripts/.gen-icons/` (raw scratch) — mirror the existing `scripts/.gen-art/` entry.
  - Docs: `docs/ASSETS.md` — new **Item icons** subsection (pipeline overview, 32×32 target, icons live at
    `public/assets/icons/`, placeholder→real flow, origin note). `docs/ASSET-EXPERIMENTS.md` — promote the
    Gemini "proposed workflow" to the **actual** `scripts/gen-icons/` pipeline; note the Tailscale route.
  - Side effects: pure tooling — writes only under `scripts/gen-icons/`, `scripts/.gen-icons/` (scratch),
    `public/assets/icons/` (when run), and docs. No game-code/build impact. `--dry-run` needs no key.
  - Done when: `python3 scripts/gen-icons/generate.py --dry-run` prints the composed per-item prompts; docs
    updated; `.gitignore` covers the raw scratch dir. Commit + push (tooling only, safe on green).

- [x] **Step 2: Generate real icons (gated on key) + verify** `[inline]` — **review checkpoint**
  - Outcome: Key pulled from guppi (`/home/guppi/house-helper/.env`) over Tailscale (SSH user
    `guppi`) straight into a local gitignored `.env`, value never echoed. Ran
    `generate.py` → generated + post-processed real 32×32 icons for `wood`/`stone`/`berries`
    (raw ~1024px in gitignored `scripts/.gen-icons/raw/`). Eyeballed at 6× and at in-game slot
    scale (drove items in via `__test.applyScenario` on the dev build, screenshotted the populated
    hotbar) — all three read well, consistent set, backgrounds fully keyed (fringe-pixel check: 0/0/
    negligible). Verify sweep: `npm run build` clean; `npm run smoke` PASSED (game booted, Game+UI
    active, **0 console/page errors** = icons loaded clean). Docs: `docs/ASSETS.md` "Origins" note +
    berries-bush note updated; `docs/STATUS.md` new plan-009 block; `.env.example` gained a
    documented `GEMINI_API_KEY=` line. Placeholder→real: `public/assets/icons/{wood,stone,berries}.png`
    overwritten with generated art.
  - **Note:** background keyer handles a non-flat (vignetted) chroma bg fine at default tolerance 45;
    default downscale is `lanczos`. Commit again scoped to plan-009 files only (concurrent plan-014
    WIP still growing in the tree).
  - **Precondition:** `GEMINI_API_KEY` reachable this session (Matt confirms Tailscale up / provides the
    key) **and** the agent proxy allows `generativelanguage.googleapis.com` (check
    `$HTTPS_PROXY/__agentproxy/status` if a call is blocked). If either is missing, **stop here** and hand
    back — the pipeline (Step 1) is the durable deliverable; Matt runs generation later from a machine with
    the key. Do not fake or hand-draw icons.
  - Run `python3 scripts/gen-icons/generate.py`; **eyeball** each 32×32 result at in-game scale (they'll
    render in the inventory grid from plan 008) — check silhouette reads, palette fits, background fully
    keyed. Regenerate individuals with `--only <id>` (tweak the subject line, not the shared preamble,
    unless the whole set needs it) until consistent.
  - Replace the placeholder `wood.png`/`stone.png` with the generated ones; note each icon's origin
    (prompt) per the "commit the processed sprite + note its origin" convention.
  - Verify: `npm run build` clean, `npm run smoke` (icons load, 0 console errors), quick manual/screenshot
    check of the inventory grid. Update `docs/STATUS.md` (icons now real, generated via `scripts/gen-icons/`).
  - Docs: record in `docs/ASSETS.md` that wood/stone icons are Gemini-generated (+ the prompt manifest is
    the reproducible source).
  - Done when: real 32×32 icons committed + rendering in-game, full sweep green, docs updated, pushed —
    **or** cleanly deferred with the pipeline in place and the reason recorded.

## Out of scope

- **Non-item art** (terrain tiles, mobs, stations) — this pipeline targets item icons; environment art has
  its own path (`scripts/gen-art/` RD/PixelLab trials, `scripts/pixel-crawler/` extraction).
- **Icons beyond the items 008 defines** — the manifest extends by one line each, but only current `ITEMS`
  are generated now.
- **Auto-running generation in CI / cloud sessions** — key is LAN-only by design; generation is a
  human-gated, run-when-reachable step, not part of the deploy.
- **Inventory mechanic / UI** — delivered in plan 008; this plan only supplies the art.
