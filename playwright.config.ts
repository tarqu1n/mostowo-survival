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
const PORT = 5174;
const chromiumPath = process.env.SMOKE_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
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
