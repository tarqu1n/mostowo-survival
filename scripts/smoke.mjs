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

// Map a base-res (360x640) point to a client position on the scaled canvas.
const toClient = ([bx, by]) =>
  page.evaluate(
    ([bx, by]) => {
      const r = document.querySelector('canvas').getBoundingClientRect();
      const s = r.width / 360; // Scale.FIT preserves aspect
      return { x: r.left + bx * s, y: r.top + by * s };
    },
    [bx, by],
  );
async function tapBase(bx, by) {
  const p = await toClient([bx, by]);
  await page.mouse.click(p.x, p.y);
}
async function longPressBase(bx, by) {
  const p = await toClient([bx, by]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(480); // > LONGPRESS_MS (350) → append
  await page.mouse.up();
}
// Hold past the long-press threshold, then drag across tiles — paints several queue orders at once.
async function paintDrag(cells) {
  const first = await toClient(center(...cells[0]));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.waitForTimeout(430); // cross LONGPRESS_MS → enter paint mode
  for (let i = 1; i < cells.length; i++) {
    const c = await toClient(center(...cells[i]));
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

// 1. Chop the tree at tile (5,8): worker paths adjacent (trees block) + 3 hits → wood 3.
await tapBase(...center(5, 8));
await page.waitForTimeout(6500);
const w1 = await wood();
if (w1 >= 3) ok(`chop → wood ${w1}`);
else fail(`chop did not yield wood (got ${w1}, expected >= 3)`);
await page.screenshot({ path: `${OUT}-1-chopped.png` });

// 2. Long-press three far tiles (bottom-left, clear of HUD buttons) → queue fills (current + 2). (b)
await longPressBase(...center(2, 38));
await longPressBase(...center(3, 36));
await longPressBase(...center(4, 34));
const q = await dbg();
if (q.pending >= 2) ok(`long-press queued orders (pending ${q.pending})`);
else fail(`queue did not fill via long-press (pending ${q.pending}, current ${q.currentKind})`);

// 2b. A queued harvest outlines its tree yellow; hold-drag paints several orders in one gesture.
await tapBase(...center(2, 2)); // act-now move busies the worker so queued items don't drain
await longPressBase(...center(8, 20)); // append a harvest of a still-live tree (5,8 was felled above)
await page.waitForTimeout(120);
const outlined = await page.evaluate(() =>
  window.game.scene.getScene('Game').trees.some((t) => t.rect.isStroked && t.rect.strokeColor === 0xffd500),
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
await tapBase(...center(11, 10)); // place blueprint
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
await tapBase(...center(11, 10)); // still in build mode → re-enqueue build
await tapBase(314, 21); // exit build mode so it doesn't interfere
await page.waitForTimeout(9000); // travel + BUILD_MS (2500)
if (await blocked(11, 10)) ok('completed wall now blocks movement');
else fail('wall did not become a blocking obstacle after build');
await page.screenshot({ path: `${OUT}-2-wall.png` });

// 7. Pathfinding respects the wall: ordering a move ONTO the wall tile is a no-op (path null). (a)
const preMove = await dbg();
await tapBase(...center(11, 10));
await page.waitForTimeout(1500);
const onWall = await dbg();
if (!(onWall.pcol === 11 && onWall.prow === 10)) ok('worker will not path onto a wall tile');
else fail('worker walked onto a wall tile');
// ...and it still reaches a reachable open tile.
await tapBase(...center(11, 16));
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
