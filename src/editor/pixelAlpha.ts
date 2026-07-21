/**
 * Pure canvas alpha-opacity read (plan 43 step 6) — generalises the inline block in
 * `tabs/ObjectEditorTab.tsx` that caches a sheet's alpha channel for client-side double-click
 * region auto-detect (`detectRegionAt`). The DOM/canvas half (create canvas → drawImage → getImageData)
 * stays in the component's effect; this file is just the framework-free RGBA→alpha maths, so it's
 * unit-testable with a synthetic ImageData-like object and never touches the DOM.
 */

/** The subset of the DOM `ImageData` shape this reads: row-major RGBA bytes + dimensions. Accepting a
 *  plain interface (not `ImageData` itself) keeps the module DOM-free and testable. */
export interface RgbaImageData {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** A packed alpha channel: one byte per pixel, row-major, with the source dimensions. */
export interface AlphaChannel {
  readonly data: Uint8Array;
  readonly w: number;
  readonly h: number;
}

/**
 * Extract the alpha channel from RGBA `img` into a compact one-byte-per-pixel `Uint8Array`
 * (row-major). This is the pure core of the editor's alpha cache: `alpha[i] = rgba[i * 4 + 3]`.
 */
export function extractAlphaChannel(img: RgbaImageData): AlphaChannel {
  const { data, width, height } = img;
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  return { data: alpha, w: width, h: height };
}

/**
 * Alpha (0–255) of the pixel at integer (x, y) in a packed `AlphaChannel`. Out-of-bounds coords read
 * as fully transparent (0). The single-pixel companion to `extractAlphaChannel`.
 */
export function alphaAt(channel: AlphaChannel, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= channel.w || y >= channel.h) return 0;
  return channel.data[y * channel.w + x];
}
