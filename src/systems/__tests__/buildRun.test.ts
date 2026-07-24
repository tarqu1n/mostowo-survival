import { describe, it, expect } from 'vitest';
import { runAxis, runTiles, selectRun, type RunTile } from '../buildRun';

const cell = (col: number, row: number) => ({ col, row });
const at = (tiles: readonly RunTile[]) => tiles.map((t) => `${t.col},${t.row}`);

describe('runAxis / runTiles (axis-lock + dedupe)', () => {
  it('locks a mostly-horizontal drag to the anchor row (column varies)', () => {
    const anchor = cell(2, 5);
    expect(runAxis(anchor, cell(6, 6))).toBe('horizontal'); // |dCol|=4 > |dRow|=1
    const tiles = runTiles(anchor, cell(6, 6));
    expect(tiles.every((t) => t.row === 5)).toBe(true); // snapped to anchor row, drag row ignored
    expect(at(tiles)).toEqual(['2,5', '3,5', '4,5', '5,5', '6,5']);
  });

  it('locks a mostly-vertical drag to the anchor column (row varies)', () => {
    const anchor = cell(2, 5);
    expect(runAxis(anchor, cell(3, 1))).toBe('vertical'); // |dRow|=4 > |dCol|=1
    const tiles = runTiles(anchor, cell(3, 1));
    expect(tiles.every((t) => t.col === 2)).toBe(true); // snapped to anchor column
    expect(at(tiles)).toEqual(['2,5', '2,4', '2,3', '2,2', '2,1']);
  });

  it('a diagonal tie favours the horizontal axis', () => {
    const anchor = cell(0, 0);
    expect(runAxis(anchor, cell(3, 3))).toBe('horizontal'); // |dCol| == |dRow| ⇒ horizontal
    expect(at(runTiles(anchor, cell(3, 3)))).toEqual(['0,0', '1,0', '2,0', '3,0']);
  });

  it('an anchor-only (or exact-repeat) drag is a length-1 run', () => {
    const anchor = cell(4, 4);
    expect(at(runTiles(anchor, anchor))).toEqual(['4,4']);
  });

  it('is inherently deduped — no tile repeats even when the endpoint is re-hit', () => {
    const anchor = cell(0, 0);
    // Drag out to (4,0), back to (2,0), then out to (4,0) again — each recompute is a clean line.
    expect(at(runTiles(anchor, cell(4, 0)))).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0']);
    const back = runTiles(anchor, cell(2, 0));
    expect(at(back)).toEqual(['0,0', '1,0', '2,0']);
    const again = runTiles(anchor, cell(4, 0));
    expect(new Set(at(again)).size).toBe(again.length); // no duplicates
    expect(at(again)).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0']);
  });

  it('stamps the run facing on every tile', () => {
    const tiles = runTiles(cell(0, 0), cell(2, 0), 'right');
    expect(tiles.every((t) => t.facing === 'right')).toBe(true);
  });
});

describe('selectRun (placeable / affordable / totalCost / eta)', () => {
  const tiles = runTiles(cell(0, 0), cell(4, 0)); // 5 tiles
  const allPlaceable = tiles.map(() => true);

  it('affordable subset is the cumulative-cost prefix and drives totalCost + eta', () => {
    // cost {wood:2}/tile, 6 wood held ⇒ 3 tiles afford (2+2+2=6), the 4th (8) does not.
    const sel = selectRun({
      tiles,
      placeable: allPlaceable,
      cost: { wood: 2 },
      inventory: { wood: 6 },
      buildTimeMs: 2500,
    });
    expect(sel.affordableCount).toBe(3);
    expect(sel.totalCost).toEqual({ wood: 6 });
    expect(sel.etaMs).toBe(3 * 2500); // serial sum over the affordable subset
    expect(sel.placeableCount).toBe(5);
  });

  it('affords the whole run when inventory is ample', () => {
    const sel = selectRun({
      tiles,
      placeable: allPlaceable,
      cost: { wood: 2 },
      inventory: { wood: 100 },
      buildTimeMs: 1000,
    });
    expect(sel.affordableCount).toBe(5);
    expect(sel.totalCost).toEqual({ wood: 10 });
    expect(sel.etaMs).toBe(5000);
  });

  it('affords nothing when the first tile is already unaffordable', () => {
    const sel = selectRun({
      tiles,
      placeable: allPlaceable,
      cost: { wood: 2 },
      inventory: { wood: 1 },
      buildTimeMs: 2500,
    });
    expect(sel.affordableCount).toBe(0);
    expect(sel.totalCost).toEqual({ wood: 0 });
    expect(sel.etaMs).toBe(0);
  });

  it('takes the tightest item across a multi-resource cost', () => {
    // {stone:10, wood:10}/tile; stone caps at 2 tiles (25/10), wood would allow 5 (55/10) → min = 2.
    const sel = selectRun({
      tiles,
      placeable: allPlaceable,
      cost: { stone: 10, wood: 10 },
      inventory: { stone: 25, wood: 55 },
      buildTimeMs: 2500,
    });
    expect(sel.affordableCount).toBe(2);
    expect(sel.totalCost).toEqual({ stone: 20, wood: 20 });
  });

  it('placeableCount is independent of affordability', () => {
    // Tile 2 blocked; budget affords all 5. placeableCount counts placeable tiles, not a prefix.
    const sel = selectRun({
      tiles,
      placeable: [true, true, false, true, true],
      cost: { wood: 1 },
      inventory: { wood: 100 },
      buildTimeMs: 100,
    });
    expect(sel.placeableCount).toBe(4);
    expect(sel.affordableCount).toBe(5); // affordability charges every tile regardless of placeability
  });

  it('a length-1 run (single-tap path) resolves normally', () => {
    const one = runTiles(cell(3, 3), cell(3, 3));
    const sel = selectRun({
      tiles: one,
      placeable: [true],
      cost: { wood: 2 },
      inventory: { wood: 2 },
      buildTimeMs: 2500,
    });
    expect(sel.tiles).toHaveLength(1);
    expect(sel.affordableCount).toBe(1);
    expect(sel.etaMs).toBe(2500);
  });

  it('a free (empty-cost) buildable affords the whole run', () => {
    const sel = selectRun({
      tiles,
      placeable: allPlaceable,
      cost: {},
      inventory: {},
      buildTimeMs: 500,
    });
    expect(sel.affordableCount).toBe(5);
    expect(sel.totalCost).toEqual({});
    expect(sel.etaMs).toBe(2500);
  });
});
