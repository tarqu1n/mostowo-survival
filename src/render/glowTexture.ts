import Phaser from 'phaser';

/**
 * Bakes a soft silhouette glow into a cached canvas texture **once**, so callers can draw it as a
 * plain Image sitting behind a sprite (see GameScene.refreshQueueHighlights). This replaces the old
 * per-frame `OutlinePipeline` PostFX pass.
 *
 * Why bake instead of shade every frame: a PostFX pipeline runs a full-screen fragment pass (36
 * dependent taps/pixel here) per attached sprite, every frame — even though a tree's silhouette
 * never changes, so the halo is a per-species *constant*. Baking computes that constant a single
 * time on the CPU; the "pulse" then becomes a cheap alpha tween on the baked sprite, and there is no
 * shader in the frame loop at all. It also works identically on WebGL and Canvas, so the old
 * WebGL-only feature-detect fork disappears. See docs/RENDERING.md ("Bake static effects").
 */
export interface GlowTexture {
  /** Phaser texture key of the baked glow canvas. */
  key: string;
  /** Transparent border (source px) added on every side so the halo isn't clipped at the frame edge. */
  pad: number;
}

// Cached per (srcKey,color,radius) so every instance of a species shares one baked texture — and so
// it survives GameScene death-restarts (the global TextureManager outlives the scene, as does this).
const cache = new Map<string, GlowTexture>();

/**
 * Bake (or return the cached) glow texture for `srcKey`. `radius` is the halo reach in **source**
 * texels; `color` is 0xRRGGBB. Requires a 2D canvas + readable source image (same-origin assets),
 * which holds under Vite dev, the GitHub Pages build, and the headless smoke's real browser.
 */
export function bakeGlowTexture(
  scene: Phaser.Scene,
  srcKey: string,
  color: number,
  radius: number,
): GlowTexture {
  const cacheKey = `${srcKey}|${color}|${radius}`;
  const cached = cache.get(cacheKey);
  if (cached && scene.textures.exists(cached.key)) return cached;

  const pad = Math.ceil(radius);
  const glowKey = `glow:${cacheKey}`;
  const srcImg = scene.textures.get(srcKey).getSourceImage() as
    HTMLImageElement | HTMLCanvasElement;
  const w = srcImg.width;
  const h = srcImg.height;
  const gw = w + pad * 2;
  const gh = h + pad * 2;

  // Read the source alpha into a padded frame (0 outside the sprite, so the halo can fade into the border).
  const read = document.createElement('canvas');
  read.width = gw;
  read.height = gh;
  const rctx = read.getContext('2d')!;
  rctx.drawImage(srcImg, pad, pad);
  const srcData = rctx.getImageData(0, 0, gw, gh).data;
  const alphaAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= gw || y >= gh ? 0 : srcData[(y * gw + x) * 4 + 3] / 255;

  // Dilate the alpha silhouette outward with a linear falloff, keep the strongest distance-weighted
  // hit, then a smoothstep shoulder — the same soft distance-field halo the old fragment shader drew
  // (12×3 ring taps), computed once here over a full disc for a smoother result.
  const out = rctx.createImageData(gw, gh);
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let glow = 0;
      for (let dy = -pad; dy <= pad; dy++) {
        for (let dx = -pad; dx <= pad; dx++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > radius) continue;
          const contrib = alphaAt(x + dx, y + dy) * (1 - dist / radius); // linear falloff → 0 at the rim
          if (contrib > glow) glow = contrib;
        }
      }
      glow = glow * glow * (3 - 2 * glow); // smoothstep → soft shoulder, reads as a glow not a hard stroke
      const i = (y * gw + x) * 4;
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = Math.round(glow * 255 * (1 - alphaAt(x, y))); // additive-style: only outside the sprite
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = gw;
  canvas.height = gh;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  if (scene.textures.exists(glowKey)) scene.textures.remove(glowKey);
  scene.textures.addCanvas(glowKey, canvas);

  const result: GlowTexture = { key: glowKey, pad };
  cache.set(cacheKey, result);
  return result;
}
