import Phaser from 'phaser';
import {
  TILE_SIZE,
  CAMPFIRE_FUEL_MAX,
  CAMPFIRE_FUEL_BURN_PER_SEC,
  CAMPFIRE_FUEL_PER_WOOD,
} from '../../config';
import { tileToWorldCenter } from '../../systems/grid';
import { BUILDABLES } from '../../data/buildables';
import { campfireAnimKey } from '../../data/tileset';
import { drainFuel, feedFuel, isLit } from '../../systems/campfire';
import type { CampfireUnit, BuildSite } from '../../entities/types';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link CampfireManager} needs but doesn't own — GameScene supplies these as
 * closures over its own private fields at construction (plan 013/015 coupling rules: managers get
 * narrow interfaces, not raw field access). `spend` mirrors `systems/Inventory.ts`'s signature exactly
 * (rather than handing over the raw Inventory), matching how SurvivalClockDeps/BuildManagerDeps take
 * their cost closures — so the tap-to-feed spend reads as a one-line closure at the GameScene wiring.
 */
export interface CampfireManagerDeps {
  /** Deduct `cost` (here always `{ wood: 1 }`) atomically; false (no-op) if unaffordable — feedAt's spend. */
  spend(cost: Record<string, number>): boolean;
}

/**
 * Campfires — the first live, per-frame-simulated buildable (plan 012). Owns the campfire collection
 * and each one's animated fire sprite (so it is the sole writer of the sprite's anim/tint, and its
 * sole destroyer). A campfire is created by {@link materialise} when its build site completes (called
 * from `BuildManager.finishSite` via the scene-mediated `materialiseBuildable` dep — BuildManager
 * still owns the site rect + its occupancy/collision body, this manager owns only the visual + fuel).
 *
 * Per-frame {@link tick} drains fuel and flips lit/unlit (dimming the sprite when spent);
 * {@link feedAt} is the command-mode tap-to-feed. {@link lightSources} is the single light source the
 * scene hands to BOTH SurvivalClock (night-overlay mask holes) and VisionController (fog reveal) — no
 * manager↔manager edge; the scene mediates.
 *
 * Constructed fresh in `buildWorld()` each (re)start, alongside the other world managers.
 *
 * **SHUTDOWN vs plain GameObjects — the trap for this manager.** The fire sprites are plain animated
 * Sprites (no Arcade body), but the rule from EnemyManager/SurvivalClock still applies: Phaser's own
 * scene teardown destroys every GameObject BEFORE this manager's SHUTDOWN listener runs (a fresh
 * CampfireManager is built by the next `buildWorld()`). So {@link destroy} may **only drop references**
 * — never call `sprite.destroy()` on the SHUTDOWN path (it pokes an already-destroyed sprite). This
 * differs from {@link reset}, which runs at RUNTIME (physics/scene alive) where `sprite.destroy()` IS
 * correct — that's the DEV-only scenario reset.
 */
export class CampfireManager {
  private campfires: CampfireUnit[] = [];
  private nextId = 0;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: CampfireManagerDeps,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  // --- Lifecycle -----------------------------------------------------------------

  /** Turn a completed campfire build site into a live, burning campfire: a bottom-anchored animated
   *  fire sprite (mirrors ResourceNodeManager's node scale/anchor) that starts full and lit. */
  materialise(site: BuildSite): void {
    const def = BUILDABLES[site.buildableId];
    const sprite = this.scene.add
      .sprite(tileToWorldCenter(site.col), tileToWorldCenter(site.row), campfireAnimKey())
      .setDepth(1);
    sprite
      .setScale((TILE_SIZE * (def.tilesTall ?? 1)) / sprite.frame.height)
      .setOrigin(0.5, def.originY ?? 1);
    sprite.play(campfireAnimKey());
    this.campfires.push({
      id: `campfire-${this.nextId++}`,
      col: site.col,
      row: site.row,
      sprite,
      fuel: CAMPFIRE_FUEL_MAX,
      lit: true,
    });
  }

  // --- Per-frame tick ------------------------------------------------------------

  /** Drain every campfire's fuel and flip its lit state on a zero-crossing: on lit→unlit stop the
   *  flame + dim it (ash-grey), on unlit→lit resume. Called every frame (above the scene's no-action
   *  early-return) so fuel drains whether or not a worker task is active. */
  tick(delta: number): void {
    for (const c of this.campfires) {
      c.fuel = drainFuel(c.fuel, delta, CAMPFIRE_FUEL_BURN_PER_SEC);
      if (c.lit && !isLit(c.fuel)) this.douse(c);
      else if (!c.lit && isLit(c.fuel)) this.light(c);
    }
  }

  // --- Tap-to-feed ---------------------------------------------------------------

  /** Command-mode tap-to-feed: if a campfire sits on this tile and the bag has wood, spend one wood,
   *  top up its fuel, and relight it if it was out. Returns whether a feed happened (the scene uses
   *  this to suppress the move/harvest order the same tap would otherwise issue). */
  feedAt(col: number, row: number): boolean {
    const c = this.campfireAt(col, row);
    if (!c) return false;
    if (!this.deps.spend({ wood: 1 })) return false; // no wood — no-op
    c.fuel = feedFuel(c.fuel, CAMPFIRE_FUEL_PER_WOOD, CAMPFIRE_FUEL_MAX);
    if (!c.lit && isLit(c.fuel)) this.light(c);
    this.flare(c); // visible confirmation the feed registered — the fire briefly flares up
    return true;
  }

  /** Brief "flare up" pulse on a fed fire — a quick scale bump that settles back, so a successful
   *  tap-to-feed reads instantly (fuel is otherwise invisible without opening Inspect). Recomputes the
   *  rest scale from the def (not the live scale) so rapid feeds mid-tween can't leave it inflated. */
  private flare(c: CampfireUnit): void {
    const base = (TILE_SIZE * (BUILDABLES.campfire.tilesTall ?? 1)) / c.sprite.frame.height;
    this.scene.tweens.killTweensOf(c.sprite);
    c.sprite.setScale(base);
    this.scene.tweens.add({
      targets: c.sprite,
      scaleX: base * 1.18,
      scaleY: base * 1.18,
      duration: 110,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  // --- Light source (read by SurvivalClock + VisionController via the scene) ------

  /** World-space light discs this manager contributes — the behavior-neutral "light source" seam both
   *  the night-overlay mask (SurvivalClock) and the fog reveal (VisionController) fill circles from
   *  (named for the concept it fulfils, not "campfires", so a future lamp/torch emitter aggregates into
   *  the same scene closure without either consumer changing — see docs/DECISIONS.md). One disc per LIT
   *  campfire; radius = the buildable's `light` (tiles) × TILE_SIZE, centred on the fire's base tile. */
  lightSources(): readonly { x: number; y: number; radius: number }[] {
    const radius = (BUILDABLES.campfire.light ?? 0) * TILE_SIZE;
    return this.campfires
      .filter((c) => c.lit)
      .map((c) => ({ x: tileToWorldCenter(c.col), y: tileToWorldCenter(c.row), radius }));
  }

  /** True if world point (x,y) is within any lit campfire's light radius (the reveal predicate). */
  inLight(x: number, y: number): boolean {
    return this.lightSources().some(
      (l) => Phaser.Math.Distance.Between(x, y, l.x, l.y) <= l.radius,
    );
  }

  // --- Queries -------------------------------------------------------------------

  /** Every campfire (raw backing array, not a copy). */
  all(): CampfireUnit[] {
    return this.campfires;
  }

  campfireAt(col: number, row: number): CampfireUnit | undefined {
    return this.campfires.find((c) => c.col === col && c.row === row);
  }

  // --- Reset / teardown ----------------------------------------------------------

  /** Douse: stop the flame + dim it ash-grey. */
  private douse(c: CampfireUnit): void {
    c.lit = false;
    c.sprite.stop();
    c.sprite.setTint(0x555555);
  }

  /** Light/relight: clear the dim tint + resume the flame loop. */
  private light(c: CampfireUnit): void {
    c.lit = true;
    c.sprite.clearTint();
    c.sprite.play(campfireAnimKey(), true);
  }

  /**
   * Destroy every campfire sprite and clear the collection. Called at RUNTIME (scene alive), so
   * `sprite.destroy()` is correct — this is the DEV-only scenario reset (testResetWorld), NOT the
   * SHUTDOWN path (see class doc).
   */
  reset(): void {
    for (const c of this.campfires) c.sprite.destroy();
    this.campfires = [];
    this.nextId = 0;
  }

  /**
   * SHUTDOWN: this run's campfire sprites are going away with the rest of this manager instance (a
   * fresh CampfireManager is built by the next `buildWorld()`) — Phaser's own scene teardown already
   * destroyed every sprite by the time this fires. So this only drops the stale references; it must
   * NEVER call `sprite.destroy()` here (see class doc). Deliberately not `reset()` (that destroys
   * sprites, only safe while the scene is alive).
   */
  private destroy(): void {
    this.campfires = [];
  }
}
