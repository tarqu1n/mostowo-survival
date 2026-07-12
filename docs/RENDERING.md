# Rendering & Shaders

How custom rendering is wired in Mostowo Survival, and a heuristic for when a visual effect should
be a **shader** vs a plain GameObject. Lean index — extend it as we add pipelines.

The renderer is `Phaser.AUTO` + `pixelArt: true` (see [src/main.ts](../src/main.ts)): WebGL where
available, Canvas fallback otherwise. **Custom pipelines are WebGL-only** — always feature-detect and
keep a non-shader path for Canvas.

## Generate once, or shade every frame? (read this first)

A shader is the right way to *generate* a per-pixel effect that a GameObject can't express (a
silhouette glow, a palette swap). It is the **wrong** way to *re-run* one whose inputs don't change
frame to frame. A Phaser `PostFXPipeline` runs a **full-screen fragment pass per attached sprite,
every frame** — attach it to N sprites and you pay N canvas-sized passes forever, even if nothing
moved.

So split the decision in two:

- **Does the effect's output change every frame?** (animated silhouette, screen-space day/night
  grade, time-varying distortion) → a live per-frame pipeline earns its keep.
- **Is the shape a constant** the sprite's texture already determines (a static outline/glow)? →
  **bake it once** into a texture and draw that; animate cheap properties (alpha/scale/tint) with a
  tween. No shader in the frame loop.

The queued-tree glow started as a per-frame PostFX and was **rebaked** for exactly this reason — see
the 2026-07-12 entry in [DECISIONS.md](DECISIONS.md).

## Baking a static effect (the current queued-tree glow)

Reference: [src/render/glowTexture.ts](../src/render/glowTexture.ts) — `bakeGlowTexture` dilates a
sprite's alpha silhouette on the CPU (linear falloff + smoothstep shoulder) into a **cached canvas
texture**, keyed per `(srcKey,color,radius)` so every instance of a species shares one texture and it
survives `GameScene` death-restarts (the global `TextureManager` outlives the scene). The caller
([GameScene.refreshQueueHighlights](../src/scenes/GameScene.ts)) draws it as a plain `Image` behind the
sprite, aligned via `setDisplayOrigin(origin + pad)` + matching scale, and tweens its alpha for the
head-of-queue "breathing" pulse. Works identically on WebGL and Canvas — **no feature-detect fork**.

When baking, remember: **pad the canvas** by the glow radius so the halo isn't clipped at the frame
edge, author the radius in **source texels** (convert from a screen-px target using the sprite's
scale) so it reads consistently across sprites, and keep the bake behind a cache so it runs once, not
per attach.

**Baked effect on an animated host:** the halo is a *separate* GameObject, so if the host sprite
animates (the tree's chop bounce, and planned walk-past sway / fall), the halo must follow. Don't
hand-couple each animation to the glow — that breaks the first time someone adds an animation and
forgets. Instead **mirror the host's transform once per frame** for the handful of active effects
(`GameScene.syncGlowTransforms`: copy `position`/`scale`/`rotation`). Because the glow shares the
host's origin, one mirror reproduces *any* affine animation about the same pivot, and new animations
need no glow-specific code. Corollary: keep game **logic** (targeting, pathfinding, occupancy) keyed
off the tile (`col`/`row`), never the animated sprite transform — a sway or a mid-fall lean is purely
visual and must not move the object's logical position.

## Custom PostFX pipelines (for genuinely per-frame effects)

A PostFX pipeline runs a fragment shader over a sprite *after* it's drawn, into a padded
render-target. Attach it per-object; each attachment is its own instance, so per-object state (a
flag, a phase) can differ between sprites sharing the pipeline.

No live PostFX pipeline ships today — the queued-tree glow that first introduced one was rebaked (see
above). If you add one for a genuinely per-frame effect, this is the pattern (and the retired
`OutlinePipeline` in git history is a worked example):

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
7. **Keep the kernel cheap:** per-pixel loops (ring/box samples for glows, blurs) run over the whole
   FX render-target every frame, per attached sprite — and the target is **canvas-sized**, not
   sprite-sized. Dozens of taps are fine; ~100 measurably slowed the **headless SwiftShader** render
   enough to slow-mo the game loop and flake timing-based tests. If the effect is static, this whole
   cost is avoidable — bake it (see above) rather than shrinking the kernel.

**Testing note:** the headless smoke runs real WebGL, so a shader compile/link error surfaces as a
console error and fails the zero-error gate — a free compile check. Assert shader-driven (or baked)
state through a `debugState()` accessor, not by inspecting GameObjects the render path may not create.

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
