import Phaser from 'phaser';
import { ENEMIES } from '../../data/enemies';
import type { CombatantStats } from '../../data/types';
import { enemyDeathKey } from '../../data/tileset';
import { hurtboxContains, hurtboxTiles, DEFAULT_HURTBOX } from '../../systems/hurtbox';
import type { Cell, Dims } from '../../systems/pathfind';
import type { Threat } from '../../systems/monsterAI';
import {
  MonsterCharacter,
  type MonsterSpawnOpts,
  type MonsterTickEnv,
} from '../../entities/MonsterCharacter';
import type { CharacterSprite } from '../../entities/Character';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link EnemyManager} needs but doesn't own — GameScene supplies these as
 * closures over its own private fields/methods at construction (plan 013 Step 6 coupling rules,
 * carried into plan 015: managers get narrow interfaces, not raw field access, and never a direct
 * manager↔manager edge — the scene mediates). `isBlocked` is the scene's own composite predicate
 * (occupancy + live blocking node); this manager receives it by reference and folds it into the
 * {@link MonsterTickEnv} it builds each tick — see GameScene's own doc for why that composite can't
 * live in either manager. `rng` is threaded into both `addEnemy` (per-spawn weapon roll) and the tick
 * env (per-bite hit rolls) so the DEV-only test API's pinned rng reaches both.
 */
export interface EnemyManagerDeps {
  /** The player's current tile — the player threat's `tile` (also derives its body tiles). */
  playerTile(): Cell;
  /** The player sprite's world position — the player threat's `pos` (chase/lunge targeting). */
  playerPos(): { x: number; y: number };
  /** The player's stat bag — hurtbox for the player threat's body tiles, plus armour/dodge for bite
   *  resolution. */
  playerStats(): CombatantStats;
  /** Grid bounds for pathing/placement checks. */
  dims(): Dims;
  /** Pathfinding walkability predicate (the scene's `isBlocked`) — passed through into the tick env. */
  isBlocked(col: number, row: number): boolean;
  /** Injectable combat/weapon-roll rng (the scene's `this.rng`) — threaded into `addEnemy` AND the
   *  tick env so the DEV-only test API's pinned rng reaches every roll a monster makes. */
  rng(): number;
  /** Landed-bite feedback — flash + camera kick + damage vignette (scene-owned bus emission). */
  onPlayerHurt(): void;
  /** Apply bite damage to the player (scene-owned: emits hp events / triggers the death path). */
  damagePlayer(amount: number): void;
  /** Plan 042 Step 6 — the companion NPC as a threat snapshot (tile + world pos + stats + downed), or
   *  null when none is spawned. Mobs add it to their per-tick threat list UNLESS downed (never pile on a
   *  corpse). A narrow scene-mediated snapshot, mirroring `litHearth()` — no manager↔manager edge. */
  companion(): {
    tile: Cell;
    pos: { x: number; y: number };
    stats: CombatantStats;
    downed: boolean;
  } | null;
  /** Landed-bite feedback on the companion (its sprite flash) — the NPC twin of onPlayerHurt (plan 042). */
  onNpcHurt(): void;
  /** Apply bite damage to the companion NPC (scene-owned: routes to its takeDamage + downed collapse). */
  damageNpc(amount: number): void;
  /** Plan 038 Step 4 — the nearest lit hearth the night wave targets (id + tile + world pos), or null
   *  when none is lit. Shared across the tick (one hearth in the MVP); wave mobs (`seeksFire`) path to
   *  it + strike it. */
  litHearth(): { id: string; tile: Cell; pos: { x: number; y: number } } | null;
  /** Drain `amount` fuel from the fire (→ CampfireBehavior.damageFire) — the fire-strike effect. */
  attackFire(id: string, amount: number): void;
  /** Plan 037 chunk 2c — the live structure occupying `(col,row)` (today a wall), with the combat
   *  `defender` (armour + zeroed offence) and `thorns` a mob's strike needs; null when the tile holds
   *  no structure. Assembled by GameScene routing through the wall behavior module. */
  structureAt(
    col: number,
    row: number,
  ): { id: string; defender: CombatantStats; thorns: number } | null;
  /** Deal `dmg` to the structure (→ WallBehavior.takeDamage); returns whether the blow destroyed it. */
  attackStructure(id: string, dmg: number): boolean;
  /** Red flash + flinch on a sprite that took a survived hit (routes to CombatFxManager.flashHit) —
   *  reused for the thorns retaliation feedback, exactly as the player's melee/bow hit uses it. */
  flashHit(sprite: CharacterSprite): void;
  /** Visible attack tell + weapon swing (routes to CombatFxManager.lungeAt). */
  lungeAt(monster: MonsterCharacter, targetX: number, targetY: number): void;
  /** Play the wind-up telegraph before a strike (routes to CombatFxManager.beginWindUp). */
  beginWindUp(monster: MonsterCharacter, durationMs: number): void;
  /** Clear the wind-up telegraph — strike landing or whiff (routes to CombatFxManager.endWindUp). */
  endWindUp(monster: MonsterCharacter): void;
  /** Stop any in-flight hit-flash/lunge/weapon-swing tween before a sprite is destroyed. */
  cleanupActorFx(sprite: CharacterSprite): void;
  /** Track a corpse sprite lingering after death (see killEnemy's delayedCall). */
  addCorpse(sprite: CharacterSprite): void;
  /** Drop a corpse once its lingering removal fires. */
  removeCorpse(sprite: CharacterSprite): void;
}

/**
 * Enemies — spawn, per-frame AI tick, attack/kill, and the DEV-menu scatter (plan 015 Step 2). Moved
 * verbatim out of GameScene, which still owns the *decision* of when to attack/kill (`attack()` reads
 * {@link enemyAt}/calls {@link killEnemy}) — this manager only owns the collection, the FSM-tick
 * plumbing, and the enemy-half of a full world reset.
 *
 * Constructed fresh in `buildWorld()` each (re)start, at the exact point the old inline
 * `spawnEnemies()` call used to run — **before** the player exists (`buildWorld()`'s construction
 * order is load-bearing; see GameScene). The constructor itself must never reach for player state;
 * only call-time closures (the `deps` above) may. It also does NOT auto-spawn — `spawnEnemies()` is a
 * separate call right after construction — so construction stays side-effect-free, matching the
 * "constructor must not touch player" rule with zero risk of the ordering mattering later.
 *
 * **`all()` returns the raw backing array — alive AND dead monsters alike.** `pickSpriteAt` (still
 * scene-resident until plan 015 Step 5) and this manager's own {@link update} each do their own
 * `if (!z.alive) continue` filtering on top, so filtering inside `all()` would silently change what
 * those callers see (a dead-but-lingering corpse would vanish from hit-testing entirely instead of
 * just being un-targetable-while-dead).
 *
 * **SHUTDOWN vs Arcade physics — the trap for this manager.** Monster sprites carry Arcade physics
 * bodies (`scene.physics.add.existing(sprite)` in MonsterCharacter's constructor). Phaser's own scene
 * teardown destroys every GameObject AND tears down the Arcade physics World's own bookkeeping BEFORE
 * this manager's SHUTDOWN listener runs (Arcade's World registers its own SHUTDOWN handler once, when
 * the physics plugin boots — long before this manager's, re-added fresh every `buildWorld()` — so
 * Arcade's handler always runs first). By the time `destroy()` below fires, every enemy sprite/body is
 * already gone. So `destroy()` may **ONLY drop references / reset plain data** — it must **NEVER**
 * call `sprite.destroy()`, touch `body`/physics teardown, or call `deps.cleanupActorFx` on the
 * SHUTDOWN path: those all poke an already-destroyed sprite/body and throw. This is DIFFERENT from
 * {@link clearAll}, which runs at RUNTIME (physics alive) where `sprite.destroy()` IS correct — that's
 * the DEV-only scenario reset and the dev-menu world randomiser, both called with the scene very much
 * alive.
 */
export class EnemyManager {
  private enemies: MonsterCharacter[] = [];
  private nextEnemyId = 0;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: EnemyManagerDeps,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  // --- Spawning ----------------------------------------------------------------

  spawnEnemies(): void {
    this.addEnemy('kidZombie', 22, 50); // ~10 tiles below the map-centre spawn, as before the resize
  }

  addEnemy(enemyId: string, col: number, row: number, opts?: MonsterSpawnOpts): void {
    this.enemies.push(
      new MonsterCharacter(
        this.scene,
        `enemy-${this.nextEnemyId++}`,
        ENEMIES[enemyId],
        col,
        row,
        () => this.deps.rng(),
        opts,
      ),
    );
  }

  // --- Queries -------------------------------------------------------------------

  /** Every enemy, alive AND dead (see class doc) — callers filter `alive` themselves. Returns the raw
   *  backing array, not a copy. */
  all(): MonsterCharacter[] {
    return this.enemies;
  }

  /** The live enemy whose body (hurtbox, anchored at its feet tile) covers tile (col,row) — so a
   *  tall enemy is hit/inspected by its drawn torso, not only its feet tile. Footprint is unchanged. */
  enemyAt(col: number, row: number): MonsterCharacter | undefined {
    const target = { col, row };
    return this.enemies.find(
      (z) =>
        z.alive &&
        hurtboxContains({ col: z.col, row: z.row }, z.def.hurtbox ?? DEFAULT_HURTBOX, target),
    );
  }

  /** Every DISTINCT alive enemy whose body (hurtbox, anchored at its feet tile) covers ANY of
   *  `tiles` — the multi-hit query behind a wide/line melee swing (plan 036 Step 3). Mirrors
   *  {@link enemyAt}'s hurtbox use; one enemy covering several arc tiles is returned once (dedupe by
   *  reference, since `find`-per-tile would double-count a tall/wide body straddling the arc). */
  enemiesInTiles(tiles: Cell[]): MonsterCharacter[] {
    return this.enemies.filter(
      (z) =>
        z.alive &&
        tiles.some((t) =>
          hurtboxContains({ col: z.col, row: z.row }, z.def.hurtbox ?? DEFAULT_HURTBOX, t),
        ),
    );
  }

  // --- Per-frame tick --------------------------------------------------------------

  /** Per-frame AI tick for every live monster. Builds the shared {@link MonsterTickEnv} world
   *  snapshot + effect callbacks (FX/damage/bus emissions all route back through `deps`); each
   *  MonsterCharacter *executes* its FSM decision (repath/move/contact-bite) — see
   *  MonsterCharacter.update. */
  update(): void {
    const pt = this.deps.playerTile();
    const playerStats = this.deps.playerStats();
    // The threat list (plan 042 Step 6): the player, always, plus the companion NPC when spawned AND
    // not downed. The FSM (acquire/chase) picks the nearest of these; the mob never targets itself (it's
    // not in the list) and a downed/absent NPC is simply omitted, so it's never a valid target.
    const threats: Threat[] = [
      {
        kind: 'player',
        pos: this.deps.playerPos(),
        tile: pt,
        bodyTiles: hurtboxTiles(pt, playerStats.hurtbox ?? DEFAULT_HURTBOX),
        stats: playerStats,
      },
    ];
    const npc = this.deps.companion();
    if (npc && !npc.downed) {
      threats.push({
        kind: 'npc',
        pos: npc.pos,
        tile: npc.tile,
        bodyTiles: hurtboxTiles(npc.tile, npc.stats.hurtbox ?? DEFAULT_HURTBOX),
        stats: npc.stats,
      });
    }
    const env: MonsterTickEnv = {
      nowMs: this.scene.time.now,
      threats,
      dims: this.deps.dims(),
      isBlocked: (col, row) => this.deps.isBlocked(col, row),
      rng: () => this.deps.rng(),
      lungeAt: (m, x, y) => this.deps.lungeAt(m, x, y),
      beginWindUp: (m, ms) => this.deps.beginWindUp(m, ms),
      endWindUp: (m) => this.deps.endWindUp(m),
      // Dispatch the bite's landed-hit feedback + damage to whichever threat the mob engaged.
      onThreatHurt: (threat) =>
        threat.kind === 'player' ? this.deps.onPlayerHurt() : this.deps.onNpcHurt(),
      damageThreat: (threat, amount) =>
        threat.kind === 'player' ? this.deps.damagePlayer(amount) : this.deps.damageNpc(amount),
      fire: this.deps.litHearth(), // plan 038 Step 4 — shared fire target for this tick's wave mobs
      attackFire: (id, amount) => this.deps.attackFire(id, amount),
      // Plan 037 chunk 2c — the generic structure-target seam (mirrors the fire seam above): find the
      // blocking wall, bash it, and route its thorns retaliation back through the kill path.
      structureAt: (col, row) => this.deps.structureAt(col, row),
      attackStructure: (id, dmg) => this.deps.attackStructure(id, dmg),
      hurtMonster: (m, amount) => this.hurtMonster(m, amount),
    };
    for (const z of this.enemies) {
      if (!z.alive) continue;
      z.update(env);
    }
  }

  /**
   * Apply damage to a live monster through the SAME path the player's attack uses (plan 037 2c thorns):
   * a survived blow gets the red hit-flash, a lethal one runs the full {@link killEnemy} collapse — so a
   * low-HP mob genuinely dies to a spiked wall's retaliation. No-op on an already-dead mob or a ≤0 amount.
   */
  private hurtMonster(z: MonsterCharacter, amount: number): void {
    if (!z.alive || amount <= 0) return;
    z.takeDamage(amount);
    if (z.hp <= 0) this.killEnemy(z);
    else this.deps.flashHit(z.sprite);
  }

  /** Damage a monster from an ENVIRONMENTAL source (a spike trap, plan 040) through the same
   *  hit-flash/kill path a wall's thorns use. Public seam for TrapBehavior via its dep closure —
   *  keeps `hurtMonster` (the internal thorns path) private while the trap reuses the exact kill route. */
  hurtEnemy(z: MonsterCharacter, amount: number): void {
    this.hurtMonster(z, amount);
  }

  // --- Combat ----------------------------------------------------------------------

  /**
   * Kill an enemy: pull it out of the AI/debugState set immediately (so nothing chases or counts it),
   * then let its sprite linger just long enough to play the one-shot Death collapse before removing
   * the corpse. The body is disabled so a corpse isn't a physics obstacle mid-animation, and any
   * in-flight flash/lunge is stopped first (those tweens poke the sprite, which is about to go away).
   */
  killEnemy(z: MonsterCharacter): void {
    this.enemies = this.enemies.filter((x) => x !== z);
    this.deps.cleanupActorFx(z.sprite); // also stops an in-flight weapon swing before the image goes away
    z.die(); // character-side collapse: alive=false, weapon/fists gone, body off, Death strip playing
    const sprite = z.sprite;
    this.deps.addCorpse(sprite);
    const dur = this.scene.anims.get(enemyDeathKey)?.duration ?? 600;
    // TEMP: hold the settled final frame for 5 minutes so the death anim can be observed on the corpse
    // (instead of the brief DEATH_HOLD_MS beat). Revisit once the skeleton death look is dialled in.
    const CORPSE_LINGER_MS = 5 * 60_000;
    this.scene.time.delayedCall(dur + CORPSE_LINGER_MS, () => {
      this.deps.removeCorpse(sprite);
      sprite.destroy();
    });
  }

  // --- Reset / teardown --------------------------------------------------------------

  /**
   * Destroy every enemy's sprite/weapon/fists and drop it. Called at RUNTIME (the scene/physics world
   * is alive), so `sprite.destroy()` is correct here — this is NOT the SHUTDOWN path (see class doc).
   * `resetIds` governs whether the id counter also resets: the DEV-only scenario reset
   * (`resetTreesAndEnemies` → `clearAll({ resetIds: true })`) wants fresh `enemy-0`-style ids each
   * scenario, while the dev-menu world randomiser (`randomiseWorld` → `clearAll({ resetIds: false })`)
   * deliberately keeps the counter running — pre-existing behaviour, preserved as-is.
   */
  clearAll(opts: { resetIds: boolean }): void {
    for (const z of this.enemies) {
      this.deps.cleanupActorFx(z.sprite);
      z.weapon?.sprite.destroy();
      z.hands?.main.destroy();
      z.hands?.off.destroy();
      z.sprite.destroy();
    }
    this.enemies = [];
    if (opts.resetIds) this.nextEnemyId = 0;
  }

  /**
   * SHUTDOWN: this run's enemies are going away with the rest of this manager instance (a fresh
   * EnemyManager is constructed by the next `buildWorld()`) — Phaser's own scene teardown, PLUS
   * Arcade's own SHUTDOWN-triggered World teardown, have already destroyed every sprite/body by the
   * time this fires (see class doc's SHUTDOWN-vs-Arcade-physics note). So this just drops the stale
   * references. Deliberately does NOT call {@link clearAll} here: that method's `sprite.destroy()` /
   * `deps.cleanupActorFx` calls are only safe while the scene/physics world is alive, which it no
   * longer is by the time SHUTDOWN fires.
   */
  private destroy(): void {
    this.enemies = [];
  }
}
