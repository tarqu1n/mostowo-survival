import Phaser from 'phaser';
import {
  LONGPRESS_MS,
  DRAG_PX,
  RENDER_SCALE,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_ZOOM,
  ZOOM_STORAGE_KEY,
} from '../../config';
import { worldToTile, tileKey } from '../../systems/grid';
import type { CharacterSprite } from '../../entities/Character';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link PointerInputController} needs but doesn't own — GameScene supplies these
 * as closures over its own private fields/methods at construction (plan 013 Step 5 coupling rules:
 * managers get narrow interfaces, not raw field access). Build placement and mode-dependent intent
 * dispatch (tap / queue-paint / inspect) are NOT gesture mechanics — they route back into the scene
 * through these callbacks, so the controller only ever resolves gesture mechanics (tap vs pan vs
 * pinch vs long-press, plus the zoom/follow camera state those gestures drive).
 */
export interface PointerInputDeps {
  /** The live player sprite — camera follow/center targets it. */
  getPlayerSprite(): CharacterSprite;
  /** True while build-mode placement owns the pointer (ghost tracking + place/enqueue). */
  isBuildMode(): boolean;
  /** Build-mode pointerdown: track the ghost to the pointer, then place/enqueue the blueprint under it. */
  onBuildDown(pointer: Phaser.Input.Pointer): void;
  /** Build-mode pointermove: track the ghost to the pointer. */
  onBuildMove(pointer: Phaser.Input.Pointer): void;
  /** Current input mode ('command'/'combat'/'inspect') — gates tap/paint/inspect dispatch. */
  getMode(): 'command' | 'combat' | 'inspect';
  /** True while a finger is held on the combat movepad. While it is, map order dispatch (tap-to-move,
   *  queue-paint) and pan are suppressed for every OTHER pointer until the pad is released — the
   *  driving thumb shouldn't also let a second finger queue a path across the map. */
  isMovepadHeld(): boolean;
  /** Command-mode tap: move now, or queue if the target is a harvest / the press was a long-press. */
  onTap(pointer: Phaser.Input.Pointer): void;
  /** Command-mode queue-paint: resolve + enqueue the target under a tile not yet painted this gesture. */
  onPaint(pointer: Phaser.Input.Pointer): void;
  /** Inspect-mode tap: show/hide the tapped entity's stats panel. */
  onInspect(pointer: Phaser.Input.Pointer): void;
}

/**
 * Pointer gestures (tap / long-press queue-paint / pan / pinch-zoom) plus the camera they drive
 * (zoom, follow-lock) — moved verbatim out of GameScene (plan 013 Step 5). Camera and gestures stay
 * together (advisor decision 4): pinch/pan/follow state IS gesture state. Build placement and
 * mode-dependent intent dispatch stay in the scene, reached through {@link PointerInputDeps} — this
 * controller only ever resolves gesture mechanics.
 *
 * Constructed fresh in `create()` on every (re)start (a death-restart reuses the same Scene instance,
 * so a stale controller must not survive it): wires its own `input.on(...)` listeners there and tears
 * them down via a `once(SHUTDOWN, ...)` it arms itself in the constructor. Unlike CombatFxManager (a
 * cheap field initializer + a separate `armShutdown()` call, because that timing matters there),
 * `scene.input`/`scene.events` are already wired by the time `create()` runs, so this controller can
 * wire everything in one place with no split needed.
 */
export class PointerInputController {
  // --- Camera ---------------------------------------------------------------
  private userZoom = DEFAULT_ZOOM; // the user-facing zoom level (100/200/300%); camera scale is this × RENDER_SCALE
  private following = true; // camera auto-follows the player until a manual pan breaks the lock

  // --- Gesture state ---------------------------------------------------------
  private downScreen = new Phaser.Math.Vector2(); // pointerdown position in screen/base-canvas px
  private sawPointerDown = false; // this controller observed the press; guards against a leaked pointerup (see onPointerUp)
  private pressStart = 0; // scene-clock time of the current pointer press (for hold detection)
  private queuePainting = false; // once a hold crosses LONGPRESS_MS, dragging paints queue orders
  private paintedThisGesture = new Set<string>(); // tile keys already queued in the current gesture
  private pinching = false; // a second pointer went down — the gesture is a pinch-zoom, not a tap
  private pinchDist = 0; // previous frame's inter-pointer distance, for the zoom delta ratio
  private isPanning = false; // this gesture dragged the camera rather than issuing an order
  private lastPanX = 0; // previous frame's screen-space pointer position, for the pan delta
  private lastPanY = 0;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: PointerInputDeps,
  ) {
    scene.input.on('pointerdown', this.onPointerDown, this);
    scene.input.on('pointermove', this.onPointerMove, this);
    scene.input.on('pointerup', this.onPointerUp, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Remove this run's pointer listeners — a fresh instance + registration happens on the next create(). */
  destroy(): void {
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.off('pointermove', this.onPointerMove, this);
    this.scene.input.off('pointerup', this.onPointerUp, this);
  }

  /** Drop any tile-dedupe state left over from an in-progress queue-paint gesture — the DEV-only
   *  scenario reset mirrors what a fresh create() would start with (see GameScene.testResetWorld). */
  clearPaintedTiles(): void {
    this.paintedThisGesture.clear();
  }

  // --- Input gate ------------------------------------------------------------
  //
  // The HUD is a DOM overlay (plan 046): its interactive controls set `pointer-events: auto`, so a
  // press on a control is consumed by the DOM and never reaches this Phaser canvas — while empty HUD
  // space (`pointer-events: none`) falls through to here. That capture replaces the old Phaser
  // `hudHitTest`/`downOnUI` gate (retired at Step 13); every pointer this controller sees is therefore
  // already a genuine world press. The one HUD→world coupling left is the `movepadHeld` registry flag
  // (below), which the DOM movepad sets while dragging so other pointers stay inert mid-drive.

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.activePointerCount() >= 2) {
      // A second finger just landed — this gesture is a pinch, not a tap. Abandon anything the
      // first finger started (build ghost / queue-paint / pan) so they don't fight over the input.
      this.pinching = true;
      this.pinchDist = this.pointerDistance();
      this.queuePainting = false;
      this.isPanning = false;
      return;
    }
    this.sawPointerDown = true; // a genuine press this controller owns — its paired pointerup may now resolve
    this.downScreen.set(pointer.x, pointer.y);
    this.lastPanX = pointer.x;
    this.lastPanY = pointer.y;
    this.isPanning = false;
    this.pressStart = this.scene.time.now;
    this.queuePainting = false;
    this.paintedThisGesture.clear();
    if (this.deps.isBuildMode()) {
      this.deps.onBuildDown(pointer);
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.pinching) {
      if (this.activePointerCount() < 2) return; // one finger already lifted — wait for pointerup
      const dist = this.pointerDistance();
      if (this.pinchDist > 0) this.setZoom(this.userZoom * (dist / this.pinchDist));
      this.pinchDist = dist;
      return;
    }
    if (this.deps.isBuildMode()) {
      this.deps.onBuildMove(pointer);
      return;
    }
    // Combat mode: the DOM movepad owns all dragging. A world drag must never fall through to the
    // camera-pan below — steering the movepad drags the thumb off the small pad, and without this gate
    // that off-pad travel panned the world and broke the follow-lock, yanking the camera around
    // whenever the player changed direction.
    //
    // This (and the tap dispatch in onPointerUp) stays gated on raw `mode === 'combat'`, NOT the
    // combatActive auto-surface (plan 035a Step 3, critique #2): the chosen precedence is "movepad
    // drives, taps still queue orders", so command-mode pan/queue-paint/tap-to-move must stay live
    // while controls auto-surface. The movepad itself is still safe there — it is a DOM control that
    // consumes its own presses (they never reach this canvas) — so command-mode + auto-surface never
    // yields a dead movepad NOR a hijacked camera. Only the drive + onCombatMove gate in GameScene
    // rebase onto combatActive (see GameScene.movepadDrives).
    if (this.deps.getMode() === 'combat') return;
    // While the movepad is held (driving with the other thumb), the map is inert for any other
    // pointer — no queue-paint, no pan — until the pad is released. The pinch guard alone can't cover
    // this: BootScene registers 3 touch pointers but activePointerCount() only sees pointer1/2, so a
    // movepad finger on pointer3 slips the count and a map finger paints a path mid-drive (playtest bug).
    if (this.deps.isMovepadHeld()) return;
    if (!pointer.isDown) return;

    // Command-mode-only: queue-painting (long-press-drag) issues tap-to-pathfind orders, which
    // would fight Combat mode's direct movepad control and has no meaning in Inspect mode.
    if (this.deps.getMode() === 'command') {
      if (this.queuePainting) {
        this.paintQueueAt(pointer);
        return;
      }
      // A press held roughly still past the long-press threshold enters queue-paint mode (unchanged
      // behaviour); a press that starts dragging *first* pans the camera instead — see onPointerUp.
      if (!this.isPanning && this.scene.time.now - this.pressStart >= LONGPRESS_MS) {
        this.queuePainting = true;
        this.paintQueueAt(pointer);
        return;
      }
    }

    // downScreen and pointer are backing-store px (device-scaled); DRAG_PX is a design-space distance.
    if (
      !this.isPanning &&
      Phaser.Math.Distance.Between(this.downScreen.x, this.downScreen.y, pointer.x, pointer.y) >
        DRAG_PX * RENDER_SCALE
    ) {
      this.isPanning = true;
      this.setFollowing(false); // manual pan always breaks the follow-lock
    }
    if (this.isPanning) {
      const cam = this.scene.cameras.main;
      cam.scrollX -= (pointer.x - this.lastPanX) / cam.zoom;
      cam.scrollY -= (pointer.y - this.lastPanY) / cam.zoom;
    }
    this.lastPanX = pointer.x;
    this.lastPanY = pointer.y;
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.pinching) {
      if (this.activePointerCount() < 2) this.pinching = false; // both fingers up — gesture over
      return; // a pinch never resolves as a tap, however many fingers are still down
    }
    // A pointerup with no matching pointerdown seen by this controller is a foreign/leaked event:
    // MainMenu starts the Game scene on pointerdown, so the paired release lands on this freshly-
    // created scene and would otherwise resolve as a stray move order on the map. Never act on it.
    // (Reset so a second leaked release also no-ops.)
    if (!this.sawPointerDown) return;
    this.sawPointerDown = false;
    if (this.deps.isBuildMode()) return;
    // Movepad held → this release is a stray second-finger tap while driving; swallow it so it can't
    // issue a move/queue order (mirrors the onPointerMove gate above).
    if (this.deps.isMovepadHeld()) return;
    if (this.queuePainting) {
      this.queuePainting = false; // the drag already queued its targets
      return;
    }
    if (this.isPanning) {
      this.isPanning = false; // the drag panned the camera — never resolves as a tap
      return;
    }
    // Inspect mode shows a stats panel instead of issuing a command; Combat mode drives the
    // player via the movepad, not taps. Both skip the Command-mode tap fallthrough below.
    if (this.deps.getMode() === 'inspect') {
      this.deps.onInspect(pointer);
      return;
    }
    if (this.deps.getMode() !== 'command') return;

    this.deps.onTap(pointer);
  }

  /** Resolve + enqueue the target under the pointer, once per tile per paint gesture. */
  private paintQueueAt(pointer: Phaser.Input.Pointer): void {
    const key = tileKey(worldToTile(pointer.worldX), worldToTile(pointer.worldY));
    if (this.paintedThisGesture.has(key)) return;
    this.paintedThisGesture.add(key);
    this.deps.onPaint(pointer);
  }

  /** How many of the tracked pointers (see BootScene's addPointer) are currently held down. */
  private activePointerCount(): number {
    return [this.scene.input.pointer1, this.scene.input.pointer2].filter((p) => p.isDown).length;
  }

  private pointerDistance(): number {
    return Phaser.Math.Distance.Between(
      this.scene.input.pointer1.x,
      this.scene.input.pointer1.y,
      this.scene.input.pointer2.x,
      this.scene.input.pointer2.y,
    );
  }

  // --- Camera zoom -----------------------------------------------------------

  /** Best-effort read of a persisted zoom preference; falls back to the default. */
  loadStoredZoom(): number {
    try {
      const stored = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
      if (stored) return stored;
    } catch {
      // Private browsing / storage disabled — fall back silently.
    }
    return DEFAULT_ZOOM;
  }

  /** Apply + persist a zoom level, clamped to [MIN_ZOOM, MAX_ZOOM]. Also mirrored onto the
   * registry (for the HUD's initial zoom readout) and broadcast for live updates. */
  setZoom(z: number): void {
    // Snap to an integer level: pixel-art sprites only stay crisp at integer camera scale (see
    // config.ts ZOOM_STEP). This gates *every* zoom source — buttons, pinch, restored preference.
    const clamped = Phaser.Math.Clamp(Math.round(z), MIN_ZOOM, MAX_ZOOM);
    this.userZoom = clamped;
    // Camera scale = the user's (integer) zoom × the device render scale, so the world is drawn at
    // device density (a crisp ~1:1 final upscale, no seams) while the user still zooms in integer
    // steps. Everything else — the registry mirror, persistence, the HUD %readout — is the *user* zoom.
    this.scene.cameras.main.setZoom(clamped * RENDER_SCALE);
    this.scene.registry.set('zoom', clamped);
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped));
    } catch {
      // Private browsing / storage disabled — the zoom still applies, just won't persist.
    }
    this.scene.game.events.emit('zoom:changed', clamped);
  }

  adjustZoom(delta: number): void {
    this.setZoom(this.userZoom + delta);
  }

  // --- Camera pan / follow-lock -----------------------------------------------

  /** Engage/disengage camera auto-follow. Mirrored onto the registry (the HUD's initial follow-button
   * state) and broadcast for live updates, matching the zoom-state pattern above. */
  setFollowing(on: boolean): void {
    if (this.following === on) return;
    this.following = on;
    this.scene.registry.set('following', on);
    if (on) {
      const player = this.deps.getPlayerSprite();
      this.scene.cameras.main.startFollow(player, true);
      this.scene.cameras.main.centerOn(player.x, player.y);
    } else {
      this.scene.cameras.main.stopFollow();
    }
    this.scene.game.events.emit('camera:followChanged', on);
  }

  /** HUD "FOLLOW" button: snap back to the player and re-engage the follow-lock. */
  centerOnPlayer(): void {
    this.setFollowing(true);
  }
}
