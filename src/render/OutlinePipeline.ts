import Phaser from 'phaser';

/**
 * Custom WebGL PostFX pipeline that draws a soft glow hugging a sprite's alpha silhouette (a
 * feathered halo, not a hard 1px stroke). Attach it to any Image/Sprite via
 * `setPostPipeline(OUTLINE_PIPELINE_KEY)`; each attachment gets its own instance, so the per-instance
 * {@link OutlinePipeline.pulse} flag lets one sprite breathe while others hold a static glow.
 *
 * WebGL-only — {@link registerOutlinePipeline} no-ops under the Canvas fallback, and callers keep
 * their own non-shader highlight for that path (see GameScene.refreshQueueHighlights). This is the
 * first pipeline in the codebase; see docs/RENDERING.md for the pattern + when to reach for one.
 */
export const OUTLINE_PIPELINE_KEY = 'OutlineFX';

// COLORS.queued (0xffd500) as normalized rgb. Inlined (not imported) so the shader layer stays
// self-contained; keep in sync with config.ts COLORS.queued if that colour ever changes.
const OUTLINE_RGB: readonly [number, number, number] = [0xff / 255, 0xd5 / 255, 0x00 / 255];

// Glow reach in render-target texels — how far the halo extends from the sprite edge. ~5 gives a
// soft few-px bloom at the 100/150/200% zoom range; authored in texels so it scales consistently.
const GLOW_RADIUS = 5.0;

// Soft radial glow: for each pixel, sample the sprite's alpha along a ring of directions at several
// radii and keep the strongest distance-weighted hit — a cheap distance-field falloff that fades to
// zero at GLOW_RADIUS. Confined to the transparent region so the sprite itself is untouched. The
// smoothstep ramp softens the near-edge shoulder so it reads as a glow, not a hard stroke.
const fragShader = `
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec2  uTexSize;        // render-target size in px
uniform vec3  uOutlineColor;   // normalized rgb
uniform float uRadius;         // glow reach, in render-target texels
uniform float uPulse;          // 0 = static, 1 = breathing
uniform float uTime;           // seconds
varying vec2  outTexCoord;

const int DIRS  = 12;          // angular samples around the ring
const int STEPS = 3;           // radial samples per direction (12x3 = 36 taps: soft, yet cheap)

void main() {
  vec4 tex = texture2D(uMainSampler, outTexCoord);
  vec2 unit = 1.0 / uTexSize;
  float glow = 0.0;
  for (int d = 0; d < DIRS; d++) {
    float ang = (float(d) / float(DIRS)) * 6.2831853;
    vec2 dir = vec2(cos(ang), sin(ang));
    for (int s = 1; s <= STEPS; s++) {
      float r = (float(s) / float(STEPS)) * uRadius;         // texels out along this direction
      float a = texture2D(uMainSampler, outTexCoord + dir * unit * r).a;
      float w = 1.0 - (r / uRadius);                         // linear falloff → 0 at the rim
      glow = max(glow, a * w);
    }
  }
  glow = clamp(glow, 0.0, 1.0);
  glow = glow * glow * (3.0 - 2.0 * glow);                   // smoothstep → soft shoulder
  float breathe = 0.65 + 0.35 * (0.5 + 0.5 * sin(uTime * 4.0));
  float strength = mix(1.0, breathe, uPulse);
  vec4 halo = vec4(uOutlineColor, 1.0) * glow * strength;
  gl_FragColor = tex + halo * (1.0 - tex.a);                 // additive glow, only outside the sprite
}
`;

export class OutlinePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  /** Per-attachment: the head-of-queue tree sets this so its glow breathes; others stay static. */
  pulse = false;

  constructor(game: Phaser.Game) {
    super({ game, fragShader } as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);
  }

  onDraw(renderTarget: Phaser.Renderer.WebGL.RenderTarget): void {
    this.set2f('uTexSize', renderTarget.width, renderTarget.height);
    this.set3f('uOutlineColor', OUTLINE_RGB[0], OUTLINE_RGB[1], OUTLINE_RGB[2]);
    this.set1f('uRadius', GLOW_RADIUS);
    this.set1f('uPulse', this.pulse ? 1 : 0);
    this.set1f('uTime', this.game.loop.time / 1000); // scene clock, not Date.now() (deterministic)
    this.bindAndDraw(renderTarget);
  }
}

/**
 * Register the outline pipeline once, globally. No-op under Canvas; guarded against double
 * registration so it survives GameScene restarts (the pipeline registry outlives the scene).
 */
export function registerOutlinePipeline(game: Phaser.Game): void {
  if (game.renderer.type !== Phaser.WEBGL) return;
  const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!renderer.pipelines.has(OUTLINE_PIPELINE_KEY)) {
    renderer.pipelines.addPostPipeline(OUTLINE_PIPELINE_KEY, OutlinePipeline);
  }
}
