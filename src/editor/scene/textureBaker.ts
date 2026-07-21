import Phaser from 'phaser';
import { TILE_SIZE, GROUND_CHUNK_ROWS } from '../../config';
import { resolveTile, sheetKey, tileImageKey } from '../../data/tileset';
import { cellIndex, isInside, type MapFile } from '../../systems/mapFormat';
import { parseAssetId, tilesetAssetUrl } from '../textureLoading';
import { useEditorStore } from '../store/editorStore';
import { queueDecorTexture } from '../../render/decorSprites';
import { ghostBoundingBox, type GhostCell } from '../worldViewOps';
import { DEPTH_GHOST, GHOST_ALPHA } from './constants';
import type { EditorScene } from '../EditorScene';

// Tile/texture baking for the editor scene (plan 043 mechanical split out of EditorScene.ts). Pure,
// scene-scoped free functions (no owned state — the chunk/ghost RenderTexture handles live on the
// EditorScene): queue the textures a map needs, bake tile layers into chunked RenderTextures with the
// batch API (mirroring `world/groundRenderer.ts`), bake a neighbour ghost strip, and bake the
// save-thumbnail composite. Behaviour-preserving move only.

/** Queue every palette + decor texture the map needs (deduped by key). Returns whether anything
 *  was queued (nothing → bake synchronously). */
export function queueTextures(scene: EditorScene, map: MapFile): boolean {
  const seen = new Set<string>();
  const addImage = (key: string, url: string): void => {
    if (scene.textures.exists(key) || seen.has(key)) return;
    seen.add(key);
    scene.load.image(key, url);
  };
  const addSheet = (key: string, url: string): void => {
    if (scene.textures.exists(key) || seen.has(key)) return;
    seen.add(key);
    scene.load.spritesheet(key, url, { frameWidth: TILE_SIZE, frameHeight: TILE_SIZE });
  };

  for (const entry of map.palette) {
    if (!entry) continue;
    if (entry.source.kind === 'image') {
      addImage(tileImageKey(entry.source.path), tilesetAssetUrl(entry.pack, entry.source.path));
    } else {
      addSheet(sheetKey(entry.source.sheet), tilesetAssetUrl(entry.pack, entry.source.sheet));
    }
  }

  for (const obj of map.objects) {
    if (obj.kind === 'decor') {
      try {
        // Decor asset ids never carry a tile-style `#frame` suffix (that scheme is for Library tile
        // brushes only — see `resolveBrushValue`/`parseAssetId`'s doc); `queueDecorTexture` decides
        // whole-image vs spritesheet load from `obj.region`/`obj.anim` (mapFormat's own metadata),
        // not from the asset id shape, so `frame` is irrelevant here.
        const { pack, path } = parseAssetId(obj.asset);
        queueDecorTexture(scene, obj, path, tilesetAssetUrl(pack, path), seen);
      } catch (e) {
        console.warn(`[editor] skipping decor "${obj.id}": ${(e as Error).message}`);
      }
    } else if (obj.kind === 'node') {
      // Nodes render per skin from the catalog (matches ResourceNodeManager, plan 021 step 6) —
      // queue every skin's live + depleted asset of the referenced def so a placed skin, an
      // inspector override, or a cycle always has a resident texture. Skins carry no anim, so each
      // asset shares the plain whole-image `tileImageKey` (a region crop reuses it). An unknown ref
      // falls back to a marker (see placeNodeSprite), needing no texture. Reads the store's live
      // parsed registry (plan 021 step 7), not the boot-time `NODES` import, so an in-session def
      // edit is reflected without a reload.
      const def = useEditorStore.getState().nodeDefsParsed[obj.ref];
      if (!def) continue;
      const queueSkinAsset = (asset: string): void => {
        try {
          const { pack, path } = parseAssetId(asset);
          addImage(tileImageKey(path), tilesetAssetUrl(pack, path));
        } catch (e) {
          console.warn(
            `[editor] skipping node "${obj.id}" skin asset "${asset}": ${(e as Error).message}`,
          );
        }
      };
      for (const skin of def.skins) {
        queueSkinAsset(skin.asset);
        if (skin.depleted) queueSkinAsset(skin.depleted.asset);
      }
    }
  }

  return seen.size > 0;
}

export function bakeAllLayers(scene: EditorScene, map: MapFile): void {
  const cols = map.meta.width;
  const chunkCount = Math.ceil(map.meta.height / GROUND_CHUNK_ROWS);
  // Record the dims these RTs are sized for, so a later dimension change forces a full rebuild.
  scene.bakedWidth = map.meta.width;
  scene.bakedHeight = map.meta.height;
  scene.chunkRTs = map.layers.map((_layer, layerIndex) => {
    const rts: Phaser.GameObjects.RenderTexture[] = [];
    for (let chunk = 0; chunk < chunkCount; chunk++) {
      const startRow = chunk * GROUND_CHUNK_ROWS;
      const chunkRows = Math.min(GROUND_CHUNK_ROWS, map.meta.height - startRow);
      const rt = scene.add
        .renderTexture(0, startRow * TILE_SIZE, cols * TILE_SIZE, chunkRows * TILE_SIZE)
        .setOrigin(0, 0)
        .setDepth(layerIndex);
      rts.push(rt);
      bakeChunk(scene, map, layerIndex, chunk, rt);
    }
    return rts;
  });
}

/** Bake one layer chunk (up to GROUND_CHUNK_ROWS rows) with a single batched draw pass. */
export function bakeChunk(
  scene: EditorScene,
  map: MapFile,
  layerIndex: number,
  chunkIndex: number,
  rt: Phaser.GameObjects.RenderTexture,
): void {
  const layer = map.layers[layerIndex];
  const width = map.meta.width;
  const startRow = chunkIndex * GROUND_CHUNK_ROWS;
  const chunkRows = Math.min(GROUND_CHUNK_ROWS, map.meta.height - startRow);

  rt.clear();
  rt.beginDraw();
  for (let r = 0; r < chunkRows; r++) {
    const row = startRow + r;
    for (let col = 0; col < width; col++) {
      const paletteIndex = layer.cells[cellIndex(col, row, width)];
      if (paletteIndex === 0) continue; // empty cell
      const entry = map.palette[paletteIndex];
      if (!entry) continue;
      const { key, frame } = resolveTile(entry.source);
      if (!scene.textures.exists(key)) continue; // texture failed to load — skip, don't crash
      // stamp (not batchDrawFrame) so a rotated palette entry blits rotated; drawn about the tile
      // CENTRE with origin 0.5 so angle 0 lands on the exact same pixels as the old top-left blit.
      const angle = entry.rotation ?? 0;
      rt.stamp(key, frame, col * TILE_SIZE + TILE_SIZE / 2, r * TILE_SIZE + TILE_SIZE / 2, {
        angle,
        originX: 0.5,
        originY: 0.5,
        skipBatch: true,
      });
    }
  }
  rt.endDraw();
  rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST); // crisp when the camera scales it
}

/** Queue only the palette (tile-layer) textures of `map` — the ghost strips draw tile layers, not
 *  objects. `seen` dedupes across strips within one refresh. Returns whether anything was queued. */
export function queuePaletteTextures(scene: EditorScene, map: MapFile, seen: Set<string>): boolean {
  let queued = false;
  for (const entry of map.palette) {
    if (!entry) continue;
    if (entry.source.kind === 'image') {
      const key = tileImageKey(entry.source.path);
      if (!scene.textures.exists(key) && !seen.has(key)) {
        seen.add(key);
        scene.load.image(key, tilesetAssetUrl(entry.pack, entry.source.path));
        queued = true;
      }
    } else {
      const key = sheetKey(entry.source.sheet);
      if (!scene.textures.exists(key) && !seen.has(key)) {
        seen.add(key);
        scene.load.spritesheet(key, tilesetAssetUrl(entry.pack, entry.source.sheet), {
          frameWidth: TILE_SIZE,
          frameHeight: TILE_SIZE,
        });
        queued = true;
      }
    }
  }
  return queued;
}

/** Bake one neighbour's strip cells into a single dimmed RenderTexture, positioned just outside the
 *  open map's bounds in the open map's LOCAL scene coordinates (where my (0,0) is scene (0,0)); the
 *  strip's local cell coords are exactly that offset. All neighbour tile layers draw bottom→top. */
export function bakeGhostStrip(scene: EditorScene, nmap: MapFile, cells: GhostCell[]): void {
  const box = ghostBoundingBox(cells);
  if (!box) return;
  const cols = box.maxCol - box.minCol + 1;
  const rows = box.maxRow - box.minRow + 1;
  const rt = scene.add
    .renderTexture(
      box.minCol * TILE_SIZE,
      box.minRow * TILE_SIZE,
      cols * TILE_SIZE,
      rows * TILE_SIZE,
    )
    .setOrigin(0, 0)
    .setDepth(DEPTH_GHOST)
    .setAlpha(GHOST_ALPHA);
  const width = nmap.meta.width;
  rt.beginDraw();
  for (const cell of cells) {
    const dx = (cell.localCol - box.minCol) * TILE_SIZE;
    const dy = (cell.localRow - box.minRow) * TILE_SIZE;
    for (const layer of nmap.layers) {
      const paletteIndex = layer.cells[cellIndex(cell.neighbourCol, cell.neighbourRow, width)];
      if (paletteIndex === 0) continue;
      const entry = nmap.palette[paletteIndex];
      if (!entry) continue;
      const { key, frame } = resolveTile(entry.source);
      if (!scene.textures.exists(key)) continue;
      // stamp about the tile centre so rotated entries blit rotated (angle 0 = identical pixels).
      const angle = entry.rotation ?? 0;
      rt.stamp(key, frame, dx + TILE_SIZE / 2, dy + TILE_SIZE / 2, {
        angle,
        originX: 0.5,
        originY: 0.5,
        skipBatch: true,
      });
    }
  }
  rt.endDraw();
  rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  scene.ghostRTs.push(rt);
}

/**
 * Bakes the open map to a 1px-per-tile PNG `Blob` (tile layers bottom→top, clipped to the shape
 * mask, void = transparent) — the capability the React Save flow invokes through the store. Renders
 * a full-resolution composite offscreen, then downscales it by `1/TILE_SIZE` into a `width×height`
 * RenderTexture and snapshots that to a PNG. Resolves `null` if no map is open or the snapshot
 * fails (the caller treats that as "skip the thumbnail", never a save failure).
 */
export function bakeThumbnailBlob(scene: EditorScene): Promise<Blob | null> {
  const map = useEditorStore.getState().map;
  if (!map) return Promise.resolve(null);
  const { width, height } = map.meta;

  // 1) full-resolution composite (inside cells only → void stays transparent), offscreen.
  const full = scene.make.renderTexture(
    { width: width * TILE_SIZE, height: height * TILE_SIZE },
    false,
  );
  full.setOrigin(0, 0);
  for (const layer of map.layers) {
    full.beginDraw();
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (!isInside(map, col, row)) continue;
        const paletteIndex = layer.cells[cellIndex(col, row, width)];
        if (paletteIndex === 0) continue;
        const entry = map.palette[paletteIndex];
        if (!entry) continue;
        const { key, frame } = resolveTile(entry.source);
        if (!scene.textures.exists(key)) continue;
        // stamp about the tile centre so rotated entries blit rotated (angle 0 = identical pixels).
        const angle = entry.rotation ?? 0;
        full.stamp(key, frame, col * TILE_SIZE + TILE_SIZE / 2, row * TILE_SIZE + TILE_SIZE / 2, {
          angle,
          originX: 0.5,
          originY: 0.5,
          skipBatch: true,
        });
      }
    }
    full.endDraw();
  }

  // 2) downscale into a 1px-per-tile RenderTexture (drawing the scaled composite into it).
  const thumb = scene.make.renderTexture({ width, height }, false);
  thumb.setOrigin(0, 0);
  full
    .setPosition(0, 0)
    .setOrigin(0, 0)
    .setScale(1 / TILE_SIZE);
  thumb.draw(full);

  // 3) snapshot the thumb to a PNG blob (snapshot yields an <img> with a data URL → fetch → blob).
  return new Promise<Blob | null>((resolve) => {
    const cleanup = (): void => {
      full.destroy();
      thumb.destroy();
    };
    thumb.snapshot((result) => {
      if (result instanceof HTMLImageElement) {
        fetch(result.src)
          .then((r) => r.blob())
          .then((blob) => {
            cleanup();
            resolve(blob);
          })
          .catch(() => {
            cleanup();
            resolve(null);
          });
      } else {
        cleanup();
        resolve(null);
      }
    });
  });
}
