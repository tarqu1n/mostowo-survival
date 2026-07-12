import Phaser from 'phaser';
import {
  BASE_WIDTH,
  BASE_HEIGHT,
  RENDER_SCALE,
  COLORS,
  DEFAULT_ZOOM,
  ZOOM_STEP,
  MIN_ZOOM,
  MAX_ZOOM,
  HOTBAR_SLOTS,
  INVENTORY_SLOTS,
  HUNGER_MAX,
  HUNGER_LOW_FRACTION,
  HUNGER_VIGNETTE_COLOR,
  HUNGER_VIGNETTE_MAX_ALPHA,
  DAMAGE_VIGNETTE_MS,
  DAMAGE_VIGNETTE_ALPHA,
  DAMAGE_VIGNETTE_COLOR,
} from '../config';
import { ITEMS } from '../data/items';
import type { CombatantStats } from '../data/types';
import { BUILDABLES } from '../data/buildables';
import { iconKey } from '../data/tileset';
import { bakeVignetteTexture } from '../render/vignetteTexture';
import type { Inventory } from '../systems/Inventory';
import type { InspectableStats } from '../data/types';
import { Button, Panel, SlotGrid, arrangeRow, UI_THEME, type SlotVisual } from '../ui';

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
  private timeText!: Phaser.GameObjects.Text;

  // Dev menu (dev-only): a bottom-right DEV toggle that opens a small olive Panel of build-testing
  // helpers — Randomise (scatter nodes + enemies) and a day/night flip. Only the toggle button and
  // the Panel go in hudElements; the buttons nested in the Panel ride its bounds/visibility.
  private devButton!: Button;
  private devPanel!: Panel;
  private devTimeButton!: Button;

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

  // Health & Wellbeing screen (plan 004): a STATUS-toggled Panel with a hunger + health meter, the
  // player's stat rows, and a tap-to-eat edible list. Only the button + panel go in hudElements — the
  // panel's bounds cover the edible rows for the world-tap gate (same as the inventory panel).
  private statusButton!: Button;
  private wellbeingPanel!: Panel;
  private hungerBarFg!: Phaser.GameObjects.Rectangle;
  private hungerLabel!: Phaser.GameObjects.Text;
  private healthBarFg!: Phaser.GameObjects.Rectangle;
  private healthLabel!: Phaser.GameObjects.Text;

  // Always-on HUD meters (top-left): compact HP + food bars so survival state is readable at a glance
  // without opening the STATUS panel. Passive (not interactive), fed by the same value updates as the
  // Wellbeing panel's bars — see updateHealthBar/updateHungerBar, which drive both in lockstep.
  private hudHealthBarFg!: Phaser.GameObjects.Rectangle;
  private hudHealthLabel!: Phaser.GameObjects.Text;
  private hudHungerBarFg!: Phaser.GameObjects.Rectangle;
  private hudHungerLabel!: Phaser.GameObjects.Text;
  private playerMaxHp = 0;
  private playerHp = 0; // seeded lazily from the first player:hpChanged (HP isn't on the registry)
  private eatRows: Array<{ itemId: string; button: Button; nutrition: number }> = [];

  // Full-viewport red "damage vignette" (top depth, camera-fixed, alpha 0 at rest). Its alpha is
  // pulsed on a `player:hit` event so a bite reads as a peripheral red flash, not just a tint on the
  // easily-missed centre sprite. Non-interactive, so it never blocks the HUD buttons beneath it.
  private damageVignette!: Phaser.GameObjects.Image;

  // Steady yellow "starving vignette", a sibling of the damage one but persistent, not pulsed: its
  // alpha ramps in as hunger drops below HUNGER_LOW_FRACTION (driven by updateHungerBar). Sits just
  // below the damage vignette so a hit still flashes red over it. Also non-interactive.
  private hungerVignette!: Phaser.GameObjects.Image;

  // Combat mode: virtual movepad (bottom-right) + Attack button (bottom-left). The movepad is a
  // bespoke joystick (drag tracking below), not a kit widget; the Attack button is a kit Button.
  // Drag is tracked here (not GameScene) via a scene-level pointermove/up, gated by which pointer id
  // pressed the base — keeps the input arithmetic out of GameScene, which only needs the resulting
  // normalized {dx, dy}.
  private movepadBase!: Phaser.GameObjects.Arc;
  private movepadKnob!: Phaser.GameObjects.Arc;
  private readonly movepadCenter = { x: 300, y: 540 };
  private readonly movepadRadius = 40;
  private movepadPointerId: number | null = null;
  private combatAttackButton!: Button;

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

    // The backing store is BASE×RENDER_SCALE (rendered at device density to kill tile-edge seams —
    // see config RENDER_SCALE). Zoom the HUD camera by that factor and recentre it on the design-space
    // midpoint, so every widget below stays authored in plain BASE_WIDTH×BASE_HEIGHT units yet renders
    // crisply at device resolution. (No-op at RENDER_SCALE 1.)
    if (RENDER_SCALE !== 1) {
      this.cameras.main.setZoom(RENDER_SCALE);
      this.cameras.main.centerOn(BASE_WIDTH / 2, BASE_HEIGHT / 2);
    }

    // Damage vignette: a full-viewport red edge-flash, invisible at rest, pulsed on `player:hit`.
    // Baked once (see render/vignetteTexture); a plain world object sized to the design viewport and
    // never made interactive so pointer input still falls through to the HUD/world beneath it. NOT
    // scrollFactor 0: this scene's camera is zoomed (RENDER_SCALE) and centerOn'd, so its scroll is
    // non-zero — a scrollFactor-0 object skips that compensation and, under zoom, pins its centre to
    // screen (0,0) scaled up, covering only the top-left quadrant. As a world object it maps like every
    // other HUD widget. The camera never scrolls, so it stays a fixed overlay regardless.
    const vignetteKey = bakeVignetteTexture(this, DAMAGE_VIGNETTE_COLOR, BASE_WIDTH, BASE_HEIGHT);
    this.damageVignette = this.add
      .image(BASE_WIDTH / 2, BASE_HEIGHT / 2, vignetteKey)
      .setDisplaySize(BASE_WIDTH, BASE_HEIGHT)
      .setDepth(100000)
      .setAlpha(0);

    // Starving vignette: same baked edge-vignette, yellow, one depth below the damage flash. Alpha
    // starts at 0 and is driven live by updateHungerBar; no tween — hunger changes gradually.
    const hungerVignetteKey = bakeVignetteTexture(this, HUNGER_VIGNETTE_COLOR, BASE_WIDTH, BASE_HEIGHT);
    this.hungerVignette = this.add
      .image(BASE_WIDTH / 2, BASE_HEIGHT / 2, hungerVignetteKey)
      .setDisplaySize(BASE_WIDTH, BASE_HEIGHT)
      .setDepth(99999)
      .setAlpha(0);

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

    // Day/night readout — passive (not interactive, not pushed to hudElements), top-centre just
    // below the zoom/follow stack. ASCII form (not the ☀/☾ glyphs) to avoid tofu boxes at 12px in
    // the monospace HUD font. Seeded from the registry (GameScene seeds 'dayPhase'/'dayCount' in its
    // own create()); kept in sync via 'time:changed' below.
    const initialPhase = (this.registry.get('dayPhase') as 'day' | 'night' | undefined) ?? 'day';
    const initialDayCount = (this.registry.get('dayCount') as number | undefined) ?? 1;
    this.timeText = this.add
      .text(BASE_WIDTH / 2, zY + zbSize / 2 + 6 + fbh + 10, `Day ${initialDayCount} [${initialPhase}]`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#e8dcc0',
      })
      .setOrigin(0.5);

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

    // STATUS — opens the Health & Wellbeing screen. Left column, below the mode row (clear of the
    // combat movepad/Attack corners and the centre day/night stack).
    this.statusButton = new Button(this, 8 + mbw / 2, 72, {
      width: mbw,
      height: mbh,
      label: 'STATUS',
      fontSize: 9,
      onDown: () => this.toggleWellbeing(),
    });
    this.hudElements.push(this.statusButton);

    // Combat mode controls — hidden until mode === 'combat' (see onModeChanged). The movepad stays
    // a bespoke joystick; only the Attack button comes from the kit.
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
    this.combatAttackButton = new Button(this, 8 + pbw / 2, BASE_HEIGHT - 8 - pbh / 2, {
      width: pbw,
      height: pbh,
      label: 'ATTACK',
      variant: 'danger',
      onDown: () => this.game.events.emit('combat:attack'),
    }).setVisible(false);
    this.hudElements.push(this.combatAttackButton);

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

    // Dev menu (dev-only): a bottom-right DEV toggle opening a small olive Panel of build helpers.
    const dbw = 96;
    const dbh = 24;
    this.devButton = new Button(this, BASE_WIDTH - dbw / 2 - 8, BASE_HEIGHT - dbh / 2 - 8, {
      width: dbw,
      height: dbh,
      label: 'DEV',
      variant: 'olive',
      fontSize: 11,
      onDown: () => this.toggleDevMenu(),
    });
    this.hudElements.push(this.devButton);

    // The menu panel sits just above the DEV button, right-aligned to it. Its buttons are nested
    // children (like the Wellbeing eat-rows), so they show/hide and hit-test with the panel — only
    // the panel itself is pushed to hudElements. Hidden until DEV is tapped.
    const dpw = 124;
    const dph = 96;
    this.devPanel = new Panel(this, BASE_WIDTH - dpw / 2 - 8, BASE_HEIGHT - dbh - 16 - dph / 2, {
      width: dpw,
      height: dph,
      fill: UI_THEME.olive.fill,
      stroke: UI_THEME.olive.stroke,
      strokeAlpha: UI_THEME.olive.strokeAlpha,
      depth: 20,
    });
    this.devPanel.addText(14, { fontSize: '10px', color: UI_THEME.olive.text }).setText('DEV MENU');

    const randomiseButton = new Button(this, 0, -4, {
      width: 108,
      height: 24,
      label: '⟳ RANDOMISE',
      variant: 'olive',
      fontSize: 11,
      onDown: () => this.game.events.emit('debug:randomise'),
    });
    const initialTimeLabel = initialPhase === 'day' ? 'GO NIGHT' : 'GO DAY';
    this.devTimeButton = new Button(this, 0, 26, {
      width: 108,
      height: 24,
      label: initialTimeLabel,
      variant: 'olive',
      fontSize: 11,
      onDown: () => this.game.events.emit('debug:toggleTime'),
    });
    this.devPanel.add([randomiseButton, this.devTimeButton]);
    this.hudElements.push(this.devPanel);

    // Hotbar — always-visible row of the first HOTBAR_SLOTS slots, bottom-centre. Hidden in combat
    // mode (see onModeChanged) so it never clashes with the movepad/Attack controls.
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

    // Always-on HP + food bars, top-left (built before the Wellbeing panel so its seed values, which
    // drive both sets of bars, land on objects that already exist).
    this.buildHudBars();

    // Health & Wellbeing screen (plan 004) — meters + stat rows + edible list.
    this.buildWellbeingPanel();

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
    this.game.events.on('time:changed', this.onTimeChanged, this);
    this.game.events.on('hunger:changed', this.onHungerChanged, this);
    this.game.events.on('player:hpChanged', this.onPlayerHp, this);
    this.game.events.on('player:hit', this.onPlayerHit, this);

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
      this.game.events.off('time:changed', this.onTimeChanged, this);
      this.game.events.off('hunger:changed', this.onHungerChanged, this);
      this.game.events.off('player:hpChanged', this.onPlayerHp, this);
      this.game.events.off('player:hit', this.onPlayerHit, this);
    });
  }

  /** Pulse the damage vignette: snap to its peak alpha and fade out. Restarts cleanly on a rapid
   * second hit (kill the prior fade first) so back-to-back bites each read as a fresh flash. */
  private onPlayerHit(): void {
    this.tweens.killTweensOf(this.damageVignette);
    this.damageVignette.setAlpha(DAMAGE_VIGNETTE_ALPHA);
    // Cubic.easeIn holds near the peak briefly before dropping off, so the flash registers rather than
    // fading the instant it appears (Quad.easeOut lost most of it in the first ~80ms).
    this.tweens.add({ targets: this.damageVignette, alpha: 0, duration: DAMAGE_VIGNETTE_MS, ease: 'Cubic.easeIn' });
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
    this.refreshEatRows(); // keep the Wellbeing edible counts live with the bag
  }

  private toggleInventory(): void {
    this.setInventoryOpen(!this.inventoryPanel.visible);
  }

  private setInventoryOpen(open: boolean): void {
    if (open) this.inventoryPanel.show();
    else this.inventoryPanel.hide();
    this.inventoryButton.setToggled(open);
  }

  private toggleDevMenu(): void {
    const open = !this.devPanel.visible;
    if (open) this.devPanel.show();
    else this.devPanel.hide();
    this.devButton.setToggled(open);
  }

  // ---- Always-on HUD meters ------------------------------------------------

  /**
   * Build the compact top-left HP + food bars: a short text label, a dark-bg / coloured-fg meter, and
   * a value readout overlaid on the fill. They live in the free strip above the queue readout and left
   * of the zoom controls, stay visible in every mode, and are fed by updateHealthBar/updateHungerBar
   * (shared with the Wellbeing panel). Value seeding happens there, once the panel is built.
   */
  private buildHudBars(): void {
    const LABEL_X = 8;
    const BAR_X = 40;
    const BAR_W = 96;
    const BAR_H = 9;
    const healthY = 10;
    const hungerY = 21;

    // Dark bg rect + left-anchored coloured fg (origin 0,0.5 keeps the left edge fixed as scaleX
    // shrinks), plus a centred value label with a black stroke so numbers stay legible over any fill.
    const makeBar = (yc: number, colour: number): { fg: Phaser.GameObjects.Rectangle; value: Phaser.GameObjects.Text } => {
      this.add.rectangle(BAR_X + BAR_W / 2, yc, BAR_W, BAR_H, 0x2a2a2a).setStrokeStyle(1, 0x000000, 0.5);
      const fg = this.add.rectangle(BAR_X, yc, BAR_W, BAR_H, colour).setOrigin(0, 0.5);
      const value = this.add
        .text(BAR_X + BAR_W / 2, yc, '', { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff' })
        .setOrigin(0.5)
        .setStroke('#000000', 2);
      return { fg, value };
    };

    this.add.text(LABEL_X, healthY, 'HP', { fontFamily: 'monospace', fontSize: '8px', color: '#e8dcc0' }).setOrigin(0, 0.5);
    const health = makeBar(healthY, 0x4caf50);
    this.hudHealthBarFg = health.fg;
    this.hudHealthLabel = health.value;

    this.add.text(LABEL_X, hungerY, 'FOOD', { fontFamily: 'monospace', fontSize: '8px', color: '#e8dcc0' }).setOrigin(0, 0.5);
    const hunger = makeBar(hungerY, 0xd8a24a);
    this.hudHungerBarFg = hunger.fg;
    this.hudHungerLabel = hunger.value;
  }

  // ---- Health & Wellbeing screen -------------------------------------------

  /**
   * Build the STATUS-toggled Wellbeing Panel: a hunger + health two-rect meter, the player's stat
   * rows (from the registry's `playerStats`), and a tap-to-eat list of every edible item. Meters are
   * left-anchored fg rects scaled by value; the edible rows are kit Buttons that emit `needs:eat`.
   */
  private buildWellbeingPanel(): void {
    const W = 220;
    const H = 384;
    const halfH = H / 2;
    const top = (offsetY: number): number => -halfH + offsetY;
    const BAR_W = 176;
    const BAR_H = 12;

    this.wellbeingPanel = new Panel(this, BASE_WIDTH / 2, BASE_HEIGHT / 2, {
      width: W,
      height: H,
      depth: 20,
      dismissible: true,
      onDismiss: () => this.setWellbeingOpen(false),
    });
    this.wellbeingPanel.addText(16, { fontSize: '12px', color: '#e8dcc0' }).setText('HEALTH & WELLBEING');

    // A left-anchored two-rect meter (dark bg + coloured fg scaled by value). Returns the fg rect;
    // callers set `fg.scaleX = value/max` and re-tint it. Origin (0, 0.5) keeps the left edge fixed.
    const makeBar = (offsetY: number, colour: number): Phaser.GameObjects.Rectangle => {
      const bg = this.add.rectangle(0, top(offsetY), BAR_W, BAR_H, 0x2a2a2a).setStrokeStyle(1, 0x000000, 0.5);
      const fg = this.add.rectangle(-BAR_W / 2, top(offsetY), BAR_W, BAR_H, colour).setOrigin(0, 0.5);
      this.wellbeingPanel.add([bg, fg]);
      return fg;
    };

    this.hungerLabel = this.wellbeingPanel.addText(44, { fontSize: '10px', color: '#e8dcc0' });
    this.hungerBarFg = makeBar(60, 0xd8a24a);
    this.healthLabel = this.wellbeingPanel.addText(86, { fontSize: '10px', color: '#e8dcc0' });
    this.healthBarFg = makeBar(102, 0x4caf50);

    // Player stats — read once from the registry (combat's private stat bag, surfaced by GameScene).
    const s = this.registry.get('playerStats') as CombatantStats | undefined;
    const statLine = (label: string, value: number | string): string => `${label.padEnd(9)}${value}`;
    const statsText = s
      ? [
          statLine('Max HP', s.maxHp),
          statLine('Armour', s.armour),
          statLine('Speed', s.speed),
          statLine('Vision', s.vision ?? '-'),
          statLine('Strength', s.strength),
          statLine('Dex', s.dex),
          statLine('Dodge', s.dodge),
        ].join('\n')
      : '(stats unavailable)';
    this.wellbeingPanel.addText(126, { fontSize: '11px', color: '#9a8f74' }).setText('— STATS —');
    this.wellbeingPanel
      .addText(140, { fontSize: '10px', color: '#9a8f74', align: 'left' }, 0)
      .setText(statsText);

    // Seed the health bar: max from playerStats (HP itself isn't on the registry — fill from the first
    // player:hpChanged), so it starts full until combat reports the live value.
    this.playerMaxHp = s?.maxHp ?? 0;
    this.playerHp = this.playerMaxHp;
    this.updateHealthBar();
    this.updateHungerBar((this.registry.get('hunger') as number | undefined) ?? HUNGER_MAX);

    // Edible list — one interactive row per item with `nutrition`. The row emits needs:eat (guarded to
    // count > 0). Rows live inside the panel, so the panel's bounds cover them for the world-tap gate.
    this.wellbeingPanel.addText(248, { fontSize: '11px', color: '#9a8f74' }).setText('— AVAILABLE TO EAT —');
    const edibles = Object.values(ITEMS).filter((it) => it.nutrition != null);
    edibles.forEach((it, i) => {
      const rowY = top(272 + i * 30);
      if (this.textures.exists(iconKey(it.id))) {
        const icon = this.add.image(-BAR_W / 2 + 6, rowY, iconKey(it.id)).setDisplaySize(18, 18);
        this.wellbeingPanel.add(icon);
      }
      const button = new Button(this, 14, rowY, {
        width: 150,
        height: 24,
        label: it.name,
        fontSize: 10,
        onDown: () => {
          if ((this.inv?.get(it.id) ?? 0) > 0) this.game.events.emit('needs:eat', { itemId: it.id });
        },
      });
      this.wellbeingPanel.add(button);
      this.eatRows.push({ itemId: it.id, button, nutrition: it.nutrition! });
    });
  }

  private toggleWellbeing(): void {
    this.setWellbeingOpen(!this.wellbeingPanel.visible);
  }

  private setWellbeingOpen(open: boolean): void {
    if (open) {
      this.refreshEatRows(); // sync counts before showing
      this.wellbeingPanel.show();
    } else {
      this.wellbeingPanel.hide();
    }
    this.statusButton.setToggled(open);
  }

  /** Scale + tint the hunger bars (panel + always-on HUD) and update their labels. Amber normally,
   * red when near-empty/starving. */
  private updateHungerBar(hunger: number): void {
    const ratio = Math.max(0, Math.min(1, hunger / HUNGER_MAX));
    const colour = ratio <= HUNGER_LOW_FRACTION ? 0xc0392b : 0xd8a24a;
    const rounded = Math.round(hunger);
    this.hungerBarFg.scaleX = ratio;
    this.hungerBarFg.setFillStyle(colour);
    this.hungerLabel.setText(`Hunger  ${rounded}/${HUNGER_MAX}`);
    this.hudHungerBarFg.scaleX = ratio;
    this.hudHungerBarFg.setFillStyle(colour);
    this.hudHungerLabel.setText(`${rounded}/${HUNGER_MAX}`);

    // Steady yellow starving vignette: 0 at/above the low cutoff, ramping to full as hunger hits 0.
    const vignetteAlpha =
      ratio < HUNGER_LOW_FRACTION ? HUNGER_VIGNETTE_MAX_ALPHA * (1 - ratio / HUNGER_LOW_FRACTION) : 0;
    this.hungerVignette.setAlpha(vignetteAlpha);
  }

  /** Scale + tint the health bars (panel + always-on HUD) and update their labels. Green normally,
   * red when low. */
  private updateHealthBar(): void {
    const ratio = this.playerMaxHp > 0 ? Math.max(0, Math.min(1, this.playerHp / this.playerMaxHp)) : 1;
    const colour = ratio <= 0.3 ? 0xc0392b : 0x4caf50;
    this.healthBarFg.scaleX = ratio;
    this.healthBarFg.setFillStyle(colour);
    this.healthLabel.setText(`Health  ${this.playerHp}/${this.playerMaxHp}`);
    this.hudHealthBarFg.scaleX = ratio;
    this.hudHealthBarFg.setFillStyle(colour);
    this.hudHealthLabel.setText(`${this.playerHp}/${this.playerMaxHp}`);
  }

  /** Refresh each edible row's label (live count + nutrition) and dim rows with no stock. */
  private refreshEatRows(): void {
    for (const row of this.eatRows) {
      const count = this.inv?.get(row.itemId) ?? 0;
      const name = ITEMS[row.itemId]?.name ?? row.itemId;
      row.button.setLabel(`${name}  x${count}  +${row.nutrition}`);
      row.button.setDimmed(count <= 0);
    }
  }

  private onHungerChanged({ hunger }: { hunger: number; max: number }): void {
    this.updateHungerBar(hunger);
  }

  private onPlayerHp({ hp, maxHp }: { hp: number; maxHp: number }): void {
    this.playerHp = hp;
    this.playerMaxHp = maxHp;
    this.updateHealthBar();
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

  /** Keep the passive day/night readout in sync with GameScene's clock (fires only on phase/day change). */
  private onTimeChanged({ phase, dayCount }: { phase: 'day' | 'night'; dayCount: number }): void {
    this.timeText.setText(`Day ${dayCount} [${phase}]`);
    // Dev day/night button shows the phase it'll switch *to*, so it reads as an action.
    this.devTimeButton.setLabel(phase === 'day' ? 'GO NIGHT' : 'GO DAY');
  }

  /** Reflects the authoritative mode from GameScene: button highlight + combat-controls visibility. */
  private onModeChanged(mode: 'command' | 'combat' | 'inspect'): void {
    this.modeCombatButton.setToggled(mode === 'combat');
    this.modeInspectButton.setToggled(mode === 'inspect');
    const inCombat = mode === 'combat';
    this.movepadBase.setVisible(inCombat);
    this.movepadKnob.setVisible(inCombat);
    this.combatAttackButton.setVisible(inCombat);
    // Hide the hotbar in combat so it doesn't clash with the movepad/Attack controls; and drop the
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
    // Raw pointer coords are backing-store px (device-scaled); the movepad geometry is design-space.
    const dx = pointer.x / RENDER_SCALE - this.movepadCenter.x;
    const dy = pointer.y / RENDER_SCALE - this.movepadCenter.y;
    const dist = Math.min(this.movepadRadius, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    this.movepadKnob.setPosition(this.movepadCenter.x + Math.cos(angle) * dist, this.movepadCenter.y + Math.sin(angle) * dist);
    const norm = dist / this.movepadRadius;
    this.game.events.emit('combat:move', { dx: Math.cos(angle) * norm, dy: Math.sin(angle) * norm });
  }
}
