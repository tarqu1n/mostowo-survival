/**
 * Pure weapon-attachment transform — no Phaser, no scene deps. Maps a per-frame {@link AttachPoint}
 * (authored in the strip frame's own pixel space) to the world-pixel offset + angle at which to draw
 * a held weapon, relative to the wielder's origin. The scene calls this every tick with the current
 * frame's anchor, applies the result to the one pinned weapon sprite, and the weapon tracks the hand.
 *
 * Footprint independence: the offset is scaled through the ACTIVE strip's render (its own when the
 * strip overrides the actor default — e.g. the 32px Idle vs the 64px Run), so an anchor authored on a
 * 32px frame drawn at scale 2 and the equivalent point on a 64px frame at scale 1 resolve to the SAME
 * world offset. Mirroring: when the actor faces left (`flipX`) the x-offset mirrors and the angle
 * negates, so the weapon flips with the body. `extraRot` is the additive coded-swing angle.
 *
 * Shared primitive: the player's future rigid equipment slots (plan 010) reuse this same transform.
 */

import type { AttachPoint, ActorRender } from '../data/tileset';

export interface WeaponTransformInput {
  /** The active frame's grip point, in that frame's pixel space (top-left origin, +x right, +y down). */
  anchor: AttachPoint;
  /** The actor's default render footprint (scale + origin fractions). */
  actorRender: ActorRender;
  /** The active strip's own footprint override, when it has one (e.g. the 32px Idle); wins over `actorRender`. */
  stripRender?: ActorRender;
  /** Active frame dimensions in source px (Idle 32×32, Run 64×64). */
  frameW: number;
  frameH: number;
  /** Actor facing left — mirrors the x-offset and negates the angle. */
  flipX: boolean;
  /** Additive swing angle in degrees (the coded attack tween); 0 at rest. */
  extraRot?: number;
}

export interface WeaponTransform {
  /** World-px x offset from the actor's origin (already mirrored when `flipX`). */
  x: number;
  /** World-px y offset from the actor's origin. */
  y: number;
  /** Weapon angle in DEGREES: the anchor's resting `rot` plus `extraRot`, negated when `flipX`. */
  rotation: number;
  /** Pass-through of `flipX` so the caller mirrors the weapon sprite with the body. */
  flipX: boolean;
}

/**
 * Resolve where/how to draw the held weapon this frame. Pure: depends only on its inputs.
 *
 * The offset is the anchor's displacement from the frame's origin point (`origin × frameSize`), taken
 * in frame px and scaled to world px by the active render's `scale`. The active render is the strip's
 * own when present, else the actor default — this is what makes a 32px and a 64px strip agree.
 */
export function weaponTransform(input: WeaponTransformInput): WeaponTransform {
  const { anchor, actorRender, stripRender, frameW, frameH, flipX, extraRot = 0 } = input;
  const render = stripRender ?? actorRender;

  // Anchor's offset from the frame origin, in source px, scaled into world px.
  const dx = (anchor.x - render.originX * frameW) * render.scale;
  const dy = (anchor.y - render.originY * frameH) * render.scale;

  const rot = (anchor.rot ?? 0) + extraRot;

  return {
    x: flipX ? -dx : dx,
    y: dy,
    rotation: flipX ? -rot : rot,
    flipX,
  };
}
