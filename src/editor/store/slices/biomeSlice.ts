/**
 * Plan 052 Step 10 — bakes a Step 9 `BiomeResult` into the live `MapFile` as ONE atomic undoable
 * command: `applyBiomeResult(result, origin, edgeSets)`. `result` is region-local (Steps 7-9's own
 * convention); `origin` is where that region sits in the real map (tile coords) — every cell/placement
 * is translated by `origin` before it touches `map`. `edgeSets` is the same loaded tile-edge-set
 * catalog Step 9 needed to generate `result` in the first place, needed again here to resolve each
 * `TerrainCell.edgeSetId` to a real `{pack, sheet}` for the palette.
 *
 * **Layer resolution** (per plan): the `'base'` role (bands — mud/water/…) bakes onto the CURRENT
 * active layer (falling back to the map's first layer), matching how terrain painting already targets
 * `activeLayerId`. The `'overlay'` role (the biome's base terrain, e.g. grass, alpha-cutout over holes
 * punched by the bands — see `terrain.ts`'s module doc) needs to draw ABOVE that, so it bakes onto a
 * freshly-added higher-index `TileLayer` — but ONLY when `result` actually contains overlay cells,
 * skipping layer creation entirely otherwise (an empty biome/region produces none). Every real biome in
 * this plan (Step 6's Forest preset) always paints its base terrain as the overlay role regardless of
 * whether it has any band, so in practice this condition is almost always true — the plan's original
 * "only if the biome uses an overlay band" framing predates Step 7 landing; skipping on empty output is
 * what it becomes once "overlay" means "the base terrain's own cells", not "an overlay-method band".
 * KNOWN SCOPE LIMIT: each call that produces overlay cells adds its OWN new layer — repeated applies in
 * different regions (rather than the undo→regen→apply re-roll flow Step 11 uses) will accumulate
 * multiple "Biome Overlay" layers over time. No cross-apply layer reuse is implemented here (would need
 * new persisted state this step doesn't add); flagged as a known follow-up, not silently swallowed.
 *
 * **Objects**: every `ScatterPlacement` becomes a real `NodeObject`/`DecorObject` (auto id via
 * `nextObjectId`, mirroring `placeNode`/`placeDecor`), gated on `footprintIsValid` (which itself checks
 * `isInside`) — an object that would land on void/out-of-bounds is DROPPED, not fatal to the rest of the
 * apply (mirrors how `duplicateObjects` drops an individual copy rather than aborting the batch).
 *
 * Tile edits + the optional new layer + object inserts are bundled into ONE `batchCommand` so the whole
 * apply is a single undo entry — this is what makes Step 11's re-roll (undo → regenerate → apply) clean.
 * Sets `pendingDirty: null` before `applyCommand` (full rebake), mirroring `terrainSlice.ts`'s own
 * precedent for a multi-cell bulk edit rather than tracking precise per-chunk dirt.
 */

import {
  cellIndex,
  isInside,
  type DecorObject,
  type MapFile,
  type MapObject,
  type NodeObject,
  type TileLayer,
} from '../../../systems/mapFormat';
import type { TileSource } from '../../../data/tileset';
import { TILE_SIZE } from '../../../config';
import { findOrAppendPaletteIndex } from '../../paintOps';
import type { TerrainBakeChange } from '../../terrainOps';
import { batchCommand, footprintIsValid, nextObjectId } from '../../objectOps';
import type { BiomeResult, ScatterPlacement, TerrainCell } from '../../../systems/biomeGen';
import type { EdgeSet } from '../../../systems/edgeSets';
import { type Command } from '../history';
import type { EditorSlice, EditorState } from '../types';

/** Next auto `layer_NNNN` id — duplicates `layersSlice.ts`'s private helper of the same name (not
 *  exported from there; mirrors `objectOps.ts`'s own precedent for small, private, single-purpose
 *  helpers duplicated across modules rather than exported solely for one new caller). */
function nextLayerId(map: MapFile): string {
  let max = 0;
  for (const layer of map.layers) {
    const m = /^layer_(\d+)$/.exec(layer.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `layer_${String(max + 1).padStart(4, '0')}`;
}

/** Resolves one `TerrainCell` to a palette `{pack, source}` pair. `frame` cells reference a sheet frame
 *  on the edge set's own sheet; `imageAsset` cells (a depth level's `fillAsset`, see `edgeSets.ts`) are
 *  committed sibling files under the edge set's own `edge-sets/` dir (verified against
 *  `public/assets/tilesets/pixel-crawler/edge-sets/water.json`'s real `fillAsset` values). */
function tileSourceForCell(
  edgeSet: EdgeSet,
  cell: TerrainCell,
): { pack: string; source: TileSource } {
  if (cell.frame !== undefined) {
    return {
      pack: edgeSet.pack,
      source: { kind: 'sheetFrame', sheet: edgeSet.sheet, frame: cell.frame },
    };
  }
  if (cell.imageAsset === undefined) {
    throw new Error(
      `applyBiomeResult: terrain cell has neither frame nor imageAsset (edge set "${edgeSet.id}")`,
    );
  }
  return { pack: edgeSet.pack, source: { kind: 'image', path: `edge-sets/${cell.imageAsset}` } };
}

/** Translates one role's region-local `TerrainCell`s into absolute-map `TerrainBakeChange`s against
 *  `layerCells`, resolving each cell's palette index (append-only) along the way. Cells landing outside
 *  the map or on a void tile are dropped (defense in depth — `generateBiome`'s own `existing.isInside`
 *  should already have excluded these if the caller wired it up, but this is the first point that has
 *  the REAL map to check against). */
function tileCellChanges(
  cells: readonly TerrainCell[],
  origin: { col: number; row: number },
  map: MapFile,
  layerCells: readonly number[],
  edgeSets: Record<string, EdgeSet>,
): TerrainBakeChange[] {
  const width = map.meta.width;
  const changes: TerrainBakeChange[] = [];
  const seen = new Set<number>();
  for (const cell of cells) {
    const col = origin.col + cell.col;
    const row = origin.row + cell.row;
    if (!isInside(map, col, row)) continue;
    const index = cellIndex(col, row, width);
    if (seen.has(index)) continue; // Step 7 emits one cell per position — guard anyway
    seen.add(index);
    const edgeSet = edgeSets[cell.edgeSetId];
    if (!edgeSet) {
      throw new Error(`applyBiomeResult: no edge set registered for id "${cell.edgeSetId}"`);
    }
    const { pack, source } = tileSourceForCell(edgeSet, cell);
    const next = findOrAppendPaletteIndex(map, pack, source, cell.rotation);
    const prev = layerCells[index];
    if (prev !== next) changes.push({ index, prev, next });
  }
  return changes;
}

/** Op pair for a `TerrainBakeChange[]` — mirrors `store/shared.ts`'s `commandFromChanges` but supports a
 *  DIFFERENT `next` value per cell (a biome bake paints many distinct frames in one call, unlike a
 *  single-value paint stroke). Returns `null` (nothing to fold into the batch) when `changes` is empty. */
function opFromBakeChanges(
  cells: number[],
  changes: TerrainBakeChange[],
): { do: () => void; undo: () => void } | null {
  if (changes.length === 0) return null;
  return {
    do: () => {
      for (const c of changes) cells[c.index] = c.next;
    },
    undo: () => {
      for (const c of changes) cells[c.index] = c.prev;
    },
  };
}

/** Builds a real `MapObject` from one region-local `ScatterPlacement`, or `null` if its footprint is
 *  invalid (void/out-of-bounds) — dropped, not fatal. `extraIds` mirrors `duplicateObjects`'s pattern:
 *  ids already minted earlier in this same batch, so `nextObjectId` never collides within one apply. */
function resolveObject(
  placement: ScatterPlacement,
  origin: { col: number; row: number },
  map: MapFile,
  extraIds: readonly string[],
): MapObject | null {
  if (placement.kind === 'node') {
    const obj: NodeObject = {
      id: nextObjectId(map, 'node', extraIds),
      kind: 'node',
      ref: placement.ref,
      col: origin.col + placement.col,
      row: origin.row + placement.row,
      ...(placement.skin === undefined ? {} : { skin: placement.skin }),
    };
    return footprintIsValid(map, obj) ? obj : null;
  }
  const obj: DecorObject = {
    id: nextObjectId(map, 'decor', extraIds),
    kind: 'decor',
    asset: placement.asset,
    x: origin.col * TILE_SIZE + placement.x,
    y: origin.row * TILE_SIZE + placement.y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
    depth: 0,
  };
  return footprintIsValid(map, obj) ? obj : null;
}

export const biomeSlice: EditorSlice<Pick<EditorState, 'applyBiomeResult'>> = (set, get) => ({
  applyBiomeResult: (
    result: BiomeResult,
    origin: { col: number; row: number },
    edgeSets: Record<string, EdgeSet>,
  ) => {
    const map = get().map;
    if (!map) return false;
    const activeLayer = map.layers.find((l) => l.id === get().activeLayerId) ?? map.layers[0];
    if (!activeLayer) return false;

    const ops: Array<{ do: () => void; undo: () => void }> = [];

    const baseEdits = result.tileEdits.find((l) => l.layerRole === 'base');
    if (baseEdits && baseEdits.cells.length > 0) {
      const changes = tileCellChanges(baseEdits.cells, origin, map, activeLayer.cells, edgeSets);
      const op = opFromBakeChanges(activeLayer.cells, changes);
      if (op) ops.push(op);
    }

    const overlayEdits = result.tileEdits.find((l) => l.layerRole === 'overlay');
    if (overlayEdits && overlayEdits.cells.length > 0) {
      const newLayer: TileLayer = {
        id: nextLayerId(map),
        name: 'Biome Overlay',
        kind: 'tiles',
        overhead: false,
        cells: new Array<number>(map.meta.width * map.meta.height).fill(0),
      };
      ops.push({
        do: () => {
          map.layers.push(newLayer);
        },
        undo: () => {
          const i = map.layers.indexOf(newLayer);
          if (i >= 0) map.layers.splice(i, 1);
        },
      });
      const changes = tileCellChanges(overlayEdits.cells, origin, map, newLayer.cells, edgeSets);
      const op = opFromBakeChanges(newLayer.cells, changes);
      if (op) ops.push(op);
    }

    const mintedIds: string[] = [];
    const newObjects: MapObject[] = [];
    for (const placement of result.objects) {
      const obj = resolveObject(placement, origin, map, mintedIds);
      if (!obj) continue;
      mintedIds.push(obj.id);
      newObjects.push(obj);
    }
    if (newObjects.length > 0) {
      ops.push({
        do: () => {
          map.objects.push(...newObjects);
        },
        undo: () => {
          for (const obj of newObjects) {
            const i = map.objects.indexOf(obj);
            if (i >= 0) map.objects.splice(i, 1);
          }
        },
      });
    }

    if (ops.length === 0) return true; // nothing survived exclusion — not an error

    const cmd: Command = batchCommand(ops);
    set({ pendingDirty: null });
    get().applyCommand(cmd);
    return true;
  },
});
