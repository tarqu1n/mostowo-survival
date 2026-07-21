import type Phaser from 'phaser';
import {
  NPC_MAX_HP,
  NPC_SPEED,
  NPC_VISION,
  NPC_STRENGTH,
  NPC_HURTBOX,
  NPC_MELEE_WEAPON_ID,
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

  /** The equipped melee weapon (gameplay stats from `MELEE_WEAPONS`) — the eventual directed swing
   *  (Step 7) reads its `damage`/`attackShape`. Fixed at construction; no inventory/equip UI yet. */
  readonly meleeWeapon: MeleeWeapon;

  /** Which footprint the sprite currently shows — the 32px Idle vs the 64px Run/`walk` — so
   *  {@link setFootprint} only swaps scale/origin/body on an actual state change (see the skeleton). */
  private activeStrip: 'idle' | 'walk' = 'walk'; // the constructor sets up the 64px Run footprint
  /** The held blade (plain image, no physics body), pinned to the main hand each tick. */
  private weapon?: { sprite: Phaser.GameObjects.Image; art: WeaponArt };
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

    // Weapon + hand rig — the SAME approach as the skeleton (MonsterCharacter): a plain weapon image
    // pinned to the main-hand anchor, drawn over two layered mitts. All pinned each tick in
    // syncAttachments; the swing tween is Step 7 (rest angle for now).
    const art = npcActor.weapons[NPC_MELEE_WEAPON_ID];
    if (art) {
      const wsprite = scene.add
        .image(sprite.x, sprite.y, resolveTile(art.source).key)
        .setOrigin(art.pivot[0], art.pivot[1])
        .setScale(art.scale ?? 1)
        .setDepth(sprite.depth + art.z);
      this.weapon = { sprite: wsprite, art };
    }
    const handArt = npcActor.hand;
    const offKey = resolveTile(handArt.source).key;
    const mainKey = resolveTile(handArt.mainSource ?? handArt.source).key;
    const mkHand = (key: string, z: number): Phaser.GameObjects.Image =>
      scene.add
        .image(sprite.x, sprite.y, key)
        .setOrigin(handArt.pivot[0], handArt.pivot[1])
        .setDepth(sprite.depth + z);
    this.hands = { main: mkHand(mainKey, handArt.mainZ), off: mkHand(offKey, handArt.offZ) };

    this.syncAttachments(); // place weapon + fists on frame 0
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
    if (this.weapon) {
      this.weapon.sprite.destroy();
      this.weapon = undefined;
    }
    if (this.hands) {
      this.hands.main.destroy();
      this.hands.off.destroy();
      this.hands = undefined;
    }
    this.sprite.body.setVelocity(0, 0);
    // Death is a 32px strip — settle onto its own footprint (like the Idle) so the collapse grounds on
    // the tile instead of playing at the 64px Run scale/origin.
    const { death, render } = ACTIVE_TILESET.actors.npc;
    const deathRender = death.render ?? render;
    this.sprite.setScale(deathRender.scale).setOrigin(deathRender.originX, deathRender.originY);
    this.sprite.setData('baseScale', deathRender.scale);
    this.sprite.anims.play(npcAnimKey('death'));
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
      const t = pin(strip.anchors?.mainHand, 0);
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
