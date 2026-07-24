import Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import { tileToWorldCenter } from '../../systems/grid';
import { rowDepthOffset } from '../../systems/mapFormat';
import { BUILDABLES } from '../../data/buildables';
import { parseAssetId } from '../../render/assetPaths';
import { resolveDecorDraw } from '../../render/decorSprites';
import { placedWorkbenchStats } from '../../systems/stats';
import type { InspectableStats } from '../../data/types';
import type { BuildSite, PlacedStructure, WorkbenchStructure } from '../../entities/types';
import type { GameScene } from '../GameScene';
import type { StructureBehavior } from './StructureManager';

/** Default bottom-anchor + height (in tiles) the workbench sprite scales to when the buildable omits
 *  them — the workbench sets `originY`/`tilesTall` in data (see buildables.ts). */
const BENCH_ORIGIN_Y = 1;
const BENCH_TILES_TALL = 1;

/** Full-hp tint (no wash) and the fully-damaged tint the sprite lerps toward as hp → 0 — a dark,
 *  bruised brown. WorkbenchBehavior has no crumble sheet (plan 048 Step 3), so damage reads purely as
 *  this progressive tint step (mirrors WallBehavior stepping its Destroy frame, sans art). */
const BENCH_TINT_FULL = 0xffffff;
const BENCH_TINT_DEAD = 0x6b3a2a;

/**
 * Narrow scene state {@link WorkbenchBehavior} needs but doesn't own — GameScene supplies these as
 * closures over its own fields at construction (013/015 coupling rule). BuildManager stays the sole
 * occupancy/collision writer, so a destroyed bench frees its tile back through {@link freeTile}.
 */
export interface WorkbenchBehaviorDeps {
  /** Free a destroyed bench's occupied tile + collision body (BuildManager.releaseTile). */
  freeTile(col: number, row: number): void;
  /** Recompute the active path after a bench was removed (the tile just opened up). */
  repath(): void;
}

/**
 * Workbench crafting stations — the 4th live/destructible buildable (plan 048), a {@link StructureBehavior}
 * module in the StructureManager registry alongside {@link CampfireBehavior}/{@link WallBehavior}/
 * {@link TrapBehavior}. It owns the bench collection and each bench's ONE static sprite
 * ({@link PlacedStructure.sprite}, a `Workbench.png` region crop — NO anim, unlike the barricade), so
 * it is the sole writer of that sprite's damage tint and its sole destroyer. A bench is created by
 * {@link materialise} when its build site completes (routed from `BuildManager.finishSite` via the
 * scene → `StructureManager.materialise` dispatch on `def.behavior`).
 *
 * HP spine mirrors {@link WallBehavior}: {@link takeDamage} lowers hp + steps a progressive damage tint
 * (no crumble sheet — plan 048 Step 3), and at `hp <= 0` the bench is removed (frees its tile via the
 * dep + repaths). {@link repair} raises hp + steps the tint back. The craft rate scales with hp (the
 * `craft` worker order reads `hp/maxHp`, Step 6), so a damaged bench crafts slower but the HP itself
 * still drops to 0 like a wall if left undefended. The enemy-attack path (Step 4) drives
 * {@link takeDamage}; the DEV test seam drives it too.
 *
 * Constructed fresh in `buildWorld()` each (re)start and registered under `'workbench'`. Event-driven —
 * no per-frame tick here (craft progress is accumulated by the worker order on the struct's `state`,
 * not ticked by this module), so it omits {@link StructureBehavior.tick}/`lightSources`.
 *
 * **SHUTDOWN vs plain GameObjects — the same trap as WallBehavior.** The bench sprites are plain
 * Sprites (no Arcade body — BuildManager owns the collision body). Phaser's own scene teardown destroys
 * every GameObject BEFORE StructureManager fans {@link destroy} out. So {@link destroy} may **only drop
 * references** — never call `sprite.destroy()` on the SHUTDOWN path. {@link reset} runs at RUNTIME
 * (scene alive) where `sprite.destroy()` IS correct — the DEV-only scenario reset.
 */
export class WorkbenchBehavior implements StructureBehavior {
  private benches: WorkbenchStructure[] = [];
  private nextId = 0;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: WorkbenchBehaviorDeps,
  ) {}

  // --- Lifecycle -----------------------------------------------------------------

  /** Turn a completed workbench build site into a live station: one bottom-anchored static sprite (the
   *  `objectSprite` region crop baked via the shared object-region path) at the tile. Starts at full hp,
   *  idle (no craft). If the source texture isn't resident the sprite falls back to a bare rect-less
   *  placeholder frame — but PreloadScene loads every `objectSprite` sheet unconditionally, so this
   *  resolves in practice (matches ResourceNodeManager's resident-texture assumption). */
  materialise(site: BuildSite): void {
    const def = BUILDABLES[site.buildableId];
    const x = tileToWorldCenter(site.col);
    const y = tileToWorldCenter(site.row);
    const originY = def.originY ?? BENCH_ORIGIN_Y;
    const tilesTall = def.tilesTall ?? BENCH_TILES_TALL;

    // Base-row y-sort (plan 029/5b): the bench sorts as one row against trees/other structures.
    const sprite = this.scene.add
      .sprite(x, y, '__DEFAULT')
      .setDepth(1 + rowDepthOffset(site.row))
      .setOrigin(0.5, originY);
    this.applyObjectSprite(sprite, def.objectSprite);
    sprite.setScale((TILE_SIZE * tilesTall) / sprite.frame.height);

    this.benches.push({
      id: `workbench-${this.nextId++}`,
      buildableId: site.buildableId,
      behavior: 'workbench',
      col: site.col,
      row: site.row,
      sprite,
      state: { hp: def.maxHp, maxHp: def.maxHp, craft: null },
    });
  }

  /** Point a fresh sprite at the buildable's static object-region crop (asset + region → the shared
   *  `resolveDecorDraw`, the same path a decor/node skin uses). No-op if the def carries no
   *  `objectSprite` or the texture isn't resident (the sprite keeps its placeholder frame + a dev warn),
   *  matching every other "texture failed to load" path in this codebase. */
  private applyObjectSprite(
    sprite: Phaser.GameObjects.Sprite,
    objectSprite: (typeof BUILDABLES)[string]['objectSprite'],
  ): void {
    if (!objectSprite) return;
    let path: string;
    try {
      ({ path } = parseAssetId(objectSprite.asset));
    } catch {
      return; // malformed asset id — validated at authoring time; skip defensively
    }
    const draw = resolveDecorDraw(
      this.scene,
      {
        id: 'workbench',
        asset: objectSprite.asset,
        ...(objectSprite.region ? { region: objectSprite.region } : {}),
      },
      path,
    );
    if (!draw) {
      if (import.meta.env.DEV) {
        console.warn(
          `[WorkbenchBehavior] objectSprite "${objectSprite.asset}" is not resident — bench sprite ` +
            `left as placeholder. Check PreloadScene's objectSprite enumeration.`,
        );
      }
      return;
    }
    if (draw.kind === 'region') sprite.setTexture(draw.key, draw.frame);
    else sprite.setTexture(draw.key); // 'whole' (a region-less objectSprite); 'anim' never occurs here
  }

  // --- Damage (mob attacks lower hp; Step 4 wires the enemy) ----------------------

  /** Lower a bench's hp by `amount` and reflect it via the damage tint; at `hp <= 0` remove the bench
   *  (free its tile via the dep + repath). Returns whether this blow destroyed it. No-op (returns false)
   *  if `id` is unknown — tolerates a bench removed mid-attack (like WallBehavior.takeDamage). */
  takeDamage(id: string, amount: number): boolean {
    const b = this.benchById(id);
    if (!b) return false;
    b.state.hp = Math.max(0, b.state.hp - amount);
    if (b.state.hp <= 0) {
      this.destroyBench(b);
      return true;
    }
    this.applyDamageTint(b);
    return false;
  }

  /** Restore a bench's hp by `amount` and step the damage tint back toward intact. Mirrors
   *  WallBehavior.repair: an unknown id is a no-op reporting "now full" (so a repair planner moves on),
   *  and a bench already at full hp is a no-op. Returns whether the bench is now at `maxHp`. */
  repair(id: string, amount: number): boolean {
    const b = this.benchById(id);
    if (!b) return true; // bench gone mid-order — nothing to mend (planner replans)
    if (b.state.hp >= b.state.maxHp) return true; // already intact — no-op
    b.state.hp = Math.min(b.state.maxHp, b.state.hp + amount);
    this.applyDamageTint(b);
    return b.state.hp >= b.state.maxHp;
  }

  /** Wash the bench sprite from {@link BENCH_TINT_FULL} (intact) toward {@link BENCH_TINT_DEAD} as hp
   *  drops — the damage feedback in lieu of a crumble sheet (plan 048 Step 3). Clears the tint exactly
   *  at full hp so a repaired bench reads clean. */
  private applyDamageTint(b: WorkbenchStructure): void {
    const t = 1 - b.state.hp / b.state.maxHp; // 0 intact → 1 dead
    if (t <= 0) {
      b.sprite.clearTint();
      return;
    }
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.IntegerToColor(BENCH_TINT_FULL),
      Phaser.Display.Color.IntegerToColor(BENCH_TINT_DEAD),
      100,
      Math.round(t * 100),
    );
    b.sprite.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
  }

  /** Remove a destroyed bench (mob kill): free its tile NOW (pathing/occupancy open immediately) + drop
   *  it from the collection + repath, then fade the sprite out and self-destroy it. No crumble sheet
   *  (plan 048 Step 3) and no refund — a kill is not a player unbuild. */
  private destroyBench(b: WorkbenchStructure): void {
    this.deps.freeTile(b.col, b.row);
    this.deps.repath();
    this.benches = this.benches.filter((x) => x !== b);
    const sprite = b.sprite;
    this.scene.tweens.add({
      targets: sprite,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        if (sprite.active) sprite.destroy();
      },
    });
  }

  // --- Queries -------------------------------------------------------------------

  /** Every bench (raw backing array, not a copy). */
  all(): WorkbenchStructure[] {
    return this.benches;
  }

  benchAt(col: number, row: number): WorkbenchStructure | undefined {
    return this.benches.find((b) => b.col === col && b.row === row);
  }

  /** Look up a bench by id (undefined once gone) — a per-order consumer (the craft order, the enemy
   *  attack path) tolerates a bench destroyed mid-order. */
  benchById(id: string): WorkbenchStructure | undefined {
    return this.benches.find((b) => b.id === id);
  }

  /** Inspect-panel stats for a picked bench (dispatched here from StructureManager.stats). */
  stats(struct: PlacedStructure): InspectableStats {
    return placedWorkbenchStats(struct as WorkbenchStructure);
  }

  /** The world-AABB a queued-order outline hugs: the bench sprite's rendered bounds. Dispatched here
   *  from StructureManager.highlightBounds. */
  highlightBounds(struct: PlacedStructure): Phaser.Geom.Rectangle {
    return struct.sprite.getBounds();
  }

  // --- Reset / teardown ----------------------------------------------------------

  /**
   * Destroy every bench sprite and clear the collection. Called at RUNTIME (scene alive), so
   * `sprite.destroy()` is correct — the DEV-only scenario reset (testResetWorld), NOT the SHUTDOWN
   * path (see class doc).
   */
  reset(): void {
    for (const b of this.benches) b.sprite.destroy();
    this.benches = [];
    this.nextId = 0;
  }

  /**
   * SHUTDOWN: this run's bench sprites are going away with the rest of this module instance — Phaser's
   * own scene teardown already destroyed every sprite by the time StructureManager fans this out. So
   * this only drops the stale references; it must NEVER call `sprite.destroy()` here (see class doc).
   */
  destroy(): void {
    this.benches = [];
  }
}
