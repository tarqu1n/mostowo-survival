// Headless smoke test for the worker task system (plan 002). Drives the real game in Chromium and
// asserts: pathfinding obstacle-respect, tap/long-press queueing, timed construction (blueprint →
// solid wall), and non-destructive Cancel — plus the plan-001 chop→wood loop and no console errors.
// Run against `npm run preview`:  node scripts/smoke.mjs
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
let failed = false;
const fail = (m) => {
  console.error('FAIL:', m);
  failed = true;
};
const ok = (m) => console.log('ok:', m);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.game?.isBooted, null, { timeout: 10000 });

// Map a base-res (360x640) *screen* point (HUD buttons, menu — always at zoom 1, no scroll) to a
// client position on the scaled canvas.
const toClient = ([bx, by]) =>
  page.evaluate(
    ([bx, by]) => {
      const r = document.querySelector('canvas').getBoundingClientRect();
      const s = r.width / 360; // Scale.FIT preserves aspect
      return { x: r.left + bx * s, y: r.top + by * s };
    },
    [bx, by],
  );
// Map a *world* point (a game tile) to a client position, through GameScene's live camera zoom/
// scroll (it now follows the player once zoomed in — see config.ts MIN/MAX/DEFAULT_ZOOM) rather
// than assuming the old fixed 1:1 world-to-screen mapping. Uses the camera's own `worldView` (the
// authoritative currently-visible world rect) rather than re-deriving Phaser's transform matrix.
const worldToClient = ([wx, wy]) =>
  page.evaluate(
    ([wx, wy]) => {
      const cam = window.game.scene.getScene('Game').cameras.main;
      const wv = cam.worldView;
      const baseX = ((wx - wv.x) / wv.width) * cam.width;
      const baseY = ((wy - wv.y) / wv.height) * cam.height;
      const r = document.querySelector('canvas').getBoundingClientRect();
      const s = r.width / 360;
      return { x: r.left + baseX * s, y: r.top + baseY * s };
    },
    [wx, wy],
  );
async function tapBase(bx, by) {
  const p = await toClient([bx, by]);
  await page.mouse.click(p.x, p.y);
}
async function tapWorld(wx, wy) {
  const p = await worldToClient([wx, wy]);
  await page.mouse.click(p.x, p.y);
}
async function longPressWorld(wx, wy) {
  const p = await worldToClient([wx, wy]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(480); // > LONGPRESS_MS (350) → append
  await page.mouse.up();
}
// Hold past the long-press threshold, then drag across tiles — paints several queue orders at once.
async function paintDrag(cells) {
  const first = await worldToClient(center(...cells[0]));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.waitForTimeout(430); // cross LONGPRESS_MS → enter paint mode
  for (let i = 1; i < cells.length; i++) {
    const c = await worldToClient(center(...cells[i]));
    await page.mouse.move(c.x, c.y);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
}
const wood = () => page.evaluate(() => window.game.registry.get('inventory')?.get('wood') ?? 0);
const dbg = () => page.evaluate(() => window.game.scene.getScene('Game').debugState());
const blocked = (c, r) => page.evaluate(([c, r]) => window.game.scene.getScene('Game').isTileBlocked(c, r), [c, r]);
const TILE = 16;
const center = (col, row) => [col * TILE + TILE / 2, row * TILE + TILE / 2];

// 0. Menu → world + HUD.
await tapBase(180, 400);
await page.waitForFunction(() => window.game.scene.getScene('Game')?.scene.isActive(), null, { timeout: 5000 });
await page.waitForFunction(() => window.game.scene.getScene('UI')?.scene.isActive(), null, { timeout: 5000 });

// 0b. Zoom: default is 200%; the UI +/− buttons (UIScene, top-center: [−] 146,20 · 214,20 [+])
// change and clamp the camera zoom, and the % readout follows. Left at MIN_ZOOM (100%) afterward,
// deliberately: once zoomed in, the camera follows the player and only a fraction of the map is
// visible at a time, so this test's fixed tile targets (chosen back when the whole map was always
// on-screen) would be off-screen at the default zoom. Zoom only changes camera framing, not game
// logic, so testing the gameplay below at MIN_ZOOM (whole map visible, exactly the old behaviour)
// is the correct, simplest coverage — it's not testing "at zoom X" so much as "at any zoom".
const zoomNow = () => page.evaluate(() => window.game.scene.getScene('Game').cameras.main.zoom);
const zoomReadout = () => page.evaluate(() => window.game.scene.getScene('UI').zoomText.text);

const z0 = await zoomNow();
if (z0 === 2) ok(`default zoom is 200% (${z0 * 100}%)`);
else fail(`unexpected default zoom (${z0 * 100}%, expected 200%)`);

for (let i = 0; i < 4; i++) await tapBase(214, 20); // zoom-in button, past MAX_ZOOM (3 → 300%)
await page.waitForTimeout(100);
const zMax = await zoomNow();
if (zMax === 3 && (await zoomReadout()) === '300%') ok(`zoom-in clamps at MAX_ZOOM (${zMax * 100}%, readout 300%)`);
else fail(`zoom-in did not clamp correctly (zoom ${zMax * 100}%, readout ${await zoomReadout()})`);

for (let i = 0; i < 6; i++) await tapBase(146, 20); // zoom-out button, past MIN_ZOOM (1 → 100%)
await page.waitForTimeout(100);
const zMin = await zoomNow();
if (zMin === 1 && (await zoomReadout()) === '100%') ok(`zoom-out clamps at MIN_ZOOM (${zMin * 100}%, readout 100%)`);
else fail(`zoom-out did not clamp correctly (zoom ${zMin * 100}%, readout ${await zoomReadout()})`);

// 0c. Manual pan: a quick drag (before the long-press threshold) scrolls the camera and breaks
// the follow-lock; the FOLLOW button (top-center, under the zoom row: 180,49) snaps back +
// re-locks. Zoom in one step first — at MIN_ZOOM the viewport already covers the whole map, so
// there's no scroll room to actually demonstrate a pan.
const following = () => page.evaluate(() => window.game.registry.get('following'));
const scrollNow = () => page.evaluate(() => {
  const cam = window.game.scene.getScene('Game').cameras.main;
  return { x: cam.scrollX, y: cam.scrollY };
});

await tapBase(214, 20); // zoom in one step: 100% → 150%
await page.waitForTimeout(100);

if ((await following()) === true) ok('camera starts in follow mode');
else fail(`camera did not start in follow mode (got ${await following()})`);

const scrollBefore = await scrollNow();
const dragStart = await toClient([200, 300]);
const dragEnd = await toClient([260, 380]);
await page.mouse.move(dragStart.x, dragStart.y);
await page.mouse.down();
await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 8 });
await page.waitForTimeout(50);
await page.mouse.up();
const scrollAfter = await scrollNow();

if ((await following()) === false) ok('manual pan breaks the follow-lock');
else fail('follow-lock was still on after a manual pan');
if (scrollAfter.x !== scrollBefore.x || scrollAfter.y !== scrollBefore.y) ok('manual pan scrolled the camera');
else fail(`pan did not move the camera (scroll stayed at ${JSON.stringify(scrollAfter)})`);

await tapBase(180, 49); // FOLLOW button
await page.waitForTimeout(100);
if ((await following()) === true) ok('FOLLOW button re-engages the follow-lock');
else fail('FOLLOW button did not re-engage the follow-lock');

for (let i = 0; i < 3; i++) await tapBase(146, 20); // back to MIN_ZOOM for the gameplay steps below
await page.waitForTimeout(100);
await page.screenshot({ path: `${OUT}-0-fog.png` }); // visual check: vision-radius fog around the player

// 1. Chop the tree at tile (5,8): worker paths adjacent (trees block) + 3 hits → wood 3.
await tapWorld(...center(5, 8));
await page.waitForTimeout(6500);
const w1 = await wood();
if (w1 >= 3) ok(`chop → wood ${w1}`);
else fail(`chop did not yield wood (got ${w1}, expected >= 3)`);
await page.screenshot({ path: `${OUT}-1-chopped.png` });

// 2. Long-press three far tiles (bottom-left, clear of HUD buttons) → queue fills (current + 2). (b)
await longPressWorld(...center(2, 38));
await longPressWorld(...center(3, 36));
await longPressWorld(...center(4, 34));
const q = await dbg();
if (q.pending >= 2) ok(`long-press queued orders (pending ${q.pending})`);
else fail(`queue did not fill via long-press (pending ${q.pending}, current ${q.currentKind})`);

// 2b. A queued harvest outlines its tree yellow; hold-drag paints several orders in one gesture.
await tapWorld(...center(2, 2)); // act-now move busies the worker so queued items don't drain
await longPressWorld(...center(8, 20)); // append a harvest of a still-live tree (5,8 was felled above)
await page.waitForTimeout(120);
// Trees are sprites (not Rectangles, see docs/ASSETS.md) — queued harvest is outlined via a
// stroke-only marker rect over the tile rather than a stroke on the tree itself.
const outlined = await page.evaluate(() =>
  window.game.scene.getScene('Game').queueMarkers.some((m) => m.isStroked && m.strokeColor === 0xffd500),
);
if (outlined) ok('queued harvest target is outlined yellow');
else fail('queued harvest target was not outlined yellow');

const pBefore = (await dbg()).pending;
await paintDrag([[2, 32], [3, 32], [4, 32], [5, 32], [6, 32]]);
const pAfter = (await dbg()).pending;
if (pAfter - pBefore >= 3) ok(`hold-drag queued multiple orders (+${pAfter - pBefore})`);
else fail(`hold-drag did not queue multiple orders (pending ${pBefore} → ${pAfter})`);

// 3. Cancel clears the queue. (part of d)
await tapBase(314, 51); // Cancel button
await page.waitForTimeout(200);
const qc = await dbg();
if (qc.pending === 0 && qc.currentKind === null) ok('Cancel cleared the queue');
else fail(`Cancel did not clear queue (pending ${qc.pending}, current ${qc.currentKind})`);

// 4. Enter build mode, place a blueprint at (11,10): spends 2 wood, passable while building.
await tapBase(314, 21); // Build button
await page.waitForTimeout(150);
if ((await dbg()).buildMode) ok('Build button → build mode ON');
else fail('Build button did not enable build mode');
const wBefore = await wood();
await tapWorld(...center(11, 10)); // place blueprint
await page.waitForTimeout(150);
const wAfter = await wood();
const sBuilt = await dbg();
if (wAfter === wBefore - 2) ok(`blueprint reserved 2 wood (${wBefore} → ${wAfter})`);
else fail(`blueprint wood spend wrong (${wBefore} → ${wAfter})`);
if (sBuilt.sites === 1) ok('blueprint site created');
else fail(`expected 1 site, got ${sBuilt.sites}`);
if (!(await blocked(11, 10))) ok('blueprint is passable while building');
else fail('blueprint blocks movement before completion (should be passable)');

// 5. Cancel is non-destructive: clears the build task but the blueprint remains. (d)
await tapBase(314, 51); // Cancel
await page.waitForTimeout(200);
const sCancel = await dbg();
if (sCancel.pending === 0 && sCancel.sites === 1 && !(await blocked(11, 10)))
  ok('Cancel is non-destructive (blueprint remains, unbuilt)');
else fail(`Cancel destroyed the blueprint (pending ${sCancel.pending}, sites ${sCancel.sites})`);

// 6. Re-tap the blueprint to resume building, then wait: it becomes a solid, blocking wall. (c)
await tapWorld(...center(11, 10)); // still in build mode → re-enqueue build
await tapBase(314, 21); // exit build mode so it doesn't interfere
await page.waitForTimeout(9000); // travel + BUILD_MS (2500)
if (await blocked(11, 10)) ok('completed wall now blocks movement');
else fail('wall did not become a blocking obstacle after build');
await page.screenshot({ path: `${OUT}-2-wall.png` });

// 7. Pathfinding respects the wall: ordering a move ONTO the wall tile is a no-op (path null). (a)
const preMove = await dbg();
await tapWorld(...center(11, 10));
await page.waitForTimeout(1500);
const onWall = await dbg();
if (!(onWall.pcol === 11 && onWall.prow === 10)) ok('worker will not path onto a wall tile');
else fail('worker walked onto a wall tile');
// ...and it still reaches a reachable open tile.
await tapWorld(...center(11, 16));
await page.waitForTimeout(4000);
const arrived = await dbg();
if (Math.abs(arrived.pcol - 11) <= 1 && Math.abs(arrived.prow - 16) <= 1) ok('worker reaches an open tile (routing around obstacles)');
else fail(`worker did not reach the open target (at ${arrived.pcol},${arrived.prow})`);
void preMove;

if (errors.length) fail(`console/page errors:\n${errors.join('\n')}`);
else ok('no console/page errors');

await browser.close();
console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE PASSED');
process.exitCode = failed ? 1 : 0;
