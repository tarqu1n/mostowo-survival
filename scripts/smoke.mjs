// Headless smoke test for the core-loop slice. Drives the real game in Chromium and asserts the
// chop→wood→build→wall loop plus the Finding-1 input arbitration. Run against `npm run preview`.
//   node scripts/smoke.mjs
// Resolve Playwright from local deps if present, else the global install (this is a dev-only tool).
import { execSync } from 'node:child_process';
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return import(`file://${root}/playwright/index.js`);
  }
}
const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium;

const URL = process.env.SMOKE_URL ?? 'http://localhost:4173/Mostowa-survival/';
const OUT = 'scripts/.smoke';
const fail = (m) => {
  console.error('FAIL:', m);
  process.exitCode = 1;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 800 } });

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.game?.isBooted, null, { timeout: 10000 });

// Map a base-resolution (360x640) point to a real client click position on the scaled canvas.
async function tapBase(bx, by) {
  const pt = await page.evaluate(
    ([bx, by]) => {
      const c = document.querySelector('canvas');
      const r = c.getBoundingClientRect();
      const s = r.width / 360; // Scale.FIT preserves aspect, so scaleX === scaleY
      return { x: r.left + bx * s, y: r.top + by * s };
    },
    [bx, by],
  );
  await page.mouse.click(pt.x, pt.y);
}

const scene = (key) => page.evaluate((k) => !!window.game.scene.getScene(k)?.scene.isActive(), key);
const wood = () => page.evaluate(() => window.game.registry.get('inventory')?.get('wood') ?? 0);
const state = () =>
  page.evaluate(() => {
    const g = window.game.scene.getScene('Game');
    return { buildMode: g.buildMode, walls: g.occupied.size, px: g.player.x, py: g.player.y };
  });

// 1. Pass the main menu (tap anywhere) and wait for the world + HUD.
await tapBase(180, 400);
await page.waitForFunction(() => window.game.scene.getScene('Game')?.scene.isActive(), null, { timeout: 5000 });
await page.waitForFunction(() => window.game.scene.getScene('UI')?.scene.isActive(), null, { timeout: 5000 });
if (!(await scene('Game'))) fail('Game scene not active after menu tap');

await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}-1-start.png` });
const startWood = await wood();

// 2. Chop the tree at tile (5,8): walk over + 3 hits → wood should reach 3, then stump.
await tapBase(5 * 16 + 8, 8 * 16 + 8);
await page.waitForTimeout(5000);
const afterChop = await wood();
if (afterChop < 3) fail(`chop did not yield wood: started ${startWood}, got ${afterChop} (expected >= 3)`);
else console.log(`ok: chop → wood ${startWood} → ${afterChop}`);
await page.screenshot({ path: `${OUT}-2-chopped.png` });

// 3. Finding-1: tapping the Build button toggles build mode WITHOUT moving/placing underneath.
await page.waitForTimeout(500); // let any residual movement settle before snapshotting
const before = await state();
await tapBase(314, 21); // Build button centre
await page.waitForTimeout(200);
const afterBuildTap = await state();
if (!afterBuildTap.buildMode) fail('Build button did not enable build mode');
else console.log('ok: Build button → build mode ON');
if (afterBuildTap.walls !== before.walls) fail('tapping Build placed a wall (Finding 1 leak)');
if (Math.abs(afterBuildTap.px - before.px) > 3 || Math.abs(afterBuildTap.py - before.py) > 3)
  fail(`tapping Build moved the player (Finding 1 leak): ${JSON.stringify(before)} → ${JSON.stringify(afterBuildTap)}`);
else console.log('ok: Build tap did not leak into world (no move, no wall)');
const woodAfterBuildTap = await wood();
if (woodAfterBuildTap !== afterChop) fail('tapping Build changed wood count');

// 4. Place a wall on an empty tile → spends 2 wood, adds one wall.
await tapBase(11 * 16 + 8, 20 * 16 + 8); // empty tile (11,20)
await page.waitForTimeout(300);
const afterPlace = await state();
const woodAfterPlace = await wood();
if (afterPlace.walls !== before.walls + 1) fail(`wall not placed: walls ${before.walls} → ${afterPlace.walls}`);
else console.log(`ok: wall placed (walls ${before.walls} → ${afterPlace.walls})`);
if (woodAfterPlace !== afterChop - 2) fail(`wall did not cost 2 wood: ${afterChop} → ${woodAfterPlace}`);
else console.log(`ok: wall spent 2 wood (${afterChop} → ${woodAfterPlace})`);
await page.screenshot({ path: `${OUT}-3-wall.png` });

// 5. Finding-1 again: tapping Build to EXIT must not place a wall under the button.
await tapBase(314, 21);
await page.waitForTimeout(200);
const afterExit = await state();
if (afterExit.buildMode) fail('Build button did not exit build mode');
else console.log('ok: Build button → build mode OFF');
if (afterExit.walls !== afterPlace.walls) fail('exiting build mode placed a wall under the button (Finding 1 leak)');
else console.log('ok: exit tap did not place a wall');

if (errors.length) fail(`console/page errors:\n${errors.join('\n')}`);
else console.log('ok: no console/page errors');

await browser.close();
console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE PASSED');
