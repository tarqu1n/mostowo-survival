import Phaser from 'phaser';
import { registerHitFlashPipeline } from '../render/hitFlashPipeline';

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
    // Register the WebGL hit-flash PostFX once (no-op on Canvas). The pipeline registry outlives
    // GameScene death-restarts, so Boot is the right one-time home for it (see docs/RENDERING.md).
    registerHitFlashPipeline(this.game);
    this.scene.start('Preload');
  }
}
