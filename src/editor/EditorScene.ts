import Phaser from 'phaser';
import { TILE_SIZE, GROUND_CHUNK_ROWS } from '../config';
import { ACTIVE_TILESET, resolveTile, sheetKey, tileImageKey } from '../data/tileset';
import { NODES } from '../data/nodes';
import { cellIndex, getCell, isInside, type MapFile, type PortalRect } from '../systems/mapFormat';
import { worldToTile, snapToTileCenter } from '../systems/grid';
import { useEditorStore, type PaintMode } from './store/editorStore';
import { parseAssetId, tilesetAssetUrl } from './textureLoading';
import { queueDecorTexture, resolveDecorDraw } from '../render/decorSprites';
import { objectFootprintCells } from './objectOps';

/** Which target grid a `collision`/`zone`/`shape` tool gesture writes to (plan 014 step 8) — see
 *  `dispatchTargetPaint`. */
type PaintTarget = 'collision' | 'zone' | 'shape';

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
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const PAN_MARGIN_TILES = 6;

// Render depths. Tile layers occupy 0..layers.length-1; everything else sits above them.
const DEPTH_VOID = 500;
const DEPTH_OBJECTS = 1000;
const DEPTH_WALKABILITY = 1500;
const DEPTH_ZONES = 1550;
const DEPTH_ZONE_LABELS = 1560;
const DEPTH_GRID = 9000;
const DEPTH_SHAPE_BOUNDARY = 9100;
const DEPTH_HOVER = 9500;
const DEPTH_SELECTION = 9550;
const DEPTH_RECT_PREVIEW = 9600;

// Void checker — two near-black shades per cell plus a faint diagonal, reads as "out of bounds".
const VOID_COLOUR_A = 0x0a0807;
const VOID_COLOUR_B = 0x181113;
const VOID_HATCH = 0x2a2320;
const GRID_COLOUR = 0x4a3f38;
const HOVER_COLOUR = 0xf0d890;
const SELECTION_COLOUR = 0x5fd0ff;
const PORTAL_PREVIEW_COLOUR = 0x7aa6ff;
const COLLISION_PREVIEW_COLOUR = 0xd06a5a;
const ZONE_PREVIEW_COLOUR = 0x8fd67a;
const SHAPE_PREVIEW_COLOUR = 0xfff05a;

// Step 8 overlays.
const WALKABILITY_TINT = 0xd04040;
const WALKABILITY_HATCH = 0xffffff;
const SHAPE_BOUNDARY_COLOUR = 0xfff05a;

// Node/portal marker fallback (used when a node ref is unknown, or its tile texture isn't resident —
// real tile-role sprite rendering is the step-7 default; portals are always a labelled outline).
const NODE_MARKER = 0x66bb66;
const PORTAL_MARKER = 0x7aa6ff;

export class EditorScene extends Phaser.Scene {
  private unsubs: Array<() => void> = [];
  private currentEpoch = -1;

  private chunkRTs: Phaser.GameObjects.RenderTexture[][] = []; // [layerIndex][chunkIndex]
  private objectSprites: Phaser.GameObjects.GameObject[] = [];
  /** Object id → its primary display GameObject (decor's image; node/portal's marker rect) — lets the
   *  select tool hit-test/highlight by id without re-deriving bounds from map data (step 7). Rebuilt
   *  every `placeObjects` call. */
  private objectDisplayById = new Map<string, Phaser.GameObjects.GameObject>();
  private voidGfx?: Phaser.GameObjects.Graphics;
  private gridGfx?: Phaser.GameObjects.Graphics;
  private hoverGfx?: Phaser.GameObjects.Graphics;
  private rectPreviewGfx?: Phaser.GameObjects.Graphics;
  private selectionGfx?: Phaser.GameObjects.Graphics;
  // ---- Step 8 overlays ----
  private walkabilityGfx?: Phaser.GameObjects.Graphics;
  private zonesGfx?: Phaser.GameObjects.Graphics;
  private shapeBoundaryGfx?: Phaser.GameObjects.Graphics;
  /** Zone name labels (Graphics can't draw text) — rebuilt every `drawZonesOverlay` call. */
  private zoneLabelTexts: Phaser.GameObjects.Text[] = [];

  private panning = false;
  private panLast = { x: 0, y: 0 };
  private spaceDown = false;
  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleSpaceKey(e, true);
  private readonly onKeyUp = (e: KeyboardEvent): void => this.handleSpaceKey(e, false);

  // ---- Paint tool state (step 6) ----
  private strokeCounter = 0;
  /** An in-progress brush/eraser drag: which tool, its coalescing strokeId, and the last painted
   *  cell (so pointermove paints the segment since last position — no gaps on a fast drag). */
  private activeStroke: {
    tool: 'brush' | 'eraser';
    strokeId: string;
    lastCol: number;
    lastRow: number;
  } | null = null;
  /** An in-progress rect-tool drag: the pressed corner. Committed as one command on pointer-up. */
  private rectDrag: { startCol: number; startRow: number } | null = null;

  // ---- Collision/zone/shape tool state (step 8) ----
  /** An in-progress collision/zone/shape brush drag: which target grid, the value it's painting
   *  (`on`, locked at pointer-down — see `handleTargetToolDown`'s doc on why a modifier held mid-drag
   *  doesn't retroactively change it), its coalescing strokeId, and the last painted cell. Mirrors
   *  `activeStroke` (tile brush/eraser) generalised over the target grid instead of duplicating it. */
  private activeTargetStroke: {
    target: PaintTarget;
    on: boolean;
    strokeId: string;
    lastCol: number;
    lastRow: number;
  } | null = null;
  /** An in-progress collision/zone/shape rect drag. Mirrors `rectDrag`. */
  private targetRectDrag: {
    target: PaintTarget;
    on: boolean;
    startCol: number;
    startRow: number;
  } | null = null;

  // ---- Object tool state (step 7) ----
  /** An in-progress Portal-tool drag: the pressed tile corner. Mirrors `rectDrag`, but commits to
   *  `pendingPortalRect` (opens the name/facing dialog) instead of painting on pointer-up. */
  private portalDrag: { startCol: number; startRow: number } | null = null;
  /** An in-progress select-tool object drag: the ids being moved, the world point the drag started
   *  at (for the raw px delta), and each dragged object's ORIGINAL display position (so pointermove
   *  can translate the live sprites smoothly without touching the store — see module doc on why paint
   *  strokes don't mutate per-move; the same reasoning applies here: mutating per-move would rebake/
   *  reselect every frame). Committed as one `translateObjects` call on pointer-up. */
  private objectDrag: {
    ids: string[];
    startWorld: { x: number; y: number };
    displayOrigins: Map<string, { x: number; y: number }>;
  } | null = null;

  constructor() {
    super('Editor');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)'); // transparent — the dark pane shows through
    this.voidGfx = this.add.graphics().setDepth(DEPTH_VOID);
    this.walkabilityGfx = this.add.graphics().setDepth(DEPTH_WALKABILITY);
    this.zonesGfx = this.add.graphics().setDepth(DEPTH_ZONES);
    this.gridGfx = this.add.graphics().setDepth(DEPTH_GRID);
    this.shapeBoundaryGfx = this.add.graphics().setDepth(DEPTH_SHAPE_BOUNDARY);
    this.hoverGfx = this.add.graphics().setDepth(DEPTH_HOVER);
    this.selectionGfx = this.add.graphics().setDepth(DEPTH_SELECTION);
    this.rectPreviewGfx = this.add.graphics().setDepth(DEPTH_RECT_PREVIEW);

    // Input wiring: wheel = zoom, middle/space/pan-tool drag = pan, and the pointer-tool modifiers
    // (Alt = free-pixel, Shift-click = multi-select). NOTE: any shortcut/gesture added or changed
    // below must be reflected in `shortcuts.ts` (the Shortcuts panel).
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.handleWheel, this);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.handlePointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.handlePointerUp, this);
    this.input.mouse?.disableContextMenu(); // right-click reserved for future tools; no browser menu
    // A texture that 404s (an authored map may reference an asset that doesn't exist yet) is logged
    // and skipped — the bake checks `textures.exists` before drawing, so a missing tile just no-ops.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      const url = typeof file.url === 'string' ? file.url : '?'; // Phaser types url as string|object
      console.warn(`[editor] texture failed to load, skipping: ${file.key} (${url})`);
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

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
        () => this.redrawOverlays(),
      ),
      // The shape-tool boundary outline only draws while that tool is active (step 8) — re-render on
      // every tool switch so entering/leaving `shape` shows/hides it.
      useEditorStore.subscribe(
        (s) => s.activeTool,
        () => this.redrawOverlays(),
      ),
      useEditorStore.subscribe(
        (s) => s.hiddenLayerIds,
        () => this.applyLayerVisibility(),
      ),
      useEditorStore.subscribe(
        (s) => s.selectedObjectIds,
        () => this.redrawSelection(),
      ),
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());

    this.syncDocument();
  }

  private teardown(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  // ---- Document lifecycle ----

  /** Full (re)load: tear down the current render, then queue textures and bake once loaded. */
  private syncDocument(): void {
    const { map, mapEpoch } = useEditorStore.getState();
    this.currentEpoch = mapEpoch;
    this.clearRender();
    if (!map) {
      this.redrawOverlays();
      return;
    }
    this.loadTexturesThenBuild(map, mapEpoch);
  }

  private clearRender(): void {
    for (const layer of this.chunkRTs) for (const rt of layer) rt.destroy();
    this.chunkRTs = [];
    for (const obj of this.objectSprites) obj.destroy();
    this.objectSprites = [];
    this.objectDisplayById.clear();
    this.voidGfx?.clear();
    this.walkabilityGfx?.clear();
    this.zonesGfx?.clear();
    for (const t of this.zoneLabelTexts) t.destroy();
    this.zoneLabelTexts = [];
    this.gridGfx?.clear();
    this.shapeBoundaryGfx?.clear();
    this.hoverGfx?.clear();
    this.selectionGfx?.clear();
    this.rectPreviewGfx?.clear();
    // A full document reload invalidates any in-flight paint/object interaction (the layer/cells/
    // objects it was targeting may no longer exist).
    this.activeStroke = null;
    this.rectDrag = null;
    this.portalDrag = null;
    this.objectDrag = null;
    this.activeTargetStroke = null;
    this.targetRectDrag = null;
  }

  private loadTexturesThenBuild(map: MapFile, epoch: number): void {
    const queued = this.queueTextures(map);
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

  /** Queue every palette + decor texture the map needs (deduped by key). Returns whether anything
   *  was queued (nothing → bake synchronously). */
  private queueTextures(map: MapFile): boolean {
    const seen = new Set<string>();
    const addImage = (key: string, url: string): void => {
      if (this.textures.exists(key) || seen.has(key)) return;
      seen.add(key);
      this.load.image(key, url);
    };
    const addSheet = (key: string, url: string): void => {
      if (this.textures.exists(key) || seen.has(key)) return;
      seen.add(key);
      this.load.spritesheet(key, url, { frameWidth: TILE_SIZE, frameHeight: TILE_SIZE });
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
          queueDecorTexture(this, obj, path, tilesetAssetUrl(pack, path), seen);
        } catch (e) {
          console.warn(`[editor] skipping decor "${obj.id}": ${(e as Error).message}`);
        }
      } else if (obj.kind === 'node') {
        // Nodes render as their real tile-role sprite (matches ResourceNodeManager.addNode) —
        // queue that role's texture too. An unknown ref falls back to a marker (see placeNodeSprite),
        // needing no texture.
        const def = NODES[obj.ref];
        if (!def) continue;
        const source = ACTIVE_TILESET.tiles[def.tile];
        if (source.kind === 'image') {
          addImage(tileImageKey(source.path), tilesetAssetUrl(ACTIVE_TILESET.id, source.path));
        } else {
          addSheet(sheetKey(source.sheet), tilesetAssetUrl(ACTIVE_TILESET.id, source.sheet));
        }
      }
    }

    return seen.size > 0;
  }

  private buildScene(map: MapFile): void {
    this.bakeAllLayers(map);
    this.placeObjects(map);
    this.redrawOverlays();
    this.applyLayerVisibility();
    this.fitCamera(map);
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
    if (this.chunkRTs.length !== map.layers.length) {
      this.syncDocument(); // layer set changed — safest to rebuild wholesale
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
          if (rt) this.bakeChunk(map, dirty.layerIndex, chunk, rt);
        }
      } else {
        for (let layerIndex = 0; layerIndex < map.layers.length; layerIndex++) {
          const rts = this.chunkRTs[layerIndex];
          for (let chunk = 0; chunk < rts.length; chunk++) {
            this.bakeChunk(map, layerIndex, chunk, rts[chunk]);
          }
        }
      }
      this.placeObjects(map);
      this.redrawOverlays();
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
    if (this.queueTextures(map)) {
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

  // ---- Tile baking (chunked batch API, mirroring drawGround) ----

  private bakeAllLayers(map: MapFile): void {
    const cols = map.meta.width;
    const chunkCount = Math.ceil(map.meta.height / GROUND_CHUNK_ROWS);
    this.chunkRTs = map.layers.map((_layer, layerIndex) => {
      const rts: Phaser.GameObjects.RenderTexture[] = [];
      for (let chunk = 0; chunk < chunkCount; chunk++) {
        const startRow = chunk * GROUND_CHUNK_ROWS;
        const chunkRows = Math.min(GROUND_CHUNK_ROWS, map.meta.height - startRow);
        const rt = this.add
          .renderTexture(0, startRow * TILE_SIZE, cols * TILE_SIZE, chunkRows * TILE_SIZE)
          .setOrigin(0, 0)
          .setDepth(layerIndex);
        rts.push(rt);
        this.bakeChunk(map, layerIndex, chunk, rt);
      }
      return rts;
    });
  }

  /** Bake one layer chunk (up to GROUND_CHUNK_ROWS rows) with a single batched draw pass. */
  private bakeChunk(
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
        if (!this.textures.exists(key)) continue; // texture failed to load — skip, don't crash
        // frame is undefined for standalone images → batchDrawFrame falls back to the base frame.
        rt.batchDrawFrame(key, frame, col * TILE_SIZE, r * TILE_SIZE);
      }
    }
    rt.endDraw();
    rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST); // crisp when the camera scales it
  }

  // ---- Objects (place/transform/stack/portals — step 7) ----

  /** Rebuilds every object's display GameObject(s) + the `objectDisplayById` hit-test/highlight index,
   *  then redraws the selection outline (bounds can change after a move/transform). */
  private placeObjects(map: MapFile): void {
    for (const obj of this.objectSprites) obj.destroy();
    this.objectSprites = [];
    this.objectDisplayById.clear();

    for (const obj of map.objects) {
      let display: Phaser.GameObjects.GameObject | undefined;
      if (obj.kind === 'decor') {
        display = this.placeDecor(obj);
      } else if (obj.kind === 'node') {
        display = this.placeNodeSprite(obj);
      } else {
        const { col, row, w, h } = obj.rect;
        const x = (col + w / 2) * TILE_SIZE;
        const y = (row + h / 2) * TILE_SIZE;
        display = this.addMarker(x, y, w * TILE_SIZE, h * TILE_SIZE, PORTAL_MARKER, obj.name);
      }
      if (display) this.objectDisplayById.set(obj.id, display);
    }
    this.redrawSelection();
  }

  /** Renders a decor object through the shared `decorSprites` helper (region-crop / animated
   *  playback in-editor) — the same resolution the step-11 game loader will use, so there's exactly
   *  one place that knows how to turn a `DecorObject` into pixels. A plain image (no `region`/`anim`)
   *  and a `region` crop both draw as a static `Image`; an `anim` decor draws as a `Sprite` and starts
   *  playing immediately. */
  private placeDecor(
    obj: Extract<MapFile['objects'][number], { kind: 'decor' }>,
  ): Phaser.GameObjects.Image | Phaser.GameObjects.Sprite | undefined {
    let path: string;
    try {
      ({ path } = parseAssetId(obj.asset));
    } catch {
      return undefined; // already warned in queueTextures
    }
    const draw = resolveDecorDraw(this, obj, path);
    if (!draw) return undefined; // texture missing — skip cleanly

    let display: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
    if (draw.kind === 'anim') {
      const sprite = this.add.sprite(obj.x, obj.y, draw.key);
      sprite.play(draw.animKey);
      display = sprite;
    } else if (draw.kind === 'region') {
      display = this.add.image(obj.x, obj.y, draw.key, draw.frame);
    } else {
      display = this.add.image(obj.x, obj.y, draw.key);
    }
    display.setScale(obj.scaleX, obj.scaleY);
    display.setAngle(obj.rotation); // stored in degrees (see mapFormat DecorObject)
    display.setFlip(obj.flipX, obj.flipY);
    display.setDepth(DEPTH_OBJECTS + obj.depth);
    this.objectSprites.push(display);
    return display;
  }

  /** Nodes render as their REAL tile-role sprite, matching `ResourceNodeManager.addNode` exactly:
   *  position = tile centre (both axes), scale = `(TILE_SIZE * tilesTall) / frameHeight`, origin =
   *  `(originX, originY)`. Falls back to a labelled marker (unknown ref, or its texture isn't
   *  resident) so authoring always shows *something* pickable. */
  private placeNodeSprite(
    obj: Extract<MapFile['objects'][number], { kind: 'node' }>,
  ): Phaser.GameObjects.GameObject | undefined {
    const x = obj.col * TILE_SIZE + TILE_SIZE / 2;
    const y = obj.row * TILE_SIZE + TILE_SIZE / 2;
    const def = NODES[obj.ref];
    if (!def) return this.addMarker(x, y, TILE_SIZE, TILE_SIZE, NODE_MARKER, obj.ref);

    const { key, frame } = resolveTile(ACTIVE_TILESET.tiles[def.tile]);
    if (!this.textures.exists(key))
      return this.addMarker(x, y, TILE_SIZE, TILE_SIZE, NODE_MARKER, obj.ref);

    const img = frame === undefined ? this.add.image(x, y, key) : this.add.image(x, y, key, frame);
    img.setScale((TILE_SIZE * def.tilesTall) / img.frame.height);
    img.setOrigin(def.originX, def.originY);
    img.setDepth(DEPTH_OBJECTS);
    this.objectSprites.push(img);
    return img;
  }

  private addMarker(
    x: number,
    y: number,
    w: number,
    h: number,
    colour: number,
    label: string,
  ): Phaser.GameObjects.GameObject {
    const rect = this.add
      .rectangle(x, y, w, h, colour, 0.28)
      .setStrokeStyle(1, colour, 0.9)
      .setDepth(DEPTH_OBJECTS);
    this.objectSprites.push(rect);
    const text = this.add
      .text(x, y, label, { fontFamily: 'monospace', fontSize: '8px', color: '#f4ecd8' })
      .setOrigin(0.5)
      .setDepth(DEPTH_OBJECTS + 1);
    this.objectSprites.push(text);
    return rect; // the outline rect is the hit-test/highlight bounds; the label just rides along
  }

  /** Topmost object under `(worldX,worldY)`: iterate every object's display bounds, preferring higher
   *  `depth` then later array position (insertion order) on a tie — "simple bounds check is fine
   *  in-editor" per the plan, mirroring the game's `pickSpriteAt` intent without its full complexity. */
  private pickObjectAt(map: MapFile, worldX: number, worldY: number): string | null {
    let best: { id: string; depth: number; index: number } | null = null;
    map.objects.forEach((obj, index) => {
      const display = this.objectDisplayById.get(obj.id);
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

  /** Strokes an outline around each selected object's current display bounds. Redrawn on selection
   *  change AND after every `placeObjects` (a move/transform changes bounds). */
  private redrawSelection(): void {
    const g = this.selectionGfx;
    if (!g) return;
    g.clear();
    const { map, selectedObjectIds } = useEditorStore.getState();
    if (!map || selectedObjectIds.length === 0) return;
    g.lineStyle(2, SELECTION_COLOUR, 1);
    for (const id of selectedObjectIds) {
      const display = this.objectDisplayById.get(id);
      if (!display) continue;
      const withBounds = display as unknown as { getBounds?: () => Phaser.Geom.Rectangle };
      if (typeof withBounds.getBounds !== 'function') continue;
      const bounds = withBounds.getBounds();
      g.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
  }

  // ---- Overlays ----

  private redrawOverlays(): void {
    const { map, overlays, activeTool } = useEditorStore.getState();
    this.drawVoid(map);
    this.drawGrid(map, overlays.grid);
    this.drawWalkabilityOverlay(map, overlays.walkability);
    this.drawZonesOverlay(map, overlays.zones);
    this.drawShapeBoundary(map, activeTool === 'shape');
    if (!map) this.hoverGfx?.clear();
  }

  /** Red ~40% tint on blocked base-terrain cells (`walkability.cells[i] === 1`), toggled by
   *  `overlays.walkability`. Also hatches the footprint of every RUNTIME obstacle that composites on
   *  top of base terrain at runtime — decor WITH a `collision` footprint, and every node — read-only,
   *  for authoring clarity (walkability painting never touches these; see the store's module doc).
   *  Cosmetic decor (no `collision`) and portals don't block, so they're excluded. */
  private drawWalkabilityOverlay(map: MapFile | null, show: boolean): void {
    const g = this.walkabilityGfx;
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
  private drawZonesOverlay(map: MapFile | null, show: boolean): void {
    const g = this.zonesGfx;
    for (const t of this.zoneLabelTexts) t.destroy();
    this.zoneLabelTexts = [];
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
      const text = this.add
        .text((sumCol / count) * TILE_SIZE, (sumRow / count) * TILE_SIZE, def.name, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#f4ecd8',
          backgroundColor: 'rgba(0,0,0,0.45)',
          padding: { x: 3, y: 1 },
        })
        .setOrigin(0.5)
        .setDepth(DEPTH_ZONE_LABELS);
      this.zoneLabelTexts.push(text);
    }
  }

  /** While the shape tool is active, trace a bright outline along the inside/void boundary (and the
   *  map edge) so the author can see the authored mask clearly while carving it. */
  private drawShapeBoundary(map: MapFile | null, show: boolean): void {
    const g = this.shapeBoundaryGfx;
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

  private drawVoid(map: MapFile | null): void {
    const g = this.voidGfx;
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

  private drawGrid(map: MapFile | null, show: boolean): void {
    const g = this.gridGfx;
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

  private updateHover(pointer: Phaser.Input.Pointer): void {
    const g = this.hoverGfx;
    if (!g) return;
    g.clear();
    const { map } = useEditorStore.getState();
    if (!map) return;
    const { col, row } = this.pointerTile(pointer);
    if (!isInside(map, col, row)) return; // reject the cursor on void / out-of-bounds cells
    g.lineStyle(1.5, HOVER_COLOUR, 0.9);
    g.strokeRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  }

  /** The tile `(col,row)` the pointer is currently over, in world/map space. */
  private pointerTile(pointer: Phaser.Input.Pointer): { col: number; row: number } {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { col: worldToTile(world.x), row: worldToTile(world.y) };
  }

  /** Live outline shown while dragging the rect/portal tool, from the pressed corner to the current
   *  cell. `colour` defaults to the paint-rect preview's hue; the Portal tool passes its own so the
   *  two read as visually distinct while dragging. */
  private drawRectPreview(
    c0: number,
    r0: number,
    c1: number,
    r1: number,
    colour: number = HOVER_COLOUR,
  ): void {
    const g = this.rectPreviewGfx;
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

  /** Every cell of the (order-independent) rect spanning two tile corners, inclusive. */
  private static rectFromCorners(c0: number, r0: number, c1: number, r1: number): PortalRect {
    const minCol = Math.min(c0, c1);
    const maxCol = Math.max(c0, c1);
    const minRow = Math.min(r0, r1);
    const maxRow = Math.max(r0, r1);
    return { col: minCol, row: minRow, w: maxCol - minCol + 1, h: maxRow - minRow + 1 };
  }

  /** True if every cell of `rect` is inside the map (matches `parseMap`'s void-consistency
   *  invariant) — gates opening the Portal dialog. */
  private static portalRectValid(map: MapFile, rect: PortalRect): boolean {
    for (let dr = 0; dr < rect.h; dr++) {
      for (let dc = 0; dc < rect.w; dc++) {
        if (!isInside(map, rect.col + dc, rect.row + dr)) return false;
      }
    }
    return true;
  }

  private mintStrokeId(): string {
    this.strokeCounter += 1;
    return `stroke-${Date.now()}-${this.strokeCounter}`;
  }

  // ---- Camera ----

  private fitCamera(map: MapFile): void {
    const cam = this.cameras.main;
    const widthPx = map.meta.width * TILE_SIZE;
    const heightPx = map.meta.height * TILE_SIZE;
    const margin = PAN_MARGIN_TILES * TILE_SIZE;
    cam.setBounds(-margin, -margin, widthPx + margin * 2, heightPx + margin * 2);
    const fit = Math.min(this.scale.width / widthPx, this.scale.height / heightPx);
    cam.setZoom(Phaser.Math.Clamp(Math.floor(fit) || MIN_ZOOM, MIN_ZOOM, MAX_ZOOM));
    cam.centerOn(widthPx / 2, heightPx / 2);
  }

  private handleWheel(
    pointer: Phaser.Input.Pointer,
    _over: Phaser.GameObjects.GameObject[],
    _dx: number,
    dy: number,
  ): void {
    const cam = this.cameras.main;
    const zoomBefore = cam.zoom;
    const next = Phaser.Math.Clamp(Math.round(zoomBefore) + (dy > 0 ? -1 : 1), MIN_ZOOM, MAX_ZOOM);
    if (next === zoomBefore) return;
    // getWorldPoint() inverts a matrix that's only rebuilt once per frame in preRender(), so it
    // can't be trusted immediately after setZoom() in the same tick. Re-derive the same transform
    // preRender() builds (Camera#preRender in phaser.esm.js): zoom pivots around the viewport's
    // origin (default centre), so world = scroll + origin + (screen - camXY - origin) / zoom.
    const originX = cam.width * cam.originX;
    const originY = cam.height * cam.originY;
    const relX = pointer.x - cam.x - originX;
    const relY = pointer.y - cam.y - originY;
    const worldX = cam.scrollX + originX + relX / zoomBefore;
    const worldY = cam.scrollY + originY + relY / zoomBefore;
    cam.setZoom(next);
    cam.scrollX = worldX - originX - relX / next;
    cam.scrollY = worldY - originY - relY / next;
    this.updateHover(pointer);
  }

  /**
   * Pan (middle-drag, space+left-drag, or plain left-drag while the `pan` tool is active) takes
   * priority; otherwise a left-press with a paint tool active begins that tool's interaction —
   * brush/eraser start a coalesced stroke (painting the pressed cell immediately), fill paints once
   * on click, and rect begins a live-preview drag committed on release. Void cells refuse every paint
   * tool (mirrors `updateHover`'s cursor rejection).
   */
  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const state = useEditorStore.getState();
    if (
      pointer.middleButtonDown() ||
      (this.spaceDown && pointer.leftButtonDown()) ||
      (state.activeTool === 'pan' && pointer.leftButtonDown())
    ) {
      this.panning = true;
      this.panLast = { x: pointer.x, y: pointer.y };
      this.setCursor('grabbing');
      return;
    }

    if (!pointer.leftButtonDown() || !state.map) return;

    // The select tool operates over the WHOLE viewport (including void — e.g. clicking empty void
    // space still clears the selection), so it's handled before the paint tools' shared isInside
    // gate below.
    if (state.activeTool === 'select') {
      this.handleSelectPointerDown(pointer, state.map);
      return;
    }

    // The shape tool ALSO bypasses the isInside gate below — painting a cell back to "inside" would
    // be impossible if void cells (which is exactly what isInside rejects) refused the tool. It uses
    // its own in-bounds-only check (see `handleShapePointerDown`).
    if (state.activeTool === 'shape') {
      this.handleShapePointerDown(pointer, state.map, state.paintMode);
      return;
    }

    const { col, row } = this.pointerTile(pointer);
    if (!isInside(state.map, col, row)) return;

    switch (state.activeTool) {
      case 'brush': {
        if (!state.brushAsset) return; // brush needs an asset selected in the Library
        const strokeId = this.mintStrokeId();
        this.activeStroke = { tool: 'brush', strokeId, lastCol: col, lastRow: row };
        state.paintLine(col, row, col, row, strokeId);
        break;
      }
      case 'eraser': {
        const strokeId = this.mintStrokeId();
        this.activeStroke = { tool: 'eraser', strokeId, lastCol: col, lastRow: row };
        state.eraseLine(col, row, col, row, strokeId);
        break;
      }
      case 'fill':
        state.fillFrom(col, row); // single click — no drag/stroke
        break;
      case 'rect':
        if (!state.brushAsset) return; // rect needs an asset selected, same as brush
        this.rectDrag = { startCol: col, startRow: row };
        this.drawRectPreview(col, row, col, row);
        break;
      case 'place': {
        if (state.armedObjectAsset) {
          const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const alt = pointer.event instanceof MouseEvent && pointer.event.altKey;
          const snap = state.snapToTileCenter && !alt;
          const x = snap ? snapToTileCenter(world.x) : world.x;
          const y = snap ? snapToTileCenter(world.y) : world.y;
          const { assetId, region, anim } = state.armedObjectAsset;
          if (!state.placeDecor(assetId, x, y, region, anim)) {
            console.warn('[editor] decor placement refused — void/out-of-bounds cell');
          }
        } else if (state.armedNodeRef) {
          if (!state.placeNode(state.armedNodeRef, col, row)) {
            console.warn('[editor] node placement refused — void/out-of-bounds cell');
          }
        } // nothing armed — no-op, matches the plan's "if nothing armed, no-op"
        break;
      }
      case 'portal':
        this.portalDrag = { startCol: col, startRow: row };
        this.drawRectPreview(col, row, col, row, PORTAL_PREVIEW_COLOUR);
        break;
      case 'collision': {
        // Default (no modifier) marks the cell blocked — the primary "add an obstacle" action;
        // Alt clears it, mirroring the free-pixel-placement modifier convention (step 7). Locked for
        // the whole gesture at press time (see `activeTargetStroke`'s doc).
        const alt = pointer.event instanceof MouseEvent && pointer.event.altKey;
        this.dispatchTargetPaint('collision', col, row, !alt, state.paintMode);
        break;
      }
      case 'zone': {
        // Default paints the active zone id; Alt clears the cell's zone assignment regardless of
        // which zone owned it.
        const alt = pointer.event instanceof MouseEvent && pointer.event.altKey;
        this.dispatchTargetPaint('zone', col, row, !alt, state.paintMode);
        break;
      }
      default:
        break; // 'shape' is handled above, before the isInside gate
    }
  }

  /** Shape tool press (step 8) — bypasses the shared isInside gate (see caller's comment). Default
   *  (no modifier) carves VOID, the primary authoring action when starting from a full rectangular
   *  map; Alt restores a cell to inside. Locked for the whole gesture at press time, same as every
   *  other modifier-gated tool. */
  private handleShapePointerDown(
    pointer: Phaser.Input.Pointer,
    map: MapFile,
    paintMode: PaintMode,
  ): void {
    const { col, row } = this.pointerTile(pointer);
    if (col < 0 || row < 0 || col >= map.meta.width || row >= map.meta.height) return;
    const alt = pointer.event instanceof MouseEvent && pointer.event.altKey;
    this.dispatchTargetPaint('shape', col, row, alt, paintMode);
  }

  /** Dispatches a collision/zone/shape tool press to the right gesture (step 8) — generalises the
   *  brush/rect/fill mechanics the tile-paint tools each get their own `EditorTool` for, since these
   *  three tools each write a DIFFERENT target grid rather than a tile layer (see `PaintMode`'s doc in
   *  the store). `on` is the value locked in for this whole gesture (collision: blocked; zone: paint
   *  vs. clear; shape: inside vs. void). */
  private dispatchTargetPaint(
    target: PaintTarget,
    col: number,
    row: number,
    on: boolean,
    paintMode: PaintMode,
  ): void {
    switch (paintMode) {
      case 'brush': {
        const strokeId = this.mintStrokeId();
        this.activeTargetStroke = { target, on, strokeId, lastCol: col, lastRow: row };
        this.applyTargetSegment(col, row, col, row);
        break;
      }
      case 'fill':
        this.applyTargetFill(target, col, row, on);
        break;
      case 'rect':
        this.targetRectDrag = { target, on, startCol: col, startRow: row };
        this.drawRectPreview(col, row, col, row, this.targetPreviewColour(target));
        break;
    }
  }

  private applyTargetSegment(fromCol: number, fromRow: number, toCol: number, toRow: number): void {
    const s = this.activeTargetStroke;
    if (!s) return;
    const store = useEditorStore.getState();
    if (s.target === 'collision') {
      store.paintWalkabilityLine(fromCol, fromRow, toCol, toRow, s.strokeId, s.on);
    } else if (s.target === 'zone') {
      store.paintZoneLine(fromCol, fromRow, toCol, toRow, s.strokeId, s.on);
    } else {
      store.paintShapeLine(fromCol, fromRow, toCol, toRow, s.strokeId, s.on);
    }
  }

  private applyTargetFill(target: PaintTarget, col: number, row: number, on: boolean): void {
    const store = useEditorStore.getState();
    if (target === 'collision') store.fillWalkabilityFrom(col, row, on);
    else if (target === 'zone') store.fillZoneFrom(col, row, on);
    else store.fillShapeFrom(col, row, on);
  }

  private applyTargetRect(
    target: PaintTarget,
    startCol: number,
    startRow: number,
    col: number,
    row: number,
    on: boolean,
  ): void {
    const store = useEditorStore.getState();
    if (target === 'collision') store.paintWalkabilityRect(startCol, startRow, col, row, on);
    else if (target === 'zone') store.paintZoneRect(startCol, startRow, col, row, on);
    else store.paintShapeRect(startCol, startRow, col, row, on);
  }

  private targetPreviewColour(target: PaintTarget): number {
    if (target === 'collision') return COLLISION_PREVIEW_COLOUR;
    if (target === 'zone') return ZONE_PREVIEW_COLOUR;
    return SHAPE_PREVIEW_COLOUR;
  }

  /** Select-tool press: pick the topmost object under the pointer (plain click = single-select,
   *  shift-click = toggle into the multi-select set, empty space = clear), then begin a drag of the
   *  resulting selection if a pick landed. */
  private handleSelectPointerDown(pointer: Phaser.Input.Pointer, map: MapFile): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const pickedId = this.pickObjectAt(map, world.x, world.y);
    const shift = pointer.event instanceof MouseEvent && pointer.event.shiftKey;
    const store = useEditorStore.getState();

    if (!pickedId) {
      if (!shift) store.setSelectedObjectIds([]);
      return; // empty space — no drag begins
    }

    let selection = store.selectedObjectIds;
    if (shift) {
      selection = selection.includes(pickedId)
        ? selection.filter((id) => id !== pickedId)
        : [...selection, pickedId];
      store.setSelectedObjectIds(selection);
      if (!selection.includes(pickedId)) return; // shift-click just DESELECTED it — nothing to drag
    } else if (!selection.includes(pickedId)) {
      selection = [pickedId];
      store.setSelectedObjectIds(selection);
    } // else: pickedId is already part of a multi-selection — keep the set, begin a group drag

    this.beginObjectDrag(pointer, selection);
  }

  private beginObjectDrag(pointer: Phaser.Input.Pointer, ids: string[]): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const displayOrigins = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const display = this.objectDisplayById.get(id);
      const withXY = display as unknown as { x?: number; y?: number } | undefined;
      if (withXY && typeof withXY.x === 'number' && typeof withXY.y === 'number') {
        displayOrigins.set(id, { x: withXY.x, y: withXY.y });
      }
    }
    this.objectDrag = { ids, startWorld: { x: world.x, y: world.y }, displayOrigins };
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.panning) {
      const cam = this.cameras.main;
      cam.scrollX -= (pointer.x - this.panLast.x) / cam.zoom;
      cam.scrollY -= (pointer.y - this.panLast.y) / cam.zoom;
      this.panLast = { x: pointer.x, y: pointer.y };
      return;
    }

    if (this.activeStroke) {
      const { col, row } = this.pointerTile(pointer);
      if (col !== this.activeStroke.lastCol || row !== this.activeStroke.lastRow) {
        const state = useEditorStore.getState();
        const { strokeId, lastCol, lastRow } = this.activeStroke;
        if (this.activeStroke.tool === 'brush')
          state.paintLine(lastCol, lastRow, col, row, strokeId);
        else state.eraseLine(lastCol, lastRow, col, row, strokeId);
        this.activeStroke.lastCol = col;
        this.activeStroke.lastRow = row;
      }
      this.updateHover(pointer);
      return;
    }

    if (this.rectDrag) {
      const { col, row } = this.pointerTile(pointer);
      this.drawRectPreview(this.rectDrag.startCol, this.rectDrag.startRow, col, row);
      this.updateHover(pointer);
      return;
    }

    if (this.activeTargetStroke) {
      const { col, row } = this.pointerTile(pointer);
      const s = this.activeTargetStroke;
      if (col !== s.lastCol || row !== s.lastRow) {
        this.applyTargetSegment(s.lastCol, s.lastRow, col, row);
        s.lastCol = col;
        s.lastRow = row;
      }
      this.updateHover(pointer);
      return;
    }

    if (this.targetRectDrag) {
      const { col, row } = this.pointerTile(pointer);
      this.drawRectPreview(
        this.targetRectDrag.startCol,
        this.targetRectDrag.startRow,
        col,
        row,
        this.targetPreviewColour(this.targetRectDrag.target),
      );
      this.updateHover(pointer);
      return;
    }

    if (this.portalDrag) {
      const { col, row } = this.pointerTile(pointer);
      this.drawRectPreview(
        this.portalDrag.startCol,
        this.portalDrag.startRow,
        col,
        row,
        PORTAL_PREVIEW_COLOUR,
      );
      this.updateHover(pointer);
      return;
    }

    if (this.objectDrag) {
      // Live-preview only — translate the tracked display GameObjects visually; the store is NOT
      // touched until pointer-up (mutating per-move would rebake/reselect every frame, and — unlike
      // paint strokes — an object move isn't naturally coalesced cell-by-cell). Follows the pointer
      // continuously (unsnapped) for a smooth feel; the COMMIT step (below) computes the actual
      // snapped/tile-stepped delta that gets stored.
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const dx = world.x - this.objectDrag.startWorld.x;
      const dy = world.y - this.objectDrag.startWorld.y;
      for (const [id, origin] of this.objectDrag.displayOrigins) {
        const display = this.objectDisplayById.get(id) as unknown as
          { setPosition?: (x: number, y: number) => void } | undefined;
        display?.setPosition?.(origin.x + dx, origin.y + dy);
      }
      this.redrawSelection();
      return;
    }

    this.updateHover(pointer);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.panning) {
      this.panning = false;
      this.setCursor(this.spaceDown ? 'grab' : 'default');
      return;
    }
    if (this.activeStroke) {
      this.activeStroke = null;
      return;
    }
    if (this.rectDrag) {
      const { col, row } = this.pointerTile(pointer);
      useEditorStore
        .getState()
        .paintRectArea(this.rectDrag.startCol, this.rectDrag.startRow, col, row);
      this.rectDrag = null;
      this.rectPreviewGfx?.clear();
      return;
    }
    if (this.activeTargetStroke) {
      this.activeTargetStroke = null;
      return;
    }
    if (this.targetRectDrag) {
      const { col, row } = this.pointerTile(pointer);
      const drag = this.targetRectDrag;
      this.targetRectDrag = null;
      this.rectPreviewGfx?.clear();
      this.applyTargetRect(drag.target, drag.startCol, drag.startRow, col, row, drag.on);
      return;
    }
    if (this.portalDrag) {
      const { col, row } = this.pointerTile(pointer);
      const rect = EditorScene.rectFromCorners(
        this.portalDrag.startCol,
        this.portalDrag.startRow,
        col,
        row,
      );
      this.portalDrag = null;
      this.rectPreviewGfx?.clear();
      const map = useEditorStore.getState().map;
      if (map && EditorScene.portalRectValid(map, rect)) {
        useEditorStore.getState().setPendingPortalRect(rect);
      } else {
        console.warn('[editor] portal rect refused — overlaps void/out-of-bounds');
      }
      return;
    }
    if (this.objectDrag) {
      this.commitObjectDrag(pointer);
    }
  }

  /** Computes the final commit delta (snapped per the rules in the module doc) and applies it via
   *  `translateObjects`. On refusal (would land on void/out-of-bounds), redraws from the unchanged
   *  map data so the live-preview sprites snap back to their real positions. */
  private commitObjectDrag(pointer: Phaser.Input.Pointer): void {
    const drag = this.objectDrag;
    this.objectDrag = null;
    if (!drag) return;

    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const rawDx = world.x - drag.startWorld.x;
    const rawDy = world.y - drag.startWorld.y;
    const alt = pointer.event instanceof MouseEvent && pointer.event.altKey;
    const state = useEditorStore.getState();
    const snap = state.snapToTileCenter && !alt;
    const dxPx = snap ? Math.round(rawDx / TILE_SIZE) * TILE_SIZE : rawDx;
    const dyPx = snap ? Math.round(rawDy / TILE_SIZE) * TILE_SIZE : rawDy;
    // Nodes/portals are always tile-snapped regardless of the snap toggle (see module doc).
    const dCol = Math.round(rawDx / TILE_SIZE);
    const dRow = Math.round(rawDy / TILE_SIZE);

    const applied = state.translateObjects(drag.ids, { dxPx, dyPx, dCol, dRow });
    if (!applied) {
      // Refused (void/out-of-bounds) — the store made no change, so redraw straight from map data to
      // snap the live-preview sprites back.
      const map = useEditorStore.getState().map;
      if (map) this.placeObjects(map);
      console.warn('[editor] object move refused — would land on void/out-of-bounds');
    }
    // On success, `translateObjects` already bumped `docRevision` → `onDocEdited` rebakes/replaces
    // objects via the store subscription; nothing else to do here.
  }

  private handleSpaceKey(e: KeyboardEvent, down: boolean): void {
    if (e.code !== 'Space') return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      return; // don't hijack the space bar while typing in a dialog field
    }
    if (down) e.preventDefault(); // stop the page from scrolling while space-panning
    this.spaceDown = down;
    if (!this.panning) this.setCursor(down ? 'grab' : 'default');
  }

  private setCursor(cursor: string): void {
    if (this.game.canvas) this.game.canvas.style.cursor = cursor;
  }
}
