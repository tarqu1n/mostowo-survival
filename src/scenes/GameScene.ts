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
  DRAG_PX,
  RENDER_SCALE,
  COLORS,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_ZOOM,
  ZOOM_STORAGE_KEY,
  PLAYER_MAX_HP,
  PLAYER_START_SPEED,
  PLAYER_START_VISION,
  UNARMED_BASE_DAMAGE,
  ATTACK_MOVE_SLOW,
  CONTACT_DAMAGE_COOLDOWN_MS,
  HIT_FLASH_MS,
  HIT_FLASH_PEAK,
  HIT_FLASH_SQUASH,
  HIT_FLASH_TINT,
  PLAYER_HIT_SHAKE_MS,
  PLAYER_HIT_SHAKE_INTENSITY,
  ENEMY_HIT_SHAKE_MS,
  ENEMY_HIT_SHAKE_INTENSITY,
  ENEMY_LUNGE_PX,
  ENEMY_LUNGE_MS,
  WEAPON_SWING_ARC_DEG,
  WEAPON_SWING_MS,
  WEAPON_SWING_SCALE_POP,
  MONSTER_CHASE_DROP_RADIUS_PX,
  MONSTER_VEER_BAND_PX,
  MONSTER_VEER_MAX_TILES,
  MONSTER_REPATH_MS,
  MONSTER_IDLE_MS_MIN,
  MONSTER_IDLE_MS_MAX,
  MONSTER_WANDER_RADIUS_TILES,
  MONSTER_PATROL_PAUSE_MS,
  DEATH_ANIM_FRAMERATE,
  DEATH_HOLD_MS,
  INVENTORY_SLOTS,
  DEFAULT_MAX_STACK,
  PLAYER_HURTBOX,
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
import { MONSTER_WEAPONS, type MonsterWeapon } from '../data/weapons';
import type { ResourceNodeDef, CombatantStats, EnemyDef } from '../data/types';
import { Inventory } from '../systems/Inventory';
import { worldToTile, tileToWorldCenter, snapToTileCenter, tileKey } from '../systems/grid';
import { findPath, reachableAdjacent, type Cell } from '../systems/pathfind';
import { TaskQueue, type Action } from '../systems/tasks';
import { cycleLengthMs, phaseAt, tintAlphaAt, dayCountForTotal, type DayPhase } from '../systems/daynight';
import { drainHunger, feed, isStarving } from '../systems/needs';
import { resolveMeleeAttack } from '../systems/combat';
import { stepMonster, initialMonsterState, type MonsterState, type MonsterMode } from '../systems/monsterAI';
import { weaponTransform } from '../systems/attachment';
import { hurtboxContains, hurtboxTiles, DEFAULT_HURTBOX } from '../systems/hurtbox';
import { bakeGlowTexture } from '../render/glowTexture';
import { HIT_FLASH_KEY, type HitFlashPipeline } from '../render/hitFlashPipeline';
import { treeStats, wallStats, enemyStats } from '../systems/stats';
import type { UIScene } from './UIScene';
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
  type ActorRender,
  type AttachPoint,
} from '../data/tileset';

/** Queued-node glow reach on screen (px). Converted to source texels per species so the baked halo
 *  reads the same regardless of a sprite's source resolution — see refreshQueueHighlights. */
const GLOW_SCREEN_PX = 5;

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

/** A live enemy instance in the world — driven by the pure FSM in systems/monsterAI (plans 003, 011). */
export interface EnemyUnit {
  id: string;
  sprite: Phaser.GameObjects.Sprite & { body: Phaser.Physics.Arcade.Body };
  def: EnemyDef;
  hp: number;
  alive: boolean;
  col: number;
  row: number;
  /** Persisted AI state — read+returned by stepMonster each tick (repath timing lives inside it). */
  ai: MonsterState;
  lastContactAt: number;
  path: Cell[];
  pathIndex: number;
  /** Which render footprint the sprite is currently showing (`walk` 64px vs the `idle` 32px bob) —
   *  so `updateEnemyAnim` only swaps scale/origin/body on an actual state change (see setEnemyFootprint). */
  activeStrip: 'idle' | 'walk';
  /** The rolled-per-spawn held weapon (Phase B), or undefined = unarmed. `sprite` is a plain image
   *  (no physics body) pinned to the hand each tick; `def` owns its damage/cadence; `swingRot` is the
   *  live coded-swing angle (deg) tweened on each bite. */
  weapon?: { id: string; sprite: Phaser.GameObjects.Image; def: MonsterWeapon; swingRot: number };
  /** The two visible fists layered on the skeleton (its own hands are unreadable nubs). Always present,
   *  armed or not: `main` pins to the mainHand anchor (grips the weapon, drawn over it), `off` to the
   *  offHand anchor (free). Plain images, no physics; pinned each tick in syncEnemyAttachments. */
  hands?: { main: Phaser.GameObjects.Image; off: Phaser.GameObjects.Image };
}

/**
 * What a pointer "raycast" landed on: the specific world entity whose *rendered sprite* is drawn
 * under the point (see {@link GameScene.pickSpriteAt}). `null` (the absence of a pick) means empty
 * ground — no interactive sprite there — and the caller falls back to a plain move-to-tile.
 */
export type PointerPick =
  | { kind: 'tree'; tree: TreeNode }
  | { kind: 'enemy'; enemy: EnemyUnit }
  | { kind: 'site'; site: BuildSite };

/** Cardinal facing shorthand for {@link ScenarioSpec}, mapped to `lastFacing` deltas below. */
export type FacingSpec = 'up' | 'down' | 'left' | 'right';

const FACING_DELTAS: Record<FacingSpec, { dCol: number; dRow: number }> = {
  up: { dCol: 0, dRow: -1 },
  down: { dCol: 0, dRow: 1 },
  left: { dCol: -1, dRow: 0 },
  right: { dCol: 1, dRow: 0 },
};

/**
 * Declarative world spec for the test-only scenario API (plan 007). Every field is optional so a
 * test constructs only what it needs (`{ player:[3,3], trees:[[5,3]] }`). Coordinates are tile
 * (col,row). `enemies` entries default to `kidZombie`; `walls` are built solid, `blueprints`
 * passable-and-unbuilt. `rng`/`wood` pin combat + inventory determinism. `hunger`/`clockMs`/
 * `startPhase` seed the survival state (plan 004) so day/night + hunger scenarios start at a known
 * point (`clockMs` wins over `startPhase`; `startPhase:'night'` = start of night, i.e. `clockMs=DAY_MS`).
 * `bushes` are forageable, non-blocking berry bushes. See __test.applyScenario.
 */
export interface ScenarioSpec {
  player?: [number, number];
  facing?: FacingSpec;
  mode?: 'command' | 'combat' | 'inspect';
  wood?: number;
  inventory?: Record<string, number>;
  trees?: Array<[number, number]>;
  rocks?: Array<[number, number]>;
  bushes?: Array<[number, number]>;
  enemies?: Array<
    | [number, number]
    | {
        at: [number, number];
        id?: string;
        patrolRoute?: Array<[number, number]>;
        mode?: MonsterMode;
        /** Force the spawned weapon (else rolled from the enemy's pool) — for deterministic combat specs. */
        weaponId?: string;
      }
  >;
  walls?: Array<[number, number]>;
  blueprints?: Array<[number, number]>;
  rng?: () => number;
  hunger?: number;
  clockMs?: number;
  startPhase?: DayPhase;
}

/** Ids of the entities {@link ScenarioSpec} placed, in spec order, so a test can reference them. */
export interface ScenarioResult {
  treeIds: string[];
  rockIds: string[];
  bushIds: string[];
  enemyIds: string[];
  siteIds: string[];
}

/** The DEV-only debug surface installed at `window.game.__test` (see GameScene.create). */
export interface GameTestApi {
  applyScenario(spec: ScenarioSpec): ScenarioResult;
  step(ms: number): void;
  setRng(fn: () => number): void;
  state(): ReturnType<GameScene['debugState']>;
  order(a: Action): void;
  enqueue(a: Action): void;
  inspect(col: number, row: number): void;
  blocked(col: number, row: number): boolean;
}

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
  private player!: Phaser.GameObjects.Sprite & { body: Phaser.Physics.Arcade.Body };

  // Combat: stats bag + separate runtime HP (mirrors the def/runtime-hp split used for trees),
  // facing (for the attack — see Step 5/6), reset in create() so a death-restart starts fresh.
  private playerStats!: CombatantStats;
  private playerHp = 0;
  private lastFacing = { dCol: 0, dRow: 1 };

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
  private enemies: EnemyUnit[] = [];
  private nextEnemyId = 0;

  private readonly queue = new TaskQueue();
  private path: Cell[] = [];
  private pathIndex = 0;
  private actionGoal: Cell | null = null; // the tile we're currently pathing to (for re-pathing)
  private chopElapsed = 0;
  // Action-swing anim state: `harvestSwing` is set each frame the worker is harvesting in place —
  // 'chop' (axe) for a tree, 'mine' (pickaxe) for a rock, 'gather' (Collect forage) for a bush — and
  // drives that looping animation; null when not harvesting. `attackLockUntil` is the scene-clock time
  // until which the one-shot attack (sword) swing owns the sprite (updatePlayerAnim yields to it — see
  // attack()).
  private harvestSwing: 'chop' | 'mine' | 'gather' | null = null;
  private attackLockUntil = 0;
  // Latest Combat-mode movepad vector (analog: |v| ≤ 1). The movepad only emits on press/drag, not per
  // frame, so update() re-applies velocity from this each frame — that's what lets the attack-slow
  // (see effectiveMoveSpeed) take hold and release mid-hold without the player needing to nudge the pad.
  private combatMoveVec = { dx: 0, dy: 0 };

  // Combat hit feedback (see flashHit / enemyLungeAt). Actors flash red + squash-flinch on a landed
  // hit, and an enemy lunges toward its target when it bites (no attack strip ships for the skeleton).
  // Tweens are tracked per actor sprite so a rapid re-hit restarts cleanly and a killed/destroyed
  // sprite can be torn down (its tweens target plain objects but poke the sprite, so they must stop
  // before destroy). `hitFlashOn` is the set of sprites currently carrying the WebGL flash pipeline.
  private readonly hitFlashTweens = new Map<Phaser.GameObjects.Sprite, Phaser.Tweens.Tween>();
  private readonly lungeTweens = new Map<Phaser.GameObjects.Sprite, Phaser.Tweens.Tween>();
  // Weapon-swing tweens keyed by the WIELDER sprite (so cleanupActorFx(enemySprite) can stop one
  // mid-swing before the weapon image is destroyed — the tween pokes the weapon each frame).
  private readonly weaponSwingTweens = new Map<Phaser.GameObjects.Sprite, Phaser.Tweens.Tween>();
  private readonly hitFlashOn = new Set<Phaser.GameObjects.Sprite>();
  // Enemy sprites out of the AI set but lingering to play their one-shot death collapse before the
  // corpse is removed. Tracked so debugState can report them (proves removal waits for the animation).
  private readonly corpses = new Set<Phaser.GameObjects.Sprite>();
  // Live player flash intensity (0..1) + cumulative FX counters, surfaced via debugState so Tier-2
  // scenarios can assert hit/attack feedback fired without inspecting the (shader-driven) sprite.
  private playerFlash = 0;
  private playerHitFlashes = 0;
  private enemyHitFlashes = 0;
  private enemyAttacks = 0;
  // True from the moment the player's HP hits 0 until the death-anim beat ends and the scene restarts.
  // Freezes the world (see update()) and swallows further damage so a crowd can't re-trigger death.
  private playerDying = false;

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
  private userZoom = DEFAULT_ZOOM; // the user-facing zoom level (100/200/300%); camera scale is this × RENDER_SCALE
  private gridDims = { cols: Math.floor(MAP_WIDTH / TILE_SIZE), rows: Math.floor(MAP_HEIGHT / TILE_SIZE) };
  private downScreen = new Phaser.Math.Vector2(); // pointerdown position in screen/base-canvas px
  private downOnUI = false;
  private sawPointerDown = false; // this scene observed the press; guards against a leaked pointerup (see onPointerUp)
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
    this.enemies = [];
    this.nextEnemyId = 0;
    this.sites = [];
    this.siteTiles.clear();
    this.occupied.clear();
    this.nextSiteId = 0;
    this.path = [];
    this.pathIndex = 0;
    this.actionGoal = null;
    this.chopElapsed = 0;
    this.harvestSwing = null;
    this.attackLockUntil = 0;
    this.combatMoveVec = { dx: 0, dy: 0 };
    // Combat-FX state — clear so a death-restart starts clean: the maps/set held tweens+sprites from
    // the dead run (Phaser destroyed them on teardown, so drop the stale references), and `playerDying`
    // must reset or the fresh player would stay frozen from the previous death (see killPlayer/update).
    this.resetCombatFx();
    this.buildMode = false;
    this.sawPointerDown = false; // fields persist across scene.restart(); clear so a press interrupted by death can't resolve post-restart
    this.queueMarkers = [];
    this.outlinedTreeIds.clear();
    this.glowSprites.clear(); // scene teardown destroys the GameObjects; drop our stale references
    this.glowPulse = undefined;
    this.paintedThisGesture.clear();
    this.lastFacing = { dCol: 0, dRow: 1 };
    this.mode = 'command';
    // Survival state — reset so a death-restart begins a fresh Day 1 at full hunger (these are plain-data
    // fields; without an explicit reset they'd carry the dead run's values, e.g. hunger stuck at 0).
    this.clockMs = 0;
    this.dayPhase = 'day';
    this.dayCount = 1;
    this.hunger = HUNGER_MAX;
    this.starveElapsed = 0;

    this.playerStats = {
      maxHp: PLAYER_MAX_HP,
      armour: 0,
      speed: PLAYER_START_SPEED,
      vision: PLAYER_START_VISION,
      strength: 0,
      dex: 0,
      dodge: 0,
      hurtbox: PLAYER_HURTBOX,
    };
    this.playerHp = this.playerStats.maxHp;
    // Seed survival state onto the registry so UIScene (Wellbeing screen) re-reads it on a scene
    // restart. playerStats is combat's private stat bag surfaced here for the Wellbeing stat rows.
    this.registry.set('hunger', this.hunger);
    this.registry.set('playerStats', this.playerStats);

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
    (['idle', 'walk', 'chop', 'mine', 'gather', 'attack', 'death'] as PlayerState[]).forEach((state) => {
      const isAction = state === 'chop' || state === 'mine' || state === 'attack';
      const oneShot = state === 'attack' || state === 'death'; // play once and hold the last frame
      (['down', 'side', 'up'] as Facing[]).forEach((facing) => {
        const key = playerAnimKey(state, facing);
        if (this.anims.exists(key)) return;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(key, { start: 0, end: playerActor[state][facing].frames - 1 }),
          frameRate: state === 'death' ? DEATH_ANIM_FRAMERATE : isAction ? ACTION_ANIM_FRAMERATE : 10,
          repeat: oneShot ? 0 : -1,
        });
      });
    });
    // Enemy (skeleton): a single Run strip (frame 0 doubles as the idle pose, flipped by movement-x —
    // the mob sheets ship no directional variants) plus a one-shot Death collapse played on kill.
    if (!this.anims.exists(enemyWalkKey)) {
      this.anims.create({
        key: enemyWalkKey,
        frames: this.anims.generateFrameNumbers(enemyWalkKey, { start: 0, end: enemyActor.walk.frames - 1 }),
        frameRate: 10,
        repeat: -1,
      });
    }
    if (!this.anims.exists(enemyIdleKey)) {
      this.anims.create({
        key: enemyIdleKey,
        frames: this.anims.generateFrameNumbers(enemyIdleKey, { start: 0, end: enemyActor.idle.frames - 1 }),
        frameRate: 6, // slow, gentle breathing bob
        repeat: -1,
      });
    }
    if (!this.anims.exists(enemyDeathKey)) {
      this.anims.create({
        key: enemyDeathKey,
        frames: this.anims.generateFrameNumbers(enemyDeathKey, { start: 0, end: enemyActor.death.frames - 1 }),
        frameRate: DEATH_ANIM_FRAMERATE,
        repeat: 0,
      });
    }
    const p = this.add.sprite(MAP_WIDTH / 2, MAP_HEIGHT / 2, playerAnimKey('idle', 'down'));
    this.physics.add.existing(p);
    this.player = p as typeof this.player;
    this.player.setDepth(10).setScale(playerActor.render.scale).setOrigin(playerActor.render.originX, playerActor.render.originY);
    this.player.setData('baseScale', playerActor.render.scale); // rest scale the flinch squash returns to
    this.player.body.setCollideWorldBounds(true);
    this.fitActorBody(this.player, playerActor.render);
    this.physics.world.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);

    // Camera follows the player. The map is larger than the viewport at every zoom, so the camera
    // always has scroll room and tracks the player. Instant (no lerp smoothing): this is a precision
    // tap-to-target game, so the camera should never lag behind where the player actually is.
    // centerOn avoids a visible pan-in from (0,0) on the first frame. A manual drag breaks this lock
    // (free look); the HUD's FOLLOW button re-engages it.
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
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
    this.add.rectangle(MAP_WIDTH / 2, MAP_HEIGHT / 2, MAP_WIDTH, MAP_HEIGHT, 0x000000, 0.2).setDepth(5).setMask(fogMask);
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
    this.game.events.on('debug:randomise', this.randomiseWorld, this); // dev menu: scatter nodes + enemies
    this.game.events.on('debug:toggleTime', this.toggleDayNight, this); // dev menu: flip day/night
    this.game.events.on('zoom:delta', this.adjustZoom, this);
    this.game.events.on('camera:center', this.centerOnPlayer, this);
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
      this.game.events.off('zoom:delta', this.adjustZoom, this);
      this.game.events.off('camera:center', this.centerOnPlayer, this);
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
    if (this.playerDying) {
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
      this.game.events.emit('time:changed', { phase, dayCount, cycleMs, tNorm: cycleMs / cycleLengthMs() });
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
        const speed = this.effectiveMoveSpeed();
        this.player.body.setVelocity(this.combatMoveVec.dx * speed, this.combatMoveVec.dy * speed);
      } else {
        this.player.body.setVelocity(0, 0);
      }
      this.updatePlayerAnim();
      this.updateVision();
      this.updateEnemies();
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
    this.physics.moveTo(this.player, wx, wy, this.effectiveMoveSpeed());
    return false;
  }

  /** The player's current move speed, cut to {@link ATTACK_MOVE_SLOW} of `playerStats.speed` while a
   * swing is in progress (the attack-lock window) so attacking commits you in place. Drives both the
   * pathfinder ({@link advancePath}) and the Combat-mode movepad ({@link update}). */
  private effectiveMoveSpeed(): number {
    const attacking = this.time.now < this.attackLockUntil;
    return this.playerStats.speed * (attacking ? ATTACK_MOVE_SLOW : 1);
  }

  /**
   * Directional player animation from `lastFacing`. Priority: a one-shot attack (sword) swing owns
   * the sprite until it finishes (we yield, leaving its frames to play); else the looping harvest
   * swing (`harvestSwing`: chop/axe on a tree, mine/pickaxe on a rock) while working in place; else
   * walk while translating / idle when still. Side art faces right, so left is the same strip
   * mirrored with flipX; down/up clear flipX.
   */
  private updatePlayerAnim(): void {
    if (this.playerDying) return; // death collapse owns the sprite until the restart
    if (this.time.now < this.attackLockUntil) return; // attack swing in progress — don't stomp it
    const facing = this.facingDir();
    const state: PlayerState = this.harvestSwing ?? (this.player.body.velocity.lengthSq() > 1 ? 'walk' : 'idle');
    this.player.setFlipX(facing === 'side' && this.lastFacing.dCol < 0);
    this.player.anims.play(playerAnimKey(state, facing), true);
  }

  /** Play the one-shot attack swing in the current facing and lock updatePlayerAnim out for its
   * duration (so an attack reads fully even while moving). Re-pressing restarts it. */
  private playAttackSwing(): void {
    const facing = this.facingDir();
    this.player.setFlipX(facing === 'side' && this.lastFacing.dCol < 0);
    const key = playerAnimKey('attack', facing);
    this.player.anims.play(key); // no ignoreIfPlaying → a rapid re-press restarts the swing
    this.attackLockUntil = this.time.now + (this.anims.get(key)?.duration ?? 300);
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
      // Bag can't accept this node's yield → don't even start the walk-and-swing; abort the order.
      if (!this.inv.canAccept(tree.def.yieldItemId, tree.def.yieldPerHit)) {
        this.flashBagFull(tree);
        return this.completeCurrent();
      }
      const target = { col: tree.col, row: tree.row };
      // Prefer this species' stand tiles (a tall tree restricts to its base, never up in the canopy);
      // fall back to any adjacent tile if those are walled off. A rock omits standOffsets → all-adjacent.
      const stand =
        reachableAdjacent(this.playerTile(), target, this.isBlocked, this.gridDims, tree.def.standOffsets) ??
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
    const radius = Phaser.Math.Clamp(Math.round(GLOW_SCREEN_PX / this.nodeScale(tree.sprite, tree.def)), 2, 16);
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
    // If the bag can no longer accept this node's yield, abort the order rather than swing forever on
    // a node we can never fell (critique #1): the task only completes at hp<=0, so skipping the hit
    // alone would jam the queue head. Aborting clears it and frees any orders queued behind it.
    if (!this.inv.canAccept(tree.def.yieldItemId, tree.def.yieldPerHit)) {
      this.flashBagFull(tree);
      return this.completeCurrent();
    }
    if (this.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.faceTile(tree.col, tree.row); // swing toward the node, whatever side we stood on
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

  /** HUD hit-test in design space. Raw pointer coords live in the device-scaled backing store, but
   * the HUD is authored in BASE_WIDTH×BASE_HEIGHT units — divide by RENDER_SCALE to line them up. */
  private pointerOnHud(pointer: Phaser.Input.Pointer): boolean {
    return this.ui.hudHitTest(pointer.x / RENDER_SCALE, pointer.y / RENDER_SCALE);
  }

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
    this.sawPointerDown = true; // a genuine press this scene owns — its paired pointerup may now resolve
    this.downOnUI = this.pointerOnHud(pointer);
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
      if (this.pinchDist > 0) this.setZoom(this.userZoom * (dist / this.pinchDist));
      this.pinchDist = dist;
      return;
    }
    if (this.buildMode) {
      if (!this.pointerOnHud(pointer)) this.updateGhost(pointer);
      return;
    }
    // Combat mode: the movepad (tracked independently in UIScene) owns all dragging. A world drag
    // must never fall through to the camera-pan below — steering the movepad drags the thumb off the
    // small pad, and without this gate that off-pad travel panned the world and broke the follow-lock,
    // yanking the camera around whenever the player changed direction.
    if (this.mode === 'combat') return;
    if (!pointer.isDown || this.downOnUI || this.pointerOnHud(pointer)) return;

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

    // downScreen and pointer are backing-store px (device-scaled); DRAG_PX is a design-space distance.
    if (!this.isPanning && Phaser.Math.Distance.Between(this.downScreen.x, this.downScreen.y, pointer.x, pointer.y) > DRAG_PX * RENDER_SCALE) {
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
    // A pointerup with no matching pointerdown seen by this scene is a foreign/leaked event: MainMenu
    // starts the Game scene on pointerdown, so the paired release lands on this freshly-created scene
    // and would otherwise resolve as a stray move order on the map. Never act on it. (Reset so a second
    // leaked release also no-ops.)
    if (!this.sawPointerDown) return;
    this.sawPointerDown = false;
    if (this.buildMode || this.downOnUI || this.pointerOnHud(pointer)) return;
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
    // A tap on a tree queues it: it falls in behind the current job (or starts at once if the worker
    // is idle) instead of interrupting an in-progress harvest — chopping is the loop you batch up, so
    // tapping tree after tree should build a chop list, not keep re-targeting. A tap on the ground
    // still redirects the worker now (act-now move); a held-still long-press queues either kind.
    if (action.kind === 'harvest' || pointer.getDuration() >= LONGPRESS_MS) this.enqueue(action);
    else this.order(action); // quick tap on the ground = move now
  }

  /** The order implied by a world point: harvest the live tree whose sprite is drawn under it (see
   * pickSpriteAt — the raycast, not the foot tile), else move to that tile. A pick that isn't a tree
   * (an enemy, a blueprint — neither is a Command-mode harvest target) also falls through to move. */
  private actionAt(x: number, y: number): Action {
    const pick = this.pickSpriteAt(x, y);
    if (pick?.kind === 'tree') return { kind: 'harvest', treeId: pick.tree.id };
    return { kind: 'move', col: worldToTile(x), row: worldToTile(y) };
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
   * "Death = restart" — no in-place heal, since that let an adjacent enemy immediately re-hit a
   * "reset" player). */
  private damagePlayer(amount: number): void {
    if (this.playerDying) return; // already collapsing — ignore further bites/starve ticks until restart
    this.playerHp = Math.max(0, this.playerHp - amount);
    this.game.events.emit('player:hpChanged', { hp: this.playerHp, maxHp: this.playerStats.maxHp });
    if (this.playerHp <= 0) this.killPlayer();
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
  private enemyAt(col: number, row: number): EnemyUnit | undefined {
    const target = { col, row };
    return this.enemies.find(
      (z) => z.alive && hurtboxContains({ col: z.col, row: z.row }, z.def.hurtbox ?? DEFAULT_HURTBOX, target),
    );
  }

  /** Attack the facing tile: flat damage via the shared combat formula, no range/arc beyond that
   * tile — but an enemy is hit anywhere its hurtbox reaches it (see enemyAt). Enemies only; trees
   * keep using chop(). */
  private attack(): void {
    this.playAttackSwing(); // swing on every press, even a whiff, so the input always feels heard
    const pt = this.playerTile();
    const col = pt.col + this.lastFacing.dCol;
    const row = pt.row + this.lastFacing.dRow;
    const enemy = this.enemyAt(col, row);
    if (!enemy) return;
    const dmg = resolveMeleeAttack(this.playerStats, enemy.def, UNARMED_BASE_DAMAGE, this.rng);
    enemy.hp -= dmg;
    if (enemy.hp <= 0) {
      this.killEnemy(enemy); // play the death collapse, then remove the corpse
    } else if (dmg > 0) {
      this.flashHit(enemy.sprite); // red flash + flinch on a hit it survived
      this.cameras.main.shake(ENEMY_HIT_SHAKE_MS, ENEMY_HIT_SHAKE_INTENSITY); // light kick so a connect has impact
    }
  }

  /** Player took a landed hit: the shared "you're hurt" feedback — the red flash + squash on the
   * sprite, a firm camera kick, and a `player:hit` event UIScene turns into a red damage vignette round
   * the screen edges. Deliberately *not* on the starvation drain (a passive tick, not an impact); it
   * fires from the bite site so getting bitten is unmissable even when you're not watching your feet. */
  private onPlayerHurt(): void {
    this.flashHit(this.player);
    this.cameras.main.shake(PLAYER_HIT_SHAKE_MS, PLAYER_HIT_SHAKE_INTENSITY);
    this.game.events.emit('player:hit');
  }

  /** This sprite's live HitFlash pipeline instance (WebGL only), or null. `getPostPipeline` may hand
   * back a single instance or an array depending on the query — normalise to the first. */
  private hitPipeline(sprite: Phaser.GameObjects.Sprite): HitFlashPipeline | null {
    const p = sprite.getPostPipeline(HIT_FLASH_KEY);
    return ((Array.isArray(p) ? p[0] : p) as HitFlashPipeline | undefined) ?? null;
  }

  /**
   * Damage reaction shared by the player and enemies: a red flash (the HitFlash PostFX on WebGL, a
   * solid fill-tint on Canvas) plus a quick squash "flinch". Both are driven off ONE tween over a
   * plain `{ t }` object (1 → 0), so the flash intensity and the squash decay in lockstep from the
   * moment of impact and settle back to rest — no yoyo needed, the impact is instantaneous and the
   * recovery is the ease-out. The squash animates *scale only*, never position, so it can't fight the
   * actor's Arcade body (game logic stays keyed to col/row per docs/RENDERING.md). Re-hitting mid-flash
   * restarts cleanly (the prior tween is stopped, not completed, so it won't tear down the pipeline).
   */
  private flashHit(sprite: Phaser.GameObjects.Sprite): void {
    const isPlayer = sprite === this.player;
    if (isPlayer) this.playerHitFlashes += 1;
    else this.enemyHitFlashes += 1;

    const webgl = this.game.renderer.type === Phaser.WEBGL;
    if (webgl) {
      if (!this.hitFlashOn.has(sprite)) {
        sprite.setPostPipeline(HIT_FLASH_KEY);
        this.hitFlashOn.add(sprite);
      }
    } else {
      sprite.setTintFill(HIT_FLASH_TINT); // Canvas fallback: a plain solid-red fill, cleared on completion
    }
    const pipe = webgl ? this.hitPipeline(sprite) : null;

    this.hitFlashTweens.get(sprite)?.stop(); // stop() (not remove()) so the old onComplete never runs
    const fx = { t: 1 };
    const tween = this.tweens.add({
      targets: fx,
      t: 0,
      duration: HIT_FLASH_MS,
      ease: 'Expo.easeOut', // hit hard on impact, fade fast
      onUpdate: () => {
        const t = fx.t;
        if (pipe) pipe.flash = t * HIT_FLASH_PEAK;
        // Read baseScale LIVE, not captured once: a footprint swap (idle 32px@2 ↔ walk 64px@1,
        // setEnemyFootprint) can fire mid-flash, and a stale base would stretch the new strip to the
        // old scale — e.g. the 64px Run drawn at the Idle's scale 2 → the sprite visibly doubles.
        const base = (sprite.getData('baseScale') as number | undefined) ?? 1;
        // squash: widest+shortest at impact (t=1), easing back to the rest scale (t=0).
        sprite.setScale(base * (1 + HIT_FLASH_SQUASH * t), base * (1 - HIT_FLASH_SQUASH * 0.8 * t));
        if (isPlayer) this.playerFlash = t;
      },
      onComplete: () => {
        this.hitFlashTweens.delete(sprite);
        const base = (sprite.getData('baseScale') as number | undefined) ?? 1;
        sprite.setScale(base);
        if (webgl) {
          sprite.removePostPipeline(HIT_FLASH_KEY);
          this.hitFlashOn.delete(sprite);
        } else {
          sprite.clearTint();
        }
        if (isPlayer) this.playerFlash = 0;
      },
    });
    this.hitFlashTweens.set(sprite, tween);
  }

  /**
   * An enemy's attack "tell": a quick out-and-back lunge toward its target. The skeleton sheet ships
   * no attack strip, so without this a bite is invisible — the enemy just stands on the player. We
   * move the Arcade **body** (via `body.reset`), not the sprite transform: Arcade writes the body's
   * position back onto the sprite every step, so a `sprite.x` tween would be stomped each frame. The
   * lunge only runs during the stationary contact phase (velocity 0, no active path) and snaps back to
   * the origin on completion, and its total time stays under the contact cooldown so it always settles
   * before the next bite. Logic (contact, pathing) keys off z.col/z.row, so this stays purely visual.
   */
  private enemyLungeAt(z: EnemyUnit, targetX: number, targetY: number): void {
    this.enemyAttacks += 1;
    const sprite = z.sprite;
    if (this.lungeTweens.has(sprite)) return; // already lunging — don't stack
    const ox = sprite.x;
    const oy = sprite.y;
    const dx = targetX - ox;
    const dy = targetY - oy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = (dx / len) * ENEMY_LUNGE_PX;
    const uy = (dy / len) * ENEMY_LUNGE_PX;
    if (dx !== 0) sprite.setFlipX(dx < 0); // face the target across the lunge (velocity is 0, so updateEnemyAnim won't reflip)

    const tween = this.tweens.add({
      targets: { p: 0 },
      p: 1,
      duration: ENEMY_LUNGE_MS,
      yoyo: true, // out to the target, then back
      ease: 'Quad.easeOut',
      onUpdate: (_tw, tgt: { p: number }) => sprite.body.reset(ox + ux * tgt.p, oy + uy * tgt.p),
      onComplete: () => {
        this.lungeTweens.delete(sprite);
        sprite.body.reset(ox, oy); // guarantee it lands exactly back home
      },
    });
    this.lungeTweens.set(sprite, tween);

    // Coded weapon swing (the pack ships no mob attack strip): rotate the held weapon about its grip
    // through WEAPON_SWING_ARC_DEG with a small scale pop, yoyo, in step with the body lunge. syncEnemyAttachments
    // adds w.swingRot every tick, so the pinned weapon arcs while still tracking the hand.
    if (z.weapon) {
      const w = z.weapon;
      const baseScale = w.sprite.scale;
      this.weaponSwingTweens.get(sprite)?.stop();
      const swing = this.tweens.add({
        targets: w,
        swingRot: WEAPON_SWING_ARC_DEG, // always a +arc; weaponTransform mirrors it when the wielder faces left
        duration: WEAPON_SWING_MS,
        yoyo: true,
        ease: 'Quad.easeOut',
        onUpdate: () => {
          if (!w.sprite.active) return; // weapon destroyed mid-swing (death/teardown) — don't poke it
          const p = w.swingRot / WEAPON_SWING_ARC_DEG; // 0→1→0 across the yoyo
          w.sprite.setScale(baseScale * (1 + (WEAPON_SWING_SCALE_POP - 1) * p));
        },
        onComplete: () => {
          w.swingRot = 0;
          if (w.sprite.active) w.sprite.setScale(baseScale);
          this.weaponSwingTweens.delete(sprite);
        },
      });
      this.weaponSwingTweens.set(sprite, swing);
    }
  }

  /** Stop and forget any in-flight hit-flash/lunge tweens for a sprite about to be destroyed — those
   * tweens target plain objects but poke the sprite (scale / body.reset), so they'd throw once it's
   * gone. Called before a killed enemy's sprite is destroyed. */
  private cleanupActorFx(sprite: Phaser.GameObjects.Sprite): void {
    this.hitFlashTweens.get(sprite)?.stop();
    this.hitFlashTweens.delete(sprite);
    this.lungeTweens.get(sprite)?.stop();
    this.lungeTweens.delete(sprite);
    this.weaponSwingTweens.get(sprite)?.stop(); // the swing tween pokes the weapon image each frame
    this.weaponSwingTweens.delete(sprite);
    this.hitFlashOn.delete(sprite);
  }

  /** Reset all combat-FX bookkeeping to its boot state — called from create() (death-restart) and the
   * scenario reset. The maps/set may hold tweens+sprites from a torn-down run, so drop them wholesale. */
  private resetCombatFx(): void {
    // Stop before dropping: a cleared map still leaves the tween running in Phaser's TweenManager, and
    // its onUpdate pokes a sprite the teardown is about to destroy (the yoyo weapon-swing outlives a
    // short step). Stopping first guarantees no orphaned tween fires on a dead sprite next frame.
    for (const t of this.hitFlashTweens.values()) t.stop();
    for (const t of this.lungeTweens.values()) t.stop();
    for (const t of this.weaponSwingTweens.values()) t.stop();
    this.hitFlashTweens.clear();
    this.lungeTweens.clear();
    this.weaponSwingTweens.clear();
    this.hitFlashOn.clear();
    this.corpses.clear(); // scene teardown destroys the sprites; drop stale references
    this.playerFlash = 0;
    this.playerHitFlashes = 0;
    this.enemyHitFlashes = 0;
    this.enemyAttacks = 0;
    this.playerDying = false;
  }

  /**
   * Kill an enemy: pull it out of the AI/debugState set immediately (so nothing chases or counts it),
   * then let its sprite linger just long enough to play the one-shot Death collapse before removing
   * the corpse. The body is disabled so a corpse isn't a physics obstacle mid-animation, and any
   * in-flight flash/lunge is stopped first (those tweens poke the sprite, which is about to go away).
   */
  private killEnemy(z: EnemyUnit): void {
    z.alive = false;
    this.enemies = this.enemies.filter((x) => x !== z);
    this.cleanupActorFx(z.sprite); // also stops an in-flight weapon swing before the image goes away
    if (z.weapon) {
      z.weapon.sprite.destroy(); // weapon hides on death (no loot/drop — see plan Out of scope)
      z.weapon = undefined;
    }
    if (z.hands) {
      // Fists go with the weapon — the Death collapse (96px frames) carries no anchors, so a pinned
      // fist would freeze mid-air over the corpse.
      z.hands.main.destroy();
      z.hands.off.destroy();
      z.hands = undefined;
    }
    const sprite = z.sprite;
    sprite.body.setVelocity(0, 0);
    sprite.body.enable = false;
    // Reset to the default 64px footprint before the collapse — undoes any flinch squash AND the 32px
    // Idle bob's scale:2/origin (dying mid-bob would otherwise play the Death strip double-size, off-tile).
    const { render } = ACTIVE_TILESET.actors.enemy;
    sprite.setScale(render.scale).setOrigin(render.originX, render.originY);
    sprite.anims.play(enemyDeathKey); // keeps its current flipX — collapses facing the way it ran
    this.corpses.add(sprite);
    const dur = this.anims.get(enemyDeathKey)?.duration ?? 600;
    // TEMP: hold the settled final frame for 5 minutes so the death anim can be observed on the corpse
    // (instead of the brief DEATH_HOLD_MS beat). Revisit once the skeleton death look is dialled in.
    const CORPSE_LINGER_MS = 5 * 60_000;
    this.time.delayedCall(dur + CORPSE_LINGER_MS, () => {
      this.corpses.delete(sprite);
      sprite.destroy();
    });
  }

  /**
   * Player death: freeze the world on a one-shot Death collapse, then restart the scene (the existing
   * "Death = restart" reset — see damagePlayer). Guarded by `playerDying` so a crowd of enemies can't
   * re-enter this each frame. We cancel any active order, stop movement, and clear an in-flight
   * hit-flash so the corpse isn't left mid-squash; update() then holds everything still until the
   * scheduled restart fires (the delayedCall runs on the scene clock, which the test harness drives).
   */
  private killPlayer(): void {
    this.playerDying = true;
    console.log('player down — restarting'); // the death→restart signal the death spec asserts
    this.cancelAll();
    this.player.body.setVelocity(0, 0);
    this.attackLockUntil = 0;
    this.cleanupActorFx(this.player);
    const facing = this.facingDir();
    this.player.setScale((this.player.getData('baseScale') as number | undefined) ?? 1);
    this.player.setFlipX(facing === 'side' && this.lastFacing.dCol < 0);
    const key = playerAnimKey('death', facing);
    this.player.anims.play(key);
    const dur = this.anims.get(key)?.duration ?? 600;
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
      this.lastFacing =
        Math.abs(vec.dx) >= Math.abs(vec.dy) ? { dCol: Math.sign(vec.dx), dRow: 0 } : { dCol: 0, dRow: Math.sign(vec.dy) };
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
    if (pick?.kind === 'enemy') return void this.game.events.emit('inspect:show', enemyStats(pick.enemy));
    if (pick?.kind === 'tree') return void this.game.events.emit('inspect:show', treeStats(pick.tree));
    if (pick?.kind === 'site') return void this.game.events.emit('inspect:show', wallStats(pick.site));
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
    const consider = (obj: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle, pick: PointerPick): void => {
      const order = this.children.getIndex(obj);
      if (!best || obj.depth > best.depth || (obj.depth === best.depth && order > best.order)) {
        best = { pick, depth: obj.depth, order };
      }
    };
    for (const z of this.enemies) {
      if (!z.alive) continue;
      const footprint = hurtboxContains({ col: z.col, row: z.row }, z.def.hurtbox ?? DEFAULT_HURTBOX, { col, row });
      if (footprint || this.alphaHit(z.sprite, x, y)) consider(z.sprite, { kind: 'enemy', enemy: z });
    }
    for (const t of this.trees) {
      if (!t.alive) continue;
      if ((t.col === col && t.row === row) || this.alphaHit(t.sprite, x, y)) consider(t.sprite, { kind: 'tree', tree: t });
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
  private alphaHit(s: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, x: number, y: number): boolean {
    if (!s.getBounds().contains(x, y)) return false;
    let localX = (x - s.x) / s.scaleX + s.displayOriginX;
    let localY = (y - s.y) / s.scaleY + s.displayOriginY;
    if (s.flipX) localX = s.frame.width - localX;
    if (s.flipY) localY = s.frame.height - localY;
    try {
      const alpha = this.textures.getPixelAlpha(Math.floor(localX), Math.floor(localY), s.texture.key, s.frame.name);
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
    const sprite = this.add.image(tileToWorldCenter(col), tileToWorldCenter(row), key, frame).setDepth(1);
    // Each species sizes/anchors itself from its def (critique #2): a pine scales to ~2.6 tiles and
    // anchors near its base so the canopy overhangs up; a rock is ~1 tile, centred. sprite.x/y stay
    // the tile centre, so treeAt()'s distance check is unaffected regardless of scale/origin.
    sprite.setScale(this.nodeScale(sprite, def)).setOrigin(def.originX, def.originY);
    this.trees.push({ id: `${def.id}-${this.nextTreeId++}`, sprite, def, hp: def.maxHp, alive: true, col, row });
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
    for (const z of this.enemies) { this.cleanupActorFx(z.sprite); z.weapon?.sprite.destroy(); z.hands?.main.destroy(); z.hands?.off.destroy(); z.sprite.destroy(); }
    this.trees = [];
    this.enemies = [];

    const pt = this.playerTile();
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

  private addEnemy(
    enemyId: string,
    col: number,
    row: number,
    opts?: { patrolRoute?: Cell[]; mode?: MonsterMode; weaponId?: string },
  ): void {
    const def = ENEMIES[enemyId];
    const enemyActor = ACTIVE_TILESET.actors.enemy;
    const { render } = enemyActor;
    const sprite = this.add.sprite(tileToWorldCenter(col), tileToWorldCenter(row), enemyWalkKey).setDepth(9);
    sprite.setScale(render.scale).setOrigin(render.originX, render.originY);
    sprite.setData('baseScale', render.scale); // rest scale the flinch squash returns to
    this.physics.add.existing(sprite);
    const enemySprite = sprite as EnemyUnit['sprite'];
    enemySprite.body.setCollideWorldBounds(true);
    this.fitActorBody(enemySprite, render);
    const ai = initialMonsterState(opts?.patrolRoute);
    if (opts?.mode) ai.mode = opts.mode; // scenario override (e.g. spawn already chasing)

    // Roll a held weapon from the enemy's pool (Phase B) — or take a scenario-forced id. The weapon is
    // a plain image (no physics body); it's pinned to the hand each tick in syncEnemyAttachments.
    const pool = def.weaponPool ?? [];
    const weaponId = opts?.weaponId ?? (pool.length ? pool[Math.floor(this.rng() * pool.length)] : undefined);
    let weapon: EnemyUnit['weapon'];
    const art = weaponId ? enemyActor.weapons[weaponId] : undefined;
    const stats = weaponId ? MONSTER_WEAPONS[weaponId] : undefined;
    if (weaponId && art && stats) {
      const wsprite = this.add.image(sprite.x, sprite.y, resolveTile(art.source).key);
      wsprite.setOrigin(art.pivot[0], art.pivot[1]).setScale(art.scale ?? 1).setDepth(sprite.depth + art.z);
      weapon = { id: weaponId, sprite: wsprite, def: stats, swingRot: 0 };
    }

    // Both fists — always (the skeleton has hands whether or not it's armed). The gripping hand draws
    // over the weapon, the free hand beside the body; both pinned each tick in syncEnemyAttachments.
    const handArt = enemyActor.hand;
    const handKey = resolveTile(handArt.source).key;
    const mkHand = (z: number) =>
      this.add.image(sprite.x, sprite.y, handKey).setOrigin(handArt.pivot[0], handArt.pivot[1]).setDepth(sprite.depth + z);
    const hands = { main: mkHand(handArt.mainZ), off: mkHand(handArt.offZ) };

    this.enemies.push({
      id: `enemy-${this.nextEnemyId++}`,
      sprite: enemySprite,
      def,
      hp: def.maxHp,
      alive: true,
      col,
      row,
      ai,
      lastContactAt: 0,
      path: [],
      pathIndex: 0,
      activeStrip: 'walk', // addEnemy set up the 64px Walk footprint above
      weapon,
      hands,
    });
    this.syncEnemyAttachments(this.enemies[this.enemies.length - 1]); // place weapon + fists on frame 0
  }

  /** Step an enemy toward its next waypoint (mirrors advancePath's approach); true once its
   * current path is exhausted. */
  private advanceEnemy(z: EnemyUnit): boolean {
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

  /**
   * Enemy animation each tick: the Run cycle while moving (flipped by movement-x — art faces right),
   * the real 4-frame Idle bob when stationary in a calm mode (its own 32px footprint, Phase B), or a
   * held Run frame-0 pose when stalled in melee while chasing (the lunge is the attack tell — no bob
   * mid-bite). The footprint (scale/origin/body) is swapped only on a state change (setEnemyFootprint).
   */
  private updateEnemyAnim(z: EnemyUnit): void {
    const moving = z.sprite.body.velocity.lengthSq() > 1;
    const calmIdle = !moving && z.ai.mode !== 'chase';
    this.setEnemyFootprint(z, calmIdle ? 'idle' : 'walk');

    if (calmIdle) {
      z.sprite.anims.play(enemyIdleKey, true); // looping gentle bob
    } else if (moving) {
      const vx = z.sprite.body.velocity.x;
      if (vx !== 0) z.sprite.setFlipX(vx < 0);
      z.sprite.anims.play(enemyWalkKey, true);
    } else {
      z.sprite.anims.stop();
      z.sprite.setFrame(0); // chasing but stalled in melee → hold the Run frame-0 pose
    }

    this.syncEnemyAttachments(z); // pin the weapon (if any) + both fists to this frame's hand anchors
  }

  /**
   * Pin the held weapon to the wielder's hand for the CURRENT animation frame — called every tick (not
   * on `animationupdate`, so the lunge/swing slide between frame changes without the pin going stale).
   * Reads the active strip's per-frame `mainHand` anchor, runs the pure {@link weaponTransform} with the
   * live flipX + swing angle, and writes the result onto the weapon image (position/flip/angle). Scale
   * is owned by the swing tween, so it's untouched here.
   */
  private syncEnemyAttachments(z: EnemyUnit): void {
    const enemy = ACTIVE_TILESET.actors.enemy;
    const strip = z.activeStrip === 'idle' ? enemy.idle : enemy.walk;
    const frameW = strip.frameWidth ?? strip.frameSize;
    const frameH = strip.frameSize;
    const frame = Number(z.sprite.frame.name); // spritesheet frame index (0-based) == anchor index

    // Resolve a slot's anchor for THIS frame into a world offset/angle, or undefined if the strip
    // carries no anchors for it (→ caller hides that attachment).
    const pin = (anchors: AttachPoint[] | undefined, extraRot: number) => {
      if (!anchors || anchors.length === 0) return undefined;
      const index = Math.max(0, Math.min(anchors.length - 1, Number.isFinite(frame) ? frame : 0));
      return weaponTransform({
        anchor: anchors[index],
        actorRender: enemy.render,
        stripRender: strip.render,
        frameW,
        frameH,
        flipX: z.sprite.flipX,
        extraRot,
      });
    };

    // Weapon at the main-hand grip: resting `rot` + the live coded swing (about its grip = this anchor).
    if (z.weapon) {
      const t = pin(strip.anchors?.mainHand, z.weapon.swingRot);
      if (t) z.weapon.sprite.setPosition(z.sprite.x + t.x, z.sprite.y + t.y).setFlipX(t.flipX).setAngle(t.rotation);
    }
    // Fists: a fist doesn't rotate, so pin position + mirror only (angle stays 0). The gripping hand
    // sits at the SAME anchor as the weapon, so it stays put while the weapon arcs about it.
    if (z.hands) {
      const m = pin(strip.anchors?.mainHand, 0);
      z.hands.main.setVisible(!!m);
      if (m) z.hands.main.setPosition(z.sprite.x + m.x, z.sprite.y + m.y).setFlipX(m.flipX);
      const o = pin(strip.anchors?.offHand, 0);
      z.hands.off.setVisible(!!o);
      if (o) z.hands.off.setPosition(z.sprite.x + o.x, z.sprite.y + o.y).setFlipX(o.flipX);
    }
  }

  /**
   * Swap the enemy sprite between its Walk (64px) and Idle (32px) footprints — on an actual change
   * only. Applies the target strip's render (scale/origin) and re-fits the Arcade body so its WORLD
   * footprint (a ~1-tile box at the feet) is identical in both states: the display size matches (32px
   * Idle @scale 2 == 64px Run @scale 1) and the contact tile is unchanged (critique #3). `sprite.x/y`
   * is untouched, so there's no positional jump — only the drawn pixels reflow around the same anchor.
   */
  private setEnemyFootprint(z: EnemyUnit, which: 'idle' | 'walk'): void {
    if (z.activeStrip === which) return;
    z.activeStrip = which;
    const enemy = ACTIVE_TILESET.actors.enemy;
    const render = which === 'idle' ? enemy.idle.render ?? enemy.render : enemy.render;
    // Base frame of the target strip first, so fitActorBody reads the right frame size below.
    z.sprite.setTexture(which === 'idle' ? enemyIdleKey : enemyWalkKey, 0);
    z.sprite.setScale(render.scale).setOrigin(render.originX, render.originY);
    z.sprite.setData('baseScale', render.scale); // flinch-squash rest scale follows the active footprint
    this.fitActorBody(z.sprite, render);
  }

  /** Per-frame AI tick (pure FSM in systems/monsterAI) + chase/contact-damage for every live enemy.
   *  The scene owns the *effects*: A* repath, `advanceEnemy`, the contact bite; the FSM owns the
   *  *decision* (mode, where to move, whether to repath). */
  private updateEnemies(): void {
    const now = this.time.now;
    const pt = this.playerTile();
    // The player's body tiles (feet + torso overhang); an enemy in melee contact with ANY of them
    // lands its bite, so a tall player is reachable by its drawn torso, not only its feet tile.
    const playerBody = hurtboxTiles(pt, this.playerStats.hurtbox ?? DEFAULT_HURTBOX);
    for (const z of this.enemies) {
      if (!z.alive) continue;

      const decision = stepMonster(
        z.ai,
        {
          nowMs: now,
          monster: { col: z.col, row: z.row },
          monsterPos: { x: z.sprite.x, y: z.sprite.y },
          playerPos: { x: this.player.x, y: this.player.y },
          playerTile: pt,
          acquireRadiusPx: z.def.vision ?? 0,
          chaseDropRadiusPx: MONSTER_CHASE_DROP_RADIUS_PX,
          veerBandPx: MONSTER_VEER_BAND_PX,
          veerMaxTiles: MONSTER_VEER_MAX_TILES,
          repathMs: MONSTER_REPATH_MS,
          idleMsMin: MONSTER_IDLE_MS_MIN,
          idleMsMax: MONSTER_IDLE_MS_MAX,
          wanderRadiusTiles: MONSTER_WANDER_RADIUS_TILES,
          patrolPauseMs: MONSTER_PATROL_PAUSE_MS,
          dims: this.gridDims,
          isBlocked: this.isBlocked,
        },
        this.rng,
      );
      z.ai = decision.state;

      // Chase + in melee contact: stand and bite on the cadence (skip movement).
      if (z.ai.mode === 'chase') {
        const inContact = playerBody.some(
          (t) => Math.max(Math.abs(t.col - z.col), Math.abs(t.row - z.row)) <= 1,
        );
        if (inContact) {
          z.sprite.body.setVelocity(0, 0);
          // The equipped weapon sets the base damage + the attack cadence (a knife bites ~2× as often
          // as a club); an unarmed monster falls back to the shared unarmed damage + contact cooldown.
          const baseDmg = z.weapon ? z.weapon.def.damage : UNARMED_BASE_DAMAGE;
          const cooldown = z.weapon ? z.weapon.def.attackMs : CONTACT_DAMAGE_COOLDOWN_MS;
          if (now - z.lastContactAt >= cooldown) {
            z.lastContactAt = now;
            this.enemyLungeAt(z, this.player.x, this.player.y); // visible attack tell + weapon swing
            const dmg = resolveMeleeAttack(z.def, this.playerStats, baseDmg, this.rng);
            if (dmg > 0) this.onPlayerHurt(); // flash + camera kick + damage vignette when the bite lands
            this.damagePlayer(dmg);
          }
          this.updateEnemyAnim(z);
          continue;
        }
      }

      // Otherwise honour the FSM's move command: repath when asked, then walk (or stand if no target).
      if (decision.repath && decision.targetTile) {
        const path = findPath({ col: z.col, row: z.row }, decision.targetTile, this.isBlocked, this.gridDims);
        z.path = path ?? [];
        z.pathIndex = 0;
        // Only a truly UNREACHABLE calm-mode pick (findPath → null) strands the monster — drop to idle
        // so it re-picks next beat. An empty path ([]) is "already on the target" (e.g. a patroller
        // sitting on its first waypoint): keep the mode so the FSM's arrival logic (pause → next
        // waypoint) runs. Chase keeps trying regardless (the player may be briefly unreachable).
        if (path === null && z.ai.mode !== 'chase') {
          z.ai = { ...z.ai, mode: 'idle', goalTile: null, timerMs: now + MONSTER_IDLE_MS_MIN };
        }
      }
      if (decision.targetTile) this.advanceEnemy(z);
      else z.sprite.body.setVelocity(0, 0);

      this.updateEnemyAnim(z);
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
    if (this.trees.some((t) => t.alive && t.def.blocksPath && t.col === col && t.row === row)) return false;
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

    const site = this.createBlueprint(col, row);
    this.enqueue({ kind: 'build', siteId: site.id });
  }

  /** Add a passable, unbuilt blueprint at a tile and register its occupancy (shared by real build
   * placement and the DEV-only scenario API). Does NOT spend wood or enqueue — callers do that. */
  private createBlueprint(col: number, row: number): BuildSite {
    const key = tileKey(col, row);
    const rect = this.add
      .rectangle(tileToWorldCenter(col), tileToWorldCenter(row), TILE_SIZE, TILE_SIZE, COLORS.blueprint, 0.35)
      .setDepth(1);
    const site: BuildSite = { id: `site-${this.nextSiteId++}`, col, row, rect, visual: null, progress: 0, done: false };
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
    for (const z of this.enemies) { this.cleanupActorFx(z.sprite); z.weapon?.sprite.destroy(); z.hands?.main.destroy(); z.hands?.off.destroy(); z.sprite.destroy(); }
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
    this.path = [];
    this.pathIndex = 0;
    this.actionGoal = null;
    this.chopElapsed = 0;
    this.harvestSwing = null;
    this.attackLockUntil = 0;
    this.combatMoveVec = { dx: 0, dy: 0 };
    this.resetCombatFx(); // start each scenario with clean FX counters/flags (see create())
    this.buildMode = false;
    this.queueMarkers = [];
    this.outlinedTreeIds.clear();
    this.paintedThisGesture.clear();
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

    this.playerHp = this.playerStats.maxHp;
    this.game.events.emit('player:hpChanged', { hp: this.playerHp, maxHp: this.playerStats.maxHp });
  }

  /** Construct the world declared by `spec` (see {@link ScenarioSpec}) and return the placed ids. */
  private testApplyScenario(spec: ScenarioSpec): ScenarioResult {
    this.testResetWorld();

    const [pcol, prow] = spec.player ?? [Math.floor(this.gridDims.cols / 2), Math.floor(this.gridDims.rows / 2)];
    this.player.body.reset(tileToWorldCenter(pcol), tileToWorldCenter(prow));
    this.player.body.setVelocity(0, 0);
    this.lastFacing = spec.facing ? { ...FACING_DELTAS[spec.facing] } : { dCol: 0, dRow: 1 };

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
      const id = Array.isArray(z) ? 'kidZombie' : z.id ?? 'kidZombie';
      const opts = Array.isArray(z)
        ? undefined
        : { patrolRoute: z.patrolRoute?.map(([c, r]) => ({ col: c, row: r })), mode: z.mode, weaponId: z.weaponId };
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
      px: this.player.x,
      py: this.player.y,
      enemies: this.enemies.filter((z) => z.alive).length,
      enemyModes: this.enemies.filter((z) => z.alive).map((z) => z.ai.mode),
      // Live enemy tiles (spec order) — patrol mode never leaves 'patrol', so waypoint cycling is
      // only observable via position; the monster.spec patrol test reads this.
      enemyTiles: this.enemies.filter((z) => z.alive).map((z) => ({ col: z.col, row: z.row })),
      // Equipped weapon id per live enemy (null = unarmed) — lets a combat spec confirm the rolled/forced weapon.
      enemyWeapons: this.enemies.filter((z) => z.alive).map((z) => z.weapon?.id ?? null),
      corpses: this.corpses.size,
      playerHp: this.playerHp,
      playerDying: this.playerDying,
      playerFlash: this.playerFlash,
      playerHitFlashes: this.playerHitFlashes,
      enemyHitFlashes: this.enemyHitFlashes,
      enemyAttacks: this.enemyAttacks,
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
    const groundVariants = ACTIVE_TILESET.tiles.ground.map((g) => ({ ...resolveTile(g.source), weight: g.weight }));
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
    // Snap to an integer level: pixel-art sprites only stay crisp at integer camera scale (see
    // config.ts ZOOM_STEP). This gates *every* zoom source — buttons, pinch, restored preference.
    const clamped = Phaser.Math.Clamp(Math.round(z), MIN_ZOOM, MAX_ZOOM);
    this.userZoom = clamped;
    // Camera scale = the user's (integer) zoom × the device render scale, so the world is drawn at
    // device density (a crisp ~1:1 final upscale, no seams) while the user still zooms in integer
    // steps. Everything else — the registry mirror, persistence, the HUD %readout — is the *user* zoom.
    this.cameras.main.setZoom(clamped * RENDER_SCALE);
    this.registry.set('zoom', clamped);
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped));
    } catch {
      // Private browsing / storage disabled — the zoom still applies, just won't persist.
    }
    this.game.events.emit('zoom:changed', clamped);
  }

  private adjustZoom(delta: number): void {
    this.setZoom(this.userZoom + delta);
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
