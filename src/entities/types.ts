/**
 * World entity shapes shared across the scene, systems, and the DEV-only test API. Moved verbatim
 * out of `scenes/GameScene.ts` (plan 013 Step 2) — names/shapes unchanged, this is an import-path
 * move only, so it kills the one systems→scene back-edge (`systems/stats.ts` used to import these
 * from the scene). `EnemyUnit` graduated to the `MonsterCharacter` class in Step 4; trees and build
 * sites deliberately stay plain interfaces (behaviour classes yes, data hierarchy no).
 */

import type Phaser from 'phaser';
import type { ParsedNodeDef } from '../systems/nodeDefs';
import type { MonsterCharacter } from './MonsterCharacter';

/** A live/stump resource node instance in the world (tree sprite + its data + state). */
export interface TreeNode {
  id: string;
  sprite: Phaser.GameObjects.Image;
  /** The parsed def (superset of `ResourceNodeDef`, adding `skins`) — carried so the harvest/regrow
   *  path can resolve {@link skin}'s live/depleted sprite without a `NODES` re-lookup (plan 021 step 5). */
  def: ParsedNodeDef;
  hp: number;
  /** Effective max HP for THIS instance — the chosen {@link skin}'s `maxHp` override when it has one,
   *  else the def's `maxHp` (plan: per-skin HP so a smaller tree yields less). Total harvest hits =
   *  this value; drives spawn hp, the chop depletion fraction, and the regrow reset. */
  maxHp: number;
  alive: boolean;
  col: number;
  row: number;
  /** Which of `def.skins` this instance renders (rolled on placement, persisted on the map object as
   *  `NodeObject.skin`; absent/unknown ⇒ `def.skins[0]`). Drives the live sprite and, if that skin
   *  carries a `depleted`, its stump sprite (plan 021 step 5). */
  skin: string;
  /** Authored placement rotation (deg) — the node's TRUE resting angle. Stored so the chop fx can
   *  recoil/tremble around it and settle back to it (rather than snapping the sprite to 0 and losing
   *  the placement rotation permanently, incl. after regrow); the fell clone topples from it too. */
  rotation: number;
}

/**
 * A placed-but-not-yet-built wall: a passable blueprint the worker builds on site over time.
 * `rect` stays the physics/collision + blueprint-progress visual throughout; once built it's
 * hidden and `visual` (the wall sprite) is shown on top instead.
 */
export interface BuildSite {
  id: string;
  /** Which `BUILDABLES` entry this site builds — drives `finishSite`'s render/occupancy branch. */
  buildableId: string;
  col: number;
  row: number;
  rect: Phaser.GameObjects.Rectangle;
  visual: Phaser.GameObjects.Image | null;
  progress: number;
  done: boolean;
  /** Placement facing for an `orientable` buildable (the wall) — stamped by `createBlueprint` from the
   *  build manager's rotate state (plan 037); undefined for a fixed-orientation buildable. Drives the
   *  oriented sprite WallManager materialises (left = the side sheet flipped). */
  facing?: FacingSpec;
}

/**
 * A built campfire in the world: its stacked fire sprites plus fuel/lit state. Owned by
 * CampfireManager, the sole writer of the sprites' anim/tint (and their sole destroyer). `fuel` drains
 * every frame; `lit` mirrors `fuel > 0` and drives the light it casts + its dim-out when spent. The
 * fire is THREE layered sprites: `sprite` is the stone-ring base (always present), `flame` is the
 * flame over it (large/small sheet + scale by fuel, hidden when out), and `smoke` is the plume above
 * (always drifting). CampfireManager picks the flame sheet + scale from fuel each tick (`flameBaseScale`
 * is its full-fuel fit).
 */
export interface CampfireUnit {
  id: string;
  col: number;
  row: number;
  /** Stone-ring ember base layer — always visible (dimmed when out). */
  sprite: Phaser.GameObjects.Sprite;
  /** Flame layer, drawn over the base — swaps large/small sheet + scales by fuel, hidden when out. */
  flame: Phaser.GameObjects.Sprite;
  /** Smoke plume, drawn above the flame — always visible/animating. */
  smoke: Phaser.GameObjects.Sprite;
  fuel: number;
  lit: boolean;
  /** Flame's fitted full-fuel display scale — CampfireManager render state; the large sheet ×[MIN..1] by fuel. */
  flameBaseScale: number;
  /** Which flame sheet is currently rendered (large >50% fuel, small ≤50%) — swap state, so the anim isn't replayed every tick. */
  flameLevel: 'large' | 'small';
}

/**
 * A built barricade wall in the world: its single oriented sprite + HP. Owned by WallManager, the sole
 * writer of the sprite's anim/frame (and its sole destroyer) — mirrors {@link CampfireUnit}. `hp` drops
 * when a mob attacks it (plan 037 chunk 2c wires the enemy); the HP-stage render steps the Destroy
 * sheet toward rubble, and at `hp <= 0` the wall plays the Destroy anim and is removed (its tile freed
 * through BuildManager). `facing` is the player-rotate placement facing (left = the side sheet flipped).
 */
export interface PlacedWall {
  id: string;
  col: number;
  row: number;
  facing: FacingSpec;
  sprite: Phaser.GameObjects.Sprite;
  hp: number;
  maxHp: number;
}

/**
 * What a pointer "raycast" landed on: the specific world entity whose *rendered sprite* is drawn
 * under the point (see {@link ScenePicker.pickSpriteAt}). `null` (the absence of a pick) means empty
 * ground — no interactive sprite there — and the caller falls back to a plain move-to-tile.
 */
export type PointerPick =
  | { kind: 'tree'; tree: TreeNode }
  | { kind: 'enemy'; enemy: MonsterCharacter }
  | { kind: 'site'; site: BuildSite }
  | { kind: 'campfire'; campfire: CampfireUnit };

/** Cardinal facing shorthand for {@link ScenarioSpec}, mapped to `lastFacing` deltas below. */
export type FacingSpec = 'up' | 'down' | 'left' | 'right';

export const FACING_DELTAS: Record<FacingSpec, { dCol: number; dRow: number }> = {
  up: { dCol: 0, dRow: -1 },
  down: { dCol: 0, dRow: 1 },
  left: { dCol: -1, dRow: 0 },
  right: { dCol: 1, dRow: 0 },
};
