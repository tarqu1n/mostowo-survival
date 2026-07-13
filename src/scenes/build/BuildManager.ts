import Phaser from 'phaser';
import { TILE_SIZE, COLORS } from '../../config';
import { tileKey, worldToTile, snapToTileCenter, tileToWorldCenter } from '../../systems/grid';
import { reachableAdjacent, type Cell, type Dims } from '../../systems/pathfind';
import { ACTIVE_TILESET, resolveTile } from '../../data/tileset';
import type { BuildSite } from '../../entities/types';
import type { CharacterSprite } from '../../entities/Character';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link BuildManager} needs but doesn't own — GameScene supplies these as
 * closures over its own private fields/methods at construction (plan 013 Step 6 coupling rules:
 * managers get narrow interfaces, not raw field access). `isBlocked` is the scene's pathfinding
 * predicate (it in turn reads BuildManager's own {@link BuildManager.isOccupied} — a scene-mediated
 * loop, not a manager↔manager edge: the scene wires both sides).
 */
export interface BuildManagerDeps {
  /** The live player sprite — the wall/player Arcade collider is wired against it at construction. */
  getPlayerSprite(): CharacterSprite;
  /** The worker's current tile — tilePlaceable's reachableAdjacent (stand-tile) check keys off this. */
  playerTile(): Cell;
  /** Pathfinding walkability predicate (the scene's `isBlocked`) — reachableAdjacent's obstacle test
   *  when checking whether a blueprint has a tile the worker could stand on to build it. */
  isBlocked(col: number, row: number): boolean;
  /** True if a live *blocking* node (tree/rock) occupies (col,row) — tilePlaceable's veto; a
   *  non-blocking bush can be built over. */
  hasBlockingTree(col: number, row: number): boolean;
  /** Grid bounds for tilePlaceable's in-bounds check. */
  dims(): Dims;
  /** Can the player afford one wall's cost right now? (updateGhost's valid/invalid tint). */
  canAffordWall(): boolean;
  /** Spend one wall's cost; false (no-op) if unaffordable. */
  spendWallCost(): boolean;
  /** Append a build order for a site to the task queue. */
  enqueueBuild(siteId: string): void;
  /** Recompute the path to the active goal after the world changed (finishSite: a wall completed). */
  repath(): void;
}

/**
 * Build placement + blueprint/wall lifecycle (plan 013 Step 6) — moved verbatim out of GameScene.
 * Owns build-mode state, the placement ghost, every placed site (blueprint or finished wall), tile
 * occupancy, and the walls physics group. Constructed fresh in `create()` each (re)start (like
 * `PointerInputController` — its constructor builds real GameObjects, which need `scene.add`/
 * `scene.physics` not yet wired when GameScene's own field initializers run); wires its own SHUTDOWN
 * teardown directly (`scene.events`/`scene.physics`/`scene.add` are already live by the time
 * `create()` runs, same reasoning as the pointer controller — no `armShutdown()` split needed).
 */
export class BuildManager {
  /** Whether build-mode placement currently owns the pointer (ghost tracking + place/enqueue). */
  buildMode = false;

  private readonly walls: Phaser.Physics.Arcade.StaticGroup;
  private readonly ghost: Phaser.GameObjects.Rectangle;
  private readonly occupied = new Set<string>();
  private sites: BuildSite[] = [];
  private readonly siteTiles = new Set<string>();
  private nextSiteId = 0;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: BuildManagerDeps,
  ) {
    // Walls: static bodies the player collides with (a backstop; pathing already avoids them).
    this.walls = scene.physics.add.staticGroup();
    scene.physics.add.collider(deps.getPlayerSprite(), this.walls);

    // Build ghost — hidden until build mode; recoloured valid/invalid as it tracks the tapped tile.
    this.ghost = scene.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE, COLORS.ghostValid, 0.5)
      .setVisible(false)
      .setDepth(6);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  // --- Queries --------------------------------------------------------------

  /** True if (col,row) is a completed (blocking) wall's tile. */
  isOccupied(col: number, row: number): boolean {
    return this.occupied.has(tileKey(col, row));
  }

  /** True if (col,row) already carries a placed site (blueprint or built) — occupies the *slot*,
   *  whether or not it blocks pathing yet. */
  hasSiteTile(col: number, row: number): boolean {
    return this.siteTiles.has(tileKey(col, row));
  }

  /** Count of completed-wall tiles (debugState's `occupied`). */
  occupiedCount(): number {
    return this.occupied.size;
  }

  /** Count of placed sites, built + unbuilt (debugState's `sites`). */
  siteCount(): number {
    return this.sites.length;
  }

  /** Every placed site (built + unbuilt), in placement order — read by TaskGlowRenderer's queue-
   *  highlight pass and the scene's pointer-pick raycast. */
  allSites(): readonly BuildSite[] {
    return this.sites;
  }

  siteById(id: string): BuildSite | undefined {
    return this.sites.find((s) => s.id === id);
  }

  siteAt(col: number, row: number): BuildSite | undefined {
    return this.sites.find((s) => !s.done && s.col === col && s.row === row);
  }

  // --- Placement --------------------------------------------------------------

  /** True if a wall can be blueprinted here: in bounds, empty, off live blocking nodes, and reachable. */
  tilePlaceable(col: number, row: number): boolean {
    const dims = this.deps.dims();
    if (col < 0 || row < 0 || col >= dims.cols || row >= dims.rows) return false;
    if (this.isOccupied(col, row) || this.hasSiteTile(col, row)) return false;
    // Only blocking nodes (trees/rocks) veto placement — a non-blocking bush can be built over.
    if (this.deps.hasBlockingTree(col, row)) return false;
    // Must have a tile the worker can stand on to build it (Finding 4 — no stranded blueprints).
    return (
      reachableAdjacent(this.deps.playerTile(), { col, row }, this.deps.isBlocked, dims) !== null
    );
  }

  updateGhost(pointer: Phaser.Input.Pointer): void {
    const col = worldToTile(pointer.worldX);
    const row = worldToTile(pointer.worldY);
    const ok = this.tilePlaceable(col, row) && this.deps.canAffordWall();
    this.ghost
      .setPosition(snapToTileCenter(pointer.worldX), snapToTileCenter(pointer.worldY))
      .setFillStyle(ok ? COLORS.ghostValid : COLORS.ghostInvalid, 0.5)
      .setVisible(true);
  }

  placeOrEnqueueBuild(pointer: Phaser.Input.Pointer): void {
    const col = worldToTile(pointer.worldX);
    const row = worldToTile(pointer.worldY);

    // Tapping an existing un-built blueprint re-enqueues its build (Cancel is non-destructive).
    const existing = this.siteAt(col, row);
    if (existing) {
      this.deps.enqueueBuild(existing.id);
      return;
    }

    if (!this.tilePlaceable(col, row)) return;
    if (!this.deps.spendWallCost()) return; // unaffordable — no-op

    const site = this.createBlueprint(col, row);
    this.deps.enqueueBuild(site.id);
  }

  /** Add a passable, unbuilt blueprint at a tile and register its occupancy (shared by real build
   * placement and the DEV-only scenario API). Does NOT spend wood or enqueue — callers do that. */
  createBlueprint(col: number, row: number): BuildSite {
    const key = tileKey(col, row);
    const rect = this.scene.add
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
  finishSite(site: BuildSite): void {
    site.done = true;
    // Physics body stays on the (now-hidden) rect; the pack's wall sprite renders on top of it.
    site.rect.setAlpha(0);
    const wall = resolveTile(ACTIVE_TILESET.tiles.wall);
    site.visual = this.scene.add.image(site.rect.x, site.rect.y, wall.key, wall.frame).setDepth(1);
    this.walls.add(site.rect);
    const body = site.rect.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(TILE_SIZE, TILE_SIZE);
    body.updateFromGameObject();
    this.occupied.add(tileKey(site.col, site.row));
    this.deps.repath();
  }

  /** Flip build-mode; hides the ghost when leaving it. Wired to `game.events` `build:toggle` by the
   *  scene (in), emits `build:modeChanged` (out) — names unchanged from the pre-move scene method. */
  toggleBuild(): void {
    this.buildMode = !this.buildMode;
    if (!this.buildMode) this.ghost.setVisible(false);
    this.scene.game.events.emit('build:modeChanged', this.buildMode);
  }

  // --- Reset / teardown --------------------------------------------------------

  /** Drop every placed site's GameObjects + this run's build-mode/occupancy state — mirrors what a
   *  fresh create() used to do inline, now on demand for the DEV-only scenario reset (testResetWorld).
   *  Does NOT touch the ghost — it persists across a scenario reset, same as before this move. */
  reset(): void {
    for (const s of this.sites) {
      s.visual?.destroy();
      s.rect.destroy();
    }
    this.walls.clear(false, false); // drop the (now-destroyed) wall-rect refs; children handled above
    this.sites = [];
    this.siteTiles.clear();
    this.occupied.clear();
    this.nextSiteId = 0;
    this.buildMode = false;
  }

  /**
   * SHUTDOWN: this run's ghost is going away with the rest of this manager instance (a fresh
   * BuildManager + ghost are constructed by the next create()) — Phaser's own scene teardown already
   * destroys every GameObject on a death-restart, so this just drops the stale ghost reference.
   * Deliberately does NOT call {@link reset} here: `reset()`'s `walls.clear()` touches the Arcade
   * physics World's own bookkeeping, which has ALREADY torn itself down by the time this fires —
   * Arcade's World listens for the scene's SHUTDOWN too, registered once when the physics plugin
   * boots (long before this manager's own listener, re-added fresh every create()), so its handler
   * always runs first, and `walls.clear()` afterwards throws (`children` is already undefined). The
   * sites/occupancy bookkeeping needs no explicit reset either — the next create() constructs a
   * brand-new BuildManager whose fields start fresh; this instance is simply discarded. `reset()`
   * itself stays exactly as-is for its other caller, the DEV-only scenario reset (testResetWorld),
   * where the physics world is very much alive.
   */
  private destroy(): void {
    this.ghost.destroy();
  }
}
