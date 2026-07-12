# Rendering & Shaders

How custom rendering is wired in Mostowo Survival, and a heuristic for when a visual effect should
be a **shader** vs a plain GameObject. Lean index — extend it as we add pipelines.

The renderer is `Phaser.AUTO` + `pixelArt: true` (see [src/main.ts](../src/main.ts)): WebGL where
available, Canvas fallback otherwise. **Custom pipelines are WebGL-only** — always feature-detect and
keep a non-shader path for Canvas.

## Custom PostFX pipelines

A PostFX pipeline runs a fragment shader over a sprite *after* it's drawn, into a padded
render-target. Attach it per-object; each attachment is its own instance, so per-object state (a
flag, a phase) can differ between sprites sharing the pipeline.

**The pattern** (reference implementation:
[src/render/OutlinePipeline.ts](../src/render/OutlinePipeline.ts) — the queued-tree outline):

1. **Subclass** `Phaser.Renderer.WebGL.Pipelines.PostFXPipeline` with an inline GLSL `fragShader`.
   Add public instance fields for per-attachment state (e.g. `pulse`).
2. **Set uniforms** by overriding `onDraw(renderTarget)`: `set2f`/`set3f`/`set1f`, then
   `this.bindAndDraw(renderTarget)`. Read the render-target size from `renderTarget.width/height`.
   For time, use `this.game.loop.time / 1000` — **never `Date.now()`** (keeps it deterministic and
   aligned with the scene clock).
3. **Register once** via a `register*Pipeline(game)` helper that no-ops unless
   `game.renderer.type === Phaser.WEBGL` and guards `renderer.pipelines.has(KEY)` before
   `addPostPipeline(KEY, Class)`. Call it from `BootScene.create()` — the pipeline registry outlives
   `GameScene` death-restarts, so it registers exactly once.
4. **Attach / detach** on a live sprite with `sprite.setPostPipeline(KEY)` /
   `sprite.removePostPipeline(KEY)`; grab the instance with `sprite.getPostPipeline(KEY)` (may return
   an instance or an array — take the first) to poke its per-attachment fields.
5. **Graceful degradation:** guard the WebGL path with `renderer.type === Phaser.WEBGL` and keep the
   old GameObject-based visual for Canvas (the outline falls back to a stroke-only marker rect).
6. **Crispness:** author thickness/offsets in **render-target texels**, not screen px, so the effect
   scales consistently with nearest-neighbour sampling and doesn't shimmer at fractional zoom.

**Testing note:** the headless smoke runs real WebGL, so a shader compile/link error surfaces as a
console error and fails the zero-error gate — a free compile check. Assert shader-driven state through
a `debugState()` accessor, not by inspecting GameObjects that the shader path no longer creates.

## When to reach for a shader

Prefer a **pipeline/shader** when the effect is inherently per-pixel or screen-space:

- Silhouette outlines / glows that must hug a sprite's actual shape (a rect can't).
- Per-pixel tint, masking, palette swaps, dissolves, damage/hit flashes.
- Day/night colour grading, vignettes, other screen-space post effects.
- Anything that needs to sample neighbouring pixels or the whole frame.

Prefer a **plain GameObject / tween** when a primitive already expresses it cleanly:

- Solid fills, rectangle strokes, simple pips/markers (build sites, move tiles).
- Simple alpha / scale / position tweens on a whole object.
- One-off UI chrome that never needs per-pixel logic.

Rule of thumb: if you'd be faking a per-pixel effect by stacking/among GameObjects, it's a shader; if
a single primitive with a tween says it, don't write GLSL.
