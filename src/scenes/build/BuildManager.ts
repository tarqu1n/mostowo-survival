import Phaser from 'phaser';
import { TILE_SIZE, COLORS, SPAWN_TILE, BASE_ZONE_SIZE } from '../../config';
import { tileKey, worldToTile, snapToTileCenter, tileToWorldCenter } from '../../systems/grid';
import { reachableAdjacent, type Cell, type Dims } from '../../systems/pathfind';
import { ACTIVE_TILESET, resolveTile } from '../../data/tileset';
import { BUILDABLES } from '../../data/buildables';
import { isInBase, baseZoneFromSpawn, type Rect } from '../../systems/base';
import { rowDepthOffset } from '../../systems/mapFormat';
import { ghostTextureFor } from './ghostTexture';
import { runTiles, selectRun, type RunTile, type RunSelection } from '../../systems/buildRun';
import { buildTimeFor } from '../../systems/buildTime';
import type { BuildSite, FacingSpec } from '../../entities/types';
import type { CharacterSprite } from '../../entities/Character';
import type { GameScene } from '../GameScene';

/** Opacity of the Blueprint-Mode snap-grid lines (plan 050 Step 4) — faint, so the grid reads as a
 *  placement aid over the dimmed world without competing with the ghost or the blueprints. */
const SNAP_GRID_ALPHA = 0.22;

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
  /** True if a lit hearth exists — the base-CLAIM is active (plan 039). While false, the bootstrap
   *  `BASE_ZONE` rect governs `baseOnly` placement so the first campfire can be built; while true,
   *  {@link inClaim} governs. Scene closure over CampfireBehavior.hasLitHearth. */
  hasLitClaim(): boolean;
  /** True if tile (col,row)'s centre lies inside a lit hearth's **bright core** — the fire-heart base
   *  claim (plan 039). Scene closure converting the tile centre to world-px and calling
   *  CampfireBehavior.inClaim; fires only, never the player's render light (decision #7). */
  inClaim(col: number, row: number): boolean;
  /** Can the player afford `cost` right now? (updateGhost's valid/invalid tint + the placement gate). */
  canAfford(cost: Record<string, number>): boolean;
  /** Current held-item counts (an `Inventory` snapshot) — the pending-run selector's cumulative-cost
   *  affordability walk needs quantities, not just the single-cost yes/no `canAfford` gives (plan 050
   *  Step 5). */
  heldCounts(): Record<string, number>;
  /** Spend `cost`; false (no-op) if unaffordable. */
  spend(cost: Record<string, number>): boolean;
  /** Append a build order for a site to the task queue. */
  enqueueBuild(siteId: string): void;
  /** Hand a just-completed *live/simulated* buildable's site to its runtime manager to create the
   *  visual (e.g. StructureManager.materialise). Called only for buildables with a `behavior`; buildables
   *  without one take the static-tile path instead. */
  materialiseBuildable(site: BuildSite): void;
  /** Recompute the path to the active goal after the world changed (finishSite: a buildable completed). */
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

  /** Which `BUILDABLES` entry the palette has selected — placement/ghost/cost all key off it.
   *  Defaults to `'wall'` so pre-palette behaviour (and the wall e2e) is unchanged; `reset()` restores
   *  it (so a `tryPlaceAt` after a campfire selection can't leak `'campfire'` into a later scenario). */
  private selectedBuildableId = 'wall';

  /** Placement facing for the next `orientable` buildable (the wall), cycled by {@link rotatePlacement}
   *  (plan 037). Reset to `'down'` on {@link select} + {@link reset} so a fresh selection/scenario
   *  starts front-facing; ignored for non-orientable buildables (createBlueprint stamps undefined). */
  private placeFacing: FacingSpec = 'down';

  private readonly walls: Phaser.Physics.Arcade.StaticGroup;
  /** The pre-placement placement cursor — a real structure sprite (plan 050 Step 2) textured from the
   *  selected buildable's in-world art, oriented to {@link placeFacing}, tinted valid/invalid. */
  private readonly ghost: Phaser.GameObjects.Sprite;
  /** Blueprint-Mode tile-snap grid (plan 050 Step 4) — a world-space Graphics redrawn each frame while
   *  build mode is active ({@link syncSnapGrid}), spanning only the camera view so it stays aligned as
   *  the camera follows the player; hidden/cleared on build-mode exit. Demolish never enters build mode,
   *  so it shows no grid. */
  private readonly snapGrid: Phaser.GameObjects.Graphics;
  /** Blueprint-Mode **pending run** (plan 050 Step 5) — the anchor a drag started from and the ordered,
   *  axis-locked tile line it currently spans ({@link runTiles}); `null`/empty when no run is in flight.
   *  Pure model only this step: it spends nothing and creates no blueprint (Step 7 commits it). Cleared
   *  on mode exit / selection change / reset. */
  private runAnchor: Cell | null = null;
  private pendingTiles: RunTile[] = [];
  /** Ghost-sprite pool for rendering the pending run — one Step-2-style textured ghost per pending tile,
   *  grown on demand and hidden (not destroyed) when the run shrinks/clears, mirroring the single
   *  {@link ghost}. Destroyed with the manager in {@link destroy}. */
  private readonly runGhosts: Phaser.GameObjects.Sprite[] = [];
  private readonly occupied = new Set<string>();
  private sites: BuildSite[] = [];
  private readonly siteTiles = new Set<string>();
  private nextSiteId = 0;

  /**
   * The base zone rect, computed once from config (plan 018 A8). Config-computed rather than
   * threaded in as a dep: GameScene's BuildManagerDeps construction is owned by a later, concurrent
   * plan step (A11) that this step must not touch, so adding a required new dep here would leave
   * GameScene not compiling. This keeps that call site untouched; A11 can swap it for a threaded dep
   * later if the rect needs to vary at runtime (e.g. a claimed/movable base).
   */
  private readonly baseZoneRect: Rect = baseZoneFromSpawn(SPAWN_TILE, BASE_ZONE_SIZE);

  constructor(
    private readonly scene: GameScene,
    private readonly deps: BuildManagerDeps,
  ) {
    // Walls: static bodies the player collides with (a backstop; pathing already avoids them).
    this.walls = scene.physics.add.staticGroup();
    scene.physics.add.collider(deps.getPlayerSprite(), this.walls);

    // Build ghost — a structure sprite, hidden until build mode; textured from the selected buildable
    // + placeFacing and tinted valid/invalid as it tracks the tapped tile. Starts on a neutral frame,
    // then applyGhostAppearance() points it at the default selection (the wall, facing down).
    this.ghost = scene.add.sprite(0, 0, '__WHITE').setVisible(false).setDepth(6);
    this.applyGhostAppearance();

    // Snap grid — sits just under the ghost (depth 6) and above the world/blueprints, hidden until
    // build mode. Redrawn per-frame by syncSnapGrid() (the scene's update() drives it).
    this.snapGrid = scene.add.graphics().setDepth(5).setVisible(false);

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

  /** True if the *selected* buildable can be blueprinted here: in bounds, inside the base claim (if
   *  the buildable is `baseOnly`), empty, off live blocking nodes, and reachable. */
  tilePlaceable(col: number, row: number): boolean {
    const dims = this.deps.dims();
    if (col < 0 || row < 0 || col >= dims.cols || row >= dims.rows) return false;
    // Base-claim restriction for `baseOnly` buildables (e.g. the campfire); walls place anywhere.
    // The claim IS the fire-heart's lit bright core (plan 039): once a hearth is lit, placement is
    // confined to `inClaim`. Bootstrap — while NO hearth is lit (before the first fire exists), fall
    // back to the fixed `BASE_ZONE` rect so that first `baseOnly` campfire can still be placed.
    if (BUILDABLES[this.selectedBuildableId].baseOnly) {
      const claimed = this.deps.hasLitClaim()
        ? this.deps.inClaim(col, row)
        : isInBase(this.baseZoneRect, col, row);
      if (!claimed) return false;
    }
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
    const ok =
      this.tilePlaceable(col, row) &&
      this.deps.canAfford(BUILDABLES[this.selectedBuildableId].cost);
    // Keep the sprite's texture/frame + flip in step with the current selection + placeFacing (the
    // orientable wall re-orients as build:rotate fires), then track/tint the tile under the pointer.
    this.applyGhostAppearance();
    this.ghost
      .setPosition(snapToTileCenter(pointer.worldX), snapToTileCenter(pointer.worldY))
      .setTint(ok ? COLORS.ghostValid : COLORS.ghostInvalid)
      .setAlpha(0.5)
      .setVisible(true);
  }

  /** Point the ghost sprite at the selected buildable's in-world texture for the current
   *  {@link placeFacing}: set its texture/frame, orientation flip, bottom-anchor, and tile-scaled size
   *  ({@link ghostTextureFor} — the wall reuses the barricade orient/flip mapping the placed wall
   *  renders from, so the two can't drift). Called on construction and whenever the selection or facing
   *  changes (select/rotate/reset) plus each {@link updateGhost}; leaves visibility/position/tint alone.
   *  Falls back to a neutral tile square if the buildable's texture isn't resident (shouldn't happen —
   *  PreloadScene loads every structure texture). */
  private applyGhostAppearance(): void {
    this.applyAppearanceTo(this.ghost, this.placeFacing);
  }

  /** Texture a ghost sprite (the hover {@link ghost} or a {@link runGhosts} pool sprite) as the selected
   *  buildable's in-world art for `facing`: texture/frame, orient flip, bottom-anchor + tile-scaled size
   *  ({@link ghostTextureFor}). Leaves position/tint/alpha/visibility to the caller. Shared so the single
   *  hover ghost and every pending-run ghost can't drift (plan 050 Step 5). */
  private applyAppearanceTo(sprite: Phaser.GameObjects.Sprite, facing: FacingSpec): void {
    const tex = ghostTextureFor(this.scene, this.selectedBuildableId, facing);
    if (!tex) {
      sprite
        .setTexture('__WHITE')
        .setOrigin(0.5)
        .setFlipX(false)
        .setDisplaySize(TILE_SIZE, TILE_SIZE);
      return;
    }
    if (tex.frame !== undefined) sprite.setTexture(tex.key, tex.frame);
    else sprite.setTexture(tex.key);
    sprite
      .setOrigin(0.5, tex.originY)
      .setFlipX(tex.flipX)
      .setScale((TILE_SIZE * tex.tilesTall) / sprite.frame.height);
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

    this.tryPlaceAt(col, row);
  }

  /**
   * Place the *selected* buildable at a tile if allowed + affordable: runs the real {@link
   * tilePlaceable} gate (incl. the base-zone check), spends its cost, blueprints it, and enqueues the
   * build. Returns whether a site was placed. Pointer-free so the DEV-only test API can drive it
   * directly (the "blocked outside base" seam). Does NOT handle the "tap an existing blueprint"
   * re-enqueue case — that stays in {@link placeOrEnqueueBuild}.
   */
  tryPlaceAt(col: number, row: number): boolean {
    if (!this.tilePlaceable(col, row)) return false;
    if (!this.deps.spend(BUILDABLES[this.selectedBuildableId].cost)) return false; // unaffordable — no-op
    const site = this.createBlueprint(col, row);
    this.deps.enqueueBuild(site.id);
    return true;
  }

  // --- Pending run (plan 050 Step 5) -----------------------------------------

  /** Start a pending run at `anchor` — a length-1 run (just the anchor) until {@link extendRun} grows it.
   *  Renders the anchor as a Step-2 ghost. No spend, no blueprint (Step 7 commits). */
  beginRun(anchor: Cell): void {
    this.runAnchor = anchor;
    this.pendingTiles = runTiles(anchor, anchor, this.runFacing());
    this.refreshRunGhosts();
    this.emitRunChanged();
  }

  /** Grow/redraw the pending run out to `tile`: recomputes the axis-locked straight line from the anchor
   *  ({@link runTiles} — dominant axis vs anchor, inherently deduped). No-op-safe before a {@link beginRun}
   *  (treats `tile` as a fresh anchor). Pure re-projection each call, so a drag that jitters back over
   *  earlier tiles never duplicates. No spend, no blueprint. */
  extendRun(tile: Cell): void {
    if (!this.runAnchor) {
      this.beginRun(tile);
      return;
    }
    this.pendingTiles = runTiles(this.runAnchor, tile, this.runFacing());
    this.refreshRunGhosts();
    this.emitRunChanged();
  }

  /** Drop the pending run + hide its ghost pool (kept for reuse, not destroyed). Called on mode
   *  exit / selection change / reset, by {@link commitRun} once a run commits, and by the HUD Cancel
   *  (`build:cancelRun`). Emits an empty tally so the HUD commit bar hides. */
  clearRun(): void {
    this.runAnchor = null;
    this.pendingTiles = [];
    for (const g of this.runGhosts) g.setVisible(false);
    this.emitRunChanged();
  }

  /**
   * Commit the pending run (plan 050 Step 7): blueprint + enqueue-build the run's VALID subset — each
   * tile in the affordable PREFIX ({@link runSelection}'s `affordableCount`) that is ALSO placeable —
   * spending its cost per tile through the shared `Inventory`, then {@link clearRun}. No-op on an empty
   * run (Confirm on nothing). Building only the affordable-prefix∩placeable tiles matches the ghost
   * preview's valid tint (see {@link refreshRunGhosts}), so a commit places exactly what the run showed
   * as buildable and inventory drops by exactly that subset's cumulative cost. Build orders APPEND
   * (`ORDER_META.build.dedupeOnEnqueue === false`), so a run batches cleanly behind any existing work.
   */
  commitRun(): void {
    if (this.pendingTiles.length === 0) return; // Confirm no-ops on an empty run
    const cost = BUILDABLES[this.selectedBuildableId].cost;
    const { affordableCount } = this.runSelection();
    for (let i = 0; i < this.pendingTiles.length && i < affordableCount; i++) {
      const t = this.pendingTiles[i];
      if (!this.tilePlaceable(t.col, t.row)) continue; // skip a non-placeable tile inside the affordable prefix
      if (!this.deps.spend(cost)) break; // budget exhausted (shouldn't happen within the prefix) — stop
      const site = this.createBlueprint(t.col, t.row);
      this.deps.enqueueBuild(site.id);
    }
    this.clearRun();
  }

  /** Emit `build:runChanged` with the current pending-run tally so the HUD commit bar (plan 050 Step 7)
   *  renders the live count/cost/ETA. Called on every run mutation (begin/extend/clear/commit) and once
   *  per (re)start by GameScene's HUD resync. Lean payload — counts + the affordable subset's cost/ETA,
   *  not the tile array — so the emit stays cheap even mid-drag. */
  emitRunChanged(): void {
    const sel = this.runSelection();
    this.scene.game.events.emit('build:runChanged', {
      tileCount: sel.tiles.length,
      placeableCount: sel.placeableCount,
      affordableCount: sel.affordableCount,
      totalCost: sel.totalCost,
      etaMs: sel.etaMs,
    });
  }

  /**
   * The Step-5 pending-run selector: `{ tiles, placeableCount, affordableCount, totalCost, etaMs }` for
   * the current run — delegating the math to the pure {@link selectRun}, fed this manager's live
   * {@link tilePlaceable} per tile, the selected buildable's cost, the {@link BuildManagerDeps.heldCounts}
   * inventory snapshot, and its {@link buildTimeFor} time. Read-only (no spend); consumed by Step 7's
   * commit + HUD.
   */
  runSelection(): RunSelection {
    const def = BUILDABLES[this.selectedBuildableId];
    const placeable = this.pendingTiles.map((t) => this.tilePlaceable(t.col, t.row));
    return selectRun({
      tiles: this.pendingTiles,
      placeable,
      cost: def.cost,
      inventory: this.deps.heldCounts(),
      buildTimeMs: buildTimeFor(def),
    });
  }

  /** The placement facing to stamp on each run tile — the current {@link placeFacing} only for an
   *  orientable buildable (the wall), else undefined (matching {@link createBlueprint}). */
  private runFacing(): FacingSpec | undefined {
    return BUILDABLES[this.selectedBuildableId].orientable ? this.placeFacing : undefined;
  }

  /** Redraw the ghost pool to the current {@link pendingTiles}: one Step-2-style textured ghost per tile,
   *  tinted valid up to `affordableCount` (and only where placeable), invalid beyond — the single tile
   *  being the length-1 case. Grows the pool on demand; hides surplus sprites. */
  private refreshRunGhosts(): void {
    const def = BUILDABLES[this.selectedBuildableId];
    const placeable = this.pendingTiles.map((t) => this.tilePlaceable(t.col, t.row));
    const { affordableCount } = selectRun({
      tiles: this.pendingTiles,
      placeable,
      cost: def.cost,
      inventory: this.deps.heldCounts(),
      buildTimeMs: buildTimeFor(def),
    });
    while (this.runGhosts.length < this.pendingTiles.length) {
      this.runGhosts.push(this.scene.add.sprite(0, 0, '__WHITE').setVisible(false).setDepth(6));
    }
    for (let i = 0; i < this.runGhosts.length; i++) {
      const g = this.runGhosts[i];
      if (i >= this.pendingTiles.length) {
        g.setVisible(false);
        continue;
      }
      const t = this.pendingTiles[i];
      this.applyAppearanceTo(g, t.facing ?? 'down');
      const valid = i < affordableCount && placeable[i];
      g.setPosition(tileToWorldCenter(t.col), tileToWorldCenter(t.row))
        .setTint(valid ? COLORS.ghostValid : COLORS.ghostInvalid)
        .setAlpha(0.5)
        .setVisible(true);
    }
  }

  /** Palette selected a buildable: remember it + enter build mode. Wired to `build:select` by the
   *  scene; emits `build:modeChanged` so the HUD reflects build mode (mirrors {@link toggleBuild}). */
  select(id: string): void {
    this.selectedBuildableId = id;
    this.placeFacing = 'down'; // a fresh selection starts front-facing (rotate cycles from here)
    this.clearRun(); // a selection change abandons any in-flight run (would re-cost against the new pick)
    this.applyGhostAppearance(); // re-texture the ghost for the newly-selected buildable
    this.buildMode = true;
    this.scene.game.events.emit('build:modeChanged', this.buildMode);
  }

  /** Cycle the placement facing for an `orientable` buildable: down → right → up → left → down (plan
   *  037). Wired to the `build:rotate` game event (the HUD ROTATE button + the R key). No-op visual-wise
   *  for a non-orientable selection — createBlueprint only stamps the facing when the buildable is
   *  orientable, so the extra state is harmless. */
  rotatePlacement(): void {
    const order: FacingSpec[] = ['down', 'right', 'up', 'left'];
    this.placeFacing = order[(order.indexOf(this.placeFacing) + 1) % order.length];
    // Re-orient the ghost now: rotate fires off a button/key, not a pointer move, so updateGhost won't
    // run — refresh here so the wall ghost flips/re-faces immediately (plan 050 Step 2 acceptance).
    this.applyGhostAppearance();
  }

  /** Add a passable, unbuilt blueprint at a tile and register its occupancy (shared by real build
   * placement and the DEV-only scenario API). `buildableId` defaults to the current selection but is
   * passed explicitly by the scenario API (which places walls + campfires regardless of selection).
   * Does NOT spend cost or enqueue — callers do that. */
  createBlueprint(
    col: number,
    row: number,
    buildableId: string = this.selectedBuildableId,
  ): BuildSite {
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
      // Base-row y-sort (plan 029/5b): the blueprint is a placed world object, so a foreground tree
      // occludes it correctly. Placement visibility is the ghost cursor's job, not this rect's.
      .setDepth(1 + rowDepthOffset(row));
    const site: BuildSite = {
      id: `site-${this.nextSiteId++}`,
      buildableId,
      col,
      row,
      rect,
      visual: null,
      progress: 0,
      done: false,
      // Stamp the current rotate facing only for an orientable buildable (the wall); a fixed-orientation
      // buildable leaves it undefined. WallBehavior reads it to render the oriented sprite.
      facing: BUILDABLES[buildableId].orientable ? this.placeFacing : undefined,
    };
    this.sites.push(site);
    this.siteTiles.add(key);
    return site;
  }

  /** Complete a blueprint into its finished structure (materialises on the worker-vacated tile).
   *  Branches on the buildable: a *static* buildable (no `behavior` — the wall) renders a pack sprite
   *  over the hidden rect; a *live/simulated* buildable (`behavior` set — the campfire) hands its
   *  visual to a runtime manager via {@link BuildManagerDeps.materialiseBuildable}. `behavior` (not
   *  `animKey`) is the discriminant — it means "needs a runtime manager", vs `animKey` which is purely
   *  visual. Occupancy + a static collision body are added here for any blocking buildable (this
   *  manager stays the sole pathing/collision writer). */
  finishSite(site: BuildSite): void {
    site.done = true;
    const def = BUILDABLES[site.buildableId];
    // Hide the blueprint square either way — the finished sprite renders on top of the (kept) rect,
    // whose physics body backs the occupancy below.
    site.rect.setAlpha(0);

    // Occupancy + static body for any blocking buildable (missing blocksPath ⇒ true, so the wall
    // keeps blocking). A non-blocking buildable stays passable and off the occupancy set.
    if (def.blocksPath ?? true) {
      this.walls.add(site.rect);
      const body = site.rect.body as Phaser.Physics.Arcade.StaticBody;
      body.setSize(TILE_SIZE, TILE_SIZE);
      body.updateFromGameObject();
      this.occupied.add(tileKey(site.col, site.row));
    }

    if (def.behavior) {
      // Live/simulated buildable (campfire): its runtime manager owns the sprite. Do NOT set
      // site.visual — reset() destroys site.visual, and the manager destroys its own sprite (avoids a
      // double-destroy). The sprite may be animated (def.animKey) — that's the manager's concern now.
      this.deps.materialiseBuildable(site);
    } else {
      // Static-tile buildable. The wall is the only one today; a future static buildable would map its
      // id to a `tiles` role here (`tiles` is a fixed-key manifest, not string-indexable).
      const tile = resolveTile(ACTIVE_TILESET.tiles.wall);
      site.visual = this.scene.add
        .image(site.rect.x, site.rect.y, tile.key, tile.frame)
        // Base-row y-sort (plan 029/5b): the finished wall sorts by its row against trees/other walls.
        .setDepth(1 + rowDepthOffset(site.row));
    }

    this.deps.repath();
  }

  /** Free a completed *live* buildable's tile when its runtime manager removes it (a destroyed wall —
   *  WallBehavior calls this through its `freeTile` dep so BuildManager stays the sole occupancy/collision
   *  writer). Fully retires the finished site: drop its rect from the walls group + destroy it (which
   *  frees the static collision body with it), and clear the occupancy/site-slot keys — so the tile is
   *  passable AND re-placeable again, with no dangling destroyed-rect reference left for `reset()`. */
  releaseTile(col: number, row: number): void {
    const key = tileKey(col, row);
    const idx = this.sites.findIndex((s) => s.done && s.col === col && s.row === row);
    if (idx !== -1) {
      const [site] = this.sites.splice(idx, 1);
      this.walls.remove(site.rect, false, false); // drop from the static group (we destroy the rect next)
      site.visual?.destroy();
      site.rect.destroy(); // frees the attached static body with it
    }
    this.siteTiles.delete(key);
    this.occupied.delete(key);
  }

  /** Flip build-mode; hides the ghost when leaving it. Wired to `game.events` `build:toggle` by the
   *  scene (in), emits `build:modeChanged` (out) — names unchanged from the pre-move scene method. */
  toggleBuild(): void {
    this.buildMode = !this.buildMode;
    if (!this.buildMode) {
      this.ghost.setVisible(false);
      this.clearRun(); // leaving build mode abandons any in-flight run + hides its ghosts
    }
    this.scene.game.events.emit('build:modeChanged', this.buildMode);
  }

  /**
   * Redraw the Blueprint-Mode snap grid — called each frame by the scene's `update()` (plan 050
   * Step 4). Off build mode: clear + hide (a one-shot no-op once already hidden). In build mode: redraw
   * tile-boundary lines spanning ONLY the camera's current world view (culled to the viewport), snapped
   * to `TILE_SIZE` so they line up with the ghost's {@link snapToTileCenter} placement. Redrawing every
   * frame keeps it aligned as the camera follows the player / zooms — the same "sync to a moving
   * camera-space transform each frame" shape TaskGlowRenderer.syncGlowTransforms uses. The camera is
   * bounded to the map (`cameras.main.setBounds`), so the view never spills past the buildable area and
   * no extra map-extent clamp is needed.
   */
  syncSnapGrid(): void {
    if (!this.buildMode) {
      if (this.snapGrid.visible) this.snapGrid.clear().setVisible(false);
      return;
    }
    const view = this.scene.cameras.main.worldView;
    const startX = Math.floor(view.x / TILE_SIZE) * TILE_SIZE;
    const startY = Math.floor(view.y / TILE_SIZE) * TILE_SIZE;
    this.snapGrid.clear().lineStyle(1, COLORS.snapGrid, SNAP_GRID_ALPHA).beginPath();
    for (let x = startX; x <= view.right; x += TILE_SIZE) {
      this.snapGrid.moveTo(x, view.y);
      this.snapGrid.lineTo(x, view.bottom);
    }
    for (let y = startY; y <= view.bottom; y += TILE_SIZE) {
      this.snapGrid.moveTo(view.x, y);
      this.snapGrid.lineTo(view.right, y);
    }
    this.snapGrid.strokePath();
    this.snapGrid.setVisible(true);
  }

  // --- Reset / teardown --------------------------------------------------------

  /** Drop every placed site's GameObjects + this run's build-mode/occupancy state — mirrors what a
   *  fresh create() used to do inline, now on demand for the DEV-only scenario reset (testResetWorld).
   *  The ghost sprite persists across a scenario reset (not destroyed/hidden); its texture is just
   *  re-pointed at the reset wall selection so it can't show a stale prior buildable. */
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
    this.selectedBuildableId = 'wall'; // don't leak a prior campfire selection into a fresh scenario
    this.placeFacing = 'down'; // nor a prior rotate facing (a fresh scenario places walls front-facing)
    this.applyGhostAppearance(); // re-texture the (persisting) ghost back to the reset wall selection
    this.snapGrid.clear().setVisible(false); // buildMode is now false — drop the grid immediately too
    this.clearRun(); // drop any in-flight run + hide its ghost pool (sprites persist like the ghost)
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
    for (const g of this.runGhosts) g.destroy(); // run-ghost pool goes with the ghost (plain sprites, no bodies)
    this.snapGrid.destroy(); // a plain Graphics (no physics body) — safe to drop the stale ref, like the ghost
  }
}
