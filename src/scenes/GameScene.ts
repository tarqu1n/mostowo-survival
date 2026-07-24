import Phaser from 'phaser';
import {
  START_MAP_ID,
  SPAWN_TILE,
  TILE_SIZE,
  CHOP_INTERVAL_MS,
  CAMPFIRE_FUEL_MAX,
  CAMPFIRE_FUEL_PER_WOOD,
  CAMPFIRE_FEED_INTERVAL_MS,
  WORKBENCH_REPAIR_INTERVAL_MS,
  WORKBENCH_REPAIR_PER_TICK,
  CRAFT_DAMAGED_MIN_FRAC,
  LONGPRESS_MS,
  BUILD_MS,
  SALVAGE_MS,
  CLEAR_MS,
  COMBAT_ACTIVE_RADIUS_TILES,
  COMBAT_ACTIVE_HYSTERESIS_TILES,
  INVENTORY_SLOTS,
  DEFAULT_MAX_STACK,
  PLAYER_LIGHT_RADIUS,
} from '../config';
import { ITEMS } from '../data/items';
import { BUILDABLES } from '../data/buildables';
import { RECIPES } from '../data/recipes';
import { iconKey } from '../data/tileset';
import { Inventory } from '../systems/Inventory';
import { BaseSupply } from '../systems/baseSupply';
import { tileToWorldCenter, worldToTile } from '../systems/grid';
import { findPath, reachableAdjacent, type Cell } from '../systems/pathfind';
import { originOf } from '../systems/mapRuntime';
import { mapBlocks } from '../systems/mapWalkability';
import { zoneAt } from '../systems/mapZones';
import type { MapFile, DecorObject, NodeObject, PortalObject } from '../systems/mapFormat';
import { breadcrumb, setCrashContext } from '../debug/crashReporter';
import { TaskQueue, type Action } from '../systems/tasks';
import { ORDER_META, isOrderQueued, orderTargetId, toggleOrder } from '../systems/orders';
import { harvestAnimMotion } from '../systems/nodeDefs';
import { rollLoot } from '../systems/loot';
import { objectAsDefender } from '../systems/combat';
import { hurtboxTiles, DEFAULT_HURTBOX } from '../systems/hurtbox';
import type { DayPhase } from '../systems/daynight';
import type { GameTestApi } from '../entities/testTypes';
import type { PlacedStructure } from '../entities/types';
import type { CharacterSprite } from '../entities/Character';
import { PlayerCharacter } from '../entities/PlayerCharacter';
import { CombatFxManager } from './fx/CombatFxManager';
import { NodeFxManager } from './fx/NodeFxManager';
import { PointerInputController } from './input/PointerInputController';
import { ScenePicker } from './input/ScenePicker';
import { BuildManager } from './build/BuildManager';
import { TaskGlowRenderer } from './fx/TaskGlowRenderer';
import { ResourceNodeManager } from './world/ResourceNodeManager';
import { DecorManager } from './world/DecorManager';
import { EnemyManager } from './world/EnemyManager';
import { CompanionManager } from './world/CompanionManager';
import type { NpcCharacter, NpcDayRole, NpcNightPosture } from '../entities/NpcCharacter';
import { StructureManager } from './world/StructureManager';
import { CampfireBehavior } from './world/CampfireBehavior';
import { WallBehavior } from './world/WallBehavior';
import { TrapBehavior } from './world/TrapBehavior';
import { WorkbenchBehavior } from './world/WorkbenchBehavior';
import { SurvivalClock } from './world/SurvivalClock';
import { WaveDirector } from './world/WaveDirector';
import { VisionController } from './fx/VisionController';
import { CombatController } from './combat/CombatController';
import { DevWorldTools } from './world/DevWorldTools';
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

  // The AI companion (plan 042) — spawn, per-frame drive, reset/teardown — see
  // src/scenes/world/CompanionManager.ts. Owns the single NpcCharacter. Constructed fresh in
  // buildWorld() each (re)start, AFTER the player (construction order is load-bearing — later steps'
  // tick env reads player state); wires its own SHUTDOWN teardown. Replaces the Step-1 dev seam.
  private companionManager!: CompanionManager;

  /** The shared base-supply pool (plan 042 Step 3): a `wood`/`rock` stockpile SEPARATE from the player
   *  {@link Inventory} (critique #3), the sink the companion gathers into (Step 4) + the source wall
   *  repairs draw from (Step 5). Owned here, constructed fresh per `buildWorld()` (so a death-restart
   *  starts empty), surfaced in `debugState().baseSupply`, seeded by a scenario's `baseSupply`, and
   *  bridged to the HUD via `supply:changed` (see buildWorld). Exposed to CompanionManager via
   *  {@link supply} when Steps 4/5 need it. See src/systems/baseSupply.ts. */
  private baseSupply!: BaseSupply;

  /** The shared base-supply stockpile — CompanionManager reaches it here once the gather/repair loop
   *  lands (plan 042 Steps 4/5). Constructed in buildWorld, so only valid after (re)start. */
  get supply(): BaseSupply {
    return this.baseSupply;
  }

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
  // exclusive; the DOM HUD mirrors this for highlighting/visibility via 'mode:changed'.
  private mode: 'command' | 'combat' | 'inspect' = 'command';

  // Demolish mode (plan 037 chunk 2b): while on, a command-mode tap on a finished wall enqueues a
  // `deconstruct` worker order for it (walk adjacent → remove + partial refund). Layered on command
  // mode (like build mode, it's not one of the three `mode` values) and MUTUALLY EXCLUSIVE with build
  // mode — turning either on turns the other off. Non-destructive: toggling it never cancelAll()s the
  // queue (mirrors build mode). The DOM HUD mirrors it via `demolish:modeChanged` for the DEMOLISH button.
  private demolishMode = false;

  // Guard-point placement (plan 042 Step 9): armed by the companion assignment menu's "Guard here"
  // option, it makes the NEXT command-mode world tap set the companion's guard tile (and its night
  // posture to `guard`), then disarms — the arm→place→disarm shape build placement uses. A tap back
  // on the NPC while armed cancels it (as does Escape). Layered on command mode like demolish mode.
  private placingGuardPoint = false;

  // Auto-surface combat controls (plan 035a Step 3): recomputed every frame (updateCombatActive) —
  // true while a live enemy is within COMBAT_ACTIVE_RADIUS_TILES of the player OR it's night. Drives
  // whether the movepad is authoritative (movepadDrives) and whether the DOM HUD reveals the fighting
  // (emitted as `combat:activeChanged`). Independent of `mode`: it never flips `mode` to 'combat'
  // (that cancelAll()s the task queue), so command-mode taps keep queuing orders while it's true.
  private combatActive = false;

  // Player combat — melee/bow/damage/death flow + the bow's auto-target (plan 011 combat; extracted to
  // src/scenes/combat/CombatController.ts). Constructed fresh in buildWorld() each (re)start (after the
  // player exists); wires its own SHUTDOWN teardown. wireBus() routes combat:attack/combat:bow here,
  // and the EnemyManager bite + SurvivalClock starve edges route to its damagePlayer.
  private combatController!: CombatController;

  // DEV-only world tools — the dev-menu scatter/spawn seams + the scenario-reset primitive (extracted
  // to src/scenes/world/DevWorldTools.ts). Stateless; constructed fresh in buildWorld() each (re)start.
  private devWorldTools!: DevWorldTools;

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

  // Harvest-node FX (per-hit recoil + escalating tremble, per-kind fell payoff) — see
  // src/scenes/fx/NodeFxManager.ts (plan 031). Same field-initializer + armShutdown/reset lifecycle as
  // `fx` above (create() arms + resets it each (re)start); ResourceNodeManager reaches it only via the
  // playChopFx/playFellFx dep closures wired in buildWorld() (scene mediates — no manager↔manager edge).
  private readonly nodeFx = new NodeFxManager(this);

  // Day/night clock + hunger/starvation (plan 015 Step 3) — see src/scenes/world/SurvivalClock.ts.
  // Owns clockMs/dayPhase/dayCount/hunger/starveElapsed + the night light-layer RenderTexture (sole writer).
  // Constructed fresh in buildWorld() each (re)start, at the same point the old inline night-overlay
  // block used to run; wires its own SHUTDOWN teardown directly.
  private survivalClock!: SurvivalClock;

  // Night wave scheduler (plan 038 Step 3) — see src/scenes/world/WaveDirector.ts. Paces skeleton
  // spawns from the "treeline" during the night phase over the existing EnemyManager + day/night clock.
  // Constructed fresh in buildWorld() each (re)start (after SurvivalClock); its time:changed
  // subscription is wired in wireBus() with the matching SHUTDOWN off (like the other game.events).
  private waveDirector!: WaveDirector;

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

  // Live/simulated buildables (plan 037) — owns the world's structures as one homogeneous
  // PlacedStructure population behind a behavior registry: a CampfireBehavior (plan 012 — fuel-drained
  // per tick, casts the light both SurvivalClock and VisionController read) and a WallBehavior (plan
  // 037 — destructible barricades). Every consumer (materialise/tick/lightSources/pick/stats/reset)
  // routes through this single manager; behavior-SPECIFIC ops reach the module via `campfire`/`wall`
  // (both resolve through it — see the getters). Constructed fresh in buildWorld() each (re)start; it
  // wires ONE SHUTDOWN teardown that fans out to every module. See world/StructureManager.ts.
  private structureManager!: StructureManager;

  /** The campfire behavior module, reached through the structure registry — for the behavior-SPECIFIC
   *  campfire ops the generic StructureManager route doesn't cover (feed/damageFire/flashNoFuel/…). */
  private get campfire(): CampfireBehavior {
    return this.structureManager.behavior<CampfireBehavior>('campfire');
  }

  /** The wall behavior module, reached through the structure registry — for the behavior-SPECIFIC wall
   *  ops (takeDamage/thornsOf/deconstruct/wallAt/…) the generic StructureManager route doesn't cover. */
  private get wall(): WallBehavior {
    return this.structureManager.behavior<WallBehavior>('wall');
  }

  /** The spike-trap behavior module, reached through the structure registry — for the behavior-SPECIFIC
   *  trap ops (rearm/trapById/trapAt) the generic StructureManager route doesn't cover (plan 040). */
  private get trap(): TrapBehavior {
    return this.structureManager.behavior<TrapBehavior>('trap');
  }
  /** The workbench behavior module, reached through the structure registry — for the behavior-SPECIFIC
   *  bench ops (takeDamage/repair/benchById/benchAt) the generic StructureManager route doesn't cover
   *  (plan 048): the enemy-attack seam + the player repair order. */
  private get workbench(): WorkbenchBehavior {
    return this.structureManager.behavior<WorkbenchBehavior>('workbench');
  }

  // Pointer "raycast" + the tap/inspect intent built on top of it (plan 015 Step 5) — see
  // src/scenes/input/ScenePicker.ts. Stateless (no fields but scene+deps, no SHUTDOWN teardown — see
  // its class doc). Constructed fresh in buildWorld() each (re)start, right after ResourceNodeManager/
  // EnemyManager/BuildManager exist (its deps close over their real methods) and before
  // PointerInputController (whose deps read `this.scenePicker`).
  private scenePicker!: ScenePicker;

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
  // actors outside vision. Does NOT own the night light-layer (SurvivalClock does — see there). Constructed
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
        combatActive: this.combatActive,
        action: a ? { kind: a.kind, target: this.describeActionTarget(a) } : null,
        harvestSwing: this.harvestSwing,
        playerTile: this.playerChar?.tile(),
        playerHp: this.playerChar?.hp,
        nodes: this.resourceNodeManager?.all().length,
        map: START_MAP_ID,
        portals: this.portals.length, // parse-and-hold count (plan 018); wired for transitions in 019
      };
    });
    // Reveal the page-level DOM HUD: it outlives every scene and is hidden while Boot/Preload/MainMenu
    // run (the loading + title screens), so flip the registry flag the bridge mirrors now that the
    // world is live. Cleared on SHUTDOWN (see wireBus) so a death-restart re-hides until the next create.
    this.registry.set('sceneActive', true);
    breadcrumb('scene', 'GameScene create done');
  }

  /** One-line description of an action's target for the crash report (no sprite refs). Every ordered
   *  kind reports its target id (`orderTargetId`); a bare move reports its tile. */
  private describeActionTarget(a: Action): string {
    return orderTargetId(a) ?? (a.kind === 'move' ? `(${a.col},${a.row})` : '');
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
    this.combatActive = false; // recomputed on the first update() tick; HUD resynced in buildWorld
    // The bow's auto-target lives on CombatController now (reconstructed fresh in buildWorld, so a
    // death-restart starts with no target); its FX highlight is cleared via fx.resetCombatFx below.
    // Combat-FX state — (re-)arm the SHUTDOWN flush (see CombatFxManager.armShutdown) then clear so a
    // death-restart starts clean: the maps/set held tweens+sprites from the dead run (Phaser destroyed
    // them on teardown, so drop the stale references). Player-side state (hp/facing/path/attack-lock/
    // dying) needs no reset here — a fresh PlayerCharacter is constructed below each (re)start.
    this.fx.armShutdown();
    this.fx.resetCombatFx();
    // Node FX — same (re-)arm + clear discipline (see NodeFxManager): the previous run's tweens were
    // torn down on SHUTDOWN (refs dropped), so reset() runs on an empty collection here and re-arms.
    this.nodeFx.armShutdown();
    this.nodeFx.reset();
    this.mode = 'command';
    this.demolishMode = false; // a death-restart starts clear of demolish mode (HUD resynced in buildWorld)
    this.placingGuardPoint = false; // …and clear of any half-armed guard-point placement (plan 042 Step 9)
    // baseSupply is (re)constructed fresh in buildWorld (like the shared Inventory), so a death-restart
    // starts with an empty pool without an explicit reset here — see plan 042 Step 3.
  }

  /**
   * Build this (re)start's world from the authored start map (plan 018): baked tile layers + decor,
   * shared inventory, resource nodes hydrated from `node` objects + the (still procedural) first enemy
   * pack, player + enemy animations, the player character spawned at `SPAWN_TILE`, the
   * build/queue-glow/pointer managers, and the camera + fog-of-war + night overlay sized to the map.
   * Order matters in one place (called out inline): the player must exist before BuildManager's
   * collider. The HUD is the page-level DOM overlay (plan 046) — not a scene launched here — so the
   * tail only re-emits current state onto the bus for its bridge to re-sync.
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

    // Shared character inventory — stored in the registry so the HUD reads the same instance.
    this.inv = new Inventory({
      capacity: INVENTORY_SLOTS,
      maxStackOf: (id) => ITEMS[id]?.maxStack ?? DEFAULT_MAX_STACK,
    });
    this.registry.set('inventory', this.inv);

    // Shared base-supply pool (plan 042 Step 3) — fresh each (re)start (so a death-restart starts
    // empty). Bridge its 'change' to a `supply:changed` game event so the HUD reflects
    // deposits/withdrawals/seeding, mirroring how CampfireBehavior feeds the fire bar via `fire:changed`.
    this.baseSupply = new BaseSupply();
    this.baseSupply.on('change', (snap: { wood: number; rock: number }) =>
      this.game.events.emit('supply:changed', snap),
    );

    // Resource nodes (plan 015 Step 1) — constructed before the player (its constructor must not
    // touch player closures); loadNodes() is a separate call right after so construction itself
    // stays side-effect-free. See ResourceNodeManagerDeps for why each closure is narrowed this way.
    this.resourceNodeManager = new ResourceNodeManager(this, {
      repath: () => this.repath(),
      addYield: (itemId, n) => this.inv.add(itemId, n),
      playChopFx: (input) => this.nodeFx.playChop(input),
      playFellFx: (input) => this.nodeFx.playFell(input),
      playYieldFx: (input) => this.nodeFx.playYieldFloat(input),
    });
    // Hydrate resource nodes from authored `node` objects (plan 018 A6).
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
      onPlayerHurt: () => this.combatController.onPlayerHurt(),
      damagePlayer: (amount) => this.combatController.damagePlayer(amount),
      // Companion NPC as a threat (plan 042 Step 6) — a narrow snapshot assembled from CompanionManager
      // (the scene mediates; no manager↔manager edge). Null when unspawned; EnemyManager omits a downed
      // NPC from the threat list. `damageNpc`/`onNpcHurt` are the NPC twins of the player bite seams.
      companion: () => {
        const npc = this.companionManager.get();
        if (!npc) return null;
        return {
          tile: npc.tile(),
          pos: { x: npc.sprite.x, y: npc.sprite.y },
          stats: npc.stats,
          downed: npc.downed,
        };
      },
      onNpcHurt: () => this.onNpcHurt(),
      damageNpc: (amount) => this.damageNpc(amount),
      litHearth: () => this.litHearth(),
      attackFire: (id, amount) => this.campfire.damageFire(id, amount),
      // Structure-target seam (plan 037 2c) — the blocking structure a walled-off mob bashes, plus its
      // combat defender (armour, zeroed offence) + thorns; routes to the owning behavior module. A wall
      // (plan 037) OR a workbench (plan 048) can be in the way — both `blocksPath`, so a mob pathing to
      // the fire/player bashes whichever sits on the tile. The bench has no thorns. Checked wall-first;
      // only one blocking structure ever occupies a tile.
      structureAt: (col, row) => {
        const w = this.wall.wallAt(col, row);
        if (w)
          return {
            id: w.id,
            defender: objectAsDefender(BUILDABLES.wall),
            thorns: this.wall.thornsOf(w.id),
          };
        const b = this.workbench.benchAt(col, row);
        if (b) return { id: b.id, defender: objectAsDefender(BUILDABLES.workbench), thorns: 0 };
        return null;
      },
      // Route damage to the module that owns the id (ids are module-prefixed, but resolve by lookup so
      // this never assumes the prefix format): a wall if one has that id, else a workbench.
      attackStructure: (id, dmg) =>
        this.wall.wallById(id) ? this.wall.takeDamage(id, dmg) : this.workbench.takeDamage(id, dmg),
      flashHit: (sprite) => this.fx.flashHit(sprite),
      lungeAt: (m, x, y) => this.fx.lungeAt(m, x, y),
      beginWindUp: (m, ms) => this.fx.beginWindUp(m, ms),
      endWindUp: (m) => this.fx.endWindUp(m),
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

    // AI companion (plan 042 Step 2) — constructed AFTER the player (construction order is load-bearing:
    // later steps' per-frame tick env reads player state). Side-effect-free like EnemyManager: it does
    // NOT auto-spawn — a dev seam / scenario calls spawn() — and wires its own SHUTDOWN teardown.
    this.companionManager = new CompanionManager(this, {
      dims: () => this.gridDims,
      isBlocked: (col, row) => this.isBlocked(col, row),
      playerTile: () => this.playerChar.tile(),
      dayPhase: () => this.survivalClock.dayPhase,
      nodes: () => this.resourceNodeManager.all(),
      chopNode: (tree, facing, onYield) => this.resourceNodeManager.chop(tree, facing, onYield),
      litHearthTile: () => this.litHearth()?.tile ?? null,
      supplyAdd: (item, n) => this.baseSupply.add(item, n),
      // Repair day role (plan 042 Step 5) — the wall-facing deps. Call-time closures over the `wall`
      // behavior getter (resolved lazily, so it's live even though StructureManager is constructed just
      // below this) + the base-supply pool; kept narrow (a plain snapshot + ops), never the manager.
      walls: () =>
        this.wall
          .all()
          .map((w) => ({ id: w.id, col: w.col, row: w.row, hp: w.state.hp, maxHp: w.state.maxHp })),
      repairWall: (id, amount) => this.wall.repair(id, amount),
      supplyCount: (item) => this.baseSupply.count(item),
      supplyTake: (item, n) => this.baseSupply.take(item, n),
      // Night combat (plan 042 Step 7) — the enemy-facing deps. A plain per-tick snapshot of the live
      // mobs as combat targets (id + world pos + feet tile + body tiles + stats), and a damage op that
      // routes back through EnemyManager.hurtEnemy BY ID — the SAME kill/flash/corpse path the player's
      // attack + the trap use, so enemy-death bookkeeping isn't duplicated. `rng` mirrors EnemyManager's
      // so the DEV test API's pinned rng reaches the companion's hit rolls too.
      enemies: () =>
        this.enemyManager
          .all()
          .filter((z) => z.alive)
          .map((z) => ({
            id: z.id,
            pos: { x: z.sprite.x, y: z.sprite.y },
            tile: { col: z.col, row: z.row },
            bodyTiles: hurtboxTiles({ col: z.col, row: z.row }, z.def.hurtbox ?? DEFAULT_HURTBOX),
            stats: z.def,
          })),
      damageEnemy: (id, amount) => {
        const z = this.enemyManager.all().find((e) => e.id === id && e.alive);
        if (z) this.enemyManager.hurtEnemy(z, amount);
      },
      rng: () => this.rng(),
      // Refuel night posture (plan 042 Step 8) — feed the lit hearth `amount` fuel WITHOUT an Inventory
      // spend (the companion sources wood from the base-supply pool via `supplyTake`, not the player's
      // bag), routed to CampfireBehavior.refuel on the lit hearth. False (no-op) when no fire is lit.
      refuelFire: (amount) => {
        const h = this.litHearth();
        return h ? this.campfire.refuel(h.id, amount) : false;
      },
    });

    // Player combat (extracted) — constructed after the player + EnemyManager exist; the FX/enemy seams
    // route through the scene (no manager↔manager edge). `rng` is a live closure (picks up a pinned
    // setRng). wireBus() points combat:attack/combat:bow here; damagePlayer is the bite/starve sink.
    this.combatController = new CombatController(this, {
      playerChar: () => this.playerChar,
      rng: () => this.rng(),
      enemies: () => this.enemyManager.all(),
      enemiesInTiles: (tiles) => this.enemyManager.enemiesInTiles(tiles),
      killEnemy: (target) => this.enemyManager.killEnemy(target),
      playAttackSwing: () => this.fx.playAttackSwing(),
      flashHit: (sprite) => this.fx.flashHit(sprite),
      fireArrow: (fromX, fromY, toX, toY) => this.fx.fireArrow(fromX, fromY, toX, toY),
      syncBowTargetHighlight: (sprite) => this.fx.syncBowTargetHighlight(sprite),
      cleanupActorFx: (sprite) => this.fx.cleanupActorFx(sprite),
      cancelAll: () => this.cancelAll(),
    });

    // Build placement (plan 013 Step 6) — constructed fresh each (re)start; its constructor wires a
    // physics collider against the player sprite just constructed above, and its own SHUTDOWN
    // teardown. See BuildManagerDeps for why each closure below is narrowed the way it is.
    this.buildManager = new BuildManager(this, {
      getPlayerSprite: () => this.player,
      playerTile: () => this.playerChar.tile(),
      isBlocked: (col, row) => this.isBlocked(col, row),
      hasBlockingTree: (col, row) => this.resourceNodeManager.hasBlockingNode(col, row),
      dims: () => this.gridDims,
      // Base-claim (plan 039): the fire-heart's lit bright core replaces the fixed rect. Closures over
      // CampfireBehavior — resolved at call time (tilePlaceable), so `this.campfire` is live even though
      // structureManager is constructed just below this BuildManager. Tile centre → world-px matches the
      // space lightSources() casts in (tileToWorldCenter, no origin offset).
      hasLitClaim: () => this.campfire.hasLitHearth(),
      inClaim: (col, row) => this.campfire.inClaim(tileToWorldCenter(col), tileToWorldCenter(row)),
      canAfford: (cost) => this.inv.canAfford(cost),
      spend: (cost) => this.inv.spend(cost),
      enqueueBuild: (siteId) => this.enqueue({ kind: 'build', siteId }),
      // Dispatch a completed live buildable to its runtime behavior module (finishSite only calls this
      // for buildables with a `behavior`) — StructureManager routes on `def.behavior` internally.
      materialiseBuildable: (site) => this.structureManager.materialise(site),
      repath: () => this.repath(),
    });

    // Live/simulated buildables (plan 037) — the StructureManager registry, constructed here so it
    // exists before VisionController below (whose constructor calls update() → lightSources()) and
    // before any finishSite routes a `behavior` buildable to materialise(). One register() line per
    // buildable, each module built with its OWN narrow deps (013/015 coupling rule). StructureManager
    // wires ONE SHUTDOWN teardown that fans out to every module.
    this.structureManager = new StructureManager(this);
    // Campfire (plan 012) — the per-frame buildable: drains fuel each tick, casts the light source.
    this.structureManager.register(
      'campfire',
      new CampfireBehavior(this, {
        spend: (cost) => this.inv.spend(cost),
      }),
    );
    // Barricade walls (plan 037) — a destroyed wall frees its tile back through BuildManager (the sole
    // occupancy/collision writer) then repaths.
    this.structureManager.register(
      'wall',
      new WallBehavior(this, {
        freeTile: (c, r) => this.buildManager.releaseTile(c, r),
        repath: () => this.repath(),
        // Deconstruct refund (plan 037 2b) — credit each refunded resource back the same way costs are
        // spent (through the shared Inventory), mirroring CampfireBehaviorDeps.spend's decoupling.
        addItems: (items) => {
          for (const [id, n] of Object.entries(items)) this.inv.add(id, n);
        },
      }),
    );
    // Spike traps (plan 040) — an armed trap fires on the enemy STANDING on its tile (exact feet-tile
    // match, decision #3 — NOT enemyAt's hurtbox test), routed through EnemyManager's environmental-
    // damage seam (the normal hit-flash/kill path). Scene-mediated, so TrapBehavior never edges to
    // EnemyManager/MonsterCharacter directly (013/015 coupling rule).
    this.structureManager.register(
      'trap',
      new TrapBehavior(this, {
        hurtEnemyOnTile: (col, row, amount) => {
          const z = this.enemyManager.all().find((e) => e.alive && e.col === col && e.row === row);
          if (!z) return false;
          this.enemyManager.hurtEnemy(z, amount);
          return true;
        },
      }),
    );
    // Workbench crafting station (plan 048) — the 4th behavior: an HP structure like the wall (mobs bash
    // it, the player repairs it, it crafts slower while damaged) but with a static object sprite. A
    // destroyed bench frees its tile back through BuildManager (the sole occupancy/collision writer) +
    // repaths, same as the wall.
    this.structureManager.register(
      'workbench',
      new WorkbenchBehavior(this, {
        freeTile: (c, r) => this.buildManager.releaseTile(c, r),
        repath: () => this.repath(),
      }),
    );

    // Pointer "raycast" + tap/inspect intent (plan 015 Step 5) — constructed here, after
    // ResourceNodeManager/EnemyManager/BuildManager all exist, so its deps close over their real
    // `all()`/`allSites()` methods; before PointerInputController (below), whose onTap/onPaint/
    // onInspect deps call into `this.scenePicker`.
    this.scenePicker = new ScenePicker(this, {
      enemies: () => this.enemyManager.all(),
      trees: () => this.resourceNodeManager.all(),
      allSites: () => this.buildManager.allSites(),
      structures: () => this.structureManager.all(),
      structureStats: (s) => this.structureManager.stats(s),
      companion: () => this.companionManager.get(),
    });

    // Queue/glow presentation (plan 013 Step 6) — pure presentation over the queue, so it has no
    // GameObjects to build at construction time; kept beside BuildManager for locality (both are
    // "world state managers" wired at the same point in create()).
    this.taskGlowRenderer = new TaskGlowRenderer(this, {
      queueActions: () => this.queue.all(),
      treeById: (id) => this.resourceNodeManager.treeById(id),
      allSites: () => this.buildManager.allSites(),
      siteById: (id) => this.buildManager.siteById(id),
      structureById: (id) => this.structureManager.byId(id),
      structureBounds: (s) => this.structureManager.highlightBounds(s),
      nodeScale: (def, skin) => this.resourceNodeManager.nodeScale(def, skin),
    });

    // DEV-only world tools (extracted) — the dev-menu scatter/spawn seams + scenario-reset primitive.
    // Stateless; all seams route through the node/enemy/companion managers via the scene. Constructed
    // here alongside the other world managers (its dep closures read their real methods at call time).
    this.devWorldTools = new DevWorldTools(this, {
      cancelAll: () => this.cancelAll(),
      resetNodeFx: () => this.nodeFx.reset(),
      clearNodes: (opts) => this.resourceNodeManager.clearAll(opts),
      clearEnemies: (opts) => this.enemyManager.clearAll(opts),
      addNode: (def, col, row) => this.resourceNodeManager.addNode(def, col, row),
      addEnemy: (id, col, row) => this.enemyManager.addEnemy(id, col, row),
      playerTile: () => this.playerChar.tile(),
      dims: () => this.gridDims,
      isBlocked: (col, row) => this.isBlocked(col, row),
      isOccupied: (col, row) => this.buildManager.isOccupied(col, row),
      hasSiteTile: (col, row) => this.buildManager.hasSiteTile(col, row),
      companion: () => this.companionManager.get(),
      spawnCompanion: (col, row) => this.companionManager.spawn(col, row),
    });

    // Gesture + camera controller (plan 013 Step 5) — constructed fresh each (re)start; wires its own
    // pointer listeners and tears them down on SHUTDOWN itself (see the class doc). Since plan 046 Step
    // 13 the DOM HUD gates its own taps via `pointer-events` (a press on a control never reaches this
    // canvas), so there is no HUD hit-test dep any more. Build placement and mode dispatch are NOT
    // gesture mechanics — they route back through these deps callbacks (see PointerInputDeps).
    this.pointerInput = new PointerInputController(this, {
      getPlayerSprite: () => this.player,
      isBuildMode: () => this.buildManager.buildMode,
      onBuildDown: (pointer) => {
        this.buildManager.updateGhost(pointer);
        this.buildManager.placeOrEnqueueBuild(pointer);
      },
      onBuildMove: (pointer) => this.buildManager.updateGhost(pointer),
      getMode: () => this.mode,
      // The DOM movepad (plan 046 Step 10) sets the `movepadHeld` registry flag through the HUD bridge;
      // read it here (was `this.ui.isMovepadHeld()`, the retired Phaser CombatControls movepad) so world
      // pan/tap stays suppressed while the on-screen pad is being dragged.
      isMovepadHeld: () => this.registry.get('movepadHeld') === true,
      onTap: (pointer) => {
        // Guard-point placement (plan 042 Step 9): while armed by the assignment menu's "Guard here",
        // the tap places the point — UNLESS it landed back on the NPC, which cancels (the menu's other
        // documented escape hatch). Checked first so it fully owns the tap while armed, mirroring the
        // build-placement arm→place→disarm shape (and demolish mode's own first-check below).
        if (this.placingGuardPoint) {
          if (this.scenePicker.companionAt(pointer.worldX, pointer.worldY)) {
            this.cancelPlaceGuardPoint(); // tapped the NPC again — cancel, don't post here
            return;
          }
          this.setNpcGuardPoint(worldToTile(pointer.worldX), worldToTile(pointer.worldY));
          this.setNpcNightPosture('guard'); // posting a point also adopts the guard posture
          this.placingGuardPoint = false;
          return;
        }
        // A tap on the companion opens its assignment menu (day role / night posture) instead of
        // issuing a world order — so tapping the NPC never also moves the player onto its tile. Checked
        // before demolish/actionAt, the same priority a campfire's refuel gets in ScenePicker.actionAt.
        const npc = this.scenePicker.companionAt(pointer.worldX, pointer.worldY);
        if (npc) {
          this.openNpcMenu(npc);
          return;
        }
        // Demolish mode (plan 037 2b): a tap on a finished wall enqueues its deconstruct order; a tap
        // on empty ground / a non-wall does nothing (no move/harvest). Checked before the normal tap
        // dispatch so it fully owns the tap while the mode is on.
        if (this.demolishMode) {
          const wall = this.scenePicker.wallAt(pointer.worldX, pointer.worldY);
          if (wall) this.enqueue({ kind: 'deconstruct', wallId: wall.id });
          return;
        }
        // A tap on a workbench opens its craft menu (plan 048 Step 7) — a HUD side effect, not a world
        // order (crafting is a bench-tapped station interaction, like the NPC's assignment menu). Checked
        // before the generic actionAt dispatch so the bench never falls through to a move onto its tile.
        const bench = this.scenePicker.workbenchAt(pointer.worldX, pointer.worldY);
        if (bench) {
          this.openCraftMenu(bench);
          return;
        }
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
          action.kind === 'rearm' ||
          action.kind === 'clear' ||
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
    this.registry.set('movepadHeld', false); // reset the DOM-movepad gate each (re)start (plan 046 Step 10)
    this.cameras.main.startFollow(this.player, true);
    this.pointerInput.setZoom(this.pointerInput.loadStoredZoom());

    // Fog of war (plan 015 Step 4) — constructed fresh each (re)start, at the same point the old
    // inline fog-of-war block used to run (after the player exists); its own SHUTDOWN teardown drops
    // the `fogShape` reference (never destroys it — see VisionController's class doc).
    this.visionController = new VisionController(this, {
      getPlayerSprite: () => this.player,
      getVision: () => this.playerChar.stats.vision,
      lightSources: () => this.structureManager.lightSources(),
      worldPx, // fog dim-rect spans the loaded map (plan 018 A9) instead of fixed MAP_WIDTH/HEIGHT
    });

    // Day/night clock + hunger/starvation (plan 015 Step 3) — constructed fresh each (re)start, at
    // the same point the old inline night-overlay block used to run; its own SHUTDOWN teardown drops
    // the overlay reference (never destroys it — see SurvivalClock's class doc). `damagePlayer`/
    // `canAfford`/`spend` are the only scene-owned edges it needs (the starve loop + `eat`).
    this.survivalClock = new SurvivalClock(this, {
      damagePlayer: (amount) => this.combatController.damagePlayer(amount),
      canAfford: (cost) => this.inv.canAfford(cost),
      spend: (cost) => this.inv.spend(cost),
      // RENDER light sources for the night light-layer (plan 039): the lit hearths (unioned by
      // StructureManager) PLUS the player's tiny personal light, so full-dark night leaves a small
      // readable disc around the player. This is the RENDER seam only — the base CLAIM keys off
      // CampfireBehavior.inClaim (fires-only), so the player light never grants placement (decision #7).
      // VisionController keeps its own fires-only closure + separate vision radius (unchanged).
      lightSources: () => [...this.structureManager.lightSources(), this.playerLight()],
      worldPx, // night overlay spans the loaded map (plan 018 A9) instead of fixed MAP_WIDTH/HEIGHT
    });

    // Night wave (plan 038 Step 3) — constructed after SurvivalClock so its `phase()` reconcile reads a
    // live clock. Side-effect-free; the time:changed subscription is wired in wireBus(). `defendCentre`
    // is the nearest lit hearth (the thing the wave converges on) or the player when no fire is lit.
    this.waveDirector = new WaveDirector(this, {
      spawnEnemy: (id, col, row, opts) => this.enemyManager.addEnemy(id, col, row, opts),
      dims: () => this.gridDims,
      isBlocked: (col, row) => this.isBlocked(col, row),
      defendCentre: () => this.litHearth()?.tile ?? this.playerChar.tile(),
      rng: () => this.rng(),
      dayContext: () => ({
        phase: this.survivalClock.dayPhase,
        dayCount: this.survivalClock.dayCount,
      }),
    });

    // The DOM/React HUD overlay (plan 046) is page-level and persists across a death-restart (only
    // 'Game' restarts), so on every (re)start re-emit the current state onto the bus — the HUD bridge
    // re-syncs its store from these rather than being torn down (see src/hud/bridge.ts "Lifecycle").
    // mode:changed resyncs the mode-toggle/movepad morph in case death happened mid-Combat/Inspect.
    this.game.events.emit('mode:changed', this.mode);
    // Auto-surface visibility: a stale `true` from the prior run would otherwise leave the fighting HUD
    // showing; update() re-emits on the first frame if it flips true again.
    this.game.events.emit('combat:activeChanged', this.combatActive);
    // Demolish mode: re-emit the reset value (false) so the DEMOLISH button/hint don't linger toggled
    // from the prior run (plan 037 2b).
    this.game.events.emit('demolish:modeChanged', this.demolishMode);
    // Seed the base-supply readout with this (re)start's pool (fresh = 0/0) so it reflects this run
    // (plan 042 Step 3).
    this.game.events.emit('supply:changed', this.baseSupply.snapshot());
  }

  /** Wire every `game.events` scene↔HUD listener + its matching SHUTDOWN teardown (the same 12
   *  listeners create() always registered — build/zoom/camera route to the managers that now own
   *  those methods), then push the first queue-highlight refresh. */
  private wireBus(): void {
    const bus = this.game.events;
    // Table-driven bus wiring (plan 043 Step 14): one [event, handler, context] list drives BOTH the
    // `on` here and the matching `off` at SHUTDOWN, so a subscription can never be registered without
    // its teardown — the old parallel on/off blocks (~40 lines each) could, and were the exact kind of
    // 28-on/28-off mirror flagged in the smells lens. `never[]`-param typing lets any handler signature
    // sit in one homogeneous list without `any` (a fn is assignable to `(...args: never[]) => void`).
    const subs: ReadonlyArray<readonly [string, (...args: never[]) => void, object]> = [
      ['build:toggle', this.buildManager.toggleBuild, this.buildManager],
      ['build:rotate', this.buildManager.rotatePlacement, this.buildManager],
      ['build:select', this.onBuildSelect, this],
      ['build:modeChanged', this.onBuildModeChanged, this], // turn demolish off when build turns on (plan 037 2b)
      ['demolish:toggle', this.onDemolishToggle, this],
      ['tasks:cancel', this.cancelAll, this],
      ['debug:randomise', this.devWorldTools.randomiseWorld, this.devWorldTools], // dev menu: scatter nodes + enemies
      ['debug:spawnEnemy', this.devWorldTools.spawnEnemyNearPlayer, this.devWorldTools], // dev menu: drop one enemy by the player to fight
      ['debug:spawnNpc', this.devWorldTools.spawnNpcNearPlayer, this.devWorldTools], // dev menu: drop the companion Rogue by the player (plan 042)
      ['debug:toggleTime', this.survivalClock.toggleDayNight, this.survivalClock], // dev menu: flip day/night
      ['debug:forceWave', this.onForceWave, this], // dev menu: jump to night + start a wave now
      ['time:changed', this.waveDirector.onTimeChanged, this.waveDirector], // start/stop the night wave on dusk/dawn
      ['time:changed', this.rearmTrapsAtDawn, this], // dawn → auto-enqueue rearm for spent traps (plan 040)
      ['time:changed', this.companionManager.onPhaseChanged, this.companionManager], // night→adopt posture / day→resume role + revive (plan 042 Step 8)
      ['zoom:delta', this.pointerInput.adjustZoom, this.pointerInput],
      ['camera:center', this.pointerInput.centerOnPlayer, this.pointerInput],
      ['combat:attack', this.combatController.attack, this.combatController],
      ['combat:bow', this.combatController.bow, this.combatController],
      ['mode:combatToggle', this.onCombatToggle, this],
      ['mode:inspectToggle', this.onInspectToggle, this],
      ['needs:eat', this.survivalClock.onNeedsEat, this.survivalClock],
      ['combat:move', this.onCombatMove, this],
      ['combat:moveEnd', this.onCombatMoveEnd, this],
      // Companion assignment menu (plan 042 Step 9) — the DOM HUD's companion menu routes back here through
      // the same shared setters the `__test` seams call; "Guard here" arms the place-point mode.
      ['npc:assignDayRole', this.setNpcDayRole, this],
      ['npc:assignNightPosture', this.setNpcNightPosture, this],
      ['npc:beginPlaceGuard', this.beginPlaceGuardPoint, this],
      ['npc:cancelPlaceGuard', this.cancelPlaceGuardPoint, this], // Escape while armed
      // Workbench craft menu (plan 048 Step 7) — the DOM craft menu routes a recipe pick back here to
      // enqueue the real `craft` order, and a Repair pick (shown when the bench is damaged) to the
      // player `repair` order — the same worker orders a `__test.enqueue` drives.
      ['craft:queue', this.onCraftQueue, this],
      ['craft:repair', this.onCraftRepair, this],
    ];
    for (const [event, handler, ctx] of subs) bus.on(event, handler, ctx);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const [event, handler, ctx] of subs) bus.off(event, handler, ctx);
      // Hide the page-level HUD while no Game scene is live (a death-restart re-shows it in create()).
      this.registry.set('sceneActive', false);
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
      structureManager: this.structureManager,
      companionManager: this.companionManager,
      waveDirector: this.waveDirector,
      taskGlowRenderer: this.taskGlowRenderer,
      fx: this.fx,
      pointerInput: this.pointerInput,
      playerChar: this.playerChar,
      queue: this.queue,
      inv: this.inv,
      gridDims: this.gridDims,
      getPlayerSprite: () => this.player,
      trees: () => this.resourceNodeManager.all(),
      enemies: () => this.enemyManager.all(),
      treeById: (id) => this.resourceNodeManager.treeById(id),
      addNode: (def, col, row) => this.resourceNodeManager.addNode(def, col, row),
      addEnemy: (id, col, row, opts) => this.enemyManager.addEnemy(id, col, row, opts),
      resetTreesAndEnemies: () => this.devWorldTools.resetTreesAndEnemies(),
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
      getCombatActive: () => this.combatActive,
      getBowTargetId: () => this.combatController.bowTargetId,
      clearBowTarget: () => this.combatController.clearBowTarget(),
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
      // Base-supply pool (plan 042 Step 3) — read/seed the dedicated store. `snapshot()` hands out a
      // copy; `set()` overwrites both counts (and emits 'change' → the HUD updates via `supply:changed`).
      getBaseSupply: () => this.baseSupply.snapshot(),
      setBaseSupply: (v) => this.baseSupply.set(v),
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
      damageFire: (i, amount) => testApi.damageFire(i, amount),
      walls: () => testApi.walls(),
      damageWall: (i, amount) => testApi.damageWall(i, amount),
      workbenches: () => testApi.workbenches(),
      damageWorkbench: (i, amount) => testApi.damageWorkbench(i, amount),
      itemCount: (id) => this.inv.get(id),
      enemyHps: () => testApi.enemyHps(),
      nodes: () => testApi.nodes(),
      setNodeProgress: (id, ms) => testApi.setNodeProgress(id, ms),
      // Enqueue the real deconstruct worker order for the wall at `index` (the order the demolish-mode
      // tap enqueues) — drives the full walk-adjacent → remove + refund path under step() (plan 037 2b).
      deconstructWall: (i) => {
        const w = this.wall.all()[i];
        if (!w) return false;
        this.enqueue({ kind: 'deconstruct', wallId: w.id });
        return true;
      },
      // Enqueue the real rearm worker order for the trap at `index` (the order a tap on a spent trap
      // enqueues) — drives the full walk-adjacent → re-prime path under step() (plan 040).
      rearmTrap: (i) => {
        const t = this.trap.all()[i];
        if (!t) return false;
        this.enqueue({ kind: 'rearm', trapId: t.id });
        return true;
      },
      beginWave: () => testApi.beginWave(),
      zoneAt: (c, r) => this.zoneAt(c, r),
      moveEnemy: (i, c, r) => testApi.moveEnemy(i, c, r),
      setPlayerMelee: (id) => testApi.setPlayerMelee(id),
      // Companion assignment setters (plan 042 Step 2) — route to the SHARED scene methods the
      // assignment menu also calls (plan 042 Step 9), so the harness and the in-game menu drive exactly
      // one code path. No-op if no companion is spawned; each writes a live-polled field.
      setNpcDayRole: (role) => this.setNpcDayRole(role),
      setNpcNightPosture: (posture) => this.setNpcNightPosture(posture),
      setNpcGuardPoint: (c, r) => this.setNpcGuardPoint(c, r),
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

    // Live structures tick every frame too (above the early-return), so a campfire burns down whether
    // or not a worker task is active — mirrors the survival tick. See src/scenes/world/StructureManager.ts.
    this.structureManager.tick(delta);

    // AI companion (plan 042) — drive it each frame (advance path + anim today; the gather/guard tick
    // lands later). Above the no-action early-return so it ticks whether or not a worker task is active.
    this.companionManager.update(delta);

    // Night wave scheduler (plan 038 Step 3) — meter out spawns during the night. Above the no-action
    // early-return (so it runs whether or not a task is active) but below the `playerChar.dying` freeze
    // above, so no skeletons spawn during the death beat. See src/scenes/world/WaveDirector.ts.
    this.waveDirector.tick(delta);

    // Recompute the auto-surface predicate (enemy-near / night) before any movement gating below —
    // it decides whether the movepad is authoritative this frame (see movepadDrives).
    this.updateCombatActive();

    // Reconcile the bow's auto-target + keep its highlight glued to the target (plan 035a Step 5).
    // Above the movement early-return below so the highlight tracks even on the idle/movepad-drive
    // path (a kiting player shooting while backing away).
    this.combatController.syncBowTarget();

    // Draw the attention-scoped monster HP bars (plan 035a Step 6) — the bow target's bar persists,
    // any recently-hit enemy flashes a brief one, capped + near-death sprite tell. Also above the
    // early-return so bars track on the idle/movepad path.
    this.fx.syncEnemyHealthBars(
      this.enemyManager.all(),
      this.combatController.bowTargetId,
      this.playerChar.tile(),
    );

    const action = this.queue.current;
    // Movepad precedence (plan 035a Step 3): while combat controls are surfaced (manual Combat mode OR
    // the combatActive auto-surface) AND the pad is actually held, the movepad drives velocity
    // directly — overriding an in-progress task for this frame WITHOUT clearing the queue, so a pending
    // order survives the reveal and resumes the moment the pad is released. With no active task the
    // same drive runs (the idle case, unchanged). This is the chosen precedence: movepad drives; taps
    // still queue orders (see PointerInputController, whose command-mode tap/pan path stays live).
    const padHeld = this.combatMoveVec.dx !== 0 || this.combatMoveVec.dy !== 0;
    if (!action || (this.movepadDrives() && padHeld)) {
      // The pad only emits on press/drag, so re-apply velocity from the held vector every frame,
      // scaled by effectiveMoveSpeed — that per-frame re-eval is what lets the attack/bow move-slow
      // engage and release mid-hold without the player needing to nudge the pad again.
      if (this.movepadDrives()) {
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
    // Dispatch the per-frame work by kind through the runner table (below) — the registry-driven
    // replacement for the old switch. A kind with no runner (e.g. companion-only `repair`) is a no-op.
    (this.orderRunners[action.kind] as ((a: Action, delta: number) => void) | undefined)?.(
      action,
      delta,
    );
    // Stuck guard (belt-and-braces behind the pathfinder's corner rule): if the worker stopped
    // closing on its waypoint — e.g. deflected by the wall collider backstop — repath to the same
    // goal. The corner-safe pathfinder then routes clear; if the goal got walled off, repath drops
    // the order rather than shove forever. No-op while idle/working in place (isStuck stays false).
    if (this.playerChar.isStuck()) this.repath();
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

  /**
   * The authored zone id at GLOBAL tile `(col,row)`, or `0` for no zone (plan 014 step 11 —
   * proving the zones runtime read path). Converts to map-local by subtracting the map origin, same
   * as {@link isBlocked} does for `mapBlocks`. Nothing consumes it in gameplay yet; quests/spawn
   * rules will. */
  zoneAt(col: number, row: number): number {
    return zoneAt(this.startMap, col - this.mapOrigin.col, row - this.mapOrigin.row);
  }

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

  /** Begin executing whatever is `current` — compute its path / stand tile, or skip if impossible.
   *  Shared prelude (reset path/goal + breadcrumb) then dispatch the per-kind stand-tile resolution
   *  through {@link orderBeginners} (the registry-driven replacement for the old if-chain). */
  private beginCurrent(): void {
    // Blanket teardown of the timed-action feedback (plan 047, critique #1): a toggle-cancel (re-tapping
    // a queued salvage/clear), a walk-away, or switching to another order ALL route through here — NOT
    // completeCurrent — so this is the one guaranteed chokepoint to stop the looping shake + hide the
    // progress bar. Without it a cancel would leak an infinite `repeat:-1` tween poking the node
    // transform forever + a floating bar. Safe (no-op) when nothing is animating; runs before the
    // `!a` idle return so going idle cleans up too. The active runner re-arms its own shake/bar next frame.
    this.nodeFx.stopAllShakes();
    this.nodeFx.hideAllActionProgress();
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
    (this.orderBeginners[a.kind] as ((a: Action) => void) | undefined)?.(a);
  }

  /**
   * Per-frame executors keyed by order kind — the dispatch table `update()` runs (plan 043 Step 14,
   * the registry pattern mirroring StructureManager). A kind with no runner (companion-only `repair`)
   * is a no-op. Arrow closures so `this` binds to the scene; a new order kind's per-frame work is one
   * entry here + its {@link orderBeginners} block, not a new `switch` case.
   */
  private readonly orderRunners: {
    [K in Action['kind']]?: (a: Extract<Action, { kind: K }>, delta: number) => void;
  } = {
    move: () => {
      if (this.playerChar.advancePath()) this.completeCurrent();
    },
    harvest: (a, delta) => this.runHarvest(a, delta),
    build: (a, delta) => this.runBuild(a, delta),
    refuel: (a, delta) => this.runRefuel(a, delta),
    deconstruct: (a) => this.runDeconstruct(a),
    rearm: (a) => this.runRearm(a),
    repair: (a, delta) => this.runRepair(a, delta),
    craft: (a, delta) => this.runCraft(a, delta),
    clear: (a, delta) => this.runClear(a, delta),
  };

  /**
   * Stand-tile resolution keyed by order kind — the dispatch table {@link beginCurrent} runs. Each
   * resolves the walk-to tile (or aborts via {@link completeCurrent}) for its kind. On the PLAYER queue
   * `repair` targets a workbench (plan 048 Step 4); the companion's wall repair runs on its OWN queue
   * (CompanionManager, plan 042 Step 5), never here.
   */
  private readonly orderBeginners: {
    [K in Action['kind']]?: (a: Extract<Action, { kind: K }>) => void;
  } = {
    move: (a) => {
      if (!this.pathTo({ col: a.col, row: a.row })) this.completeCurrent();
    },
    repair: (a) => this.beginRepair(a),
    craft: (a) => this.beginCraft(a),
    harvest: (a) => this.beginHarvest(a),
    refuel: (a) => this.beginRefuel(a),
    deconstruct: (a) => this.beginDeconstruct(a),
    rearm: (a) => this.beginRearm(a),
    build: (a) => this.beginBuild(a),
    clear: (a) => this.beginClear(a),
  };

  private beginHarvest(a: Extract<Action, { kind: 'harvest' }>): void {
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
  }

  private beginRefuel(a: Extract<Action, { kind: 'refuel' }>): void {
    const c = this.campfire.campfireById(a.campfireId);
    if (!c) return this.completeCurrent();
    // Nothing to do → flash a refusal and drop the order rather than walk over for a no-op: the bag's
    // empty, or the fire's already topped up (a full wood wouldn't fit — the no-waste rule runRefuel
    // also completes on). Mirrors harvest's "can't-start → flashBagFull + complete" abort.
    if (
      !this.inv.canAfford({ wood: 1 }) ||
      CAMPFIRE_FUEL_MAX - c.state.fuel < CAMPFIRE_FUEL_PER_WOOD
    ) {
      this.campfire.flashNoFuel(c);
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
  }

  private beginDeconstruct(a: Extract<Action, { kind: 'deconstruct' }>): void {
    const w = this.wall.wallById(a.wallId);
    if (!w) return this.completeCurrent(); // wall already gone (e.g. a mob destroyed it) — drop the order
    // Stand on any tile adjacent to the wall's foot tile (it blocks its own tile, like the fire).
    const stand = reachableAdjacent(
      this.playerChar.tile(),
      { col: w.col, row: w.row },
      this.isBlocked,
      this.gridDims,
    );
    if (!stand || !this.pathTo(stand)) this.completeCurrent();
  }

  private beginRearm(a: Extract<Action, { kind: 'rearm' }>): void {
    const t = this.trap.trapById(a.trapId);
    if (!t) return this.completeCurrent(); // trap gone (e.g. a scenario reset) — drop the order
    if (t.state.armed) return this.completeCurrent(); // already re-armed (fired-and-reset race) — nothing to do
    // Stand ADJACENT to the trap (a trap tile is walkable, but standing off it avoids re-tripping a
    // just-re-armed trap on the worker's own feet — the trigger only queries enemies, but adjacency
    // reads as "reach over and reset it", mirroring the fire/wall tend-from-adjacent orders).
    const stand = reachableAdjacent(
      this.playerChar.tile(),
      { col: t.col, row: t.row },
      this.isBlocked,
      this.gridDims,
    );
    if (!stand || !this.pathTo(stand)) this.completeCurrent();
  }

  private beginRepair(a: Extract<Action, { kind: 'repair' }>): void {
    const b = this.workbench.benchById(a.structureId);
    // Player repair targets a workbench (plan 048). Gone, or already at full hp → nothing to mend; drop
    // the order. (A wall id on the player queue also resolves to no bench here → dropped — walls are
    // the companion's job, plan 042.)
    if (!b || b.state.hp >= b.state.maxHp) return this.completeCurrent();
    // Stand on any tile adjacent to the bench's foot tile (it blocks its own tile, like the fire/wall).
    const stand = reachableAdjacent(
      this.playerChar.tile(),
      { col: b.col, row: b.row },
      this.isBlocked,
      this.gridDims,
    );
    if (!stand || !this.pathTo(stand)) this.completeCurrent();
  }

  private beginCraft(a: Extract<Action, { kind: 'craft' }>): void {
    const b = this.workbench.benchById(a.benchId);
    const recipe = RECIPES[a.recipeId];
    if (!b || !recipe) return this.completeCurrent(); // bench gone / unknown recipe — drop the order
    // Start (or resume) the craft record on the bench. A different recipe mid-craft on this bench
    // shouldn't happen (crafts are sequential), but defensively restart fresh for THIS recipe — the
    // progress lives on the bench so a walk-away + re-queue of the same recipe picks up where it left off.
    if (!b.state.craft || b.state.craft.recipeId !== a.recipeId)
      b.state.craft = { recipeId: a.recipeId, progress: 0 };
    // Stand on any tile adjacent to the bench's foot tile (it blocks its own tile, like the fire/wall).
    const stand = reachableAdjacent(
      this.playerChar.tile(),
      { col: b.col, row: b.row },
      this.isBlocked,
      this.gridDims,
    );
    if (!stand || !this.pathTo(stand)) this.completeCurrent();
  }

  private beginClear(a: Extract<Action, { kind: 'clear' }>): void {
    const tree = this.resourceNodeManager.treeById(a.treeId);
    // Clearable only if it's still a present, depleted `oneShot` ruin (the salvage husk). Gone /
    // somehow alive / not a one-shot node → drop the order.
    if (!tree || tree.alive || !tree.def.oneShot) return this.completeCurrent();
    const target = { col: tree.col, row: tree.row };
    // Prefer the node's own stand tiles (the tall tent is base-anchored, like harvesting it); fall
    // back to any adjacent tile if those are walled off. The ruin blocks its own tile (hasBlockingNode),
    // so the worker always stands adjacent — never on it.
    const stand =
      reachableAdjacent(
        this.playerChar.tile(),
        target,
        this.isBlocked,
        this.gridDims,
        tree.def.standOffsets,
      ) ?? reachableAdjacent(this.playerChar.tile(), target, this.isBlocked, this.gridDims);
    if (!stand || !this.pathTo(stand)) this.completeCurrent();
  }

  private beginBuild(a: Extract<Action, { kind: 'build' }>): void {
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

  /**
   * Append an order; if the worker was idle, start it. Tapping a target that already has an order of
   * the same kind toggles it back off instead of duplicating it (the toggle/queue behaviour, now
   * generic over `orderTargetId` — see systems/orders.ts). Only the kinds flagged `dedupeOnEnqueue`
   * toggle (harvest/refuel/deconstruct/rearm/clear); `build`/`move` always append. Toggling off re-queues at
   * the END on a later tap (a fresh append); if the live order is cancelled, {@link beginCurrent}
   * advances to the next (or goes idle) so the worker stops working a target you un-queued. The rearm
   * de-dupe also stops the dawn auto-enqueue from queuing a trap twice (plan 040).
   */
  private enqueue(a: Action): void {
    if (ORDER_META[a.kind].dedupeOnEnqueue && isOrderQueued(this.queue, a)) {
      if (toggleOrder(this.queue, a)) this.beginCurrent();
      this.emitTasks();
      return;
    }
    const wasIdle = this.queue.current === null;
    this.queue.append(a);
    if (wasIdle) this.beginCurrent();
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
      // (gather/Collect), a rock is mined (pickaxe), everything else is chopped (axe). The swing is
      // now authored directly per def (`harvestAnim`), defaulting to chop; `salvage` (tent wreck) reuses
      // the gather motion via `harvestAnimMotion`. See ResourceNodeDef.harvestAnim.
      this.harvestSwing = harvestAnimMotion(tree.def.harvestAnim);
      // Timed SALVAGE (plan 047): a `oneShot` loot node (the tent wreck) is ONE long timed action, not
      // a per-hit chop. Accumulate real-time on the NODE — so cancelling (re-tap / walk away) keeps the
      // progress and re-queuing resumes — and fell it exactly ONCE at SALVAGE_MS. Loot semantics are
      // unchanged from the old single-hit salvage: `chop` rolls the whole `loot` table and `inv.add`
      // clamps, so a near-full bag drops the overflow exactly as before (critique #4 — accepted, not
      // re-gated). The hit-cadence path below is untouched for trees/rocks/bushes.
      if (tree.def.oneShot && tree.def.loot) {
        tree.progressMs += delta;
        // Continuous shake + a progress bar filling over the 20s (plan 047). startShake is idempotent
        // (captures rest once); the bar reflects persisted progress on resume for free (progressMs/SALVAGE_MS).
        this.nodeFx.startShake(tree.sprite);
        this.nodeFx.showActionProgress(tree.sprite, tree.progressMs / SALVAGE_MS);
        if (tree.progressMs >= SALVAGE_MS) {
          // Stop the shake + hide the bar BEFORE the fell — chop() starts its own recoil tween on this
          // same sprite, which must not fight a still-running shake (the beginCurrent blanket is only a
          // backstop). stopShake snaps the node back to rest first.
          this.nodeFx.stopShake(tree.sprite);
          this.nodeFx.hideActionProgress(tree.sprite);
          // faceTile above set lastFacing FROM the player TO the node, so the fell lean is +lastFacing.
          this.resourceNodeManager.chop(tree, this.playerChar.lastFacing); // rolls loot + depletes; no regrow (oneShot)
          tree.progressMs = 0; // reset the accumulator for the later CLEAR stage
          this.completeCurrent();
        }
        return;
      }
      this.chopElapsed += delta;
      if (this.chopElapsed >= CHOP_INTERVAL_MS) {
        this.chopElapsed = 0;
        // faceTile above set lastFacing to point FROM the player TO the node, so the fx recoil/topple
        // lean away-from-chopper == +lastFacing (see NodeFxManager).
        this.resourceNodeManager.chop(tree, this.playerChar.lastFacing);
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
    const c = this.campfire.campfireById(a.campfireId);
    if (!c) return this.completeCurrent();
    if (CAMPFIRE_FUEL_MAX - c.state.fuel < CAMPFIRE_FUEL_PER_WOOD) return this.completeCurrent(); // topped up
    if (this.playerChar.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.playerChar.faceTile(c.col, c.row); // tend toward the fire, whatever side we stood on
      this.harvestSwing = 'gather'; // the forage/tend loop reads as feeding the fire
      this.chopElapsed += delta;
      if (this.chopElapsed >= CAMPFIRE_FEED_INTERVAL_MS) {
        this.chopElapsed = 0;
        if (!this.campfire.feedOne(c)) {
          this.campfire.flashNoFuel(c); // bag ran dry mid-order — abort, don't idle-swing
          this.completeCurrent();
        }
      }
    }
  }

  /**
   * Deconstruct a wall (plan 037 chunk 2b, decision #6): walk to the stand tile (set in beginCurrent),
   * then on arrival remove the wall — crediting its partial refund — and END the order. Like
   * {@link runRefuel} it's a walk-adjacent-then-act order that self-terminates on a *condition* (the
   * wall is gone), not the target's death; but it's a single act (one wall, removed once), so there's
   * no per-interval feed loop. If the wall vanished before the worker arrived (e.g. a mob destroyed it
   * mid-walk), drop the order rather than stall — WallBehavior.deconstruct also no-ops on a gone wall.
   */
  private runDeconstruct(a: Extract<Action, { kind: 'deconstruct' }>): void {
    const w = this.wall.wallById(a.wallId);
    if (!w) return this.completeCurrent();
    if (this.playerChar.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.playerChar.faceTile(w.col, w.row); // face the wall as it comes down
      this.wall.deconstruct(a.wallId); // remove + credit the partial refund
      this.completeCurrent(); // condition-terminate: the wall is gone
    }
  }

  /**
   * Re-arm a spent spike trap (plan 040, decision #6): walk to the stand tile (set in beginCurrent),
   * then on arrival re-prime the trap and END the order. Like {@link runDeconstruct} it's a
   * walk-adjacent-then-act order that self-terminates on a *condition* (the trap is armed / gone), a
   * single act with no per-interval loop, and consumes NO resource for MVP (worker-time only). If the
   * trap vanished mid-walk, drop the order rather than stall — TrapBehavior.rearm also no-ops on a gone
   * (or already-armed) trap. Drives both the tap-to-rearm and the dawn auto-enqueue.
   */
  private runRearm(a: Extract<Action, { kind: 'rearm' }>): void {
    const t = this.trap.trapById(a.trapId);
    if (!t || t.state.armed) return this.completeCurrent(); // gone or already re-armed — condition-terminate
    if (this.playerChar.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.playerChar.faceTile(t.col, t.row); // face the trap as it's reset
      this.trap.rearm(a.trapId); // re-prime it (worker-time only, no resource — decision #6)
      this.completeCurrent();
    }
  }

  /**
   * Clear a salvaged wreck's ruined husk (plan 047): walk to the stand tile (set in beginCurrent),
   * then dismantle it over CLEAR_MS — an even longer timed action than the salvage that preceded it.
   * A timed progress-accumulator like {@link runBuild}/the salvage branch of {@link runHarvest} (the
   * `progressMs` lives on the node, so cancel/re-queue resumes), completing like {@link runDeconstruct}
   * on a *condition*: at CLEAR_MS roll the optional `clearLoot` scrap into the bag, remove the node
   * (frees its tile + repaths), and END the order. If the ruin vanished before arrival (scenario reset),
   * drop the order rather than stall — mirrors runDeconstruct's gone-target guard.
   */
  /**
   * Repair a damaged workbench (plan 048 Step 4): walk to the stand tile (set in beginRepair), then tend
   * it on a cadence — restoring {@link WORKBENCH_REPAIR_PER_TICK} hp every
   * {@link WORKBENCH_REPAIR_INTERVAL_MS} until full, then END the order (like {@link runRefuel}, a
   * walk-adjacent-then-tend loop that self-terminates on a *condition* — here, hp back at max). Worker-
   * time only, no resource cost this pass (mirrors the trap re-arm). If the bench vanished before/along
   * the way (a mob destroyed it mid-walk), drop the order rather than stall — WorkbenchBehavior.repair
   * also no-ops on a gone bench.
   */
  private runRepair(a: Extract<Action, { kind: 'repair' }>, delta: number): void {
    const b = this.workbench.benchById(a.structureId);
    if (!b) return this.completeCurrent(); // bench gone (e.g. a mob destroyed it) — drop the order
    if (b.state.hp >= b.state.maxHp) return this.completeCurrent(); // already mended
    if (this.playerChar.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.playerChar.faceTile(b.col, b.row); // face the bench while mending it
      this.harvestSwing = 'gather'; // reuse the forage/tend motion as "working on the bench"
      this.chopElapsed += delta;
      if (this.chopElapsed >= WORKBENCH_REPAIR_INTERVAL_MS) {
        this.chopElapsed = 0;
        if (this.workbench.repair(a.structureId, WORKBENCH_REPAIR_PER_TICK)) this.completeCurrent();
      }
    }
  }

  /**
   * Craft a recipe at a workbench (plan 048 Step 6): walk to the stand tile (set in beginCraft), then
   * accumulate craft progress on the bench's `craft` record — the rate SCALED by the bench's current hp
   * (`Linear(CRAFT_DAMAGED_MIN_FRAC, 1, hp/maxHp)`, so a full-hp bench crafts at 1× and a near-dead one
   * at the {@link CRAFT_DAMAGED_MIN_FRAC} floor, never fully stalling). A timed progress-accumulator like
   * {@link runBuild}/{@link runClear} (progress lives on the bench, so a walk-away + re-queue resumes),
   * with an above-bench progress bar (à la the salvage/clear bar). On reaching `recipe.craftMs`: SPEND
   * `recipe.cost` + ADD `recipe.output` to the bag, then END the order. Deliberately checked at
   * COMPLETION (not begin — materials may be gathered mid-craft): if the cost is unaffordable OR the
   * output won't fit the bag at that moment, the craft FIZZLES (no spend, no item, a bench flash) rather
   * than stalling. If the bench vanished mid-craft (a mob destroyed it), drop the order.
   */
  private runCraft(a: Extract<Action, { kind: 'craft' }>, delta: number): void {
    const b = this.workbench.benchById(a.benchId);
    const recipe = RECIPES[a.recipeId];
    if (!b || !recipe) return this.completeCurrent(); // bench destroyed mid-craft / bad recipe — drop
    if (this.playerChar.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.playerChar.faceTile(b.col, b.row); // face the bench while working it
      this.harvestSwing = 'gather'; // the work-the-bench loop reads as the rummage/gather motion
      const craft = (b.state.craft ??= { recipeId: a.recipeId, progress: 0 });
      const rate = Phaser.Math.Linear(CRAFT_DAMAGED_MIN_FRAC, 1, b.state.hp / b.state.maxHp);
      craft.progress += delta * rate;
      this.nodeFx.showActionProgress(b.sprite, Math.min(1, craft.progress / recipe.craftMs));
      if (craft.progress >= recipe.craftMs) {
        this.nodeFx.hideActionProgress(b.sprite);
        b.state.craft = null;
        if (
          this.inv.canAfford(recipe.cost) &&
          this.inv.canAccept(recipe.output.itemId, recipe.output.count)
        ) {
          this.inv.spend(recipe.cost);
          this.inv.add(recipe.output.itemId, recipe.output.count);
        } else {
          this.workbench.flashFizzle(b.id); // unaffordable / bag full at completion — fizzle, no item
        }
        this.completeCurrent();
      }
    }
  }

  private runClear(a: Extract<Action, { kind: 'clear' }>, delta: number): void {
    const tree = this.resourceNodeManager.treeById(a.treeId);
    if (!tree || tree.alive || !tree.def.oneShot) return this.completeCurrent(); // gone / regrew / not a ruin
    if (this.playerChar.advancePath()) {
      this.player.body.setVelocity(0, 0);
      this.playerChar.faceTile(tree.col, tree.row); // face the husk as it comes apart
      this.harvestSwing = 'gather'; // dismantle reads as the rummage/gather motion (reskin stand-in)
      tree.progressMs += delta;
      // Continuous shake + a progress bar filling over the 40s (plan 047); persisted progress resumes it.
      this.nodeFx.startShake(tree.sprite);
      this.nodeFx.showActionProgress(tree.sprite, tree.progressMs / CLEAR_MS);
      if (tree.progressMs >= CLEAR_MS) {
        // Stop the shake + hide the bar before removeNode destroys the sprite (a live tween writing a
        // destroyed sprite is .active-guarded, but stop it cleanly rather than lean on the backstop).
        this.nodeFx.stopShake(tree.sprite);
        this.nodeFx.hideActionProgress(tree.sprite);
        // A little scrap for the effort (cloth/wood) — a one-shot node with no clearLoot clears silently.
        const cleared: string[] = [];
        if (tree.def.clearLoot)
          for (const drop of rollLoot(tree.def.clearLoot)) {
            this.inv.add(drop.itemId, drop.qty);
            cleared.push(drop.itemId);
          }
        // Float the scrap icons above the husk (same "resource acquired" pop as a harvest hit) BEFORE
        // removeNode destroys the node sprite — the float spawns its own independent icon sprites, so
        // they keep rising after the husk is gone.
        if (cleared.length > 0)
          this.nodeFx.playYieldFloat({
            sprite: tree.sprite,
            iconKeys: cleared.map((id) => iconKey(id)),
          });
        this.resourceNodeManager.removeNode(a.treeId); // destroy + free the tile + repath
        this.completeCurrent(); // condition-terminate: the ruin is gone
      }
    }
  }

  /**
   * Dawn hook (plan 040, decision #6): on the night→`'day'` edge, auto-enqueue a `rearm` for every
   * SPENT trap — the game's first SYSTEM-initiated worker order (no player tap). `time:changed` only
   * emits on a phase/day change (SurvivalClock.tick), so `phase==='day'` here IS the dawn edge. Routes
   * through the same {@link enqueue} the player's tap uses, so these compose with any pending player
   * order: enqueue APPENDS (never replaces the active order) and its `dedupeOnEnqueue` de-dupe (rearm
   * is a dedupe kind — see systems/orders.ts) means a trap already queued for rearm (e.g. a player
   * tapped it overnight) isn't double-queued. Subscribed
   * in {@link wireBus} with a SHUTDOWN `off` (mirrors WaveDirector.onTimeChanged).
   */
  private rearmTrapsAtDawn({ phase }: { phase: DayPhase }): void {
    if (phase !== 'day') return;
    for (const t of this.trap.all())
      if (!t.state.armed) this.enqueue({ kind: 'rearm', trapId: t.id });
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

  /** The lit hearth the night wave converges on + strikes (plan 038): the first lit campfire (id + its
   *  tile + world-centre pos), or null when none is lit. Single hearth in the MVP; shared by the
   *  WaveDirector's spawn-anchor and the enemy AI's fire objective. */
  /** The player's tiny personal RENDER light (plan 039 Step 3) — a small disc at the player's current
   *  world position, fed into SurvivalClock's night light-layer erase list so the player is never fully
   *  blind at full-dark night. RENDER only: it is NOT in the base-claim path (fires-only, decision #7). */
  private playerLight(): { x: number; y: number; radius: number } {
    // Emit from the sprite's visual CENTRE, not its feet. `this.player.y` sits at the sprite origin
    // (originY ~0.78 ≈ the feet row), so a disc centred there pools the small glow at the feet and
    // leaves the body in the dark. Shift up from the origin to the frame's vertical centre (0.5) so the
    // glow lights the character. x is unaffected (originX 0.5 is already centred).
    const s = this.player;
    const centerY = s.y - (s.originY - 0.5) * s.displayHeight;
    return { x: s.x, y: centerY, radius: PLAYER_LIGHT_RADIUS };
  }

  private litHearth(): { id: string; tile: Cell; pos: { x: number; y: number } } | null {
    const c = this.campfire.all().find((f) => f.state.lit);
    if (!c) return null;
    return {
      id: c.id,
      tile: { col: c.col, row: c.row },
      pos: { x: tileToWorldCenter(c.col), y: tileToWorldCenter(c.row) },
    };
  }

  /** DEV force-wave hook (plan 038 Step 6): jump to night if it's day, then kick off a wave now — the
   *  manual-playtest counterpart to the scenario API's `beginWave`. `toggleDayNight` emits
   *  `time:changed(night)` which already begins a wave via the WaveDirector; the explicit `beginWave`
   *  covers the already-night case (and is idempotent), so one tap always guarantees a live wave. */
  private onForceWave(): void {
    if (this.survivalClock.dayPhase === 'day') this.survivalClock.toggleDayNight();
    this.waveDirector.beginWave();
  }

  /** Apply a mob's bite to the companion NPC (plan 042 Step 6 — the NPC twin of
   *  {@link CombatController.damagePlayer}).
   *  A no-op once downed (mobs stop targeting it, but this also guards against an in-flight strike landing
   *  the same tick it collapsed). On a lethal blow it collapses into the `downed` state via the
   *  character-side die(); the dawn revive that stands it back up is plan 042 Step 7. FX are cleaned up
   *  first, mirroring the enemy kill path, so no in-flight flash tween pokes the (surviving) sprite. */
  private damageNpc(amount: number): void {
    const npc = this.companionManager.get();
    if (!npc || npc.downed || amount <= 0) return;
    npc.takeDamage(amount);
    if (npc.hp <= 0) {
      this.fx.cleanupActorFx(npc.sprite); // stop any in-flight hit-flash before the collapse
      npc.die(); // character-side collapse → downed; CompanionManager idles it on the Death strip
    }
  }

  /** Landed-bite feedback on the companion — its sprite flash (the NPC twin of
   *  {@link CombatController.onPlayerHurt}, without the player-only screen-edge damage vignette /
   *  camera kick). No-op if it's gone/downed. */
  private onNpcHurt(): void {
    const npc = this.companionManager.get();
    if (npc && !npc.downed) this.fx.flashHit(npc.sprite);
  }

  /** Switch input mode (mutually exclusive) and notify the HUD to update accordingly. */
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

  /** Palette picked a buildable (the HUD's `build:select`): route to BuildManager, which remembers the
   *  selection and enters build mode. */
  private onBuildSelect({ id }: { id: string }): void {
    this.buildManager.select(id);
  }

  /** Toggle demolish mode (plan 037 2b) — the HUD DEMOLISH button / ESC via `demolish:toggle`. */
  private onDemolishToggle(): void {
    this.setDemolishMode(!this.demolishMode);
  }

  /** Set demolish mode + notify the HUD (`demolish:modeChanged`). Turning it ON exits build mode (the
   *  two are mutually exclusive — a base-building session is either placing or unbuilding, never both).
   *  Deliberately does NOT cancelAll() (mirrors build mode's non-destructive toggle): entering demolish
   *  leaves any in-flight worker order running until you actually mark a wall. */
  private setDemolishMode(on: boolean): void {
    this.demolishMode = on;
    if (on && this.buildManager.buildMode) this.buildManager.toggleBuild(); // leave build mode
    this.game.events.emit('demolish:modeChanged', this.demolishMode);
  }

  /** Build mode changed (`build:modeChanged`, from BuildManager) — if it just turned ON while demolish
   *  mode was active, drop demolish (the mutual-exclusion's other direction: BuildManager.select/toggle
   *  own build mode, so this closes the loop without them knowing demolish exists). */
  private onBuildModeChanged(active: boolean): void {
    if (active && this.demolishMode) this.setDemolishMode(false);
  }

  // --- Companion assignment (plan 042 Step 9) — the SHARED setter path the assignment menu AND the
  // `__test` seams both call, so the in-game popover and the harness drive exactly one code path. Each
  // is a no-op when no companion is spawned; the fields are polled live by CompanionManager.update, so
  // a change takes effect on the next frame (no restart of an in-flight role/posture needed). ------

  /** Set the companion's day job (Gather / Repair). Wired to the menu's `npc:assignDayRole` + the
   *  `setNpcDayRole` `__test` seam. */
  private setNpcDayRole(role: NpcDayRole): void {
    const npc = this.companionManager.get();
    if (npc) npc.dayRole = role;
  }

  /** Set the companion's night posture (Guard / Follow / Refuel). Wired to the menu's
   *  `npc:assignNightPosture` (and "Guard here"'s place-then-adopt) + the `setNpcNightPosture` seam. */
  private setNpcNightPosture(posture: NpcNightPosture): void {
    const npc = this.companionManager.get();
    if (npc) npc.nightPosture = posture;
  }

  /** Set the companion's night guard tile. Wired to the guard-placement tap (below) + the
   *  `setNpcGuardPoint` seam; the `guard` posture holds this tile (see CompanionManager.driveGuard). */
  private setNpcGuardPoint(col: number, row: number): void {
    const npc = this.companionManager.get();
    if (npc) npc.guardPoint = { col, row };
  }

  /** Menu "Guard here" (`npc:beginPlaceGuard`): arm the one-tap place-the-point mode — the next
   *  command-mode world tap sets the guard tile + adopts the guard posture (see the onTap dep). No-op
   *  with no companion, so a stray event can't strand the world in a placing state. */
  private beginPlaceGuardPoint(): void {
    if (this.companionManager.get()) this.placingGuardPoint = true;
  }

  /** Disarm guard-point placement without posting one — Escape, or a tap back on the NPC. */
  private cancelPlaceGuardPoint(): void {
    this.placingGuardPoint = false;
  }

  /** A tap on the companion opened its assignment menu: hand the HUD the NPC's current role/posture so
   *  it can highlight the live rows. (The legacy Phaser popover was anchored to the sprite's on-screen
   *  point; the DOM HUD is a bottom sheet, so that x/y payload was dropped at plan 046 Step 13.) */
  private openNpcMenu(npc: NpcCharacter): void {
    this.game.events.emit('npc:menuOpen', {
      dayRole: npc.dayRole,
      nightPosture: npc.nightPosture,
    });
  }

  /** Open the DOM craft menu for a tapped workbench (plan 048 Step 7): emit its id + live hp so the
   *  menu can list recipes and offer Repair when damaged. Resolved through the module so `state` is
   *  the typed {@link WorkbenchState}; a bench gone between pick and here is a silent no-op. */
  private openCraftMenu(bench: PlacedStructure): void {
    const b = this.workbench.benchById(bench.id);
    if (!b) return;
    this.game.events.emit('craft:menuOpen', {
      benchId: b.id,
      hp: b.state.hp,
      maxHp: b.state.maxHp,
    });
  }

  /** A recipe pick in the craft menu → enqueue the real `craft` worker order (plan 048 Step 7). */
  private onCraftQueue(p: { benchId: string; recipeId: string }): void {
    this.enqueue({ kind: 'craft', benchId: p.benchId, recipeId: p.recipeId });
  }

  /** The Repair pick in the craft menu (shown when the bench is damaged) → enqueue the player `repair`
   *  worker order for the bench (plan 048 Step 7; the mechanic landed in Step 4). */
  private onCraftRepair(p: { benchId: string }): void {
    this.enqueue({ kind: 'repair', structureId: p.benchId });
  }

  /** True while the movepad is authoritative — manual Combat mode OR the combatActive auto-surface
   *  (plan 035a Step 3). The movepad drive (update()) and onCombatMove gate rebase onto THIS rather
   *  than raw `mode==='combat'`, which is what stops a "dead movepad" when controls auto-surface in
   *  command mode (critique #2). Command-mode taps/pan/queue-paint stay live independently (see
   *  PointerInputController) — the chosen precedence: movepad drives, taps still queue orders. */
  private movepadDrives(): boolean {
    return this.mode === 'combat' || this.combatActive;
  }

  /** Recompute {@link combatActive} and emit `combat:activeChanged` only when it flips (the HUD
   *  shows/hides the fighting HUD on it). Engages when a live enemy is within COMBAT_ACTIVE_RADIUS_TILES
   *  (Chebyshev) OR it's night; retracts only past the wider hysteresis radius (see below) to stop
   *  boundary flicker. Deliberately does NOT call setMode('combat') (that cancelAll()s the queue). */
  private updateCombatActive(): void {
    const pt = this.playerChar.tile();
    // Hysteresis: engage at the tight activation radius, but once engaged don't retract until every
    // enemy is beyond the wider release radius. A boar loitering at the exact trigger range would
    // otherwise flick the fighting HUD on/off every frame it stepped across the line (playtest bug).
    const radius = this.combatActive
      ? COMBAT_ACTIVE_RADIUS_TILES + COMBAT_ACTIVE_HYSTERESIS_TILES
      : COMBAT_ACTIVE_RADIUS_TILES;
    const enemyNear = this.enemyManager
      .all()
      .some(
        (z) => z.alive && Math.max(Math.abs(z.col - pt.col), Math.abs(z.row - pt.row)) <= radius,
      );
    const next = enemyNear || this.survivalClock.dayPhase === 'night';
    if (next === this.combatActive) return;
    this.combatActive = next;
    this.game.events.emit('combat:activeChanged', next);
  }

  /** Combat movepad drag: store the drive vector (applied each frame in update(), scaled by
   * effectiveMoveSpeed) — this bypasses the pathfinder/task queue. Accepted whenever the movepad is
   * authoritative (movepadDrives): manual Combat mode or the combatActive auto-surface. */
  private onCombatMove(vec: { dx: number; dy: number }): void {
    if (!this.movepadDrives()) return;
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
    if (this.movepadDrives()) this.player.body.setVelocity(0, 0);
  }
}
