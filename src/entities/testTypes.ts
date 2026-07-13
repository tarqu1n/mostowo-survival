/**
 * The DEV-only test-contract types: the declarative scenario spec + result, and the `window.game.__test`
 * surface shape. Moved verbatim out of `scenes/GameScene.ts` (plan 013 Step 2) — names/shapes
 * unchanged. Consumed by `GameScene` (which implements/installs `GameTestApi`) and by the Tier-2
 * Playwright harness (`tests/e2e/harness.ts`, `tests/e2e/scenarios.ts`).
 */

import type { DayPhase } from '../systems/daynight';
import type { MonsterMode } from '../systems/monsterAI';
import type { Action } from '../systems/tasks';
import type { GameScene } from '../scenes/GameScene';
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
}

/** The DEV-only debug surface installed at `window.game.__test` (see GameScene.create). */
export interface GameTestApi {
  applyScenario(spec: ScenarioSpec): ScenarioResult;
  step(ms: number): void;
  setRng(fn: () => number): void;
  state(): ReturnType<GameScene['debugState']>;
  order(a: Action): void;
  enqueue(a: Action): void;
  inspect(col: number, row: number): void;
  blocked(col: number, row: number): boolean;
}
