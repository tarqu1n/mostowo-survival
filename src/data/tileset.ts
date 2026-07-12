/**
 * Active environment tileset, as a swappable manifest. Scenes only ever reference the abstract
 * tile/actor *roles* below (`ground`, `wall`, `tree`, player/enemy anims) — never a pack's
 * folder/file names directly — so trying a different pack means adding a new manifest here and
 * pointing `ACTIVE_TILESET` at it. Loading/rendering is centralised through the helpers at the
 * bottom (`resolveTile`, `sheetKey`, `playerAnimKey`, ...) so PreloadScene/GameScene stay role-based.
 *
 * The one behaviour this manifest shape adds over the previous (zombie) one is **directional facing**
 * for the player (down/side/up strips; side art faces right, GameScene mirrors with flipX). The
 * retired `ZOMBIE_APOCALYPSE_TILESET` (per-frame PNGs, single-orientation) is preserved in git history
 * and documented in docs/ASSETS.md; its asset files remain under public/assets/ as reference art but
 * are no longer wired.
 */

export type Facing = 'down' | 'side' | 'up';
/**
 * Player animation states: `idle`/`walk` are looping locomotion (velocity-driven); `chop`/`mine`/
 * `gather`/`punch` are in-place harvest/action states. `chop` (axe) loops while felling a tree;
 * `mine` (overhead pickaxe swing) loops while mining a rock; `gather` (Collect crouch-pick) loops
 * while foraging a bush; `punch` (sword thrust) is a one-shot combat swing; `death` is a one-shot
 * collapse played once on death then held on its last frame (see GameScene.killPlayer). All are 3-way
 * directional and share one `playerAnimKey`/render footprint.
 */
export type PlayerState = 'idle' | 'walk' | 'chop' | 'mine' | 'gather' | 'punch' | 'death';

/** A terrain tile: a standalone PNG (load.image) OR frame N of a sheet sliced at TILE_SIZE. */
export type TileSource =
  | { kind: 'image'; path: string }
  | { kind: 'sheetFrame'; sheet: string; frame: number };

/** A horizontal animation strip. Square frames, `frameSize` px each, `frames` count. */
export interface StripAnim {
  path: string;
  frameSize: number;
  frames: number;
}

/** Display scale + origin so a padded actor canvas (e.g. 64px) sits right on a 16px tile. */
export interface ActorRender {
  scale: number;
  originX: number;
  originY: number;
}

export interface TilesetManifest {
  /** Pack id — must match its folder under public/assets/tilesets/<id>/. */
  id: string;
  /** Optional subdir under the pack id where files live. Omit for pixel-crawler (files at pack root). */
  spriteRoot?: string;
  tiles: {
    /**
     * Ground variants, each with a relative pick `weight` — GameScene scatters these per-tile
     * (see `pickWeighted`) for texture. Needs at least one entry; any length/weights work.
     */
    ground: Array<{ source: TileSource; weight: number }>;
    wall: TileSource;
    tree: TileSource;
    rock: TileSource;
    bush: TileSource;
  };
  actors: {
    /**
     * Player: one render footprint for all strips; 3-way directional idle + walk (looping
     * locomotion) plus chop + mine + gather + punch action swings (see `PlayerState` doc).
     */
    player: {
      render: ActorRender;
      idle: Record<Facing, StripAnim>;
      walk: Record<Facing, StripAnim>;
      chop: Record<Facing, StripAnim>;
      mine: Record<Facing, StripAnim>;
      gather: Record<Facing, StripAnim>;
      punch: Record<Facing, StripAnim>;
      death: Record<Facing, StripAnim>;
    };
    /**
     * Enemy: single-orientation Run strip (frame 0 doubles as idle; GameScene flips by move-x) plus a
     * single-orientation Death strip (one-shot collapse, played on kill — see GameScene.killZombie).
     */
    enemy: { render: ActorRender; walk: StripAnim; death: StripAnim };
  };
}

/**
 * Pixel Crawler pack (CC0-ish, see Terms.txt). Files load IN-PLACE from the pack root with their
 * original names, so a re-downloaded/updated pack drops in without re-curation — hence real relative
 * paths below, not renamed assets. The one derived file is the extracted tree (`_derived/`, a
 * `_`-prefixed dir a pack re-extract won't clobber; reproducible via scripts/pixel-crawler/extract.py).
 *
 * Terrain frame math: Floors/Wall sheets are 25 cols @ TILE_SIZE, so `frame = row*25 + col`.
 * Grass fill (2,10)=252 verified seamless (pack README + docs/assets/.../floors-blob-grid.png);
 * variants (1,10)=251 & (3,10)=253 are the neighbouring clean grass fills. Wall = grey stone fill (8,3)=83.
 */
export const PIXEL_CRAWLER_TILESET: TilesetManifest = {
  id: 'pixel-crawler',
  tiles: {
    ground: [
      { source: { kind: 'sheetFrame', sheet: 'Environment/Tilesets/Floors_Tiles.png', frame: 252 }, weight: 14 }, // grass (2,10)
      { source: { kind: 'sheetFrame', sheet: 'Environment/Tilesets/Floors_Tiles.png', frame: 251 }, weight: 10 }, // grass (1,10)
      { source: { kind: 'sheetFrame', sheet: 'Environment/Tilesets/Floors_Tiles.png', frame: 253 }, weight: 10 }, // grass (3,10)
    ],
    wall: { kind: 'sheetFrame', sheet: 'Environment/Tilesets/Wall_Tiles.png', frame: 83 }, // grey stone fill (8,3)
    tree: { kind: 'image', path: '_derived/tree_pine.png' }, // extracted green pine (Model_02/Size_03 idx 3)
    rock: { kind: 'image', path: '_derived/rock.png' }, // extracted grey boulder (Rocks.png idx 5)
    bush: { kind: 'image', path: '_derived/bush.png' }, // placeholder berry bush (scripts/placeholder-art.mjs; real art = plan 009)
  },
  actors: {
    player: {
      // scale:1 = draw the ~30px character at native 1:1 (no fractional down-scale), so it stays
      // crisp at every integer camera zoom — see docs/RENDERING.md "Pixel-art scale must be integer".
      // originY 0.78 ≈ the feet row (content bottom ≈ y48 of the 64px frame) so they rest on the tile.
      render: { scale: 1, originX: 0.5, originY: 0.78 },
      idle: {
        down: { path: 'Entities/Characters/Body_A/Animations/Idle_Base/Idle_Down-Sheet.png', frameSize: 64, frames: 4 },
        side: { path: 'Entities/Characters/Body_A/Animations/Idle_Base/Idle_Side-Sheet.png', frameSize: 64, frames: 4 },
        up: { path: 'Entities/Characters/Body_A/Animations/Idle_Base/Idle_Up-Sheet.png', frameSize: 64, frames: 4 },
      },
      walk: {
        down: { path: 'Entities/Characters/Body_A/Animations/Walk_Base/Walk_Down-Sheet.png', frameSize: 64, frames: 6 },
        side: { path: 'Entities/Characters/Body_A/Animations/Walk_Base/Walk_Side-Sheet.png', frameSize: 64, frames: 6 },
        up: { path: 'Entities/Characters/Body_A/Animations/Walk_Base/Walk_Up-Sheet.png', frameSize: 64, frames: 6 },
      },
      // Each action maps to the Body_A motion that reads right for it: chop = Slice_Base
      // (side-swing axe, fells trees); mine = Crush_Base (overhead smash, reads as a pickaxe on
      // rock); gather = Collect_Base (crouch-and-pick, reads as foraging a bush); punch = Pierce_Base
      // (weapon thrust — the character holds a sword, so this is the combat swing). All 8×64px, 3-way.
      // NB Pierce ships its up strip as `Pierce_Top-Sheet.png` (not `_Up`) — the manifest lists
      // explicit paths, so the odd name is captured here.
      chop: {
        down: { path: 'Entities/Characters/Body_A/Animations/Slice_Base/Slice_Down-Sheet.png', frameSize: 64, frames: 8 },
        side: { path: 'Entities/Characters/Body_A/Animations/Slice_Base/Slice_Side-Sheet.png', frameSize: 64, frames: 8 },
        up: { path: 'Entities/Characters/Body_A/Animations/Slice_Base/Slice_Up-Sheet.png', frameSize: 64, frames: 8 },
      },
      mine: {
        down: { path: 'Entities/Characters/Body_A/Animations/Crush_Base/Crush_Down-Sheet.png', frameSize: 64, frames: 8 },
        side: { path: 'Entities/Characters/Body_A/Animations/Crush_Base/Crush_Side-Sheet.png', frameSize: 64, frames: 8 },
        up: { path: 'Entities/Characters/Body_A/Animations/Crush_Base/Crush_Up-Sheet.png', frameSize: 64, frames: 8 },
      },
      gather: {
        down: { path: 'Entities/Characters/Body_A/Animations/Collect_Base/Collect_Down-Sheet.png', frameSize: 64, frames: 8 },
        side: { path: 'Entities/Characters/Body_A/Animations/Collect_Base/Collect_Side-Sheet.png', frameSize: 64, frames: 8 },
        up: { path: 'Entities/Characters/Body_A/Animations/Collect_Base/Collect_Up-Sheet.png', frameSize: 64, frames: 8 },
      },
      punch: {
        down: { path: 'Entities/Characters/Body_A/Animations/Pierce_Base/Pierce_Down-Sheet.png', frameSize: 64, frames: 8 },
        side: { path: 'Entities/Characters/Body_A/Animations/Pierce_Base/Pierce_Side-Sheet.png', frameSize: 64, frames: 8 },
        up: { path: 'Entities/Characters/Body_A/Animations/Pierce_Base/Pierce_Top-Sheet.png', frameSize: 64, frames: 8 },
      },
      // death = Death_Base: an 8-frame collapse. Directional like the other player strips (up ships as
      // `Death_Up`, not the `_Top` oddity Pierce has), played once and held on the last (downed) frame.
      death: {
        down: { path: 'Entities/Characters/Body_A/Animations/Death_Base/Death_Down-Sheet.png', frameSize: 64, frames: 8 },
        side: { path: 'Entities/Characters/Body_A/Animations/Death_Base/Death_Side-Sheet.png', frameSize: 64, frames: 8 },
        up: { path: 'Entities/Characters/Body_A/Animations/Death_Base/Death_Up-Sheet.png', frameSize: 64, frames: 8 },
      },
    },
    enemy: {
      // Native 1:1 like the player (crisp at integer zoom). The skeleton's feet reach the frame
      // bottom (content bbox ≈ y34–64), so originY 0.96 grounds it on the tile.
      render: { scale: 1, originX: 0.5, originY: 0.96 },
      walk: { path: 'Entities/Mobs/Skeleton Crew/Skeleton - Base/Run/Run-Sheet.png', frameSize: 64, frames: 6 },
      death: { path: 'Entities/Mobs/Skeleton Crew/Skeleton - Base/Death/Death-Sheet.png', frameSize: 64, frames: 12 },
    },
  },
};

/** Swap this to trial a different pack — see the module doc above. */
export const ACTIVE_TILESET: TilesetManifest = PIXEL_CRAWLER_TILESET;

// ---- Shared key/resolve helpers (loader in PreloadScene + renderer in GameScene use these) ----

/** Sanitise a path into a stable Phaser texture key for a spritesheet loaded from it. */
export const sheetKey = (path: string): string => `sheet-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`;

/** Sanitise a path into a stable Phaser texture key for a standalone image loaded from it. */
export const tileImageKey = (path: string): string => `img-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`;

/**
 * Map a TileSource to the Phaser texture key (+ optional frame) to draw it. `image` → its own
 * texture; `sheetFrame` → the shared sheet texture + frame index. `add.image(x,y,key,frame)` takes
 * an optional frame, so callers have one render path. (Subsumes the old tree/dirt key helpers.)
 */
export const resolveTile = (source: TileSource): { key: string; frame?: number } =>
  source.kind === 'image'
    ? { key: tileImageKey(source.path) }
    : { key: sheetKey(source.sheet), frame: source.frame };

/** Texture/anim key for a player state+facing strip, e.g. `player-walk-side`. */
export const playerAnimKey = (state: PlayerState, facing: Facing): string => `player-${state}-${facing}`;

/** Texture/anim key for the enemy Run strip (frame 0 doubles as idle). */
export const enemyWalkKey = 'enemy-walk';

/** Texture/anim key for the enemy Death strip (one-shot collapse on kill). */
export const enemyDeathKey = 'enemy-death';

/** Texture key for an item's icon image (loaded from `public/assets/icons/<icon>`). */
export const iconKey = (id: string): string => `icon:${id}`;

/** Weighted-random pick over `items` — used for ground variety (see `tiles.ground` doc above). */
export function pickWeighted<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    if (r < item.weight) return item;
    r -= item.weight;
  }
  return items[items.length - 1];
}
