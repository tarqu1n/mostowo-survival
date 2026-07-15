/**
 * Pure helpers for the "Node Types" authoring panel (plan 021 step 8) — kept Phaser/React-free so
 * they're plain-Node testable (mirrors the rest of `src/editor/*Ops.ts`). Two concerns:
 *  - `color`/`stumpColor` on `AuthoredNodeDef` are decimal ints (JSON has no hex literal) — the form
 *    edits them as `#rrggbb` via an `<input type="color">`, so this module carries the round-trip.
 *  - `validateNodeDefPatch` builds the exact candidate `editorStore`'s own `updateNodeDef` would
 *    build (this def's raw fields merged with `patch`, spliced back into the full `nodeDefs` array)
 *    and runs it through the SAME `parseNodeDefs` choke point, so the stats form can show a live
 *    inline error / disable its Save button BEFORE the user commits — without inventing a second
 *    validation source of truth. Never throws; callers get `null` (valid) or the thrown message.
 */

import { parseNodeDefs, type AuthoredNodeDef } from '../systems/nodeDefs';
import { parseAssetId, tilesetAssetUrl } from './textureLoading';

/** Decimal int (as stored on `AuthoredNodeDef.color`/`stumpColor`) → `#rrggbb` for an
 *  `<input type="color">`. Clamped into the 24-bit range so a stray out-of-range value (shouldn't
 *  happen — `parseNodeDefs` only requires an integer, not a 0..0xffffff range) still renders
 *  something instead of a malformed hex string. */
export function colorToHex(n: number): string {
  const clamped = Math.max(0, Math.min(0xffffff, Math.trunc(n)));
  return `#${clamped.toString(16).padStart(6, '0')}`;
}

/** `#rrggbb` (or `#rgb`) → decimal int. Returns `0` for anything unparseable — callers always feed
 *  this a browser-produced `<input type="color">` value, which is always a well-formed `#rrggbb`. */
export function hexToColor(hex: string): number {
  const cleaned = hex.trim().replace(/^#/, '');
  const n = Number.parseInt(cleaned, 16);
  return Number.isFinite(n) ? n : 0;
}

/** Builds the candidate `nodeDefs` array `editorStore.updateNodeDef(defId, patch)` would build
 *  (this def's scalar fields merged with `patch`, skins left untouched, spliced back into
 *  `allDefs`) and runs it through `parseNodeDefs` — the single validation choke point. Returns
 *  `null` when the candidate is valid, else the thrown message (a precise `<path> <problem>` string
 *  — see `nodeDefs.ts`'s module doc). Used by the stats form to show a live error / gate its Save
 *  button on every keystroke, without duplicating any of `parseNodeDefs`'s actual rules. */
export function validateNodeDefPatch(
  allDefs: AuthoredNodeDef[],
  defId: string,
  patch: Partial<Omit<AuthoredNodeDef, 'id' | 'skins'>>,
): string | null {
  const index = allDefs.findIndex((d) => d.id === defId);
  if (index < 0) return `node def "${defId}" not found`;
  const candidate = allDefs.slice();
  candidate[index] = { ...candidate[index], ...patch, id: defId, skins: candidate[index].skins };
  try {
    parseNodeDefs({ version: 1, defs: candidate });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Resolves a skin/decor-style `asset` id (`<pack>/path`) to its source image URL — `null` (never
 *  throws) for anything `parseAssetId` can't parse, most notably the Node Types panel's
 *  `PLACEHOLDER_SKIN_ASSET` sentinel (a freshly-created def's skin before its author picks a real
 *  sprite). Deliberately kept in this Phaser/React-free module rather than inlined in
 *  `LibraryPanel.tsx`'s `nodePreviewUrl` (which calls this): `LibraryPanel.tsx` is a component file
 *  Vite's react-refresh plugin fast-refreshes, and it only allows COMPONENT exports from such a file
 *  — a stray non-component export (this used to be one, exported for testing) invalidates fast
 *  refresh for the whole file and forces a heavier remount on every edit. Exporting this pure resolver
 *  from here instead keeps `LibraryPanel.tsx`'s export list component-only while still being directly
 *  unit-testable (see `nodeTypesUi.test.ts`). */
export function resolveSkinPreviewUrl(assetId: string): string | null {
  try {
    const { pack, path } = parseAssetId(assetId);
    return tilesetAssetUrl(pack, path);
  } catch {
    return null;
  }
}
