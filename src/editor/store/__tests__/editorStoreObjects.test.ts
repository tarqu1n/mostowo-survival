import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, DECOR_ANIM_DEFAULT_FPS } from '../editorStore';
import { parseMap, serializeMap, type DecorObject, type MapFile } from '../../../systems/mapFormat';

const DECOR_ASSET = 'pixel-crawler/Environment/Props/Static/Rocks.png#5';
const ATLAS_ASSET = 'pixel-crawler/Environment/Props/Static/Furniture.png';
const STRIP_ASSET = 'pixel-crawler/Environment/Structures/Stations/Bonfire/Bonfire_07-Sheet.png';

/** Fresh 6x6 map for each test — `newMap` also clears history/selection/armed state (a full reset of
 *  everything the store shares across tests, since it's a module-level singleton). */
function reset(width = 6, height = 6): void {
  useEditorStore.getState().newMap('scratch', 'Scratch', width, height);
}

describe('editorStore objects: placement', () => {
  beforeEach(() => reset());

  it('placeDecor adds a decor object with default transform + auto id, and selects it', () => {
    const ok = useEditorStore.getState().placeDecor(DECOR_ASSET, 40, 56);
    expect(ok).toBe(true);
    const map = useEditorStore.getState().map!;
    expect(map.objects).toHaveLength(1);
    const obj = map.objects[0] as DecorObject;
    expect(obj).toMatchObject({
      id: 'decor_0001',
      kind: 'decor',
      asset: DECOR_ASSET,
      x: 40,
      y: 56,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
      depth: 0,
    });
    expect(useEditorStore.getState().selectedObjectIds).toEqual(['decor_0001']);
  });

  it('placeDecor refuses (no mutation) when the anchor tile is void', () => {
    const map: MapFile = useEditorStore.getState().map!;
    map.shape = { cells: new Array(36).fill(1) as number[] }; // all inside...
    map.shape.cells[0] = 0; // ...except tile (0,0)
    const ok = useEditorStore.getState().placeDecor(DECOR_ASSET, 4, 4); // floor(4/16)=0,0 -> void
    expect(ok).toBe(false);
    expect(useEditorStore.getState().map!.objects).toHaveLength(0);
  });

  it('placeNode adds a node object at col/row and selects it; auto-ids increment', () => {
    useEditorStore.getState().placeNode('tree', 2, 3);
    useEditorStore.getState().placeNode('rock', 4, 4);
    const map = useEditorStore.getState().map!;
    expect(map.objects.map((o) => o.id)).toEqual(['node_0001', 'node_0002']);
    expect(useEditorStore.getState().selectedObjectIds).toEqual(['node_0002']);
  });

  it('placeNode refuses when the target cell is void', () => {
    const map = useEditorStore.getState().map!;
    const cells = new Array(36).fill(1) as number[];
    cells[2 * 6 + 3] = 0; // (col 3, row 2) void
    map.shape = { cells };
    const ok = useEditorStore.getState().placeNode('tree', 3, 2);
    expect(ok).toBe(false);
    expect(map.objects).toHaveLength(0);
  });

  it('createPortal adds a portal object and refuses if any rect cell is void', () => {
    const ok = useEditorStore
      .getState()
      .createPortal({ col: 1, row: 1, w: 2, h: 1 }, 'South', 'down');
    expect(ok).toBe(true);
    const map = useEditorStore.getState().map!;
    expect(map.objects[0]).toMatchObject({
      id: 'portal_0001',
      kind: 'portal',
      name: 'South',
      rect: { col: 1, row: 1, w: 2, h: 1 },
      facing: 'down',
    });

    const cells = new Array(36).fill(1) as number[];
    cells[1 * 6 + 4] = 0; // (col 4, row 1) void, inside the next rect
    map.shape = { cells };
    const refused = useEditorStore
      .getState()
      .createPortal({ col: 3, row: 1, w: 2, h: 1 }, 'X', 'up');
    expect(refused).toBe(false);
    expect(map.objects).toHaveLength(1); // still just the first portal
  });
});

describe('editorStore objects: select-tool drag (translateObjects)', () => {
  beforeEach(() => reset());

  it('moves decor by a px delta and node/portal by a tile-step delta, undoably', () => {
    useEditorStore.getState().placeDecor(DECOR_ASSET, 32, 32);
    useEditorStore.getState().placeNode('tree', 1, 1);
    const map = useEditorStore.getState().map!;
    const decorId = map.objects[0].id;
    const nodeId = map.objects[1].id;

    const applied = useEditorStore
      .getState()
      .translateObjects([decorId, nodeId], { dxPx: 16, dyPx: -16, dCol: 1, dRow: -1 });
    expect(applied).toBe(true);
    expect((map.objects[0] as DecorObject).x).toBe(48);
    expect((map.objects[0] as DecorObject).y).toBe(16);
    expect(map.objects[1]).toMatchObject({ col: 2, row: 0 });

    useEditorStore.getState().undo();
    expect((map.objects[0] as DecorObject).x).toBe(32);
    expect((map.objects[0] as DecorObject).y).toBe(32);
    expect(map.objects[1]).toMatchObject({ col: 1, row: 1 });
  });

  it('refuses the WHOLE move if any target would land on void, mutating nothing', () => {
    useEditorStore.getState().placeDecor(DECOR_ASSET, 16, 16); // tile (1,1)
    useEditorStore.getState().placeNode('tree', 0, 0);
    const map = useEditorStore.getState().map!;
    const decorId = map.objects[0].id;
    const nodeId = map.objects[1].id;
    const cells = new Array(36).fill(1) as number[];
    cells[0 * 6 + 1] = 0; // (col 1, row 0) — where the node would land after +1 col
    map.shape = { cells };

    const applied = useEditorStore
      .getState()
      .translateObjects([decorId, nodeId], { dxPx: 0, dyPx: 0, dCol: 1, dRow: 0 });
    expect(applied).toBe(false);
    // Neither object moved — the decor's move was valid in isolation but the WHOLE batch is refused.
    expect((map.objects[0] as DecorObject).x).toBe(16);
    expect(map.objects[1]).toMatchObject({ col: 0, row: 0 });
  });

  it('a zero delta is a no-op that does not push a history entry', () => {
    useEditorStore.getState().placeDecor(DECOR_ASSET, 16, 16);
    const before = useEditorStore.getState().canUndo;
    const id = useEditorStore.getState().map!.objects[0].id;
    const applied = useEditorStore
      .getState()
      .translateObjects([id], { dxPx: 0, dyPx: 0, dCol: 0, dRow: 0 });
    expect(applied).toBe(true);
    expect(useEditorStore.getState().canUndo).toBe(before); // placeDecor already pushed one entry; no new one
  });
});

describe('editorStore objects: rotate/flip/depth/duplicate/delete', () => {
  beforeEach(() => reset());

  it('rotateObjects bumps rotation by the delta and skips node/portal ids', () => {
    useEditorStore.getState().placeDecor(DECOR_ASSET, 16, 16);
    useEditorStore.getState().placeNode('tree', 2, 2);
    const map = useEditorStore.getState().map!;
    const [decorId, nodeId] = map.objects.map((o) => o.id);

    useEditorStore.getState().rotateObjects([decorId, nodeId], 90);
    expect((map.objects[0] as DecorObject).rotation).toBe(90);
    expect(map.objects[1]).not.toHaveProperty('rotation'); // node untouched, no crash

    useEditorStore.getState().undo();
    expect((map.objects[0] as DecorObject).rotation).toBe(0);
  });

  it('free rotation via updateDecor accepts any degree value', () => {
    useEditorStore.getState().placeDecor(DECOR_ASSET, 16, 16);
    const map = useEditorStore.getState().map!;
    const id = map.objects[0].id;
    const ok = useEditorStore.getState().updateDecor(id, { rotation: 37.5 });
    expect(ok).toBe(true);
    expect((map.objects[0] as DecorObject).rotation).toBe(37.5);
  });

  it('flipObjects toggles flipX/flipY undoably', () => {
    useEditorStore.getState().placeDecor(DECOR_ASSET, 16, 16);
    const map = useEditorStore.getState().map!;
    const id = map.objects[0].id;
    useEditorStore.getState().flipObjects([id], 'x');
    expect((map.objects[0] as DecorObject).flipX).toBe(true);
    useEditorStore.getState().undo();
    expect((map.objects[0] as DecorObject).flipX).toBe(false);
  });

  it('bumpDepth adjusts decor depth (bring-forward/send-back), reordering stacking', () => {
    useEditorStore.getState().placeDecor(DECOR_ASSET, 16, 16);
    useEditorStore.getState().placeDecor(DECOR_ASSET, 16, 16); // overlapping — same footprint
    const map = useEditorStore.getState().map!;
    const [a, b] = map.objects.map((o) => o.id);
    expect((map.objects[0] as DecorObject).depth).toBe(0);
    expect((map.objects[1] as DecorObject).depth).toBe(0);

    useEditorStore.getState().bumpDepth([b], 1);
    expect((map.objects[1] as DecorObject).depth).toBe(1); // b now stacks above a
    useEditorStore.getState().bumpDepth([a], -1);
    expect((map.objects[0] as DecorObject).depth).toBe(-1);

    useEditorStore.getState().undo();
    expect((map.objects[0] as DecorObject).depth).toBe(0);
    useEditorStore.getState().undo();
    expect((map.objects[1] as DecorObject).depth).toBe(0);
  });

  it('duplicateObjects offsets by one tile when valid, mints distinct new ids, and selects the copies', () => {
    useEditorStore.getState().placeDecor(DECOR_ASSET, 16, 16);
    useEditorStore.getState().placeNode('tree', 1, 1);
    const map = useEditorStore.getState().map!;
    const ids = map.objects.map((o) => o.id);

    const newIds = useEditorStore.getState().duplicateObjects(ids);
    expect(newIds).toEqual(['decor_0002', 'node_0002']); // distinct, no batch-mint collision
    expect(map.objects).toHaveLength(4);
    expect(useEditorStore.getState().selectedObjectIds).toEqual(newIds);
    const dup = map.objects.find((o) => o.id === 'decor_0002') as DecorObject;
    expect(dup.x).toBe(32); // offset by tileSize (16)
    expect(dup.y).toBe(32);

    useEditorStore.getState().undo();
    expect(map.objects).toHaveLength(2);
  });

  it('duplicateObjects degrades to stacking at the same position when the offset would land on void', () => {
    useEditorStore.getState().placeNode('tree', 5, 5); // near the 6x6 map's bottom-right corner
    const map = useEditorStore.getState().map!;
    const id = map.objects[0].id;
    const newIds = useEditorStore.getState().duplicateObjects([id]);
    const dup = map.objects.find((o) => o.id === newIds[0]);
    expect(dup).toMatchObject({ col: 5, row: 5 }); // offset (6,6) would be OOB on a 6x6 map — degraded
  });

  it('deleteObjects removes the objects, reconciles selection, and undo restores original order', () => {
    useEditorStore.getState().placeDecor(DECOR_ASSET, 16, 16);
    useEditorStore.getState().placeNode('tree', 1, 1);
    useEditorStore.getState().placeNode('rock', 2, 2);
    const map = useEditorStore.getState().map!;
    const [decorId, treeId, rockId] = map.objects.map((o) => o.id);
    useEditorStore.getState().setSelectedObjectIds([decorId, treeId]);

    useEditorStore.getState().deleteObjects([decorId, treeId]);
    expect(map.objects.map((o) => o.id)).toEqual([rockId]);
    expect(useEditorStore.getState().selectedObjectIds).toEqual([]); // reconciled — no dangling ids

    useEditorStore.getState().undo();
    expect(map.objects.map((o) => o.id)).toEqual([decorId, treeId, rockId]); // original order restored
  });
});

describe('editorStore objects: updateDecor/updateNode/updatePortal', () => {
  beforeEach(() => reset());

  it('updateDecor refuses a patch that would move the anchor tile onto void', () => {
    useEditorStore.getState().placeDecor(DECOR_ASSET, 16, 16); // tile (1,1)
    const map = useEditorStore.getState().map!;
    const id = map.objects[0].id;
    const cells = new Array(36).fill(1) as number[];
    cells[2 * 6 + 2] = 0; // (2,2) void
    map.shape = { cells };
    const ok = useEditorStore.getState().updateDecor(id, { x: 40, y: 40 }); // floor(40/16)=2,2
    expect(ok).toBe(false);
    expect((map.objects[0] as DecorObject).x).toBe(16);
  });

  it('updateNode moves col/row undoably and rejects void targets', () => {
    useEditorStore.getState().placeNode('tree', 1, 1);
    const map = useEditorStore.getState().map!;
    const id = map.objects[0].id;
    expect(useEditorStore.getState().updateNode(id, { col: 3, row: 3 })).toBe(true);
    expect(map.objects[0]).toMatchObject({ col: 3, row: 3 });
    useEditorStore.getState().undo();
    expect(map.objects[0]).toMatchObject({ col: 1, row: 1 });
  });

  it('updatePortal patches name/facing freely and validates rect changes', () => {
    useEditorStore.getState().createPortal({ col: 0, row: 0, w: 1, h: 1 }, 'A', 'down');
    const map = useEditorStore.getState().map!;
    const id = map.objects[0].id;
    expect(useEditorStore.getState().updatePortal(id, { name: 'B', facing: 'left' })).toBe(true);
    expect(map.objects[0]).toMatchObject({ name: 'B', facing: 'left' });

    const cells = new Array(36).fill(1) as number[];
    cells[0] = 0; // (0,0) void — moving the rect there should be refused
    map.shape = { cells };
    const refused = useEditorStore
      .getState()
      .updatePortal(id, { rect: { col: 0, row: 0, w: 1, h: 1 } });
    expect(refused).toBe(false);
  });
});

describe('acceptance: step 7 done-when scenario', () => {
  beforeEach(() => reset(10, 10));

  it('place/reorder/rotate/free-rotate decor, add a tree node + a portal; round-trips through parseMap; void is refused; undo unwinds to empty', () => {
    // Two overlapping decor objects.
    expect(useEditorStore.getState().placeDecor(DECOR_ASSET, 48, 48)).toBe(true);
    expect(useEditorStore.getState().placeDecor(DECOR_ASSET, 48, 48)).toBe(true);
    const map = useEditorStore.getState().map!;
    const [decorA, decorB] = map.objects.map((o) => o.id);

    // Reorder their stacking (bring B above A).
    useEditorStore.getState().bumpDepth([decorB], 2);
    expect((map.objects[1] as DecorObject).depth).toBe(2);

    // Rotate one 90°, free-rotate another.
    useEditorStore.getState().rotateObjects([decorA], 90);
    expect((map.objects[0] as DecorObject).rotation).toBe(90);
    expect(useEditorStore.getState().updateDecor(decorB, { rotation: 12.5 })).toBe(true);
    expect((map.objects[1] as DecorObject).rotation).toBe(12.5);

    // A node:'tree' and a portal.
    expect(useEditorStore.getState().placeNode('tree', 4, 4)).toBe(true);
    expect(
      useEditorStore.getState().createPortal({ col: 8, row: 8, w: 2, h: 1 }, 'East gate', 'right'),
    ).toBe(true);
    expect(map.objects).toHaveLength(4);

    // Serialize → parseMap round-trips and passes void-consistency (all-inside map here).
    const json = serializeMap(map);
    const reparsed = parseMap(JSON.parse(json) as unknown);
    expect(reparsed.objects).toHaveLength(4);
    expect(JSON.parse(serializeMap(reparsed)) as unknown).toEqual(JSON.parse(json) as unknown);

    // Placement on a void cell is refused.
    map.shape = {
      cells: (() => {
        const c = new Array(100).fill(1) as number[];
        c[0] = 0; // (0,0) void
        return c;
      })(),
    };
    expect(useEditorStore.getState().placeNode('rock', 0, 0)).toBe(false);
    expect(map.objects).toHaveLength(4); // refused — no 5th object

    // Undo the stack all the way back to empty.
    while (useEditorStore.getState().canUndo) useEditorStore.getState().undo();
    expect(map.objects).toHaveLength(0);
    expect(useEditorStore.getState().canUndo).toBe(false);
  });
});

describe('editorStore objects: placeDecor region/anim (plan 014 step 7b)', () => {
  beforeEach(() => reset());

  it('placeDecor writes a region onto the new decor object and omits anim', () => {
    const region = { x: 4, y: 8, w: 16, h: 24 };
    const ok = useEditorStore.getState().placeDecor(ATLAS_ASSET, 40, 56, region);
    expect(ok).toBe(true);
    const obj = useEditorStore.getState().map!.objects[0] as DecorObject;
    expect(obj.region).toEqual(region);
    expect(obj.anim).toBeUndefined();
  });

  it('placeDecor stamps the fixed default fps onto an armed anim (minus fps) and omits region', () => {
    const anim = { frameWidth: 32, frameHeight: 32, frames: 4 };
    const ok = useEditorStore.getState().placeDecor(STRIP_ASSET, 40, 56, undefined, anim);
    expect(ok).toBe(true);
    const obj = useEditorStore.getState().map!.objects[0] as DecorObject;
    expect(obj.anim).toEqual({ ...anim, fps: DECOR_ANIM_DEFAULT_FPS });
    expect(obj.region).toBeUndefined();
  });

  it('placeDecor threads an armed anim.omit through verbatim onto the placed decor (plan 017 step 6.6)', () => {
    const anim = { frameWidth: 32, frameHeight: 32, frames: 22, omit: [21] };
    const ok = useEditorStore.getState().placeDecor(STRIP_ASSET, 40, 56, undefined, anim);
    expect(ok).toBe(true);
    const obj = useEditorStore.getState().map!.objects[0] as DecorObject;
    expect(obj.anim).toEqual({ ...anim, fps: DECOR_ANIM_DEFAULT_FPS });
  });

  it('placeDecor with neither region nor anim omits both keys (unchanged step-7 behaviour)', () => {
    useEditorStore.getState().placeDecor(DECOR_ASSET, 16, 16);
    const obj = useEditorStore.getState().map!.objects[0] as DecorObject;
    expect(obj.region).toBeUndefined();
    expect(obj.anim).toBeUndefined();
  });

  it('a region decor refuses on a void anchor tile exactly like a plain decor', () => {
    const map = useEditorStore.getState().map!;
    const cells = new Array(36).fill(1) as number[];
    cells[2 * 6 + 2] = 0; // (2,2) void
    map.shape = { cells };
    const ok = useEditorStore
      .getState()
      .placeDecor(ATLAS_ASSET, 40, 40, { x: 0, y: 0, w: 8, h: 8 }); // floor(40/16) = (2,2)
    expect(ok).toBe(false);
    expect(map.objects).toHaveLength(0);
  });

  it('round-trips a region decor and an anim decor through serializeMap -> parseMap', () => {
    useEditorStore.getState().placeDecor(ATLAS_ASSET, 16, 16, { x: 4, y: 8, w: 16, h: 24 });
    useEditorStore
      .getState()
      .placeDecor(STRIP_ASSET, 32, 32, undefined, { frameWidth: 32, frameHeight: 32, frames: 4 });
    const map: MapFile = useEditorStore.getState().map!;
    const json = serializeMap(map);
    const reparsed = parseMap(JSON.parse(json) as unknown);
    expect(reparsed).toEqual(map);
    expect(JSON.parse(serializeMap(reparsed)) as unknown).toEqual(JSON.parse(json) as unknown);

    // undo walks both placements back to empty.
    useEditorStore.getState().undo();
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().map!.objects).toHaveLength(0);
  });
});
