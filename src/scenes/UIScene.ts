import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, RENDER_SCALE } from '../config';
import type { HudElement } from './hud/types';

/**
 * HUD overlay, run in parallel over GameScene (never replaces it). UI is decoupled from world logic:
 * it talks to GameScene only over `this.game.events`.
 *
 * Migration (plan 046): every Phaser HUD widget has now been ported to the DOM/React HUD (`src/hud/`).
 * The always-on bars + top-centre stack + vignettes went at Step 9; the build/combat/mode controls at
 * Step 10; the Wellbeing panel + Inventory widget + build palette at Step 11; and the last three —
 * Inspect, Dev, NPC-assign — at Step 12. What remains here is the vestigial world-tap arbitration
 * (`hudHitTest`, now over an empty element list since no Phaser widget registers one) and the ESC
 * guard-cancel; both are retired and this whole scene is deleted at the Step 13 cutover.
 *
 * Cross-scene input arbitration: GameScene's world tap handler ignores pointers inside the HUD
 * hit-region ({@link hudHitTest}) so tapping a button never also moves/chops/places underneath.
 */
export class UIScene extends Phaser.Scene {
  /** Interactive HUD elements GameScene must treat as UI, not world. Empty since Step 12 (all HUD
   * controls are DOM now, gating taps via `pointer-events`); retired with `hudHitTest` at Step 13. */
  private hudElements: HudElement[] = [];

  constructor() {
    super('UI');
  }

  create(): void {
    // The backing store is BASE×RENDER_SCALE (rendered at device density to kill tile-edge seams —
    // see config RENDER_SCALE). Zoom the HUD camera by that factor and recentre it on the design-space
    // midpoint, so every widget below stays authored in plain BASE_WIDTH×BASE_HEIGHT units yet renders
    // crisply at device resolution. (No-op at RENDER_SCALE 1.)
    if (RENDER_SCALE !== 1) {
      this.cameras.main.setZoom(RENDER_SCALE);
      this.cameras.main.centerOn(BASE_WIDTH / 2, BASE_HEIGHT / 2);
    }

    // ESC bails out of any armed guard-point placement in GameScene (a harmless no-op when nothing is
    // armed) — the companion menu's documented Escape cancel (plan 042 Step 9). The DOM CompanionMenu
    // (a Radix sheet) handles its own Escape-to-close, so this only needs the world-side cancel.
    // Keyboard is scene-scoped, so Phaser tears this listener down on scene shutdown.
    this.input.keyboard?.on('keydown-ESC', this.onEscape, this);
  }

  /** True if (x, y) in game coords lands on a *visible* interactive HUD element. Always false since
   * Step 12 (no Phaser widget registers one); kept until the Step 13 input-path retirement. */
  hudHitTest(x: number, y: number): boolean {
    return this.hudElements.some((el) => el.visible && el.getBounds().contains(x, y));
  }

  /** ESC: bail out of any armed guard-point placement in GameScene (a harmless no-op when nothing is
   *  armed) — the assignment menu's documented Escape cancel (plan 042 Step 9). */
  private onEscape(): void {
    this.game.events.emit('npc:cancelPlaceGuard');
  }
}
