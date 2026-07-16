# Asset decisions

Art-pack swaps, theme pivots, CraftPix ingest, the art pipeline, and tile regions/roles.

Part of the [decision log index](../DECISIONS.md). Newest first.

---

## 2026-07-16 — [DECIDED] Per-region roles on mixed tile/object sheets, not physically splitting the sheet (plan 028)

Some stock Anokolisa sheets are **mixed**: one PNG classed `tile` holds both true 16px terrain and
large multi-cell props (e.g. `garden-environment/Assets/Tiles.png` — fountains/statues/trees/a bench
alongside grass/cobble). **Chose option B — per-region roles on the one sheet — over physically
splitting the PNG.** Splitting fights the **load-in-place rule** (a re-downloaded pack won't
reproduce split files; they'd have to live under `_derived/`, duplicating pixels + a second texture
load, with no generator to catch drift); region-roles reuse the existing region machinery and change
no map format; on mobile/single-texture terms, one PNG loaded once under two keys beats two textures.

**Invariant (collapses the complexity — don't re-litigate):** a `tile` sheet is already 16px
grid-sliced, so a tile frame index is **always** a whole-sheet index — object regions never re-index
the tile grid. A `tile` sheet may therefore carry `object`-role regions (MVP: object-role only;
`tile`-role deferred, schema left extensible). "Regions on a tile sheet" is purely a catalog +
editor-UI concern; no Preload/EditorScene/map-format change was needed. Full detail:
[ASSETS.md](../assets-catalog.md#atlas-sprite-regions-plan-014-step-7a), `plans/028-editor-tile-sheet-object-regions.md`.

## 2026-07-16 — [DECIDED] CraftPix ingest: 4 theme packs, no-shadow variants, directional sheets sliced

Bringing in CraftPix.net packs (18 downloads, growing). Three settled choices, all in CRAFTPIX.md:

- **Consolidate into 4 theme/type packs** (`craftpix-nature`/`-undead`/`-dungeon`/`-creatures`) with
  per-source subfolders, not one pack per download. Rationale: the pack-discovery tooling groups the
  Library by pack; 4 themed groups are far more navigable than one-per-download, and per-source
  subfolders keep provenance + avoid filename collisions (undead + cursed both ship
  `Water_coasts.png`). **New downloads fold into these 4** by theme/type rather than adding packs
  (e.g. later orc/slime mobs → `-creatures`, chapel/workshop/home/traps → `-dungeon`). The actor pack
  was renamed `craftpix-animals` → `craftpix-creatures` once mobs joined wildlife (it's a *type*
  group — directional sprites that get sliced — so "animals" stopped fitting); safe, nothing wired
  referenced it.
- **Prefer the no-shadow variant** wherever the download ships one (all nature props + all actors).
  Rationale: our wired art (pixel-crawler trees, skeleton) has no baked shadows, so CraftPix's
  `_shadow` disc would sit wrong. undead/cursed/rocky-area ship *only* shadowed/terrain-baked sprites
  — kept shadowed for now, flagged for later shadow-strip (the log-pile precedent), not blocking.
- **Slice directional sheets at ingest, don't extend the schema.** CraftPix packs actors as one sheet
  whose ROWS are facings and COLUMNS are frames (an N×4 grid). Rather than teach the runtime/editor a
  new "directional sheet" concept (new schema + editor UI to assign rows→facings), a re-runnable
  slice step (`scripts/craftpix/slice.py`) normalises each sheet into per-direction strips — after
  which the *existing* "one file = one strip = one clip" model (the wired pixel-crawler actor
  convention) handles them with zero new code and auto-detected frame counts. This pushes every
  vendor's packing quirk to the ingest boundary so the core sees one convention. Supersedes the
  earlier "represent in place via a `clipRows` descriptor" lean once slicing proved simpler to
  consume and more general across packs. Row→facing order differs per pack (animals vs guild) and is
  recorded in `slice.py`; verify L/R when an actor is actually wired.

## 2026-07-12 — [DECIDED] Theme is dark-fantasy, not zombie apocalypse (story pivot, follows the art)

The active art has been medieval-fantasy (Pixel Crawler — skeletons, orcs, bonfires) since plan 005,
but that swap was explicitly logged as **art-only, "not a story change"** (see 2026-07-11 [PROPOSED]
below): the story stayed a zombie apocalypse and the fantasy mobs were "reskinnable stand-ins". We're
now **making it a story change** — the game *is* a **dark-fantasy survival adventure**, not a zombie
one. This resolves the growing mismatch where the art, the title screen, and the enemy sprite
(skeleton) all read fantasy while the design docs still said "zombie apocalypse".

**Framing (kept deliberately light — a generic dark-fantasy wilds, not heavy bespoke lore):** you're
camped at Mostowo when the **old woods wake** — the dead don't stay down and creatures come out of the
treeline at night. Everything else is **unchanged**: the four pillars (base building · survival ·
crafting · base defense), the day/night risk/reward rhythm, hunger as the core pressure, the
real-Mostowo grounding, mobile-first, and the **dark-and-grotty-but-funny** tone (which fantasy
carries as well as horror did).

**Scope of this change:** prose/design docs only — `GAME-DESIGN.md` (pitch, setting, enemies, MVP),
`LORE.md`, and the one-liner in `CLAUDE.md`, plus the title-screen copy (already de-zombified: "MOSTOWO
/ SURVIVAL", tagline *"something stirs in the old woods"*). **Code identifiers are left as-is** for now
— the enemy's data id stays `kidZombie` / name `Kid Zombie`, and `zombieAt`/`ZombieUnit`/`zombieStats`
keep their names (a rename is a mechanical refactor to schedule separately, not a design decision). New
content should be authored fantasy-first; the zombie names in code are legacy, not intent.

Supersedes the "not a story change" caveat in the 2026-07-11 [PROPOSED] entry below.

## 2026-07-12 — [DECIDED] Swap active art to Pixel Crawler; zombie pack retired (plan 005)

Committed the swap proposed below: `ACTIVE_TILESET` now points to `PIXEL_CRAWLER_TILESET`
(`src/data/tileset.ts`). The old `ZOMBIE_APOCALYPSE_TILESET` const is removed (git history +
[docs/ASSETS.md](../ASSETS.md#zombie-apocalypse-tileset--retired-reference-fallback-2026-07-11) retain
the record); its files stay under `public/assets/` as retired reference/fallback art, not deleted.
Manifest reshaped to a role-based schema (`TileSource` union — `image`/`sheetFrame` — plus
`StripAnim`/`ActorRender`), replacing the old approach, since the new schema is strip-only.

**Skeleton (Base)** mob is the sprite stand-in for the kid zombie — enemy data id `kidZombie` /
`name: 'Kid Zombie'` unchanged, only the sprite changed, consistent with the "reskinnable
stand-ins" call below.

Added **3-way directional facing for the player** (Down/Side/Up idle+walk strips; Side art faces
right, `flipX` mirrors left, driven by `lastFacing`). The **enemy stays single-orientation** (Run
strip only, frame 0 = idle, flips by movement-x) — mob sheets in this pack ship no directional
variants.

**Escape hatch (deferred, not done):** the zombie pack doesn't need to stay runnable (Matt's call
mid-plan), but could be made to fit the new strip-only schema by montaging its per-frame PNGs into
horizontal strips.

**Deferred primitive:** the new `sheetFrame` `TileSource` (a single fixed frame per tile) is also
the right shape for future adjacency-mask → frame **autotiling** — intentionally left as a
door-opener; only single fill frames are wired today (grass weighted-random, wall single fill).

Supersedes the [PROPOSED] entry directly below (Pixel Crawler is now committed/wired, not just the
leading candidate). Full narrative:
[docs/ASSETS.md](../wired-art.md#active-tileset--pixel-crawler-wired-in-plan-005).

## 2026-07-11 — [PROPOSED] Adopt Pixel Crawler as the base art (re-theme to fantasy), darken later

Evaluated **Pixel Crawler — Free Pack v2.11** (Anokolisa) and made it the **leading replacement** for
the Zombie Apocalypse pack: better art quality and a style we prefer. Accepted trade-off — it's
**medieval-fantasy** (knights/orcs/skeletons/anvils/bonfires), not zombie/modern. Matt's call: keep
this art despite it **not being grim-dark enough yet**, and darken it *later* via grimmer
tiles/props/recolours + a lighting pass (proven viable by `demo2_camp_night.png`). So this swaps the
*art* and treats fantasy mobs as reskinnable stand-ins — **not** a story change, and **not yet wired
into `src/data/tileset.ts`** (evaluation only; still PROPOSED). If it pans out, buy more of Anokolisa's
paid packs (same grid/conventions). Full index + demos: pack
[`README.md`](../../public/assets/tilesets/pixel-crawler/README.md) and
[`docs/ASSETS.md`](../wired-art.md#active-tileset--pixel-crawler-wired-in-plan-005). Zombie pack stays the
wired-in default until this is committed.

## 2026-07-11 — [DECIDED] Art pipeline: programmatic placeholders first

Start with generated/coloured-rect placeholder art so we can build and feel the mechanics quickly
(ideal for on-the-go sessions), then swap in real pixel art (free CC0 tileset and/or hand-drawn)
once the slice is fun. Keeps art off the critical path.

## 2026-07-11 — [DECIDED] Art identity: dark & grotty, but humorous

Grimy survival-horror palette with comic items/enemies/visual gags. Rationale: distinctive tone,
and humour keeps a grim premise fun.

## 2026-07-11 — [DECIDED] Asset pipeline: free CC0 tilesets + Gemini "Nano Banana" (via guppi)

Start with CC0 tilesets (Kenney first) for a coherent base; generate bespoke on-theme items/enemies
with `gemini-2.5-flash-image` mirroring `guppi/house-helper/catalog_icons.py`. Key lives on the home
server (`GEMINI_API_KEY`, gitignored, LAN-only) so generation runs from a guppi-reachable machine and
processed sprites get committed. Detail in ASSETS.md.
