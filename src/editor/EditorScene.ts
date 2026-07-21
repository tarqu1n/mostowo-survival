import Phaser from 'phaser';
import { type MapFile } from '../systems/mapFormat';
import { useEditorStore } from './store/editorStore';
import { EditorCameraController } from './scene/EditorCameraController';
import { EditorInputController } from './scene/EditorInputController';
import { queueTextures, bakeAllLayers, bakeChunk, bakeThumbnailBlob } from './scene/textureBaker';
import { placeObjects, clearObjects } from './scene/objectRenderer';
import {
  createOverlayObjects,
  clearOverlayGraphics,
  clearGhosts,
  destroyUnderlay,
  redrawOverlays,
  redrawSelection,
  redrawRegion,
  refreshBrushGhost,
  refreshGhosts,
  refreshUnderlay,
} from './scene/overlaysRenderer';

/**
 * The editor's single Phaser scene (plan 014 step 5). Renders the open map pixel-identically to the
 * game via the same `resolveTile` seam: tile layers bake into per-layer chunked `RenderTexture`s
 * with the batch API (mirroring `world/groundRenderer.ts` — per-tile `drawFrame` is pathologically
 * slow), objects draw on top with their stored transform, and overlay `Graphics` draw the void
 * checker, grid, walkability tint/hatch, zone tints/labels, the shape-tool boundary outline, and the
 * hover cell above everything (step 8 adds walkability/zones/shape). Void cells reject the hover
 * cursor.
 *
 * It observes the editor store (the sole React↔Phaser bridge): a `mapEpoch` change = full reload
 * (textures → bake → camera fit); a `docRevision` change = rebake in place; an `overlays` change =
 * overlay redraw; an `activeTool` change also triggers an overlay redraw (step 8 — the shape-tool
 * boundary only shows while that tool is active). Robustness: a texture that fails to load is logged
 * and skipped (authored maps may reference assets that don't exist yet mid-development), never
 * crashing the scene.
 *
 * Plan 043: this class is the thin composition root. It owns the document lifecycle + the render-
 * state handles (chunk/ghost/underlay/object/overlay GameObjects) and wires the store subscriptions,
 * but delegates all rendering + input to the `scene/` modules: `textureBaker`/`objectRenderer`/
 * `overlaysRenderer` (scene-scoped free functions over those handles) and the `EditorCameraController`
 * /`EditorInputController` classes (which wire + tear down their own listeners). The render-state
 * handles are deliberately public so those modules can operate on them.
 */
export class EditorScene extends Phaser.Scene {
  private unsubs: Array<() => void> = [];
  currentEpoch = -1;

  chunkRTs: Phaser.GameObjects.RenderTexture[][] = []; // [layerIndex][chunkIndex]
  /** The map dims the chunk RTs were last baked at. Chunk-RT sizes derive from map dims, so a resize
   *  (or its undo/redo — plan 024) that changes width/height must rebuild wholesale, not rebake in
   *  place; `onDocEdited` compares these against the current dims to trigger that (see its guard). */
  bakedWidth = -1;
  bakedHeight = -1;
  /** One dimmed RenderTexture per placed neighbour whose tiles reach into the open map's border ring
   *  (step 9). Rebuilt by `refreshGhosts`; strictly read-only + non-interactive. */
  ghostRTs: Phaser.GameObjects.RenderTexture[] = [];
  /** "N neighbour(s) missing/invalid" notice, camera-fixed; rebuilt each `refreshGhosts`. */
  ghostNotice?: Phaser.GameObjects.Text;
  /** Bumped on every `refreshGhosts` so a slower earlier async pass (neighbour fetch + texture load)
   *  that resolves late can detect it's been superseded and bail before drawing stale strips. */
  ghostEpoch = 0;
  /** The reference-overlay tracing sprite (plan 022), or `undefined` when none is picked/visible.
   *  Rendered above the tile layers at `DEPTH_UNDERLAY`. */
  underlayImage?: Phaser.GameObjects.Image;
  /** Bumped per `refreshUnderlay` so a slow async texture load resolving late detects it was
   *  superseded and bails before drawing (mirrors `ghostEpoch`). */
  underlayEpoch = 0;
  /** The data URL currently resident under `UNDERLAY_TEXTURE_KEY` — lets a transform-only change
   *  (opacity/offset/scale slider) skip re-decoding the large base64 image and just re-apply the
   *  transform to the existing sprite, reloading the texture only when the image itself changes. */
  underlayTextureDataUrl?: string;
  objectSprites: Phaser.GameObjects.GameObject[] = [];
  /** Object id → its primary display GameObject (decor's image; node/portal's marker rect) — lets the
   *  select tool hit-test/highlight by id without re-deriving bounds from map data (step 7). Rebuilt
   *  every `placeObjects` call. */
  objectDisplayById = new Map<string, Phaser.GameObjects.GameObject>();
  voidGfx?: Phaser.GameObjects.Graphics;
  gridGfx?: Phaser.GameObjects.Graphics;
  hoverGfx?: Phaser.GameObjects.Graphics;
  /** Translucent preview of the armed tileset piece under the cursor, rotated to `brushRotation`
   *  (plan 026). Only shown for the `brush` tool with an asset armed and the cursor inside the map. */
  brushGhost?: Phaser.GameObjects.Image;
  /** Last tile the pointer hovered while inside the map, or null when off-map — lets the brush ghost
   *  re-render on `brushRotation`/`brushAsset`/tool changes without waiting for a pointer move. */
  hoverTile: { col: number; row: number } | null = null;
  /** Brush-ghost texture keys already load-requested, so a not-yet-loaded armed tile is fetched ONCE
   *  (never re-queued every hover — a 404'd asset would otherwise loop). Never cleared. */
  ghostTexturesRequested = new Set<string>();
  rectPreviewGfx?: Phaser.GameObjects.Graphics;
  selectionGfx?: Phaser.GameObjects.Graphics;
  /** The persistent highlight of the Select tool's marquee region (`store.regionSelection`). Redrawn
   *  on every region change; cleared when the region clears or the tool leaves `select`. */
  regionGfx?: Phaser.GameObjects.Graphics;
  // ---- Step 8 overlays ----
  walkabilityGfx?: Phaser.GameObjects.Graphics;
  zonesGfx?: Phaser.GameObjects.Graphics;
  shapeBoundaryGfx?: Phaser.GameObjects.Graphics;
  /** Zone name labels (Graphics can't draw text) — rebuilt every `drawZonesOverlay` call. */
  zoneLabelTexts: Phaser.GameObjects.Text[] = [];

  /** Camera control (pan bounds, fit/restore, wheel/step zoom, gesture-settle persist). */
  cameraController!: EditorCameraController;
  /** Pointer/gesture/keyboard input + tool dispatch. */
  inputController!: EditorInputController;

  constructor() {
    super('Editor');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)'); // transparent — the dark pane shows through
    createOverlayObjects(this);

    // A texture that 404s (an authored map may reference an asset that doesn't exist yet) is logged
    // and skipped — the bake checks `textures.exists` before drawing, so a missing tile just no-ops.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      const url = typeof file.url === 'string' ? file.url : '?'; // Phaser types url as string|object
      console.warn(`[editor] texture failed to load, skipping: ${file.key} (${url})`);
    });

    // Camera + input controllers wire their own input/window listeners (and tear them down in
    // `destroy()`, called from `teardown`). NOTE: any shortcut/gesture they add or change must be
    // reflected in `shortcuts.ts` (the Shortcuts panel).
    this.cameraController = new EditorCameraController(this);
    this.inputController = new EditorInputController(this);

    // Observe the store (the sole React↔Phaser bridge). subscribeWithSelector fires only on change,
    // so we do an explicit initial sync below for the already-open map on a remount.
    this.unsubs.push(
      useEditorStore.subscribe(
        (s) => s.mapEpoch,
        () => this.syncDocument(),
      ),
      useEditorStore.subscribe(
        (s) => s.docRevision,
        () => this.onDocEdited(),
      ),
      useEditorStore.subscribe(
        (s) => s.overlays,
        () => {
          redrawOverlays(this);
          void refreshGhosts(this); // ghosts toggle lives in overlays.ghosts (step 9)
        },
      ),
      // Ghost strips refresh on VIEW-SWITCH back to the Map tab (plan 014 step 9: "refresh on
      // view-switch/reopen, no live sync") — a neighbour placed/moved in the World tab shows next
      // time the Map tab is shown, without any live cross-tab wiring.
      useEditorStore.subscribe(
        (s) => s.activeTabId,
        (activeTabId) => {
          if (activeTabId === 'map') void refreshGhosts(this);
        },
      ),
      // The shape-tool boundary outline only draws while that tool is active (step 8) — re-render on
      // every tool switch so entering/leaving `shape` shows/hides it.
      useEditorStore.subscribe(
        (s) => s.activeTool,
        () => {
          redrawOverlays(this);
          refreshBrushGhost(this); // hide/show the tile preview when entering/leaving the brush tool
          this.inputController.updateToolCursor(); // eyedropper pipette when the eyedropper tool is active
          redrawRegion(this); // show/hide the marquee region box when entering/leaving Select
        },
      ),
      // Marquee region highlight (region select & move): redraw whenever the box is set/moved/cleared.
      useEditorStore.subscribe(
        (s) => s.regionSelection,
        () => redrawRegion(this),
      ),
      // Eyedropper cursor: reflect the physical Alt modifier over a tile-paint tool the moment it's
      // pressed/released (a pointer-move also refreshes it from the click's native event — see
      // handlePointerMove — so it still tracks even if this store flag ever desyncs via a blur).
      useEditorStore.subscribe(
        (s) => s.altHeld,
        () => this.inputController.updateToolCursor(),
      ),
      // Brush ghost preview (plan 026): re-render when the armed asset or its pending rotation changes,
      // so pressing R / re-arming updates the preview without needing a pointer move.
      useEditorStore.subscribe(
        (s) => s.brushRotation,
        () => refreshBrushGhost(this),
      ),
      useEditorStore.subscribe(
        (s) => s.brushAsset,
        () => refreshBrushGhost(this),
      ),
      useEditorStore.subscribe(
        (s) => s.hiddenLayerIds,
        () => this.applyLayerVisibility(),
      ),
      useEditorStore.subscribe(
        (s) => s.selectedObjectIds,
        () => redrawSelection(this),
      ),
      // Compact drawers (Library/Inspector) toggling can strand a phantom touch (see
      // `resetTouchGesture`); EditorApp bumps this nonce on every toggle so we clear that state.
      useEditorStore.subscribe(
        (s) => s.pointerGestureResetNonce,
        () => this.inputController.resetTouchGesture(),
      ),
      // Reference underlay (plan 022): re-render on every underlay change — pick/clear, a transform
      // slider, visibility/lock toggle, or a lifecycle swap. `refreshUnderlay` reads the latest
      // `underlay` via getState() and reloads the texture only when the image itself changed.
      useEditorStore.subscribe(
        (s) => s.underlayRevision,
        () => refreshUnderlay(this),
      ),
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());

    // Install the thumbnail-bake capability the React Save flow invokes through the store (the bridge
    // is store-only — no scene ref in React; see editorStore's `bakeThumbnail` doc). Cleared on
    // teardown so a torn-down scene (StrictMode double-mount / HMR) never leaves a dangling closure.
    useEditorStore.getState().setBakeThumbnail(() => bakeThumbnailBlob(this));
    // Install the viewport-zoom capability the on-screen zoom buttons (ContextBar) invoke through the
    // store — same store-only bridge as the thumbnail bake above. Cleared on teardown.
    useEditorStore.getState().setZoomViewport((delta) => this.cameraController.zoomByStep(delta));

    this.syncDocument();
  }

  private teardown(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.inputController.destroy();
    this.cameraController.destroy();
    if (useEditorStore.getState().bakeThumbnail) useEditorStore.getState().setBakeThumbnail(null);
    if (useEditorStore.getState().zoomViewport) useEditorStore.getState().setZoomViewport(null);
    clearGhosts(this);
    destroyUnderlay(this);
  }

  // ---- Document lifecycle ----

  /** Full (re)load: tear down the current render, then queue textures and bake once loaded. */
  private syncDocument(): void {
    const { map, mapEpoch } = useEditorStore.getState();
    this.currentEpoch = mapEpoch;
    this.clearRender();
    if (!map) {
      redrawOverlays(this);
      return;
    }
    this.loadTexturesThenBuild(map, mapEpoch);
  }

  private clearRender(): void {
    for (const layer of this.chunkRTs) for (const rt of layer) rt.destroy();
    this.chunkRTs = [];
    clearGhosts(this);
    destroyUnderlay(this);
    clearObjects(this);
    clearOverlayGraphics(this);
    // A full document reload invalidates any in-flight paint/object interaction (the layer/cells/
    // objects it was targeting may no longer exist).
    this.inputController.clearInteractionState();
  }

  private loadTexturesThenBuild(map: MapFile, epoch: number): void {
    const queued = queueTextures(this, map);
    const build = (): void => {
      if (this.currentEpoch !== epoch) return; // a newer reload superseded this one
      this.buildScene(map);
    };
    if (queued) {
      this.load.once(Phaser.Loader.Events.COMPLETE, build);
      this.load.start();
    } else {
      build();
    }
  }

  private buildScene(map: MapFile): void {
    bakeAllLayers(this, map);
    placeObjects(this, map);
    redrawOverlays(this);
    this.applyLayerVisibility();
    this.cameraController.restoreOrFitCamera(map);
    // A reopen/reload re-derives the neighbour ghost strips from the current world layout (step 9).
    void refreshGhosts(this);
    // …and the reference underlay from persisted per-map settings (plan 022). Handles the case where
    // the underlay is already hydrated at build time; a late hydrate fires the subscription instead.
    refreshUnderlay(this);
  }

  /**
   * Rebake in place after an in-map edit (step 6). A layer added/removed changes `chunkRTs.length`
   * vs `map.layers.length` — that's still the safest signal to rebuild wholesale (a chunk-RT set
   * needs creating/destroying, not just redrawing). Otherwise, consume `pendingDirty` (set by the
   * paint actions just before this fires — see editorStore's module doc): when present, rebake only
   * those chunks of that one layer; when absent (undo/redo, layer rename/reorder/overhead toggle,
   * favourites, or any future edit that doesn't report dirty chunks) fall back to the full chunked
   * rebake, which stays correct for every case including reorder (see editorStore's module doc for
   * why reorder needs no dedicated handling here).
   */
  private onDocEdited(): void {
    const { map } = useEditorStore.getState();
    if (!map) return;
    if (
      this.chunkRTs.length !== map.layers.length ||
      this.bakedWidth !== map.meta.width ||
      this.bakedHeight !== map.meta.height
    ) {
      // Layer set OR map dimensions changed — chunk RTs must be recreated, not just redrawn, so
      // rebuild wholesale (also refits the camera + re-derives ghosts/underlay). The dims arm fires
      // for a resize and for its undo/redo, since all three bump `docRevision` (plan 024).
      this.syncDocument();
      return;
    }

    // Capture the bake plan now (dirty chunks vs. full rebake); a first-use tile may need its
    // texture loaded before baking, so the actual draw runs synchronously if every texture is
    // already resident, or deferred to load-COMPLETE otherwise.
    const dirty = useEditorStore.getState().consumePendingDirty();
    const bake = (): void => {
      const dirtyRts = dirty ? this.chunkRTs[dirty.layerIndex] : undefined;
      if (dirty && dirtyRts) {
        for (const chunk of dirty.chunks) {
          const rt = dirtyRts[chunk];
          if (rt) bakeChunk(this, map, dirty.layerIndex, chunk, rt);
        }
      } else {
        for (let layerIndex = 0; layerIndex < map.layers.length; layerIndex++) {
          const rts = this.chunkRTs[layerIndex];
          for (let chunk = 0; chunk < rts.length; chunk++) {
            bakeChunk(this, map, layerIndex, chunk, rts[chunk]);
          }
        }
      }
      placeObjects(this, map);
      redrawOverlays(this);
      this.applyLayerVisibility();
    };
    this.ensureTexturesThenBake(map, bake);
  }

  /** Painting can introduce a palette entry (or decor) whose texture wasn't loaded at map-load time
   *  (a fresh map loads nothing). Queue any missing textures and defer `bake` to load-COMPLETE;
   *  bake synchronously when everything is already resident. `bakeChunk` redraws a whole chunk from
   *  current cell data, so it stays correct even if several deferred bakes coalesce onto one
   *  COMPLETE during a fast drag over a first-use tile. */
  private ensureTexturesThenBake(map: MapFile, bake: () => void): void {
    if (queueTextures(this, map)) {
      this.load.once(Phaser.Loader.Events.COMPLETE, bake);
      this.load.start();
    } else {
      bake();
    }
  }

  /** Layer visibility is editor VIEW state (`hiddenLayerIds`), never map data — hide/show the
   *  already-baked RenderTextures rather than skipping their bake. */
  private applyLayerVisibility(): void {
    const { map, hiddenLayerIds } = useEditorStore.getState();
    if (!map) return;
    for (let layerIndex = 0; layerIndex < map.layers.length; layerIndex++) {
      const hidden = hiddenLayerIds.includes(map.layers[layerIndex].id);
      const rts = this.chunkRTs[layerIndex];
      if (!rts) continue;
      for (const rt of rts) rt.setVisible(!hidden);
    }
  }
}
