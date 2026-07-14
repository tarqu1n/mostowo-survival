import Phaser from 'phaser';
import { TILE_SIZE, GROUND_CHUNK_ROWS } from '../../config';
import { resolveTile } from '../../data/tileset';
import { cellIndex, type MapFile } from '../../systems/mapFormat';

// Tile layers occupy depth `0..layers.length-1` (mirroring the editor's `EditorScene` depth
// convention — see its module comment). `overhead` layers (e.g. a tree canopy) need to sit above
// actors instead, a case a flat depth-0 bake can't express. The editor's own bake
// doesn't yet differentiate `overhead` for depth (every tile layer sits below its `DEPTH_OBJECTS`
// regardless), so there's no live precedent for the exact number here — chosen with headroom over
// the highest known actor depth (`PlayerCharacter` 10; `MonsterCharacter` body 9 + accessory z up to
// ~2 → 11). Revisit if it reads wrong against the night overlay
// (depth 15) or any future actor depth.
const OVERHEAD_LAYER_DEPTH = 20;

/**
 * Bakes a map's authored tile layers into RenderTextures (plan 018 step A4) — the world's ground
 * render. Mirrors the editor's `EditorScene.bakeAllLayers`/`bakeChunk`
 * (read-only reference — logic duplicated here per the plan's editor-import guardrail, not
 * imported): per `layer` in `map.layers`, bake `GROUND_CHUNK_ROWS`-tall RenderTexture chunks; per
 * cell, `layer.cells[cellIndex(col,row,map.meta.width)]` → skip `0` (empty) → `map.palette[idx]` →
 * `resolveTile(entry.source)` → batched `NEAREST`-filtered draw. Depth is layer order, EXCEPT
 * `layer.overhead` layers get `OVERHEAD_LAYER_DEPTH` (above actors).
 *
 * `originPx` is the map's placement in GLOBAL pixel space (plan 018 decision: use global tile
 * coords + an origin offset throughout the runtime path, even though this step's only caller passes
 * `{x:0,y:0}`, so plan 019's map streaming can reuse this unchanged for maps placed away from the
 * world origin). Each chunk's RenderTexture is positioned at `originPx` (offset by its own row) in
 * world space; cell draws inside it use chunk-LOCAL pixel offsets — together those two put every
 * tile at its correct global pixel position without sizing any one RT to the whole world. Cell
 * lookups (`cellIndex`, `map.palette`) stay in map-LOCAL col/row throughout, matching how A11's
 * `isBlocked` composite converts a global col/row back to local by subtracting the map's origin.
 */
export function drawMapLayers(
  scene: Phaser.Scene,
  map: MapFile,
  originPx: { x: number; y: number },
): void {
  const width = map.meta.width;
  const height = map.meta.height;

  map.layers.forEach((layer, layerIndex) => {
    const depth = layer.overhead ? OVERHEAD_LAYER_DEPTH : layerIndex;
    for (let startRow = 0; startRow < height; startRow += GROUND_CHUNK_ROWS) {
      const chunkRows = Math.min(GROUND_CHUNK_ROWS, height - startRow);
      const rt = scene.add
        .renderTexture(
          originPx.x,
          originPx.y + startRow * TILE_SIZE,
          width * TILE_SIZE,
          chunkRows * TILE_SIZE,
        )
        .setOrigin(0, 0)
        .setDepth(depth);
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
          rt.batchDrawFrame(key, frame, col * TILE_SIZE, r * TILE_SIZE);
        }
      }
      rt.endDraw();
      rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST); // crisp pixels when the camera scales it
    }
  });
}
