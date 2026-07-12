import Phaser from 'phaser';
import { UI_THEME } from './theme';

/** One slot's contents (mirrors `Inventory.slots()` entries): a stack, or `null` for an empty slot. */
export type SlotData = { id: string; count: number } | null;

/** How to draw an item id: its icon texture key + a fallback tint if that texture is missing. */
export interface SlotVisual {
  iconKey: string;
  color: number;
}

/** Resolve an item id to its {@link SlotVisual}, or `undefined` for an unknown id. */
export type SlotVisualLookup = (id: string) => SlotVisual | undefined;

export interface SlotGridConfig {
  /** Number of cells. */
  slotCount: number;
  /** Cells per row (a hotbar is `cols === slotCount`; the full grid wraps). */
  cols: number;
  /** Cell edge length in px. */
  cellSize?: number;
  /** Gap between cells in px. */
  gap?: number;
}

/** Shared 1×1 white texture, tinted for the fallback swatch when an item has no icon texture. */
const BLANK_TEX = 'ui-slot-blank';

/**
 * A row/grid of bordered inventory slots as a {@link Phaser.GameObjects.Container}. Each cell draws
 * the item's **icon** sprite (scaled into the cell) — or, if that texture key is missing, a coloured
 * swatch in the item's `color` — plus a small count label (hidden when the stack is ≤ 1). Purely a
 * view: {@link SlotGrid.update} takes a slots array + an id→visual lookup and repaints; it holds no
 * inventory state. Display-only this slice (no click-to-select — plan 008 critique #4).
 *
 * Built from the kit like {@link ./Button}/{@link ./Panel}: position (x, y) is the grid's centre;
 * dropping it into `UIScene.hudElements` makes it a UI-tap region only while visible.
 */
export class SlotGrid extends Phaser.GameObjects.Container {
  private readonly cells: Array<{
    icon: Phaser.GameObjects.Image;
    count: Phaser.GameObjects.Text;
  }> = [];
  private readonly cellSize: number;

  constructor(scene: Phaser.Scene, x: number, y: number, cfg: SlotGridConfig) {
    super(scene, x, y);
    const cell = cfg.cellSize ?? 28;
    const gap = cfg.gap ?? 4;
    this.cellSize = cell;
    SlotGrid.ensureBlankTexture(scene);

    const rows = Math.ceil(cfg.slotCount / cfg.cols);
    const totalW = cfg.cols * cell + (cfg.cols - 1) * gap;
    const totalH = rows * cell + (rows - 1) * gap;
    this.setSize(totalW, totalH);

    for (let i = 0; i < cfg.slotCount; i++) {
      const col = i % cfg.cols;
      const row = Math.floor(i / cfg.cols);
      const cx = -totalW / 2 + cell / 2 + col * (cell + gap);
      const cy = -totalH / 2 + cell / 2 + row * (cell + gap);

      const bg = scene.add
        .rectangle(cx, cy, cell, cell, UI_THEME.button.fill, 0.55)
        .setStrokeStyle(1, UI_THEME.button.stroke, UI_THEME.button.strokeAlpha);
      const icon = scene.add.image(cx, cy, BLANK_TEX).setVisible(false);
      const count = scene.add
        .text(cx + cell / 2 - 2, cy + cell / 2 - 1, '', {
          fontFamily: UI_THEME.font,
          fontSize: '9px',
          color: UI_THEME.button.text,
          stroke: '#000000',
          strokeThickness: 2,
        })
        .setOrigin(1, 1)
        .setVisible(false);

      this.add([bg, icon, count]);
      this.cells.push({ icon, count });
    }

    scene.add.existing(this);
  }

  /** Repaint every cell from `slots` (index-aligned), resolving each item id via `lookup`. */
  update(slots: ReadonlyArray<SlotData>, lookup: SlotVisualLookup): this {
    const iconSize = this.cellSize - 6;
    for (let i = 0; i < this.cells.length; i++) {
      const { icon, count } = this.cells[i];
      const slot = slots[i] ?? null;
      if (!slot) {
        icon.setVisible(false);
        count.setVisible(false);
        continue;
      }
      const vis = lookup(slot.id);
      if (vis && this.scene.textures.exists(vis.iconKey)) {
        icon
          .setTexture(vis.iconKey)
          .clearTint()
          .setDisplaySize(iconSize, iconSize)
          .setVisible(true);
      } else {
        // Fallback: a coloured swatch (the item's placeholder colour) so a missing icon never blanks.
        icon
          .setTexture(BLANK_TEX)
          .setTint(vis?.color ?? 0xffffff)
          .setDisplaySize(iconSize, iconSize)
          .setVisible(true);
      }
      count.setText(String(slot.count)).setVisible(slot.count > 1);
    }
    return this;
  }

  private static ensureBlankTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(BLANK_TEX)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillRect(0, 0, 1, 1);
    g.generateTexture(BLANK_TEX, 1, 1);
    g.destroy();
  }
}
