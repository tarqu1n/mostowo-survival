import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, COLORS, DEFAULT_ZOOM, ZOOM_STEP, MIN_ZOOM, MAX_ZOOM } from '../config';
import { ITEMS } from '../data/items';
import { BUILDABLES } from '../data/buildables';
import type { Inventory } from '../systems/Inventory';

/**
 * HUD overlay, run in parallel over GameScene (never replaces it). Renders the wood counter, a
 * Build toggle, a build-mode indicator, a Cancel button, and a live task-queue indicator. UI is
 * decoupled from world logic: it reads the shared Inventory (via the registry) and talks to GameScene
 * only over `this.game.events` (`build:*`, `tasks:*`).
 *
 * Cross-scene input arbitration: GameScene's world tap handler ignores pointers inside the HUD
 * hit-region ({@link hudHitTest}) so tapping a button never also moves/chops/places underneath.
 */
export class UIScene extends Phaser.Scene {
  private inv?: Inventory;
  private woodText!: Phaser.GameObjects.Text;
  private buildButton!: Phaser.GameObjects.Rectangle;
  private buildLabel!: Phaser.GameObjects.Text;
  private modeIndicator!: Phaser.GameObjects.Text;
  private cancelButton!: Phaser.GameObjects.Rectangle;
  private cancelLabel!: Phaser.GameObjects.Text;
  private queueText!: Phaser.GameObjects.Text;
  private zoomText!: Phaser.GameObjects.Text;
  private zoomOutButton!: Phaser.GameObjects.Rectangle;
  private zoomInButton!: Phaser.GameObjects.Rectangle;
  private followButton!: Phaser.GameObjects.Rectangle;
  /** Interactive HUD elements GameScene must treat as UI, not world — tested live so a hidden
   * button (Cancel when idle, the indicator outside build mode) never swallows a world tap. */
  private hudElements: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text> = [];

  constructor() {
    super('UI');
  }

  create(): void {
    this.inv = this.registry.get('inventory') as Inventory | undefined;

    // Wood counter: a colour swatch in the item's placeholder colour + a live count.
    this.add.rectangle(10, 12, 10, 10, ITEMS.wood.color).setOrigin(0, 0.5);
    this.woodText = this.add.text(24, 6, '0', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#e8dcc0',
    });

    // Build toggle — a touch-sized button, top-right.
    const bw = 76;
    const bh = 26;
    const bx = BASE_WIDTH - bw / 2 - 8;
    const by = 8 + bh / 2;
    this.buildButton = this.add
      .rectangle(bx, by, bw, bh, 0x3a3730)
      .setStrokeStyle(1, COLORS.ui, 0.6)
      .setInteractive({ useHandCursor: true });
    this.buildLabel = this.add
      .text(bx, by, 'BUILD', { fontFamily: 'monospace', fontSize: '12px', color: '#e8dcc0' })
      .setOrigin(0.5);
    this.buildButton.on('pointerdown', () => this.game.events.emit('build:toggle'));
    this.hudElements.push(this.buildButton);

    // Build-mode indicator — only visible while building.
    this.modeIndicator = this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 14, 'BUILD MODE — tap a tile · tap Build to cancel', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e8dcc0',
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.hudElements.push(this.modeIndicator);

    // Cancel button — clears the worker's task queue. Sits under the Build button, top-right.
    const cbw = 60;
    const cbh = 22;
    const cbx = BASE_WIDTH - cbw / 2 - 8;
    const cby = by + bh / 2 + cbh / 2 + 6;
    this.cancelButton = this.add
      .rectangle(cbx, cby, cbw, cbh, 0x3a2a2a)
      .setStrokeStyle(1, 0xb23b3b, 0.6)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);
    this.cancelLabel = this.add
      .text(cbx, cby, 'CANCEL', { fontFamily: 'monospace', fontSize: '10px', color: '#e8c0c0' })
      .setOrigin(0.5)
      .setVisible(false);
    this.cancelButton.on('pointerdown', () => this.game.events.emit('tasks:cancel'));
    this.hudElements.push(this.cancelButton);

    // Queue indicator — current action + queued count, top-left under the wood counter.
    this.queueText = this.add.text(10, 26, '', { fontFamily: 'monospace', fontSize: '9px', color: '#9a8f74' });

    // Zoom controls — top-center: [−] 100% [+]. GameScene owns the actual camera zoom (and the
    // pinch-gesture path to it); this only emits deltas + mirrors the current value back as text.
    const zbSize = 24;
    const zGap = 34;
    const zY = 8 + zbSize / 2;
    this.zoomOutButton = this.add
      .rectangle(BASE_WIDTH / 2 - zGap, zY, zbSize, zbSize, 0x3a3730)
      .setStrokeStyle(1, COLORS.ui, 0.6)
      .setInteractive({ useHandCursor: true });
    this.add.text(BASE_WIDTH / 2 - zGap, zY, '−', { fontFamily: 'monospace', fontSize: '16px', color: '#e8dcc0' }).setOrigin(0.5);
    const initialZoom = (this.registry.get('zoom') as number | undefined) ?? DEFAULT_ZOOM;
    this.zoomText = this.add
      .text(BASE_WIDTH / 2, zY, `${Math.round(initialZoom * 100)}%`, { fontFamily: 'monospace', fontSize: '10px', color: '#e8dcc0' })
      .setOrigin(0.5);
    this.zoomInButton = this.add
      .rectangle(BASE_WIDTH / 2 + zGap, zY, zbSize, zbSize, 0x3a3730)
      .setStrokeStyle(1, COLORS.ui, 0.6)
      .setInteractive({ useHandCursor: true });
    this.add.text(BASE_WIDTH / 2 + zGap, zY, '+', { fontFamily: 'monospace', fontSize: '16px', color: '#e8dcc0' }).setOrigin(0.5);
    this.zoomOutButton.on('pointerdown', () => this.game.events.emit('zoom:delta', -ZOOM_STEP));
    this.zoomInButton.on('pointerdown', () => this.game.events.emit('zoom:delta', ZOOM_STEP));
    this.hudElements.push(this.zoomOutButton, this.zoomInButton);
    this.updateZoomButtons(initialZoom);

    // Follow button — grouped with zoom (top-center, just below it): snaps the camera back to the
    // player and re-engages the follow-lock a manual drag (GameScene.onPointerMove) breaks. Teal
    // fill while locked on.
    const fbw = 64;
    const fbh = 22;
    const fbx = BASE_WIDTH / 2;
    const fby = zY + zbSize / 2 + 6 + fbh / 2;
    const initialFollowing = (this.registry.get('following') as boolean | undefined) ?? true;
    this.followButton = this.add
      .rectangle(fbx, fby, fbw, fbh, initialFollowing ? 0x2f4a45 : 0x3a3730)
      .setStrokeStyle(1, COLORS.ui, 0.6)
      .setInteractive({ useHandCursor: true });
    this.add.text(fbx, fby, 'FOLLOW', { fontFamily: 'monospace', fontSize: '10px', color: '#e8dcc0' }).setOrigin(0.5);
    this.followButton.on('pointerdown', () => this.game.events.emit('camera:center'));
    this.hudElements.push(this.followButton);

    // Control hint — moved here from GameScene: a genuinely fixed HUD label belongs on the
    // never-zoomed UI camera, not on the world camera (which now pans/zooms with the player).
    this.add.text(6, BASE_HEIGHT - 30, 'tap: order · hold: queue · Build: walls', {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#6f6552',
    });

    // TEMP (movement testing): scatter a fresh random batch of trees. Bottom-right, dashed olive.
    const dbw = 96;
    const dbh = 24;
    const dbx = BASE_WIDTH - dbw / 2 - 8;
    const dby = BASE_HEIGHT - dbh / 2 - 8;
    const debugButton = this.add
      .rectangle(dbx, dby, dbw, dbh, 0x2f3b26)
      .setStrokeStyle(1, 0x6f8a5a, 0.8)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(dbx, dby, '⟳ TREES', { fontFamily: 'monospace', fontSize: '11px', color: '#b9d29a' })
      .setOrigin(0.5);
    debugButton.on('pointerdown', () => this.game.events.emit('debug:regenTrees'));
    this.hudElements.push(debugButton);

    // Seed + subscribe: read the shared Inventory's own 'change' directly (no event-bus hop).
    this.refreshWood(this.inv?.snapshot() ?? {});
    this.inv?.on('change', this.refreshWood, this);
    this.game.events.on('build:modeChanged', this.onBuildMode, this);
    this.game.events.on('tasks:changed', this.onTasks, this);
    this.game.events.on('zoom:changed', this.onZoomChanged, this);
    this.game.events.on('camera:followChanged', this.onFollowChanged, this);

    // Teardown so a future scene restart doesn't double-register on stale listeners.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inv?.off('change', this.refreshWood, this);
      this.game.events.off('build:modeChanged', this.onBuildMode, this);
      this.game.events.off('tasks:changed', this.onTasks, this);
      this.game.events.off('zoom:changed', this.onZoomChanged, this);
      this.game.events.off('camera:followChanged', this.onFollowChanged, this);
    });
  }

  /** True if (x, y) in game coords lands on a *visible* interactive HUD element. */
  hudHitTest(x: number, y: number): boolean {
    return this.hudElements.some((el) => el.visible && el.getBounds().contains(x, y));
  }

  private refreshWood(snapshot: Record<string, number>): void {
    this.woodText.setText(String(snapshot[ITEMS.wood.id] ?? 0));
    // Reflect affordability of a wall on the button (dim when you can't afford it).
    const affordable = (snapshot[ITEMS.wood.id] ?? 0) >= (BUILDABLES.wall.cost.wood ?? 0);
    this.buildLabel.setAlpha(affordable ? 1 : 0.4);
  }

  private onBuildMode(active: boolean): void {
    this.modeIndicator.setVisible(active);
    this.buildButton.setFillStyle(active ? 0x5a5140 : 0x3a3730);
  }

  /** Reflect the worker's live task state: current action label + queued count, and Cancel visibility. */
  private onTasks(state: { current: string | null; pending: number }): void {
    const busy = state.current !== null || state.pending > 0;
    this.queueText.setText(busy ? `▶ ${state.current ?? 'idle'}${state.pending ? ` · +${state.pending} queued` : ''}` : '');
    this.cancelButton.setVisible(busy);
    this.cancelLabel.setVisible(busy);
  }

  private onZoomChanged(zoom: number): void {
    this.zoomText.setText(`${Math.round(zoom * 100)}%`);
    this.updateZoomButtons(zoom);
  }

  /** Dim a zoom button once its direction is exhausted (mirrors the Build button's afford-dimming). */
  private updateZoomButtons(zoom: number): void {
    this.zoomOutButton.setAlpha(zoom <= MIN_ZOOM ? 0.4 : 1);
    this.zoomInButton.setAlpha(zoom >= MAX_ZOOM ? 0.4 : 1);
  }

  private onFollowChanged(following: boolean): void {
    this.followButton.setFillStyle(following ? 0x2f4a45 : 0x3a3730);
  }
}
