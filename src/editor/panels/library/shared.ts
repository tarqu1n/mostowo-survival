import { TILE_SIZE } from '../../../config';
import type { CatalogRegion } from '../../catalog';
import { cn } from '../../lib/utils';

/**
 * Shared primitives for the Library panel's extracted card/picker modules (plan 043 step 9) — the
 * size constants, `lib*Class` utility strings, and the `isObjectRegion` predicate that several of the
 * split files (`cards`, `AtlasSheetPicker`, `AnimatedStripPicker`) and the composing `LibraryPanel`
 * all reference. Kept in one leaf module so there's a single definition to change.
 */

/** On-screen swatch size for tile frames — an integer upscale of TILE_SIZE for legibility (16→32). */
export const PREVIEW_PX = TILE_SIZE * 2;
/** Compact-viewport swatch size for the same frame grid (plan 027 step 10) — a real tileset sheet can
 *  be many columns wide (e.g. a 25-col Floors sheet), and at `PREVIEW_PX` that's 800px of horizontal
 *  scroll in a ~320px drawer. Shrinking the swatch (rather than reflowing the column count, which
 *  would break the frame grid's 1:1 visual match to the source sheet's own row/col layout) is the
 *  additive lever here — it's a deliberate trade against the ~44px touch-target guideline: a dense
 *  tile-variant picker needs to show many swatches at once to be usable at all, so these stay smaller
 *  and tap-precise rather than touch-ideal (see plan's "note it, don't grind" guidance).  */
export const COMPACT_PREVIEW_PX = 22;

/** A region is object-role — a placeable prop — when it declares `role:'object'` or predates the
 *  `role` field (absent ⇒ object, the plan-028 invariant). Only these arm as decor and occlude the
 *  tile cells they cover; a future `tile`-role region would do neither. On a `tile`-classed mixed
 *  sheet the authored prop regions carry `role:'object'` explicitly; on a plain `object` atlas the
 *  older regions have no `role` and still qualify here. */
export const isObjectRegion = (r: CatalogRegion): boolean =>
  r.role === undefined || r.role === 'object';

/* Shared utility strings for the repeated Library shapes (plan 020 Step 4). Extracting them keeps the
 * per-item JSX terse and gives every card/label/swatch one definition to change. */
export const libLabelClass =
  'flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.75rem]';
export const libSwatchClass =
  'pixelated h-10 w-10 flex-none rounded-[2px] bg-inset bg-contain bg-center bg-no-repeat';
/** `.lib-card`: a full-width row (swatch · label · heart); `is-active` gets the gold ring + surface bg.
 *  `compact` (plan 027 step 10) adds a touch of extra padding/gap so the whole row — already close to
 *  44px tall via `libSwatchClass`'s 40px swatch — comfortably clears the touch-target guideline. */
export const libCardClass = (active: boolean, compact = false): string =>
  cn(
    'flex w-full items-center gap-2 rounded-md border border-transparent p-1 text-left',
    active && 'border-gold-light bg-surface',
    compact && 'gap-3 p-1.5',
  );
