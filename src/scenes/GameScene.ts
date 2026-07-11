import Phaser from 'phaser';
import {
  BASE_WIDTH,
  BASE_HEIGHT,
  TILE_SIZE,
  CHOP_INTERVAL_MS,
  LONGPRESS_MS,
  BUILD_MS,
  DRAG_PX,
  COLORS,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_ZOOM,
  ZOOM_STORAGE_KEY,
  VISION_RADIUS,
} from '../config';
import { NODES } from '../data/nodes';
import { BUILDABLES } from '../data/buildables';
import type { ResourceNodeDef } from '../data/types';
import { Inventory } from '../systems/Inventory';
import { worldToTile, tileToWorldCenter, snapToTileCenter, tileKey } from '../systems/grid';
import { findPath, reachableAdjacent, type Cell } from '../systems/pathfind';
import { TaskQueue, type Action } from '../systems/tasks';
import type { UIScene } from './UIScene';
import { ACTIVE_TILESET, dirtKey, playerFrameKey, pickWeighted } from '../data/tileset';

/** A live/stump resource node instance in the world (tree sprite + its data + state). */
interface TreeNode {
  id: string;
  sprite: Phaser.GameObjects.Image;
  def: ResourceNodeDef;
  hp: number;
  alive: boolean;
  col: number;
  row: number;
}

/**
 * A placed-but-not-yet-built wall: a passable blueprint the worker builds on site over time.
 * `rect` stays the physics/collision + blueprint-progress visual throughout; once built it's
 * hidden and `visual` (the wall sprite) is shown on top instead.
 */
interface BuildSite {
  id: string;
  col: number;
  row: number;
  rect: Phaser.GameObjects.Rectangle;
  visual: Phaser.GameObjects.Image | null;
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
  private player!: Phaser.GameObjects.Sprite & { body: Phaser.Physics.Arcade.Body };
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
  private downScreen = new Phaser.Math.Vector2(); // pointerdown position in screen/base-canvas px
  private downOnUI = false;
  private pressStart = 0; // scene-clock time of the current pointer press (for hold detection)
  private queuePainting = false; // once a hold crosses LONGPRESS_MS, dragging paints queue orders
  private paintedThisGesture = new Set<string>(); // tile keys already queued in the current gesture
  private queueMarkers: Phaser.GameObjects.Rectangle[] = []; // yellow pips over queued move tiles
  private pinching = false; // a second pointer went down — the gesture is a pinch-zoom, not a tap
  private pinchDist = 0; // previous frame's inter-pointer distance, for the zoom delta ratio
  private isPanning = false; // this gesture dragged the camera rather than issuing an order
  private lastPanX = 0; // previous frame's screen-space pointer position, for the pan delta
  private lastPanY = 0;
  private following = true; // camera auto-follows the player until a manual pan breaks the lock
  private fog!: Phaser.GameObjects.Rectangle;
  private fogShape!: Phaser.GameObjects.Graphics; // invisible — its shape is only a mask source

  constructor() {
    super('Game');
  }

  create(): void {
    this.drawGround();

    // Shared character inventory — stored in the registry so the UIScene reads the same instance.
    this.inv = new Inventory();
    this.registry.set('inventory', this.inv);

    this.spawnTrees();

    // The player you order around with taps — the pack's walk-cycle frames, idle on frame 0.
    if (!this.anims.exists('player-walk')) {
      this.anims.create({
        key: 'player-walk',
        frames: ACTIVE_TILESET.actors.player.map((_, i) => ({ key: playerFrameKey(i) })),
        frameRate: 10,
        repeat: -1,
      });
    }
    const p = this.add.sprite(BASE_WIDTH / 2, BASE_HEIGHT / 2, playerFrameKey(0));
    this.physics.add.existing(p);
    this.player = p as typeof this.player;
    this.player.setDepth(10);
    this.player.body.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, BASE_WIDTH, BASE_HEIGHT);

    // Camera follows the player once zoomed in (at MIN_ZOOM the viewport already covers the whole
    // map, so bounds leave no scroll room and this is a no-op — see config.ts). Instant (no lerp
    // smoothing): this is a precision tap-to-target game, so the camera should never lag behind
    // where the player actually is. centerOn avoids a visible pan-in from (0,0) on the first frame.
    // A manual drag breaks this lock (free look); the HUD's FOLLOW button re-engages it.
    this.cameras.main.setBounds(0, 0, BASE_WIDTH, BASE_HEIGHT);
    this.cameras.main.centerOn(this.player.x, this.player.y);
    this.registry.set('following', true);
    this.cameras.main.startFollow(this.player, true);
    this.setZoom(this.loadStoredZoom());

    // Fog of war: a full-map dark overlay with a hole (inverted geometry mask) tracking the
    // character's vision radius, redrawn each frame in update() as the character moves.
    this.fogShape = this.add.graphics().setVisible(false);
    this.fog = this.add.rectangle(BASE_WIDTH / 2, BASE_HEIGHT / 2, BASE_WIDTH, BASE_HEIGHT, 0x000000, 1).setDepth(50);
    const fogMask = this.fogShape.createGeometryMask();
    fogMask.setInvertAlpha(true);
    this.fog.setMask(fogMask);
    this.updateFog();

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
    this.game.events.on('zoom:delta', this.adjustZoom, this);
    this.game.events.on('camera:center', this.centerOnPlayer, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('build:toggle', this.toggleBuild, this);
      this.game.events.off('tasks:cancel', this.cancelAll, this);
      this.game.events.off('debug:regenTrees', this.regenerateTrees, this); // TEMP
      this.game.events.off('zoom:delta', this.adjustZoom, this);
      this.game.events.off('camera:center', this.centerOnPlayer, this);
    });

    this.emitTasks();
  }

  override update(_time: number, delta: number): void {
    const action = this.queue.current;
    if (!action) {
      this.player.body.setVelocity(0, 0);
      this.updatePlayerAnim();
      this.updateFog();
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
    this.updatePlayerAnim();
    this.updateFog();
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

  /** Walk-cycle while actually translating (moving between tiles); idle frame otherwise (e.g. chopping in place). */
  private updatePlayerAnim(): void {
    if (this.player.body.velocity.lengthSq() > 1) {
      this.player.anims.play('player-walk', true);
    } else {
      this.player.anims.stop();
      this.player.setTexture(playerFrameKey(0));
    }
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
    for (const s of this.sites) s.rect.isStroked = false;
    for (const m of this.queueMarkers) m.destroy();
    this.queueMarkers = [];

    for (const a of this.queue.all()) {
      if (a.kind === 'harvest') {
        const tree = this.treeById(a.treeId);
        // Trees are sprites now (not Rectangles, see docs/ASSETS.md) — can't be stroked directly,
        // so outline with a stroke-only marker rect over the tile instead.
        if (tree?.alive) {
          this.queueMarkers.push(
            this.add
              .rectangle(tree.sprite.x, tree.sprite.y, TILE_SIZE, TILE_SIZE, 0, 0)
              .setStrokeStyle(2, COLORS.queued, 1)
              .setDepth(4),
          );
        }
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
    if (this.activePointerCount() >= 2) {
      // A second finger just landed — this gesture is a pinch, not a tap. Abandon anything the
      // first finger started (build ghost / queue-paint / pan) so they don't fight over the input.
      this.pinching = true;
      this.pinchDist = this.pointerDistance();
      this.queuePainting = false;
      this.isPanning = false;
      return;
    }
    this.downOnUI = this.ui.hudHitTest(pointer.x, pointer.y);
    if (this.downOnUI) return; // HUD owns this tap
    this.downScreen.set(pointer.x, pointer.y);
    this.lastPanX = pointer.x;
    this.lastPanY = pointer.y;
    this.isPanning = false;
    this.pressStart = this.time.now;
    this.queuePainting = false;
    this.paintedThisGesture.clear();
    if (this.buildMode) {
      this.updateGhost(pointer);
      this.placeOrEnqueueBuild(pointer);
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.pinching) {
      if (this.activePointerCount() < 2) return; // one finger already lifted — wait for pointerup
      const dist = this.pointerDistance();
      if (this.pinchDist > 0) this.setZoom(this.cameras.main.zoom * (dist / this.pinchDist));
      this.pinchDist = dist;
      return;
    }
    if (this.buildMode) {
      if (!this.ui.hudHitTest(pointer.x, pointer.y)) this.updateGhost(pointer);
      return;
    }
    if (!pointer.isDown || this.downOnUI || this.ui.hudHitTest(pointer.x, pointer.y)) return;

    if (this.queuePainting) {
      this.paintQueueAt(pointer);
      return;
    }
    // A press held roughly still past the long-press threshold enters queue-paint mode (unchanged
    // behaviour); a press that starts dragging *first* pans the camera instead — see onPointerUp.
    if (!this.isPanning && this.time.now - this.pressStart >= LONGPRESS_MS) {
      this.queuePainting = true;
      this.paintQueueAt(pointer);
      return;
    }

    if (!this.isPanning && Phaser.Math.Distance.Between(this.downScreen.x, this.downScreen.y, pointer.x, pointer.y) > DRAG_PX) {
      this.isPanning = true;
      this.setFollowing(false); // manual pan always breaks the follow-lock
    }
    if (this.isPanning) {
      const cam = this.cameras.main;
      cam.scrollX -= (pointer.x - this.lastPanX) / cam.zoom;
      cam.scrollY -= (pointer.y - this.lastPanY) / cam.zoom;
    }
    this.lastPanX = pointer.x;
    this.lastPanY = pointer.y;
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.pinching) {
      if (this.activePointerCount() < 2) this.pinching = false; // both fingers up — gesture over
      return; // a pinch never resolves as a tap, however many fingers are still down
    }
    if (this.buildMode || this.downOnUI || this.ui.hudHitTest(pointer.x, pointer.y)) return;
    if (this.queuePainting) {
      this.queuePainting = false; // the drag already queued its targets
      return;
    }
    if (this.isPanning) {
      this.isPanning = false; // the drag panned the camera — never resolves as a tap
      return;
    }

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
    const sprite = this.add.image(tileToWorldCenter(col), tileToWorldCenter(row), 'tree').setDepth(1);
    this.trees.push({ id: `tree-${this.nextTreeId++}`, sprite, def, hp: def.maxHp, alive: true, col, row });
  }

  /**
   * TEMP (movement testing): clear all trees and scatter a fresh random batch on empty tiles,
   * avoiding walls, blueprints, and the player's own tile. Wired to a debug HUD button.
   */
  private regenerateTrees(): void {
    this.cancelAll(); // drop harvest orders that reference the trees we're about to destroy
    for (const t of this.trees) t.sprite.destroy();
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
      if (tree.alive && Phaser.Math.Distance.Between(x, y, tree.sprite.x, tree.sprite.y) <= TILE_SIZE) return tree;
    }
    return null;
  }

  private chop(tree: TreeNode): void {
    tree.hp -= 1;
    this.inv.add(tree.def.woodItemId, tree.def.woodPerHit);
    this.tweens.add({ targets: tree.sprite, scale: 1.18, duration: 80, yoyo: true });
    if (tree.hp <= 0) {
      tree.alive = false;
      // No dedicated stump sprite in the pack yet (see docs/ASSETS.md) — tint the felled tree
      // brown as a stand-in "stump" state rather than mixing in a mismatched placeholder rect.
      tree.sprite.setScale(1).setTint(tree.def.stumpColor);
      this.time.delayedCall(tree.def.regrowMs, () => {
        tree.hp = tree.def.maxHp;
        tree.alive = true;
        tree.sprite.clearTint();
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
    const site: BuildSite = { id: `site-${this.nextSiteId++}`, col, row, rect, visual: null, progress: 0, done: false };
    this.sites.push(site);
    this.siteTiles.add(key);
    this.enqueue({ kind: 'build', siteId: site.id });
  }

  /** Complete a blueprint into a solid, blocking wall (materialises on the worker-vacated tile). */
  private finishSite(site: BuildSite): void {
    site.done = true;
    // Physics body stays on the (now-hidden) rect; the pack's wall sprite renders on top of it.
    site.rect.setAlpha(0);
    site.visual = this.add.image(site.rect.x, site.rect.y, 'wall').setDepth(1);
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

  /**
   * Ground pass using the active pack's dirt variants (still eval-stage, see docs/ASSETS.md) —
   * weighted-random per tile so the common plain variants dominate and the rarer debris variants
   * just sprinkle in, instead of either a flat placeholder or an obvious repeating checkerboard.
   */
  private drawGround(): void {
    const dirtVariants = ACTIVE_TILESET.tiles.dirt.map((variant, i) => ({ ...variant, key: dirtKey(i) }));
    for (let row = 0; row * TILE_SIZE < BASE_HEIGHT; row++) {
      for (let col = 0; col * TILE_SIZE < BASE_WIDTH; col++) {
        this.add.image(tileToWorldCenter(col), tileToWorldCenter(row), pickWeighted(dirtVariants).key).setDepth(0);
      }
    }
  }

  // --- Camera zoom -----------------------------------------------------------

  /** Best-effort read of a persisted zoom preference; falls back to the default. */
  private loadStoredZoom(): number {
    try {
      const stored = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
      if (stored) return stored;
    } catch {
      // Private browsing / storage disabled — fall back silently.
    }
    return DEFAULT_ZOOM;
  }

  /** Apply + persist a zoom level, clamped to [MIN_ZOOM, MAX_ZOOM]. Also mirrored onto the
   * registry (for UIScene's initial readout — see UIScene.create) and broadcast for live updates. */
  private setZoom(z: number): void {
    const clamped = Phaser.Math.Clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.cameras.main.setZoom(clamped);
    this.registry.set('zoom', clamped);
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped));
    } catch {
      // Private browsing / storage disabled — the zoom still applies, just won't persist.
    }
    this.game.events.emit('zoom:changed', clamped);
  }

  private adjustZoom(delta: number): void {
    this.setZoom(this.cameras.main.zoom + delta);
  }

  // --- Camera pan / follow-lock -----------------------------------------------

  /** Engage/disengage camera auto-follow. Mirrored onto the registry (UIScene's initial button
   * colour) and broadcast for live updates, matching the zoom-state pattern above. */
  private setFollowing(on: boolean): void {
    if (this.following === on) return;
    this.following = on;
    this.registry.set('following', on);
    if (on) {
      this.cameras.main.startFollow(this.player, true);
      this.cameras.main.centerOn(this.player.x, this.player.y);
    } else {
      this.cameras.main.stopFollow();
    }
    this.game.events.emit('camera:followChanged', on);
  }

  /** HUD "FOLLOW" button: snap back to the player and re-engage the follow-lock. */
  private centerOnPlayer(): void {
    this.setFollowing(true);
  }

  /** Redraw the vision-radius mask shape at the character's current position. */
  private updateFog(): void {
    this.fogShape.clear();
    this.fogShape.fillStyle(0xffffff);
    this.fogShape.fillCircle(this.player.x, this.player.y, VISION_RADIUS);
  }

  /** How many of the tracked pointers (see BootScene's addPointer) are currently held down. */
  private activePointerCount(): number {
    return [this.input.pointer1, this.input.pointer2].filter((p) => p.isDown).length;
  }

  private pointerDistance(): number {
    return Phaser.Math.Distance.Between(
      this.input.pointer1.x,
      this.input.pointer1.y,
      this.input.pointer2.x,
      this.input.pointer2.y,
    );
  }
}
