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
 * `gather`/`attack` are in-place harvest/action states. `chop` (axe) loops while felling a tree;
 * `mine` (overhead pickaxe swing) loops while mining a rock; `gather` (Collect crouch-pick) loops
 * while foraging a bush; `attack` (sword thrust) is a one-shot combat swing; `death` is a one-shot
 * collapse played once on death then held on its last frame (see GameScene.killPlayer). All are 3-way
 * directional and share one `playerAnimKey`/render footprint.
 */
export type PlayerState = 'idle' | 'walk' | 'chop' | 'mine' | 'gather' | 'attack' | 'death';

/** A terrain tile: a standalone PNG (load.image) OR frame N of a sheet sliced at TILE_SIZE. */
export type TileSource =
  { kind: 'image'; path: string } | { kind: 'sheetFrame'; sheet: string; frame: number };

/**
 * A grip/attach point for a held prop (a monster weapon today), authored in the strip frame's OWN
 * pixel space (origin = frame top-left, +x right, +y down). `rot` (degrees, default 0) is the prop's
 * resting angle at this frame. `weaponTransform` (systems/attachment.ts, Phase B) maps this through
 * the strip's render (scale/origin) to a world-px offset from the actor origin — so anchors authored
 * against a 32px Idle frame and a 64px Run frame that point at the same hand resolve to the same world
 * spot (footprint independence). Shared primitive the player's rigid slots (plan 010) will reuse.
 */
export interface AttachPoint {
  x: number;
  y: number;
  rot?: number;
}

/**
 * A horizontal animation strip. Frames are `frameSize` px tall and, by default, `frameSize` px wide
 * (square). A sheet whose cells are wider than tall — e.g. the skeleton Death sheet packs its collapse
 * into 96×64 cells so the motion has horizontal room — sets `frameWidth` to that wider value; slicing
 * such a sheet at the square `frameSize` lands between real frames (empty gaps → flicker, content
 * jumping left/right → apparent "flying"), so the width must be declared, not assumed.
 */
export interface StripAnim {
  path: string;
  frameSize: number;
  frames: number;
  /** Cell width in px when the frame isn't square; defaults to `frameSize`. */
  frameWidth?: number;
  /**
   * Per-frame attach points for held props, keyed by slot. Each array's length MUST equal `frames`
   * (one anchor per animation frame — asserted in data.test.ts). `mainHand` = the weapon-gripping
   * hand (the held weapon AND the fist that grips it pin here); `offHand` = the free hand. A strip
   * carrying neither omits `anchors`; one carrying hands but no weapon still pins both fists.
   */
  anchors?: { mainHand?: AttachPoint[]; offHand?: AttachPoint[] };
  /**
   * Per-strip render footprint override. A strip whose source canvas differs from the actor's default
   * footprint (the 32px skeleton Idle vs the 64px Run) carries its own scale/origin so it still grounds
   * on the tile; GameScene applies it on the state change and reverts to the actor default otherwise.
   * Scale MUST stay an integer (crisp at integer zoom). Omit to inherit the actor default footprint.
   */
  render?: ActorRender;
}

/**
 * A station animation authored at several discrete intensity levels (plan 016). The campfire ships as
 * `Bonfire_01..08-Sheet.png` — 8 sheets of the *same* fire from faint embers (1) to a roaring blaze
 * (8). All levels share `frameSize`/`frames`/`frameWidth`; each level's sheet path comes from
 * `pathTemplate` with `{n}` replaced by the zero-padded level. CampfireManager swaps the played level
 * by a fuel bucket, so the visible flame grows/shrinks with fuel (see {@link campfireLevelStrip}).
 */
export interface StationLevels {
  /** Sheet path with `{n}` — replaced by the 2-digit level `01..levels` (see campfireLevelStrip). */
  pathTemplate: string;
  /** Number of intensity levels (sheets); level 1 = faintest, `levels` = fiercest. */
  levels: number;
  frameSize: number;
  frames: number;
  /** Cell width in px when the frame isn't square; defaults to `frameSize`. */
  frameWidth?: number;
}

/** Display scale + origin so a padded actor canvas (e.g. 64px) sits right on a 16px tile. */
export interface ActorRender {
  scale: number;
  originX: number;
  originY: number;
}

/**
 * Art for an equippable monster weapon: its `source` image, the grip `pivot` (setOrigin, as [x,y]
 * fractions of the image — the point pinned to the hand anchor and rotated about when swinging), the
 * draw-order `z` added to the wielder's depth (weapon in front), and an optional integer display
 * `scale`. GAMEPLAY stats (damage, attack cadence) live in data/weapons.ts, NOT here — single source
 * of truth; the two are joined by a shared weapon id.
 */
export interface WeaponArt {
  source: TileSource;
  pivot: [number, number];
  z: number;
  scale?: number;
}

/**
 * The shared hand mitt layered onto the monster. The Base skeleton's own hands are vestigial nubs
 * (crossed-forearm pixels that read as nothing at game scale), so a visible fist from `Weapons/Hands`
 * is pinned to each hand anchor every frame — the SAME image for both, mirrored with the body. The
 * `mainZ`/`offZ` depth offsets (added to the wielder's depth) put the gripping hand OVER the weapon
 * (weapon `z` 1) and the free hand beside the body. A fist doesn't rotate, so there's no `rot` here.
 */
export interface HandArt {
  source: TileSource;
  /** setOrigin as [x,y] fractions — the point pinned to the hand anchor (fist centre). */
  pivot: [number, number];
  /** Depth offset for the weapon-gripping (main) hand — drawn in front of the weapon. */
  mainZ: number;
  /** Depth offset for the free (off) hand. */
  offZ: number;
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
     * locomotion) plus chop + mine + gather + attack action swings (see `PlayerState` doc).
     */
    player: {
      render: ActorRender;
      idle: Record<Facing, StripAnim>;
      walk: Record<Facing, StripAnim>;
      chop: Record<Facing, StripAnim>;
      mine: Record<Facing, StripAnim>;
      gather: Record<Facing, StripAnim>;
      attack: Record<Facing, StripAnim>;
      death: Record<Facing, StripAnim>;
    };
    /**
     * Enemy: single-orientation Run (`walk`) strip + a one-shot Death collapse (see GameScene.killEnemy),
     * plus (Phase B) a slow Idle bob on its own 32px footprint and a catalogue of equippable `weapons`
     * (art only — stats in data/weapons.ts) the mob rolls from per spawn. `walk`/`idle` carry per-frame
     * `mainHand` anchors so the held weapon pins to the hand each tick.
     */
    enemy: {
      render: ActorRender;
      idle: StripAnim;
      walk: StripAnim;
      death: StripAnim;
      weapons: Record<string, WeaponArt>;
      /** Shared hand mitt pinned to the `mainHand` (grips the weapon) and `offHand` anchors — see
       *  {@link HandArt}. The skeleton always has both hands, armed or not. */
      hand: HandArt;
    };
  };
  /**
   * Placeable-station animations, keyed by station role — separate from `actors` since these aren't
   * characters. Today just the campfire, authored at several fuel-intensity levels (see
   * {@link StationLevels}); `data/buildables.ts`'s `campfire.animKey` stays truthy to route through
   * the animated-buildable branch, but the played key is a per-level `campfireLevelKey(n)`.
   */
  stations: {
    campfire: StationLevels;
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
      {
        source: { kind: 'sheetFrame', sheet: 'Environment/Tilesets/Floors_Tiles.png', frame: 252 },
        weight: 14,
      }, // grass (2,10)
      {
        source: { kind: 'sheetFrame', sheet: 'Environment/Tilesets/Floors_Tiles.png', frame: 251 },
        weight: 10,
      }, // grass (1,10)
      {
        source: { kind: 'sheetFrame', sheet: 'Environment/Tilesets/Floors_Tiles.png', frame: 253 },
        weight: 10,
      }, // grass (3,10)
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
        down: {
          path: 'Entities/Characters/Body_A/Animations/Idle_Base/Idle_Down-Sheet.png',
          frameSize: 64,
          frames: 4,
        },
        side: {
          path: 'Entities/Characters/Body_A/Animations/Idle_Base/Idle_Side-Sheet.png',
          frameSize: 64,
          frames: 4,
        },
        up: {
          path: 'Entities/Characters/Body_A/Animations/Idle_Base/Idle_Up-Sheet.png',
          frameSize: 64,
          frames: 4,
        },
      },
      walk: {
        down: {
          path: 'Entities/Characters/Body_A/Animations/Walk_Base/Walk_Down-Sheet.png',
          frameSize: 64,
          frames: 6,
        },
        side: {
          path: 'Entities/Characters/Body_A/Animations/Walk_Base/Walk_Side-Sheet.png',
          frameSize: 64,
          frames: 6,
        },
        up: {
          path: 'Entities/Characters/Body_A/Animations/Walk_Base/Walk_Up-Sheet.png',
          frameSize: 64,
          frames: 6,
        },
      },
      // Each action maps to the Body_A motion that reads right for it: chop = Slice_Base
      // (side-swing axe, fells trees); mine = Crush_Base (overhead smash, reads as a pickaxe on
      // rock); gather = Collect_Base (crouch-and-pick, reads as foraging a bush); attack = Pierce_Base
      // (weapon thrust — the character holds a sword, so this is the combat swing). All 8×64px, 3-way.
      // NB Pierce ships its up strip as `Pierce_Top-Sheet.png` (not `_Up`) — the manifest lists
      // explicit paths, so the odd name is captured here.
      chop: {
        down: {
          path: 'Entities/Characters/Body_A/Animations/Slice_Base/Slice_Down-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
        side: {
          path: 'Entities/Characters/Body_A/Animations/Slice_Base/Slice_Side-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
        up: {
          path: 'Entities/Characters/Body_A/Animations/Slice_Base/Slice_Up-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
      },
      mine: {
        down: {
          path: 'Entities/Characters/Body_A/Animations/Crush_Base/Crush_Down-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
        side: {
          path: 'Entities/Characters/Body_A/Animations/Crush_Base/Crush_Side-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
        up: {
          path: 'Entities/Characters/Body_A/Animations/Crush_Base/Crush_Up-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
      },
      gather: {
        down: {
          path: 'Entities/Characters/Body_A/Animations/Collect_Base/Collect_Down-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
        side: {
          path: 'Entities/Characters/Body_A/Animations/Collect_Base/Collect_Side-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
        up: {
          path: 'Entities/Characters/Body_A/Animations/Collect_Base/Collect_Up-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
      },
      attack: {
        down: {
          path: 'Entities/Characters/Body_A/Animations/Pierce_Base/Pierce_Down-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
        side: {
          path: 'Entities/Characters/Body_A/Animations/Pierce_Base/Pierce_Side-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
        up: {
          path: 'Entities/Characters/Body_A/Animations/Pierce_Base/Pierce_Top-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
      },
      // death = Death_Base: an 8-frame collapse. Directional like the other player strips (up ships as
      // `Death_Up`, not the `_Top` oddity Pierce has), played once and held on the last (downed) frame.
      death: {
        down: {
          path: 'Entities/Characters/Body_A/Animations/Death_Base/Death_Down-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
        side: {
          path: 'Entities/Characters/Body_A/Animations/Death_Base/Death_Side-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
        up: {
          path: 'Entities/Characters/Body_A/Animations/Death_Base/Death_Up-Sheet.png',
          frameSize: 64,
          frames: 8,
        },
      },
    },
    enemy: {
      // Native 1:1 like the player (crisp at integer zoom). The skeleton's feet reach the frame
      // bottom (content bbox ≈ y34–64), so originY 0.96 grounds it on the tile.
      render: { scale: 1, originX: 0.5, originY: 0.96 },
      // Idle bob: a 128×32 sheet = 4 frames of 32px. The 32px canvas is just TIGHTER PADDING than the
      // 64px Run canvas — the skeleton CONTENT is the same ~30px tall in both sheets (measured). So the
      // idle strip renders at scale 1 like the Run; a scale of 2 (matching the 32→64 canvas ratio) drew
      // the character at ~2× and it visibly ballooned whenever a wanderer paused to idle. Content is
      // bottom-aligned like the Run, so originY 0.92 grounds the feet identically (32·0.08 = 2.56px
      // below tile, == the Run's 64·0.04). anchors are frame-px; weaponTransform rescales them per strip.
      idle: {
        path: 'Entities/Mobs/Skeleton Crew/Skeleton - Base/Idle/Idle-Sheet.png',
        frameSize: 32,
        frames: 4,
        render: { scale: 1, originX: 0.5, originY: 0.92 },
        // mainHand holds the weapon OUT to the front (was ~x20 = straight up the face); `rot` leans the
        // shaft forward off the skull. offHand = the free fist at the far side. y follows the bob.
        anchors: {
          mainHand: [
            { x: 24, y: 20, rot: 14 },
            { x: 24, y: 21, rot: 14 },
            { x: 24, y: 20, rot: 14 },
            { x: 24, y: 19, rot: 14 },
          ],
          offHand: [
            { x: 10, y: 20 },
            { x: 10, y: 21 },
            { x: 10, y: 20 },
            { x: 10, y: 19 },
          ],
        },
      },
      // Run strip (frame 0 doubles as the Phase-A frozen idle). Per-frame mainHand grip + offHand points
      // (frame-px space, one per frame) so the held weapon and both fists track the run cycle.
      walk: {
        path: 'Entities/Mobs/Skeleton Crew/Skeleton - Base/Run/Run-Sheet.png',
        frameSize: 64,
        frames: 6,
        anchors: {
          mainHand: [
            { x: 43, y: 41, rot: 14 },
            { x: 44, y: 40, rot: 14 },
            { x: 43, y: 39, rot: 14 },
            { x: 43, y: 41, rot: 14 },
            { x: 44, y: 40, rot: 14 },
            { x: 43, y: 39, rot: 14 },
          ],
          offHand: [
            { x: 28, y: 47 },
            { x: 29, y: 46 },
            { x: 28, y: 45 },
            { x: 28, y: 47 },
            { x: 29, y: 46 },
            { x: 28, y: 45 },
          ],
        },
      },
      // Death cells are 96×64 (wider than the 64² Run cells) — the collapse needs horizontal room.
      // Sliced at 64 it flickered (every 3rd slice empty) and jumped L/R; 96×8 reads as a clean fall.
      death: {
        path: 'Entities/Mobs/Skeleton Crew/Skeleton - Base/Death/Death-Sheet.png',
        frameSize: 64,
        frameWidth: 96,
        frames: 8,
      },
      // Equippable weapon ART (stats in data/weapons.ts, shared id). Sources are extracted from
      // Weapons/Bone/Bone.png into _derived/weapons/ in B2 (files not needed until the B4/B5 load).
      // pivot = grip end (bottom-centre); z 1 draws the weapon in front of the depth-9 skeleton.
      weapons: {
        club: {
          source: { kind: 'image', path: '_derived/weapons/club.png' },
          pivot: [0.5, 0.9],
          z: 1,
        },
        knife: {
          source: { kind: 'image', path: '_derived/weapons/knife.png' },
          pivot: [0.5, 0.9],
          z: 1,
        },
      },
      // Visible fist layered on both hands (the Base skeleton's own hands are unreadable nubs). One
      // brown gloved fist (Hands.png idx 4) extracted into _derived/hand.png — a leather-glove look
      // that reads less like bare human skin than the tan idx-0 fist did; centred on the anchor, mirrored with
      // the body. mainZ 2 draws it over the weapon (z 1); offZ 1 sits the free fist beside the body.
      hand: {
        source: { kind: 'image', path: '_derived/hand.png' },
        pivot: [0.5, 0.5],
        mainZ: 2,
        offZ: 1,
      },
    },
  },
  stations: {
    // Bonfire_01..08-Sheet.png are the *full* campfire (log base + flames — unlike Fire_0x-Sheet.png,
    // which is flames only and looked like a floating fire), each 128×32 = 4 frames of 32×32, at
    // rising flame intensity (01 ≈ embers → 08 ≈ roaring). CampfireManager plays the level matching the
    // fire's fuel, so the flame grows/shrinks as it burns (plan 016). (09/10 are a different, boxed
    // forge structure — not a campfire, hence levels:8.) Square cell, so a bare frameSize:32 slices it.
    campfire: {
      pathTemplate: 'Environment/Structures/Stations/Bonfire/Bonfire_{n}-Sheet.png',
      levels: 8,
      frameSize: 32,
      frames: 4,
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
export const playerAnimKey = (state: PlayerState, facing: Facing): string =>
  `player-${state}-${facing}`;

/** Texture/anim key for the enemy Run strip (frame 0 doubles as the Phase-A frozen idle). */
export const enemyWalkKey = 'enemy-walk';

/** Texture/anim key for the enemy Idle bob strip (32px footprint — see actors.enemy.idle, Phase B). */
export const enemyIdleKey = 'enemy-idle';

/** Texture/anim key for the enemy Death strip (one-shot collapse on kill). */
export const enemyDeathKey = 'enemy-death';

/** Number of campfire intensity levels available (see `stations.campfire`). */
export const campfireLevelCount = (): number => ACTIVE_TILESET.stations.campfire.levels;

/**
 * Texture/anim key for campfire intensity level `n` (1..{@link campfireLevelCount}). CampfireManager
 * picks `n` from a fuel bucket and plays this key; PreloadScene/actorAnims register one per level.
 */
export const campfireLevelKey = (n: number): string => `campfire-${n}`;

/**
 * The {@link StripAnim} for campfire intensity level `n` — resolves the shared level shape against
 * `stations.campfire.pathTemplate` (`{n}` → zero-padded level). Loaded/registered under
 * {@link campfireLevelKey}`(n)`.
 */
export const campfireLevelStrip = (n: number): StripAnim => {
  const s = ACTIVE_TILESET.stations.campfire;
  return {
    path: s.pathTemplate.replace('{n}', String(n).padStart(2, '0')),
    frameSize: s.frameSize,
    frames: s.frames,
    frameWidth: s.frameWidth,
  };
};

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
