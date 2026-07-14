import Phaser from 'phaser';
import {
  TILE_SIZE,
  CAMPFIRE_FUEL_MAX,
  CAMPFIRE_FUEL_BURN_PER_SEC,
  CAMPFIRE_FUEL_PER_WOOD,
  CAMPFIRE_LIGHT_MIN_FRAC,
  CAMPFIRE_FLAME_MIN_FRAC,
  COLORS,
} from '../../config';
import { tileToWorldCenter } from '../../systems/grid';
import { BUILDABLES } from '../../data/buildables';
import { campfireBaseKey, campfireFlameKey } from '../../data/tileset';
import { drainFuel, feedFuel, isLit, fuelFrac } from '../../systems/campfire';
import type { CampfireUnit, BuildSite } from '../../entities/types';
import type { GameScene } from '../GameScene';

/** Ember/log base render height in tiles (the flame's height comes from the buildable's `tilesTall`). */
const EMBER_TILES = 2;

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
 * and each one's TWO fire sprites — an ember/log base + a flame layered over it (plan 016) — so it is
 * the sole writer of their anim/tint/scale and their sole destroyer. A campfire is created by
 * {@link materialise} when its build site completes (called
 * from `BuildManager.finishSite` via the scene-mediated `materialiseBuildable` dep — BuildManager
 * still owns the site rect + its occupancy/collision body, this manager owns only the visual + fuel).
 *
 * Per-frame {@link tick} drains fuel, flips lit/unlit (dimming the sprite when spent), and scales the
 * flame sprite by fuel so it visibly grows/shrinks as it burns (plan 016 — a single consistent sprite
 * scaled, NOT swapping the Bonfire_0x sheets, which aren't a clean intensity ramp). {@link feedOne} is
 * the single fuel/sprite write path — the GameScene `refuel` worker order feeds one wood per tick
 * through it (walk-adjacent-then-tend, like harvesting), and the DEV {@link feedAt} test seam delegates
 * to it. {@link lightSources} is the single light source the scene hands to BOTH SurvivalClock
 * (night-overlay mask holes) and VisionController (fog reveal) — no manager↔manager edge; the scene
 * mediates — and its radius lerps with fuel the same way the flame scale does.
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

  /** Turn a completed campfire build site into a live, burning campfire: two bottom-anchored layers at
   *  the fire's tile — an ember/log `base` (fixed height) and a `flame` drawn just above it (its
   *  `flameBaseScale` is the full-fuel size; tick multiplies it by the fuel fraction). Starts full + lit. */
  materialise(site: BuildSite): void {
    const def = BUILDABLES[site.buildableId];
    const x = tileToWorldCenter(site.col);
    const y = tileToWorldCenter(site.row);
    const originY = def.originY ?? 1;
    const base = this.scene.add.sprite(x, y, campfireBaseKey()).setDepth(1).setOrigin(0.5, originY);
    base.setScale((TILE_SIZE * EMBER_TILES) / base.frame.height).play(campfireBaseKey());
    // Flame sits a hair above the base (depth 1.01) so it draws over the embers; height = the
    // buildable's tilesTall at full fuel, scaled down as fuel drains (see applyScale).
    const flame = this.scene.add
      .sprite(x, y, campfireFlameKey())
      .setDepth(1.01)
      .setOrigin(0.5, originY);
    const flameBaseScale = (TILE_SIZE * (def.tilesTall ?? 1)) / flame.frame.height;
    flame.play(campfireFlameKey());
    const c: CampfireUnit = {
      id: `campfire-${this.nextId++}`,
      col: site.col,
      row: site.row,
      sprite: base,
      flame,
      fuel: CAMPFIRE_FUEL_MAX,
      lit: true,
      flameBaseScale,
    };
    this.applyScale(c); // full tank → native flame size
    this.campfires.push(c);
  }

  // --- Per-frame tick ------------------------------------------------------------

  /** Drain every campfire's fuel and reflect it visually: flip lit on a zero-crossing (lit→unlit stops
   *  the flame + dims it ash-grey; unlit→lit resumes), and while lit, scale the flame to match fuel so
   *  it shrinks as it burns down. Called every frame (above the scene's no-action early-return) so fuel
   *  drains whether or not a worker task is active. */
  tick(delta: number): void {
    for (const c of this.campfires) {
      c.fuel = drainFuel(c.fuel, delta, CAMPFIRE_FUEL_BURN_PER_SEC);
      if (c.lit && !isLit(c.fuel)) this.douse(c);
      else if (!c.lit && isLit(c.fuel)) this.light(c);
      else if (c.lit) this.applyScale(c); // still lit — grow/shrink the flame to match fuel
    }
  }

  /** Scale the FLAME from its fuel: `flameBaseScale × fuelFrac(fuel)`, so a full tank is native size and
   *  a dying fire's flame shrinks toward `CAMPFIRE_FLAME_MIN_FRAC` of it. The ember base is fixed — only
   *  the flame grows/shrinks. Sole flame-scale writer (drain in tick + the jump-up on feed route here). */
  private applyScale(c: CampfireUnit): void {
    c.flame.setScale(
      c.flameBaseScale * fuelFrac(c.fuel, CAMPFIRE_FUEL_MAX, CAMPFIRE_FLAME_MIN_FRAC),
    );
  }

  // --- Tap-to-feed ---------------------------------------------------------------

  /** Feed the campfire on this tile one wood, if one is there (the DEV test seam + a tile-addressed
   *  delegate). Returns whether a feed happened. */
  feedAt(col: number, row: number): boolean {
    const c = this.campfireAt(col, row);
    return c ? this.feedOne(c) : false;
  }

  /** Feed one wood into `c`: spend it (false/no-op if the bag is empty), top the tank up, relight it if
   *  it was out, and grow the flame to match the new fuel (the visible "fed it" pop). This is the single
   *  fuel/sprite write path: the refuel worker order calls it once per feed interval and the test seam
   *  routes through it too, so there is no parallel "instant feed" logic to drift from the real one. */
  feedOne(c: CampfireUnit): boolean {
    if (!this.deps.spend({ wood: 1 })) return false; // no wood — no-op
    c.fuel = feedFuel(c.fuel, CAMPFIRE_FUEL_PER_WOOD, CAMPFIRE_FUEL_MAX);
    if (!c.lit && isLit(c.fuel)) this.light(c);
    else this.applyScale(c); // already lit → jump the flame up to the new fuel
    return true;
  }

  /** Brief red "can't feed" blink for a refuel that can't proceed (bag empty, or the fire's already
   *  topped up), so an aborted refuel reads as a refusal rather than a dead tap; restores the real tint
   *  after (none if lit, ash-grey if out). */
  flashNoFuel(c: CampfireUnit): void {
    c.sprite.setTint(COLORS.ghostInvalid);
    c.flame.setTint(COLORS.ghostInvalid);
    this.scene.time.delayedCall(160, () => {
      if (!c.sprite.active) return; // torn down by a scenario reset before the blink cleared
      c.flame.clearTint();
      if (c.lit) c.sprite.clearTint();
      else c.sprite.setTint(0x555555);
    });
  }

  // --- Light source (read by SurvivalClock + VisionController via the scene) ------

  /** World-space light discs this manager contributes — the behavior-neutral "light source" seam both
   *  the night-overlay mask (SurvivalClock) and the fog reveal (VisionController) fill circles from
   *  (named for the concept it fulfils, not "campfires", so a future lamp/torch emitter aggregates into
   *  the same scene closure without either consumer changing — see docs/DECISIONS.md). One disc per LIT
   *  campfire; radius = the buildable's `light` (tiles) × TILE_SIZE, centred on the fire's base tile. */
  lightSources(): readonly { x: number; y: number; radius: number }[] {
    const base = (BUILDABLES.campfire.light ?? 0) * TILE_SIZE;
    return this.campfires
      .filter((c) => c.lit)
      .map((c) => ({
        x: tileToWorldCenter(c.col),
        y: tileToWorldCenter(c.row),
        // Radius lerps MIN_FRAC..1 with fuel — a dying fire's lit hole shrinks (plan 016). Read per
        // frame by SurvivalClock + VisionController, so it animates for free; fog reveal is one-way so a
        // shrinking radius never un-reveals ground already seen this frame.
        radius: base * fuelFrac(c.fuel, CAMPFIRE_FUEL_MAX, CAMPFIRE_LIGHT_MIN_FRAC),
      }));
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

  /** Look up a campfire by id (undefined once gone) — the refuel worker order re-resolves through this
   *  each frame so the executor tolerates a fire that's destroyed mid-order (future destructible fires). */
  campfireById(id: string): CampfireUnit | undefined {
    return this.campfires.find((c) => c.id === id);
  }

  // --- Reset / teardown ----------------------------------------------------------

  /** Douse: hide + stop the flame (embers remain), and dim the ember base ash-grey (fuel is 0 here). */
  private douse(c: CampfireUnit): void {
    c.lit = false;
    c.flame.stop();
    c.flame.setVisible(false);
    c.sprite.setTint(0x555555);
  }

  /** Light/relight: un-dim the embers, show + resume the flame, and size it to current fuel. */
  private light(c: CampfireUnit): void {
    c.lit = true;
    c.sprite.clearTint();
    c.flame.setVisible(true).play(campfireFlameKey(), true);
    this.applyScale(c);
  }

  /**
   * Destroy every campfire sprite and clear the collection. Called at RUNTIME (scene alive), so
   * `sprite.destroy()` is correct — this is the DEV-only scenario reset (testResetWorld), NOT the
   * SHUTDOWN path (see class doc).
   */
  reset(): void {
    for (const c of this.campfires) {
      c.sprite.destroy();
      c.flame.destroy();
    }
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
