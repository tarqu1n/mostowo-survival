import Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import { resolveTile, type TileSource } from '../../data/tileset';
import { getCell, isInside, parseMap, type MapFile } from '../../systems/mapFormat';
import { worldToTile } from '../../systems/grid';
import { useEditorStore, type UnderlayState } from '../store/editorStore';
import { parseAssetId, tilesetAssetUrl } from '../textureLoading';
import { getMap } from '../api';
import { computeGhostStripCells, type GhostCell } from '../worldViewOps';
import { objectFootprintCells } from '../objectOps';
import { queuePaletteTextures, bakeGhostStrip } from './textureBaker';
import {
  BRUSH_GHOST_ALPHA,
  DEPTH_GHOST_NOTICE,
  DEPTH_GRID,
  DEPTH_HOVER,
  DEPTH_RECT_PREVIEW,
  DEPTH_REGION,
  DEPTH_SELECTION,
  DEPTH_SHAPE_BOUNDARY,
  DEPTH_UNDERLAY,
  DEPTH_VOID,
  DEPTH_WALKABILITY,
  DEPTH_ZONE_LABELS,
  DEPTH_ZONES,
  GHOST_STRIP_TILES,
  GRID_COLOUR,
  HOVER_COLOUR,
  REGION_COLOUR,
  SELECTION_COLOUR,
  SHAPE_BOUNDARY_COLOUR,
  UNDERLAY_TEXTURE_KEY,
  VOID_COLOUR_A,
  VOID_COLOUR_B,
  VOID_HATCH,
  WALKABILITY_HATCH,
  WALKABILITY_TINT,
} from './constants';
import type { EditorScene } from '../EditorScene';

// Overlay/guide rendering for the editor scene (plan 043 mechanical split out of EditorScene.ts).
// Scene-scoped free functions over the Graphics/Image/Text handles the EditorScene owns: the void
// checker, grid, walkability tint/hatch, zone tints/labels, shape boundary, hover cell + translucent
// brush ghost, rect-drag preview, object-selection outline, marquee region box, neighbour ghost
// strips, and the reference tracing underlay. Behaviour-preserving move only.

/** Create the persistent overlay GameObjects the scene owns (depth-ordered Graphics + the brush-ghost
 *  Image). Called once from `EditorScene.create`. */
export function createOverlayObjects(scene: EditorScene): void {
  scene.voidGfx = scene.add.graphics().setDepth(DEPTH_VOID);
  scene.walkabilityGfx = scene.add.graphics().setDepth(DEPTH_WALKABILITY);
  scene.zonesGfx = scene.add.graphics().setDepth(DEPTH_ZONES);
  scene.gridGfx = scene.add.graphics().setDepth(DEPTH_GRID);
  scene.shapeBoundaryGfx = scene.add.graphics().setDepth(DEPTH_SHAPE_BOUNDARY);
  scene.hoverGfx = scene.add.graphics().setDepth(DEPTH_HOVER);
  // Brush ghost sits at the same depth as the hover outline but is added AFTER it, so the tile
  // preview draws on top of the outline. Non-interactive (Image default) — never eats pointer events.
  scene.brushGhost = scene.add
    .image(0, 0, '__DEFAULT')
    .setOrigin(0.5)
    .setDepth(DEPTH_HOVER)
    .setVisible(false);
  scene.selectionGfx = scene.add.graphics().setDepth(DEPTH_SELECTION);
  scene.regionGfx = scene.add.graphics().setDepth(DEPTH_REGION);
  scene.rectPreviewGfx = scene.add.graphics().setDepth(DEPTH_RECT_PREVIEW);
}

/** Clear every overlay Graphics + reset the hover/brush-ghost state (the render-teardown half of
 *  `EditorScene.clearRender`). */
export function clearOverlayGraphics(scene: EditorScene): void {
  scene.voidGfx?.clear();
  scene.walkabilityGfx?.clear();
  scene.zonesGfx?.clear();
  for (const t of scene.zoneLabelTexts) t.destroy();
  scene.zoneLabelTexts = [];
  scene.gridGfx?.clear();
  scene.shapeBoundaryGfx?.clear();
  scene.hoverGfx?.clear();
  scene.hoverTile = null;
  scene.brushGhost?.setVisible(false);
  scene.selectionGfx?.clear();
  scene.regionGfx?.clear();
  scene.rectPreviewGfx?.clear();
}

export function redrawOverlays(scene: EditorScene): void {
  const { map, overlays, activeTool } = useEditorStore.getState();
  drawVoid(scene, map);
  drawGrid(scene, map, overlays.grid);
  drawWalkabilityOverlay(scene, map, overlays.walkability);
  drawZonesOverlay(scene, map, overlays.zones);
  drawShapeBoundary(scene, map, activeTool === 'shape');
  if (!map) {
    scene.hoverGfx?.clear();
    scene.hoverTile = null;
    scene.brushGhost?.setVisible(false);
  }
}

/** Red ~40% tint on blocked base-terrain cells (`walkability.cells[i] === 1`), toggled by
 *  `overlays.walkability`. Also hatches the footprint of every RUNTIME obstacle that composites on
 *  top of base terrain at runtime — decor WITH a `collision` footprint, and every node — read-only,
 *  for authoring clarity (walkability painting never touches these; see the store's module doc).
 *  Cosmetic decor (no `collision`) and portals don't block, so they're excluded. */
export function drawWalkabilityOverlay(
  scene: EditorScene,
  map: MapFile | null,
  show: boolean,
): void {
  const g = scene.walkabilityGfx;
  if (!g) return;
  g.clear();
  g.setVisible(show);
  if (!map || !show) return;
  const { width, height } = map.meta;

  g.fillStyle(WALKABILITY_TINT, 0.4);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (getCell(map.walkability.cells, col, row, width) !== 1) continue;
      g.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  g.lineStyle(1, WALKABILITY_HATCH, 0.55);
  for (const obj of map.objects) {
    if (obj.kind === 'portal') continue; // portals never block
    if (obj.kind === 'decor' && !obj.collision) continue; // cosmetic decor doesn't block
    for (const { col, row } of objectFootprintCells(obj, map.meta.tileSize)) {
      if (col < 0 || row < 0 || col >= width || row >= height) continue;
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      g.lineBetween(x, y, x + TILE_SIZE, y + TILE_SIZE);
      g.lineBetween(x + TILE_SIZE, y, x, y + TILE_SIZE);
    }
  }
}

/** Each zone def rendered as its colour at ~30% alpha over its cells, plus a name label at the
 *  region's centroid, toggled by `overlays.zones`. */
export function drawZonesOverlay(scene: EditorScene, map: MapFile | null, show: boolean): void {
  const g = scene.zonesGfx;
  for (const t of scene.zoneLabelTexts) t.destroy();
  scene.zoneLabelTexts = [];
  if (!g) return;
  g.clear();
  g.setVisible(show);
  if (!map || !show) return;
  const { width, height } = map.meta;

  for (const def of map.zones.defs) {
    let colour: number;
    try {
      colour = Phaser.Display.Color.HexStringToColor(def.colour).color;
    } catch {
      colour = 0x888888; // malformed colour string — still show SOMETHING rather than skip the zone
    }
    g.fillStyle(colour, 0.3);
    let sumCol = 0;
    let sumRow = 0;
    let count = 0;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (getCell(map.zones.cells, col, row, width) !== def.id) continue;
        g.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        sumCol += col + 0.5;
        sumRow += row + 0.5;
        count++;
      }
    }
    if (count === 0) continue; // an empty zone def has no cells to centre a label on
    const text = scene.add
      .text((sumCol / count) * TILE_SIZE, (sumRow / count) * TILE_SIZE, def.name, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#f4ecd8',
        backgroundColor: 'rgba(0,0,0,0.45)',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_ZONE_LABELS);
    scene.zoneLabelTexts.push(text);
  }
}

/** While the shape tool is active, trace a bright outline along the inside/void boundary (and the
 *  map edge) so the author can see the authored mask clearly while carving it. */
export function drawShapeBoundary(scene: EditorScene, map: MapFile | null, show: boolean): void {
  const g = scene.shapeBoundaryGfx;
  if (!g) return;
  g.clear();
  g.setVisible(show);
  if (!map || !show) return;
  const { width, height } = map.meta;
  g.lineStyle(2, SHAPE_BOUNDARY_COLOUR, 0.95);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!isInside(map, col, row)) continue;
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      if (row === 0 || !isInside(map, col, row - 1)) g.lineBetween(x, y, x + TILE_SIZE, y);
      if (row === height - 1 || !isInside(map, col, row + 1)) {
        g.lineBetween(x, y + TILE_SIZE, x + TILE_SIZE, y + TILE_SIZE);
      }
      if (col === 0 || !isInside(map, col - 1, row)) g.lineBetween(x, y, x, y + TILE_SIZE);
      if (col === width - 1 || !isInside(map, col + 1, row)) {
        g.lineBetween(x + TILE_SIZE, y, x + TILE_SIZE, y + TILE_SIZE);
      }
    }
  }
}

export function drawVoid(scene: EditorScene, map: MapFile | null): void {
  const g = scene.voidGfx;
  if (!g) return;
  g.clear();
  if (!map?.shape) return; // absent shape ⇒ all-inside, nothing to hatch
  const { width, height } = map.meta;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (isInside(map, col, row)) continue;
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      g.fillStyle((col + row) % 2 === 0 ? VOID_COLOUR_A : VOID_COLOUR_B, 1);
      g.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      g.lineStyle(1, VOID_HATCH, 0.5);
      g.lineBetween(x, y + TILE_SIZE, x + TILE_SIZE, y);
    }
  }
}

export function drawGrid(scene: EditorScene, map: MapFile | null, show: boolean): void {
  const g = scene.gridGfx;
  if (!g) return;
  g.clear();
  g.setVisible(show);
  if (!map || !show) return;
  const { width, height } = map.meta;
  g.lineStyle(1, GRID_COLOUR, 0.35);
  for (let col = 0; col <= width; col++) {
    g.lineBetween(col * TILE_SIZE, 0, col * TILE_SIZE, height * TILE_SIZE);
  }
  for (let row = 0; row <= height; row++) {
    g.lineBetween(0, row * TILE_SIZE, width * TILE_SIZE, row * TILE_SIZE);
  }
}

export function updateHover(scene: EditorScene, pointer: Phaser.Input.Pointer): void {
  const g = scene.hoverGfx;
  if (!g) return;
  g.clear();
  const { map } = useEditorStore.getState();
  if (!map) {
    scene.hoverTile = null;
    refreshBrushGhost(scene);
    return;
  }
  const { col, row } = pointerTile(scene, pointer);
  if (!isInside(map, col, row)) {
    scene.hoverTile = null; // reject the cursor on void / out-of-bounds cells
    refreshBrushGhost(scene);
    return;
  }
  scene.hoverTile = { col, row };
  g.lineStyle(1.5, HOVER_COLOUR, 0.9);
  g.strokeRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  refreshBrushGhost(scene);
}

/** Clear the hover outline + brush ghost and forget the hovered tile (touch pointer-up: no cursor
 *  sits over a cell once the finger lifts). */
export function clearHover(scene: EditorScene): void {
  scene.hoverTile = null;
  scene.hoverGfx?.clear();
  refreshBrushGhost(scene);
}

/**
 * Update the translucent brush-tile preview (plan 026). Shows a copy of the armed tileset piece —
 * rotated to `brushRotation` — centred on the hovered tile, but only for the `brush` tool with an
 * asset armed and the cursor inside the map; hidden otherwise. Resolves the texture via the same
 * `parseAssetId → TileSource → resolveTile` chain the paint path uses; if the texture isn't loaded
 * yet it is load-requested ONCE (see `ghostTexturesRequested`) and the ghost stays hidden until it
 * arrives. A malformed armed id just hides the preview (the paint path already warns on it).
 */
export function refreshBrushGhost(scene: EditorScene): void {
  const ghost = scene.brushGhost;
  if (!ghost) return;
  const { map, activeTool, brushAsset, brushRotation } = useEditorStore.getState();
  const tile = scene.hoverTile;
  if (!map || activeTool !== 'brush' || !brushAsset || !tile) {
    ghost.setVisible(false);
    return;
  }
  try {
    const { pack, path, frame } = parseAssetId(brushAsset);
    const source: TileSource =
      frame === undefined ? { kind: 'image', path } : { kind: 'sheetFrame', sheet: path, frame };
    const { key, frame: texFrame } = resolveTile(source);
    if (!scene.textures.exists(key)) {
      // Not loaded yet (armed straight from the Library, never painted) — fetch it once, then the
      // COMPLETE handler re-runs this method and the preview appears. Guard against re-queuing so a
      // 404'd asset doesn't loop.
      if (!scene.ghostTexturesRequested.has(key)) {
        scene.ghostTexturesRequested.add(key);
        if (source.kind === 'image') {
          scene.load.image(key, tilesetAssetUrl(pack, source.path));
        } else {
          scene.load.spritesheet(key, tilesetAssetUrl(pack, source.sheet), {
            frameWidth: TILE_SIZE,
            frameHeight: TILE_SIZE,
          });
        }
        scene.load.once(Phaser.Loader.Events.COMPLETE, () => refreshBrushGhost(scene));
        scene.load.start();
      }
      ghost.setVisible(false);
      return;
    }
    if (texFrame === undefined) ghost.setTexture(key);
    else ghost.setTexture(key, texFrame);
    ghost.texture.setFilter(Phaser.Textures.FilterMode.NEAREST); // crisp pixels at any zoom
    ghost
      .setPosition(tile.col * TILE_SIZE + TILE_SIZE / 2, tile.row * TILE_SIZE + TILE_SIZE / 2)
      .setOrigin(0.5)
      .setAngle(brushRotation)
      .setAlpha(BRUSH_GHOST_ALPHA)
      .setVisible(true);
  } catch {
    ghost.setVisible(false);
  }
}

/** The tile `(col,row)` the pointer is currently over, in world/map space. */
export function pointerTile(
  scene: EditorScene,
  pointer: Phaser.Input.Pointer,
): {
  col: number;
  row: number;
} {
  const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
  return { col: worldToTile(world.x), row: worldToTile(world.y) };
}

/** Live outline shown while dragging the rect/portal tool, from the pressed corner to the current
 *  cell. `colour` defaults to the paint-rect preview's hue; the Portal tool passes its own so the
 *  two read as visually distinct while dragging. */
export function drawRectPreview(
  scene: EditorScene,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  colour: number = HOVER_COLOUR,
): void {
  const g = scene.rectPreviewGfx;
  if (!g) return;
  g.clear();
  const minCol = Math.min(c0, c1);
  const maxCol = Math.max(c0, c1);
  const minRow = Math.min(r0, r1);
  const maxRow = Math.max(r0, r1);
  g.lineStyle(2, colour, 0.9);
  g.strokeRect(
    minCol * TILE_SIZE,
    minRow * TILE_SIZE,
    (maxCol - minCol + 1) * TILE_SIZE,
    (maxRow - minRow + 1) * TILE_SIZE,
  );
}

/** Strokes an outline around each selected object's current display bounds. Redrawn on selection
 *  change AND after every `placeObjects` (a move/transform changes bounds). */
export function redrawSelection(scene: EditorScene): void {
  const g = scene.selectionGfx;
  if (!g) return;
  g.clear();
  const { map, selectedObjectIds } = useEditorStore.getState();
  if (!map || selectedObjectIds.length === 0) return;
  g.lineStyle(2, SELECTION_COLOUR, 1);
  for (const id of selectedObjectIds) {
    const display = scene.objectDisplayById.get(id);
    if (!display) continue;
    const withBounds = display as unknown as { getBounds?: () => Phaser.Geom.Rectangle };
    if (typeof withBounds.getBounds !== 'function') continue;
    const bounds = withBounds.getBounds();
    g.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }
}

/** Draws the Select tool's marquee region box (`store.regionSelection`) — a translucent amber fill +
 *  outline over the whole selected tile area. Only shown while the Select tool is active; cleared
 *  otherwise (a different tool, no box, or no map). */
export function redrawRegion(scene: EditorScene): void {
  const g = scene.regionGfx;
  if (!g) return;
  g.clear();
  const { map, regionSelection, activeTool } = useEditorStore.getState();
  if (!map || !regionSelection || activeTool !== 'select') return;
  const x = regionSelection.col * TILE_SIZE;
  const y = regionSelection.row * TILE_SIZE;
  const w = regionSelection.w * TILE_SIZE;
  const h = regionSelection.h * TILE_SIZE;
  g.fillStyle(REGION_COLOUR, 0.12);
  g.fillRect(x, y, w, h);
  g.lineStyle(2, REGION_COLOUR, 0.95);
  g.strokeRect(x, y, w, h);
}

// ---- Neighbour ghost strips (step 9) ----

export function clearGhosts(scene: EditorScene): void {
  for (const rt of scene.ghostRTs) rt.destroy();
  scene.ghostRTs = [];
  scene.ghostNotice?.destroy();
  scene.ghostNotice = undefined;
}

/**
 * Rebuild the read-only, dimmed strips of every placed NEIGHBOUR's tile layers that reach into the
 * open map's ~`GHOST_STRIP_TILES`-deep border ring (plan 014 step 9). Gated on `overlays.ghosts`
 * AND the open map being placed in `world`. Neighbour files are fetched on demand (`getMap` →
 * `parseMap`) and clipped STRICTLY to the ring (via `computeGhostStripCells`, never the whole
 * neighbour map); a neighbour that's missing/invalid is skipped and counted into a small on-screen
 * notice. Async + guarded by `ghostEpoch` so a stale in-flight pass (slow fetch/texture load) never
 * draws over a newer one. No live cross-editor sync — this only runs on map reopen, ghosts-toggle,
 * or a switch back to the Map tab (see `EditorScene.create`'s subscriptions).
 */
export async function refreshGhosts(scene: EditorScene): Promise<void> {
  const token = ++scene.ghostEpoch;
  clearGhosts(scene);
  const { map, mapId, world, overlays } = useEditorStore.getState();
  if (!map || !mapId || !overlays.ghosts) return;
  const mine = world.placements.find((p) => p.mapId === mapId);
  if (!mine) return; // the open map isn't placed — nothing to ghost against

  const strips: Array<{ map: MapFile; cells: GhostCell[] }> = [];
  const missing: string[] = [];
  for (const n of world.placements) {
    if (n.mapId === mapId) continue;
    let nmap: MapFile;
    try {
      nmap = parseMap(await getMap(n.mapId));
    } catch {
      missing.push(n.mapId);
      continue;
    }
    if (token !== scene.ghostEpoch) return; // a newer refresh superseded this pass
    const cells = computeGhostStripCells(
      mine.origin,
      map.meta.width,
      map.meta.height,
      GHOST_STRIP_TILES,
      n.origin,
      nmap.meta.width,
      nmap.meta.height,
      (col, row) => isInside(nmap, col, row),
    );
    if (cells.length > 0) strips.push({ map: nmap, cells });
  }
  if (token !== scene.ghostEpoch) return;

  // Queue every neighbour palette texture the strips need (deduped), then bake once resident.
  const seen = new Set<string>();
  let queued = false;
  for (const strip of strips) {
    if (queuePaletteTextures(scene, strip.map, seen)) queued = true;
  }
  const bake = (): void => {
    if (token !== scene.ghostEpoch) return;
    for (const strip of strips) bakeGhostStrip(scene, strip.map, strip.cells);
    showGhostNotice(scene, missing);
  };
  if (queued) {
    scene.load.once(Phaser.Loader.Events.COMPLETE, bake);
    scene.load.start();
  } else {
    bake();
  }
}

/** Small camera-fixed notice when one or more placed neighbours couldn't be loaded/parsed. */
export function showGhostNotice(scene: EditorScene, missing: string[]): void {
  if (missing.length === 0) return;
  const msg = `⚠ ${missing.length} neighbour${missing.length === 1 ? '' : 's'} missing/invalid: ${missing.join(', ')}`;
  scene.ghostNotice = scene.add
    .text(6, 6, msg, {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#f4d0c8',
      backgroundColor: 'rgba(74,36,32,0.85)',
      padding: { x: 4, y: 2 },
    })
    .setScrollFactor(0)
    .setDepth(DEPTH_GHOST_NOTICE);
}

// ---- Reference underlay (plan 022) ----

/** Destroy the underlay sprite and remove its texture (Phaser errors on re-adding a live key).
 *  Idempotent — safe to call when nothing is resident (teardown / clearRender / a hidden underlay). */
export function destroyUnderlay(scene: EditorScene): void {
  scene.underlayImage?.destroy();
  scene.underlayImage = undefined;
  if (scene.textures.exists(UNDERLAY_TEXTURE_KEY)) scene.textures.remove(UNDERLAY_TEXTURE_KEY);
  scene.underlayTextureDataUrl = undefined;
}

function applyUnderlayTransform(img: Phaser.GameObjects.Image, u: UnderlayState): void {
  img.setPosition(u.offsetX * TILE_SIZE, u.offsetY * TILE_SIZE);
  img.setScale(u.scale);
  img.setAlpha(u.opacity);
}

/**
 * Reconcile the on-screen underlay against `store.underlay` (plan 022). Absent or hidden → tear it
 * down. A transform-only change (same `dataUrl` already resident) → re-apply position/scale/alpha to
 * the existing sprite, no reload. A new/changed image → remove the old texture and load the data URL
 * under the fixed `UNDERLAY_TEXTURE_KEY`, creating the sprite at `DEPTH_UNDERLAY` (above the tile
 * layers) on load COMPLETE. Async + epoch-guarded (`underlayEpoch`) so a slow load resolving after a newer
 * refresh never draws stale. A decode failure is non-fatal — the global FILE_LOAD_ERROR handler warns
 * and the `textures.exists` check leaves the underlay simply absent.
 */
export function refreshUnderlay(scene: EditorScene): void {
  const token = ++scene.underlayEpoch;
  const underlay = useEditorStore.getState().underlay;
  if (!underlay || !underlay.visible) {
    destroyUnderlay(scene);
    return;
  }
  // Same image already resident → transform-only update (skip the base64 re-decode).
  if (scene.underlayImage && scene.underlayTextureDataUrl === underlay.dataUrl) {
    applyUnderlayTransform(scene.underlayImage, underlay);
    return;
  }
  // New or changed image — drop the old texture (dup-key guard) and reload.
  destroyUnderlay(scene);
  const dataUrl = underlay.dataUrl;
  const place = (): void => {
    if (token !== scene.underlayEpoch) return; // a newer refresh superseded this load
    if (!scene.textures.exists(UNDERLAY_TEXTURE_KEY)) return; // decode failed — FILE_LOAD_ERROR warned
    const u = useEditorStore.getState().underlay; // re-read: a transform may have changed mid-load
    if (!u || !u.visible) {
      destroyUnderlay(scene);
      return;
    }
    scene.underlayTextureDataUrl = dataUrl;
    scene.underlayImage = scene.add
      .image(0, 0, UNDERLAY_TEXTURE_KEY)
      .setOrigin(0, 0)
      .setDepth(DEPTH_UNDERLAY);
    applyUnderlayTransform(scene.underlayImage, u);
  };
  scene.load.image(UNDERLAY_TEXTURE_KEY, dataUrl);
  scene.load.once(Phaser.Loader.Events.COMPLETE, place);
  scene.load.start();
}
