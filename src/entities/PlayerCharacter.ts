import type Phaser from 'phaser';
import {
  PLAYER_MAX_HP,
  PLAYER_START_SPEED,
  PLAYER_START_VISION,
  PLAYER_HURTBOX,
  ATTACK_MOVE_SLOW,
} from '../config';
import { ACTIVE_TILESET, playerAnimKey, type PlayerState } from '../data/tileset';
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

  /** The player's current move speed, cut to {@link ATTACK_MOVE_SLOW} of `stats.speed` while a swing
   * is in progress (the attack-lock window) so attacking commits you in place. Drives both the
   * pathfinder ({@link advancePath}) and the Combat-mode movepad (GameScene.update). */
  effectiveMoveSpeed(): number {
    const attacking = this.scene.time.now < this.attackLockUntil;
    return this.stats.speed * (attacking ? ATTACK_MOVE_SLOW : 1);
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
    const facing = this.facingDir();
    this.sprite.setScale((this.sprite.getData('baseScale') as number | undefined) ?? 1);
    this.sprite.setFlipX(facing === 'side' && this.lastFacing.dCol < 0);
    const key = playerAnimKey('death', facing);
    this.sprite.anims.play(key);
    return this.scene.anims.get(key)?.duration ?? 600;
  }
}
