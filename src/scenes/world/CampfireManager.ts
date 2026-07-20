import Phaser from 'phaser';
import {
  TILE_SIZE,
  CAMPFIRE_FUEL_MAX,
  CAMPFIRE_FUEL_BURN_PER_SEC,
  CAMPFIRE_FUEL_PER_WOOD,
  CAMPFIRE_LIGHT_MIN_FRAC,
  CAMPFIRE_FLAME_LARGE_MIN_FRAC,
  CAMPFIRE_FLAME_LARGE_SCALE_MIN,
  CAMPFIRE_FLAME_RISE_PX,
  CAMPFIRE_SMOKE_RISE_PX,
  COLORS,
} from '../../config';
import { tileToWorldCenter } from '../../systems/grid';
import { rowDepthOffset, SUB_ROW_EPSILON } from '../../systems/mapFormat';
import { BUILDABLES } from '../../data/buildables';
import {
  campfireBaseKey,
  campfireFlameLargeKey,
  campfireFlameSmallKey,
  campfireSmokeKey,
} from '../../data/tileset';
import { drainFuel, feedFuel, isLit, fuelFrac } from '../../systems/campfire';
import type { CampfireUnit, BuildSite } from '../../entities/types';
import type { GameScene } from '../GameScene';

/** Stone-ring base render height in tiles (the flame's height comes from the buildable's `tilesTall`). */
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
 * and each one's THREE stacked sprites — a stone-ring base + a flame over it + a smoke plume on top
 * (plan 016 follow-up) — so it is the sole writer of their anim/tint/scale and their sole destroyer. A
 * campfire is created by {@link materialise} when its build site completes (called
 * from `BuildManager.finishSite` via the scene-mediated `materialiseBuildable` dep — BuildManager
 * still owns the site rect + its occupancy/collision body, this manager owns only the visual + fuel).
 *
 * Per-frame {@link tick} drains fuel, flips lit/unlit (dimming the base when spent), and drives the
 * flame from fuel (see {@link applyFlame}): the LARGE `Fire_01` sheet above 50% fuel (scaled a touch by
 * fuel), the SMALL `Fire_02` sheet below — a two-level swap, unlike the plan-012 single sheet, because
 * these two flame sheets ARE a clean ramp (the Bonfire_0x sheets weren't). The smoke drifts at all
 * times, fuel-agnostic. {@link feedOne} is
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

  /** Turn a completed campfire build site into a live, burning campfire: three bottom-anchored layers at
   *  the fire's tile — a stone-ring `base` (fixed height), a `flame` lifted `CAMPFIRE_FLAME_RISE_PX`
   *  above it (large/small sheet + scale set by {@link applyFlame}), and a `smoke` plume above that
   *  (always drifting). Starts full + lit. */
  materialise(site: BuildSite): void {
    const def = BUILDABLES[site.buildableId];
    const x = tileToWorldCenter(site.col);
    const y = tileToWorldCenter(site.row);
    const originY = def.originY ?? 1;
    const tilesTall = def.tilesTall ?? 1;

    // Base-row y-sort (plan 029/5b): the whole campfire sorts as one row against trees/walls, so a tree
    // in front draws over it and one behind draws under it. Flame/smoke ride sub-row epsilons above the
    // base so the stack keeps its internal order without ever crossing a row boundary.
    const baseDepth = 1 + rowDepthOffset(site.row);
    const base = this.scene.add
      .sprite(x, y, campfireBaseKey())
      .setDepth(baseDepth)
      .setOrigin(0.5, originY);
    base.setScale((TILE_SIZE * EMBER_TILES) / base.frame.height).play(campfireBaseKey());

    // Flame rides a few px above the stone base (depth base + 1 epsilon) so it reads as rising out of the
    // ring, not sitting in it; starts on the large sheet (full fuel). flameBaseScale = its full-fuel fit;
    // both flame sheets share the 32×48 grid, so one scale fits either. applyFlame picks the sheet+scale.
    const flame = this.scene.add
      .sprite(x, y - CAMPFIRE_FLAME_RISE_PX, campfireFlameLargeKey())
      .setDepth(baseDepth + SUB_ROW_EPSILON)
      .setOrigin(0.5, originY);
    const flameBaseScale = (TILE_SIZE * tilesTall) / flame.frame.height;
    flame.play(campfireFlameLargeKey());

    // Smoke always drifts above the flame (depth base + 2 epsilons), independent of fuel/lit state.
    const smoke = this.scene.add
      .sprite(x, y - CAMPFIRE_SMOKE_RISE_PX, campfireSmokeKey())
      .setDepth(baseDepth + 2 * SUB_ROW_EPSILON)
      .setOrigin(0.5, originY);
    smoke.setScale((TILE_SIZE * tilesTall) / smoke.frame.height).play(campfireSmokeKey());

    const c: CampfireUnit = {
      id: `campfire-${this.nextId++}`,
      col: site.col,
      row: site.row,
      sprite: base,
      flame,
      smoke,
      fuel: CAMPFIRE_FUEL_MAX,
      lit: true,
      flameBaseScale,
      flameLevel: 'large',
    };
    this.applyFlame(c); // full tank → large sheet at native size
    this.campfires.push(c);
  }

  // --- Per-frame tick ------------------------------------------------------------

  /** Drain every campfire's fuel and reflect it visually: flip lit on a zero-crossing (lit→unlit stops
   *  the flame + dims the base ash-grey; unlit→lit resumes), and while lit, pick the flame sheet + scale
   *  for the new fuel so it visibly steps down as it burns. Called every frame (above the scene's
   *  no-action early-return) so fuel drains whether or not a worker task is active. */
  tick(delta: number): void {
    for (const c of this.campfires) {
      c.fuel = drainFuel(c.fuel, delta, CAMPFIRE_FUEL_BURN_PER_SEC);
      if (c.lit && !isLit(c.fuel)) this.douse(c);
      else if (!c.lit && isLit(c.fuel)) this.light(c);
      else if (c.lit) this.applyFlame(c); // still lit — pick sheet + scale for the new fuel
    }
  }

  /** Which flame sheet a given fuel level burns: the LARGE sheet at/above `CAMPFIRE_FLAME_LARGE_MIN_FRAC`
   *  of a full tank, the SMALL sheet below. */
  private flameLevelFor(fuel: number): 'large' | 'small' {
    return fuel / CAMPFIRE_FUEL_MAX >= CAMPFIRE_FLAME_LARGE_MIN_FRAC ? 'large' : 'small';
  }

  private flameKeyFor(level: 'large' | 'small'): string {
    return level === 'large' ? campfireFlameLargeKey() : campfireFlameSmallKey();
  }

  /** Drive the FLAME from fuel: swap between the large (>50%) and small (≤50%) sheets on a threshold
   *  crossing — keeping the current frame index so the loop doesn't visibly restart — then set its
   *  scale. The large sheet grows a touch across the top band (`CAMPFIRE_FLAME_LARGE_SCALE_MIN`..1); the
   *  small sheet stays native (its art already reads as a reduced flame, so we don't shrink it further).
   *  The stone base is fixed — only the flame changes. Sole flame texture/scale writer (drain in tick +
   *  the jump-up on feed both route here). */
  private applyFlame(c: CampfireUnit): void {
    const level = this.flameLevelFor(c.fuel);
    if (level !== c.flameLevel) {
      c.flameLevel = level;
      c.flame.play({
        key: this.flameKeyFor(level),
        startFrame: c.flame.anims.currentFrame?.index ?? 0,
      });
    }
    const topBand = Phaser.Math.Clamp(
      (c.fuel / CAMPFIRE_FUEL_MAX - CAMPFIRE_FLAME_LARGE_MIN_FRAC) /
        (1 - CAMPFIRE_FLAME_LARGE_MIN_FRAC),
      0,
      1,
    );
    const scale =
      level === 'large'
        ? c.flameBaseScale * Phaser.Math.Linear(CAMPFIRE_FLAME_LARGE_SCALE_MIN, 1, topBand)
        : c.flameBaseScale;
    c.flame.setScale(scale);
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
    else this.applyFlame(c); // already lit → jump the flame up to the new fuel (may swap small→large)
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

  // --- Damage (mob attacks knock the light out) ----------------------------------

  /** Drain a fire's fuel by `amount` — a mob attack on the fire-heart (plan 038). Deliberately drains
   *  the SAME `fuel` meter that natural burn drains and feeding wood restores (decision #2: no separate
   *  integrity meter), so an attacked fire dims (its {@link lightSources} radius lerps with fuel) and,
   *  once emptied, douses on the same zero-crossing as a plain burn-out — the attacked-out and
   *  starved-out states are identical by construction. **Not a loss** (decision #1): a doused fire just
   *  floods darkness; relight it via the existing feed-wood path. No-op (returns false) if `id` is
   *  unknown — tolerates a fire removed mid-attack, like {@link campfireById}'s consumers. */
  damageFire(id: string, amount: number): boolean {
    const c = this.campfireById(id);
    if (!c) return false;
    c.fuel = Math.max(0, c.fuel - amount);
    if (c.lit && !isLit(c.fuel))
      this.douse(c); // emptied → douse (same path as burn-out in tick)
    else if (c.lit) this.applyFlame(c); // still lit → shrink the flame to the new fuel now, not next tick
    return true;
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

  /** Douse: hide + stop the flame (the stone ring remains), and dim the base ash-grey (fuel is 0 here).
   *  Smoke keeps drifting — a doused fire still smoulders (smoke is always-on). */
  private douse(c: CampfireUnit): void {
    c.lit = false;
    c.flame.stop();
    c.flame.setVisible(false);
    c.sprite.setTint(0x555555);
  }

  /** Light/relight: un-dim the stones, show + resume the flame on the sheet for the current fuel, and
   *  size it. */
  private light(c: CampfireUnit): void {
    c.lit = true;
    c.sprite.clearTint();
    c.flameLevel = this.flameLevelFor(c.fuel);
    c.flame.setVisible(true).play(this.flameKeyFor(c.flameLevel), true);
    this.applyFlame(c);
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
      c.smoke.destroy();
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
