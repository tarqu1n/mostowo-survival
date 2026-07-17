# Importing CraftPix asset packs

How to bring a [CraftPix.net](https://craftpix.net) pixel-art pack into the repo so it shows up in
the Map Builder Library and is usable in authored maps. This is the CraftPix-specific companion to
[ASSETS.md](ASSETS.md) — read its "Pack manifests & asset catalog" and "Atlas sprite regions"
sections for how `pack.json` / `regions.json` / the catalog work; this doc covers what's *particular
to CraftPix*.

## The ingest is scripted

Two committed scripts under [`scripts/craftpix/`](../scripts/craftpix/) do the whole job — the
decisions below are encoded there, so re-running reproduces the packs:

- [`ingest.py`](../scripts/craftpix/ingest.py) — reads the extracted CraftPix downloads, copies the
  chosen subset/variant of each into the 4 theme packs, and slices directional actor sheets.
- [`slice.py`](../scripts/craftpix/slice.py) — cuts a directional sheet (rows = facings) into one
  horizontal strip per direction. Also a standalone CLI to re-slice from a committed `_src/` sheet.

Then regenerate the catalog (as for any pack):
```
python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog
```
And **restart `npm run editor`** if it's running (Vite caches `public/` at startup — new/removed pack
dirs aren't served until a restart; see the gotcha in ASSETS.md).

> Sources are the extracted downloads in `~/Downloads` / a scratch dir, **not** committed (they're
> the whole zips; we only take a subset). The re-runnable artifact in-repo is the sliced actors'
> `_src/` raw sheets (excluded from the catalog) + these scripts + this doc.

## Three settled decisions (see DECISIONS.md 2026-07-16)

### 1. Four theme packs, not one-per-download

18 downloads consolidate into **4 packs** grouped by theme/asset-type, each with per-source
subfolders (keeps provenance + avoids filename collisions — undead & cursed both ship
`Water_coasts.png`):

|Pack|Contents|Sub-folders|
|---|---|---|
|`craftpix-nature`|outdoor natural props + overgrown ruins|`Trees/ Bushes/ Crystals/ Rocks/ RockyArea/ Ruins/`|
|`craftpix-undead`|dark tilesets + horror props (undead + cursed-land)|`Undead/{Tiles,Fx,Objects}/  Cursed/{Tiles,Objects}/`|
|`craftpix-dungeon`|man-made structures/props/defenses + NPCs|`DungeonObjects/ DungeonProps/ GuildHall/ Chapel/ Workshop/ Home/ Traps/`|
|`craftpix-creatures`|directional actors — wildlife + mobs (sliced)|`Fox/ Boar/ Deer/ Hare/ Black_grouse/ Orc1-3/ Slime1-3/`|

> **`craftpix-animals` was renamed to `craftpix-creatures`** when orc + slime mob packs arrived —
> the pack is a *type* group (directional actor sprites needing slicing), and "animals" no longer
> fit mobs. Safe rename (nothing wired referenced it yet).

The chapel & workshop NPCs (monks, priest) ship **already separated per-direction** by CraftPix
(`Mon1k_Idle_front-Sheet.png`, `Priest_Walk_left.png`) — the ideal case: no slicing needed, they
fit the strip model as-is. Their irregular "packed" mega-sheets (Parishioner, Master) are imported
where useful but not sliced (grid-tune in the editor if wired).

Each pack is still a **separate** `pack.json` (the tooling scans top-level dirs under
`public/assets/tilesets/` and enforces folder-name == `pack.id`). The `craftpix-` prefix groups them.

### 2. No-shadow variant where available

Our wired art (pixel-crawler trees, the skeleton) has **no baked shadows**, so CraftPix's `_shadow`
contact-disc would sit wrong. So we take the **no-shadow** variant wherever the download ships one:

- **Has a clean no-shadow variant → used:** trees/bushes/crystals (plain `Assets/`), rocks
  (`*_no_shadow.png`), animals (`Without_shadow/`, minus the standalone `*_shadow.png` layer), all
  guild characters (`*_without_shadow.png`).
- **No clean no-shadow variant → kept shadowed (for now):** undead + cursed objects (every separated
  sprite is `*_shadow*`), rocky-area (only `_grass_shadow`/`_ground_shadow`, a baked terrain disc).
  These are the grimdark horror set; shadow-stripping them (the log-pile grass-strip precedent in
  ASSETS.md) is a deferred follow-up, not done here.

### 3. Directional actor sheets are SLICED at ingest

CraftPix packs an actor as **one sheet: rows = facing directions, columns = frames** (an N×4 grid,
32px cells for animals). Our codebase models actor animation as *one file = one horizontal strip =
one clip* (the wired pixel-crawler actors ship separate per-direction files). So the ingest
**normalises** each directional sheet into per-direction strips (`<base>_<dir>.png`) — after which
the existing catalog/StripAnim pipeline handles them with **no new schema**, and frame counts
auto-detect (a sliced strip is `cols×1` at the cell height). This pushes every vendor's packing quirk
to the ingest boundary; the core only ever sees one convention.

- **Row→facing order differs per pack** (verified visually, recorded in `ingest.py`): wildlife
  animals = `[up, down, left, right]` @32px; guild NPCs + orc + slime mobs = `[down, left, right, up]`
  (orc/slime @64px cells). Left/right are near-mirrors, so an L/R mix-up is cosmetic until an actor is
  wired (the 3-way down/up/side + flipX rig picks one side then). **Verify L/R at wire time.**
- **Non-square cells need a `frames` override.** Auto-detection assumes square frames; the guild
  mage's `64×52` cells don't divide evenly, so `ingest.py` writes a `frames` override for those 16
  sliced strips. Everything else (32/64px square) auto-detects.
- **`_src/` holds the raw multi-row sheets**, excluded from the catalog (`exclude: ["**/_src/**"]`),
  so slicing is re-runnable in-repo: `python3 scripts/craftpix/slice.py <_src sheet> <dest> <base>
  <cellW> <cellH> up,down,left,right`.
- **Single-row sheets aren't sliced** (Guildmaster, Talking*, Reader) — they're already strips.

#### Column-animation Fx sheets are sliced too (the transpose case)

Some **Home/Fx ambient anims** pack the *other* way: each animation is a **vertical column**
whose frames run **top-to-bottom**, several columns side by side (`cat_animation.png` is one column;
`Trees_animation.png` is a 9×13 grid of 64×80 cells — 9 tree anims × 13 sway frames). That's the
transpose of a directional sheet, so the same normalise-at-ingest rule applies: `slice.py`'s
`slice_columns` (the complement of `slice_directional`) **transposes each column into a horizontal
strip** — column `c`'s frames become one `<base>_<label>.png` clip. `Trees_animation.png` → 9 strips
(`Trees_animation_{green,apple,dark}_{lg,md,sm}.png`), labels = 3 species × 3 sizes. Cells are
non-square (64×80), so each strip gets a `frames: 13` override exactly like the mage's 64×52 rows.
Driven by `ingest.py` (`slice_into(..., by_column=True)`); raw sheet kept in `Home/Fx/_src/`.

## What was imported (record)

Licence for all: free personal/commercial, alterable, **no reselling/redistributing standalone**
(`License.txt` travels with each pack; <https://craftpix.net/file-licenses/>). Counts are catalog
assets.

|Pack|Group|Assets|Notes|
|---|---|---|---|
|`craftpix-nature`|Trees/Bushes/Crystals/Rocks|40 each|no-shadow variant|
||RockyArea|38|mushrooms/shells; **baked grass base** (only variant shipped)|
||Ruins|40|overgrown stone ruins/arches; no-shadow variant|
|`craftpix-undead`|Undead|240 obj + 5 tiles + 6 fx|bones/graves/dead-trees/thorns/ruins — very on-theme; shadowed|
||Cursed|127 obj + 7 tiles|body-horror plants/ruins; shadowed|
|`craftpix-dungeon`|DungeonObjects + DungeonProps|6 + 9 atlases → ~550 regions|dropped `full.png`/`Cannon_restricted_size.png` dups|
||GuildHall|6 env + 2 fx + 14 sliced + 6 passthrough|characters no-shadow, sliced to per-direction strips|
||Chapel|5 env + 4 props + 58 char strips|monks/priest pre-separated per-direction (no slicing); Parishioner packed sheets skipped|
||Workshop|6 env + 2 fx + 4 NPC sheets|forge + glassblower NPCs; Master is a packed sheet (grid-tune in-editor)|
||Home|5 env + 4 fx + 9 tree strips|player-home/base set (walls/floor/interior + ambient bird/cat/smoke anims); `Trees_animation` column-sliced into 9 per-tree sway strips|
||Traps|86 (Spikes/Barricades/Lightning/Barrel)|base-defense props; barricades have build/destroy + D/S/U facings; kept as objects|
|`craftpix-creatures`|Fox/Boar/Deer/Hare/Black_grouse (wildlife)|104 strips|32px, 26 sheets × 4 dirs, sliced, no-shadow|
||Orc1-3 + Slime1-3 (mobs)|168 strips|64px, 42 sheets × 4 dirs, sliced, no-shadow|

## Follow-ups (not done here)

- **Terrain roles unwired.** undead/cursed `Tiles/` sheets are catalogued as 16px tiles but nothing
  declares which frame is grass/water/coast — paintable now, roles TBD (like the Anokolisa paid packs).
- **Actors need wiring.** animals + guild `Characters/` are ingested (browsable) but not spawnable —
  needs typed data + `ActorRender`/`StripAnim` + spawn logic + `anims.create`, per the skeleton/bat
  pattern. Confirm each species' row→facing (esp. grouse `Flight`) when wiring.
- **Fx/animation sheets** (undead `Animation*`, guild `Fire`/`Flags_animation`, and the remaining Home
  `bird_*`/`cat`/`Smoke` anims) catalog as 1 unsliced frame (the benign warnings); set their grids in
  the in-editor object editor when used, or — for the vertical-column ones like `cat_animation` — slice
  them with `slice_columns` as `Trees_animation` now is (see the transpose case above).
- **Shadow-strip the horror set** (undead/cursed/rocky-area) if a shadowless look is wanted there too.
