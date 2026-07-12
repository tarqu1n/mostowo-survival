import Phaser from 'phaser';
import {
  BASE_WIDTH,
  BASE_HEIGHT,
  TILE_SIZE,
  CHOP_INTERVAL_MS,
  ACTION_ANIM_FRAMERATE,
  LONGPRESS_MS,
  BUILD_MS,
  DRAG_PX,
  COLORS,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_ZOOM,
  ZOOM_STORAGE_KEY,
  PLAYER_MAX_HP,
  PLAYER_START_SPEED,
  PLAYER_START_VISION,
  UNARMED_BASE_DAMAGE,
  CONTACT_DAMAGE_COOLDOWN_MS,
} from '../config';
import { NODES } from '../data/nodes';
import { BUILDABLES } from '../data/buildables';
import { ENEMIES } from '../data/enemies';
import type { ResourceNodeDef, CombatantStats, EnemyDef } from '../data/types';
import { Inventory } from '../systems/Inventory';
import { worldToTile, tileToWorldCenter, snapToTileCenter, tileKey } from '../systems/grid';
import { findPath, reachableAdjacent, type Cell } from '../systems/pathfind';
import { TaskQueue, type Action } from '../systems/tasks';
import { resolveMeleeAttack } from '../systems/combat';
import { bakeGlowTexture } from '../render/glowTexture';
import { treeStats, wallStats, zombieStats } from '../systems/stats';
import type { UIScene } from './UIScene';
import {
  ACTIVE_TILESET,
  resolveTile,
  playerAnimKey,
  enemyWalkKey,
  pickWeighted,
  type Facing,
  type PlayerState,
  type ActorRender,
} from '../data/tileset';

/** Height (in tiles) the tree image is scaled to stand — big pine on a 16px tile, canopy overhangs up. */
const TREE_TILES_TALL = 2.6;

/** Queued-tree glow reach on screen (px). Converted to source texels per species so the baked halo
 *  reads the same regardless of a sprite's source resolution — see refreshQueueHighlights. */
const GLOW_SCREEN_PX = 5;

/**
 * Neighbour offsets the worker may stand on to chop a tree: the trunk row (sides) and the row below,
 * but NOT the three tiles directly above (dr === -1). A pine overhangs ~2 tiles upward yet only
 * blocks its trunk tile, so an "above" stand tile sits inside the canopy and — with the player drawn
 * on top — reads as chopping halfway up the tree. Restricting to the base keeps the worker rooted at
 * the trunk. Falls back to any adjacent tile if the base is walled off (see beginCurrent).
 */
const TREE_BASE_STAND_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
];

/** A live/stump resource node instance in the world (tree sprite + its data + state). */
export interface TreeNode {
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
export interface BuildSite {
  id: string;
  col: number;
  row: number;
  rect: Phaser.GameObjects.Rectangle;
  visual: Phaser.GameObjects.Image | null;
  progress: number;
  done: boolean;
}

/** A live enemy instance in the world — minimal idle/chasing AI (see plan 003). */
export interface ZombieUnit {
  id: string;
  sprite: Phaser.GameObjects.Sprite & { body: Phaser.Physics.Arcade.Body };
  def: EnemyDef;
  hp: number;
  alive: boolean;
  col: number;
  row: number;
  state: 'idle' | 'chasing';
  lastContactAt: number;
  lastRepathAt: number;
  path: Cell[];
  pathIndex: number;
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

  // Combat: stats bag + separate runtime HP (mirrors the def/runtime-hp split used for trees),
  // facing (for Punch — see Step 5/6), reset in create() so a death-restart starts fresh.
  private playerStats!: CombatantStats;
  private playerHp = 0;
  private lastFacing = { dCol: 0, dRow: 1 };

  // Input mode: Command (default tap-to-pathfind, unchanged), Combat (movepad drives the player
  // directly, bypassing the pathfinder), Inspect (tap shows a stats panel — Step 7). Mutually
  // exclusive; UIScene mirrors this for HUD highlighting/visibility via 'mode:changed'.
  private mode: 'command' | 'combat' | 'inspect' = 'command';

  private inv!: Inventory;
  private trees: TreeNode[] = [];
  private nextTreeId = 0;
  private zombies: ZombieUnit[] = [];
  private nextZombieId = 0;

  private readonly queue = new TaskQueue();
  private path: Cell[] = [];
  private pathIndex = 0;
  private actionGoal: Cell | null = null; // the tile we're currently pathing to (for re-pathing)
  private chopElapsed = 0;
  // Action-swing anim state: `chopping` is set true each frame the worker is felling in place
  // (drives the looping chop swing); `punchLockUntil` is the scene-clock time until which the
  // one-shot punch swing owns the sprite (updatePlayerAnim yields to it — see punch()).
  private chopping = false;
  private punchLockUntil = 0;

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
  private outlinedTreeIds = new Set<string>(); // trees currently showing a queued-glow sprite
  private glowSprites = new Map<string, Phaser.GameObjects.Image>(); // treeId → its baked glow halo image
  private glowPulse?: Phaser.Tweens.Tween; // breathing alpha tween on the head-of-queue glow
  private pinching = false; // a second pointer went down — the gesture is a pinch-zoom, not a tap
  private pinchDist = 0; // previous frame's inter-pointer distance, for the zoom delta ratio
  private isPanning = false; // this gesture dragged the camera rather than issuing an order
  private lastPanX = 0; // previous frame's screen-space pointer position, for the pan delta
  private lastPanY = 0;
  private following = true; // camera auto-follows the player until a manual pan breaks the lock
  // Fog of war (see create() + updateVision()) — fogShape is never rendered directly, just the
  // vision-radius mask's shape source, redrawn each frame to track the character.
  private fogShape!: Phaser.GameObjects.Graphics;

  constructor() {
    super('Game');
  }

  create(): void {
    // Reset all mutable world/queue state — create() reruns on a death-restart (see
    // damagePlayer()), and Phaser reuses this same Scene instance rather than reconstructing it,
    // so plain-data fields (unlike this.add.*-owned GameObjects, which the scene teardown already
    // destroys) need an explicit reset here or they'd accumulate across restarts.
    this.queue.clear();
    this.trees = [];
    this.nextTreeId = 0;
    this.zombies = [];
    this.nextZombieId = 0;
    this.sites = [];
    this.siteTiles.clear();
    this.occupied.clear();
    this.nextSiteId = 0;
    this.path = [];
    this.pathIndex = 0;
    this.actionGoal = null;
    this.chopElapsed = 0;
    this.chopping = false;
    this.punchLockUntil = 0;
    this.buildMode = false;
    this.queueMarkers = [];
    this.outlinedTreeIds.clear();
    this.glowSprites.clear(); // scene teardown destroys the GameObjects; drop our stale references
    this.glowPulse = undefined;
    this.paintedThisGesture.clear();
    this.lastFacing = { dCol: 0, dRow: 1 };
    this.mode = 'command';

    this.playerStats = {
      maxHp: PLAYER_MAX_HP,
      armour: 0,
      speed: PLAYER_START_SPEED,
      vision: PLAYER_START_VISION,
      strength: 0,
      dex: 0,
      dodge: 0,
    };
    this.playerHp = this.playerStats.maxHp;

    this.drawGround();

    // Shared character inventory — stored in the registry so the UIScene reads the same instance.
    this.inv = new Inventory();
    this.registry.set('inventory', this.inv);

    this.spawnTrees();
    this.spawnZombies();

    // Player: 3-way directional idle + walk (down/side/up). Each strip is its own texture (key ==
    // anim key, loaded in PreloadScene); side art faces right, GameScene mirrors it with flipX.
    const { player: playerActor, enemy: enemyActor } = ACTIVE_TILESET.actors;
    // idle/walk loop (velocity-driven locomotion); chop loops while felling in place; punch is a
    // one-shot swing. Action swings run faster (ACTION_ANIM_FRAMERATE) so a chop lands per hit.
    (['idle', 'walk', 'chop', 'punch'] as PlayerState[]).forEach((state) => {
      const isAction = state === 'chop' || state === 'punch';
      (['down', 'side', 'up'] as Facing[]).forEach((facing) => {
        const key = playerAnimKey(state, facing);
        if (this.anims.exists(key)) return;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(key, { start: 0, end: playerActor[state][facing].frames - 1 }),
          frameRate: isAction ? ACTION_ANIM_FRAMERATE : 10,
          repeat: state === 'punch' ? 0 : -1,
        });
      });
    });
    // Enemy (skeleton): a single Run strip; frame 0 doubles as the idle pose, and GameScene flips it
    // by movement-x (the mob sheets ship no directional variants). Its damaged anim is dropped.
    if (!this.anims.exists(enemyWalkKey)) {
      this.anims.create({
        key: enemyWalkKey,
        frames: this.anims.generateFrameNumbers(enemyWalkKey, { start: 0, end: enemyActor.walk.frames - 1 }),
        frameRate: 10,
        repeat: -1,
      });
    }
    const p = this.add.sprite(BASE_WIDTH / 2, BASE_HEIGHT / 2, playerAnimKey('idle', 'down'));
    this.physics.add.existing(p);
    this.player = p as typeof this.player;
    this.player.setDepth(10).setScale(playerActor.render.scale).setOrigin(playerActor.render.originX, playerActor.render.originY);
    this.player.body.setCollideWorldBounds(true);
    this.fitActorBody(this.player, playerActor.render);
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

    // Fog of war: a semi-transparent overlay (inverted geometry mask — a hole at the vision
    // radius) dims static world content (ground/trees/walls, depths 0-4) but sits below the ghost
    // (6) and player (10), so they're unaffected by it. Dynamic actors instead hide themselves
    // entirely outside vision — see updateVision() — since a second full-screen overlay can't
    // selectively cover "just the actors" without also re-covering the static content underneath.
    this.fogShape = this.add.graphics().setVisible(false);
    const fogMask = this.fogShape.createGeometryMask();
    fogMask.setInvertAlpha(true);
    this.add.rectangle(BASE_WIDTH / 2, BASE_HEIGHT / 2, BASE_WIDTH, BASE_HEIGHT, 0x000000, 0.2).setDepth(5).setMask(fogMask);
    this.updateVision();

    // Walls: static bodies the player collides with (a backstop; pathing already avoids them).
    this.walls = this.physics.add.staticGroup();
    this.physics.add.collider(this.player, this.walls);

    // Build ghost — hidden until build mode; recoloured valid/invalid as it tracks the tapped tile.
    this.ghost = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, COLORS.ghostValid, 0.5).setVisible(false).setDepth(6);

    // HUD overlay runs alongside this scene; grab its instance for the UI-tap guard. UIScene
    // itself isn't restarted on a death-restart (only 'Game' is), so re-emit mode:changed here to
    // resync its mode-toggle/movepad visuals in case death happened mid-Combat/Inspect mode.
    this.scene.launch('UI');
    this.ui = this.scene.get('UI') as UIScene;
    this.game.events.emit('mode:changed', this.mode);

    // One unified pointer gate (down + up).
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);

    this.game.events.on('build:toggle', this.toggleBuild, this);
    this.game.events.on('tasks:cancel', this.cancelAll, this);
    this.game.events.on('debug:regenTrees', this.regenerateTrees, this); // TEMP: movement testing
    this.game.events.on('zoom:delta', this.adjustZoom, this);
    this.game.events.on('camera:center', this.centerOnPlayer, this);
    this.game.events.on('combat:punch', this.punch, this);
    this.game.events.on('mode:combatToggle', this.onCombatToggle, this);
    this.game.events.on('mode:inspectToggle', this.onInspectToggle, this);
    this.game.events.on('combat:move', this.onCombatMove, this);
    this.game.events.on('combat:moveEnd', this.onCombatMoveEnd, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('build:toggle', this.toggleBuild, this);
      this.game.events.off('tasks:cancel', this.cancelAll, this);
      this.game.events.off('debug:regenTrees', this.regenerateTrees, this); // TEMP
      this.game.events.off('zoom:delta', this.adjustZoom, this);
      this.game.events.off('camera:center', this.centerOnPlayer, this);
      this.game.events.off('combat:punch', this.punch, this);
      this.game.events.off('mode:combatToggle', this.onCombatToggle, this);
      this.game.events.off('mode:inspectToggle', this.onInspectToggle, this);
      this.game.events.off('combat:move', this.onCombatMove, this);
      this.game.events.off('combat:moveEnd', this.onCombatMoveEnd, this);
    });

    this.emitTasks();
  }

  override update(_time: number, delta: number): void {
    this.chopping = false; // re-set true by runHarvest only while actually felling in place
    this.syncGlowTransforms(); // keep queued-tree halos locked to their (possibly animating) trees
    const action = this.queue.current;
    if (!action) {
      // Combat mode drives velocity directly via onCombatMove/onCombatMoveEnd — don't stomp it
      // here every frame just because the (unused, in Combat mode) task queue is empty.
      if (this.mode !== 'combat') this.player.body.setVelocity(0, 0);
      this.updatePlayerAnim();
      this.updateVision();
      this.updateZombies();
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
    this.updateVision();
    this.updateZombies();
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
    const dCol = Math.sign(wp.col - worldToTile(this.player.x));
    const dRow = Math.sign(wp.row - worldToTile(this.player.y));
    if (dCol !== 0 || dRow !== 0) this.lastFacing = { dCol, dRow };
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, wx, wy) <= 2) {
      this.player.body.reset(wx, wy);
      this.pathIndex += 1;
      return this.pathIndex >= this.path.length;
    }
    this.physics.moveTo(this.player, wx, wy, this.playerStats.speed);
    return false;
  }

  /**
   * Directional player animation from `lastFacing`. Priority: a one-shot punch swing owns the
   * sprite until it finishes (we yield, leaving its frames to play); else the looping chop swing
   * while felling in place; else walk while translating / idle when still. Side art faces right, so
   * left is the same strip mirrored with flipX; down/up clear flipX.
   */
  private updatePlayerAnim(): void {
    if (this.time.now < this.punchLockUntil) return; // punch swing in progress — don't stomp it
    const facing = this.facingDir();
    const state: PlayerState = this.chopping ? 'chop' : this.player.body.velocity.lengthSq() > 1 ? 'walk' : 'idle';
    this.player.setFlipX(facing === 'side' && this.lastFacing.dCol < 0);
    this.player.anims.play(playerAnimKey(state, facing), true);
  }

  /** Play the one-shot punch swing in the current facing and lock updatePlayerAnim out for its
   * duration (so a punch reads fully even while moving). Re-pressing restarts it. */
  private playPunchSwing(): void {
    const facing = this.facingDir();
    this.player.setFlipX(facing === 'side' && this.lastFacing.dCol < 0);
    const key = playerAnimKey('punch', facing);
    this.player.anims.play(key); // no ignoreIfPlaying → a rapid re-press restarts the swing
    this.punchLockUntil = this.time.now + (this.anims.get(key)?.duration ?? 300);
  }

  /** Map `lastFacing` (dCol/dRow) to a directional strip: side when horizontal dominates, else up/down. */
  private facingDir(): Facing {
    const { dCol, dRow } = this.lastFacing;
    if (dCol !== 0 && Math.abs(dCol) >= Math.abs(dRow)) return 'side';
    return dRow < 0 ? 'up' : 'down';
  }

  /**
   * Turn the worker to face a target tile. Called while working in place (chop/build) so the swing
   * points at the thing being worked — independent of the approach direction or a stale `lastFacing`
   * (fixes chopping while facing away when already stood next to the target).
   */
  private faceTile(col: number, row: number): void {
    const pt = this.playerTile();
    const dCol = Math.sign(col - pt.col);
    const dRow = Math.sign(row - pt.row);
    if (dCol !== 0 || dRow !== 0) this.lastFacing = { dCol, dRow };
  }

  /**
   * Give a scaled actor a roughly tile-sized physics body at its feet. Size/offset are in source-
   * frame px (Arcade scales the body by the sprite's scale), so a padded 64px canvas gets a ~1-tile
   * world body centred on the character's feet. Low-stakes: player↔wall collision is a pathfinding
   * backstop and enemy contact damage is tile-based (z.col/row), not physics.
   */
  private fitActorBody(
    sprite: Phaser.GameObjects.Sprite & { body: Phaser.Physics.Arcade.Body },
    render: ActorRender,
  ): void {
    const frame = sprite.frame.width; // square source canvas (px)
    const bodyPx = Math.min(frame, Math.round(TILE_SIZE / render.scale)); // → ≈ one tile in world
    sprite.body.setSize(bodyPx, bodyPx);
    sprite.body.setOffset((frame - bodyPx) / 2, frame - bodyPx); // centred horizontally, at the canvas bottom
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
      const target = { col: tree.col, row: tree.row };
      // Prefer a base stand tile (never up in the canopy); fall back to any adjacent if walled off.
      const stand =
        reachableAdjacent(this.playerTile(), target, this.isBlocked, this.gridDims, TREE_BASE_STAND_OFFSETS) ??
        reachableAdjacent(this.playerTile(), target, this.isBlocked, this.gridDims);
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
    // Tear down last refresh's glow halos + their pulse tween; we rebuild them below for the live
    // queue. This runs only on queue changes (a tap/long-press), never per frame — so recreating the
    // handful of glow sprites is cheap, unlike the old per-frame PostFX pass this replaced.
    this.glowPulse?.remove();
    this.glowPulse = undefined;
    for (const g of this.glowSprites.values()) {
      this.tweens.killTweensOf(g); // drop any live pulse/chop-bounce tween before destroying its target
      g.destroy();
    }
    this.glowSprites.clear();
    this.outlinedTreeIds.clear();

    // The head-of-queue harvest (first alive tree in queue order) pulses; the rest are static.
    const headId = this.headHarvestTreeId();

    for (const a of this.queue.all()) {
      if (a.kind === 'harvest') {
        const tree = this.treeById(a.treeId);
        if (tree?.alive) {
          this.addTreeGlow(tree, tree.id === headId);
          this.outlinedTreeIds.add(tree.id);
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

  /**
   * Draw a queued tree's soft silhouette glow: a baked halo texture (generated once per species, see
   * src/render/glowTexture.ts) placed behind the tree, aligned to the same origin + scale. `pulse`
   * (the head of queue) breathes via an alpha tween; the rest hold a static glow. Replaces the old
   * per-frame OutlineFX PostFX — no shader runs in the frame loop.
   */
  private addTreeGlow(tree: TreeNode, pulse: boolean): void {
    const radius = Phaser.Math.Clamp(Math.round(GLOW_SCREEN_PX / this.treeScale(tree.sprite)), 2, 16);
    const glow = bakeGlowTexture(this, tree.sprite.texture.key, COLORS.queued, radius);
    // Align the padded halo canvas onto the tree: its content sits `pad` texels in from every edge,
    // so the tree's display origin shifts by `pad` and the scale matches.
    const img = this.add
      .image(tree.sprite.x, tree.sprite.y, glow.key)
      .setDisplayOrigin(tree.sprite.displayOriginX + glow.pad, tree.sprite.displayOriginY + glow.pad)
      .setScale(tree.sprite.scaleX, tree.sprite.scaleY)
      .setDepth(tree.sprite.depth - 0.5); // between the ground (0) and the tree (1)
    this.glowSprites.set(tree.id, img);
    if (pulse) {
      img.setAlpha(0.65);
      this.glowPulse = this.tweens.add({
        targets: img,
        alpha: 1,
        duration: 620,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }
  }

  /**
   * Keep each queued tree's glow halo locked onto its tree. The glow is a sibling GameObject that
   * shares the tree's origin (the trunk base), so mirroring position/scale/rotation reproduces any
   * visual animation the tree plays — chop bounce, walk-past sway, fall — about the same pivot,
   * without every animation having to know the glow exists. Runs only for currently-glowing trees (a
   * handful), so the per-frame cost is trivial (nothing like the old per-frame PostFX pass).
   *
   * Keep tree *logic* (targeting, pathfinding, occupancy) keyed off `col`/`row`, never the animated
   * sprite transform — a sway or a mid-fall lean must not move the tree's logical tile.
   */
  private syncGlowTransforms(): void {
    for (const [id, glow] of this.glowSprites) {
      const s = this.treeById(id)?.sprite;
      if (!s) continue;
      glow.setPosition(s.x, s.y);
      glow.setScale(s.scaleX, s.scaleY);
      glow.rotation = s.rotation;
    }
  }

  /** The tree the worker will chop next: first `harvest` in queue order whose tree is still alive. */
  private headHarvestTreeId(): string | null {
    for (const a of this.queue.all()) {
      if (a.kind === 'harvest' && this.treeById(a.treeId)?.alive) return a.treeId;
    }
    return null;
  }

  // --- Harvest / build executors ------------------------------------------

  private runHarvest(a: Extract<Action, { kind: 'harvest' }>, delta: number): void {
    const tree = this.treeById(a.treeId);
    if (!tree || !tree.alive) return this.completeCurrent();
    if (this.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.faceTile(tree.col, tree.row); // swing toward the trunk, whatever side we stood on
      this.chopping = true; // standing at the tree → updatePlayerAnim plays the chop swing
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
      this.faceTile(site.col, site.row); // face the blueprint while building it
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

    // Command-mode-only: queue-painting (long-press-drag) issues tap-to-pathfind orders, which
    // would fight Combat mode's direct movepad control and has no meaning in Inspect mode.
    if (this.mode === 'command') {
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
    // Inspect mode shows a stats panel instead of issuing a command; Combat mode drives the
    // player via the movepad, not taps. Both skip the Command-mode tree/move fallthrough below.
    if (this.mode === 'inspect') {
      this.inspectAt(pointer.worldX, pointer.worldY);
      return;
    }
    if (this.mode !== 'command') return;

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

  // --- Combat ----------------------------------------------------------------

  /** Apply incoming damage to the player; on death, restart the scene (see Context & decisions'
   * "Death = restart" — no in-place heal, since that let an adjacent zombie immediately re-hit a
   * "reset" player). */
  private damagePlayer(amount: number): void {
    this.playerHp = Math.max(0, this.playerHp - amount);
    this.game.events.emit('player:hpChanged', { hp: this.playerHp, maxHp: this.playerStats.maxHp });
    if (this.playerHp <= 0) {
      console.log('player down — restarting');
      this.scene.restart();
    }
  }

  /** Punch the facing-adjacent tile: flat damage via the shared combat formula, no range/arc
   * beyond that one tile. Only affects zombies — trees keep using chop(). */
  private punch(): void {
    this.playPunchSwing(); // swing on every press, even a whiff, so the input always feels heard
    const pt = this.playerTile();
    const col = pt.col + this.lastFacing.dCol;
    const row = pt.row + this.lastFacing.dRow;
    const zombie = this.zombies.find((z) => z.alive && z.col === col && z.row === row);
    if (!zombie) return;
    zombie.hp -= resolveMeleeAttack(this.playerStats, zombie.def, UNARMED_BASE_DAMAGE);
    if (zombie.hp <= 0) {
      zombie.alive = false;
      zombie.sprite.destroy();
      this.zombies = this.zombies.filter((z) => z !== zombie);
    }
  }

  /** Switch input mode (mutually exclusive) and notify UIScene to update its HUD accordingly. */
  private setMode(next: 'command' | 'combat' | 'inspect'): void {
    if (this.mode === next) return;
    this.mode = next;
    // Entering Combat mode shouldn't fight with an in-flight Command-mode task (treat it like Cancel).
    if (next === 'combat') this.cancelAll();
    this.game.events.emit('mode:changed', this.mode);
  }

  private onCombatToggle(): void {
    this.setMode(this.mode === 'combat' ? 'command' : 'combat');
  }

  private onInspectToggle(): void {
    this.setMode(this.mode === 'inspect' ? 'command' : 'inspect');
  }

  /** Combat-mode movepad drag: drives the player directly (bypassing the pathfinder/task queue). */
  private onCombatMove(vec: { dx: number; dy: number }): void {
    if (this.mode !== 'combat') return;
    this.player.body.setVelocity(vec.dx * this.playerStats.speed, vec.dy * this.playerStats.speed);
    // Facing follows the movepad's dominant axis (cardinal, not diagonal): a near-axis-aligned
    // drag still has a tiny off-axis component, and Math.sign on that noise would otherwise flip
    // facing diagonal — pointing Punch at an empty tile next to a zombie the player is squarely
    // facing.
    if (vec.dx !== 0 || vec.dy !== 0) {
      this.lastFacing =
        Math.abs(vec.dx) >= Math.abs(vec.dy) ? { dCol: Math.sign(vec.dx), dRow: 0 } : { dCol: 0, dRow: Math.sign(vec.dy) };
    }
  }

  private onCombatMoveEnd(): void {
    if (this.mode === 'combat') this.player.body.setVelocity(0, 0);
  }

  /** Inspect-mode tap: hit-test zombies, then trees, then build sites (closest-thing-wins
   * priority order) and show that entity's stats panel; empty ground closes any open panel. */
  private inspectAt(x: number, y: number): void {
    const col = worldToTile(x);
    const row = worldToTile(y);

    const zombie = this.zombies.find((z) => z.alive && z.col === col && z.row === row);
    if (zombie) {
      this.game.events.emit('inspect:show', zombieStats(zombie));
      return;
    }
    const tree = this.treeAt(x, y);
    if (tree) {
      this.game.events.emit('inspect:show', treeStats(tree));
      return;
    }
    const site = this.sites.find((s) => s.col === col && s.row === row);
    if (site) {
      this.game.events.emit('inspect:show', wallStats(site));
      return;
    }
    this.game.events.emit('inspect:hide');
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
    const { key } = resolveTile(ACTIVE_TILESET.tiles.tree);
    const sprite = this.add.image(tileToWorldCenter(col), tileToWorldCenter(row), key).setDepth(1);
    // The extracted pine is much taller than a tile: scale it to ~TREE_TILES_TALL tiles high and
    // anchor near its base (bottom-centre-ish origin) so the trunk sits on the tile and the canopy
    // overhangs upward. sprite.x/y stay the tile centre, so treeAt()'s distance check is unaffected.
    sprite.setScale(this.treeScale(sprite)).setOrigin(0.5, 0.92);
    this.trees.push({ id: `tree-${this.nextTreeId++}`, sprite, def, hp: def.maxHp, alive: true, col, row });
  }

  /** Base display scale for the tree image (derived from its source height, so any pine fits its tile). */
  private treeScale(sprite: Phaser.GameObjects.Image): number {
    return (TILE_SIZE * TREE_TILES_TALL) / sprite.frame.height;
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
    // Bump relative to the tree's fitted base scale (not an absolute 1 — the pine is scaled down).
    // Animate only the tree — its queued glow halo mirrors this (and any future sway/fall) each frame
    // via syncGlowTransforms(), so animations never have to drive the glow themselves.
    const base = this.treeScale(tree.sprite);
    this.tweens.add({ targets: tree.sprite, scale: base * 1.18, duration: 80, yoyo: true });
    if (tree.hp <= 0) {
      tree.alive = false;
      // No dedicated stump sprite in the pack yet (see docs/ASSETS.md) — tint the felled tree
      // brown as a stand-in "stump" state rather than mixing in a mismatched placeholder rect.
      tree.sprite.setScale(base).setTint(tree.def.stumpColor);
      this.time.delayedCall(tree.def.regrowMs, () => {
        tree.hp = tree.def.maxHp;
        tree.alive = true;
        tree.sprite.clearTint();
        this.repath(); // regrown tree may now block the active route
      });
    }
  }

  // --- Zombies (minimal idle/chasing AI — see plan 003) ---------------------

  private spawnZombies(): void {
    this.addZombie('kidZombie', 11, 30);
  }

  private addZombie(enemyId: string, col: number, row: number): void {
    const def = ENEMIES[enemyId];
    const { render } = ACTIVE_TILESET.actors.enemy;
    const sprite = this.add.sprite(tileToWorldCenter(col), tileToWorldCenter(row), enemyWalkKey).setDepth(9);
    sprite.setScale(render.scale).setOrigin(render.originX, render.originY);
    this.physics.add.existing(sprite);
    const zsprite = sprite as ZombieUnit['sprite'];
    zsprite.body.setCollideWorldBounds(true);
    this.fitActorBody(zsprite, render);
    this.zombies.push({
      id: `zombie-${this.nextZombieId++}`,
      sprite: zsprite,
      def,
      hp: def.maxHp,
      alive: true,
      col,
      row,
      state: 'idle',
      lastContactAt: 0,
      lastRepathAt: 0,
      path: [],
      pathIndex: 0,
    });
  }

  /** Step a zombie toward its next waypoint (mirrors advancePath's approach); true once its
   * current path is exhausted. */
  private advanceZombie(z: ZombieUnit): boolean {
    if (z.pathIndex >= z.path.length) {
      z.sprite.body.setVelocity(0, 0);
      return true;
    }
    const wp = z.path[z.pathIndex];
    const wx = tileToWorldCenter(wp.col);
    const wy = tileToWorldCenter(wp.row);
    if (Phaser.Math.Distance.Between(z.sprite.x, z.sprite.y, wx, wy) <= 2) {
      z.sprite.body.reset(wx, wy);
      z.col = wp.col;
      z.row = wp.row;
      z.pathIndex += 1;
      return z.pathIndex >= z.path.length;
    }
    this.physics.moveTo(z.sprite, wx, wy, z.def.speed);
    return false;
  }

  /** Run-cycle while moving (flipped by movement-x — art faces right), idle pose (frame 0) otherwise. */
  private updateZombieAnim(z: ZombieUnit): void {
    if (z.sprite.body.velocity.lengthSq() > 1) {
      const vx = z.sprite.body.velocity.x;
      if (vx !== 0) z.sprite.setFlipX(vx < 0);
      z.sprite.anims.play(enemyWalkKey, true);
    } else {
      z.sprite.anims.stop();
      z.sprite.setFrame(0);
    }
  }

  /** Per-frame idle→chasing aggro check + chase/contact-damage for every live zombie. */
  private updateZombies(): void {
    const now = this.time.now;
    const pt = this.playerTile();
    for (const z of this.zombies) {
      if (!z.alive) continue;

      if (z.state === 'idle') {
        const dist = Phaser.Math.Distance.Between(z.sprite.x, z.sprite.y, this.player.x, this.player.y);
        if (dist <= (z.def.vision ?? 0)) z.state = 'chasing';
      }

      if (z.state === 'chasing') {
        const tileDist = Math.max(Math.abs(pt.col - z.col), Math.abs(pt.row - z.row));
        if (tileDist <= 1) {
          z.sprite.body.setVelocity(0, 0);
          if (now - z.lastContactAt >= CONTACT_DAMAGE_COOLDOWN_MS) {
            z.lastContactAt = now;
            this.damagePlayer(resolveMeleeAttack(z.def, this.playerStats, UNARMED_BASE_DAMAGE));
          }
        } else {
          if (now - z.lastRepathAt >= 300) {
            z.lastRepathAt = now;
            z.path = findPath({ col: z.col, row: z.row }, pt, this.isBlocked, this.gridDims) ?? [];
            z.pathIndex = 0;
          }
          this.advanceZombie(z);
        }
      }

      this.updateZombieAnim(z);
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
    const wall = resolveTile(ACTIVE_TILESET.tiles.wall);
    site.visual = this.add.image(site.rect.x, site.rect.y, wall.key, wall.frame).setDepth(1);
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
    zombies: number;
    playerHp: number;
    mode: 'command' | 'combat' | 'inspect';
    outlinedTreeIds: string[];
    pulsingTreeId: string | null;
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
      zombies: this.zombies.filter((z) => z.alive).length,
      playerHp: this.playerHp,
      mode: this.mode,
      outlinedTreeIds: [...this.outlinedTreeIds],
      pulsingTreeId: this.headHarvestTreeId(),
    };
  }

  /** True if the tile is currently a pathfinding obstacle (test helper). */
  isTileBlocked(col: number, row: number): boolean {
    return this.isBlocked(col, row);
  }

  // --- Rendering -----------------------------------------------------------

  /**
   * Ground pass: weighted-random grass variants per tile so the common variants dominate and rarer
   * ones just sprinkle in (vs a flat fill or an obvious checkerboard).
   *
   * Baked into ONE RenderTexture rather than ~900 separate tile images. Individually-placed frames
   * of a shared spritesheet bleed at fractional zoom (e.g. 150%): a 16px source tile scaled to 24px
   * samples just past its atlas cell and picks up a neighbouring (dark) frame, showing as thin
   * vertical seams that crawl as the camera scrolls. Baked side-by-side at integer 1:1, every tile's
   * neighbour is the actual adjacent grass — no cross-frame bleed, and one object means no inter-tile
   * gaps either. The camera then scales this single opaque texture, which nearest-samples cleanly.
   */
  private drawGround(): void {
    const groundVariants = ACTIVE_TILESET.tiles.ground.map((g) => ({ ...resolveTile(g.source), weight: g.weight }));
    const cols = Math.ceil(BASE_WIDTH / TILE_SIZE);
    const rows = Math.ceil(BASE_HEIGHT / TILE_SIZE);
    const rt = this.add.renderTexture(0, 0, cols * TILE_SIZE, rows * TILE_SIZE).setOrigin(0, 0).setDepth(0);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const pick = pickWeighted(groundVariants);
        rt.drawFrame(pick.key, pick.frame, col * TILE_SIZE, row * TILE_SIZE);
      }
    }
    rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST); // crisp pixels when the camera scales it
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
  /** Redraws the vision-radius mask shape, and hides/shows dynamic actors by distance to it —
   * unlike static world content (dimmed by the terrain fog above), an actor outside vision is
   * fully invisible. Only the player exists to apply this to today; the same one-line check is
   * the pattern for any future monster/NPC sprite. */
  private updateVision(): void {
    this.fogShape.clear();
    this.fogShape.fillStyle(0xffffff);
    this.fogShape.fillCircle(this.player.x, this.player.y, this.playerStats.vision ?? PLAYER_START_VISION);
    this.player.setVisible(this.inVisionRange(this.player.x, this.player.y));
  }

  /** True if a world point is within the character's vision radius (see fog of war above). */
  private inVisionRange(x: number, y: number): boolean {
    return (
      Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) <= (this.playerStats.vision ?? PLAYER_START_VISION)
    );
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
