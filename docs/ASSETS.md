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

## The rest of the pipeline

This hub keeps art direction, the retired reference pack, item icons, and where files live. Deeper detail is split out:

- → [wired-art inventory: active Pixel Crawler tileset, sprite extraction, art-swap frames, runtime weapon pinning](wired-art.md)
- → [asset catalog & pack-manifest schema: pack.json, regions.json, atlas regions, type/grid overrides, ingested packs](assets-catalog.md)
- → [operational Gemini item-icon pipeline (endpoint, key, workflow)](gemini-pipeline.md)

## Item icons (Gemini pipeline, plan 009)

Inventory **item icons** live at [`public/assets/icons/`](../public/assets/icons/) as **32×32
transparent PNGs**, one per item, named `<item-id>.png` (matches `ITEMS[*].icon` in
`src/data/items.ts`; loaded as `icon:<id>`, with the item's `color` rect as fallback if a key is
missing). They're generated from prompts, not hand-drawn:

- **Source of truth** = the prompt manifest in [`scripts/gen-icons/prompts.py`](../scripts/gen-icons/prompts.py)
  — a shared style preamble + one subject line per item. Regenerate any icon from there; that's the
  reproducible origin (per the "commit the processed sprite + note its origin" convention).
- **Pipeline:** [`scripts/gen-icons/`](../scripts/gen-icons/) — Gemini (`gemini-2.5-flash-image`)
  generates ~1024px, then PIL keys out the flat background → square-crops → downscales to 32×32 →
  optional palette quantise. Full R&D context + endpoint/auth in
  [ASSET-EXPERIMENTS.md](gemini-pipeline.md#gemini-asset-generation-via-guppi); run commands and
  "how to add an item" in that script's README.
- **Placeholder → real flow:** plan 008 shipped coloured-rect placeholder PNGs so the inventory UI
  worked immediately; plan 009 replaces them with generated art. Generation is **gated on
  `GEMINI_API_KEY`** (LAN-only, via Tailscale), so it's a run-when-reachable step, not part of the
  build — the game stays green on whatever icons are committed.

> **Origins:** `wood`, `stone`, `berries` are all **Gemini-generated** (plan 009,
> `gemini-2.5-flash-image`) via `scripts/gen-icons/` — regenerate/tweak from `prompts.py`, the
> reproducible source. No item icons remain as plan-008 placeholders.

## Where assets live

- `public/assets/` — sprites/tilesets/atlases the game loads (Vite serves it from the site root;
  packs are staged under `public/assets/tilesets/<pack>/`, pipeline-derived PNGs under `_derived/`).
- `docs/assets/reference/` — reference material (e.g. the Google Maps screenshot of Mostowo).
- Licence notes travel with any third-party pack.
