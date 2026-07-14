import { describe, it, expect } from 'vitest';
import type Phaser from 'phaser';
import { decorTextureKey, resolveDecorDraw } from '../decorSprites';
import { tileImageKey } from '../../data/tileset';
import type { DecorAnim, DecorObject } from '../../systems/mapFormat';

/**
 * Tier-1 coverage for `decorSprites.ts`'s only Phaser-free piece — `decorTextureKey`'s pure
 * path/anim → key derivation. `queueDecorTexture`/`resolveDecorDraw` need a live `Phaser.Scene`
 * (texture manager, loader, anims manager) and are exercised live at `npm run editor` instead (see
 * plan 014 step 7b's acceptance notes) — there's no Phaser/DOM test harness in this repo. The
 * anim-cache-key / played-frame logic added in plan 017 step 6.3 is pure enough to unit-test against
 * a hand-rolled anims/textures stub, so those cases run below with a minimal fake scene.
 */
describe('decorTextureKey', () => {
  const PATH = 'Environment/Props/Static/Rocks.png';

  it('matches the ordinary whole-image key (tileImageKey) when no anim is given', () => {
    expect(decorTextureKey(PATH)).toBe(tileImageKey(PATH));
  });

  it('is deterministic: the same path+anim always derives the same key', () => {
    const anim = { frameWidth: 32, frameHeight: 48, frames: 4, fps: 8 };
    expect(decorTextureKey(PATH, anim)).toBe(decorTextureKey(PATH, anim));
  });

  it('differs from the whole-image key when an anim is given (distinct Phaser texture object)', () => {
    const anim = { frameWidth: 32, frameHeight: 48, frames: 4, fps: 8 };
    expect(decorTextureKey(PATH, anim)).not.toBe(decorTextureKey(PATH));
  });

  it('differs across distinct frameWidth/frameHeight pairs over the same path', () => {
    const a = decorTextureKey(PATH, { frameWidth: 32, frameHeight: 48, frames: 4, fps: 8 });
    const b = decorTextureKey(PATH, { frameWidth: 16, frameHeight: 16, frames: 8, fps: 8 });
    expect(a).not.toBe(b);
  });

  it('is unaffected by fps/frames — only the Phaser-load-relevant frame dimensions key the texture', () => {
    const a = decorTextureKey(PATH, { frameWidth: 32, frameHeight: 48, frames: 4, fps: 8 });
    const b = decorTextureKey(PATH, { frameWidth: 32, frameHeight: 48, frames: 6, fps: 12 });
    expect(a).toBe(b);
  });

  it('is UNCHANGED by omit/frames — same geometry ⇒ same texture key regardless of played set (6.3)', () => {
    // omit affects PLAYBACK only, never spritesheet slicing, so it must not key the texture.
    const withOmit = decorTextureKey(PATH, {
      frameWidth: 32,
      frameHeight: 48,
      frames: 22,
      fps: 8,
      omit: [21],
    });
    const noOmit = decorTextureKey(PATH, { frameWidth: 32, frameHeight: 48, frames: 4, fps: 8 });
    expect(withOmit).toBe(noOmit);
  });
});

/**
 * Minimal fake `Phaser.Scene` exposing only the surface `resolveDecorDraw`'s anim branch touches:
 * `textures.exists` (always resident here), and an `anims` manager that records
 * `generateFrameNumbers`/`create` calls and caches created keys so `exists` reflects them. Cast
 * through `unknown` since it's a deliberate sliver of the real Scene type.
 */
function makeFakeScene() {
  const generateCalls: Array<{ key: string; config: unknown }> = [];
  const createCalls: Array<{ key: string; frames: unknown; frameRate: number; repeat: number }> =
    [];
  const existingAnims = new Set<string>();
  const scene = {
    textures: { exists: () => true },
    anims: {
      exists: (key: string) => existingAnims.has(key),
      generateFrameNumbers: (key: string, config: unknown) => {
        generateCalls.push({ key, config });
        return { key, config }; // opaque marker — resolveDecorDraw only forwards it to create()
      },
      create: (cfg: { key: string; frames: unknown; frameRate: number; repeat: number }) => {
        existingAnims.add(cfg.key);
        createCalls.push(cfg);
        return cfg;
      },
    },
  };
  return { scene: scene as unknown as Phaser.Scene, generateCalls, createCalls, existingAnims };
}

function decorWithAnim(anim: DecorAnim, asset = 'pixel-crawler/foo.png'): DecorObject {
  return {
    id: 'decor_0001',
    kind: 'decor',
    asset,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
    depth: 0,
    anim,
  };
}

describe('resolveDecorDraw anim omit (plan 017 step 6.3)', () => {
  const PATH = 'Environment/Props/Static/Campfire.png';

  function animKeyFor(anim: DecorAnim): string {
    const { scene } = makeFakeScene();
    const draw = resolveDecorDraw(scene, decorWithAnim(anim), PATH);
    expect(draw?.kind).toBe('anim');
    if (draw?.kind !== 'anim') throw new Error('expected an anim draw');
    return draw.animKey;
  }

  it('folds `frames` into animKey (same geometry/fps but different frames → different keys)', () => {
    const a = animKeyFor({ frameWidth: 16, frameHeight: 16, frames: 4, fps: 8 });
    const b = animKeyFor({ frameWidth: 16, frameHeight: 16, frames: 6, fps: 8 });
    expect(a).toContain(':4');
    expect(b).toContain(':6');
    expect(a).not.toBe(b);
  });

  it('a placement WITH omit gets a DIFFERENT animKey than the same geometry/frames WITHOUT omit', () => {
    const withOmit = animKeyFor({ frameWidth: 16, frameHeight: 16, frames: 5, fps: 8, omit: [2] });
    const noOmit = animKeyFor({ frameWidth: 16, frameHeight: 16, frames: 5, fps: 8 });
    expect(withOmit).not.toBe(noOmit);
    expect(withOmit).toContain(':o2');
    expect(noOmit).not.toContain(':o');
  });

  it('two placements with different omit sets get different animKeys (sorted, stable signature)', () => {
    const a = animKeyFor({ frameWidth: 16, frameHeight: 16, frames: 6, fps: 8, omit: [5] });
    const b = animKeyFor({ frameWidth: 16, frameHeight: 16, frames: 6, fps: 8, omit: [2, 4] });
    // The signature is order-independent (sorted): [4,2] keys the same as [2,4].
    const bReordered = animKeyFor({
      frameWidth: 16,
      frameHeight: 16,
      frames: 6,
      fps: 8,
      omit: [4, 2],
    });
    expect(a).not.toBe(b);
    expect(b).toBe(bReordered);
    expect(b).toContain(':o2-4');
  });

  it('with omit non-empty, generateFrameNumbers is called with { frames: <ascending kept list> }', () => {
    const { scene, generateCalls } = makeFakeScene();
    // frames:5, omit:[2] → played set [0,1,3,4] (index 2 excluded, ascending).
    resolveDecorDraw(
      scene,
      decorWithAnim({ frameWidth: 16, frameHeight: 16, frames: 5, fps: 8, omit: [2] }),
      PATH,
    );
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0].config).toEqual({ frames: [0, 1, 3, 4] });
  });

  it('without omit, generateFrameNumbers is still called with { start: 0, end: frames - 1 }', () => {
    const { scene, generateCalls } = makeFakeScene();
    resolveDecorDraw(
      scene,
      decorWithAnim({ frameWidth: 16, frameHeight: 16, frames: 4, fps: 8 }),
      PATH,
    );
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0].config).toEqual({ start: 0, end: 3 });
  });

  it('an empty omit:[] behaves like no omit (full range, no omit signature in the key)', () => {
    const { scene, generateCalls } = makeFakeScene();
    const draw = resolveDecorDraw(
      scene,
      decorWithAnim({ frameWidth: 16, frameHeight: 16, frames: 4, fps: 8, omit: [] }),
      PATH,
    );
    expect(draw?.kind === 'anim' && draw.animKey).not.toContain(':o');
    expect(generateCalls[0].config).toEqual({ start: 0, end: 3 });
  });
});
