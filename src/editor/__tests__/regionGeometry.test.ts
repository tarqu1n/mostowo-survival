import { describe, it, expect } from 'vitest';
import { clampN, normRect, resizeBox, type Handle } from '../regionGeometry';
import { alphaAt, extractAlphaChannel, type AlphaChannel, type RgbaImageData } from '../pixelAlpha';

describe('clampN', () => {
  it('passes a value already within bounds through unchanged', () => {
    expect(clampN(5, 0, 10)).toBe(5);
  });

  it('clamps below the lower bound up to lo', () => {
    expect(clampN(-3, 0, 10)).toBe(0);
  });

  it('clamps above the upper bound down to hi', () => {
    expect(clampN(42, 0, 10)).toBe(10);
  });

  it('returns the bounds themselves at the edges', () => {
    expect(clampN(0, 0, 10)).toBe(0);
    expect(clampN(10, 0, 10)).toBe(10);
  });

  it('does NOT round — fractional inputs pass through when in range', () => {
    expect(clampN(2.5, 0, 10)).toBe(2.5);
  });
});

describe('normRect', () => {
  it('leaves an already-normal rect (b below-right of a) unchanged', () => {
    expect(normRect(2, 3, 12, 9)).toEqual({ x: 2, y: 3, w: 10, h: 6 });
  });

  it('normalises an inverted drag (b above-left of a) to positive w/h', () => {
    expect(normRect(12, 9, 2, 3)).toEqual({ x: 2, y: 3, w: 10, h: 6 });
  });

  it('normalises an x-inverted-only drag', () => {
    expect(normRect(12, 3, 2, 9)).toEqual({ x: 2, y: 3, w: 10, h: 6 });
  });

  it('yields a zero-size rect for coincident anchors', () => {
    expect(normRect(5, 5, 5, 5)).toEqual({ x: 5, y: 5, w: 0, h: 0 });
  });

  it('handles a zero-width but non-zero-height drag', () => {
    expect(normRect(5, 2, 5, 8)).toEqual({ x: 5, y: 2, w: 0, h: 6 });
  });
});

describe('resizeBox', () => {
  // A 10x10 box at (10,10) inside a 100x100 sheet, resized from each handle.
  const orig = { x: 10, y: 10, w: 10, h: 10 };
  const W = 100;
  const H = 100;

  it('e: moves only the right edge', () => {
    expect(resizeBox(orig, 'e', 40, 999, W, H)).toEqual({ x: 10, y: 10, w: 30, h: 10 });
  });

  it('w: moves only the left edge, keeping the right fixed', () => {
    expect(resizeBox(orig, 'w', 4, 999, W, H)).toEqual({ x: 4, y: 10, w: 16, h: 10 });
  });

  it('n: moves only the top edge, keeping the bottom fixed', () => {
    expect(resizeBox(orig, 'n', 4, 4, W, H)).toEqual({ x: 10, y: 4, w: 10, h: 16 });
  });

  it('s: moves only the bottom edge', () => {
    expect(resizeBox(orig, 's', 999, 40, W, H)).toEqual({ x: 10, y: 10, w: 10, h: 30 });
  });

  it('se: moves right + bottom edges together', () => {
    expect(resizeBox(orig, 'se', 50, 60, W, H)).toEqual({ x: 10, y: 10, w: 40, h: 50 });
  });

  it('nw: moves left + top edges together', () => {
    expect(resizeBox(orig, 'nw', 2, 3, W, H)).toEqual({ x: 2, y: 3, w: 18, h: 17 });
  });

  it('ne: moves right + top edges together', () => {
    expect(resizeBox(orig, 'ne', 50, 3, W, H)).toEqual({ x: 10, y: 3, w: 40, h: 17 });
  });

  it('sw: moves left + bottom edges together', () => {
    expect(resizeBox(orig, 'sw', 2, 60, W, H)).toEqual({ x: 2, y: 10, w: 18, h: 50 });
  });

  it('clamps the right edge to the sheet width', () => {
    expect(resizeBox(orig, 'e', 999, 0, W, H)).toEqual({ x: 10, y: 10, w: W - 10, h: 10 });
  });

  it('clamps the left edge to 0', () => {
    expect(resizeBox(orig, 'w', -50, 0, W, H)).toEqual({ x: 0, y: 10, w: 20, h: 10 });
  });

  it('enforces a 1px minimum when the moving edge crosses the fixed one (e past left)', () => {
    // Dragging the right edge left past x=10 clamps to left+1 = 11 → w = 1.
    expect(resizeBox(orig, 'e', 0, 0, W, H)).toEqual({ x: 10, y: 10, w: 1, h: 10 });
  });

  it('enforces a 1px minimum when the left edge is dragged past the right', () => {
    // Dragging the left edge right past x=20 clamps to right-1 = 19 → w = 1.
    expect(resizeBox(orig, 'w', 999, 0, W, H)).toEqual({ x: 19, y: 10, w: 1, h: 10 });
  });

  it('accepts every handle in the union without widening the type', () => {
    const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    for (const h of handles) expect(resizeBox(orig, h, 15, 15, W, H)).toBeDefined();
  });
});

/** Build an RGBA ImageData-like from per-pixel alpha bytes (RGB left 0) for the alpha tests. */
function rgbaFromAlpha(alpha: number[], width: number, height: number): RgbaImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < alpha.length; i++) data[i * 4 + 3] = alpha[i];
  return { data, width, height };
}

describe('extractAlphaChannel', () => {
  it('packs the alpha byte of each RGBA pixel row-major', () => {
    const img = rgbaFromAlpha([0, 64, 128, 255], 2, 2);
    const ch = extractAlphaChannel(img);
    expect(ch.w).toBe(2);
    expect(ch.h).toBe(2);
    expect(Array.from(ch.data)).toEqual([0, 64, 128, 255]);
  });

  it('returns an empty channel for a zero-size image', () => {
    const ch = extractAlphaChannel({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
    expect(ch.data.length).toBe(0);
  });
});

describe('alphaAt', () => {
  const ch: AlphaChannel = { data: new Uint8Array([0, 64, 128, 255]), w: 2, h: 2 };

  it('reads the alpha at integer coords', () => {
    expect(alphaAt(ch, 0, 0)).toBe(0);
    expect(alphaAt(ch, 1, 0)).toBe(64);
    expect(alphaAt(ch, 0, 1)).toBe(128);
    expect(alphaAt(ch, 1, 1)).toBe(255);
  });

  it('reads out-of-bounds coords as fully transparent', () => {
    expect(alphaAt(ch, -1, 0)).toBe(0);
    expect(alphaAt(ch, 0, -1)).toBe(0);
    expect(alphaAt(ch, 2, 0)).toBe(0);
    expect(alphaAt(ch, 0, 2)).toBe(0);
  });
});
