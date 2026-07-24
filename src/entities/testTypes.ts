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
import type { RunSelection } from '../systems/buildRun';
import type { DebugState } from '../scenes/testApi';
import type { NpcDayRole, NpcNightPosture } from './NpcCharacter';
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
  /** Spawn the player holding a demo melee weapon (`MELEE_WEAPONS` id; unknown/omitted = unarmed) —
   *  mirrors an enemy's `weaponId`, for deterministic reach/arc specs (plan 036). */
  melee?: string;
  /** Force-equip these equippable item ids into their declared slots (plan 049), bypassing the bag —
   *  e.g. `['bow']` to enable ranged, `['brand']` for the off-hand light/drain. Deterministic setup
   *  seam paralleling `melee`; the real bag↔slot toggle path is `equip:toggle`. */
  equip?: string[];
  trees?: Array<[number, number]>;
  rocks?: Array<[number, number]>;
  bushes?: Array<[number, number]>;
  /** Wrecked tents (`salvagedTent`) — the `oneShot` two-stage salvage→clear node (plan 047). Placed
   *  live/full; a spec salvages one (a timed `harvest`) to leave a permanent ruined husk, then clears
   *  the husk (a timed `clear`) to remove it. Ids returned as `tentIds`. See __test.applyScenario. */
  tents?: Array<[number, number]>;
  enemies?: Array<
    | [number, number]
    | {
        at: [number, number];
        id?: string;
        patrolRoute?: Array<[number, number]>;
        mode?: MonsterMode;
        /** Force the spawned weapon (else rolled from the enemy's pool) — for deterministic combat specs. */
        weaponId?: string;
        /** `'fire'` spawns a fire-seeking wave mob (plan 038 Step 4); omitted/`'player'` = player-target. */
        objective?: 'player' | 'fire';
      }
  >;
  walls?: Array<[number, number]>;
  blueprints?: Array<[number, number]>;
  /** Campfires placed built + lit, bypassing the base-zone gate (fixtures). See __test.applyScenario. */
  campfires?: Array<[number, number]>;
  /** Seed every placed campfire's fuel (e.g. a near-empty fire for a drain/relight test). */
  campfireFuel?: number;
  /** Spike traps placed built + ARMED, bypassing tilePlaceable (fixtures) — a spec drives one spent by
   *  scripting an enemy onto its tile (plan 040). See __test.applyScenario. */
  traps?: Array<[number, number]>;
  /** Workbenches placed built + full-hp, bypassing tilePlaceable/base-zone (fixtures) — a spec drives
   *  one damaged via `damageWorkbench` (or an adjacent mob) then mends it with a `repair` order (plan
   *  048). Ids returned as `workbenchIds`. See __test.applyScenario. */
  workbenches?: Array<[number, number]>;
  /** Place the single AI companion (plan 042). `at` is its spawn tile; the rest seed its scaffold
   *  state so a spec can read it back via `debugState().companion` (behaviour lands in later steps).
   *  `guardAt` sets the night guard tile (not yet behavioural); `hp`/`downed` seed collapse-state e2e. */
  companion?: {
    at: [number, number];
    dayRole?: NpcDayRole;
    nightPosture?: NpcNightPosture;
    guardAt?: [number, number];
    hp?: number;
    downed?: boolean;
  };
  /** Seed the shared base-supply pool's wood/rock counts (plan 042; the store module lands in Step 3,
   *  so this seeds a placeholder holder for now). Surfaced in `debugState().baseSupply`. */
  baseSupply?: { wood?: number; rock?: number };
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
  tentIds: string[];
  enemyIds: string[];
  siteIds: string[];
  campfireIds: string[];
  trapIds: string[];
  workbenchIds: string[];
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
  /** DEV/test-only: the current Blueprint-Mode pending-run tally (plan 050 Step 7) — the tiles plus
   *  placeable/affordable counts, the affordable subset's cumulative cost, and its serial build ETA
   *  (BuildManager's `runSelection()`). Lets a spec assert the live run tally the commit bar renders;
   *  an empty run yields `{ tiles: [], placeableCount: 0, affordableCount: 0, totalCost: {}, etaMs: 0 }`. */
  runSelection(): RunSelection;
  /** True if the tile's centre falls within any lit campfire's light radius. */
  inLight(col: number, row: number): boolean;
  /** Run the real tap-to-feed path on the campfire at `index` (spend wood, top up, relight). */
  feedCampfire(index: number): boolean;
  /** DEV/test-only: drain the campfire at `index` by `amount` fuel (a mob attack on the fire-heart,
   *  plan 038) — knocks its light out (fuel→0 douses it → dark) without the wave AI. NOT a loss; relight
   *  via feedCampfire. Returns false if there's no campfire at that index. */
  damageFire(index: number, amount: number): boolean;
  /** DEV/test-only: the live barricade walls (col/row/facing/hp/maxHp), placement order (plan 037) —
   *  NOT part of DebugState, so the refactor-tripwire golden stays green. */
  walls(): { col: number; row: number; facing: string; hp: number; maxHp: number }[];
  /** DEV/test-only: damage the wall at `index` by `amount` (WallBehavior.takeDamage — the path chunk
   *  2c's enemy drives). Returns whether the blow destroyed it; false if no wall at that index. */
  damageWall(index: number, amount: number): boolean;
  /** DEV/test-only: the live workbenches (col/row/hp/maxHp + whether crafting), placement order (plan
   *  048) — the read seam the workbench spec asserts damage/repair against. NOT part of DebugState (like
   *  {@link walls}), so the refactor-tripwire golden stays untouched. */
  workbenches(): { col: number; row: number; hp: number; maxHp: number; crafting: boolean }[];
  /** DEV/test-only: damage the workbench at `index` by `amount` (WorkbenchBehavior.takeDamage — the
   *  path a bashing mob drives). Returns whether the blow destroyed it; false if none at that index. */
  damageWorkbench(index: number, amount: number): boolean;
  /** DEV/test-only: the player's aggregate count of item `id` in the pack (Inventory.get) — the read
   *  seam a spec asserts a crafted item arrived / a cost was spent against (plan 048). */
  itemCount(id: string): number;
  /** DEV/test-only: live enemies' current HP, spec order (plan 037 2c) — lets the enemy-attack spec
   *  watch a mob's HP fall to a spiked wall's thorns. NOT part of DebugState (no golden bump). */
  enemyHps(): number[];
  /** DEV/test-only: the live resource nodes (id/col/row/alive/oneShot), placement order (plan 047) — a
   *  standalone read seam (like {@link walls}) for the salvage-lifecycle spec to assert a salvaged
   *  `oneShot` ruin stays present-but-dead (no regrow) and is then gone after `clear`. NOT part of
   *  DebugState, so the refactor-tripwire golden stays untouched. */
  nodes(): { id: string; col: number; row: number; alive: boolean; oneShot: boolean }[];
  /** DEV/test-only: seed a node's persistent timed-action accumulator (`progressMs`, plan 047) so a
   *  salvage/clear crosses its threshold in a few driven frames instead of the real 20s/40s — the same
   *  reason `campfireFuel` is seeded rather than burnt down in real time. Also exercises resume: a timed
   *  action picks up from the seeded progress. Returns false if there's no node with that id. */
  setNodeProgress(id: string, ms: number): boolean;
  /** DEV/test-only: enqueue the real `deconstruct` worker order for the wall at `index` (the order the
   *  demolish-mode tap enqueues) — drives the walk-adjacent → remove + partial-refund path under step()
   *  (plan 037 2b). Returns false if there's no wall at that index. */
  deconstructWall(index: number): boolean;
  /** DEV/test-only: enqueue the real `rearm` worker order for the trap at `index` (the order a tap on a
   *  spent trap enqueues) — drives the walk-adjacent → re-prime path under step() (plan 040). Returns
   *  false if there's no trap at that index. */
  rearmTrap(index: number): boolean;
  /** DEV/test-only: start a night wave immediately (plan 038 Step 3), independent of the day→night
   *  clock edge — the deterministic entry point for spawn/pacing specs. Idempotent. */
  beginWave(): void;
  /** The authored zone id at global tile `(col,row)`, `0` = no zone (plan 014 zones read path). */
  zoneAt(col: number, row: number): number;
  /** DEV/test-only: relocate the enemy at `index` (sprite + body + logical tile) without a world
   *  reset — lets a spec cross a distance threshold mid-test. Returns false if no such enemy. */
  moveEnemy(index: number, col: number, row: number): boolean;
  /** DEV/test-only: equip the player's melee weapon by `MELEE_WEAPONS` id, or clear to unarmed with
   *  `null` (an unknown id also clears) — lets a spec assert reach/arc deterministically (plan 036). */
  setPlayerMelee(id: string | null): void;
  /** DEV/test-only: force-equip an equippable item id into its declared slot (plan 049) — enables the
   *  ranged gate / off-hand light without the bag→toggle path. A non-equippable id is a no-op. */
  equip(itemId: string): void;
  /** DEV/test-only: set an equipped consumable's durability by item id (plan 049) — fast-forward a
   *  brand toward empty without driving its whole real-time lifetime. No-op if not equipped. */
  setEquipDurability(itemId: string, value: number): void;
  /** DEV/test-only: set the companion's day role — round-trips to `debugState().companion.dayRole`
   *  (plan 042 Step 2). No-op if no companion is spawned; the behaviour it drives lands in later steps. */
  setNpcDayRole(role: NpcDayRole): void;
  /** DEV/test-only: set the companion's night posture — round-trips to
   *  `debugState().companion.nightPosture` (plan 042 Step 2). No-op if no companion is spawned. */
  setNpcNightPosture(posture: NpcNightPosture): void;
  /** DEV/test-only: set the companion's night guard tile (plan 042 Step 2). No-op if no companion is
   *  spawned; not surfaced in debugState yet (the guard behaviour that reads it lands in a later step). */
  setNpcGuardPoint(col: number, row: number): void;
}
