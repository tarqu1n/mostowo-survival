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
export type PlayerState = 'idle' | 'walk';

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
  };
  actors: {
    /** Player: one render footprint for all strips; 3-way directional idle + walk. */
    player: { render: ActorRender; idle: Record<Facing, StripAnim>; walk: Record<Facing, StripAnim> };
    /** Enemy: single-orientation Run strip (frame 0 doubles as idle); GameScene flips by move-x. */
    enemy: { render: ActorRender; walk: StripAnim };
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
  },
  actors: {
    player: {
      render: { scale: 0.5, originX: 0.5, originY: 0.9 }, // Step 4/5 tune by eye (~1.5-tile-tall, feet on tile)
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
    },
    enemy: {
      render: { scale: 0.5, originX: 0.5, originY: 0.9 },
      walk: { path: 'Entities/Mobs/Skeleton Crew/Skeleton - Base/Run/Run-Sheet.png', frameSize: 64, frames: 6 },
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
