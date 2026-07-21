import { describe, it, expect } from 'vitest';
import { NPC_MENU_SECTIONS, isNpcMenuOptionActive, type NpcMenuOption } from './npcMenu';

// Pure-model tests (plan 042 Step 9): the assignment menu's sections/options + the active-row
// predicate. Framework-free (no Phaser) — UIScene builds the popover off this list and GameScene owns
// the setters each option routes to (the SAME path as the Step-2 `__test` seams), so verifying the
// model here + the shared-setter wiring is the deterministic half of the step's coverage; the visual
// open/close/tap is manual-verify (pointer→sprite mapping is flaky under parallel Playwright load).

const allOptions = (): NpcMenuOption[] => NPC_MENU_SECTIONS.flatMap((s) => [...s.options]);

describe('NPC_MENU_SECTIONS', () => {
  it('has exactly a DAY and a NIGHT section, in that order', () => {
    expect(NPC_MENU_SECTIONS.map((s) => s.title)).toEqual(['DAY', 'NIGHT']);
  });

  it('DAY offers Gather + Repair mapped to the two day roles', () => {
    const day = NPC_MENU_SECTIONS[0].options;
    expect(day).toEqual([
      { kind: 'dayRole', label: 'Gather', value: 'gather' },
      { kind: 'dayRole', label: 'Repair', value: 'repair' },
    ]);
  });

  it('NIGHT offers Guard here + the follow/refuel postures', () => {
    const night = NPC_MENU_SECTIONS[1].options;
    expect(night).toEqual([
      { kind: 'guardHere', label: 'Guard here' },
      { kind: 'nightPosture', label: 'Follow', value: 'follow' },
      { kind: 'nightPosture', label: 'Refuel lights', value: 'refuel' },
    ]);
  });

  it('every option carries a non-empty label', () => {
    for (const o of allOptions()) expect(o.label.length).toBeGreaterThan(0);
  });

  it('covers both day roles and all three night postures exactly once', () => {
    const dayValues = allOptions().flatMap((o) => (o.kind === 'dayRole' ? [o.value] : []));
    const postureValues = allOptions().flatMap((o) => (o.kind === 'nightPosture' ? [o.value] : []));
    expect(dayValues.sort()).toEqual(['gather', 'repair']);
    // 'guard' is reached via the special guardHere arm-then-place option, not a plain posture button.
    expect(postureValues.sort()).toEqual(['follow', 'refuel']);
    expect(allOptions().filter((o) => o.kind === 'guardHere')).toHaveLength(1);
  });
});

describe('isNpcMenuOptionActive', () => {
  it('highlights the day-role row matching the current role', () => {
    const current = { dayRole: 'repair' as const, nightPosture: 'follow' as const };
    const gather = { kind: 'dayRole', label: 'Gather', value: 'gather' } as const;
    const repair = { kind: 'dayRole', label: 'Repair', value: 'repair' } as const;
    expect(isNpcMenuOptionActive(gather, current)).toBe(false);
    expect(isNpcMenuOptionActive(repair, current)).toBe(true);
  });

  it('highlights the posture row matching the current posture', () => {
    const current = { dayRole: 'gather' as const, nightPosture: 'refuel' as const };
    const follow = { kind: 'nightPosture', label: 'Follow', value: 'follow' } as const;
    const refuel = { kind: 'nightPosture', label: 'Refuel lights', value: 'refuel' } as const;
    expect(isNpcMenuOptionActive(follow, current)).toBe(false);
    expect(isNpcMenuOptionActive(refuel, current)).toBe(true);
  });

  it('highlights Guard here exactly when the posture is guard', () => {
    const guardHere = { kind: 'guardHere', label: 'Guard here' } as const;
    expect(isNpcMenuOptionActive(guardHere, { dayRole: 'gather', nightPosture: 'guard' })).toBe(
      true,
    );
    expect(isNpcMenuOptionActive(guardHere, { dayRole: 'gather', nightPosture: 'follow' })).toBe(
      false,
    );
  });
});
