import Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import {
  cellIndex,
  isInside,
  type DecorAnim,
  type MapFile,
  type PortalRect,
  type TilePaletteEntry,
} from '../../systems/mapFormat';
import { snapToTileCenter } from '../../systems/grid';
import { useEditorStore, type PaintMode } from '../store/editorStore';
import { normalizeRegion } from '../regionOps';
import {
  COLLISION_PREVIEW_COLOUR,
  EYEDROPPER_CURSOR,
  MAX_ZOOM,
  MIN_ZOOM,
  PORTAL_PREVIEW_COLOUR,
  REGION_COLOUR,
  SHAPE_PREVIEW_COLOUR,
  TERRAIN_PREVIEW_COLOUR,
  TWO_FINGER_GESTURE_ENABLED,
  ZONE_PREVIEW_COLOUR,
} from './constants';
import {
  clearHover,
  drawRectPreview,
  pointerTile,
  redrawSelection,
  updateHover,
} from './overlaysRenderer';
import { pickObjectAt, placeObjects } from './objectRenderer';
import type { EditorScene } from '../EditorScene';

/** Which target a `collision`/`zone`/`shape`/`terrain` tool gesture writes to (plan 014 step 8,
 *  extended step 10) — see `dispatchTargetPaint`. `terrain` writes an editor-only mask (rebaked into
 *  the active tile layer's real cells) rather than a standalone grid, but shares the exact same
 *  brush/rect/fill + on/off gesture shape as the other three, so it rides the same dispatch. */
type PaintTarget = 'collision' | 'zone' | 'shape' | 'terrain';

/** Reconstruct the Library asset-id string (`<pack>/<path>[#frame]`) for a palette entry — the exact
 *  inverse of the `parseAssetId → TileSource` chain `resolveBrushValue` (editorStore) uses to turn a
 *  `brushAsset` into a palette slot. Used by the eyedropper to re-arm the Brush with a sampled tile. */
function paletteEntryAssetId(entry: TilePaletteEntry): string {
  return entry.source.kind === 'image'
    ? `${entry.pack}/${entry.source.path}`
    : `${entry.pack}/${entry.source.sheet}#${entry.source.frame}`;
}

/**
 * Pointer, gesture, and keyboard input for the editor scene (plan 043 mechanical split out of
 * EditorScene.ts — the biggest chunk). Owns all interaction state: pan, the parked two-finger camera
 * gesture (behind `TWO_FINGER_GESTURE_ENABLED`), the in-progress paint/target/portal/object/marquee
 * drags, and the space-bar pan modifier. Resolves every tool press/drag/release, the eyedropper
 * sample, the Select-tool pick/drag/marquee, and the tool cursor. Drives the camera through
 * `scene.camera` (pinch pivot + gesture-settle persist) and the renderers through the overlay/object
 * free functions.
 *
 * Wires its `input.on(...)` + `window` key listeners in the constructor and tears them down in
 * `destroy()` (called from `EditorScene.teardown`). Behaviour-preserving move only.
 */
export class EditorInputController {
  private panning = false;
  private panLast = { x: 0, y: 0 };
  private spaceDown = false;

  // ---- Multi-touch camera gestures (plan 027 step 3) ----
  /** Ids of touch pointers currently pressed. Two down = a camera gesture (pinch + two-finger pan);
   *  one = a normal single-finger tool interaction (step 4). Tracked by pointer id so a desktop mouse
   *  (a single 'mouse' pointer, never added here) can never reach 2 and desktop input is untouched. */
  private readonly touchIdsDown = new Set<number>();
  /** The live two-finger gesture, or null. `startDist`/`startZoom` anchor the pinch ratio (fractional
   *  zoom accumulated over the gesture, snapped to the integer MIN..MAX clamp); `lastMid` tracks the
   *  two-finger midpoint so pan follows the midpoint delta. Re-seated when the pointer set changes. */
  private gesture: {
    startDist: number;
    startZoom: number;
    lastMid: { x: number; y: number };
  } | null = null;
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
  /** An in-progress Select-tool marquee drag over EMPTY map space: the pressed tile corner. Committed
   *  to `store.regionSelection` (the moveable group box) on pointer-up — a same-tile release (a click,
   *  not a drag) clears the region instead. Mirrors `rectDrag`, but sets a region rather than painting. */
  private regionMarquee: { startCol: number; startRow: number } | null = null;

  constructor(private readonly scene: EditorScene) {
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.handlePointerUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.handlePointerUp, this);
    scene.input.mouse?.disableContextMenu(); // right-click reserved for future tools; no browser menu
    scene.input.addPointer(2); // plan 027 step 3: ≥2 live pointers for pinch-zoom / two-finger pan
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.handlePointerUp, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.handlePointerUp, this);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  /** Null every in-progress interaction (the interaction-teardown half of `EditorScene.clearRender`):
   *  a full document reload invalidates any paint/object drag the targeted cells/objects may no longer
   *  exist for. */
  clearInteractionState(): void {
    this.activeStroke = null;
    this.rectDrag = null;
    this.portalDrag = null;
    this.objectDrag = null;
    this.regionMarquee = null;
    this.activeTargetStroke = null;
    this.targetRectDrag = null;
  }

  /**
   * Eyedropper — sample whatever is under the pointer and arm it, mirroring the Library's "arm the
   * asset AND switch to the tool that paints it" convention. Reached two ways: the `eyedropper`
   * toolbar tool (a plain click/tap — mobile-friendly) or Alt-click while a tile-paint tool is
   * active (a desktop power-user modifier). Picks
   * the visually topmost thing first:
   *  - a `decor` object → re-arm it (with its `region`/`anim`, minus the placement-stamped `fps`) and
   *    switch to the `place` tool;
   *  - a `node` object → re-arm its `ref` and switch to `place`;
   *  - a `portal` (or an unresolved pick) is NOT arm-placeable, so it's skipped and sampling falls
   *    through to the tile beneath it.
   * With no object, the tile at that cell is sampled — the ACTIVE layer first (what a subsequent
   * paint stroke would target), then the topmost VISIBLE painted layer as a fallback — and the Brush
   * is armed with that palette piece and its rotation. A no-op when there's nothing to pick (an empty
   * cell, or a void/out-of-bounds cell).
   */
  private sampleUnderPointer(pointer: Phaser.Input.Pointer, map: MapFile): void {
    const store = useEditorStore.getState();
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);

    // 1) Topmost object under the cursor (same hit-test the Select tool uses).
    const pickedId = pickObjectAt(this.scene, map, world.x, world.y);
    if (pickedId) {
      const obj = map.objects.find((o) => o.id === pickedId);
      if (obj?.kind === 'decor') {
        // Drop the placement-stamped `fps` — `ArmedObjectAsset.anim` is `Omit<DecorAnim, 'fps'>`
        // (re-stamped at placement, see editorStore's DECOR_ANIM_DEFAULT_FPS); keep `omit` only when
        // present so a subsequent placement round-trips identically.
        let anim: Omit<DecorAnim, 'fps'> | undefined;
        if (obj.anim) {
          anim = {
            frameWidth: obj.anim.frameWidth,
            frameHeight: obj.anim.frameHeight,
            frames: obj.anim.frames,
            ...(obj.anim.omit ? { omit: obj.anim.omit } : {}),
          };
        }
        store.setArmedObjectAsset({
          assetId: obj.asset,
          ...(obj.region ? { region: { ...obj.region } } : {}),
          ...(anim ? { anim } : {}),
        });
        store.setActiveTool('place');
        return;
      }
      if (obj?.kind === 'node') {
        store.setArmedNodeRef(obj.ref);
        store.setActiveTool('place');
        return;
      }
      // portal / unresolved — fall through to the tile beneath.
    }

    // 2) Tile under the cursor: active layer first, then topmost visible painted layer.
    const { col, row } = pointerTile(this.scene, pointer);
    if (!isInside(map, col, row)) return;
    const idx = cellIndex(col, row, map.meta.width);
    const cellAt = (layerIndex: number): number => map.layers[layerIndex]?.cells[idx] ?? 0;

    let paletteIndex = 0;
    const activeIndex = map.layers.findIndex((l) => l.id === store.activeLayerId);
    if (activeIndex >= 0) paletteIndex = cellAt(activeIndex);
    if (paletteIndex === 0) {
      for (let i = map.layers.length - 1; i >= 0; i--) {
        if (store.hiddenLayerIds.includes(map.layers[i].id)) continue;
        const v = cellAt(i);
        if (v !== 0) {
          paletteIndex = v;
          break;
        }
      }
    }
    if (paletteIndex === 0) return; // empty here — nothing to sample

    const entry = map.palette[paletteIndex];
    if (!entry) return;
    store.setBrushAsset(paletteEntryAssetId(entry));
    store.setBrushRotation(entry.rotation ?? 0);
    store.setActiveTool('brush');
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

  /** Screen-space spread + midpoint of the two currently-down touch pointers, or null if fewer than
   *  two are down. Guards a zero distance (both fingers on one pixel) so the pinch ratio never divides
   *  by zero. */
  private twoPointerSpread(): { dist: number; mid: { x: number; y: number } } | null {
    const active = this.scene.input.manager.pointers.filter((p) => this.touchIdsDown.has(p.id));
    if (active.length < 2) return null;
    const [a, b] = active;
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  /** Begin (or re-seat) a two-finger camera gesture: cancel any in-progress single-finger tool
   *  interaction first (so a paint stroke can never turn into a zoom), then snapshot the pinch
   *  baseline from the current fingers. Called on the 2nd pointer-down and whenever the pointer set
   *  changes while ≥2 remain down, so the ongoing gesture never jumps. */
  private beginGesture(): void {
    this.cancelActiveInteraction();
    const s = this.twoPointerSpread();
    if (!s) return;
    this.gesture = { startDist: s.dist, startZoom: this.scene.cameras.main.zoom, lastMid: s.mid };
  }

  /** Advance the live gesture: two-finger pan by the midpoint delta, plus pinch-zoom to the integer
   *  step nearest the accumulated distance ratio, anchored on the midpoint so the map stays put under
   *  the fingers. */
  private updateGesture(): void {
    if (!this.gesture) return;
    const s = this.twoPointerSpread();
    if (!s) return;
    const cam = this.scene.cameras.main;
    cam.scrollX -= (s.mid.x - this.gesture.lastMid.x) / cam.zoom;
    cam.scrollY -= (s.mid.y - this.gesture.lastMid.y) / cam.zoom;
    this.gesture.lastMid = s.mid;
    const target = this.gesture.startZoom * (s.dist / this.gesture.startDist);
    this.scene.cameraController.zoomAnchored(
      Phaser.Math.Clamp(Math.round(target), MIN_ZOOM, MAX_ZOOM),
      s.mid.x,
      s.mid.y,
    );
  }

  /** Abort any in-progress single-finger tool interaction WITHOUT committing it — used when a second
   *  finger arrives and the camera gesture takes over. Clears live preview graphics; a brush/eraser
   *  leaves whatever cell the initial tap already coalesced (undoable via history). */
  private cancelActiveInteraction(): void {
    this.activeStroke = null;
    this.activeTargetStroke = null;
    if (this.rectDrag || this.targetRectDrag || this.portalDrag || this.regionMarquee) {
      this.rectDrag = null;
      this.targetRectDrag = null;
      this.portalDrag = null;
      this.regionMarquee = null; // abort an in-progress marquee (no region committed)
      this.scene.rectPreviewGfx?.clear();
    }
    if (this.objectDrag) {
      // The drag never commits — snap the live-preview sprites back to their stored positions.
      this.objectDrag = null;
      const map = useEditorStore.getState().map;
      if (map) placeObjects(this.scene, map);
    }
    if (this.panning) {
      this.panning = false;
      this.setCursor(this.spaceDown ? 'grab' : this.desiredIdleCursor());
    }
  }

  /**
   * Pan (middle-drag, space+left-drag, or plain left-drag while the `pan` tool is active) takes
   * priority; otherwise a left-press with a paint tool active begins that tool's interaction —
   * brush/eraser start a coalesced stroke (painting the pressed cell immediately), fill paints once
   * on click, and rect begins a live-preview drag committed on release. Void cells refuse every paint
   * tool (mirrors `updateHover`'s cursor rejection).
   */
  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    // Multi-touch arbitration (plan 027 step 3): track touch pointers; the moment two are down the
    // camera gesture owns the interaction and no tool fires. A mouse pointer is `wasTouch === false`,
    // never tracked here, so it can never reach two — desktop input is unchanged. Gated off for now
    // (see `TWO_FINGER_GESTURE_ENABLED`): with the gesture disabled every touch falls straight through
    // to the tool, so a phantom finger can never turn a tap into a zoom.
    if (TWO_FINGER_GESTURE_ENABLED) {
      if (pointer.wasTouch) this.touchIdsDown.add(pointer.id);
      if (this.gesture || this.touchIdsDown.size >= 2) {
        this.beginGesture(); // (re)snapshot the pinch baseline; cancels any in-progress tool
        return;
      }
    }

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

    // Touch has no hover-move to position the cursor before contact, so snap the hover outline +
    // brush ghost under the finger the moment it lands — a stationary tap gets the same feedback a
    // desktop hover already gives, and a drag shows it from the first cell rather than the second.
    // Touch-only so desktop input is byte-identical (the mouse already drives updateHover on move).
    // Plan 027 step 4.
    if (pointer.wasTouch) updateHover(this.scene, pointer);

    // Eyedropper: Alt-click while a tile-paint tool (brush/eraser/fill/rect) is active samples the
    // tile or object under the cursor and arms it, INSTEAD of painting (see shortcuts.ts). Alt is
    // otherwise unused by these four tools — the free-pixel/complement Alt modifiers apply only to
    // place/select and collision/zone/shape/terrain — so there's no conflict. We read Alt off the
    // click's OWN native event (authoritative at click time), not just the store's `altHeld`, which
    // a stray `window` blur (Alt focusing browser chrome on some OSes) can silently clear.
    const altDown = EditorInputController.pointerAlt(pointer) || state.altHeld;
    if (
      altDown &&
      (state.activeTool === 'brush' ||
        state.activeTool === 'eraser' ||
        state.activeTool === 'fill' ||
        state.activeTool === 'rect')
    ) {
      this.sampleUnderPointer(pointer, state.map);
      return;
    }

    // Eyedropper TOOL — the touch/toolbar equivalent of the Alt modifier above (there's no Alt key on
    // mobile). A plain tap samples the tile/object under the cursor. Whole-viewport like select;
    // `sampleUnderPointer` does its own inside check on the tile path and auto-switches to the
    // matching paint tool once something is armed.
    if (state.activeTool === 'eyedropper') {
      this.sampleUnderPointer(pointer, state.map);
      return;
    }

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

    const { col, row } = pointerTile(this.scene, pointer);
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
        drawRectPreview(this.scene, col, row, col, row);
        break;
      case 'place': {
        if (state.armedObjectAsset) {
          const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
          // Effective free-pixel intent: sticky context-bar toggle OR a held Alt (plan 027 step 2;
          // `altDown` reads the click's native event so a desynced store `altHeld` can't drop it).
          const freePixel = state.freePixelActive || altDown;
          const snap = state.snapToTileCenter && !freePixel;
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
        drawRectPreview(this.scene, col, row, col, row, PORTAL_PREVIEW_COLOUR);
        break;
      case 'collision': {
        // Default (no modifier) marks the cell blocked — the primary "add an obstacle" action;
        // erase (context-bar toggle OR held Alt, plan 027 step 2) clears it. Locked for the whole
        // gesture at press time (see `activeTargetStroke`'s doc).
        const erase = state.eraseActive || altDown;
        this.dispatchTargetPaint('collision', col, row, !erase, state.paintMode);
        break;
      }
      case 'zone': {
        // Default paints the active zone id; erase (context-bar toggle OR held Alt) clears the
        // cell's zone assignment regardless of which zone owned it.
        const erase = state.eraseActive || altDown;
        this.dispatchTargetPaint('zone', col, row, !erase, state.paintMode);
        break;
      }
      case 'terrain': {
        // Default paints the armed terrain's mask; erase (context-bar toggle OR held Alt) clears it
        // (clears the mask cell + rebakes), mirroring the collision/zone modifier convention. Both
        // directions require an armed terrain (see paintTerrainLine's doc) — the store warns/no-ops.
        const erase = state.eraseActive || altDown;
        this.dispatchTargetPaint('terrain', col, row, !erase, state.paintMode);
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
    const { col, row } = pointerTile(this.scene, pointer);
    if (col < 0 || row < 0 || col >= map.meta.width || row >= map.meta.height) return;
    // Default carves void (on=false); erase (context-bar toggle OR held Alt) restores to inside
    // (on=true) — plan 027 step 2.
    const store = useEditorStore.getState();
    const restore = store.eraseActive || EditorInputController.pointerAlt(pointer) || store.altHeld;
    this.dispatchTargetPaint('shape', col, row, restore, paintMode);
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
        drawRectPreview(this.scene, col, row, col, row, this.targetPreviewColour(target));
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
    } else if (s.target === 'terrain') {
      store.paintTerrainLine(fromCol, fromRow, toCol, toRow, s.strokeId, s.on);
    } else {
      store.paintShapeLine(fromCol, fromRow, toCol, toRow, s.strokeId, s.on);
    }
  }

  private applyTargetFill(target: PaintTarget, col: number, row: number, on: boolean): void {
    const store = useEditorStore.getState();
    if (target === 'collision') store.fillWalkabilityFrom(col, row, on);
    else if (target === 'zone') store.fillZoneFrom(col, row, on);
    else if (target === 'terrain') store.fillTerrainFrom(col, row, on);
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
    else if (target === 'terrain') store.paintTerrainRect(startCol, startRow, col, row, on);
    else store.paintShapeRect(startCol, startRow, col, row, on);
  }

  private targetPreviewColour(target: PaintTarget): number {
    if (target === 'collision') return COLLISION_PREVIEW_COLOUR;
    if (target === 'zone') return ZONE_PREVIEW_COLOUR;
    if (target === 'terrain') return TERRAIN_PREVIEW_COLOUR;
    return SHAPE_PREVIEW_COLOUR;
  }

  /** Select-tool press: pick the topmost object under the pointer (plain click = single-select,
   *  shift-click = toggle into the multi-select set, empty space = clear), then begin a drag of the
   *  resulting selection if a pick landed. */
  private handleSelectPointerDown(pointer: Phaser.Input.Pointer, map: MapFile): void {
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const pickedId = pickObjectAt(this.scene, map, world.x, world.y);
    const store = useEditorStore.getState();
    // Effective multi-select intent: sticky context-bar toggle OR a held Shift (plan 027 step 2).
    const shift = store.multiSelectActive || store.shiftHeld;

    if (!pickedId) {
      // Empty space → start a marquee (region select & move). Object selection clears (unless shift),
      // matching the old empty-click behaviour; the region box is committed/cleared on pointer-up
      // depending on whether this becomes a real drag.
      if (!shift) store.setSelectedObjectIds([]);
      const { col, row } = pointerTile(this.scene, pointer);
      this.regionMarquee = { startCol: col, startRow: row };
      drawRectPreview(this.scene, col, row, col, row, REGION_COLOUR);
      return;
    }

    // Clicking an object is an object interaction — drop any drawn region so the two selection modes
    // never both show at once.
    if (store.regionSelection) store.setRegionSelection(null);

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
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const displayOrigins = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const display = this.scene.objectDisplayById.get(id);
      const withXY = display as unknown as { x?: number; y?: number } | undefined;
      if (withXY && typeof withXY.x === 'number' && typeof withXY.y === 'number') {
        displayOrigins.set(id, { x: withXY.x, y: withXY.y });
      }
    }
    this.objectDrag = { ids, startWorld: { x: world.x, y: world.y }, displayOrigins };
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.gesture) {
      this.updateGesture();
      return;
    }
    if (this.panning) {
      const cam = this.scene.cameras.main;
      cam.scrollX -= (pointer.x - this.panLast.x) / cam.zoom;
      cam.scrollY -= (pointer.y - this.panLast.y) / cam.zoom;
      this.panLast = { x: pointer.x, y: pointer.y };
      return;
    }

    if (this.activeStroke) {
      const { col, row } = pointerTile(this.scene, pointer);
      if (col !== this.activeStroke.lastCol || row !== this.activeStroke.lastRow) {
        const state = useEditorStore.getState();
        const { strokeId, lastCol, lastRow } = this.activeStroke;
        if (this.activeStroke.tool === 'brush')
          state.paintLine(lastCol, lastRow, col, row, strokeId);
        else state.eraseLine(lastCol, lastRow, col, row, strokeId);
        this.activeStroke.lastCol = col;
        this.activeStroke.lastRow = row;
      }
      updateHover(this.scene, pointer);
      return;
    }

    if (this.rectDrag) {
      const { col, row } = pointerTile(this.scene, pointer);
      drawRectPreview(this.scene, this.rectDrag.startCol, this.rectDrag.startRow, col, row);
      updateHover(this.scene, pointer);
      return;
    }

    if (this.activeTargetStroke) {
      const { col, row } = pointerTile(this.scene, pointer);
      const s = this.activeTargetStroke;
      if (col !== s.lastCol || row !== s.lastRow) {
        this.applyTargetSegment(s.lastCol, s.lastRow, col, row);
        s.lastCol = col;
        s.lastRow = row;
      }
      updateHover(this.scene, pointer);
      return;
    }

    if (this.targetRectDrag) {
      const { col, row } = pointerTile(this.scene, pointer);
      drawRectPreview(
        this.scene,
        this.targetRectDrag.startCol,
        this.targetRectDrag.startRow,
        col,
        row,
        this.targetPreviewColour(this.targetRectDrag.target),
      );
      updateHover(this.scene, pointer);
      return;
    }

    if (this.portalDrag) {
      const { col, row } = pointerTile(this.scene, pointer);
      drawRectPreview(
        this.scene,
        this.portalDrag.startCol,
        this.portalDrag.startRow,
        col,
        row,
        PORTAL_PREVIEW_COLOUR,
      );
      updateHover(this.scene, pointer);
      return;
    }

    if (this.regionMarquee) {
      const { col, row } = pointerTile(this.scene, pointer);
      drawRectPreview(
        this.scene,
        this.regionMarquee.startCol,
        this.regionMarquee.startRow,
        col,
        row,
        REGION_COLOUR,
      );
      updateHover(this.scene, pointer);
      return;
    }

    if (this.objectDrag) {
      // Live-preview only — translate the tracked display GameObjects visually; the store is NOT
      // touched until pointer-up (mutating per-move would rebake/reselect every frame, and — unlike
      // paint strokes — an object move isn't naturally coalesced cell-by-cell). Follows the pointer
      // continuously (unsnapped) for a smooth feel; the COMMIT step (below) computes the actual
      // snapped/tile-stepped delta that gets stored.
      const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const dx = world.x - this.objectDrag.startWorld.x;
      const dy = world.y - this.objectDrag.startWorld.y;
      for (const [id, origin] of this.objectDrag.displayOrigins) {
        const display = this.scene.objectDisplayById.get(id) as unknown as
          { setPosition?: (x: number, y: number) => void } | undefined;
        display?.setPosition?.(origin.x + dx, origin.y + dy);
      }
      redrawSelection(this.scene);
      return;
    }

    updateHover(this.scene, pointer);
    // Keep the eyedropper cursor in step with the LIVE Alt state off this move's native event, so it
    // shows/hides even if the store's `altHeld` tracking missed a keydown/keyup (blur/focus).
    this.updateToolCursor(EditorInputController.pointerAlt(pointer));
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    const wasTouch = pointer.wasTouch;
    if (wasTouch) this.touchIdsDown.delete(pointer.id);
    if (this.gesture) {
      // A finger lifted mid-gesture: if two are still down, re-seat the baseline so the remaining
      // pair continues without a jump; otherwise the gesture ends. The still-down finger fires no new
      // pointer-down, so no tool starts on gesture end (no accidental paint on release).
      if (this.touchIdsDown.size >= 2) {
        this.beginGesture();
        return;
      }
      this.gesture = null;
      // Pinch/two-finger zoom just ended (the primary mobile zoom) — persist the settled camera.
      this.scene.cameraController.persistCamera();
    } else {
      this.dispatchToolPointerUp(pointer);
    }
    // Touch has no hover state once the finger lifts (no cursor sitting over a cell), so clear the
    // hover outline + brush ghost that tracked the finger during the drag — otherwise they linger
    // under an absent finger. Desktop keeps its hover: the mouse is still over the cell after a
    // click, and this is gated to touch. Plan 027 step 4.
    if (wasTouch) clearHover(this.scene);
  }

  /** The tool-release dispatch (commit rect/portal/object drags, end strokes/pans). Split out of
   *  `handlePointerUp` so the wrapper can run a touch-only hover/ghost clear afterwards regardless of
   *  which release branch fired. Runs only for a single-pointer release (a two-finger gesture is
   *  handled by the caller). */
  private dispatchToolPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.panning) {
      this.panning = false;
      this.scene.cameraController.persistCamera();
      this.setCursor(this.spaceDown ? 'grab' : this.desiredIdleCursor());
      return;
    }
    if (this.activeStroke) {
      this.activeStroke = null;
      return;
    }
    if (this.rectDrag) {
      const { col, row } = pointerTile(this.scene, pointer);
      useEditorStore
        .getState()
        .paintRectArea(this.rectDrag.startCol, this.rectDrag.startRow, col, row);
      this.rectDrag = null;
      this.scene.rectPreviewGfx?.clear();
      return;
    }
    if (this.activeTargetStroke) {
      this.activeTargetStroke = null;
      return;
    }
    if (this.targetRectDrag) {
      const { col, row } = pointerTile(this.scene, pointer);
      const drag = this.targetRectDrag;
      this.targetRectDrag = null;
      this.scene.rectPreviewGfx?.clear();
      this.applyTargetRect(drag.target, drag.startCol, drag.startRow, col, row, drag.on);
      return;
    }
    if (this.portalDrag) {
      const { col, row } = pointerTile(this.scene, pointer);
      const rect = EditorInputController.rectFromCorners(
        this.portalDrag.startCol,
        this.portalDrag.startRow,
        col,
        row,
      );
      this.portalDrag = null;
      this.scene.rectPreviewGfx?.clear();
      const map = useEditorStore.getState().map;
      if (map && EditorInputController.portalRectValid(map, rect)) {
        useEditorStore.getState().setPendingPortalRect(rect);
      } else {
        console.warn('[editor] portal rect refused — overlaps void/out-of-bounds');
      }
      return;
    }
    if (this.regionMarquee) {
      const { startCol, startRow } = this.regionMarquee;
      this.regionMarquee = null;
      this.scene.rectPreviewGfx?.clear();
      const { col, row } = pointerTile(this.scene, pointer);
      const store = useEditorStore.getState();
      const map = store.map;
      if (!map) return;
      if (col === startCol && row === startRow) {
        // A click, not a drag → clear the region (the touch/desktop "deselect" gesture).
        store.setRegionSelection(null);
      } else {
        // A real box drag → select that tile area (normalizeRegion clamps to bounds, null if off-map).
        store.setRegionSelection(
          normalizeRegion(startCol, startRow, col, row, map.meta.width, map.meta.height),
        );
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

    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const rawDx = world.x - drag.startWorld.x;
    const rawDy = world.y - drag.startWorld.y;
    const state = useEditorStore.getState();
    // Effective free-pixel intent: sticky context-bar toggle OR a held Alt (plan 027 step 2), Alt
    // read off this release's native event so a desynced store `altHeld` can't drop it.
    const freePixel =
      state.freePixelActive || EditorInputController.pointerAlt(pointer) || state.altHeld;
    const snap = state.snapToTileCenter && !freePixel;
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
      if (map) placeObjects(this.scene, map);
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
    if (!this.panning) this.setCursor(down ? 'grab' : this.desiredIdleCursor());
  }

  private setCursor(cursor: string): void {
    if (this.scene.game.canvas) this.scene.game.canvas.style.cursor = cursor;
  }

  /** Whether Alt is held per a pointer's OWN native DOM event — the authoritative read at click time,
   *  independent of the store's `altHeld` tracking (which a `window` blur can clear). `pointer.event`
   *  is the native Mouse/Touch event; all carry an `altKey`. */
  private static pointerAlt(pointer: Phaser.Input.Pointer): boolean {
    const ev = pointer.event as { altKey?: boolean } | undefined;
    return ev?.altKey === true;
  }

  /** Drop all in-flight touch/gesture tracking (fired via the store's `pointerGestureResetNonce` when a
   *  compact drawer toggles — see that field's doc). The Library/Inspector drawers are modal DOM
   *  overlays that can swallow a finger's `touchend` (a Radix Sheet `preventDefault`s it), stranding a
   *  phantom in `touchIdsDown`; a later single tap would then count as a two-finger pinch and jam the
   *  editor in zoom. Resetting on the drawer toggle — the exact desync boundary — clears that phantom
   *  deterministically, without the earlier native-touch-count heuristic that broke real pinch-zoom.
   *  Also aborts any half-finished tool interaction so nothing is left dangling across the overlay. */
  resetTouchGesture(): void {
    this.touchIdsDown.clear();
    this.gesture = null;
    this.cancelActiveInteraction();
  }

  /** The idle (non-drag) cursor for the active tool: the eyedropper pipette when the `eyedropper`
   *  tool is active OR Alt is held over a tile-paint tool (brush/eraser/fill/rect); `default`
   *  otherwise. `altOverride` lets a pointer-move pass the click's live native Alt state so the
   *  cursor tracks the physical key even if the store's `altHeld` desynced. */
  private desiredIdleCursor(altOverride?: boolean): string {
    const { activeTool, altHeld } = useEditorStore.getState();
    const alt = altOverride ?? altHeld;
    const tilePaint =
      activeTool === 'brush' ||
      activeTool === 'eraser' ||
      activeTool === 'fill' ||
      activeTool === 'rect';
    return activeTool === 'eyedropper' || (alt && tilePaint) ? EYEDROPPER_CURSOR : 'default';
  }

  /** Apply `desiredIdleCursor` — unless a pan/space-drag currently owns the cursor (grab/grabbing),
   *  which takes priority and restores the idle cursor itself on release. */
  updateToolCursor(altOverride?: boolean): void {
    if (this.panning || this.spaceDown) return;
    this.setCursor(this.desiredIdleCursor(altOverride));
  }
}
