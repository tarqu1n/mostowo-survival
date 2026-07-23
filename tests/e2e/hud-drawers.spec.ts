import { test, expect } from '@playwright/test';
import { startGame, applyScenario, captured, held } from './harness';

// Plan 046 Step 14 — DOM/React HUD (action layer: command bar → bottom-sheet drawers + hotbar). These
// drive the REAL DOM controls (open a drawer from the command bar, tap/long-press a tile) and assert
// the inbound event fired (via the capture seam) or the store mutation rendered. The command bar sits
// in scavenge morph on a fresh game (command mode, no combat), so Build/Pack/Status are present.

/** Install extra bus captures for the inbound events these specs assert (startGame only wires a few). */
async function captureInbound(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as any).game;
    for (const ev of ['build:select', 'needs:eat', 'build:toggle']) {
      g.events.on(ev, (payload: unknown) => {
        g.__captured[ev] = payload ?? true;
      });
    }
  });
}

test('the build catalog opens from the command bar and select emits build:select + closes', async ({
  page,
}) => {
  await startGame(page);
  await captureInbound(page);

  await page.getByRole('button', { name: 'Build', exact: true }).click();

  // The catalog is a bottom sheet with data-driven tabs — today Defense + Survival (no empty Craft).
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Build')).toBeVisible();

  // It slides up from the bottom: the sheet runs the `hud-enter` keyframe (the tailwindcss-animate
  // contract hand-provided in hud.css) rather than popping in with animationName: none.
  await expect
    .poll(() =>
      page
        .locator('[data-slot="sheet-content"]')
        .evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe('hud-enter');
  await expect(page.getByRole('tab', { name: 'Defense' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Survival' })).toBeVisible();

  // Pick the Wall (Defense) → emits build:select for it, then closes the catalog like the legacy palette.
  await page.getByRole('button', { name: 'Wall' }).click();
  expect(await captured(page, 'build:select')).toMatchObject({ id: 'wall' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the pack drawer lists stocked items and tapping a consumable eats it', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, { player: [10, 10], inventory: { wood: 5, berries: 3 } });
  await captureInbound(page);

  await page.getByRole('button', { name: 'Pack', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: 'Wood' })).toBeVisible();

  // Berries carry `nutrition`, so a tap eats them → needs:eat (a non-edible like Wood would just select).
  await sheet.getByRole('button', { name: 'Berries' }).click();
  expect(await captured(page, 'needs:eat')).toMatchObject({ itemId: 'berries' });
});

test('long-pressing a pack item pins it to the hotbar, and the pin survives a reload', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, { player: [10, 10], inventory: { wood: 5 } });

  const hotbar = page.getByTestId('hud-hotbar');
  await expect(hotbar.getByRole('button', { name: 'Wood' })).toHaveCount(0); // empty to start

  await page.getByRole('button', { name: 'Pack', exact: true }).click();
  const slot = page.getByRole('dialog').getByRole('button', { name: 'Wood' });

  // Long-press: hold past LONGPRESS_MS (350) so the pin fires and the trailing tap is suppressed.
  // hover() first so the raw-coordinate press below lands after the sheet's slide-in settles (the
  // bottom sheet animates up over ~0.5s; a boundingBox captured mid-slide would be stale).
  await slot.hover();
  const box = (await slot.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();

  await page.keyboard.press('Escape'); // close the drawer (Radix dismiss)
  await expect(hotbar.getByRole('button', { name: 'Wood' })).toHaveCount(1); // pinned onto the bar

  // Persistence: the loadout is saved to localStorage keyed per save, so it rehydrates after a fresh
  // load (startGame re-navigates → new store). The persisted loadout tolerates items no longer owned —
  // the slot renders from the loadout, not from stock — so no scenario re-seed is needed here.
  await startGame(page);
  await expect(page.getByTestId('hud-hotbar').getByRole('button', { name: 'Wood' })).toHaveCount(1);
});

test('a stackable hotbar item shows its live count and a tap eats one, decrementing it', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, { player: [10, 10], inventory: { berries: 3 }, hunger: 20 });

  // Pin berries to the bar via the Pack-drawer long-press (same gesture as the pin test above).
  await page.getByRole('button', { name: 'Pack', exact: true }).click();
  const entry = page.getByRole('dialog').getByRole('button', { name: 'Berries' });
  await entry.hover(); // wait out the sheet's slide-in so the raw-coordinate press lands (see above)
  const box = (await entry.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600); // past LONGPRESS_MS
  await page.mouse.up();
  await page.keyboard.press('Escape'); // close the drawer

  const hotbar = page.getByTestId('hud-hotbar');
  const berries = hotbar.getByRole('button', { name: /Berries/ });
  await expect(berries).toHaveCount(1);
  // The slot shows the live stack count (3 held).
  await expect(hotbar.getByTestId('hud-hotbar-count')).toHaveText('3');

  // A tap eats one: eat() spends synchronously and the inventory 'change' flows straight to the store,
  // so the count drops to 2 with no game step — proving both "shows a count" and "eaten when tapped".
  await berries.click();
  await expect(hotbar.getByTestId('hud-hotbar-count')).toHaveText('2');
  expect(await held(page, 'berries')).toBe(2);

  // Eating shows the visual feedback cue: a "+N" floats up from the hunger meter (seeded hunger 20 +
  // berries' 25 nutrition = a +25 gain).
  await expect(page.getByTestId('hud-fed-float')).toHaveText('+25');

  // Eating starts the shared 5s cooldown: a shrinking sweep appears over the food slot and further
  // taps are ignored until it elapses (the game enforces the same, so no berry is wasted).
  await expect(hotbar.getByTestId('hud-hotbar-cooldown')).toBeVisible();
  await berries.click(); // spam-tap mid-cooldown
  await expect(hotbar.getByTestId('hud-hotbar-count')).toHaveText('2'); // still 2 — blocked
  expect(await held(page, 'berries')).toBe(2);
});
