import { describe, it, expect } from 'vitest';
import {
  stepMonster,
  chaseVeerMaxTiles,
  initialMonsterState,
  type MonsterInputs,
  type MonsterState,
} from '../monsterAI';

/** Deterministic PRNG (mulberry32) so seeded runs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DROP = 200;
const BAND = 60;
const VEER_MAX = 3;

/** A tuning/world snapshot with the player parked far away (no acquire) unless overridden. */
function baseInputs(over: Partial<MonsterInputs> = {}): MonsterInputs {
  return {
    nowMs: 1000,
    monster: { col: 5, row: 5 },
    monsterPos: { x: 0, y: 0 },
    playerPos: { x: 9999, y: 0 },
    playerTile: { col: 40, row: 5 },
    acquireRadiusPx: 80,
    chaseDropRadiusPx: DROP,
    veerBandPx: BAND,
    veerMaxTiles: VEER_MAX,
    repathMs: 300,
    idleMsMin: 700,
    idleMsMax: 2000,
    wanderRadiusTiles: 4,
    patrolPauseMs: 1000,
    dims: { cols: 60, rows: 60 },
    isBlocked: () => false,
    ...over,
  };
}

describe('acquire (radius-only)', () => {
  it('acquires the player exactly at the radius edge', () => {
    const prev = initialMonsterState();
    const inputs = baseInputs({ playerPos: { x: 80, y: 0 } }); // dist == acquireRadiusPx
    const { state } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('chase');
  });

  it('does NOT acquire just outside the radius', () => {
    // Mid-idle-pause (timerMs > nowMs) so "stays idle" isolates the no-acquire behaviour.
    const prev: MonsterState = { ...initialMonsterState(), mode: 'idle', timerMs: 9999 };
    const inputs = baseInputs({ nowMs: 1000, playerPos: { x: 80.001, y: 0 } });
    const { state } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).not.toBe('chase');
    expect(state.mode).toBe('idle');
  });
});

describe('de-aggro (distance-only)', () => {
  it('keeps chasing at exactly the drop radius', () => {
    const prev: MonsterState = { ...initialMonsterState(), mode: 'chase', lastChaseRepathMs: 0 };
    const inputs = baseInputs({
      nowMs: 1000,
      monsterPos: { x: 0, y: 0 },
      playerPos: { x: DROP, y: 0 },
    });
    const { state } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('chase');
  });

  it('gives up past the drop radius', () => {
    const prev: MonsterState = { ...initialMonsterState(), mode: 'chase', lastChaseRepathMs: 0 };
    const inputs = baseInputs({ monsterPos: { x: 0, y: 0 }, playerPos: { x: DROP + 1, y: 0 } });
    const { state, repath } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('idle');
    expect(repath).toBe(false);
  });
});

describe('veer band', () => {
  it('is 0 well inside chase range, ramps to veerMaxTiles at the drop edge, monotonically', () => {
    const bandInner = DROP - BAND; // 140
    expect(chaseVeerMaxTiles(100, DROP, BAND, VEER_MAX)).toBe(0);
    expect(chaseVeerMaxTiles(bandInner, DROP, BAND, VEER_MAX)).toBe(0);
    expect(chaseVeerMaxTiles(DROP, DROP, BAND, VEER_MAX)).toBe(VEER_MAX);
    const mid = chaseVeerMaxTiles((bandInner + DROP) / 2, DROP, BAND, VEER_MAX);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(VEER_MAX);
    // Monotonic non-decreasing across the band.
    let last = 0;
    for (let dpx = bandInner; dpx <= DROP; dpx += 2) {
      const v = chaseVeerMaxTiles(dpx, DROP, BAND, VEER_MAX);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it('perturbs the chase target within veerMaxTiles on each axis, for any rng draw', () => {
    const prev: MonsterState = {
      ...initialMonsterState(),
      mode: 'chase',
      lastChaseRepathMs: -1000,
    };
    // Player at the drop edge so perturbation is at its max.
    const inputs = baseInputs({
      nowMs: 1000,
      monsterPos: { x: 0, y: 0 },
      playerPos: { x: DROP, y: 0 },
      playerTile: { col: 30, row: 30 },
    });
    for (let seed = 1; seed <= 50; seed++) {
      const { state, targetTile, repath } = stepMonster(prev, inputs, mulberry32(seed));
      expect(state.mode).toBe('chase');
      expect(repath).toBe(true); // cadence elapsed → repath
      expect(targetTile).not.toBeNull();
      expect(Math.abs(targetTile!.col - inputs.playerTile.col)).toBeLessThanOrEqual(VEER_MAX);
      expect(Math.abs(targetTile!.row - inputs.playerTile.row)).toBeLessThanOrEqual(VEER_MAX);
    }
  });

  it('throttles chase repaths to the repath cadence', () => {
    const prev: MonsterState = { ...initialMonsterState(), mode: 'chase', lastChaseRepathMs: 900 };
    const inputs = baseInputs({
      nowMs: 1000,
      monsterPos: { x: 0, y: 0 },
      playerPos: { x: 150, y: 0 },
    });
    // Only 100ms since the last repath (< 300) → no repath this tick.
    const { repath } = stepMonster(prev, inputs, mulberry32(1));
    expect(repath).toBe(false);
  });
});

describe('wander', () => {
  it('picks a reachable tile within the wander radius once the idle pause elapses', () => {
    const inputs = baseInputs({ nowMs: 5000 }); // player far → no acquire
    for (let seed = 1; seed <= 40; seed++) {
      const prev: MonsterState = { ...initialMonsterState(), mode: 'idle', timerMs: 1000 }; // pause already over
      const { state, targetTile, repath } = stepMonster(prev, inputs, mulberry32(seed));
      expect(state.mode).toBe('wander');
      expect(repath).toBe(true);
      expect(targetTile).not.toBeNull();
      expect(Math.abs(targetTile!.col - inputs.monster.col)).toBeLessThanOrEqual(
        inputs.wanderRadiusTiles,
      );
      expect(Math.abs(targetTile!.row - inputs.monster.row)).toBeLessThanOrEqual(
        inputs.wanderRadiusTiles,
      );
      expect(targetTile).not.toEqual(inputs.monster);
    }
  });

  it('returns to idle on arrival at the wander goal', () => {
    const goal = { col: 7, row: 5 };
    const prev: MonsterState = { ...initialMonsterState(), mode: 'wander', goalTile: goal };
    const inputs = baseInputs({ monster: goal }); // monster tile == goal ⇒ arrived
    const { state, targetTile } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('idle');
    expect(targetTile).toBeNull();
    expect(state.timerMs).toBeGreaterThan(inputs.nowMs); // a fresh pause was scheduled
  });

  it('stays idle (retries) when no free tile is available', () => {
    const prev: MonsterState = { ...initialMonsterState(), mode: 'idle', timerMs: 0 };
    const inputs = baseInputs({ nowMs: 5000, isBlocked: () => true }); // everything blocked
    const { state, targetTile, repath } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('idle');
    expect(targetTile).toBeNull();
    expect(repath).toBe(false);
  });
});

describe('patrol', () => {
  const route = [
    { col: 1, row: 1 },
    { col: 2, row: 1 },
    { col: 3, row: 1 },
  ];

  it('starts patrolling the first waypoint once the idle pause elapses', () => {
    const prev: MonsterState = { ...initialMonsterState(route), mode: 'idle', timerMs: 0 };
    const inputs = baseInputs({ nowMs: 5000 });
    const { state, targetTile, repath } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('patrol');
    expect(state.patrolIndex).toBe(0);
    expect(targetTile).toEqual(route[0]);
    expect(repath).toBe(true);
  });

  it('advances waypoints with a pause at each, wrapping back to the start', () => {
    const rng = mulberry32(1);
    let state: MonsterState = {
      ...initialMonsterState(route),
      mode: 'patrol',
      patrolIndex: 0,
      goalTile: route[0],
    };
    const visited: number[] = [];

    // Walk the full loop: arrive → pause → advance, for one wrap plus one.
    for (let i = 0; i < route.length + 1; i++) {
      const idx = state.patrolIndex;
      visited.push(idx);
      const atWaypoint = route[idx];
      // Tick 1 — arrived at the waypoint: begin the pause, stand.
      let out = stepMonster(state, baseInputs({ nowMs: 1000, monster: atWaypoint }), rng);
      expect(out.targetTile).toBeNull();
      state = out.state;
      expect(state.timerMs).toBeGreaterThan(0);
      // Tick 2 — pause elapsed: advance to the next waypoint, repath.
      out = stepMonster(state, baseInputs({ nowMs: 1000 + 5000, monster: atWaypoint }), rng);
      expect(out.repath).toBe(true);
      state = out.state;
      expect(state.patrolIndex).toBe((idx + 1) % route.length);
      expect(state.goalTile).toEqual(route[(idx + 1) % route.length]);
    }
    // Visited indices in order, wrapping: 0,1,2,0
    expect(visited).toEqual([0, 1, 2, 0]);
  });
});

describe('determinism', () => {
  it('produces identical decisions for the same seed', () => {
    const capture = (seed: number) => {
      const rng = mulberry32(seed);
      const goals: Array<{ col: number; row: number } | null> = [];
      // Repeated idle→wander picks: each pass starts from a lapsed idle pause.
      for (let i = 0; i < 20; i++) {
        const prev: MonsterState = { ...initialMonsterState(), mode: 'idle', timerMs: 0 };
        const { targetTile } = stepMonster(prev, baseInputs({ nowMs: 5000 }), rng);
        goals.push(targetTile);
      }
      return goals;
    };
    expect(capture(42)).toEqual(capture(42));
  });
});
