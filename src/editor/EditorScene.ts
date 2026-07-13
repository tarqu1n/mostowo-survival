import Phaser from 'phaser';
import { TILE_SIZE, GROUND_CHUNK_ROWS } from '../config';
import { ACTIVE_TILESET, resolveTile, sheetKey, tileImageKey } from '../data/tileset';
import { NODES } from '../data/nodes';
import { cellIndex, isInside, type MapFile, type PortalRect } from '../systems/mapFormat';
import { worldToTile, snapToTileCenter } from '../systems/grid';
import { useEditorStore } from './store/editorStore';
import { parseAssetId, tilesetAssetUrl } from './textureLoading';

/**
 * The editor's single Phaser scene (plan 014 step 5). Renders the open map pixel-identically to the
 * game via the same `resolveTile` seam: tile layers bake into per-layer chunked `RenderTexture`s
 * with the batch API (mirroring `world/groundRenderer.ts` — per-tile `drawFrame` is pathologically
 * slow), objects draw on top with their stored transform, and overlay `Graphics` draw the void
 * checker, grid and hover cell above everything. Void cells reject the hover cursor.
 *
 * It observes the editor store (the sole React↔Phaser bridge): a `mapEpoch` change = full reload
 * (textures → bake → camera fit); a `docRevision` change = rebake in place; an `overlays` change =
 * overlay redraw. Robustness: a texture that fails to load is logged and skipped (authored maps may
 * reference assets that don't exist yet mid-development), never crashing the scene.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const PAN_MARGIN_TILES = 6;

// Render depths. Tile layers occupy 0..layers.length-1; everything else sits above them.
const DEPTH_VOID = 500;
const DEPTH_OBJECTS = 1000;
const DEPTH_GRID = 9000;
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
    this.gridGfx = this.add.graphics().setDepth(DEPTH_GRID);
    this.hoverGfx = this.add.graphics().setDepth(DEPTH_HOVER);
    this.selectionGfx = this.add.graphics().setDepth(DEPTH_SELECTION);
    this.rectPreviewGfx = this.add.graphics().setDepth(DEPTH_RECT_PREVIEW);

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
    this.gridGfx?.clear();
    this.hoverGfx?.clear();
    this.selectionGfx?.clear();
    this.rectPreviewGfx?.clear();
    // A full document reload invalidates any in-flight paint/object interaction (the layer/cells/
    // objects it was targeting may no longer exist).
    this.activeStroke = null;
    this.rectDrag = null;
    this.portalDrag = null;
    this.objectDrag = null;
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
          const { pack, path, frame } = parseAssetId(obj.asset);
          if (frame === undefined) addImage(tileImageKey(path), tilesetAssetUrl(pack, path));
          // Sheet-frame decor: best-effort TILE_SIZE frames here; the catalog (step 6) carries the
          // real frame dimensions and will supersede this.
          else addSheet(sheetKey(path), tilesetAssetUrl(pack, path));
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

  private placeDecor(
    obj: Extract<MapFile['objects'][number], { kind: 'decor' }>,
  ): Phaser.GameObjects.Image | undefined {
    let parsed: { pack: string; path: string; frame?: number };
    try {
      parsed = parseAssetId(obj.asset);
    } catch {
      return undefined; // already warned in queueTextures
    }
    const key = parsed.frame === undefined ? tileImageKey(parsed.path) : sheetKey(parsed.path);
    if (!this.textures.exists(key)) return undefined; // texture missing — skip cleanly
    const img =
      parsed.frame === undefined
        ? this.add.image(obj.x, obj.y, key)
        : this.add.image(obj.x, obj.y, key, parsed.frame);
    img.setScale(obj.scaleX, obj.scaleY);
    img.setAngle(obj.rotation); // stored in degrees (see mapFormat DecorObject)
    img.setFlip(obj.flipX, obj.flipY);
    img.setDepth(DEPTH_OBJECTS + obj.depth);
    this.objectSprites.push(img);
    return img;
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
    const { map, overlays } = useEditorStore.getState();
    this.drawVoid(map);
    this.drawGrid(map, overlays.grid);
    if (!map) this.hoverGfx?.clear();
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
    const before = cam.getWorldPoint(pointer.x, pointer.y);
    const next = Phaser.Math.Clamp(Math.round(cam.zoom) + (dy > 0 ? -1 : 1), MIN_ZOOM, MAX_ZOOM);
    if (next === cam.zoom) return;
    cam.setZoom(next);
    const after = cam.getWorldPoint(pointer.x, pointer.y); // keep the world point under the cursor fixed
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
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
          if (!state.placeDecor(state.armedObjectAsset, x, y)) {
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
      default:
        break; // collision/zone/shape land in a later step
    }
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
