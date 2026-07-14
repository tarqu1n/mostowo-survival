import Phaser from 'phaser';
import {
  COLORS,
  DAY_MS,
  TWILIGHT_MS,
  HUNGER_MAX,
  HUNGER_DRAIN_PER_SEC,
  HUNGER_LETHAL,
  STARVE_DAMAGE,
  STARVE_DAMAGE_INTERVAL_MS,
} from '../../config';
import { ITEMS } from '../../data/items';
import {
  cycleLengthMs,
  phaseAt,
  tintAlphaAt,
  dayCountForTotal,
  type DayPhase,
} from '../../systems/daynight';
import { drainHunger, feed, isStarving } from '../../systems/needs';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link SurvivalClock} needs but doesn't own — GameScene supplies these as
 * closures over its own private fields/methods at construction (plan 013 Step 6 coupling rules,
 * carried into plan 015: managers get narrow interfaces, not raw field access). `canAfford`/`spend`
 * mirror `systems/Inventory.ts`'s own signatures exactly (rather than handing this manager the raw
 * `Inventory` instance) so `eat`'s single-item cost check/spend reads as a one-line closure at the
 * call site in GameScene.
 */
export interface SurvivalClockDeps {
  /** Apply starvation damage to the player (scene-owned: emits hp events / triggers the death path). */
  damagePlayer(amount: number): void;
  /** True iff `cost` (here always `{ [itemId]: 1 }`) is currently held — eat()'s afford check. */
  canAfford(cost: Record<string, number>): boolean;
  /** Deduct `cost` atomically; false (no-op) if unaffordable — eat()'s spend. */
  spend(cost: Record<string, number>): boolean;
  /** World-space light discs (the behavior-neutral light-source seam — CampfireManager.lightSources()
   *  today, via the scene, no manager↔manager edge). Each becomes a hole in the night overlay so a lit
   *  source is readable at night. Empty ⇒ no holes ⇒ full night, byte-identical to pre-campfire behaviour. */
  lightSources(): readonly { x: number; y: number; radius: number }[];
  /** World pixel extent (loaded map's width/height in px) — the night overlay spans this instead of
   *  the old fixed `MAP_WIDTH`/`MAP_HEIGHT` (plan 018 A9: runtime map loader, world extent now derives
   *  from the loaded map rather than a compile-time constant). */
  worldPx: { w: number; h: number };
}

/**
 * Day/night clock + hunger/starvation (plan 015 Step 3) — moved verbatim out of GameScene, which
 * still owns `damagePlayer` itself (the starve loop calls it via `deps`, same edge as EnemyManager's
 * bite damage). Owns `clockMs`/`dayPhase`/`dayCount` (advanced every frame in {@link tick}, mirrored
 * to the registry + emitted as `time:changed` on a phase/day change) and `hunger`/`starveElapsed`
 * (drained every frame in the same tick; at zero the player starves, taking `STARVE_DAMAGE` every
 * `STARVE_DAMAGE_INTERVAL_MS` via `deps.damagePlayer`).
 *
 * **Sole writer of `nightOverlay`'s alpha, and owner of its campfire-light mask.** Per the plan's
 * ownership rule ("ownership follows the writer"), the map-sized dark rect that darkens the world at
 * night lives here, not on VisionController or any other manager — every alpha write (the per-frame
 * tick, a manual `toggleDayNight` jump, and the DEV-only test API's `nightOverlay` poke) funnels
 * through this class. Plan 012 added the overlay's inverted geometry mask + its `lightShape` source
 * here too (redrawn each tick from the scene-supplied `deps.lightSources()` — no manager↔manager
 * edge), so lit campfires punch readable holes in the darkness.
 *
 * Constructed fresh in `buildWorld()` each (re)start, at the exact point the old inline night-overlay
 * block used to run. Unlike `ResourceNodeManager`/`EnemyManager`, its constructor DOES have real
 * side effects (seeding the registry's `dayPhase`/`dayCount`/`hunger` keys) — this mirrors what the
 * old inline block did at the same point, and is safe since nothing here reaches for player state.
 *
 * **SHUTDOWN vs plain GameObjects — the trap for this manager.** `nightOverlay` is a plain
 * `Rectangle` with no Arcade physics body, but the SHUTDOWN rule from EnemyManager/BuildManager still
 * applies: Phaser's own scene teardown destroys every GameObject BEFORE this manager's SHUTDOWN
 * listener runs (a fresh SurvivalClock + overlay are constructed by the next `buildWorld()`). So
 * `destroy()` below may **only drop the stale `nightOverlay` reference** — it must **never** call
 * `.destroy()` on it (Phaser already has), or touch any other GameObject.
 */
export class SurvivalClock {
  clockMs = 0;
  dayPhase: DayPhase = 'day';
  dayCount = 1;
  hunger = HUNGER_MAX;
  starveElapsed = 0;

  /**
   * Night overlay — mirrors the fog rect's map size/centre but unmasked (a global dim, not a vision
   * hole) and at a higher depth (15, above the player at 10) so it darkens actors too. Non-interactive
   * (plain rects don't eat pointers) and below UIScene, so the HUD stays bright above it.
   *
   * Opacity is driven via the GameObject alpha (setAlpha) each frame from the day/night clock (see
   * tick()/applyClock()). The fill alpha MUST stay 1: Phaser renders a shape's fill at
   * fillAlpha × gameObjectAlpha, so a fillAlpha of 0 would pin the overlay invisible no matter what
   * setAlpha does. We start it transparent with setAlpha(0) (full day) rather than a 0 fill alpha.
   */
  readonly nightOverlay: Phaser.GameObjects.Rectangle;

  /**
   * Hidden Graphics whose filled circles (one per lit campfire) source the night overlay's INVERTED
   * geometry mask — filled areas become holes, so a lit fire punches a readable gap in the darkness.
   * Redrawn each {@link tick} (and after a manual clock jump — see {@link applyClock}) from
   * `deps.lightSources()`; empty ⇒ no holes ⇒ full night. Mirrors VisionController's `fogShape` mask.
   */
  private readonly lightShape: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: SurvivalClockDeps,
  ) {
    const { w, h } = deps.worldPx;
    this.nightOverlay = scene.add
      .rectangle(w / 2, h / 2, w, h, COLORS.night, 1)
      .setAlpha(0)
      .setDepth(15);
    // Campfire light: an inverted geometry mask over the overlay (filled circle ⇒ hole). Created once;
    // its shape is redrawn each frame. With no lit fires the shape is empty, so the overlay is
    // undimmed-nowhere — i.e. full night, exactly as before campfires existed.
    this.lightShape = scene.add.graphics().setVisible(false);
    const lightMask = this.lightShape.createGeometryMask();
    lightMask.setInvertAlpha(true);
    this.nightOverlay.setMask(lightMask);
    scene.registry.set('dayPhase', 'day');
    scene.registry.set('dayCount', 1);
    scene.registry.set('hunger', this.hunger); // seed so UIScene (Wellbeing screen) re-reads it on restart

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  // --- Per-frame tick --------------------------------------------------------------

  /**
   * Advance the day/night clock EVERY frame, above GameScene's no-action early-return, so time passes
   * whether or not a worker task is active. Drives the night-tint alpha; on a phase/day change, seeds
   * the registry (so a scene restart re-reads it) and emits `time:changed`. Hunger drains every frame
   * too (`drainHunger` clamps a big refocus delta to `[0,max]`); emits only when the displayed
   * (rounded) value changes. At zero the player starves: `STARVE_DAMAGE` every
   * `STARVE_DAMAGE_INTERVAL_MS` via `deps.damagePlayer` (the chop-interval accumulator idiom; the
   * `while` is bounded since it decrements). A fully-starved player thus loses HP and dies via
   * combat's `scene.restart()` death path — after which the next `buildWorld()` constructs a fresh
   * SurvivalClock, re-seeding full hunger via its field initializer.
   */
  tick(delta: number): void {
    this.clockMs += delta;
    const cycleMs = this.clockMs % cycleLengthMs();
    this.nightOverlay.setAlpha(tintAlphaAt(cycleMs));
    this.redrawLight(); // punch the lit-campfire holes into the darkness (empty ⇒ full night)
    const phase = phaseAt(cycleMs);
    const dayCount = dayCountForTotal(this.clockMs);
    if (phase !== this.dayPhase || dayCount !== this.dayCount) {
      this.dayPhase = phase;
      this.dayCount = dayCount;
      this.scene.registry.set('dayPhase', phase);
      this.scene.registry.set('dayCount', dayCount);
      this.scene.game.events.emit('time:changed', {
        phase,
        dayCount,
        cycleMs,
        tNorm: cycleMs / cycleLengthMs(),
      });
    }

    const hungerBefore = Math.round(this.hunger);
    this.hunger = drainHunger(this.hunger, delta, HUNGER_DRAIN_PER_SEC, HUNGER_MAX);
    if (Math.round(this.hunger) !== hungerBefore) {
      this.scene.registry.set('hunger', this.hunger);
      this.scene.game.events.emit('hunger:changed', { hunger: this.hunger, max: HUNGER_MAX });
    }
    if (isStarving(this.hunger)) {
      this.starveElapsed += delta;
      while (this.starveElapsed >= STARVE_DAMAGE_INTERVAL_MS) {
        this.starveElapsed -= STARVE_DAMAGE_INTERVAL_MS;
        // TEMP stopgap (plan 018 critique #1): hunger still ticks/displays above regardless; only the
        // lethal HP drain is gated off until the start map has authored food. Delete this `if` (and
        // HUNGER_LETHAL in config.ts) once food lands / the flag is flipped true.
        if (HUNGER_LETHAL) {
          this.deps.damagePlayer(STARVE_DAMAGE);
        }
      }
    } else {
      this.starveElapsed = 0;
    }
  }

  // --- Dev menu / eat ---------------------------------------------------------------

  /**
   * Dev menu: flip the day/night clock to the opposite phase of the current in-game day, jumping
   * straight to full daylight / full dark rather than riding the twilight ramp. Stays within the
   * current cycle so the day count doesn't change.
   */
  toggleDayNight(): void {
    const cycleMs = this.clockMs % cycleLengthMs();
    const cycleStart = this.clockMs - cycleMs; // ms at the start of the current in-game day
    // day -> start of night (full-dark plateau); night -> just past dawn (full daylight, same day).
    this.clockMs = cycleStart + (phaseAt(cycleMs) === 'day' ? DAY_MS : TWILIGHT_MS);
    this.applyClock();
  }

  /**
   * Recompute the night-tint overlay + phase/day from `clockMs` and broadcast `time:changed`. The
   * per-frame survival tick does the same inline but only emits on a phase/day *change* — this forces
   * the update (and re-emit) after a manual clock jump (see toggleDayNight).
   */
  private applyClock(): void {
    const cycleMs = this.clockMs % cycleLengthMs();
    this.nightOverlay.setAlpha(tintAlphaAt(cycleMs));
    this.redrawLight();
    this.dayPhase = phaseAt(cycleMs);
    this.dayCount = dayCountForTotal(this.clockMs);
    this.scene.registry.set('dayPhase', this.dayPhase);
    this.scene.registry.set('dayCount', this.dayCount);
    this.scene.game.events.emit('time:changed', {
      phase: this.dayPhase,
      dayCount: this.dayCount,
      cycleMs,
      tNorm: cycleMs / cycleLengthMs(),
    });
  }

  /** Redraw the night-overlay mask shape from the current lit campfires — one filled circle per fire
   *  becomes a hole in the darkness. Cleared + refilled each call so the holes track fuel/lit changes;
   *  an empty shape (no lit fires) means no holes, i.e. full night. */
  private redrawLight(): void {
    this.lightShape.clear();
    this.lightShape.fillStyle(0xffffff);
    for (const l of this.deps.lightSources()) this.lightShape.fillCircle(l.x, l.y, l.radius);
  }

  /**
   * Eat one unit of an edible item: spend it from the bag and restore its `nutrition` to hunger.
   * Returns false (a no-op) if the item isn't edible or none is held. Wired to the `needs:eat` event
   * the Wellbeing screen (UIScene) emits; `spend` already fires the inventory `'change'` for the HUD.
   */
  eat(itemId: string): boolean {
    const def = ITEMS[itemId];
    if (def?.nutrition == null || !this.deps.canAfford({ [itemId]: 1 })) return false;
    this.deps.spend({ [itemId]: 1 });
    this.hunger = feed(this.hunger, def.nutrition, HUNGER_MAX);
    this.scene.registry.set('hunger', this.hunger);
    this.scene.game.events.emit('hunger:changed', { hunger: this.hunger, max: HUNGER_MAX });
    return true;
  }

  /** `needs:eat` handler — the Wellbeing screen taps an edible; forward to `eat`. */
  onNeedsEat({ itemId }: { itemId: string }): void {
    this.eat(itemId);
  }

  // --- Reset / teardown --------------------------------------------------------------

  /**
   * SHUTDOWN: this run's overlay is going away with the rest of this manager instance (a fresh
   * SurvivalClock + overlay are constructed by the next `buildWorld()`) — Phaser's own scene teardown
   * already destroys every GameObject on a death-restart, so this just drops the stale reference. See
   * class doc's SHUTDOWN note: NEVER call `.destroy()` on `nightOverlay` here, Phaser already has.
   */
  private destroy(): void {
    // Drop the stale reference only — see class doc. `nightOverlay` isn't reassignable (readonly), so
    // there's nothing else for this method to safely do; it exists to document/enforce the rule.
  }
}
