// Boot canary (plan 007 Tier 3). The old ~400-line linear playthrough was retired — its ~35
// assertions now live in the deterministic unit tests (`npm test`) and Playwright scenarios
// (`npm run e2e`), which don't race real-time walks/chops. This keeps only the one thing those
// tiers can't cheaply give: proof the real production bundle BOOTS end-to-end, reaches the Game +
// UI scenes, renders (compiling every WebGL shader, running the queued-glow bake), and logs ZERO
// console/page errors. No gameplay, no timing.
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
const box = await page.locator('canvas').boundingBox();
if (!box) fail('game canvas not found');
else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

await page
  .waitForFunction(() => window.game.scene.getScene('Game')?.scene.isActive(), null, {
    timeout: 5000,
  })
  .then(() => ok('Game scene active'))
  .catch(() => fail('Game scene never became active'));
await page
  .waitForFunction(() => window.game.scene.getScene('UI')?.scene.isActive(), null, {
    timeout: 5000,
  })
  .then(() => ok('UI scene active'))
  .catch(() => fail('UI scene never became active'));

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
