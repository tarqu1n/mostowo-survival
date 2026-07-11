import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, COLORS } from '../config';

/**
 * Loads assets and shows a simple loading bar. No real assets yet (placeholder-first art), so this
 * mostly exists to lock the pipeline in place — drop `this.load.*` calls here as assets arrive.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload(): void {
    const barWidth = BASE_WIDTH * 0.6;
    const barX = (BASE_WIDTH - barWidth) / 2;
    const barY = BASE_HEIGHT / 2;

    const border = this.add.rectangle(BASE_WIDTH / 2, barY, barWidth + 4, 16, COLORS.ui, 0.25);
    const bar = this.add.rectangle(barX, barY, 1, 12, COLORS.ui).setOrigin(0, 0.5);

    this.add
      .text(BASE_WIDTH / 2, barY - 24, 'Loading…', { fontFamily: 'monospace', fontSize: '12px', color: '#e8dcc0' })
      .setOrigin(0.5);

    this.load.on('progress', (p: number) => {
      bar.width = Math.max(1, barWidth * p);
    });
    this.load.once('complete', () => {
      border.destroy();
      bar.destroy();
    });

    // No assets to load yet — this keeps the loader from stalling on an empty queue.
    this.load.image('__noop', 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=');
  }

  create(): void {
    this.scene.start('MainMenu');
  }
}
