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

/**
 * World (map) size in pixels — the playable area, larger than the render viewport (BASE_*). The
 * camera scrolls/follows within it. Held at 2× the base in each dimension (a 45×80-tile map) so the
 * room to roam and build scales with the larger native-scale actors (see DECISIONS.md 2026-07-12);
 * BASE_* stays the fixed viewport/HUD design size.
 */
export const MAP_WIDTH = BASE_WIDTH * 2;
export const MAP_HEIGHT = BASE_HEIGHT * 2;

/** Pixel size of a world tile at base resolution. */
export const TILE_SIZE = 16;

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
 * Frame rate for the player's action swings (chop/punch). The strips are 8 frames, so this ≈ one
 * swing per CHOP_INTERVAL_MS (8 / 20 fps = 400 ms) — a chop reads as a continuous swing per hit,
 * and a punch is a single snappy swing. Locomotion (idle/walk) stays at the slower default (10).
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
 * ~1 tile wide and ~2 tall, so its torso occupies the tile above its feet — a zombie touching that
 * tile still connects. Footprint/occupancy stays the single feet tile.
 */
export const PLAYER_HURTBOX: Hurtbox = { width: 1, height: 2 };

/** Base damage of an unarmed hit — shared by Punch and a zombie's bite via resolveMeleeAttack. */
export const UNARMED_BASE_DAMAGE = 1;

/** Minimum time (ms) between a zombie's contact-damage attempts on the player. */
export const CONTACT_DAMAGE_COOLDOWN_MS = 1000;

/**
 * Hit feedback (see render/hitFlashPipeline.ts + GameScene.flashHit). When an actor takes damage it
 * flashes red and does a quick squash "flinch". `HIT_FLASH_MS` is how long the whole reaction lasts;
 * `HIT_FLASH_PEAK` is the max red mix (0..1) at the moment of impact — kept below 1 so it reads as a
 * flash *tint*, not a solid red silhouette. `HIT_FLASH_TINT` is the Canvas-fallback fill colour (no
 * shader). The skeletons ship no attack strip, so a zombie's attack is a coded lunge toward its
 * target: `ZOMBIE_LUNGE_PX` is the reach (world px) and `ZOMBIE_LUNGE_MS` the time for each leg of the
 * out-and-back — kept well under the contact cooldown so a lunge always settles before the next bite.
 */
export const HIT_FLASH_MS = 200;
export const HIT_FLASH_PEAK = 0.7;
export const HIT_FLASH_TINT = 0xd21f1f;
export const ZOMBIE_LUNGE_PX = 7;
export const ZOMBIE_LUNGE_MS = 120;

/**
 * Death animation timing (see GameScene.killPlayer / killZombie). Both actors play a one-shot
 * collapse strip on death: `DEATH_ANIM_FRAMERATE` is slower than an action swing so the collapse
 * reads as a fall, not a twitch (player 8f ≈ 0.67s, skeleton 12f ≈ 1.0s). `DEATH_HOLD_MS` is the
 * beat the downed last frame is held before the payoff — the player's scene restart, the zombie's
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
 */
export const HUNGER_MAX = 100;
export const HUNGER_DRAIN_PER_SEC = 0.4;
export const STARVE_DAMAGE = 1;
export const STARVE_DAMAGE_INTERVAL_MS = 2_000;

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
} as const;
