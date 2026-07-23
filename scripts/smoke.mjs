// Boot canary (plan 007 Tier 3). The old ~400-line linear playthrough was retired — its ~35
// assertions now live in the deterministic unit tests (`npm test`) and Playwright scenarios
// (`npm run e2e`), which don't race real-time walks/chops. This keeps only the one thing those
// tiers can't cheaply give: proof the real production bundle BOOTS end-to-end, reaches the Game scene
// with the DOM/React HUD overlay mounted over it, renders (compiling every WebGL shader, running the
// queued-glow bake), and logs ZERO console/page errors. No gameplay, no timing.
//
// Run against the production preview build:  npm run preview  (then)  npm run smoke
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

const URL = process.env.SMOKE_URL ?? 'http://localhost:4173/mostowo-survival/';
const OUT = 'scripts/.smoke';
let failed = false;
const fail = (m) => {
  console.error('FAIL:', m);
  failed = true;
};
const ok = (m) => console.log('ok:', m);

// Honour a pre-installed browser (e.g. CI / cloud dev boxes that pin a different Playwright build):
// set SMOKE_CHROMIUM_PATH to a chromium executable. Unset → Playwright's own managed download.
const browser = await chromium.launch(
  process.env.SMOKE_CHROMIUM_PATH ? { executablePath: process.env.SMOKE_CHROMIUM_PATH } : undefined,
);
const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.game?.isBooted, null, { timeout: 10000 });
ok('game booted (Boot → Preload → MainMenu)');

// MainMenu starts the Game scene on any pointerdown; click the canvas centre (the FIT-scaled canvas
// is letterboxed within the viewport, so viewport-centre may miss it). Reaching Game renders the
// world + HUD, which compiles the WebGL shaders — the zero-error gate below is the shader-compile check.
// Retry the tap while MainMenu is still active: game.isBooted flips long before MainMenu.create()
// registers its pointerdown listener, so a single click can land in that gap and be dropped (the
// documented "boot-timeout" race — see tests/e2e/harness.ts bootIntoGame). Retrying self-heals it.
await page.waitForFunction(() => window.game?.scene?.isActive('MainMenu'), null, {
  timeout: 10000,
});
const box = await page.locator('canvas').boundingBox();
let gameActive = false;
if (!box) fail('game canvas not found');
else {
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  for (let attempt = 0; attempt < 10 && !gameActive; attempt++) {
    if (await page.evaluate(() => window.game.scene.isActive('MainMenu')))
      await page.mouse.click(cx, cy);
    gameActive = await page
      .waitForFunction(() => window.game.scene.getScene('Game')?.scene.isActive(), null, {
        timeout: 1500,
      })
      .then(() => true)
      .catch(() => false);
  }
}
if (gameActive) ok('Game scene active');
else fail('Game scene never became active');
// The HUD is a DOM/React overlay (plan 046), not a Phaser scene — assert it mounted by waiting for the
// command bar, which ActionLayer renders once the Game scene is live over the canvas.
await page
  .waitForSelector('[data-testid="hud-command-bar"]', { timeout: 5000 })
  .then(() => ok('DOM HUD mounted (command bar present)'))
  .catch(() => fail('DOM HUD never mounted'));

// Let a few frames render so any first-use shader compile / draw error surfaces before we assert.
await page.waitForFunction(
  () => {
    const w = window;
    w.__frames = (w.__frames ?? 0) + 1;
    return w.__frames > 10;
  },
  null,
  { timeout: 5000, polling: 'raf' },
);
await page.screenshot({ path: `${OUT}-boot.png` }); // eyeball check: world + fog + HUD rendered

if (errors.length) fail(`console/page errors:\n${errors.join('\n')}`);
else ok('no console/page errors (shaders compiled clean)');

await browser.close();
console.log(failed ? '\nBOOT CANARY FAILED' : '\nBOOT CANARY PASSED');
process.exitCode = failed ? 1 : 0;
