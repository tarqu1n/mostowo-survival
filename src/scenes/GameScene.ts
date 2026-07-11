import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, TILE_SIZE, CHOP_INTERVAL_MS, LONGPRESS_MS, BUILD_MS, DRAG_PX, COLORS } from '../config';
import { NODES } from '../data/nodes';
import { BUILDABLES } from '../data/buildables';
import type { ResourceNodeDef } from '../data/types';
import { Inventory } from '../systems/Inventory';
import { worldToTile, tileToWorldCenter, snapToTileCenter, tileKey } from '../systems/grid';
import { findPath, reachableAdjacent, type Cell } from '../systems/pathfind';
import { TaskQueue, type Action } from '../systems/tasks';
import type { UIScene } from './UIScene';

/** A live/stump resource node instance in the world (placeholder rect + its data + state). */
interface TreeNode {
  id: string;
  rect: Phaser.GameObjects.Rectangle;
  def: ResourceNodeDef;
  hp: number;
  alive: boolean;
  col: number;
  row: number;
}

/** A placed-but-not-yet-built wall: a passable blueprint the worker builds on site over time. */
interface BuildSite {
  id: string;
  col: number;
  row: number;
  rect: Phaser.GameObjects.Rectangle;
  progress: number;
  done: boolean;
}

/**
 * World scene: the worker task system. The player unit pathfinds around obstacles (walls + live
 * trees), works through a queue of orders (tap = act now / clear; long-press = append), and builds
 * walls as timed on-site jobs (place a passable blueprint → worker walks over → works → solid wall).
 *
 * All pointer input flows through one gate: the HUD hit-region is ignored on BOTH down and up; build
 * placement resolves on `pointerdown`; move/harvest orders resolve on `pointerup` (long-press = queue).
 */
export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };
  private readonly speed = 90;

  private inv!: Inventory;
  private trees: TreeNode[] = [];
  private nextTreeId = 0;

  private readonly queue = new TaskQueue();
  private path: Cell[] = [];
  private pathIndex = 0;
  private actionGoal: Cell | null = null; // the tile we're currently pathing to (for re-pathing)
  private chopElapsed = 0;

  private buildMode = false;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private occupied = new Set<string>();
  private sites: BuildSite[] = [];
  private siteTiles = new Set<string>();
  private ghost!: Phaser.GameObjects.Rectangle;
  private nextSiteId = 0;

  private ui!: UIScene;
  private gridDims = { cols: Math.floor(BASE_WIDTH / TILE_SIZE), rows: Math.floor(BASE_HEIGHT / TILE_SIZE) };
  private downWorld = new Phaser.Math.Vector2();
  private downOnUI = false;
  private pressStart = 0; // scene-clock time of the current pointer press (for hold detection)
  private queuePainting = false; // once a hold crosses LONGPRESS_MS, dragging paints queue orders
  private paintedThisGesture = new Set<string>(); // tile keys already queued in the current gesture
  private queueMarkers: Phaser.GameObjects.Rectangle[] = []; // yellow pips over queued move tiles

  constructor() {
    super('Game');
  }

  create(): void {
    this.drawPlaceholderGround();

    // Shared character inventory — stored in the registry so the UIScene reads the same instance.
    this.inv = new Inventory();
    this.registry.set('inventory', this.inv);

    this.spawnTrees();

    // Placeholder player: a lantern-lit square you order around with taps.
    const p = this.add.rectangle(BASE_WIDTH / 2, BASE_HEIGHT / 2, TILE_SIZE - 2, TILE_SIZE - 2, COLORS.player);
    this.physics.add.existing(p);
    this.player = p as typeof this.player;
    this.player.setDepth(10);
    this.player.body.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, BASE_WIDTH, BASE_HEIGHT);

    // Walls: static bodies the player collides with (a backstop; pathing already avoids them).
    this.walls = this.physics.add.staticGroup();
    this.physics.add.collider(this.player, this.walls);

    // Build ghost — hidden until build mode; recoloured valid/invalid as it tracks the tapped tile.
    this.ghost = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, COLORS.ghostValid, 0.5).setVisible(false).setDepth(6);

    // HUD overlay runs alongside this scene; grab its instance for the UI-tap guard.
    this.scene.launch('UI');
    this.ui = this.scene.get('UI') as UIScene;

    // One unified pointer gate (down + up).
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);

    this.game.events.on('build:toggle', this.toggleBuild, this);
    this.game.events.on('tasks:cancel', this.cancelAll, this);
    this.game.events.on('debug:regenTrees', this.regenerateTrees, this); // TEMP: movement testing

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('build:toggle', this.toggleBuild, this);
      this.game.events.off('tasks:cancel', this.cancelAll, this);
      this.game.events.off('debug:regenTrees', this.regenerateTrees, this); // TEMP
    });

    this.buildHud();
    this.emitTasks();
  }

  override update(_time: number, delta: number): void {
    const action = this.queue.current;
    if (!action) {
      this.player.body.setVelocity(0, 0);
      return;
    }
    switch (action.kind) {
      case 'move':
        if (this.advancePath()) this.completeCurrent();
        break;
      case 'harvest':
        this.runHarvest(action, delta);
        break;
      case 'build':
        this.runBuild(action, delta);
        break;
    }
  }

  // --- Obstacle grid + path following -------------------------------------

  /** Walkability for the pathfinder: completed walls and live trees block; blueprints are passable. */
  private readonly isBlocked = (col: number, row: number): boolean =>
    this.occupied.has(tileKey(col, row)) || this.trees.some((t) => t.alive && t.col === col && t.row === row);

  private playerTile(): Cell {
    return { col: worldToTile(this.player.x), row: worldToTile(this.player.y) };
  }

  /** Path the worker toward `goal`; returns false if unreachable (`null` path). `[]` = already there. */
  private pathTo(goal: Cell): boolean {
    const path = findPath(this.playerTile(), goal, this.isBlocked, this.gridDims);
    if (path === null) return false;
    this.path = path;
    this.pathIndex = 0;
    this.actionGoal = goal;
    return true;
  }

  /** Step along the current path; returns true once the worker has reached the final waypoint. */
  private advancePath(): boolean {
    if (this.pathIndex >= this.path.length) {
      this.player.body.setVelocity(0, 0);
      return true;
    }
    const wp = this.path[this.pathIndex];
    const wx = tileToWorldCenter(wp.col);
    const wy = tileToWorldCenter(wp.row);
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, wx, wy) <= 2) {
      this.player.body.reset(wx, wy);
      this.pathIndex += 1;
      return this.pathIndex >= this.path.length;
    }
    this.physics.moveTo(this.player, wx, wy, this.speed);
    return false;
  }

  /** Recompute the path to the active goal after the world changed (wall built / tree regrew). */
  private repath(): void {
    if (!this.actionGoal || !this.queue.current) return;
    const path = findPath(this.playerTile(), this.actionGoal, this.isBlocked, this.gridDims);
    if (path === null) {
      this.completeCurrent(); // goal got walled off — drop it, don't stall
      return;
    }
    this.path = path;
    this.pathIndex = 0;
  }

  // --- Task queue lifecycle ------------------------------------------------

  /** Begin executing whatever is `current` — compute its path / stand tile, or skip if impossible. */
  private beginCurrent(): void {
    this.chopElapsed = 0;
    this.path = [];
    this.pathIndex = 0;
    this.actionGoal = null;
    const a = this.queue.current;
    if (!a) {
      this.player.body.setVelocity(0, 0);
      return;
    }
    if (a.kind === 'move') {
      if (!this.pathTo({ col: a.col, row: a.row })) this.completeCurrent();
      return;
    }
    if (a.kind === 'harvest') {
      const tree = this.treeById(a.treeId);
      if (!tree || !tree.alive) return this.completeCurrent();
      const stand = reachableAdjacent(this.playerTile(), { col: tree.col, row: tree.row }, this.isBlocked, this.gridDims);
      if (!stand || !this.pathTo(stand)) this.completeCurrent();
      return;
    }
    // build
    const site = this.siteById(a.siteId);
    if (!site || site.done) return this.completeCurrent();
    const stand = reachableAdjacent(this.playerTile(), { col: site.col, row: site.row }, this.isBlocked, this.gridDims);
    if (!stand || !this.pathTo(stand)) this.completeCurrent();
  }

  /** Finish the current action and advance to the next (or go idle), emitting a queue update. */
  private completeCurrent(): void {
    const next = this.queue.next();
    if (next) this.beginCurrent();
    else this.player.body.setVelocity(0, 0);
    this.emitTasks();
  }

  /** Replace the queue with a single act-now order. */
  private order(a: Action): void {
    this.queue.replace(a);
    this.beginCurrent();
    this.emitTasks();
  }

  /** Append an order; if the worker was idle, start it. */
  private enqueue(a: Action): void {
    const wasIdle = this.queue.current === null;
    this.queue.append(a);
    if (wasIdle) this.beginCurrent();
    this.emitTasks();
  }

  private cancelAll(): void {
    this.queue.clear();
    this.path = [];
    this.pathIndex = 0;
    this.actionGoal = null;
    this.player.body.setVelocity(0, 0);
    this.emitTasks();
  }

  private emitTasks(): void {
    this.refreshQueueHighlights();
    this.game.events.emit('tasks:changed', { current: this.queue.current?.kind ?? null, pending: this.queue.pending });
  }

  /** Outline every queued target in yellow (trees to harvest, sites to build) + pip queued move tiles. */
  private refreshQueueHighlights(): void {
    for (const t of this.trees) t.rect.isStroked = false;
    for (const s of this.sites) s.rect.isStroked = false;
    for (const m of this.queueMarkers) m.destroy();
    this.queueMarkers = [];

    for (const a of this.queue.all()) {
      if (a.kind === 'harvest') {
        const tree = this.treeById(a.treeId);
        if (tree?.alive) tree.rect.setStrokeStyle(2, COLORS.queued, 1);
      } else if (a.kind === 'build') {
        const site = this.siteById(a.siteId);
        if (site && !site.done) site.rect.setStrokeStyle(2, COLORS.queued, 1);
      } else {
        this.queueMarkers.push(
          this.add.rectangle(tileToWorldCenter(a.col), tileToWorldCenter(a.row), 6, 6, COLORS.queued, 0.85).setDepth(4),
        );
      }
    }
  }

  // --- Harvest / build executors ------------------------------------------

  private runHarvest(a: Extract<Action, { kind: 'harvest' }>, delta: number): void {
    const tree = this.treeById(a.treeId);
    if (!tree || !tree.alive) return this.completeCurrent();
    if (this.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.chopElapsed += delta;
      if (this.chopElapsed >= CHOP_INTERVAL_MS) {
        this.chopElapsed = 0;
        this.chop(tree);
      }
    }
  }

  private runBuild(a: Extract<Action, { kind: 'build' }>, delta: number): void {
    const site = this.siteById(a.siteId);
    if (!site || site.done) return this.completeCurrent();
    if (this.advancePath()) {
      this.player.body.setVelocity(0, 0);
      site.progress += delta;
      site.rect.setAlpha(0.35 + 0.55 * Math.min(1, site.progress / BUILD_MS));
      if (site.progress >= BUILD_MS) {
        this.finishSite(site);
        this.completeCurrent();
      }
    }
  }

  // --- Input gate ----------------------------------------------------------

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    this.downOnUI = this.ui.hudHitTest(pointer.x, pointer.y);
    if (this.downOnUI) return; // HUD owns this tap
    this.downWorld.set(pointer.worldX, pointer.worldY);
    this.pressStart = this.time.now;
    this.queuePainting = false;
    this.paintedThisGesture.clear();
    if (this.buildMode) {
      this.updateGhost(pointer);
      this.placeOrEnqueueBuild(pointer);
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.buildMode) {
      if (!this.ui.hudHitTest(pointer.x, pointer.y)) this.updateGhost(pointer);
      return;
    }
    if (!pointer.isDown || this.downOnUI || this.ui.hudHitTest(pointer.x, pointer.y)) return;
    // Once the press has been held past the long-press threshold, dragging paints queue orders —
    // hold and drag across trees / tiles to add several things to the queue in one gesture.
    if (!this.queuePainting && this.time.now - this.pressStart >= LONGPRESS_MS) this.queuePainting = true;
    if (this.queuePainting) this.paintQueueAt(pointer);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.buildMode || this.downOnUI || this.ui.hudHitTest(pointer.x, pointer.y)) return;
    if (this.queuePainting) {
      this.queuePainting = false; // the drag already queued its targets
      return;
    }
    // Reject drags/swipes — only deliberate taps become orders.
    if (Phaser.Math.Distance.Between(this.downWorld.x, this.downWorld.y, pointer.worldX, pointer.worldY) > DRAG_PX) return;

    const action = this.actionAt(pointer.worldX, pointer.worldY);
    if (pointer.getDuration() >= LONGPRESS_MS) this.enqueue(action); // held-still long-press = append one
    else this.order(action); // quick tap = act now
  }

  /** The order implied by a world point: harvest a live tree there, else move to that tile. */
  private actionAt(x: number, y: number): Action {
    const tree = this.treeAt(x, y);
    return tree ? { kind: 'harvest', treeId: tree.id } : { kind: 'move', col: worldToTile(x), row: worldToTile(y) };
  }

  /** Append the target under the pointer to the queue, once per tile per paint gesture. */
  private paintQueueAt(pointer: Phaser.Input.Pointer): void {
    const key = tileKey(worldToTile(pointer.worldX), worldToTile(pointer.worldY));
    if (this.paintedThisGesture.has(key)) return;
    this.paintedThisGesture.add(key);
    this.enqueue(this.actionAt(pointer.worldX, pointer.worldY));
  }

  // --- Trees / chopping ----------------------------------------------------

  private spawnTrees(): void {
    for (const [col, row] of [
      [5, 8],
      [14, 12],
      [8, 20],
    ] as Array<[number, number]>) {
      this.addTree(col, row);
    }
  }

  private addTree(col: number, row: number): void {
    const def = NODES.tree;
    const rect = this.add.rectangle(tileToWorldCenter(col), tileToWorldCenter(row), TILE_SIZE, TILE_SIZE, def.color).setDepth(1);
    this.trees.push({ id: `tree-${this.nextTreeId++}`, rect, def, hp: def.maxHp, alive: true, col, row });
  }

  /**
   * TEMP (movement testing): clear all trees and scatter a fresh random batch on empty tiles,
   * avoiding walls, blueprints, and the player's own tile. Wired to a debug HUD button.
   */
  private regenerateTrees(): void {
    this.cancelAll(); // drop harvest orders that reference the trees we're about to destroy
    for (const t of this.trees) t.rect.destroy();
    this.trees = [];

    const count = 6 + Math.floor(Math.random() * 9); // 6..14
    const pt = this.playerTile();
    const used = new Set<string>([tileKey(pt.col, pt.row)]);
    let placed = 0;
    for (let attempt = 0; placed < count && attempt < count * 30; attempt++) {
      const col = Math.floor(Math.random() * this.gridDims.cols);
      const row = Math.floor(Math.random() * this.gridDims.rows);
      const key = tileKey(col, row);
      if (used.has(key) || this.occupied.has(key) || this.siteTiles.has(key)) continue;
      used.add(key);
      this.addTree(col, row);
      placed += 1;
    }
  }

  private treeById(id: string): TreeNode | undefined {
    return this.trees.find((t) => t.id === id);
  }

  /** The live tree under a world point, if any (within ~one tile). */
  private treeAt(x: number, y: number): TreeNode | null {
    for (const tree of this.trees) {
      if (tree.alive && Phaser.Math.Distance.Between(x, y, tree.rect.x, tree.rect.y) <= TILE_SIZE) return tree;
    }
    return null;
  }

  private chop(tree: TreeNode): void {
    tree.hp -= 1;
    this.inv.add(tree.def.woodItemId, tree.def.woodPerHit);
    this.tweens.add({ targets: tree.rect, scale: 1.18, duration: 80, yoyo: true });
    if (tree.hp <= 0) {
      tree.alive = false;
      tree.rect.setScale(1).setFillStyle(tree.def.stumpColor);
      this.time.delayedCall(tree.def.regrowMs, () => {
        tree.hp = tree.def.maxHp;
        tree.alive = true;
        tree.rect.setFillStyle(tree.def.color);
        this.repath(); // regrown tree may now block the active route
      });
    }
  }

  // --- Building ------------------------------------------------------------

  private toggleBuild(): void {
    this.buildMode = !this.buildMode;
    if (!this.buildMode) this.ghost.setVisible(false);
    this.game.events.emit('build:modeChanged', this.buildMode);
  }

  private siteById(id: string): BuildSite | undefined {
    return this.sites.find((s) => s.id === id);
  }

  private siteAt(col: number, row: number): BuildSite | undefined {
    return this.sites.find((s) => !s.done && s.col === col && s.row === row);
  }

  /** True if a wall can be blueprinted here: in bounds, empty, off live trees, and reachable. */
  private tilePlaceable(col: number, row: number): boolean {
    const key = tileKey(col, row);
    if (col < 0 || row < 0 || col >= this.gridDims.cols || row >= this.gridDims.rows) return false;
    if (this.occupied.has(key) || this.siteTiles.has(key)) return false;
    if (this.trees.some((t) => t.alive && t.col === col && t.row === row)) return false;
    // Must have a tile the worker can stand on to build it (Finding 4 — no stranded blueprints).
    return reachableAdjacent(this.playerTile(), { col, row }, this.isBlocked, this.gridDims) !== null;
  }

  private updateGhost(pointer: Phaser.Input.Pointer): void {
    const col = worldToTile(pointer.worldX);
    const row = worldToTile(pointer.worldY);
    const ok = this.tilePlaceable(col, row) && this.inv.canAfford(BUILDABLES.wall.cost);
    this.ghost
      .setPosition(snapToTileCenter(pointer.worldX), snapToTileCenter(pointer.worldY))
      .setFillStyle(ok ? COLORS.ghostValid : COLORS.ghostInvalid, 0.5)
      .setVisible(true);
  }

  private placeOrEnqueueBuild(pointer: Phaser.Input.Pointer): void {
    const col = worldToTile(pointer.worldX);
    const row = worldToTile(pointer.worldY);

    // Tapping an existing un-built blueprint re-enqueues its build (Cancel is non-destructive).
    const existing = this.siteAt(col, row);
    if (existing) {
      this.enqueue({ kind: 'build', siteId: existing.id });
      return;
    }

    if (!this.tilePlaceable(col, row)) return;
    if (!this.inv.spend(BUILDABLES.wall.cost)) return; // unaffordable — no-op

    const key = tileKey(col, row);
    const rect = this.add
      .rectangle(tileToWorldCenter(col), tileToWorldCenter(row), TILE_SIZE, TILE_SIZE, COLORS.blueprint, 0.35)
      .setDepth(1);
    const site: BuildSite = { id: `site-${this.nextSiteId++}`, col, row, rect, progress: 0, done: false };
    this.sites.push(site);
    this.siteTiles.add(key);
    this.enqueue({ kind: 'build', siteId: site.id });
  }

  /** Complete a blueprint into a solid, blocking wall (materialises on the worker-vacated tile). */
  private finishSite(site: BuildSite): void {
    site.done = true;
    site.rect.setAlpha(1).setFillStyle(BUILDABLES.wall.color);
    this.walls.add(site.rect);
    const body = site.rect.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(TILE_SIZE, TILE_SIZE);
    body.updateFromGameObject();
    this.occupied.add(tileKey(site.col, site.row));
    this.repath();
  }

  // --- Debug (headless smoke test reads this) ------------------------------

  /** State snapshot for the smoke test. */
  debugState(): {
    currentKind: string | null;
    pending: number;
    pathLen: number;
    sites: number;
    buildMode: boolean;
    occupied: number;
    pcol: number;
    prow: number;
  } {
    const t = this.playerTile();
    return {
      currentKind: this.queue.current?.kind ?? null,
      pending: this.queue.pending,
      pathLen: Math.max(0, this.path.length - this.pathIndex),
      sites: this.sites.length,
      buildMode: this.buildMode,
      occupied: this.occupied.size,
      pcol: t.col,
      prow: t.row,
    };
  }

  /** True if the tile is currently a pathfinding obstacle (test helper). */
  isTileBlocked(col: number, row: number): boolean {
    return this.isBlocked(col, row);
  }

  // --- Rendering -----------------------------------------------------------

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
      .text(6, BASE_HEIGHT - 30, 'tap: order · hold: queue · Build: walls', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#6f6552',
      })
      .setScrollFactor(0);
  }
}
