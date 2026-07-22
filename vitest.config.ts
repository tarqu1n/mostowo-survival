import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tier-1 unit tests (plan 007). Goal: EVERY unit test runs in plain Node — the pure systems
// (pathfind/tasks/combat/grid/stats) import no Phaser, and Inventory is kept Node-testable by
// importing eventemitter3 directly (see src/systems/Inventory.ts) rather than the full `phaser`
// package (whose canvas feature-detection would force jsdom + a canvas mock). Reuses Vite's
// resolution/tsconfig. `passWithNoTests` so `vitest run` exits 0 before any test file exists.
export default defineConfig({
  resolve: {
    // `@/*` → `src/*`. Must stay in sync with vite.config.ts and tsconfig.json.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts', 'scripts/**/*.test.mjs'],
    // Overhead trim (plan 044): default `forks` + `isolate:true` spins one child process per file and
    // re-transforms the module graph in each — most of the wall time is that overhead, not the ~0.9s of
    // actual test execution. All unit tests are pure Node with no cross-file side effects (systems are
    // pure; the editor Zustand store specs already `beforeEach`-reset their module state), so a shared
    // worker thread with isolation off is safe and much cheaper. If a future spec needs a fresh module
    // graph, re-enable isolation narrowly via a `test.projects` entry rather than flipping this globally.
    pool: 'threads',
    isolate: false,
  },
});
