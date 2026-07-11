import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, COLORS } from './config';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

/**
 * Phaser game bootstrap. Mobile-first, portrait, pixel-art, touch-native.
 * See docs/GAME-DESIGN.md (Platform & controls) and docs/DECISIONS.md.
 */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: COLORS.background,
  pixelArt: true, // nearest-neighbour scaling — crisp pixels
  scale: {
    mode: Phaser.Scale.FIT, // scale the fixed base canvas to fit any screen
    autoCenter: Phaser.Scale.Center.CENTER_BOTH,
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 }, // top-down world, no gravity
      debug: false,
    },
  },
  scene: [BootScene, PreloadScene, MainMenuScene, GameScene, UIScene],
};

// Expose the game instance for debugging + headless smoke tests (harmless in a solo browser game).
(window as unknown as { game: Phaser.Game }).game = new Phaser.Game(config);
