import { describe, it, expect } from 'vitest';
import {
  stepMonster,
  chaseVeerMaxTiles,
  initialMonsterState,
  type MonsterInputs,
  type MonsterState,
  type Threat,
  type ThreatKind,
  type Vec2,
} from '../monsterAI';
import type { CombatantStats } from '../../data/types';

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

/** A throwaway combatant stat bag — the FSM never reads a threat's `stats`/`bodyTiles` (only the caller
 *  does), so the exact values are irrelevant to these decision tests. */
const THREAT_STATS: CombatantStats = {
  maxHp: 10,
  armour: 0,
  speed: 60,
  vision: 80,
  strength: 1,
  dex: 0,
  dodge: 0,
};

/** Build a threat of a given kind at a world pos + tile (plan 042 Step 6). */
function threat(kind: ThreatKind, pos: Vec2, tile: { col: number; row: number }): Threat {
  return { kind, pos, tile, bodyTiles: [tile], stats: THREAT_STATS };
}
const playerThreat = (pos: Vec2, tile: { col: number; row: number }): Threat =>
  threat('player', pos, tile);
const npcThreat = (pos: Vec2, tile: { col: number; row: number }): Threat =>
  threat('npc', pos, tile);

/**
 * A tuning/world snapshot with a single threat — the player — parked far away (no acquire) unless
 * overridden. `playerPos`/`playerTile` are test-only conveniences that build that lone player threat
 * (so the pre-existing single-target cases read unchanged); pass `threats` directly for a multi-threat
 * (player + NPC) case.
 */
function baseInputs(
  over: Partial<MonsterInputs> & {
    playerPos?: Vec2;
    playerTile?: { col: number; row: number };
  } = {},
): MonsterInputs {
  const { playerPos, playerTile, threats, ...rest } = over;
  return {
    nowMs: 1000,
    monster: { col: 5, row: 5 },
    monsterPos: { x: 0, y: 0 },
    threats: threats ?? [
      playerThreat(playerPos ?? { x: 9999, y: 0 }, playerTile ?? { col: 40, row: 5 }),
    ],
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
    ...rest,
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
    const playerTile = { col: 30, row: 30 };
    const inputs = baseInputs({
      nowMs: 1000,
      monsterPos: { x: 0, y: 0 },
      playerPos: { x: DROP, y: 0 },
      playerTile,
    });
    for (let seed = 1; seed <= 50; seed++) {
      const { state, targetTile, repath } = stepMonster(prev, inputs, mulberry32(seed));
      expect(state.mode).toBe('chase');
      expect(repath).toBe(true); // cadence elapsed → repath
      expect(targetTile).not.toBeNull();
      expect(Math.abs(targetTile!.col - playerTile.col)).toBeLessThanOrEqual(VEER_MAX);
      expect(Math.abs(targetTile!.row - playerTile.row)).toBeLessThanOrEqual(VEER_MAX);
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

describe('seek (fire objective — plan 038 Step 4)', () => {
  const FIRE = { col: 20, row: 20 };

  it('a fire-seeker with a lit hearth and no player near seeks the fire', () => {
    // Mid-idle-pause so the calm branch would otherwise stand — proves seek preempts calm, not just
    // that a lapsed idle happened to move.
    const prev: MonsterState = { ...initialMonsterState(), mode: 'idle', timerMs: 9999 };
    const { state, targetTile, repath } = stepMonster(
      prev,
      baseInputs({ seeksFire: true, fireTile: FIRE }),
      mulberry32(1),
    );
    expect(state.mode).toBe('seek');
    expect(targetTile).toEqual(FIRE);
    expect(repath).toBe(true); // first entry → path to the fire
  });

  it('player-acquire preempts the fire objective (fights the player, the roaming-pull)', () => {
    const prev: MonsterState = { ...initialMonsterState(), mode: 'seek', goalTile: FIRE };
    const { state } = stepMonster(
      prev,
      baseInputs({ seeksFire: true, fireTile: FIRE, playerPos: { x: 40, y: 0 } }), // within acquire (80)
      mulberry32(1),
    );
    expect(state.mode).toBe('chase');
  });

  it('re-seeks without a redundant repath once already walking to the fire', () => {
    const prev: MonsterState = { ...initialMonsterState(), mode: 'seek', goalTile: FIRE };
    const { state, targetTile, repath } = stepMonster(
      prev,
      baseInputs({ seeksFire: true, fireTile: FIRE }),
      mulberry32(1),
    );
    expect(state.mode).toBe('seek');
    expect(targetTile).toEqual(FIRE);
    expect(repath).toBe(false); // goal unchanged → keep the existing path
  });

  it('falls back to a calm beat when the fire goes dark (no lit hearth)', () => {
    // Was seeking; the hearth is knocked out (fireTile null) → drop to idle, stand, re-evaluate.
    const prev: MonsterState = { ...initialMonsterState(), mode: 'seek', goalTile: FIRE };
    const { state, targetTile } = stepMonster(
      prev,
      baseInputs({ seeksFire: true, fireTile: null }),
      mulberry32(1),
    );
    expect(state.mode).toBe('idle');
    expect(targetTile).toBeNull();
  });

  it('a non-seeker ignores the fire entirely (classic behaviour)', () => {
    const prev: MonsterState = { ...initialMonsterState(), mode: 'idle', timerMs: 9999 };
    const { state } = stepMonster(
      prev,
      baseInputs({ seeksFire: false, fireTile: FIRE }),
      mulberry32(1),
    );
    expect(state.mode).toBe('idle'); // stands its idle pause — never seeks
  });
});

describe('siege (walled-off objective — plan 037 chunk 2c)', () => {
  const WALL = { col: 6, row: 5 };

  it('a walled-off mob sieges the blocking wall — preempting even player-acquire', () => {
    // Player well inside acquire radius (would normally chase), but the caller found no route and fed a
    // siegeTarget: siege must win, since chasing would just fail to path each tick.
    const prev: MonsterState = {
      ...initialMonsterState(),
      mode: 'chase',
      lastChaseRepathMs: -1000,
    };
    const { state, targetTile, repath } = stepMonster(
      prev,
      baseInputs({ playerPos: { x: 40, y: 0 }, siegeTarget: WALL }), // dist 40 < acquire 80
      mulberry32(1),
    );
    expect(state.mode).toBe('siege');
    expect(targetTile).toEqual(WALL);
    expect(repath).toBe(true); // first entry → path adjacent to the wall
  });

  it('re-sieges the same wall without a redundant repath', () => {
    const prev: MonsterState = { ...initialMonsterState(), mode: 'siege', goalTile: WALL };
    const { state, targetTile, repath } = stepMonster(
      prev,
      baseInputs({ siegeTarget: WALL }),
      mulberry32(1),
    );
    expect(state.mode).toBe('siege');
    expect(targetTile).toEqual(WALL);
    expect(repath).toBe(false); // goal wall unchanged → keep the existing path
  });

  it('drops straight back to chase once the wall breaks (siegeTarget cleared)', () => {
    // The caller clears siegeTarget when the wall falls; with the player still in radius, acquire fires.
    const prev: MonsterState = { ...initialMonsterState(), mode: 'siege', goalTile: WALL };
    const { state } = stepMonster(
      prev,
      baseInputs({ playerPos: { x: 40, y: 0 }, siegeTarget: null }),
      mulberry32(1),
    );
    expect(state.mode).toBe('chase');
  });
});

describe('threat targeting — player + NPC (plan 042 Step 6)', () => {
  it('REGRESSION: with only the player present, acquire is unchanged (single-target behaviour)', () => {
    // The classic path: one threat (the player) at the radius edge → acquire, sticking to the player.
    const prev = initialMonsterState();
    const inputs = baseInputs({ threats: [playerThreat({ x: 80, y: 0 }, { col: 6, row: 5 })] });
    const { state, targetTile } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('chase');
    expect(state.chaseKind).toBe('player');
    expect(targetTile).toEqual({ col: 6, row: 5 }); // inside the veer band inner → exact tile
  });

  it('acquires the NEAREST eligible threat — an NPC closer than the player wins', () => {
    // Mid-idle-pause so the calm branch would otherwise stand — proves the acquire, not a lapsed idle.
    const prev: MonsterState = { ...initialMonsterState(), mode: 'idle', timerMs: 9999 };
    const inputs = baseInputs({
      threats: [
        playerThreat({ x: 9999, y: 0 }, { col: 40, row: 5 }), // far
        npcThreat({ x: 50, y: 0 }, { col: 6, row: 5 }), // within acquire (80), and the nearest
      ],
    });
    const { state, targetTile } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('chase');
    expect(state.chaseKind).toBe('npc'); // aggro stuck to the nearer NPC
    expect(targetTile).toEqual({ col: 6, row: 5 });
  });

  it('acquires the player when the player is the nearer of the two threats', () => {
    const prev: MonsterState = { ...initialMonsterState(), mode: 'idle', timerMs: 9999 };
    const inputs = baseInputs({
      threats: [
        playerThreat({ x: 30, y: 0 }, { col: 8, row: 5 }), // nearer
        npcThreat({ x: 60, y: 0 }, { col: 11, row: 5 }),
      ],
    });
    const { state } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('chase');
    expect(state.chaseKind).toBe('player');
  });

  it('a downed/absent NPC is not in the threat list, so it is never acquired', () => {
    // The caller omits a downed NPC — even one that WOULD be adjacent — leaving only the far player, so
    // the mob acquires nobody (mobs never pile on a downed companion).
    const prev: MonsterState = { ...initialMonsterState(), mode: 'idle', timerMs: 9999 };
    const inputs = baseInputs({ threats: [playerThreat({ x: 9999, y: 0 }, { col: 40, row: 5 })] });
    const { state } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('idle'); // no eligible threat within radius
  });

  it('a nearer threat still preempts fire-seek exactly as the player did (NPC in radius)', () => {
    const FIRE = { col: 20, row: 20 };
    const prev: MonsterState = { ...initialMonsterState(), mode: 'seek', goalTile: FIRE };
    const inputs = baseInputs({
      seeksFire: true,
      fireTile: FIRE,
      threats: [
        playerThreat({ x: 9999, y: 0 }, { col: 40, row: 5 }), // far
        npcThreat({ x: 40, y: 0 }, { col: 6, row: 5 }), // within acquire (80)
      ],
    });
    const { state } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('chase'); // seek preempted by the threat, as with the player
    expect(state.chaseKind).toBe('npc');
  });

  it('chase sticks to the acquired threat (chaseKind) even when the other threat is now nearer', () => {
    // Locked onto the NPC; the player is closer this tick but stickiness keeps it tracking the NPC.
    const prev: MonsterState = {
      ...initialMonsterState(),
      mode: 'chase',
      chaseKind: 'npc',
      lastChaseRepathMs: -1000,
    };
    const inputs = baseInputs({
      monsterPos: { x: 0, y: 0 },
      threats: [
        playerThreat({ x: 20, y: 0 }, { col: 2, row: 5 }), // nearer, but NOT what aggro stuck to
        npcThreat({ x: 150, y: 0 }, { col: 18, row: 5 }), // within drop radius (200)
      ],
    });
    const { state, targetTile } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('chase');
    expect(state.chaseKind).toBe('npc');
    // Tracks the NPC's tile (perturbed within the veer band at dist 150), not the nearer player's.
    expect(Math.abs(targetTile!.col - 18)).toBeLessThanOrEqual(VEER_MAX);
    expect(Math.abs(targetTile!.row - 5)).toBeLessThanOrEqual(VEER_MAX);
  });

  it('de-aggros from the acquired NPC once it passes the drop radius (player far → no re-acquire)', () => {
    const prev: MonsterState = {
      ...initialMonsterState(),
      mode: 'chase',
      chaseKind: 'npc',
      lastChaseRepathMs: 0,
    };
    const inputs = baseInputs({
      monsterPos: { x: 0, y: 0 },
      threats: [
        playerThreat({ x: 9999, y: 0 }, { col: 40, row: 5 }),
        npcThreat({ x: DROP + 1, y: 0 }, { col: 20, row: 5 }), // just past the drop radius
      ],
    });
    const { state, repath } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('idle');
    expect(repath).toBe(false);
  });

  it('a forced `chase` spawn with no chaseKind falls back to the player (regression for scenario mobs)', () => {
    // A scenario/dev spawn can start already `chase` without ever running acquire → no chaseKind. It must
    // still chase the player (always present), not stall — the old single-target fallback.
    const prev: MonsterState = {
      ...initialMonsterState(),
      mode: 'chase',
      lastChaseRepathMs: -1000,
    };
    const inputs = baseInputs({
      monsterPos: { x: 0, y: 0 },
      threats: [playerThreat({ x: 150, y: 0 }, { col: 18, row: 5 })],
    });
    const { state, targetTile } = stepMonster(prev, inputs, mulberry32(1));
    expect(state.mode).toBe('chase');
    expect(state.chaseKind).toBe('player'); // re-synced to the fallback target
    expect(targetTile).not.toBeNull();
  });
});
