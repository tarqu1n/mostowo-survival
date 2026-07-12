import { defineConfig } from 'vitest/config';

// Tier-1 unit tests (plan 007). Goal: EVERY unit test runs in plain Node — the pure systems
// (pathfind/tasks/combat/grid/stats) import no Phaser, and Inventory is kept Node-testable by
// importing eventemitter3 directly (see src/systems/Inventory.ts) rather than the full `phaser`
// package (whose canvas feature-detection would force jsdom + a canvas mock). Reuses Vite's
// resolution/tsconfig. `passWithNoTests` so `vitest run` exits 0 before any test file exists.
export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
  },
});
