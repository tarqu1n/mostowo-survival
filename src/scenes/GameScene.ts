import Phaser from 'phaser';
import {
  START_MAP_ID,
  SPAWN_TILE,
  TILE_SIZE,
  CHOP_INTERVAL_MS,
  CAMPFIRE_FUEL_MAX,
  CAMPFIRE_FUEL_PER_WOOD,
  CAMPFIRE_FEED_INTERVAL_MS,
  LONGPRESS_MS,
  BUILD_MS,
  UNARMED_BASE_DAMAGE,
  PLAYER_HIT_SHAKE_MS,
  PLAYER_HIT_SHAKE_INTENSITY,
  ENEMY_HIT_SHAKE_MS,
  ENEMY_HIT_SHAKE_INTENSITY,
  DEATH_HOLD_MS,
  INVENTORY_SLOTS,
  DEFAULT_MAX_STACK,
} from '../config';
import { ITEMS } from '../data/items';
import { NODES } from '../data/nodes';
import { Inventory } from '../systems/Inventory';
import { tileKey, tileToWorldCenter } from '../systems/grid';
import { findPath, reachableAdjacent, type Cell } from '../systems/pathfind';
import { originOf } from '../systems/mapRuntime';
import { mapBlocks } from '../systems/mapWalkability';
import type { MapFile, DecorObject, NodeObject, PortalObject } from '../systems/mapFormat';
import { breadcrumb, setCrashContext } from '../debug/crashReporter';
import { TaskQueue, type Action } from '../systems/tasks';
import { resolveMeleeAttack } from '../systems/combat';
import type { UIScene } from './UIScene';
import type { GameTestApi } from '../entities/testTypes';
import type { CharacterSprite } from '../entities/Character';
import { PlayerCharacter } from '../entities/PlayerCharacter';
import { CombatFxManager } from './fx/CombatFxManager';
import { PointerInputController } from './input/PointerInputController';
import { ScenePicker } from './input/ScenePicker';
import { BuildManager } from './build/BuildManager';
import { TaskGlowRenderer } from './fx/TaskGlowRenderer';
import { ResourceNodeManager } from './world/ResourceNodeManager';
import { DecorManager } from './world/DecorManager';
import { EnemyManager } from './world/EnemyManager';
import { CampfireManager } from './world/CampfireManager';
import { SurvivalClock } from './world/SurvivalClock';
import { VisionController } from './fx/VisionController';
import { TestApi } from './testApi';
import { registerActorAnims } from './world/actorAnims';
import { drawMapLayers } from './world/groundRenderer';

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

  // Input mode: Command (default tap-to-pathfind, unchanged), Combat (movepad drives the player
  // directly, bypassing the pathfinder), Inspect (tap shows a stats panel — Step 7). Mutually
  // exclusive; UIScene mirrors this for HUD highlighting/visibility via 'mode:changed'.
  private mode: 'command' | 'combat' | 'inspect' = 'command';

  private inv!: Inventory;

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

  // Day/night clock + hunger/starvation (plan 015 Step 3) — see src/scenes/world/SurvivalClock.ts.
  // Owns clockMs/dayPhase/dayCount/hunger/starveElapsed + the nightOverlay rect (sole alpha-writer).
  // Constructed fresh in buildWorld() each (re)start, at the same point the old inline night-overlay
  // block used to run; wires its own SHUTDOWN teardown directly.
  private survivalClock!: SurvivalClock;

  // Resource nodes — trees/rocks/bushes: spawn, harvest, regrow (plan 015 Step 1) — see
  // src/scenes/world/ResourceNodeManager.ts. Constructed fresh in buildWorld() each (re)start, before
  // the player exists; hydrated from authored map nodes (loadNodes); wires its own SHUTDOWN teardown.
  private resourceNodeManager!: ResourceNodeManager;

  // Enemies — spawn, per-frame AI tick, attack/kill, DEV-menu scatter (plan 015 Step 2) — see
  // src/scenes/world/EnemyManager.ts. Constructed fresh in buildWorld() each (re)start, at the same
  // point the old inline spawnEnemies() call used to run (before the player exists); wires its own
  // SHUTDOWN teardown directly.
  private enemyManager!: EnemyManager;

  // Build placement (plan 013 Step 6) — see src/scenes/build/BuildManager.ts. Constructed fresh in
  // buildWorld() each (re)start (its constructor builds real GameObjects + a physics collider against
  // the just-constructed player, same reasoning as `pointerInput` below); wires its own SHUTDOWN
  // teardown directly.
  private buildManager!: BuildManager;

  // Campfires (plan 012) — the first live, per-frame-simulated buildable: owns the campfire collection
  // + each fire's animated sprite, drains fuel each tick, and exposes its lit fires as the light source
  // both SurvivalClock (night-overlay mask) and VisionController (fog reveal) read via the scene.
  // Constructed fresh in buildWorld() each (re)start; wires its own SHUTDOWN teardown directly.
  private campfireManager!: CampfireManager;

  // Pointer "raycast" + the tap/inspect intent built on top of it (plan 015 Step 5) — see
  // src/scenes/input/ScenePicker.ts. Stateless (no fields but scene+deps, no SHUTDOWN teardown — see
  // its class doc). Constructed fresh in buildWorld() each (re)start, right after ResourceNodeManager/
  // EnemyManager/BuildManager exist (its deps close over their real methods) and before
  // PointerInputController (whose deps read `this.scenePicker`).
  private scenePicker!: ScenePicker;

  private ui!: UIScene;
  // Pointer gestures (tap/long-press-paint/pan/pinch) + the camera they drive (zoom, follow-lock) —
  // see src/scenes/input/PointerInputController.ts (plan 013 Step 5). Constructed fresh in create()
  // (it wires its own input.on(...) listeners there and tears them down on SHUTDOWN itself), so unlike
  // `fx` above it is NOT a field initializer — see the controller's class doc for why that's fine here.
  private pointerInput!: PointerInputController;
  // Grid dimensions in tiles. Recomputed per (re)start in buildWorld() from the loaded map's
  // `meta.width/height` (plan 018 A11) — NOT a field initializer, because Phaser reuses this scene
  // instance across death-restarts and the dims must re-derive from whichever map is loaded. Read via
  // `dims()` deps by EnemyManager/BuildManager/pathfind/randomiseWorld/TestApi.
  private gridDims = { cols: 0, rows: 0 };
  // The authored start map + its placement origin (global tile coords) — set at the top of
  // buildWorld() (plan 018 A11). `isBlocked` composites the map's own walkability in, converting a
  // GLOBAL (col,row) back to map-local by subtracting `mapOrigin`.
  private startMap!: MapFile;
  private mapOrigin: { col: number; row: number } = { col: 0, row: 0 };
  // Runtime decor renderer (plan 018 A7) — draws authored `decor` objects + contributes their
  // collision footprints to `isBlocked`. Constructed fresh in buildWorld() each (re)start.
  private decorManager!: DecorManager;
  // Authored `portal` objects — parse-and-hold only at L0 (plan 018 decision): stored for plan 019's
  // map-streaming transitions, with NO transition behaviour wired here.
  private portals: PortalObject[] = [];
  // Queue/glow presentation (plan 013 Step 6) — see src/scenes/fx/TaskGlowRenderer.ts. Constructed
  // fresh in buildWorld() each (re)start; wires its own SHUTDOWN teardown directly.
  private taskGlowRenderer!: TaskGlowRenderer;
  // Fog of war (plan 015 Step 4) — see src/scenes/fx/VisionController.ts. Owns `fogShape` (the
  // vision-radius mask's shape source, redrawn each frame to track the character) and hides dynamic
  // actors outside vision. Does NOT own `nightOverlay` (SurvivalClock does — see there). Constructed
  // fresh in buildWorld() each (re)start, at the same point the old inline fog-of-war block used to
  // run (after the player exists); wires its own SHUTDOWN teardown directly.
  private visionController!: VisionController;

  constructor() {
    super('Game');
  }

  create(): void {
    this.resetState();
    this.buildWorld();
    this.wireBus();
    this.installTestApi();
    // Feed the crash reporter a live state snapshot, sampled only if/when a crash is caught. Read
    // defensively (optional-chain) — the reporter wraps this call, but a clean snapshot beats a
    // "provider threw" line in the report.
    setCrashContext(() => {
      const a = this.queue.current;
      return {
        mode: this.mode,
        action: a ? { kind: a.kind, target: this.describeActionTarget(a) } : null,
        harvestSwing: this.harvestSwing,
        playerTile: this.playerChar?.tile(),
        playerHp: this.playerChar?.hp,
        nodes: this.resourceNodeManager?.all().length,
        map: START_MAP_ID,
        portals: this.portals.length, // parse-and-hold count (plan 018); wired for transitions in 019
      };
    });
    breadcrumb('scene', 'GameScene create done');
  }

  /** One-line description of an action's target for the crash report (no sprite refs). */
  private describeActionTarget(a: Action): string {
    if (a.kind === 'harvest') return a.treeId;
    if (a.kind === 'refuel') return a.campfireId;
    if (a.kind === 'build') return a.siteId;
    return `(${a.col},${a.row})`;
  }

  /**
   * Reset all mutable world/queue state — create() reruns on a death-restart (see killPlayer), and
   * Phaser reuses this same Scene instance rather than reconstructing it, so plain-data fields (unlike
   * this.add.*-owned GameObjects, which the scene teardown already destroys) need an explicit reset
   * here or they'd accumulate across restarts. Build/node/enemy/survival/queue-glow state needs no
   * reset here: ResourceNodeManager, EnemyManager, BuildManager, SurvivalClock, and TaskGlowRenderer
   * are reconstructed fresh in buildWorld() below, each wiring its own SHUTDOWN teardown for the
   * outgoing instance.
   */
  private resetState(): void {
    this.queue.clear();
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
    this.mode = 'command';
  }

  /**
   * Build this (re)start's world from the authored start map (plan 018): baked tile layers + decor,
   * shared inventory, resource nodes hydrated from `node` objects + the (still procedural) first enemy
   * pack, player + enemy animations, the player character spawned at `SPAWN_TILE`, the
   * build/queue-glow/pointer managers, the camera + fog-of-war + night overlay sized to the map, and
   * the HUD overlay scene. Order matters in a couple of
   * places (called out inline): the player must exist before BuildManager's collider, and both
   * managers before UIScene launch (hudHitTest closes over `this.ui`, assigned at the very end, but
   * that's only read from a later pointer event, never during this method).
   */
  private buildWorld(): void {
    // Authored start map — loaded + its textures made resident in PreloadScene (plan 018 A10). Global
    // tile coords + an `originPx` offset are used throughout the runtime world path (plan 018
    // decision), so plan 019's adjacent-map streaming can place a second map away from the world
    // origin without reworking any of this. At L0 there's one map and `originOf` returns {0,0}.
    const map = this.registry.get('startMap') as MapFile;
    this.startMap = map;
    this.mapOrigin = originOf(START_MAP_ID);
    const originPx = { x: this.mapOrigin.col * TILE_SIZE, y: this.mapOrigin.row * TILE_SIZE };
    const worldPx = { w: map.meta.width * TILE_SIZE, h: map.meta.height * TILE_SIZE };
    // Per-map grid dims (see the field's note) — recomputed here each (re)start from the loaded map.
    this.gridDims = { cols: map.meta.width, rows: map.meta.height };

    // Tile layers baked from the authored palette/cells (plan 018 A4). Honours per-layer `overhead` depth.
    drawMapLayers(this, map, originPx);

    // Shared character inventory — stored in the registry so the UIScene reads the same instance.
    this.inv = new Inventory({
      capacity: INVENTORY_SLOTS,
      maxStackOf: (id) => ITEMS[id]?.maxStack ?? DEFAULT_MAX_STACK,
    });
    this.registry.set('inventory', this.inv);

    // Resource nodes (plan 015 Step 1) — constructed before the player (its constructor must not
    // touch player closures); loadNodes() is a separate call right after so construction itself
    // stays side-effect-free. See ResourceNodeManagerDeps for why each closure is narrowed this way.
    this.resourceNodeManager = new ResourceNodeManager(this, {
      repath: () => this.repath(),
      addYield: (itemId, n) => this.inv.add(itemId, n),
    });
    // Hydrate resource nodes from authored `node` objects (plan 018 A6). test.map.json carries none
    // yet (see the Phase-A content ship gate) — hunger stays non-lethal via HUNGER_LETHAL until
    // authored food lands, so a node-less map can't starve out.
    this.resourceNodeManager.loadNodes(
      map.objects.filter((o): o is NodeObject => o.kind === 'node'),
    );

    // Decor (plan 018 A7) — the animated bonfire + static rocks. Construction is side-effect-free;
    // render() draws each object at its global pixel position and folds any collision footprint into
    // the isBlocked composite. Built here (before the player) alongside the other static-world
    // managers — its constructor never touches player state.
    this.decorManager = new DecorManager(this);
    this.decorManager.render(
      map.objects.filter((o): o is DecorObject => o.kind === 'decor'),
      originPx,
    );

    // Portals — parse-and-hold only at L0 (plan 018 decision): stored for plan 019's map-streaming
    // transitions; NO transition behaviour is wired here. (test.map.json has none.)
    this.portals = map.objects.filter((o): o is PortalObject => o.kind === 'portal');

    // Enemies (plan 015 Step 2) — constructed before the player (its constructor must not touch
    // player closures — only the deps' call-time closures below may); spawnEnemies() is a separate
    // call right after so construction itself stays side-effect-free. See EnemyManagerDeps for why
    // each closure is narrowed this way. `rng` is wrapped (not `this.rng` directly) so a later
    // `setRng` reassignment (the DEV-only test API) is picked up live, not snapshotted here.
    this.enemyManager = new EnemyManager(this, {
      playerTile: () => this.playerChar.tile(),
      playerPos: () => ({ x: this.player.x, y: this.player.y }),
      playerStats: () => this.playerChar.stats,
      dims: () => this.gridDims,
      isBlocked: (col, row) => this.isBlocked(col, row),
      rng: () => this.rng(),
      onPlayerHurt: () => this.onPlayerHurt(),
      damagePlayer: (amount) => this.damagePlayer(amount),
      lungeAt: (m, x, y) => this.fx.lungeAt(m, x, y),
      cleanupActorFx: (sprite) => this.fx.cleanupActorFx(sprite),
      addCorpse: (sprite) => this.fx.addCorpse(sprite),
      removeCorpse: (sprite) => this.fx.removeCorpse(sprite),
    });
    this.enemyManager.spawnEnemies();

    // Player + enemy anim registration (plan 015 Step 6) — see world/actorAnims.ts.
    registerActorAnims(this);
    // Player spawns at the authored SPAWN_TILE (config), offset by the map origin — was the fixed
    // map-centre (plan 018 A11). tileToWorldCenter puts it at the tile's centre pixel.
    this.playerChar = new PlayerCharacter(this, {
      x: tileToWorldCenter(SPAWN_TILE.col) + originPx.x,
      y: tileToWorldCenter(SPAWN_TILE.row) + originPx.y,
    });
    // playerStats is the player's stat bag surfaced for the Wellbeing screen's stat rows.
    this.registry.set('playerStats', this.playerChar.stats);
    this.physics.world.setBounds(originPx.x, originPx.y, worldPx.w, worldPx.h);

    // Build placement (plan 013 Step 6) — constructed fresh each (re)start; its constructor wires a
    // physics collider against the player sprite just constructed above, and its own SHUTDOWN
    // teardown. See BuildManagerDeps for why each closure below is narrowed the way it is.
    this.buildManager = new BuildManager(this, {
      getPlayerSprite: () => this.player,
      playerTile: () => this.playerChar.tile(),
      isBlocked: (col, row) => this.isBlocked(col, row),
      hasBlockingTree: (col, row) => this.resourceNodeManager.hasBlockingNode(col, row),
      dims: () => this.gridDims,
      canAfford: (cost) => this.inv.canAfford(cost),
      spend: (cost) => this.inv.spend(cost),
      enqueueBuild: (siteId) => this.enqueue({ kind: 'build', siteId }),
      materialiseBuildable: (site) => this.campfireManager.materialise(site),
      repath: () => this.repath(),
    });

    // Campfires (plan 012) — the live, per-frame buildable. Constructed here so it exists before
    // VisionController below (whose constructor calls update() → lightSources()) and before any
    // finishSite routes a `behavior` buildable to materialise(). Wires its own SHUTDOWN teardown.
    this.campfireManager = new CampfireManager(this, {
      spend: (cost) => this.inv.spend(cost),
    });

    // Pointer "raycast" + tap/inspect intent (plan 015 Step 5) — constructed here, after
    // ResourceNodeManager/EnemyManager/BuildManager all exist, so its deps close over their real
    // `all()`/`allSites()` methods; before PointerInputController (below), whose onTap/onPaint/
    // onInspect deps call into `this.scenePicker`.
    this.scenePicker = new ScenePicker(this, {
      enemies: () => this.enemyManager.all(),
      trees: () => this.resourceNodeManager.all(),
      allSites: () => this.buildManager.allSites(),
      campfires: () => this.campfireManager.all(),
    });

    // Queue/glow presentation (plan 013 Step 6) — pure presentation over the queue, so it has no
    // GameObjects to build at construction time; kept beside BuildManager for locality (both are
    // "world state managers" wired at the same point in create()).
    this.taskGlowRenderer = new TaskGlowRenderer(this, {
      queueActions: () => this.queue.all(),
      treeById: (id) => this.resourceNodeManager.treeById(id),
      allSites: () => this.buildManager.allSites(),
      siteById: (id) => this.buildManager.siteById(id),
      campfireById: (id) => this.campfireManager.campfireById(id),
      nodeScale: (sprite, def) => this.resourceNodeManager.nodeScale(sprite, def),
    });

    // Gesture + camera controller (plan 013 Step 5) — constructed fresh each (re)start; wires its own
    // pointer listeners and tears them down on SHUTDOWN itself (see the class doc). hudHitTest closes
    // over `this.ui`, assigned further below once UIScene is launched — safe, since no pointer event
    // can fire before create() returns. Build placement and mode dispatch are NOT gesture mechanics —
    // they route back through these deps callbacks (see PointerInputDeps).
    this.pointerInput = new PointerInputController(this, {
      hudHitTest: (x, y) => this.ui.hudHitTest(x, y),
      getPlayerSprite: () => this.player,
      isBuildMode: () => this.buildManager.buildMode,
      onBuildDown: (pointer) => {
        this.buildManager.updateGhost(pointer);
        this.buildManager.placeOrEnqueueBuild(pointer);
      },
      onBuildMove: (pointer) => this.buildManager.updateGhost(pointer),
      getMode: () => this.mode,
      onTap: (pointer) => {
        const action = this.scenePicker.actionAt(pointer.worldX, pointer.worldY);
        // A tap on a tree or a campfire queues a job (harvest / refuel): it falls in behind the current
        // work (or starts at once if the worker is idle) instead of interrupting an in-progress job —
        // harvesting/tending are loops you batch up, so tapping target after target should build a work
        // list, not keep re-targeting. A tap on the ground still redirects the worker now (act-now
        // move); a held-still long-press queues either kind. Because a campfire always resolves to a
        // refuel action (never a move — see ScenePicker.actionAt), tapping the fire can no longer walk
        // the worker into its blocking tile.
        if (
          action.kind === 'harvest' ||
          action.kind === 'refuel' ||
          pointer.getDuration() >= LONGPRESS_MS
        )
          this.enqueue(action);
        else this.order(action); // quick tap on the ground = move now
      },
      onPaint: (pointer) => this.enqueue(this.scenePicker.actionAt(pointer.worldX, pointer.worldY)),
      onInspect: (pointer) => this.scenePicker.inspectAt(pointer.worldX, pointer.worldY),
    });

    // Camera follows the player. The map is larger than the viewport at every zoom, so the camera
    // always has scroll room and tracks the player. Instant (no lerp smoothing): this is a precision
    // tap-to-target game, so the camera should never lag behind where the player actually is.
    // centerOn avoids a visible pan-in from (0,0) on the first frame. A manual drag breaks this lock
    // (free look); the HUD's FOLLOW button re-engages it.
    this.cameras.main.setBounds(originPx.x, originPx.y, worldPx.w, worldPx.h);
    this.cameras.main.centerOn(this.player.x, this.player.y);
    this.registry.set('following', true);
    this.cameras.main.startFollow(this.player, true);
    this.pointerInput.setZoom(this.pointerInput.loadStoredZoom());

    // Fog of war (plan 015 Step 4) — constructed fresh each (re)start, at the same point the old
    // inline fog-of-war block used to run (after the player exists); its own SHUTDOWN teardown drops
    // the `fogShape` reference (never destroys it — see VisionController's class doc).
    this.visionController = new VisionController(this, {
      getPlayerSprite: () => this.player,
      getVision: () => this.playerChar.stats.vision,
      lightSources: () => this.campfireManager.lightSources(),
      worldPx, // fog dim-rect spans the loaded map (plan 018 A9) instead of fixed MAP_WIDTH/HEIGHT
    });

    // Day/night clock + hunger/starvation (plan 015 Step 3) — constructed fresh each (re)start, at
    // the same point the old inline night-overlay block used to run; its own SHUTDOWN teardown drops
    // the overlay reference (never destroys it — see SurvivalClock's class doc). `damagePlayer`/
    // `canAfford`/`spend` are the only scene-owned edges it needs (the starve loop + `eat`).
    this.survivalClock = new SurvivalClock(this, {
      damagePlayer: (amount) => this.damagePlayer(amount),
      canAfford: (cost) => this.inv.canAfford(cost),
      spend: (cost) => this.inv.spend(cost),
      lightSources: () => this.campfireManager.lightSources(),
      worldPx, // night overlay spans the loaded map (plan 018 A9) instead of fixed MAP_WIDTH/HEIGHT
    });

    // HUD overlay runs alongside this scene; grab its instance for the UI-tap guard. UIScene
    // itself isn't restarted on a death-restart (only 'Game' is), so re-emit mode:changed here to
    // resync its mode-toggle/movepad visuals in case death happened mid-Combat/Inspect mode.
    this.scene.launch('UI');
    this.ui = this.scene.get('UI') as UIScene;
    this.game.events.emit('mode:changed', this.mode);
  }

  /** Wire every `game.events` scene↔UIScene listener + its matching SHUTDOWN teardown (the same 12
   *  listeners create() always registered — build/zoom/camera route to the managers that now own
   *  those methods), then push the first queue-highlight refresh. */
  private wireBus(): void {
    this.game.events.on('build:toggle', this.buildManager.toggleBuild, this.buildManager);
    this.game.events.on('build:select', this.onBuildSelect, this);
    this.game.events.on('tasks:cancel', this.cancelAll, this);
    this.game.events.on('debug:randomise', this.randomiseWorld, this); // dev menu: scatter nodes + enemies
    this.game.events.on('debug:toggleTime', this.survivalClock.toggleDayNight, this.survivalClock); // dev menu: flip day/night
    this.game.events.on('zoom:delta', this.pointerInput.adjustZoom, this.pointerInput);
    this.game.events.on('camera:center', this.pointerInput.centerOnPlayer, this.pointerInput);
    this.game.events.on('combat:attack', this.attack, this);
    this.game.events.on('mode:combatToggle', this.onCombatToggle, this);
    this.game.events.on('mode:inspectToggle', this.onInspectToggle, this);
    this.game.events.on('needs:eat', this.survivalClock.onNeedsEat, this.survivalClock);
    this.game.events.on('combat:move', this.onCombatMove, this);
    this.game.events.on('combat:moveEnd', this.onCombatMoveEnd, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('build:toggle', this.buildManager.toggleBuild, this.buildManager);
      this.game.events.off('build:select', this.onBuildSelect, this);
      this.game.events.off('tasks:cancel', this.cancelAll, this);
      this.game.events.off('debug:randomise', this.randomiseWorld, this);
      this.game.events.off(
        'debug:toggleTime',
        this.survivalClock.toggleDayNight,
        this.survivalClock,
      );
      this.game.events.off('zoom:delta', this.pointerInput.adjustZoom, this.pointerInput);
      this.game.events.off('camera:center', this.pointerInput.centerOnPlayer, this.pointerInput);
      this.game.events.off('combat:attack', this.attack, this);
      this.game.events.off('mode:combatToggle', this.onCombatToggle, this);
      this.game.events.off('mode:inspectToggle', this.onInspectToggle, this);
      this.game.events.off('needs:eat', this.survivalClock.onNeedsEat, this.survivalClock);
      this.game.events.off('combat:move', this.onCombatMove, this);
      this.game.events.off('combat:moveEnd', this.onCombatMoveEnd, this);
    });

    this.emitTasks();
  }

  /**
   * DEV-only: build the {@link TestApi} facade + install `window.game.__test` (plan 007; plan 013
   * Step 6 — the ~220 lines of scenario/debug logic now live in src/scenes/testApi.ts, reached
   * through the narrow `TestApiDeps` facade so GameScene's own private fields never widen). Gated on
   * import.meta.env.DEV so `vite build` dead-code-eliminates this whole block — the production bundle
   * installs no `__test` and `window.game.__test` is undefined there. The e2e runner therefore serves
   * `vite dev`, where DEV === true.
   */
  private installTestApi(): void {
    if (!import.meta.env.DEV) return;
    const testApi = new TestApi(this, {
      buildManager: this.buildManager,
      campfireManager: this.campfireManager,
      taskGlowRenderer: this.taskGlowRenderer,
      fx: this.fx,
      pointerInput: this.pointerInput,
      playerChar: this.playerChar,
      queue: this.queue,
      inv: this.inv,
      nightOverlay: this.survivalClock.nightOverlay,
      gridDims: this.gridDims,
      getPlayerSprite: () => this.player,
      trees: () => this.resourceNodeManager.all(),
      enemies: () => this.enemyManager.all(),
      treeById: (id) => this.resourceNodeManager.treeById(id),
      addNode: (def, col, row) => this.resourceNodeManager.addNode(def, col, row),
      addEnemy: (id, col, row, opts) => this.enemyManager.addEnemy(id, col, row, opts),
      resetTreesAndEnemies: () => this.resetTreesAndEnemies(),
      clearActionGoal: () => {
        this.actionGoal = null;
      },
      setChopElapsed: (v) => {
        this.chopElapsed = v;
      },
      setHarvestSwing: (v) => {
        this.harvestSwing = v;
      },
      setCombatMoveVec: (v) => {
        this.combatMoveVec = v;
      },
      getMode: () => this.mode,
      setModeAndEmit: (m) => {
        this.mode = m;
        this.game.events.emit('mode:changed', this.mode);
      },
      setRng: (fn) => {
        this.rng = fn;
      },
      getClockMs: () => this.survivalClock.clockMs,
      setClockMs: (v) => {
        this.survivalClock.clockMs = v;
      },
      getDayPhase: () => this.survivalClock.dayPhase,
      setDayPhase: (v) => {
        this.survivalClock.dayPhase = v;
      },
      getDayCount: () => this.survivalClock.dayCount,
      setDayCount: (v) => {
        this.survivalClock.dayCount = v;
      },
      getHunger: () => this.survivalClock.hunger,
      setHunger: (v) => {
        this.survivalClock.hunger = v;
      },
      setStarveElapsed: (v) => {
        this.survivalClock.starveElapsed = v;
      },
      updateVision: () => this.visionController.update(),
      emitTasks: () => this.emitTasks(),
      inspectAt: (x, y) => this.scenePicker.inspectAt(x, y),
      isBlocked: (col, row) => this.isBlocked(col, row),
    });
    const api: GameTestApi = {
      applyScenario: (spec) => testApi.applyScenario(spec),
      step: (ms) => testApi.step(ms),
      setRng: (fn) => {
        this.rng = fn;
      },
      state: () => testApi.debugState(),
      order: (a) => this.order(a),
      enqueue: (a) => this.enqueue(a),
      inspect: (c, r) => testApi.inspect(c, r),
      blocked: (c, r) => testApi.isTileBlocked(c, r),
      tryPlace: (id, c, r) => testApi.tryPlace(id, c, r),
      inLight: (c, r) => testApi.inLight(c, r),
      feedCampfire: (i) => testApi.feedCampfire(i),
    };
    (this.game as unknown as { __test?: GameTestApi }).__test = api;
  }

  override update(_time: number, delta: number): void {
    this.harvestSwing = null; // re-set by runHarvest only while actually harvesting in place
    this.taskGlowRenderer.syncGlowTransforms(); // keep queued-tree halos locked to their (possibly animating) trees

    // Player is collapsing: freeze the world on the death anim (which advances on its own via Phaser's
    // anim system) until the scheduled scene.restart() fires. No clock/hunger tick, no input, no AI —
    // a clean death beat. The sprite's velocity is pinned to 0 so nothing drifts under the animation.
    if (this.playerChar.dying) {
      this.player.body.setVelocity(0, 0);
      return;
    }

    // Survival tick — day/night clock + hunger/starvation, above the no-action early-return below, so
    // time passes whether or not a worker task is active. See src/scenes/world/SurvivalClock.ts.
    this.survivalClock.tick(delta);

    // Campfire fuel drains every frame too (above the early-return), so a fire burns down whether or
    // not a worker task is active — mirrors the survival tick. See src/scenes/world/CampfireManager.ts.
    this.campfireManager.tick(delta);

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
      this.visionController.update();
      this.enemyManager.update();
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
      case 'refuel':
        this.runRefuel(action, delta);
        break;
    }
    this.playerChar.updateAnim(this.harvestSwing);
    this.visionController.update();
    this.enemyManager.update();
  }

  // --- Obstacle grid + path following -------------------------------------

  /**
   * Walkability for the pathfinder: completed walls and live *blocking* nodes (trees/rocks) block;
   * blueprints and non-blocking nodes (bushes, `def.blocksPath === false`) are passable.
   */
  private readonly isBlocked = (col: number, row: number): boolean =>
    this.buildManager.isOccupied(col, row) ||
    this.resourceNodeManager.hasBlockingNode(col, row) ||
    this.decorManager.blocksAt(col, row) ||
    // The map's own base walkability composites UNDER the runtime obstacles above (plan 018 A5/A11);
    // convert the GLOBAL (col,row) back to map-local by subtracting the map origin.
    mapBlocks(this.startMap, col - this.mapOrigin.col, row - this.mapOrigin.row);

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
    breadcrumb('action', `begin ${a.kind}`, { target: this.describeActionTarget(a) });
    if (a.kind === 'move') {
      if (!this.pathTo({ col: a.col, row: a.row })) this.completeCurrent();
      return;
    }
    if (a.kind === 'harvest') {
      const tree = this.resourceNodeManager.treeById(a.treeId);
      if (!tree || !tree.alive) return this.completeCurrent();
      // Bag can't accept this node's yield → don't even start the walk-and-swing; abort the order.
      if (!this.inv.canAccept(tree.def.yieldItemId, tree.def.yieldPerHit)) {
        this.resourceNodeManager.flashBagFull(tree);
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
    if (a.kind === 'refuel') {
      const c = this.campfireManager.campfireById(a.campfireId);
      if (!c) return this.completeCurrent();
      // Nothing to do → flash a refusal and drop the order rather than walk over for a no-op: the bag's
      // empty, or the fire's already topped up (a full wood wouldn't fit — the no-waste rule runRefuel
      // also completes on). Mirrors harvest's "can't-start → flashBagFull + complete" abort.
      if (!this.inv.canAfford({ wood: 1 }) || CAMPFIRE_FUEL_MAX - c.fuel < CAMPFIRE_FUEL_PER_WOOD) {
        this.campfireManager.flashNoFuel(c);
        return this.completeCurrent();
      }
      // Stand on any tile adjacent to the fire's foot tile (it blocks its own tile, like a rock).
      const stand = reachableAdjacent(
        this.playerChar.tile(),
        { col: c.col, row: c.row },
        this.isBlocked,
        this.gridDims,
      );
      if (!stand || !this.pathTo(stand)) this.completeCurrent();
      return;
    }
    // build
    const site = this.buildManager.siteById(a.siteId);
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
    if (a.kind === 'refuel' && this.isRefuelQueued(a.campfireId)) {
      this.toggleRefuel(a.campfireId);
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

  /** True if a campfire already has a refuel order (current or pending). */
  private isRefuelQueued(campfireId: string): boolean {
    return this.queue.all().some((x) => x.kind === 'refuel' && x.campfireId === campfireId);
  }

  /** Remove a campfire's refuel order — the fire-tending analogue of {@link toggleHarvest}: tapping a
   *  fire that's already queued un-queues it (tap again to re-queue at the end). If it was the live
   *  refuel, advance to the next order (or go idle) so the worker stops tending a fire you cancelled. */
  private toggleRefuel(campfireId: string): void {
    const wasCurrent = this.queue.removeWhere(
      (x) => x.kind === 'refuel' && x.campfireId === campfireId,
    );
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
    this.taskGlowRenderer.refreshQueueHighlights();
    this.game.events.emit('tasks:changed', {
      current: this.queue.current?.kind ?? null,
      pending: this.queue.pending,
    });
  }

  // --- Harvest / build executors ------------------------------------------

  private runHarvest(a: Extract<Action, { kind: 'harvest' }>, delta: number): void {
    const tree = this.resourceNodeManager.treeById(a.treeId);
    if (!tree || !tree.alive) return this.completeCurrent();
    // If the bag can no longer accept this node's yield, abort the order rather than swing forever on
    // a node we can never fell (critique #1): the task only completes at hp<=0, so skipping the hit
    // alone would jam the queue head. Aborting clears it and frees any orders queued behind it.
    if (!this.inv.canAccept(tree.def.yieldItemId, tree.def.yieldPerHit)) {
      this.resourceNodeManager.flashBagFull(tree);
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
        this.resourceNodeManager.chop(tree);
      }
    }
  }

  private runBuild(a: Extract<Action, { kind: 'build' }>, delta: number): void {
    const site = this.buildManager.siteById(a.siteId);
    if (!site || site.done) return this.completeCurrent();
    if (this.playerChar.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.playerChar.faceTile(site.col, site.row); // face the blueprint while building it
      site.progress += delta;
      site.rect.setAlpha(0.35 + 0.55 * Math.min(1, site.progress / BUILD_MS));
      if (site.progress >= BUILD_MS) {
        this.buildManager.finishSite(site);
        this.completeCurrent();
      }
    }
  }

  /**
   * Tend a campfire: walk to the stand tile (set in beginCurrent) then feed one wood every
   * CAMPFIRE_FEED_INTERVAL_MS until the fire is topped up or the bag runs dry. Mirrors {@link runHarvest}
   * (walk-then-repeat-in-place), but self-terminates on *conditions* rather than the target's death,
   * since a fire persists:
   *  - **Topped up** — complete once a whole wood no longer fits (`MAX - fuel < PER_WOOD`). Checked
   *    every frame, NOT `fuel >= MAX`: tick() drains fuel each frame, so exact-full is never observable
   *    and the order would spin forever; this "no-waste" bound also never feeds a wood that would
   *    overflow the clamp.
   *  - **Out of wood** — if a feed can't be paid for mid-order, flash a refusal and complete rather
   *    than idle-swing on a fire we can't feed (the harvest bag-full abort, applied to fuel).
   */
  private runRefuel(a: Extract<Action, { kind: 'refuel' }>, delta: number): void {
    const c = this.campfireManager.campfireById(a.campfireId);
    if (!c) return this.completeCurrent();
    if (CAMPFIRE_FUEL_MAX - c.fuel < CAMPFIRE_FUEL_PER_WOOD) return this.completeCurrent(); // topped up
    if (this.playerChar.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.playerChar.faceTile(c.col, c.row); // tend toward the fire, whatever side we stood on
      this.harvestSwing = 'gather'; // the forage/tend loop reads as feeding the fire
      this.chopElapsed += delta;
      if (this.chopElapsed >= CAMPFIRE_FEED_INTERVAL_MS) {
        this.chopElapsed = 0;
        if (!this.campfireManager.feedOne(c)) {
          this.campfireManager.flashNoFuel(c); // bag ran dry mid-order — abort, don't idle-swing
          this.completeCurrent();
        }
      }
    }
  }

  // --- Input gate ----------------------------------------------------------
  //
  // Gesture recognition (tap/long-press-paint/pan/pinch) + the camera it drives live in
  // PointerInputController (plan 013 Step 5) — it resolves mechanics and calls back into onTap/
  // onPaint/onInspect (below, via the deps passed at construction in create()) for the mode-dependent
  // intent. Build-mode placement (isBuildMode/onBuildDown/onBuildMove deps) stays here too. The
  // pointer "raycast" + tap/inspect-intent resolution itself lives in ScenePicker (plan 015 Step 5) —
  // see src/scenes/input/ScenePicker.ts; onTap/onPaint call `this.scenePicker.actionAt`, onInspect
  // calls `this.scenePicker.inspectAt`.

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

  /** Attack the facing tile: flat damage via the shared combat formula, no range/arc beyond that
   * tile — but an enemy is hit anywhere its hurtbox reaches it (see EnemyManager.enemyAt). Enemies
   * only; trees keep using chop(). */
  private attack(): void {
    this.fx.playAttackSwing(); // swing on every press, even a whiff, so the input always feels heard
    const pt = this.playerChar.tile();
    const col = pt.col + this.playerChar.lastFacing.dCol;
    const row = pt.row + this.playerChar.lastFacing.dRow;
    const enemy = this.enemyManager.enemyAt(col, row);
    if (!enemy) return;
    const dmg = resolveMeleeAttack(this.playerChar.stats, enemy.def, UNARMED_BASE_DAMAGE, this.rng);
    enemy.takeDamage(dmg);
    if (enemy.hp <= 0) {
      this.enemyManager.killEnemy(enemy); // play the death collapse, then remove the corpse
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
   * Player death: freeze the world on a one-shot Death collapse, then restart the scene (the existing
   * "Death = restart" reset — see damagePlayer). Guarded by `playerChar.dying` so a crowd of enemies
   * can't re-enter this each frame. We cancel any active order and clear an in-flight hit-flash, then
   * `playerChar.die()` freezes + plays the collapse; update() holds everything still until the
   * scheduled restart fires (the delayedCall runs on the scene clock, which the test harness drives).
   */
  private killPlayer(): void {
    console.log('player down — restarting'); // the death→restart signal the death spec asserts
    breadcrumb('world', 'player died → scene.restart scheduled');
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

  /** Palette picked a buildable (UIScene `build:select`): route to BuildManager, which remembers the
   *  selection and enters build mode. */
  private onBuildSelect({ id }: { id: string }): void {
    this.buildManager.select(id);
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

  // --- Resource nodes / harvesting -----------------------------------------
  //
  // Spawning/harvest/regrow + the "does a live node block this tile" query live in
  // ResourceNodeManager (plan 015 Step 1) — see src/scenes/world/ResourceNodeManager.ts.

  /** Destroy every resource node + enemy GameObject and reset both arrays + id counters — the shared
   *  preamble of a full world reset (used by the DEV-only scenario reset via
   *  TestApiDeps.resetTreesAndEnemies; mirrors randomiseWorld's own calls below, which pass
   *  `resetIds: false` since a dev-menu scatter has no need for ids restarting at 0). */
  private resetTreesAndEnemies(): void {
    this.resourceNodeManager.clearAll({ resetIds: true });
    this.enemyManager.clearAll({ resetIds: true });
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
    this.resourceNodeManager.clearAll({ resetIds: false }); // keeps its id counter running (pre-existing)
    this.enemyManager.clearAll({ resetIds: false }); // same — id counter keeps running (pre-existing)

    const pt = this.playerChar.tile();
    const used = new Set<string>([tileKey(pt.col, pt.row)]);
    // Pick a random empty tile (in bounds, not a wall/blueprint/already-used), at least `minPlayerDist`
    // tiles (Chebyshev) from the player. Returns null if it can't find one within the attempt budget.
    const pickTile = (minPlayerDist: number): Cell | null => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const col = Math.floor(Math.random() * this.gridDims.cols);
        const row = Math.floor(Math.random() * this.gridDims.rows);
        const key = tileKey(col, row);
        if (
          used.has(key) ||
          this.buildManager.isOccupied(col, row) ||
          this.buildManager.hasSiteTile(col, row)
        )
          continue;
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
      this.resourceNodeManager.addNode(
        nodePool[Math.floor(Math.random() * nodePool.length)],
        tile.col,
        tile.row,
      );
    }

    const enemyCount = 8 + Math.floor(Math.random() * 9); // 8..16
    for (let i = 0; i < enemyCount; i++) {
      const tile = pickTile(6); // keep enemies clear of the player's tile
      if (!tile) break;
      this.enemyManager.addEnemy('kidZombie', tile.col, tile.row);
    }
  }
}
