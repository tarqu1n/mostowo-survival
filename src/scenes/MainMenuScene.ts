import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, COLORS, RENDER_SCALE } from '../config';
import { bakeVignetteTexture } from '../render/vignetteTexture';
import { playerAnimKey } from '../data/tileset';

/**
 * Title screen. Tap anywhere to start — touch-native, no buttons to mis-hit on a phone.
 *
 * Theme is medieval-fantasy adventure (the active Pixel Crawler art — see docs/ASSETS.md), so the
 * copy stays evocative rather than zombie-specific. A lone idle adventurer + an edge vignette give
 * the bare text a bit of mood.
 */
export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super('MainMenu');
  }

  create(): void {
    // The backing store is BASE×RENDER_SCALE (rendered at device density to kill tile-edge seams —
    // see config RENDER_SCALE). Zoom this scene's camera by that factor and recentre it on the
    // design-space centre so everything authored in BASE_WIDTH×BASE_HEIGHT units fills the canvas at
    // device resolution instead of clustering tiny in the top-left. Mirrors UIScene.create.
    // (No-op at RENDER_SCALE 1.)
    if (RENDER_SCALE !== 1) {
      this.cameras.main.setZoom(RENDER_SCALE);
      this.cameras.main.centerOn(BASE_WIDTH / 2, BASE_HEIGHT / 2);
    }

    const cx = BASE_WIDTH / 2;

    // Backdrop: the same dark base tone as the game, so the fade into the loading→menu→game flow reads
    // as one continuous mood.
    this.add.rectangle(cx, BASE_HEIGHT / 2, BASE_WIDTH, BASE_HEIGHT, COLORS.background).setDepth(0);

    // Lone adventurer, idle. Native 64px frame drawn at integer scale 2 (pixel-art must stay integer —
    // see docs/RENDERING.md), feet-anchored so they stand on the tagline line.
    const heroKey = playerAnimKey('idle', 'down');
    const menuIdle = 'menu-hero-idle';
    if (this.textures.exists(heroKey) && !this.anims.exists(menuIdle)) {
      this.anims.create({
        key: menuIdle,
        frames: this.anims.generateFrameNumbers(heroKey, { start: 0, end: 3 }),
        frameRate: 6,
        repeat: -1,
      });
    }
    if (this.textures.exists(heroKey)) {
      const hero = this.add
        .sprite(cx, BASE_HEIGHT * 0.68, heroKey)
        .setOrigin(0.5, 0.78)
        .setScale(2)
        .setDepth(1);
      if (this.anims.exists(menuIdle)) hero.play(menuIdle);
    }

    // Edge vignette darkens the corners so the centre pops — same baked-once texture UIScene pulses on
    // hit, here just held static and dark.
    const vignetteKey = bakeVignetteTexture(this, 0x000000, BASE_WIDTH, BASE_HEIGHT);
    this.add
      .image(cx, BASE_HEIGHT / 2, vignetteKey)
      .setDisplaySize(BASE_WIDTH, BASE_HEIGHT)
      .setAlpha(0.6)
      .setDepth(2);

    const title = this.add
      .text(cx, BASE_HEIGHT * 0.22, 'MOSTOWO', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#e8dcc0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(3);
    title.setShadow(0, 3, '#000000', 6, false, true);

    this.add
      .text(cx, BASE_HEIGHT * 0.22 + 40, 'S U R V I V A L', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#9a8f74',
      })
      .setOrigin(0.5)
      .setDepth(3);

    this.add
      .text(cx, BASE_HEIGHT * 0.42, 'something stirs in the old woods', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#6f6552',
      })
      .setOrigin(0.5)
      .setDepth(3);

    const prompt = this.add
      .text(cx, BASE_HEIGHT * 0.88, 'tap to begin', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e8dcc0',
      })
      .setOrigin(0.5)
      .setDepth(3);

    this.tweens.add({ targets: prompt, alpha: 0.2, duration: 800, yoyo: true, repeat: -1 });

    this.input.once('pointerdown', () => this.scene.start('Game'));
  }
}
