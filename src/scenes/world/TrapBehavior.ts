import Phaser from 'phaser';
import { TILE_SIZE, SPIKE_TRAP_DAMAGE } from '../../config';
import { tileToWorldCenter } from '../../systems/grid';
import { rowDepthOffset } from '../../systems/mapFormat';
import { BUILDABLES } from '../../data/buildables';
import {
  spikeTrapKey,
  spikeTrapExtendKey,
  spikeTrapRetractKey,
  SPIKE_TRAP_ARMED_FRAME,
} from '../../data/tileset';
import { trapStats } from '../../systems/stats';
import type { InspectableStats } from '../../data/types';
import type { TrapStructure, BuildSite, PlacedStructure } from '../../entities/types';
import type { GameScene } from '../GameScene';
import type { StructureBehavior } from './StructureManager';

/** Default bottom-anchor + height (tiles) the spike sprite scales to when the buildable omits them —
 *  a single-tile floor decal (the 32px spike frame fits one 16px tile at scale 0.5). */
const TRAP_ORIGIN_Y = 0.5;
const TRAP_TILES_TALL = 1;

/** Depth the spike sprite jumps to for the strike beat so the spikes punch up **over** the mob standing
 *  on the tile (mobs draw at depth 9, the player at 10, held weapons ~11–12) — otherwise the strike
 *  plays at the trap's ground depth, hidden behind the body. Restored to the ground depth once settled. */
const TRAP_STRIKE_DEPTH = 15;

/** A trap's resting (ground) depth — the one-row y-sort band trees/walls/campfire share (plan 029/5b),
 *  well below mobs so a standing enemy draws over the resting trap. */
const groundDepth = (row: number): number => 1 + rowDepthOffset(row);

/**
 * Narrow scene state {@link TrapBehavior} needs but doesn't own — GameScene supplies these as closures
 * over its own fields at construction (plan 013/015 coupling rules: modules get narrow interfaces, not
 * raw manager↔manager edges — the scene mediates). Mirrors how CampfireBehaviorDeps/WallBehaviorDeps
 * take their cost/tile closures.
 */
export interface TrapBehaviorDeps {
  /**
   * Damage the live enemy STANDING ON tile (col,row) — an exact feet-tile match (decision #3: "enemies
   * key off a single feet tile"), NOT EnemyManager.enemyAt's hurtbox test (which would also fire on a
   * torso overlapping from the adjacent tile — not "standing on the spikes"). Routes `amount` through
   * the normal hit-flash/kill path. Returns whether an enemy was there (→ the trap fired).
   */
  hurtEnemyOnTile(col: number, row: number, amount: number): boolean;
}

/**
 * Spike traps — the third live/simulated buildable (plan 040), a {@link StructureBehavior} module in the
 * StructureManager registry alongside {@link CampfireBehavior}/{@link WallBehavior}. Owns the trap
 * collection and each trap's ONE sprite ({@link PlacedStructure.sprite}), so it is the sole writer of
 * that sprite's frame/anim and its sole destroyer. A trap is created by {@link materialise} when its
 * build site completes (routed from `BuildManager.finishSite` via the scene → `StructureManager.materialise`
 * dispatch on `def.behavior`). BuildManager still owns the site rect, but the trap is `blocksPath:false`
 * so it never joins the occupancy set (mobs must walk ONTO it to fire it).
 *
 * Trigger-once: {@link tick} checks each ARMED trap for an enemy on its tile (via the injected dep) and,
 * on a hit, deals flat `SPIKE_TRAP_DAMAGE`, plays the extend/strike anim, and flips `armed` false —
 * settling on the extended (spent) frame. A spent trap is re-armed by {@link rearm} (the GameScene
 * `rearm` worker order — a dawn auto-enqueue + a tap), which snaps it back to the armed frame.
 *
 * Constructed fresh in `buildWorld()` each (re)start and registered under `'trap'`. It simulates (owns a
 * per-frame trigger), so it implements {@link StructureBehavior.tick}; it casts no light, so it omits
 * `lightSources` (like the wall).
 *
 * **SHUTDOWN vs plain GameObjects — the same trap as Campfire/WallBehavior.** The spike sprites are plain
 * animated Sprites (no Arcade body). Phaser's own scene teardown destroys every GameObject BEFORE
 * StructureManager fans {@link destroy} out (a fresh module is built by the next `buildWorld()`). So
 * {@link destroy} may **only drop references** — never call `sprite.destroy()` on the SHUTDOWN path.
 * That differs from {@link reset}, which runs at RUNTIME (scene alive) where `sprite.destroy()` IS
 * correct — the DEV-only scenario reset.
 */
export class TrapBehavior implements StructureBehavior {
  private traps: TrapStructure[] = [];
  private nextId = 0;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: TrapBehaviorDeps,
  ) {}

  // --- Lifecycle -----------------------------------------------------------------

  /** Turn a completed trap build site into a live, ARMED spike trap: one centred floor sprite on the
   *  tile, settled on the armed frame (low/primed — visible so a placed trap reads on the map). */
  materialise(site: BuildSite): void {
    const def = BUILDABLES[site.buildableId];
    const x = tileToWorldCenter(site.col);
    const y = tileToWorldCenter(site.row);
    const originY = def.originY ?? TRAP_ORIGIN_Y;
    const tilesTall = def.tilesTall ?? TRAP_TILES_TALL;

    // Base-row y-sort (plan 029/5b): the trap sorts as one row against trees/other structures. Its low
    // ground depth (1 + rowDepthOffset) sits well under mobs (depth 9+) so an enemy stands OVER the
    // spikes. Start on the armed frame (not the extend anim) — a placed trap is primed, not striking.
    const sprite = this.scene.add
      .sprite(x, y, spikeTrapKey(), SPIKE_TRAP_ARMED_FRAME)
      .setDepth(groundDepth(site.row))
      .setOrigin(0.5, originY);
    sprite.setScale((TILE_SIZE * tilesTall) / sprite.frame.height);

    this.traps.push({
      id: `trap-${this.nextId++}`,
      buildableId: site.buildableId,
      behavior: 'trap',
      col: site.col,
      row: site.row,
      sprite,
      state: { armed: true },
    });
  }

  // --- Per-frame tick (trigger) --------------------------------------------------

  /** Fire any ARMED trap an enemy is standing on: one hit of `SPIKE_TRAP_DAMAGE` through the normal
   *  kill path (via the dep), then play the extend/strike anim and flip `armed` false — the sprite holds
   *  the extended (spent) peak frame on the anim's last frame. Trigger-once: a spent trap is skipped, so
   *  it never re-fires until {@link rearm}. Deterministic under `step()` (the enemy's feet tile is
   *  sampled once per frame). Called every frame by StructureManager.tick (above the scene early-return),
   *  like the campfire's fuel drain, so a trap fires whether or not a worker task is active. */
  tick(_delta: number): void {
    for (const t of this.traps) {
      if (!t.state.armed) continue;
      if (this.deps.hurtEnemyOnTile(t.col, t.row, SPIKE_TRAP_DAMAGE)) this.trip(t);
    }
  }

  /** Spring a trap: flip it spent + play the coil-then-slam strike (flush→low→peak), holding the
   *  extended spent frame. The sprite jumps to {@link TRAP_STRIKE_DEPTH} for the strike so the spikes
   *  punch up OVER the mob on the tile (they'd otherwise play hidden behind it at ground depth), then
   *  drops back to the ground depth once the strike settles. Sole spent-transition path (tick routes
   *  here). Guard the completion callback with `sprite.active` — a scenario reset may destroy it mid-anim. */
  private trip(t: TrapStructure): void {
    t.state.armed = false;
    t.sprite.setDepth(TRAP_STRIKE_DEPTH).play(spikeTrapExtendKey());
    t.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (t.sprite.active) t.sprite.setDepth(groundDepth(t.row));
    });
  }

  /** Re-arm a spent trap: flip `armed` true and play the wind-down (peak→low, the strip's descent
   *  half), settling on the canonical armed frame when it completes. No-op (returns false) if `id` is
   *  unknown (a trap gone mid-order — tolerated, like wallById's consumers) or the trap is already
   *  armed. Driven by the GameScene `rearm` worker order (dawn auto-enqueue + tap). */
  rearm(id: string): boolean {
    const t = this.trapById(id);
    if (!t || t.state.armed) return false;
    t.state.armed = true;
    t.sprite.play(spikeTrapRetractKey());
    t.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (!t.sprite.active) return; // torn down by a scenario reset before the wind-down finished
      t.sprite.stop();
      t.sprite.setTexture(spikeTrapKey(), SPIKE_TRAP_ARMED_FRAME);
    });
    return true;
  }

  // --- Queries -------------------------------------------------------------------

  /** Every trap (raw backing array, not a copy). */
  all(): TrapStructure[] {
    return this.traps;
  }

  trapAt(col: number, row: number): TrapStructure | undefined {
    return this.traps.find((t) => t.col === col && t.row === row);
  }

  /** Look up a trap by id (undefined once gone) — the rearm worker order re-resolves through this each
   *  frame so the executor tolerates a trap removed mid-order (mirrors campfireById/wallById). */
  trapById(id: string): TrapStructure | undefined {
    return this.traps.find((t) => t.id === id);
  }

  /** Inspect-panel stats for a picked trap (dispatched here from StructureManager.stats). */
  stats(struct: PlacedStructure): InspectableStats {
    return trapStats(struct as TrapStructure);
  }

  /** The world-AABB a queued-rearm outline hugs: the spike sprite's rendered bounds. Dispatched here
   *  from StructureManager.highlightBounds. */
  highlightBounds(struct: PlacedStructure): Phaser.Geom.Rectangle {
    return struct.sprite.getBounds();
  }

  // --- Reset / teardown ----------------------------------------------------------

  /**
   * Destroy every trap sprite and clear the collection. Called at RUNTIME (scene alive), so
   * `sprite.destroy()` is correct — the DEV-only scenario reset (testResetWorld), NOT the SHUTDOWN
   * path (see class doc).
   */
  reset(): void {
    for (const t of this.traps) t.sprite.destroy();
    this.traps = [];
    this.nextId = 0;
  }

  /**
   * SHUTDOWN: this run's trap sprites are going away with the rest of this module instance (a fresh
   * module is built by the next `buildWorld()`) — Phaser's own scene teardown already destroyed every
   * sprite by the time StructureManager fans this out. So this only drops the stale references; it must
   * NEVER call `sprite.destroy()` here (see class doc). Deliberately not `reset()`.
   */
  destroy(): void {
    this.traps = [];
  }
}
