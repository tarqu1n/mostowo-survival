import Phaser from 'phaser';
import {
  CHOP_INTERVAL_MS,
  NPC_CARRY_CAP,
  NPC_REPAIR_MS,
  NPC_REPAIR_WOOD_PER_TICK,
  NPC_REPAIR_HP_PER_TICK,
  NPC_VISION,
  NPC_ATTACK_WINDUP_MS,
  NPC_ATTACK_COOLDOWN_MS,
  NPC_COMBAT_REPATH_MS,
  NPC_FOLLOW_RADIUS_TILES,
  CAMPFIRE_FEED_INTERVAL_MS,
  CAMPFIRE_FUEL_PER_WOOD,
} from '../../config';
import type { DayPhase } from '../../systems/daynight';
import { tileToWorldCenter } from '../../systems/grid';
import { findPath, reachableAdjacent, type Cell, type Dims } from '../../systems/pathfind';
import { TaskQueue } from '../../systems/tasks';
import { resolveMeleeAttack } from '../../systems/combat';
import {
  acquireNearestTarget,
  inMeleeContact,
  type CombatTarget,
} from '../../systems/companionCombat';
import type { SupplyItem } from '../../systems/baseSupply';
import type { TreeNode } from '../../entities/types';
import { NpcCharacter } from '../../entities/NpcCharacter';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link CompanionManager} needs but doesn't own — GameScene supplies these as
 * closures over its own private fields/methods at construction (the plan 013/015 coupling rule the
 * other world managers follow: managers get a narrow interface, never raw field access, and never a
 * direct manager↔manager edge — the scene mediates). All are resolved at CALL time (during
 * {@link CompanionManager.update}), so construction order stays irrelevant — the companion is built
 * before BuildManager/StructureManager, whose closures below only fire once the scene is running.
 */
export interface CompanionManagerDeps {
  /** Live grid extent (per loaded map) — the same dims the player's pathfinder reads. */
  dims(): Dims;
  /** Walkability veto for the pathfinder — the SAME composite the player's `pathTo` uses (walls +
   *  live blocking nodes + decor + map). The companion adds the player's tile on top (see
   *  {@link CompanionManager} occupancy note) so the two actors never path onto the same tile. */
  isBlocked(col: number, row: number): boolean;
  /** The player's current logical tile — folded into the companion's occupancy veto so it doesn't
   *  stack on the player. */
  playerTile(): Cell;
  /** Current day/night phase — gather only runs by day (plan 042 Step 4; night postures are Steps 6-8). */
  dayPhase(): DayPhase;
  /** Every resource node, alive and dead (`ResourceNodeManager.all()`); the gather planner filters to
   *  alive wood/rock nodes itself. Returns the manager's raw backing array — read-only here. */
  nodes(): TreeNode[];
  /** Fell one hit off a node through the shared `ResourceNodeManager.chop` path (hp/deplete/regrow/fx),
   *  redirecting the yield into `onYield` (the companion's carry buffer) instead of the player's bag. */
  chopNode(
    tree: TreeNode,
    facing: { dCol: number; dRow: number },
    onYield: (itemId: string, n: number) => void,
  ): void;
  /** The lit hearth's tile (the walk-to deposit anchor), or null when no fire is lit. */
  litHearthTile(): Cell | null;
  /** Deposit `n` of a supply kind into the shared base-supply pool (`baseSupply.add`). */
  supplyAdd(item: SupplyItem, n: number): void;
  /** Snapshot of every live wall (id + tile + hp/maxHp) — the `repair` day-role planner scans this for
   *  damaged walls (`hp < maxHp`). A cheap plain snapshot, not the raw WallStructure (013/015 rule). */
  walls(): WallRepairTarget[];
  /** Restore `amount` hp to wall `id` (clamped to maxHp, updates its visual) via `WallBehavior.repair`;
   *  returns whether it is now at full hp (so the planner moves to the next damaged wall). No-op on an
   *  unknown or already-full wall. */
  repairWall(id: string, amount: number): boolean;
  /** Count currently pooled of a supply kind (`baseSupply.count`) — the repair planner checks wood > 0
   *  before pathing so an empty base never thrashes the walk. */
  supplyCount(item: SupplyItem): number;
  /** Withdraw `n` of a supply kind from the base pool (`baseSupply.take`); false (and no-op) when short,
   *  so the repair tick stops the moment wood runs out. */
  supplyTake(item: SupplyItem, n: number): boolean;
  /** Every live enemy as a combat target (plan 042 Step 7) — id + world pos + feet tile + body tiles +
   *  stats, for the night combat stepper's nearest-enemy acquire. A plain snapshot (013/015 rule), never
   *  the raw MonsterCharacter; a dead/absent mob is omitted so it's never a valid target. */
  enemies(): CombatTarget[];
  /** Deal `amount` to the live enemy `id` through the SAME kill/flash/corpse path the player's attack
   *  uses (`EnemyManager.hurtEnemy`) — reused so enemy death/FX/corpse bookkeeping stays consistent and
   *  isn't duplicated. No-op on an unknown/dead id. */
  damageEnemy(id: string, amount: number): void;
  /** Injectable combat rng (the scene's `this.rng`) for the strike's hit roll — threaded like
   *  {@link import('./EnemyManager').EnemyManagerDeps.rng} so the DEV test API's pinned rng reaches it. */
  rng(): number;
  /** Add `amount` fuel to the currently-lit hearth WITHOUT an Inventory spend — the `refuel` night
   *  posture (plan 042 Step 8) sources its wood from the base-supply pool (`supplyTake`), not the
   *  player's bag, so it can't reuse the player's `feedOne` (which spends Inventory). Routes to
   *  `CampfireBehavior.refuel`. Returns false (no-op) when no fire is lit. */
  refuelFire(amount: number): boolean;
}

/** The narrow per-wall snapshot the `repair` planner reads (via {@link CompanionManagerDeps.walls}) —
 *  just the id + tile + hp fields it needs to find and path to the most-damaged wall. */
export interface WallRepairTarget {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly hp: number;
  readonly maxHp: number;
}

/** yieldItemId → base-supply kind. Gather only targets nodes that map to a supply kind — a node
 *  whose yield isn't wood/rock (e.g. a berry bush's `berries`) is never a gather target. */
const SUPPLY_KIND: Readonly<Record<string, SupplyItem>> = { wood: 'wood', stone: 'rock' };

/**
 * The AI companion (plan 042) — spawn, per-frame drive, and the reset/teardown half of a world reset.
 * Mirrors {@link EnemyManager} but owns exactly ONE `NpcCharacter | null` (the game has a single
 * companion), so there's no collection and no id counter — {@link get} returns the one NPC or null.
 *
 * **The companion owns its OWN slimmed task loop (plan 042 Step 4, critique #5).** The player's ~350-
 * line scene executor (`GameScene.beginCurrent`/`runHarvest`/…) is deliberately NOT reused or
 * refactored — this manager runs a small dedicated executor that borrows only the PURE pieces
 * (`findPath`/`reachableAdjacent`, the `CHOP_INTERVAL_MS` cadence) and the shared node bookkeeping
 * (`deps.chopNode` → `ResourceNodeManager.chop`), so node depletion stays consistent whichever actor
 * chops. It NEVER touches `GameScene.queue`; it holds its own {@link TaskQueue} instance ({@link queue})
 * — kept on the manager (not the NpcCharacter), mirroring how the player's queue lives on the scene
 * rather than on `PlayerCharacter`, and reset whenever the single companion is (re)spawned or cleared.
 *
 * **Gather state machine (day role `gather`, day only).** While idle it plans the next order:
 *   1. find the nearest reachable alive wood/rock node → path adjacent → chop it on the cadence,
 *      accruing the yield into a carry buffer (up to {@link NPC_CARRY_CAP});
 *   2. once the buffer is full (or no reachable node remains and it's carrying something) → path to a
 *      tile adjacent to the lit hearth and deposit the whole buffer into `baseSupply`, then repeat.
 * With no lit hearth to walk to, it deposits IN PLACE (the base-supply store is global — the hearth is
 * only the walk-to anchor, not a gate on the count), so a carry never wedges the loop.
 *
 * **Repair state machine (day role `repair`, day only, plan 042 Step 5).** The SAME slimmed executor,
 * a second branch alongside gather: while idle it finds the MOST-DAMAGED reachable wall (lowest
 * `hp/maxHp` ratio among `hp < maxHp`), paths adjacent (reusing gather's stand-adjacent lookup), and
 * mends it on the {@link NPC_REPAIR_MS} cadence — each tick withdrawing {@link NPC_REPAIR_WOOD_PER_TICK}
 * wood from `baseSupply` and restoring {@link NPC_REPAIR_HP_PER_TICK} hp. This ties the two day roles
 * together economically (gather fills the pool, repair drains it). An empty pool → idle (surface
 * nothing); a full wall is never targeted (no path-thrash), and reaching `maxHp` replans to the next.
 *
 * **Night postures (plan 042 Steps 7–8).** By night the same per-frame drive runs the posture
 * dispatcher ({@link driveNight}) instead of the day roles. The shared ENGAGE primitive
 * ({@link engageNearest}, the Step-7 combat stepper) acquires the nearest live enemy within
 * {@link NPC_VISION}, chases to a stand-adjacent tile, and lands a telegraphed strike on contact —
 * reusing the monster's acquire → chase → contact SHAPE (never its FSM), the shared
 * {@link resolveMeleeAttack}, and the weapon-pin swing; the hit routes back through the existing enemy
 * kill/flash/corpse path (`deps.damageEnemy`). The THREE postures (Step 8) layer positioning/leash over
 * it: **guard** ({@link driveGuard}) holds a set tile and returns to post; **follow**
 * ({@link driveFollow}) trails the player (no path-thrash when the player is still) and fights
 * alongside; **refuel** ({@link driveRefuel}) walks to the lit hearth and feeds it base-supply wood,
 * holding where the fire was if none is lit. A downed companion (0 HP, {@link NpcCharacter.die}) stays
 * inert on its Death strip until the night→day edge revives it ({@link NpcCharacter.revive}) at
 * {@link NPC_REVIVE_HP} — consolidated with the posture-switch in {@link onPhaseChanged}, the single
 * `time:changed` handler (Step 8).
 *
 * **Occupancy.** The companion's pathfinder veto is the player's `isBlocked` composite PLUS the
 * player's current tile, so the two actors never route onto the same tile. Its own tile is never
 * vetoed (findPath rejects a blocked start), so it can always path away from where it stands.
 *
 * Constructed fresh in `buildWorld()` each (re)start, AFTER the player exists (construction order is
 * load-bearing — the tick env reads player state). It does NOT auto-spawn — {@link spawn} is a
 * separate call (the dev seam / a scenario), so construction stays side-effect-free.
 *
 * **SHUTDOWN vs Arcade physics — the same trap {@link EnemyManager} documents.** The companion's
 * sprite carries an Arcade physics body. Phaser's scene teardown, PLUS Arcade's own SHUTDOWN-triggered
 * World teardown, destroy every sprite/body BEFORE this manager's SHUTDOWN listener runs. So
 * {@link destroy} may ONLY drop the reference — it must NEVER call `dispose()`/`sprite.destroy()`.
 * That is DIFFERENT from {@link reset}, which runs at RUNTIME (physics alive) where tearing the sprite
 * down via `NpcCharacter.dispose()` IS correct.
 */
export class CompanionManager {
  private npc: NpcCharacter | null = null;

  // --- Companion-owned task loop (plan 042 Step 4) — never GameScene.queue -------------------------
  /** The companion's own order queue — one auto-planned action at a time (a `harvest` of a chosen node,
   *  or a `move` to the hearth-deposit stand tile). Distinct from the player's `GameScene.queue`. */
  private readonly queue = new TaskQueue();
  /** The carry buffer, split by supply kind so a mixed haul (a tree then a rock) deposits correctly;
   *  `npc.carry` mirrors the total for `debugState().companion.carry`. */
  private carryBuf: { wood: number; rock: number } = { wood: 0, rock: 0 };
  /** Harvest-cadence accumulator (ms), mirroring the player's `chopElapsed` — one chop per
   *  `CHOP_INTERVAL_MS` while standing at the node. */
  private chopElapsed = 0;
  /** Repair-cadence accumulator (ms), the `repair`-role twin of {@link chopElapsed} — one mend per
   *  `NPC_REPAIR_MS` while standing at the wall. */
  private repairElapsed = 0;
  /** The current pathfinding goal (a node-adjacent or hearth-adjacent stand tile) — re-fed to
   *  `findPath` on a stuck-repath, like the player's `actionGoal`. */
  private goal: Cell | null = null;
  /** The player's tile this tick — captured at the top of the gather drive so {@link npcBlocked} folds
   *  it into the occupancy veto without re-querying per pathfind call. */
  private playerTileTick: Cell = { col: -1, row: -1 };

  // --- Night-combat state (plan 042 Step 7) — the dedicated companion combat stepper ---------------
  /** >0 while a strike wind-up is in flight: the timestamp (ms) the blow lands. Set on entering a
   *  telegraphed strike in contact, cleared on the strike or on leaving contact (mirrors the mob). */
  private combatWindupUntil = 0;
  /** Earliest time (ms) the NEXT strike may begin winding up — the cadence gate ({@link NPC_ATTACK_COOLDOWN_MS}). */
  private combatReadyAt = 0;
  /** Chase-repath accumulator (ms) — the path to a stand-adjacent tile refreshes at most every
   *  {@link NPC_COMBAT_REPATH_MS} while closing on the target (throttled, like the mob's chase repath). */
  private combatRepathElapsed = 0;
  /** The enemy id currently engaged — so a change of target forces an immediate repath. */
  private combatTargetId: string | null = null;

  // --- Day/night handoff + night-posture state (plan 042 Step 8) ------------------------------------
  /** The phase our day/night handoff last APPLIED — gates {@link onPhaseChanged} to a genuine phase
   *  FLIP so a same-phase `applyClock` re-emit (a manual clock jump fires `time:changed` unconditionally)
   *  is an idempotent no-op: no double-revive, no order re-thrash. `null` until the first flip. */
  private appliedPhase: DayPhase | null = null;
  /** The player tile the `follow` posture last pathed toward — a still player (same tile) never
   *  triggers a repath, so a stationary player doesn't path-thrash the companion. */
  private lastFollowTile: Cell | null = null;
  /** The hearth-adjacent stand tile the `refuel` posture walks to — recomputed only when null, cleared
   *  on a posture handoff so a re-entry re-derives it. */
  private refuelStand: Cell | null = null;
  /** Refuel-cadence accumulator (ms) — one wood fed per {@link CAMPFIRE_FEED_INTERVAL_MS}, mirroring
   *  the player's refuel feed cadence. */
  private refuelElapsed = 0;
  /** Last-known lit hearth tile — the `refuel` posture holds here (and feeds nothing) when no fire is
   *  currently lit (the documented "if none, hold where the fire was" fallback). */
  private lastHearthTile: Cell | null = null;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: CompanionManagerDeps,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  // --- Spawning ----------------------------------------------------------------

  /** Place the single companion at tile `(col,row)` (converted to the world centre like the enemy
   *  spawn) and return it. A single companion, so any prior one is torn down first (RUNTIME dispose —
   *  the scene is alive here). Callers seed scaffold state (role/posture/hp/…) on the returned NPC. */
  spawn(col: number, row: number): NpcCharacter {
    if (this.npc) this.npc.dispose(); // one companion — replace any prior at runtime
    this.resetGatherState(); // a fresh companion starts with an empty queue + carry
    this.npc = new NpcCharacter(this.scene, {
      x: tileToWorldCenter(col),
      y: tileToWorldCenter(row),
    });
    return this.npc;
  }

  // --- Queries -------------------------------------------------------------------

  /** The live companion, or null when none is spawned. */
  get(): NpcCharacter | null {
    return this.npc;
  }

  // --- Per-frame tick --------------------------------------------------------------

  /**
   * Per-frame drive for the companion: run its current role/posture loop and refresh its animation.
   * Above GameScene's no-action early-return, so it ticks whether or not the PLAYER has an active task.
   * By DAY it gathers/repairs (plan 042 Steps 4/5); by NIGHT the posture dispatcher shapes where/how it
   * fights ({@link driveNight} — guard/follow/refuel, Step 8). A downed companion is left inert on its
   * Death strip until the dawn revive (in {@link onPhaseChanged}) stands it back up.
   *
   * **The role/posture BEHAVIOUR is polled here each frame** (phase + `dayRole`/`nightPosture`), so a
   * scenario seeded straight into a phase — which emits no `time:changed` — behaves without any edge
   * event. The once-per-transition SIDE EFFECTS (dawn revive, order/combat handoff) are consolidated
   * into {@link onPhaseChanged}, the single `time:changed` handler (plan 042 Step 8) — the Step-7
   * `update()` phase-edge revive was removed to keep exactly one code path per transition.
   */
  update(delta: number): void {
    const npc = this.npc;
    if (!npc) return;
    if (npc.downed) {
      npc.updateAnim(); // inert on the Death strip until onPhaseChanged's dawn revive
      return;
    }
    const day = this.deps.dayPhase() === 'day';
    if (day && npc.dayRole === 'gather') this.driveGather(npc, delta);
    else if (day && npc.dayRole === 'repair') this.driveRepair(npc, delta);
    else this.driveNight(npc, delta); // night → posture dispatcher (plan 042 Step 8)
    npc.updateAnim();
  }

  // --- Day/night handoff (plan 042 Step 8) — the single `time:changed` transition path ------------

  /**
   * Day/night role switch — the SINGLE transition path, subscribed to `time:changed` in
   * `GameScene.wireBus` (with the paired SHUTDOWN `off`, mirroring `WaveDirector.onTimeChanged`).
   * Consolidates the Step-7 `update()` phase-edge revive here so revive + posture-adopt + day-role-resume
   * all happen ONCE per transition. Gated on a genuine phase FLIP via {@link appliedPhase}: a same-phase
   * re-emit — a manual `applyClock` clock jump fires `time:changed` unconditionally — is an idempotent
   * no-op, so it never double-revives or re-thrashes an in-flight order.
   *
   * On the night→day edge a downed companion revives ({@link NpcCharacter.revive}, itself idempotent —
   * a no-op when already up) at `NPC_REVIVE_HP`; either edge clears the transient combat/order/posture
   * movement state ({@link handoff}) so the incoming role/posture replans from a clean slate. The role
   * (gather/repair) and posture (guard/follow/refuel) then resume automatically via {@link update}'s
   * per-frame poll — this handler owns only the edge-triggered side effects, not the steady-state drive.
   */
  onPhaseChanged({ phase }: { phase: DayPhase }): void {
    const npc = this.npc;
    if (!npc) return;
    if (phase === this.appliedPhase) return; // same-phase re-emit (clock jump) — idempotent no-op
    this.appliedPhase = phase;
    if (phase === 'day' && npc.downed) npc.revive(); // dawn revive (idempotent; no-op when already up)
    this.handoff(npc); // clear stale order/combat/posture-movement state for a clean phase handoff
  }

  /** Clear the transient per-phase state — the order queue + its goal/cadence, the combat wind-up/engage,
   *  the posture movement targets, and any in-flight path — on a day/night flip, so the incoming role or
   *  posture starts from a clean slate rather than walking a stale target. */
  private handoff(npc: NpcCharacter): void {
    this.finishOrder(); // drop any gather/repair order + goal + chop/repair cadence
    this.resetCombatState(); // drop any wind-up / engaged target / chase repath
    this.lastFollowTile = null;
    this.refuelStand = null;
    this.refuelElapsed = 0;
    npc.path = [];
    npc.pathIndex = 0;
  }

  // --- Gather executor (the companion's slimmed task loop) -----------------------------------------

  /** One frame of the gather loop: refresh the occupancy veto, plan an order if idle, then run the
   *  current one — with the same stuck-guard/repath the player's loop uses so a deflected walk recovers. */
  private driveGather(npc: NpcCharacter, delta: number): void {
    this.playerTileTick = this.deps.playerTile();

    if (this.queue.current === null) this.planNext(npc);

    const action = this.queue.current;
    if (!action) {
      npc.advancePath(); // nothing to do (no reachable node, empty carry) — settle in place
      return;
    }
    if (action.kind === 'harvest') this.runHarvest(npc, action.treeId, delta);
    else if (action.kind === 'move') this.runDeposit(npc);

    // Stuck guard (belt-and-braces behind the corner-safe pathfinder), mirroring GameScene.update: if
    // the walk stopped closing on its waypoint, repath to the same goal (or drop it if now walled off).
    if (npc.isStuck()) this.repath(npc);
  }

  /** Decide the next order when idle: deposit a full/stranded haul, else harvest the nearest node. */
  private planNext(npc: NpcCharacter): void {
    const carried = this.carryBuf.wood + this.carryBuf.rock;
    if (carried >= NPC_CARRY_CAP) return this.beginDeposit(npc); // buffer full — go bank it

    const tree = this.nearestHarvestable(npc);
    if (tree) {
      // Prefer this species' stand tiles (a tall tree restricts to its base); fall back to any adjacent
      // tile if those are walled off — the SAME two-tier lookup the player's beginCurrent uses.
      const target = { col: tree.col, row: tree.row };
      const stand =
        reachableAdjacent(
          npc.tile(),
          target,
          this.npcBlocked,
          this.deps.dims(),
          tree.def.standOffsets,
        ) ?? reachableAdjacent(npc.tile(), target, this.npcBlocked, this.deps.dims());
      if (stand && this.pathTo(npc, stand)) {
        this.queue.replace({ kind: 'harvest', treeId: tree.id });
        this.chopElapsed = 0;
      }
      return;
    }
    // No reachable node left: bank whatever we're carrying, else idle until one regrows.
    if (carried > 0) this.beginDeposit(npc);
  }

  /** Nearest alive wood/rock node with a reachable adjacent stand tile, by tile distance from the NPC
   *  (candidates sorted near→far so the first reachable one wins — matching the player picking the
   *  closest actionable target). Bushes / non-supply yields are never gather targets. */
  private nearestHarvestable(npc: NpcCharacter): TreeNode | null {
    const from = npc.tile();
    const dims = this.deps.dims();
    const candidates = this.deps
      .nodes()
      .filter((t) => t.alive && t.def.yieldItemId in SUPPLY_KIND)
      .sort((a, b) => dist2(from, a) - dist2(from, b));
    for (const tree of candidates) {
      const target = { col: tree.col, row: tree.row };
      const stand =
        reachableAdjacent(from, target, this.npcBlocked, dims, tree.def.standOffsets) ??
        reachableAdjacent(from, target, this.npcBlocked, dims);
      if (stand) return tree;
    }
    return null;
  }

  /** Harvest a chosen node: walk to the stand tile, then chop it on the cadence, accruing the yield
   *  into the carry buffer. Mirrors GameScene.runHarvest's shape (walk-then-swing-in-place) but banks
   *  into the buffer instead of the player's bag, and completes on fell OR a full buffer. */
  private runHarvest(npc: NpcCharacter, treeId: string, delta: number): void {
    const tree = this.deps.nodes().find((t) => t.id === treeId);
    if (!tree || !tree.alive) return this.finishOrder();
    if (!npc.advancePath()) return; // still walking to the stand tile
    npc.faceTile(tree.col, tree.row); // swing toward the node, whatever side we stood on
    this.chopElapsed += delta;
    if (this.chopElapsed < CHOP_INTERVAL_MS) return;
    this.chopElapsed = 0;
    this.deps.chopNode(tree, npc.lastFacing, (itemId, n) => this.addToCarry(npc, itemId, n));
    const carried = this.carryBuf.wood + this.carryBuf.rock;
    if (!tree.alive || carried >= NPC_CARRY_CAP) this.finishOrder(); // felled or buffer full — replan next frame
  }

  /** Accrue a harvested hit's yield into the carry buffer (by supply kind) and mirror the total onto
   *  `npc.carry` so `debugState().companion.carry` reflects the live buffer. */
  private addToCarry(npc: NpcCharacter, itemId: string, n: number): void {
    const kind = SUPPLY_KIND[itemId];
    if (!kind) return; // defensive — nearestHarvestable only ever picks wood/rock nodes
    this.carryBuf[kind] += n;
    npc.carry = this.carryBuf.wood + this.carryBuf.rock;
  }

  /** Enter the deposit phase: path to a tile adjacent to the lit hearth. With no lit hearth (or none
   *  reachable), deposit IN PLACE — the base-supply store is global, so the hearth is only the walk-to
   *  anchor, and depositing in place keeps a carried haul from wedging the loop (documented fallback). */
  private beginDeposit(npc: NpcCharacter): void {
    const hearth = this.deps.litHearthTile();
    if (!hearth) return this.deposit(npc);
    const stand = reachableAdjacent(npc.tile(), hearth, this.npcBlocked, this.deps.dims());
    if (stand && this.pathTo(npc, stand)) {
      this.queue.replace({ kind: 'move', col: stand.col, row: stand.row });
    } else {
      this.deposit(npc); // hearth unreachable — fall back to depositing in place
    }
  }

  /** Run the deposit walk: on arrival at the hearth stand tile, dump the buffer into base supply. A
   *  `move` order in this executor is only ever a deposit walk (planNext queues nothing else). */
  private runDeposit(npc: NpcCharacter): void {
    if (npc.advancePath()) this.deposit(npc);
  }

  /** Dump the whole carry buffer into the shared base-supply pool and clear the order/buffer. */
  private deposit(npc: NpcCharacter): void {
    if (this.carryBuf.wood > 0) this.deps.supplyAdd('wood', this.carryBuf.wood);
    if (this.carryBuf.rock > 0) this.deps.supplyAdd('rock', this.carryBuf.rock);
    this.carryBuf = { wood: 0, rock: 0 };
    npc.carry = 0;
    this.finishOrder();
  }

  // --- Repair executor (day role `repair`, plan 042 Step 5) ----------------------------------------

  /** One frame of the repair loop, the twin of {@link driveGather}: refresh the occupancy veto, plan a
   *  mend if idle, then run the current order — with the same stuck-guard/repath the gather loop uses. */
  private driveRepair(npc: NpcCharacter, delta: number): void {
    this.playerTileTick = this.deps.playerTile();

    if (this.queue.current === null) this.planRepair(npc);

    const action = this.queue.current;
    if (!action) {
      npc.advancePath(); // nothing to mend (no damaged wall, or empty supply) — settle in place
      return;
    }
    if (action.kind === 'repair') this.runRepair(npc, action.wallId, delta);

    if (npc.isStuck()) this.repath(npc);
  }

  /** Decide the next repair order when idle: with no wood pooled → idle (don't path — repair drains the
   *  base supply the gather role fills). Else target the most-damaged reachable wall and path adjacent;
   *  no damaged/reachable wall → idle until one takes a hit. */
  private planRepair(npc: NpcCharacter): void {
    if (this.deps.supplyCount('wood') <= 0) return; // base is out of wood — nothing to mend with
    const wall = this.mostDamagedWall(npc);
    if (!wall) return; // no damaged, reachable wall — idle
    // Any adjacent tile (a wall is a single footprint tile with no stand-offset restriction) — the same
    // stand-adjacent lookup gather uses for a node.
    const stand = reachableAdjacent(
      npc.tile(),
      { col: wall.col, row: wall.row },
      this.npcBlocked,
      this.deps.dims(),
    );
    if (stand && this.pathTo(npc, stand)) {
      this.queue.replace({ kind: 'repair', wallId: wall.id });
      this.repairElapsed = 0;
    }
  }

  /** The most-damaged wall with a reachable adjacent stand tile: sorted by LOWEST `hp/maxHp` ratio (the
   *  relatively-most-damaged), tie-broken nearest-first. Full-HP walls are never candidates, so a mend
   *  never thrashes pathing toward an intact wall. */
  private mostDamagedWall(npc: NpcCharacter): WallRepairTarget | null {
    const from = npc.tile();
    const dims = this.deps.dims();
    const candidates = this.deps
      .walls()
      .filter((w) => w.hp < w.maxHp)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || dist2(from, a) - dist2(from, b));
    for (const wall of candidates) {
      const stand = reachableAdjacent(
        from,
        { col: wall.col, row: wall.row },
        this.npcBlocked,
        dims,
      );
      if (stand) return wall;
    }
    return null;
  }

  /** Mend a chosen wall: walk to the stand tile, then on the {@link NPC_REPAIR_MS} cadence withdraw a
   *  wood from base supply and restore hp. Mirrors {@link runHarvest}'s walk-then-act-in-place shape.
   *  Completes (replans) when the wall reaches full hp, is gone, or the base runs out of wood. */
  private runRepair(npc: NpcCharacter, wallId: string, delta: number): void {
    const wall = this.deps.walls().find((w) => w.id === wallId);
    if (!wall || wall.hp >= wall.maxHp) return this.finishOrder(); // gone or already intact — replan
    if (!npc.advancePath()) return; // still walking to the stand tile
    npc.faceTile(wall.col, wall.row); // face the wall while mending, whatever side we stood on
    this.repairElapsed += delta;
    if (this.repairElapsed < NPC_REPAIR_MS) return;
    this.repairElapsed = 0;
    if (!this.deps.supplyTake('wood', NPC_REPAIR_WOOD_PER_TICK)) return this.finishOrder(); // supply empty — stop, replan (idles)
    if (this.deps.repairWall(wallId, NPC_REPAIR_HP_PER_TICK)) this.finishOrder(); // hit maxHp — mend the next damaged wall
  }

  // --- Night postures (plan 042 Step 8) — the posture dispatcher over the Step-7 combat primitive ---

  /**
   * Night dispatcher: route to the executor for the companion's current {@link NpcCharacter.nightPosture}.
   * The three postures share ONE ENGAGE primitive ({@link engageNearest}, the Step-7 combat stepper) and
   * differ only in POSITIONING/leash: `guard` holds a set tile and returns to it, `follow` trails the
   * player and fights alongside, `refuel` keeps the lit hearth fed. Default `follow` (also the entity's
   * default) so an unspecified posture still behaves.
   */
  private driveNight(npc: NpcCharacter, delta: number): void {
    switch (npc.nightPosture) {
      case 'guard':
        this.driveGuard(npc, delta);
        break;
      case 'refuel':
        this.driveRefuel(npc, delta);
        break;
      case 'follow':
      default:
        this.driveFollow(npc, delta);
        break;
    }
  }

  /**
   * The shared night ENGAGE primitive (the plan 042 Step-7 combat stepper, generalised for Step 8):
   * acquire the NEAREST live enemy within {@link NPC_VISION} (the pure {@link acquireNearestTarget}),
   * then — reusing the monster's acquire → chase → telegraphed-contact SHAPE (NOT its FSM), the shared
   * {@link resolveMeleeAttack}, and the weapon-pin swing — either stand and land a telegraphed strike in
   * melee contact, or path to a tile adjacent to the target and close in. Returns the engaged target, or
   * `null` when none is in range: unlike Step 7 it does NOT settle movement on the no-target branch — the
   * CALLING POSTURE owns that idle/return/errand positioning (guard returns to post, follow trails the
   * player, refuel tends the fire). Engages ENEMIES only (the player / itself are never in the list).
   */
  private engageNearest(npc: NpcCharacter, delta: number): CombatTarget | null {
    const target = acquireNearestTarget(
      { x: npc.sprite.x, y: npc.sprite.y },
      this.deps.enemies(),
      NPC_VISION,
    );
    if (!target) {
      this.combatTargetId = null;
      this.combatWindupUntil = 0; // nothing to strike — drop any pending tell
      return null; // caller does its posture's positioning
    }

    const npcTile = npc.tile();
    if (inMeleeContact(npcTile, target.bodyTiles)) {
      // In contact — plant and run the telegraphed strike (the mob's clunk-fix wind-up, mirrored).
      npc.path = [];
      npc.pathIndex = 0;
      npc.sprite.body.setVelocity(0, 0);
      this.tryStrike(npc, target);
      this.combatTargetId = target.id;
      return target;
    }

    // Chase: refresh the path to a stand-adjacent tile on the repath cadence (or when the target changed
    // / the path ran out), then advance — with the same stuck-guard/repath the gather loop uses.
    this.combatWindupUntil = 0; // out of contact — any wind-up whiffs (the target slipped away)
    this.combatRepathElapsed += delta;
    const needPath =
      this.combatTargetId !== target.id ||
      npc.pathIndex >= npc.path.length ||
      this.combatRepathElapsed >= NPC_COMBAT_REPATH_MS;
    if (needPath) {
      this.combatRepathElapsed = 0;
      const stand = reachableAdjacent(npcTile, target.tile, this.npcBlocked, this.deps.dims());
      if (stand) this.pathTo(npc, stand);
    }
    this.combatTargetId = target.id;
    npc.advancePath();
    if (npc.isStuck()) this.repath(npc);
    return target;
  }

  /**
   * `guard` posture: hold a set tile, engage any mob that comes within range, and RETURN to post once
   * the coast is clear. The guard tile defaults to where the companion stands on first guard drive (or a
   * scenario's `guardAt` / the `setNpcGuardPoint` dev seam). Engagement range is the shared
   * {@link NPC_VISION} — a natural leash: it chases only what it can SEE, then walks back — so it never
   * wanders off after a fleeing mob. Idles in place (no path-thrash) once home.
   */
  private driveGuard(npc: NpcCharacter, delta: number): void {
    this.playerTileTick = this.deps.playerTile();
    if (!npc.guardPoint) npc.guardPoint = npc.tile(); // default the post to the current tile
    const post = npc.guardPoint;

    if (this.engageNearest(npc, delta)) return; // a mob is in range — fight it

    // Coast clear — return to post; idle once there (don't re-path when already home / already heading).
    const from = npc.tile();
    if (from.col === post.col && from.row === post.row) {
      npc.advancePath(); // at post — settle any residual movement
      return;
    }
    const heading = this.goal != null && this.goal.col === post.col && this.goal.row === post.row;
    if (!heading || npc.pathIndex >= npc.path.length) this.pathTo(npc, post);
    npc.advancePath();
    if (npc.isStuck()) this.repath(npc);
  }

  /**
   * `follow` posture: stick near the player and fight alongside. Engages any mob in range first
   * ({@link engageNearest}); otherwise trails the player, but only (re)paths once the player is beyond
   * {@link NPC_FOLLOW_RADIUS_TILES} (Chebyshev) AND has stepped to a NEW tile since the last follow path
   * — so a still player never makes it path-thrash (inside the radius it simply idles in place).
   */
  private driveFollow(npc: NpcCharacter, delta: number): void {
    this.playerTileTick = this.deps.playerTile();
    if (this.engageNearest(npc, delta)) {
      this.lastFollowTile = null; // fighting broke formation — re-path fresh when we resume trailing
      return;
    }

    const player = this.playerTileTick;
    const from = npc.tile();
    const cheb = Math.max(Math.abs(from.col - player.col), Math.abs(from.row - player.row));
    if (cheb <= NPC_FOLLOW_RADIUS_TILES) {
      npc.advancePath(); // close enough — settle, no repath (no thrash while the player stands still)
      this.lastFollowTile = null;
      return;
    }

    // Too far — (re)path toward a tile adjacent to the player, throttled to an actual player tile change.
    const playerMoved =
      this.lastFollowTile === null ||
      this.lastFollowTile.col !== player.col ||
      this.lastFollowTile.row !== player.row;
    if (playerMoved || npc.pathIndex >= npc.path.length) {
      const stand = reachableAdjacent(from, player, this.npcBlocked, this.deps.dims());
      if (stand && this.pathTo(npc, stand))
        this.lastFollowTile = { col: player.col, row: player.row };
    }
    npc.advancePath();
    if (npc.isStuck()) this.repath(npc);
  }

  /**
   * `refuel` posture: keep the lit hearth fed. Walk to a tile adjacent to the hearth, then on the
   * player-refuel cadence ({@link CAMPFIRE_FEED_INTERVAL_MS}) withdraw one wood from the SHARED BASE
   * SUPPLY and add {@link CAMPFIRE_FUEL_PER_WOOD} fuel to the fire (`deps.refuelFire`) — the same
   * wood→fuel exchange the player's `refuel` order uses, sourced from the base pool rather than the bag,
   * so an empty pool simply feeds nothing. Depends on a LIT hearth: when none is lit it holds at the
   * last-known hearth tile and feeds nothing (the documented "if none, hold where the fire was"
   * fallback). Kept simple — refuel prioritises the fire over fighting; a bite still lands via the
   * Step-6 enemy AI (mobs target the NPC), it just doesn't fight back while tending.
   */
  private driveRefuel(npc: NpcCharacter, delta: number): void {
    this.playerTileTick = this.deps.playerTile();
    const hearth = this.deps.litHearthTile();
    if (hearth) this.lastHearthTile = hearth;
    const anchor = hearth ?? this.lastHearthTile;
    if (!anchor) {
      npc.advancePath(); // no fire has ever been lit — nothing to tend, settle in place
      return;
    }

    // Establish a walk to a hearth-adjacent stand tile once (single MVP hearth); reused each frame after.
    if (!this.refuelStand) {
      const stand = reachableAdjacent(npc.tile(), anchor, this.npcBlocked, this.deps.dims());
      if (stand) {
        this.refuelStand = stand;
        this.pathTo(npc, stand);
      }
    }
    const arrived = npc.advancePath(); // true once at the stand tile (or with no path — already there)
    if (npc.isStuck()) this.repath(npc);
    if (!arrived) return;

    npc.sprite.body.setVelocity(0, 0);
    npc.faceTile(anchor.col, anchor.row); // tend toward the fire, whatever side we stood on
    if (!hearth) return; // fire's out — hold where it was, feed nothing until it's relit
    this.refuelElapsed += delta;
    if (this.refuelElapsed < CAMPFIRE_FEED_INTERVAL_MS) return;
    this.refuelElapsed = 0;
    // One base-supply wood → CAMPFIRE_FUEL_PER_WOOD fuel (the player-refuel exchange). Empty pool → skip.
    if (this.deps.supplyTake('wood', 1)) this.deps.refuelFire(CAMPFIRE_FUEL_PER_WOOD);
  }

  /**
   * Advance the telegraphed stand-and-strike while in melee contact (mirrors MonsterCharacter's
   * strikeContact shape): begin a {@link NPC_ATTACK_WINDUP_MS} wind-up once the cadence gate
   * ({@link NPC_ATTACK_COOLDOWN_MS}) is open, then on completion resolve the hit through the shared
   * {@link resolveMeleeAttack} (attacker = NPC stats, defender = the enemy's stats, base = the equipped
   * cleaver's damage) and route the damage back through the existing enemy kill/flash/corpse path
   * (`deps.damageEnemy`). The visible strike is the one-shot dagger-slash strip ({@link NpcCharacter.playAttack}).
   */
  private tryStrike(npc: NpcCharacter, target: CombatTarget): void {
    const now = this.scene.time.now;
    if (this.combatWindupUntil > 0) {
      if (now >= this.combatWindupUntil) {
        this.combatWindupUntil = 0;
        this.combatReadyAt = now + NPC_ATTACK_COOLDOWN_MS; // gate the next wind-up (the bite cadence)
        npc.playAttack(target.tile.col, target.tile.row); // one-shot dagger-slash strip + face the struck tile
        const dmg = resolveMeleeAttack(
          npc.stats,
          target.stats,
          npc.meleeWeapon.damage,
          this.deps.rng,
        );
        if (dmg > 0) this.deps.damageEnemy(target.id, dmg); // reuse the player-attack enemy-death path
      }
    } else if (now >= this.combatReadyAt) {
      this.combatWindupUntil = now + NPC_ATTACK_WINDUP_MS; // cadence open → begin the telegraph
    }
  }

  /** Zero the night-combat stepper's transient state (wind-up / cadence gate / repath / engaged id) —
   *  on (re)spawn, the DEV reset, and the dawn revive, so a fresh night never inherits a stale strike. */
  private resetCombatState(): void {
    this.combatWindupUntil = 0;
    this.combatReadyAt = 0;
    this.combatRepathElapsed = 0;
    this.combatTargetId = null;
  }

  /** Path the companion toward `goal`, recording it for repath; false (leaving the path empty) if
   *  unreachable. Uses the SAME pure `findPath` + occupancy inputs the player's `pathTo` does, plus the
   *  player-tile veto. `[]` (already there) still counts as pathed — advancePath returns true at once. */
  private pathTo(npc: NpcCharacter, goal: Cell): boolean {
    const path = findPath(npc.tile(), goal, this.npcBlocked, this.deps.dims());
    if (path === null) return false;
    npc.path = path;
    npc.pathIndex = 0;
    this.goal = goal;
    return true;
  }

  /** Recompute the path to the active goal after a stall; drop the order if it's now walled off. */
  private repath(npc: NpcCharacter): void {
    if (!this.goal) return;
    const path = findPath(npc.tile(), this.goal, this.npcBlocked, this.deps.dims());
    if (path === null) {
      this.finishOrder(); // goal walled off — drop it, don't shove forever
      return;
    }
    npc.path = path;
    npc.pathIndex = 0;
  }

  /** Clear the current order + its goal so the next tick replans. */
  private finishOrder(): void {
    this.queue.clear();
    this.goal = null;
    this.chopElapsed = 0;
    this.repairElapsed = 0;
  }

  /** The companion's pathfinder veto: the player's walkability composite PLUS the player's current
   *  tile (so the two actors never stack). Its own tile is never added, so findPath can path away. */
  private readonly npcBlocked = (col: number, row: number): boolean =>
    this.deps.isBlocked(col, row) ||
    (col === this.playerTileTick.col && row === this.playerTileTick.row);

  // --- Reset / teardown --------------------------------------------------------------

  /** Zero the gather/repair loop's state — an empty queue + carry buffer + cadence — AND the night
   *  combat stepper's transient state, the night-posture movement state, and the day/night handoff
   *  tracker. Called on (re)spawn and on the DEV scenario reset so a fresh companion never inherits a
   *  prior run's haul, order, pending strike, follow/refuel target, or applied phase. */
  private resetGatherState(): void {
    this.queue.clear();
    this.carryBuf = { wood: 0, rock: 0 };
    this.chopElapsed = 0;
    this.repairElapsed = 0;
    this.goal = null;
    this.resetCombatState();
    this.appliedPhase = null;
    this.lastFollowTile = null;
    this.refuelStand = null;
    this.refuelElapsed = 0;
    this.lastHearthTile = null;
  }

  /**
   * Tear down the companion + drop it. Called at RUNTIME (the scene/physics world is alive), so
   * `dispose()` — which calls `sprite.destroy()` — is correct here (see class doc). This is the
   * DEV-only scenario reset path (`applyScenario` → `resetWorld`), NOT SHUTDOWN.
   */
  reset(): void {
    if (this.npc) {
      this.npc.dispose();
      this.npc = null;
    }
    this.resetGatherState();
  }

  /**
   * SHUTDOWN: this run's companion is going away with the rest of this manager instance (a fresh
   * CompanionManager is constructed by the next `buildWorld()`) — Phaser's scene teardown + Arcade's
   * World teardown have already destroyed the sprite/body by the time this fires (see class doc). So
   * this just drops the stale reference; it deliberately does NOT call {@link reset}, whose
   * `dispose()`/`sprite.destroy()` is only safe while the scene is alive.
   */
  private destroy(): void {
    this.npc = null;
  }
}

/** Squared tile distance — cheap ordering key for nearest-node selection (no sqrt needed). */
function dist2(a: Cell, b: { col: number; row: number }): number {
  const dc = a.col - b.col;
  const dr = a.row - b.row;
  return dc * dc + dr * dr;
}
