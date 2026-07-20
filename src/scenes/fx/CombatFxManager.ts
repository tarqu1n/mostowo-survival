import Phaser from 'phaser';
import {
  HIT_FLASH_MS,
  HIT_FLASH_PEAK,
  HIT_FLASH_SQUASH,
  HIT_FLASH_TINT,
  ENEMY_LUNGE_PX,
  ENEMY_LUNGE_MS,
  WEAPON_SWING_ARC_DEG,
  WEAPON_SWING_MS,
  WEAPON_SWING_SCALE_POP,
  ENEMY_WINDUP_TINT,
  BOW_ARROW_MS,
  BOW_ARROW_LEN_PX,
  COLORS,
  TILE_SIZE,
  HP_BAR_SHOW_MS,
  HP_BAR_MAX_VISIBLE,
  HP_BAR_WIDTH_PX,
  HP_BAR_HEIGHT_PX,
  HP_BAR_GAP_PX,
  HP_BAR_NEAR_DEATH_FRAC,
  HP_BAR_NEAR_DEATH_ALPHA_MIN,
  HP_BAR_NEAR_DEATH_PERIOD_MS,
} from '../../config';
import { HIT_FLASH_KEY, type HitFlashPipeline } from '../../render/hitFlashPipeline';
import { playerAnimKey, type Facing } from '../../data/tileset';
import { DEFAULT_HURTBOX } from '../../systems/hurtbox';
import type { Cell } from '../../systems/pathfind';
import type { MonsterCharacter } from '../../entities/MonsterCharacter';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link CombatFxManager} needs but doesn't own — GameScene supplies these as
 * closures over its own private fields at construction (see the `fx` field there), so the manager
 * never widens GameScene's API surface (plan 013 Step 3 coupling rules: managers get narrow
 * interfaces, not raw field access; `getPlayerSprite`/`getFacing`/`getLastFacingDCol` are reads,
 * `setAttackLockUntil` is the one write the moved FX code needs to make back into scene state).
 */
export interface CombatFxDeps {
  /** The live player sprite — flashHit keys "is this the player" off it; playAttackSwing animates it. */
  getPlayerSprite(): Phaser.GameObjects.Sprite;
  /** Player's current directional strip ('side'/'up'/'down'), derived from lastFacing. */
  getFacing(): Facing;
  /** Sign of lastFacing.dCol — flips the swing sprite for a left-facing side attack. */
  getLastFacingDCol(): number;
  /** Write the scene's attack-lock deadline; effectiveMoveSpeed/updatePlayerAnim read it back. */
  setAttackLockUntil(t: number): void;
}

/**
 * Combat hit/attack FX: the red flash + squash-flinch on a landed hit, an enemy's lunge-and-weapon-
 * swing attack tell, the player's attack-swing lock, and corpse-lingering bookkeeping. Moved verbatim
 * out of GameScene (plan 013 Step 3) — the tween maps were already sprite-keyed, so this is
 * presentation state the scene now reaches via direct method calls (no manager↔manager events, per
 * the coupling rules). The kill *logic* (when/why something dies) stays in GameScene for now — this
 * manager only owns the tween/FX bookkeeping around it.
 */
export class CombatFxManager {
  // Tweens are tracked per actor sprite so a rapid re-hit restarts cleanly and a killed/destroyed
  // sprite can be torn down (its tweens target plain objects but poke the sprite, so they must stop
  // before destroy). `hitFlashOn` is the set of sprites currently carrying the WebGL flash pipeline.
  private readonly hitFlashTweens = new Map<Phaser.GameObjects.Sprite, Phaser.Tweens.Tween>();
  private readonly lungeTweens = new Map<Phaser.GameObjects.Sprite, Phaser.Tweens.Tween>();
  // Weapon-swing tweens keyed by the WIELDER sprite (so cleanupActorFx(enemySprite) can stop one
  // mid-swing before the weapon image is destroyed — the tween pokes the weapon each frame).
  private readonly weaponSwingTweens = new Map<Phaser.GameObjects.Sprite, Phaser.Tweens.Tween>();
  // Wind-up tint tweens keyed by the enemy sprite — the telegraph that plays BEFORE the strike lunge
  // (plan 035a Step 1). Tracked so a strike/escape/teardown can stop it and clear the tint.
  private readonly windUpTweens = new Map<Phaser.GameObjects.Sprite, Phaser.Tweens.Tween>();
  private readonly hitFlashOn = new Set<Phaser.GameObjects.Sprite>();
  // Bow FX (plan 035a Step 5). `arrows` are the in-flight coded arrow tracers (a thin dash tweened
  // player→target, self-destroying on arrival) — tracked so a scenario reset / SHUTDOWN can kill any
  // still mid-flight before their target sprite is freed. `bowTargetBox` is the ONE persistent stroked
  // highlight round the bow's current auto-target, re-synced each frame to hug the target's bounds
  // (mirrors TaskGlowRenderer.outlineStructure + syncGlowTransforms — NOT a baked halo, which would
  // freeze on one frame of a moving/animating enemy); hidden when there's no target.
  private readonly arrows = new Set<Phaser.GameObjects.Rectangle>();
  private bowTargetBox?: Phaser.GameObjects.Rectangle;
  // Monster HP bars (plan 035a Step 6). `hpBars` is the pool of floating bars in play, keyed by enemy
  // id — one {bg, fg} pair, created lazily, positioned/sized each frame; a bar whose enemy is no
  // longer "shown" (dead / bar timed out / evicted by the visible cap) is destroyed. `enemyHitAt`
  // stamps the last time each enemy sprite took a hit (written in flashHit — the single choke point
  // for "an enemy was hit"), so syncEnemyHealthBars can show a brief on-hit bar that fades.
  private readonly hpBars = new Map<
    string,
    { bg: Phaser.GameObjects.Rectangle; fg: Phaser.GameObjects.Rectangle }
  >();
  private readonly enemyHitAt = new Map<Phaser.GameObjects.Sprite, number>();
  // Enemy sprites out of the AI set but lingering to play their one-shot death collapse before the
  // corpse is removed. Tracked so debugState can report them (proves removal waits for the animation).
  private readonly corpses = new Set<Phaser.GameObjects.Sprite>();
  // Live player flash intensity (0..1) + cumulative FX counters, surfaced via debugState so Tier-2
  // scenarios can assert hit/attack feedback fired without inspecting the (shader-driven) sprite.
  private playerFlash = 0;
  private playerHitFlashes = 0;
  private enemyHitFlashes = 0;
  private enemyAttacks = 0;

  // GameScene constructs this as an eager field initializer (see the `fx` field there) — cheapest at
  // that point, since Scene-plugin injections (`scene.events`/`tweens`/`time`/`anims`) aren't installed
  // yet when the GameScene class constructor runs (Phaser wires those just before create()). The
  // constructor therefore only stashes its deps; `armShutdown()` does the one thing that needs to wait.
  constructor(
    private readonly scene: GameScene,
    private readonly deps: CombatFxDeps,
  ) {}

  /**
   * Arm the SHUTDOWN-triggered flush. Call once per `create()` (every scene (re)start re-registers,
   * mirroring how GameScene's own `game.events` listeners are re-added each create() and torn down by
   * a matching once-SHUTDOWN) — `.once` fires exactly once per run, flushing this run's tweens before
   * the next create() reuses this same manager instance. Split out of the constructor so the bulk of
   * this manager's construction (the tween maps below) can stay a cheap GameScene field initializer;
   * only this trivial listener registration needs to wait for `scene.events` to exist.
   */
  armShutdown(): void {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  getPlayerFlash(): number {
    return this.playerFlash;
  }

  getPlayerHitFlashes(): number {
    return this.playerHitFlashes;
  }

  getEnemyHitFlashes(): number {
    return this.enemyHitFlashes;
  }

  getEnemyAttacks(): number {
    return this.enemyAttacks;
  }

  getCorpseCount(): number {
    return this.corpses.size;
  }

  /** This sprite's live HitFlash pipeline instance (WebGL only), or null. `getPostPipeline` may hand
   * back a single instance or an array depending on the query — normalise to the first. */
  private hitPipeline(sprite: Phaser.GameObjects.Sprite): HitFlashPipeline | null {
    const p = sprite.getPostPipeline(HIT_FLASH_KEY);
    return ((Array.isArray(p) ? p[0] : p) as HitFlashPipeline | undefined) ?? null;
  }

  /**
   * Damage reaction shared by the player and enemies: a red flash (the HitFlash PostFX on WebGL, a
   * solid fill-tint on Canvas) plus a quick squash "flinch". Both are driven off ONE tween over a
   * plain `{ t }` object (1 → 0), so the flash intensity and the squash decay in lockstep from the
   * moment of impact and settle back to rest — no yoyo needed, the impact is instantaneous and the
   * recovery is the ease-out. The squash animates *scale only*, never position, so it can't fight the
   * actor's Arcade body (game logic stays keyed to col/row per docs/RENDERING.md). Re-hitting mid-flash
   * restarts cleanly (the prior tween is stopped, not completed, so it won't tear down the pipeline).
   */
  flashHit(sprite: Phaser.GameObjects.Sprite): void {
    const isPlayer = sprite === this.deps.getPlayerSprite();
    if (isPlayer) this.playerHitFlashes += 1;
    else {
      this.enemyHitFlashes += 1;
      this.enemyHitAt.set(sprite, this.scene.time.now); // drives the brief on-hit HP bar (Step 6)
    }

    const webgl = this.scene.game.renderer.type === Phaser.WEBGL;
    if (webgl) {
      if (!this.hitFlashOn.has(sprite)) {
        sprite.setPostPipeline(HIT_FLASH_KEY);
        this.hitFlashOn.add(sprite);
      }
    } else {
      sprite.setTintFill(HIT_FLASH_TINT); // Canvas fallback: a plain solid-red fill, cleared on completion
    }
    const pipe = webgl ? this.hitPipeline(sprite) : null;

    this.hitFlashTweens.get(sprite)?.stop(); // stop() (not remove()) so the old onComplete never runs
    const fx = { t: 1 };
    const tween = this.scene.tweens.add({
      targets: fx,
      t: 0,
      duration: HIT_FLASH_MS,
      ease: 'Expo.easeOut', // hit hard on impact, fade fast
      onUpdate: () => {
        const t = fx.t;
        if (pipe) pipe.flash = t * HIT_FLASH_PEAK;
        // Read baseScale LIVE, not captured once: a footprint swap (idle 32px@2 ↔ walk 64px@1,
        // setEnemyFootprint) can fire mid-flash, and a stale base would stretch the new strip to the
        // old scale — e.g. the 64px Run drawn at the Idle's scale 2 → the sprite visibly doubles.
        const base = (sprite.getData('baseScale') as number | undefined) ?? 1;
        // squash: widest+shortest at impact (t=1), easing back to the rest scale (t=0).
        sprite.setScale(base * (1 + HIT_FLASH_SQUASH * t), base * (1 - HIT_FLASH_SQUASH * 0.8 * t));
        if (isPlayer) this.playerFlash = t;
      },
      onComplete: () => {
        this.hitFlashTweens.delete(sprite);
        const base = (sprite.getData('baseScale') as number | undefined) ?? 1;
        sprite.setScale(base);
        if (webgl) {
          sprite.removePostPipeline(HIT_FLASH_KEY);
          this.hitFlashOn.delete(sprite);
        } else {
          sprite.clearTint();
        }
        if (isPlayer) this.playerFlash = 0;
      },
    });
    this.hitFlashTweens.set(sprite, tween);
  }

  /**
   * The enemy attack **wind-up** telegraph (plan 035a Step 1): while the enemy freezes in melee contact
   * for the wind-up window (see MonsterCharacter.update), ramp a warning tint (white → ENEMY_WINDUP_TINT)
   * over `durationMs` so the impending strike is readable — anticipation before the forward strike-lunge.
   * Tint-only (never scale) so it can't fight the flinch-squash's live baseScale writes or the Arcade
   * body. Cleared by {@link endWindUp} on the strike (or a whiff, if the player escapes contact).
   */
  beginWindUp(z: MonsterCharacter, durationMs: number): void {
    const sprite = z.sprite;
    if (this.windUpTweens.has(sprite)) return; // already telegraphing this cycle
    const to = {
      r: (ENEMY_WINDUP_TINT >> 16) & 0xff,
      g: (ENEMY_WINDUP_TINT >> 8) & 0xff,
      b: ENEMY_WINDUP_TINT & 0xff,
    };
    const tween = this.scene.tweens.add({
      targets: { t: 0 },
      t: 1,
      duration: durationMs,
      ease: 'Quad.easeIn', // loads up — most vivid in the instant before the strike
      onUpdate: (_tw, tgt: { t: number }) => {
        if (!sprite.active) return; // enemy destroyed mid-wind-up (death/teardown) — don't poke it
        const t = tgt.t;
        const r = Math.round(255 + (to.r - 255) * t);
        const g = Math.round(255 + (to.g - 255) * t);
        const b = Math.round(255 + (to.b - 255) * t);
        sprite.setTint((r << 16) | (g << 8) | b);
      },
      onComplete: () => this.windUpTweens.delete(sprite), // tint held until endWindUp clears it
    });
    this.windUpTweens.set(sprite, tween);
  }

  /** Clear an enemy's wind-up telegraph — its strike is landing (or it whiffed on the player escaping).
   *  Stops the ramp tween and drops the warning tint back to normal. */
  endWindUp(z: MonsterCharacter): void {
    const sprite = z.sprite;
    this.windUpTweens.get(sprite)?.stop();
    this.windUpTweens.delete(sprite);
    if (sprite.active) sprite.clearTint();
  }

  /**
   * An enemy's attack "tell": a quick out-and-back lunge toward its target. The skeleton sheet ships
   * no attack strip, so without this a bite is invisible — the enemy just stands on the player. We
   * move the Arcade **body** (via `body.reset`), not the sprite transform: Arcade writes the body's
   * position back onto the sprite every step, so a `sprite.x` tween would be stomped each frame. The
   * lunge only runs during the stationary contact phase (velocity 0, no active path) and snaps back to
   * the origin on completion, and its total time stays under the contact cooldown so it always settles
   * before the next bite. Logic (contact, pathing) keys off z.col/z.row, so this stays purely visual.
   */
  lungeAt(z: MonsterCharacter, targetX: number, targetY: number): void {
    this.enemyAttacks += 1;
    const sprite = z.sprite;
    if (this.lungeTweens.has(sprite)) return; // already lunging — don't stack
    const ox = sprite.x;
    const oy = sprite.y;
    const dx = targetX - ox;
    const dy = targetY - oy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = (dx / len) * ENEMY_LUNGE_PX;
    const uy = (dy / len) * ENEMY_LUNGE_PX;
    if (dx !== 0) sprite.setFlipX(dx < 0); // face the target across the lunge (velocity is 0, so updateEnemyAnim won't reflip)

    const tween = this.scene.tweens.add({
      targets: { p: 0 },
      p: 1,
      duration: ENEMY_LUNGE_MS,
      yoyo: true, // out to the target, then back
      ease: 'Quad.easeOut',
      onUpdate: (_tw, tgt: { p: number }) => sprite.body.reset(ox + ux * tgt.p, oy + uy * tgt.p),
      onComplete: () => {
        this.lungeTweens.delete(sprite);
        sprite.body.reset(ox, oy); // guarantee it lands exactly back home
      },
    });
    this.lungeTweens.set(sprite, tween);

    // Coded weapon swing (the pack ships no mob attack strip): rotate the held weapon about its grip
    // through WEAPON_SWING_ARC_DEG with a small scale pop, yoyo, in step with the body lunge. syncEnemyAttachments
    // adds w.swingRot every tick, so the pinned weapon arcs while still tracking the hand.
    if (z.weapon) {
      const w = z.weapon;
      const baseScale = w.sprite.scale;
      this.weaponSwingTweens.get(sprite)?.stop();
      const swing = this.scene.tweens.add({
        targets: w,
        swingRot: WEAPON_SWING_ARC_DEG, // always a +arc; weaponTransform mirrors it when the wielder faces left
        duration: WEAPON_SWING_MS,
        yoyo: true,
        ease: 'Quad.easeOut',
        onUpdate: () => {
          if (!w.sprite.active) return; // weapon destroyed mid-swing (death/teardown) — don't poke it
          const p = w.swingRot / WEAPON_SWING_ARC_DEG; // 0→1→0 across the yoyo
          w.sprite.setScale(baseScale * (1 + (WEAPON_SWING_SCALE_POP - 1) * p));
        },
        onComplete: () => {
          w.swingRot = 0;
          if (w.sprite.active) w.sprite.setScale(baseScale);
          this.weaponSwingTweens.delete(sprite);
        },
      });
      this.weaponSwingTweens.set(sprite, swing);
    }
  }

  /** Play the one-shot attack swing in the current facing and lock updatePlayerAnim out for its
   * duration (so an attack reads fully even while moving). Re-pressing restarts it. */
  playAttackSwing(): void {
    const player = this.deps.getPlayerSprite();
    const facing = this.deps.getFacing();
    player.setFlipX(facing === 'side' && this.deps.getLastFacingDCol() < 0);
    const key = playerAnimKey('attack', facing);
    player.anims.play(key); // no ignoreIfPlaying → a rapid re-press restarts the swing
    this.deps.setAttackLockUntil(
      this.scene.time.now + (this.scene.anims.get(key)?.duration ?? 300),
    );
  }

  /**
   * Loose a coded arrow tracer (plan 035a Step 5): a thin dash that flies from `(fromX,fromY)` to
   * `(toX,toY)` over {@link BOW_ARROW_MS}, then self-destroys. Purely visual — the actual ranged
   * damage resolves instantly in GameScene.bow (hitscan); this only *sells* the shot, the same way
   * {@link lungeAt} sells an enemy bite with no real projectile. Tracked in `arrows` so a mid-flight
   * dash is torn down cleanly on a scenario reset / SHUTDOWN.
   */
  fireArrow(fromX: number, fromY: number, toX: number, toY: number): void {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const arrow = this.scene.add
      .rectangle(fromX, fromY, BOW_ARROW_LEN_PX, 2, COLORS.arrow, 1)
      .setDepth(11) // above enemies (9) + their weapons (~10–11); under the bow-target box (12)
      .setRotation(angle);
    this.arrows.add(arrow);
    this.scene.tweens.add({
      targets: arrow,
      x: toX,
      y: toY,
      duration: BOW_ARROW_MS,
      ease: 'Linear',
      onComplete: () => {
        this.arrows.delete(arrow);
        arrow.destroy();
      },
    });
  }

  /**
   * Keep the bow's current-target highlight — a stroked rect hugging `sprite`'s rendered bounds —
   * locked onto the target, or hide it when `sprite` is null (no target / target gone). Called every
   * frame by GameScene.update with the live target sprite: re-hugging the bounds tracks a moving,
   * animating, or flinching enemy (a baked halo would freeze on one frame). The box is created lazily
   * and reused; `setSize` reflows the stroke each frame.
   */
  syncBowTargetHighlight(sprite: Phaser.GameObjects.Sprite | null): void {
    if (!sprite || !sprite.active) {
      this.bowTargetBox?.setVisible(false);
      return;
    }
    const b = sprite.getBounds();
    const pad = 3;
    if (!this.bowTargetBox) {
      this.bowTargetBox = this.scene.add
        .rectangle(0, 0, 1, 1, COLORS.bowTarget, 0) // no fill — outline only
        .setStrokeStyle(1.5, COLORS.bowTarget, 1)
        .setDepth(12);
    }
    this.bowTargetBox
      .setVisible(true)
      .setPosition((b.left + b.right) / 2, (b.top + b.bottom) / 2)
      .setSize(b.width + pad, b.height + pad);
  }

  /**
   * Draw the attention-scoped monster HP bars (plan 035a Step 6), called every frame by
   * GameScene.update with the live enemy list, the bow's current target id, and the player tile.
   * Anti-clutter rules (see config HP_BAR_*):
   *  - a bar shows for an enemy that is the **bow target** (persistently) or was **hit** within
   *    `HP_BAR_SHOW_MS` (brief, then fades out by dropping);
   *  - at most `HP_BAR_MAX_VISIBLE` render — the target first, then the nearest others;
   *  - every LIVE enemy below `HP_BAR_NEAR_DEATH_FRAC` HP also gets an alpha-throb sprite tell, so
   *    "almost dead" reads even for an enemy with no bar (a capped-out one).
   * A thin bg + green→red fg (mirrors the player's `updateHealthBar`), pooled per enemy id and
   * anchored above the hurtbox (`sprite.y − hurtbox.height·TILE·scaleY`). Bars for enemies no longer
   * shown (dead / timed-out / evicted) are destroyed here so nothing lingers.
   */
  syncEnemyHealthBars(
    enemies: MonsterCharacter[],
    bowTargetId: string | null,
    playerTile: Cell,
  ): void {
    const now = this.scene.time.now;
    const live = enemies.filter((z) => z.alive);

    // Near-death sprite tell — an alpha throb on any live low-HP enemy (independent of its bar).
    for (const z of live) {
      const frac = z.def.maxHp > 0 ? z.hp / z.def.maxHp : 1;
      if (frac > 0 && frac <= HP_BAR_NEAR_DEATH_FRAC) {
        const phase = 0.5 + 0.5 * Math.sin((now / HP_BAR_NEAR_DEATH_PERIOD_MS) * Math.PI * 2);
        z.sprite.setAlpha(HP_BAR_NEAR_DEATH_ALPHA_MIN + (1 - HP_BAR_NEAR_DEATH_ALPHA_MIN) * phase);
      } else if (z.sprite.alpha !== 1) {
        z.sprite.setAlpha(1); // recovered / above the threshold → back to solid
      }
    }

    // Which enemies get a bar: the bow target (always) + any hit within HP_BAR_SHOW_MS; the target
    // sorts first, the rest by nearness, then cap the count.
    const dist = (z: MonsterCharacter): number =>
      Math.hypot(z.col - playerTile.col, z.row - playerTile.row);
    const candidates = live.filter(
      (z) =>
        z.id === bowTargetId ||
        now - (this.enemyHitAt.get(z.sprite) ?? -Infinity) <= HP_BAR_SHOW_MS,
    );
    candidates.sort((a, b) => {
      if (a.id === bowTargetId) return -1;
      if (b.id === bowTargetId) return 1;
      return dist(a) - dist(b);
    });
    const visible = candidates.slice(0, HP_BAR_MAX_VISIBLE);
    const visibleIds = new Set(visible.map((z) => z.id));

    // Drop bars whose enemy is no longer shown (dead / timed out / evicted by the cap).
    for (const [id, bar] of this.hpBars) {
      if (!visibleIds.has(id)) {
        bar.bg.destroy();
        bar.fg.destroy();
        this.hpBars.delete(id);
      }
    }

    // Position/size a bar for each visible enemy, above its hurtbox.
    for (const z of visible) {
      const box = z.def.hurtbox ?? DEFAULT_HURTBOX;
      const x = z.sprite.x;
      const y = z.sprite.y - box.height * TILE_SIZE * z.sprite.scaleY - HP_BAR_GAP_PX;
      let bar = this.hpBars.get(z.id);
      if (!bar) {
        const bg = this.scene.add
          .rectangle(x, y, HP_BAR_WIDTH_PX, HP_BAR_HEIGHT_PX, COLORS.hpBarBg, 0.85)
          .setDepth(13);
        // fg is left-anchored so scaleX shrinks it from the right, like a draining bar.
        const fg = this.scene.add
          .rectangle(
            x - HP_BAR_WIDTH_PX / 2,
            y,
            HP_BAR_WIDTH_PX,
            HP_BAR_HEIGHT_PX,
            COLORS.hpBarHigh,
            1,
          )
          .setOrigin(0, 0.5)
          .setDepth(14);
        bar = { bg, fg };
        this.hpBars.set(z.id, bar);
      }
      const ratio = Phaser.Math.Clamp(z.def.maxHp > 0 ? z.hp / z.def.maxHp : 0, 0, 1);
      bar.bg.setPosition(x, y);
      bar.fg.setPosition(x - HP_BAR_WIDTH_PX / 2, y);
      bar.fg.scaleX = ratio;
      bar.fg.setFillStyle(ratio <= 0.3 ? COLORS.hpBarLow : COLORS.hpBarHigh);
    }
  }

  /** Count of monster HP bars currently rendered (debugState `enemyHpBarsVisible`, plan 035a Step 6) —
   *  bars for hidden enemies are destroyed each frame, so the pool size IS the visible count. */
  getVisibleHpBarCount(): number {
    return this.hpBars.size;
  }

  /** Stop and forget any in-flight hit-flash/lunge tweens for a sprite about to be destroyed — those
   * tweens target plain objects but poke the sprite (scale / body.reset), so they'd throw once it's
   * gone. Called before a killed enemy's sprite is destroyed. */
  cleanupActorFx(sprite: Phaser.GameObjects.Sprite): void {
    this.hitFlashTweens.get(sprite)?.stop();
    this.hitFlashTweens.delete(sprite);
    this.lungeTweens.get(sprite)?.stop();
    this.lungeTweens.delete(sprite);
    this.weaponSwingTweens.get(sprite)?.stop(); // the swing tween pokes the weapon image each frame
    this.weaponSwingTweens.delete(sprite);
    this.windUpTweens.get(sprite)?.stop(); // clear any in-flight wind-up telegraph before the sprite goes
    this.windUpTweens.delete(sprite);
    if (sprite.active) {
      sprite.clearTint(); // don't leave a corpse wearing the warning tint
      sprite.setAlpha(1); // undo a near-death alpha throb so the corpse isn't left semi-transparent
    }
    this.enemyHitAt.delete(sprite); // drop the on-hit HP-bar stamp (its bar clears next sync)
    this.hitFlashOn.delete(sprite);
  }

  /** Track a corpse sprite lingering after death, so debugState can report it (proves removal waits
   * for the death anim to play out) — the removal itself is still scheduled by the scene's kill logic
   * (see GameScene.killEnemy's delayedCall, which calls removeCorpse below). */
  addCorpse(sprite: Phaser.GameObjects.Sprite): void {
    this.corpses.add(sprite);
  }

  /** Drop a corpse once its lingering removal fires (see GameScene.killEnemy). */
  removeCorpse(sprite: Phaser.GameObjects.Sprite): void {
    this.corpses.delete(sprite);
  }

  /** Reset all combat-FX bookkeeping to its boot state — called from GameScene.create() (death-
   * restart) and the scenario reset (testResetWorld). The maps/set may hold tweens+sprites from a
   * torn-down run, so drop them wholesale. */
  resetCombatFx(): void {
    // Stop before dropping: a cleared map still leaves the tween running in Phaser's TweenManager, and
    // its onUpdate pokes a sprite the teardown is about to destroy (the yoyo weapon-swing outlives a
    // short step). Stopping first guarantees no orphaned tween fires on a dead sprite next frame.
    for (const t of this.hitFlashTweens.values()) t.stop();
    for (const t of this.lungeTweens.values()) t.stop();
    for (const t of this.weaponSwingTweens.values()) t.stop();
    for (const t of this.windUpTweens.values()) t.stop();
    this.hitFlashTweens.clear();
    this.lungeTweens.clear();
    this.weaponSwingTweens.clear();
    this.windUpTweens.clear();
    this.hitFlashOn.clear();
    // Bow FX: kill any in-flight arrow tracer + destroy its dash, then drop the persistent target box
    // (a fresh create()/scenario rebuilds it lazily on the next shot). Same "stop then destroy" as
    // above so no orphaned tween pokes a freed dash next frame.
    for (const a of this.arrows) {
      this.scene.tweens.killTweensOf(a);
      a.destroy();
    }
    this.arrows.clear();
    this.bowTargetBox?.destroy();
    this.bowTargetBox = undefined;
    // Monster HP bars: destroy the pooled rects + drop the hit stamps. Plain GameObjects (no physics
    // body), so destroy() is safe here at RUNTIME (death-restart / scenario reset); on the SHUTDOWN
    // path Phaser has already destroyed them and a second destroy() is a guarded no-op.
    for (const bar of this.hpBars.values()) {
      bar.bg.destroy();
      bar.fg.destroy();
    }
    this.hpBars.clear();
    this.enemyHitAt.clear();
    this.corpses.clear(); // scene teardown destroys the sprites; drop stale references
    this.playerFlash = 0;
    this.playerHitFlashes = 0;
    this.enemyHitFlashes = 0;
    this.enemyAttacks = 0;
  }

  /** Flush every tween/flag on scene SHUTDOWN (registered by armShutdown()) — the same "stop then
   * clear" as resetCombatFx (also zeroing the counters is harmless: this instance's next real use is a
   * fresh create()/resetCombatFx() cycle). Replaces the scene's old implicit teardown of these fields. */
  destroy(): void {
    this.resetCombatFx();
  }
}
