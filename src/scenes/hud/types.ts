import type Phaser from 'phaser';

/**
 * The GameObject kinds the HUD registers as interactive UI (see `UIScene.hudElements` /
 * `UIScene.hudHitTest`): kit widgets are Containers, plus the bespoke movepad Arc, indicator Texts,
 * and scrim Rectangles. Widget modules push their interactive elements back to UIScene through the
 * shared `addHudElement` closure so the single hit-region list stays authoritative.
 */
export type HudElement =
  | Phaser.GameObjects.Container
  | Phaser.GameObjects.Text
  | Phaser.GameObjects.Arc
  | Phaser.GameObjects.Rectangle;
