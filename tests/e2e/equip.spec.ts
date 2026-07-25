import { test, expect } from '@playwright/test';
import {
  startGame,
  applyScenario,
  emit,
  step,
  state,
  itemCount,
  setEquipDurability,
} from './harness';
import { ATTACK_COOLDOWN_MS } from '../../src/config';

// Plan 049 — equippable items + equip slots. Exercises the real bag↔slot toggle path (`equip:toggle`,
// not the force-equip scenario seam) and the three combat/light hooks: ranged is gated on an equipped
// bow, the main-hand item drives melee damage, and the off-hand torch grows the player light + drains
// in real time to destruction. Light is asserted via `playerLightRadius` (the render union isn't
// otherwise queryable); drain via `equipment.offHand.durability`.

const PLAYER_LIGHT = 20; // PLAYER_LIGHT_RADIUS: TILE_SIZE 16 × 1.25
const TORCH_LIGHT = 56; // TORCH_LIGHT_RADIUS: TILE_SIZE 16 × 3.5
const TORCH_START = 100; // TORCH_DURABILITY

test('unarmed default: no bow equipped ⇒ combat:bow is a no-op, and the light is the base radius', async ({
  page,
}) => {
  await startGame(page);
  // Enemy 4 tiles north, inside bow range (6); player faces it. Nothing equipped (the default loadout).
  await applyScenario(page, {
    player: [10, 10],
    facing: 'up',
    mode: 'combat',
    enemies: [[10, 6]],
  });
  let s = await state(page);
  expect(s.equipment).toEqual({ mainHand: null, ranged: null, offHand: null });
  expect(s.playerLightRadius).toBe(PLAYER_LIGHT); // no torch → base light

  await emit(page, 'combat:bow');
  await step(page, 100);
  s = await state(page);
  expect(s.enemyHitFlashes).toBe(0); // ranged disabled without a bow — no arrow landed
});

test('equipping a crafted bow (bag→ranged slot) enables ranged fire', async ({ page }) => {
  await startGame(page);
  await applyScenario(page, {
    player: [10, 10],
    facing: 'up',
    mode: 'combat',
    inventory: { bow: 1 }, // a crafted bow sitting in the pack (plan 048 output)
    enemies: [[10, 6]],
  });
  expect(await itemCount(page, 'bow')).toBe(1);
  expect((await state(page)).equipment.ranged).toBeNull();

  // Toggle-equip it: the bow moves bag→ranged slot (permanent — no durability).
  await emit(page, 'equip:toggle', { itemId: 'bow' });
  let s = await state(page);
  expect(s.equipment.ranged).toEqual({ id: 'bow', durability: null });
  expect(await itemCount(page, 'bow')).toBe(0); // spent out of the bag while equipped

  // Now ranged fires and connects (kidZombie hp3, bow 2 dmg → survives, flashes).
  await emit(page, 'combat:bow');
  await step(page, 100);
  s = await state(page);
  expect(s.enemyHitFlashes).toBeGreaterThan(0);
});

test('equipping a crafted sword upgrades melee damage (2 hits kill a kidZombie, not 3)', async ({
  page,
}) => {
  await startGame(page);
  // Enemy adjacent (east); player faces it. Unarmed is 1 dmg (3 hits to kill hp3); the sword is 2 dmg.
  await applyScenario(page, {
    player: [10, 10],
    facing: 'right',
    mode: 'combat',
    inventory: { sword: 1 },
    enemies: [[11, 10]],
  });
  await emit(page, 'equip:toggle', { itemId: 'sword' });
  expect((await state(page)).equipment.mainHand).toEqual({ id: 'sword', durability: null });

  // Two cooldown-spaced swings: 2 × 2 dmg = 4 ≥ hp3 → dead. (Unarmed would leave it at 1 hp.)
  await emit(page, 'combat:attack');
  await step(page, ATTACK_COOLDOWN_MS + 20);
  await emit(page, 'combat:attack');
  await step(page, 50);
  expect((await state(page)).enemies).toBe(0);
});

test('equipping a torch grows the player light, drains in real time, and is destroyed at zero', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, {
    player: [10, 10],
    inventory: { torch: 1 }, // a crafted torch in the pack
  });
  expect(await itemCount(page, 'torch')).toBe(1);
  expect((await state(page)).playerLightRadius).toBe(PLAYER_LIGHT);

  // Equip it: bag→off hand, seeded with full durability; the light disc grows immediately. (Durability
  // reads a hair under TORCH_START — the DEV clock's brief pre-first-step RAF window drains one frame.)
  await emit(page, 'equip:toggle', { itemId: 'torch' });
  let s = await state(page);
  expect(s.equipment.offHand?.id).toBe('torch');
  expect(s.equipment.offHand!.durability!).toBeGreaterThan(TORCH_START - 1);
  expect(s.equipment.offHand!.durability!).toBeLessThanOrEqual(TORCH_START);
  expect(await itemCount(page, 'torch')).toBe(0); // moved out of the bag while worn
  expect(s.playerLightRadius).toBe(TORCH_LIGHT); // torch raises the disc

  // Burns down in real time while equipped: a couple seconds of drive drops it below full but not out.
  await step(page, 2000);
  s = await state(page);
  expect(s.equipment.offHand).not.toBeNull();
  expect(s.equipment.offHand!.durability!).toBeLessThan(TORCH_START);
  expect(s.equipment.offHand!.durability!).toBeGreaterThan(0);

  // Fast-forward to the edge (a seam, like setHunger — driving the full ~90s lifetime frame-by-frame
  // would blow the test budget), then let the REAL per-frame drain cross zero over a short drive.
  await setEquipDurability(page, 'torch', 1);
  await step(page, 2000); // ~2.2 durability drained > 1 → tickTorch destroys it
  s = await state(page);
  expect(s.equipment.offHand).toBeNull(); // destroyed at zero by the per-frame drain
  expect(s.playerLightRadius).toBe(PLAYER_LIGHT); // light reverts to base
  expect(await itemCount(page, 'torch')).toBe(0); // drain-to-0 destroys it — gone for good (only an
  // UNEQUIP returns it to the pack; see the next test)
});

test('unequipping a partially-drained torch returns it to the pack; re-equip resumes its charge (plan 051)', async ({
  page,
}) => {
  await startGame(page);
  await applyScenario(page, {
    player: [10, 10],
    inventory: { torch: 1 },
  });
  // Equip → drain partway (a real drive, not the seam) → the worn torch is below full but alive.
  await emit(page, 'equip:toggle', { itemId: 'torch' });
  await step(page, 3000);
  let s = await state(page);
  const worn = s.equipment.offHand!.durability!;
  expect(worn).toBeLessThan(TORCH_START);
  expect(worn).toBeGreaterThan(0);
  expect(await itemCount(page, 'torch')).toBe(0); // out of the bag while worn

  // Unequip: it returns to the pack (plan 051 reverses 049's discard), the slot clears, and the light
  // reverts — nothing destroyed.
  await emit(page, 'equip:toggle', { itemId: 'torch' });
  s = await state(page);
  expect(s.equipment.offHand).toBeNull();
  expect(s.playerLightRadius).toBe(PLAYER_LIGHT);
  expect(await itemCount(page, 'torch')).toBe(1); // back in the pack, NOT discarded

  // Re-equip: it resumes from the STASHED charge (~what it had when unequipped), not a fresh full torch.
  await emit(page, 'equip:toggle', { itemId: 'torch' });
  s = await state(page);
  const resumed = s.equipment.offHand!.durability!;
  expect(resumed).toBeLessThan(TORCH_START); // not reset to full
  expect(resumed).toBeLessThanOrEqual(worn); // at (or just under) the charge it was stashed at
  expect(resumed).toBeGreaterThan(worn - 5); // and not meaningfully more drained than the stash
});
