import type { NpcDayRole, NpcNightPosture } from '../entities/NpcCharacter';

/**
 * The NPC-companion assignment menu, as a pure Phaser-free MODEL (plan 042 Step 9) — the sections,
 * labelled options, and which companion setter each option drives. UIScene builds the actual
 * Container-based popover ({@link ../ui} kit) off this list, and GameScene owns the setters the
 * options route to (`setNpcDayRole`/`setNpcNightPosture` + the `beginPlaceGuard` arm-then-place mode),
 * the SAME path the Step-2 `__test` seams call — so the menu and the harness stay in lockstep. Kept
 * data-only + framework-free so it unit-tests in plain Node (no Phaser), mirroring `src/data`.
 *
 * A `dayRole`/`nightPosture` option sets that field live; the single `guardHere` option is special —
 * it arms a one-tap "place the guard point" mode (the next world tap sets the point AND
 * `nightPosture='guard'`), so it carries no value of its own.
 */
export type NpcMenuOption =
  | { readonly kind: 'dayRole'; readonly label: string; readonly value: NpcDayRole }
  | { readonly kind: 'nightPosture'; readonly label: string; readonly value: NpcNightPosture }
  | { readonly kind: 'guardHere'; readonly label: string };

export interface NpcMenuSection {
  readonly title: string;
  readonly options: readonly NpcMenuOption[];
}

/** The two labelled sections: a DAY job (Gather / Repair) and a NIGHT posture (Guard here / Follow /
 *  Refuel lights). "Guard here" leads the night list because it's the base-defence default. */
export const NPC_MENU_SECTIONS: readonly NpcMenuSection[] = [
  {
    title: 'DAY',
    options: [
      { kind: 'dayRole', label: 'Gather', value: 'gather' },
      { kind: 'dayRole', label: 'Repair', value: 'repair' },
    ],
  },
  {
    title: 'NIGHT',
    options: [
      { kind: 'guardHere', label: 'Guard here' },
      { kind: 'nightPosture', label: 'Follow', value: 'follow' },
      { kind: 'nightPosture', label: 'Refuel lights', value: 'refuel' },
    ],
  },
];

/** Whether `option` is the companion's currently-active assignment — used to highlight the live row
 *  when the menu opens. `guardHere` is active whenever the night posture is `guard` (the point it
 *  places is the same posture), so re-opening the menu on a posted guard shows it selected. */
export function isNpcMenuOptionActive(
  option: NpcMenuOption,
  current: { dayRole: NpcDayRole; nightPosture: NpcNightPosture },
): boolean {
  switch (option.kind) {
    case 'dayRole':
      return option.value === current.dayRole;
    case 'nightPosture':
      return option.value === current.nightPosture;
    case 'guardHere':
      return current.nightPosture === 'guard';
  }
}
