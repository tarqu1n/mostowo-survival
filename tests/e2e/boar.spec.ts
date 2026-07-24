import { test, expect } from '@playwright/test';
import { startGame, applyScenario, emit, step, state } from './harness';
import { ATTACK_COOLDOWN_MS } from '../../src/config';

// Tier-2: the boar — a 4-way directional (`dir4`) enemy (plan 035b). Proves the directional render path
// end-to-end: its cross-pack strips load, it chases + bites through the real combat wiring, takes melee
// and bow damage, and dies onto its Death strip. The facing MAPPING itself is unit-tested
// (data.test.ts `facing4FromVelocity`); here we prove the dir4 mob integrates with the scene like the
// skeleton does, without the flip3 weapon/hand rig.

test('the boar loads its directional strips (cross-pack) and spawns as a dir4 enemy', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, { player: [10, 10], enemies: [{ at: [12, 10], id: 'boar' }] });
  expect((await state(page)).enemies).toBe(1);

  // The boar art lives in the craftpix-creatures pack (NOT the manifest's pixel-crawler), so PreloadScene
  // routes its loads through tilesetAssetUrl. Every state×facing strip must be resident under its
  // id-scoped texture key (== the anim key) or the sprite would draw the green missing-texture box.
  // Spot-check a representative spread of states + all four facings.
  const loaded = await page.evaluate(() => {
    const g = (window as unknown as { game: Phaser.Game }).game;
    const keys = [
      'enemy-boar-idle-down',
      'enemy-boar-walk-up',
      'enemy-boar-run-left',
      'enemy-boar-run-right',
      'enemy-boar-attack-down',
      'enemy-boar-death-up',
    ];
    return keys.every((k) => g.textures.exists(k) && g.anims.exists(k));
  });
  expect(loaded).toBe(true);
});

test('a boar chases and bites the player (the dir4 render path runs through combat)', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, { player: [10, 10], enemies: [{ at: [12, 10], id: 'boar' }] });

  const before = (await state(page)).playerHp;
  await step(page, 4000); // aggro (vision 100 ≥ the 32px gap) → chase → adjacent → at least one bite
  const s = await state(page);
  expect(s.enemyModes).toContain('chase');
  expect(s.playerHp).toBeLessThan(before); // it closed and bit — the dir4 update/anim path ran clean
});

test('a boar takes melee hits and dies onto its Death strip (the dir4 die path)', async ({
  page,
}) => {
  await startGame(page);
  // Adjacent, player facing it, Combat mode so Attack is live. Boar maxHp 5, player unarmed flat-1 →
  // five hits, each spaced past the attack cooldown; 'chase' holds it on the adjacent tile through the
  // longer fight. Its hurtbox (width 2, height 1) covers the feet tile the player faces.
  await applyScenario(page, {
    player: [10, 10],
    enemies: [{ at: [11, 10], id: 'boar', mode: 'chase' }],
    facing: 'right',
    mode: 'combat',
  });
  expect((await state(page)).enemies).toBe(1);

  for (let i = 0; i < 5; i++) {
    await emit(page, 'combat:attack');
    await step(page, ATTACK_COOLDOWN_MS + 20);
  }
  const s = await state(page);
  expect(s.enemies).toBe(0); // dead on the fifth hit
  expect(s.corpses).toBe(1); // lingers as a corpse on its Death collapse, like the skeleton
});

test('a boar telegraphs a wind-up (its Attack anim) before its bite lands (plan 035b)', async ({
  page,
}) => {
  await startGame(page);
  // Boar already adjacent + chasing. Unarmed (natural bite), so it uses the contact cadence with a
  // punchier BOAR_ATTACK_WINDUP_MS tell. dodge 0 → the bite always connects once it strikes.
  await applyScenario(page, {
    player: [10, 10],
    enemies: [{ at: [11, 10], id: 'boar', mode: 'chase' }],
  });
  const before = (await state(page)).playerHp;

  // Drive in slices finer than the wind-up and prove the ordering: at some slice the boar is mid-wind-up
  // with the player still unhurt (a readable window to disengage), and only later does HP drop. Same
  // shape as the skeleton wind-up test, but exercising the unarmed dir4 path (Attack anim as the tell).
  let sawWindupBeforeDamage = false;
  let damageLanded = false;
  for (let i = 0; i < 40 && !damageLanded; i++) {
    await step(page, 50);
    const s = await state(page);
    if (s.enemyWindups > 0 && s.playerHp === before) sawWindupBeforeDamage = true;
    if (s.playerHp < before) damageLanded = true;
  }
  expect(sawWindupBeforeDamage).toBe(true); // wound up with no damage yet — the disengage window
  expect(damageLanded).toBe(true); // the strike eventually bit
});

test('a boar takes bow damage from range (reuses the 035a bow)', async ({ page }) => {
  await startGame(page);
  // Boar 5 tiles north — inside bow range (6), never adjacent. Player faces up, no movepad drive.
  await applyScenario(page, {
    player: [10, 10],
    facing: 'up',
    mode: 'combat',
    equip: ['bow'], // ranged gated on an equipped bow (plan 049)
    enemies: [{ at: [10, 5], id: 'boar' }],
  });
  expect((await state(page)).enemies).toBe(1);

  await emit(page, 'combat:bow');
  await step(page, 100);
  const s = await state(page);
  expect(s.enemyHitFlashes).toBeGreaterThan(0); // the arrow connected (boar hp5, bow 2 → survives)
  expect(s.enemies).toBe(1);
});
