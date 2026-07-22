import type Phaser from 'phaser';
import {
  PLAYER_MAX_HP,
  PLAYER_START_SPEED,
  PLAYER_START_VISION,
  PLAYER_HURTBOX,
  ATTACK_MOVE_SLOW,
  BOW_MOVE_SLOW,
  UNARMED_BASE_DAMAGE,
  UNARMED_MELEE_SHAPE,
} from '../config';
import { ACTIVE_TILESET, playerAnimKey, playerBowKey, type PlayerState } from '../data/tileset';
import type { AttackShape } from '../data/types';
import type { MeleeWeapon } from '../data/weapons';
import { worldToTile } from '../systems/grid';
import type { Cell } from '../systems/pathfind';
import { Character, type CharacterSprite } from './Character';

/**
 * The player-controlled worker (plan 013 Step 4). Owns the player sprite + stat construction
 * (constants stay in config.ts), the directional idle/walk/harvest animation, the attack-lock speed
 * cut, and the death collapse. The scene keeps everything coordination-shaped: the task loop that
 * drives `path`/`advancePath`, hunger (a player *need* ticked by the scene via systems/needs), mode
 * switching, and all bus emissions (`player:hpChanged`/`player:hit` stay scene-owned).
 */
export class PlayerCharacter extends Character {
  /** True from the moment HP hits 0 until the death-anim beat ends and the scene restarts.
   *  Freezes the world (see GameScene.update) and swallows further damage so a crowd can't
   *  re-trigger death. */
  dying = false;
  /** Scene-clock time until which the one-shot attack (sword) swing owns the sprite — updateAnim
   *  yields to it, and effectiveMoveSpeed cuts movement while it runs. Written by the FX manager
   *  via the scene's `setAttackLockUntil` dep (see GameScene's `fx` field). */
  attackLockUntil = 0;
  /** Scene-clock time until which a bow fire owns the player (plan 035a). Mirrors `attackLockUntil`
   *  but with a far lighter move-slow (`BOW_MOVE_SLOW` vs `ATTACK_MOVE_SLOW`), so shooting lets you
   *  keep kiting where melee roots you. Written by the scene's bow handler (`GameScene.bow`). */
  bowLockUntil = 0;
  /** Scene-clock time before which a new melee swing is refused (the cooldown gate, `ATTACK_COOLDOWN_MS`).
   *  Set by `GameScene.attack`; a press while `now < meleeReadyAt` is ignored so mashing can't stack
   *  hits or restart the swing. Distinct from `attackLockUntil` (the move-slow commit window). */
  meleeReadyAt = 0;
  /** As {@link meleeReadyAt} but for the bow (`BOW_COOLDOWN_MS`) — set by `GameScene.bow`. */
  bowReadyAt = 0;
  /** Currently equipped melee weapon, or `undefined` for unarmed (plan 036). Sources the swing's
   *  footprint + base damage via {@link meleeShape}/{@link meleeBaseDamage}. Minimal by design: no
   *  inventory, no equipment slot, no render change — Step 3 wires the scene to read these. */
  meleeWeapon?: MeleeWeapon;

  constructor(scene: Phaser.Scene, spawn: { x: number; y: number }) {
    // Player: 3-way directional idle + walk (down/side/up). Each strip is its own texture (key ==
    // anim key, loaded in PreloadScene); side art faces right, updateAnim mirrors it with flipX.
    // Spawn is passed in (plan 018 A11: the authored SPAWN_TILE + map origin, computed by GameScene)
    // rather than the old fixed map-centre, so the player lands on the start map's authored spawn tile.
    const { player: playerActor } = ACTIVE_TILESET.actors;
    const sprite = scene.add.sprite(spawn.x, spawn.y, playerAnimKey('idle', 'down'));
    scene.physics.add.existing(sprite);
    super(scene, sprite as CharacterSprite, {
      maxHp: PLAYER_MAX_HP,
      armour: 0,
      speed: PLAYER_START_SPEED,
      vision: PLAYER_START_VISION,
      strength: 0,
      dex: 0,
      dodge: 0,
      hurtbox: PLAYER_HURTBOX,
    });
    this.sprite
      .setDepth(10)
      .setScale(playerActor.render.scale)
      .setOrigin(playerActor.render.originX, playerActor.render.originY);
    this.sprite.setData('baseScale', playerActor.render.scale); // rest scale the flinch squash returns to
    this.sprite.body.setCollideWorldBounds(true);
    this.fitBody(playerActor.render);
  }

  /** Equip (or, with `undefined`, unequip back to unarmed) the player's melee weapon (plan 036). */
  setMeleeWeapon(w?: MeleeWeapon): void {
    this.meleeWeapon = w;
  }

  /** The footprint the current melee swing covers — the equipped weapon's shape, or the unarmed
   *  default ({@link UNARMED_MELEE_SHAPE}: today's single front tile). Consumed by the scene's attack
   *  (Step 3) via `attackTiles`. */
  meleeShape(): AttackShape {
    return this.meleeWeapon?.attackShape ?? UNARMED_MELEE_SHAPE;
  }

  /** Base damage of the current melee swing — the equipped weapon's `damage`, or
   *  {@link UNARMED_BASE_DAMAGE} when bare-handed. */
  meleeBaseDamage(): number {
    return this.meleeWeapon?.damage ?? UNARMED_BASE_DAMAGE;
  }

  /** The player's current move speed, cut while an action commits you in place: hard to
   * {@link ATTACK_MOVE_SLOW} during a melee swing (roots you), gently to {@link BOW_MOVE_SLOW} during
   * a bow fire (kite-able). Melee wins if both windows somehow overlap (the heavier slow). Drives both
   * the pathfinder ({@link advancePath}) and the Combat-mode movepad (GameScene.update). */
  effectiveMoveSpeed(): number {
    const now = this.scene.time.now;
    const mult =
      now < this.attackLockUntil ? ATTACK_MOVE_SLOW : now < this.bowLockUntil ? BOW_MOVE_SLOW : 1;
    return this.stats.speed * mult;
  }

  protected override moveSpeed(): number {
    return this.effectiveMoveSpeed();
  }

  /** Face along the path each step, whether or not this step arrives at the waypoint. */
  protected override onBeforeStep(wp: Cell): void {
    const dCol = Math.sign(wp.col - worldToTile(this.sprite.x));
    const dRow = Math.sign(wp.row - worldToTile(this.sprite.y));
    if (dCol !== 0 || dRow !== 0) this.lastFacing = { dCol, dRow };
  }

  /**
   * Directional player animation from `lastFacing`. Priority: a one-shot attack (sword) swing owns
   * the sprite until it finishes (we yield, leaving its frames to play); else the looping harvest
   * swing (`harvestSwing`: chop/axe on a tree, mine/pickaxe on a rock, gather on a bush — task-loop
   * state the scene passes in) while working in place; else walk while translating / idle when
   * still. Side art faces right, so left is the same strip mirrored with flipX; down/up clear flipX.
   */
  updateAnim(harvestSwing: 'chop' | 'mine' | 'gather' | null): void {
    if (this.dying) return; // death collapse owns the sprite until the restart
    if (this.scene.time.now < this.attackLockUntil) return; // attack swing in progress — don't stomp it
    if (this.scene.time.now < this.bowLockUntil) {
      // Bow draw/loose. SIDE has dedicated art — a one-shot draw→loose strip (playerBowKey,
      // AI-generated, bakes its own bow) played and held for the lock. DOWN/UP have no bow art
      // (the model can't hold a coherent bow toward/away from camera), so they still reuse the
      // Pierce (`attack`) strip as a coded stand-in — a committed forward motion that reads as
      // loosing. Either way the arrow tracer + target highlight (CombatFxManager) carry the
      // actual "ranged" read, and the light BOW_MOVE_SLOW lets you kite. Held (played with
      // ignoreIfPlaying) for the window so update()'s per-frame call can't stomp it back to
      // idle/walk — same "one state owns the sprite" discipline as the attack-lock above.
      const facing = this.facingDir();
      this.sprite.setFlipX(facing === 'side' && this.lastFacing.dCol < 0);
      this.sprite.anims.play(
        facing === 'side' ? playerBowKey : playerAnimKey('attack', facing),
        true,
      );
      return;
    }
    const facing = this.facingDir();
    const state: PlayerState =
      harvestSwing ?? (this.sprite.body.velocity.lengthSq() > 1 ? 'walk' : 'idle');
    this.sprite.setFlipX(facing === 'side' && this.lastFacing.dCol < 0);
    this.sprite.anims.play(playerAnimKey(state, facing), true);
  }

  /** Ignored once dying (a crowd/starve tick can't re-hit a collapsing player); clamps at 0. */
  override takeDamage(amount: number): void {
    if (this.dying) return;
    this.hp = Math.max(0, this.hp - amount);
  }

  /**
   * The character-side death collapse: freeze + play the one-shot Death strip in the current facing,
   * returning its duration so the scene can schedule the restart beat (the "Death = restart" path —
   * see GameScene.killPlayer, which pairs this with FX cleanup + the delayed `scene.restart()`).
   */
  override die(): number {
    this.dying = true;
    this.sprite.body.setVelocity(0, 0);
    this.attackLockUntil = 0;
    this.meleeReadyAt = 0;
    this.bowReadyAt = 0;
    const facing = this.facingDir();
    this.sprite.setScale((this.sprite.getData('baseScale') as number | undefined) ?? 1);
    this.sprite.setFlipX(facing === 'side' && this.lastFacing.dCol < 0);
    const key = playerAnimKey('death', facing);
    this.sprite.anims.play(key);
    return this.scene.anims.get(key)?.duration ?? 600;
  }
}
