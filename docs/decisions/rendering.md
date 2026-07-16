# Rendering decisions

Ground/tile baking, integer zoom, render-scale, glow bake vs PostFX, seams, and depth/y-sort draw order.

Part of the [decision log index](../DECISIONS.md). Newest first.

---

## 2026-07-16 — [DECIDED] Node + buildable y-sort by base row via shared `rowDepthOffset`; optional `depthBias` for manual same-row node ordering (plan 029)

Resource nodes and buildables now render with base-row y-sorting: an object lower on the map (higher row) draws in front. The sort law is a shared `rowDepthOffset(row, bias)` fraction in `src/systems/mapFormat.ts` — both game and editor call it so draw order agrees. Nodes have an optional `depthBias?: number` field (integer virtual rows) for manual same-row ordering; absent ⇒ 0; omitted-when-zero so legacy maps round-trip byte-identical. Decor keeps its own separate depth band (not interleaved with nodes/buildables) — deliberate. The editor's "Bring forward / Send back" buttons (nudge `depthBias ±1`) and a new "Depth bias" Inspector NumberField now work for node selections (previously decor-only). **Open item:** player (depth 10) and monsters (depth 9) are not y-sorted — player always over trees (known limitation).

## 2026-07-12 — [DECIDED] Bake the ground in bounded vertical chunks to kill the residual dark horizontal lines

The RENDER_SCALE fix below **helped but didn't fully land it** — faint, evenly-spaced *horizontal*
lines still showed on-device (Android/Brave), and crucially they were **world-locked**: pinned to map
rows, only appearing toward the **bottom** of the map, and only after the map was doubled to 1280px
tall. That's a different artifact from the earlier vertical seams.

Evidence (this session): a snapshot of the baked ground `RenderTexture` pulled from the running game
is **uniform top-to-bottom** — per-row green sd 0.44 on a mean of 118.6, and top/mid/bottom thirds are
equally flat (0.443/0.436/0.447), fully opaque, no periodic dips. A *uniform* texture can't grow dark
lines under any sampling/composite artifact, so the lines aren't baked content — they're introduced
when a real mobile GPU **samples the one over-tall (1280px) ground texture**. Root cause: NEAREST
sampling at reduced fragment precision (`mediump`, where the GPU lacks `GL_FRAGMENT_PRECISION_HIGH`;
varying interpolation is hardware-dependent regardless) rounds the texel coordinate to the wrong row,
and the **absolute error grows with the texture's V extent** — so the taller the texture, the further
down (and more often) a row is mis-sampled. Fits every symptom: world-locked, worse toward the bottom,
absent before the doubling (the old 640px map stayed under the error threshold), invisible on
desktop/headless (highp / clean resample) — which is exactly why neither this nor the prior seam
reproduced in CI.

**Confirmed on-device (flip test):** temporarily rendering the single map-tall ground texture with
`setFlipY(true)` moved the lines from the bottom to the **top** of the map — they follow the texture's
V mapping, not screen/framebuffer position. That rules out a screen-space composite artifact and nails
it to texture-coordinate precision, so capping the texture height is the right lever.

**Decided:** split the ground bake into vertically-stacked `RenderTexture` chunks of
`GROUND_CHUNK_ROWS` (32 rows / 512px) each — under the 640px height that was seam-free pre-doubling, so
the per-texel error stays sub-half-texel and no row flips. Chunks are tile-aligned and drawn 1:1, so
their shared edges are just adjacent grass (verified: full 1280-row coverage, no boundary seam, same
uniform luminance as the single bake). Keeps NEAREST — the ground stays crisp pixel art, unlike the
LINEAR-filter alternative (would blur it) — and the single-flush `beginDraw…endDraw` batching per
chunk, so bake cost is unchanged. Lesson: **one big continuous texture beats fractional zoom, but not
an unbounded height** — a NEAREST texture sampled on a mediump mobile GPU degrades toward its far edge;
cap the dimension.

## 2026-07-12 — [DECIDED] Render the backing store at device resolution (RENDER_SCALE) to kill tile seams

The "black lines on the doubled map" (reported on-device, Android/Brave) turned out **not** to be the
ground bake: a snapshot of the baked `RenderTexture` was pixel-perfect (0 gaps, fully opaque), and the
WebGL framebuffer was clean at every integer zoom. The seams were a **display-time** artifact — the
game rendered into a fixed `BASE_WIDTH×BASE_HEIGHT` (360×640) backing store and let the browser stretch
that to the physical screen by a *fractional* factor (~2.5× on the phone). A NEAREST-sampled fractional
upscale drops/doubles whole pixel rows on a beat (~every 3 tiles), reading as thin black lines on the
darker fogged ground. It only surfaced after the map doubling because the camera now scrolls, so the
beat crawls instead of sitting still off-screen. (Doesn't reproduce in headless Chromium — its
compositor resamples cleanly — so this class of bug needs on-device eyes.)

**Decided:** render the backing store at ~device density. New `RENDER_SCALE` (config) = an *integer*
supersample factor derived from `devicePixelRatio` (`ceil`, capped at 3; `?ss=N` overrides for
tuning/tests; 1 in headless/Node so the whole existing test path is unchanged). The game config size
becomes `BASE_* × RENDER_SCALE`, so FIT's final upscale is ~1:1 — no fractional beat, and everything is
sharper. Kept **integer** for the same reason zoom is integer: sprite pixels must stay uniform. The
**design space stays 360×640** — each scene's camera zoom absorbs the factor: `GameScene` camera scale =
`userZoom × RENDER_SCALE` (a new `userZoom` field is the source of truth for the HUD %/persistence, not
`cameras.main.zoom`), and `UIScene` zooms its camera by `RENDER_SCALE` and recentres on the design
midpoint. Raw-pointer math that compares against design-space UI (HUD hit-tests, movepad, the drag
threshold) divides by `RENDER_SCALE`; everything on `pointer.worldX/worldY` is already camera-correct.

Chosen over the two alternatives: **integer-only scaling** (letterbox) would also fix it but wastes
~90px each side on a phone (rejected — mobile-first); **softening grass contrast** is a band-aid that
leaves the root cause. Lesson: a fixed low-res backing store + fractional browser upscale = seams on
mobile GPUs, independent of the bake or camera; render at device density.

## 2026-07-12 — [DECIDED] Map decoupled from viewport, doubled to offset the larger actors

The world was exactly one base-screen (camera bounds = `BASE_WIDTH×BASE_HEIGHT`), so the larger
native-scale character/trees left little room to roam or build. **Decided:** separate the *map* from
the *viewport* — new `MAP_WIDTH`/`MAP_HEIGHT` (config) = 2× the base in each dimension (a 45×80-tile
world); `BASE_*` stays the fixed render/HUD design size. Grid, physics + camera bounds, ground bake,
fog cover, and the player spawn (now the map centre, tile 22,40) key off `MAP_*`; default tree/zombie
spawns re-centred to keep the *starting* scene identical relative to the player, with room beyond. The
camera now scrolls/follows at every zoom (there's no "whole map at zoom 1" any more; MIN_ZOOM stays 1
since zooming further out would need a fractional, blurry scale).

**Perf caveat that bit us:** `drawGround` issued one `RenderTexture.drawFrame()` per tile — each flushes
the GPU. Fine at ~900 tiles; at the doubled map's ~3600 it took **~25s** on the headless software
renderer (scene never "became active", timing out every test). Fixed by batching the whole ground into
one `beginDraw…batchDrawFrame…endDraw` pass → ~160ms. Lesson: bake many-frame RenderTextures with the
batch API, never a per-frame `drawFrame` loop.

## 2026-07-12 — [DECIDED] Actors render at native 1:1; camera zoom is integer-only

Reported: the player sprite looked "slightly stretched / pixels clipping" at 300% zoom. Cause: actors
rendered at `render.scale = 0.5` on a ~30px-tall character, so on-screen texel size was `0.5 × zoom`
— integer (crisp) only at the even default 200%, fractional everywhere else (`0.5 × 3 = 1.5` at 300%
→ some texels 1px, others 2px). The baked ground didn't show it because a single continuous texture
has no frame boundary to expose the unevenness (see the `drawGround` comment), but a small framed
actor does.

**Decided:** author actors at native `render.scale = 1` (draw the source 1:1, size by the art) and
restrict camera zoom to integer steps (`ZOOM_STEP = 1`; `setZoom` rounds *every* path incl. pinch and
the restored preference). Together these keep `render.scale × zoom` a whole number at every zoom stop,
so nearest-neighbour stays crisp. `originY` was retuned per actor (player 0.78, skeleton 0.96) because
doubling the scale would otherwise double the empty-padding gap under the feet.

**Trade-offs accepted:** the character is ~2× larger on screen (native detail, ~2 tiles tall) — chosen
over keeping it small-but-crisp (which would have needed a half-res pre-bake and stayed low-detail);
and zoom is now 3 stops (100/200/300%) instead of 5 — pinch snaps between them. Rule captured in
[RENDERING.md](../RENDERING.md) ("Pixel-art scale must be integer").

## 2026-07-12 — [DECIDED] Queued-tree glow: bake once, don't shade every frame (supersedes the PostFX pipeline)

The plan-006 glow (below) worked but wasn't cheap, for an architectural reason, not a kernel one: a
Phaser `PostFXPipeline` runs a **full-screen fragment pass per attached sprite, every frame** — our
36-tap dilation over a canvas-sized render target, N times per frame for N queued trees, forever. Yet a
tree is a static `Image`: its silhouette never changes, so the halo is a per-species **constant**. We
were recomputing a constant 60×/sec, N times over.

Fix: **bake the halo once into a cached canvas texture** (`src/render/glowTexture.ts`,
`bakeGlowTexture`) and draw it as a plain `Image` behind the tree; the **pulse** is now an alpha
**tween** on that sprite (reusing the tween pattern already in `chop()`), so *no shader runs in the
frame loop at all*. The bake is a one-time CPU dilation of the sprite's alpha (same linear-falloff +
smoothstep shoulder the shader used), cached per `(srcKey,color,radius)` — one texture shared by every
tree of a species, surviving death-restarts with the global `TextureManager`. Per-frame cost drops from
*N full-screen 36-tap passes + N render-target copies* to *N textured quads + one tween*, and it scales
to a big queue without touching frame time.

Bonus: a baked texture isn't WebGL-only, so the **Canvas fallback and its feature-detect fork are
gone** — both renderers now show the identical soft glow (Canvas previously got a plain stroke-rect).
`OutlinePipeline.ts` and its `BootScene` registration were **retired**. The
`debugState().outlinedTreeIds`/`pulsingTreeId` seam is unchanged, so the smoke assertions still hold;
the zero-console-error gate now catches a bake/canvas failure instead of a shader-compile one.

*General lesson (folded into `docs/RENDERING.md`):* a PostFX pipeline is the right tool to **generate**
a per-pixel effect, but the wrong tool to **re-run** one whose inputs are static — bake it. Reach for a
live per-frame shader only when the effect genuinely changes every frame (animated silhouettes,
screen-space grading, time-varying distortion).

## 2026-07-12 — [DECIDED] Queued-tree highlight via a custom WebGL PostFX glow pipeline (plan 006)

Replaced the tile-sized stroked-rectangle marker on queued harvest targets with a **soft silhouette
glow** drawn by a custom WebGL PostFX pipeline (`src/render/OutlinePipeline.ts`, key `OutlineFX`).
Why a shader, not a GameObject: the glow *hugs the sprite's actual shape* (a box can't) and feathers
outward — a per-pixel effect a GameObject can't express — and the pipeline is **reusable by any
Image/Sprite** so enemies/companions can opt in later without new marker plumbing. It samples the
sprite's alpha along a ring of directions at several radii and keeps the strongest distance-weighted
hit (a cheap distance-field falloff to `uRadius = 5` texels; authored in render-target texels so it
scales with the fractional zoom). The **head-of-queue** tree (first alive `harvest` in queue order)
**pulses**; the rest hold a static glow — the pulse *is* the "this one's next" signal. Registered once
in `BootScene` (registry outlives GameScene death-restarts). **Graceful degradation:** WebGL-only, so
`registerOutlinePipeline` no-ops on Canvas and `refreshQueueHighlights` keeps the old stroke-rect
marker for that path. **Started as a crisp 1px outline, softened to a glow on request** — same
pipeline, glow falloff swapped in for the single-ring edge test.

*Perf/testing note:* per-pixel sample count is deliberately modest (12 dirs × 3 radii = 36 taps) —
an early 96-tap version measurably slowed the **headless** SwiftShader render enough to slow-mo the
game loop and starve the smoke's fixed-wall-clock chop step. Two takeaways baked in: keep glow kernels
cheap, and the smoke's chop assertion now **polls** for the wood yield instead of a fixed `waitForTimeout`
(a step toward the less-timing-fragile smoke this log already calls for). Trees are highlighted via the
pipeline now, so the smoke asserts through `debugState().outlinedTreeIds`/`pulsingTreeId` (not the marker
rect); its zero-console-error gate doubles as the shader-compile check. Pattern + a "when to reach for a
shader" heuristic live in `docs/RENDERING.md`.

## 2026-07-12 — [DECIDED] Ground baked into one RenderTexture (fixes fractional-zoom tile seams)

`drawGround()` bakes all ground tiles into a single `RenderTexture` instead of ~900 separate
`add.image` tiles. Symptom it fixes: at fractional camera zoom (notably 150%) thin dark vertical
seams crawled across the grass while scrolling horizontally. Cause: individually-placed frames of a
shared spritesheet **bleed** at non-integer scale — a 16px source tile drawn at 24px samples just
past its atlas cell and picks up a neighbouring (dark) frame. At 100%/200% (integer scale) the
sampling lands cleanly, so it only showed at 150%. Baked side-by-side at integer 1:1, each tile's
neighbour is the real adjacent grass (no cross-frame bleed) and it's one object (no inter-tile gaps);
the camera then nearest-samples one opaque texture. Rationale: robust at any zoom, and collapses ~900
draw objects to one. (Alternative — extruding tile edges — is more work for the same result here.)
