import Phaser from 'phaser';
import { ACTION_ANIM_FRAMERATE, DEATH_ANIM_FRAMERATE } from '../../config';
import {
  ACTIVE_TILESET,
  playerAnimKey,
  enemyWalkKey,
  enemyIdleKey,
  enemyDeathKey,
  campfireBaseKey,
  campfireFlameKey,
  type Facing,
  type PlayerState,
} from '../../data/tileset';

/**
 * Registers the player + enemy Phaser animations once per (re)start. Pure setup: reads the active
 * tileset manifest and calls `scene.anims.create` for every strip, guarding each with
 * `anims.exists` since Phaser's anim manager is process-global and survives scene restarts (the
 * (re)started scene must not recreate — or error on — animations already registered). Free
 * function (not a method) since it only touches base `Phaser.Scene` API, no GameScene state.
 */
export function registerActorAnims(scene: Phaser.Scene): void {
  // Player: 3-way directional idle + walk (down/side/up). Each strip is its own texture (key ==
  // anim key, loaded in PreloadScene); side art faces right, GameScene mirrors it with flipX.
  const { player: playerActor, enemy: enemyActor } = ACTIVE_TILESET.actors;
  // idle/walk loop (velocity-driven locomotion); chop/mine/gather loop while harvesting in place;
  // attack is a one-shot swing. Chop/mine/attack run faster (ACTION_ANIM_FRAMERATE) so a hit lands per
  // swing; gather is a calmer forage loop at the locomotion rate.
  (['idle', 'walk', 'chop', 'mine', 'gather', 'attack', 'death'] as PlayerState[]).forEach(
    (state) => {
      const isAction = state === 'chop' || state === 'mine' || state === 'attack';
      const oneShot = state === 'attack' || state === 'death'; // play once and hold the last frame
      (['down', 'side', 'up'] as Facing[]).forEach((facing) => {
        const key = playerAnimKey(state, facing);
        if (scene.anims.exists(key)) return;
        scene.anims.create({
          key,
          frames: scene.anims.generateFrameNumbers(key, {
            start: 0,
            end: playerActor[state][facing].frames - 1,
          }),
          frameRate:
            state === 'death' ? DEATH_ANIM_FRAMERATE : isAction ? ACTION_ANIM_FRAMERATE : 10,
          repeat: oneShot ? 0 : -1,
        });
      });
    },
  );
  // Enemy (skeleton): a single Run strip (frame 0 doubles as the idle pose, flipped by movement-x —
  // the mob sheets ship no directional variants) plus a one-shot Death collapse played on kill.
  if (!scene.anims.exists(enemyWalkKey)) {
    scene.anims.create({
      key: enemyWalkKey,
      frames: scene.anims.generateFrameNumbers(enemyWalkKey, {
        start: 0,
        end: enemyActor.walk.frames - 1,
      }),
      frameRate: 10,
      repeat: -1,
    });
  }
  if (!scene.anims.exists(enemyIdleKey)) {
    scene.anims.create({
      key: enemyIdleKey,
      frames: scene.anims.generateFrameNumbers(enemyIdleKey, {
        start: 0,
        end: enemyActor.idle.frames - 1,
      }),
      frameRate: 6, // slow, gentle breathing bob
      repeat: -1,
    });
  }
  if (!scene.anims.exists(enemyDeathKey)) {
    scene.anims.create({
      key: enemyDeathKey,
      frames: scene.anims.generateFrameNumbers(enemyDeathKey, {
        start: 0,
        end: enemyActor.death.frames - 1,
      }),
      frameRate: DEATH_ANIM_FRAMERATE,
      repeat: 0,
    });
  }
  // Campfire (station): two looping flickers — the ember/log base and the flame layered on top (plan
  // 016). Registered here alongside the actors so every anims.create lives in one guarded place; keys +
  // frame counts come from the manifest. CampfireManager scales the flame by fuel (anims are fuel-agnostic).
  const { base: campfireBase, flame: campfireFlame } = ACTIVE_TILESET.stations.campfire;
  for (const [key, strip] of [
    [campfireBaseKey(), campfireBase],
    [campfireFlameKey(), campfireFlame],
  ] as const) {
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(key, { start: 0, end: strip.frames - 1 }),
      frameRate: 8, // steady flame flicker
      repeat: -1,
    });
  }
}
