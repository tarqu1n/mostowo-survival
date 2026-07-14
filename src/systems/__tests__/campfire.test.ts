import { describe, it, expect } from 'vitest';
import { drainFuel, feedFuel, isLit, fuelFrac } from '../campfire';
import {
  CAMPFIRE_FUEL_MAX,
  CAMPFIRE_FUEL_BURN_PER_SEC,
  CAMPFIRE_FUEL_PER_WOOD,
  CAMPFIRE_LIGHT_MIN_FRAC,
} from '../../config';

describe('drainFuel', () => {
  it('subtracts burnPerSec * seconds elapsed', () => {
    expect(drainFuel(10, 1000, 1)).toBe(9);
    expect(drainFuel(CAMPFIRE_FUEL_MAX, 1000, CAMPFIRE_FUEL_BURN_PER_SEC)).toBe(
      CAMPFIRE_FUEL_MAX - CAMPFIRE_FUEL_BURN_PER_SEC,
    );
  });

  it('clamps at 0 rather than going negative', () => {
    expect(drainFuel(1, 5000, 1)).toBe(0);
    expect(drainFuel(0, 1000, 1)).toBe(0);
  });
});

describe('feedFuel', () => {
  it('adds perWood to the current fuel', () => {
    expect(feedFuel(0, CAMPFIRE_FUEL_PER_WOOD, CAMPFIRE_FUEL_MAX)).toBe(CAMPFIRE_FUEL_PER_WOOD);
  });

  it('clamps at max', () => {
    expect(feedFuel(CAMPFIRE_FUEL_MAX - 5, CAMPFIRE_FUEL_PER_WOOD, CAMPFIRE_FUEL_MAX)).toBe(
      CAMPFIRE_FUEL_MAX,
    );
  });
});

describe('isLit', () => {
  it('is true whenever fuel is greater than 0', () => {
    expect(isLit(1)).toBe(true);
    expect(isLit(0.1)).toBe(true);
  });

  it('is false at exactly 0 (and below)', () => {
    expect(isLit(0)).toBe(false);
    expect(isLit(-1)).toBe(false);
  });
});

describe('fuelFrac', () => {
  it('is 1 at a full tank and the floor at empty (drives both flame scale and light radius)', () => {
    expect(fuelFrac(CAMPFIRE_FUEL_MAX, CAMPFIRE_FUEL_MAX, CAMPFIRE_LIGHT_MIN_FRAC)).toBe(1);
    expect(fuelFrac(0, CAMPFIRE_FUEL_MAX, CAMPFIRE_LIGHT_MIN_FRAC)).toBe(CAMPFIRE_LIGHT_MIN_FRAC);
  });

  it('lerps between the floor and 1 with fuel (half tank = midpoint)', () => {
    expect(fuelFrac(CAMPFIRE_FUEL_MAX / 2, CAMPFIRE_FUEL_MAX, 0.4)).toBeCloseTo(0.7);
  });

  it('rises monotonically with fuel', () => {
    expect(fuelFrac(30, CAMPFIRE_FUEL_MAX, 0.4)).toBeLessThan(fuelFrac(90, CAMPFIRE_FUEL_MAX, 0.4));
  });

  it('never drops below the floor even past empty', () => {
    expect(fuelFrac(-10, CAMPFIRE_FUEL_MAX, 0.4)).toBe(0.4);
  });
});
