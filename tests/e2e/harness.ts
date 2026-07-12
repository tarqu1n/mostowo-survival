import type { Page } from '@playwright/test';
import type { Action } from '../../src/systems/tasks';
import type { ScenarioSpec, ScenarioResult } from '../../src/scenes/GameScene';

// Thin Playwright-side wrappers over the DEV-only `window.game.__test` seam (plan 007). All the
// game-facing work happens inside `page.evaluate` (page context); these just marshal args/results.
// Imports here are `type`-only, so esbuild erases them — no Phaser is ever loaded in Node.

/** The shape GameScene.debugState() returns (mirrored so specs get autocomplete without importing Phaser). */
export interface DebugState {
  currentKind: string | null;
  pending: number;
  pathLen: number;
  sites: number;
  buildMode: boolean;
  occupied: number;
  pcol: number;
  prow: number;
  zombies: number;
  corpses: number;
  playerHp: number;
  playerDying: boolean;
  playerFlash: number;
  playerHitFlashes: number;
  zombieHitFlashes: number;
  zombieAttacks: number;
  mode: 'command' | 'combat' | 'inspect';
  hunger: number;
  dayPhase: 'day' | 'night';
  dayCount: number;
  clockMs: number;
  nightAlpha: number;
  outlinedTreeIds: string[];
  pulsingTreeId: string | null;
  queuedTreeIds: string[];
}

/** Boot the game, start the world (menu → Game), and wait for the DEV test surface to install. */
export async function startGame(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).game?.isBooted, null, { timeout: 15_000 });
  // MainMenu starts the Game scene on any pointerdown; click the canvas centre (via its bounding
  // box — the FIT-scaled canvas is letterboxed within the viewport, so viewport-centre may miss it).
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('game canvas not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => (window as any).game?.__test != null, null, { timeout: 15_000 });
  // Install a per-page event capture so specs can assert on GameScene→UIScene events.
  await page.evaluate(() => {
    const g = (window as any).game;
    g.__captured = {};
    for (const ev of ['inspect:show', 'inspect:hide', 'mode:changed', 'zoom:changed', 'camera:followChanged']) {
      g.events.on(ev, (payload: unknown) => {
        g.__captured[ev] = payload ?? true;
      });
    }
  });
}

/** Build a known world; returns the ids of the entities placed (spec order). */
export function applyScenario(page: Page, spec: ScenarioSpec): Promise<ScenarioResult> {
  return page.evaluate((s) => (window as any).game.__test.applyScenario(s), spec);
}

/** Advance gameplay deterministically by `ms` (fixed 1/60s slices, no wall-clock). */
export function step(page: Page, ms: number): Promise<void> {
  return page.evaluate((m) => (window as any).game.__test.step(m), ms);
}

/** Read the live debug snapshot. */
export function state(page: Page): Promise<DebugState> {
  return page.evaluate(() => (window as any).game.__test.state());
}

/** Issue an act-now order (replaces the queue). */
export function order(page: Page, action: Action): Promise<void> {
  return page.evaluate((a) => (window as any).game.__test.order(a), action);
}

/** Append an order to the queue. */
export function enqueue(page: Page, action: Action): Promise<void> {
  return page.evaluate((a) => (window as any).game.__test.enqueue(a), action);
}

/** Inspect the entity at a tile (same panel path as an Inspect-mode tap). */
export function inspect(page: Page, col: number, row: number): Promise<void> {
  return page.evaluate(([c, r]) => (window as any).game.__test.inspect(c, r), [col, row] as const);
}

/** True if a tile is currently a pathfinding obstacle. */
export function blocked(page: Page, col: number, row: number): Promise<boolean> {
  return page.evaluate(([c, r]) => (window as any).game.__test.blocked(c, r), [col, row] as const);
}

/** Emit a game event (drives the HUD-wired paths: mode toggles, zoom, punch, follow). */
export function emit(page: Page, event: string, ...args: unknown[]): Promise<void> {
  return page.evaluate(({ event, args }) => (window as any).game.events.emit(event, ...args), { event, args });
}

/** Read the last-captured payload for an event (see startGame's capture install). */
export function captured(page: Page, event: string): Promise<unknown> {
  return page.evaluate((e) => (window as any).game.__captured?.[e] ?? null, event);
}

/** Read the live camera zoom. */
export function cameraZoom(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).game.scene.getScene('Game').cameras.main.zoom);
}

/** True if the game is running the WebGL renderer (the outline PostFX only attaches under WebGL;
 * Canvas falls back to a marker rect — see GameScene.refreshQueueHighlights). */
export function isWebGL(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as any).game.renderer.type === 2); // 2 === Phaser.WEBGL
}

/** Current wood held (reads the shared Inventory in the registry). */
export function wood(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).game.scene.getScene('Game').registry.get('inventory').get('wood'));
}

/** Current amount of item `id` held (reads the shared Inventory in the registry). */
export function held(page: Page, id: string): Promise<number> {
  return page.evaluate((i) => (window as any).game.scene.getScene('Game').registry.get('inventory').get(i), id);
}

/** Map a world tile (col,row) to a client (screen) pixel through the live camera zoom/scroll, for
 * real-pointer gesture specs. Mirrors scripts/smoke.mjs's worldToClient (camera worldView + the
 * Scale.FIT canvas scale from the backing-store width, i.e. BASE_WIDTH × RENDER_SCALE). */
export function tileToClient(page: Page, col: number, row: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([col, row]) => {
      const TILE = 16;
      const wx = col * TILE + TILE / 2;
      const wy = row * TILE + TILE / 2;
      const cam = (window as any).game.scene.getScene('Game').cameras.main;
      const wv = cam.worldView;
      const baseX = ((wx - wv.x) / wv.width) * cam.width;
      const baseY = ((wy - wv.y) / wv.height) * cam.height;
      const rect = document.querySelector('canvas')!.getBoundingClientRect();
      // baseX/baseY are in backing-store px (cam.width = BASE_WIDTH × RENDER_SCALE); map to CSS px.
      const s = rect.width / cam.width;
      return { x: rect.left + baseX * s, y: rect.top + baseY * s };
    },
    [col, row] as const,
  );
}
