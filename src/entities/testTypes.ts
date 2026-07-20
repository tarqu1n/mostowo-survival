/**
 * The DEV-only test-contract types: the declarative scenario spec + result, and the `window.game.__test`
 * surface shape. Moved verbatim out of `scenes/GameScene.ts` (plan 013 Step 2) — names/shapes
 * unchanged. `GameTestApi.state()` returns `DebugState` (plan 013 Step 6 — the serializer moved to
 * `scenes/testApi.ts`, which now installs `GameTestApi` on GameScene's behalf). Consumed by
 * `GameScene.installTestApi()` and by the Tier-2 Playwright harness (`tests/e2e/harness.ts`,
 * `tests/e2e/scenarios.ts`).
 */

import type { DayPhase } from '../systems/daynight';
import type { MonsterMode } from '../systems/monsterAI';
import type { Action } from '../systems/tasks';
import type { DebugState } from '../scenes/testApi';
import type { FacingSpec } from './types';

/**
 * Declarative world spec for the test-only scenario API (plan 007). Every field is optional so a
 * test constructs only what it needs (`{ player:[3,3], trees:[[5,3]] }`). Coordinates are tile
 * (col,row). `enemies` entries default to `kidZombie`; `walls` are built solid, `blueprints`
 * passable-and-unbuilt. `rng`/`wood` pin combat + inventory determinism. `hunger`/`clockMs`/
 * `startPhase` seed the survival state (plan 004) so day/night + hunger scenarios start at a known
 * point (`clockMs` wins over `startPhase`; `startPhase:'night'` = start of night, i.e. `clockMs=DAY_MS`).
 * `bushes` are forageable, non-blocking berry bushes. See __test.applyScenario.
 */
export interface ScenarioSpec {
  player?: [number, number];
  facing?: FacingSpec;
  mode?: 'command' | 'combat' | 'inspect';
  wood?: number;
  inventory?: Record<string, number>;
  trees?: Array<[number, number]>;
  rocks?: Array<[number, number]>;
  bushes?: Array<[number, number]>;
  enemies?: Array<
    | [number, number]
    | {
        at: [number, number];
        id?: string;
        patrolRoute?: Array<[number, number]>;
        mode?: MonsterMode;
        /** Force the spawned weapon (else rolled from the enemy's pool) — for deterministic combat specs. */
        weaponId?: string;
      }
  >;
  walls?: Array<[number, number]>;
  blueprints?: Array<[number, number]>;
  /** Campfires placed built + lit, bypassing the base-zone gate (fixtures). See __test.applyScenario. */
  campfires?: Array<[number, number]>;
  /** Seed every placed campfire's fuel (e.g. a near-empty fire for a drain/relight test). */
  campfireFuel?: number;
  rng?: () => number;
  hunger?: number;
  clockMs?: number;
  startPhase?: DayPhase;
}

/** Ids of the entities {@link ScenarioSpec} placed, in spec order, so a test can reference them. */
export interface ScenarioResult {
  treeIds: string[];
  rockIds: string[];
  bushIds: string[];
  enemyIds: string[];
  siteIds: string[];
  campfireIds: string[];
}

/** The DEV-only debug surface installed at `window.game.__test` (see GameScene.create). */
export interface GameTestApi {
  applyScenario(spec: ScenarioSpec): ScenarioResult;
  step(ms: number): void;
  setRng(fn: () => number): void;
  state(): DebugState;
  order(a: Action): void;
  enqueue(a: Action): void;
  inspect(col: number, row: number): void;
  blocked(col: number, row: number): boolean;
  /** Select `id` + attempt a real placement at a tile (runs tilePlaceable + the isInBase gate). */
  tryPlace(id: string, col: number, row: number): boolean;
  /** True if the tile's centre falls within any lit campfire's light radius. */
  inLight(col: number, row: number): boolean;
  /** Run the real tap-to-feed path on the campfire at `index` (spend wood, top up, relight). */
  feedCampfire(index: number): boolean;
  /** The authored zone id at global tile `(col,row)`, `0` = no zone (plan 014 zones read path). */
  zoneAt(col: number, row: number): number;
  /** DEV/test-only: relocate the enemy at `index` (sprite + body + logical tile) without a world
   *  reset — lets a spec cross a distance threshold mid-test. Returns false if no such enemy. */
  moveEnemy(index: number, col: number, row: number): boolean;
}
