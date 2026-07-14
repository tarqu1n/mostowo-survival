/**
 * Global game constants. Keep tunables here so they're easy to find and change from any device.
 */

import type { Hurtbox } from './data/types';

/**
 * Base render resolution. Mobile-first: a portrait canvas (9:16-ish) that Phaser's Scale.FIT
 * scales up to fill any screen (letterboxing on wider desktop displays). Design at this size.
 */
export const BASE_WIDTH = 360;
export const BASE_HEIGHT = 640;

/**
 * Device-pixel render scale — an integer supersample factor for the canvas backing store.
 *
 * The game is authored in the fixed BASE_WIDTH×BASE_HEIGHT design space above. On a high-DPI screen
 * the browser stretches that small backing store up to the physical display by a *fractional* factor,
 * and a NEAREST-sampled fractional upscale drops/doubles whole pixel rows — thin crawling seams along
 * tile edges (worst on mobile GPUs; this is what put the black lines on the doubled map). Rendering
 * the backing store at ~device density makes that final upscale ~1:1, so the seams vanish and
 * everything is sharper. Kept an integer so sprite pixels stay uniform (same reason zoom is integer —
 * see ZOOM_STEP). World and HUD stay authored in design units; each scene's camera zoom absorbs this
 * factor (see GameScene.setZoom and UIScene.create). Override for tuning/tests with `?ss=N`.
 */
export const RENDER_SCALE: number = (() => {
  if (typeof window === 'undefined') return 1; // unit tests run in plain Node — no DOM, no scaling
  try {
    const forced = Number(new URLSearchParams(window.location.search).get('ss'));
    if (Number.isFinite(forced) && forced >= 1 && forced <= 4) return Math.round(forced);
  } catch {
    // location unavailable — fall through to the DPR-derived default
  }
  return Math.min(3, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
})();

/** Pixel size of a world tile at base resolution. */
export const TILE_SIZE = 16;

/**
 * Ground is baked into RenderTextures stacked vertically, this many tile-rows tall each (see
 * groundRenderer.drawMapLayers). One map-tall texture (80 rows = 1280px after the map doubled) developed
 * faint, evenly-spaced dark horizontal lines that worsened toward the bottom — only on real mobile
 * GPUs, never on desktop/headless. Cause: NEAREST sampling of a tall texture at reduced fragment
 * precision (`mediump` where the GPU lacks `GL_FRAGMENT_PRECISION_HIGH`) rounds the texel coordinate
 * to the wrong row, and the absolute error grows with the texture's V extent — so the taller the
 * texture, the lower down (and more often) a row gets mis-sampled. Capping each chunk's height keeps
 * that error below half a texel (a 40-row/640px map showed no lines pre-doubling), so no row flips.
 * Chunks are tile-aligned and drawn 1:1, so their shared edges are just adjacent grass — no seam.
 */
export const GROUND_CHUNK_ROWS = 32;

/** Total inventory slots (the full grid panel). */
export const INVENTORY_SLOTS = 20;
/** Slots surfaced on the always-visible hotbar (the first N inventory slots). Must be ≤ INVENTORY_SLOTS. */
export const HOTBAR_SLOTS = 5;
/** Fallback per-slot stack size for any item whose def omits `maxStack`. */
export const DEFAULT_MAX_STACK = 50;

/** How close (px) the player must be to a node to interact (chop). */
export const INTERACT_RANGE = TILE_SIZE * 1.4;

/** Milliseconds between chop hits while felling a node. */
export const CHOP_INTERVAL_MS = 400;

/**
 * Frame rate for the player's action swings (chop/attack). The strips are 8 frames, so this ≈ one
 * swing per CHOP_INTERVAL_MS (8 / 20 fps = 400 ms) — a chop reads as a continuous swing per hit,
 * and an attack is a single snappy swing. Locomotion (idle/walk) stays at the slower default (10).
 */
export const ACTION_ANIM_FRAMERATE = 20;

/** Hold time (ms) that turns a tap into a queued order rather than an act-now order. */
export const LONGPRESS_MS = 350;

/** On-site work time (ms) for a worker to finish one wall from its blueprint. */
export const BUILD_MS = 2500;

/** Pointer travel (px, base res) above which a press is treated as a drag, not an order. */
export const DRAG_PX = 12;

/** Camera zoom bounds + default. The map (MAP_*) is larger than the viewport, so the camera scrolls
 * and follows the player at every level (higher = more zoomed in); tune to taste. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
export const DEFAULT_ZOOM = 2;
/**
 * Zoom change per UI button press. Kept at whole integers so every zoom stop (100/200/300%) is an
 * integer camera scale: pixel-art sprites nearest-sample cleanly only at integer zoom — a fractional
 * zoom (e.g. 150%) gives some source texels 1px and others 2px, reading as "stretched"/clipping.
 * setZoom() rounds every path (buttons, pinch, restored preference) to enforce this.
 */
export const ZOOM_STEP = 1;
/** localStorage key the current zoom is persisted under (best-effort — see GameScene.setZoom). */
export const ZOOM_STORAGE_KEY = 'mostowo:zoom';

/** Radius (world px) of the character's line of sight — everything beyond it is fogged. */
export const VISION_RADIUS = TILE_SIZE * 5;

/** Starting player combat stats (see plan 003 Context & decisions' cast table). */
export const PLAYER_MAX_HP = 10;
export const PLAYER_START_SPEED = 90;
export const PLAYER_START_VISION = VISION_RADIUS;

/**
 * Player body extent for combat targeting (see `Hurtbox` in data/types). The character sprite is
 * ~1 tile wide and ~2 tall, so its torso occupies the tile above its feet — an enemy touching that
 * tile still connects. Footprint/occupancy stays the single feet tile.
 */
export const PLAYER_HURTBOX: Hurtbox = { width: 1, height: 2 };

/** Base damage of an unarmed hit — shared by an unarmed attack and an enemy's bite via resolveMeleeAttack. */
export const UNARMED_BASE_DAMAGE = 1;

/**
 * Attack commitment: while a swing is in progress (the attack-lock window, see GameScene.playAttackSwing)
 * the player's move speed drops to this fraction of normal, so attacking has weight — you plant and
 * commit rather than gliding through the swing at full pace. Applied to both movepad and pathfinder
 * movement via GameScene.effectiveMoveSpeed.
 */
export const ATTACK_MOVE_SLOW = 0.2;

/** Minimum time (ms) between an enemy's contact-damage attempts on the player. */
export const CONTACT_DAMAGE_COOLDOWN_MS = 1000;

/**
 * Hit feedback (see render/hitFlashPipeline.ts + GameScene.flashHit). When an actor takes damage it
 * flashes red and does a quick squash "flinch". `HIT_FLASH_MS` is how long the reaction lasts;
 * `HIT_FLASH_PEAK` is the max red mix (0..1) at impact — near 1 so the hit is unmistakable, a shade
 * under so a sliver of the sprite's own colour survives. `HIT_FLASH_SQUASH` is how hard the flinch
 * squashes (fraction of scale: wider by this, shorter by ~0.8× this, at impact). `HIT_FLASH_TINT` is
 * the Canvas-fallback fill colour (no shader).
 *
 * On top of the per-sprite flash, a **camera kick** sells the impact: getting bitten gives a firm
 * shake (`PLAYER_HIT_SHAKE_*`) plus a red **damage vignette** pulse round the screen edges
 * (`DAMAGE_VIGNETTE_*`, drawn by UIScene on a `player:hit` event); landing an attack gives a lighter
 * shake (`ENEMY_HIT_SHAKE_*`). Shake intensity is a fraction of the viewport, durations are ms.
 *
 * The enemies ship no attack strip, so an enemy's attack is a coded lunge toward its target:
 * `ENEMY_LUNGE_PX` is the reach (world px) and `ENEMY_LUNGE_MS` the time for each leg of the
 * out-and-back — kept well under the contact cooldown so a lunge always settles before the next bite.
 */
export const HIT_FLASH_MS = 260;
export const HIT_FLASH_PEAK = 0.9;
export const HIT_FLASH_SQUASH = 0.28;
export const HIT_FLASH_TINT = 0xff2a2a;
export const PLAYER_HIT_SHAKE_MS = 100;
export const PLAYER_HIT_SHAKE_INTENSITY = 0.005;
export const ENEMY_HIT_SHAKE_MS = 55;
export const ENEMY_HIT_SHAKE_INTENSITY = 0.003;
export const DAMAGE_VIGNETTE_MS = 460;
export const DAMAGE_VIGNETTE_ALPHA = 0.72;
export const DAMAGE_VIGNETTE_COLOR = 0xe01818;
export const ENEMY_LUNGE_PX = 7;
export const ENEMY_LUNGE_MS = 120;

/**
 * Monster weapon swing feel (Phase B — see GameScene.enemyLungeAt / systems/attachment.ts). The
 * enemy pack ships no mob attack strip, so the bite's weapon "swing" is coded: rotate the held
 * weapon about its grip through `WEAPON_SWING_ARC_DEG`, with a brief `WEAPON_SWING_SCALE_POP` pop,
 * over `WEAPON_SWING_MS` (yoyo). Swing *feel* only — weapon damage/cadence live in data/weapons.ts.
 */
export const WEAPON_SWING_ARC_DEG = 75;
export const WEAPON_SWING_SCALE_POP = 1.12;
export const WEAPON_SWING_MS = 140;

/**
 * Monster AI tuning (see systems/monsterAI.ts). The FSM is idle → wander|patrol → chase.
 * Aggro is radius-only, using the enemy's own `EnemyDef.vision` as the acquire radius (no separate
 * const). De-aggro is distance-only: as the player nears the outer edge of chase range the monster
 * keeps chasing but veers off (path noise ramping with distance) as if losing the scent, then gives
 * up past the hard drop radius.
 *
 * `MONSTER_CHASE_DROP_RADIUS_PX` — hard de-aggro distance; past it the monster returns to a calm state.
 * `MONSTER_VEER_BAND_PX` — width of the outer band (just inside the drop radius) where chase degrades.
 * `MONSTER_VEER_MAX_TILES` — max tiles the chase target is perturbed by at the band's outer edge.
 * `MONSTER_REPATH_MS` — min time between A* repaths while chasing (replaces the old inline `300`).
 * `MONSTER_IDLE_MS_MIN`/`MAX` — random pause length in the `idle` state before the next roam.
 * `MONSTER_WANDER_RADIUS_TILES` — how far a wander picks its next random reachable tile.
 * `MONSTER_PATROL_PAUSE_MS` — pause at each patrol waypoint before advancing to the next.
 */
export const MONSTER_CHASE_DROP_RADIUS_PX = 200;
export const MONSTER_VEER_BAND_PX = 60;
export const MONSTER_VEER_MAX_TILES = 3;
export const MONSTER_REPATH_MS = 300;
export const MONSTER_IDLE_MS_MIN = 700;
export const MONSTER_IDLE_MS_MAX = 2000;
export const MONSTER_WANDER_RADIUS_TILES = 4;
export const MONSTER_PATROL_PAUSE_MS = 1000;

/**
 * Death animation timing (see GameScene.killPlayer / killEnemy). Both actors play a one-shot
 * collapse strip on death: `DEATH_ANIM_FRAMERATE` is slower than an action swing so the collapse
 * reads as a fall, not a twitch (player 8f ≈ 0.67s, enemy 12f ≈ 1.0s). `DEATH_HOLD_MS` is the
 * beat the downed last frame is held before the payoff — the player's scene restart, the enemy's
 * corpse removal.
 */
export const DEATH_ANIM_FRAMERATE = 12;
export const DEATH_HOLD_MS = 300;

/**
 * Day/night cycle timing (see systems/daynight.ts). A full cycle is DAY_MS + NIGHT_MS of real time,
 * looping continuously. TWILIGHT_MS is the length of the dusk/dawn cross-fade at each boundary —
 * kept short relative to DAY_MS/NIGHT_MS so full day and full night both read as distinct plateaus.
 */
export const DAY_MS = 120_000;
export const NIGHT_MS = 90_000;
export const TWILIGHT_MS = 8_000;
/** Darkest the night tint gets (alpha of COLORS.night overlay) — never fully opaque so play stays visible. */
export const NIGHT_MAX_ALPHA = 0.55;

/**
 * Hunger (see systems/needs.ts). HUNGER_DRAIN_PER_SEC empties a full HUNGER_MAX in ~250s (~1.5
 * day/night cycles at current DAY_MS/NIGHT_MS) — tune by feel. While starving (hunger <= 0), the
 * player takes STARVE_DAMAGE every STARVE_DAMAGE_INTERVAL_MS (1 HP / 2s).
 *
 * `HUNGER_LOW_FRACTION` is the "near-empty" cutoff (fraction of HUNGER_MAX): below it the HUD hunger
 * bars turn red AND a steady yellow edge vignette fades in (UIScene, same baked-texture approach as
 * the red damage vignette). Unlike the damage flash it doesn't pulse — its alpha ramps smoothly from
 * 0 at the cutoff up to HUNGER_VIGNETTE_MAX_ALPHA as hunger reaches 0, a persistent "you're starving"
 * cue round the screen edges.
 */
export const HUNGER_MAX = 100;
export const HUNGER_DRAIN_PER_SEC = 0.4;
export const STARVE_DAMAGE = 1;
export const STARVE_DAMAGE_INTERVAL_MS = 2_000;
export const HUNGER_LOW_FRACTION = 0.2;
export const HUNGER_VIGNETTE_COLOR = 0xe0b020;
export const HUNGER_VIGNETTE_MAX_ALPHA = 0.5;

/**
 * TEMP stopgap (plan 018 critique #1): the start map has no food nodes yet and trunk auto-deploys;
 * keep hunger non-lethal until authored food lands, then set true / remove.
 */
export const HUNGER_LETHAL = false;

/** Map ID to load at game start (must match a key in maps/manifest.json). */
export const START_MAP_ID = 'test';

/** Player spawn location within the start map, in tile coordinates (col, row). */
export const SPAWN_TILE = { col: 21, row: 33 };

/**
 * Base zone size in tiles (width, height). The runtime base zone is a rect of this size centred on
 * the spawn tile — see `baseZoneFromSpawn` (plan 018 A8, which replaced the old fixed-bounds BASE_ZONE).
 */
export const BASE_ZONE_SIZE = { w: 21, h: 27 };

/**
 * Campfire fuel (see plan 014 Context & decisions). The fire is always burning once built, draining
 * fuel continuously at `CAMPFIRE_FUEL_BURN_PER_SEC` — a full tank (`CAMPFIRE_FUEL_MAX`) lasts ~120s,
 * deliberately short of a full day/night cycle (DAY_MS + NIGHT_MS = 210s) so upkeep stays a pressure.
 * Refuelled by feeding wood: each unit adds `CAMPFIRE_FUEL_PER_WOOD` fuel (4 wood refuels an empty
 * fire). Starts full on completion.
 */
export const CAMPFIRE_FUEL_MAX = 120;
export const CAMPFIRE_FUEL_BURN_PER_SEC = 1;
export const CAMPFIRE_FUEL_PER_WOOD = 30;

/**
 * Refuel-as-worker-order tuning (plan 016). Tapping a fire queues a `refuel` order: the worker walks
 * adjacent and feeds one wood per `CAMPFIRE_FEED_INTERVAL_MS` (an empty fire tops up in ~4s / 4 wood),
 * stopping when a full wood no longer fits or the bag runs dry. `CAMPFIRE_LIGHT_MIN_FRAC` is what the
 * light radius shrinks to at near-empty, as a fraction of full — it lerps `MIN_FRAC..1` with fuel, so a
 * well-fed fire casts a bigger hole and a dying one dims (full light = the buildable's `light` tiles).
 */
export const CAMPFIRE_FEED_INTERVAL_MS = 1000;
export const CAMPFIRE_LIGHT_MIN_FRAC = 0.4;

/**
 * Flame/smoke rendering (plan 016 follow-up). The flame is a TWO-sheet swap keyed on fuel fraction: at
 * or above `CAMPFIRE_FLAME_LARGE_MIN_FRAC` the larger `Fire_01` sheet burns, scaled a touch by fuel
 * (`CAMPFIRE_FLAME_LARGE_SCALE_MIN`..1 across the top band) so a well-fed fire is visibly bigger; below
 * the threshold the smaller `Fire_02` sheet takes over at native size — so a fire running low steps
 * down. The flame is lifted `CAMPFIRE_FLAME_RISE_PX` above the stone base (reads as rising out of the
 * ring, not sitting in it); a smoke plume always drifts `CAMPFIRE_SMOKE_RISE_PX` above the base centre.
 */
export const CAMPFIRE_FLAME_LARGE_MIN_FRAC = 0.5;
export const CAMPFIRE_FLAME_LARGE_SCALE_MIN = 0.85;
export const CAMPFIRE_FLAME_RISE_PX = 2;
export const CAMPFIRE_SMOKE_RISE_PX = 22;

/** Semantic colour palette (dark & grotty). Expand as the art identity firms up. */
export const COLORS = {
  background: 0x14100f,
  water: 0x24384a,
  ui: 0xe8dcc0,
  ghostValid: 0x4caf50, // build ghost when a tile is placeable + affordable
  ghostInvalid: 0xb23b3b, // build ghost when blocked or unaffordable
  blueprint: 0x5a7a9a, // placed-but-unbuilt construction site (drawn translucent)
  queued: 0xffd500, // outline / marker for targets currently in the worker's task queue
  night: 0x0a1020, // full-screen overlay tint during the day/night cycle's dark hours
  fireLight: 0xffb066, // warm campfire glow tint (later step: light/reveal radius rendering)
} as const;
