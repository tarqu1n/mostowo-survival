import Phaser from 'phaser';
import { UI_THEME } from './theme';

export interface PanelConfig {
  width: number;
  height: number;
  fill?: number;
  fillAlpha?: number;
  stroke?: number;
  strokeAlpha?: number;
  /** Container depth — set above the always-on HUD so an open panel sits on top. */
  depth?: number;
  /** Tapping the panel background dismisses it (fires onDismiss). */
  dismissible?: boolean;
  onDismiss?: () => void;
}

/**
 * A content panel as a {@link Phaser.GameObjects.Container} (background rect + whatever rows you
 * add). Hidden by default — drive it with {@link Panel.show}/{@link Panel.hide}, which toggle the
 * container's own `visible`. Because visibility lives on the container, pushing a Panel into
 * `UIScene.hudElements` makes it a UI-tap region *only while open*, and reading `panel.visible`
 * reflects open/closed directly.
 *
 * Add labelled rows with {@link Panel.addText}; reach for the helpers in {@link ./layout} when a
 * panel grows into a grid/list of richer content (inventory, build palette).
 */
export class Panel extends Phaser.GameObjects.Container {
  readonly bg: Phaser.GameObjects.Rectangle;
  private readonly halfHeight: number;

  constructor(scene: Phaser.Scene, x: number, y: number, cfg: PanelConfig) {
    super(scene, x, y);
    this.halfHeight = cfg.height / 2;

    this.bg = scene.add
      .rectangle(
        0,
        0,
        cfg.width,
        cfg.height,
        cfg.fill ?? UI_THEME.panel.fill,
        cfg.fillAlpha ?? UI_THEME.panel.fillAlpha,
      )
      .setStrokeStyle(
        1,
        cfg.stroke ?? UI_THEME.panel.stroke,
        cfg.strokeAlpha ?? UI_THEME.panel.strokeAlpha,
      );
    this.add(this.bg);
    this.setSize(cfg.width, cfg.height);
    if (cfg.depth !== undefined) this.setDepth(cfg.depth);

    if (cfg.dismissible) {
      this.bg.setInteractive({ useHandCursor: true });
      if (cfg.onDismiss) this.bg.on('pointerdown', cfg.onDismiss);
    }

    this.setVisible(false);
    scene.add.existing(this);
  }

  /**
   * Add a text row `offsetY` px down from the panel's top edge. Horizontally centred; `originY`
   * controls vertical anchoring (0.5 = centre on the row, 0 = top-anchored, for multi-line blocks).
   * Returns the Text so callers can update it later with setText.
   */
  addText(
    offsetY: number,
    style: Phaser.Types.GameObjects.Text.TextStyle,
    originY = 0.5,
  ): Phaser.GameObjects.Text {
    const t = this.scene.add
      .text(0, -this.halfHeight + offsetY, '', { fontFamily: UI_THEME.font, ...style })
      .setOrigin(0.5, originY);
    this.add(t);
    return t;
  }

  show(): this {
    this.setVisible(true);
    return this;
  }

  hide(): this {
    this.setVisible(false);
    return this;
  }
}
