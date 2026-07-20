/**
 * Pure monster-AI state machine — no Phaser, no scene deps, no module-level mutable state. The scene
 * owns the *effects* (A* `findPath`, `advanceEnemy`, tween movement, contact damage); this module
 * owns the *decision*: given the monster's prior AI state plus a snapshot of the world, it returns the
 * next state, the tile to move toward this tick, and whether the path needs recomputing.
 *
 * FSM: `idle` → `wander` | `patrol` → back to `idle`, with `chase` preempting any calm mode, and
 * `seek` (plan 038 Step 4 — the night wave's objective-target behaviour) sitting between them: a mob
 * flagged `seeksFire` with a lit hearth to attack walks to it and (caller-side) strikes it, but player
 * radius-acquire still **preempts** seek (near the player it fights the player — the roaming-pull),
 * returning to the fire once the player is gone. `seek` needs `fireTile` in the inputs; with no lit
 * fire the mob falls back to the calm modes (and will still acquire the player). `siege` (plan 037 2c
 * — base-defence) preempts everything: when the caller finds its objective (player/fire) is **walled
 * off** (`findPath` → null) it resolves the blocking structure and feeds its tile as `siegeTarget`; the
 * mob then walks adjacent to that wall and (caller-side) bashes it, resuming chase/seek once it breaks
 * through. `siegeTarget` is caller-computed (it owns the A*), so the pure FSM never runs pathfinding.
 *  - **Acquire** is radius-only (world px) using the enemy's own `acquireRadiusPx` (= `EnemyDef.vision`);
 *    no line-of-sight / wall occlusion.
 *  - **De-aggro** is distance-only (no timeout): as the player nears the outer edge of chase range the
 *    monster keeps chasing but its target is perturbed by up to `veerMaxTiles` (ramping with distance —
 *    "losing the scent"); past `chaseDropRadiusPx` it gives up and drops back to an idle beat.
 *  - **wander** = an aimless random reachable tile within `wanderRadiusTiles`, walked once then back to
 *    idle. **patrol** = a set route walked waypoint-to-waypoint with a pause at each. A monster patrols
 *    iff it carries a non-empty `patrolRoute`, else it wanders.
 *
 * All randomness comes through the injected `rng` so tests are deterministic (mirrors `combat.ts`).
 */

import type { Cell, Dims } from './pathfind';

export type MonsterMode = 'idle' | 'wander' | 'patrol' | 'chase' | 'seek' | 'siege';

/** A world-pixel position (radius aggro/de-aggro is measured in world px, not tiles). */
export interface Vec2 {
  x: number;
  y: number;
}

/** The monster's persisted AI state — lives on the scene's enemy instance; `stepMonster` reads it
 *  and returns the next one (never mutates the input). */
export interface MonsterState {
  mode: MonsterMode;
  /**
   * Absolute time gate (ms) for the current mode: `idle` stands until `nowMs >= timerMs`; a `patrol`
   * waypoint pause runs until the same. `0` is the sentinel for "no gate active" (travelling, or a
   * fresh mode) — callers should keep `patrolPauseMs > 0` and `nowMs > 0` so a real pause never
   * collapses back onto the sentinel.
   */
  timerMs: number;
  /** Current roam destination — a wander pick or the active patrol waypoint; `null` when idle/none. */
  goalTile: Cell | null;
  /** Patrol route in tiles; when present & non-empty the monster patrols instead of wanders. */
  patrolRoute?: Cell[];
  /** Index into `patrolRoute` of the waypoint currently headed for. */
  patrolIndex: number;
  /** Last chase repath time (ms) — throttles A* recompute to the caller's repath cadence. */
  lastChaseRepathMs: number;
}

/** A read-only snapshot of the world + tuning the FSM needs to decide one step. */
export interface MonsterInputs {
  nowMs: number;
  /** Monster's current tile (the scene snaps this as the monster reaches path waypoints). */
  monster: Cell;
  /** Monster & player world-pixel positions — radius checks are in world px. */
  monsterPos: Vec2;
  playerPos: Vec2;
  /** Player's current tile — the chase target before veer perturbation. */
  playerTile: Cell;
  /** Acquire radius (world px) = `EnemyDef.vision`. */
  acquireRadiusPx: number;
  chaseDropRadiusPx: number;
  veerBandPx: number;
  veerMaxTiles: number;
  repathMs: number;
  idleMsMin: number;
  idleMsMax: number;
  wanderRadiusTiles: number;
  patrolPauseMs: number;
  dims: Dims;
  /** True if `(col,row)` cannot be walked (out-of-bounds already excluded by the caller/`dims`). */
  isBlocked: (col: number, row: number) => boolean;
  /** Plan 038 Step 4 — this mob's objective is the fire-heart (a wave spawn). When true AND `fireTile`
   *  is non-null, a non-chasing mob `seek`s the fire. Off (default) ⇒ the classic idle/wander/patrol +
   *  player-chase behaviour, unchanged. */
  seeksFire?: boolean;
  /** The tile of the nearest lit hearth to attack, or `null` when none is lit (mob falls back to calm
   *  modes). Stationary, so `seek` re-paths only when it changes. */
  fireTile?: Cell | null;
  /** Plan 037 chunk 2c — the tile of the structure (wall) barring this mob's route to its objective, or
   *  `null` when the objective is reachable / nothing blocks. Computed caller-side (MonsterCharacter,
   *  which owns the `findPath` call): a chase/seek mob whose path to its objective is `null` (walled
   *  off) resolves the blocking wall on the frontier and feeds it here, flipping the FSM into `siege`.
   *  Kept out of the FSM so the pure module never runs A* itself. */
  siegeTarget?: Cell | null;
}

export interface MonsterDecision {
  /** The next persisted state — assign it back onto the monster instance. */
  state: MonsterState;
  /** Tile to move toward this tick; `null` = stand still. Only re-pathed to when `repath` is true. */
  targetTile: Cell | null;
  /** Recompute the A* path to `targetTile` now (target changed / chase cadence elapsed). */
  repath: boolean;
}

/** Fresh idle state; pass a route to make the monster a patroller. */
export function initialMonsterState(patrolRoute?: Cell[]): MonsterState {
  return {
    mode: 'idle',
    timerMs: 0,
    goalTile: null,
    patrolRoute: patrolRoute && patrolRoute.length > 0 ? patrolRoute : undefined,
    patrolIndex: 0,
    lastChaseRepathMs: 0,
  };
}

/**
 * Max per-axis tile offset applied to the chase target within the veer band: `0` well inside chase
 * range (track precisely), ramping to `maxTiles` at the drop-radius edge. Exported so the ramp is
 * unit-testable independent of the rng.
 */
export function chaseVeerMaxTiles(
  distPx: number,
  dropRadiusPx: number,
  bandPx: number,
  maxTiles: number,
): number {
  if (bandPx <= 0) return 0;
  const bandInner = dropRadiusPx - bandPx;
  if (distPx <= bandInner) return 0;
  const t = Math.min(1, (distPx - bandInner) / bandPx);
  return Math.round(t * maxTiles);
}

function distPx(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sameTile(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

function clampTile(c: Cell, dims: Dims): Cell {
  return {
    col: Math.max(0, Math.min(dims.cols - 1, c.col)),
    row: Math.max(0, Math.min(dims.rows - 1, c.row)),
  };
}

/** The player's tile, perturbed by up to `veerMaxTiles` when inside the veer band (else exact). */
function perturbedChaseTarget(inputs: MonsterInputs, d: number, rng: () => number): Cell {
  const maxOff = chaseVeerMaxTiles(
    d,
    inputs.chaseDropRadiusPx,
    inputs.veerBandPx,
    inputs.veerMaxTiles,
  );
  if (maxOff <= 0) return { ...inputs.playerTile };
  const dcol = Math.round((rng() * 2 - 1) * maxOff);
  const drow = Math.round((rng() * 2 - 1) * maxOff);
  return clampTile(
    { col: inputs.playerTile.col + dcol, row: inputs.playerTile.row + drow },
    inputs.dims,
  );
}

/** A random reachable (in-bounds, unblocked, non-self) tile within `radius`, or `null` if none found. */
function pickWanderTile(
  monster: Cell,
  radius: number,
  dims: Dims,
  isBlocked: (col: number, row: number) => boolean,
  rng: () => number,
): Cell | null {
  for (let attempt = 0; attempt < 12; attempt++) {
    const dcol = Math.round((rng() * 2 - 1) * radius);
    const drow = Math.round((rng() * 2 - 1) * radius);
    if (dcol === 0 && drow === 0) continue;
    const col = monster.col + dcol;
    const row = monster.row + drow;
    if (col < 0 || row < 0 || col >= dims.cols || row >= dims.rows) continue;
    if (isBlocked(col, row)) continue;
    return { col, row };
  }
  return null;
}

/** Transition into a fresh idle beat (random pause length). */
function enterIdle(prev: MonsterState, inputs: MonsterInputs, rng: () => number): MonsterState {
  const span = Math.max(0, inputs.idleMsMax - inputs.idleMsMin);
  const pause = inputs.idleMsMin + rng() * span;
  return { ...prev, mode: 'idle', timerMs: inputs.nowMs + pause, goalTile: null };
}

function stepIdle(prev: MonsterState, inputs: MonsterInputs, rng: () => number): MonsterDecision {
  if (inputs.nowMs < prev.timerMs) {
    return { state: prev, targetTile: null, repath: false }; // still pausing → stand
  }
  // Pause elapsed → begin a roam. Patrol if a route exists, else wander.
  if (prev.patrolRoute && prev.patrolRoute.length > 0) {
    const idx = prev.patrolIndex % prev.patrolRoute.length;
    const goal = prev.patrolRoute[idx];
    return {
      state: { ...prev, mode: 'patrol', patrolIndex: idx, goalTile: goal, timerMs: 0 },
      targetTile: goal,
      repath: true,
    };
  }
  const goal = pickWanderTile(
    inputs.monster,
    inputs.wanderRadiusTiles,
    inputs.dims,
    inputs.isBlocked,
    rng,
  );
  if (!goal) return { state: prev, targetTile: null, repath: false }; // no free tile → stand, retry next tick
  return {
    state: { ...prev, mode: 'wander', goalTile: goal, timerMs: 0 },
    targetTile: goal,
    repath: true,
  };
}

function stepWander(prev: MonsterState, inputs: MonsterInputs, rng: () => number): MonsterDecision {
  const goal = prev.goalTile;
  if (!goal || sameTile(inputs.monster, goal)) {
    // Arrived (or the goal was lost) → back to an idle beat.
    return { state: enterIdle(prev, inputs, rng), targetTile: null, repath: false };
  }
  return { state: prev, targetTile: goal, repath: false }; // keep walking the existing path
}

/**
 * Seek the fire-heart (plan 038 Step 4): head for `fireTile` and keep the mob in `seek` mode. The fire
 * is stationary and its tile is blocked (the fire ring), so the caller (MonsterCharacter.update) paths
 * to a walkable tile ADJACENT to it and strikes on contact — this only sets the mode + goal + asks for
 * a repath when the target tile changes (fire relit elsewhere / first entry). Player-acquire is handled
 * upstream in {@link stepMonster}, so it always preempts this.
 */
function stepSeek(prev: MonsterState, fireTile: Cell): MonsterDecision {
  const changed = prev.mode !== 'seek' || !prev.goalTile || !sameTile(prev.goalTile, fireTile);
  return {
    state: { ...prev, mode: 'seek', goalTile: fireTile, timerMs: 0 },
    targetTile: fireTile,
    repath: changed,
  };
}

/**
 * Siege the wall barring the route to the objective (plan 037 chunk 2c): head for `wallTile` and hold
 * `siege` mode. Directly analogous to {@link stepSeek} — the caller (MonsterCharacter.update) paths to a
 * walkable tile ADJACENT to the (blocked) wall and drives the telegraphed strike, and clears the mob's
 * `siegeTarget` once the wall falls so the FSM resumes chase/seek. Only sets the mode + goal + asks for a
 * repath when the target wall changes (a fresh siege / a different frontier wall).
 */
function stepSiege(prev: MonsterState, wallTile: Cell): MonsterDecision {
  const changed = prev.mode !== 'siege' || !prev.goalTile || !sameTile(prev.goalTile, wallTile);
  return {
    state: { ...prev, mode: 'siege', goalTile: wallTile, timerMs: 0 },
    targetTile: wallTile,
    repath: changed,
  };
}

function stepPatrol(prev: MonsterState, inputs: MonsterInputs): MonsterDecision {
  const route = prev.patrolRoute;
  if (!route || route.length === 0) {
    // Route vanished → fall back to idle.
    return {
      state: { ...prev, mode: 'idle', goalTile: null, timerMs: 0 },
      targetTile: null,
      repath: false,
    };
  }
  const goal = prev.goalTile ?? route[prev.patrolIndex % route.length];
  if (!sameTile(inputs.monster, goal)) {
    return { state: prev, targetTile: goal, repath: false }; // travelling to the waypoint
  }
  // At the waypoint: pause (timerMs === 0 ⇒ just arrived, begin it), then advance to the next.
  if (prev.timerMs === 0) {
    return {
      state: { ...prev, timerMs: inputs.nowMs + inputs.patrolPauseMs },
      targetTile: null,
      repath: false,
    };
  }
  if (inputs.nowMs < prev.timerMs) {
    return { state: prev, targetTile: null, repath: false }; // still pausing
  }
  const idx = (prev.patrolIndex + 1) % route.length;
  const next = route[idx];
  return {
    state: { ...prev, patrolIndex: idx, goalTile: next, timerMs: 0 },
    targetTile: next,
    repath: true,
  };
}

/**
 * One AI tick. Pure: never mutates `prev`. See the module doc for the FSM shape. The returned
 * `state` must be persisted by the caller; `targetTile`/`repath` drive its pathfinding & movement.
 */
export function stepMonster(
  prev: MonsterState,
  inputs: MonsterInputs,
  rng: () => number = Math.random,
): MonsterDecision {
  const d = distPx(inputs.monsterPos, inputs.playerPos);

  // Siege (plan 037 chunk 2c): the caller found the objective walled off and resolved the blocking wall
  // — bash it until it falls. Preempts EVERYTHING, including acquire: a walled-off mob has the player in
  // radius but unreachable, so it must break through rather than re-acquire-and-fail-to-path each tick.
  // Cleared caller-side (siegeTarget → null) once the wall breaks, dropping straight back to acquire.
  if (inputs.siegeTarget) {
    return stepSiege(prev, inputs.siegeTarget);
  }

  // Acquire: any calm mode flips to chase the instant the player is within radius.
  if (prev.mode !== 'chase' && d <= inputs.acquireRadiusPx) {
    return {
      state: {
        ...prev,
        mode: 'chase',
        lastChaseRepathMs: inputs.nowMs,
        timerMs: 0,
        goalTile: null,
      },
      targetTile: perturbedChaseTarget(inputs, d, rng),
      repath: true,
    };
  }

  // Chase: track the player (veering near the edge) until the hard drop distance.
  if (prev.mode === 'chase') {
    if (d > inputs.chaseDropRadiusPx) {
      return { state: enterIdle(prev, inputs, rng), targetTile: null, repath: false }; // lost them
    }
    if (inputs.nowMs - prev.lastChaseRepathMs < inputs.repathMs) {
      return { state: prev, targetTile: inputs.playerTile, repath: false }; // keep advancing existing path
    }
    return {
      state: { ...prev, lastChaseRepathMs: inputs.nowMs },
      targetTile: perturbedChaseTarget(inputs, d, rng),
      repath: true,
    };
  }

  // Fire objective (plan 038 Step 4): a wave mob with a lit hearth to hit seeks it — but only once the
  // player-acquire above has declined (so chasing the player always wins the roaming-pull). With no lit
  // fire (`fireTile` null) it falls through to the calm modes below and can still acquire the player.
  if (inputs.seeksFire && inputs.fireTile) {
    return stepSeek(prev, inputs.fireTile);
  }
  // Was seeking, but the fire went dark (no lit hearth) → drop to a calm beat and re-evaluate.
  if (prev.mode === 'seek') {
    return { state: enterIdle(prev, inputs, rng), targetTile: null, repath: false };
  }

  // Calm modes.
  switch (prev.mode) {
    case 'idle':
      return stepIdle(prev, inputs, rng);
    case 'wander':
      return stepWander(prev, inputs, rng);
    case 'patrol':
      return stepPatrol(prev, inputs);
    default:
      return { state: prev, targetTile: null, repath: false };
  }
}
