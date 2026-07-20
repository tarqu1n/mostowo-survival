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
 * Full 4-way facing for **directional creatures** (distinct left & right sheets), as opposed to the
 * player/skeleton's 3-way `Facing` (down/side/up, side mirrored with flipX). A `dir4` enemy (see
 * `EnemyDef.actorKind`) ships a separate strip per direction — no flipping — so a boar charging left
 * looks different from one charging right.
 */
export type Facing4 = 'down' | 'up' | 'left' | 'right';
/** Animation states a directional (`dir4`) enemy ships as a strip-per-facing. */
export type DirEnemyState = 'idle' | 'walk' | 'run' | 'attack' | 'hurt' | 'death';
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
 * The hands layered onto the monster. The Base skeleton's own hands are vestigial nubs (crossed-forearm
 * pixels that read as nothing at game scale), so a visible hand from `Weapons/Hands` is pinned to each
 * anchor every frame. The two hands are DISTINCT so the pair reads as a real left + right rather than
 * two identical fists: `source` is the free-hand fist (off hand); `mainSource` (when set) is the
 * weapon-gripping hand — an OPEN grip that wraps the raised weapon — tilted by `mainRot` so it follows
 * the blade, and `offFlip` mirrors the off-hand fist relative to the body so it's the opposite hand.
 * The `mainZ`/`offZ` depth offsets (added to the wielder's depth) put the gripping hand OVER the weapon
 * (weapon `z` 1) and the free hand beside the body.
 */
export interface HandArt {
  /** The free (off) hand image — a closed fist. */
  source: TileSource;
  /** The weapon-gripping (main) hand image, when it differs from the off-hand fist. Defaults to `source`. */
  mainSource?: TileSource;
  /** Resting tilt (deg, clockwise) for the main hand so its open grip aligns with the held weapon;
   *  negated with the body on `flipX`. Default 0. The off-hand fist never rotates. */
  mainRot?: number;
  /** Mirror the off-hand fist relative to the body's facing, so the two hands read as a left/right
   *  pair instead of two of the same. Default false. */
  offFlip?: boolean;
  /** setOrigin as [x,y] fractions — the point pinned to the hand anchor (hand centre). */
  pivot: [number, number];
  /** Depth offset for the weapon-gripping (main) hand — drawn in front of the weapon. */
  mainZ: number;
  /** Depth offset for the free (off) hand. */
  offZ: number;
}

/**
 * A **4-way directional enemy** actor (e.g. the boar) — one strip per state per facing, distinct
 * left & right (no flipX). Contrast the single-orientation `actors.enemy` (skeleton) which fakes
 * facing by mirroring one Run strip. Selected per enemy via `EnemyDef.actorKind: 'dir4'`; the manifest
 * holds these id-keyed under `actors.directional` and `MonsterCharacter` picks the strip from facing.
 * `render` is the shared footprint for all this creature's 32px strips; per-state `render` overrides on
 * an individual `StripAnim` still apply. No hand/weapon rig — dir4 mobs bite (see `EnemyDef.weaponPool`).
 */
export interface DirectionalEnemyActor {
  /** Pack folder under `public/assets/tilesets/` these strips load from — a dir4 creature may live in
   *  a DIFFERENT pack than the base `TilesetManifest.id` (the boar is `craftpix-creatures`, not
   *  `pixel-crawler`), so its strips load via `tilesetAssetUrl(pack, strip.path)`, not the manifest base. */
  pack: string;
  render: ActorRender;
  idle: Record<Facing4, StripAnim>;
  walk: Record<Facing4, StripAnim>;
  run: Record<Facing4, StripAnim>;
  attack: Record<Facing4, StripAnim>;
  hurt: Record<Facing4, StripAnim>;
  death: Record<Facing4, StripAnim>;
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
    /**
     * 4-way directional enemies (e.g. the boar), keyed by `EnemyDef.id`. Separate from the single
     * `enemy` struct so the flip3 skeleton is untouched: a def with `actorKind: 'dir4'` renders from
     * its entry here, one strip per facing (see {@link DirectionalEnemyActor}). Empty until a dir4
     * creature is wired (plan 035b Step 2).
     */
    directional: Record<string, DirectionalEnemyActor>;
  };
  /**
   * Placeable-station animations, keyed by station role — separate from `actors` since these aren't
   * characters. The campfire composites FOUR strips: a stone-ring `base` (always present, dimmed when
   * out), a `flameLarge` + `flameSmall` pair (CampfireBehavior burns the large sheet above 50% fuel and
   * the small one below, so the flame steps down as it runs low), and a `smoke` plume drawn on top at
   * all times (plan 016 follow-up). Neither the base nor a flame reads right alone — the base is a flat
   * ember ring ("no flame") and a bare flame floats with no fuel under it — so we composite.
   * `data/buildables.ts`'s `campfire.animKey` just needs to be truthy to route through the
   * animated-buildable branch.
   */
  stations: {
    campfire: {
      base: StripAnim;
      flameLarge: StripAnim;
      flameSmall: StripAnim;
      smoke: StripAnim;
    };
  };
  /**
   * Placeable *structure* animations, keyed by structure role — a live/destructible buildable's art,
   * separate from `stations` (crafting stations) and `actors` (characters). The barricade wall
   * composites nothing: WallBehavior makes ONE sprite per placed wall that plays a Build strip once,
   * then settles on the Destroy strip's frame 0 (the intact idle) — the HP-stage hook steps the Destroy
   * strip toward rubble as HP drops. Full 4-way facing from three sheets each (down/up/side; left =
   * side flipped) for Build + Destroy, loaded cross-pack from `pack` (the boar precedent). Frame slicing
   * is authoritative in docs/wired-art.md.
   */
  structures: {
    barricade: {
      pack: string;
      build: Record<Facing, StripAnim>;
      destroy: Record<Facing, StripAnim>;
    };
  };
}

/**
 * Build the boar's 4-facing strip set for one action. All boar sheets are horizontal strips of 32px
 * SQUARE frames (frameWidth == frameSize, so no override), one PNG per direction, named
 * `Boar/Boar_<Action>_<dir>.png` under the craftpix-creatures pack (see asset-catalog.json).
 */
const boarStrips = (action: string, frames: number): Record<Facing4, StripAnim> =>
  Object.fromEntries(
    (['down', 'up', 'left', 'right'] as Facing4[]).map((dir) => [
      dir,
      { path: `Boar/Boar_${action}_${dir}.png`, frameSize: 32, frames } satisfies StripAnim,
    ]),
  ) as Record<Facing4, StripAnim>;

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
    // Node sprites (tree/rock/bush) are NO LONGER manifest roles (plan 021 step 6) — every node def
    // now names its own catalog asset per skin (see src/data/maps/nodes.json), resolved via the
    // shared decor/catalog render path. The `_derived/*.png` sprites still exist; they're referenced
    // as catalog assets (`pixel-crawler/_derived/{tree_pine,rock,bush}.png`), not fixed roles here.
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
          // Free hand dropped down + out (out 3, down 3 — the 32px idle-frame equivalent of the Run's
          // shift) so it hangs by the hip rather than tucked up at the ribs. y follows the bob.
          offHand: [
            { x: 7, y: 23 },
            { x: 7, y: 24 },
            { x: 7, y: 23 },
            { x: 7, y: 22 },
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
          // Free hand hangs low by the hip, well clear of the body (was up at the ribs, tucked in),
          // so it reads as a swinging trailing arm: shifted out 5px + down 6px from the old ribs spot.
          offHand: [
            { x: 23, y: 53 },
            { x: 24, y: 52 },
            { x: 23, y: 51 },
            { x: 23, y: 53 },
            { x: 24, y: 52 },
            { x: 23, y: 51 },
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
      // Two DISTINCT hands (the skeleton's own are unreadable nubs), so it doesn't read as two identical
      // fists: off (free) hand = brown gloved fist (_derived/hand.png, Hands.png idx 4); main (weapon)
      // hand = the open grip (_derived/hand_open.png, idx 7) tilted mainRot 14° to wrap the raised weapon.
      // Both centred on their anchor, mirrored with the body. mainZ 2 draws the grip over the weapon
      // (z 1); offZ 1 sits the free fist beside the body. (The idx-4 fist reads as the correct hand —
      // thumb on the outside — un-flipped, so `offFlip` is left off; it's the lever if that ever inverts.)
      hand: {
        source: { kind: 'image', path: '_derived/hand.png' },
        mainSource: { kind: 'image', path: '_derived/hand_open.png' },
        mainRot: 14,
        pivot: [0.5, 0.5],
        mainZ: 2,
        offZ: 1,
      },
    },
    // 4-way directional enemies (plan 035b). The boar lives in the craftpix-creatures pack (not
    // pixel-crawler) — `pack` routes its loads there. All strips are 32px square; `render` grounds the
    // ~28px-tall content on the 16px tile (originY tuned so the hooves sit on the feet tile). Frame
    // counts from asset-catalog.json: Idle 4, Walk 6, Run 5, Attack 5, Hurt 4, Death 6.
    directional: {
      boar: {
        pack: 'craftpix-creatures',
        render: { scale: 1, originX: 0.5, originY: 0.82 },
        idle: boarStrips('Idle', 4),
        walk: boarStrips('Walk', 6),
        run: boarStrips('Run', 5),
        attack: boarStrips('Attack', 5),
        hurt: boarStrips('Hurt', 4),
        death: boarStrips('Death', 6),
      },
    },
  },
  stations: {
    // base = Bonfire_01 (a ring of stones with glowing embers, 128×32 = 4 frames of 32×32) — the fire
    // costs stone to build, so the base reads as a stone fire-ring and is all that's left (dimmed) once
    // out. flameLarge = Fire_01 / flameSmall = Fire_02 (both 128×48 = 4 frames of 32 wide × 48 tall):
    // CampfireBehavior burns the large sheet above 50% fuel and the small one below, so the flame visibly
    // steps down as it runs low. smoke = Smoke-Sheet (same 32×48 grid) rides above the flame at all
    // times. frameWidth(32) ≠ frameSize(48) on the tall sheets, so both are declared (a bare
    // frameSize:48 would slice between frames).
    campfire: {
      base: {
        path: 'Environment/Structures/Stations/Bonfire/Bonfire_01-Sheet.png',
        frameSize: 32,
        frames: 4,
      },
      flameLarge: {
        path: 'Environment/Structures/Stations/Bonfire/Fire_01-Sheet.png',
        frameWidth: 32,
        frameSize: 48,
        frames: 4,
      },
      flameSmall: {
        path: 'Environment/Structures/Stations/Bonfire/Fire_02-Sheet.png',
        frameWidth: 32,
        frameSize: 48,
        frames: 4,
      },
      smoke: {
        path: 'Environment/Structures/Stations/Bonfire/Smoke-Sheet.png',
        frameWidth: 32,
        frameSize: 48,
        frames: 4,
      },
    },
  },
  structures: {
    // Barricade wall (plan 037) — the open lashed-stake palisade `Traps/Barricades/*_2`, full 4-way
    // (D=down/front, U=up/back, S=side; left reuses S flipped, see WallBehavior). Each orientation ships
    // a Build (6f, played once on placement) + a Destroy (6f, frame 0 = intact idle → frame 5 = rubble)
    // sheet, 36w×64h frames throughout. Loaded cross-pack from craftpix-dungeon (via `pack`, not the
    // manifest base). Slicing verified in docs/wired-art.md.
    barricade: {
      pack: 'craftpix-dungeon',
      build: {
        down: { path: 'Traps/Barricades/D_2_Build.png', frameWidth: 36, frameSize: 64, frames: 6 },
        side: { path: 'Traps/Barricades/S_2_Build.png', frameWidth: 36, frameSize: 64, frames: 6 },
        up: { path: 'Traps/Barricades/U_2_Build.png', frameWidth: 36, frameSize: 64, frames: 6 },
      },
      destroy: {
        down: {
          path: 'Traps/Barricades/D_2_Destroy.png',
          frameWidth: 36,
          frameSize: 64,
          frames: 6,
        },
        side: {
          path: 'Traps/Barricades/S_2_Destroy.png',
          frameWidth: 36,
          frameSize: 64,
          frames: 6,
        },
        up: { path: 'Traps/Barricades/U_2_Destroy.png', frameWidth: 36, frameSize: 64, frames: 6 },
      },
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

/**
 * Texture/anim key for a **directional** enemy's state+facing strip, id-scoped so each dir4 creature
 * owns its keyspace (e.g. `enemy-boar-run-left`) — distinct from the skeleton's global `enemy-*` keys.
 */
export const dirEnemyAnimKey = (id: string, state: DirEnemyState, facing: Facing4): string =>
  `enemy-${id}-${state}-${facing}`;

/**
 * Pick a 4-way `Facing4` from a velocity vector — the dominant axis wins (horizontal on an exact tie).
 * Drives a `dir4` enemy's directional strip selection (see `MonsterCharacter`); screen-space, so +y
 * points DOWN (`vy > 0` ⇒ `'down'`). Pure — lives here (Phaser-free) so it's unit-testable without the
 * entity/Phaser graph. The skeleton's flip3 facing is just `vx < 0`, so it doesn't need this.
 */
export const facing4FromVelocity = (vx: number, vy: number): Facing4 =>
  Math.abs(vx) >= Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : vy < 0 ? 'up' : 'down';

/** Texture/anim key for the campfire's stone-ring ember base layer (see `stations.campfire.base`). */
export const campfireBaseKey = (): string => 'campfire-base';

/** Texture/anim key for the campfire's LARGE flame sheet, burned above 50% fuel (see `stations.campfire.flameLarge`). */
export const campfireFlameLargeKey = (): string => 'campfire-flame-large';

/** Texture/anim key for the campfire's SMALL flame sheet, burned at/below 50% fuel (see `stations.campfire.flameSmall`). */
export const campfireFlameSmallKey = (): string => 'campfire-flame-small';

/** Texture/anim key for the campfire's smoke plume, always drawn above the flame (see `stations.campfire.smoke`). */
export const campfireSmokeKey = (): string => 'campfire-smoke';

/** Texture/anim key for the barricade wall's BUILD strip for an orientation (down/side/up — LEFT
 *  facing reuses the `side` sheet flipped at the manager, so it maps to `side`). Played once on
 *  placement, then the sprite settles on the Destroy strip's frame 0. See `structures.barricade`. */
export const barricadeBuildKey = (facing: Facing): string => `barricade-build-${facing}`;

/** Texture/anim key for the barricade wall's DESTROY strip for an orientation — frame 0 = the intact
 *  idle (identical to the Build strip's last frame), stepping to rubble (frame 5) as HP drops (the
 *  damage-stage render hook) and played through on destruction. See `structures.barricade`. */
export const barricadeDestroyKey = (facing: Facing): string => `barricade-destroy-${facing}`;

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
