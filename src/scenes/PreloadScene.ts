import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, COLORS } from '../config';
import { ACTIVE_TILESET, dirtKey, playerFrameKey } from '../data/tileset';

/**
 * Loads assets and shows a simple loading bar. Trialling a first real-art pass (see
 * `src/data/tileset.ts` for the active pack, still eval-stage per docs/ASSETS.md) over the
 * placeholder rects, to see how it reads in motion before committing to a base tileset. Texture
 * keys loaded here are the pack-agnostic roles (`dirt0`, `wall`, `player-walk-0`, ...), not
 * pack-specific names — swapping `ACTIVE_TILESET` is the only change needed to trial a different
 * pack.
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

    const base = `${import.meta.env.BASE_URL}assets/tilesets/${ACTIVE_TILESET.id}/sprites`;
    ACTIVE_TILESET.tiles.dirt.forEach((variant, i) => this.load.image(dirtKey(i), `${base}/${variant.path}`));
    this.load.image('wall', `${base}/${ACTIVE_TILESET.tiles.wall}`);
    this.load.image('tree', `${base}/${ACTIVE_TILESET.tiles.tree}`);
    ACTIVE_TILESET.actors.player.forEach((relPath, i) => this.load.image(playerFrameKey(i), `${base}/${relPath}`));
  }

  create(): void {
    this.scene.start('MainMenu');
  }
}
