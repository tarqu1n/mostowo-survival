import { test, expect } from '@playwright/test';
import { startGame, emit } from './harness';

// Plan 046 Step 14 — DOM/React HUD (top cluster). The retiring steps 9–12 verified the migration
// through the event bus + a headless smoke; these specs are the standing DOM-driven coverage: drive
// the game→HUD events on the bus and assert the rendered overlay (queried by data-testid / text),
// proving the bridge → store → React path end-to-end. No canvas, no timing — pure event → DOM.

test('the survival meters render the live HP / food / supply values', async ({ page }) => {
  await startGame(page);

  // Distinct values so each ring's readout is unambiguous in the cluster's text.
  await emit(page, 'player:hpChanged', { hp: 77, maxHp: 100 });
  await emit(page, 'hunger:changed', { hunger: 55, max: 100 });
  await emit(page, 'supply:changed', { wood: 3, rock: 4 });
  await emit(page, 'fire:changed', { fuel: 42, maxFuel: 100, lit: true });

  const meters = page.getByTestId('hud-meterbars');
  await expect(meters).toContainText('77'); // HP ring
  await expect(meters).toContainText('55'); // food ring
  await expect(meters).toContainText('42'); // fire ring (present only with a hearth)
  await expect(meters).toContainText('3'); // wood pool
  await expect(meters).toContainText('4'); // rock pool

  // No hearth → the fire ring is hidden entirely (mirrors the legacy HudBars null case).
  await emit(page, 'fire:changed', null);
  await expect(meters).not.toContainText('42');
});

test('the day/night dial tracks the phase and drops a night-wave banner', async ({ page }) => {
  await startGame(page);

  await emit(page, 'time:changed', { phase: 'day', dayCount: 2, tNorm: 0.25 });
  const dial = page.getByTestId('hud-daynight');
  await expect(dial).toContainText('Day 2');
  await expect(dial).not.toContainText('Night Wave');

  // Night: the label advances and the wave banner drops in (the store derives the wave from the phase).
  await emit(page, 'time:changed', { phase: 'night', dayCount: 3, tNorm: 0.6 });
  await expect(dial).toContainText('Day 3');
  await expect(dial).toContainText('Night Wave');

  // Back to day — the banner retracts.
  await emit(page, 'time:changed', { phase: 'day', dayCount: 4, tNorm: 0.1 });
  await expect(dial).not.toContainText('Night Wave');
});

test('the starving vignette ramps in below the hunger threshold and clears when fed', async ({
  page,
}) => {
  await startGame(page);
  const vignette = page.getByTestId('hud-vignette-hunger');
  const opacity = () => vignette.evaluate((el) => parseFloat(getComputedStyle(el).opacity));

  // Full hunger → no tint.
  await emit(page, 'hunger:changed', { hunger: 100, max: 100 });
  await expect.poll(opacity).toBe(0);

  // Near-empty → the radial starving tint fades in (opacity > 0).
  await emit(page, 'hunger:changed', { hunger: 5, max: 100 });
  await expect.poll(opacity).toBeGreaterThan(0);

  // Fed back to full → clears again.
  await emit(page, 'hunger:changed', { hunger: 100, max: 100 });
  await expect.poll(opacity).toBe(0);
});
