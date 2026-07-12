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

/** Semantic colour palette (dark & grotty). Expand as the art identity firms up. */
export const COLORS = {
  background: 0x14100f,
  water: 0x24384a,
  ui: 0xe8dcc0,
  ghostValid: 0x4caf50, // build ghost when a tile is placeable + affordable
  ghostInvalid: 0xb23b3b, // build ghost when blocked or unaffordable
  blueprint: 0x5a7a9a, // placed-but-unbuilt construction site (drawn translucent)
  queued: 0xffd500, // outline / marker for targets currently in the worker's task queue
} as const;
