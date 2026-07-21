import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import { ZOOM_MIN, ZOOM_STEP, clampZoom } from '../zoom';

/** Ready-made React pointer handlers for a pan-only canvas (the Library's `AtlasSheetPicker` case):
 *  a middle-drag or left+Space drag pans the viewport, and pointer capture rides `e.currentTarget`.
 *  A consumer that must interleave panning with its own pointer gestures (the object-editor tab's
 *  `RegionsEditor`, which also draws/moves/resizes boxes) skips these and composes `isPanTrigger` +
 *  `beginPan`/`movePan`/`endPan` into its own handlers instead. */
export interface PanHandlers {
  onCanvasPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onCanvasPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onCanvasPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
}

export interface PanZoom extends PanHandlers {
  /** 1–8× multiplier over the consumer's own base "fit" scale. */
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  /** Space is held while the pointer is over this viewport → a left-drag pans. */
  spaceHeld: boolean;
  /** A pan drag is in flight (drives the grab/grabbing cursor). */
  isPanning: boolean;
  /** The scrollable overflow element. The consumer attaches this to its viewport div AND wires the
   *  hover-tracking `onPointerEnter/Leave` that flip `hoveringRef`. */
  viewportRef: RefObject<HTMLDivElement | null>;
  /** True while the pointer is over the viewport — gates the Space listener so one card/tab never
   *  steals the spacebar from another. The consumer sets it from the viewport's enter/leave. */
  hoveringRef: RefObject<boolean>;
  /** Base pan trigger: middle mouse (any modifier) or left button while Space is held. A consumer
   *  with an extra trigger (e.g. a sticky touch pan toggle) ORs it in. */
  isPanTrigger: (e: ReactPointerEvent) => boolean;
  /** Start/track/stop a pan against the viewport's scroll offset. Pointer capture is the consumer's
   *  responsibility (call sites capture on different nodes), so `beginPan` does not take it. */
  beginPan: (e: ReactPointerEvent) => void;
  movePan: (e: ReactPointerEvent) => void;
  endPan: () => void;
}

/**
 * Shared pan/zoom viewport logic for the editor's zoomable sprite-sheet views (plan 043), lifted
 * verbatim from the twin copies in `AtlasSheetPicker` and `RegionsEditor`:
 *   - a 1–8× `zoom` (see `zoom.ts`) with cursor-anchored WHEEL zoom — the content point under the
 *     pointer stays put across the resize, re-anchored in a layout effect (before paint, no flicker);
 *     the wheel listener is native + non-passive because React's synthetic `onWheel` is passive and
 *     can't `preventDefault` the viewport's own scroll;
 *   - hold-Space (gated on `hoveringRef`) or middle-mouse to pan by writing `scrollLeft/scrollTop`.
 *
 * `scale` (the consumer's base fit-scale × `zoom`) is passed IN rather than computed here: the two
 * call sites derive their fit basis differently (a fixed preview budget vs a measured viewport), but
 * the anchor math only needs the resulting effective scale. Everything else is identical, so it lives
 * here once. Pointer capture is left to the consumer since the two capture on different nodes.
 */
export function usePanZoom(scale: number): PanZoom {
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const hoveringRef = useRef(false);
  const panRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  // Set by a wheel event, consumed by the layout effect below to keep the pointed-at content point
  // stationary across the zoom: `cx/cy` = content-space point under the cursor, `ox/oy` = its pixel
  // offset within the viewport.
  const pendingAnchor = useRef<{ cx: number; cy: number; ox: number; oy: number } | null>(null);

  // Re-anchor scroll after a wheel-zoom changes the canvas size (runs before paint, so no flicker).
  useLayoutEffect(() => {
    const el = viewportRef.current;
    const a = pendingAnchor.current;
    if (!el || !a) return;
    el.scrollLeft = a.cx * scale - a.ox;
    el.scrollTop = a.cy * scale - a.oy;
    pendingAnchor.current = null;
  }, [scale]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      pendingAnchor.current = {
        cx: (el.scrollLeft + ox) / scale,
        cy: (el.scrollTop + oy) / scale,
        ox,
        oy,
      };
      setZoom((z) => clampZoom(z + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale]);

  // Hold Space to pan (middle-mouse-drag works too, unconditionally — see isPanTrigger). Gated on
  // `hoveringRef` rather than global focus so it never steals the spacebar from another card/tab
  // while the pointer's elsewhere on the page.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.code !== 'Space' || e.repeat || !hoveringRef.current) return;
      e.preventDefault();
      setSpaceHeld(true);
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === 'Space') setSpaceHeld(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const isPanTrigger = (e: ReactPointerEvent): boolean =>
    e.button === 1 || (e.button === 0 && spaceHeld);

  function beginPan(e: ReactPointerEvent): void {
    e.preventDefault();
    const el = viewportRef.current;
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: el?.scrollLeft ?? 0,
      startTop: el?.scrollTop ?? 0,
    };
    setIsPanning(true);
  }

  function movePan(e: ReactPointerEvent): void {
    const p = panRef.current;
    if (!p) return;
    const el = viewportRef.current;
    if (el) {
      el.scrollLeft = p.startLeft - (e.clientX - p.startX);
      el.scrollTop = p.startTop - (e.clientY - p.startY);
    }
  }

  function endPan(): void {
    panRef.current = null;
    setIsPanning(false);
  }

  function onCanvasPointerDown(e: ReactPointerEvent<HTMLElement>): void {
    if (!isPanTrigger(e)) return;
    beginPan(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onCanvasPointerMove(e: ReactPointerEvent<HTMLElement>): void {
    movePan(e);
  }

  function onCanvasPointerUp(e: ReactPointerEvent<HTMLElement>): void {
    if (!panRef.current) return;
    endPan();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return {
    zoom,
    setZoom,
    spaceHeld,
    isPanning,
    viewportRef,
    hoveringRef,
    isPanTrigger,
    beginPan,
    movePan,
    endPan,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
  };
}
