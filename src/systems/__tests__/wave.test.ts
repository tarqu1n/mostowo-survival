import { describe, it, expect } from 'vitest';
import {
  intervalForNightProgress,
  escalationForNight,
  spawnKindForIndex,
  type WaveBeat,
} from '../wave';
import {
  CAMPFIRE_FUEL_MAX,
  CONTACT_DAMAGE_COOLDOWN_MS,
  WAVE_FIRE_ATTACK_DAMAGE,
  NIGHT_MS,
} from '../../config';

const BEATS: WaveBeat[] = [
  { untilNorm: 0.25, intervalMs: 20_000 }, // trickle
  { untilNorm: 0.7, intervalMs: 14_000 }, // push
  { untilNorm: 1.0, intervalMs: 26_000 }, // lull
];

describe('intervalForNightProgress', () => {
  it('reads the beat the progress falls in (trickle → push → lull)', () => {
    expect(intervalForNightProgress(0, BEATS)).toBe(20_000); // start of night → trickle
    expect(intervalForNightProgress(0.2, BEATS)).toBe(20_000); // still trickle
    expect(intervalForNightProgress(0.5, BEATS)).toBe(14_000); // push
    expect(intervalForNightProgress(0.9, BEATS)).toBe(26_000); // lull
  });

  it('clamps out-of-range progress and covers the final threshold', () => {
    expect(intervalForNightProgress(-1, BEATS)).toBe(20_000); // clamped to 0
    expect(intervalForNightProgress(1, BEATS)).toBe(26_000); // == last threshold → last beat
    expect(intervalForNightProgress(5, BEATS)).toBe(26_000); // clamped to 1
  });

  it('scales every interval by intervalScale (denser later nights)', () => {
    expect(intervalForNightProgress(0.5, BEATS, 0.5)).toBe(7_000); // 14000 * 0.5
  });
});

describe('escalationForNight', () => {
  it('night 1 is the gentle baseline — one opener, full-length pacing, no boars', () => {
    const e = escalationForNight(1);
    expect(e.openingBurst).toBe(1);
    expect(e.intervalScale).toBe(1);
    expect(e.boarEvery).toBe(0);
  });

  it('ramps each survived night — bigger opener, denser pacing, boars from night 2', () => {
    const n1 = escalationForNight(1);
    const n2 = escalationForNight(2);
    const n3 = escalationForNight(3);
    expect(n2.openingBurst).toBeGreaterThan(n1.openingBurst);
    expect(n2.intervalScale).toBeLessThan(n1.intervalScale);
    expect(n1.boarEvery).toBe(0); // no boars on the first night
    expect(n2.boarEvery).toBeGreaterThan(0); // boars appear from night 2
    expect(n3.boarEvery).toBeLessThanOrEqual(n2.boarEvery); // …and tighten (more boars) later
  });

  it('clamps so a long run cannot runaway into an unwinnable wall', () => {
    const deep = escalationForNight(99);
    expect(deep.openingBurst).toBeLessThanOrEqual(5);
    expect(deep.intervalScale).toBeGreaterThanOrEqual(0.5);
    expect(deep.boarEvery).toBeGreaterThanOrEqual(3);
  });

  it('treats day 0 / negatives as night 1 (defensive floor)', () => {
    expect(escalationForNight(0)).toEqual(escalationForNight(1));
    expect(escalationForNight(-5)).toEqual(escalationForNight(1));
  });
});

describe('fire-attack tuning anchor (plan 038 Step 5)', () => {
  // A lone seeking mob (striking on the contact cadence) should threaten the fire but not instantly
  // douse it: knock a full fire out in a tense-but-reactable window — more than a blink, less than a
  // night. Deterministic guard on WAVE_FIRE_ATTACK_DAMAGE vs fuel vs cadence (not a "feels right").
  it('a lone mob douses a full fire in >15s and well within a night', () => {
    const strikesToDouse = CAMPFIRE_FUEL_MAX / WAVE_FIRE_ATTACK_DAMAGE;
    const secondsToDouse = strikesToDouse * (CONTACT_DAMAGE_COOLDOWN_MS / 1000);
    expect(secondsToDouse).toBeGreaterThan(15); // not a blink — the player can react
    expect(secondsToDouse).toBeLessThan(NIGHT_MS / 1000); // but a real threat within one night
  });
});

describe('spawnKindForIndex', () => {
  it('is all skeletons when boarEvery is 0', () => {
    expect([0, 1, 2, 5, 10].map((i) => spawnKindForIndex(i, 0))).toEqual([
      'kidZombie',
      'kidZombie',
      'kidZombie',
      'kidZombie',
      'kidZombie',
    ]);
  });

  it('drops a boar on every Nth spawn (1-based) and skeletons otherwise', () => {
    // boarEvery 3 → the 3rd, 6th, 9th spawn (0-based indices 2, 5, 8) are boars.
    expect(spawnKindForIndex(0, 3)).toBe('kidZombie');
    expect(spawnKindForIndex(1, 3)).toBe('kidZombie');
    expect(spawnKindForIndex(2, 3)).toBe('boar');
    expect(spawnKindForIndex(5, 3)).toBe('boar');
    expect(spawnKindForIndex(8, 3)).toBe('boar');
  });
});
