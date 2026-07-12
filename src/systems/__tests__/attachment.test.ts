import { describe, it, expect } from 'vitest';
import { weaponTransform } from '../attachment';
import type { ActorRender } from '../../data/tileset';

// Tier-1: the pure weapon-attach transform (systems/attachment). No Phaser — plain number math.
// Proves the four properties the per-tick weapon pin relies on: flipX mirrors x, flipX negates the
// angle, extraRot adds to the resting rot, and the offset is footprint-independent (32px@2 == 64px@1).

const ACTOR: ActorRender = { scale: 1, originX: 0.5, originY: 0.5 };

describe('weaponTransform', () => {
  it('mirrors the x-offset (and leaves y) when the actor faces left', () => {
    const base = { anchor: { x: 48, y: 24 }, actorRender: ACTOR, frameW: 64, frameH: 64 };
    const right = weaponTransform({ ...base, flipX: false });
    const left = weaponTransform({ ...base, flipX: true });
    expect(right.x).toBe(16); // (48 - 0.5*64) * 1
    expect(left.x).toBe(-16); // mirrored
    expect(left.y).toBe(right.y); // y unchanged by flip
    expect(left.flipX).toBe(true); // passed through for the caller to mirror the sprite
  });

  it('negates the angle under flipX', () => {
    const base = { anchor: { x: 32, y: 32, rot: 30 }, actorRender: ACTOR, frameW: 64, frameH: 64 };
    expect(weaponTransform({ ...base, flipX: false }).rotation).toBe(30);
    expect(weaponTransform({ ...base, flipX: true }).rotation).toBe(-30);
  });

  it('adds extraRot to the anchor resting rot', () => {
    const t = weaponTransform({
      anchor: { x: 32, y: 32, rot: 10 },
      actorRender: ACTOR,
      frameW: 64,
      frameH: 64,
      flipX: false,
      extraRot: 45,
    });
    expect(t.rotation).toBe(55); // 10 resting + 45 swing
  });

  it('treats a missing anchor rot as 0', () => {
    const t = weaponTransform({
      anchor: { x: 32, y: 32 },
      actorRender: ACTOR,
      frameW: 64,
      frameH: 64,
      flipX: false,
      extraRot: 20,
    });
    expect(t.rotation).toBe(20);
  });

  it('is footprint-independent: a 32px@scale2 anchor maps to the same world offset as the 64px@scale1 point', () => {
    const big = weaponTransform({
      anchor: { x: 48, y: 24 },
      actorRender: { scale: 1, originX: 0.5, originY: 0.5 },
      frameW: 64,
      frameH: 64,
      flipX: false,
    });
    const small = weaponTransform({
      anchor: { x: 24, y: 12 }, // half the coords…
      actorRender: ACTOR,
      stripRender: { scale: 2, originX: 0.5, originY: 0.5 }, // …drawn at 2× on a 32px frame
      frameW: 32,
      frameH: 32,
      flipX: false,
    });
    expect(small.x).toBe(big.x); // both (16, -8)
    expect(small.y).toBe(big.y);
  });

  it('honours the strip render override over the actor default', () => {
    const t = weaponTransform({
      anchor: { x: 20, y: 10 },
      actorRender: { scale: 1, originX: 0.5, originY: 0.96 }, // would give a different offset…
      stripRender: { scale: 2, originX: 0.5, originY: 0.95 }, // …but the strip override wins
      frameW: 32,
      frameH: 32,
      flipX: false,
    });
    expect(t.x).toBe((20 - 0.5 * 32) * 2); // 8 — uses the strip's scale/origin, not the actor's
    expect(t.y).toBe((10 - 0.95 * 32) * 2); // -40.8
  });
});
