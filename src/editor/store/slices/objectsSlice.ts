import {
  isInside,
  type DecorObject,
  type MapObject,
  type NodeObject,
  type PortalObject,
} from '../../../systems/mapFormat';
import { pickWeighted } from '../../../data/tileset';
import { batchCommand, footprintIsValid, nextObjectId } from '../../objectOps';
import {
  captureRegionObjects,
  computeGridRegionMove,
  regionDestinationInside,
  regionMoveInBounds,
  type RegionCellEdit,
} from '../../regionOps';
import { type Command } from '../history';
import type { EditorSlice, EditorState } from '../types';

/** Fixed animation rate every placed `anim` decor gets stamped with (critique #6: no per-instance
 *  editable fps field in v1). See `DecorObject.anim` in mapFormat for why `fps` still lives in schema. */
export const DECOR_ANIM_DEFAULT_FPS = 8;

export const objectsSlice: EditorSlice<
  Pick<
    EditorState,
    | 'selectedObjectIds'
    | 'regionSelection'
    | 'setSelectedObjectIds'
    | 'setRegionSelection'
    | 'translateRegion'
    | 'placeDecor'
    | 'placeNode'
    | 'createPortal'
    | 'translateObjects'
    | 'deleteObjects'
    | 'duplicateObjects'
    | 'updateDecor'
    | 'updateNode'
    | 'cycleNodeSkin'
    | 'updatePortal'
    | 'rotateObjects'
    | 'flipObjects'
    | 'bumpDepth'
  >
> = (set, get) => ({
  selectedObjectIds: [],
  regionSelection: null,
  setSelectedObjectIds: (selectedObjectIds) => set({ selectedObjectIds }),
  setRegionSelection: (regionSelection) => set({ regionSelection }),
  // ---- objects: place, transform, stack, portals (step 7) ----

  placeDecor: (asset, x, y, region, anim) => {
    const map = get().map;
    if (!map) return false;
    const id = nextObjectId(map, 'decor');
    const obj: DecorObject = {
      id,
      kind: 'decor',
      asset,
      x,
      y,
      scaleX: 1,
      scaleY: 1,
      rotation: get().placeRotation, // sticky placement-wheel angle (deg); 0 = upright default
      flipX: false,
      flipY: false,
      depth: 0,
      ...(region ? { region } : {}),
      ...(anim ? { anim: { ...anim, fps: DECOR_ANIM_DEFAULT_FPS } } : {}),
    };
    if (!footprintIsValid(map, obj)) return false;
    const cmd: Command = {
      do: () => {
        map.objects.push(obj);
      },
      undo: () => {
        const i = map.objects.indexOf(obj);
        if (i >= 0) map.objects.splice(i, 1);
      },
    };
    get().applyCommand(cmd);
    set({ selectedObjectIds: [id] });
    return true;
  },

  placeNode: (ref, col, row) => {
    const map = get().map;
    if (!map) return false;
    const id = nextObjectId(map, 'node');
    // Roll a weighted-random skin from the def so a placed forest comes out visually varied
    // (plan 021 step 9) — the inspector picker + cycle-skin shortcut let you override it after.
    // Only persist `skin` when the roll differs from the def's default (`skins[0]`): an omitted
    // `skin` already means "the first skin", so single-skin seeds (tree/rock/bush) stay byte-identical
    // to today and map files don't carry a redundant `skin: "default"` on every placement.
    const def = get().nodeDefsParsed[ref];
    const rolled = def && def.skins.length > 0 ? pickWeighted(def.skins).id : undefined;
    const skin = rolled !== undefined && def && rolled !== def.skins[0].id ? rolled : undefined;
    // Stamp the sticky placement-wheel angle, omitted when 0 so an upright node stays byte-identical
    // to a legacy (rotation-less) placement — mirrors `skin`'s omitted-when-default treatment.
    const rotation = get().placeRotation;
    const obj: NodeObject = {
      id,
      kind: 'node',
      ref,
      col,
      row,
      ...(skin !== undefined ? { skin } : {}),
      ...(rotation ? { rotation } : {}),
    };
    if (!footprintIsValid(map, obj)) return false;
    const cmd: Command = {
      do: () => {
        map.objects.push(obj);
      },
      undo: () => {
        const i = map.objects.indexOf(obj);
        if (i >= 0) map.objects.splice(i, 1);
      },
    };
    get().applyCommand(cmd);
    set({ selectedObjectIds: [id] });
    return true;
  },

  createPortal: (rect, name, facing) => {
    const map = get().map;
    if (!map) return false;
    const id = nextObjectId(map, 'portal');
    const obj: PortalObject = { id, kind: 'portal', name, rect, facing };
    if (!footprintIsValid(map, obj)) return false;
    const cmd: Command = {
      do: () => {
        map.objects.push(obj);
      },
      undo: () => {
        const i = map.objects.indexOf(obj);
        if (i >= 0) map.objects.splice(i, 1);
      },
    };
    get().applyCommand(cmd);
    set({ selectedObjectIds: [id] });
    return true;
  },

  translateObjects: (ids, delta) => {
    const map = get().map;
    if (!map) return false;
    const targets = map.objects.filter((o) => ids.includes(o.id));
    if (targets.length === 0) return false;
    if (delta.dxPx === 0 && delta.dyPx === 0 && delta.dCol === 0 && delta.dRow === 0) return true; // no movement — nothing to commit

    // Build prospective next values + validate EVERY target's footprint before mutating anything.
    const prev = new Map<string, { x: number; y: number } | { col: number; row: number }>();
    const next = new Map<string, { x: number; y: number } | { col: number; row: number }>();
    for (const obj of targets) {
      if (obj.kind === 'decor') {
        prev.set(obj.id, { x: obj.x, y: obj.y });
        next.set(obj.id, { x: obj.x + delta.dxPx, y: obj.y + delta.dyPx });
      } else if (obj.kind === 'node') {
        prev.set(obj.id, { col: obj.col, row: obj.row });
        next.set(obj.id, { col: obj.col + delta.dCol, row: obj.row + delta.dRow });
      } else {
        prev.set(obj.id, { col: obj.rect.col, row: obj.rect.row });
        next.set(obj.id, { col: obj.rect.col + delta.dCol, row: obj.rect.row + delta.dRow });
      }
    }
    for (const obj of targets) {
      const n = next.get(obj.id);
      if (!n) continue;
      const candidate: MapObject =
        obj.kind === 'decor'
          ? { ...obj, x: (n as { x: number; y: number }).x, y: (n as { x: number; y: number }).y }
          : obj.kind === 'node'
            ? {
                ...obj,
                col: (n as { col: number; row: number }).col,
                row: (n as { col: number; row: number }).row,
              }
            : {
                ...obj,
                rect: {
                  ...obj.rect,
                  col: (n as { col: number; row: number }).col,
                  row: (n as { col: number; row: number }).row,
                },
              };
      if (!footprintIsValid(map, candidate)) return false; // any target on void/OOB refuses the WHOLE move
    }

    const cmd: Command = {
      do: () => {
        for (const obj of targets) {
          const n = next.get(obj.id);
          if (!n) continue;
          if (obj.kind === 'decor') {
            obj.x = (n as { x: number; y: number }).x;
            obj.y = (n as { x: number; y: number }).y;
          } else if (obj.kind === 'node') {
            obj.col = (n as { col: number; row: number }).col;
            obj.row = (n as { col: number; row: number }).row;
          } else {
            obj.rect.col = (n as { col: number; row: number }).col;
            obj.rect.row = (n as { col: number; row: number }).row;
          }
        }
      },
      undo: () => {
        for (const obj of targets) {
          const p = prev.get(obj.id);
          if (!p) continue;
          if (obj.kind === 'decor') {
            obj.x = (p as { x: number; y: number }).x;
            obj.y = (p as { x: number; y: number }).y;
          } else if (obj.kind === 'node') {
            obj.col = (p as { col: number; row: number }).col;
            obj.row = (p as { col: number; row: number }).row;
          } else {
            obj.rect.col = (p as { col: number; row: number }).col;
            obj.rect.row = (p as { col: number; row: number }).row;
          }
        }
      },
    };
    get().applyCommand(cmd);
    return true;
  },

  translateRegion: (dCol, dRow) => {
    const { map, regionSelection: region } = get();
    if (!map || !region) return false;
    if (dCol === 0 && dRow === 0) return true; // no movement — nothing to commit (no undo noise)

    const { width, height, tileSize } = map.meta;
    // Refuse before mutating anything (mirrors `translateObjects`' all-or-nothing contract):
    //  1. the box must stay fully on-map (never silently drop tiles off the edge), and
    //  2. no destination tile may be void (never break parseMap's void-consistency invariant).
    if (!regionMoveInBounds(region, dCol, dRow, width, height)) return false;
    if (!regionDestinationInside(map, region, dCol, dRow)) return false;

    // Capture every object whose footprint intersects the box, and validate each one's DESTINATION
    // footprint up-front — one invalid target (e.g. a decor collision box that would poke off-map)
    // refuses the WHOLE move, exactly like `translateObjects`.
    const capturedIds = new Set(captureRegionObjects(map, region));
    const targets = map.objects.filter((o) => capturedIds.has(o.id));
    const objPrev = new Map<string, { x: number; y: number } | { col: number; row: number }>();
    const objNext = new Map<string, { x: number; y: number } | { col: number; row: number }>();
    for (const obj of targets) {
      if (obj.kind === 'decor') {
        objPrev.set(obj.id, { x: obj.x, y: obj.y });
        objNext.set(obj.id, { x: obj.x + dCol * tileSize, y: obj.y + dRow * tileSize });
      } else if (obj.kind === 'node') {
        objPrev.set(obj.id, { col: obj.col, row: obj.row });
        objNext.set(obj.id, { col: obj.col + dCol, row: obj.row + dRow });
      } else {
        objPrev.set(obj.id, { col: obj.rect.col, row: obj.rect.row });
        objNext.set(obj.id, { col: obj.rect.col + dCol, row: obj.rect.row + dRow });
      }
    }
    for (const obj of targets) {
      const n = objNext.get(obj.id);
      if (!n) continue;
      const candidate: MapObject =
        obj.kind === 'decor'
          ? { ...obj, x: (n as { x: number; y: number }).x, y: (n as { x: number; y: number }).y }
          : obj.kind === 'node'
            ? {
                ...obj,
                col: (n as { col: number; row: number }).col,
                row: (n as { col: number; row: number }).row,
              }
            : {
                ...obj,
                rect: {
                  ...obj.rect,
                  col: (n as { col: number; row: number }).col,
                  row: (n as { col: number; row: number }).row,
                },
              };
      if (!footprintIsValid(map, candidate)) return false;
    }

    // Block-move edits for every flat width*height grid EXCEPT the void/shape mask (structural, see
    // the action doc): all tile layers, walkability, zones, and each terrain mask. A grid that
    // doesn't change (e.g. an untouched walkability grid) contributes nothing.
    const isIn = (c: number, r: number): boolean => isInside(map, c, r);
    const gridMoves: Array<{ cells: number[]; edits: RegionCellEdit[] }> = [];
    const collect = (cells: number[]): void => {
      const edits = computeGridRegionMove(cells, width, region, dCol, dRow, isIn);
      if (edits.length > 0) gridMoves.push({ cells, edits });
    };
    for (const layer of map.layers) collect(layer.cells);
    collect(map.walkability.cells);
    collect(map.zones.cells);
    for (const section of map.terrain) collect(section.cells);

    const applyObj = (
      which: Map<string, { x: number; y: number } | { col: number; row: number }>,
    ): void => {
      for (const obj of targets) {
        const v = which.get(obj.id);
        if (!v) continue;
        if (obj.kind === 'decor') {
          obj.x = (v as { x: number; y: number }).x;
          obj.y = (v as { x: number; y: number }).y;
        } else if (obj.kind === 'node') {
          obj.col = (v as { col: number; row: number }).col;
          obj.row = (v as { col: number; row: number }).row;
        } else {
          obj.rect.col = (v as { col: number; row: number }).col;
          obj.rect.row = (v as { col: number; row: number }).row;
        }
      }
    };

    const cmd: Command = {
      do: () => {
        for (const g of gridMoves) for (const e of g.edits) g.cells[e.index] = e.next;
        applyObj(objNext);
      },
      undo: () => {
        for (const g of gridMoves) for (const e of g.edits) g.cells[e.index] = e.prev;
        applyObj(objPrev);
      },
    };
    // Multiple layers move at once — no narrowed rebake is worth it, so force the scene's full
    // chunked rebake by leaving `pendingDirty` cleared (see the module doc + shape/void cascade).
    set({ pendingDirty: null });
    get().applyCommand(cmd);
    // The box follows its contents so repeated nudges keep moving the same group. Set AFTER
    // applyCommand (whose own `set` doesn't touch `regionSelection`).
    set({ regionSelection: { ...region, col: region.col + dCol, row: region.row + dRow } });
    return true;
  },

  deleteObjects: (ids) => {
    const map = get().map;
    if (!map) return;
    const removed: Array<{ index: number; obj: MapObject }> = [];
    map.objects.forEach((o, index) => {
      if (ids.includes(o.id)) removed.push({ index, obj: o });
    });
    if (removed.length === 0) return;
    const cmd: Command = {
      do: () => {
        // Remove from the end backwards (by the ORIGINAL indices, captured before any mutation) so
        // earlier indices stay valid as later ones are spliced out.
        for (let i = removed.length - 1; i >= 0; i--) map.objects.splice(removed[i].index, 1);
      },
      undo: () => {
        // Reinsert in ascending index order so every object lands back at its original position.
        for (const { index, obj } of removed) map.objects.splice(index, 0, obj);
      },
    };
    get().applyCommand(cmd); // applyCommand also reconciles selectedObjectIds — no separate clear needed
  },

  duplicateObjects: (ids) => {
    const map = get().map;
    if (!map) return [];
    const targets = map.objects.filter((o) => ids.includes(o.id));
    if (targets.length === 0) return [];
    const mintedIds: string[] = [];
    const copies: MapObject[] = [];
    for (const obj of targets) {
      if (obj.kind === 'decor') {
        const id = nextObjectId(map, 'decor', mintedIds);
        mintedIds.push(id);
        const tileSize = map.meta.tileSize;
        const offset: DecorObject = { ...obj, id, x: obj.x + tileSize, y: obj.y + tileSize };
        copies.push(footprintIsValid(map, offset) ? offset : { ...obj, id, x: obj.x, y: obj.y });
      } else if (obj.kind === 'node') {
        const id = nextObjectId(map, 'node', mintedIds);
        mintedIds.push(id);
        const offset: NodeObject = { ...obj, id, col: obj.col + 1, row: obj.row + 1 };
        copies.push(
          footprintIsValid(map, offset) ? offset : { ...obj, id, col: obj.col, row: obj.row },
        );
      } else {
        const id = nextObjectId(map, 'portal', mintedIds);
        mintedIds.push(id);
        const offset: PortalObject = {
          ...obj,
          id,
          rect: { ...obj.rect, col: obj.rect.col + 1, row: obj.rect.row + 1 },
        };
        copies.push(footprintIsValid(map, offset) ? offset : { ...obj, id, rect: { ...obj.rect } });
      }
    }
    const cmd: Command = {
      do: () => {
        map.objects.push(...copies);
      },
      undo: () => {
        for (const copy of copies) {
          const i = map.objects.indexOf(copy);
          if (i >= 0) map.objects.splice(i, 1);
        }
      },
    };
    get().applyCommand(cmd);
    const newIds = copies.map((o) => o.id);
    set({ selectedObjectIds: newIds });
    return newIds;
  },

  updateDecor: (id, patch) => {
    const map = get().map;
    if (!map) return false;
    const obj = map.objects.find((o) => o.id === id && o.kind === 'decor') as
      DecorObject | undefined;
    if (!obj) return false;
    const touchesFootprint = 'x' in patch || 'y' in patch || 'collision' in patch;
    if (touchesFootprint) {
      const candidate: DecorObject = { ...obj, ...patch };
      if (!footprintIsValid(map, candidate)) return false;
    }
    const prev: Partial<DecorObject> = {};
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      (prev as Record<string, unknown>)[key] = obj[key as keyof DecorObject];
    }
    const cmd: Command = {
      do: () => Object.assign(obj, patch),
      undo: () => Object.assign(obj, prev),
    };
    get().applyCommand(cmd);
    return true;
  },

  updateNode: (id, patch) => {
    const map = get().map;
    if (!map) return false;
    const obj = map.objects.find((o) => o.id === id && o.kind === 'node') as NodeObject | undefined;
    if (!obj) return false;
    // rotation is optional: a zero angle is stored as `undefined` (key dropped by JSON.stringify) so
    // an unrotated node round-trips byte-identical, matching how `skin`/placement omit their defaults.
    const norm: Partial<NodeObject> = { ...patch };
    if ('rotation' in norm && !norm.rotation) norm.rotation = undefined;
    // depthBias mirrors rotation's omit-when-zero (plan 029) so an Inspector edit back to 0 clears
    // the key, matching `bumpDepth`'s normalisation.
    if ('depthBias' in norm && !norm.depthBias) norm.depthBias = undefined;
    const candidate: NodeObject = { ...obj, ...norm };
    if (!footprintIsValid(map, candidate)) return false;
    // Snapshot exactly the keys being patched (mirrors `updateDecor`) so undo restores rotation/skin
    // too, not just col/row.
    const prev: Partial<NodeObject> = {};
    for (const key of Object.keys(norm) as Array<keyof NodeObject>) {
      (prev as Record<string, unknown>)[key] = obj[key];
    }
    const cmd: Command = {
      do: () => Object.assign(obj, norm),
      undo: () => Object.assign(obj, prev),
    };
    get().applyCommand(cmd);
    return true;
  },

  cycleNodeSkin: (id) => {
    const map = get().map;
    if (!map) return false;
    const obj = map.objects.find((o) => o.id === id && o.kind === 'node') as NodeObject | undefined;
    if (!obj) return false;
    const def = get().nodeDefsParsed[obj.ref];
    if (!def || def.skins.length < 2) return false;
    const cur = obj.skin ?? def.skins[0].id;
    const idx = def.skins.findIndex((s) => s.id === cur);
    // Unknown current skin ⇒ treat as position 0 so the first cycle lands on skins[1].
    const next = def.skins[(Math.max(idx, 0) + 1) % def.skins.length];
    return get().updateNode(id, { skin: next.id });
  },

  updatePortal: (id, patch) => {
    const map = get().map;
    if (!map) return false;
    const obj = map.objects.find((o) => o.id === id && o.kind === 'portal') as
      PortalObject | undefined;
    if (!obj) return false;
    if (patch.rect) {
      const candidate: PortalObject = { ...obj, rect: patch.rect };
      if (!footprintIsValid(map, candidate)) return false;
    }
    const prev: Partial<Pick<PortalObject, 'name' | 'facing' | 'rect'>> = {
      name: obj.name,
      facing: obj.facing,
      rect: { ...obj.rect },
    };
    const cmd: Command = {
      do: () => Object.assign(obj, patch),
      undo: () => Object.assign(obj, prev),
    };
    get().applyCommand(cmd);
    return true;
  },

  rotateObjects: (ids, deltaDeg) => {
    const map = get().map;
    if (!map) return;
    const ops: Array<{ do: () => void; undo: () => void }> = [];
    for (const obj of map.objects) {
      if (!ids.includes(obj.id) || obj.kind !== 'decor') continue;
      const prevRotation = obj.rotation;
      const nextRotation = obj.rotation + deltaDeg;
      ops.push({
        do: () => {
          obj.rotation = nextRotation;
        },
        undo: () => {
          obj.rotation = prevRotation;
        },
      });
    }
    if (ops.length === 0) return;
    get().applyCommand(batchCommand(ops));
  },

  flipObjects: (ids, axis) => {
    const map = get().map;
    if (!map) return;
    const key = axis === 'x' ? 'flipX' : 'flipY';
    const ops: Array<{ do: () => void; undo: () => void }> = [];
    for (const obj of map.objects) {
      if (!ids.includes(obj.id) || obj.kind !== 'decor') continue;
      const prevVal = obj[key];
      const nextVal = !prevVal;
      ops.push({
        do: () => {
          obj[key] = nextVal;
        },
        undo: () => {
          obj[key] = prevVal;
        },
      });
    }
    if (ops.length === 0) return;
    get().applyCommand(batchCommand(ops));
  },

  bumpDepth: (ids, delta) => {
    const map = get().map;
    if (!map) return;
    const ops: Array<{ do: () => void; undo: () => void }> = [];
    for (const obj of map.objects) {
      if (!ids.includes(obj.id)) continue;
      if (obj.kind === 'decor') {
        const prevDepth = obj.depth;
        const nextDepth = obj.depth + delta;
        ops.push({
          do: () => {
            obj.depth = nextDepth;
          },
          undo: () => {
            obj.depth = prevDepth;
          },
        });
      } else if (obj.kind === 'node') {
        // depthBias is optional-omitted-when-zero (plan 029), matching how updateNode normalises
        // rotation: a bump that lands back on 0 clears the key so an unbiased node round-trips
        // byte-identical.
        const prevBias = obj.depthBias;
        const nextBias = (obj.depthBias ?? 0) + delta;
        const nextVal = nextBias === 0 ? undefined : nextBias;
        ops.push({
          do: () => {
            obj.depthBias = nextVal;
          },
          undo: () => {
            obj.depthBias = prevBias;
          },
        });
      }
      // portal ids fall through untouched (no depth/depthBias concept).
    }
    if (ops.length === 0) return;
    get().applyCommand(batchCommand(ops));
  },
});
