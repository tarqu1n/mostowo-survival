import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditorStore } from '../editorStore';
import { parseMap, serializeMap, type NodeObject } from '../../../systems/mapFormat';

/** Fresh 6x6 map for each test — mirrors `editorStoreObjects.test.ts`'s `reset` helper (the store is
 *  a module-level singleton shared across tests). */
function reset(width = 6, height = 6): void {
  useEditorStore.getState().newMap('scratch', 'Scratch', width, height);
}

describe('editorStore: walkability (collision tool)', () => {
  beforeEach(() => reset());

  it('paintWalkabilityLine marks cells blocked, undoably', () => {
    useEditorStore.getState().paintWalkabilityLine(1, 1, 3, 1, 'stroke-1', true);
    const map = useEditorStore.getState().map!;
    expect(map.walkability.cells[1 * 6 + 1]).toBe(1);
    expect(map.walkability.cells[1 * 6 + 2]).toBe(1);
    expect(map.walkability.cells[1 * 6 + 3]).toBe(1);

    useEditorStore.getState().undo();
    expect(map.walkability.cells[1 * 6 + 1]).toBe(0);
    expect(map.walkability.cells[1 * 6 + 3]).toBe(0);
  });

  it('a second call with blocked=false clears cells back to walkable', () => {
    useEditorStore.getState().paintWalkabilityLine(1, 1, 1, 1, 'a', true);
    useEditorStore.getState().paintWalkabilityLine(1, 1, 1, 1, 'b', false);
    const map = useEditorStore.getState().map!;
    expect(map.walkability.cells[1 * 6 + 1]).toBe(0);
  });

  it('skips void cells (respects the shape mask, like every other paint tool)', () => {
    const map = useEditorStore.getState().map!;
    const cells = new Array(36).fill(1) as number[];
    cells[0] = 0; // (0,0) void
    map.shape = { cells };
    useEditorStore.getState().paintWalkabilityLine(0, 0, 2, 0, 's', true);
    expect(map.walkability.cells[0]).toBe(0); // untouched — void
    expect(map.walkability.cells[1]).toBe(1);
    expect(map.walkability.cells[2]).toBe(1);
  });

  it('paintWalkabilityRect and fillWalkabilityFrom fill an area', () => {
    useEditorStore.getState().paintWalkabilityRect(0, 0, 1, 1, true);
    const map = useEditorStore.getState().map!;
    expect(map.walkability.cells.slice(0, 2)).toEqual([1, 1]);
    expect(map.walkability.cells[6]).toBe(1); // (0,1)
    expect(map.walkability.cells[7]).toBe(1); // (1,1)

    useEditorStore.getState().fillWalkabilityFrom(3, 3, true);
    expect(map.walkability.cells.filter((v) => v === 1).length).toBeGreaterThan(4);
  });

  it('coalesces same-strokeId segments into one undo entry', () => {
    useEditorStore.getState().paintWalkabilityLine(0, 0, 1, 0, 'drag-1', true);
    useEditorStore.getState().paintWalkabilityLine(1, 0, 3, 0, 'drag-1', true);
    const map = useEditorStore.getState().map!;
    expect(map.walkability.cells.slice(0, 4)).toEqual([1, 1, 1, 1]);
    useEditorStore.getState().undo(); // ONE undo should revert the whole coalesced drag
    expect(map.walkability.cells.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(useEditorStore.getState().canUndo).toBe(false);
  });
});

describe('editorStore: walkability + zones round-trip through serializeMap/parseMap', () => {
  beforeEach(() => reset());

  it('a saved-then-reopened map preserves painted walkability and two zones', () => {
    useEditorStore.getState().paintWalkabilityRect(0, 0, 1, 0, true);
    const campId = useEditorStore.getState().createZone()!;
    useEditorStore.getState().renameZone(campId, 'Camp');
    useEditorStore.getState().paintZoneRect(2, 0, 3, 0, true);
    const forestId = useEditorStore.getState().createZone()!;
    useEditorStore.getState().renameZone(forestId, 'Forest');
    useEditorStore.getState().paintZoneRect(4, 0, 5, 0, true);

    const map = useEditorStore.getState().map!;
    const json = serializeMap(map);
    const reopened = parseMap(JSON.parse(json)); // throws on any invariant violation

    expect(reopened.walkability.cells.slice(0, 2)).toEqual([1, 1]);
    expect(reopened.zones.defs.map((d) => d.name)).toEqual(['Camp', 'Forest']);
    expect(reopened.zones.cells.slice(2, 4)).toEqual([campId, campId]);
    expect(reopened.zones.cells.slice(4, 6)).toEqual([forestId, forestId]);
  });
});

describe('editorStore: zones CRUD', () => {
  beforeEach(() => reset());

  it('createZone allocates the lowest free id and activates it', () => {
    const id1 = useEditorStore.getState().createZone();
    const id2 = useEditorStore.getState().createZone();
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(useEditorStore.getState().activeZoneId).toBe(2);
    const map = useEditorStore.getState().map!;
    expect(map.zones.defs.map((d) => d.id)).toEqual([1, 2]);
  });

  it('createZone reuses the lowest free id after a delete, not max+1', () => {
    const id1 = useEditorStore.getState().createZone()!;
    useEditorStore.getState().createZone();
    useEditorStore.getState().deleteZone(id1);
    const id3 = useEditorStore.getState().createZone();
    expect(id3).toBe(1);
  });

  it('renameZone and recolourZone are undoable', () => {
    const id = useEditorStore.getState().createZone()!;
    useEditorStore.getState().renameZone(id, 'Camp');
    useEditorStore.getState().recolourZone(id, '#123456');
    const map = useEditorStore.getState().map!;
    const def = map.zones.defs.find((d) => d.id === id)!;
    expect(def.name).toBe('Camp');
    expect(def.colour).toBe('#123456');

    useEditorStore.getState().undo(); // undoes recolour
    expect(def.colour).not.toBe('#123456');
    useEditorStore.getState().undo(); // undoes rename
    expect(def.name).not.toBe('Camp');
  });

  it('deleteZone removes the def AND clears its painted cells, as one undoable command', () => {
    const id = useEditorStore.getState().createZone()!;
    useEditorStore.getState().paintZoneRect(0, 0, 1, 1, true);
    const map = useEditorStore.getState().map!;
    expect(map.zones.cells.slice(0, 2)).toEqual([id, id]);

    useEditorStore.getState().deleteZone(id);
    expect(map.zones.defs).toHaveLength(0);
    expect(map.zones.cells.slice(0, 2)).toEqual([0, 0]);
    expect(useEditorStore.getState().activeZoneId).toBeNull(); // was active — deselected

    useEditorStore.getState().undo(); // ONE undo restores both the def and the cells
    expect(map.zones.defs.map((d) => d.id)).toEqual([id]);
    expect(map.zones.cells.slice(0, 2)).toEqual([id, id]);
  });
});

describe('editorStore: zone painting (zone tool)', () => {
  beforeEach(() => reset());

  it('paints the active zone id, undoably', () => {
    const id = useEditorStore.getState().createZone()!;
    useEditorStore.getState().paintZoneLine(0, 0, 2, 0, 's', true);
    const map = useEditorStore.getState().map!;
    expect(map.zones.cells.slice(0, 3)).toEqual([id, id, id]);
    useEditorStore.getState().undo();
    expect(map.zones.cells.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('warns and no-ops when painting with no active zone selected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useEditorStore.getState().paintZoneLine(0, 0, 1, 0, 's', true);
    const map = useEditorStore.getState().map!;
    expect(map.zones.cells.slice(0, 2)).toEqual([0, 0]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('clears to 0 regardless of which zone owned the cell (paint=false)', () => {
    const id = useEditorStore.getState().createZone()!;
    useEditorStore.getState().paintZoneRect(0, 0, 1, 0, true);
    useEditorStore.getState().paintZoneLine(0, 0, 1, 0, 's2', false);
    const map = useEditorStore.getState().map!;
    expect(map.zones.cells.slice(0, 2)).toEqual([0, 0]);
    expect(id).toBeGreaterThan(0); // sanity — id was actually allocated
  });

  it('skips void cells', () => {
    useEditorStore.getState().createZone();
    const map = useEditorStore.getState().map!;
    const cells = new Array(36).fill(1) as number[];
    cells[0] = 0;
    map.shape = { cells };
    useEditorStore.getState().paintZoneRect(0, 0, 1, 0, true);
    expect(map.zones.cells[0]).toBe(0);
    expect(map.zones.cells[1]).toBe(1);
  });
});

describe('editorStore: shape painting (shape tool) — void-consistency cascade', () => {
  beforeEach(() => reset());

  it('voiding a cell with a tile, a zone, and an overlapping object clears all three in ONE undo entry', () => {
    const map = useEditorStore.getState().map!;
    const layer = map.layers[0];
    const targetIndex = 2 * 6 + 3; // (col 3, row 2)
    layer.cells[targetIndex] = 5; // pretend a palette entry is painted there

    const zoneId = useEditorStore.getState().createZone()!;
    useEditorStore.getState().paintZoneLine(3, 2, 3, 2, 'z', true);
    expect(map.zones.cells[targetIndex]).toBe(zoneId);

    const placed = useEditorStore.getState().placeNode('tree', 3, 2);
    expect(placed).toBe(true);
    expect(map.objects).toHaveLength(1);

    const undoDepthBefore = useEditorStore.getState().canUndo;
    expect(undoDepthBefore).toBe(true);

    // Carve (3,2) to void — default gesture, `inside=false`.
    useEditorStore.getState().paintShapeLine(3, 2, 3, 2, 'shape-1', false);

    expect(map.shape).toBeDefined();
    expect(map.shape!.cells[targetIndex]).toBe(0);
    expect(layer.cells[targetIndex]).toBe(0); // tile cleared
    expect(map.zones.cells[targetIndex]).toBe(0); // zone cleared
    expect(map.objects).toHaveLength(0); // overlapping node removed

    // ONE undo restores everything: shape, tile, zone, AND the object.
    useEditorStore.getState().undo();
    expect(map.shape).toBeUndefined(); // shape was absent before this was the FIRST shape edit
    expect(layer.cells[targetIndex]).toBe(5);
    expect(map.zones.cells[targetIndex]).toBe(zoneId);
    expect(map.objects).toHaveLength(1);
    expect((map.objects[0] as NodeObject).col).toBe(3);
  });

  it('painting a void cell back to inside is a plain cell flip — no cascade, nothing to restore', () => {
    const map = useEditorStore.getState().map!;
    const targetIndex = 1 * 6 + 1;
    map.layers[0].cells[targetIndex] = 9;
    useEditorStore.getState().paintShapeLine(1, 1, 1, 1, 'void-it', false);
    expect(map.layers[0].cells[targetIndex]).toBe(0); // cascaded away

    // Restore the cell to inside (Alt-equivalent, inside=true) — must NOT resurrect the tile.
    useEditorStore.getState().paintShapeLine(1, 1, 1, 1, 'restore-it', true);
    expect(map.shape!.cells[targetIndex]).toBe(1);
    expect(map.layers[0].cells[targetIndex]).toBe(0); // still empty — restoring inside has no cascade
  });

  it('coalesces a shape drag stroke into one undo entry', () => {
    const map = useEditorStore.getState().map!;
    useEditorStore.getState().paintShapeLine(0, 0, 1, 0, 'drag', false);
    useEditorStore.getState().paintShapeLine(1, 0, 3, 0, 'drag', false);
    expect(map.shape!.cells.slice(0, 4)).toEqual([0, 0, 0, 0]);
    useEditorStore.getState().undo();
    expect(map.shape).toBeUndefined(); // one undo unwinds the WHOLE coalesced stroke
  });

  it('fillShapeFrom and paintShapeRect carve/restore an area bounded only by map edges', () => {
    const map = useEditorStore.getState().map!;
    useEditorStore.getState().paintShapeRect(0, 0, 5, 5, false); // void the whole map
    expect(map.shape!.cells.every((v) => v === 0)).toBe(true);
    useEditorStore.getState().fillShapeFrom(0, 0, true); // flood-restore from a corner
    expect(map.shape!.cells.every((v) => v === 1)).toBe(true);
  });

  it('a carved, non-rectangular shape round-trips through serializeMap/parseMap and stays void-consistent', () => {
    const map = useEditorStore.getState().map!;
    map.layers[0].cells[2] = 3; // will be voided
    useEditorStore.getState().placeNode('tree', 4, 4); // stays inside — untouched

    // Carve the whole top row void except it should cascade-clear cell (2,0)'s tile.
    useEditorStore.getState().paintShapeRect(0, 0, 5, 0, false);

    const json = serializeMap(map);
    const reparsed = parseMap(JSON.parse(json)); // throws on any void-consistency violation
    expect(reparsed.shape!.cells.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(reparsed.layers[0].cells[2]).toBe(0);
    expect(reparsed.objects).toHaveLength(1); // the node at (4,4) survived — outside the voided row
  });
});
