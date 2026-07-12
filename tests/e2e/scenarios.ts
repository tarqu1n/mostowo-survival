import type { ScenarioSpec } from '../../src/scenes/GameScene';

/**
 * Named fixture builders for shared world shapes (plan 007). Each returns a declarative
 * {@link ScenarioSpec} fed to the SAME `__test.applyScenario` — never a hand-authored map. Keep
 * these to shapes ≥2 specs actually want; any test may spread-override a builder's result.
 *
 * Entities are placed ADJACENT (small = few entities close together, not a shrunk canvas) so there
 * is no multi-second walk to drive through — a chop/attack/build resolves in a few `step()` slices.
 */

/** Player at [3,3], one live tree one tile to the right — the minimal chop world. */
export function justATree(): ScenarioSpec {
  return { player: [3, 3], trees: [[5, 3]], wood: 0 };
}

/** Player at [3,3], two live trees to the east — for exercising harvest queueing (tap A, tap B). */
export function twoTrees(): ScenarioSpec {
  return { player: [3, 3], trees: [[5, 3], [8, 3]], wood: 0 };
}

/** Player at [3,3], one rock one tile to the right — the minimal mining world. */
export function justARock(): ScenarioSpec {
  return { player: [3, 3], rocks: [[5, 3]], inventory: {} };
}

/** Player at [10,10], one kid zombie two tiles east — closes distance fast, then contact-damages. */
export function oneZombie(): ScenarioSpec {
  return { player: [10, 10], zombies: [[12, 10]] };
}

/** Player at [3,3] with a built wall at [5,5] — a solid tile the pathfinder must route around. */
export function wallToRouteAround(): ScenarioSpec {
  return { player: [3, 3], walls: [[5, 5]] };
}
