/**
 * Global game constants. Keep tunables here so they're easy to find and change from any device.
 */

/**
 * Base render resolution. Mobile-first: a portrait canvas (9:16-ish) that Phaser's Scale.FIT
 * scales up to fill any screen (letterboxing on wider desktop displays). Design at this size.
 */
export const BASE_WIDTH = 360;
export const BASE_HEIGHT = 640;

/** Pixel size of a world tile at base resolution. */
export const TILE_SIZE = 16;

/** How close (px) the player must be to a node to interact (chop). */
export const INTERACT_RANGE = TILE_SIZE * 1.4;

/** Milliseconds between chop hits while felling a node. */
export const CHOP_INTERVAL_MS = 400;

/** Hold time (ms) that turns a tap into a queued order rather than an act-now order. */
export const LONGPRESS_MS = 350;

/** On-site work time (ms) for a worker to finish one wall from its blueprint. */
export const BUILD_MS = 2500;

/** Pointer travel (px, base res) above which a press is treated as a drag, not an order. */
export const DRAG_PX = 12;

/** Camera zoom bounds + default. 1 = whole map visible (no camera scroll room); tune to taste. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
export const DEFAULT_ZOOM = 2;
/** Zoom change per UI button press. */
export const ZOOM_STEP = 0.5;
/** localStorage key the current zoom is persisted under (best-effort — see GameScene.setZoom). */
export const ZOOM_STORAGE_KEY = 'mostowo:zoom';

/** Radius (world px) of the character's line of sight — everything beyond it is fogged. */
export const VISION_RADIUS = TILE_SIZE * 5;

/** Starting player combat stats (see plan 003 Context & decisions' cast table). */
export const PLAYER_MAX_HP = 10;
export const PLAYER_START_SPEED = 90;
export const PLAYER_START_VISION = VISION_RADIUS;

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
