# Asset catalog & pack manifests

The system/schema for the asset catalog: how packs, `pack.json`, `regions.json`, atlas sprite regions, and per-asset type/grid overrides work — plus the record of ingested packs. Reference for wiring tooling and the editor.

See also: [the concrete wired-art inventory](wired-art.md) · [art-pipeline hub](ASSETS.md).

## Pack manifests & asset catalog

Every pack dir under `public/assets/tilesets/<pack>/` carries a `pack.json`: `id`, `name`, `author`,
`sourceUrl`, `licence`, `tileSize`, plus `rules` (glob patterns) encoding the 3 load classes above —
`tile` (`Environment/Tilesets/**`), `strip` (`**/*-Sheet.png`), everything else defaults to `object` —
and a `selfMade` rule (tags `_derived/**` etc as `origin: "self-made"`). `overrides` (exact relative
path → partial field patch) and `exclude` (globs, dropped entirely) are the per-pack escape hatches
for the odd sheet the mechanical rule gets wrong (e.g. the skeleton Death-Sheet's `frameWidth`
exception above needs a `frames` override).

`npm run assets:catalog` (`scripts/asset-catalog.mjs`, Node built-ins only — no image-parsing dep,
PNG width/height read straight off the IHDR chunk) walks every `pack.json`'d dir and regenerates the
**committed** `public/assets/asset-catalog.json` the Map Builder editor's Library panel browses.
Deterministic (packs/assets/tags all sorted, no timestamp) — re-running with no pack changes produces
a byte-identical file. Never hand-edit the catalog; re-run the script after adding/removing pack
files or editing a `pack.json`.

`public/assets/tilesets/mostowo-custom/` is the home for self-made art — same `pack.json` shape,
`licence: "original"`. First resident: `Environment/Tilesets/water_diagonal.png`, a synthesised 45°
water/grass coast tileset (12 frames) — the pack ships no clean diagonal, so it's generated from the
pack palette. **How to author terrain tiles that match a stock pack and tile seamlessly (the
global-band + connector-tile technique, the seamlessness rules, and the wire-into-editor recipe):
[TILE-AUTHORING.md](TILE-AUTHORING.md).** Generator:
[`scripts/mostowo-custom/gen_water_diagonal.py`](../scripts/mostowo-custom/gen_water_diagonal.py).

Also resident: `Environment/Props/Static/log_pile{,_2,_3}.png` — three log-pile props.
**Origin:** generated with **Retro Diffusion** (see [ASSET-EXPERIMENTS.md](ASSET-EXPERIMENTS.md)),
prompted for a top-down log pile with the pack's tree sheet as the *style-reference image*, then
post-processed (all steps reproducible from the Downloaded gen + the scripts below):

- **De-inflate:** RD emits a 4×-upscaled PNG (native pixel size 4). Recover the real grid with a
  `/4` nearest-neighbour downscale *before* anything else, else it fights nearest-neighbour scaling.
- **Ground:** `log_pile.png` shipped a baked grass disc — stripped (green-dominant pixels removed)
  and replaced with a soft translucent drop shadow, so it's terrain-agnostic like the pack props.
  `_2`/`_3` had no ground disc (`_3`'s green is *moss on the wood* — kept, not stripped).
- **Size:** props are baked to a whole-tile footprint (`log_pile` ~2×1.3 tiles; `_2`/`_3` exactly
  16×32 = 1×2 tiles). Placed decor snapshots its size, so **re-place after any resize**.
- **Style-match:** run through
  [`scripts/mostowo-custom/style_match.py`](../scripts/mostowo-custom/style_match.py) — flattens
  painterly shading to N bands, snaps every colour onto a palette auto-extracted from the pack's
  own wood/foliage sprites, and recolours the black silhouette outline to the pack's dark-brown.
  This is the general fix for "the gen art's palette is off" — reusable over any new gen asset
  (`--bands`, `--no-outline`, `--grimy` knobs; `--out-dir` to preview without overwriting).

> **Editor-serving gotcha:** Vite caches its `public/` file list at dev-server **startup**, so a
> brand-new asset file (or dir) returns the HTML SPA-fallback (black thumbnail) until you restart
> `npm run editor`. *Edits* to an already-served file go live without a restart. Drop file in →
> regen catalog → restart editor.

### Additional Anokolisa packs (ingested for the editor Library)

Nine more **paid** Anokolisa packs (bought on the "if it works out, buy more" note above) are staged
alongside the free pack, each in its own `public/assets/tilesets/<id>/`: `castle-environment`, `cave`,
`desert`, `fairy-forest`, `forge`, `garden-environment`, `hideout`, `library`, `sewer`. They're
**ingested into the asset catalog** — browsable/placeable in the Map Builder Library. What that
unlocks depends on the asset kind:

- **Terrain + props/decor are usable in-game *now*, via map authoring** — no code change. `ACTIVE_TILESET`
  (still `pixel-crawler`) is only the *base* load; `PreloadScene.queueMapTextures` additionally loads
  every palette source + placed decor a loaded map references, honouring each entry's own `pack`
  (`tilesetAssetUrl(pack, …)`). So paint a `fairy-forest` tile / drop a `cave` prop into a map, save it,
  and the game loads those textures at boot. They're just invisible until some authored map references
  them.
- **Enemies need code+data wiring** — mobs aren't catalog-placeable map objects; they're spawned AI
  actors defined in typed data + an `ActorRender`/`StripAnim` manifest (frame counts, anchors) + spawn
  logic + `anims.create` (the plan-005/011 skeleton pattern). Ingesting an enemy pack makes its sheets
  *available*; making one actually spawn is a per-enemy feature step.

Two Anokolisa **mob packs** are ingested the same way — `bat-fur` and `small-bat` (directional
Idle/Move/Attack/Death/Hit × Down/Side/Up strips, a richer rig than the free pack's single-orientation
skeleton). Being enemies, they fall under the wiring caveat above. (Their downloads shipped **no
`Terms.txt`** — licence assumed to match the other Anokolisa packs; confirm before any public release.)

These paid packs use a **different internal layout** than the free pack, so each carries its own tuned
`pack.json` (not the free pack's rules): terrain lives at `Assets/{Tiles,Ground,Sand,Water}.png`
(classed `tile`, all 16-px-aligned) rather than `Environment/Tilesets/**`; enemy anims are the usual
`**/*-Sheet.png` strips (Idle/Run/Death/Hit); `Weapons/**`, `Assets/Props.png`, `Assets/Tree.png`,
`Assets/Light.png`/`Shadown.png` fall to `object` (region-detected atlases). Ingestion dropped the
non-game files via `exclude`: `Social/**` (promo covers/mockups), `**/*.png~` (editor backups),
`**/*.gif`, `**/*.aseprite` (source, per the PNG-only convention). Frame counts on the enemy strips are
left to auto-detection for now — tune any that read wrong via the in-editor object editor (plan 017)
when a pack is actually wired in.

**Licence (paid):** same author terms as the free pack but **purchased** — free to use/alter in any
project, credit optional, but the raw assets may **not** be resold or redistributed standalone, even
altered (each pack's `Terms.txt` travels with it). If this repo/build ever goes public, the raw pack
PNGs should not ship in a form that amounts to redistributing the paid assets.

**Multi-pack region generation:** `scripts/pixel-crawler/gen_regions.py` now walks **every** pack dir
carrying a `pack.json` (matching `asset-catalog.mjs`), writing one `regions.json` per pack; an optional
pack-id argv restricts the run. It previously only did `pixel-crawler`. The two-command regen
(`python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog`) is unchanged and now covers
all packs at once.

### CraftPix packs (ingested for the editor Library)

18 **[CraftPix.net](https://craftpix.net)** downloads are consolidated into **4 theme packs** —
`craftpix-nature` (trees/bushes/crystals/rocks/rocky-area/ruins), `craftpix-undead` (undead +
cursed-land tilesets + horror props), `craftpix-dungeon` (dungeon objects/props + guild/chapel/
workshop/home structures + magic-and-traps defenses), and `craftpix-creatures` (wildlife + orc/slime
mob actors) — ~1150 catalogued assets, each pack with per-source subfolders.
Same "ingested = browsable/placeable now, terrain-roles + actors need wiring later" caveat as the
Anokolisa paid packs above. Three CraftPix-specific choices: we take the **no-shadow** variant
wherever one ships (our wired art is shadowless), and CraftPix **directional actor sheets** (rows =
facings, columns = frames) are **sliced into per-direction strips at ingest** so the existing
one-file-one-clip StripAnim model handles them with no new schema. The whole ingest is scripted
([`scripts/craftpix/ingest.py`](../scripts/craftpix/ingest.py) +
[`slice.py`](../scripts/craftpix/slice.py)). **Full recipe, decisions, and per-pack record:
[CRAFTPIX.md](CRAFTPIX.md)** (decision log: [DECISIONS.md](DECISIONS.md) 2026-07-16). Licence (all):
free personal/commercial, alterable, no reselling standalone (`License.txt` travels with each pack).

### Zelda-like pack (OpenGameArt, CC0)

One **[CC0](https://opengameart.org/content/zelda-like-tilesets-and-sprites)** pack by **ArMM1998**
staged at `public/assets/tilesets/zelda-like/` — a 16×16 top-down set. Ingested the ordinary way (no
special script): the download's game PNGs mapped onto the standard layout — `Environment/Tilesets/`
(`Overworld`/`Inner`/`Cave` → `tile`), `Environment/Props/Objects.png` + `Entities/{Characters,Npcs}/`
(`object`, region-detected). The non-game files (`font.png`, `log.png`) were dropped. Terrain + props
are usable in-game now via map authoring; the character/NPC sheets are browsable but **need actor
wiring** to spawn (same caveat as the other packs). **Style note:** it's GBA-bright — recolour toward
the dark Pixel Crawler palette (`scripts/mostowo-custom/style_match.py`) before mixing it into a map.
CC0 = no attribution required (`LICENSE.txt` in the pack; re-confirm at source before a public build).

### The Fan-tasy Tileset (Valerio Colonna)

One pack from a **different creator** (not CraftPix), so it's its own top-level pack
`public/assets/tilesets/fantasy-tileset/` — a **16×16** medieval-village set (ground/road/water/rock-slope
terrain, buildings, props, rocks, trees/bushes, a directional main character). Ingested by its own
reproducible script [`scripts/fantasy-tileset/ingest.py`](../scripts/fantasy-tileset/ingest.py), which
reuses the CraftPix directional slicer. Conventions match the rest: **no-shadow** (the pack ships a
separate `Shadows/` decal folder, so the sprites are shadowless — `Shadows/` skipped); prefer the
individually-named PNGs over the packed `Atlas/` copies (Trees/Bushes ships only an atlas, so that one's
region-detected); the main-character sheets (`4×4 @ 40×48`, non-square → `frames` overrides) are
**sliced** to per-direction strips. Tiled project files + `Tileset_Layout*` previews dropped. 52
catalogued assets. **Licence:** it's a **free trial** by Valerio Colonna (valeriocolona_art) — the
bundled PDFs (kept in the pack as the provenance record) state no explicit redistribution/commercial
terms, so **confirm the exact licence at source before any public build.**

### Atlas sprite regions (plan 014 step 7a)

Most `object`-type sheets are actually multi-sprite ATLASES (e.g. `Furniture.png` 800×864 holds ~50
placeable props). Rather than physically splitting a sheet into one file per sprite, each pack's
committed `regions.json` sidecar (`public/assets/tilesets/<pack>/regions.json`) carries per-sprite
bounding boxes, detected by connected-components analysis; `asset-catalog.mjs` merges these in so a
`CatalogAsset` with >=2 regions gets a `regions: [{key,x,y,w,h}]` array (0 or 1 stays a plain single
object). Editor/game crop the chosen region at render — the sheet stays the load/dedupe unit
(`collectTextureSources` doc in `mapFormat.ts` has the mobile-memory trade-off this implies).

**A region carries an optional `role` (`'object'`)** — a `tile`-classed sheet may declare object-role
regions (plan 028), so a mixed sheet (true 16px terrain **and** large multi-cell props, e.g.
`garden-environment/Assets/Tiles.png`) stays classed `tile` while its props become placeable decor.
`gen_regions.py` runs no detection pass on a `tile` sheet — its regions are always hand-authored,
tagged `role:'object'` verbatim. In the Library/tile picker, an object region **hides** every 16px
cell it overlaps (cell-centre-inside-region test), so terrain keeps tiling cleanly around the prop.
MVP is object-role only — no `tile`-role regions yet (schema left extensible). Decision + invariant
(a tile frame index is always a whole-sheet index, unaffected by object regions): DECISIONS.md.

**Regen (always both, in order):**
```
python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog
```
Never hand-edit `regions.json` — it's generated, like the catalog itself. The only hand-authored
inputs are two escape-hatch maps in that pack's `pack.json`: `regionParams` (per-sheet detection
tuning — `alphaThresh`/`gap`/`minArea`) and `regions` (a verbatim per-sheet region list, for sheets
where no amount of tuning gets it right — e.g. touching sprites that merge, or a false-positive
non-sprite region). Both keyed by the sheet's relative path. Concrete examples already in
`pixel-crawler/pack.json`: `Rocks.png`/`Resources.png`/`Esoteric.png`/`Tools.png` each had a baked-in
"PALETTE:" swatch legend in one corner that connected-components happily detects as a "sprite" — the
`regions` override drops just that one box; `Trees/Model_03/Size_04-export.png`'s four colour
variants touch at the canopy edges and detect as one merged blob — the override splits it into its
four (plus the already-correct dead-tree/stump) regions.

**In-editor region editing (plan 017 step 4):** the `regions` list no longer has to be hand-authored
in `pack.json`. Open an `object` asset's tab in the Map Builder (`npm run editor`) — its body is a
**Regions** editor overlaying the sheet: drag to draw a box, click to select (with a live x/y/w/h
readout + Delete), drag the body/handles to move/resize, and **grid-slice** a selected box into a
cols×rows grid of equal cells (one action splits a whole merged crop/seed row — the motivating
`Farm.png` case detection can't). **Save regions** `PUT`s `/__editor/asset-regions`
(`scripts/vite-editor-api.mjs`), which **whole-list replaces** `pack.json`'s `regions[relPath]` (the
server clamps every rect in-bounds of the sheet PNG and rejects an out-of-bounds one) then reruns
both generators server-side, serialised, with the same `python3`-ENOENT graceful degrade as
`/__editor/asset-override`. **Reset to auto-detect** saves an EMPTY list, which deletes the key so
the sheet falls back to connected-component detection. Reachable two ways now: picking `object` in
the type dropdown for a strip/tile asset (Save then forces the `object` type override — a genuine
reclassify); or, for a `tile` asset, the **"Edit regions" toggle** beside the Type dropdown, which
opens the same editor **without demoting the asset's type** — Save tags every region `role:'object'`
instead (see "Atlas sprite regions" above). The per-selected-box panel shows a read-only "Role:
object" badge in this mode.

**Content-drift caveat:** the catalog build validates a sidecar region is in-bounds for its sheet
(fatal if not — a stale sidecar after a sheet shrunk), but it can't detect a sprite that moved
*within* a same-size sheet. Re-running `gen_regions.py` after editing ANY pack PNG is the only guard
— there's no automatic staleness check for that case (by design: this module reads pixels, `parseMap`
deliberately doesn't).

### Per-asset type/grid overrides + in-editor reclassify (plan 014 step 7c)

`pack.json` `rules`-based classification (filename/path glob → `tile`/`strip`/`object`) is
mechanical and sometimes wrong — e.g. the furnace sheets (`Bricks_01-Sheet.png` etc., 64×96) match
`*-Sheet.png` → `strip` by filename, but they're 2×2 **grid** animations (4 flame frames arranged in
a square, not one horizontal row), which the filename rule can't express. Two `overrides[relPath]`
keys fix this, consumed by **both** generators before classification (never after — a bare `type`
override redoes the frame/region math, it doesn't just relabel a stale asset):

- **`type: "tile" | "strip" | "object"`** — forces classification, overriding the `rules` glob
  match. A `-Sheet.png` forced to `object` gets a `gen_regions.py` detection pass (and gains
  `regions` if it detects ≥2 sprites); a `.png` forced to `strip` is excluded from detection.
- **`rows`** (strip-only, default `1`) — LEGACY mode: turns the existing `frames` override into a
  GRID: with `rows` rows, `frameHeight = h / rows`, `cols = frames / rows`, `frameWidth = w / cols`.
  `rows: 1` (the default) collapses back to the original single-horizontal-row math, so every
  pre-existing `frames`-only override still means exactly what it always did.
- **`cols` + `omit`** (strip-only, plan 017 step 6) — GEOMETRY mode, which **decouples the grid from
  the played frames**. With `cols` present, `frameWidth = w / cols`, `frameHeight = h / rows` (rows
  default `1`); the total cell count is `cols * rows`, and that is what the catalog's `frames` now
  means. `omit: number[]` lists cell indices (row-major, `0..cols*rows-1`) to SKIP, so the played set
  is every cell minus `omit`, ascending. This expresses a sheet whose grid has blank cells — e.g. the
  Alchemy table `Alchemy_Table_01-Sheet.png` (192×704) is a 2×11 = 22-cell grid whose blank 22nd cell
  is `"cols": 2, "rows": 11, "omit": [21]` → 21 played frames. In geometry mode `frames` is NOT
  authored (it's derived from `cols*rows`); the server rejects an `omit` that skips every cell. Legacy
  `frames`(+`rows`) overrides regenerate byte-for-byte — geometry mode is purely additive.

Example — the furnace fix (legacy mode): `"Environment/Structures/Stations/Furnace/
Bricks_01-Sheet.png": { "frames": 4, "rows": 2 }` → `frameHeight = 96/2 = 48`, `cols = 4/2 = 2`,
`frameWidth = 64/2 = 32`. The same grid in geometry mode: `{ "cols": 2, "rows": 2 }`.

**Preferred path — the in-editor object-editor tab** (Library panel ⚙, plan 017): click the ⚙ on any
non-tile asset card to open its full-size object-editor tab with a `type` dropdown (the `strip` option
is labelled **"Animated strip"**) and, for a strip, free-entry **Columns**/**Rows** fields with a live
grid overlay on the full sheet (updates as you type — pure arithmetic on `w`/`h`, no pixel decode) plus
divisor-pair suggestion chips, and a per-frame preview where **clicking a cell toggles whether it's
omitted** (the geometry-mode `omit` authoring above). Committing `PUT`s
`/__editor/asset-override` (`scripts/vite-editor-api.mjs`, dev-only middleware), which patches
`pack.json` and reruns **both** generators server-side, in order (`gen_regions.py` then
`assets:catalog` — the sidecar must be current before the catalog build reads it), serialized so two
overlapping reclassifies can't race. On success the Library refetches the catalog immediately — no
page reload, no manual terminal step. If `python3` isn't on `PATH`, the endpoint still saves the
`pack.json` patch and returns a structured error naming the fallback below (the override isn't lost,
only the regen needs finishing by hand).

**Fallback — the two-command regen** (same as the Atlas sprite regions section above): edit
`pack.json` by hand, then `python3 scripts/pixel-crawler/gen_regions.py && npm run assets:catalog`.

**Known limitation:** already-placed decor is a catalog SNAPSHOT — a furnace already dropped into a
map before its sheet was reclassified does not retroactively animate; delete and re-place it (no
texture-key collision either way, since `decorTextureKey` includes the frame dims). Pixel-based
auto-detection of a strip's grid is deliberately out of scope — connected-component detection is
weak on animation sheets specifically, and the grid itself is ambiguous from pixels alone (64×96
could be 2×2 or 2×3) — manual entry with a live preview is the v1 approach.
