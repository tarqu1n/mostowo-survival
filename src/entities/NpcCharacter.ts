import type Phaser from 'phaser';
import {
  NPC_MAX_HP,
  NPC_SPEED,
  NPC_VISION,
  NPC_STRENGTH,
  NPC_HURTBOX,
  NPC_MELEE_WEAPON_ID,
  NPC_REVIVE_HP,
  WEAPON_SWING_ARC_DEG,
  WEAPON_SWING_SCALE_POP,
  WEAPON_SWING_MS,
} from '../config';
import {
  ACTIVE_TILESET,
  resolveTile,
  npcAnimKey,
  type AttachPoint,
  type WeaponArt,
} from '../data/tileset';
import { MELEE_WEAPONS, type MeleeWeapon } from '../data/weapons';
import { weaponTransform } from '../systems/attachment';
import type { Cell } from '../systems/pathfind';
import { Character, type CharacterSprite } from './Character';

/** The companion's single assignable DAY job (plan 042): scavenge with the player (`gather`) or mend
 *  the base's structures (`repair`). Toggled between the two; behaviour lands in a later step. */
export type NpcDayRole = 'gather' | 'repair';
/** The companion's NIGHT posture (plan 042): hold the fire line (`guard`), stick to the player
 *  (`follow`), or feed the hearth (`refuel`). Behaviour lands in a later step. */
export type NpcNightPosture = 'guard' | 'follow' | 'refuel';

/**
 * The NPC companion — the Rogue (plan 042), a THIRD {@link Character} subclass alongside
 * `PlayerCharacter`/`MonsterCharacter`. Owns the Rogue sprite (single-orientation flip3, faked-facing
 * by `flipX`, like the skeleton) + a hand-built `CombatantStats` from the `NPC_*` config block (the
 * player pattern — a named constants block, not a data catalogue). It carries a melee weapon from
 * `MELEE_WEAPONS` on the SAME weapon/hand pin rig the skeleton uses, so its swing reads even though the
 * Rogue ships no attack strip; the Death strip is its downed/revive visual.
 *
 * Step 1 is the ENTITY + SPRITE + CONFIG foundation only: the day-role / night-posture / `downed`
 * fields are state SCAFFOLD with sensible defaults — the gather/repair/guard/follow/refuel behaviour,
 * the directed swing, and the dawn revive all land in later steps. The scene drives `path`/
 * `advancePath()`/`updateAnim()` (a temporary dev seam today; `CompanionManager` in Step 2).
 */
export class NpcCharacter extends Character {
  // --- Role / posture / downed scaffold (plan 042 Step 1) — behaviour lands later -----------------
  /** The assignable day job; defaults to scavenging with the player. */
  dayRole: NpcDayRole = 'gather';
  /** The night posture; defaults to sticking with the player. */
  nightPosture: NpcNightPosture = 'follow';
  /** True from collapse (0 HP) until the dawn revive (later step). While set, the Death strip owns the
   *  sprite and `updateAnim` yields. Doubles as the PlayerCharacter-style "don't re-trigger" guard. */
  downed = false;
  /** Units currently ferried in the carry buffer (0..`NPC_CARRY_CAP`) — SCAFFOLD (plan 042 Step 2): the
   *  gather loop that fills it + the base-supply drop that empties it land in later steps. Surfaced in
   *  `debugState().companion.carry` so a spec can read it back. */
  carry = 0;
  /** The night guard tile the `'guard'` posture will hold — SCAFFOLD (plan 042 Step 2): seeded by a
   *  scenario's `companion.guardAt` / the `setNpcGuardPoint` dev seam; the guard behaviour that reads it
   *  lands in a later step. `null` until assigned. */
  guardPoint: Cell | null = null;

  /** The equipped melee weapon (gameplay stats from `MELEE_WEAPONS`) — the eventual directed swing
   *  (Step 7) reads its `damage`/`attackShape`. Fixed at construction; no inventory/equip UI yet. */
  readonly meleeWeapon: MeleeWeapon;

  /** Which footprint the sprite currently shows — the 32px Idle, the 64px Run/`walk`, or the 56px
   *  one-shot `attack` — so {@link setFootprint} only swaps scale/origin/body on an actual state change
   *  (see the skeleton). `attack` is transient; {@link playAttack} sets it and {@link updateAnim}
   *  swaps back to idle/walk once the strip finishes. */
  private activeStrip: 'idle' | 'walk' | 'attack' = 'walk'; // the constructor sets up the 64px Run footprint
  /** True while the one-shot attack strip is playing: {@link updateAnim} yields (the strip owns the
   *  sprite) and the pinned weapon/mitts are hidden (the strip draws its own dagger + hands). */
  private attacking = false;
  /** The held blade (plain image, no physics body), pinned to the main hand each tick. `swingRot` is
   *  the live coded-swing angle (deg) the directed strike tween drives (plan 042 Step 7); 0 at rest, so
   *  a still companion holds the blade at its rest angle. */
  private weapon?: { sprite: Phaser.GameObjects.Image; art: WeaponArt; swingRot: number };
  /** The two visible mitts (the Rogue's own hands are unreadable nubs): `main` grips the weapon, `off`
   *  is the free fist — always present, pinned each tick in {@link syncAttachments} (see the skeleton). */
  private hands?: { main: Phaser.GameObjects.Image; off: Phaser.GameObjects.Image };

  constructor(scene: Phaser.Scene, spawn: { x: number; y: number }) {
    const npcActor = ACTIVE_TILESET.actors.npc;
    // Start on the Run strip (frame 0 doubles as the frozen idle pose), like the skeleton; the depth-9
    // matches the enemy so the companion layers with the other actors.
    const sprite = scene.add.sprite(spawn.x, spawn.y, npcAnimKey('walk')).setDepth(9);
    sprite
      .setScale(npcActor.render.scale)
      .setOrigin(npcActor.render.originX, npcActor.render.originY);
    sprite.setData('baseScale', npcActor.render.scale); // rest scale a future flinch squash returns to
    scene.physics.add.existing(sprite);
    super(scene, sprite as CharacterSprite, {
      maxHp: NPC_MAX_HP,
      armour: 0,
      speed: NPC_SPEED,
      vision: NPC_VISION,
      strength: NPC_STRENGTH,
      dex: 0,
      dodge: 0,
      hurtbox: NPC_HURTBOX,
    });
    this.meleeWeapon = MELEE_WEAPONS[NPC_MELEE_WEAPON_ID];
    this.sprite.body.setCollideWorldBounds(true);
    this.fitBody(npcActor.render);

    this.buildRig(); // create the weapon + fists (rebuilt on the dawn revive, plan 042 Step 7)
    this.syncAttachments(); // place weapon + fists on frame 0
  }

  /**
   * Build the held-weapon + two-mitt rig — the SAME approach as the skeleton (MonsterCharacter): a
   * plain weapon image pinned to the main-hand anchor, drawn over two layered mitts, all pinned each
   * tick in {@link syncAttachments}. Extracted so the dawn {@link revive} can rebuild it after
   * {@link die} tore it down. The coded swing rides `weapon.swingRot` (plan 042 Step 7, {@link swingWeapon}).
   */
  private buildRig(): void {
    const npcActor = ACTIVE_TILESET.actors.npc;
    const sprite = this.sprite;
    const art = npcActor.weapons[NPC_MELEE_WEAPON_ID];
    if (art) {
      const wsprite = this.scene.add
        .image(sprite.x, sprite.y, resolveTile(art.source).key)
        .setOrigin(art.pivot[0], art.pivot[1])
        .setScale(art.scale ?? 1)
        .setDepth(sprite.depth + art.z);
      this.weapon = { sprite: wsprite, art, swingRot: 0 };
    }
    const handArt = npcActor.hand;
    const offKey = resolveTile(handArt.source).key;
    const mainKey = resolveTile(handArt.mainSource ?? handArt.source).key;
    const mkHand = (key: string, z: number): Phaser.GameObjects.Image =>
      this.scene.add
        .image(sprite.x, sprite.y, key)
        .setOrigin(handArt.pivot[0], handArt.pivot[1])
        .setDepth(sprite.depth + z);
    this.hands = { main: mkHand(mainKey, handArt.mainZ), off: mkHand(offKey, handArt.offZ) };
  }

  protected override moveSpeed(): number {
    return this.stats.speed;
  }

  /**
   * Animation each tick: the Run cycle while translating (flipped by movement-x — art faces right),
   * else the Idle bob when stationary. The footprint (scale/origin/body) swaps only on a state change
   * (setFootprint). Mirrors the skeleton's flip3 handling; the melee-swing tell rides the weapon rig,
   * wired in a later step. Yields while `downed` (the Death strip owns the sprite).
   */
  updateAnim(): void {
    if (this.downed) return; // death collapse owns the sprite until the (later) revive
    if (this.attacking) return; // the one-shot attack strip owns the sprite until it completes
    const moving = this.sprite.body.velocity.lengthSq() > 1;
    this.setFootprint(moving ? 'walk' : 'idle');
    if (moving) {
      const vx = this.sprite.body.velocity.x;
      if (vx !== 0) this.sprite.setFlipX(vx < 0);
      this.sprite.anims.play(npcAnimKey('walk'), true);
    } else {
      this.sprite.anims.play(npcAnimKey('idle'), true);
    }
    this.syncAttachments(); // pin the weapon + both fists to this frame's hand anchors
  }

  /**
   * The character-side death collapse (plan 042): mark `downed`, drop the weapon + fists (the Death
   * strip carries no anchors, so a pinned mitt would freeze mid-air over the body), freeze velocity,
   * and play the one-shot Death strip on its own 32px footprint. The dawn revive that clears `downed`
   * and stands it back up (`NPC_REVIVE_HP`) is a later step; the scene pairs this with any FX.
   */
  override die(): void {
    this.downed = true;
    // Cancel an in-flight attack strip so its completion listener can't fire post-death (die plays the
    // Death anim, so 'animationcomplete-attack' would never arrive and `attacking` would stick).
    this.attacking = false;
    this.sprite.off(`animationcomplete-${npcAnimKey('attack')}`);
    if (this.weapon) {
      this.scene.tweens.killTweensOf(this.weapon); // stop an in-flight swing before the image goes away
      this.weapon.sprite.destroy();
      this.weapon = undefined;
    }
    if (this.hands) {
      this.hands.main.destroy();
      this.hands.off.destroy();
      this.hands = undefined;
    }
    this.sprite.body.setVelocity(0, 0);
    this.sprite.body.enable = false; // inert while downed — no collision on the collapsed body (revive re-enables)
    // Death is a 32px strip — settle onto its own footprint (like the Idle) so the collapse grounds on
    // the tile instead of playing at the 64px Run scale/origin.
    const { death, render } = ACTIVE_TILESET.actors.npc;
    const deathRender = death.render ?? render;
    this.sprite.setScale(deathRender.scale).setOrigin(deathRender.originX, deathRender.originY);
    this.sprite.setData('baseScale', deathRender.scale);
    this.sprite.anims.play(npcAnimKey('death'));
  }

  /**
   * The directed melee swing (plan 042 Step 7): face the struck tile and arc the held blade about its
   * grip (`WEAPON_SWING_*`, yoyo with a small scale pop), reusing the weapon-pin rig —
   * {@link syncAttachments} folds `weapon.swingRot` into the main-hand pin each tick, so the blade
   * arcs while still tracking the hand (the SAME coded swing the skeleton's bite uses; the pack ships
   * the Rogue no attack strip). Purely visual — the hit is resolved by `CompanionManager`. No-op while
   * downed or unarmed.
   */
  swingWeapon(col: number, row: number): void {
    if (this.downed) return;
    this.faceTile(col, row); // point the swing at the struck tile, whatever side we stood on
    const w = this.weapon;
    if (!w) return;
    this.scene.tweens.killTweensOf(w); // a rapid re-strike restarts the swing rather than stacking it
    w.swingRot = 0;
    const baseScale = w.sprite.scale;
    this.scene.tweens.add({
      targets: w,
      swingRot: WEAPON_SWING_ARC_DEG, // always a +arc; weaponTransform mirrors it when facing left
      duration: WEAPON_SWING_MS,
      yoyo: true,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        if (!w.sprite.active) return; // destroyed mid-swing (die/teardown) — don't poke it
        const p = w.swingRot / WEAPON_SWING_ARC_DEG; // 0→1→0 across the yoyo
        w.sprite.setScale(baseScale * (1 + (WEAPON_SWING_SCALE_POP - 1) * p));
      },
      onComplete: () => {
        w.swingRot = 0;
        if (w.sprite.active) w.sprite.setScale(baseScale);
      },
    });
  }

  /**
   * Play the one-shot overhead dagger-slash ATTACK strip (plan 043) toward the struck tile — the
   * AI-generated sheet ({@link docs/AI-SPRITE-PIPELINE.md}) that replaces the coded {@link swingWeapon}
   * as the companion's visible strike. The strip has its own 56px footprint and draws its OWN baked
   * dagger + hands, so the pinned weapon/mitts are hidden for its duration and re-shown on completion;
   * `updateAnim` yields while it plays, then swaps back to idle/walk (activeStrip 'attack' forces the
   * {@link setFootprint} re-apply). Purely visual — the hit is resolved by `CompanionManager`. No-op
   * while downed.
   */
  playAttack(col: number, row: number): void {
    if (this.downed) return;
    this.faceTile(col, row);
    const t = this.tile();
    const dCol = Math.sign(col - t.col);
    if (dCol !== 0) this.sprite.setFlipX(dCol < 0); // art faces right; mirror to face left
    this.attacking = true;
    this.activeStrip = 'attack';
    const npc = ACTIVE_TILESET.actors.npc;
    const render = npc.attack.render ?? npc.render;
    this.sprite.setTexture(npcAnimKey('attack'), 0);
    this.sprite.setScale(render.scale).setOrigin(render.originX, render.originY);
    this.sprite.setData('baseScale', render.scale);
    this.fitBody(render);
    this.setRigVisible(false); // the strip draws its own dagger + hands
    const key = npcAnimKey('attack');
    this.sprite.off(`animationcomplete-${key}`); // drop any stale listener from a rapid re-strike
    this.sprite.once(`animationcomplete-${key}`, () => {
      this.attacking = false;
      this.setRigVisible(true); // updateAnim re-pins + swaps footprint back next tick
    });
    this.sprite.anims.play(key);
  }

  /** Show/hide the pinned weapon + both mitts as one — hidden while the attack strip (which bakes its
   *  own dagger + hands) plays, so the two don't double up. */
  private setRigVisible(visible: boolean): void {
    this.weapon?.sprite.setVisible(visible);
    this.hands?.main.setVisible(visible);
    this.hands?.off.setVisible(visible);
  }

  /**
   * The dawn revive (plan 042 Step 7): stand a downed companion back up at {@link NPC_REVIVE_HP}. Clears
   * `downed`, re-enables the physics body, rebuilds the weapon/fist rig {@link die} tore down, and
   * restores the default Run footprint (die switched the sprite to the 32px Death render) so
   * {@link updateAnim} resumes normally. Idempotent — a no-op when not downed. `CompanionManager`
   * calls this on the night→day edge, then resumes the day role.
   */
  revive(): void {
    if (!this.downed) return;
    this.downed = false;
    this.hp = NPC_REVIVE_HP;
    const npcActor = ACTIVE_TILESET.actors.npc;
    this.sprite.body.enable = true;
    this.sprite.body.setVelocity(0, 0);
    // Restore the default Run footprint (die() left the sprite on the 32px Death render) and re-fit the
    // body — mirrors setFootprint's work, but forced (activeStrip may still read 'walk', which would
    // otherwise short-circuit the swap).
    this.activeStrip = 'walk';
    this.sprite.setTexture(npcAnimKey('walk'), 0);
    this.sprite
      .setScale(npcActor.render.scale)
      .setOrigin(npcActor.render.originX, npcActor.render.originY);
    this.sprite.setData('baseScale', npcActor.render.scale);
    this.fitBody(npcActor.render);
    this.buildRig(); // die() destroyed the weapon + fists — rebuild them
    this.syncAttachments(); // pin the fresh rig onto the current frame
  }

  /**
   * Fully tear down the companion's GameObjects — the held weapon, both mitts, and the sprite itself —
   * and drop their references. Called at RUNTIME by {@link CompanionManager.reset} / a spawn-replace
   * (the scene/physics world is alive, so `destroy()` is correct here). This is NOT the SHUTDOWN path,
   * where Phaser's own scene teardown has already freed every GameObject — mirrors EnemyManager's
   * clearAll-vs-destroy split (weapon/hands are private here, so the manager tears down through this).
   */
  dispose(): void {
    if (this.weapon) {
      this.weapon.sprite.destroy();
      this.weapon = undefined;
    }
    if (this.hands) {
      this.hands.main.destroy();
      this.hands.off.destroy();
      this.hands = undefined;
    }
    this.sprite.destroy();
  }

  /**
   * Swap the sprite between its Run (64px) and Idle (32px) footprints — on an actual change only.
   * Applies the target strip's render (scale/origin) and re-fits the Arcade body so its WORLD
   * footprint (a ~1-tile box at the feet) is identical in both states. `sprite.x/y` is untouched, so
   * there's no positional jump — only the drawn pixels reflow. Mirrors MonsterCharacter.setFootprint.
   */
  private setFootprint(which: 'idle' | 'walk'): void {
    if (this.activeStrip === which) return;
    this.activeStrip = which;
    const npc = ACTIVE_TILESET.actors.npc;
    const render = which === 'idle' ? (npc.idle.render ?? npc.render) : npc.render;
    // Base frame of the target strip first, so fitBody reads the right frame size below.
    this.sprite.setTexture(npcAnimKey(which), 0);
    this.sprite.setScale(render.scale).setOrigin(render.originX, render.originY);
    this.sprite.setData('baseScale', render.scale);
    this.fitBody(render);
  }

  /**
   * Pin the held weapon + both mitts to the wielder's hand for the CURRENT animation frame — called
   * every tick (not on `animationupdate`, so a swing slides between frame changes without the pin going
   * stale). Reads the active strip's per-frame `mainHand`/`offHand` anchors, runs the pure
   * {@link weaponTransform} with the live flipX, and writes the result onto each image. Mirrors
   * MonsterCharacter.syncAttachments; the coded swing angle (`extraRot`) stays 0 until Step 7.
   */
  private syncAttachments(): void {
    const npc = ACTIVE_TILESET.actors.npc;
    const strip = this.activeStrip === 'idle' ? npc.idle : npc.walk;
    const frameW = strip.frameWidth ?? strip.frameSize;
    const frameH = strip.frameSize;
    const frame = Number(this.sprite.frame.name); // spritesheet frame index (0-based) == anchor index

    const pin = (anchors: AttachPoint[] | undefined, extraRot: number) => {
      if (!anchors || anchors.length === 0) return undefined;
      const index = Math.max(0, Math.min(anchors.length - 1, Number.isFinite(frame) ? frame : 0));
      return weaponTransform({
        anchor: anchors[index],
        actorRender: npc.render,
        stripRender: strip.render,
        frameW,
        frameH,
        flipX: this.sprite.flipX,
        extraRot,
      });
    };

    if (this.weapon) {
      const t = pin(strip.anchors?.mainHand, this.weapon.swingRot); // fold the live coded swing into the pin
      if (t)
        this.weapon.sprite
          .setPosition(this.sprite.x + t.x, this.sprite.y + t.y)
          .setFlipX(t.flipX)
          .setAngle(t.rotation);
    }
    if (this.hands) {
      const handArt = npc.hand;
      const m = pin(strip.anchors?.mainHand, 0);
      this.hands.main.setVisible(!!m);
      if (m)
        this.hands.main
          .setPosition(this.sprite.x + m.x, this.sprite.y + m.y)
          .setFlipX(m.flipX)
          .setAngle(m.flipX ? -(handArt.mainRot ?? 0) : (handArt.mainRot ?? 0));
      const o = pin(strip.anchors?.offHand, 0);
      this.hands.off.setVisible(!!o);
      if (o)
        this.hands.off
          .setPosition(this.sprite.x + o.x, this.sprite.y + o.y)
          .setFlipX(handArt.offFlip ? !o.flipX : o.flipX);
    }
  }
}
