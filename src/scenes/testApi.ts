import type Phaser from 'phaser';
import { DAY_MS, HUNGER_MAX } from '../config';
import { NODES } from '../data/nodes';
import { MELEE_WEAPONS } from '../data/weapons';
import type { ParsedNodeDef } from '../systems/nodeDefs';
import type { Inventory } from '../systems/Inventory';
import type { Dims } from '../systems/pathfind';
import {
  cycleLengthMs,
  phaseAt,
  tintAlphaAt,
  dayCountForTotal,
  type DayPhase,
} from '../systems/daynight';
import type { MonsterMode } from '../systems/monsterAI';
import type { Action, TaskQueue } from '../systems/tasks';
import { tileToWorldCenter } from '../systems/grid';
import { FACING_DELTAS } from '../entities/types';
import type { TreeNode } from '../entities/types';
import type { ScenarioSpec, ScenarioResult } from '../entities/testTypes';
import type { CharacterSprite } from '../entities/Character';
import type { PlayerCharacter } from '../entities/PlayerCharacter';
import type { MonsterCharacter, MonsterSpawnOpts } from '../entities/MonsterCharacter';
import type { BuildManager } from './build/BuildManager';
import type { CampfireManager } from './world/CampfireManager';
import type { WallManager } from './world/WallManager';
import type { WaveDirector } from './world/WaveDirector';
import type { TaskGlowRenderer } from './fx/TaskGlowRenderer';
import type { CombatFxManager } from './fx/CombatFxManager';
import type { PointerInputController } from './input/PointerInputController';
import type { GameScene } from './GameScene';

/** The shape `TestApi.debugState()` returns — the `window.game.__test.state()` contract (plan 007;
 *  named + exported here per plan 013 Step 2's outcome note, replacing the old
 *  `ReturnType<GameScene['debugState']>` now that the serializer has moved off the scene). Field
 *  order is part of the contract: it crosses the Playwright bridge as JSON and the refactor-tripwire
 *  spec deep-equals a full snapshot — keep it byte-identical to the pre-move shape. */
export interface DebugState {
  currentKind: string | null;
  pending: number;
  pathLen: number;
  sites: number;
  buildMode: boolean;
  occupied: number;
  pcol: number;
  prow: number;
  px: number;
  py: number;
  enemies: number;
  enemyModes: MonsterMode[];
  enemyTiles: { col: number; row: number }[];
  enemyWeapons: (string | null)[];
  corpses: number;
  playerHp: number;
  playerDying: boolean;
  playerFlash: number;
  playerHitFlashes: number;
  enemyHitFlashes: number;
  enemyAttacks: number;
  mode: 'command' | 'combat' | 'inspect';
  hunger: number;
  dayPhase: DayPhase;
  dayCount: number;
  clockMs: number;
  nightAlpha: number;
  outlinedTreeIds: string[];
  pulsingTreeId: string | null;
  queuedTreeIds: string[];
  // Appended (plan 012) — the refactor-tripwire deep-equals DebugState, so new fields go at the END
  // and the tripwire snapshot is updated in the same step. One entry per live campfire.
  campfires: { col: number; row: number; fuel: number; lit: boolean }[];
  // Appended (plan 035a Step 1) — count of live enemies currently in an attack wind-up (telegraphing a
  // strike). Lets a Tier-2 spec assert the wind-up pause fires before damage lands.
  enemyWindups: number;
  // Appended (plan 035a Step 3) — the auto-surface predicate (enemy-near OR night). Lets a Tier-2 spec
  // assert both triggers surface the fighting controls without a manual Combat-mode switch.
  combatActive: boolean;
  // Appended (plan 035a Step 5) — the bow's current auto-target enemy id (null = none). Lets a Tier-2
  // spec assert facing-biased target selection + that the target clears when it dies/leaves range.
  bowTargetId: string | null;
  // Appended (plan 035a Step 6) — count of monster HP bars currently rendered. Lets a Tier-2 spec
  // assert the on-hit reveal fires + fades and the bow target keeps a persistent bar.
  enemyHpBarsVisible: number;
  // Appended (plan 038 Step 7) — night-wave state: whether a wave is running, how many mobs it has
  // spawned this wave, and each live enemy's def id (composition — skeleton vs boar). Lets a Tier-2
  // spec assert the wave starts/ends, paces, escalates, and survives to a day increment.
  waveActive: boolean;
  waveSpawns: number;
  enemyKinds: string[];
}

/**
 * Narrow facade over GameScene + its managers/entities that {@link TestApi} needs (plan 013 Step 6
 * coupling rules — a facade, not raw private-field access, since TestApi lives in a separate file).
 * Two shapes of entry:
 *  - **Stable object references** (managers/entities/systems): each is constructed/reassigned at most
 *    once per `create()`, always BEFORE `installTestApi()` runs (see GameScene.create) — a `create()`
 *    that replaces any of them also constructs a fresh TestApi, so a reference captured at
 *    construction never outlives its owner. Holding them directly (not behind closures) is safe.
 *  - **Closures** over scene state that mutates independently of a TestApi (re)construction — either
 *    primitives the scene's own `update()`/task-loop reassigns every frame (mode/rng/hunger/clock/…),
 *    or collections `randomiseWorld` (a dev-menu action, unrelated to create()) can reassign.
 */
export interface TestApiDeps {
  readonly buildManager: BuildManager;
  readonly campfireManager: CampfireManager;
  readonly wallManager: WallManager;
  readonly waveDirector: WaveDirector;
  readonly taskGlowRenderer: TaskGlowRenderer;
  readonly fx: CombatFxManager;
  readonly pointerInput: PointerInputController;
  readonly playerChar: PlayerCharacter;
  readonly queue: TaskQueue;
  readonly inv: Inventory;
  readonly nightOverlay: Phaser.GameObjects.Rectangle;
  readonly gridDims: Dims;

  /** The live player sprite (playerChar.sprite) — read the same way every other manager does. */
  getPlayerSprite(): CharacterSprite;

  trees(): TreeNode[];
  enemies(): MonsterCharacter[];
  treeById(id: string): TreeNode | undefined;

  // Spawning stays scene-owned (plan 013 Step 6 — GameScene keeps "spawning/world-gen"); TestApi
  // only calls it while building a scenario's declared world.
  addNode(def: ParsedNodeDef, col: number, row: number): void;
  addEnemy(id: string, col: number, row: number, opts?: MonsterSpawnOpts): void;
  /** Destroy every tree/enemy GameObject and reset their arrays + id counters — the shared preamble
   *  of a world reset (mirrors `randomiseWorld`'s own inline copy, which keeps the id counters
   *  running and is left as-is — only this DEV-only scenario reset needs ids restarting at 0). */
  resetTreesAndEnemies(): void;

  // Task-loop scalar state — still owned/read by the task loop itself; TestApi only resets it,
  // mirroring create()'s reset block.
  clearActionGoal(): void;
  setChopElapsed(v: number): void;
  setHarvestSwing(v: 'chop' | 'mine' | 'gather' | null): void;
  setCombatMoveVec(v: { dx: number; dy: number }): void;

  getMode(): 'command' | 'combat' | 'inspect';
  /** The auto-surface predicate (plan 035a Step 3) — enemy-near OR night; surfaced in debugState. */
  getCombatActive(): boolean;
  /** The bow's current auto-target enemy id, or null (plan 035a Step 5) — surfaced in debugState. */
  getBowTargetId(): string | null;
  /** Clear the bow's auto-target — called by resetWorld so a scenario never inherits a prior target. */
  clearBowTarget(): void;
  /** Set mode + emit `mode:changed` — the exact testApplyScenario form (a direct field write, NOT
   *  `setMode`'s guarded toggle: a scenario reset already cleared the queue, so `setMode`'s
   *  combat-entry `cancelAll` would be redundant, and its "same mode" early-return would wrongly
   *  skip the re-emit a fresh scenario needs). */
  setModeAndEmit(m: 'command' | 'combat' | 'inspect'): void;

  setRng(fn: () => number): void;

  // Survival clock/hunger — still driven every frame by the scene's update(); TestApi only
  // seeds/reads it for a scenario or a reset.
  getClockMs(): number;
  setClockMs(v: number): void;
  getDayPhase(): DayPhase;
  setDayPhase(v: DayPhase): void;
  getDayCount(): number;
  setDayCount(v: number): void;
  getHunger(): number;
  setHunger(v: number): void;
  setStarveElapsed(v: number): void;

  // Scene glue that stays scene-owned (task loop / vision / input-mode dispatch).
  updateVision(): void;
  emitTasks(): void;
  inspectAt(x: number, y: number): void;
  isBlocked(col: number, row: number): boolean;
}

/**
 * DEV-only scenario / fixed-step test API + the `debugState()` serializer (plan 007; moved out of
 * GameScene verbatim in plan 013 Step 6 — ~220 lines). Constructed fresh each `create()` (mirrors
 * `BuildManager`/`TaskGlowRenderer`/`PointerInputController` — see {@link TestApiDeps}'s doc), from
 * `GameScene.installTestApi()`, which wraps this class's methods into the `window.game.__test`
 * surface. Holds no state of its own beyond the fixed-step clock below — everything else is read/
 * written through {@link TestApiDeps}, so GameScene's own private fields never widen their access
 * beyond the closures it hands over here.
 */
export class TestApi {
  // Monotonic clock for the fixed-step seam (see step()) — seeded from `scene.time.now` on first use
  // so driven steps never jump the game clock backwards. A fresh TestApi (and clock) is constructed
  // each create()/restart; time.now itself doesn't reset across a restart (the main loop, once
  // stopped by a first step() call, never resumes), so reseeding here converges back to the same
  // absolute clock a persisted field would have reached — see plan 013 Step 6 Outcome for the analysis.
  private testClock = 0;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: TestApiDeps,
  ) {}

  /**
   * Reset the live world to empty — destroy every tree/enemy/site/marker GameObject and clear all
   * the plain-data queue/occupancy state, mirroring create()'s reset block (which assumes a fresh
   * scene with nothing to destroy). Zeroes inventory + player HP. Called by applyScenario before it
   * places the spec's entities, so a scenario never inherits the boot fixtures or a prior run.
   */
  private resetWorld(): void {
    this.deps.resetTreesAndEnemies();
    this.deps.buildManager.reset(); // sites/siteTiles/occupied/walls/nextSiteId/buildMode
    this.deps.campfireManager.reset(); // destroy fire sprites + clear the collection (RUNTIME path)
    this.deps.wallManager.reset(); // destroy wall sprites + clear the collection (RUNTIME path, plan 037)
    this.deps.waveDirector.reset(); // clear any running wave + its first-tick reconcile flag (plan 038)
    this.deps.taskGlowRenderer.reset(); // queue markers + glow halos/pulse + outlinedTreeIds

    this.deps.queue.clear();
    const pc = this.deps.playerChar;
    pc.path = [];
    pc.pathIndex = 0;
    this.deps.clearActionGoal();
    this.deps.setChopElapsed(0);
    this.deps.setHarvestSwing(null);
    pc.attackLockUntil = 0;
    pc.setMeleeWeapon(undefined); // back to unarmed — a scenario never inherits a prior run's weapon (plan 036)
    this.deps.setCombatMoveVec({ dx: 0, dy: 0 });
    this.deps.clearBowTarget(); // no bow target carried into a fresh scenario (highlight cleared below)
    this.deps.fx.resetCombatFx(); // start each scenario with clean FX counters/flags (see create())
    pc.dying = false;
    this.deps.pointerInput.clearPaintedTiles();
    this.deps.setRng(Math.random);

    // Reset survival state so a scenario never inherits a prior run's clock/hunger (applyScenario may
    // then re-seed via spec.clockMs/startPhase/hunger). Mirrors create()'s death-restart reset.
    this.deps.setClockMs(0);
    this.deps.setDayPhase('day');
    this.deps.setDayCount(1);
    this.deps.setHunger(HUNGER_MAX);
    this.deps.setStarveElapsed(0);

    // Zero the shared Inventory in place (keep the same instance so UIScene's 'change' binding holds).
    const snap = this.deps.inv.snapshot();
    if (Object.keys(snap).length) this.deps.inv.spend(snap);

    pc.hp = pc.stats.maxHp;
    this.scene.game.events.emit('player:hpChanged', { hp: pc.hp, maxHp: pc.stats.maxHp });
  }

  /** Construct the world declared by `spec` (see {@link ScenarioSpec}) and return the placed ids. */
  applyScenario(spec: ScenarioSpec): ScenarioResult {
    this.resetWorld();

    const [pcol, prow] = spec.player ?? [
      Math.floor(this.deps.gridDims.cols / 2),
      Math.floor(this.deps.gridDims.rows / 2),
    ];
    const player = this.deps.getPlayerSprite();
    player.body.reset(tileToWorldCenter(pcol), tileToWorldCenter(prow));
    player.body.setVelocity(0, 0);
    this.deps.playerChar.lastFacing = spec.facing
      ? { ...FACING_DELTAS[spec.facing] }
      : { dCol: 0, dRow: 1 };

    this.deps.setModeAndEmit(spec.mode ?? 'command');

    // Optional: spawn the player already holding a demo melee weapon (mirrors enemy `weaponId`). An
    // unknown id resolves to undefined → unarmed. resetWorld already cleared it, so only set when given.
    if (spec.melee != null) this.deps.playerChar.setMeleeWeapon(MELEE_WEAPONS[spec.melee]);

    const inv = spec.inventory ?? (spec.wood != null ? { wood: spec.wood } : {});
    for (const [id, n] of Object.entries(inv)) if (n > 0) this.deps.inv.add(id, n);

    const treeIds: string[] = [];
    for (const [c, r] of spec.trees ?? []) {
      this.deps.addNode(NODES.tree, c, r);
      treeIds.push(this.deps.trees()[this.deps.trees().length - 1].id);
    }

    const rockIds: string[] = [];
    for (const [c, r] of spec.rocks ?? []) {
      this.deps.addNode(NODES.rock, c, r);
      rockIds.push(this.deps.trees()[this.deps.trees().length - 1].id);
    }

    const bushIds: string[] = [];
    for (const [c, r] of spec.bushes ?? []) {
      this.deps.addNode(NODES.berryBush, c, r);
      bushIds.push(this.deps.trees()[this.deps.trees().length - 1].id);
    }

    // Pass the buildable id EXPLICITLY (never rely on the default selectedBuildableId, which a prior
    // tryPlace may have moved — belt-and-suspenders alongside BuildManager.reset()'s reset to 'wall').
    for (const [c, r] of spec.walls ?? [])
      this.deps.buildManager.finishSite(this.deps.buildManager.createBlueprint(c, r, 'wall'));

    // Campfires: mirror the wall path (finishSite → the campfire branch → materialiseBuildable →
    // CampfireManager.materialise). Bypassing tilePlaceable/isInBase is fine + intended for fixtures.
    const campfireIds: string[] = [];
    for (const [c, r] of spec.campfires ?? []) {
      this.deps.buildManager.finishSite(this.deps.buildManager.createBlueprint(c, r, 'campfire'));
      const list = this.deps.campfireManager.all();
      campfireIds.push(list[list.length - 1].id);
    }
    // Optional: seed every placed campfire's fuel (e.g. a near-empty fire for a drain/relight test).
    if (spec.campfireFuel != null)
      for (const cf of this.deps.campfireManager.all()) cf.fuel = spec.campfireFuel;

    const siteIds: string[] = [];
    for (const [c, r] of spec.blueprints ?? [])
      siteIds.push(this.deps.buildManager.createBlueprint(c, r, 'wall').id);

    const enemyIds: string[] = [];
    for (const z of spec.enemies ?? []) {
      const at = Array.isArray(z) ? z : z.at;
      const id = Array.isArray(z) ? 'kidZombie' : (z.id ?? 'kidZombie');
      const opts = Array.isArray(z)
        ? undefined
        : {
            patrolRoute: z.patrolRoute?.map(([c, r]) => ({ col: c, row: r })),
            mode: z.mode,
            weaponId: z.weaponId,
            objective: z.objective,
          };
      this.deps.addEnemy(id, at[0], at[1], opts);
      enemyIds.push(this.deps.enemies()[this.deps.enemies().length - 1].id);
    }

    if (spec.rng) this.deps.setRng(spec.rng);

    // Seed survival state (plan 004). clockMs wins over startPhase; both drive the derived phase/day
    // + the night-overlay alpha so a pre-step debugState() reflects the seed (update() reconciles the
    // rest on the first driven step). hunger is clamped into [0, HUNGER_MAX].
    if (spec.clockMs != null) this.deps.setClockMs(spec.clockMs);
    else if (spec.startPhase != null)
      this.deps.setClockMs(spec.startPhase === 'night' ? DAY_MS : 0);
    if (spec.clockMs != null || spec.startPhase != null) {
      const cycleMs = this.deps.getClockMs() % cycleLengthMs();
      this.deps.setDayPhase(phaseAt(cycleMs));
      this.deps.setDayCount(dayCountForTotal(this.deps.getClockMs()));
      this.deps.nightOverlay.setAlpha(tintAlphaAt(cycleMs));
      this.scene.registry.set('dayPhase', this.deps.getDayPhase());
      this.scene.registry.set('dayCount', this.deps.getDayCount());
    }
    if (spec.hunger != null) {
      this.deps.setHunger(Math.max(0, Math.min(HUNGER_MAX, spec.hunger)));
      this.scene.registry.set('hunger', this.deps.getHunger());
    }

    this.deps.updateVision();
    this.deps.emitTasks();
    return { treeIds, rockIds, bushIds, enemyIds, siteIds, campfireIds };
  }

  /**
   * Advance gameplay by `ms` in fixed 1/60s slices, deterministically. Stops the RAF game loop and
   * drives `game.step(clock, fixedDelta)` itself — this runs each scene's update → Arcade physics →
   * clock → tweens → timers, so movement/chop/build/contact-cooldown/regrow all resolve with zero
   * wall-clock (a manual `scene.update()` would NOT advance physics/clock/timers — see plan 007 B1).
   */
  step(ms: number): void {
    const fixed = 1000 / 60;
    if (this.scene.game.loop.running) this.scene.game.loop.stop();
    if (this.testClock === 0) this.testClock = this.scene.time.now;
    const steps = Math.max(1, Math.round(ms / fixed));
    for (let i = 0; i < steps; i++) {
      this.testClock += fixed;
      this.scene.game.step(this.testClock, fixed);
    }
  }

  /** Inspect the entity at a tile (drives the same panel path as an Inspect-mode tap). */
  inspect(col: number, row: number): void {
    this.deps.inspectAt(tileToWorldCenter(col), tileToWorldCenter(row));
  }

  /** True if the tile is currently a pathfinding obstacle (test helper). */
  isTileBlocked(col: number, row: number): boolean {
    return this.deps.isBlocked(col, row);
  }

  /** Select a buildable + attempt a real placement at a tile — exercises the true `tilePlaceable`
   *  path (bounds/occupancy/reachability + the `isInBase` base-zone gate for `baseOnly`). Returns
   *  whether a site was placed. (Enters build mode as a side effect, like the palette pick would.) */
  tryPlace(id: string, col: number, row: number): boolean {
    this.deps.buildManager.select(id);
    return this.deps.buildManager.tryPlaceAt(col, row);
  }

  /** True if the tile's centre is within any lit campfire's light radius (the reveal predicate). */
  inLight(col: number, row: number): boolean {
    return this.deps.campfireManager.inLight(tileToWorldCenter(col), tileToWorldCenter(row));
  }

  /** Run the real tap-to-feed path on the campfire at `index` (spend one wood, top up + relight).
   *  Returns whether a feed happened (false if the index is out of range or there's no wood). */
  feedCampfire(index: number): boolean {
    const c = this.deps.campfireManager.all()[index];
    if (!c) return false;
    return this.deps.campfireManager.feedAt(c.col, c.row);
  }

  /** DEV/test-only: drain the campfire at `index` by `amount` fuel — the real
   *  {@link CampfireManager.damageFire} (a mob attack on the fire-heart, plan 038). Lets a spec knock a
   *  fire's light out (drive its fuel to 0 → douses → dark) without the wave AI. Returns false if there's
   *  no campfire at that index. */
  damageFire(index: number, amount: number): boolean {
    const c = this.deps.campfireManager.all()[index];
    if (!c) return false;
    return this.deps.campfireManager.damageFire(c.id, amount);
  }

  /** DEV/test-only: the live barricade walls (col/row/facing/hp/maxHp), placement order — a standalone
   *  read seam for the wall spec (plan 037). NOT part of the serialized {@link DebugState}, so the
   *  refactor-tripwire golden stays untouched (new DebugState fields are deferred to a later step). */
  walls(): { col: number; row: number; facing: string; hp: number; maxHp: number }[] {
    return this.deps.wallManager
      .all()
      .map((w) => ({ col: w.col, row: w.row, facing: w.facing, hp: w.hp, maxHp: w.maxHp }));
  }

  /** DEV/test-only: damage the wall at `index` by `amount` — the real {@link WallManager.takeDamage}
   *  (the path chunk 2c's enemy will drive). Returns whether that blow destroyed the wall; false if
   *  there's no wall at that index. Mirrors {@link damageFire}. */
  damageWall(index: number, amount: number): boolean {
    const w = this.deps.wallManager.all()[index];
    if (!w) return false;
    return this.deps.wallManager.takeDamage(w.id, amount);
  }

  /** DEV/test-only: live enemies' current HP, spec order — a standalone read seam (like {@link walls})
   *  for the enemy-attack spec to watch a mob's HP fall to thorns (plan 037 2c). NOT part of the
   *  serialized {@link DebugState}, so the refactor-tripwire golden stays untouched. */
  enemyHps(): number[] {
    return this.deps
      .enemies()
      .filter((z) => z.alive)
      .map((z) => z.hp);
  }

  /** DEV/test-only: start a night wave immediately (plan 038 Step 3) — the deterministic entry point
   *  for spawn/pacing specs, independent of crossing a day→night clock edge. Idempotent (no-op if a
   *  wave is already running). Also the target of the dev force-wave hook (Step 6). */
  beginWave(): void {
    this.deps.waveDirector.beginWave();
  }

  /** DEV-only: relocate the enemy at `index` to a tile — sprite, physics body AND logical col/row —
   *  so a spec can cross a distance threshold (e.g. the combat-active hysteresis band) mid-test
   *  WITHOUT a world reset, which would clear the state hysteresis depends on. Returns false if no
   *  such enemy. */
  moveEnemy(index: number, col: number, row: number): boolean {
    const z = this.deps.enemies()[index];
    if (!z) return false;
    const x = tileToWorldCenter(col);
    const y = tileToWorldCenter(row);
    z.sprite.setPosition(x, y);
    z.sprite.body.reset(x, y);
    z.col = col;
    z.row = row;
    return true;
  }

  /** DEV/test-only: equip the player's melee weapon by id (looks up `MELEE_WEAPONS[id]`), or clear to
   *  unarmed with `null` (an unknown id also clears — `MELEE_WEAPONS[id]` is undefined). Lets a Tier-2
   *  spec select a weapon deterministically to assert reach/arc (plan 036). */
  setPlayerMelee(id: string | null): void {
    this.deps.playerChar.setMeleeWeapon(id != null ? MELEE_WEAPONS[id] : undefined);
  }

  /** State snapshot for the Tier-2 Playwright suite + the smoke test. */
  debugState(): DebugState {
    const pc = this.deps.playerChar;
    const t = pc.tile();
    const sprite = this.deps.getPlayerSprite();
    const aliveEnemies = this.deps.enemies().filter((z) => z.alive);
    return {
      currentKind: this.deps.queue.current?.kind ?? null,
      pending: this.deps.queue.pending,
      pathLen: Math.max(0, pc.path.length - pc.pathIndex),
      sites: this.deps.buildManager.siteCount(),
      buildMode: this.deps.buildManager.buildMode,
      occupied: this.deps.buildManager.occupiedCount(),
      pcol: t.col,
      prow: t.row,
      px: sprite.x,
      py: sprite.y,
      enemies: aliveEnemies.length,
      enemyModes: aliveEnemies.map((z) => z.ai.mode),
      // Live enemy tiles (spec order) — patrol mode never leaves 'patrol', so waypoint cycling is
      // only observable via position; the monster.spec patrol test reads this.
      enemyTiles: aliveEnemies.map((z) => ({ col: z.col, row: z.row })),
      // Equipped weapon id per live enemy (null = unarmed) — lets a combat spec confirm the rolled/forced weapon.
      enemyWeapons: aliveEnemies.map((z) => z.weapon?.id ?? null),
      corpses: this.deps.fx.getCorpseCount(),
      playerHp: pc.hp,
      playerDying: pc.dying,
      playerFlash: this.deps.fx.getPlayerFlash(),
      playerHitFlashes: this.deps.fx.getPlayerHitFlashes(),
      enemyHitFlashes: this.deps.fx.getEnemyHitFlashes(),
      enemyAttacks: this.deps.fx.getEnemyAttacks(),
      mode: this.deps.getMode(),
      hunger: this.deps.getHunger(),
      dayPhase: this.deps.getDayPhase(),
      dayCount: this.deps.getDayCount(),
      clockMs: this.deps.getClockMs(),
      nightAlpha: this.deps.nightOverlay.alpha,
      outlinedTreeIds: this.deps.taskGlowRenderer.getOutlinedTreeIds(),
      pulsingTreeId: this.deps.taskGlowRenderer.headHarvestTreeId(),
      queuedTreeIds: this.deps.queue
        .all()
        .filter((a): a is Extract<Action, { kind: 'harvest' }> => a.kind === 'harvest')
        .map((a) => a.treeId),
      campfires: this.deps.campfireManager
        .all()
        .map((c) => ({ col: c.col, row: c.row, fuel: c.fuel, lit: c.lit })),
      enemyWindups: aliveEnemies.filter((z) => z.windupUntil > 0).length,
      combatActive: this.deps.getCombatActive(),
      bowTargetId: this.deps.getBowTargetId(),
      enemyHpBarsVisible: this.deps.fx.getVisibleHpBarCount(),
      waveActive: this.deps.waveDirector.isActive(),
      waveSpawns: this.deps.waveDirector.spawnedCount(),
      enemyKinds: aliveEnemies.map((z) => z.def.id),
    };
  }
}
