/**
 * Resource node catalogue. Keyed by node id; add new harvestable nodes here. A node is just data —
 * a rock is the same machinery as a tree with a different sprite role, yield, and footprint (see
 * ResourceNodeDef). Adding a species means a new record here, not new code in GameScene.
 */

import type { ResourceNodeDef } from './types';

/**
 * Base stand tiles for a tall node: the trunk sides and the row below, but never the three tiles
 * directly above. A pine overhangs ~2 tiles upward yet only blocks its trunk tile, so an "above"
 * stand tile sits inside the canopy and (with the worker drawn on top) reads as chopping halfway up
 * the tree — restricting to the base keeps the worker rooted at the trunk. GameScene falls back to
 * any adjacent tile if the base is walled off.
 */
const TREE_BASE_STAND_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
];

export const NODES: Record<string, ResourceNodeDef> = {
  tree: {
    id: 'tree',
    name: 'Tree',
    maxHp: 3,
    armour: 0, // inert for objects — see plan 003 Context & decisions
    speed: 0, // inert for objects
    yieldItemId: 'wood',
    yieldPerHit: 1,
    regrowMs: 15000,
    color: 0x2f5d34,
    stumpColor: 0x5a3f28,
    tile: 'tree',
    tilesTall: 2.6, // big pine on a 16px tile — canopy overhangs upward
    originX: 0.5,
    originY: 0.92, // anchor near the base so the trunk sits on the tile
    standOffsets: TREE_BASE_STAND_OFFSETS,
  },
  rock: {
    id: 'rock',
    name: 'Rock',
    maxHp: 4,
    armour: 0,
    speed: 0,
    yieldItemId: 'stone',
    yieldPerHit: 1,
    regrowMs: 30000, // stone reforms slower than a tree regrows
    color: 0x8a8a8a,
    stumpColor: 0x5a5a5a, // depleted rubble tint
    tile: 'rock',
    tilesTall: 1.2, // a ~1-tile boulder (no tall canopy to inherit — critique #2)
    originX: 0.5,
    originY: 0.8, // base-anchored so it rests on its tile
    // standOffsets omitted → any adjacent tile is a valid mining spot
  },
};
