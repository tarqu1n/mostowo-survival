import type Phaser from 'phaser';
import {
  UNARMED_BASE_DAMAGE,
  CONTACT_DAMAGE_COOLDOWN_MS,
  ENEMY_ATTACK_WINDUP_MS,
  BOAR_ATTACK_WINDUP_MS,
  MONSTER_CHASE_DROP_RADIUS_PX,
  MONSTER_VEER_BAND_PX,
  MONSTER_VEER_MAX_TILES,
  MONSTER_REPATH_MS,
  MONSTER_IDLE_MS_MIN,
  MONSTER_IDLE_MS_MAX,
  MONSTER_WANDER_RADIUS_TILES,
  MONSTER_PATROL_PAUSE_MS,
} from '../config';
import type { CombatantStats, EnemyDef } from '../data/types';
import { MONSTER_WEAPONS, type MonsterWeapon } from '../data/weapons';
import {
  ACTIVE_TILESET,
  resolveTile,
  enemyWalkKey,
  enemyIdleKey,
  enemyDeathKey,
  dirEnemyAnimKey,
  facing4FromVelocity,
  type AttachPoint,
  type DirectionalEnemyActor,
  type DirEnemyState,
  type Facing4,
} from '../data/tileset';
import { tileToWorldCenter } from '../systems/grid';
import { findPath, type Cell, type Dims } from '../systems/pathfind';
import {
  stepMonster,
  initialMonsterState,
  type MonsterMode,
  type MonsterState,
  type Vec2,
} from '../systems/monsterAI';
import { resolveMeleeAttack } from '../systems/combat';
import { weaponTransform } from '../systems/attachment';
import { Character, type CharacterSprite } from './Character';

/** Scenario/spawn overrides — a forced patrol route, starting FSM mode, or held weapon. */
export interface MonsterSpawnOpts {
  patrolRoute?: Cell[];
  mode?: MonsterMode;
  weaponId?: string;
}

/**
 * The per-tick world snapshot + effect callbacks the scene feeds each live monster (plan 013
 * Step 4). Decision/effect split preserved: `systems/monsterAI` keeps *deciding* (pure FSM),
 * `MonsterCharacter.update` *executes* the decision. The callbacks route the bite's effects back to
 * scene-owned seams — FX stay in `CombatFxManager`, bus emissions stay in the scene.
 */
export interface MonsterTickEnv {
  nowMs: number;
  playerTile: Cell;
  playerPos: Vec2;
  /** The player's body tiles (feet + torso overhang) — a bite lands on contact with ANY of them,
   *  so a tall player is reachable by its drawn torso, not only its feet tile. */
  playerBodyTiles: Cell[];
  playerStats: CombatantStats;
  dims: Dims;
  isBlocked: (col: number, row: number) => boolean;
  rng: () => number;
  /** Visible attack tell + weapon swing (routes to CombatFxManager.lungeAt). */
  lungeAt: (monster: MonsterCharacter, targetX: number, targetY: number) => void;
  /** Play the wind-up telegraph — a ramping warning tint over `durationMs` (CombatFxManager.beginWindUp). */
  beginWindUp: (monster: MonsterCharacter, durationMs: number) => void;
  /** Clear the wind-up telegraph — the strike is landing, or the player escaped (CombatFxManager.endWindUp). */
  endWindUp: (monster: MonsterCharacter) => void;
  /** Landed-bite feedback — flash + camera kick + damage vignette (scene-owned bus emission). */
  onPlayerHurt: () => void;
  /** Apply bite damage to the player (scene-owned: emits hp events / triggers the death path). */
  damagePlayer: (amount: number) => void;
}

/**
 * A live monster (plan 013 Step 4 — the class promotion of the old `EnemyUnit` struct + the scene's
 * enemy-execution methods). Owns its sprite, held weapon + fists, footprint state, and the
 * *execution* of FSM decisions (repath/move/contact-bite); the pure FSM in `systems/monsterAI` owns
 * the *decision*. The scene keeps the `enemies[]` collection, spawning, the per-frame loop that
 * feeds `update()` its inputs + rng, and all bus emissions.
 */
export class MonsterCharacter extends Character {
  readonly id: string;
  readonly def: EnemyDef;
  alive = true;
  /** Logical feet tile — combat/pathing key off this, never the animated sprite transform. */
  col: number;
  row: number;
  /** Persisted AI state — read+returned by stepMonster each tick (repath timing lives inside it). */
  ai: MonsterState;
  lastContactAt = 0;
  /** >0 while the enemy is in an attack wind-up (plan 035a Step 1): the timestamp its strike lands.
   *  Set caller-side on entering the wind-up window in melee contact; cleared on the strike or on a
   *  whiff (the player left contact during the wind-up). Surfaced via debugState (`enemyWindups`). */
  windupUntil = 0;
  /** Which render footprint the sprite is currently showing (`walk` 64px vs the `idle` 32px bob) —
   *  so `updateAnim` only swaps scale/origin/body on an actual state change (see setFootprint). */
  private activeStrip: 'idle' | 'walk' = 'walk'; // the constructor sets up the 64px Walk footprint
  /** The directional (`dir4`) actor art for this enemy (e.g. the boar), or undefined for a flip3
   *  skeleton. Its presence is the render-path discriminator: set ⇒ strip-per-facing, no flip, no
   *  weapon/hand rig; undefined ⇒ the skeleton's single Run strip mirrored by `setFlipX`. */
  private readonly dir4Actor?: DirectionalEnemyActor;
  /** Last 4-way facing a `dir4` enemy moved in — held while stationary so it idles/dies facing the way
   *  it last went (unused for flip3). Updated from velocity each moving tick. Distinct from the base
   *  `Character.lastFacing` (a dCol/dRow vector); this is the discrete `Facing4` for strip selection. */
  private dir4Facing: Facing4 = 'down';
  /** The rolled-per-spawn held weapon (Phase B), or undefined = unarmed. `sprite` is a plain image
   *  (no physics body) pinned to the hand each tick; `def` owns its damage/cadence; `swingRot` is the
   *  live coded-swing angle (deg) tweened on each bite. */
  weapon?: { id: string; sprite: Phaser.GameObjects.Image; def: MonsterWeapon; swingRot: number };
  /** The two visible fists layered on the skeleton (its own hands are unreadable nubs). Always present,
   *  armed or not: `main` pins to the mainHand anchor (grips the weapon, drawn over it), `off` to the
   *  offHand anchor (free). Plain images, no physics; pinned each tick in syncAttachments. */
  hands?: { main: Phaser.GameObjects.Image; off: Phaser.GameObjects.Image };

  constructor(
    scene: Phaser.Scene,
    id: string,
    def: EnemyDef,
    col: number,
    row: number,
    rng: () => number,
    opts?: MonsterSpawnOpts,
  ) {
    const enemyActor = ACTIVE_TILESET.actors.enemy;
    // dir4 (e.g. boar) renders from its id-keyed directional entry; flip3 (skeleton) from the shared
    // `enemy` struct. Presence of the entry is the whole discriminator (a dir4 def with no manifest
    // entry falls back to the skeleton path — data.test asserts the two stay in lockstep).
    const dir4Actor =
      def.actorKind === 'dir4' ? ACTIVE_TILESET.actors.directional[def.id] : undefined;
    const render = dir4Actor?.render ?? enemyActor.render;
    // dir4 starts on its idle-down strip; flip3 on the shared Run strip (its frame 0 doubles as idle).
    const initialKey = dir4Actor ? dirEnemyAnimKey(def.id, 'idle', 'down') : enemyWalkKey;
    const sprite = scene.add
      .sprite(tileToWorldCenter(col), tileToWorldCenter(row), initialKey)
      .setDepth(9);
    sprite.setScale(render.scale).setOrigin(render.originX, render.originY);
    sprite.setData('baseScale', render.scale); // rest scale the flinch squash returns to
    scene.physics.add.existing(sprite);
    super(scene, sprite as CharacterSprite, def);
    this.id = id;
    this.def = def;
    this.dir4Actor = dir4Actor;
    this.col = col;
    this.row = row;
    this.sprite.body.setCollideWorldBounds(true);
    this.fitBody(render);
    this.ai = initialMonsterState(opts?.patrolRoute);
    if (opts?.mode) this.ai.mode = opts.mode; // scenario override (e.g. spawn already chasing)

    // Weapon + hand rig — flip3 (skeleton) ONLY. A dir4 mob (boar) bites unarmed with a natural body,
    // so it carries no weapon and no layered fists (its sheets draw the whole animal).
    if (!dir4Actor) {
      // Roll a held weapon from the enemy's pool (Phase B) — or take a scenario-forced id. The weapon is
      // a plain image (no physics body); it's pinned to the hand each tick in syncAttachments.
      const pool = def.weaponPool ?? [];
      const weaponId =
        opts?.weaponId ?? (pool.length ? pool[Math.floor(rng() * pool.length)] : undefined);
      const art = weaponId ? enemyActor.weapons[weaponId] : undefined;
      const stats = weaponId ? MONSTER_WEAPONS[weaponId] : undefined;
      if (weaponId && art && stats) {
        const wsprite = scene.add.image(sprite.x, sprite.y, resolveTile(art.source).key);
        wsprite
          .setOrigin(art.pivot[0], art.pivot[1])
          .setScale(art.scale ?? 1)
          .setDepth(sprite.depth + art.z);
        this.weapon = { id: weaponId, sprite: wsprite, def: stats, swingRot: 0 };
      }

      // Both hands — always (the skeleton has hands whether or not it's armed). The gripping (main) hand
      // draws over the weapon, the free (off) hand beside the body; both pinned each tick in
      // syncAttachments. They use DISTINCT images (open grip vs fist) so they don't read as two of the same.
      const handArt = enemyActor.hand;
      const offKey = resolveTile(handArt.source).key;
      const mainKey = resolveTile(handArt.mainSource ?? handArt.source).key;
      const mkHand = (key: string, z: number) =>
        scene.add
          .image(sprite.x, sprite.y, key)
          .setOrigin(handArt.pivot[0], handArt.pivot[1])
          .setDepth(sprite.depth + z);
      this.hands = { main: mkHand(mainKey, handArt.mainZ), off: mkHand(offKey, handArt.offZ) };

      this.syncAttachments(); // place weapon + fists on frame 0
    }
  }

  protected override moveSpeed(): number {
    return this.def.speed;
  }

  /** Waypoint reached — snap the logical tile with it (combat/pathing key off col/row). */
  protected override onWaypointReached(wp: Cell): void {
    this.col = wp.col;
    this.row = wp.row;
  }

  /**
   * One AI tick: run the pure FSM, then execute its decision — stand-and-bite when chasing in melee
   * contact, else repath when asked and walk (or stand if no target). Mirrors the loop body the
   * scene's old `updateEnemies` owned; the scene still drives it per live monster each frame.
   */
  update(env: MonsterTickEnv): void {
    const decision = stepMonster(
      this.ai,
      {
        nowMs: env.nowMs,
        monster: { col: this.col, row: this.row },
        monsterPos: { x: this.sprite.x, y: this.sprite.y },
        playerPos: env.playerPos,
        playerTile: env.playerTile,
        acquireRadiusPx: this.def.vision ?? 0,
        chaseDropRadiusPx: MONSTER_CHASE_DROP_RADIUS_PX,
        veerBandPx: MONSTER_VEER_BAND_PX,
        veerMaxTiles: MONSTER_VEER_MAX_TILES,
        repathMs: MONSTER_REPATH_MS,
        idleMsMin: MONSTER_IDLE_MS_MIN,
        idleMsMax: MONSTER_IDLE_MS_MAX,
        wanderRadiusTiles: MONSTER_WANDER_RADIUS_TILES,
        patrolPauseMs: MONSTER_PATROL_PAUSE_MS,
        dims: env.dims,
        isBlocked: env.isBlocked,
      },
      env.rng,
    );
    this.ai = decision.state;

    // Chase + in melee contact: stand and bite on the cadence — but TELEGRAPHED (plan 035a Step 1).
    // Instead of an instant contact-bite, the enemy freezes in a readable wind-up first (the clunk
    // fix), then strikes; leaving contact mid-wind-up cancels the strike.
    if (this.ai.mode === 'chase') {
      const inContact = env.playerBodyTiles.some(
        (t) => Math.max(Math.abs(t.col - this.col), Math.abs(t.row - this.row)) <= 1,
      );
      if (inContact) {
        this.sprite.body.setVelocity(0, 0);
        // The equipped weapon sets the base damage + the attack cadence (a knife bites ~2× as often
        // as a club); an unarmed monster falls back to the shared unarmed damage + contact cooldown.
        const baseDmg = this.weapon ? this.weapon.def.damage : UNARMED_BASE_DAMAGE;
        const cooldown = this.weapon ? this.weapon.def.attackMs : CONTACT_DAMAGE_COOLDOWN_MS;
        // A dir4 mob (the boar) telegraphs with its real Attack sheet on a punchier wind-up; the flip3
        // skeleton uses the shared coded-tint wind-up. updateAnimDir4 plays the Attack anim while
        // `windupUntil > 0` (this same window), so the tell is the animation, not just the tint.
        const windupMs = this.dir4Actor ? BOAR_ATTACK_WINDUP_MS : ENEMY_ATTACK_WINDUP_MS;
        if (this.windupUntil > 0) {
          // Mid wind-up: hold the tell until it completes, then STRIKE. The wind-up is carved out of
          // the tail of the cadence, so the strike still lands on schedule — just now with a warning.
          if (env.nowMs >= this.windupUntil) {
            this.windupUntil = 0;
            this.lastContactAt = env.nowMs;
            env.endWindUp(this); // drop the warning tint — the strike is landing
            env.lungeAt(this, env.playerPos.x, env.playerPos.y); // the forward strike-lunge + weapon swing
            const dmg = resolveMeleeAttack(this.def, env.playerStats, baseDmg, env.rng);
            if (dmg > 0) env.onPlayerHurt(); // flash + camera kick + damage vignette when the bite lands
            env.damagePlayer(dmg);
          }
        } else if (env.nowMs - this.lastContactAt >= cooldown - windupMs) {
          // Cadence gate open → begin the wind-up telegraph (the player's cue to disengage).
          this.windupUntil = env.nowMs + windupMs;
          env.beginWindUp(this, windupMs);
        }
        this.updateAnim();
        return;
      }
      // Left contact while winding up → the player reacted to the tell: whiff (cancel, no strike).
      if (this.windupUntil > 0) {
        this.windupUntil = 0;
        env.endWindUp(this);
      }
    }

    // Otherwise honour the FSM's move command: repath when asked, then walk (or stand if no target).
    if (decision.repath && decision.targetTile) {
      const path = findPath(
        { col: this.col, row: this.row },
        decision.targetTile,
        env.isBlocked,
        env.dims,
      );
      this.path = path ?? [];
      this.pathIndex = 0;
      // Only a truly UNREACHABLE calm-mode pick (findPath → null) strands the monster — drop to idle
      // so it re-picks next beat. An empty path ([]) is "already on the target" (e.g. a patroller
      // sitting on its first waypoint): keep the mode so the FSM's arrival logic (pause → next
      // waypoint) runs. Chase keeps trying regardless (the player may be briefly unreachable).
      if (path === null && this.ai.mode !== 'chase') {
        this.ai = {
          ...this.ai,
          mode: 'idle',
          goalTile: null,
          timerMs: env.nowMs + MONSTER_IDLE_MS_MIN,
        };
      }
    }
    if (decision.targetTile) this.advancePath();
    else this.sprite.body.setVelocity(0, 0);

    this.updateAnim();
  }

  /**
   * Animation each tick: the Run cycle while moving (flipped by movement-x — art faces right), the
   * real 4-frame Idle bob when stationary in a calm mode (its own 32px footprint, Phase B), or a
   * held Run frame-0 pose when stalled in melee while chasing (the lunge is the attack tell — no bob
   * mid-bite). The footprint (scale/origin/body) is swapped only on a state change (setFootprint).
   */
  private updateAnim(): void {
    if (this.dir4Actor) {
      this.updateAnimDir4();
      return;
    }
    const moving = this.sprite.body.velocity.lengthSq() > 1;
    const calmIdle = !moving && this.ai.mode !== 'chase';
    this.setFootprint(calmIdle ? 'idle' : 'walk');

    if (calmIdle) {
      this.sprite.anims.play(enemyIdleKey, true); // looping gentle bob
    } else if (moving) {
      const vx = this.sprite.body.velocity.x;
      if (vx !== 0) this.sprite.setFlipX(vx < 0);
      this.sprite.anims.play(enemyWalkKey, true);
    } else {
      this.sprite.anims.stop();
      this.sprite.setFrame(0); // chasing but stalled in melee → hold the Run frame-0 pose
    }

    this.syncAttachments(); // pin the weapon (if any) + both fists to this frame's hand anchors
  }

  /**
   * Animation each tick for a `dir4` enemy (the boar): choose the strip by movement + FSM mode and face
   * it with the dominant-axis facing — no flipX (each direction is its own sheet), no attachments (the
   * sheets draw the whole animal). Charges on the Run sheet while chasing, ambles on Walk when
   * wandering/patrolling, and holds an Idle bob when stopped calm. Chasing-but-stalled (melee contact)
   * holds a static facing frame — the bite telegraph is Step 3, not a bob mid-lunge. One footprint for
   * every strip (all 32px), so no `setFootprint` swap.
   */
  private updateAnimDir4(): void {
    const v = this.sprite.body.velocity;
    const moving = v.lengthSq() > 1;
    if (moving) this.dir4Facing = facing4FromVelocity(v.x, v.y);
    // Winding up a bite (plan 035b Step 3): play the real Attack sheet as the telegraph — a one-shot
    // anim (`true` keeps it running rather than restarting each tick), facing the way it last charged so
    // the lunge reads. This is the whole tell; the strike lands on wind-up completion (see update()).
    if (this.windupUntil > 0) {
      this.sprite.anims.play(dirEnemyAnimKey(this.def.id, 'attack', this.dir4Facing), true);
      return;
    }
    if (!moving) {
      // Stopped: gentle Idle bob (calm) or between-bite hold while chasing — either reads as "standing".
      this.sprite.anims.play(dirEnemyAnimKey(this.def.id, 'idle', this.dir4Facing), true);
      return;
    }
    const state: DirEnemyState = this.ai.mode === 'chase' ? 'run' : 'walk';
    this.sprite.anims.play(dirEnemyAnimKey(this.def.id, state, this.dir4Facing), true);
  }

  /**
   * Pin the held weapon to the wielder's hand for the CURRENT animation frame — called every tick (not
   * on `animationupdate`, so the lunge/swing slide between frame changes without the pin going stale).
   * Reads the active strip's per-frame `mainHand` anchor, runs the pure {@link weaponTransform} with the
   * live flipX + swing angle, and writes the result onto the weapon image (position/flip/angle). Scale
   * is owned by the swing tween, so it's untouched here.
   */
  private syncAttachments(): void {
    if (this.dir4Actor) return; // dir4 mobs carry no weapon/hands — nothing to pin
    const enemy = ACTIVE_TILESET.actors.enemy;
    const strip = this.activeStrip === 'idle' ? enemy.idle : enemy.walk;
    const frameW = strip.frameWidth ?? strip.frameSize;
    const frameH = strip.frameSize;
    const frame = Number(this.sprite.frame.name); // spritesheet frame index (0-based) == anchor index

    // Resolve a slot's anchor for THIS frame into a world offset/angle, or undefined if the strip
    // carries no anchors for it (→ caller hides that attachment).
    const pin = (anchors: AttachPoint[] | undefined, extraRot: number) => {
      if (!anchors || anchors.length === 0) return undefined;
      const index = Math.max(0, Math.min(anchors.length - 1, Number.isFinite(frame) ? frame : 0));
      return weaponTransform({
        anchor: anchors[index],
        actorRender: enemy.render,
        stripRender: strip.render,
        frameW,
        frameH,
        flipX: this.sprite.flipX,
        extraRot,
      });
    };

    // Weapon at the main-hand grip: resting `rot` + the live coded swing (about its grip = this anchor).
    if (this.weapon) {
      const t = pin(strip.anchors?.mainHand, this.weapon.swingRot);
      if (t)
        this.weapon.sprite
          .setPosition(this.sprite.x + t.x, this.sprite.y + t.y)
          .setFlipX(t.flipX)
          .setAngle(t.rotation);
    }
    // Hands: pin position + mirror. The main (open grip) hand carries a resting `mainRot` tilt so it
    // follows the raised weapon (negated with the body, like the weapon); it sits at the SAME anchor as
    // the weapon, so it stays put while the weapon arcs about it. The off (fist) hand takes `offFlip` to
    // mirror against the body's facing, so the two hands read as a left/right pair.
    if (this.hands) {
      const handArt = enemy.hand;
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

  /**
   * Swap the sprite between its Walk (64px) and Idle (32px) footprints — on an actual change only.
   * Applies the target strip's render (scale/origin) and re-fits the Arcade body so its WORLD
   * footprint (a ~1-tile box at the feet) is identical in both states: the display size matches (32px
   * Idle @scale 2 == 64px Run @scale 1) and the contact tile is unchanged. `sprite.x/y` is untouched,
   * so there's no positional jump — only the drawn pixels reflow around the same anchor.
   */
  private setFootprint(which: 'idle' | 'walk'): void {
    if (this.dir4Actor) return; // dir4 uses one footprint for every strip — no idle/walk swap
    if (this.activeStrip === which) return;
    this.activeStrip = which;
    const enemy = ACTIVE_TILESET.actors.enemy;
    const render = which === 'idle' ? (enemy.idle.render ?? enemy.render) : enemy.render;
    // Base frame of the target strip first, so fitBody reads the right frame size below.
    this.sprite.setTexture(which === 'idle' ? enemyIdleKey : enemyWalkKey, 0);
    this.sprite.setScale(render.scale).setOrigin(render.originX, render.originY);
    this.sprite.setData('baseScale', render.scale); // flinch-squash rest scale follows the active footprint
    this.fitBody(render);
  }

  /**
   * The character-side death collapse: out of the AI set immediately (`alive = false`), weapon +
   * fists destroyed (no loot/drop; the Death strip carries no anchors, so a pinned fist would freeze
   * mid-air over the corpse), body disabled so the corpse isn't a physics obstacle mid-animation, and
   * the one-shot Death strip played (keeps its current flipX — collapses facing the way it ran). The
   * scene pairs this with FX cleanup before and corpse bookkeeping/removal scheduling after (see
   * GameScene.killEnemy).
   */
  override die(): void {
    this.alive = false;
    if (this.weapon) {
      this.weapon.sprite.destroy(); // weapon hides on death (no loot/drop — see plan Out of scope)
      this.weapon = undefined;
    }
    if (this.hands) {
      this.hands.main.destroy();
      this.hands.off.destroy();
      this.hands = undefined;
    }
    this.sprite.body.setVelocity(0, 0);
    this.sprite.body.enable = false;
    if (this.dir4Actor) {
      // dir4: one footprint for every strip (nothing to undo), collapse on the last-faced Death strip.
      this.sprite.anims.play(dirEnemyAnimKey(this.def.id, 'death', this.dir4Facing));
      return;
    }
    // Reset to the default 64px footprint before the collapse — undoes any flinch squash AND the 32px
    // Idle bob's scale:2/origin (dying mid-bob would otherwise play the Death strip double-size, off-tile).
    const { render } = ACTIVE_TILESET.actors.enemy;
    this.sprite.setScale(render.scale).setOrigin(render.originX, render.originY);
    this.sprite.anims.play(enemyDeathKey);
  }
}
