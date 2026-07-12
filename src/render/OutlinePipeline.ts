import Phaser from 'phaser';

/**
 * Custom WebGL PostFX pipeline that draws a crisp pixel outline hugging a sprite's alpha
 * silhouette. Attach it to any Image/Sprite via `setPostPipeline(OUTLINE_PIPELINE_KEY)`; each
 * attachment gets its own instance, so the per-instance {@link OutlinePipeline.pulse} flag lets one
 * sprite breathe while others hold a static outline.
 *
 * WebGL-only — {@link registerOutlinePipeline} no-ops under the Canvas fallback, and callers keep
 * their own non-shader highlight for that path (see GameScene.refreshQueueHighlights). This is the
 * first pipeline in the codebase; see docs/RENDERING.md for the pattern + when to reach for one.
 */
export const OUTLINE_PIPELINE_KEY = 'OutlineFX';

// COLORS.queued (0xffd500) as normalized rgb. Inlined (not imported) so the shader layer stays
// self-contained; keep in sync with config.ts COLORS.queued if that colour ever changes.
const OUTLINE_RGB: readonly [number, number, number] = [0xff / 255, 0xd5 / 255, 0x00 / 255];

// Outline half-width in render-target texels. ~1.5 reads as a crisp 1–2 source-px border at the
// 100/150/200% zoom range without reintroducing sub-pixel shimmer (see docs/DECISIONS.md crispness).
const OUTLINE_THICKNESS = 1.5;

const fragShader = `
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec2  uTexSize;        // render-target size in px
uniform vec3  uOutlineColor;   // normalized rgb
uniform float uThickness;      // in render-target texels (~1-2)
uniform float uPulse;          // 0 = static, 1 = breathing
uniform float uTime;           // seconds
varying vec2  outTexCoord;
void main() {
  vec4 tex = texture2D(uMainSampler, outTexCoord);
  vec2 px  = uThickness / uTexSize;
  float n = 0.0;                                   // max neighbour alpha (4-way + diagonals)
  n = max(n, texture2D(uMainSampler, outTexCoord + vec2( px.x, 0.0)).a);
  n = max(n, texture2D(uMainSampler, outTexCoord + vec2(-px.x, 0.0)).a);
  n = max(n, texture2D(uMainSampler, outTexCoord + vec2(0.0,  px.y)).a);
  n = max(n, texture2D(uMainSampler, outTexCoord + vec2(0.0, -px.y)).a);
  n = max(n, texture2D(uMainSampler, outTexCoord + px).a);
  n = max(n, texture2D(uMainSampler, outTexCoord - px).a);
  n = max(n, texture2D(uMainSampler, outTexCoord + vec2(px.x, -px.y)).a);
  n = max(n, texture2D(uMainSampler, outTexCoord + vec2(-px.x, px.y)).a);
  float edge = clamp(n - tex.a, 0.0, 1.0);          // outline only where the sprite is transparent
  float breathe = 0.6 + 0.4 * (0.5 + 0.5 * sin(uTime * 5.0));
  float strength = mix(1.0, breathe, uPulse);
  vec4 outline = vec4(uOutlineColor, 1.0) * edge * strength;
  gl_FragColor = tex + outline * (1.0 - tex.a);
}
`;

export class OutlinePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  /** Per-attachment: the head-of-queue tree sets this so its outline breathes; others stay static. */
  pulse = false;

  constructor(game: Phaser.Game) {
    super({ game, fragShader } as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);
  }

  onDraw(renderTarget: Phaser.Renderer.WebGL.RenderTarget): void {
    this.set2f('uTexSize', renderTarget.width, renderTarget.height);
    this.set3f('uOutlineColor', OUTLINE_RGB[0], OUTLINE_RGB[1], OUTLINE_RGB[2]);
    this.set1f('uThickness', OUTLINE_THICKNESS);
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
