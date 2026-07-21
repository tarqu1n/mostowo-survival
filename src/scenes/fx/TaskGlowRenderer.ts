import Phaser from 'phaser';
import { COLORS } from '../../config';
import { tileToWorldCenter } from '../../systems/grid';
import { SUB_ROW_EPSILON } from '../../systems/mapFormat';
import { bakeGlowTexture } from '../../render/glowTexture';
import type { Action } from '../../systems/tasks';
import { ORDER_META, orderTargetId } from '../../systems/orders';
import type { TreeNode, BuildSite, PlacedStructure } from '../../entities/types';
import type { ResourceNodeDef } from '../../data/types';
import type { GameScene } from '../GameScene';

/** Queued-node glow reach on screen (px). Converted to source texels per species so the baked halo
 *  reads the same regardless of a sprite's source resolution — see {@link TaskGlowRenderer.addTreeGlow}. */
const GLOW_SCREEN_PX = 5;

/**
 * Narrow scene state {@link TaskGlowRenderer} needs but doesn't own — GameScene supplies these as
 * closures over its own queue/tree/site state at construction (plan 013 Step 6 coupling rules).
 */
export interface TaskGlowRendererDeps {
  /** All currently active/queued actions, in order — refreshQueueHighlights walks these. */
  queueActions(): Action[];
  /** Look up a live tree/rock/bush by id (undefined once it's gone). */
  treeById(id: string): TreeNode | undefined;
  /** Every placed build site — refreshQueueHighlights resets every site's stroke before re-applying
   *  it to the still-queued ones. */
  allSites(): readonly BuildSite[];
  /** Look up a build site by id. */
  siteById(id: string): BuildSite | undefined;
  /** Look up a built structure by id (undefined once gone) — for the queued-refuel/deconstruct outline. */
  structureById(id: string): PlacedStructure | undefined;
  /** The world-AABB a queued-order outline should hug for a structure (StructureManager.highlightBounds,
   *  dispatched to the owning behavior module — the campfire hugs base + flame, the wall its sprite). */
  structureBounds(struct: PlacedStructure): Phaser.Geom.Rectangle;
  /** Base display scale for a node's sprite (see GameScene.nodeScale) — the glow halo's radius is
   *  converted to source texels through this, so it reads the same regardless of source resolution.
   *  Pass the instance's skin so a per-skin `scale` override sizes the halo correctly. */
  nodeScale(def: ResourceNodeDef, skin?: { scale?: number }): number;
}

/**
 * Pure presentation over the task queue (plan 013 Step 6) — moved verbatim out of GameScene: the
 * yellow queue-move pips, the queued-build stroke, and the baked silhouette glow halo (+ its
 * head-of-queue pulse tween) on queued harvest targets. Reads the queue/trees/sites via the narrow
 * {@link TaskGlowRendererDeps} closures; owns no domain state, only the GameObjects/tween it draws.
 *
 * Constructed fresh in `create()` each (re)start (mirrors `PointerInputController`/`BuildManager` —
 * no GameObjects exist yet at field-initializer time); wires its own SHUTDOWN teardown directly.
 */
export class TaskGlowRenderer {
  private queueMarkers: Phaser.GameObjects.Rectangle[] = []; // yellow pips over queued move tiles
  private readonly outlinedTreeIds = new Set<string>(); // trees currently showing a queued-glow sprite
  private readonly glowSprites = new Map<string, Phaser.GameObjects.Image>(); // treeId → its glow halo image
  private glowPulse?: Phaser.Tweens.Tween; // breathing alpha tween on the head-of-queue glow

  constructor(
    private readonly scene: GameScene,
    private readonly deps: TaskGlowRendererDeps,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Outline every queued target in yellow (trees to harvest, sites to build) + pip queued move tiles. */
  refreshQueueHighlights(): void {
    for (const s of this.deps.allSites()) s.rect.isStroked = false;
    this.reset();

    // The head-of-queue harvest (first alive tree in queue order) pulses; the rest are static.
    const headId = this.headHarvestTreeId();

    // Draw each queued order's highlight by its kind's `ORDER_META.highlight` class (plan 043 Step 14)
    // — the three structure-tending kinds (refuel/deconstruct/rearm) all share the one `structure`
    // outline, keyed off the generic `orderTargetId`, so a new tending order needs no branch here.
    for (const a of this.deps.queueActions()) {
      const id = orderTargetId(a);
      switch (ORDER_META[a.kind].highlight) {
        case 'tree': {
          const tree = id ? this.deps.treeById(id) : undefined;
          if (tree?.alive) {
            this.addTreeGlow(tree, tree.id === headId);
            this.outlinedTreeIds.add(tree.id);
          }
          break;
        }
        case 'site': {
          const site = id ? this.deps.siteById(id) : undefined;
          if (site && !site.done) site.rect.setStrokeStyle(2, COLORS.queued, 1);
          break;
        }
        case 'structure': {
          const s = id ? this.deps.structureById(id) : undefined;
          if (s) this.outlineStructure(s);
          break;
        }
        case 'move': {
          if (a.kind === 'move')
            this.queueMarkers.push(
              this.scene.add
                .rectangle(
                  tileToWorldCenter(a.col),
                  tileToWorldCenter(a.row),
                  6,
                  6,
                  COLORS.queued,
                  0.85,
                )
                .setDepth(4),
            );
          break;
        }
      }
    }
  }

  /**
   * Draw a queued tree's soft silhouette glow: a baked halo texture (generated once per species, see
   * src/render/glowTexture.ts) placed behind the tree, aligned to the same origin + scale. `pulse`
   * (the head of queue) breathes via an alpha tween; the rest hold a static glow. Replaces the old
   * per-frame OutlineFX PostFX — no shader runs in the frame loop.
   */
  addTreeGlow(tree: TreeNode, pulse: boolean): void {
    const skin = tree.def.skins.find((s) => s.id === tree.skin);
    const radius = Phaser.Math.Clamp(
      Math.round(GLOW_SCREEN_PX / this.deps.nodeScale(tree.def, skin)),
      2,
      16,
    );
    const glow = bakeGlowTexture(
      this.scene,
      tree.sprite.texture.key,
      COLORS.queued,
      radius,
      tree.sprite.frame,
    );
    // Align the padded halo canvas onto the tree: its content sits `pad` texels in from every edge,
    // so the tree's display origin shifts by `pad` and the scale matches.
    const img = this.scene.add
      .image(tree.sprite.x, tree.sprite.y, glow.key)
      .setDisplayOrigin(
        tree.sprite.displayOriginX + glow.pad,
        tree.sprite.displayOriginY + glow.pad,
      )
      .setScale(tree.sprite.scaleX, tree.sprite.scaleY)
      // One sub-row epsilon below its own node — relative, so it tracks the node's base-row y-sort
      // depth and sits just under that node while staying INSIDE the node's own row slot. A larger
      // offset (this used to be a full 0.5) drops the halo below the integer tile-layer band: a node
      // near the top of the map sits at depth ~1.0x, so `-0.5` landed the halo at ~0.5x — under the
      // depth-1 ground layer — and shoreline/ground tiles drew over it (the halo read as "behind the
      // tiles"). Mirrors CampfireBehavior stacking its flame `+ SUB_ROW_EPSILON` above its base.
      .setDepth(tree.sprite.depth - SUB_ROW_EPSILON);
    this.glowSprites.set(tree.id, img);
    if (pulse) {
      img.setAlpha(0.65);
      this.glowPulse = this.scene.tweens.add({
        targets: img,
        alpha: 1,
        duration: 620,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }
  }

  /**
   * Outline a structure queued for a worker order (refuel a campfire / deconstruct a wall, plan 037): a
   * yellow stroked rect hugging the structure's rendered bounds (+ a small pad), so a marked target
   * reads the same as a queued build. The bounds come from the owning behavior module
   * (`deps.structureBounds` → StructureManager.highlightBounds): a campfire hugs the union of its
   * ember base + fuel-scaled flame (so the box tracks the actual fire instead of a fixed tile column
   * that dwarfed the small flame), a wall hugs its single sprite. Deliberately a stroked rect, NOT a
   * baked silhouette halo like {@link addTreeGlow}: a fire *animates* + *scales by fuel* and a wall
   * swaps HP-stage frames, so a single-frame baked halo would freeze on one shape and drift out of
   * sync. Matches the queued-*site* stroke; pushed into `queueMarkers` so {@link reset} tears it down.
   */
  outlineStructure(struct: PlacedStructure): void {
    const b = this.deps.structureBounds(struct);
    const pad = 4;
    const box = this.scene.add
      .rectangle(b.centerX, b.centerY, b.width + pad, b.height + pad, COLORS.queued, 0)
      .setStrokeStyle(2, COLORS.queued, 1)
      .setDepth(4);
    this.queueMarkers.push(box);
  }

  /**
   * Keep each queued tree's glow halo locked onto its tree. The glow is a sibling GameObject that
   * shares the tree's origin (the trunk base), so mirroring position/scale/rotation reproduces any
   * visual animation the tree plays — chop bounce, walk-past sway, fall — about the same pivot,
   * without every animation having to know the glow exists. Runs only for currently-glowing trees (a
   * handful), so the per-frame cost is trivial (nothing like the old per-frame PostFX pass).
   *
   * Keep tree *logic* (targeting, pathfinding, occupancy) keyed off `col`/`row`, never the animated
   * sprite transform — a sway or a mid-fall lean must not move the tree's logical tile.
   */
  syncGlowTransforms(): void {
    if (this.glowSprites.size === 0) return; // no queued-harvest halos → skip the Map-iterator alloc (plan 043 Step 15, perf item 3)
    for (const [id, glow] of this.glowSprites) {
      const s = this.deps.treeById(id)?.sprite;
      if (!s) continue;
      glow.setPosition(s.x, s.y);
      glow.setScale(s.scaleX, s.scaleY);
      glow.rotation = s.rotation;
    }
  }

  /** The tree the worker will chop next: first `harvest` in queue order whose tree is still alive.
   *  Also read by GameScene's debugState (as `pulsingTreeId`) — this is the one implementation. */
  headHarvestTreeId(): string | null {
    for (const a of this.deps.queueActions()) {
      if (a.kind === 'harvest' && this.deps.treeById(a.treeId)?.alive) return a.treeId;
    }
    return null;
  }

  /** Ids of trees currently showing a queued-glow (debugState's `outlinedTreeIds`) — a fresh array
   *  copy, named `getXxx` (not a bare getter) to avoid colliding with the verbatim-moved private
   *  `outlinedTreeIds` field (see CombatFxManager for the same convention). */
  getOutlinedTreeIds(): string[] {
    return [...this.outlinedTreeIds];
  }

  // --- Reset / teardown --------------------------------------------------------

  /** Tear down every glow/marker GameObject + the pulse tween and clear the outlined-id set — shared
   *  by refreshQueueHighlights (about to rebuild) and the DEV-only scenario reset (testResetWorld,
   *  via the facade) and destroy (final teardown, nothing rebuilds after). */
  reset(): void {
    for (const m of this.queueMarkers) m.destroy();
    this.queueMarkers = [];
    this.glowPulse?.remove();
    this.glowPulse = undefined;
    for (const g of this.glowSprites.values()) {
      this.scene.tweens.killTweensOf(g); // drop any live pulse/chop-bounce tween before destroying its target
      g.destroy();
    }
    this.glowSprites.clear();
    this.outlinedTreeIds.clear();
  }

  /** SHUTDOWN: flush this run's highlight GameObjects/tween — mirrors CombatFxManager's "flush
   *  wholesale" teardown. A fresh TaskGlowRenderer is constructed by the next create(). */
  private destroy(): void {
    this.reset();
  }
}
