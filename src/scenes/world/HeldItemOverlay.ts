import Phaser from 'phaser';

/**
 * In-hand held-item overlay (plan 051 Step 5) — a single sprite pinned to the player's hand, moved and
 * flipped each frame to follow movement/facing. The first sliver of the deferred paper-doll (plan 010):
 * only the off-hand torch is wired today, but it's kept generic over its texture/offsets so a future
 * main-hand/off-hand held item could reuse it.
 *
 * This is the VISIBLE prop only — the raised light stays `GameScene.playerLight()`, driven off the same
 * off-hand read. Hidden by default; `sync()` places/reveals or hides it. The sprite has no physics body
 * and no input, so it never blocks taps or collides. Owned per-(re)start: constructed in `buildWorld`,
 * so a death `scene.restart()` destroys the old sprite with the display list and a fresh one is remade.
 */
export class HeldItemOverlay {
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly offsetX: number;
  private readonly offsetY: number;

  constructor(
    scene: Phaser.Scene,
    opts: { texture: string; depth: number; offsetX: number; offsetY: number; scale?: number },
  ) {
    this.offsetX = opts.offsetX;
    this.offsetY = opts.offsetY;
    this.sprite = scene.add
      .image(0, 0, opts.texture)
      .setDepth(opts.depth)
      .setScale(opts.scale ?? 1)
      .setVisible(false);
  }

  /**
   * Reveal + place the overlay at the player's hand, or hide it. `flipLeft` mirrors both the X offset
   * (so the prop sits in the correct hand) and the sprite itself when the player faces left. Anchor is
   * the player sprite's origin; the configured offsets raise it to hand height.
   */
  sync(show: boolean, playerX: number, playerY: number, flipLeft: boolean): void {
    if (!show) {
      this.sprite.setVisible(false);
      return;
    }
    const dx = flipLeft ? -this.offsetX : this.offsetX;
    this.sprite
      .setPosition(playerX + dx, playerY + this.offsetY)
      .setFlipX(flipLeft)
      .setVisible(true);
  }
}
