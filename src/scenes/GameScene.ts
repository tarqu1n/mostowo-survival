import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, TILE_SIZE, COLORS } from '../config';

/**
 * Scaffold world scene. NOT real gameplay yet — it exists to prove the pipeline end-to-end:
 * pixel rendering, a tile grid, and touch controls (tap to move a placeholder "player").
 * The real day/night loop, gathering, building and defense land via the MVP plan.
 */
export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };
  private target = new Phaser.Math.Vector2();
  private readonly speed = 90;

  constructor() {
    super('Game');
  }

  create(): void {
    this.drawPlaceholderGround();

    // Placeholder player: a lantern-lit square you nudge around with taps.
    const p = this.add.rectangle(BASE_WIDTH / 2, BASE_HEIGHT / 2, TILE_SIZE - 2, TILE_SIZE - 2, COLORS.player);
    this.physics.add.existing(p);
    this.player = p as typeof this.player;
    this.player.body.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, BASE_WIDTH, BASE_HEIGHT);
    this.target.set(this.player.x, this.player.y);

    // Touch-native control: tap/drag anywhere to set a move target.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.target.set(pointer.worldX, pointer.worldY));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown) this.target.set(pointer.worldX, pointer.worldY);
    });

    this.buildHud();
  }

  override update(): void {
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.target.x, this.target.y);
    if (dist > 2) {
      this.physics.moveTo(this.player, this.target.x, this.target.y, this.speed);
    } else {
      this.player.body.reset(this.target.x, this.target.y);
    }
  }

  /** A simple checker of dirt/grass tiles so the world reads as a pixel grid. */
  private drawPlaceholderGround(): void {
    const g = this.add.graphics();
    for (let y = 0; y < BASE_HEIGHT; y += TILE_SIZE) {
      for (let x = 0; x < BASE_WIDTH; x += TILE_SIZE) {
        const grass = ((x / TILE_SIZE) + (y / TILE_SIZE)) % 2 === 0;
        g.fillStyle(grass ? COLORS.grass : COLORS.dirt, 1);
        g.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  private buildHud(): void {
    this.add
      .text(6, 6, 'Day 1 — camp', { fontFamily: 'monospace', fontSize: '11px', color: '#e8dcc0' })
      .setScrollFactor(0);
    this.add
      .text(6, BASE_HEIGHT - 16, 'scaffold · tap to move', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#6f6552',
      })
      .setScrollFactor(0);
  }
}
