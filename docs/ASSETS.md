# Assets & Art Pipeline

How we make and manage art. Direction lives in [GAME-DESIGN.md](GAME-DESIGN.md#art-direction);
this is the *how*.

## Which pipeline? (pick this BEFORE generating anything)

When asked to **generate/make a tile, icon, sprite, prop, or asset**, the **default is the
Gemini image-gen + post-process pipeline** — Gemini (`gemini-2.5-flash-image`, "Nano Banana")
image-to-image, then a PIL post-process (keyout → downscale → outline/cel-shade/quantise) so
the result sits next to the pack's hand-drawn art. Synthesis-from-code is the **narrow
exception**, not the norm. Route by what you're making:

| You want to make… | Pipeline | Doc / scripts |
|---|---|---|
| An **inventory/item icon** (32×32) | Gemini | [gemini-pipeline.md](gemini-pipeline.md) · [`scripts/gen-icons/`](../scripts/gen-icons/) |
| A **character animation strip** (missing pose on a pack actor) | Gemini image-to-image + cel-shade | [AI-SPRITE-PIPELINE.md](AI-SPRITE-PIPELINE.md) · [`scripts/pixel-crawler/gen_*_gemini.py`](../scripts/pixel-crawler/) |
| A **static world prop / structure / decorative tile** (jetty, dock, furniture, wreckage, a themed one-off tile) | Gemini + the static-prop playbook | [AI-SPRITE-PIPELINE.md § Static world-prop sprites](AI-SPRITE-PIPELINE.md#static-world-prop-sprites-the-destroyed-tents--a-reusable-playbook) · `scripts/gen-tents.py` pattern |
| A whole art set that a **stock pack already ships** | Import, don't generate | [CRAFTPIX.md](CRAFTPIX.md) |
| A **seamless terrain transition / Wang tile** that must tile edge-to-edge AND survive editor rotation with zero seams (coast, multi-tile fills) | **Pure synthesis** (the exception) | [TILE-AUTHORING.md](TILE-AUTHORING.md) |

**The rule of thumb:** if it's a *thing* (an object, character, icon, or a one-off themed
tile), **generate it with Gemini**. Only reach for code-synthesis when the job is *seamless
tiling geometry* — pixel-perfect edges that repeat and rotate — which AI gen cannot hold at
16px and synthesis nails (see TILE-AUTHORING's "when you need this"). When a job looks like
both (e.g. a jetty that's a wooden *prop* but also needs to tile into runs), **default to
Gemini for the look and ask** before falling back to synthesis.

Whichever path: **commit only the processed/derived output + the reproducible origin**
(prompt manifest or generator script), and pull `GEMINI_API_KEY` off guppi over Tailscale
(see [gemini-pipeline.md](gemini-pipeline.md) — it's reachable from a cloud session).

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

> **Origins:** all five item icons — `wood`, `stone`, `berries`, `cloth`, `cannedFood` — are
> **Gemini-generated** (`gemini-2.5-flash-image`) via `scripts/gen-icons/`; regenerate/tweak from
> `prompts.py`, the reproducible source. No item icons remain as placeholders (`cloth`/`cannedFood`
> were the last `tent-art.mjs` coloured-rect stand-ins; `cannedFood`'s file was renamed
> `canned_food.png` → `cannedFood.png` to match the `<id>.png` convention).

## Where assets live

- `public/assets/` — sprites/tilesets/atlases the game loads (Vite serves it from the site root;
  packs are staged under `public/assets/tilesets/<pack>/`, pipeline-derived PNGs under `_derived/`).
- `docs/assets/reference/` — reference material (e.g. the Google Maps screenshot of Mostowo).
- Licence notes travel with any third-party pack.
