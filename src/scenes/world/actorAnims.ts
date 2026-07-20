import Phaser from 'phaser';
import { ACTION_ANIM_FRAMERATE, DEATH_ANIM_FRAMERATE } from '../../config';
import {
  ACTIVE_TILESET,
  playerAnimKey,
  enemyWalkKey,
  enemyIdleKey,
  enemyDeathKey,
  dirEnemyAnimKey,
  campfireBaseKey,
  campfireFlameLargeKey,
  campfireFlameSmallKey,
  campfireSmokeKey,
  type Facing,
  type Facing4,
  type DirEnemyState,
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
  // Directional enemies (dir4, e.g. the boar): one anim per state per facing, id-scoped keys (distinct
  // from the skeleton's global enemy-* keys). idle/walk/run loop (locomotion); attack/hurt/death play
  // once. Frame counts come from each strip in the manifest. Empty until a dir4 creature is registered.
  const dirStates: Array<[DirEnemyState, number, number]> = [
    // [state, frameRate, repeat] — run bumped over walk for the charge; attack at the action rate.
    ['idle', 6, -1],
    ['walk', 10, -1],
    ['run', 12, -1],
    ['attack', ACTION_ANIM_FRAMERATE, 0],
    ['hurt', ACTION_ANIM_FRAMERATE, 0],
    ['death', DEATH_ANIM_FRAMERATE, 0],
  ];
  for (const [id, actor] of Object.entries(ACTIVE_TILESET.actors.directional)) {
    for (const [state, frameRate, repeat] of dirStates) {
      for (const facing of ['down', 'up', 'left', 'right'] as Facing4[]) {
        const key = dirEnemyAnimKey(id, state, facing);
        if (scene.anims.exists(key)) continue;
        scene.anims.create({
          key,
          frames: scene.anims.generateFrameNumbers(key, {
            start: 0,
            end: actor[state][facing].frames - 1,
          }),
          frameRate,
          repeat,
        });
      }
    }
  }

  // Campfire (station): four looping flickers — the stone-ring base, the large + small flame sheets,
  // and the smoke plume (plan 016 follow-up). Registered here alongside the actors so every anims.create
  // lives in one guarded place; keys + frame counts come from the manifest. CampfireManager picks which
  // flame sheet + scale by fuel (anims are fuel-agnostic).
  const { base, flameLarge, flameSmall, smoke } = ACTIVE_TILESET.stations.campfire;
  for (const [key, strip] of [
    [campfireBaseKey(), base],
    [campfireFlameLargeKey(), flameLarge],
    [campfireFlameSmallKey(), flameSmall],
    [campfireSmokeKey(), smoke],
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
