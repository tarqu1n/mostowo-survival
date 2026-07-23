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
  /** Accumulated real-time (ms) of the current timed action on THIS node — the persistent
   *  progress-accumulator for the salvage/clear lifecycle (plan 047). Unlike the per-order
   *  `chopElapsed`, it lives on the node so it survives cancel/re-queue (resuming continues where it
   *  left off); it resets only when a stage completes (salvage→ruin resets it for the clear stage,
   *  clear removes the node). `0` for non-timed nodes (trees/rocks/bushes never touch it). */
  progressMs: number;
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
   *  oriented sprite WallBehavior materialises (left = the side sheet flipped). */
  facing?: FacingSpec;
}

/**
 * A built, live/simulated structure in the world — the generic runtime record every buildable with a
 * `behavior` collapses into (plan 037: campfire + wall). Owned by a StructureManager behavior module
 * (the sole writer of `sprite`'s anim/tint + the sole destroyer), keyed by its `behavior` for routing.
 * `sprite` is the primary/base layer; each behavior's extra runtime state (fuel/flame for the campfire,
 * hp/facing for the wall) lives in the strongly-typed `state`, so a homogeneous `PlacedStructure[]` can
 * be iterated generically (pick/tick/reset) without losing per-behavior type safety at the module.
 */
export interface PlacedStructure<S = unknown> {
  id: string;
  /** The `BUILDABLES` entry this was built from — drives per-struct data reads (light/tilesTall/…). */
  buildableId: string;
  /** The behavior module that owns this struct — the StructureManager dispatch key (`'campfire'`/`'wall'`). */
  behavior: string;
  col: number;
  row: number;
  /** Primary/base sprite — the owning behavior module is its sole writer + destroyer. */
  sprite: Phaser.GameObjects.Sprite;
  /** Behavior-owned runtime state (see {@link CampfireState}/{@link WallState}). */
  state: S;
}

/**
 * A campfire structure's runtime state (plan 012/016). The fire is THREE layered sprites: the
 * {@link PlacedStructure.sprite} base is the stone ring (always present), `flame` is the flame over it
 * (large/small sheet + scale by fuel, hidden when out), and `smoke` is the plume above (always
 * drifting). `fuel` drains every frame; `lit` mirrors `fuel > 0` and drives the light it casts + its
 * dim-out when spent. The campfire behavior module picks the flame sheet + scale from fuel each tick
 * (`flameBaseScale` is its full-fuel fit).
 */
export interface CampfireState {
  /** Flame layer, drawn over the base — swaps large/small sheet + scales by fuel, hidden when out. */
  flame: Phaser.GameObjects.Sprite;
  /** Smoke plume, drawn above the flame — always visible/animating. */
  smoke: Phaser.GameObjects.Sprite;
  fuel: number;
  lit: boolean;
  /** Flame's fitted full-fuel display scale — render state; the large sheet ×[MIN..1] by fuel. */
  flameBaseScale: number;
  /** Which flame sheet is currently rendered (large >50% fuel, small ≤50%) — swap state, so the anim isn't replayed every tick. */
  flameLevel: 'large' | 'small';
}
export type CampfireStructure = PlacedStructure<CampfireState>;

/**
 * A barricade wall structure's runtime state (plan 037). Its single oriented {@link PlacedStructure.sprite}
 * is the wall behavior module's concern; `hp` drops when a mob attacks it (chunk 2c), the HP-stage render
 * steps the Destroy sheet toward rubble, and at `hp <= 0` the wall plays the Destroy anim and is removed
 * (its tile freed through BuildManager). `facing` is the player-rotate placement facing (left = the side
 * sheet flipped).
 */
export interface WallState {
  facing: FacingSpec;
  hp: number;
  maxHp: number;
}
export type WallStructure = PlacedStructure<WallState>;

/**
 * A spike-trap structure's runtime state (plan 040). Its single {@link PlacedStructure.sprite} shows
 * the spike sheet: `armed` true = primed (settled on the armed frame — fires when an enemy stands on
 * the trap's tile, dealing one hit, then flips `armed` false); `armed` false = spent (held on the
 * extended peak frame) until a `rearm` worker order (dawn auto-enqueue + tap) re-primes it. Trigger-once
 * by construction — one enemy-on-tile → one damage application. See TrapBehavior.
 */
export interface TrapState {
  armed: boolean;
}
export type TrapStructure = PlacedStructure<TrapState>;

/**
 * What a pointer "raycast" landed on: the specific world entity whose *rendered sprite* is drawn
 * under the point (see {@link ScenePicker.pickSpriteAt}). `null` (the absence of a pick) means empty
 * ground — no interactive sprite there — and the caller falls back to a plain move-to-tile. A built
 * campfire/wall both resolve to the one `structure` kind (behavior-branched by the consumer).
 */
export type PointerPick =
  | { kind: 'tree'; tree: TreeNode }
  | { kind: 'enemy'; enemy: MonsterCharacter }
  | { kind: 'site'; site: BuildSite }
  | { kind: 'structure'; structure: PlacedStructure };

/** Cardinal facing shorthand for {@link ScenarioSpec}, mapped to `lastFacing` deltas below. */
export type FacingSpec = 'up' | 'down' | 'left' | 'right';

export const FACING_DELTAS: Record<FacingSpec, { dCol: number; dRow: number }> = {
  up: { dCol: 0, dRow: -1 },
  down: { dCol: 0, dRow: 1 },
  left: { dCol: -1, dRow: 0 },
  right: { dCol: 1, dRow: 0 },
};
