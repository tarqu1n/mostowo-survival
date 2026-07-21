import type { Action } from '../../systems/tasks';
import { worldToTile } from '../../systems/grid';
import { hurtboxContains, DEFAULT_HURTBOX } from '../../systems/hurtbox';
import { treeStats, wallStats, enemyStats } from '../../systems/stats';
import { BUILDABLES } from '../../data/buildables';
import type {
  PointerPick,
  TreeNode,
  BuildSite,
  PlacedStructure,
  TrapState,
} from '../../entities/types';
import type { InspectableStats } from '../../data/types';
import type { MonsterCharacter } from '../../entities/MonsterCharacter';
import type { NpcCharacter } from '../../entities/NpcCharacter';
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
  /** Every live/simulated structure — campfires + barricade walls (StructureManager.all()) — each
   *  picked over its own (hidden) site rect by draw order, so a demolish-mode tap resolves a wall and
   *  inspecting a fire/wall reads its live state (plan 037). */
  structures(): readonly PlacedStructure[];
  /** Inspect-panel stats for a picked structure — routed to its owning behavior module
   *  (StructureManager.stats), so ScenePicker stays behavior-agnostic. */
  structureStats(struct: PlacedStructure): InspectableStats;
  /** The single AI companion, or null when none is spawned (CompanionManager.get()) — the
   *  assignment-menu open hit-test ({@link ScenePicker.companionAt}) reads it (plan 042 Step 9). */
  companion(): NpcCharacter | null;
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

  /** The order implied by a world point: harvest the live tree whose sprite is drawn under it, refuel
   * the campfire under it (a queued worker order — walk over and tend it, plan 016), else move to that
   * tile. Resolved off pickSpriteAt (the raycast, not the foot tile). A pick that's neither a tree nor
   * a campfire (an enemy, a blueprint) falls through to move. Because a campfire always resolves to
   * refuel here, tapping the fire can never fall through to a move onto its blocking tile. */
  actionAt(x: number, y: number): Action {
    const pick = this.pickSpriteAt(x, y);
    if (pick?.kind === 'tree') return { kind: 'harvest', treeId: pick.tree.id };
    if (pick?.kind === 'structure' && pick.structure.behavior === 'campfire')
      return { kind: 'refuel', campfireId: pick.structure.id };
    // A SPENT spike trap resolves to a rearm worker order (walk over + re-prime it, plan 040); an ARMED
    // trap has nothing to do, so it falls through to a plain move (its tile IS walkable — decision #5 —
    // so a move onto it is harmless; the trigger only queries enemies, never the worker).
    if (
      pick?.kind === 'structure' &&
      pick.structure.behavior === 'trap' &&
      !(pick.structure.state as TrapState).armed
    )
      return { kind: 'rearm', trapId: pick.structure.id };
    // A wall (or armed trap) falls through to a plain move to the tapped tile (deconstructing is a
    // DEMOLISH-mode-only intent — see GameScene's onTap + demolishMode; command-mode taps never unbuild
    // a wall).
    return { kind: 'move', col: worldToTile(x), row: worldToTile(y) };
  }

  // --- Demolish-mode intent --------------------------------------------------

  /** The barricade wall whose sprite is drawn under a world point, or undefined for a non-wall / empty
   *  ground. GameScene routes this to a `deconstruct` worker order only while DEMOLISH mode is on; it
   *  reuses the same raycast as command/inspect taps so a wall is hit on its foot tile or up its art. */
  wallAt(x: number, y: number): PlacedStructure | undefined {
    const pick = this.pickSpriteAt(x, y);
    return pick?.kind === 'structure' && pick.structure.behavior === 'wall'
      ? pick.structure
      : undefined;
  }

  // --- Companion-menu intent --------------------------------------------------

  /** The AI companion if its sprite is drawn under a world point — hit on its foot tile (a reliable
   *  target even where the art is transparent between the feet) OR an opaque pixel of its sprite, the
   *  same two-tier raycast trees/structures use. Else null. A thin standalone hit-test like
   *  {@link wallAt}: the NPC isn't in the general {@link pickSpriteAt} candidate list, so tapping it
   *  never competes with world entities for a draw-order pick — GameScene routes a hit to opening the
   *  assignment menu (plan 042 Step 9), a side effect, not one of the Command-mode {@link Action}s. */
  companionAt(x: number, y: number): NpcCharacter | null {
    const npc = this.deps.companion();
    if (!npc) return null;
    const col = worldToTile(x);
    const row = worldToTile(y);
    const foot = npc.tile();
    if ((foot.col === col && foot.row === row) || this.alphaHit(npc.sprite, x, y)) return npc;
    return null;
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
    if (pick?.kind === 'structure')
      return void this.scene.game.events.emit(
        'inspect:show',
        this.deps.structureStats(pick.structure),
      );
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
    // A built structure's sprite is created after (and over) its now-hidden site rect, so it wins the
    // pick tie-break by draw order — a fire/wall tile resolves to the structure (its live state), not
    // its site. Hit-test its whole `tilesTall` tile column (foot tile + the tiles a bottom-anchored
    // sprite rises into) OR an opaque pixel of the base sprite. The column matters for the CAMPFIRE
    // (tilesTall 3): its flame sheet swaps by fuel (plan 016) and its low-fuel ember frames have a tiny
    // opaque region, so an alpha-only test would flicker-miss and fall through to a move onto the fire's
    // blocking tile. The WALL has no `tilesTall` in data (→ 1), so its column collapses to the foot tile
    // (the stake art sits at the bottom of its frame, no rising flame to reach for) — identical to the
    // old dedicated wall pick.
    for (const s of this.deps.structures()) {
      const tilesTall = BUILDABLES[s.buildableId].tilesTall ?? 1;
      const inColumn = col === s.col && row <= s.row && row > s.row - tilesTall;
      if (inColumn || this.alphaHit(s.sprite, x, y))
        consider(s.sprite, { kind: 'structure', structure: s });
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
