import { describe, it, expect } from 'vitest';
import type { CatalogAsset } from '../catalog';
import { detectRegionAt, sanitiseClientRegions, seedRegions, sliceBox, type Box } from '../regions';

/** A minimal `CatalogAsset` for the region helpers (only `w`/`h`/`regions` are read). */
function asset(over: Partial<CatalogAsset> = {}): CatalogAsset {
  return {
    id: 'pack/Environment/Props/Static/Farm.png',
    pack: 'pack',
    type: 'object',
    source: { kind: 'image', path: 'Environment/Props/Static/Farm.png' },
    w: 400,
    h: 400,
    category: 'misc',
    tags: [],
    ...over,
  };
}

/** Sum of cell areas, for the "tiles exactly" assertions below. */
function totalArea(boxes: Box[]): number {
  return boxes.reduce((sum, b) => sum + b.w * b.h, 0);
}

describe('sliceBox', () => {
  it('slices an evenly-divisible box into equal cells that tile it exactly', () => {
    const cells = sliceBox({ x: 0, y: 0, w: 100, h: 50 }, 2, 1);
    expect(cells).toEqual([
      { x: 0, y: 0, w: 50, h: 50 },
      { x: 50, y: 0, w: 50, h: 50 },
    ]);
  });

  it('distributes the remainder on a non-divisible span with no gaps or overlaps', () => {
    const cells = sliceBox({ x: 0, y: 0, w: 10, h: 10 }, 3, 1);
    // Boundaries round(0,3.33,6.67,10) = 0,3,7,10 → widths 3,4,3 summing to the full 10.
    expect(cells.map((c) => c.w)).toEqual([3, 4, 3]);
    // Cells are edge-to-edge: each cell starts where the previous ended, last ends at the box's edge.
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i].x).toBe(cells[i - 1].x + cells[i - 1].w);
    }
    expect(cells[cells.length - 1].x + cells[cells.length - 1].w).toBe(10);
    expect(totalArea(cells)).toBe(10 * 10);
  });

  it('slices a multi-row grid in row-major order, honouring the box offset', () => {
    const cells = sliceBox({ x: 5, y: 5, w: 20, h: 20 }, 2, 2);
    expect(cells).toEqual([
      { x: 5, y: 5, w: 10, h: 10 },
      { x: 15, y: 5, w: 10, h: 10 },
      { x: 5, y: 15, w: 10, h: 10 },
      { x: 15, y: 15, w: 10, h: 10 },
    ]);
  });

  it('coerces cols/rows below 1 up to a single cell', () => {
    expect(sliceBox({ x: 0, y: 0, w: 8, h: 8 }, 0, 0)).toEqual([{ x: 0, y: 0, w: 8, h: 8 }]);
  });
});

describe('seedRegions', () => {
  it('seeds from the asset regions, dropping the catalog key', () => {
    const boxes = seedRegions(
      asset({
        regions: [
          { key: '10_20', x: 10, y: 20, w: 30, h: 40 },
          { key: '50_60', x: 50, y: 60, w: 8, h: 8 },
        ],
      }),
    );
    expect(boxes).toEqual([
      { x: 10, y: 20, w: 30, h: 40 },
      { x: 50, y: 60, w: 8, h: 8 },
    ]);
  });

  it('seeds one whole-sheet box when the asset has no regions', () => {
    expect(seedRegions(asset({ w: 400, h: 320 }))).toEqual([{ x: 0, y: 0, w: 400, h: 320 }]);
    expect(seedRegions(asset({ regions: [] }))).toEqual([{ x: 0, y: 0, w: 400, h: 400 }]);
  });
});

describe('sanitiseClientRegions', () => {
  it('passes a valid in-bounds box through, rounding floats', () => {
    expect(sanitiseClientRegions([{ x: 1.4, y: 2.6, w: 9.5, h: 10.2 }], 400, 400)).toEqual([
      { x: 1, y: 3, w: 10, h: 10 },
    ]);
  });

  it('clamps a box that overhangs the sheet back in-bounds', () => {
    expect(sanitiseClientRegions([{ x: 390, y: 390, w: 50, h: 50 }], 400, 400)).toEqual([
      { x: 390, y: 390, w: 10, h: 10 },
    ]);
  });

  it('drops degenerate (zero-size) boxes but keeps the rest', () => {
    const out = sanitiseClientRegions(
      [
        { x: 0, y: 0, w: 0, h: 5 },
        { x: 10, y: 10, w: 20, h: 20 },
        { x: 5, y: 5, w: 5, h: 0 },
      ],
      400,
      400,
    );
    expect(out).toEqual([{ x: 10, y: 10, w: 20, h: 20 }]);
  });

  it('returns an empty list unchanged (the auto-detect reset case)', () => {
    expect(sanitiseClientRegions([], 400, 400)).toEqual([]);
  });
});

describe('detectRegionAt', () => {
  /** An `w*h` alpha mask (row-major) with the given [x,y] pixels set fully opaque, rest transparent. */
  function mask(w: number, h: number, opaque: Array<[number, number]>): Uint8Array {
    const a = new Uint8Array(w * h);
    for (const [x, y] of opaque) a[y * w + x] = 255;
    return a;
  }

  it('detects the tight box of the solid blob under the click', () => {
    const a = mask(5, 5, [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]);
    expect(detectRegionAt(a, 5, 5, 1, 1)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    // Any pixel of the blob seeds the same box.
    expect(detectRegionAt(a, 5, 5, 2, 2)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
  });

  it('returns null when the click lands on empty space beyond the seed radius', () => {
    const a = mask(9, 9, [[8, 8]]);
    expect(detectRegionAt(a, 9, 9, 0, 0)).toBeNull();
  });

  it('stays tight by default (gap=0) and only bridges a transparent seam when asked (gap>0)', () => {
    // Two opaque pixels one transparent pixel apart on the same row — the packed-neighbour case.
    const a = mask(5, 3, [
      [1, 1],
      [3, 1],
    ]);
    // Default: tight — grabs only the clicked pixel's blob, does NOT reach across the seam.
    expect(detectRegionAt(a, 5, 3, 1, 1)).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    // Opt in to bridging with gap:1 → the two merge.
    expect(detectRegionAt(a, 5, 3, 1, 1, { gap: 1 })).toEqual({ x: 1, y: 1, w: 3, h: 1 });
  });

  it('does not merge two separate blobs the click is not part of', () => {
    const a = mask(10, 10, [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [8, 8],
      [9, 8],
      [8, 9],
      [9, 9],
    ]);
    expect(detectRegionAt(a, 10, 10, 0, 0)).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(detectRegionAt(a, 10, 10, 9, 9)).toEqual({ x: 8, y: 8, w: 2, h: 2 });
  });

  it('snaps a near-miss click to the nearest opaque pixel (seedRadius) without widening the box', () => {
    const a = mask(5, 5, [[3, 2]]);
    // Click at (2,2): transparent, but one pixel from the real (3,2) → snaps and detects the tight box.
    expect(detectRegionAt(a, 5, 5, 2, 2)).toEqual({ x: 3, y: 2, w: 1, h: 1 });
    // With no tolerance the same near-miss finds nothing.
    expect(detectRegionAt(a, 5, 5, 2, 2, { seedRadius: 0 })).toBeNull();
  });

  it('honours minArea — a lone speck is kept by default but droppable via the option', () => {
    const a = mask(5, 5, [[2, 2]]);
    expect(detectRegionAt(a, 5, 5, 2, 2)).toEqual({ x: 2, y: 2, w: 1, h: 1 });
    expect(detectRegionAt(a, 5, 5, 2, 2, { minArea: 4 })).toBeNull();
  });

  it('clamps an out-of-bounds click into the sheet before seeding', () => {
    const a = mask(4, 4, [[3, 3]]);
    expect(detectRegionAt(a, 4, 4, 99, 99)).toEqual({ x: 3, y: 3, w: 1, h: 1 });
  });
});
