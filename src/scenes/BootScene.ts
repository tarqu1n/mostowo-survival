import Phaser from 'phaser';
import { registerOutlinePipeline } from '../render/OutlinePipeline';

/**
 * First scene. Reserved for one-time setup (input config, registry defaults) before any assets
 * load. Currently just hands off to the preloader.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    // Touch is the baseline input; allow more than one active pointer for future twin-stick/UI use.
    this.input.addPointer(2);
    // Register the outline PostFX pipeline once, before any scene attaches it. No-op on Canvas; the
    // registry persists across GameScene death-restarts, so this runs exactly once.
    registerOutlinePipeline(this.game);
    this.scene.start('Preload');
  }
}
