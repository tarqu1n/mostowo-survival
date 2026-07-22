import { defineConfig, devices } from '@playwright/test';

/**
 * Tier-2 deterministic scenario tests (plan 007). Each spec builds a known world via the DEV-only
 * `window.game.__test.applyScenario(...)` seam and drives time with `__test.step(ms)` — no
 * `waitForTimeout`-based gameplay, so `retries: 0` (flakes must surface, not hide).
 *
 * webServer is `vite dev`, NOT `vite preview`: the __test API is gated on `import.meta.env.DEV`, so
 * it exists only under the dev server (DEV === true). Vite's dev `base` is '/' (production would be
 * '/mostowo-survival/'), so the baseURL is the dev root. The container ships a pre-installed
 * Chromium; honour SMOKE_CHROMIUM_PATH (same env the boot canary uses) for its executable.
 */
// Overridable via E2E_PORT so a git worktree can run its e2e on its own dev server, in parallel with
// another checkout's server (the default 5174), instead of Playwright reusing whichever server is
// already on the port and testing the wrong code. Defaults to 5174 for normal single-checkout runs.
const PORT = Number(process.env.E2E_PORT) || 5174;
const chromiumPath = process.env.SMOKE_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  // Warm the dev server once before workers fan out — a cold `.vite/deps` cache under parallel cold
  // boots triggers a full page reload that was a source of the "boot-timeout" flake. See the setup
  // file and docs/WORKFLOW.md.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  // Half the vCPUs (plan 044 Step 5). These specs drive real rendered frames on headless SwiftShader,
  // which is fill-rate-bound: past ~half the cores the workers contend for the GPU and the suite gets
  // slower AND flakier, not faster. Benchmarked at 50% (= 2 workers on the 4-vCPU dev box): 106 tests,
  // green on two consecutive cold runs at ~9.3 min. Portable across bigger CI runners; CI shards also
  // pin `--workers=2` per shard. (Phase 2's render-free stepLogic is what will actually cut the wall.)
  workers: '50%',
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    ...devices['Desktop Chrome'],
    viewport: { width: 480, height: 800 }, // portrait, matching the game's 360×640 base aspect
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
