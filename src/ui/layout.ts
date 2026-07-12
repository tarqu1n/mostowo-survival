/**
 * Pure geometry helpers for flowing centre-origin UI objects (like {@link ./Button}) so menus stop
 * hand-computing every x/y. They just call setPosition on each item — no container required — and
 * return the array for chaining. `startX`/`startY` are the top-left edge of the *first cell*;
 * `width`/`height` are per-cell, so a centre-origin item lands at edge + half-cell.
 */
type Positionable = { setPosition(x: number, y: number): unknown };

/** Lay items left-to-right. Each advances by `width + gap`; every item's y is set to `y`. */
export function arrangeRow<T extends Positionable>(
  items: T[],
  opts: { startX: number; y: number; width: number; gap: number },
): T[] {
  items.forEach((it, i) =>
    it.setPosition(opts.startX + opts.width / 2 + i * (opts.width + opts.gap), opts.y),
  );
  return items;
}

/** Lay items top-to-bottom. Each advances by `height + gap`; every item's x is set to `x`. */
export function arrangeColumn<T extends Positionable>(
  items: T[],
  opts: { x: number; startY: number; height: number; gap: number },
): T[] {
  items.forEach((it, i) =>
    it.setPosition(opts.x, opts.startY + opts.height / 2 + i * (opts.height + opts.gap)),
  );
  return items;
}

/** Lay items into a `cols`-wide grid, filling left-to-right then top-to-bottom. */
export function arrangeGrid<T extends Positionable>(
  items: T[],
  opts: {
    startX: number;
    startY: number;
    cellW: number;
    cellH: number;
    cols: number;
    gapX: number;
    gapY: number;
  },
): T[] {
  items.forEach((it, i) => {
    const col = i % opts.cols;
    const row = Math.floor(i / opts.cols);
    it.setPosition(
      opts.startX + opts.cellW / 2 + col * (opts.cellW + opts.gapX),
      opts.startY + opts.cellH / 2 + row * (opts.cellH + opts.gapY),
    );
  });
  return items;
}
