import { useRef, type MouseEvent, type PointerEvent } from 'react';
import { LONGPRESS_MS } from '../../config';

/** Movement (px) past which a press is treated as a scroll/drag, cancelling BOTH tap and long-press —
 *  so dragging to scroll a swatch row or grid neither picks nor favourites. */
const MOVE_CANCEL_PX = 10;

/** The pointer/click handlers to spread onto a target element. `onClick` swallows the trailing
 *  synthetic click (see hook doc), so a caller wiring these must NOT also supply its own `onClick`. */
export interface LongPressHandlers {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerLeave: (e: PointerEvent) => void;
  onPointerCancel: (e: PointerEvent) => void;
  onClick: (e: MouseEvent) => void;
}

/**
 * Touch tap-vs-long-press arbitration off pointer events (plan 030 step 6). ONE gesture source so a
 * long-press can never ALSO fire the tap (critique #2):
 *   - pointerdown starts a `LONGPRESS_MS` timer;
 *   - if it fires first → `onLongPress`, plus a flag that swallows the trailing synthetic click;
 *   - releasing before it (with movement under `MOVE_CANCEL_PX`) → `onTap`, fired from pointerup — and
 *     the synthetic click is swallowed too, so the caller needs (and must have) NO separate `onClick`;
 *   - moving past the threshold, or pointercancel/pointerleave, cancels both (a scroll-drag over the
 *     element does neither).
 * Intended for the compact/touch path only: `pointerdown` does NOT `preventDefault`, so the container
 * can still scroll; on desktop, callers keep their plain `onClick` and simply don't spread these.
 * The hook is always CALLED (rules of hooks) but its handlers are only wired when compact — unwired,
 * it does nothing.
 */
export function useLongPress(opts: {
  onTap: () => void;
  onLongPress: () => void;
}): LongPressHandlers {
  const timer = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  // Both flags cause the tap AND the trailing synthetic click to be swallowed for this gesture.
  const longPressed = useRef(false);
  const cancelled = useRef(false);

  const clearTimer = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return; // primary touch/pen/left-click only; ignore secondary/middle
      longPressed.current = false;
      cancelled.current = false;
      startPos.current = { x: e.clientX, y: e.clientY };
      clearTimer();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        longPressed.current = true;
        opts.onLongPress();
      }, LONGPRESS_MS);
    },
    onPointerMove: (e) => {
      const p = startPos.current;
      if (!p || timer.current === null) return;
      if (
        Math.abs(e.clientX - p.x) > MOVE_CANCEL_PX ||
        Math.abs(e.clientY - p.y) > MOVE_CANCEL_PX
      ) {
        cancelled.current = true;
        clearTimer();
      }
    },
    onPointerUp: () => {
      const wasPending = timer.current !== null; // still pending ⇒ released before the long-press
      clearTimer();
      if (wasPending && !cancelled.current && !longPressed.current) opts.onTap();
      startPos.current = null;
    },
    onPointerLeave: () => {
      cancelled.current = true;
      clearTimer();
    },
    onPointerCancel: () => {
      cancelled.current = true;
      clearTimer();
    },
    onClick: (e) => {
      // The gesture already fired tap/long-press off pointer events; swallow the synthetic click so it
      // can never pick/arm a second time (or pick right after a long-press favourite).
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
