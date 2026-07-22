import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, COLORS, RENDER_SCALE } from './config';
import { installCrashReporter } from './debug/crashReporter';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { mountHud } from './hud/main';

// Install FIRST, before the game boots, so it catches boot/preload errors too. On-device overlay for
// uncaught errors — this game is usually tested on a phone with no reachable console (see the module).
installCrashReporter();

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
    // Backing store rendered at device density (RENDER_SCALE): FIT then upscales ~1:1 instead of by a
    // fractional factor, which is what put crawling seams on tile edges. The design space stays
    // BASE_WIDTH×BASE_HEIGHT — each scene's camera zoom absorbs the scale (see config RENDER_SCALE).
    width: BASE_WIDTH * RENDER_SCALE,
    height: BASE_HEIGHT * RENDER_SCALE,
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

// Mount the DOM/React HUD overlay (plan 046) after the game exists, so the bridge can find
// `window.game`. The overlay is page-level and persists across scene restarts.
mountHud();
