import Phaser from 'phaser';
import { BUILDABLES } from '../../data/buildables';
import type { InspectableStats } from '../../data/types';
import type { BuildSite, PlacedStructure } from '../../entities/types';
import type { GameScene } from '../GameScene';

/** A world-space light disc a structure casts — the behavior-neutral seam SurvivalClock (night-overlay
 *  mask holes) and VisionController (fog reveal) both fill circles from. */
export interface LightSource {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * One live/simulated buildable's runtime, registered into {@link StructureManager} under its `behavior`
 * key (plan 037). A module OWNS its own homogeneous slice of {@link PlacedStructure}s (mints their ids,
 * creates + is the sole writer/destroyer of their sprites) and is constructed with its OWN narrow deps
 * — one registration line per buildable in `buildWorld()`, NOT one scene-level manager per buildable
 * (013/015 coupling rule). These are the AGGREGATED capability methods StructureManager fans out across
 * modules; `tick`/`lightSources` are optional (a wall has neither). Behavior-SPECIFIC operations
 * (campfire `feedOne`/`damageFire`, wall `takeDamage`/`deconstruct`/…) live on the concrete module and
 * are reached by a consumer through {@link StructureManager.behavior}.
 */
export interface StructureBehavior {
  /** Turn a completed build site into a live structure — mints the id, creates + owns its sprite(s)
   *  and state, and pushes it onto this module's collection. */
  materialise(site: BuildSite): void;
  /** Every live structure of this behavior (raw backing array) — the homogeneous view + queries. */
  all(): readonly PlacedStructure[];
  /** Inspect-panel stats for one of THIS behavior's structures (the caller passes a struct from
   *  {@link all}, so narrowing to the concrete state type is safe). */
  stats(struct: PlacedStructure): InspectableStats;
  /** The world-AABB a queued-order highlight should hug for one of THIS behavior's structures (the
   *  campfire hugs its base + fuel-scaled flame; the wall hugs its single sprite). */
  highlightBounds(struct: PlacedStructure): Phaser.Geom.Rectangle;
  /** Per-frame simulation (campfire fuel drain); omit for an event-driven behavior (the wall). */
  tick?(delta: number): void;
  /** Light discs this behavior's structures contribute (the lit campfires); omit for a non-emitter. */
  lightSources?(): readonly LightSource[];
  /** RUNTIME reset (scene alive): destroy every sprite + clear the collection — the DEV-only scenario
   *  reset. NEVER the SHUTDOWN path (see {@link destroy}). */
  reset(): void;
  /** SHUTDOWN teardown: drop references only — Phaser's own teardown already destroyed the sprites, so
   *  this must never call `sprite.destroy()` (see the modules' class docs). */
  destroy(): void;
}

/**
 * Owns the world's live/simulated buildables as a homogeneous {@link PlacedStructure} population behind
 * a behavior registry (plan 037 — the generalisation the campfire's plan-012 "generalise on buildable
 * #2" decision deferred, triggered here by the barricade wall being buildable #2). `buildWorld()`
 * constructs one {@link StructureBehavior} module per buildable (each with its own narrow deps) and
 * {@link register}s it under its `behavior` key; from then on every consumer talks to THIS single
 * route:
 *  - {@link materialise} dispatches a completed build site to the owning module (on `def.behavior`);
 *  - {@link tick}/{@link lightSources}/{@link reset}/{@link destroy} fan out / union across modules;
 *  - {@link all}/{@link at}/{@link byId}/{@link structuresOf} expose the homogeneous population for
 *    ScenePicker's pick, TaskGlowRenderer's queued-order outlines, and the worker-order lookups;
 *  - {@link stats}/{@link highlightBounds} dispatch a single struct back to its owning module.
 *
 * Behavior-SPECIFIC operations that only one buildable has (campfire feeding, wall deconstruct) are NOT
 * generalised here — a consumer reaches the concrete module via {@link behavior}, keeping this class
 * ignorant of any single behavior's shape.
 *
 * Wires ONE SHUTDOWN teardown that fans {@link StructureBehavior.destroy} out to every module (each
 * module drops its own references — the sprites are already gone; see the module class docs).
 */
export class StructureManager {
  private readonly modules = new Map<string, StructureBehavior>();

  constructor(scene: GameScene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Register a behavior module under its `behavior` key (called once per buildable in buildWorld()). */
  register(behaviorId: string, module: StructureBehavior): void {
    this.modules.set(behaviorId, module);
  }

  /** Fetch a registered module by its `behavior` key, typed by the caller — the seam a consumer uses to
   *  reach a behavior-SPECIFIC operation (campfire `feedOne`, wall `takeDamage`, …). Safe by
   *  construction: registration is fixed in buildWorld() and the caller names the behavior it built. */
  behavior<M extends StructureBehavior>(behaviorId: string): M {
    return this.modules.get(behaviorId) as M;
  }

  // --- Lifecycle / per-frame -----------------------------------------------------

  /** Hand a just-completed live buildable's site to its owning behavior module (dispatch on
   *  `def.behavior`). Called by `BuildManager.finishSite` only for buildables WITH a behavior. */
  materialise(site: BuildSite): void {
    this.modules.get(BUILDABLES[site.buildableId].behavior!)?.materialise(site);
  }

  /** Fan a per-frame tick out to every module that simulates (only the campfire today). */
  tick(delta: number): void {
    for (const m of this.modules.values()) m.tick?.(delta);
  }

  /** The union of every module's light discs (only lit campfires contribute today) — the single seam
   *  SurvivalClock + VisionController read via the scene. */
  lightSources(): readonly LightSource[] {
    const out: LightSource[] = [];
    for (const m of this.modules.values()) if (m.lightSources) out.push(...m.lightSources());
    return out;
  }

  // --- Queries (the homogeneous population) --------------------------------------

  /** Every live structure across all behaviors (fresh array; each element is the module's own record). */
  all(): PlacedStructure[] {
    const out: PlacedStructure[] = [];
    for (const m of this.modules.values()) out.push(...m.all());
    return out;
  }

  /** The structure occupying tile (col,row), or undefined. */
  at(col: number, row: number): PlacedStructure | undefined {
    return this.all().find((s) => s.col === col && s.row === row);
  }

  /** Look up a structure by id (undefined once gone) — worker orders re-resolve through this each frame
   *  so they tolerate a structure removed mid-order. */
  byId(id: string): PlacedStructure | undefined {
    return this.all().find((s) => s.id === id);
  }

  /** Every live structure of one behavior (the module's raw backing array). */
  structuresOf(behaviorId: string): readonly PlacedStructure[] {
    return this.modules.get(behaviorId)?.all() ?? [];
  }

  // --- Single-struct dispatch (back to the owning module) ------------------------

  /** Inspect-panel stats for a picked structure — dispatched to its owning behavior module. */
  stats(struct: PlacedStructure): InspectableStats {
    return this.modules.get(struct.behavior)!.stats(struct);
  }

  /** The world-AABB a queued-order highlight should hug for a structure — dispatched to its module. */
  highlightBounds(struct: PlacedStructure): Phaser.Geom.Rectangle {
    return this.modules.get(struct.behavior)!.highlightBounds(struct);
  }

  // --- Reset / teardown ----------------------------------------------------------

  /** RUNTIME reset (scene alive): fan out to every module's `reset` (destroy sprites + clear) — the
   *  DEV-only scenario reset. NOT the SHUTDOWN path (see {@link destroy}). */
  reset(): void {
    for (const m of this.modules.values()) m.reset();
  }

  /** SHUTDOWN: fan out to every module's `destroy` (each drops its own stale references — Phaser's own
   *  teardown already destroyed the sprites). Deliberately not {@link reset} (that destroys sprites,
   *  only safe while the scene is alive). */
  private destroy(): void {
    for (const m of this.modules.values()) m.destroy();
  }
}
