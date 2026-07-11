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

/** Semantic colour palette (dark & grotty). Expand as the art identity firms up. */
export const COLORS = {
  background: 0x14100f,
  dirt: 0x3b2f2a,
  grass: 0x2f3b26,
  water: 0x24384a,
  player: 0xd9c7a3,
  ui: 0xe8dcc0,
} as const;
