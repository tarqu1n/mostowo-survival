import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, TILE_SIZE, INTERACT_RANGE, CHOP_INTERVAL_MS, COLORS } from '../config';
import { NODES } from '../data/nodes';
import { BUILDABLES } from '../data/buildables';
import type { ResourceNodeDef } from '../data/types';
import { Inventory } from '../systems/Inventory';
import { worldToTile, tileToWorldCenter, snapToTileCenter, tileKey } from '../systems/grid';
import type { UIScene } from './UIScene';

/** A live/stump resource node instance in the world (placeholder rectangle + its data + state). */
interface TreeNode {
  rect: Phaser.GameObjects.Rectangle;
  def: ResourceNodeDef;
  hp: number;
  alive: boolean;
  col: number;
  row: number;
}

/**
 * World scene: the core loop slice — tap a tree to walk over and chop it for wood, tap the ground
 * to move, and (in build mode) tap a tile to place a wall that blocks movement.
 *
 * All pointer handling flows through ONE intent gate ({@link onPointerDown}/{@link onPointerMove})
 * so build-mode taps, chop taps, and moves never leak into each other, and HUD taps (the Build
 * button) are ignored here — the UIScene owns those.
 */
export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };
  private target = new Phaser.Math.Vector2();
  private readonly speed = 90;

  private inv!: Inventory;
  private trees: TreeNode[] = [];
  private pendingChop: TreeNode | null = null;
  private chopElapsed = 0;

  private buildMode = false;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private occupied = new Set<string>();
  private ghost!: Phaser.GameObjects.Rectangle;

  private ui!: UIScene;

  constructor() {
    super('Game');
  }

  create(): void {
    this.drawPlaceholderGround();

    // Shared character inventory — stored in the registry so the UIScene reads the same instance.
    this.inv = new Inventory();
    this.registry.set('inventory', this.inv);

    this.spawnTrees();

    // Placeholder player: a lantern-lit square you nudge around with taps.
    const p = this.add.rectangle(BASE_WIDTH / 2, BASE_HEIGHT / 2, TILE_SIZE - 2, TILE_SIZE - 2, COLORS.player);
    this.physics.add.existing(p);
    this.player = p as typeof this.player;
    this.player.body.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, BASE_WIDTH, BASE_HEIGHT);
    this.target.set(this.player.x, this.player.y);

    // Walls: static bodies the player collides with.
    this.walls = this.physics.add.staticGroup();
    this.physics.add.collider(this.player, this.walls);

    // Build ghost — hidden until build mode; recoloured valid/invalid as it tracks the tapped tile.
    this.ghost = this.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE, COLORS.ghostValid, 0.5)
      .setVisible(false)
      .setDepth(5);

    // HUD overlay runs alongside this scene; grab its instance for the UI-tap guard.
    this.scene.launch('UI');
    this.ui = this.scene.get('UI') as UIScene;

    // Single intent gate for all pointer input (Finding 1 & 2).
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);

    this.game.events.on('build:toggle', this.toggleBuild, this);

    // Teardown bus listeners so a scene restart doesn't double-register.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('build:toggle', this.toggleBuild, this);
    });

    this.buildHud();
  }

  override update(_time: number, delta: number): void {
    // Chop routine takes priority: approach the target tree, then hit it on an interval.
    if (this.pendingChop) {
      const tree = this.pendingChop;
      if (!tree.alive) {
        this.pendingChop = null;
      } else {
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, tree.rect.x, tree.rect.y);
        if (dist <= INTERACT_RANGE) {
          this.player.body.setVelocity(0, 0);
          this.chopElapsed += delta;
          if (this.chopElapsed >= CHOP_INTERVAL_MS) {
            this.chopElapsed = 0;
            this.chop(tree);
          }
        } else {
          this.chopElapsed = 0;
          this.physics.moveTo(this.player, tree.rect.x, tree.rect.y, this.speed);
        }
        return;
      }
    }

    // Plain tap-to-move.
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.target.x, this.target.y);
    if (dist > 2) {
      this.physics.moveTo(this.player, this.target.x, this.target.y, this.speed);
    } else {
      this.player.body.reset(this.target.x, this.target.y);
    }
  }

  // --- Input routing -------------------------------------------------------

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.ui.hudHitTest(pointer.x, pointer.y)) return; // tap landed on the HUD — leave it to the UI

    if (this.buildMode) {
      this.updateGhost(pointer);
      this.tryPlaceWall(pointer);
      return;
    }

    const tree = this.treeAt(pointer.worldX, pointer.worldY);
    if (tree) {
      this.pendingChop = tree;
      this.chopElapsed = 0;
      return;
    }

    // Otherwise it's a move: cancel any pending chop and set a new destination.
    this.pendingChop = null;
    this.target.set(pointer.worldX, pointer.worldY);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.ui.hudHitTest(pointer.x, pointer.y)) return;
    if (this.buildMode) {
      this.updateGhost(pointer);
      return;
    }
    // Drag-to-move only while genuinely moving (not mid-chop) so a drag can't hijack a chop approach.
    if (pointer.isDown && !this.pendingChop) {
      this.target.set(pointer.worldX, pointer.worldY);
    }
  }

  // --- Chopping ------------------------------------------------------------

  private spawnTrees(): void {
    const def = NODES.tree;
    // Fixed spawns, snapped to tile centres so build occupancy/overlap tests are exact.
    const tiles: Array<[number, number]> = [
      [5, 8],
      [14, 12],
      [8, 20],
    ];
    for (const [col, row] of tiles) {
      const x = tileToWorldCenter(col);
      const y = tileToWorldCenter(row);
      const rect = this.add.rectangle(x, y, TILE_SIZE, TILE_SIZE, def.color);
      this.trees.push({ rect, def, hp: def.maxHp, alive: true, col, row });
    }
  }

  /** The live tree under a world point, if any (within ~one tile). */
  private treeAt(x: number, y: number): TreeNode | null {
    for (const tree of this.trees) {
      if (!tree.alive) continue;
      if (Phaser.Math.Distance.Between(x, y, tree.rect.x, tree.rect.y) <= TILE_SIZE) return tree;
    }
    return null;
  }

  private chop(tree: TreeNode): void {
    tree.hp -= 1;
    this.inv.add(tree.def.woodItemId, tree.def.woodPerHit);
    // Visual tick: a quick scale pop so a hit reads.
    this.tweens.add({ targets: tree.rect, scale: 1.18, duration: 80, yoyo: true });

    if (tree.hp <= 0) {
      tree.alive = false;
      tree.rect.setScale(1).setFillStyle(tree.def.stumpColor);
      this.pendingChop = null;
      this.target.set(this.player.x, this.player.y); // stay put — don't drift back to a stale target
      this.player.body.reset(this.player.x, this.player.y);
      this.time.delayedCall(tree.def.regrowMs, () => {
        tree.hp = tree.def.maxHp;
        tree.alive = true;
        tree.rect.setFillStyle(tree.def.color);
      });
    }
  }

  // --- Building ------------------------------------------------------------

  private toggleBuild(): void {
    this.buildMode = !this.buildMode;
    if (this.buildMode) {
      this.pendingChop = null; // don't keep chopping while placing
    } else {
      this.ghost.setVisible(false);
    }
    this.game.events.emit('build:modeChanged', this.buildMode);
  }

  /** Can a wall go on this tile? (In bounds, not occupied, not on a live tree.) */
  private tilePlaceable(col: number, row: number, key: string): boolean {
    const cols = Math.floor(BASE_WIDTH / TILE_SIZE);
    const rows = Math.floor(BASE_HEIGHT / TILE_SIZE);
    if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
    if (this.occupied.has(key)) return false;
    if (this.trees.some((t) => t.alive && t.col === col && t.row === row)) return false;
    return true;
  }

  private updateGhost(pointer: Phaser.Input.Pointer): void {
    const col = worldToTile(pointer.worldX);
    const row = worldToTile(pointer.worldY);
    const key = tileKey(col, row);
    const ok = this.tilePlaceable(col, row, key) && this.inv.canAfford(BUILDABLES.wall.cost);
    this.ghost
      .setPosition(snapToTileCenter(pointer.worldX), snapToTileCenter(pointer.worldY))
      .setFillStyle(ok ? COLORS.ghostValid : COLORS.ghostInvalid, 0.5)
      .setVisible(true);
  }

  private tryPlaceWall(pointer: Phaser.Input.Pointer): void {
    const col = worldToTile(pointer.worldX);
    const row = worldToTile(pointer.worldY);
    const key = tileKey(col, row);
    if (!this.tilePlaceable(col, row, key)) return;
    if (!this.inv.spend(BUILDABLES.wall.cost)) return; // unaffordable — no-op

    const x = tileToWorldCenter(col);
    const y = tileToWorldCenter(row);
    const wall = this.add.rectangle(x, y, TILE_SIZE, TILE_SIZE, BUILDABLES.wall.color);
    this.walls.add(wall);
    const body = wall.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(TILE_SIZE, TILE_SIZE);
    body.updateFromGameObject();
    this.occupied.add(key);
  }

  // --- Rendering -----------------------------------------------------------

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
      .text(6, BASE_HEIGHT - 30, 'tap tree: chop · tap ground: move · Build: walls', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#6f6552',
      })
      .setScrollFactor(0);
  }
}
