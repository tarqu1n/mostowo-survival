import Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import { rowDepthOffset, type MapFile } from '../../systems/mapFormat';
import { parseAssetId } from '../textureLoading';
import { resolveDecorDraw } from '../../render/decorSprites';
import { useEditorStore } from '../store/editorStore';
import { DEPTH_OBJECTS, NODE_MARKER, PORTAL_MARKER } from './constants';
import { redrawSelection } from './overlaysRenderer';
import type { EditorScene } from '../EditorScene';

// Object rendering for the editor scene (plan 043 mechanical split out of EditorScene.ts). Scene-
// scoped free functions over the `objectSprites`/`objectDisplayById` collections the EditorScene
// owns: build every decor/node/portal display GameObject, the id→display hit-test/highlight index,
// and the topmost-object pick used by the Select tool + eyedropper. Behaviour-preserving move only.

/** Destroy every object display GameObject and clear the hit-test index (the object-teardown half of
 *  `EditorScene.clearRender`). */
export function clearObjects(scene: EditorScene): void {
  for (const obj of scene.objectSprites) obj.destroy();
  scene.objectSprites = [];
  scene.objectDisplayById.clear();
}

/** Rebuilds every object's display GameObject(s) + the `objectDisplayById` hit-test/highlight index,
 *  then redraws the selection outline (bounds can change after a move/transform). */
export function placeObjects(scene: EditorScene, map: MapFile): void {
  for (const obj of scene.objectSprites) obj.destroy();
  scene.objectSprites = [];
  scene.objectDisplayById.clear();

  for (const obj of map.objects) {
    let display: Phaser.GameObjects.GameObject | undefined;
    if (obj.kind === 'decor') {
      display = placeDecor(scene, obj);
    } else if (obj.kind === 'node') {
      display = placeNodeSprite(scene, obj);
    } else {
      const { col, row, w, h } = obj.rect;
      const x = (col + w / 2) * TILE_SIZE;
      const y = (row + h / 2) * TILE_SIZE;
      display = addMarker(scene, x, y, w * TILE_SIZE, h * TILE_SIZE, PORTAL_MARKER, obj.name);
    }
    if (display) scene.objectDisplayById.set(obj.id, display);
  }
  redrawSelection(scene);
}

/** Renders a decor object through the shared `decorSprites` helper (region-crop / animated
 *  playback in-editor) — the same resolution the step-11 game loader will use, so there's exactly
 *  one place that knows how to turn a `DecorObject` into pixels. A plain image (no `region`/`anim`)
 *  and a `region` crop both draw as a static `Image`; an `anim` decor draws as a `Sprite` and starts
 *  playing immediately. */
function placeDecor(
  scene: EditorScene,
  obj: Extract<MapFile['objects'][number], { kind: 'decor' }>,
): Phaser.GameObjects.Image | Phaser.GameObjects.Sprite | undefined {
  let path: string;
  try {
    ({ path } = parseAssetId(obj.asset));
  } catch {
    return undefined; // already warned in queueTextures
  }
  const draw = resolveDecorDraw(scene, obj, path);
  if (!draw) return undefined; // texture missing — skip cleanly

  let display: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  if (draw.kind === 'anim') {
    const sprite = scene.add.sprite(obj.x, obj.y, draw.key);
    sprite.play(draw.animKey);
    display = sprite;
  } else if (draw.kind === 'region') {
    display = scene.add.image(obj.x, obj.y, draw.key, draw.frame);
  } else {
    display = scene.add.image(obj.x, obj.y, draw.key);
  }
  display.setScale(obj.scaleX, obj.scaleY);
  display.setAngle(obj.rotation); // stored in degrees (see mapFormat DecorObject)
  display.setFlip(obj.flipX, obj.flipY);
  display.setDepth(DEPTH_OBJECTS + obj.depth);
  scene.objectSprites.push(display);
  return display;
}

/** Nodes render per skin from the catalog, matching `ResourceNodeManager.applySkinAppearance`
 *  exactly (plan 021 step 6): resolve the placed skin (or the def's first/default) → its catalog
 *  sprite via the shared decor resolver; position = tile centre (both axes), scale =
 *  `skin.scale ?? def.scale` (native-pixel multiplier), origin = `(originX, originY)` with per-skin overrides.
 *  Falls back to a labelled marker (unknown ref, malformed/unresolved asset) so authoring always
 *  shows *something* pickable. */
function placeNodeSprite(
  scene: EditorScene,
  obj: Extract<MapFile['objects'][number], { kind: 'node' }>,
): Phaser.GameObjects.GameObject | undefined {
  const x = obj.col * TILE_SIZE + TILE_SIZE / 2;
  const y = obj.row * TILE_SIZE + TILE_SIZE / 2;
  // Reads the store's live parsed registry (plan 021 step 7), not the boot-time `NODES` import.
  const def = useEditorStore.getState().nodeDefsParsed[obj.ref];
  if (!def) return addMarker(scene, x, y, TILE_SIZE, TILE_SIZE, NODE_MARKER, obj.ref);

  const skin =
    (obj.skin !== undefined ? def.skins.find((s) => s.id === obj.skin) : undefined) ?? def.skins[0];
  let path: string;
  try {
    ({ path } = parseAssetId(skin.asset));
  } catch {
    return addMarker(scene, x, y, TILE_SIZE, TILE_SIZE, NODE_MARKER, obj.ref);
  }
  const draw = resolveDecorDraw(
    scene,
    { id: obj.ref, asset: skin.asset, ...(skin.region ? { region: skin.region } : {}) },
    path,
  );
  // Skins never carry an anim (see NodeSkinDef) — an 'anim' draw is unreachable, marker is defensive.
  if (!draw || draw.kind === 'anim')
    return addMarker(scene, x, y, TILE_SIZE, TILE_SIZE, NODE_MARKER, obj.ref);

  const img =
    draw.kind === 'region'
      ? scene.add.image(x, y, draw.key, draw.frame)
      : scene.add.image(x, y, draw.key);
  img.setScale(skin.scale ?? def.scale);
  img.setOrigin(skin.originX ?? def.originX, skin.originY ?? def.originY);
  img.setAngle(obj.rotation ?? 0); // stored in degrees (see mapFormat NodeObject); absent ⇒ upright
  img.setDepth(DEPTH_OBJECTS + rowDepthOffset(obj.row, obj.depthBias ?? 0));
  scene.objectSprites.push(img);
  return img;
}

function addMarker(
  scene: EditorScene,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: number,
  label: string,
): Phaser.GameObjects.GameObject {
  const rect = scene.add
    .rectangle(x, y, w, h, colour, 0.28)
    .setStrokeStyle(1, colour, 0.9)
    .setDepth(DEPTH_OBJECTS);
  scene.objectSprites.push(rect);
  const text = scene.add
    .text(x, y, label, { fontFamily: 'monospace', fontSize: '8px', color: '#f4ecd8' })
    .setOrigin(0.5)
    .setDepth(DEPTH_OBJECTS + 1);
  scene.objectSprites.push(text);
  return rect; // the outline rect is the hit-test/highlight bounds; the label just rides along
}

/** Topmost object under `(worldX,worldY)`: iterate every object's display bounds, preferring higher
 *  `depth` then later array position (insertion order) on a tie — "simple bounds check is fine
 *  in-editor" per the plan, mirroring the game's `pickSpriteAt` intent without its full complexity. */
export function pickObjectAt(
  scene: EditorScene,
  map: MapFile,
  worldX: number,
  worldY: number,
): string | null {
  let best: { id: string; depth: number; index: number } | null = null;
  map.objects.forEach((obj, index) => {
    const display = scene.objectDisplayById.get(obj.id);
    if (!display) return;
    const withBounds = display as unknown as { getBounds?: () => Phaser.Geom.Rectangle };
    if (typeof withBounds.getBounds !== 'function') return;
    const bounds = withBounds.getBounds();
    if (!Phaser.Geom.Rectangle.Contains(bounds, worldX, worldY)) return;
    const depth = (display as unknown as { depth?: number }).depth ?? 0;
    if (!best || depth > best.depth || (depth === best.depth && index > best.index)) {
      best = { id: obj.id, depth, index };
    }
  });
  return best ? (best as { id: string }).id : null;
}
