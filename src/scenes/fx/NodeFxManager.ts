import Phaser from 'phaser';
import {
  CHOP_RECOIL_PX,
  CHOP_RECOIL_MS,
  CHOP_RECOIL_SQUASH,
  CHOP_TREMBLE_PX,
  CHOP_TREMBLE_DEG,
  TREE_FELL_MS,
  TREE_FELL_ARC_DEG,
  TREE_FELL_FADE_MS,
  ROCK_CRUMBLE_MS,
  BUSH_RUSTLE_MS,
} from '../../config';
import type { GameScene } from '../GameScene';

/**
 * Per-hit chop feedback input. `ResourceNodeManager` owns skin resolution, so it hands
 * {@link NodeFxManager} plain data (never the node object graph): the persistent node sprite to
 * animate, its TRUE resting transform (tile-centre + fitted base scale) so a re-chop mid-jitter can
 * snap back to rest instead of accumulating drift, the `depletion` fraction driving the escalating
 * tremble, and the `facing` sign-delta pointing FROM the chopper TO the node (so away == +facing).
 */
export interface ChopFxInput {
  sprite: Phaser.GameObjects.Image;
  /** True resting X (tile-centre px) — the sprite must settle exactly here between hits. */
  restX: number;
  /** True resting Y (tile-centre px). */
  restY: number;
  /** Fitted base scale (skin/def `nodeScale`) — read live each hit, never captured. */
  baseScale: number;
  /** The node's authored placement rotation (deg) — the TRUE rest angle. Recoil/tremble layer on top
   *  and settle back to THIS, so a chop never snaps the node to 0 and drops its placement rotation. */
  baseAngle: number;
  /** (maxHp - hp) / maxHp, 0..1 — tremble amplitude scales with this. */
  depletion: number;
  /** Chopper→node sign-delta (`Character.lastFacing`); away-from-chopper == +facing. */
  facing: { dCol: number; dRow: number };
}

/**
 * Depletion (fell) input for the transient clone. Carries a resolved texture key/frame + full
 * transform (the manager can't reach into skin internals), plus `nodeSprite` ONLY so `playFell` can
 * stop that sprite's in-flight recoil tween before the stump swap settles (it never animates the
 * persistent sprite — the caller has already swapped it to the stump).
 */
export interface FellFxInput {
  /** Depletion style: 'chop'/undefined → tree topple, 'mine' → rock crumble, 'gather' → bush rustle. */
  kind: 'chop' | 'gather' | 'mine';
  texKey: string;
  texFrame?: string | number;
  x: number;
  y: number;
  scale: number;
  /** The node's authored placement rotation (deg) — the clone starts here and topples/shudders FROM it. */
  baseAngle: number;
  originX: number;
  originY: number;
  depth: number;
  /** Chopper→node sign-delta — the topple leans away from the chopper. */
  facing: { dCol: number; dRow: number };
  /** The persistent node sprite — only so `playFell` can stop its recoil tween (never animated here). */
  nodeSprite: Phaser.GameObjects.Image;
}

/** A tracked transient effect sprite + the tweens poking it, so teardown can stop then drop/destroy. */
interface TransientFx {
  sprite: Phaser.GameObjects.Image;
  tweens: Phaser.Tweens.Tween[];
}

/**
 * Harvest-node FX: the per-hit directional recoil + escalating tremble on the persistent node sprite,
 * and the per-kind depletion payoff (tree topple / rock crumble / bush rustle) on a transient clone.
 * Mirrors {@link CombatFxManager}'s exact shape (plan 031): a GameScene field initializer that only
 * stashes its scene ref (Scene-plugin injections aren't installed when the class constructor runs),
 * with `armShutdown()` doing the one thing that must wait. `ResourceNodeManager` reaches this only
 * through the narrow `playChopFx`/`playFellFx` dep closures the scene supplies (no manager↔manager
 * edge) — this surface never touches skin internals, only the plain-data inputs above.
 *
 * The selection glow halo mirrors the node transform every frame via `TaskGlowRenderer.syncGlow
 * Transforms`, so animating the node transform animates its outline for free — do NOT touch
 * `TaskGlowRenderer`. The transient fell clone is unmanaged fx and is correctly NOT tracked by the
 * halo (the halo follows the stump, which stays put).
 */
export class NodeFxManager {
  // Per-hit recoil/tremble tweens, keyed by the persistent node sprite so a rapid re-chop restarts
  // cleanly (stop the old, snap to rest, start the new) and the depletion hit can stop the dying
  // recoil before the stump swap settles. The tween pokes the sprite, so it must stop before the
  // sprite is destroyed (clearAll / SHUTDOWN).
  private readonly recoilTweens = new Map<Phaser.GameObjects.Image, Phaser.Tweens.Tween>();
  // Live fell/crumble/rustle clones + their tweens. Each self-unregisters on completion (endTransient);
  // reset() stops+destroys the survivors, destroy() stops+drops them (Phaser already destroyed them).
  private readonly transient = new Set<TransientFx>();

  // Field-initializer construction (see CombatFxManager): only stash the scene here — scene.events/
  // tweens/time aren't injected yet. armShutdown() waits for create().
  constructor(private readonly scene: GameScene) {}

  /**
   * Arm the SHUTDOWN-triggered flush. Call once per `create()` (every (re)start re-registers, mirroring
   * CombatFxManager.armShutdown) — `.once` fires exactly once per run, flushing this run's tweens before
   * the next create() reuses this same manager instance.
   */
  armShutdown(): void {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /**
   * Per-hit chop feedback on the persistent node sprite: a directional recoil that jolts the node
   * AWAY from the chopper and snaps back, with an escalating positional+angular tremble layered on top
   * whose amplitude grows as HP drops toward 0. Both beats share ONE tween driving a 0→1 progress `p`
   * with an out-and-back envelope — the sprite always settles back to the true resting transform
   * (tile-centre, upright, base scale) at the end of the hit, leaving no residual offset/rotation for
   * the next hit or the fell to fight. The glow halo mirrors this motion each frame for free.
   */
  playChop(input: ChopFxInput): void {
    const { sprite, restX, restY, baseAngle, depletion, facing } = input;
    const baseScale = input.baseScale; // read live per hit — never a value captured across hits
    // Snap to the true resting transform + stop any in-flight tween FIRST, so a re-chop landing mid-
    // jitter (hits can arrive every CHOP_INTERVAL_MS) can't accumulate drift off tile-centre. Rest
    // angle is the node's authored rotation (baseAngle), NOT 0 — snapping to 0 dropped the placement
    // rotation permanently (it's never re-applied on regrow).
    this.recoilTweens.get(sprite)?.stop();
    sprite.setPosition(restX, restY).setAngle(baseAngle).setScale(baseScale);

    // Unit vector along +facing (chopper→node), so the recoil pushes the node away from the chopper.
    // Normalised so a diagonal approach recoils the same distance as an orthogonal one.
    const len = Math.hypot(facing.dCol, facing.dRow) || 1;
    const ux = facing.dCol / len;
    const uy = facing.dRow / len;
    // Tremble amplitude scales with how depleted the node is (barely visible on the first hit, wild on
    // the killing blow). A 0-facing (defensive: runHarvest always yields one) still trembles fine.
    const ampPx = depletion * CHOP_TREMBLE_PX;
    const ampDeg = depletion * CHOP_TREMBLE_DEG;

    const state = { p: 0 };
    const tween = this.scene.tweens.add({
      targets: state,
      p: 1,
      duration: CHOP_RECOIL_MS,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        if (!sprite.active) return;
        const p = state.p;
        const recoilEnv = Math.sin(p * Math.PI); // 0→1→0: out on the impact, back by the end
        const decay = 1 - p; // tremble rings down to 0 so the hit always settles upright at rest
        // Recoil offset (away from chopper) + a decaying multi-frequency shake (different freq/phase
        // per axis so it reads as a jitter, not a slide). All terms hit 0 at p=1 → exact rest.
        const dx = ux * CHOP_RECOIL_PX * recoilEnv + Math.sin(p * Math.PI * 7) * ampPx * decay;
        const dy = uy * CHOP_RECOIL_PX * recoilEnv + Math.cos(p * Math.PI * 6) * ampPx * decay;
        sprite.setPosition(restX + dx, restY + dy);
        sprite.setAngle(baseAngle + Math.sin(p * Math.PI * 5) * ampDeg * decay);
        // Squash pop at the impact (widest+shortest at the peak), easing back to base scale.
        sprite.setScale(
          baseScale * (1 + CHOP_RECOIL_SQUASH * recoilEnv),
          baseScale * (1 - CHOP_RECOIL_SQUASH * recoilEnv),
        );
      },
      onComplete: () => {
        this.recoilTweens.delete(sprite);
        // Land exactly on rest (kill float error): tile-centre, base scale, and the node's OWN rest
        // angle (baseAngle) — never a hard 0, which would erase the placement rotation.
        if (sprite.active) sprite.setPosition(restX, restY).setAngle(baseAngle).setScale(baseScale);
      },
    });
    this.recoilTweens.set(sprite, tween);
  }

  /**
   * Per-kind depletion payoff on a transient clone (tree topple / rock crumble / bush rustle). First
   * stops+clears the node sprite's in-flight recoil tween so the dying recoil can't fight the caller's
   * stump swap (Finding 4) — the persistent stump is already visible underneath. Then spawns a clone of
   * the LIVE visual at the node's transform and animates its death by kind, destroying it on complete.
   * The clone is unmanaged fx: the glow halo tracks the (stationary) stump, so the toppling clone is
   * correctly NOT mirrored by the outline. All motion terms decay to nothing before the clone is freed,
   * and every callback is `.active`-guarded so a DEV world reset mid-fell (which stops these tweens then
   * destroys the clone) can never poke a freed sprite.
   */
  playFell(input: FellFxInput): void {
    this.recoilTweens.get(input.nodeSprite)?.stop();
    this.recoilTweens.delete(input.nodeSprite);

    const { kind, texKey, texFrame, x, y, scale, baseAngle, originX, originY, depth, facing } =
      input;
    const sprite = this.scene.add
      .image(x, y, texKey, texFrame)
      .setScale(scale)
      .setOrigin(originX, originY)
      .setAngle(baseAngle) // start at the node's authored rotation; topple/shudder is relative to it
      .setDepth(depth); // match the node depth so the clone never renders over actors
    const entry = this.track(sprite);
    const end = () => this.endTransient(entry);

    if (kind === 'mine') {
      // Rock crumble: a brief decaying shudder (position + a whisper of angle) collapsing into a
      // shrink-and-fade. Minimal rotation — a rock doesn't topple, it disintegrates in place.
      const state = { p: 0 };
      entry.tweens.push(
        this.scene.tweens.add({
          targets: state,
          p: 1,
          duration: ROCK_CRUMBLE_MS,
          ease: 'Quad.easeIn',
          onUpdate: () => {
            if (!sprite.active) return;
            const p = state.p;
            const decay = 1 - p; // shudder rings down as the crumble takes over
            sprite.setPosition(x + Math.sin(p * Math.PI * 8) * 2 * decay, y);
            sprite.setAngle(baseAngle + Math.sin(p * Math.PI * 6) * 1.5 * decay);
            sprite.setScale(scale * (1 - 0.3 * p)); // → 0.7*scale
            sprite.setAlpha(1 - p);
          },
          onComplete: end,
        }),
      );
    } else if (kind === 'gather') {
      // Bush rustle: a quick squash (pop wide, compress down) fading out fast. No rotation.
      const state = { p: 0 };
      entry.tweens.push(
        this.scene.tweens.add({
          targets: state,
          p: 1,
          duration: BUSH_RUSTLE_MS,
          ease: 'Quad.easeOut',
          onUpdate: () => {
            if (!sprite.active) return;
            const p = state.p;
            sprite.setScale(scale * (1 + 0.2 * Math.sin(p * Math.PI)), scale * (1 - 0.35 * p));
            sprite.setAlpha(1 - p);
          },
          onComplete: end,
        }),
      );
    } else {
      // Tree topple ('chop'/undefined): rotate about the base-anchored origin (the trunk hinges at its
      // foot) FROM its rest angle through the fell arc, with a strong ease-in so it tips slowly then
      // whips down like a pendulum falling from balance (Quart, not Quad — the old mild ease read as
      // near-linear). Lean sign never collapses to 0 — a worker directly above/below still gets a real
      // topple, not a rotation-less fade (Finding 2).
      const sign = Math.sign(facing.dCol) || Math.sign(facing.dRow) || 1;
      entry.tweens.push(
        this.scene.tweens.add({
          targets: sprite,
          angle: baseAngle + sign * TREE_FELL_ARC_DEG,
          duration: TREE_FELL_MS,
          ease: 'Quart.easeIn',
        }),
      );
      entry.tweens.push(
        this.scene.tweens.add({
          targets: sprite,
          alpha: 0,
          delay: Math.max(0, TREE_FELL_MS - TREE_FELL_FADE_MS),
          duration: TREE_FELL_FADE_MS,
          onComplete: end,
        }),
      );
    }
  }

  /** Register a transient clone so teardown can find it; its tweens are pushed by the caller and it
   *  self-unregisters via {@link endTransient} on natural completion. */
  private track(sprite: Phaser.GameObjects.Image): TransientFx {
    const entry: TransientFx = { sprite, tweens: [] };
    this.transient.add(entry);
    return entry;
  }

  /** Natural end of a transient effect: stop its tweens, destroy the clone, drop it from the set.
   *  Idempotent + safe if `reset()`/`destroy()` already flushed it (the `has` guard short-circuits, so
   *  a stopped tween's late onComplete can't double-free). */
  private endTransient(entry: TransientFx): void {
    if (!this.transient.has(entry)) return;
    this.transient.delete(entry);
    for (const t of entry.tweens) t.stop();
    if (entry.sprite.active) entry.sprite.destroy();
  }

  /**
   * Scene-alive teardown (DEV scenario reset / dev-menu world randomiser, called before node sprites
   * are destroyed): stop every recoil tween then clear the map, and stop every transient's tweens +
   * `sprite.destroy()` then clear the set. Stop-before-clear: a cleared map still leaves the tween
   * running in Phaser's TweenManager, poking a sprite the reset is about to destroy.
   */
  reset(): void {
    for (const t of this.recoilTweens.values()) t.stop();
    this.recoilTweens.clear();
    for (const e of this.transient) {
      for (const t of e.tweens) t.stop();
      if (e.sprite.active) e.sprite.destroy();
    }
    this.transient.clear();
  }

  /**
   * SHUTDOWN teardown (armShutdown): Phaser's own scene teardown has already destroyed every
   * GameObject by now, so stop the tweens + drop refs only — NEVER `.destroy()` (double-free).
   */
  destroy(): void {
    for (const t of this.recoilTweens.values()) t.stop();
    this.recoilTweens.clear();
    for (const e of this.transient) for (const t of e.tweens) t.stop();
    this.transient.clear();
  }
}
