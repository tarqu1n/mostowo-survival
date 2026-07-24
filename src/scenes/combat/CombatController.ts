import Phaser from 'phaser';
import {
  ATTACK_COOLDOWN_MS,
  BOW_COOLDOWN_MS,
  BOW_DRAW_MS,
  BOW_BASE_DAMAGE,
  BOW_RANGE_TILES,
  ENEMY_HIT_SHAKE_MS,
  ENEMY_HIT_SHAKE_INTENSITY,
  PLAYER_HIT_SHAKE_MS,
  PLAYER_HIT_SHAKE_INTENSITY,
  DEATH_HOLD_MS,
} from '../../config';
import { resolveMeleeAttack, resolveRangedAttack } from '../../systems/combat';
import { attackTiles } from '../../systems/hurtbox';
import { breadcrumb } from '../../debug/crashReporter';
import type { PlayerCharacter } from '../../entities/PlayerCharacter';
import type { MonsterCharacter } from '../../entities/MonsterCharacter';
import type { CharacterSprite } from '../../entities/Character';
import type { Cell } from '../../systems/pathfind';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link CombatController} needs but doesn't own — GameScene supplies these as
 * closures over its own private fields/managers at construction (plan 013/015 coupling rules: managers
 * get narrow interfaces, not raw field access, and never a direct manager↔manager edge — the scene
 * mediates). The FX seams route to CombatFxManager and the enemy seams to EnemyManager, both through
 * the scene, so this controller never edges to either manager directly. `rng` is a closure (not a
 * snapshot) so a later setRng reassignment (the DEV-only test API) is picked up live, mirroring how
 * EnemyManager threads its rng.
 */
export interface CombatControllerDeps {
  /** The live player character entity — combat reads/mutates its cooldowns, facing, stats, and hp. A
   *  getter (not a captured reference) so it always resolves the current PlayerCharacter. */
  playerChar(): PlayerCharacter;
  /** Injectable hit-roll rng (the scene's `this.rng`) — a closure so the DEV test API's pinned rng is
   *  live for both melee and ranged rolls. */
  rng(): number;
  /** Every enemy, alive AND dead (EnemyManager.all()) — target selection filters `alive` itself. */
  enemies(): MonsterCharacter[];
  /** Enemies whose hurtbox reaches any of the melee swing tiles (EnemyManager.enemiesInTiles). */
  enemiesInTiles(tiles: Cell[]): MonsterCharacter[];
  /** Play an enemy's death collapse + schedule corpse removal (EnemyManager.killEnemy). */
  killEnemy(target: MonsterCharacter): void;
  /** Play the player's one-shot attack swing + lock the anim (CombatFxManager.playAttackSwing). */
  playAttackSwing(): void;
  /** Red flash + squash-flinch on a sprite that took a survived hit (CombatFxManager.flashHit). */
  flashHit(sprite: CharacterSprite): void;
  /** Loose a coded arrow tracer player→target (CombatFxManager.fireArrow) — pure FX; damage is hitscan. */
  fireArrow(fromX: number, fromY: number, toX: number, toY: number): void;
  /** Keep the bow's current-target highlight glued to `sprite`, or hide it when null
   *  (CombatFxManager.syncBowTargetHighlight). */
  syncBowTargetHighlight(sprite: CharacterSprite | null): void;
  /** Stop any in-flight hit-flash tween before the player sprite freezes on death
   *  (CombatFxManager.cleanupActorFx). */
  cleanupActorFx(sprite: CharacterSprite): void;
  /** Clear the task queue + stop the worker — the player-death reset (GameScene.cancelAll). */
  cancelAll(): void;
  /** Whether a bow is equipped in the ranged slot (plan 049) — the gate on {@link CombatController.bow}.
   *  No bow ⇒ ranged is disabled (the crafted bow is the first ranged weapon), and the HUD hides the
   *  Bow button off the same `equipment` store. */
  hasBow(): boolean;
}

/**
 * Player combat — melee swing, bow fire + auto-target, and the player-damage/hurt/death flow. Moved
 * verbatim out of GameScene (behavior-preserving split): every damage number, target-pick rule, death
 * flow, and bus emission is identical to the old inline methods. GameScene still owns the *wiring* — it
 * constructs this in `buildWorld()`, its `wireBus()` combat handlers (`combat:attack`/`combat:bow`)
 * delegate here, and the EnemyManager/SurvivalClock bite/starve edges route to {@link damagePlayer}.
 *
 * Owns the bow's auto-target (`bowTargetId`) — the one bit of per-run state here; GameScene reads it
 * via the getter (the per-frame HP-bar sync + the DEV state dump) and the fresh construction per
 * `buildWorld()` resets it, so a death-restart starts with no target. Registers a `destroy()` on
 * SHUTDOWN like the other managers, dropping that reference (the FX highlight itself is owned + torn
 * down by CombatFxManager).
 */
export class CombatController {
  // The enemy the bow currently has locked as its auto-target (plan 035a Step 5), by MonsterCharacter
  // id — or null when no target. Set on a bow fire (pickBowTarget), reconciled every frame
  // (syncBowTarget: cleared when the target dies or leaves BOW_RANGE_TILES).
  private targetId: string | null = null;

  constructor(
    private readonly scene: GameScene,
    private readonly deps: CombatControllerDeps,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** The bow's current auto-target id (or null) — read by GameScene's per-frame HP-bar sync + the DEV
   *  state dump, which used to read the scene field directly. */
  get bowTargetId(): string | null {
    return this.targetId;
  }

  /** Drop the bow's auto-target (the DEV test API's `clearBowTarget` seam). */
  clearBowTarget(): void {
    this.targetId = null;
  }

  /**
   * Attack the tiles the current melee swing covers: flat damage via the shared combat formula to
   * EVERY distinct alive enemy the swing's shape reaches (plan 036 — a cleave/line hits all of them,
   * each once; unarmed's single front tile reproduces the old one-target behaviour). Shape + base
   * damage come from the equipped weapon (or the unarmed default); an enemy is hit anywhere its
   * hurtbox reaches a swing tile (see EnemyManager.enemiesInTiles). Enemies only; trees keep chop().
   */
  attack(): void {
    const player = this.deps.playerChar();
    // Cooldown gate (playtest fix): a press inside the window is ignored outright — no swing, no
    // damage — so mashing MELEE can't machine-gun hits or restart the swing mid-animation.
    if (this.scene.time.now < player.meleeReadyAt) return;
    player.meleeReadyAt = this.scene.time.now + ATTACK_COOLDOWN_MS;
    this.deps.playAttackSwing(); // swing on every (accepted) press, even a whiff, so the input feels heard
    const shape = player.meleeShape();
    const tiles = attackTiles(player.tile(), player.lastFacing, shape);
    // Enemies only — walls are deliberately IMMUNE to player weapons (plan 037 decision #1): the only
    // targets are the enemies in the swing tiles, never the wall structures. A wall is removed by a worker
    // deconstruct order (decision #6, see runDeconstruct), not by hitting it; only mob attacks lower a
    // wall's HP (chunk 2c). (Plan 036 will fold this into the `attackTiles` generator when it lands.)
    const targets = this.deps.enemiesInTiles(tiles);
    const base = player.meleeBaseDamage();
    let anyHit = false;
    for (const target of targets) {
      const dmg = resolveMeleeAttack(player.stats, target.def, base, this.deps.rng);
      target.takeDamage(dmg);
      if (target.hp <= 0) {
        this.deps.killEnemy(target); // play the death collapse, then remove the corpse
        anyHit = true;
      } else if (dmg > 0) {
        this.deps.flashHit(target.sprite); // red flash + flinch on a hit it survived (killing hits skip this)
        anyHit = true;
      }
    }
    // One camera kick for the swing if it connected at all (not per enemy) — a whiff gets just the swing.
    if (anyHit) this.scene.cameras.main.shake(ENEMY_HIT_SHAKE_MS, ENEMY_HIT_SHAKE_INTENSITY);
  }

  /**
   * Loose an arrow (plan 035a Step 5). Commit to the brief bow-fire lock (light `BOW_MOVE_SLOW` — you
   * can keep kiting, unlike the melee root), then auto-target the nearest live enemy in bow range
   * biased to the current facing ({@link pickBowTarget}). With a target: turn to face it, fly a coded
   * arrow tracer at it, and resolve ranged damage (hitscan — the tracer is pure FX) via the shared
   * {@link resolveRangedAttack}. Unlimited ammo. Firing with nothing in range still spends the lock +
   * plays the draw pose (the Bow button always feels heard) and just clears the target.
   */
  bow(): void {
    // Equip gate (plan 049): ranged is disabled until a bow is equipped. The HUD hides the Bow button
    // when none is equipped, so this defends the bus path (a stray `combat:bow` is a silent no-op).
    if (!this.deps.hasBow()) return;
    const player = this.deps.playerChar();
    // Cooldown gate (playtest fix), same as melee: a press inside the window is ignored so the Bow
    // button can't be spammed to loose arrows faster than the draw cadence.
    if (this.scene.time.now < player.bowReadyAt) return;
    player.bowReadyAt = this.scene.time.now + BOW_COOLDOWN_MS;
    player.bowLockUntil = this.scene.time.now + BOW_DRAW_MS;
    const target = this.pickBowTarget();
    if (!target) {
      this.targetId = null;
      return;
    }
    this.targetId = target.id;
    player.faceTile(target.col, target.row); // release pose + tracer point at the target
    this.deps.fireArrow(player.sprite.x, player.sprite.y, target.sprite.x, target.sprite.y);
    const dmg = resolveRangedAttack(player.stats, target.def, BOW_BASE_DAMAGE, this.deps.rng);
    target.takeDamage(dmg);
    if (target.hp <= 0) {
      this.deps.killEnemy(target); // death collapse + corpse linger, same as a melee kill
      this.targetId = null;
    } else if (dmg > 0) {
      this.deps.flashHit(target.sprite); // red flash + flinch on a hit it survived (mirrors attack())
      this.scene.cameras.main.shake(ENEMY_HIT_SHAKE_MS, ENEMY_HIT_SHAKE_INTENSITY);
    }
  }

  /**
   * Pick the bow's auto-target: the nearest live enemy within {@link BOW_RANGE_TILES} (Euclidean
   * tiles) of the player, **biased to the current facing** — if any in-range enemy lies in the facing
   * hemisphere (the dot of its offset with `lastFacing` is positive), the nearest of THOSE wins;
   * otherwise the nearest in range regardless of side. So facing a direction preferentially shoots
   * what you're looking at, but you still hit something creeping up behind if it's all that's near.
   */
  private pickBowTarget(): MonsterCharacter | undefined {
    const player = this.deps.playerChar();
    const pt = player.tile();
    const f = player.lastFacing;
    const dist = (z: MonsterCharacter): number => Math.hypot(z.col - pt.col, z.row - pt.row);
    const inRange = this.deps.enemies().filter((z) => z.alive && dist(z) <= BOW_RANGE_TILES);
    if (inRange.length === 0) return undefined;
    const inFacing = inRange.filter(
      (z) => (z.col - pt.col) * f.dCol + (z.row - pt.row) * f.dRow > 0,
    );
    const pool = inFacing.length ? inFacing : inRange;
    return pool.reduce((best, z) => (dist(z) < dist(best) ? z : best));
  }

  /** Reconcile the bow's current target each frame + keep its highlight glued to it (plan 035a Step
   *  5). Drops the target when it's gone (killed/removed) or has walked out of {@link BOW_RANGE_TILES}
   *  — "clears when the target dies/leaves range" — then hands the live target sprite (or null) to the
   *  FX highlight, which re-hugs its bounds. */
  syncBowTarget(): void {
    let target = this.targetId
      ? this.deps.enemies().find((z) => z.id === this.targetId && z.alive)
      : undefined;
    if (target) {
      const pt = this.deps.playerChar().tile();
      if (Math.hypot(target.col - pt.col, target.row - pt.row) > BOW_RANGE_TILES)
        target = undefined;
    }
    this.targetId = target?.id ?? null;
    this.deps.syncBowTargetHighlight(target?.sprite ?? null);
  }

  /** Apply incoming damage to the player; on death, restart the scene (see Context & decisions'
   * "Death = restart" — no in-place heal, since that let an adjacent enemy immediately re-hit a
   * "reset" player). Wired to the EnemyManager bite + SurvivalClock starve edges via GameScene. */
  damagePlayer(amount: number): void {
    const player = this.deps.playerChar();
    if (player.dying) return; // already collapsing — ignore further bites/starve ticks until restart
    player.takeDamage(amount);
    this.scene.game.events.emit('player:hpChanged', {
      hp: player.hp,
      maxHp: player.stats.maxHp,
    });
    if (player.hp <= 0) this.killPlayer();
  }

  /** Player took a landed hit: the shared "you're hurt" feedback — the red flash + squash on the
   * sprite, a firm camera kick, and a `player:hit` event UIScene turns into a red damage vignette round
   * the screen edges. Deliberately *not* on the starvation drain (a passive tick, not an impact); it
   * fires from the bite site so getting bitten is unmissable even when you're not watching your feet. */
  onPlayerHurt(): void {
    this.deps.flashHit(this.deps.playerChar().sprite);
    this.scene.cameras.main.shake(PLAYER_HIT_SHAKE_MS, PLAYER_HIT_SHAKE_INTENSITY);
    this.scene.game.events.emit('player:hit');
  }

  /**
   * Player death: freeze the world on a one-shot Death collapse, then restart the scene (the existing
   * "Death = restart" reset — see damagePlayer). Guarded by `playerChar.dying` so a crowd of enemies
   * can't re-enter this each frame. We cancel any active order and clear an in-flight hit-flash, then
   * `playerChar.die()` freezes + plays the collapse; update() holds everything still until the
   * scheduled restart fires (the delayedCall runs on the scene clock, which the test harness drives).
   */
  private killPlayer(): void {
    console.log('player down — restarting'); // the death→restart signal the death spec asserts
    breadcrumb('world', 'player died → scene.restart scheduled');
    this.deps.cancelAll();
    this.deps.cleanupActorFx(this.deps.playerChar().sprite); // clear an in-flight hit-flash so the corpse isn't left mid-squash
    const dur = this.deps.playerChar().die(); // freezes + plays the collapse; returns its duration
    this.scene.time.delayedCall(dur + DEATH_HOLD_MS, () => this.scene.scene.restart());
  }

  /** Drop the bow-target reference on scene SHUTDOWN (registered in the constructor) — the FX highlight
   *  itself is owned + torn down by CombatFxManager, so there is nothing else here to clean up. */
  destroy(): void {
    this.targetId = null;
  }
}
