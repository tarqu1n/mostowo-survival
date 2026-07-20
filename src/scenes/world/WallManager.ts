import Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import { tileToWorldCenter } from '../../systems/grid';
import { rowDepthOffset } from '../../systems/mapFormat';
import { BUILDABLES } from '../../data/buildables';
import { barricadeBuildKey, barricadeDestroyKey, type Facing } from '../../data/tileset';
import type { PlacedWall, BuildSite, FacingSpec } from '../../entities/types';
import type { GameScene } from '../GameScene';

/** Default bottom-anchor + height (in tiles) the barricade sprite scales to when the buildable omits
 *  them — the wall sets `originY`/`tilesTall` in data (see buildables.ts). Chosen so the visible stake
 *  palisade (~23px of art at the bottom of the 64px frame) reads about one tile tall on its footprint. */
const WALL_ORIGIN_Y = 0.95;
const WALL_TILES_TALL = 3;

/**
 * Narrow scene state {@link WallManager} needs but doesn't own — GameScene supplies these as closures
 * over its own fields at construction (plan 013/015 coupling rules: managers get narrow interfaces, not
 * raw field access). BuildManager stays the sole occupancy/collision writer, so a destroyed wall frees
 * its tile back through {@link freeTile} rather than this manager touching the walls group directly.
 */
export interface WallManagerDeps {
  /** Free a completed wall's occupied tile + collision body (BuildManager.releaseTile) when it's destroyed. */
  freeTile(col: number, row: number): void;
  /** Recompute the active path after a wall was removed (the tile just opened up). */
  repath(): void;
}

/**
 * Barricade walls — the interim live/destructible structure manager (plan 037 chunk 2a), stood up
 * BEFORE the general StructureManager refactor so that refactor is designed against two real shapes
 * (campfire + wall), not one. Deliberately mirrors {@link CampfireManager}: it owns the wall collection
 * and each wall's ONE oriented sprite, so it is the sole writer of that sprite's anim/frame and its
 * sole destroyer. A wall is created by {@link materialise} when its build site completes (routed from
 * `BuildManager.finishSite` via the scene's `materialiseBuildable` behavior dispatch — BuildManager
 * still owns the site rect + its occupancy/collision body, this manager owns only the visual + hp).
 *
 * {@link materialise} plays the orientation's Build anim once, then settles on the intact idle frame
 * (Destroy sheet frame 0). {@link takeDamage} lowers hp and steps the Destroy sheet toward rubble; at
 * `hp <= 0` it plays the Destroy anim through, then removes the wall (frees its tile via the dep +
 * repaths). Nothing calls {@link takeDamage} yet except the DEV test seam — chunk 2c wires the enemy
 * (and consumes {@link thornsOf}).
 *
 * Constructed fresh in `buildWorld()` each (re)start, alongside the other world managers.
 *
 * **SHUTDOWN vs plain GameObjects — the same trap as CampfireManager.** The wall sprites are plain
 * animated Sprites (no Arcade body — BuildManager owns the collision body). Phaser's own scene teardown
 * destroys every GameObject BEFORE this manager's SHUTDOWN listener runs (a fresh WallManager is built
 * by the next `buildWorld()`). So {@link destroy} may **only drop references** — never call
 * `sprite.destroy()` on the SHUTDOWN path. That differs from {@link reset}, which runs at RUNTIME
 * (scene alive) where `sprite.destroy()` IS correct — the DEV-only scenario reset.
 */
export class WallManager {
  private walls: PlacedWall[] = [];
  private nextId = 0;
  /** Sprites mid-Destroy-anim after their wall left {@link walls} — held only so {@link reset} can free
   *  them if a scenario reset lands before the anim's completion callback destroys them (RUNTIME path). */
  private dying: Phaser.GameObjects.Sprite[] = [];

  constructor(
    private readonly scene: GameScene,
    private readonly deps: WallManagerDeps,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

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
      col: site.col,
      row: site.row,
      facing,
      sprite,
      hp: def.maxHp,
      maxHp: def.maxHp,
    });
  }

  // --- Damage (mob attacks lower hp; chunk 2c wires the enemy) --------------------

  /** Lower a wall's hp by `amount` and reflect it: below full hp, step the Destroy sheet's frame toward
   *  rubble (`round((1 - hp/maxHp) * 5)`, clamped 0..5 — frame 0 = intact, 5 = rubble); at `hp <= 0`
   *  play the Destroy anim through, then remove the wall (free its tile + collision via the dep, and
   *  repath). Returns whether this blow destroyed it. No-op (returns false) if `id` is unknown —
   *  tolerates a wall removed mid-attack, like {@link wallById}'s consumers. Nothing calls this yet but
   *  the DEV test seam; chunk 2c wires the enemy + thorns. */
  takeDamage(id: string, amount: number): boolean {
    const w = this.wallById(id);
    if (!w) return false;
    w.hp = Math.max(0, w.hp - amount);
    if (w.hp <= 0) {
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

  /** Show the damage-stage frame for a wall's current hp (Destroy sheet, frame 0 intact → 5 rubble). */
  private applyDamageStage(w: PlacedWall): void {
    const frame = Phaser.Math.Clamp(Math.round((1 - w.hp / w.maxHp) * 5), 0, 5);
    w.sprite.stop(); // in case the Build anim is somehow still playing — the HP-stage frame is authoritative
    w.sprite.setTexture(barricadeDestroyKey(orientOf(w.facing)), frame);
  }

  /** Remove a destroyed wall: free its tile NOW (so pathing/occupancy open immediately and the mob can
   *  repath through as it crumbles), drop it from the collection, then play the Destroy anim through and
   *  self-destroy the sprite on completion (tracked in {@link dying} so a scenario reset can free it). */
  private destroyWall(w: PlacedWall): void {
    this.deps.freeTile(w.col, w.row);
    this.deps.repath();
    this.walls = this.walls.filter((x) => x !== w);

    const sprite = w.sprite;
    this.dying.push(sprite);
    sprite.play(barricadeDestroyKey(orientOf(w.facing)));
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.dying = this.dying.filter((s) => s !== sprite);
      if (sprite.active) sprite.destroy();
    });
  }

  // --- Queries -------------------------------------------------------------------

  /** Every wall (raw backing array, not a copy). */
  all(): PlacedWall[] {
    return this.walls;
  }

  wallAt(col: number, row: number): PlacedWall | undefined {
    return this.walls.find((w) => w.col === col && w.row === row);
  }

  /** Look up a wall by id (undefined once gone) — mirrors CampfireManager.campfireById, so a future
   *  per-tick consumer (chunk 2c) tolerates a wall destroyed mid-order. */
  wallById(id: string): PlacedWall | undefined {
    return this.walls.find((w) => w.id === id);
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
   * SHUTDOWN: this run's wall sprites are going away with the rest of this manager instance (a fresh
   * WallManager is built by the next `buildWorld()`) — Phaser's own scene teardown already destroyed
   * every sprite by the time this fires. So this only drops the stale references; it must NEVER call
   * `sprite.destroy()` here (see class doc). Deliberately not `reset()` (that destroys sprites, only
   * safe while the scene is alive).
   */
  private destroy(): void {
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
 *  isolated here so a later multi-wall variant (the solid `D_1`) threads its id through PlacedWall. */
function wallBuildableId(_w: PlacedWall): string {
  return 'wall';
}
