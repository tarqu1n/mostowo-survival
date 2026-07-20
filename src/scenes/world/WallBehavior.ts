import Phaser from 'phaser';
import { TILE_SIZE, DECONSTRUCT_REFUND_FRACTION } from '../../config';
import { tileToWorldCenter } from '../../systems/grid';
import { rowDepthOffset } from '../../systems/mapFormat';
import { BUILDABLES } from '../../data/buildables';
import { barricadeBuildKey, barricadeDestroyKey, type Facing } from '../../data/tileset';
import { placedWallStats } from '../../systems/stats';
import type { InspectableStats } from '../../data/types';
import type { WallStructure, BuildSite, FacingSpec, PlacedStructure } from '../../entities/types';
import type { GameScene } from '../GameScene';
import type { StructureBehavior } from './StructureManager';

/** Default bottom-anchor + height (in tiles) the barricade sprite scales to when the buildable omits
 *  them — the wall sets `originY`/`tilesTall` in data (see buildables.ts). Chosen so the visible stake
 *  palisade (~23px of art at the bottom of the 64px frame) reads about one tile tall on its footprint. */
const WALL_ORIGIN_Y = 0.95;
const WALL_TILES_TALL = 3;

/**
 * Narrow scene state {@link WallBehavior} needs but doesn't own — GameScene supplies these as closures
 * over its own fields at construction (plan 013/015 coupling rules: modules get narrow interfaces, not
 * raw field access). BuildManager stays the sole occupancy/collision writer, so a destroyed wall frees
 * its tile back through {@link freeTile} rather than this module touching the walls group directly.
 */
export interface WallBehaviorDeps {
  /** Free a completed wall's occupied tile + collision body (BuildManager.releaseTile) when it's destroyed. */
  freeTile(col: number, row: number): void;
  /** Recompute the active path after a wall was removed (the tile just opened up). */
  repath(): void;
  /** Credit a deconstruct's partial refund back to the inventory (mirrors CampfireBehaviorDeps.spend's
   *  decoupling — WallBehavior never touches the raw Inventory). Called only from {@link deconstruct}. */
  addItems(items: Record<string, number>): void;
}

/**
 * Barricade walls — the second live/destructible buildable (plan 037 chunk 2a), a {@link StructureBehavior}
 * module in the StructureManager registry alongside {@link CampfireBehavior}. It owns the wall collection
 * and each wall's ONE oriented sprite ({@link PlacedStructure.sprite}), so it is the sole writer of that
 * sprite's anim/frame and its sole destroyer. A wall is created by {@link materialise} when its build
 * site completes (routed from `BuildManager.finishSite` via the scene → `StructureManager.materialise`
 * dispatch on `def.behavior` — BuildManager still owns the site rect + its occupancy/collision body,
 * this module owns only the visual + hp).
 *
 * {@link materialise} plays the orientation's Build anim once, then settles on the intact idle frame
 * (Destroy sheet frame 0). {@link takeDamage} lowers hp and steps the Destroy sheet toward rubble; at
 * `hp <= 0` it plays the Destroy anim through, then removes the wall (frees its tile via the dep +
 * repaths). The enemy attack path (chunk 2c) drives {@link takeDamage} + consumes {@link thornsOf}; the
 * DEV test seam drives it too.
 *
 * Constructed fresh in `buildWorld()` each (re)start and registered under `'wall'`. Event-driven — no
 * per-frame tick (walls have no fuel), so it omits {@link StructureBehavior.tick}/`lightSources`.
 *
 * **SHUTDOWN vs plain GameObjects — the same trap as CampfireBehavior.** The wall sprites are plain
 * animated Sprites (no Arcade body — BuildManager owns the collision body). Phaser's own scene teardown
 * destroys every GameObject BEFORE StructureManager fans {@link destroy} out (a fresh module is built by
 * the next `buildWorld()`). So {@link destroy} may **only drop references** — never call
 * `sprite.destroy()` on the SHUTDOWN path. That differs from {@link reset}, which runs at RUNTIME
 * (scene alive) where `sprite.destroy()` IS correct — the DEV-only scenario reset.
 */
export class WallBehavior implements StructureBehavior {
  private walls: WallStructure[] = [];
  private nextId = 0;
  /** Sprites mid-Destroy-anim after their wall left {@link walls} — held only so {@link reset} can free
   *  them if a scenario reset lands before the anim's completion callback destroys them (RUNTIME path). */
  private dying: Phaser.GameObjects.Sprite[] = [];

  constructor(
    private readonly scene: GameScene,
    private readonly deps: WallBehaviorDeps,
  ) {}

  // --- Lifecycle -----------------------------------------------------------------

  /** Turn a completed wall build site into a live barricade: one bottom-anchored, oriented sprite at
   *  the tile that plays its Build anim once, then settles on the intact idle frame (Destroy frame 0).
   *  LEFT facing reuses the `side` sheet flipped. Starts at full hp. */
  materialise(site: BuildSite): void {
    const def = BUILDABLES[site.buildableId];
    const facing: FacingSpec = site.facing ?? 'down';
    const orient = orientOf(facing);
    const x = tileToWorldCenter(site.col);
    const y = tileToWorldCenter(site.row);
    const originY = def.originY ?? WALL_ORIGIN_Y;
    const tilesTall = def.tilesTall ?? WALL_TILES_TALL;

    // Base-row y-sort (plan 029/5b): the wall sorts as one row against trees/other structures, so a
    // tree in front draws over it and one behind draws under it (mirrors the campfire base).
    const buildKey = barricadeBuildKey(orient);
    const destroyKey = barricadeDestroyKey(orient);
    const sprite = this.scene.add
      .sprite(x, y, buildKey)
      .setDepth(1 + rowDepthOffset(site.row))
      .setOrigin(0.5, originY)
      .setFlipX(facing === 'left');
    sprite.setScale((TILE_SIZE * tilesTall) / sprite.frame.height);
    sprite.play(buildKey);
    // On the Build anim's completion, settle on the Destroy sheet's frame 0 — the intact standing
    // barricade, identical to the Build strip's last frame — so the idle render + the HP-stage hook
    // (which steps the SAME Destroy sheet) share one texture. Guard the sprite (scenario reset may
    // have destroyed it before the anim finished).
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (!sprite.active) return;
      sprite.stop();
      sprite.setTexture(destroyKey, 0);
    });

    this.walls.push({
      id: `wall-${this.nextId++}`,
      buildableId: site.buildableId,
      behavior: 'wall',
      col: site.col,
      row: site.row,
      sprite,
      state: { facing, hp: def.maxHp, maxHp: def.maxHp },
    });
  }

  // --- Damage (mob attacks lower hp; chunk 2c wires the enemy) --------------------

  /** Lower a wall's hp by `amount` and reflect it: below full hp, step the Destroy sheet's frame toward
   *  rubble (`round((1 - hp/maxHp) * 5)`, clamped 0..5 — frame 0 = intact, 5 = rubble); at `hp <= 0`
   *  play the Destroy anim through, then remove the wall (free its tile + collision via the dep, and
   *  repath). Returns whether this blow destroyed it. No-op (returns false) if `id` is unknown —
   *  tolerates a wall removed mid-attack, like {@link wallById}'s consumers. */
  takeDamage(id: string, amount: number): boolean {
    const w = this.wallById(id);
    if (!w) return false;
    w.state.hp = Math.max(0, w.state.hp - amount);
    if (w.state.hp <= 0) {
      this.destroyWall(w);
      return true;
    }
    this.applyDamageStage(w);
    return false;
  }

  /** Thorns (retaliation damage) a mob takes when it attacks this wall — the buildable's `thorns` (0 if
   *  none). Consumed by chunk 2c's enemy-attack path; undefined id → 0 (tolerates a wall gone mid-tick). */
  thornsOf(id: string): number {
    const w = this.wallById(id);
    if (!w) return 0;
    return BUILDABLES[wallBuildableId(w)].thorns ?? 0;
  }

  /** Player deconstruct/unbuild (plan 037 chunk 2b, decision #6): remove a finished wall and CREDIT a
   *  partial refund (`floor(cost × DECONSTRUCT_REFUND_FRACTION)` of each resource in the buildable's
   *  `cost`; wall `{ wood: 2 }` → 1 wood) back to the inventory via the {@link WallBehaviorDeps.addItems}
   *  dep. Unlike the mob-kill {@link destroyWall} path, this is a CLEAN removal — no Destroy crumble
   *  anim (a deliberate player unbuild, not a combat kill) — and it refunds (a kill does not). Shares
   *  the tile-free/repath teardown with destroy via {@link retireWall}. Returns whether a wall was
   *  removed; no-op (false) if `id` is unknown (a wall gone mid-order — tolerated, like {@link takeDamage}).
   *  Driven by the GameScene `deconstruct` worker order once the worker stands adjacent. */
  deconstruct(id: string): boolean {
    const w = this.wallById(id);
    if (!w) return false;
    this.deps.addItems(refundFor(wallBuildableId(w)));
    this.retireWall(w);
    if (w.sprite.active) w.sprite.destroy(); // clean removal — no crumble anim (see doc)
    return true;
  }

  /** Show the damage-stage frame for a wall's current hp (Destroy sheet, frame 0 intact → 5 rubble). */
  private applyDamageStage(w: WallStructure): void {
    const frame = Phaser.Math.Clamp(Math.round((1 - w.state.hp / w.state.maxHp) * 5), 0, 5);
    w.sprite.stop(); // in case the Build anim is somehow still playing — the HP-stage frame is authoritative
    w.sprite.setTexture(barricadeDestroyKey(orientOf(w.state.facing)), frame);
  }

  /** Free a wall's tile + collision (via {@link WallBehaviorDeps.freeTile}, BuildManager the sole writer)
   *  NOW so pathing/occupancy open immediately, drop it from the collection, and repath. Shared by
   *  {@link destroyWall} (mob kill — then crumbles) and {@link deconstruct} (player unbuild — then a
   *  clean removal); the caller owns the sprite teardown, since the two differ (crumble anim vs vanish). */
  private retireWall(w: WallStructure): void {
    this.deps.freeTile(w.col, w.row);
    this.deps.repath();
    this.walls = this.walls.filter((x) => x !== w);
  }

  /** Remove a destroyed wall (mob kill): free its tile NOW (so pathing/occupancy open immediately and
   *  the mob can repath through as it crumbles), drop it from the collection, then play the Destroy anim
   *  through and self-destroy the sprite on completion (tracked in {@link dying} so a scenario reset can
   *  free it). No refund — a kill is not a player unbuild (contrast {@link deconstruct}). */
  private destroyWall(w: WallStructure): void {
    this.retireWall(w);
    const sprite = w.sprite;
    this.dying.push(sprite);
    sprite.play(barricadeDestroyKey(orientOf(w.state.facing)));
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.dying = this.dying.filter((s) => s !== sprite);
      if (sprite.active) sprite.destroy();
    });
  }

  // --- Queries -------------------------------------------------------------------

  /** Every wall (raw backing array, not a copy). */
  all(): WallStructure[] {
    return this.walls;
  }

  wallAt(col: number, row: number): WallStructure | undefined {
    return this.walls.find((w) => w.col === col && w.row === row);
  }

  /** Look up a wall by id (undefined once gone) — mirrors CampfireBehavior.campfireById, so a per-tick
   *  consumer (the enemy attack path) tolerates a wall destroyed mid-order. */
  wallById(id: string): WallStructure | undefined {
    return this.walls.find((w) => w.id === id);
  }

  /** Inspect-panel stats for a picked wall (dispatched here from StructureManager.stats). */
  stats(struct: PlacedStructure): InspectableStats {
    return placedWallStats(struct as WallStructure);
  }

  /** The world-AABB a queued-deconstruct outline hugs: the barricade sprite's rendered bounds (robust
   *  to its HP-stage frame swaps). Dispatched here from StructureManager.highlightBounds. */
  highlightBounds(struct: PlacedStructure): Phaser.Geom.Rectangle {
    return struct.sprite.getBounds();
  }

  // --- Reset / teardown ----------------------------------------------------------

  /**
   * Destroy every wall sprite (incl. any mid-Destroy-anim ones) and clear the collection. Called at
   * RUNTIME (scene alive), so `sprite.destroy()` is correct — this is the DEV-only scenario reset
   * (testResetWorld), NOT the SHUTDOWN path (see class doc).
   */
  reset(): void {
    for (const w of this.walls) w.sprite.destroy();
    for (const s of this.dying) if (s.active) s.destroy();
    this.walls = [];
    this.dying = [];
    this.nextId = 0;
  }

  /**
   * SHUTDOWN: this run's wall sprites are going away with the rest of this module instance (a fresh
   * module is built by the next `buildWorld()`) — Phaser's own scene teardown already destroyed every
   * sprite by the time StructureManager fans this out. So this only drops the stale references; it must
   * NEVER call `sprite.destroy()` here (see class doc). Deliberately not `reset()` (that destroys
   * sprites, only safe while the scene is alive).
   */
  destroy(): void {
    this.walls = [];
    this.dying = [];
  }
}

/** Map a placement facing to its sheet orientation (down/side/up): left & right both use the `side`
 *  sheet (left is flipped at materialise). */
function orientOf(facing: FacingSpec): Facing {
  return facing === 'up' ? 'up' : facing === 'down' ? 'down' : 'side';
}

/** The buildable id a placed wall renders from — a single wall archetype today, so this is constant;
 *  isolated here so a later multi-wall variant (the solid `D_1`) threads its id through WallStructure. */
function wallBuildableId(_w: WallStructure): string {
  return 'wall';
}

/** The partial deconstruct refund for a buildable: `floor(cost × DECONSTRUCT_REFUND_FRACTION)` of each
 *  resource in its `cost` (wall `{ wood: 2 }` → `{ wood: 1 }`), dropping any entry that floors to 0. */
function refundFor(buildableId: string): Record<string, number> {
  const refund: Record<string, number> = {};
  for (const [id, amount] of Object.entries(BUILDABLES[buildableId].cost)) {
    const give = Math.floor(amount * DECONSTRUCT_REFUND_FRACTION);
    if (give > 0) refund[id] = give;
  }
  return refund;
}
