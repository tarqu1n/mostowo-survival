import Phaser from 'phaser';

/**
 * Bakes a soft radial "damage vignette" into a cached canvas texture **once**: fully transparent
 * through the centre, ramping to `color` only at the edges and corners. UIScene draws it as a
 * full-viewport, camera-fixed Image and pulses its alpha when the player is hit — a peripheral red
 * flash is a far clearer "you're taking damage" cue than a tint on the (screen-centred, easily-missed)
 * player sprite alone. Bake, not a per-frame shader: the shape is a constant, only its alpha animates
 * (a cheap tween). Cached per `(color,w,h)` and keyed on the global TextureManager, so it survives
 * scene restarts and every pulse reuses the one texture. Same CPU-canvas approach as glowTexture.ts.
 */
const cache = new Map<string, string>();

export function bakeVignetteTexture(
  scene: Phaser.Scene,
  color: number,
  w: number,
  h: number,
): string {
  const cacheKey = `vignette|${color}|${w}x${h}`;
  const cached = cache.get(cacheKey);
  if (cached && scene.textures.exists(cached)) return cached;

  const key = `tex:${cacheKey}`;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;

  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.hypot(cx, cy); // reach the corners
  // Clear through the centre (stops at 0 and 0.6 are transparent), then ramp to solid at the rim, so
  // the red hugs the screen edges and never washes over the play area.
  const grad = ctx.createRadialGradient(cx, cy, outer * 0.25, cx, cy, outer);
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(0.42, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},1)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
  cache.set(cacheKey, key);
  return key;
}
