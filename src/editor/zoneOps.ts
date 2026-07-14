/**
 * Pure zone-authoring helpers for the map editor (plan 014 step 8). NO Phaser/React imports —
 * Tier-1 vitest-able (`__tests__/zoneOps.test.ts`), mirroring `objectOps.ts`'s posture.
 */

import type { ZoneDef } from '../systems/mapFormat';

/** A small rotating palette so successively-created zones default to visually distinct colours
 *  rather than all landing on the same one; the user can always recolour via the Zones panel. */
const DEFAULT_ZONE_COLOURS = [
  '#88aa44',
  '#4488aa',
  '#aa4488',
  '#aa8844',
  '#44aa88',
  '#8844aa',
] as const;

/** A default colour for the `existingCount`-th zone created (0-indexed) — cycles the palette. */
export function defaultZoneColour(existingCount: number): string {
  return DEFAULT_ZONE_COLOURS[existingCount % DEFAULT_ZONE_COLOURS.length];
}

/** Lowest free zone id in `1..255` (`0` is reserved for "no zone" — see `Zones.cells`), given the
 *  currently-defined zones. Returns `null` if the id space is exhausted (all 255 taken). */
export function nextFreeZoneId(defs: readonly ZoneDef[]): number | null {
  const used = new Set(defs.map((d) => d.id));
  for (let id = 1; id <= 255; id++) {
    if (!used.has(id)) return id;
  }
  return null;
}
