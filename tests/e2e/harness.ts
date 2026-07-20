import type { Page } from '@playwright/test';
import type { Action } from '../../src/systems/tasks';
import type { ScenarioSpec, ScenarioResult } from '../../src/entities/testTypes';

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
  px: number;
  py: number;
  enemies: number;
  enemyModes: Array<'idle' | 'wander' | 'patrol' | 'chase'>;
  enemyTiles: Array<{ col: number; row: number }>;
  enemyWeapons: Array<string | null>;
  corpses: number;
  playerHp: number;
  playerDying: boolean;
  playerFlash: number;
  playerHitFlashes: number;
  enemyHitFlashes: number;
  enemyAttacks: number;
  mode: 'command' | 'combat' | 'inspect';
  hunger: number;
  dayPhase: 'day' | 'night';
  dayCount: number;
  clockMs: number;
  nightAlpha: number;
  outlinedTreeIds: string[];
  pulsingTreeId: string | null;
  queuedTreeIds: string[];
  campfires: Array<{ col: number; row: number; fuel: number; lit: boolean }>;
  enemyWindups: number;
  combatActive: boolean;
  bowTargetId: string | null;
  enemyHpBarsVisible: number;
}

/**
 * Tap the title screen to start the Game scene and wait for the DEV `__test` surface to install.
 * Assumes the page is already navigated to the app (see `startGame`, and `tests/e2e/global-setup.ts`
 * which reuses this to warm the dev server).
 *
 * Waits for MainMenu to be ACTIVE, not just for `game.isBooted`. Phaser flips isBooted almost
 * immediately — long before PreloadScene finishes loading assets and MainMenuScene's create()
 * registers its "tap to start" pointerdown listener. Tapping straight after isBooted races that gap:
 * under parallel-worker load the tap lands before MainMenu is listening, is dropped, and we then hang
 * the full 15s for a `__test` that never installs. This was the documented e2e "boot-timeout" flake
 * (see docs/WORKFLOW.md). The tap is retried while MainMenu is still active so a dropped tap (or a
 * cold Vite reload) self-heals; once the Game scene has taken over we stop tapping — no stray move
 * orders — and just wait out the install.
 */
export async function bootIntoGame(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).game?.scene?.isActive('MainMenu'), null, {
    timeout: 15_000,
  });
  // Tap the canvas centre via its bounding box — the FIT-scaled canvas is letterboxed within the
  // viewport, so viewport-centre may miss it.
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('game canvas not found');
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  let installed = false;
  for (let attempt = 0; attempt < 10 && !installed; attempt++) {
    const menuActive = await page.evaluate(() => (window as any).game?.scene?.isActive('MainMenu'));
    if (menuActive) await page.mouse.click(cx, cy);
    installed = await page
      .waitForFunction(() => (window as any).game?.__test != null, null, { timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
  }
  if (!installed)
    throw new Error('game.__test never installed — MainMenu tap did not start the Game scene');
}

/** Boot the game, start the world (menu → Game), and wait for the DEV test surface to install. */
export async function startGame(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await bootIntoGame(page);
  // Install a per-page event capture so specs can assert on GameScene→UIScene events.
  await page.evaluate(() => {
    const g = (window as any).game;
    g.__captured = {};
    for (const ev of [
      'inspect:show',
      'inspect:hide',
      'mode:changed',
      'zoom:changed',
      'camera:followChanged',
      'player:hit',
    ]) {
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

/** Relocate the enemy at `index` (sprite + logical tile) without a world reset. */
export function moveEnemy(page: Page, index: number, col: number, row: number): Promise<boolean> {
  return page.evaluate(
    ({ index, col, row }) => (window as any).game.__test.moveEnemy(index, col, row),
    { index, col, row },
  );
}

/** Equip the player's melee weapon by `MELEE_WEAPONS` id, or clear to unarmed with `null` (plan 036). */
export function setPlayerMelee(page: Page, id: string | null): Promise<void> {
  return page.evaluate((i) => (window as any).game.__test.setPlayerMelee(i), id);
}

/** Inspect the entity at a tile (same panel path as an Inspect-mode tap). */
export function inspect(page: Page, col: number, row: number): Promise<void> {
  return page.evaluate(([c, r]) => (window as any).game.__test.inspect(c, r), [col, row] as const);
}

/** True if a tile is currently a pathfinding obstacle. */
export function blocked(page: Page, col: number, row: number): Promise<boolean> {
  return page.evaluate(([c, r]) => (window as any).game.__test.blocked(c, r), [col, row] as const);
}

/** Select a buildable + attempt a real placement (runs tilePlaceable + the isInBase gate). */
export function tryPlace(page: Page, id: string, col: number, row: number): Promise<boolean> {
  return page.evaluate(([id, c, r]) => (window as any).game.__test.tryPlace(id, c, r), [
    id,
    col,
    row,
  ] as const);
}

/** True if the tile's centre is within any lit campfire's light radius. */
export function inLight(page: Page, col: number, row: number): Promise<boolean> {
  return page.evaluate(([c, r]) => (window as any).game.__test.inLight(c, r), [col, row] as const);
}

/** Run the real tap-to-feed path on the campfire at `index`; returns whether a feed happened. */
export function feedCampfire(page: Page, index: number): Promise<boolean> {
  return page.evaluate((i) => (window as any).game.__test.feedCampfire(i), index);
}

/** Drain the campfire at `index` by `amount` fuel (a mob attack on the fire-heart, plan 038) — knocks
 *  its light out without the wave AI; returns false if there's no campfire at that index. */
export function damageFire(page: Page, index: number, amount: number): Promise<boolean> {
  return page.evaluate(
    ({ index, amount }) => (window as any).game.__test.damageFire(index, amount),
    { index, amount },
  );
}

/** The live campfires (col/row/fuel/lit), spec order — a shortcut over `state(page).campfires`. */
export function campfires(page: Page): Promise<DebugState['campfires']> {
  return page.evaluate(() => (window as any).game.__test.state().campfires);
}

/** Emit a game event (drives the HUD-wired paths: mode toggles, zoom, attack, follow). */
export function emit(page: Page, event: string, ...args: unknown[]): Promise<void> {
  return page.evaluate(({ event, args }) => (window as any).game.events.emit(event, ...args), {
    event,
    args,
  });
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
  return page.evaluate(() =>
    (window as any).game.scene.getScene('Game').registry.get('inventory').get('wood'),
  );
}

/** Current amount of item `id` held (reads the shared Inventory in the registry). */
export function held(page: Page, id: string): Promise<number> {
  return page.evaluate(
    (i) => (window as any).game.scene.getScene('Game').registry.get('inventory').get(i),
    id,
  );
}

/** Map a world tile (col,row) to a client (screen) pixel through the live camera zoom/scroll, for
 * real-pointer gesture specs. Mirrors scripts/smoke.mjs's worldToClient (camera worldView + the
 * Scale.FIT canvas scale from the backing-store width, i.e. BASE_WIDTH × RENDER_SCALE). */
export function tileToClient(
  page: Page,
  col: number,
  row: number,
): Promise<{ x: number; y: number }> {
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
