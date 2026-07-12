import Phaser from 'phaser';

/**
 * Damage flash as a per-object PostFX pass: mixes a sprite's colour toward red by a `flash` uniform
 * (0..1), driven per-frame by a tween in {@link GameScene.flashHit}. This is one of the cases
 * docs/RENDERING.md calls out for a *live* shader rather than a bake: the output changes every frame
 * for the ~200ms it's attached (the flash ramps down), and it's a genuine per-pixel tint a plain
 * GameObject tint can't express — Phaser's Canvas `setTint` is a *multiply* (it can only darken), so
 * it can't brighten a mid-tone sprite toward red. The pipeline is attached only while flashing and
 * detached on completion, so it never costs a per-frame pass at rest.
 *
 * Per-attachment state: each sprite that attaches the pipeline gets its own instance (Phaser creates
 * one per `setPostPipeline`), so `flash` differs between the player and a zombie flashing at once.
 *
 * Graceful degradation: WebGL-only. `registerHitFlashPipeline` no-ops on Canvas, and `flashHit`
 * falls back to a solid `setTintFill` there — so the effect degrades to a plain red fill, never errors.
 */
export const HIT_FLASH_KEY = 'HitFlash';

// Straight tint toward red, weighted by the sprite's own alpha so the padded-but-transparent border
// of the FX render-target (and the sprite's soft edges) never picks up red. No neighbour sampling, so
// there's nothing to author in render-target texels — the kernel is a single tap per pixel.
const fragShader = `
precision mediump float;
uniform sampler2D uMainSampler;
uniform float flash;
varying vec2 outTexCoord;
void main() {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  vec3 red = vec3(0.9, 0.1, 0.1);
  gl_FragColor = vec4(mix(c.rgb, red, flash * c.a), c.a);
}
`;

export class HitFlashPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  /** Per-attachment red-mix amount (0..1); set each frame by the caller's flash tween. */
  flash = 0;

  constructor(game: Phaser.Game) {
    super({ game, name: HIT_FLASH_KEY, fragShader });
  }

  onDraw(renderTarget: Phaser.Renderer.WebGL.RenderTarget): void {
    this.set1f('flash', this.flash);
    this.bindAndDraw(renderTarget);
  }
}

/**
 * Register the pipeline once on the game. No-ops on Canvas (WebGL-only) and guards against a double
 * register, so it's safe to call from `BootScene.create()` — the pipeline registry outlives
 * `GameScene` death-restarts, so it registers exactly once across the session (see docs/RENDERING.md).
 */
export function registerHitFlashPipeline(game: Phaser.Game): void {
  if (game.renderer.type !== Phaser.WEBGL) return;
  const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!renderer.pipelines.has(HIT_FLASH_KEY)) {
    renderer.pipelines.addPostPipeline(HIT_FLASH_KEY, HitFlashPipeline);
  }
}
