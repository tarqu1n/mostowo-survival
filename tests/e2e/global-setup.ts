import { chromium, type FullConfig } from '@playwright/test';
import { bootIntoGame } from './harness';

/**
 * Warm the Vite dev server ONCE before the parallel workers fan out.
 *
 * With a cold `.vite/deps` cache (fresh checkout / CI), Vite's optimizer re-bundles *after* clients
 * connect and fires a full page reload ("[vite] page reload …"); the first transform of the whole
 * Phaser module graph is also expensive. When N workers cold-boot simultaneously those costs collide
 * and were a source of the "boot-timeout" flake (a mid-spec reload wipes a page and no per-test retry
 * can catch it). Booting the game once here forces dep-optimization + the module-graph transform to
 * settle serially, so every worker afterwards hits a fully warm server: no reload, no cold-transform
 * pile-up, at any worker count. One ~2s boot up front — cheap insurance. Runs after Playwright's
 * `webServer` is confirmed up. See docs/WORKFLOW.md.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const { baseURL, launchOptions } = config.projects[0].use;
  if (!baseURL) throw new Error('global-setup: no baseURL configured');
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.goto(baseURL, { waitUntil: 'load' });
    await bootIntoGame(page);
  } finally {
    await browser.close();
  }
}
