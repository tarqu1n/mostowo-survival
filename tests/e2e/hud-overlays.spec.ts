import { test, expect } from '@playwright/test';
import { startGame, emit, captured } from './harness';

// Plan 046 Step 14 — DOM/React HUD (deep overlays: inspect card + companion menu). Both are pure
// mirrors of game→HUD events, so drive the bus and assert the rendered sheet + the inbound events the
// controls fire back. (The GameScene→bus wiring itself is covered by inspect.spec / companion.spec;
// these add the DOM half.)

test('the inspect card mirrors inspect:show and dismiss emits inspect:hide', async ({ page }) => {
  await startGame(page);

  await emit(page, 'inspect:show', { name: 'Kid Zombie', maxHp: 3, currentHp: 2 });
  await expect(page.getByText('Kid Zombie')).toBeVisible();

  // Re-arm the capture so we detect THIS dismiss, then close via the sheet's X → emits inspect:hide.
  await page.evaluate(() => ((window as any).game.__captured['inspect:hide'] = null));
  await page.getByRole('button', { name: 'Close' }).click();
  expect(await captured(page, 'inspect:hide')).toBe(true);
  await expect(page.getByText('Kid Zombie')).toHaveCount(0);
});

test('leaving inspect mode clears the card (mode:changed → inspect cleared)', async ({ page }) => {
  await startGame(page);

  await emit(page, 'inspect:show', { name: 'Tree', maxHp: 3 });
  await expect(page.getByText('Tree')).toBeVisible();

  // Toggling out of inspect mode clears the card — the DOM port of the retired UIScene.onModeChanged.
  await emit(page, 'mode:changed', 'command');
  await expect(page.getByText('Tree')).toHaveCount(0);
});

test('the companion menu opens on npc:menuOpen and its rows emit the assignment events', async ({
  page,
}) => {
  await startGame(page);
  await page.evaluate(() => {
    const g = (window as any).game;
    for (const ev of ['npc:assignDayRole', 'npc:assignNightPosture', 'npc:beginPlaceGuard']) {
      g.events.on(ev, (payload: unknown) => {
        g.__captured[ev] = payload ?? true;
      });
    }
  });

  // The tap-the-companion event carries the ally's live role/posture (the DOM sheet ignores the legacy
  // x/y anchor, dropped at Step 13). The current DAY role (gather) should read as the active row.
  await emit(page, 'npc:menuOpen', { dayRole: 'gather', nightPosture: 'follow' });
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Assign companion')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Gather' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Pick a DAY role → npc:assignDayRole, and the sheet closes.
  await sheet.getByRole('button', { name: 'Repair' }).click();
  expect(await captured(page, 'npc:assignDayRole')).toBe('repair');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Reopen → "Guard here" arms the one-tap place-the-point flow (npc:beginPlaceGuard).
  await emit(page, 'npc:menuOpen', { dayRole: 'repair', nightPosture: 'follow' });
  await page.getByRole('dialog').getByRole('button', { name: 'Guard here' }).click();
  expect(await captured(page, 'npc:beginPlaceGuard')).toBe(true);
});
