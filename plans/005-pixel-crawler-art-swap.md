# Swap Active Art to Pixel Crawler Pack

> Status: deployed

## Summary

Make the game actually render the **Pixel Crawler** pack (already staged at
`public/assets/tilesets/pixel-crawler/`, evaluation-only until now) instead of the zombie-apocalypse
pack. The live WIP still shows the zombie art solely because `ACTIVE_TILESET` in
`src/data/tileset.ts` points at `ZOMBIE_APOCALYPSE_TILESET`. This reshapes the `TilesetManifest`
schema to fit Pixel Crawler's structurally-different assets (spritesheet **strips** for actors,
16px-**sliced sheet frames** for terrain, a pre-extracted **tree** PNG), adds **3-way directional
facing** for the player, reskins the "kid zombie" enemy to the **Skeleton (Base)** mob, and repoints
`ACTIVE_TILESET`. Verified by `npm run smoke` (build + preview + Playwright) plus a manual
screenshot eyeball (the smoke test cannot validate frame-slicing correctness — see decisions).

## Context & decisions

**Locked with the user (do NOT re-litigate):**
- **Enemy = Skeleton (Base)** stands in for the kid zombie. Keep the enemy **data** id `kidZombie` and
  `name: 'Kid Zombie'` in `src/data/enemies.ts` **unchanged** — only the sprites change. (The smoke
  test asserts `title === 'Kid Zombie'` and `hp === 'HP: 3/3'` on the inspect panel — keeping the
  data keeps those green.)
- **Full 3-way directional facing for the PLAYER** (Down/Side/Up strips; Side art faces **right**, use
  `flipX` for left), driven by the existing `lastFacing` field in GameScene.
- **Enemy is single-orientation** — mob sheets ship no directional variants — so the skeleton gets
  **horizontal flip by movement-x** only, not true 3-way.
- **The zombie pack does NOT need to remain a runnable format** (user, mid-plan). So the actor-anim
  schema is **strip-only** (no per-frame-images union), the `ZOMBIE_APOCALYPSE_TILESET` const is
  **retired** from `tileset.ts` (git history + `docs/ASSETS.md` retain it), and its asset files stay
  under `public/assets/` as reference art but are no longer wired.
- **Load assets IN-PLACE, keep the pack's original folder/file names** (user, mid-plan — so a
  re-downloaded/updated pack drops in without re-curation). Manifest paths are the pack's real paths;
  the loader wraps each URL in `encodeURI` (only the skeleton path has spaces). The **one** derived
  file is the extracted tree (its source is a multi-object sheet, so it cannot stay in-place) — kept
  under a `_derived/` subfolder (a `_`-prefixed dir a pack re-extract won't clobber, and it's
  reproducible via Step 1's `extract.py` CLI if ever wiped).

**Schema decision (advisor-reviewed):** one **role-based** `TilesetManifest` shaped around what
GameScene consumes, keeping scenes referencing abstract roles only. Final shape to implement:

```ts
type Facing = 'down' | 'side' | 'up';

/** A terrain tile: a standalone PNG (load.image) OR frame N of a sheet sliced at TILE_SIZE. */
type TileSource =
  | { kind: 'image'; path: string }
  | { kind: 'sheetFrame'; sheet: string; frame: number };

/** A horizontal animation strip. Square frames, `frameSize` px each, `frames` count. */
interface StripAnim { path: string; frameSize: number; frames: number; }

/** Display scale + origin so a padded 64px canvas sits right on a 16px tile. */
interface ActorRender { scale: number; originX: number; originY: number; }

interface TilesetManifest {
  id: string;
  /** Optional subdir under the pack id where files live. Omit for pixel-crawler (files at pack root). */
  spriteRoot?: string;
  tiles: {
    ground: Array<{ source: TileSource; weight: number }>; // weighted-random per tile (grass fills)
    wall: TileSource;
    tree: TileSource;
  };
  actors: {
    player: { render: ActorRender; idle: Record<Facing, StripAnim>; walk: Record<Facing, StripAnim> };
    enemy:  { render: ActorRender; walk: StripAnim }; // Run strip; frame 0 doubles as idle; flip by move-x
  };
}
```

- The `TileSource` union is **intrinsic to Pixel Crawler** (tree = extracted image; grass/wall = frames
  of blob sheets), not fallback tax. `sheetFrame` is also the right primitive for future real wall
  autotiling (adjacency-mask → frame). Do **not** build autotiling now.
- Centralise the `kind` switch so GameScene stays role-based: a **loader helper** (used by
  PreloadScene) that loads every `TileSource`/`StripAnim` — `image`→`load.image`,
  `sheetFrame`→`load.spritesheet(sheetKey, path, {frameWidth:TILE_SIZE, frameHeight:TILE_SIZE})`
  **deduped by sheet path** (grass variants + wall may share `Floors_Tiles`/separate sheets), `strip`→
  `load.spritesheet` at its `frameSize`; and a **tile resolver** `resolveTile(source) → {key, frame?}`
  (Phaser `add.image(x, y, key, frame)` takes an optional frame, so one render path).

**Asset classification — the standardised in-place-vs-extract rule (tooling + doc built in Step 1):**
Every pack PNG is one of three load classes; the rule is mechanical and decides what needs extraction:
- **Grid tilesheet** → load in-place, `load.spritesheet` @ `TILE_SIZE`, address by frame index. Files:
  `Environment/Tilesets/*.png` (Floors, Wall, Wall_Variations, Water, Dungeon).
- **Animation strip** → load in-place, `load.spritesheet` @ frameSize = sheet height. Files: any
  `*-Sheet.png` (Entities/ actors, animated `Structures/Stations`, `Props/Animated`).
- **Multi-object sheet** → CANNOT grid-slice (many objects, varying sizes, irregular positions);
  extract each wanted object by connected-component bbox → a derived PNG under `_derived/`. Files:
  `Environment/Props/Static/*` (Trees, Vegetation, Rocks, Resources, Furniture, Tools, Farm, Meat,
  Dungeon_Props, Esoteric, Shadows), static (non-`-Sheet`) props under `Structures/{Stations,Buildings}/`,
  and `Weapons/{Bone,Wood,Hands}`.

**Detection for new/updated assets** (answers "find ones that need the same done"): a file that is
**not** a `*-Sheet.png` strip and **not** under `Environment/Tilesets/` is a multi-object candidate →
run the Step-1 scan; **>1 varying-size connected component ⇒ multi-object, needs extraction**.
**Extraction needed for THIS swap = the tree only (1 object).** Every other asset the game currently
loads is grid/strip (in-place). Other multi-object sheets are future candidates — not extracted this
swap. The **derived-file manifest** (output ← sheet · component-index) lives in the Step-1 doc.

**Concrete Pixel Crawler asset facts (already gathered — use directly):**
- `TILE_SIZE=16`, base `360×640`. Vite base respected via `import.meta.env.BASE_URL`.
- **Files load IN-PLACE from the pack ROOT** (`Entities/…`, `Environment/…`) — no `sprites/` subdir. So
  the loader base becomes `.../tilesets/${id}` (`spriteRoot` omitted for pixel-crawler), **dropping the
  current hardcoded `/sprites`** (`PreloadScene.ts:38`). Manifest paths are the pack's real relative
  paths (unchanged names → drop-in updatable).
- **The skeleton path contains spaces** (`Skeleton Crew`, `Skeleton - Base`) — the other used paths
  (player `Body_A/…`, terrain `Environment/Tilesets/…`) don't. The loader MUST wrap each full URL in
  **`encodeURI(...)`** (harmless on the space-free paths, required for the skeleton) or the browser
  fetch 404s. (A 404/exception is the main thing the smoke test *would* catch.)
- **Player** = `Entities/Characters/Body_A/Animations/` (all 64×64 strips → **one `render.scale`** for
  every player anim):
  - `Walk_Base/Walk_{Down,Side,Up}-Sheet.png` — 384×64 → `frameSize:64, frames:6`.
  - `Idle_Base/Idle_{Down,Side,Up}-Sheet.png` — 256×64 → `frameSize:64, frames:4`.
- **Enemy (Skeleton Base)** = `Entities/Mobs/Skeleton Crew/Skeleton - Base/Run/Run-Sheet.png` —
  384×64 → `frameSize:64, frames:6`. **Use Run only**; frame 0 = idle pose. (Its `Idle` strip is
  32×32, a different frame size — mixing 32 and 64 on one sprite causes a size-pop, so it's dropped;
  proper idle is a trivial future add once per-state scaling exists. Death 768×64 is a future
  death-anim hook — out of scope.)
- **Terrain** = `Environment/Tilesets/Floors_Tiles.png` (400×416, 25 cols) + `Wall_Tiles.png`
  (400×400, 25 cols), both sliced at 16 (**frame = row*25 + col**). README-verified fill tiles
  (col,row): grass **(2,10)** = frame 252; sand/dirt path **(5,24)** = frame 605; stone-wall top
  **(2,20)** = frame 502. `ground` = 2–3 grass fills from cols 1–3 (confirm clean variants against
  `docs/assets/pixel-crawler/reference/floors-blob-grid.png`), weighted like today (common plain +
  rare); `wall` = `{kind:'sheetFrame', sheet:'Environment/Tilesets/Wall_Tiles.png', frame:502}`.
- **Tree** = pre-extracted **green pine** (Step 1) → `{kind:'image', path:'_derived/tree_pine.png'}`.
  Source object is ~37×76 (much larger than a tile) → needs `scale` + **bottom-centre origin** so the
  trunk base sits on its tile and the canopy overhangs upward.

**Codebase seams (current anchors — reconfirm before editing):**
- `src/data/tileset.ts` — whole file is the schema + `ACTIVE_TILESET` (`:84`) + helpers `dirtKey`
  (`:87`), `playerFrameKey` (`:90`), `kidZombieFrameKey` (`:93`), `kidZombieDamagedFrameKey` (`:96`),
  `pickWeighted` (`:99`, **keep**). Module doc (`:1-6`) promises "no scene changes" — update it to note
  directional facing was new behaviour.
- `src/scenes/PreloadScene.ts:38-48` — the **only** `load.image` site; base path with hardcoded
  `/sprites` at `:38`.
- `src/scenes/GameScene.ts` — anim create `:192-217` (`player-walk`, `kid-zombie-walk`,
  `kid-zombie-damaged`); player sprite `:218` (`playerFrameKey(0)`); `updatePlayerAnim` `:362-369`;
  `spawnZombies` `:784`, `addZombie` `:788-808` (sprite `:790`), `updateZombieAnim` `:831-839`;
  `addTree` `:722-726` (`add.image(...,'tree')`); `chop` `:764-780` (tints felled tree as stump —
  keep); `drawGround` `:993-1000` (`dirtKey` + `pickWeighted`); wall visual `finishSite` `:940`
  (`add.image(...,'wall')`).
- **Blast radius is exactly these 3 files.** `src/data/buildables.ts:10` (`wall`) and
  `src/data/nodes.ts:9` (`tree`) are **logical IDs, not texture keys — do NOT touch.** No other scene,
  no test, no smoke harness references the texture/anim keys.
- **`kid-zombie-damaged` is created but NEVER played** — dropping it changes no behaviour.

**Render-footprint audit (the real hidden work — verify in GameScene, Step 4):**
- Player/enemy sprites are **padded 64px canvases** with a small character inside. Set `render.scale`
  (start ~`0.5`, tune by eye to ~1.5-tile-tall character) and **origin** (`0.5, ~0.9` so feet ≈ tile
  centre). Then set the arcade **body** roughly tile-sized at the feet (`body.setSize(...)` in
  source-texture px so the post-scale world body ≈ `TILE_SIZE`; `body.setOffset(...)`). Body precision
  is low-stakes: player↔wall is a pathfinding backstop and enemy contact-damage is **tile-based**
  (`z.col/z.row`), not physics.
- Unaffected by sprite size (all tile-based): contact-damage range, Inspect hit-tests
  (`inspectAt` col/row), fog/vision (position-based). Tree `treeAt` uses distance to `sprite.x/y`; with
  bottom-centre origin, `sprite.y` = tile centre, so its ≤`TILE_SIZE` check still holds.

**Verification reality:** `npm run smoke` = `node scripts/smoke.mjs` → Playwright/Chromium against
`http://localhost:4173/mostowo-survival/`, so it needs a **built preview running**
(`npm run build && npm run preview`, or the doc'd deploy). It boots the **real game with real assets
over HTTP** and catches hard load failures (404 → loader/console error; thrown exception →
`window.game.isBooted` never set → timeout). It does **NOT** validate frame slicing / frame counts /
directional-anim correctness (Phaser emits those as `console.warn`, which the harness filters). So
the acceptance for the render steps is **smoke green + manual screenshot eyeball** (smoke writes
`scripts/.smoke-*.png`). Optionally add `this.textures.exists(...)` / `this.anims.exists(...)`
assertions in GameScene create for a cheap extra guard.

## Steps

- [x] **Step 1: Standardise & document object extraction; extract the tree** `[delegate sonnet]`
  - Outcome: Added `scripts/pixel-crawler/extract.py` (CLI wrapping `objects.py` — `--list`, extract, `--scan`, with `--alpha-thresh`/`--gap`/`--min-area` flags); added "Sprite extraction pipeline" section to `docs/ASSETS.md` (3-class rule, detection rule, commands, rescan procedure, derived-file manifest table); added one-line row to `scripts/pixel-crawler/README.md`; extracted the green pine to `public/assets/tilesets/pixel-crawler/_derived/tree_pine.png` (37×76, transparent). `--list` confirmed **index 3** = green pine (as planned). Scan flags all multi-object prop sheets (Trees, Rocks, Furniture, Tools, Weapons/*, Buildings/Props …) and correctly skips `Environment/Tilesets/*` grids + `*-Sheet.png` strips. No pack files renamed/moved.
  - **Extract CLI** — promote the ad-hoc one-liner into a reusable script
    `scripts/pixel-crawler/extract.py` that wraps the existing `objects.py` helpers
    (`components()`/`crop()`), so extraction is a repeatable command, not copy-pasted Python:
    - `python3 scripts/pixel-crawler/extract.py --list <sheet-rel>` → previews components (index · bbox ·
      pixel size) by calling `preview_components`, so you can pick the right index.
    - `python3 scripts/pixel-crawler/extract.py <sheet-rel> <index> <out-rel>` → saves
      `crop(sheet, components(sheet)[index])` to `public/assets/tilesets/pixel-crawler/<out-rel>`
      (create parent dirs). `<sheet-rel>` is relative to the pack root.
    - Reuse `objects.py`'s tunables (`alpha_thresh`/`gap`/`min_area`) if a component comes out
      merged/split; expose them as optional flags.
  - **Scan mode** — add `python3 scripts/pixel-crawler/extract.py --scan [dir]` (default: whole pack)
    that walks PNGs and labels each per the classification rule (Context): **skip** `Environment/Tilesets/`
    (grid) and any `*-Sheet.png` (strip); for the rest, report connected-component count and flag
    **multi-object** (>1 varying-size component) as "needs extraction". This is the run-on-new-assets
    detector. Report-only (prints a list); it does not extract.
  - **Document** — add a concise **"Sprite extraction pipeline"** section to `docs/ASSETS.md`: the
    3-class rule + detection rule (from Context), how to run `--list` / extract / `--scan`, the
    rescan-when-assets-change procedure, and a **derived-file manifest table** (`output ← sheet ·
    component-index`). Seed it with the tree row. (Step 6's ASSETS.md edits are the swap *narrative* —
    a different section; cross-link them.)
  - **Extract the tree** using the new CLI (do NOT rename/move any pack file — the pack stays drop-in
    updatable; only the derived output is new):
    ```sh
    python3 -m pip install --quiet pillow numpy   # if not present
    python3 scripts/pixel-crawler/extract.py --list "Environment/Props/Static/Trees/Model_02/Size_03.png"
    python3 scripts/pixel-crawler/extract.py "Environment/Props/Static/Trees/Model_02/Size_03.png" 3 _derived/tree_pine.png
    ```
    (Index **3** = green pine per pack README:126 + the contact sheet; confirm via `--list` first.)
  - Side effects: adds `scripts/pixel-crawler/extract.py`, a doc section, and one derived PNG under
    `_derived/` (a `_`-prefixed dir a pack re-extract won't clobber). No pack files renamed/moved.
  - Docs: the ASSETS.md "Sprite extraction pipeline" section + derived manifest (this step owns it).
  - Done when: `extract.py --list`/`--scan` run and the scan flags the multi-object prop sheets (and
    NOT the tilesets/strips); the tree extraction produces
    `public/assets/tilesets/pixel-crawler/_derived/tree_pine.png` (single cropped pine ~37×76,
    transparent bg — check `sips -g pixelWidth -g pixelHeight`); and the doc records the rule, the
    commands, the rescan procedure, and the tree manifest row.

- [x] **Step 2: Reshape the manifest schema + author PIXEL_CRAWLER manifest** `[inline]`
  - Outcome: Rewrote `src/data/tileset.ts` to the role-based schema (`Facing`, `PlayerState`, `TileSource`, `StripAnim`, `ActorRender`, `TilesetManifest`). Removed `ZOMBIE_APOCALYPSE_TILESET` + old per-frame helpers; **kept `pickWeighted`**. Added `PIXEL_CRAWLER_TILESET` (id `pixel-crawler`, `spriteRoot` omitted) with real in-place paths: ground = 3 grass `sheetFrame`s of `Floors_Tiles.png` (frames 252/251/253 @ weights 14/10/10 — the row-10 cols 1–3 clean grass fills, verified vs `floors-blob-grid.png`); wall = `sheetFrame` `Wall_Tiles.png` frame 502; tree = `image` `_derived/tree_pine.png`; player idle/walk = the 6 Body_A strips (frameSize 64; idle frames 4, walk frames 6); enemy.walk = Skeleton Base `Run-Sheet.png` (64/6). Strip dims verified via `sips`. `render` set to `{scale:0.5, originX:0.5, originY:0.9}` (Step 4/5 tune). `ACTIVE_TILESET = PIXEL_CRAWLER_TILESET`. Helpers: `sheetKey`, `tileImageKey`, `resolveTile`, `playerAnimKey(state,facing)`, `enemyWalkKey`; re-exports `TILE_SIZE`. **Deviation:** consolidated tree/ground/wall keys into `resolveTile`+`tileImageKey`, so the planned standalone `treeKey='tree'` constant is unnecessary (GameScene resolves the tree via `resolveTile`). `tileset.ts` type-checks clean in isolation; remaining tsc errors are only the expected 16 (PreloadScene) + 17 (GameScene), fixed in Steps 3–4.
  - In `src/data/tileset.ts`: replace the current interface with the **role-based schema** from
    Context (`Facing`, `TileSource`, `StripAnim`, `ActorRender`, `TilesetManifest`). Remove
    `ZOMBIE_APOCALYPSE_TILESET` and the old per-frame key helpers (`dirtKey`, `playerFrameKey`,
    `kidZombieFrameKey`, `kidZombieDamagedFrameKey`); **keep `pickWeighted`**. Leave a one-line comment
    pointing to git history + `docs/ASSETS.md` for the retired zombie manifest.
  - Add `PIXEL_CRAWLER_TILESET: TilesetManifest` (id `'pixel-crawler'`, `spriteRoot` omitted) filled
    with the exact paths/frames/frameSizes from Context: `ground` = 2–3 grass `sheetFrame`s of
    `Environment/Tilesets/Floors_Tiles.png` (grass frame 252 primary + confirmed variants, weighted);
    `wall` = `sheetFrame` of `Environment/Tilesets/Wall_Tiles.png` frame 502; `tree` = `image`
    `_derived/tree_pine.png`; `player.idle/walk` = the 3 Body_A `{Idle,Walk}_{Down,Side,Up}` strips
    (frameSize 64; idle frames 4, walk frames 6); `enemy.walk` = Skeleton Base `Run/Run-Sheet.png`
    (frameSize 64, frames 6). Set `player.render`/`enemy.render` starting values (`scale ~0.5`,
    `originX 0.5`, `originY ~0.9`) — Step 4 tunes them.
  - Point `ACTIVE_TILESET` at `PIXEL_CRAWLER_TILESET`.
  - Add the two shared helpers (or export stubs Step 3/4 fill): `resolveTile(source) → {key: string;
    frame?: number}` and a `sheetKey(path)` sanitiser for dedup. Add role-based anim-key helpers:
    `playerAnimKey(state, facing)` → e.g. `player-walk-side`; `enemyWalkKey` → `enemy-walk`;
    `treeKey='tree'`.
  - Side effects: **`PreloadScene.ts` and `GameScene.ts` will not compile until Steps 3–4 land** (they
    import the removed helpers) — expected; typecheck/build acceptance is deferred to Step 5.
  - Docs: update the module doc block at top of `tileset.ts` (note directional facing is new
    behaviour; the abstract-roles promise still holds).
  - Done when: `tileset.ts` type-checks in isolation, exports the new schema + `PIXEL_CRAWLER_TILESET`
    + helpers, and `ACTIVE_TILESET === PIXEL_CRAWLER_TILESET`.

- [x] **Step 3: Rewrite the loader (PreloadScene)** `[inline]`
  - Outcome: Rewrote `PreloadScene.preload()` asset block. Base now `${BASE_URL}assets/tilesets/${id}${spriteRoot?'/'+spriteRoot:''}` (dropped hardcoded `/sprites`). Added a local `url(rel)=encodeURI(base+'/'+rel)` wrapper applied to **every** load. Terrain: collects all `TileSource`s (ground+wall+tree), loads each distinct `sheetFrame` sheet once (deduped via `sheetKey`, `load.spritesheet` @ `TILE_SIZE`) and each `image` tile once (`tileImageKey`, `load.image`). Actors: `loadStrip(key, strip)` → `load.spritesheet(key, url, {frameWidth/Height: strip.frameSize})` for the 6 player strips (`playerAnimKey(state,facing)`) + enemy Run (`enemyWalkKey`); texture key == anim key per strip. Loading-bar UI untouched. Imports `TILE_SIZE` from `../config` (not the removed tileset re-export). Also removed the now-unneeded `TILE_SIZE` import/re-export from `tileset.ts`. PreloadScene type-checks clean; only GameScene errors remain (Step 4).
  - Replace `PreloadScene.preload()` asset block (`:38-48`). Base = `${import.meta.env.BASE_URL}assets/
    tilesets/${ACTIVE_TILESET.id}${manifest.spriteRoot ? '/'+spriteRoot : ''}`. Add a loader helper
    that, for the whole manifest: loads every distinct terrain **sheet** once (`load.spritesheet` at
    `TILE_SIZE`, deduped by path via `sheetKey`), loads `tree` (`image`) and any `image` grounds, and
    loads every actor **StripAnim** via `load.spritesheet(animTextureKey, path, {frameWidth:frameSize,
    frameHeight:frameSize})`. **Wrap every full path in `encodeURI(...)`** (spaces/hyphens in mob
    paths). Keep the existing loading-bar UI (`:19-36`) unchanged.
  - Side effects: consumes Step 2's schema + helpers. Texture keys are now role/sheet-based, consumed
    in Step 4.
  - Docs: none.
  - Done when: PreloadScene type-checks against the new schema; every manifest asset has a
    corresponding `load.*` call with an `encodeURI`'d URL. (Runtime verification is Step 5.)

- [x] **Step 4: Wire GameScene rendering, directional anims + render footprint** `[inline]`
  - Outcome: All edits in `src/scenes/GameScene.ts`. Imports now `resolveTile`/`playerAnimKey`/`enemyWalkKey`/`pickWeighted` + types `Facing`/`PlayerState`/`ActorRender`. **Anims:** build all 6 `player-{idle,walk}-{down,side,up}` via `generateFrameNumbers(key,{start:0,end:frames-1})` + one `enemy-walk`; dropped `kid-zombie-damaged`. **Player** created from `playerAnimKey('idle','down')`, `setScale`/`setOrigin` from `render`, `fitActorBody`. `updatePlayerAnim` picks state (walk if moving) × `facingDir()` (new helper: side when `|dCol|>=|dRow|` & dCol≠0, else up/down) and `setFlipX(side && dCol<0)`. **Enemy** created from `enemyWalkKey` + render + `fitActorBody`; `updateZombieAnim` plays `enemy-walk` w/ `setFlipX(velocity.x<0)` when moving, else `setFrame(0)`. **Ground** via `resolveTile(g.source)`+`pickWeighted`; **wall** via `resolveTile(tiles.wall)` (key+frame); **tree** via `resolveTile(tiles.tree)`, scaled by new `treeScale()` (source-height-derived, `TREE_TILES_TALL=2.6`) with origin (0.5,0.92); **`chop()` fixed** to bump/reset relative to the fitted base scale (was hardcoded 1). Added `fitActorBody()` (source-px body ≈1 tile at feet) + `TREE_TILES_TALL` const. `npm run build` type-checks + builds clean; `grep` finds no residual removed-helper refs. Render footprint values (scale 0.5, origin 0.9/0.92) are starting points — Step 5 eyeballs/tunes.
  - **Anim creation** (replace `:192-217`): build player anims for **all 6** state×facing combos
    (`playerAnimKey(state,facing)`) from the strip texture keys via
    `this.anims.generateFrameNumbers(key, {start:0, end:frames-1})`; build one `enemy-walk` anim from
    the Run strip. **Drop the `kid-zombie-damaged` anim entirely** (never played).
  - **Player** (`:218`): create from the down-idle strip's texture key; `setScale(render.scale)`,
    `setOrigin(originX,originY)`, set arcade `body.setSize/​setOffset` (feet ≈ tile). `updatePlayerAnim`
    (`:362-369`): pick facing from `this.lastFacing` (`|dCol|>=|dRow|` → `side` + `setFlipX(dCol<0)`,
    else `down` if `dRow>=0` else `up`; clear flipX for down/up); play `player-walk-<facing>` when
    moving, else `player-idle-<facing>` (stationary keeps last facing). Replace the
    `setTexture(playerFrameKey(0))` idle-reset with the idle anim.
  - **Enemy** (`addZombie` `:790`): create from `enemy-walk` texture key; `setScale`/`setOrigin`/body
    like the player. `updateZombieAnim` (`:831-839`): play `enemy-walk` when moving (else stop on
    frame 0 = idle); **flip by movement-x** — derive dx from velocity or `wp.col - z.col` in
    `advanceZombie` and `setFlipX(dx<0)`. Remove `setTexture(kidZombieFrameKey(0))`.
  - **Ground** (`drawGround` `:993-1000`): resolve each weighted `ground` entry via `resolveTile` →
    `this.add.image(x, y, key, frame).setDepth(0)`; keep `pickWeighted`.
  - **Wall** (`finishSite` `:940`): `const {key,frame}=resolveTile(manifest.tiles.wall);
    this.add.image(x,y,key,frame)`.
  - **Tree** (`addTree` `:722-726`): resolve `tree` (image); scale + **bottom-centre-ish origin** so
    trunk sits on the tile, canopy overhangs up; keep depth 1 and `chop()`'s stump tint.
  - **Footprint audit:** confirm the render-footprint items in Context — tune `scale`/origin/body so
    player + skeleton read ~1.5 tiles tall with feet on the tile; confirm tree/`treeAt`, inspect
    hit-tests, contact damage, fog all still behave.
  - Side effects: this is the file that makes it actually render. `debugState()` and all tile-based
    logic unchanged.
  - Docs: none (covered in Step 6).
  - Done when: `npm run build` type-checks/builds clean with **no** references to removed helpers, and
    the code plays `player-{idle,walk}-{down,side,up}` + `enemy-walk` and renders ground/wall/tree from
    the new manifest.

- [x] **Step 5: Verify (build + smoke + eyeball)** `[inline]`
  - Outcome: `npm run build` clean. All 10 loader asset URLs return HTTP 200 over the preview (incl. the space-containing skeleton path via `encodeURI`). `npm run smoke` **PASSES** (33/33, no console/page errors) — incl. the `Kid Zombie HP: 3/3`, tree, and wall inspect panels. **Eyeball (smoke screenshots + a one-off Playwright capture) caught one frame error:** the plan's wall `(2,20)=502` is actually a flat dark-maroon dungeon *interior fill*, not stone — **fixed to grey stone fill `(8,3)=83`** in `tileset.ts` (verified vs `walls-blob-grid.png` + cropped candidates; re-smoke green, wall now reads as stone). Confirmed correct: grass ground (frames 252/251/253), pine tree (scaled, trunk on tile, canopy overhangs), directional player (`player-walk-{down=front,up=back,side}` with `flipX` L/R mirror — verified programmatically + visually), skeleton enemy (`enemy-walk`). Render scales left at 0.5 (player reads ~1.2 tiles — acceptable, tunable later). **Flags:** (1) the *pre-existing* combat **punch-kill** smoke assertion is **flaky** (~1/3 fail) — it depends on the chasing zombie settling orthogonally vs diagonally adjacent; NOT caused by this swap (punch is pure tile logic, untouched; no player↔zombie physics coupling) — recommend a follow-up to make it deterministic. (2) Installed `playwright` as a **devDependency** + downloaded Chromium to run smoke here (per user choice) — note: the full `playwright` pkg re-downloads the browser on every `npm install`, which is heavy for the cross-device/mobile workflow; worth revisiting (e.g. keep ad-hoc, or use `playwright-core`).
  - `npm run build`, then `npm run preview` (serves `:4173/mostowo-survival/`), then `npm run smoke` in
    another shell. Fix any 404s (likely `encodeURI` / path typos) or boot exceptions the smoke surfaces.
  - **Manually eyeball** the smoke screenshots (`scripts/.smoke-*.png`) — the smoke test does NOT catch
    frame-slicing errors. Confirm: player faces its move direction (down/side±flip/up), walks vs idles;
    skeleton chases + flips; ground is grass (not a mis-sliced frame); wall + tree render correctly
    sized on their tiles. Tune `render` scales/origins in `tileset.ts` if anything's off.
  - Side effects: none (verification only).
  - Docs: none.
  - Done when: `npm run smoke` passes and the screenshots show the Pixel Crawler art rendering
    correctly (directional player, skeleton enemy, grass ground, tree, wall).

- [x] **Step 6: Update docs** `[delegate sonnet]`
  - Outcome: Docs-only. `docs/ASSETS.md` — retitled the zombie section to "retired, reference fallback" (files kept under `public/assets/`, unwired, escape-hatch noted) and promoted Pixel Crawler to "Active tileset — wired in, plan 005" with a concrete-frames-wired subsection that cross-links (does not duplicate) the existing "Sprite extraction pipeline" section. `docs/DECISIONS.md` — appended a `2026-07-12 [DECIDED]` entry (manifest reshape, Skeleton-as-`kidZombie` stand-in, 3-way player facing vs single-orientation enemy flip, zombie manifest retired/not-runnable, escape hatch = montage frames into strips, deferred `sheetFrame` autotiling primitive); supersedes the prior `[PROPOSED]` entry. `CLAUDE.md` — Status paragraph now states the swap (Pixel Crawler active, zombie retired, Skeleton stand-in, player facing) and no longer implies the zombie tileset is active/staged; kept lean. Verified only the 3 docs changed.
  - `docs/ASSETS.md`: move Pixel Crawler from "Leading replacement candidate" to the **wired-in/active**
    pack; demote the Zombie Apocalypse section to **retired/reference fallback** (files kept under
    `public/assets/`, no longer wired). Cross-link the **"Sprite extraction pipeline"** section added in
    Step 1 (do not duplicate it) — it already documents the classification rule, `_derived/`, the
    extract/scan commands, and the derived manifest.
  - `docs/DECISIONS.md`: log the swap — active art → Pixel Crawler; Skeleton (Base) as the kid-zombie
    stand-in (data id kept as `kidZombie`); 3-way directional facing added (player only; enemy flips);
    manifest reshaped to strip/sheetFrame roles + zombie manifest retired (not kept runnable, per user);
    note the escape-hatch (montage zombie frames into strips) and the deferred wall-autotiling primitive.
  - `CLAUDE.md` (root): update the Status paragraph / one-liner where it implies the zombie art is the
    active/staged tileset.
  - Side effects: none (docs only). Write terse, high-signal edits.
  - Done when: the three docs reflect Pixel Crawler as active and the zombie pack as retired fallback,
    consistent with the code.

## Out of scope

- Real blob **autotiling** for terrain edges/corners (use single fill frames now; `sheetFrame` leaves
  the door open). Grass↔dirt path transitions, the demo-map look.
- **Extracting any multi-object prop other than the tree** (rocks, resources, crafting-station props,
  weapons, etc.). Step 1 builds the extract/scan tooling + inventory rule so future extractions are a
  documented command — but nothing besides the tree is extracted or wired this swap.
- **Skeleton Idle/Death anims** (using Run-only + frame-0 idle this pass), player **Run/action**
  anims (Collect/Slice/etc.), carrying set, weapons, NPCs, crafting stations.
- Making the zombie pack runnable under the new schema (explicitly dropped by the user).
- Darkening/grim-dark lighting pass, night tint interplay, hit-flash/VFX.
- Any change to `enemies.ts` stats/data, combat numbers, or the enemy **id/name** (`kidZombie` /
  `Kid Zombie` stay).
- A dedicated stump sprite (keep `chop()`'s brown-tint stump stand-in).
