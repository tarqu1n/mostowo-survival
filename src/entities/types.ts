/**
 * World entity shapes shared across the scene, systems, and the DEV-only test API. Moved verbatim
 * out of `scenes/GameScene.ts` (plan 013 Step 2) — names/shapes unchanged, this is an import-path
 * move only, so it kills the one systems→scene back-edge (`systems/stats.ts` used to import these
 * from the scene).
 */

import type Phaser from 'phaser';
import type { ResourceNodeDef, EnemyDef } from '../data/types';
import type { MonsterWeapon } from '../data/weapons';
import type { MonsterState } from '../systems/monsterAI';
import type { Cell } from '../systems/pathfind';

/** A live/stump resource node instance in the world (tree sprite + its data + state). */
export interface TreeNode {
  id: string;
  sprite: Phaser.GameObjects.Image;
  def: ResourceNodeDef;
  hp: number;
  alive: boolean;
  col: number;
  row: number;
}

/**
 * A placed-but-not-yet-built wall: a passable blueprint the worker builds on site over time.
 * `rect` stays the physics/collision + blueprint-progress visual throughout; once built it's
 * hidden and `visual` (the wall sprite) is shown on top instead.
 */
export interface BuildSite {
  id: string;
  col: number;
  row: number;
  rect: Phaser.GameObjects.Rectangle;
  visual: Phaser.GameObjects.Image | null;
  progress: number;
  done: boolean;
}

/** A live enemy instance in the world — driven by the pure FSM in systems/monsterAI (plans 003, 011). */
export interface EnemyUnit {
  id: string;
  sprite: Phaser.GameObjects.Sprite & { body: Phaser.Physics.Arcade.Body };
  def: EnemyDef;
  hp: number;
  alive: boolean;
  col: number;
  row: number;
  /** Persisted AI state — read+returned by stepMonster each tick (repath timing lives inside it). */
  ai: MonsterState;
  lastContactAt: number;
  path: Cell[];
  pathIndex: number;
  /** Which render footprint the sprite is currently showing (`walk` 64px vs the `idle` 32px bob) —
   *  so `updateEnemyAnim` only swaps scale/origin/body on an actual state change (see setEnemyFootprint). */
  activeStrip: 'idle' | 'walk';
  /** The rolled-per-spawn held weapon (Phase B), or undefined = unarmed. `sprite` is a plain image
   *  (no physics body) pinned to the hand each tick; `def` owns its damage/cadence; `swingRot` is the
   *  live coded-swing angle (deg) tweened on each bite. */
  weapon?: { id: string; sprite: Phaser.GameObjects.Image; def: MonsterWeapon; swingRot: number };
  /** The two visible fists layered on the skeleton (its own hands are unreadable nubs). Always present,
   *  armed or not: `main` pins to the mainHand anchor (grips the weapon, drawn over it), `off` to the
   *  offHand anchor (free). Plain images, no physics; pinned each tick in syncEnemyAttachments. */
  hands?: { main: Phaser.GameObjects.Image; off: Phaser.GameObjects.Image };
}

/**
 * What a pointer "raycast" landed on: the specific world entity whose *rendered sprite* is drawn
 * under the point (see {@link GameScene.pickSpriteAt}). `null` (the absence of a pick) means empty
 * ground — no interactive sprite there — and the caller falls back to a plain move-to-tile.
 */
export type PointerPick =
  | { kind: 'tree'; tree: TreeNode }
  | { kind: 'enemy'; enemy: EnemyUnit }
  | { kind: 'site'; site: BuildSite };

/** Cardinal facing shorthand for {@link ScenarioSpec}, mapped to `lastFacing` deltas below. */
export type FacingSpec = 'up' | 'down' | 'left' | 'right';

export const FACING_DELTAS: Record<FacingSpec, { dCol: number; dRow: number }> = {
  up: { dCol: 0, dRow: -1 },
  down: { dCol: 0, dRow: 1 },
  left: { dCol: -1, dRow: 0 },
  right: { dCol: 1, dRow: 0 },
};
