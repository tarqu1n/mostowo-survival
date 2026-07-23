import Phaser from 'phaser';
import {
  BASE_WIDTH,
  BASE_HEIGHT,
  COLORS,
  DAY_MS,
  TILE_SIZE,
  TWILIGHT_MS,
  HUNGER_MAX,
  HUNGER_DRAIN_PER_SEC,
  HUNGER_LETHAL,
  STARVE_DAMAGE,
  STARVE_DAMAGE_INTERVAL_MS,
  TIME_PROGRESS_EMIT_MS,
  EAT_COOLDOWN_MS,
} from '../../config';
import { bakeLightBrush } from '../../render/lightTexture';
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
  /** World-space light discs (the behavior-neutral light-source seam — StructureManager.lightSources()
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
 * **Sole writer of the night light-layer, and owner of the campfire-light reveal.** Per the plan's
 * ownership rule ("ownership follows the writer"), the layer that darkens the world at night lives
 * here, not on VisionController or any other manager — every write (the per-frame tick and a manual
 * `toggleDayNight` jump) funnels through this class. Plan 039 Step 2 replaced the old map-sized dark
 * `Rectangle` + inverted geometry mask with a **screen-covering RenderTexture** ({@link nightRT}):
 * each frame it clears, fills with the night colour at `tintAlphaAt()` alpha, then for each lit fire
 * (`deps.lightSources()`) **erases** a soft radial brush ({@link render/lightTexture}) — punching a
 * SOFT reveal that fades to black at its rim (a gradient the old binary mask couldn't do). Night is
 * now fully opaque (`NIGHT_MAX_ALPHA` 1.0), so darkness CONCEALS: away from a fire the world — and any
 * approaching enemy + its attack tells — is invisible (the overlay sits at depth 15, above all
 * gameplay actors/FX < 15). Overlapping fires brighten in the seam (each erase clears more).
 *
 * **Screen-space vs world-space (the flagged transform).** The RT is a **world-space** GameObject
 * (default scrollFactor) sized to the viewport, re-centred each frame on the camera's `midPoint`. It
 * is deliberately NOT `setScrollFactor(0)` + a manual world→screen transform: a scrollFactor(0) object
 * is still ZOOMED by the camera (Phaser applies zoom in the camera matrix regardless of scroll
 * factor), and the true screen transform carries a `(viewport/2)(1−zoom)` term the naive
 * `(x−scrollX)·zoom` omits — both make the naive approach mis-scale at zoom≠1. Keeping the RT in world
 * space lets the camera's own (proven) transform draw it 1:1 over the viewport at every zoom/scroll,
 * so the erase math is just `light.world − rtTopLeft.world` with NO manual screen conversion. The RT
 * is viewport-sized (never map-sized — see the mobile-texture ban in docs/RENDERING.md), oversized by
 * a small margin to cover the one-frame camera-follow lag.
 *
 * Constructed fresh in `buildWorld()` each (re)start, at the exact point the old inline night-overlay
 * block used to run. Unlike `ResourceNodeManager`/`EnemyManager`, its constructor DOES have real
 * side effects (seeding the registry's `dayPhase`/`dayCount`/`hunger` keys) — this mirrors what the
 * old inline block did at the same point, and is safe since nothing here reaches for player state.
 *
 * **SHUTDOWN vs plain GameObjects — the trap for this manager.** `nightRT` (a RenderTexture) and the
 * hidden erase `brush` (an Image) are plain GameObjects with no Arcade physics body, but the SHUTDOWN
 * rule from EnemyManager/BuildManager still applies: Phaser's own scene teardown destroys every
 * GameObject BEFORE this manager's SHUTDOWN listener runs (a fresh SurvivalClock + RT are constructed
 * by the next `buildWorld()`). So `destroy()` below may **only drop the stale references** — it must
 * **never** call `.destroy()` on them (Phaser already has), or touch any other GameObject.
 */
export class SurvivalClock {
  clockMs = 0;
  dayPhase: DayPhase = 'day';
  dayCount = 1;
  hunger = HUNGER_MAX;
  starveElapsed = 0;
  /** Scene-clock time until which eating is on cooldown — a further eat before this is rejected (the
   *  anti-spam gate, {@link EAT_COOLDOWN_MS}). Fresh per scene (rebuilt each buildWorld), so a restart
   *  clears it. Mirrors the `meleeReadyAt`/`bowReadyAt` cooldown idiom on PlayerCharacter. */
  eatReadyAt = 0;

  /** Accumulator for the throttled `time:progress` HUD tick (see {@link tick}). Emits at most every
   *  `TIME_PROGRESS_EMIT_MS` of game time so the day/night dial sweeps without a per-frame event. */
  private progressElapsed = 0;

  /**
   * Night light-layer — a world-space RenderTexture, depth 15 (above the player at 10, so it darkens
   * actors too), re-centred each frame on the camera and composited from the clock + lit fires (see
   * {@link composite}). Non-interactive (a RenderTexture doesn't eat pointers) and below UIScene, so
   * the HUD stays bright above it. Sized to the viewport (+ a small follow-lag margin), NEVER the map
   * (the mobile-texture ban — see docs/RENDERING.md); world-space so the camera draws it 1:1 at any
   * zoom (see class doc). Starts transparent (composited at the current clock alpha in the ctor).
   */
  private nightRT: Phaser.GameObjects.RenderTexture;

  /**
   * Hidden Image carrying the baked radial light brush ({@link render/lightTexture}) — the erase stamp
   * {@link composite} punches into {@link nightRT}, one scaled draw per lit fire. Invisible in the
   * scene (never rendered by the display list), but `RenderTexture.erase` draws it into the RT
   * directly regardless. Its scale is set per-fire from that fire's light radius.
   */
  private brush: Phaser.GameObjects.Image;

  /** Brush canvas edge length (px) — the scale divisor for a fire's world radius (see {@link composite}). */
  private readonly brushSize: number;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: SurvivalClockDeps,
  ) {
    // Viewport-sized (design space), oversized by a couple of tiles so the one-frame camera-follow lag
    // never exposes an unlit edge; world-space, so the camera's own zoom/scroll draws it over the view.
    const rtW = BASE_WIDTH + 2 * TILE_SIZE;
    const rtH = BASE_HEIGHT + 2 * TILE_SIZE;
    const cam = scene.cameras.main;
    this.nightRT = scene.add
      .renderTexture(cam.midPoint.x, cam.midPoint.y, rtW, rtH)
      .setOrigin(0.5, 0.5)
      .setDepth(15);
    const brush = bakeLightBrush(scene);
    this.brushSize = brush.size;
    this.brush = scene.add.image(0, 0, brush.key).setVisible(false);

    this.composite(this.clockMs % cycleLengthMs()); // seed the layer at the boot clock (no emit)
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
    this.composite(cycleMs); // dark fill at the clock alpha + soft reveals around lit fires
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

    // Continuous dial sweep: `time:changed` above fires only on a transition (its game consumers must
    // not run every frame), so the HUD dial's marker/progress ring would sit frozen for the whole day.
    // Push a throttled HUD-only `time:progress` with the live cycle position instead. See config note.
    this.progressElapsed += delta;
    if (this.progressElapsed >= TIME_PROGRESS_EMIT_MS) {
      this.progressElapsed = 0;
      this.scene.game.events.emit('time:progress', { tNorm: cycleMs / cycleLengthMs() });
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
    this.composite(cycleMs);
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

  /**
   * Composite the night light-layer for a point in the cycle: re-centre the RT over the camera, clear
   * it, fill the whole thing with `COLORS.night` at `tintAlphaAt(cycleMs)` alpha, then for each lit
   * fire erase the soft brush (scaled to that fire's radius) — punching a SOFT reveal that fades to
   * black at its rim. No lit fires ⇒ no erases ⇒ full dark. Overlapping fires brighten in the seam
   * (each `erase` clears more of the already-reduced alpha). Cheap: one fill + ~one textured-quad
   * erase per fire, no mask/framebuffer passes.
   *
   * World→texture transform: the RT is world-space, origin-centred on `cam.midPoint`, drawn 1:1 by the
   * camera at any zoom, so a fire at world `(l.x,l.y)` erases at texture-local `(l.x−left, l.y−top)`
   * where `(left,top)` is the RT's world top-left — NO manual screen/zoom conversion (see class doc).
   * The brush stamp (origin 0.5, `brushSize` px) scales by `2·radius / brushSize` so it spans the
   * fire's diameter.
   */
  private composite(cycleMs: number): void {
    const rt = this.nightRT;
    const cam = this.scene.cameras.main;
    const cx = cam.midPoint.x;
    const cy = cam.midPoint.y;
    rt.setPosition(cx, cy);
    rt.clear();
    const alpha = tintAlphaAt(cycleMs);
    rt.fill(COLORS.night, alpha);
    if (alpha <= 0) return; // fully lit day — nothing to reveal, skip the erases
    const left = cx - rt.width / 2;
    const top = cy - rt.height / 2;
    for (const l of this.deps.lightSources()) {
      this.brush.setScale((2 * l.radius) / this.brushSize);
      rt.erase(this.brush, l.x - left, l.y - top);
    }
  }

  /**
   * Eat one unit of an edible item: spend it from the bag and restore its `nutrition` to hunger.
   * Returns false (a no-op) if the item isn't edible or none is held. Wired to the `needs:eat` event
   * the Wellbeing screen (UIScene) emits; `spend` already fires the inventory `'change'` for the HUD.
   */
  eat(itemId: string): boolean {
    const def = ITEMS[itemId];
    // Cooldown gate BEFORE the spend, so a rejected (too-soon) eat never consumes an item — mirrors the
    // melee/bow readiness gate. The HUD greys the food slot for the same window, but this is the authority.
    if (
      def?.nutrition == null ||
      this.scene.time.now < this.eatReadyAt ||
      !this.deps.canAfford({ [itemId]: 1 })
    )
      return false;
    this.deps.spend({ [itemId]: 1 });
    this.eatReadyAt = this.scene.time.now + EAT_COOLDOWN_MS;
    const before = this.hunger;
    this.hunger = feed(this.hunger, def.nutrition, HUNGER_MAX);
    this.scene.registry.set('hunger', this.hunger);
    this.scene.game.events.emit('hunger:changed', { hunger: this.hunger, max: HUNGER_MAX });
    // Feedback pulse for the HUD (the "you ate something" indicator on the hunger meter). Carries the
    // ACTUAL hunger gained (capped at HUNGER_MAX), so eating near-full honestly shows the smaller gain,
    // plus the cooldown window so the HUD can run the shrinking sweep over the food slot.
    this.scene.game.events.emit('needs:fed', {
      amount: Math.round(this.hunger - before),
      cooldownMs: EAT_COOLDOWN_MS,
    });
    return true;
  }

  /** `needs:eat` handler — the Wellbeing screen taps an edible; forward to `eat`. */
  onNeedsEat({ itemId }: { itemId: string }): void {
    this.eat(itemId);
  }

  // --- Reset / teardown --------------------------------------------------------------

  /**
   * SHUTDOWN: this run's `nightRT` + `brush` are going away with the rest of this manager instance (a
   * fresh SurvivalClock + RT are constructed by the next `buildWorld()`) — Phaser's own scene teardown
   * already destroys every GameObject on a death-restart, so this just drops the stale references. See
   * class doc's SHUTDOWN note: NEVER call `.destroy()` on them here, Phaser already has. A RenderTexture
   * left dangling would throw on the next restart's teardown — this is the restart trap for this manager.
   */
  private destroy(): void {
    // Drop the stale references only — see class doc. Null them so a late tick can't touch a
    // Phaser-destroyed GameObject; a fresh RT/brush are built by the next buildWorld().
    this.nightRT = undefined as unknown as Phaser.GameObjects.RenderTexture;
    this.brush = undefined as unknown as Phaser.GameObjects.Image;
  }
}
