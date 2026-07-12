import Phaser from 'phaser';
import { UI_THEME, type ButtonVariant } from './theme';

export interface ButtonConfig {
  width: number;
  height: number;
  label: string;
  /** Label size in px. Defaults to the theme's button font size. */
  fontSize?: number;
  variant?: ButtonVariant;
  /** Background fill when toggled on (see {@link Button.setToggled}). Defaults to the theme's active fill. */
  activeFill?: number;
  /** Fired on pointerdown — matches the HUD's tap-to-emit-an-event convention. */
  onDown?: () => void;
}

/**
 * A touch-sized button as a self-contained {@link Phaser.GameObjects.Container} (background rect +
 * centred label). Replaces the repeated "add a rectangle, add a text on top, wire pointerdown, then
 * juggle fills/alphas by hand" pattern the HUD grew inline.
 *
 * Position (x, y) is the button's *centre*. Input lives on the background child, so dropping the
 * whole Button into `UIScene.hudElements` still works with the scene's getBounds()-based UI-tap
 * guard (see `UIScene.hudHitTest`) — a Container reports the union of its children's bounds.
 */
export class Button extends Phaser.GameObjects.Container {
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
  private readonly baseFill: number;
  private readonly activeFill: number;
  private toggled = false;

  constructor(scene: Phaser.Scene, x: number, y: number, cfg: ButtonConfig) {
    super(scene, x, y);

    const palette =
      cfg.variant === 'danger'
        ? UI_THEME.danger
        : cfg.variant === 'olive'
          ? UI_THEME.olive
          : UI_THEME.button;
    this.baseFill = palette.fill;
    this.activeFill = cfg.activeFill ?? UI_THEME.button.fillActive;

    this.bg = scene.add
      .rectangle(0, 0, cfg.width, cfg.height, palette.fill)
      .setStrokeStyle(1, palette.stroke, palette.strokeAlpha)
      .setInteractive({ useHandCursor: true });
    this.label = scene.add
      .text(0, 0, cfg.label, {
        fontFamily: UI_THEME.font,
        fontSize: `${cfg.fontSize ?? UI_THEME.button.fontSize}px`,
        color: palette.text,
      })
      .setOrigin(0.5);

    this.add([this.bg, this.label]);
    this.setSize(cfg.width, cfg.height);
    if (cfg.onDown) this.bg.on('pointerdown', cfg.onDown);
    scene.add.existing(this);
  }

  /** Highlight state (mode selected, follow-lock on, build mode active): swaps the background fill. */
  setToggled(on: boolean): this {
    this.toggled = on;
    this.bg.setFillStyle(on ? this.activeFill : this.baseFill);
    return this;
  }

  isToggled(): boolean {
    return this.toggled;
  }

  /** Dim the whole button (e.g. a zoom direction that's hit its clamp). Stays interactive. */
  setDimmed(dimmed: boolean): this {
    this.setAlpha(dimmed ? UI_THEME.disabledAlpha : 1);
    return this;
  }

  setLabel(text: string): this {
    this.label.setText(text);
    return this;
  }
}
