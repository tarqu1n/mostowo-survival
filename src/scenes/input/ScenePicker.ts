import type { Action } from '../../systems/tasks';
import { worldToTile } from '../../systems/grid';
import { hurtboxContains, DEFAULT_HURTBOX } from '../../systems/hurtbox';
import { treeStats, wallStats, enemyStats, campfireStats } from '../../systems/stats';
import type { PointerPick, TreeNode, BuildSite, CampfireUnit } from '../../entities/types';
import type { MonsterCharacter } from '../../entities/MonsterCharacter';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link ScenePicker} needs but doesn't own — GameScene supplies these as closures
 * over its own private fields/methods at construction (plan 013 Step 6 coupling rules, carried into
 * plan 015: managers get narrow interfaces, not raw field access, and never a direct manager↔manager
 * edge — the scene mediates). Each closure returns the manager's raw backing array/list — see
 * EnemyManager.all()/ResourceNodeManager.all()/BuildManager.allSites() for why "raw, alive AND dead"
 * matters (pickSpriteAt does its own `alive` filtering on top).
 */
export interface ScenePickerDeps {
  /** Every enemy, alive AND dead (EnemyManager.all()) — pickSpriteAt filters `alive` itself. */
  enemies(): MonsterCharacter[];
  /** Every resource node, alive AND dead (ResourceNodeManager.all()) — pickSpriteAt filters `alive`
   *  itself. */
  trees(): TreeNode[];
  /** Every placed site, built + unbuilt, in placement order (BuildManager.allSites()). */
  allSites(): readonly BuildSite[];
  /** Every built campfire (CampfireManager.all()) — picked over its own (hidden) site rect by draw order. */
  campfires(): CampfireUnit[];
}

/**
 * Pointer "raycast" + the tap/inspect intent built on top of it (plan 015 Step 5) — moved verbatim out
 * of GameScene. Resolves the topmost world entity under a world point (enemy-over-tree-over-site by
 * draw order) and turns that into either a Command-mode {@link Action} (`actionAt`) or an Inspect-mode
 * stats-panel show/hide (`inspectAt`).
 *
 * **Stateless — deliberately no `once(SHUTDOWN)` teardown.** Every other manager in `scenes/world/`,
 * `scenes/build/`, and `scenes/fx/` owns GameObjects or mutable per-run data (sprites, timers, counters)
 * and so wires a SHUTDOWN listener to drop stale references before the next `buildWorld()`. This class
 * owns NEITHER: it holds only the two constructor params below (`scene` and `deps`), both injected
 * references the *scene* owns and re-supplies fresh on every (re)start — there is nothing here for a
 * SHUTDOWN hook to ever clean up. A future extraction that copies this file as a template should NOT
 * cargo-cult a `destroy()`/SHUTDOWN wire-up unless it actually starts holding owned state.
 *
 * `order`/`enqueue` (deciding what to DO with an action once resolved) stay scene-owned — this class
 * only resolves *what's under the pointer*, never touches the task queue.
 */
export class ScenePicker {
  constructor(
    private readonly scene: GameScene,
    private readonly deps: ScenePickerDeps,
  ) {}

  // --- Command-mode intent ---------------------------------------------------

  /** The order implied by a world point: harvest the live tree whose sprite is drawn under it (see
   * pickSpriteAt — the raycast, not the foot tile), else move to that tile. A pick that isn't a tree
   * (an enemy, a blueprint — neither is a Command-mode harvest target) also falls through to move. */
  actionAt(x: number, y: number): Action {
    const pick = this.pickSpriteAt(x, y);
    if (pick?.kind === 'tree') return { kind: 'harvest', treeId: pick.tree.id };
    return { kind: 'move', col: worldToTile(x), row: worldToTile(y) };
  }

  /** The campfire whose *sprite* is drawn under world point (x,y), if the topmost picked entity is a
   * campfire (same forgiving raycast as {@link inspectAt} — a foot-tile hit OR an opaque sprite pixel),
   * else null. Command-mode tap-to-feed keys off this so tapping anywhere on the fire (its flame reaches
   * a tile or two above its foot tile — it's bottom-anchored + multi-tile) feeds it, not just the exact
   * foot tile a bare worldToTile would demand. */
  campfireAt(x: number, y: number): CampfireUnit | null {
    const pick = this.pickSpriteAt(x, y);
    return pick?.kind === 'campfire' ? pick.campfire : null;
  }

  // --- Inspect-mode intent ----------------------------------------------------

  /** Inspect-mode tap: raycast the sprite drawn under the point (pickSpriteAt already resolves the
   * enemy-over-tree-over-blueprint priority by draw order) and show that entity's stats panel;
   * empty ground closes any open panel. */
  inspectAt(x: number, y: number): void {
    const pick = this.pickSpriteAt(x, y);
    if (pick?.kind === 'enemy')
      return void this.scene.game.events.emit('inspect:show', enemyStats(pick.enemy));
    if (pick?.kind === 'tree')
      return void this.scene.game.events.emit('inspect:show', treeStats(pick.tree));
    if (pick?.kind === 'site')
      return void this.scene.game.events.emit('inspect:show', wallStats(pick.site));
    if (pick?.kind === 'campfire')
      return void this.scene.game.events.emit('inspect:show', campfireStats(pick.campfire));
    this.scene.game.events.emit('inspect:hide');
  }

  // --- Raycast -----------------------------------------------------------------

  /**
   * Pointer "raycast": the topmost world entity under world point (x,y) — the *rendered sprite* the
   * player sees there, not merely the tile beneath the point. Each candidate is hit either on its
   * logical footprint (a node's foot tile, an enemy's hurtbox tiles, a site's tile — so the base a
   * thing stands on is always a reliable target, even where the art is transparent between the feet)
   * OR on an opaque pixel of its drawn sprite (so a tall base-anchored pine, whose canopy is drawn
   * several tiles above its foot tile, is clickable up its whole trunk — which the old foot-tile
   * hit-test missed). Overlaps resolve the way they're drawn: higher depth wins, ties break on
   * display order (drawn later = on top), so an enemy in front of a tree — or the nearer of two
   * overlapping pines — is the thing you click. Returns null when nothing is under the point (caller
   * falls back to move-to-tile).
   */
  private pickSpriteAt(x: number, y: number): PointerPick | null {
    const col = worldToTile(x);
    const row = worldToTile(y);
    let best: { pick: PointerPick; depth: number; order: number } | null = null;
    const consider = (
      obj: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle,
      pick: PointerPick,
    ): void => {
      const order = this.scene.children.getIndex(obj);
      if (!best || obj.depth > best.depth || (obj.depth === best.depth && order > best.order)) {
        best = { pick, depth: obj.depth, order };
      }
    };
    for (const z of this.deps.enemies()) {
      if (!z.alive) continue;
      const footprint = hurtboxContains(
        { col: z.col, row: z.row },
        z.def.hurtbox ?? DEFAULT_HURTBOX,
        { col, row },
      );
      if (footprint || this.alphaHit(z.sprite, x, y))
        consider(z.sprite, { kind: 'enemy', enemy: z });
    }
    for (const t of this.deps.trees()) {
      if (!t.alive) continue;
      if ((t.col === col && t.row === row) || this.alphaHit(t.sprite, x, y))
        consider(t.sprite, { kind: 'tree', tree: t });
    }
    for (const s of this.deps.allSites()) {
      // An unbuilt blueprint is a plain rectangle (no texture) — its filled tile IS its shape, so an
      // on-tile hit is a cover; a finished wall has a sprite, so alpha-test it like any other node.
      const obj = s.visual ?? s.rect;
      const spriteHit = s.visual ? this.alphaHit(s.visual, x, y) : obj.getBounds().contains(x, y);
      if ((s.col === col && s.row === row) || spriteHit) consider(obj, { kind: 'site', site: s });
    }
    // A built campfire's fire sprite is created after (and over) its now-hidden site rect, so it wins
    // the pick tie-break by draw order — inspecting a built fire yields the campfire, not its site.
    for (const c of this.deps.campfires()) {
      if ((c.col === col && c.row === row) || this.alphaHit(c.sprite, x, y))
        consider(c.sprite, { kind: 'campfire', campfire: c });
    }
    return best ? (best as { pick: PointerPick }).pick : null;
  }

  /**
   * Does an opaque pixel of `s`'s sprite cover world point (x,y)? A cheap AABB reject first, then a
   * per-pixel alpha read at the mapped texel — so a click in a pine's transparent canopy padding is
   * not a hit. World sprites here are axis-aligned and scroll with the world (no rotation, default
   * scrollFactor), so the world→texel map is a straight origin/scale/flip transform. Degrades to the
   * AABB hit if the pixel can't be read (e.g. a texture whose source canvas isn't sampleable) rather
   * than silently missing.
   */
  private alphaHit(
    s: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite,
    x: number,
    y: number,
  ): boolean {
    if (!s.getBounds().contains(x, y)) return false;
    let localX = (x - s.x) / s.scaleX + s.displayOriginX;
    let localY = (y - s.y) / s.scaleY + s.displayOriginY;
    if (s.flipX) localX = s.frame.width - localX;
    if (s.flipY) localY = s.frame.height - localY;
    try {
      const alpha = this.scene.textures.getPixelAlpha(
        Math.floor(localX),
        Math.floor(localY),
        s.texture.key,
        s.frame.name,
      );
      return alpha === null ? false : alpha > 0;
    } catch {
      return true; // texture source not sampleable — fall back to the AABB hit already confirmed above
    }
  }
}
