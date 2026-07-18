import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../editorStore';
import type { DecorObject, MapFile } from '../../../systems/mapFormat';

const DECOR_ASSET = 'pixel-crawler/Environment/Props/Static/Rocks.png#5';

/** Fresh 6×6 map per test (also clears history/selection/region). */
function reset(width = 6, height = 6): void {
  useEditorStore.getState().newMap('scratch', 'Scratch', width, height);
}

const st = (): ReturnType<typeof useEditorStore.getState> => useEditorStore.getState();
const idx = (col: number, row: number, width = 6): number => row * width + col;

describe('editorStore translateRegion', () => {
  beforeEach(() => reset());

  it('moves tiles, walkability, zones and captured objects as one block; box follows; undo restores', () => {
    const map = st().map!;
    // Paint a tile + walkability + a zone at (1,1), and drop a decor whose anchor floors to (1,1).
    map.layers[0].cells[idx(1, 1)] = 7;
    map.walkability.cells[idx(1, 1)] = 1;
    map.zones.defs.push({ id: 1, name: 'z', colour: '#ffffff', favourites: [] });
    map.zones.cells[idx(1, 1)] = 1;
    expect(st().placeDecor(DECOR_ASSET, 1 * 16 + 8, 1 * 16 + 8)).toBe(true); // tile (1,1)

    st().setRegionSelection({ col: 1, row: 1, w: 1, h: 1 });
    const moved = st().translateRegion(2, 0); // shift 2 tiles right → (3,1)
    expect(moved).toBe(true);

    const after = st().map!;
    // Source cleared, destination stamped, across all three grids.
    expect(after.layers[0].cells[idx(1, 1)]).toBe(0);
    expect(after.layers[0].cells[idx(3, 1)]).toBe(7);
    expect(after.walkability.cells[idx(1, 1)]).toBe(0);
    expect(after.walkability.cells[idx(3, 1)]).toBe(1);
    expect(after.zones.cells[idx(1, 1)]).toBe(0);
    expect(after.zones.cells[idx(3, 1)]).toBe(1);
    // Decor moved by 2 tiles in px.
    expect((after.objects[0] as DecorObject).x).toBe(1 * 16 + 8 + 2 * 16);
    // The box followed its contents.
    expect(st().regionSelection).toEqual({ col: 3, row: 1, w: 1, h: 1 });

    // Undo restores every grid + the object; and clears the (non-history) box.
    st().undo();
    const back = st().map!;
    expect(back.layers[0].cells[idx(1, 1)]).toBe(7);
    expect(back.layers[0].cells[idx(3, 1)]).toBe(0);
    expect(back.walkability.cells[idx(1, 1)]).toBe(1);
    expect(back.zones.cells[idx(1, 1)]).toBe(1);
    expect((back.objects[0] as DecorObject).x).toBe(1 * 16 + 8);
    expect(st().regionSelection).toBeNull();
  });

  it('a zero delta is a no-op that returns true and adds no history entry', () => {
    st().setRegionSelection({ col: 0, row: 0, w: 2, h: 2 });
    const before = st().canUndo;
    expect(st().translateRegion(0, 0)).toBe(true);
    expect(st().canUndo).toBe(before); // no command pushed
  });

  it('refuses (no mutation) when the box would move off the map edge', () => {
    const map = st().map!;
    map.layers[0].cells[idx(5, 0)] = 4;
    st().setRegionSelection({ col: 5, row: 0, w: 1, h: 1 });
    expect(st().translateRegion(1, 0)).toBe(false); // col 5 + w1 + 1 = 7 > width 6
    expect(st().map!.layers[0].cells[idx(5, 0)]).toBe(4); // untouched
    expect(st().regionSelection).toEqual({ col: 5, row: 0, w: 1, h: 1 }); // box unchanged
  });

  it('refuses (no mutation) when a destination tile is void', () => {
    const map: MapFile = st().map!;
    map.layers[0].cells[idx(0, 0)] = 3;
    map.shape = { cells: new Array(36).fill(1) as number[] };
    map.shape.cells[idx(1, 0)] = 0; // (1,0) is void
    st().setRegionSelection({ col: 0, row: 0, w: 1, h: 1 });
    expect(st().translateRegion(1, 0)).toBe(false); // dest (1,0) is void
    expect(st().map!.layers[0].cells[idx(0, 0)]).toBe(3);
  });

  it('does nothing without a region selection', () => {
    st().setRegionSelection(null);
    expect(st().translateRegion(1, 0)).toBe(false);
  });
});
