/**
 * The one source of truth for the editor's zoomable-sheet bounds (plan 043). Both the Library's
 * `AtlasSheetPicker` and the object-editor tab's `RegionsEditor` scale a full sprite sheet by a
 * base "fit" scale times a 1–8× `zoom` multiplier (via +/− buttons, a slider, or cursor-anchored
 * wheel); they used to carry twinned copies of these constants and the round-clamp. `usePanZoom`
 * consumes these so the two viewports stay in lockstep.
 */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;
export const ZOOM_STEP = 0.5;

/** Snap `z` to the nearest `ZOOM_STEP` and clamp into `[ZOOM_MIN, ZOOM_MAX]`. Keeps the slider,
 *  the +/− buttons, and wheel-zoom all landing on the same discrete stops. */
export const clampZoom = (z: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z / ZOOM_STEP) * ZOOM_STEP));
