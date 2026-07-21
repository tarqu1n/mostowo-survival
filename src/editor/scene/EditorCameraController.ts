import Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import { type MapFile } from '../../systems/mapFormat';
import { useEditorStore } from '../store/editorStore';
import { getCamera, putCamera } from '../sessionStore';
import {
  mapContentBoundsPx,
  boundsOverlap,
  cameraViewportPx,
  type PxBounds,
} from '../cameraFraming';
import { MIN_ZOOM, MAX_ZOOM, PAN_MARGIN_TILES } from './constants';
import { updateHover } from './overlaysRenderer';
import type { EditorScene } from '../EditorScene';

/**
 * Camera control for the editor scene (plan 043 mechanical split out of EditorScene.ts): pannable
 * bounds, fit-to-content framing, saved-camera restore, integer wheel/step zoom anchored on a screen
 * point, and gesture-settle persistence (plan 034). Wheel-zoom listener wired in the constructor and
 * torn down in `destroy()` (called from `EditorScene.teardown`). Holds no persistent mutable state —
 * it drives `scene.cameras.main` directly. Behaviour-preserving move only.
 *
 * `zoomAnchored` is also the shared pivot the input controller's pinch gesture calls; `persistCamera`
 * the shared settle point every camera gesture (wheel / step / pan / pinch-end) writes through.
 */
export class EditorCameraController {
  constructor(private readonly scene: EditorScene) {
    scene.input.on(Phaser.Input.Events.POINTER_WHEEL, this.handleWheel, this);
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_WHEEL, this.handleWheel, this);
  }

  /** Set the pannable camera bounds for `map` (the fit margin included). Shared by `fitCamera` and the
   *  restore branch — scroll clamping depends on these bounds, so a restored camera must set them too. */
  private setCameraBounds(map: MapFile): void {
    const widthPx = map.meta.width * TILE_SIZE;
    const heightPx = map.meta.height * TILE_SIZE;
    const margin = PAN_MARGIN_TILES * TILE_SIZE;
    this.scene.cameras.main.setBounds(
      -margin,
      -margin,
      widthPx + margin * 2,
      heightPx + margin * 2,
    );
  }

  /** Fit-to-map. Frames the map's *authored content* (bounding box of painted tiles + objects) rather
   *  than the geometric canvas rectangle — a map's grid can be far larger than the region actually
   *  drawn (the moon map is 245×280 with all content in one ~78×67 blob), so centring on the canvas
   *  centre at the clamped integer zoom can land the view on blank space and the map "appears empty".
   *  Picks the largest integer zoom (MIN..MAX) whose viewport covers the content with a little margin,
   *  and centres on the content. A content-free map falls back to framing the whole canvas. */
  private fitCamera(map: MapFile): void {
    const cam = this.scene.cameras.main;
    this.setCameraBounds(map);
    const bounds = mapContentBoundsPx(map, TILE_SIZE);
    if (!bounds) {
      const widthPx = map.meta.width * TILE_SIZE;
      const heightPx = map.meta.height * TILE_SIZE;
      const fit = Math.min(this.scene.scale.width / widthPx, this.scene.scale.height / heightPx);
      cam.setZoom(Phaser.Math.Clamp(Math.floor(fit) || MIN_ZOOM, MIN_ZOOM, MAX_ZOOM));
      cam.centerOn(widthPx / 2, heightPx / 2);
      return;
    }
    // 10% breathing room so content isn't flush against the viewport edge.
    const contentW = (bounds.maxX - bounds.minX) * 1.1;
    const contentH = (bounds.maxY - bounds.minY) * 1.1;
    const fit = Math.min(this.scene.scale.width / contentW, this.scene.scale.height / contentH);
    cam.setZoom(Phaser.Math.Clamp(Math.floor(fit) || MIN_ZOOM, MIN_ZOOM, MAX_ZOOM));
    cam.centerOn((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
  }

  /** Restore the open map's saved camera (plan 034) if one exists, else fit-to-map. The restore branch
   *  keeps the same bounds `fitCamera` sets (Phaser clamps the restored scroll to them) and only
   *  overrides zoom/scroll. This is the ONLY camera *read* site, and it must NOT persist — a
   *  programmatic camera set is not a user settle, so there is no feedback loop into `putCamera`. A map
   *  with no saved camera (brand-new, or never panned) deterministically re-fits on every load.
   *
   *  Stale-camera guard: if the map HAS content but the restored viewport shows none of it, the saved
   *  camera is stranded over blank canvas (the reported "map loads empty" symptom on a large, sparsely
   *  authored map) — treat it as unhelpful and re-fit to the content instead. */
  restoreOrFitCamera(map: MapFile): void {
    const mapId = useEditorStore.getState().mapId;
    const saved = mapId ? getCamera(mapId) : null;
    if (!saved) {
      this.fitCamera(map);
      return;
    }
    const cam = this.scene.cameras.main;
    this.setCameraBounds(map);
    cam.setZoom(Phaser.Math.Clamp(saved.zoom, MIN_ZOOM, MAX_ZOOM));
    cam.setScroll(saved.scrollX, saved.scrollY);

    const content = mapContentBoundsPx(map, TILE_SIZE);
    if (content) {
      const view: PxBounds = cameraViewportPx(
        cam.scrollX,
        cam.scrollY,
        cam.zoom,
        this.scene.scale.width,
        this.scene.scale.height,
      );
      if (!boundsOverlap(view, content)) this.fitCamera(map);
    }
  }

  /** Persist the open map's current camera (plan 034), keyed by map id. Called only at a USER
   *  camera-gesture *settle* (pan / wheel / step-zoom / pinch end) — never per move-frame and never
   *  from a programmatic move (`fitCamera`/`restoreOrFitCamera`), so the saved value is always a
   *  place the user actually left the view. Zoom is rounded to honour the integer-zoom invariant. */
  persistCamera(): void {
    const mapId = useEditorStore.getState().mapId;
    if (!mapId) return;
    const c = this.scene.cameras.main;
    putCamera(mapId, { scrollX: c.scrollX, scrollY: c.scrollY, zoom: Math.round(c.zoom) });
  }

  private handleWheel(
    pointer: Phaser.Input.Pointer,
    _over: Phaser.GameObjects.GameObject[],
    _dx: number,
    dy: number,
  ): void {
    const next = Phaser.Math.Clamp(
      Math.round(this.scene.cameras.main.zoom) + (dy > 0 ? -1 : 1),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    this.zoomAnchored(next, pointer.x, pointer.y);
    this.persistCamera();
    updateHover(this.scene, pointer);
  }

  /** Step the integer zoom by `delta` (+1 in, −1 out), anchored on the viewport centre — the on-screen
   *  button equivalent of a wheel notch (which anchors on the cursor). Clamped to MIN..MAX; a step at a
   *  bound is a no-op (`zoomAnchored` early-returns when the level doesn't change). Installed on the
   *  store as `zoomViewport` for the ContextBar buttons to call. */
  zoomByStep(delta: number): void {
    const next = Phaser.Math.Clamp(
      Math.round(this.scene.cameras.main.zoom) + delta,
      MIN_ZOOM,
      MAX_ZOOM,
    );
    this.zoomAnchored(next, this.scene.scale.width / 2, this.scene.scale.height / 2);
    this.persistCamera();
  }

  /**
   * Set the camera zoom to `next` (already clamped/rounded) while keeping the world point under the
   * given screen anchor fixed. Shared by wheel-zoom (anchor = cursor) and pinch-zoom (anchor =
   * two-finger midpoint). getWorldPoint() inverts a matrix that's only rebuilt once per frame in
   * preRender(), so it can't be trusted immediately after setZoom() in the same tick. Re-derive the
   * same transform preRender() builds (Camera#preRender in phaser.esm.js): zoom pivots around the
   * viewport's origin (default centre), so world = scroll + origin + (screen - camXY - origin) / zoom.
   */
  zoomAnchored(next: number, screenX: number, screenY: number): void {
    const cam = this.scene.cameras.main;
    const zoomBefore = cam.zoom;
    if (next === zoomBefore) return;
    const originX = cam.width * cam.originX;
    const originY = cam.height * cam.originY;
    const relX = screenX - cam.x - originX;
    const relY = screenY - cam.y - originY;
    const worldX = cam.scrollX + originX + relX / zoomBefore;
    const worldY = cam.scrollY + originY + relY / zoomBefore;
    cam.setZoom(next);
    cam.scrollX = worldX - originX - relX / next;
    cam.scrollY = worldY - originY - relY / next;
  }
}
