import Phaser from 'phaser';
import {
  BASE_WIDTH,
  BASE_HEIGHT,
  COLORS,
  DEFAULT_ZOOM,
  ZOOM_STEP,
  MIN_ZOOM,
  MAX_ZOOM,
  HOTBAR_SLOTS,
  INVENTORY_SLOTS,
} from '../config';
import { ITEMS } from '../data/items';
import { BUILDABLES } from '../data/buildables';
import { iconKey } from '../data/tileset';
import type { Inventory } from '../systems/Inventory';
import type { InspectableStats } from '../data/types';
import { Button, Panel, SlotGrid, arrangeRow, type SlotVisual } from '../ui';

/**
 * HUD overlay, run in parallel over GameScene (never replaces it). Renders the wood counter, a
 * Build toggle, a build-mode indicator, a Cancel button, and a live task-queue indicator. UI is
 * decoupled from world logic: it reads the shared Inventory (via the registry) and talks to GameScene
 * only over `this.game.events` (`build:*`, `tasks:*`).
 *
 * Buttons and the inspect panel are built from the reusable {@link ../ui} kit (Button/Panel) rather
 * than hand-placed rectangles + text, so styling stays consistent and future menus (inventory, build
 * palette) reuse the same primitives. Bespoke widgets (the combat movepad joystick) stay inline.
 *
 * Cross-scene input arbitration: GameScene's world tap handler ignores pointers inside the HUD
 * hit-region ({@link hudHitTest}) so tapping a button never also moves/chops/places underneath.
 */
export class UIScene extends Phaser.Scene {
  private inv?: Inventory;
  private buildButton!: Button;
  private modeIndicator!: Phaser.GameObjects.Text;
  private cancelButton!: Button;
  private queueText!: Phaser.GameObjects.Text;
  private zoomText!: Phaser.GameObjects.Text;
  private zoomOutButton!: Button;
  private zoomInButton!: Button;
  private followButton!: Button;

  // Mode toggle (Command/Combat/Inspect — see plan 003). GameScene owns the authoritative mode;
  // this scene just mirrors it for button highlighting + showing/hiding the Combat-mode controls.
  private modeCombatButton!: Button;
  private modeInspectButton!: Button;

  // Inventory (plan 008): an always-visible hotbar (first HOTBAR_SLOTS slots, hidden in combat) plus
  // a button-toggled full grid Panel of all INVENTORY_SLOTS. Both are SlotGrid views over the shared
  // Inventory's slots(), repainted on its 'change'.
  private hotbar!: SlotGrid;
  private inventoryButton!: Button;
  private inventoryPanel!: Panel;
  private inventoryGrid!: SlotGrid;

  // Combat mode: virtual movepad (bottom-right) + Punch button (bottom-left). The movepad is a
  // bespoke joystick (drag tracking below), not a kit widget; the Punch button is a kit Button.
  // Drag is tracked here (not GameScene) via a scene-level pointermove/up, gated by which pointer id
  // pressed the base — keeps the input arithmetic out of GameScene, which only needs the resulting
  // normalized {dx, dy}.
  private movepadBase!: Phaser.GameObjects.Arc;
  private movepadKnob!: Phaser.GameObjects.Arc;
  private readonly movepadCenter = { x: 300, y: 540 };
  private readonly movepadRadius = 40;
  private movepadPointerId: number | null = null;
  private combatPunchButton!: Button;

  // Inspect mode: a simple stats panel, centered, shown on 'inspect:show' / hidden on
  // 'inspect:hide' or leaving Inspect mode. `inspectPanelBg` is the Panel container itself, so its
  // `visible` reflects open/closed; the three text rows live inside it.
  private inspectPanelBg!: Panel;
  private inspectPanelTitle!: Phaser.GameObjects.Text;
  private inspectPanelHp!: Phaser.GameObjects.Text;
  private inspectPanelExtra!: Phaser.GameObjects.Text;

  /** Interactive HUD elements GameScene must treat as UI, not world — tested live so a hidden
   * button (Cancel when idle, the panel when closed) never swallows a world tap. Kit widgets are
   * Containers; a Container's getBounds() is the union of its children's bounds. */
  private hudElements: Array<Phaser.GameObjects.Container | Phaser.GameObjects.Text | Phaser.GameObjects.Arc> = [];

  constructor() {
    super('UI');
  }

  create(): void {
    this.inv = this.registry.get('inventory') as Inventory | undefined;

    // Build toggle — a touch-sized button, top-right.
    const bw = 76;
    const bh = 26;
    this.buildButton = new Button(this, BASE_WIDTH - bw / 2 - 8, 8 + bh / 2, {
      width: bw,
      height: bh,
      label: 'BUILD',
      onDown: () => this.game.events.emit('build:toggle'),
    });
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
    this.cancelButton = new Button(this, BASE_WIDTH - cbw / 2 - 8, 8 + bh / 2 + bh / 2 + cbh / 2 + 6, {
      width: cbw,
      height: cbh,
      label: 'CANCEL',
      variant: 'danger',
      fontSize: 10,
      onDown: () => this.game.events.emit('tasks:cancel'),
    }).setVisible(false);
    this.hudElements.push(this.cancelButton);

    // Inventory toggle — top-right, in the same stack under BUILD/CANCEL. Opens the full grid Panel.
    const ibw = 72;
    const ibh = 22;
    this.inventoryButton = new Button(this, BASE_WIDTH - ibw / 2 - 8, 8 + bh + cbh + ibh / 2 + 12, {
      width: ibw,
      height: ibh,
      label: 'ITEMS',
      fontSize: 10,
      onDown: () => this.toggleInventory(),
    });
    this.hudElements.push(this.inventoryButton);

    // Queue indicator — current action + queued count, top-left.
    this.queueText = this.add.text(10, 26, '', { fontFamily: 'monospace', fontSize: '9px', color: '#9a8f74' });

    // Zoom controls — top-center: [−] 100% [+]. GameScene owns the actual camera zoom (and the
    // pinch-gesture path to it); this only emits deltas + mirrors the current value back as text.
    const zbSize = 24;
    const zGap = 34;
    const zY = 8 + zbSize / 2;
    this.zoomOutButton = new Button(this, BASE_WIDTH / 2 - zGap, zY, {
      width: zbSize,
      height: zbSize,
      label: '−',
      fontSize: 16,
      onDown: () => this.game.events.emit('zoom:delta', -ZOOM_STEP),
    });
    const initialZoom = (this.registry.get('zoom') as number | undefined) ?? DEFAULT_ZOOM;
    this.zoomText = this.add
      .text(BASE_WIDTH / 2, zY, `${Math.round(initialZoom * 100)}%`, { fontFamily: 'monospace', fontSize: '10px', color: '#e8dcc0' })
      .setOrigin(0.5);
    this.zoomInButton = new Button(this, BASE_WIDTH / 2 + zGap, zY, {
      width: zbSize,
      height: zbSize,
      label: '+',
      fontSize: 16,
      onDown: () => this.game.events.emit('zoom:delta', ZOOM_STEP),
    });
    this.hudElements.push(this.zoomOutButton, this.zoomInButton);
    this.updateZoomButtons(initialZoom);

    // Follow button — grouped with zoom (top-center, just below it): snaps the camera back to the
    // player and re-engages the follow-lock a manual drag (GameScene.onPointerMove) breaks. Teal
    // fill while locked on.
    const fbh = 22;
    const initialFollowing = (this.registry.get('following') as boolean | undefined) ?? true;
    this.followButton = new Button(this, BASE_WIDTH / 2, zY + zbSize / 2 + 6 + fbh / 2, {
      width: 64,
      height: fbh,
      label: 'FOLLOW',
      fontSize: 10,
      activeFill: 0x2f4a45,
      onDown: () => this.game.events.emit('camera:center'),
    }).setToggled(initialFollowing);
    this.hudElements.push(this.followButton);

    // Mode toggle — Command (default, no button needed) / Combat / Inspect, mutually exclusive.
    // Left side, below the wood/queue readout. Laid out in a row via the kit's arrangeRow helper.
    const mbw = 64;
    const mbh = 20;
    this.modeCombatButton = new Button(this, 0, 0, {
      width: mbw,
      height: mbh,
      label: 'COMBAT',
      fontSize: 9,
      onDown: () => this.game.events.emit('mode:combatToggle'),
    });
    this.modeInspectButton = new Button(this, 0, 0, {
      width: mbw,
      height: mbh,
      label: 'INSPECT',
      fontSize: 9,
      onDown: () => this.game.events.emit('mode:inspectToggle'),
    });
    arrangeRow([this.modeCombatButton, this.modeInspectButton], { startX: 8, y: 48, width: mbw, gap: 8 });
    this.hudElements.push(this.modeCombatButton, this.modeInspectButton);

    // Combat mode controls — hidden until mode === 'combat' (see onModeChanged). The movepad stays
    // a bespoke joystick; only the Punch button comes from the kit.
    this.movepadBase = this.add
      .circle(this.movepadCenter.x, this.movepadCenter.y, this.movepadRadius, 0x3a3730, 0.4)
      .setStrokeStyle(1, COLORS.ui, 0.6)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);
    this.movepadKnob = this.add.circle(this.movepadCenter.x, this.movepadCenter.y, 14, COLORS.ui, 0.85).setVisible(false);
    this.movepadBase.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.movepadPointerId = pointer.id;
      this.updateMovepad(pointer);
    });
    this.hudElements.push(this.movepadBase);

    const pbw = 70;
    const pbh = 40;
    this.combatPunchButton = new Button(this, 8 + pbw / 2, BASE_HEIGHT - 8 - pbh / 2, {
      width: pbw,
      height: pbh,
      label: 'PUNCH',
      variant: 'danger',
      onDown: () => this.game.events.emit('combat:punch'),
    }).setVisible(false);
    this.hudElements.push(this.combatPunchButton);

    // Inspect-mode stats panel — centered, clear of the always-on HUD zones. Hidden until
    // 'inspect:show'; tapping the panel itself dismisses it (dismissible Panel → 'inspect:hide').
    const iph = 150;
    this.inspectPanelBg = new Panel(this, BASE_WIDTH / 2, BASE_HEIGHT / 2 - 40, {
      width: 200,
      height: iph,
      depth: 20,
      dismissible: true,
      onDismiss: () => this.game.events.emit('inspect:hide'),
    });
    this.inspectPanelTitle = this.inspectPanelBg.addText(16, { fontSize: '13px', color: '#e8dcc0' });
    this.inspectPanelHp = this.inspectPanelBg.addText(38, { fontSize: '11px', color: '#e8dcc0' });
    this.inspectPanelExtra = this.inspectPanelBg.addText(58, { fontSize: '10px', color: '#9a8f74', align: 'center' }, 0);
    this.hudElements.push(this.inspectPanelBg);

    // Movepad drag tracking: scoped to whichever pointer id pressed the base, so a second finger
    // (e.g. a pinch-zoom on GameScene) doesn't hijack it.
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id === this.movepadPointerId) this.updateMovepad(pointer);
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.movepadPointerId) return;
      this.movepadPointerId = null;
      this.movepadKnob.setPosition(this.movepadCenter.x, this.movepadCenter.y);
      this.game.events.emit('combat:moveEnd');
    });

    // Control hint — a genuinely fixed HUD label belongs on the never-zoomed UI camera, not on the
    // world camera (which now pans/zooms with the player).
    this.add.text(6, BASE_HEIGHT - 30, 'tap: order · hold: queue · Build: walls', {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#6f6552',
    });

    // TEMP (movement testing): scatter a fresh random batch of trees. Bottom-right, dashed olive.
    const dbw = 96;
    const dbh = 24;
    const debugButton = new Button(this, BASE_WIDTH - dbw / 2 - 8, BASE_HEIGHT - dbh / 2 - 8, {
      width: dbw,
      height: dbh,
      label: '⟳ TREES',
      variant: 'olive',
      fontSize: 11,
      onDown: () => this.game.events.emit('debug:regenTrees'),
    });
    this.hudElements.push(debugButton);

    // Hotbar — always-visible row of the first HOTBAR_SLOTS slots, bottom-centre. Hidden in combat
    // mode (see onModeChanged) so it never clashes with the movepad/Punch controls.
    this.hotbar = new SlotGrid(this, BASE_WIDTH / 2, BASE_HEIGHT - 70, {
      slotCount: HOTBAR_SLOTS,
      cols: HOTBAR_SLOTS,
    });
    this.hudElements.push(this.hotbar);

    // Full inventory — a centred Panel holding a SlotGrid of every slot, toggled by the ITEMS button
    // (and dismissible by tapping it, like the inspect panel). The grid is nested in the Panel so it
    // shows/hides and positions with it.
    this.inventoryPanel = new Panel(this, BASE_WIDTH / 2, BASE_HEIGHT / 2, {
      width: 180,
      height: 172,
      depth: 20,
      dismissible: true,
      onDismiss: () => this.setInventoryOpen(false),
    });
    this.inventoryPanel.addText(16, { fontSize: '12px', color: '#e8dcc0' }).setText('INVENTORY');
    this.inventoryGrid = new SlotGrid(this, 0, 14, { slotCount: INVENTORY_SLOTS, cols: HOTBAR_SLOTS });
    this.inventoryPanel.add(this.inventoryGrid);
    this.hudElements.push(this.inventoryPanel);

    // Seed + subscribe: read the shared Inventory's own 'change' directly (no event-bus hop).
    this.refreshInventory();
    this.inv?.on('change', this.refreshInventory, this);
    this.game.events.on('build:modeChanged', this.onBuildMode, this);
    this.game.events.on('tasks:changed', this.onTasks, this);
    this.game.events.on('zoom:changed', this.onZoomChanged, this);
    this.game.events.on('camera:followChanged', this.onFollowChanged, this);
    this.game.events.on('mode:changed', this.onModeChanged, this);
    this.game.events.on('inspect:show', this.showInspectPanel, this);
    this.game.events.on('inspect:hide', this.hideInspectPanel, this);

    // Teardown so a future scene restart doesn't double-register on stale listeners.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inv?.off('change', this.refreshInventory, this);
      this.game.events.off('build:modeChanged', this.onBuildMode, this);
      this.game.events.off('tasks:changed', this.onTasks, this);
      this.game.events.off('zoom:changed', this.onZoomChanged, this);
      this.game.events.off('camera:followChanged', this.onFollowChanged, this);
      this.game.events.off('mode:changed', this.onModeChanged, this);
      this.game.events.off('inspect:show', this.showInspectPanel, this);
      this.game.events.off('inspect:hide', this.hideInspectPanel, this);
    });
  }

  /** True if (x, y) in game coords lands on a *visible* interactive HUD element. */
  hudHitTest(x: number, y: number): boolean {
    return this.hudElements.some((el) => el.visible && el.getBounds().contains(x, y));
  }

  /** Resolve an item id to its icon texture key + fallback colour for the slot grids. */
  private readonly itemVisual = (id: string): SlotVisual | undefined =>
    ITEMS[id] ? { iconKey: iconKey(id), color: ITEMS[id].color } : undefined;

  /** Repaint the hotbar + full grid from the shared Inventory's slots, and re-dim BUILD by affordability. */
  private refreshInventory(): void {
    const slots = this.inv?.slots() ?? [];
    this.hotbar.update(slots.slice(0, HOTBAR_SLOTS), this.itemVisual);
    this.inventoryGrid.update(slots, this.itemVisual);
    // Reflect affordability of a wall on the Build button (dim the label when you can't afford it).
    const affordable = (this.inv?.get(ITEMS.wood.id) ?? 0) >= (BUILDABLES.wall.cost.wood ?? 0);
    this.buildButton.label.setAlpha(affordable ? 1 : 0.4);
  }

  private toggleInventory(): void {
    this.setInventoryOpen(!this.inventoryPanel.visible);
  }

  private setInventoryOpen(open: boolean): void {
    if (open) this.inventoryPanel.show();
    else this.inventoryPanel.hide();
    this.inventoryButton.setToggled(open);
  }

  private onBuildMode(active: boolean): void {
    this.modeIndicator.setVisible(active);
    this.buildButton.setToggled(active);
  }

  /** Reflect the worker's live task state: current action label + queued count, and Cancel visibility. */
  private onTasks(state: { current: string | null; pending: number }): void {
    const busy = state.current !== null || state.pending > 0;
    this.queueText.setText(busy ? `▶ ${state.current ?? 'idle'}${state.pending ? ` · +${state.pending} queued` : ''}` : '');
    this.cancelButton.setVisible(busy);
  }

  private onZoomChanged(zoom: number): void {
    this.zoomText.setText(`${Math.round(zoom * 100)}%`);
    this.updateZoomButtons(zoom);
  }

  /** Dim a zoom button once its direction is exhausted (mirrors the Build button's afford-dimming). */
  private updateZoomButtons(zoom: number): void {
    this.zoomOutButton.setDimmed(zoom <= MIN_ZOOM);
    this.zoomInButton.setDimmed(zoom >= MAX_ZOOM);
  }

  private onFollowChanged(following: boolean): void {
    this.followButton.setToggled(following);
  }

  /** Reflects the authoritative mode from GameScene: button highlight + combat-controls visibility. */
  private onModeChanged(mode: 'command' | 'combat' | 'inspect'): void {
    this.modeCombatButton.setToggled(mode === 'combat');
    this.modeInspectButton.setToggled(mode === 'inspect');
    const inCombat = mode === 'combat';
    this.movepadBase.setVisible(inCombat);
    this.movepadKnob.setVisible(inCombat);
    this.combatPunchButton.setVisible(inCombat);
    // Hide the hotbar in combat so it doesn't clash with the movepad/Punch controls; and drop the
    // full inventory panel open across a mode switch.
    this.hotbar.setVisible(!inCombat);
    if (inCombat) this.setInventoryOpen(false);
    if (!inCombat) {
      this.movepadPointerId = null;
      this.movepadKnob.setPosition(this.movepadCenter.x, this.movepadCenter.y);
    }
    if (mode !== 'inspect') this.hideInspectPanel();
  }

  private showInspectPanel(stats: InspectableStats): void {
    this.inspectPanelTitle.setText(stats.name);
    this.inspectPanelHp.setText(stats.currentHp !== undefined ? `HP: ${stats.currentHp}/${stats.maxHp}` : `Max HP: ${stats.maxHp}`);
    this.inspectPanelExtra.setText((stats.extra ?? []).map((e) => `${e.label}: ${e.value}`).join('\n'));
    this.inspectPanelBg.show();
  }

  private hideInspectPanel(): void {
    this.inspectPanelBg.hide();
  }

  /** Drag the movepad knob toward the pointer (clamped to the base radius) and emit the
   * normalized {dx, dy} vector for GameScene to drive the player's velocity directly. */
  private updateMovepad(pointer: Phaser.Input.Pointer): void {
    const dx = pointer.x - this.movepadCenter.x;
    const dy = pointer.y - this.movepadCenter.y;
    const dist = Math.min(this.movepadRadius, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    this.movepadKnob.setPosition(this.movepadCenter.x + Math.cos(angle) * dist, this.movepadCenter.y + Math.sin(angle) * dist);
    const norm = dist / this.movepadRadius;
    this.game.events.emit('combat:move', { dx: Math.cos(angle) * norm, dy: Math.sin(angle) * norm });
  }
}
