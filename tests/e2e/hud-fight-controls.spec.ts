import { test, expect } from '@playwright/test';
import { startGame } from './harness';

// Regression (attack buttons dead while holding the movepad): a browser only synthesizes `click` for
// the PRIMARY pointer (the first finger down). While the movepad holds that primary pointer, a second
// finger tapping Attack/Bow is a non-primary pointer and never fires `click` — so the old `onClick`
// combat buttons were silently dropped mid-move. The buttons now fire on `pointerdown` (delivered for
// every pointer). These specs use CDP touch dispatch to drive genuine two-finger multitouch.
test.use({ hasTouch: true, isMobile: true });

// Count combat:* events on the bus + render the fight morph (movepad + Attack/Bow). Returns a reader.
async function armFightHud(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const g = (window as unknown as { game: any }).game;
    g.__combat = { attack: 0, bow: 0 };
    g.events.on('combat:attack', () => (g.__combat.attack += 1));
    g.events.on('combat:bow', () => (g.__combat.bow += 1));
    g.__test.equip('bow'); // the Bow button shows only with a bow equipped (plan 049)
    g.events.emit('mode:changed', 'combat'); // render the fight morph in the HUD
  });
  await page.waitForSelector('[data-testid="hud-movepad"]');
}

const counts = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { game: any }).game.__combat);

const centreOf = (page: import('@playwright/test').Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)!;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, sel);

// The Attack/Bow buttons carry no data-testid; find them by their text label.
const buttonCentre = (page: import('@playwright/test').Page, label: string) =>
  page.evaluate((l) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === l)!;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);

test('Attack and Bow fire while the movepad is held (non-primary pointer)', async ({ page }) => {
  await startGame(page);
  await armFightHud(page);
  const client = await page.context().newCDPSession(page);
  const touch = (type: string, touchPoints: Array<{ x: number; y: number; id: number }>) =>
    client.send('Input.dispatchTouchEvent', { type, touchPoints });

  const pad = await centreOf(page, '[data-testid="hud-movepad"]');
  const atk = await buttonCentre(page, 'Attack');
  const bow = await buttonCentre(page, 'Bow');

  // Baseline: a lone tap on Attack (this finger IS the primary pointer) fires — proves the harness.
  await touch('touchStart', [{ x: atk.x, y: atk.y, id: 1 }]);
  await touch('touchEnd', []);
  await expect.poll(async () => (await counts(page)).attack).toBe(1);

  // Hold the movepad (finger 0 → the primary pointer), then tap Attack and Bow with a second finger.
  await touch('touchStart', [{ x: pad.x, y: pad.y, id: 0 }]);
  await touch('touchMove', [{ x: pad.x + 12, y: pad.y + 12, id: 0 }]);

  // Second finger taps Attack while finger 0 stays down → non-primary pointer.
  await touch('touchStart', [
    { x: pad.x + 12, y: pad.y + 12, id: 0 },
    { x: atk.x, y: atk.y, id: 1 },
  ]);
  await touch('touchEnd', [{ x: pad.x + 12, y: pad.y + 12, id: 0 }]); // lift only finger 1
  await expect.poll(async () => (await counts(page)).attack).toBe(2); // fired again despite the hold

  // Same for Bow, movepad still held.
  await touch('touchStart', [
    { x: pad.x + 12, y: pad.y + 12, id: 0 },
    { x: bow.x, y: bow.y, id: 2 },
  ]);
  await touch('touchEnd', [{ x: pad.x + 12, y: pad.y + 12, id: 0 }]);
  await expect.poll(async () => (await counts(page)).bow).toBe(1);

  await touch('touchEnd', []); // release the movepad
});
