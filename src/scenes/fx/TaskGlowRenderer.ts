import Phaser from 'phaser';
import { COLORS, TILE_SIZE } from '../../config';
import { tileToWorldCenter } from '../../systems/grid';
import { bakeGlowTexture } from '../../render/glowTexture';
import { BUILDABLES } from '../../data/buildables';
import type { Action } from '../../systems/tasks';
import type { TreeNode, BuildSite, CampfireUnit } from '../../entities/types';
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
  /** Look up a built campfire by id (undefined once gone) — for the queued-refuel outline. */
  campfireById(id: string): CampfireUnit | undefined;
  /** Base display scale for a node's sprite (see GameScene.nodeScale) — the glow halo's radius is
   *  converted to source texels through this, so it reads the same regardless of source resolution. */
  nodeScale(sprite: Phaser.GameObjects.Image, def: ResourceNodeDef): number;
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

    for (const a of this.deps.queueActions()) {
      if (a.kind === 'harvest') {
        const tree = this.deps.treeById(a.treeId);
        if (tree?.alive) {
          this.addTreeGlow(tree, tree.id === headId);
          this.outlinedTreeIds.add(tree.id);
        }
      } else if (a.kind === 'build') {
        const site = this.deps.siteById(a.siteId);
        if (site && !site.done) site.rect.setStrokeStyle(2, COLORS.queued, 1);
      } else if (a.kind === 'refuel') {
        const c = this.deps.campfireById(a.campfireId);
        if (c) this.outlineCampfire(c);
      } else {
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
    const radius = Phaser.Math.Clamp(
      Math.round(GLOW_SCREEN_PX / this.deps.nodeScale(tree.sprite, tree.def)),
      2,
      16,
    );
    const glow = bakeGlowTexture(this.scene, tree.sprite.texture.key, COLORS.queued, radius);
    // Align the padded halo canvas onto the tree: its content sits `pad` texels in from every edge,
    // so the tree's display origin shifts by `pad` and the scale matches.
    const img = this.scene.add
      .image(tree.sprite.x, tree.sprite.y, glow.key)
      .setDisplayOrigin(
        tree.sprite.displayOriginX + glow.pad,
        tree.sprite.displayOriginY + glow.pad,
      )
      .setScale(tree.sprite.scaleX, tree.sprite.scaleY)
      .setDepth(tree.sprite.depth - 0.5); // between the ground (0) and the tree (1)
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
   * Outline a queued-for-refuel campfire: a yellow stroked rect over its whole `tilesTall` tile column
   * (bottom-anchored, so the column rises from the foot tile). Deliberately a stroked rect, NOT a baked
   * silhouette halo like {@link addTreeGlow}: bakeGlowTexture reads the sprite's *source image*, which
   * for the fire is the full multi-frame sheet (a 4-tile-wide smear), and the fire animates / flares /
   * swaps textures by fuel — three sync problems a static tree halo never has. The rect matches the
   * queued-*site* stroke style and is pushed into `queueMarkers` so {@link reset} tears it down.
   */
  outlineCampfire(c: CampfireUnit): void {
    const tilesTall = BUILDABLES.campfire.tilesTall ?? 1;
    const box = this.scene.add
      .rectangle(
        tileToWorldCenter(c.col),
        tileToWorldCenter(c.row) - (TILE_SIZE * (tilesTall - 1)) / 2, // centre over the tile column
        TILE_SIZE,
        TILE_SIZE * tilesTall,
        COLORS.queued,
        0, // no fill — outline only
      )
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
