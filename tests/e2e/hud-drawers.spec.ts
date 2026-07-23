import { test, expect } from '@playwright/test';
import { startGame, applyScenario, captured } from './harness';

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
