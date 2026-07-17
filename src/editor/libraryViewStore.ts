/**
 * localStorage persistence for the Library panel's view-state (plan XXX step 1) — Phaser-free, no
 * `MapFile` import: recents/browse-state are pure editor view-state, never map data. Modelled on
 * `underlayStore.ts`: same `storage()` guard, per-map keys under a `mostowo-editor-library:` prefix,
 * every read degrades to `[]`/`null` on a parse or availability failure, every write swallows its
 * errors (quota / disabled storage is non-fatal — the panel just won't persist for this map).
 *
 * Two namespaces, both keyed by `mapId`:
 *   - **recents** (`…:recents:<mapId>`) — an MRU list of library picks (tiles/decor/nodes/terrain),
 *     deduped and capped via `pushRecent`.
 *   - **browse** (`…:browse:<mapId>`) — the panel's search/filter/expansion state. `search` is
 *     deliberately excluded from the persisted shape (critique #4): it's noisy to write on every
 *     keystroke and shouldn't survive a reload, only a close/reopen within the same session, so it
 *     lives in the store's in-memory state only. `putBrowse` accepts the full in-memory
 *     `LibraryBrowseState` (so callers don't have to strip `search` themselves) but only writes the
 *     `PersistedBrowse` subset; `getBrowse` returns that same persisted subset, and the store (a
 *     later step) rehydrates it with `search: ''`.
 */

import type { DecorAnim, DecorRegion } from '../systems/mapFormat';

/** A single library pick worth remembering. `assetId`/`ref`/`id` are the respective catalog keys;
 *  `region`/`anim` narrow a decor entry to a specific sheet-crop or animation-strip variant so those
 *  are treated as distinct recents from the plain sheet (see `recentIdentity`). */
export type RecentEntry =
  | { kind: 'tile'; assetId: string }
  | { kind: 'decor'; assetId: string; region?: DecorRegion; anim?: Omit<DecorAnim, 'fps'> }
  | { kind: 'node'; ref: string }
  | { kind: 'terrain'; id: string };

/** In-memory Library panel browse state. `search` is transient — see module doc. */
export interface LibraryBrowseState {
  search: string;
  selectedPack: string | null;
  selectedCategory: string | null;
  expandedPacks: string[];
}

/** The subset of `LibraryBrowseState` that actually reaches disk — `search` omitted by design. */
export type PersistedBrowse = Omit<LibraryBrowseState, 'search'>;

/** Cap on the number of recents kept per map (oldest beyond this are dropped). */
export const RECENTS_CAP = 24;

const PREFIX = 'mostowo-editor-library:';
const recentsKey = (mapId: string) => `${PREFIX}recents:${mapId}`;
const browseKey = (mapId: string) => `${PREFIX}browse:${mapId}`;

/** `globalThis.localStorage`, or `null` if it's unavailable or even *accessing* it throws (some
 *  browsers throw on the property access itself when storage is disabled). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// ---- pure helpers (no storage access) ----

/** Stable dedupe key for a recent entry: kind + the relevant id, plus a serialized
 *  region/anim for decor so a plain sheet and a specific region/anim crop of the *same* sheet are
 *  distinct recents rather than collapsing into one. */
export function recentIdentity(entry: RecentEntry): string {
  switch (entry.kind) {
    case 'tile':
      return `tile:${entry.assetId}`;
    case 'decor':
      return `decor:${entry.assetId}:${JSON.stringify(entry.region ?? null)}:${JSON.stringify(entry.anim ?? null)}`;
    case 'node':
      return `node:${entry.ref}`;
    case 'terrain':
      return `terrain:${entry.id}`;
  }
}

/** Push `entry` onto `list` as most-recent: an existing entry (by `recentIdentity`) moves to the
 *  front instead of duplicating, and the result is capped at `cap`. Returns a **new** array —
 *  `list` is never mutated. */
export function pushRecent(
  list: RecentEntry[],
  entry: RecentEntry,
  cap = RECENTS_CAP,
): RecentEntry[] {
  const id = recentIdentity(entry);
  const rest = list.filter((e) => recentIdentity(e) !== id);
  return [entry, ...rest].slice(0, cap);
}

// ---- recents (by mapId) ----

/** Persisted recents for `mapId`, most-recent-first, or `[]` if none / unreadable / malformed. */
export function getRecents(mapId: string): RecentEntry[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(recentsKey(mapId));
    if (raw === null) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

export function putRecents(mapId: string, list: RecentEntry[]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(recentsKey(mapId), JSON.stringify(list));
  } catch {
    // Recents are a convenience cache; a failure here (quota/availability) is non-fatal.
  }
}

export function deleteRecents(mapId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(recentsKey(mapId));
  } catch {
    // no-op
  }
}

// ---- browse state (by mapId) ----

/** Persisted browse state for `mapId` (never includes `search`), or `null` if none / unreadable /
 *  malformed. The store rehydrates this with `search: ''`. */
export function getBrowse(mapId: string): PersistedBrowse | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(browseKey(mapId));
    if (raw === null) return null;
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== 'object' || obj === null) return null;
    return obj as PersistedBrowse;
  } catch {
    return null;
  }
}

/** Persists the subset of `state` that survives reload — `search` is stripped before writing (see
 *  module doc). Accepts the full in-memory `LibraryBrowseState` so callers can pass their state
 *  straight through without stripping it themselves. */
export function putBrowse(mapId: string, state: LibraryBrowseState): void {
  const s = storage();
  if (!s) return;
  const { selectedPack, selectedCategory, expandedPacks }: PersistedBrowse = state;
  const persisted: PersistedBrowse = { selectedPack, selectedCategory, expandedPacks };
  try {
    s.setItem(browseKey(mapId), JSON.stringify(persisted));
  } catch {
    // Browse state is tiny; a failure here (quota/availability) is non-fatal.
  }
}

export function deleteBrowse(mapId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(browseKey(mapId));
  } catch {
    // no-op
  }
}
