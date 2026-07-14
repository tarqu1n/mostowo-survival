import Phaser from 'phaser';
import { TILE_SIZE, COLORS } from '../../config';
import { breadcrumb } from '../../debug/crashReporter';
import { NODES } from '../../data/nodes';
import type { ResourceNodeDef } from '../../data/types';
import { tileToWorldCenter } from '../../systems/grid';
import { ACTIVE_TILESET, resolveTile } from '../../data/tileset';
import type { TreeNode } from '../../entities/types';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link ResourceNodeManager} needs but doesn't own — GameScene supplies these as
 * closures over its own private fields/methods at construction (plan 013 Step 6 coupling rules,
 * carried into plan 015: managers get narrow interfaces, not raw field access, and never a direct
 * manager↔manager edge — the scene mediates).
 */
export interface ResourceNodeManagerDeps {
  /** Recompute the path to the active goal after the world changed — a regrown tree/rock may now
   *  re-block the worker's active route (chop's regrow timer fires this the same way a finished wall
   *  does for BuildManager). */
  repath(): void;
  /** Credit the shared inventory with one harvest hit's yield (chop's `this.inv.add(itemId, n)`) —
   *  narrowed to just that one call shape rather than handing over the whole Inventory. */
  addYield(itemId: string, n: number): void;
}

/**
 * Resource nodes — trees, rocks, berry bushes — spawn, harvest (chop), regrow, and the
 * pathfinding/placement "is this tile blocked by a live node" query (plan 015 Step 1). Moved
 * verbatim out of GameScene, which still owns `isBlocked` itself (a composite over this manager's
 * {@link hasBlockingNode} and BuildManager's `isOccupied` — see GameScene's own doc for why that
 * composite can't live in either manager) and the harvest task loop (`beginCurrent`/`runHarvest`),
 * which calls back into this manager's queries/commands instead of touching a `trees` field directly.
 *
 * Constructed fresh in `buildWorld()` each (re)start, at the exact point the old inline `spawnTrees()`
 * call used to run — **before** the player exists (`buildWorld()`'s construction order is
 * load-bearing; see GameScene). The constructor itself must never reach for player state; only
 * call-time closures may. It also does NOT auto-spawn — `spawnTrees()` is a separate call right after
 * construction — so construction stays side-effect-free, matching the "constructor must not touch
 * player" rule with zero risk of the ordering mattering later.
 *
 * **`all()` returns the raw backing array — alive AND dead nodes alike.** `pickSpriteAt`/`isBlocked`/
 * the queue-glow pass each already do their own `if (!t.alive) …` filtering on top, so filtering
 * inside `all()` would silently change what those callers see (a dead/regrowing stump would vanish
 * from hit-testing entirely instead of just being unclickable-while-dead, etc.).
 *
 * **SHUTDOWN vs Arcade physics.** These nodes are plain `Phaser.GameObjects.Image`s with no physics
 * body, so there's no Arcade-World teardown-ordering hazard here the way there is for BuildManager's
 * walls group — but the same discipline still applies: Phaser's own scene teardown has already
 * destroyed every GameObject (these sprites included) by the time this manager's SHUTDOWN listener
 * runs, so `destroy()` below may ONLY drop references / reset plain data. It must NEVER call
 * `sprite.destroy()` itself on the SHUTDOWN path — that's only safe at runtime, via {@link clearAll}
 * (used by the DEV-only scenario reset and the dev-menu world randomiser, both called with the scene
 * very much alive).
 */
export class ResourceNodeManager {
  private trees: TreeNode[] = [];
  private nextTreeId = 0;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: ResourceNodeManagerDeps,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  // --- Spawning ----------------------------------------------------------------

  /** Seed the starting camp cluster: a few trees, rocks, and berry bushes at fixed tiles near the
   *  player spawn (so tests can rely on them being there). */
  spawnTrees(): void {
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
  addNode(def: ResourceNodeDef, col: number, row: number): void {
    const { key, frame } = resolveTile(ACTIVE_TILESET.tiles[def.tile]);
    const sprite = this.scene.add
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
  nodeScale(sprite: Phaser.GameObjects.Image, def: ResourceNodeDef): number {
    return (TILE_SIZE * def.tilesTall) / sprite.frame.height;
  }

  // --- Queries -------------------------------------------------------------------

  /** Every node, alive AND dead (see class doc) — callers filter `alive` themselves. Returns the raw
   *  backing array, not a copy. */
  all(): TreeNode[] {
    return this.trees;
  }

  treeById(id: string): TreeNode | undefined {
    return this.trees.find((t) => t.id === id);
  }

  /** True if a live *blocking* node (tree/rock) occupies (col,row) — the pathfinding/placement veto;
   *  a non-blocking bush (`def.blocksPath === false`) never blocks. */
  hasBlockingNode(col: number, row: number): boolean {
    return this.trees.some((t) => t.alive && t.def.blocksPath && t.col === col && t.row === row);
  }

  // --- Harvesting ------------------------------------------------------------------

  /** Light "bag full" feedback: a brief warning tint on the node (no new HUD text). */
  flashBagFull(tree: TreeNode): void {
    if (!tree.alive) return;
    tree.sprite.setTint(COLORS.ghostInvalid);
    this.scene.time.delayedCall(150, () => {
      if (tree.alive) tree.sprite.clearTint();
    });
  }

  chop(tree: TreeNode): void {
    breadcrumb('node', `chop ${tree.def.id} ${tree.id}`, { hp: tree.hp - 1, alive: tree.alive });
    tree.hp -= 1;
    this.deps.addYield(tree.def.yieldItemId, tree.def.yieldPerHit);
    // Bump relative to the node's fitted base scale (not an absolute 1 — the pine is scaled down).
    // Animate only the node — its queued glow halo mirrors this (and any future sway/fall) each frame
    // via syncGlowTransforms(), so animations never have to drive the glow themselves.
    const base = this.nodeScale(tree.sprite, tree.def);
    this.scene.tweens.add({ targets: tree.sprite, scale: base * 1.18, duration: 80, yoyo: true });
    if (tree.hp <= 0) {
      tree.alive = false;
      breadcrumb('node', `deplete ${tree.def.id} ${tree.id}`, { regrowMs: tree.def.regrowMs });
      // No dedicated depleted sprite in the pack yet (see docs/ASSETS.md) — tint the felled node to
      // its stumpColor as a stand-in "stump"/rubble state rather than a mismatched placeholder rect.
      tree.sprite.setScale(base).setTint(tree.def.stumpColor);
      this.scene.time.delayedCall(tree.def.regrowMs, () => {
        // A delayedCall scheduled here survives clearAll() (which destroys sprites but leaves the
        // scene clock running), so guard against a sprite destroyed during the regrow window — the
        // breadcrumb'd `spriteAlive:false` case is exactly the shape of a use-after-destroy crash.
        breadcrumb('node', `regrow ${tree.def.id} ${tree.id}`, { spriteAlive: tree.sprite.active });
        tree.hp = tree.def.maxHp;
        tree.alive = true;
        tree.sprite.clearTint();
        this.deps.repath(); // regrown tree may now block the active route
      });
    }
  }

  // --- Reset / teardown --------------------------------------------------------------

  /**
   * Destroy every node's sprite and drop it. Called at RUNTIME (the scene/physics world is alive), so
   * `sprite.destroy()` is correct here — this is NOT the SHUTDOWN path (see class doc). `resetIds`
   * governs whether the id counter also resets: the DEV-only scenario reset
   * (`resetTreesAndEnemies` → `clearAll({ resetIds: true })`) wants fresh `tree-0`-style ids each
   * scenario, while the dev-menu world randomiser (`randomiseWorld` → `clearAll({ resetIds: false })`)
   * deliberately keeps the counter running — pre-existing behaviour, preserved as-is.
   */
  clearAll(opts: { resetIds: boolean }): void {
    breadcrumb('world', 'clearAll (destroys node sprites)', {
      count: this.trees.length,
      resetIds: opts.resetIds,
    });
    for (const t of this.trees) t.sprite.destroy();
    this.trees = [];
    if (opts.resetIds) this.nextTreeId = 0;
  }

  /**
   * SHUTDOWN: this run's nodes are going away with the rest of this manager instance (a fresh
   * ResourceNodeManager is constructed by the next `buildWorld()`) — Phaser's own scene teardown
   * already destroys every GameObject on a death-restart, so this just drops the stale references.
   * Deliberately does NOT call {@link clearAll} here (see its own doc + this class's SHUTDOWN-vs-
   * Arcade-physics note): that method's `sprite.destroy()` calls are only safe while the scene/physics
   * world is alive, which it no longer is by the time SHUTDOWN fires.
   */
  private destroy(): void {
    this.trees = [];
  }
}
