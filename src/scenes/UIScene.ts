import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, COLORS } from '../config';
import { ITEMS } from '../data/items';
import { BUILDABLES } from '../data/buildables';
import type { Inventory } from '../systems/Inventory';

/**
 * HUD overlay, run in parallel over GameScene (never replaces it). Renders the wood counter, a
 * Build toggle, and a build-mode indicator. UI is decoupled from world logic: it reads the shared
 * Inventory (via the registry) and talks to GameScene only over `this.game.events` (`build:*`).
 *
 * Cross-scene input arbitration: GameScene's world tap handler ignores pointers inside the HUD
 * hit-region ({@link hudHitTest}) so tapping Build never also moves/chops/places underneath.
 */
export class UIScene extends Phaser.Scene {
  private inv?: Inventory;
  private woodText!: Phaser.GameObjects.Text;
  private buildButton!: Phaser.GameObjects.Rectangle;
  private buildLabel!: Phaser.GameObjects.Text;
  private modeIndicator!: Phaser.GameObjects.Text;
  /** Screen-space rects (game coords) that GameScene must treat as UI, not world. */
  private hudRects: Phaser.Geom.Rectangle[] = [];

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
    this.hudRects.push(this.buildButton.getBounds());

    // Build-mode indicator — only visible while building.
    this.modeIndicator = this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 14, 'BUILD MODE — tap a tile · tap Build to cancel', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e8dcc0',
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.hudRects.push(this.modeIndicator.getBounds());

    // Seed + subscribe: read the shared Inventory's own 'change' directly (no event-bus hop).
    this.refreshWood(this.inv?.snapshot() ?? {});
    this.inv?.on('change', this.refreshWood, this);
    this.game.events.on('build:modeChanged', this.onBuildMode, this);

    // Teardown so a future scene restart doesn't double-register on stale listeners.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inv?.off('change', this.refreshWood, this);
      this.game.events.off('build:modeChanged', this.onBuildMode, this);
    });
  }

  /** True if (x, y) in game coords lands on an interactive HUD element. */
  hudHitTest(x: number, y: number): boolean {
    return this.hudRects.some((r) => r.contains(x, y));
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
}
