import Phaser from 'phaser';
import {
  TILE_SIZE,
  CAMPFIRE_FUEL_MAX,
  CAMPFIRE_FUEL_BURN_PER_SEC,
  CAMPFIRE_FUEL_PER_WOOD,
  CAMPFIRE_LIGHT_MIN_FRAC,
  CLAIM_LIGHT_FRAC,
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
import { campfireStats } from '../../systems/stats';
import type { InspectableStats } from '../../data/types';
import type { CampfireStructure, BuildSite, PlacedStructure } from '../../entities/types';
import type { GameScene } from '../GameScene';
import type { LightSource, StructureBehavior } from './StructureManager';

/** Stone-ring base render height in tiles (the flame's height comes from the buildable's `tilesTall`). */
const EMBER_TILES = 2;

/**
 * Narrow scene state {@link CampfireBehavior} needs but doesn't own — GameScene supplies these as
 * closures over its own private fields at construction (plan 013/015 coupling rules: modules get
 * narrow interfaces, not raw field access). `spend` mirrors `systems/Inventory.ts`'s signature exactly
 * (rather than handing over the raw Inventory), matching how SurvivalClockDeps/BuildManagerDeps take
 * their cost closures — so the tap-to-feed spend reads as a one-line closure at the GameScene wiring.
 */
export interface CampfireBehaviorDeps {
  /** Deduct `cost` (here always `{ wood: 1 }`) atomically; false (no-op) if unaffordable — feedAt's spend. */
  spend(cost: Record<string, number>): boolean;
}

/**
 * Campfires — the first live, per-frame-simulated buildable (plan 012), now the first
 * {@link StructureBehavior} module in the StructureManager registry (plan 037). Owns the campfire
 * collection and each one's THREE stacked sprites — a stone-ring base ({@link PlacedStructure.sprite})
 * + a flame over it + a smoke plume on top (plan 016 follow-up) — so it is the sole writer of their
 * anim/tint/scale and their sole destroyer. A campfire is created by {@link materialise} when its
 * build site completes (routed from `BuildManager.finishSite` via the scene → `StructureManager.materialise`
 * dispatch on `def.behavior` — BuildManager still owns the site rect + its occupancy/collision body,
 * this module owns only the visual + fuel).
 *
 * Per-frame {@link tick} drains fuel, flips lit/unlit (dimming the base when spent), and drives the
 * flame from fuel (see {@link applyFlame}): the LARGE `Fire_01` sheet above 50% fuel (scaled a touch by
 * fuel), the SMALL `Fire_02` sheet below — a two-level swap, unlike the plan-012 single sheet, because
 * these two flame sheets ARE a clean ramp (the Bonfire_0x sheets weren't). The smoke drifts at all
 * times, fuel-agnostic. {@link feedOne} is the single fuel/sprite write path — the GameScene `refuel`
 * worker order feeds one wood per tick through it (walk-adjacent-then-tend, like harvesting), and the
 * DEV {@link feedAt} test seam delegates to it. {@link lightSources} is the single light source the
 * StructureManager hands to BOTH SurvivalClock (night-overlay mask holes) and VisionController (fog
 * reveal) — no module↔consumer edge; the scene mediates — and its radius lerps with fuel the same way
 * the flame scale does.
 *
 * Constructed fresh in `buildWorld()` each (re)start and registered under `'campfire'`.
 *
 * **SHUTDOWN vs plain GameObjects — the trap for this module.** The fire sprites are plain animated
 * Sprites (no Arcade body), but the rule from EnemyManager/SurvivalClock still applies: Phaser's own
 * scene teardown destroys every GameObject BEFORE StructureManager's SHUTDOWN listener fans {@link destroy}
 * out (a fresh module is built by the next `buildWorld()`). So {@link destroy} may **only drop
 * references** — never call `sprite.destroy()` on the SHUTDOWN path (it pokes an already-destroyed
 * sprite). This differs from {@link reset}, which runs at RUNTIME (physics/scene alive) where
 * `sprite.destroy()` IS correct — that's the DEV-only scenario reset.
 */
export class CampfireBehavior implements StructureBehavior {
  private campfires: CampfireStructure[] = [];
  private nextId = 0;
  /** Last rounded fuel value broadcast on `fire:changed` (plan 038 Step 6) — throttles the per-frame
   *  drain so the HUD bar only re-renders on a visible change. `-1` = nothing emitted yet. */
  private lastFireFuelEmit = -1;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: CampfireBehaviorDeps,
  ) {}

  // --- Lifecycle -----------------------------------------------------------------

  /** Turn a completed campfire build site into a live, burning campfire: three bottom-anchored layers at
   *  the fire's tile — a stone-ring `sprite` base (fixed height), a `flame` lifted `CAMPFIRE_FLAME_RISE_PX`
   *  above it (large/small sheet + scale set by {@link applyFlame}), and a `smoke` plume above that
   *  (always drifting). Starts full + lit. */
  materialise(site: BuildSite): void {
    const def = BUILDABLES[site.buildableId];
    const x = tileToWorldCenter(site.col);
    // Anchor the bottom-origin stack (base/flame/smoke all share `originY`) to the tile's BOTTOM edge,
    // not its centre. `tileToWorldCenter` is the tile's middle, so a bottom-anchored sprite placed
    // there floats half a tile above the tile it sits on; adding TILE_SIZE/2 drops the stone ring's
    // lower edge onto the tile's lower edge (the flame + smoke ride their RISE offsets above it, so the
    // whole campfire descends together as one stack).
    const y = tileToWorldCenter(site.row) + TILE_SIZE / 2;
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

    const c: CampfireStructure = {
      id: `campfire-${this.nextId++}`,
      buildableId: site.buildableId,
      behavior: 'campfire',
      col: site.col,
      row: site.row,
      sprite: base,
      state: {
        flame,
        smoke,
        fuel: CAMPFIRE_FUEL_MAX,
        lit: true,
        flameBaseScale,
        flameLevel: 'large',
      },
    };
    this.applyFlame(c); // full tank → large sheet at native size
    this.campfires.push(c);
    this.emitFire(); // a new hearth → surface it on the HUD fire bar (plan 038 Step 6)
  }

  /** Broadcast the fire-heart HUD signal (plan 038 Step 6): the primary campfire's fuel/lit (the first
   *  — a single hearth in the MVP), or `null` when none exists (the HUD hides the bar). */
  private emitFire(): void {
    const c = this.campfires[0];
    this.lastFireFuelEmit = c ? Math.round(c.state.fuel) : -1;
    this.scene.game.events.emit(
      'fire:changed',
      c ? { fuel: c.state.fuel, maxFuel: CAMPFIRE_FUEL_MAX, lit: c.state.lit } : null,
    );
  }

  // --- Per-frame tick ------------------------------------------------------------

  /** Drain every campfire's fuel and reflect it visually: flip lit on a zero-crossing (lit→unlit stops
   *  the flame + dims the base ash-grey; unlit→lit resumes), and while lit, pick the flame sheet + scale
   *  for the new fuel so it visibly steps down as it burns. Called every frame (above the scene's
   *  no-action early-return) so fuel drains whether or not a worker task is active. */
  tick(delta: number): void {
    for (const c of this.campfires) {
      c.state.fuel = drainFuel(c.state.fuel, delta, CAMPFIRE_FUEL_BURN_PER_SEC);
      if (c.state.lit && !isLit(c.state.fuel)) this.douse(c);
      else if (!c.state.lit && isLit(c.state.fuel)) this.light(c);
      else if (c.state.lit) this.applyFlame(c); // still lit — pick sheet + scale for the new fuel
    }
    // Feed the HUD fire bar, throttled to the primary hearth's rounded fuel so it only re-renders on a
    // visible change (mirrors the hunger tick's rounded-emit — plan 038 Step 6).
    const primary = this.campfires[0];
    if (primary && Math.round(primary.state.fuel) !== this.lastFireFuelEmit) this.emitFire();
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
  private applyFlame(c: CampfireStructure): void {
    const level = this.flameLevelFor(c.state.fuel);
    if (level !== c.state.flameLevel) {
      c.state.flameLevel = level;
      c.state.flame.play({
        key: this.flameKeyFor(level),
        startFrame: c.state.flame.anims.currentFrame?.index ?? 0,
      });
    }
    const topBand = Phaser.Math.Clamp(
      (c.state.fuel / CAMPFIRE_FUEL_MAX - CAMPFIRE_FLAME_LARGE_MIN_FRAC) /
        (1 - CAMPFIRE_FLAME_LARGE_MIN_FRAC),
      0,
      1,
    );
    const scale =
      level === 'large'
        ? c.state.flameBaseScale * Phaser.Math.Linear(CAMPFIRE_FLAME_LARGE_SCALE_MIN, 1, topBand)
        : c.state.flameBaseScale;
    c.state.flame.setScale(scale);
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
  feedOne(c: CampfireStructure): boolean {
    if (!this.deps.spend({ wood: 1 })) return false; // no wood — no-op
    c.state.fuel = feedFuel(c.state.fuel, CAMPFIRE_FUEL_PER_WOOD, CAMPFIRE_FUEL_MAX);
    if (!c.state.lit && isLit(c.state.fuel)) this.light(c);
    else this.applyFlame(c); // already lit → jump the flame up to the new fuel (may swap small→large)
    this.emitFire(); // refuel → bump the HUD fire bar (plan 038 Step 6)
    return true;
  }

  /**
   * Add `amount` fuel to campfire `id` WITHOUT an Inventory spend — the companion's `refuel` night
   * posture (plan 042 Step 8) sources its wood from the shared BASE-SUPPLY pool, not the player's bag,
   * so it can't route through {@link feedOne} (which spends the Inventory). Performs the same fuel/sprite
   * writes as feedOne otherwise: tops the tank up (clamped), relights an out fire on the zero-crossing,
   * grows the flame to the new fuel, and bumps the HUD fire bar. No-op (returns false) on an unknown id.
   */
  refuel(id: string, amount: number): boolean {
    const c = this.campfireById(id);
    if (!c) return false;
    c.state.fuel = feedFuel(c.state.fuel, amount, CAMPFIRE_FUEL_MAX);
    if (!c.state.lit && isLit(c.state.fuel)) this.light(c);
    else this.applyFlame(c);
    this.emitFire();
    return true;
  }

  /** Brief red "can't feed" blink for a refuel that can't proceed (bag empty, or the fire's already
   *  topped up), so an aborted refuel reads as a refusal rather than a dead tap; restores the real tint
   *  after (none if lit, ash-grey if out). */
  flashNoFuel(c: CampfireStructure): void {
    c.sprite.setTint(COLORS.ghostInvalid);
    c.state.flame.setTint(COLORS.ghostInvalid);
    this.scene.time.delayedCall(160, () => {
      if (!c.sprite.active) return; // torn down by a scenario reset before the blink cleared
      c.state.flame.clearTint();
      if (c.state.lit) c.sprite.clearTint();
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
    c.state.fuel = Math.max(0, c.state.fuel - amount);
    if (c.state.lit && !isLit(c.state.fuel))
      this.douse(c); // emptied → douse (same path as burn-out in tick)
    else if (c.state.lit) this.applyFlame(c); // still lit → shrink the flame to the new fuel now, not next tick
    this.emitFire(); // mob attack drained the fire → update the HUD fire bar (plan 038 Step 6)
    return true;
  }

  // --- Light source (read by SurvivalClock + VisionController via StructureManager) -

  /** World-space light discs this behavior contributes — the behavior-neutral "light source" seam both
   *  the night-overlay mask (SurvivalClock) and the fog reveal (VisionController) fill circles from
   *  (a future lamp/torch emitter aggregates into the same StructureManager union without either
   *  consumer changing — see docs/DECISIONS.md). One disc per LIT campfire; radius = the buildable's
   *  `light` (tiles) × TILE_SIZE, centred on the fire's base tile. */
  lightSources(): readonly LightSource[] {
    const base = (BUILDABLES.campfire.light ?? 0) * TILE_SIZE;
    return this.campfires
      .filter((c) => c.state.lit)
      .map((c) => ({
        x: tileToWorldCenter(c.col),
        y: tileToWorldCenter(c.row),
        // Radius lerps MIN_FRAC..1 with fuel — a dying fire's lit hole shrinks (plan 016). Read per
        // frame by SurvivalClock + VisionController, so it animates for free; fog reveal is one-way so a
        // shrinking radius never un-reveals ground already seen this frame.
        radius: base * fuelFrac(c.state.fuel, CAMPFIRE_FUEL_MAX, CAMPFIRE_LIGHT_MIN_FRAC),
      }));
  }

  /** True if world point (x,y) is within any lit campfire's light radius (the reveal predicate). */
  inLight(x: number, y: number): boolean {
    return this.lightSources().some(
      (l) => Phaser.Math.Distance.Between(x, y, l.x, l.y) <= l.radius,
    );
  }

  /** True if any campfire is currently lit — the base-CLAIM gate (plan 039): while false, the
   *  bootstrap `BASE_ZONE` rect governs `baseOnly` placement; once a hearth is lit, {@link inClaim}
   *  takes over so the first (`baseOnly`) campfire can still be placed before any fire exists. */
  hasLitHearth(): boolean {
    return this.campfires.some((c) => c.state.lit);
  }

  /** True if world point (x,y) is within a lit campfire's **bright core** — the base-claim predicate
   *  (plan 039 decisions #1/#7). Unlike {@link inLight} (full geometric radius, the reveal), the claim
   *  tests only `radius × CLAIM_LIGHT_FRAC` so placement is confined to the clearly-lit core, never the
   *  soft gradient rim that's faded to near-invisible. Breathes with fuel like the light does. */
  inClaim(x: number, y: number): boolean {
    return this.lightSources().some(
      (l) => Phaser.Math.Distance.Between(x, y, l.x, l.y) <= l.radius * CLAIM_LIGHT_FRAC,
    );
  }

  // --- Queries -------------------------------------------------------------------

  /** Every campfire (raw backing array, not a copy). */
  all(): CampfireStructure[] {
    return this.campfires;
  }

  campfireAt(col: number, row: number): CampfireStructure | undefined {
    return this.campfires.find((c) => c.col === col && c.row === row);
  }

  /** Look up a campfire by id (undefined once gone) — the refuel worker order re-resolves through this
   *  each frame so the executor tolerates a fire that's destroyed mid-order (future destructible fires). */
  campfireById(id: string): CampfireStructure | undefined {
    return this.campfires.find((c) => c.id === id);
  }

  /** Inspect-panel stats for a picked campfire (dispatched here from StructureManager.stats). */
  stats(struct: PlacedStructure): InspectableStats {
    return campfireStats(struct as CampfireStructure);
  }

  /** The world-AABB a queued-refuel outline hugs: the union of the two layers' world AABBs (ember base
   *  + fuel-scaled flame), so the box tracks the actual fire instead of a fixed tile column (which
   *  dwarfed the small flame). Dispatched here from StructureManager.highlightBounds. */
  highlightBounds(struct: PlacedStructure): Phaser.Geom.Rectangle {
    const c = struct as CampfireStructure;
    const b = c.sprite.getBounds();
    const f = c.state.flame.getBounds();
    const left = Math.min(b.left, f.left);
    const right = Math.max(b.right, f.right);
    const top = Math.min(b.top, f.top);
    const bottom = Math.max(b.bottom, f.bottom);
    return new Phaser.Geom.Rectangle(left, top, right - left, bottom - top);
  }

  // --- Reset / teardown ----------------------------------------------------------

  /** Douse: hide + stop the flame (the stone ring remains), and dim the base ash-grey (fuel is 0 here).
   *  Smoke keeps drifting — a doused fire still smoulders (smoke is always-on). */
  private douse(c: CampfireStructure): void {
    c.state.lit = false;
    c.state.flame.stop();
    c.state.flame.setVisible(false);
    c.sprite.setTint(0x555555);
  }

  /** Light/relight: un-dim the stones, show + resume the flame on the sheet for the current fuel, and
   *  size it. */
  private light(c: CampfireStructure): void {
    c.state.lit = true;
    c.sprite.clearTint();
    c.state.flameLevel = this.flameLevelFor(c.state.fuel);
    c.state.flame.setVisible(true).play(this.flameKeyFor(c.state.flameLevel), true);
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
      c.state.flame.destroy();
      c.state.smoke.destroy();
    }
    this.campfires = [];
    this.nextId = 0;
    this.emitFire(); // no fires left → HUD hides the bar (plan 038 Step 6)
  }

  /**
   * SHUTDOWN: this run's campfire sprites are going away with the rest of this module instance (a
   * fresh module is built by the next `buildWorld()`) — Phaser's own scene teardown already destroyed
   * every sprite by the time StructureManager fans this out. So this only drops the stale references;
   * it must NEVER call `sprite.destroy()` here (see class doc). Deliberately not `reset()` (that
   * destroys sprites, only safe while the scene is alive).
   */
  destroy(): void {
    this.campfires = [];
  }
}
