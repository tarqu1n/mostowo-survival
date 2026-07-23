import { HUD_HOTBAR_SLOTS } from '@/config';
import { ITEMS } from '@/data/items';
import { BUILDABLES } from '@/data/buildables';
import type { HotbarSlot } from './store';

/**
 * Hotbar-loadout persistence (plan 046 Step 11). The Field Kit hotbar is a manual-pin loadout that
 * must survive a page reload, so it round-trips to `localStorage`. Pure + Phaser-free: the store holds
 * the live loadout, `useBridge` calls {@link loadHotbar} once at mount to hydrate it and subscribes to
 * persist every change via {@link saveHotbar}.
 *
 * Keyed PER SAVE: the game has no save-slot system yet — it boots a single authored map — so the map
 * id stands in as the save identity (the key scheme extends cleanly once real saves land). Callers
 * pass `START_MAP_ID`.
 *
 * Tolerance: a persisted entry is dropped to an empty slot if its id no longer resolves in `ITEMS` /
 * `BUILDABLES` (stale data after a content change). An item the player doesn't currently OWN is NOT
 * dropped — a pinned-but-unstocked slot is valid (it just renders/uses as unavailable), matching the
 * plan's "persisted loadout must tolerate items no longer owned".
 */

const PREFIX = 'mostowo-hud:hotbar:';

/** `globalThis.localStorage`, or `null` if unavailable / access throws (mirrors editor/sessionStore). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const key = (saveId: string): string => `${PREFIX}${saveId}`;

/** Does this pinned entry still resolve to a real item/buildable? Guards against stale persisted ids. */
function isKnown(slot: NonNullable<HotbarSlot>): boolean {
  return slot.kind === 'item' ? slot.id in ITEMS : slot.id in BUILDABLES;
}

/** Coerce one parsed JSON element into a valid {@link HotbarSlot} (empty slot on anything unexpected). */
function coerceSlot(raw: unknown): HotbarSlot {
  if (raw === null || typeof raw !== 'object') return null;
  const { kind, id } = raw as { kind?: unknown; id?: unknown };
  if ((kind !== 'item' && kind !== 'buildable') || typeof id !== 'string') return null;
  const slot: NonNullable<HotbarSlot> = { kind, id };
  return isKnown(slot) ? slot : null;
}

/**
 * The persisted loadout for `saveId`, normalised to exactly `HUD_HOTBAR_SLOTS` slots, or `null` if
 * none is stored / storage is unavailable / the record is unreadable. A malformed record is treated as
 * absent (returns `null`) rather than throwing, so a bad write can never brick the HUD.
 */
export function loadHotbar(saveId: string): HotbarSlot[] | null {
  const s = storage();
  if (!s) return null;
  let parsed: unknown;
  try {
    const raw = s.getItem(key(saveId));
    if (raw === null) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return Array.from({ length: HUD_HOTBAR_SLOTS }, (_, i) => coerceSlot(parsed[i]));
}

/** Persist `slots` for `saveId`. Silently no-ops if storage is unavailable or the write throws (quota
 *  / private mode) — persistence is best-effort and never blocks the in-memory loadout. */
export function saveHotbar(saveId: string, slots: readonly HotbarSlot[]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key(saveId), JSON.stringify(slots));
  } catch {
    // ignore — best-effort
  }
}
