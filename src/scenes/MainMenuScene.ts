import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT } from '../config';

/**
 * Title screen. Tap anywhere to start — touch-native, no buttons to mis-hit on a phone.
 */
export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super('MainMenu');
  }

  create(): void {
    const cx = BASE_WIDTH / 2;

    this.add
      .text(cx, BASE_HEIGHT * 0.32, 'MOSTOWA', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#e8dcc0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(cx, BASE_HEIGHT * 0.32 + 40, 'SURVIVAL', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#9a8f74',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, BASE_HEIGHT * 0.5, 'the dead are up at Mostowa.', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#6f6552',
      })
      .setOrigin(0.5);

    const prompt = this.add
      .text(cx, BASE_HEIGHT * 0.72, 'tap to begin', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e8dcc0',
      })
      .setOrigin(0.5);

    this.tweens.add({ targets: prompt, alpha: 0.2, duration: 800, yoyo: true, repeat: -1 });

    this.input.once('pointerdown', () => this.scene.start('Game'));
  }
}
