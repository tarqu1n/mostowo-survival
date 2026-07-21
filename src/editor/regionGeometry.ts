/**
 * Pure box-geometry helpers for the object-editor's Regions canvas (plan 43 step 6) — lifted VERBATIM
 * in behaviour from `tabs/ObjectEditorTab.tsx` so the drag maths lives as small unit-testable functions
 * instead of inline in the React component (`__tests__/regionGeometry.test.ts`). Sibling of `regions.ts`
 * (which owns the integer grid/seed/sanitise maths); this file owns the live pointer-drag arithmetic:
 * normalising a drawn rect, clamping, and resizing a box from one of its eight handles.
 *
 * A `Box` is the bare `{x,y,w,h}` rect `pack.json` stores — reused from `regions.ts` so the editor and
 * the wire shape speak one type.
 */
import type { Box } from './regions';

/** One of the eight resize grips on a selected box: corners + edge midpoints. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Clamp `v` into `[lo, hi]`. No rounding — callers pass already-integral sheet coords. */
export const clampN = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Box spanning two anchor points (draw), normalised so w/h are non-negative. */
export function normRect(ax: number, ay: number, bx: number, by: number): Box {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** New box from dragging `handle` to sheet-point (sx,sy), keeping the opposite edge(s) fixed and
 *  clamped in-bounds with a 1px minimum on the moving edge. */
export function resizeBox(
  orig: Box,
  handle: Handle,
  sx: number,
  sy: number,
  w: number,
  h: number,
): Box {
  let left = orig.x;
  let right = orig.x + orig.w;
  let top = orig.y;
  let bottom = orig.y + orig.h;
  if (handle === 'nw' || handle === 'w' || handle === 'sw') left = clampN(sx, 0, right - 1);
  if (handle === 'ne' || handle === 'e' || handle === 'se') right = clampN(sx, left + 1, w);
  if (handle === 'nw' || handle === 'n' || handle === 'ne') top = clampN(sy, 0, bottom - 1);
  if (handle === 'sw' || handle === 's' || handle === 'se') bottom = clampN(sy, top + 1, h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}
