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
await tapWorld(...center(2, 6)); // act-now move busies the worker so queued items don't drain (row 2 would land under the plan-003 mode-toggle HUD buttons)
await longPressWorld(...center(8, 20)); // append a harvest of a still-live tree (5,8 was felled above)
await page.waitForTimeout(120);
// Queued harvest targets wear a WebGL PostFX silhouette outline (src/render/OutlinePipeline.ts);
// the head-of-queue tree pulses. Under headless WebGL, assert via the debug accessor rather than
// the old marker rect. (The zero-console-error gate below doubles as the shader-compile check.)
const q2 = await dbg();
if (q2.outlinedTreeIds.length >= 1 && q2.pulsingTreeId) ok('queued harvest target is outlined (pulsing head)');
else fail(`queued harvest target not outlined (outlined ${q2.outlinedTreeIds.length}, head ${q2.pulsingTreeId})`);

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

// 8. Combat (plan 003): a kid zombie is fixed-spawned at tile (11,30), well outside its own
// vision (80px / 5 tiles) from the player's spawn — see plan 003 Step 4. HUD coordinates: COMBAT
// toggle (40,48), INSPECT toggle (112,48), PUNCH button (43,612), movepad base (300,540) r=40.
const padCenter = await toClient([300, 540]);
async function movepadStep(dx, dy, holdMs = 150) {
  await page.mouse.move(padCenter.x, padCenter.y);
  await page.mouse.down();
  await page.mouse.move(padCenter.x + dx, padCenter.y + dy, { steps: 3 });
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

// 8a. Inspect mode: tap the (still-alive) zombie, a live tree, and the built wall from step 6 —
// each shows a matching stats panel; empty ground hides it. Doesn't require Combat mode/proximity.
await tapBase(112, 48); // INSPECT toggle
await page.waitForTimeout(150);
if ((await dbg()).mode === 'inspect') ok('INSPECT toggle → mode inspect');
else fail(`INSPECT toggle did not switch mode (got ${(await dbg()).mode})`);

await tapWorld(...center(11, 30)); // the zombie's fixed spawn tile
await page.waitForTimeout(150);
const zPanel = await page.evaluate(() => {
  const ui = window.game.scene.getScene('UI');
  return { visible: ui.inspectPanelBg.visible, title: ui.inspectPanelTitle.text, hp: ui.inspectPanelHp.text };
});
if (zPanel.visible && zPanel.title === 'Kid Zombie' && zPanel.hp === 'HP: 3/3') ok(`zombie inspect panel: ${zPanel.title} ${zPanel.hp}`);
else fail(`zombie inspect panel wrong: ${JSON.stringify(zPanel)}`);

await tapWorld(...center(14, 12)); // a still-alive tree (5,8 was chopped in step 1)
await page.waitForTimeout(150);
const treePanel = await page.evaluate(() => {
  const ui = window.game.scene.getScene('UI');
  return { visible: ui.inspectPanelBg.visible, title: ui.inspectPanelTitle.text };
});
if (treePanel.visible && treePanel.title === 'Tree') ok('tree inspect panel shows');
else fail(`tree inspect panel wrong: ${JSON.stringify(treePanel)}`);

await tapWorld(...center(11, 10)); // the wall built in step 6
await page.waitForTimeout(150);
const wallPanel = await page.evaluate(() => {
  const ui = window.game.scene.getScene('UI');
  return { visible: ui.inspectPanelBg.visible, title: ui.inspectPanelTitle.text, extra: ui.inspectPanelExtra.text };
});
if (wallPanel.visible && wallPanel.title === 'Wall' && wallPanel.extra.includes('Built')) ok('wall inspect panel shows (Built)');
else fail(`wall inspect panel wrong: ${JSON.stringify(wallPanel)}`);

await tapWorld(...center(20, 2)); // empty ground → dismisses
await page.waitForTimeout(150);
const emptyPanel = await page.evaluate(() => window.game.scene.getScene('UI').inspectPanelBg.visible);
if (!emptyPanel) ok('tapping empty ground in Inspect mode hides the panel');
else fail('panel stayed visible after tapping empty ground');

await tapBase(112, 48); // INSPECT off → command
await page.waitForTimeout(150);

// 8b. Combat mode: walk to the zombie via the movepad, let its contact damage tick the player's
// HP down, and confirm death restarts the scene (player/zombie/mode back to initial spawn state).
await tapBase(40, 48); // COMBAT toggle
await page.waitForTimeout(150);
if ((await dbg()).mode === 'combat') ok('COMBAT toggle → mode combat');
else fail(`COMBAT toggle did not switch mode (got ${(await dbg()).mode})`);

let adjacent = false;
for (let i = 0; i < 30; i++) {
  await movepadStep(0, 35);
  const st = await dbg();
  if (st.mode !== 'combat') break; // a stray restart mid-walk would otherwise loop forever
  const dist = await page.evaluate(() => {
    const gs = window.game.scene.getScene('Game');
    const z = gs.zombies.find((z) => z.alive);
    return z ? Math.abs(gs.player.y - z.sprite.y) + Math.abs(gs.player.x - z.sprite.x) : Infinity;
  });
  if (dist < 20) {
    adjacent = true;
    break;
  }
}
if (adjacent) ok('movepad walked the player to the zombie');
else fail('movepad did not close the distance to the zombie');

let sawDamage = false;
let restarted = false;
let lastHp = (await dbg()).playerHp;
for (let i = 0; i < 16 && !restarted; i++) {
  await page.waitForTimeout(1000);
  const hp = (await dbg()).playerHp;
  if (hp < lastHp) sawDamage = true;
  if (sawDamage && hp === 10 && lastHp < 10) restarted = true;
  lastHp = hp;
}
if (sawDamage) ok('zombie contact damage ticked playerHp down');
else fail('playerHp never decreased while adjacent to the chasing zombie');
if (restarted) ok('playerHp reaching 0 restarted the scene (HP back to max)');
else fail(`scene did not appear to restart after HP drain (last playerHp ${lastHp})`);

const postRestart = await dbg();
if (postRestart.zombies === 1 && postRestart.pcol === 11 && postRestart.prow === 20 && postRestart.mode === 'command')
  ok('restart reset zombies/position/mode to initial spawn state');
else fail(`restart did not fully reset state: ${JSON.stringify(postRestart)}`);

// 8c. Punch: post-restart, walk to the fresh zombie and destroy it in 3 hits (maxHp 3, flat 1 dmg).
await tapBase(40, 48); // COMBAT toggle (restart reset mode to command)
await page.waitForTimeout(150);
// Punch strikes exactly one tile — the tile at (playerTile + facing). Don't walk all the way onto
// the zombie: player↔zombie have no collision, so marching in co-locates them on one tile, leaving
// the facing-adjacent punch tile empty (and just draining HP). Instead walk down only until the
// zombie aggros (starts chasing), then hold still facing down — it climbs to the tile directly below
// and halts there (its AI stops at tileDist 1), giving Punch a stable, aligned target.
adjacent = false;
for (let i = 0; i < 20 && !adjacent; i++) {
  await movepadStep(0, 30);
  adjacent = await page.evaluate(() => window.game.scene.getScene('Game').zombies.some((z) => z.alive && z.state === 'chasing'));
}
if (adjacent) ok('movepad walked the player close enough to aggro the fresh zombie');
else fail('movepad did not get the player within the zombie’s aggro range');

// Facing was set to 'down' by the last downward step; wait for the climbing zombie to settle onto
// the punch-target tile (playerTile + facing), then punch. Punch as soon as aligned to minimise
// contact damage taken while adjacent.
const punchAligned = () =>
  page.evaluate(() => {
    const gs = window.game.scene.getScene('Game');
    const z = gs.zombies.find((z) => z.alive);
    if (!z) return false;
    const pc = Math.floor(gs.player.x / 16);
    const pr = Math.floor(gs.player.y / 16);
    return z.col === pc + gs.lastFacing.dCol && z.row === pr + gs.lastFacing.dRow;
  });
let punchReady = false;
for (let j = 0; j < 60 && !punchReady; j++) {
  punchReady = await punchAligned();
  if (!punchReady) await page.waitForTimeout(100);
}
if (punchReady) ok('zombie settled onto the punch-target tile');
else fail('zombie never aligned with the punch-target tile');

const zBefore = (await dbg()).zombies;
for (let i = 0; i < 3; i++) {
  await tapBase(43, 612); // PUNCH button
  await page.waitForTimeout(150);
}
const zAfter = (await dbg()).zombies;
if (zBefore === 1 && zAfter === 0) ok(`3 punches destroyed the zombie (${zBefore} → ${zAfter})`);
else fail(`punch did not destroy the zombie as expected (${zBefore} → ${zAfter})`);

await tapBase(40, 48); // COMBAT off → command
await page.waitForTimeout(150);
if ((await dbg()).mode === 'command') ok('COMBAT toggle off → mode command');
else fail('COMBAT toggle off did not return to command mode');

if (errors.length) fail(`console/page errors:\n${errors.join('\n')}`);
else ok('no console/page errors');

await browser.close();
console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE PASSED');
process.exitCode = failed ? 1 : 0;
