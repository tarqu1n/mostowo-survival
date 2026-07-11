# Zombie Apocalypse Tileset

Base evaluation pack for Mostowo Survival's environment art — see
[`docs/ASSETS.md`](../../../../docs/ASSETS.md) for the overall art pipeline this fits into.
**Licence:** [`LICENSE.md`](./LICENSE.md) (not CC0 — free for personal + commercial use, credit
appreciated, no redistribution of the assets themselves). Source:
[ittaimanero.itch.io/zombie-apocalypse-tileset](https://ittaimanero.itch.io/zombie-apocalypse-tileset).

## What's here

- **`reference.png`** — the author's contact sheet. Open this first for an at-a-glance view of the
  whole pack before digging into individual sprite folders.
- **`sprites/<category>/`** — 56 categories, 532 PNGs total, individually-exported layers (not a
  packed spritesheet/atlas — see [Using this in Phaser](#using-this-in-phaser)).

All sprites are **16×16 px** (a few sub-tile decals are smaller, e.g. 16×13 / 7×16), matching this
repo's `TILE_SIZE` in `src/config.ts`.

Not included: the original `.psd` source files (Photoshop layers this was exported from) — they're
~600KB+ of editable source we don't need for the game to load. Re-download from the itch.io link
above if hand-editing the source layers is ever needed.

## Category index

Environment / scenery:

`gas-station` (3) · `grass-with-flowers` (2) · `modular-barns` (58) · `modular-big-building` (29) ·
`modular-bushes` (10) · `modular-fences` (31) · `modular-road` (26) · `modular-small-building` (15) ·
`modular-stacked-straw` (6) · `modular-terrain-path` (12) · `terrain-variations` (4) ·
`terrain-wall` (1) · `trees` (9) · `urban-assets` (15) · `different-crops-lengths` (8) ·
`scarecrow` (2) · `tombstone` (1) · `zombie-poster` (1) · `90-rotatable-bridge-sprites` (3) ·
`under-bridge-water-animation-frames` (6) · `water-animation-frames` (3)

Vehicles:

`broken-cars-and-tires` (15) · `drivable-car-with-8-directions` (8) · `tractor` (4) ·
`store-truck-with-smoking-guy-animation-frames` (3) · `windmill-with-fan-animation-frames` (7)

Characters (player + zombies + birds):

`player-character-walking-animation-frames` (9) · `damaged-player-animation-frames` (9) ·
`kid-zombie-animation-frames` (9) · `damaged-kid-zombie-animation-frames` (9) ·
`skinny-walking-zombie-animation` (9) · `damaged-skinny-zombie-animation-frames` (9) ·
`big-zombie-walking-animation-frames` (9) · `damaged-big-zombie-animation-frames` (9) ·
`turret-zombie-animation-frames` (12) · `damaged-turret-zombie-animation-frames` (9) ·
`turret-zombie-vomit-shooting-animation-frames` (7) · `sitting-zombie` (2) ·
`black-bird-flying-and-ground-eating-animation-frames` (12) ·
`white-bird-flying-ground-eating-and-being-shot-blood-animation-frames` (12)

Weapons, combat & items:

`knife-attack-animation-frames` (4) · `pistol-shooting-animation-frames` (5) ·
`shotgun-shooting-animation-frames` (6) · `exploding-barrel-animation-frames` (4) ·
`explosion-animation-frames` (6) · `pickable-items-and-weapons` (20) ·
`shootable-coke-can-animation-frames` (5) · `spawning-item-box-animation-frames-and-broken-box-pieces` (6) ·
`spawning-money-animation-frames` (5)

Effects & misc:

`blood-animation-frames` (5) · `random-blood-stains` (5) ·
`dead-corpses-with-flies-animation-frames` (6) · `smoke-animation-frames` (6) ·
`music-notes-animation-frames` (3)

UI:

`inventory-interface` (15) · `ui-elements` (23)

## Folder-name note

Folder names are **slugified** from the author's originals for path-safety (no spaces/`+`/`º` in
asset URLs). E.g. `90º Rotatable Bridge Sprites` → `90-rotatable-bridge-sprites`. File names inside
each folder are left as the author's raw Photoshop-layer export names (e.g.
`Zombie-Tileset---_0134_Capa-135.png`) — meaningless on their own, but each folder is small enough to
eyeball and each file *is* one usable 16×16 (or smaller) frame.

## Using this in Phaser

**Wired in** (see `docs/ASSETS.md`): ground/wall/tree tiles, the player's walk cycle, and (plan
003) the kid zombie's walk + damaged-reaction frames are loaded via the swappable manifest in
`src/data/tileset.ts`. Most of the pack's 532 files are still unused — cherry-pick more as new
features need them:

- Files live under `public/assets/...`, so Vite serves them at `<BASE_URL>assets/tilesets/zombie-apocalypse/...`
  (respects the `base` config in `vite.config.ts` — don't hardcode a leading `/`).
- These are **individual PNGs, not an atlas** — load each needed frame with
  `this.load.image(key, path)`, or pack the ones you actually use into a Phaser texture atlas
  (`this.load.atlas`) for animated sets (e.g. the 9-frame walking cycles) once you know which
  frames you need. Don't bulk-load all 532 files — cherry-pick per feature.
- Animation frame folders (anything ending `-animation-frames`) are already in a sensible frame
  order by filename sort — verify visually via `reference.png` or by eye before wiring an
  `anims.create()` sequence, the author's internal frame numbering isn't guaranteed sequential.
