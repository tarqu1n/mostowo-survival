import Phaser from 'phaser';
import { COLORS } from '../../config';
import { breadcrumb } from '../../debug/crashReporter';
import { NODES } from '../../data/nodes';
import type { ResourceNodeDef } from '../../data/types';
import type { ParsedNodeDef, NormalizedNodeSkinDef } from '../../systems/nodeDefs';
import { tileToWorldCenter } from '../../systems/grid';
import { parseAssetId } from '../../render/assetPaths';
import { resolveDecorDraw } from '../../render/decorSprites';
import type { TreeNode } from '../../entities/types';
import { rowDepthOffset, type NodeObject } from '../../systems/mapFormat';
import type { ChopFxInput, FellFxInput } from '../fx/NodeFxManager';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link ResourceNodeManager} needs but doesn't own — GameScene supplies these as
 * closures over its own private fields/methods at construction (plan 013 Step 6 coupling rules,
 * carried into plan 015: managers get narrow interfaces, not raw field access, and never a direct
 * manager↔manager edge — the scene mediates).
 */
export interface ResourceNodeManagerDeps {
  /** Recompute the path to the active goal after the world changed — a regrown tree/rock may now
   *  re-block the worker's active route (chop's regrow timer fires this the same way a finished wall
   *  does for BuildManager). */
  repath(): void;
  /** Credit the shared inventory with one harvest hit's yield (chop's `this.inv.add(itemId, n)`) —
   *  narrowed to just that one call shape rather than handing over the whole Inventory. */
  addYield(itemId: string, n: number): void;
  /** Play the per-hit chop feedback (directional recoil + escalating tremble) on the node sprite —
   *  the scene routes this to NodeFxManager.playChop (fx lives in scenes/fx, not this state manager). */
  playChopFx(input: ChopFxInput): void;
  /** Play the per-kind depletion payoff (tree topple / rock crumble / bush rustle) on a transient
   *  clone — the scene routes this to NodeFxManager.playFell. */
  playFellFx(input: FellFxInput): void;
}

/**
 * Resource nodes — trees, rocks, berry bushes — spawn, harvest (chop), regrow, and the
 * pathfinding/placement "is this tile blocked by a live node" query (plan 015 Step 1). Moved
 * verbatim out of GameScene, which still owns `isBlocked` itself (a composite over this manager's
 * {@link hasBlockingNode} and BuildManager's `isOccupied` — see GameScene's own doc for why that
 * composite can't live in either manager) and the harvest task loop (`beginCurrent`/`runHarvest`),
 * which calls back into this manager's queries/commands instead of touching a `trees` field directly.
 *
 * Constructed fresh in `buildWorld()` each (re)start, **before** the player exists (`buildWorld()`'s
 * construction order is load-bearing; see GameScene). The constructor itself must never reach for
 * player state; only call-time closures may. It also does NOT auto-spawn — `loadNodes()` is a
 * separate call right after construction — so construction stays side-effect-free, matching the
 * "constructor must not touch player" rule with zero risk of the ordering mattering later.
 *
 * **`all()` returns the raw backing array — alive AND dead nodes alike.** `pickSpriteAt`/`isBlocked`/
 * the queue-glow pass each already do their own `if (!t.alive) …` filtering on top, so filtering
 * inside `all()` would silently change what those callers see (a dead/regrowing stump would vanish
 * from hit-testing entirely instead of just being unclickable-while-dead, etc.).
 *
 * **SHUTDOWN vs Arcade physics.** These nodes are plain `Phaser.GameObjects.Image`s with no physics
 * body, so there's no Arcade-World teardown-ordering hazard here the way there is for BuildManager's
 * walls group — but the same discipline still applies: Phaser's own scene teardown has already
 * destroyed every GameObject (these sprites included) by the time this manager's SHUTDOWN listener
 * runs, so `destroy()` below may ONLY drop references / reset plain data. It must NEVER call
 * `sprite.destroy()` itself on the SHUTDOWN path — that's only safe at runtime, via {@link clearAll}
 * (used by the DEV-only scenario reset and the dev-menu world randomiser, both called with the scene
 * very much alive).
 */
export class ResourceNodeManager {
  private trees: TreeNode[] = [];
  private nextTreeId = 0;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: ResourceNodeManagerDeps,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  // --- Spawning ----------------------------------------------------------------

  /**
   * Hydrate nodes from authored map data (plan 018 Step A6) — the runtime source of the world's
   * resource nodes (trees/rocks/bushes). Callers
   * filter `MapObject[]` to `kind === 'node'` before calling this (not this method's job — it only
   * ever sees pre-filtered {@link NodeObject}s). `parseMap` does NOT cross-check `obj.ref` against
   * `NODES` (see `NodeObject`'s own doc in `systems/mapFormat.ts`), so an unknown ref is a real
   * possibility here, not just a defensive check — warn (DEV-only, like `decorSprites.ts`'s region
   * warning) and skip that one object rather than throwing and losing the rest of the map's nodes.
   */
  loadNodes(objects: NodeObject[]): void {
    for (const obj of objects) {
      const def = NODES[obj.ref];
      if (!def) {
        if (import.meta.env.DEV) {
          console.warn(
            `[ResourceNodeManager] node "${obj.id}" at (${obj.col},${obj.row}) references unknown ` +
              `NODES key "${obj.ref}" — skipping. Check src/data/nodes.ts for the valid ref set.`,
          );
        }
        continue;
      }
      this.addNode(def, obj.col, obj.row, obj.skin, obj.rotation, obj.depthBias);
    }
  }

  /**
   * Spawn one resource node of `def` (tree, rock, …) at a tile; sized/anchored + textured from the
   * chosen skin (plan 021 step 5). `skinId` picks which of `def.skins` to render (given id → that
   * skin; absent/unknown → `def.skins[0]`, so legacy maps with no authored `skin` still render).
   * `depthBias` is the authored y-sort override (plan 029) — "virtual rows" fed into
   * {@link rowDepthOffset} alongside `row`; `0` (the default) means no override.
   */
  addNode(
    def: ParsedNodeDef,
    col: number,
    row: number,
    skinId?: string,
    rotation = 0,
    depthBias = 0,
  ): void {
    const skin = this.resolveSkin(def, skinId);
    // Seed `add.image` with the skin's own (preloaded) texture — `applySkinAppearance` below then
    // sizes/anchors it. Falls back to Phaser's always-present `__WHITE` if the asset can't be
    // resolved (a content error the world-integrity test + editor validation catch upstream) so a
    // broken ref degrades to a blank marker instead of hard-crashing the boot.
    const seed = this.resolveSkinTexture(skin.asset, skin.region);
    const sprite = this.scene.add
      .image(tileToWorldCenter(col), tileToWorldCenter(row), seed?.key ?? '__WHITE', seed?.frame)
      // Row-ordered depth (plan 029): stays strictly inside the [1, 2) node band via
      // `rowDepthOffset`'s [0, 1) range, so lower-on-map nodes draw in front without ever reaching
      // the actor layer (9+) or disturbing decor's own `1 + obj.depth` band.
      .setDepth(1 + rowDepthOffset(row, depthBias))
      // Placement rotation (deg). Set once here — the chop tween animates scale only and depleted swaps
      // re-texture without touching angle, so it persists; the queued glow halo mirrors it each frame
      // via `TaskGlowRenderer.syncGlowTransforms` (reads `sprite.rotation`), so nothing else to wire.
      .setAngle(rotation);
    // Each species sizes/anchors itself from its def/skin (critique #2): a pine renders at its native
    // size and anchors near its base so the canopy overhangs up; a rock is base-anchored. sprite.x/y
    // stay the tile centre, so treeAt()'s distance check is unaffected regardless of scale/origin.
    this.applySkinAppearance(sprite, def, skin, 'live');
    this.trees.push({
      id: `${def.id}-${this.nextTreeId++}`,
      sprite,
      def,
      hp: def.maxHp,
      alive: true,
      col,
      row,
      skin: skin.id,
      rotation, // the true rest angle — chop fx recoils/topples around it (see NodeFxManager)
    });
  }

  /** Resolve a node's skin: the one matching `skinId`, else the def's first skin (the "default"). */
  private resolveSkin(def: ParsedNodeDef, skinId?: string): NormalizedNodeSkinDef {
    return (
      (skinId !== undefined ? def.skins.find((s) => s.id === skinId) : undefined) ?? def.skins[0]
    );
  }

  /**
   * Point `sprite` at the skin's live (or, `variant === 'depleted'`, its stump) texture and size/anchor
   * it. The `depleted` sub-shape carries only `asset`/`region`, so a stump reuses the skin's/def's
   * sizing (`scale`/`originX`/`originY`). If the catalog asset isn't resident (a content error —
   * PreloadScene loads every referenced skin's textures), the texture is left unchanged and a DEV
   * warning is logged, rather than hard-failing.
   */
  private applySkinAppearance(
    sprite: Phaser.GameObjects.Image,
    def: ParsedNodeDef,
    skin: NormalizedNodeSkinDef,
    variant: 'live' | 'depleted',
  ): void {
    const src = variant === 'depleted' && skin.depleted ? skin.depleted : skin;
    const tex = this.resolveSkinTexture(src.asset, src.region);
    if (tex) {
      if (tex.frame !== undefined) sprite.setTexture(tex.key, tex.frame);
      else sprite.setTexture(tex.key);
    } else if (import.meta.env.DEV) {
      console.warn(
        `[ResourceNodeManager] node "${def.id}" skin "${skin.id}" asset "${src.asset}" is not ` +
          `resident — sprite left as-is. Check the skin's catalog id + PreloadScene enumeration.`,
      );
    }
    sprite
      .setScale(this.nodeScale(def, skin))
      .setOrigin(skin.originX ?? def.originX, skin.originY ?? def.originY);
  }

  /** Resolve a skin asset (+ optional region crop) to a resident Phaser texture key/frame via the
   *  shared decor resolver, or `null` if the texture isn't loaded / the id is malformed. */
  private resolveSkinTexture(
    asset: string,
    region: NormalizedNodeSkinDef['region'],
  ): { key: string; frame?: string | number } | null {
    let path: string;
    try {
      ({ path } = parseAssetId(asset));
    } catch {
      return null; // malformed asset id — skins are validated at authoring time; skip defensively
    }
    const draw = resolveDecorDraw(
      this.scene,
      { id: 'node', asset, ...(region ? { region } : {}) },
      path,
    );
    if (!draw) return null; // texture not resident
    if (draw.kind === 'region') return { key: draw.key, frame: draw.frame };
    return { key: draw.key }; // 'whole' (skins never carry an anim)
  }

  /** Base display scale for a node image — the skin's `scale` override, falling back to the def's
   *  `scale` (a multiplier on the sprite's native source pixels; `1.0` = native size). `skin` omitted
   *  ⇒ def default (the shared glow seam calls it that way — see `TaskGlowRenderer`). */
  nodeScale(def: ResourceNodeDef, skin?: { scale?: number }): number {
    return skin?.scale ?? def.scale;
  }

  // --- Queries -------------------------------------------------------------------

  /** Every node, alive AND dead (see class doc) — callers filter `alive` themselves. Returns the raw
   *  backing array, not a copy. */
  all(): TreeNode[] {
    return this.trees;
  }

  treeById(id: string): TreeNode | undefined {
    return this.trees.find((t) => t.id === id);
  }

  /** True if a live *blocking* node (tree/rock) occupies (col,row) — the pathfinding/placement veto;
   *  a non-blocking bush (`def.blocksPath === false`) never blocks. */
  hasBlockingNode(col: number, row: number): boolean {
    return this.trees.some((t) => t.alive && t.def.blocksPath && t.col === col && t.row === row);
  }

  // --- Harvesting ------------------------------------------------------------------

  /** Light "bag full" feedback: a brief warning tint on the node (no new HUD text). */
  flashBagFull(tree: TreeNode): void {
    if (!tree.alive) return;
    tree.sprite.setTint(COLORS.ghostInvalid);
    this.scene.time.delayedCall(150, () => {
      if (tree.alive) tree.sprite.clearTint();
    });
  }

  chop(tree: TreeNode, facing?: { dCol: number; dRow: number }): void {
    breadcrumb('node', `chop ${tree.def.id} ${tree.id}`, { hp: tree.hp - 1, alive: tree.alive });
    tree.hp -= 1;
    this.deps.addYield(tree.def.yieldItemId, tree.def.yieldPerHit);
    // Per-hit chop feedback — routed to NodeFxManager (fx lives in scenes/fx, this stays a state
    // manager). It animates only the node sprite; the queued glow halo mirrors that motion each frame
    // via syncGlowTransforms(), so the outline follows for free. We pass plain data (skin resolution
    // is this manager's job): the sprite, its TRUE resting transform (tile-centre + fitted base scale)
    // so a re-chop mid-jitter snaps back to rest, and the depletion fraction driving the tremble.
    const skin = this.resolveSkin(tree.def, tree.skin);
    const base = this.nodeScale(tree.def, skin);
    this.deps.playChopFx({
      sprite: tree.sprite,
      restX: tileToWorldCenter(tree.col),
      restY: tileToWorldCenter(tree.row),
      baseScale: base,
      baseAngle: tree.rotation, // recoil/tremble around the authored rotation, not 0 (keeps placement rotation)
      depletion: (tree.def.maxHp - Math.max(0, tree.hp)) / tree.def.maxHp,
      facing: facing ?? { dCol: 0, dRow: 0 },
    });
    if (tree.hp <= 0) {
      tree.alive = false;
      breadcrumb('node', `deplete ${tree.def.id} ${tree.id}`, { regrowMs: tree.def.regrowMs });
      if (skin.depleted) {
        // This skin carries a matching stump sprite — swap to it (own texture, skin/def sizing).
        this.applySkinAppearance(tree.sprite, tree.def, skin, 'depleted');
      } else {
        // No depleted sprite for this skin — tint the felled node to its stumpColor as a stand-in
        // "stump"/rubble state rather than a mismatched placeholder (today's fallback, preserved).
        tree.sprite.setScale(base).setTint(tree.def.stumpColor);
      }
      // Depletion payoff — a transient toppling/crumbling/rustling clone of the LIVE visual, felling
      // away from the chopper while the persistent sprite (just swapped above) becomes the stump
      // underneath. Skip when there's no chopper facing (defensive: runHarvest always yields one when
      // adjacent) — a zero-delta lean would read as a rotation-less fade, not a fell.
      if (facing && (facing.dCol !== 0 || facing.dRow !== 0)) {
        const live = this.resolveSkinTexture(skin.asset, skin.region);
        if (live) {
          this.deps.playFellFx({
            kind: tree.def.harvestAnim ?? 'chop',
            texKey: live.key,
            texFrame: live.frame,
            x: tree.sprite.x,
            y: tree.sprite.y,
            scale: base,
            baseAngle: tree.rotation, // clone starts at the node's authored rotation and topples from it
            originX: skin.originX ?? tree.def.originX,
            originY: skin.originY ?? tree.def.originY,
            depth: tree.sprite.depth,
            facing,
            nodeSprite: tree.sprite,
          });
        }
      }
      this.scene.time.delayedCall(tree.def.regrowMs, () => {
        // A delayedCall scheduled here survives clearAll() (which destroys sprites but leaves the
        // scene clock running), so guard against a sprite destroyed during the regrow window — the
        // breadcrumb'd `spriteAlive:false` case is exactly the shape of a use-after-destroy crash.
        breadcrumb('node', `regrow ${tree.def.id} ${tree.id}`, { spriteAlive: tree.sprite.active });
        tree.hp = tree.def.maxHp;
        tree.alive = true;
        // Restore the live sprite (undoes either the depleted-texture swap or the stumpColor tint).
        this.applySkinAppearance(tree.sprite, tree.def, skin, 'live');
        tree.sprite.clearTint();
        this.deps.repath(); // regrown tree may now block the active route
      });
    }
  }

  // --- Reset / teardown --------------------------------------------------------------

  /**
   * Destroy every node's sprite and drop it. Called at RUNTIME (the scene/physics world is alive), so
   * `sprite.destroy()` is correct here — this is NOT the SHUTDOWN path (see class doc). `resetIds`
   * governs whether the id counter also resets: the DEV-only scenario reset
   * (`resetTreesAndEnemies` → `clearAll({ resetIds: true })`) wants fresh `tree-0`-style ids each
   * scenario, while the dev-menu world randomiser (`randomiseWorld` → `clearAll({ resetIds: false })`)
   * deliberately keeps the counter running — pre-existing behaviour, preserved as-is.
   */
  clearAll(opts: { resetIds: boolean }): void {
    breadcrumb('world', 'clearAll (destroys node sprites)', {
      count: this.trees.length,
      resetIds: opts.resetIds,
    });
    for (const t of this.trees) t.sprite.destroy();
    this.trees = [];
    if (opts.resetIds) this.nextTreeId = 0;
  }

  /**
   * SHUTDOWN: this run's nodes are going away with the rest of this manager instance (a fresh
   * ResourceNodeManager is constructed by the next `buildWorld()`) — Phaser's own scene teardown
   * already destroys every GameObject on a death-restart, so this just drops the stale references.
   * Deliberately does NOT call {@link clearAll} here (see its own doc + this class's SHUTDOWN-vs-
   * Arcade-physics note): that method's `sprite.destroy()` calls are only safe while the scene/physics
   * world is alive, which it no longer is by the time SHUTDOWN fires.
   */
  private destroy(): void {
    this.trees = [];
  }
}
