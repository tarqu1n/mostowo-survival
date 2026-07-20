import Phaser from 'phaser';
import { PLAYER_START_VISION } from '../../config';
import type { CharacterSprite } from '../../entities/Character';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link VisionController} needs but doesn't own — GameScene supplies these as
 * closures over its own private fields at construction (plan 015 Step 4 coupling rules, carried from
 * plan 013: managers get narrow interfaces, not raw field access).
 */
export interface VisionControllerDeps {
  /** The live player sprite — update()/inVisionRange read its x/y, and update() toggles its
   *  visibility outside the vision radius. */
  getPlayerSprite(): CharacterSprite;
  /** Raw vision-radius stat (`playerChar.stats.vision` — optional per `BaseStats`); this manager
   *  applies the `PLAYER_START_VISION` fallback itself (see {@link vision}), same as the original
   *  inline `updateVision`/`inVisionRange` did. */
  getVision(): number | undefined;
  /** World-space light discs (the behavior-neutral light-source seam — StructureManager.lightSources()
   *  today, via the scene, no manager↔manager edge). Each is also filled into the fog shape so the
   *  depth-5 dim rect is revealed around a lit source (plan 012). Empty ⇒ the reveal is just the player
   *  circle, as before. */
  lightSources(): readonly { x: number; y: number; radius: number }[];
  /** World pixel extent (loaded map's width/height in px) — the dim rect spans this instead of the
   *  old fixed `MAP_WIDTH`/`MAP_HEIGHT` (plan 018 A9: runtime map loader, world extent now derives
   *  from the loaded map rather than a compile-time constant). */
  worldPx: { w: number; h: number };
}

/**
 * Fog-of-war (plan 015 Step 4) — moved verbatim out of GameScene. Owns `fogShape`: a hidden Graphics
 * whose filled circle is the source shape for an inverted geometry mask (a "hole" at the vision
 * radius), applied to a semi-transparent depth-5 rect that dims static world content (ground/trees/
 * walls, depths 0-4) but sits below the ghost (6) and player (10), so they're unaffected by it.
 * Dynamic actors instead hide themselves entirely outside vision (see {@link update}) — since a
 * second full-screen overlay can't selectively cover "just the actors" without also re-covering the
 * static content underneath.
 *
 * **Does NOT own `nightOverlay`.** Per the plan's ownership rule ("ownership follows the writer"),
 * the map-sized night-tint rect is a different mechanism (a global dim, not a vision hole) that only
 * ever sat *adjacent* to the fog block in `buildWorld()` — it belongs to `SurvivalClock` (plan 015
 * Step 3), the sole writer of its alpha. This manager touches neither `SurvivalClock` nor its
 * overlay.
 *
 * Constructed fresh in `buildWorld()` each (re)start, at the exact point the old inline fog-of-war
 * block used to run — after the player exists (the constructor's initial {@link update} call reads
 * the player's position/vision immediately, mirroring what the old inline `this.updateVision()` did
 * at the same point). Wires its own SHUTDOWN teardown directly.
 *
 * **SHUTDOWN vs plain GameObjects — the trap for this manager.** `fogShape` is a plain `Graphics`
 * with no Arcade physics body, but the same rule as `SurvivalClock`'s `nightOverlay` /
 * `BuildManager`'s physics-tied teardown still applies in spirit here: Phaser's own scene teardown
 * destroys every GameObject BEFORE this manager's SHUTDOWN listener runs (a fresh VisionController +
 * fog are constructed by the next `buildWorld()`). So `destroy()` below may **only drop the stale
 * `fogShape` reference** — it must **never** call `.destroy()` or `.clear()` on it (Phaser already
 * has), or touch any other GameObject.
 */
export class VisionController {
  /**
   * Never rendered directly (`setVisible(false)`) — just the vision-radius mask's shape source,
   * redrawn each frame ({@link update}) to track the character.
   */
  private readonly fogShape: Phaser.GameObjects.Graphics;

  // `scene` isn't stored as a field — unlike the other managers, nothing here needs it past
  // construction (no later scene.add/scene.game.events calls), so it stays a plain constructor
  // parameter rather than an unused `this.scene` field.
  constructor(
    scene: GameScene,
    private readonly deps: VisionControllerDeps,
  ) {
    this.fogShape = scene.add.graphics().setVisible(false);
    const fogMask = this.fogShape.createGeometryMask();
    fogMask.setInvertAlpha(true);
    const { w, h } = deps.worldPx;
    scene.add
      .rectangle(w / 2, h / 2, w, h, 0x000000, 0.2)
      .setDepth(5)
      .setMask(fogMask);
    this.update();

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Redraws the vision-radius mask shape, and hides/shows dynamic actors by distance to it —
   * unlike static world content (dimmed by the terrain fog above), an actor outside vision is
   * fully invisible. Only the player exists to apply this to today; the same one-line check is
   * the pattern for any future monster/NPC sprite. */
  update(): void {
    const player = this.deps.getPlayerSprite();
    this.fogShape.clear();
    this.fogShape.fillStyle(0xffffff);
    this.fogShape.fillCircle(player.x, player.y, this.vision());
    // Lit light sources extend the reveal — each punches its own hole in the dim rect (plan 012). The
    // player's own visibility still keys only off their own circle (they're always inside it).
    for (const l of this.deps.lightSources()) this.fogShape.fillCircle(l.x, l.y, l.radius);
    player.setVisible(this.inVisionRange(player.x, player.y));
  }

  /** Resolved vision radius — the stat, falling back to {@link PLAYER_START_VISION} if unset. */
  private vision(): number {
    return this.deps.getVision() ?? PLAYER_START_VISION;
  }

  /** True if a world point is within the character's vision radius (see fog of war above). */
  private inVisionRange(x: number, y: number): boolean {
    const player = this.deps.getPlayerSprite();
    return Phaser.Math.Distance.Between(x, y, player.x, player.y) <= this.vision();
  }

  // --- Teardown --------------------------------------------------------------

  /**
   * SHUTDOWN: this run's `fogShape` is going away with the rest of this manager instance (a fresh
   * VisionController + fog are constructed by the next `buildWorld()`) — Phaser's own scene teardown
   * already destroys every GameObject on a death-restart, so this just drops the stale reference. See
   * class doc's SHUTDOWN note: NEVER call `.destroy()`/`.clear()` on `fogShape` here, Phaser already
   * has.
   */
  private destroy(): void {
    // Drop the stale reference only — see class doc. `fogShape` isn't reassignable (readonly), so
    // there's nothing else for this method to safely do; it exists to document/enforce the rule.
  }
}
