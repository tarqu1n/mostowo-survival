import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../editorStore';
import { cellIndex, serializeMap, parseMap, type MapFile } from '../../../systems/mapFormat';

const BRUSH_A = 'pixel-crawler/Environment/Tilesets/Floors_Tiles.png#252';
const BRUSH_B = 'pixel-crawler/Environment/Tilesets/Floors_Tiles.png#253';

/** Fresh 4x4 map for each test — `newMap` also clears history/pendingDirty/tool state, so this is a
 *  full reset of everything the store shares across tests (the store is a module-level singleton). */
function reset(width = 4, height = 4): void {
  useEditorStore.getState().newMap('scratch', 'Scratch', width, height);
  useEditorStore.getState().setBrushAsset(BRUSH_A);
}

describe('editorStore painting', () => {
  beforeEach(() => reset());

  it('paintLine paints a straight drag as one coalesced undo entry', () => {
    const strokeId = 's1';
    useEditorStore.getState().paintLine(0, 0, 0, 0, strokeId); // pointer-down cell
    useEditorStore.getState().paintLine(0, 0, 2, 0, strokeId); // drag to (2,0)

    const map = useEditorStore.getState().map!;
    const width = map.meta.width;
    const layer = map.layers[0];
    expect(layer.cells[cellIndex(0, 0, width)]).toBe(1); // palette index 1 = the resolved brush
    expect(layer.cells[cellIndex(1, 0, width)]).toBe(1);
    expect(layer.cells[cellIndex(2, 0, width)]).toBe(1);
    expect(useEditorStore.getState().canUndo).toBe(true);

    useEditorStore.getState().undo();
    expect(layer.cells[cellIndex(0, 0, width)]).toBe(0);
    expect(layer.cells[cellIndex(2, 0, width)]).toBe(0);
    expect(useEditorStore.getState().canUndo).toBe(false); // the whole drag reverted in ONE undo
  });

  it('eraseLine clears previously-painted cells back to 0', () => {
    useEditorStore.getState().paintRectArea(0, 0, 1, 1);
    const map = useEditorStore.getState().map!;
    const width = map.meta.width;
    expect(map.layers[0].cells[cellIndex(0, 0, width)]).toBe(1);

    useEditorStore.getState().eraseLine(0, 0, 1, 1, 'erase-1');
    expect(map.layers[0].cells[cellIndex(0, 0, width)]).toBe(0);
    expect(map.layers[0].cells[cellIndex(1, 1, width)]).toBe(0);
  });

  it('paintRectArea fills a rectangle as a single undoable command', () => {
    useEditorStore.getState().paintRectArea(0, 0, 1, 1);
    const map = useEditorStore.getState().map!;
    const width = map.meta.width;
    for (const [c, r] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      expect(map.layers[0].cells[cellIndex(c, r, width)]).toBe(1);
    }
    useEditorStore.getState().undo();
    for (const [c, r] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      expect(map.layers[0].cells[cellIndex(c, r, width)]).toBe(0);
    }
  });

  it('fillFrom flood-fills the active layer bounded by the shape mask', () => {
    // Build a 3x1 map with the last cell void, then load it directly (bypassing parseMap — this is
    // an in-memory unit test of the store, not a file round-trip).
    const map: MapFile = emptyMapForTest(3, 1);
    map.shape = { cells: [1, 1, 0] };
    useEditorStore.getState().loadMap(map, 'shaped');
    useEditorStore.getState().setBrushAsset(BRUSH_A);

    useEditorStore.getState().fillFrom(0, 0);
    const loaded = useEditorStore.getState().map!;
    expect(loaded.layers[0].cells).toEqual([1, 1, 0]); // void cell (index 2) never touched
  });

  it('fill without a brushAsset acts as an erase-fill (paints 0)', () => {
    useEditorStore.getState().paintRectArea(0, 0, 3, 3); // fill the whole 4x4 map with the brush
    useEditorStore.getState().setBrushAsset(null);
    useEditorStore.getState().fillFrom(0, 0);
    const map = useEditorStore.getState().map!;
    expect(map.layers[0].cells.every((c) => c === 0)).toBe(true);
  });

  it('paint tools never touch void cells (isInside guard)', () => {
    const map: MapFile = emptyMapForTest(2, 1);
    map.shape = { cells: [1, 0] };
    useEditorStore.getState().loadMap(map, 'shaped2');
    useEditorStore.getState().setBrushAsset(BRUSH_A);

    useEditorStore.getState().paintLine(0, 0, 1, 0, 'line-1'); // (1,0) is void
    const loaded = useEditorStore.getState().map!;
    expect(loaded.layers[0].cells).toEqual([1, 0]);

    useEditorStore.getState().paintRectArea(0, 0, 1, 0);
    expect(loaded.layers[0].cells).toEqual([1, 0]); // still untouched
  });

  it('sets pendingDirty to the touched layer/chunks and consumePendingDirty clears it', () => {
    useEditorStore.getState().paintLine(0, 0, 1, 0, 's-dirty');
    const dirty = useEditorStore.getState().pendingDirty;
    expect(dirty).toEqual({ layerIndex: 0, chunks: [0] });

    expect(useEditorStore.getState().consumePendingDirty()).toEqual({ layerIndex: 0, chunks: [0] });
    expect(useEditorStore.getState().pendingDirty).toBeNull();
    expect(useEditorStore.getState().consumePendingDirty()).toBeNull(); // already consumed
  });

  it('undo clears pendingDirty (falls back to a full rebake, not a narrow one)', () => {
    useEditorStore.getState().paintLine(0, 0, 1, 0, 's-undo-dirty');
    expect(useEditorStore.getState().pendingDirty).not.toBeNull();
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().pendingDirty).toBeNull();
  });
});

describe('editorStore palette append-only (programmatic save/reopen verification)', () => {
  beforeEach(() => reset());

  it('find-or-append never grows the palette for repeated paints with the same asset', () => {
    useEditorStore.getState().paintLine(0, 0, 0, 0, 'a');
    useEditorStore.getState().paintLine(1, 1, 1, 1, 'b');
    useEditorStore.getState().paintRectArea(2, 2, 3, 3);
    const map = useEditorStore.getState().map!;
    expect(map.palette).toHaveLength(2); // reserved null + the one real BRUSH_A entry
  });

  it('appends exactly once per distinct asset across a mixed edit sequence', () => {
    useEditorStore.getState().paintLine(0, 0, 0, 0, 'a');
    useEditorStore.getState().setBrushAsset(BRUSH_B);
    useEditorStore.getState().paintLine(1, 0, 1, 0, 'b');
    useEditorStore.getState().setBrushAsset(BRUSH_A); // switch back — must reuse index 1, not re-append
    useEditorStore.getState().paintLine(2, 0, 2, 0, 'c');

    const map = useEditorStore.getState().map!;
    expect(map.palette).toHaveLength(3); // reserved + BRUSH_A + BRUSH_B
    const width = map.meta.width;
    expect(map.layers[0].cells[cellIndex(0, 0, width)]).toBe(1);
    expect(map.layers[0].cells[cellIndex(1, 0, width)]).toBe(2);
    expect(map.layers[0].cells[cellIndex(2, 0, width)]).toBe(1); // reused index 1, not a new index 3
  });

  it('two consecutive saves diff append-only, and both parse cleanly', () => {
    useEditorStore.getState().paintLine(0, 0, 1, 0, 'stroke-1');
    const map1 = useEditorStore.getState().map!;
    const json1 = serializeMap(map1);
    expect(() => parseMap(JSON.parse(json1) as unknown)).not.toThrow();

    useEditorStore.getState().setBrushAsset(BRUSH_B);
    useEditorStore.getState().paintLine(2, 0, 3, 0, 'stroke-2');
    const map2 = useEditorStore.getState().map!;
    const json2 = serializeMap(map2);
    expect(() => parseMap(JSON.parse(json2) as unknown)).not.toThrow();

    const palette1 = (JSON.parse(json1) as { palette: unknown[] }).palette;
    const palette2 = (JSON.parse(json2) as { palette: unknown[] }).palette;
    expect(palette2.length).toBeGreaterThan(palette1.length);
    // Append-only: every entry from the first save survives at the SAME index in the second.
    for (let i = 0; i < palette1.length; i++) {
      expect(palette2[i]).toEqual(palette1[i]);
    }
  });

  it('undo does not remove an appended palette entry (append is not part of the undo history)', () => {
    useEditorStore.getState().paintLine(0, 0, 0, 0, 'once');
    const map = useEditorStore.getState().map!;
    expect(map.palette).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(map.palette).toHaveLength(2); // the palette entry itself is tolerated, not undone
    expect(map.layers[0].cells.every((c) => c === 0)).toBe(true); // but the paint IS undone
  });
});

describe('editorStore layers', () => {
  beforeEach(() => reset());

  it('addLayer appends a new empty layer and makes it active; undo removes it', () => {
    const before = useEditorStore.getState().map!.layers.length;
    useEditorStore.getState().addLayer('Overhead');
    const map = useEditorStore.getState().map!;
    expect(map.layers).toHaveLength(before + 1);
    expect(map.layers[map.layers.length - 1].name).toBe('Overhead');
    expect(useEditorStore.getState().activeLayerId).toBe(map.layers[map.layers.length - 1].id);

    useEditorStore.getState().undo();
    expect(map.layers).toHaveLength(before);
  });

  it('renameLayer renames undoably', () => {
    const map = useEditorStore.getState().map!;
    const id = map.layers[0].id;
    useEditorStore.getState().renameLayer(id, 'Ground A');
    expect(map.layers[0].name).toBe('Ground A');
    useEditorStore.getState().undo();
    expect(map.layers[0].name).toBe('Ground');
  });

  it('deleteLayer removes a layer and refuses to delete the last one', () => {
    useEditorStore.getState().addLayer('Second');
    const map = useEditorStore.getState().map!;
    const secondId = map.layers[1].id;

    useEditorStore.getState().deleteLayer(secondId);
    expect(map.layers).toHaveLength(1);

    const onlyId = map.layers[0].id;
    useEditorStore.getState().deleteLayer(onlyId);
    expect(map.layers).toHaveLength(1); // refused — must keep at least one layer
  });

  it('moveLayer reorders forward/backward and is undoable', () => {
    useEditorStore.getState().addLayer('Second');
    const map = useEditorStore.getState().map!;
    const [firstId, secondId] = map.layers.map((l) => l.id);

    useEditorStore.getState().moveLayer(firstId, 'forward');
    expect(map.layers.map((l) => l.id)).toEqual([secondId, firstId]);

    useEditorStore.getState().undo();
    expect(map.layers.map((l) => l.id)).toEqual([firstId, secondId]);
  });

  it('toggleLayerOverhead flips the flag undoably', () => {
    const map = useEditorStore.getState().map!;
    const id = map.layers[0].id;
    expect(map.layers[0].overhead).toBe(false);
    useEditorStore.getState().toggleLayerOverhead(id);
    expect(map.layers[0].overhead).toBe(true);
    useEditorStore.getState().undo();
    expect(map.layers[0].overhead).toBe(false);
  });

  it('toggleLayerVisibility is view-only state, not routed through undo history', () => {
    const map = useEditorStore.getState().map!;
    const id = map.layers[0].id;
    const canUndoBefore = useEditorStore.getState().canUndo;
    useEditorStore.getState().toggleLayerVisibility(id);
    expect(useEditorStore.getState().hiddenLayerIds).toContain(id);
    expect(useEditorStore.getState().canUndo).toBe(canUndoBefore); // no history entry created
  });
});

describe('editorStore favourites', () => {
  beforeEach(() => reset());

  it('toggles map-level favourites when no zone is active', () => {
    expect(useEditorStore.getState().activeZoneId).toBeNull();
    useEditorStore.getState().toggleFavourite(BRUSH_A);
    expect(useEditorStore.getState().map!.meta.favourites).toEqual([BRUSH_A]);
    useEditorStore.getState().toggleFavourite(BRUSH_A);
    expect(useEditorStore.getState().map!.meta.favourites).toEqual([]);
  });

  it('toggles the active zone favourites when a zone is active', () => {
    const map = useEditorStore.getState().map!;
    map.zones.defs.push({ id: 1, name: 'Camp', colour: '#88aa44', favourites: [] });
    useEditorStore.getState().setActiveZoneId(1);

    useEditorStore.getState().toggleFavourite(BRUSH_A);
    expect(map.zones.defs[0].favourites).toEqual([BRUSH_A]);
    expect(map.meta.favourites ?? []).toEqual([]); // map-level list untouched

    useEditorStore.getState().undo();
    expect(map.zones.defs[0].favourites).toEqual([]);
  });
});

/** Builds a blank map without going through `newMap`'s store side effects, so a test can mutate
 *  `shape` before `loadMap` (the store itself never authors a shape). */
function emptyMapForTest(width: number, height: number): MapFile {
  useEditorStore.getState().newMap('tmp', 'Tmp', width, height);
  return useEditorStore.getState().map!;
}
