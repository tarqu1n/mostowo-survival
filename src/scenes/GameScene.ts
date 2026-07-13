import Phaser from 'phaser';
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  TILE_SIZE,
  GROUND_CHUNK_ROWS,
  CHOP_INTERVAL_MS,
  ACTION_ANIM_FRAMERATE,
  LONGPRESS_MS,
  BUILD_MS,
  COLORS,
  PLAYER_START_VISION,
  UNARMED_BASE_DAMAGE,
  PLAYER_HIT_SHAKE_MS,
  PLAYER_HIT_SHAKE_INTENSITY,
  ENEMY_HIT_SHAKE_MS,
  ENEMY_HIT_SHAKE_INTENSITY,
  DEATH_ANIM_FRAMERATE,
  DEATH_HOLD_MS,
  INVENTORY_SLOTS,
  DEFAULT_MAX_STACK,
  DAY_MS,
  TWILIGHT_MS,
  HUNGER_MAX,
  HUNGER_DRAIN_PER_SEC,
  STARVE_DAMAGE,
  STARVE_DAMAGE_INTERVAL_MS,
} from '../config';
import { ITEMS } from '../data/items';
import { NODES } from '../data/nodes';
import { BUILDABLES } from '../data/buildables';
import { ENEMIES } from '../data/enemies';
import type { ResourceNodeDef } from '../data/types';
import { Inventory } from '../systems/Inventory';
import { worldToTile, tileToWorldCenter, snapToTileCenter, tileKey } from '../systems/grid';
import { findPath, reachableAdjacent, type Cell } from '../systems/pathfind';
import { TaskQueue, type Action } from '../systems/tasks';
import {
  cycleLengthMs,
  phaseAt,
  tintAlphaAt,
  dayCountForTotal,
  type DayPhase,
} from '../systems/daynight';
import { drainHunger, feed, isStarving } from '../systems/needs';
import { resolveMeleeAttack } from '../systems/combat';
import type { MonsterMode } from '../systems/monsterAI';
import { hurtboxContains, hurtboxTiles, DEFAULT_HURTBOX } from '../systems/hurtbox';
import { bakeGlowTexture } from '../render/glowTexture';
import { treeStats, wallStats, enemyStats } from '../systems/stats';
import type { UIScene } from './UIScene';
import { FACING_DELTAS } from '../entities/types';
import type { TreeNode, BuildSite, PointerPick } from '../entities/types';
import type { ScenarioSpec, ScenarioResult, GameTestApi } from '../entities/testTypes';
import type { CharacterSprite } from '../entities/Character';
import { PlayerCharacter } from '../entities/PlayerCharacter';
import {
  MonsterCharacter,
  type MonsterSpawnOpts,
  type MonsterTickEnv,
} from '../entities/MonsterCharacter';
import { CombatFxManager } from './fx/CombatFxManager';
import { PointerInputController } from './input/PointerInputController';
import {
  ACTIVE_TILESET,
  resolveTile,
  playerAnimKey,
  enemyWalkKey,
  enemyIdleKey,
  enemyDeathKey,
  pickWeighted,
  type Facing,
  type PlayerState,
} from '../data/tileset';

/** Queued-node glow reach on screen (px). Converted to source texels per species so the baked halo
 *  reads the same regardless of a sprite's source resolution — see refreshQueueHighlights. */
const GLOW_SCREEN_PX = 5;

/**
 * World scene: the worker task system. The player unit pathfinds around obstacles (walls + live
 * trees), works through a queue of orders (tap a tree = queue a chop, or un-queue it if already
 * queued; tap the ground = move now / clear; long-press = queue either), and builds walls as timed
 * on-site jobs (place a passable blueprint → worker walks over → works → solid wall).
 *
 * All pointer input flows through one gate: the HUD hit-region is ignored on BOTH down and up; build
 * placement resolves on `pointerdown`; move/harvest orders resolve on `pointerup` (long-press = queue).
 */
export class GameScene extends Phaser.Scene {
  // The player-controlled worker (plan 013 Step 4): owns its sprite, stats/hp, facing, path state,
  // anim + death collapse. Recreated every create() (a death-restart), so all its state starts fresh.
  private playerChar!: PlayerCharacter;

  /** The player's sprite — camera/fog/pointer code addresses the display object this way. */
  private get player(): CharacterSprite {
    return this.playerChar.sprite;
  }

  // Injectable RNG for combat hit-rolls (default Math.random). Threaded into every
  // resolveMeleeAttack call site so the DEV-only test API can pin it — combat scenarios then stay
  // deterministic even if a future enemy/player gains dodge > 0 (today both are 0). See plan 007 S3.
  private rng: () => number = Math.random;
  // Monotonic clock for the DEV-only fixed-step seam (__test.step); seeded from this.time.now on
  // first use so driven steps never jump the scene clock backwards. See testStep().
  private testClock = 0;

  // Input mode: Command (default tap-to-pathfind, unchanged), Combat (movepad drives the player
  // directly, bypassing the pathfinder), Inspect (tap shows a stats panel — Step 7). Mutually
  // exclusive; UIScene mirrors this for HUD highlighting/visibility via 'mode:changed'.
  private mode: 'command' | 'combat' | 'inspect' = 'command';

  private inv!: Inventory;
  private trees: TreeNode[] = [];
  private nextTreeId = 0;
  private enemies: MonsterCharacter[] = [];
  private nextEnemyId = 0;

  private readonly queue = new TaskQueue();
  private actionGoal: Cell | null = null; // the tile we're currently pathing to (for re-pathing)
  private chopElapsed = 0;
  // Action-swing anim state: `harvestSwing` is set each frame the worker is harvesting in place —
  // 'chop' (axe) for a tree, 'mine' (pickaxe) for a rock, 'gather' (Collect forage) for a bush — and
  // drives that looping animation; null when not harvesting. Passed into playerChar.updateAnim each
  // frame (the attack-lock that yields to a sword swing lives on PlayerCharacter — see attack()).
  private harvestSwing: 'chop' | 'mine' | 'gather' | null = null;
  // Latest Combat-mode movepad vector (analog: |v| ≤ 1). The movepad only emits on press/drag, not per
  // frame, so update() re-applies velocity from this each frame — that's what lets the attack-slow
  // (see effectiveMoveSpeed) take hold and release mid-hold without the player needing to nudge the pad.
  private combatMoveVec = { dx: 0, dy: 0 };

  // Combat FX (hit flash, enemy lunge + weapon swing, corpse lingering, the attack-swing lock) — see
  // src/scenes/fx/CombatFxManager.ts (plan 013 Step 3). A field initializer (cheap — its constructor
  // only stashes these closures, it doesn't touch any Scene-plugin injection); create() calls
  // fx.armShutdown() + fx.resetCombatFx() each (re)start — see there for why arming is split out.
  private readonly fx = new CombatFxManager(this, {
    getPlayerSprite: () => this.player,
    getFacing: () => this.playerChar.facingDir(),
    getLastFacingDCol: () => this.playerChar.lastFacing.dCol,
    setAttackLockUntil: (t) => {
      this.playerChar.attackLockUntil = t;
    },
  });

  // Day/night clock: `clockMs` auto-advances every frame (see update()); `dayPhase`/`dayCount` are the
  // derived, queryable state (also mirrored to the registry + emitted as 'time:changed'). The
  // `nightOverlay` is a map-sized dark rect whose alpha the clock drives to darken the world at night.
  private clockMs = 0;
  private dayPhase: DayPhase = 'day';
  private dayCount = 1;
  private nightOverlay!: Phaser.GameObjects.Rectangle;

  // Hunger: drains every frame (see update()); at zero the player starves, taking STARVE_DAMAGE every
  // STARVE_DAMAGE_INTERVAL_MS via combat's damagePlayer. `starveElapsed` is the damage-cadence accumulator.
  private hunger = HUNGER_MAX;
  private starveElapsed = 0;

  private buildMode = false;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private occupied = new Set<string>();
  private sites: BuildSite[] = [];
  private siteTiles = new Set<string>();
  private ghost!: Phaser.GameObjects.Rectangle;
  private nextSiteId = 0;

  private ui!: UIScene;
  // Pointer gestures (tap/long-press-paint/pan/pinch) + the camera they drive (zoom, follow-lock) —
  // see src/scenes/input/PointerInputController.ts (plan 013 Step 5). Constructed fresh in create()
  // (it wires its own input.on(...) listeners there and tears them down on SHUTDOWN itself), so unlike
  // `fx` above it is NOT a field initializer — see the controller's class doc for why that's fine here.
  private pointerInput!: PointerInputController;
  private gridDims = {
    cols: Math.floor(MAP_WIDTH / TILE_SIZE),
    rows: Math.floor(MAP_HEIGHT / TILE_SIZE),
  };
  private queueMarkers: Phaser.GameObjects.Rectangle[] = []; // yellow pips over queued move tiles
  private outlinedTreeIds = new Set<string>(); // trees currently showing a queued-glow sprite
  private glowSprites = new Map<string, Phaser.GameObjects.Image>(); // treeId → its baked glow halo image
  private glowPulse?: Phaser.Tweens.Tween; // breathing alpha tween on the head-of-queue glow
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
    this.enemies = [];
    this.nextEnemyId = 0;
    this.sites = [];
    this.siteTiles.clear();
    this.occupied.clear();
    this.nextSiteId = 0;
    this.actionGoal = null;
    this.chopElapsed = 0;
    this.harvestSwing = null;
    this.combatMoveVec = { dx: 0, dy: 0 };
    // Combat-FX state — (re-)arm the SHUTDOWN flush (see CombatFxManager.armShutdown) then clear so a
    // death-restart starts clean: the maps/set held tweens+sprites from the dead run (Phaser destroyed
    // them on teardown, so drop the stale references). Player-side state (hp/facing/path/attack-lock/
    // dying) needs no reset here — a fresh PlayerCharacter is constructed below each (re)start.
    this.fx.armShutdown();
    this.fx.resetCombatFx();
    this.buildMode = false;
    this.queueMarkers = [];
    this.outlinedTreeIds.clear();
    this.glowSprites.clear(); // scene teardown destroys the GameObjects; drop our stale references
    this.glowPulse = undefined;
    this.mode = 'command';
    // Survival state — reset so a death-restart begins a fresh Day 1 at full hunger (these are plain-data
    // fields; without an explicit reset they'd carry the dead run's values, e.g. hunger stuck at 0).
    this.clockMs = 0;
    this.dayPhase = 'day';
    this.dayCount = 1;
    this.hunger = HUNGER_MAX;
    this.starveElapsed = 0;

    // Seed survival state onto the registry so UIScene (Wellbeing screen) re-reads it on a scene
    // restart (playerStats follows below, once the fresh PlayerCharacter has built its stat bag).
    this.registry.set('hunger', this.hunger);

    this.drawGround();

    // Shared character inventory — stored in the registry so the UIScene reads the same instance.
    this.inv = new Inventory({
      capacity: INVENTORY_SLOTS,
      maxStackOf: (id) => ITEMS[id]?.maxStack ?? DEFAULT_MAX_STACK,
    });
    this.registry.set('inventory', this.inv);

    this.spawnTrees();
    this.spawnEnemies();

    // Player: 3-way directional idle + walk (down/side/up). Each strip is its own texture (key ==
    // anim key, loaded in PreloadScene); side art faces right, GameScene mirrors it with flipX.
    const { player: playerActor, enemy: enemyActor } = ACTIVE_TILESET.actors;
    // idle/walk loop (velocity-driven locomotion); chop/mine/gather loop while harvesting in place;
    // attack is a one-shot swing. Chop/mine/attack run faster (ACTION_ANIM_FRAMERATE) so a hit lands per
    // swing; gather is a calmer forage loop at the locomotion rate.
    (['idle', 'walk', 'chop', 'mine', 'gather', 'attack', 'death'] as PlayerState[]).forEach(
      (state) => {
        const isAction = state === 'chop' || state === 'mine' || state === 'attack';
        const oneShot = state === 'attack' || state === 'death'; // play once and hold the last frame
        (['down', 'side', 'up'] as Facing[]).forEach((facing) => {
          const key = playerAnimKey(state, facing);
          if (this.anims.exists(key)) return;
          this.anims.create({
            key,
            frames: this.anims.generateFrameNumbers(key, {
              start: 0,
              end: playerActor[state][facing].frames - 1,
            }),
            frameRate:
              state === 'death' ? DEATH_ANIM_FRAMERATE : isAction ? ACTION_ANIM_FRAMERATE : 10,
            repeat: oneShot ? 0 : -1,
          });
        });
      },
    );
    // Enemy (skeleton): a single Run strip (frame 0 doubles as the idle pose, flipped by movement-x —
    // the mob sheets ship no directional variants) plus a one-shot Death collapse played on kill.
    if (!this.anims.exists(enemyWalkKey)) {
      this.anims.create({
        key: enemyWalkKey,
        frames: this.anims.generateFrameNumbers(enemyWalkKey, {
          start: 0,
          end: enemyActor.walk.frames - 1,
        }),
        frameRate: 10,
        repeat: -1,
      });
    }
    if (!this.anims.exists(enemyIdleKey)) {
      this.anims.create({
        key: enemyIdleKey,
        frames: this.anims.generateFrameNumbers(enemyIdleKey, {
          start: 0,
          end: enemyActor.idle.frames - 1,
        }),
        frameRate: 6, // slow, gentle breathing bob
        repeat: -1,
      });
    }
    if (!this.anims.exists(enemyDeathKey)) {
      this.anims.create({
        key: enemyDeathKey,
        frames: this.anims.generateFrameNumbers(enemyDeathKey, {
          start: 0,
          end: enemyActor.death.frames - 1,
        }),
        frameRate: DEATH_ANIM_FRAMERATE,
        repeat: 0,
      });
    }
    this.playerChar = new PlayerCharacter(this);
    // playerStats is the player's stat bag surfaced for the Wellbeing screen's stat rows.
    this.registry.set('playerStats', this.playerChar.stats);
    this.physics.world.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);

    // Gesture + camera controller (plan 013 Step 5) — constructed fresh each (re)start; wires its own
    // pointer listeners and tears them down on SHUTDOWN itself (see the class doc). hudHitTest closes
    // over `this.ui`, assigned further below once UIScene is launched — safe, since no pointer event
    // can fire before create() returns. Build placement and mode dispatch are NOT gesture mechanics —
    // they route back through these deps callbacks (see PointerInputDeps).
    this.pointerInput = new PointerInputController(this, {
      hudHitTest: (x, y) => this.ui.hudHitTest(x, y),
      getPlayerSprite: () => this.player,
      isBuildMode: () => this.buildMode,
      onBuildDown: (pointer) => {
        this.updateGhost(pointer);
        this.placeOrEnqueueBuild(pointer);
      },
      onBuildMove: (pointer) => this.updateGhost(pointer),
      getMode: () => this.mode,
      onTap: (pointer) => {
        const action = this.actionAt(pointer.worldX, pointer.worldY);
        // A tap on a tree queues it: it falls in behind the current job (or starts at once if the
        // worker is idle) instead of interrupting an in-progress harvest — chopping is the loop you
        // batch up, so tapping tree after tree should build a chop list, not keep re-targeting. A tap
        // on the ground still redirects the worker now (act-now move); a held-still long-press queues
        // either kind.
        if (action.kind === 'harvest' || pointer.getDuration() >= LONGPRESS_MS)
          this.enqueue(action);
        else this.order(action); // quick tap on the ground = move now
      },
      onPaint: (pointer) => this.enqueue(this.actionAt(pointer.worldX, pointer.worldY)),
      onInspect: (pointer) => this.inspectAt(pointer.worldX, pointer.worldY),
    });

    // Camera follows the player. The map is larger than the viewport at every zoom, so the camera
    // always has scroll room and tracks the player. Instant (no lerp smoothing): this is a precision
    // tap-to-target game, so the camera should never lag behind where the player actually is.
    // centerOn avoids a visible pan-in from (0,0) on the first frame. A manual drag breaks this lock
    // (free look); the HUD's FOLLOW button re-engages it.
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.cameras.main.centerOn(this.player.x, this.player.y);
    this.registry.set('following', true);
    this.cameras.main.startFollow(this.player, true);
    this.pointerInput.setZoom(this.pointerInput.loadStoredZoom());

    // Fog of war: a semi-transparent overlay (inverted geometry mask — a hole at the vision
    // radius) dims static world content (ground/trees/walls, depths 0-4) but sits below the ghost
    // (6) and player (10), so they're unaffected by it. Dynamic actors instead hide themselves
    // entirely outside vision — see updateVision() — since a second full-screen overlay can't
    // selectively cover "just the actors" without also re-covering the static content underneath.
    this.fogShape = this.add.graphics().setVisible(false);
    const fogMask = this.fogShape.createGeometryMask();
    fogMask.setInvertAlpha(true);
    this.add
      .rectangle(MAP_WIDTH / 2, MAP_HEIGHT / 2, MAP_WIDTH, MAP_HEIGHT, 0x000000, 0.2)
      .setDepth(5)
      .setMask(fogMask);
    this.updateVision();

    // Night overlay — mirrors the fog rect's map size/centre but unmasked (a global dim, not a vision
    // hole) and at a higher depth (15, above the player at 10) so it darkens actors too. Non-interactive
    // (plain rects don't eat pointers) and below UIScene, so the HUD stays bright above it.
    //
    // Opacity is driven via the GameObject alpha (setAlpha) each frame from the day/night clock (see
    // update()/applyClock()). The fill alpha MUST stay 1: Phaser renders a shape's fill at
    // fillAlpha × gameObjectAlpha, so a fillAlpha of 0 would pin the overlay invisible no matter what
    // setAlpha does. We start it transparent with setAlpha(0) (full day) rather than a 0 fill alpha.
    this.nightOverlay = this.add
      .rectangle(MAP_WIDTH / 2, MAP_HEIGHT / 2, MAP_WIDTH, MAP_HEIGHT, COLORS.night, 1)
      .setAlpha(0)
      .setDepth(15);
    this.registry.set('dayPhase', 'day');
    this.registry.set('dayCount', 1);

    // Walls: static bodies the player collides with (a backstop; pathing already avoids them).
    this.walls = this.physics.add.staticGroup();
    this.physics.add.collider(this.player, this.walls);

    // Build ghost — hidden until build mode; recoloured valid/invalid as it tracks the tapped tile.
    this.ghost = this.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE, COLORS.ghostValid, 0.5)
      .setVisible(false)
      .setDepth(6);

    // HUD overlay runs alongside this scene; grab its instance for the UI-tap guard. UIScene
    // itself isn't restarted on a death-restart (only 'Game' is), so re-emit mode:changed here to
    // resync its mode-toggle/movepad visuals in case death happened mid-Combat/Inspect mode.
    this.scene.launch('UI');
    this.ui = this.scene.get('UI') as UIScene;
    this.game.events.emit('mode:changed', this.mode);

    this.game.events.on('build:toggle', this.toggleBuild, this);
    this.game.events.on('tasks:cancel', this.cancelAll, this);
    this.game.events.on('debug:randomise', this.randomiseWorld, this); // dev menu: scatter nodes + enemies
    this.game.events.on('debug:toggleTime', this.toggleDayNight, this); // dev menu: flip day/night
    this.game.events.on('zoom:delta', this.pointerInput.adjustZoom, this.pointerInput);
    this.game.events.on('camera:center', this.pointerInput.centerOnPlayer, this.pointerInput);
    this.game.events.on('combat:attack', this.attack, this);
    this.game.events.on('mode:combatToggle', this.onCombatToggle, this);
    this.game.events.on('mode:inspectToggle', this.onInspectToggle, this);
    this.game.events.on('needs:eat', this.onNeedsEat, this);
    this.game.events.on('combat:move', this.onCombatMove, this);
    this.game.events.on('combat:moveEnd', this.onCombatMoveEnd, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('build:toggle', this.toggleBuild, this);
      this.game.events.off('tasks:cancel', this.cancelAll, this);
      this.game.events.off('debug:randomise', this.randomiseWorld, this);
      this.game.events.off('debug:toggleTime', this.toggleDayNight, this);
      this.game.events.off('zoom:delta', this.pointerInput.adjustZoom, this.pointerInput);
      this.game.events.off('camera:center', this.pointerInput.centerOnPlayer, this.pointerInput);
      this.game.events.off('combat:attack', this.attack, this);
      this.game.events.off('mode:combatToggle', this.onCombatToggle, this);
      this.game.events.off('mode:inspectToggle', this.onInspectToggle, this);
      this.game.events.off('needs:eat', this.onNeedsEat, this);
      this.game.events.off('combat:move', this.onCombatMove, this);
      this.game.events.off('combat:moveEnd', this.onCombatMoveEnd, this);
    });

    this.emitTasks();

    // DEV-only test surface (plan 007). Gated on import.meta.env.DEV so `vite build` strips this
    // whole block — the shipped production bundle has no `__test` install and window.game.__test is
    // undefined there. The e2e runner therefore serves `vite dev`, where DEV === true.
    if (import.meta.env.DEV) {
      const api: GameTestApi = {
        applyScenario: (spec) => this.testApplyScenario(spec),
        step: (ms) => this.testStep(ms),
        setRng: (fn) => {
          this.rng = fn;
        },
        state: () => this.debugState(),
        order: (a) => this.order(a),
        enqueue: (a) => this.enqueue(a),
        inspect: (c, r) => this.testInspect(c, r),
        blocked: (c, r) => this.isTileBlocked(c, r),
      };
      (this.game as unknown as { __test?: GameTestApi }).__test = api;
    }
  }

  override update(_time: number, delta: number): void {
    this.harvestSwing = null; // re-set by runHarvest only while actually harvesting in place
    this.syncGlowTransforms(); // keep queued-tree halos locked to their (possibly animating) trees

    // Player is collapsing: freeze the world on the death anim (which advances on its own via Phaser's
    // anim system) until the scheduled scene.restart() fires. No clock/hunger tick, no input, no AI —
    // a clean death beat. The sprite's velocity is pinned to 0 so nothing drifts under the animation.
    if (this.playerChar.dying) {
      this.player.body.setVelocity(0, 0);
      return;
    }

    // Survival tick — advance the day/night clock EVERY frame, above the no-action early-return below,
    // so time passes whether or not a worker task is active. Drives the night-tint alpha; on a
    // phase/day change, seed the registry (so a scene restart re-reads it) and emit 'time:changed'.
    this.clockMs += delta;
    const cycleMs = this.clockMs % cycleLengthMs();
    this.nightOverlay.setAlpha(tintAlphaAt(cycleMs));
    const phase = phaseAt(cycleMs);
    const dayCount = dayCountForTotal(this.clockMs);
    if (phase !== this.dayPhase || dayCount !== this.dayCount) {
      this.dayPhase = phase;
      this.dayCount = dayCount;
      this.registry.set('dayPhase', phase);
      this.registry.set('dayCount', dayCount);
      this.game.events.emit('time:changed', {
        phase,
        dayCount,
        cycleMs,
        tNorm: cycleMs / cycleLengthMs(),
      });
    }

    // Hunger drains every frame too (drainHunger clamps a big refocus delta to [0,max]). Emit only when
    // the displayed (rounded) value changes. At zero the player starves: STARVE_DAMAGE every
    // STARVE_DAMAGE_INTERVAL_MS via combat's damagePlayer (the chop-interval accumulator idiom; the
    // while is bounded since it decrements). A fully-starved player thus loses HP and dies via combat's
    // scene.restart() death path — after which the create() reset above re-seeds full hunger.
    const hungerBefore = Math.round(this.hunger);
    this.hunger = drainHunger(this.hunger, delta, HUNGER_DRAIN_PER_SEC, HUNGER_MAX);
    if (Math.round(this.hunger) !== hungerBefore) {
      this.registry.set('hunger', this.hunger);
      this.game.events.emit('hunger:changed', { hunger: this.hunger, max: HUNGER_MAX });
    }
    if (isStarving(this.hunger)) {
      this.starveElapsed += delta;
      while (this.starveElapsed >= STARVE_DAMAGE_INTERVAL_MS) {
        this.starveElapsed -= STARVE_DAMAGE_INTERVAL_MS;
        this.damagePlayer(STARVE_DAMAGE);
      }
    } else {
      this.starveElapsed = 0;
    }

    const action = this.queue.current;
    if (!action) {
      // Combat mode drives velocity from the held movepad vector every frame (the pad only emits on
      // press/drag), scaled by effectiveMoveSpeed so an in-progress swing slows the player — that
      // re-evaluation each frame is what lets the attack-slow engage/release without a fresh pad input.
      if (this.mode === 'combat') {
        const speed = this.playerChar.effectiveMoveSpeed();
        this.player.body.setVelocity(this.combatMoveVec.dx * speed, this.combatMoveVec.dy * speed);
      } else {
        this.player.body.setVelocity(0, 0);
      }
      this.playerChar.updateAnim(this.harvestSwing);
      this.updateVision();
      this.updateEnemies();
      return;
    }
    switch (action.kind) {
      case 'move':
        if (this.playerChar.advancePath()) this.completeCurrent();
        break;
      case 'harvest':
        this.runHarvest(action, delta);
        break;
      case 'build':
        this.runBuild(action, delta);
        break;
    }
    this.playerChar.updateAnim(this.harvestSwing);
    this.updateVision();
    this.updateEnemies();
  }

  // --- Obstacle grid + path following -------------------------------------

  /**
   * Walkability for the pathfinder: completed walls and live *blocking* nodes (trees/rocks) block;
   * blueprints and non-blocking nodes (bushes, `def.blocksPath === false`) are passable.
   */
  private readonly isBlocked = (col: number, row: number): boolean =>
    this.occupied.has(tileKey(col, row)) ||
    this.trees.some((t) => t.alive && t.def.blocksPath && t.col === col && t.row === row);

  /** Path the worker toward `goal`; returns false if unreachable (`null` path). `[]` = already there. */
  private pathTo(goal: Cell): boolean {
    const path = findPath(this.playerChar.tile(), goal, this.isBlocked, this.gridDims);
    if (path === null) return false;
    this.playerChar.path = path;
    this.playerChar.pathIndex = 0;
    this.actionGoal = goal;
    return true;
  }

  /** Recompute the path to the active goal after the world changed (wall built / tree regrew). */
  private repath(): void {
    if (!this.actionGoal || !this.queue.current) return;
    const path = findPath(this.playerChar.tile(), this.actionGoal, this.isBlocked, this.gridDims);
    if (path === null) {
      this.completeCurrent(); // goal got walled off — drop it, don't stall
      return;
    }
    this.playerChar.path = path;
    this.playerChar.pathIndex = 0;
  }

  // --- Task queue lifecycle ------------------------------------------------

  /** Begin executing whatever is `current` — compute its path / stand tile, or skip if impossible. */
  private beginCurrent(): void {
    this.chopElapsed = 0;
    this.playerChar.path = [];
    this.playerChar.pathIndex = 0;
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
      // Bag can't accept this node's yield → don't even start the walk-and-swing; abort the order.
      if (!this.inv.canAccept(tree.def.yieldItemId, tree.def.yieldPerHit)) {
        this.flashBagFull(tree);
        return this.completeCurrent();
      }
      const target = { col: tree.col, row: tree.row };
      // Prefer this species' stand tiles (a tall tree restricts to its base, never up in the canopy);
      // fall back to any adjacent tile if those are walled off. A rock omits standOffsets → all-adjacent.
      const stand =
        reachableAdjacent(
          this.playerChar.tile(),
          target,
          this.isBlocked,
          this.gridDims,
          tree.def.standOffsets,
        ) ?? reachableAdjacent(this.playerChar.tile(), target, this.isBlocked, this.gridDims);
      if (!stand || !this.pathTo(stand)) this.completeCurrent();
      return;
    }
    // build
    const site = this.siteById(a.siteId);
    if (!site || site.done) return this.completeCurrent();
    const stand = reachableAdjacent(
      this.playerChar.tile(),
      { col: site.col, row: site.row },
      this.isBlocked,
      this.gridDims,
    );
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

  /** Append an order; if the worker was idle, start it. Tapping a tree that's already queued toggles
   *  it back off (see {@link toggleHarvest}) — never a duplicate chop order. */
  private enqueue(a: Action): void {
    if (a.kind === 'harvest' && this.isHarvestQueued(a.treeId)) {
      this.toggleHarvest(a.treeId);
      return;
    }
    const wasIdle = this.queue.current === null;
    this.queue.append(a);
    if (wasIdle) this.beginCurrent();
    this.emitTasks();
  }

  /** True if a tree already has a harvest order (current or pending). */
  private isHarvestQueued(treeId: string): boolean {
    return this.queue.all().some((x) => x.kind === 'harvest' && x.treeId === treeId);
  }

  /** Remove a tree's harvest order. Tapping a queued tree un-queues it; tapping it again re-queues it
   *  at the END of the list (a fresh `enqueue` append). If it was the live chop, advance to the next
   *  order (or go idle) so the worker doesn't keep swinging at a tree you just cancelled. */
  private toggleHarvest(treeId: string): void {
    const wasCurrent = this.queue.removeWhere((x) => x.kind === 'harvest' && x.treeId === treeId);
    if (wasCurrent) this.beginCurrent();
    this.emitTasks();
  }

  private cancelAll(): void {
    this.queue.clear();
    this.playerChar.path = [];
    this.playerChar.pathIndex = 0;
    this.actionGoal = null;
    this.player.body.setVelocity(0, 0);
    this.emitTasks();
  }

  private emitTasks(): void {
    this.refreshQueueHighlights();
    this.game.events.emit('tasks:changed', {
      current: this.queue.current?.kind ?? null,
      pending: this.queue.pending,
    });
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
          this.add
            .rectangle(
              tileToWorldCenter(a.col),
              tileToWorldCenter(a.row),
              6,
              6,
              COLORS.queued,
              0.85,
            )
            .setDepth(4),
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
    const radius = Phaser.Math.Clamp(
      Math.round(GLOW_SCREEN_PX / this.nodeScale(tree.sprite, tree.def)),
      2,
      16,
    );
    const glow = bakeGlowTexture(this, tree.sprite.texture.key, COLORS.queued, radius);
    // Align the padded halo canvas onto the tree: its content sits `pad` texels in from every edge,
    // so the tree's display origin shifts by `pad` and the scale matches.
    const img = this.add
      .image(tree.sprite.x, tree.sprite.y, glow.key)
      .setDisplayOrigin(
        tree.sprite.displayOriginX + glow.pad,
        tree.sprite.displayOriginY + glow.pad,
      )
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
    // If the bag can no longer accept this node's yield, abort the order rather than swing forever on
    // a node we can never fell (critique #1): the task only completes at hp<=0, so skipping the hit
    // alone would jam the queue head. Aborting clears it and frees any orders queued behind it.
    if (!this.inv.canAccept(tree.def.yieldItemId, tree.def.yieldPerHit)) {
      this.flashBagFull(tree);
      return this.completeCurrent();
    }
    if (this.playerChar.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.playerChar.faceTile(tree.col, tree.row); // swing toward the node, whatever side we stood on
      // Standing at the node → updatePlayerAnim plays the matching harvest anim: a bush is foraged
      // (gather/Collect), a rock is mined (pickaxe), everything else is chopped (axe). Bush wins ahead
      // of the rock/tree split via its `harvestAnim` def flag. See ResourceNodeDef.tile/harvestAnim.
      this.harvestSwing =
        tree.def.harvestAnim === 'gather' ? 'gather' : tree.def.tile === 'rock' ? 'mine' : 'chop';
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
    if (this.playerChar.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.playerChar.faceTile(site.col, site.row); // face the blueprint while building it
      site.progress += delta;
      site.rect.setAlpha(0.35 + 0.55 * Math.min(1, site.progress / BUILD_MS));
      if (site.progress >= BUILD_MS) {
        this.finishSite(site);
        this.completeCurrent();
      }
    }
  }

  // --- Input gate ----------------------------------------------------------
  //
  // Gesture recognition (tap/long-press-paint/pan/pinch) + the camera it drives live in
  // PointerInputController (plan 013 Step 5) — it resolves mechanics and calls back into onTap/
  // onPaint/onInspect (below, via the deps passed at construction in create()) for the mode-dependent
  // intent. Build-mode placement (isBuildMode/onBuildDown/onBuildMove deps) stays here too.

  /** The order implied by a world point: harvest the live tree whose sprite is drawn under it (see
   * pickSpriteAt — the raycast, not the foot tile), else move to that tile. A pick that isn't a tree
   * (an enemy, a blueprint — neither is a Command-mode harvest target) also falls through to move. */
  private actionAt(x: number, y: number): Action {
    const pick = this.pickSpriteAt(x, y);
    if (pick?.kind === 'tree') return { kind: 'harvest', treeId: pick.tree.id };
    return { kind: 'move', col: worldToTile(x), row: worldToTile(y) };
  }

  // --- Combat ----------------------------------------------------------------

  /** Apply incoming damage to the player; on death, restart the scene (see Context & decisions'
   * "Death = restart" — no in-place heal, since that let an adjacent enemy immediately re-hit a
   * "reset" player). */
  private damagePlayer(amount: number): void {
    if (this.playerChar.dying) return; // already collapsing — ignore further bites/starve ticks until restart
    this.playerChar.takeDamage(amount);
    this.game.events.emit('player:hpChanged', {
      hp: this.playerChar.hp,
      maxHp: this.playerChar.stats.maxHp,
    });
    if (this.playerChar.hp <= 0) this.killPlayer();
  }

  /**
   * Eat one unit of an edible item: spend it from the bag and restore its `nutrition` to hunger.
   * Returns false (a no-op) if the item isn't edible or none is held. Wired to the `needs:eat` event
   * the Wellbeing screen (UIScene) emits; `spend` already fires the inventory `'change'` for the HUD.
   */
  private eat(itemId: string): boolean {
    const def = ITEMS[itemId];
    if (def?.nutrition == null || !this.inv.canAfford({ [itemId]: 1 })) return false;
    this.inv.spend({ [itemId]: 1 });
    this.hunger = feed(this.hunger, def.nutrition, HUNGER_MAX);
    this.registry.set('hunger', this.hunger);
    this.game.events.emit('hunger:changed', { hunger: this.hunger, max: HUNGER_MAX });
    return true;
  }

  /** `needs:eat` handler — the Wellbeing screen taps an edible; forward to `eat`. */
  private onNeedsEat({ itemId }: { itemId: string }): void {
    this.eat(itemId);
  }

  /** The live enemy whose body (hurtbox, anchored at its feet tile) covers tile (col,row) — so a
   * tall enemy is hit/inspected by its drawn torso, not only its feet tile. Footprint is unchanged. */
  private enemyAt(col: number, row: number): MonsterCharacter | undefined {
    const target = { col, row };
    return this.enemies.find(
      (z) =>
        z.alive &&
        hurtboxContains({ col: z.col, row: z.row }, z.def.hurtbox ?? DEFAULT_HURTBOX, target),
    );
  }

  /** Attack the facing tile: flat damage via the shared combat formula, no range/arc beyond that
   * tile — but an enemy is hit anywhere its hurtbox reaches it (see enemyAt). Enemies only; trees
   * keep using chop(). */
  private attack(): void {
    this.fx.playAttackSwing(); // swing on every press, even a whiff, so the input always feels heard
    const pt = this.playerChar.tile();
    const col = pt.col + this.playerChar.lastFacing.dCol;
    const row = pt.row + this.playerChar.lastFacing.dRow;
    const enemy = this.enemyAt(col, row);
    if (!enemy) return;
    const dmg = resolveMeleeAttack(this.playerChar.stats, enemy.def, UNARMED_BASE_DAMAGE, this.rng);
    enemy.takeDamage(dmg);
    if (enemy.hp <= 0) {
      this.killEnemy(enemy); // play the death collapse, then remove the corpse
    } else if (dmg > 0) {
      this.fx.flashHit(enemy.sprite); // red flash + flinch on a hit it survived
      this.cameras.main.shake(ENEMY_HIT_SHAKE_MS, ENEMY_HIT_SHAKE_INTENSITY); // light kick so a connect has impact
    }
  }

  /** Player took a landed hit: the shared "you're hurt" feedback — the red flash + squash on the
   * sprite, a firm camera kick, and a `player:hit` event UIScene turns into a red damage vignette round
   * the screen edges. Deliberately *not* on the starvation drain (a passive tick, not an impact); it
   * fires from the bite site so getting bitten is unmissable even when you're not watching your feet. */
  private onPlayerHurt(): void {
    this.fx.flashHit(this.player);
    this.cameras.main.shake(PLAYER_HIT_SHAKE_MS, PLAYER_HIT_SHAKE_INTENSITY);
    this.game.events.emit('player:hit');
  }

  /**
   * Kill an enemy: pull it out of the AI/debugState set immediately (so nothing chases or counts it),
   * then let its sprite linger just long enough to play the one-shot Death collapse before removing
   * the corpse. The body is disabled so a corpse isn't a physics obstacle mid-animation, and any
   * in-flight flash/lunge is stopped first (those tweens poke the sprite, which is about to go away).
   */
  private killEnemy(z: MonsterCharacter): void {
    this.enemies = this.enemies.filter((x) => x !== z);
    this.fx.cleanupActorFx(z.sprite); // also stops an in-flight weapon swing before the image goes away
    z.die(); // character-side collapse: alive=false, weapon/fists gone, body off, Death strip playing
    const sprite = z.sprite;
    this.fx.addCorpse(sprite);
    const dur = this.anims.get(enemyDeathKey)?.duration ?? 600;
    // TEMP: hold the settled final frame for 5 minutes so the death anim can be observed on the corpse
    // (instead of the brief DEATH_HOLD_MS beat). Revisit once the skeleton death look is dialled in.
    const CORPSE_LINGER_MS = 5 * 60_000;
    this.time.delayedCall(dur + CORPSE_LINGER_MS, () => {
      this.fx.removeCorpse(sprite);
      sprite.destroy();
    });
  }

  /**
   * Player death: freeze the world on a one-shot Death collapse, then restart the scene (the existing
   * "Death = restart" reset — see damagePlayer). Guarded by `playerChar.dying` so a crowd of enemies
   * can't re-enter this each frame. We cancel any active order and clear an in-flight hit-flash, then
   * `playerChar.die()` freezes + plays the collapse; update() holds everything still until the
   * scheduled restart fires (the delayedCall runs on the scene clock, which the test harness drives).
   */
  private killPlayer(): void {
    console.log('player down — restarting'); // the death→restart signal the death spec asserts
    this.cancelAll();
    this.fx.cleanupActorFx(this.player); // clear an in-flight hit-flash so the corpse isn't left mid-squash
    const dur = this.playerChar.die(); // freezes + plays the collapse; returns its duration
    this.time.delayedCall(dur + DEATH_HOLD_MS, () => this.scene.restart());
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

  /** Combat-mode movepad drag: store the drive vector (applied each frame in update(), scaled by
   * effectiveMoveSpeed) — this bypasses the pathfinder/task queue. */
  private onCombatMove(vec: { dx: number; dy: number }): void {
    if (this.mode !== 'combat') return;
    this.combatMoveVec = { dx: vec.dx, dy: vec.dy };
    // Facing follows the movepad's dominant axis (cardinal, not diagonal): a near-axis-aligned
    // drag still has a tiny off-axis component, and Math.sign on that noise would otherwise flip
    // facing diagonal — pointing the attack at an empty tile next to an enemy the player is squarely
    // facing.
    if (vec.dx !== 0 || vec.dy !== 0) {
      this.playerChar.lastFacing =
        Math.abs(vec.dx) >= Math.abs(vec.dy)
          ? { dCol: Math.sign(vec.dx), dRow: 0 }
          : { dCol: 0, dRow: Math.sign(vec.dy) };
    }
  }

  private onCombatMoveEnd(): void {
    this.combatMoveVec = { dx: 0, dy: 0 };
    if (this.mode === 'combat') this.player.body.setVelocity(0, 0);
  }

  /** Inspect-mode tap: raycast the sprite drawn under the point (pickSpriteAt already resolves the
   * enemy-over-tree-over-blueprint priority by draw order) and show that entity's stats panel;
   * empty ground closes any open panel. */
  private inspectAt(x: number, y: number): void {
    const pick = this.pickSpriteAt(x, y);
    if (pick?.kind === 'enemy')
      return void this.game.events.emit('inspect:show', enemyStats(pick.enemy));
    if (pick?.kind === 'tree')
      return void this.game.events.emit('inspect:show', treeStats(pick.tree));
    if (pick?.kind === 'site')
      return void this.game.events.emit('inspect:show', wallStats(pick.site));
    this.game.events.emit('inspect:hide');
  }

  /**
   * Pointer "raycast": the topmost world entity under world point (x,y) — the *rendered sprite* the
   * player sees there, not merely the tile beneath the point. Each candidate is hit either on its
   * logical footprint (a node's foot tile, an enemy's hurtbox tiles, a site's tile — so the base a
   * thing stands on is always a reliable target, even where the art is transparent between the feet)
   * OR on an opaque pixel of its drawn sprite (so a tall base-anchored pine, whose canopy is drawn
   * several tiles above its foot tile, is clickable up its whole trunk — which the old foot-tile
   * hit-test missed). Overlaps resolve the way they're drawn: higher depth wins, ties break on
   * display order (drawn later = on top), so an enemy in front of a tree — or the nearer of two
   * overlapping pines — is the thing you click. Returns null when nothing is under the point (caller
   * falls back to move-to-tile).
   */
  private pickSpriteAt(x: number, y: number): PointerPick | null {
    const col = worldToTile(x);
    const row = worldToTile(y);
    let best: { pick: PointerPick; depth: number; order: number } | null = null;
    const consider = (
      obj: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle,
      pick: PointerPick,
    ): void => {
      const order = this.children.getIndex(obj);
      if (!best || obj.depth > best.depth || (obj.depth === best.depth && order > best.order)) {
        best = { pick, depth: obj.depth, order };
      }
    };
    for (const z of this.enemies) {
      if (!z.alive) continue;
      const footprint = hurtboxContains(
        { col: z.col, row: z.row },
        z.def.hurtbox ?? DEFAULT_HURTBOX,
        { col, row },
      );
      if (footprint || this.alphaHit(z.sprite, x, y))
        consider(z.sprite, { kind: 'enemy', enemy: z });
    }
    for (const t of this.trees) {
      if (!t.alive) continue;
      if ((t.col === col && t.row === row) || this.alphaHit(t.sprite, x, y))
        consider(t.sprite, { kind: 'tree', tree: t });
    }
    for (const s of this.sites) {
      // An unbuilt blueprint is a plain rectangle (no texture) — its filled tile IS its shape, so an
      // on-tile hit is a cover; a finished wall has a sprite, so alpha-test it like any other node.
      const obj = s.visual ?? s.rect;
      const spriteHit = s.visual ? this.alphaHit(s.visual, x, y) : obj.getBounds().contains(x, y);
      if ((s.col === col && s.row === row) || spriteHit) consider(obj, { kind: 'site', site: s });
    }
    return best ? (best as { pick: PointerPick }).pick : null;
  }

  /**
   * Does an opaque pixel of `s`'s sprite cover world point (x,y)? A cheap AABB reject first, then a
   * per-pixel alpha read at the mapped texel — so a click in a pine's transparent canopy padding is
   * not a hit. World sprites here are axis-aligned and scroll with the world (no rotation, default
   * scrollFactor), so the world→texel map is a straight origin/scale/flip transform. Degrades to the
   * AABB hit if the pixel can't be read (e.g. a texture whose source canvas isn't sampleable) rather
   * than silently missing.
   */
  private alphaHit(
    s: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite,
    x: number,
    y: number,
  ): boolean {
    if (!s.getBounds().contains(x, y)) return false;
    let localX = (x - s.x) / s.scaleX + s.displayOriginX;
    let localY = (y - s.y) / s.scaleY + s.displayOriginY;
    if (s.flipX) localX = s.frame.width - localX;
    if (s.flipY) localY = s.frame.height - localY;
    try {
      const alpha = this.textures.getPixelAlpha(
        Math.floor(localX),
        Math.floor(localY),
        s.texture.key,
        s.frame.name,
      );
      return alpha === null ? false : alpha > 0;
    } catch {
      return true; // texture source not sampleable — fall back to the AABB hit already confirmed above
    }
  }

  // --- Resource nodes / harvesting -----------------------------------------

  private spawnTrees(): void {
    // Positioned around the map centre (~22,40) where the player spawns — same layout relative to the
    // player as before the map doubled, so the starting scene stays familiar with room to roam beyond.
    for (const [col, row] of [
      [16, 28],
      [25, 32],
      [19, 40],
    ] as Array<[number, number]>) {
      this.addNode(NODES.tree, col, row);
    }
    // A few rocks around the same camp cluster (near the player spawn ~22,40) so there's a stone
    // source in view and within reach from the start (see plan 008).
    for (const [col, row] of [
      [26, 43],
      [18, 45],
      [28, 36],
    ] as Array<[number, number]>) {
      this.addNode(NODES.rock, col, row);
    }
    // Berry bushes near the camp — the starting food source. Non-blocking, so the worker walks through
    // them (unlike trees/rocks) and forages from an adjacent tile. Fixed tiles so tests can rely on them.
    for (const [col, row] of [
      [21, 43],
      [24, 38],
      [17, 41],
    ] as Array<[number, number]>) {
      this.addNode(NODES.berryBush, col, row);
    }
  }

  /** Spawn one resource node of `def` (tree, rock, …) at a tile; sized/anchored from its own data. */
  private addNode(def: ResourceNodeDef, col: number, row: number): void {
    const { key, frame } = resolveTile(ACTIVE_TILESET.tiles[def.tile]);
    const sprite = this.add
      .image(tileToWorldCenter(col), tileToWorldCenter(row), key, frame)
      .setDepth(1);
    // Each species sizes/anchors itself from its def (critique #2): a pine scales to ~2.6 tiles and
    // anchors near its base so the canopy overhangs up; a rock is ~1 tile, centred. sprite.x/y stay
    // the tile centre, so treeAt()'s distance check is unaffected regardless of scale/origin.
    sprite.setScale(this.nodeScale(sprite, def)).setOrigin(def.originX, def.originY);
    this.trees.push({
      id: `${def.id}-${this.nextTreeId++}`,
      sprite,
      def,
      hp: def.maxHp,
      alive: true,
      col,
      row,
    });
  }

  /** Base display scale for a node image (derived from its source height + the def's `tilesTall`). */
  private nodeScale(sprite: Phaser.GameObjects.Image, def: ResourceNodeDef): number {
    return (TILE_SIZE * def.tilesTall) / sprite.frame.height;
  }

  /**
   * Dev menu: clear the scattered world — every resource node and enemy — then scatter a fresh
   * random batch on empty tiles: a mix of trees/rocks/bushes (trees weighted so wood stays plentiful)
   * plus a pack of enemies. The player's own walls/blueprints are left standing (only `occupied`/`siteTiles`
   * are read, never cleared). Enemies keep a few tiles clear of the player so a randomise never spawns
   * an instant bite. Wired to the dev-menu Randomise button.
   */
  private randomiseWorld(): void {
    this.cancelAll(); // drop harvest orders that reference the nodes we're about to destroy
    for (const t of this.trees) t.sprite.destroy();
    for (const z of this.enemies) {
      this.fx.cleanupActorFx(z.sprite);
      z.weapon?.sprite.destroy();
      z.hands?.main.destroy();
      z.hands?.off.destroy();
      z.sprite.destroy();
    }
    this.trees = [];
    this.enemies = [];

    const pt = this.playerChar.tile();
    const used = new Set<string>([tileKey(pt.col, pt.row)]);
    // Pick a random empty tile (in bounds, not a wall/blueprint/already-used), at least `minPlayerDist`
    // tiles (Chebyshev) from the player. Returns null if it can't find one within the attempt budget.
    const pickTile = (minPlayerDist: number): Cell | null => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const col = Math.floor(Math.random() * this.gridDims.cols);
        const row = Math.floor(Math.random() * this.gridDims.rows);
        const key = tileKey(col, row);
        if (used.has(key) || this.occupied.has(key) || this.siteTiles.has(key)) continue;
        if (Math.max(Math.abs(col - pt.col), Math.abs(row - pt.row)) < minPlayerDist) continue;
        used.add(key);
        return { col, row };
      }
      return null;
    };

    const nodePool = [NODES.tree, NODES.tree, NODES.tree, NODES.rock, NODES.berryBush];
    const nodeCount = 24 + Math.floor(Math.random() * 25); // 24..48
    for (let i = 0; i < nodeCount; i++) {
      const tile = pickTile(0);
      if (!tile) break;
      this.addNode(nodePool[Math.floor(Math.random() * nodePool.length)], tile.col, tile.row);
    }

    const enemyCount = 8 + Math.floor(Math.random() * 9); // 8..16
    for (let i = 0; i < enemyCount; i++) {
      const tile = pickTile(6); // keep enemies clear of the player's tile
      if (!tile) break;
      this.addEnemy('kidZombie', tile.col, tile.row);
    }
  }

  /**
   * Dev menu: flip the day/night clock to the opposite phase of the current in-game day, jumping
   * straight to full daylight / full dark rather than riding the twilight ramp. Stays within the
   * current cycle so the day count doesn't change.
   */
  private toggleDayNight(): void {
    const cycleMs = this.clockMs % cycleLengthMs();
    const cycleStart = this.clockMs - cycleMs; // ms at the start of the current in-game day
    // day -> start of night (full-dark plateau); night -> just past dawn (full daylight, same day).
    this.clockMs = cycleStart + (phaseAt(cycleMs) === 'day' ? DAY_MS : TWILIGHT_MS);
    this.applyClock();
  }

  /**
   * Recompute the night-tint overlay + phase/day from `clockMs` and broadcast `time:changed`. The
   * per-frame survival tick in update() does the same inline but only emits on a phase/day *change* —
   * this forces the update (and re-emit) after a manual clock jump (see toggleDayNight).
   */
  private applyClock(): void {
    const cycleMs = this.clockMs % cycleLengthMs();
    this.nightOverlay.setAlpha(tintAlphaAt(cycleMs));
    this.dayPhase = phaseAt(cycleMs);
    this.dayCount = dayCountForTotal(this.clockMs);
    this.registry.set('dayPhase', this.dayPhase);
    this.registry.set('dayCount', this.dayCount);
    this.game.events.emit('time:changed', {
      phase: this.dayPhase,
      dayCount: this.dayCount,
      cycleMs,
      tNorm: cycleMs / cycleLengthMs(),
    });
  }

  private treeById(id: string): TreeNode | undefined {
    return this.trees.find((t) => t.id === id);
  }

  /** Light "bag full" feedback: a brief warning tint on the node (no new HUD text). */
  private flashBagFull(tree: TreeNode): void {
    if (!tree.alive) return;
    tree.sprite.setTint(COLORS.ghostInvalid);
    this.time.delayedCall(150, () => {
      if (tree.alive) tree.sprite.clearTint();
    });
  }

  private chop(tree: TreeNode): void {
    tree.hp -= 1;
    this.inv.add(tree.def.yieldItemId, tree.def.yieldPerHit);
    // Bump relative to the node's fitted base scale (not an absolute 1 — the pine is scaled down).
    // Animate only the node — its queued glow halo mirrors this (and any future sway/fall) each frame
    // via syncGlowTransforms(), so animations never have to drive the glow themselves.
    const base = this.nodeScale(tree.sprite, tree.def);
    this.tweens.add({ targets: tree.sprite, scale: base * 1.18, duration: 80, yoyo: true });
    if (tree.hp <= 0) {
      tree.alive = false;
      // No dedicated depleted sprite in the pack yet (see docs/ASSETS.md) — tint the felled node to
      // its stumpColor as a stand-in "stump"/rubble state rather than a mismatched placeholder rect.
      tree.sprite.setScale(base).setTint(tree.def.stumpColor);
      this.time.delayedCall(tree.def.regrowMs, () => {
        tree.hp = tree.def.maxHp;
        tree.alive = true;
        tree.sprite.clearTint();
        this.repath(); // regrown tree may now block the active route
      });
    }
  }

  // --- Enemies (minimal idle/chasing AI — see plan 003) ---------------------

  private spawnEnemies(): void {
    this.addEnemy('kidZombie', 22, 50); // ~10 tiles below the map-centre spawn, as before the resize
  }

  private addEnemy(enemyId: string, col: number, row: number, opts?: MonsterSpawnOpts): void {
    this.enemies.push(
      new MonsterCharacter(
        this,
        `enemy-${this.nextEnemyId++}`,
        ENEMIES[enemyId],
        col,
        row,
        this.rng,
        opts,
      ),
    );
  }

  /** Per-frame AI tick for every live monster. The scene builds the shared world snapshot + effect
   *  callbacks (FX via the manager, damage/bus emissions via its own seams); each MonsterCharacter
   *  *executes* its FSM decision (repath/move/contact-bite) — see MonsterCharacter.update. */
  private updateEnemies(): void {
    const pt = this.playerChar.tile();
    const env: MonsterTickEnv = {
      nowMs: this.time.now,
      playerTile: pt,
      playerPos: { x: this.player.x, y: this.player.y },
      playerBodyTiles: hurtboxTiles(pt, this.playerChar.stats.hurtbox ?? DEFAULT_HURTBOX),
      playerStats: this.playerChar.stats,
      dims: this.gridDims,
      isBlocked: this.isBlocked,
      rng: this.rng,
      lungeAt: (m, x, y) => this.fx.lungeAt(m, x, y),
      onPlayerHurt: () => this.onPlayerHurt(),
      damagePlayer: (amount) => this.damagePlayer(amount),
    };
    for (const z of this.enemies) {
      if (!z.alive) continue;
      z.update(env);
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

  /** True if a wall can be blueprinted here: in bounds, empty, off live blocking nodes, and reachable. */
  private tilePlaceable(col: number, row: number): boolean {
    const key = tileKey(col, row);
    if (col < 0 || row < 0 || col >= this.gridDims.cols || row >= this.gridDims.rows) return false;
    if (this.occupied.has(key) || this.siteTiles.has(key)) return false;
    // Only blocking nodes (trees/rocks) veto placement — a non-blocking bush can be built over.
    if (this.trees.some((t) => t.alive && t.def.blocksPath && t.col === col && t.row === row))
      return false;
    // Must have a tile the worker can stand on to build it (Finding 4 — no stranded blueprints).
    return (
      reachableAdjacent(this.playerChar.tile(), { col, row }, this.isBlocked, this.gridDims) !==
      null
    );
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

    const site = this.createBlueprint(col, row);
    this.enqueue({ kind: 'build', siteId: site.id });
  }

  /** Add a passable, unbuilt blueprint at a tile and register its occupancy (shared by real build
   * placement and the DEV-only scenario API). Does NOT spend wood or enqueue — callers do that. */
  private createBlueprint(col: number, row: number): BuildSite {
    const key = tileKey(col, row);
    const rect = this.add
      .rectangle(
        tileToWorldCenter(col),
        tileToWorldCenter(row),
        TILE_SIZE,
        TILE_SIZE,
        COLORS.blueprint,
        0.35,
      )
      .setDepth(1);
    const site: BuildSite = {
      id: `site-${this.nextSiteId++}`,
      col,
      row,
      rect,
      visual: null,
      progress: 0,
      done: false,
    };
    this.sites.push(site);
    this.siteTiles.add(key);
    return site;
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

  // --- DEV-only scenario / fixed-step test API (plan 007) -------------------
  //
  // These build a known world and drive the game deterministically. The `window.game.__test`
  // install that exposes them is DEV-gated in create() so `vite build` dead-code-eliminates it —
  // the methods below ship (unreachable) but the player-facing surface never does. NB the seam only
  // exists under `vite dev` (import.meta.env.DEV === true), which the e2e runner must serve from.

  /**
   * Reset the live world to empty — destroy every tree/enemy/site/marker GameObject and clear all
   * the plain-data queue/occupancy state, mirroring create()'s reset block (which assumes a fresh
   * scene with nothing to destroy). Zeroes inventory + player HP. Called by testApplyScenario before
   * it places the spec's entities, so a scenario never inherits the boot fixtures or a prior run.
   */
  private testResetWorld(): void {
    for (const t of this.trees) t.sprite.destroy();
    for (const z of this.enemies) {
      this.fx.cleanupActorFx(z.sprite);
      z.weapon?.sprite.destroy();
      z.hands?.main.destroy();
      z.hands?.off.destroy();
      z.sprite.destroy();
    }
    for (const s of this.sites) {
      s.visual?.destroy();
      s.rect.destroy();
    }
    for (const m of this.queueMarkers) m.destroy();
    this.walls.clear(false, false); // drop the (now-destroyed) wall-rect refs; children handled above

    this.queue.clear();
    this.trees = [];
    this.nextTreeId = 0;
    this.enemies = [];
    this.nextEnemyId = 0;
    this.sites = [];
    this.siteTiles.clear();
    this.occupied.clear();
    this.nextSiteId = 0;
    this.playerChar.path = [];
    this.playerChar.pathIndex = 0;
    this.actionGoal = null;
    this.chopElapsed = 0;
    this.harvestSwing = null;
    this.playerChar.attackLockUntil = 0;
    this.combatMoveVec = { dx: 0, dy: 0 };
    this.fx.resetCombatFx(); // start each scenario with clean FX counters/flags (see create())
    this.playerChar.dying = false;
    this.buildMode = false;
    this.queueMarkers = [];
    this.outlinedTreeIds.clear();
    this.pointerInput.clearPaintedTiles();
    this.rng = Math.random;

    // Reset survival state so a scenario never inherits a prior run's clock/hunger (testApplyScenario
    // may then re-seed via spec.clockMs/startPhase/hunger). Mirrors create()'s death-restart reset.
    this.clockMs = 0;
    this.dayPhase = 'day';
    this.dayCount = 1;
    this.hunger = HUNGER_MAX;
    this.starveElapsed = 0;

    // Zero the shared Inventory in place (keep the same instance so UIScene's 'change' binding holds).
    const snap = this.inv.snapshot();
    if (Object.keys(snap).length) this.inv.spend(snap);

    this.playerChar.hp = this.playerChar.stats.maxHp;
    this.game.events.emit('player:hpChanged', {
      hp: this.playerChar.hp,
      maxHp: this.playerChar.stats.maxHp,
    });
  }

  /** Construct the world declared by `spec` (see {@link ScenarioSpec}) and return the placed ids. */
  private testApplyScenario(spec: ScenarioSpec): ScenarioResult {
    this.testResetWorld();

    const [pcol, prow] = spec.player ?? [
      Math.floor(this.gridDims.cols / 2),
      Math.floor(this.gridDims.rows / 2),
    ];
    this.player.body.reset(tileToWorldCenter(pcol), tileToWorldCenter(prow));
    this.player.body.setVelocity(0, 0);
    this.playerChar.lastFacing = spec.facing
      ? { ...FACING_DELTAS[spec.facing] }
      : { dCol: 0, dRow: 1 };

    this.mode = spec.mode ?? 'command';
    this.game.events.emit('mode:changed', this.mode);

    const inv = spec.inventory ?? (spec.wood != null ? { wood: spec.wood } : {});
    for (const [id, n] of Object.entries(inv)) if (n > 0) this.inv.add(id, n);

    const treeIds: string[] = [];
    for (const [c, r] of spec.trees ?? []) {
      this.addNode(NODES.tree, c, r);
      treeIds.push(this.trees[this.trees.length - 1].id);
    }

    const rockIds: string[] = [];
    for (const [c, r] of spec.rocks ?? []) {
      this.addNode(NODES.rock, c, r);
      rockIds.push(this.trees[this.trees.length - 1].id);
    }

    const bushIds: string[] = [];
    for (const [c, r] of spec.bushes ?? []) {
      this.addNode(NODES.berryBush, c, r);
      bushIds.push(this.trees[this.trees.length - 1].id);
    }

    for (const [c, r] of spec.walls ?? []) this.finishSite(this.createBlueprint(c, r));

    const siteIds: string[] = [];
    for (const [c, r] of spec.blueprints ?? []) siteIds.push(this.createBlueprint(c, r).id);

    const enemyIds: string[] = [];
    for (const z of spec.enemies ?? []) {
      const at = Array.isArray(z) ? z : z.at;
      const id = Array.isArray(z) ? 'kidZombie' : (z.id ?? 'kidZombie');
      const opts = Array.isArray(z)
        ? undefined
        : {
            patrolRoute: z.patrolRoute?.map(([c, r]) => ({ col: c, row: r })),
            mode: z.mode,
            weaponId: z.weaponId,
          };
      this.addEnemy(id, at[0], at[1], opts);
      enemyIds.push(this.enemies[this.enemies.length - 1].id);
    }

    if (spec.rng) this.rng = spec.rng;

    // Seed survival state (plan 004). clockMs wins over startPhase; both drive the derived phase/day
    // + the night-overlay alpha so a pre-step debugState() reflects the seed (update() reconciles the
    // rest on the first driven step). hunger is clamped into [0, HUNGER_MAX].
    if (spec.clockMs != null) this.clockMs = spec.clockMs;
    else if (spec.startPhase != null) this.clockMs = spec.startPhase === 'night' ? DAY_MS : 0;
    if (spec.clockMs != null || spec.startPhase != null) {
      const cycleMs = this.clockMs % cycleLengthMs();
      this.dayPhase = phaseAt(cycleMs);
      this.dayCount = dayCountForTotal(this.clockMs);
      this.nightOverlay.setAlpha(tintAlphaAt(cycleMs));
      this.registry.set('dayPhase', this.dayPhase);
      this.registry.set('dayCount', this.dayCount);
    }
    if (spec.hunger != null) {
      this.hunger = Math.max(0, Math.min(HUNGER_MAX, spec.hunger));
      this.registry.set('hunger', this.hunger);
    }

    this.updateVision();
    this.emitTasks();
    return { treeIds, rockIds, bushIds, enemyIds, siteIds };
  }

  /**
   * Advance gameplay by `ms` in fixed 1/60s slices, deterministically. Stops the RAF game loop and
   * drives `game.step(clock, fixedDelta)` itself — this runs each scene's update → Arcade physics →
   * clock → tweens → timers, so movement/chop/build/contact-cooldown/regrow all resolve with zero
   * wall-clock (a manual `scene.update()` would NOT advance physics/clock/timers — see plan 007 B1).
   */
  private testStep(ms: number): void {
    const fixed = 1000 / 60;
    if (this.game.loop.running) this.game.loop.stop();
    if (this.testClock === 0) this.testClock = this.time.now;
    const steps = Math.max(1, Math.round(ms / fixed));
    for (let i = 0; i < steps; i++) {
      this.testClock += fixed;
      this.game.step(this.testClock, fixed);
    }
  }

  /** Inspect the entity at a tile (drives the same panel path as an Inspect-mode tap). */
  private testInspect(col: number, row: number): void {
    this.inspectAt(tileToWorldCenter(col), tileToWorldCenter(row));
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
    px: number;
    py: number;
    enemies: number;
    enemyModes: MonsterMode[];
    enemyTiles: { col: number; row: number }[];
    enemyWeapons: (string | null)[];
    corpses: number;
    playerHp: number;
    playerDying: boolean;
    playerFlash: number;
    playerHitFlashes: number;
    enemyHitFlashes: number;
    enemyAttacks: number;
    mode: 'command' | 'combat' | 'inspect';
    hunger: number;
    dayPhase: DayPhase;
    dayCount: number;
    clockMs: number;
    nightAlpha: number;
    outlinedTreeIds: string[];
    pulsingTreeId: string | null;
    queuedTreeIds: string[];
  } {
    const t = this.playerChar.tile();
    return {
      currentKind: this.queue.current?.kind ?? null,
      pending: this.queue.pending,
      pathLen: Math.max(0, this.playerChar.path.length - this.playerChar.pathIndex),
      sites: this.sites.length,
      buildMode: this.buildMode,
      occupied: this.occupied.size,
      pcol: t.col,
      prow: t.row,
      px: this.player.x,
      py: this.player.y,
      enemies: this.enemies.filter((z) => z.alive).length,
      enemyModes: this.enemies.filter((z) => z.alive).map((z) => z.ai.mode),
      // Live enemy tiles (spec order) — patrol mode never leaves 'patrol', so waypoint cycling is
      // only observable via position; the monster.spec patrol test reads this.
      enemyTiles: this.enemies.filter((z) => z.alive).map((z) => ({ col: z.col, row: z.row })),
      // Equipped weapon id per live enemy (null = unarmed) — lets a combat spec confirm the rolled/forced weapon.
      enemyWeapons: this.enemies.filter((z) => z.alive).map((z) => z.weapon?.id ?? null),
      corpses: this.fx.getCorpseCount(),
      playerHp: this.playerChar.hp,
      playerDying: this.playerChar.dying,
      playerFlash: this.fx.getPlayerFlash(),
      playerHitFlashes: this.fx.getPlayerHitFlashes(),
      enemyHitFlashes: this.fx.getEnemyHitFlashes(),
      enemyAttacks: this.fx.getEnemyAttacks(),
      mode: this.mode,
      hunger: this.hunger,
      dayPhase: this.dayPhase,
      dayCount: this.dayCount,
      clockMs: this.clockMs,
      nightAlpha: this.nightOverlay.alpha,
      outlinedTreeIds: [...this.outlinedTreeIds],
      pulsingTreeId: this.headHarvestTreeId(),
      queuedTreeIds: this.queue
        .all()
        .filter((a): a is Extract<Action, { kind: 'harvest' }> => a.kind === 'harvest')
        .map((a) => a.treeId),
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
   * Baked into RenderTextures rather than ~900 separate tile images. Individually-placed frames
   * of a shared spritesheet bleed at fractional zoom (e.g. 150%): a 16px source tile scaled to 24px
   * samples just past its atlas cell and picks up a neighbouring (dark) frame, showing as thin
   * vertical seams that crawl as the camera scrolls. Baked side-by-side at integer 1:1, every tile's
   * neighbour is the actual adjacent grass — no cross-frame bleed, and one object means no inter-tile
   * gaps either. The camera then scales the baked texture, which nearest-samples cleanly.
   *
   * The bake is split into vertical chunks of `GROUND_CHUNK_ROWS` tile-rows (stacked, tile-aligned,
   * drawn 1:1 so their edges are seamless adjacent grass). A single map-tall texture (1280px after
   * the map doubled) grew faint evenly-spaced dark horizontal lines toward the bottom on real mobile
   * GPUs — a NEAREST-at-`mediump` texel-rounding artifact whose error grows with texture height.
   * Capping chunk height keeps that error sub-texel so no row is mis-sampled. See GROUND_CHUNK_ROWS.
   */
  private drawGround(): void {
    const groundVariants = ACTIVE_TILESET.tiles.ground.map((g) => ({
      ...resolveTile(g.source),
      weight: g.weight,
    }));
    const cols = Math.ceil(MAP_WIDTH / TILE_SIZE);
    const rows = Math.ceil(MAP_HEIGHT / TILE_SIZE);
    for (let startRow = 0; startRow < rows; startRow += GROUND_CHUNK_ROWS) {
      const chunkRows = Math.min(GROUND_CHUNK_ROWS, rows - startRow);
      const rt = this.add
        .renderTexture(0, startRow * TILE_SIZE, cols * TILE_SIZE, chunkRows * TILE_SIZE)
        .setOrigin(0, 0)
        .setDepth(0);
      // Batch each chunk's tile draws into ONE flush (beginDraw…endDraw). A per-tile drawFrame()
      // flushes the GPU each call — fine at ~900 tiles, but the doubled map is cols*rows ≈ 3600, and
      // per-call flushes on the headless software renderer took ~25s. Batched, it's one pass per chunk.
      rt.beginDraw();
      for (let row = 0; row < chunkRows; row++) {
        for (let col = 0; col < cols; col++) {
          const pick = pickWeighted(groundVariants);
          rt.batchDrawFrame(pick.key, pick.frame, col * TILE_SIZE, row * TILE_SIZE);
        }
      }
      rt.endDraw();
      rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST); // crisp pixels when the camera scales it
    }
  }

  /** Redraw the vision-radius mask shape at the character's current position. */
  /** Redraws the vision-radius mask shape, and hides/shows dynamic actors by distance to it —
   * unlike static world content (dimmed by the terrain fog above), an actor outside vision is
   * fully invisible. Only the player exists to apply this to today; the same one-line check is
   * the pattern for any future monster/NPC sprite. */
  private updateVision(): void {
    this.fogShape.clear();
    this.fogShape.fillStyle(0xffffff);
    this.fogShape.fillCircle(
      this.player.x,
      this.player.y,
      this.playerChar.stats.vision ?? PLAYER_START_VISION,
    );
    this.player.setVisible(this.inVisionRange(this.player.x, this.player.y));
  }

  /** True if a world point is within the character's vision radius (see fog of war above). */
  private inVisionRange(x: number, y: number): boolean {
    return (
      Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) <=
      (this.playerChar.stats.vision ?? PLAYER_START_VISION)
    );
  }
}
