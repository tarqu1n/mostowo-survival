# Queued-Tree Outline Shader (Custom PostFX Pipeline)

> Status: done — executed 2026-07-12. All steps landed; `npm run typecheck` + `npm run smoke` pass,
> verified by eye at 200% zoom (head-of-queue pulses). Follow-up: the crisp 1px outline was softened
> to a **soft glow** on request (same pipeline, distance-field falloff; see docs/DECISIONS.md).

## Summary
Replace the tile-sized stroked-rectangle marker used to flag queued harvest targets with a
**custom Phaser WebGL PostFX pipeline** that draws a crisp pixel outline hugging the tree
sprite's silhouette. The **next-up** queued tree (head of the queue) gets a **subtly pulsing**
outline; all other queued trees get a **static** outline. Both use `COLORS.queued` (`0xffd500`).
The pipeline is written to be **reusable by any sprite** (so enemies / future companions can opt
in), guarded so it **degrades gracefully to the existing rect marker under the Canvas fallback**,
and the decision is recorded plus a standing "when to reach for a shader" heuristic doc.

## Context & decisions

**Design choices (settled with the user):**
- **Scope:** trees only for now, but the pipeline is generic — any `Image`/`Sprite` can attach it.
  Build sites (Rectangles — already stroke crisply) and move pips (no silhouette) are **unchanged**.
- **Style:** the head-of-queue tree (the one about to be worked) **pulses**; other queued trees are
  **static**. The pulse *is* the "this is next" signal. Colour = `COLORS.queued`.
- **Docs:** log the decision in `docs/DECISIONS.md` **and** add a reusable rendering/pipeline
  reference (`docs/RENDERING.md`) capturing the pattern + a heuristic for spotting future
  shader-worthy effects, linked from the `CLAUDE.md` docs index.

**Key facts from repo research (anchors to mirror / respect):**
- **Trees** are plain `Phaser.GameObjects.Image` at **depth 1**, created in `addTree()`
  ([GameScene.ts:810-819](src/scenes/GameScene.ts#L810-L819)); `TreeNode` interface at
  [GameScene.ts:62-71](src/scenes/GameScene.ts#L62-L71) (`{ id, sprite, def, hp, alive, col, row }`);
  `treeById()` linear find at [GameScene.ts:850-851](src/scenes/GameScene.ts#L850-L851). Tree texture is
  a **standalone PNG** (`_derived/tree_pine.png`, not an atlas frame) so it avoids the fractional-zoom
  atlas-bleed, but the nearest-neighbour/`pixelArt` regime still applies.
- **`refreshQueueHighlights()`** at [GameScene.ts:536-563](src/scenes/GameScene.ts#L536-L563) is the
  method to rewire; `queueMarkers` field at [GameScene.ts:158](src/scenes/GameScene.ts#L158), reset at
  [GameScene.ts:194](src/scenes/GameScene.ts#L194). Called **only** from `emitTasks()`
  ([GameScene.ts:530-533](src/scenes/GameScene.ts#L530-L533), itself called from
  `completeCurrent`/`order`/`enqueue`/`cancelAll`). The harvest branch currently creates the stroked
  rect ([GameScene.ts:547-552](src/scenes/GameScene.ts#L547-L552)).
- **Queue order:** `TaskQueue.all()` returns `[current, ...pending]`
  ([tasks.ts:70-72](src/systems/tasks.ts#L70-L72)); `Action` union `move|harvest{treeId}|build`
  ([tasks.ts:7-10](src/systems/tasks.ts#L7-L10)). "Head of queue" = **first `harvest` action in
  `all()` order whose tree is `alive`**.
- **Tint vs outline never coexist:** felled trees are tinted (`stumpColor`) and set `alive=false`
  ([GameScene.ts:872](src/scenes/GameScene.ts#L872)); highlights only apply to `alive` trees.
- **Renderer:** `type: Phaser.AUTO` + `pixelArt: true` ([main.ts:14-17](src/main.ts#L14-L17)) — **no
  existing pipeline/postFX anywhere in `src`**; this is the first. Register via
  `game.renderer.pipelines.addPostPipeline(key, Class)`, attach via
  `sprite.setPostPipeline(key)` / `sprite.removePostPipeline(key)` — **WebGL-only**; feature-detect
  `game.renderer.type === Phaser.WEBGL`.
- **`BootScene.create()`** ([BootScene.ts:12-16](src/scenes/BootScene.ts#L12-L16)) is the documented
  one-time-setup hook and runs once before assets — the right place to register the global pipeline
  (registry persists across `GameScene` restarts, so a `has(key)` guard covers the player-death restart).
- **Smoke test risk:** `scripts/smoke.mjs` runs the real game in **headless Chromium (WebGL) via
  Playwright**, so the shader actually compiles there. Two hard constraints: **(a)** it asserts on the
  current marker at `scripts/smoke.mjs:190-194` (`queueMarkers.some(m => m.isStroked && m.strokeColor
  === 0xffd500)`) — replacing the rect breaks this; **(b)** it fails on **any** console error at
  `scripts/smoke.mjs:409`, so a shader **compile/link error would fail the smoke** (this is a useful
  gate). The smoke reaches internals via `window.game` + `debugState()`/`dbg()`.
- **Crispness constraint** ([DECISIONS.md:221-231](docs/DECISIONS.md#L221)): author outline thickness
  in **source-texel terms** and keep nearest-consistent so it doesn't reintroduce sub-pixel shimmer at
  150% zoom (`DEFAULT_ZOOM=2`, range 1–3). Verify by eye at 100 % / 150 % / 200 %.
- **Tooling:** `tsconfig` `strict` + `noUnusedLocals/Parameters`; no ESLint. `npm run typecheck` =
  `tsc --noEmit`. Phaser types ship with the package (subclass
  `Phaser.Renderer.WebGL.Pipelines.PostFXPipeline`). Plans live in `plans/` (this repo), numbered.

## Steps

- [x] **Step 1: Create the reusable outline PostFX pipeline** `[delegate sonnet]`
  - New file `src/render/OutlinePipeline.ts` (create `src/render/`). Export:
    - `OUTLINE_PIPELINE_KEY = 'OutlineFX'` (string const).
    - `class OutlinePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline` with an inline
      GLSL `fragShader`. Public instance field `pulse = false` (per-attachment flag; each
      `setPostPipeline` creates its own instance, so this is per-tree).
    - `registerOutlinePipeline(game: Phaser.Game): void` helper — no-op unless
      `game.renderer.type === Phaser.WEBGL`; then, guarded by
      `!(game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).pipelines.has(OUTLINE_PIPELINE_KEY)`,
      call `.addPostPipeline(OUTLINE_PIPELINE_KEY, OutlinePipeline)`.
  - Fragment shader (silhouette-edge detection; starting point — tune thickness in Step 6):
    ```glsl
    precision mediump float;
    uniform sampler2D uMainSampler;
    uniform vec2  uTexSize;        // render-target size in px
    uniform vec3  uOutlineColor;   // normalized rgb
    uniform float uThickness;      // in render-target texels (~1–2)
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
      float edge = clamp(n - tex.a, 0.0, 1.0);          // outline only where sprite is transparent
      float breathe = 0.6 + 0.4 * (0.5 + 0.5 * sin(uTime * 5.0));
      float strength = mix(1.0, breathe, uPulse);
      vec4 outline = vec4(uOutlineColor, 1.0) * edge * strength;
      gl_FragColor = tex + outline * (1.0 - tex.a);
    }
    ```
  - Set uniforms by overriding `onDraw(renderTarget)`: compute `uTexSize` from
    `renderTarget.width/height`, push `uOutlineColor` (derive from `COLORS.queued` in `config.ts` →
    normalized rgb; hardcode-derive is fine — add a tiny `hexToRgb01()` local or inline the three
    components with a comment tying them to `0xffd500`), `uThickness` (start `1.5`), `uPulse`
    (`this.pulse ? 1 : 0`), `uTime` (`this.game.loop.time / 1000` — do **not** use `Date.now()`),
    then `this.bindAndDraw(renderTarget)`.
  - Side effects: none yet (not wired). First pipeline in the codebase — keep it self-contained.
  - Docs: none in this step.
  - Done when: `npm run typecheck` passes; `OutlinePipeline` + `registerOutlinePipeline` +
    `OUTLINE_PIPELINE_KEY` are exported and compile under `strict`.

- [x] **Step 2: Register the pipeline once at boot (WebGL-guarded)** `[delegate sonnet]`
  - In `BootScene.create()` ([BootScene.ts:12-16](src/scenes/BootScene.ts#L12-L16)), call
    `registerOutlinePipeline(this.game)` **before** `this.scene.start('Preload')`. Add the import.
  - The helper already no-ops on Canvas and guards double-registration, so this is safe across the
    player-death `GameScene` restart (Boot itself does not re-run; the registry persists).
  - Side effects: `BootScene` gains one import + one call; no behaviour change on Canvas.
  - Docs: none.
  - Done when: `npm run typecheck` passes; app boots (`npm run dev`) with no console error; in the
    browser console `window.game.renderer.pipelines.has('OutlineFX')` is `true` on WebGL.

- [x] **Step 3: Rewire `refreshQueueHighlights()` to attach/detach the outline** `[inline]`
  - In [GameScene.ts:536-563](src/scenes/GameScene.ts#L536-L563), replace the **harvest** branch so
    that instead of pushing a stroked rect it attaches the pipeline to the tree sprite:
    - Add a field `private outlinedTreeIds = new Set<string>()` (near `queueMarkers`,
      [GameScene.ts:158](src/scenes/GameScene.ts#L158); reset it in the same place `queueMarkers` is
      reset, [GameScene.ts:194](src/scenes/GameScene.ts#L194)).
    - Add a private const at top of the method: `const webgl = this.game.renderer.type ===
      Phaser.WEBGL;`
    - **Cleanup at method start:** for every `id` in `outlinedTreeIds`, look up the tree and
      `tree.sprite.removePostPipeline(OUTLINE_PIPELINE_KEY)` (guard: tree may be null); then
      `outlinedTreeIds.clear()`. (Mirrors the existing "destroy all markers each refresh" pattern.)
    - Determine the **head harvest tree**: the first action in `this.queue.all()` with
      `kind === 'harvest'` whose `treeById(a.treeId)?.alive` — remember its `treeId` as `headId`.
    - In the harvest branch, for each queued **alive** tree:
      - If `webgl`: `tree.sprite.setPostPipeline(OUTLINE_PIPELINE_KEY)`, then fetch the instance via
        `tree.sprite.getPostPipeline(OUTLINE_PIPELINE_KEY)` (may return an instance or array — take the
        `OutlinePipeline` instance, cast via `as OutlinePipeline`), set `.pulse = (tree.id === headId)`,
        and `outlinedTreeIds.add(tree.id)`.
      - **Else (Canvas fallback):** keep the **existing stroked-rect marker** code path unchanged so
        highlights still render (and the fallback stays test-covered).
  - Leave the `build` and `move` branches exactly as they are.
  - Side effects: trees are never destroyed (felled = tint, regrow), so add/remove pipeline is always
    on a live sprite — safe. The outline now lives at the tree's depth (1) rather than the old marker
    depth (4); that's intended (it's part of the tree). Confirm the outline isn't visually clipped by
    the FX render-target bounds (Phaser pads FX targets — verify in Step 6). `emitTasks()` already
    re-runs this on every queue change, so pulse/head correctly re-evaluates as the queue advances.
  - Docs: none in this step (covered in Step 5).
  - Done when: `npm run typecheck` passes; queueing a tree in-browser shows a silhouette outline (not a
    box), the head-of-queue tree pulses, others are static, and dequeuing/cancelling removes it cleanly;
    switching modes / felling a queued tree leaves no orphaned outline.

- [x] **Step 4: Update the headless smoke test for the new highlight** `[delegate sonnet]` (parallel: A)
  - `scripts/smoke.mjs` asserts the old marker at `:190-194` and gates on zero console errors at
    `:409`. Update the highlight assertion to verify the **pipeline path** instead of the stroked rect.
  - Preferred (least brittle): add a tiny debug accessor to `GameScene` — extend the existing
    `debugState()`/`dbg()` (search `debugState` in [GameScene.ts](src/scenes/GameScene.ts)) to include
    `outlinedTreeIds: [...this.outlinedTreeIds]` and `pulsingTreeId` (the current head id, or null).
    Then in `smoke.mjs` assert, after ordering a harvest, that `dbg().outlinedTreeIds.length >= 1` and
    `pulsingTreeId` is non-null. (If touching `GameScene` here conflicts with Step 3's edits, fold this
    accessor into Step 3 and keep Step 4 to `smoke.mjs` only — note this is why Step 4 depends on Step 3.)
  - Keep/verify the zero-console-error gate at `:409` — it now doubles as the **shader-compile check**.
  - Side effects: `smoke.mjs` only (plus possibly the shared `debugState` accessor — coordinate with
    Step 3). Do not weaken unrelated queue/pending assertions that use `dbg()`.
  - Docs: none.
  - Done when: `npm run smoke` passes end-to-end (implies the shader compiled with no console errors and
    the outline is applied to a queued tree).

- [x] **Step 5: Document the decision + reusable shader heuristic** `[delegate sonnet]` (parallel: A)
  - `docs/DECISIONS.md`: add a dated entry (2026-07-12) — "Queued-tree highlight via custom PostFX
    outline pipeline". Record: what changed (rect marker → silhouette outline), why (crisp, hugs the
    sprite, reusable), the **AUTO/Canvas graceful-degradation** guard, the **pulse = head-of-queue**
    convention, and the smoke-test coupling. Terse, high-signal.
  - New `docs/RENDERING.md` (concise): (1) how the custom PostFX pipeline is structured and registered
    (`src/render/OutlinePipeline.ts`, boot registration, WebGL feature-detect, per-instance `pulse`);
    (2) a **"when to reach for a shader" heuristic** — a short bullet list of the kinds of effects that
    are better as a pipeline than as GameObjects (silhouette outlines/glows, per-pixel tint/masking,
    palette swaps, dissolves/damage flashes, day/night colour grading, screen-space post effects) vs.
    when a plain GameObject/tween is simpler (solid fills, rect strokes, simple alpha/scale tweens).
    Keep it a lean index future sessions can extend.
  - `CLAUDE.md`: add `docs/RENDERING.md` to the **Docs** index list (one line). Optionally refresh the
    "Post-005 polish" status note to mention the queued-tree outline shader (one clause).
  - Side effects: docs + `CLAUDE.md` only — write-disjoint from `smoke.mjs`, so this runs parallel with
    Step 4. Both depend on Step 3 being complete.
  - Docs: this *is* the docs step.
  - Done when: `docs/RENDERING.md` exists and is linked from `CLAUDE.md`; `DECISIONS.md` has the entry.

- [x] **Step 6: Tune crispness + verify across zoom, then final smoke** `[inline]`
  - Run `npm run dev`, queue several trees. Tune `uThickness` (and, if needed, switch the shader
    between 4-way and 8-way sampling) so the outline reads as a **crisp ~1–2 source-px border** with no
    sub-pixel shimmer at **100 % / 150 % / 200 %** zoom (`DEFAULT_ZOOM=2`; step through with the zoom
    buttons). Confirm the pulse is *subtle*, not distracting, and that the outline isn't clipped at the
    sprite's edges (increase FX padding via `this.setBoundsPadding()` in the pipeline if it is).
  - Re-run `npm run typecheck` and `npm run smoke` as the final gate.
  - Side effects: may adjust constants in `src/render/OutlinePipeline.ts` only.
  - Docs: if the final thickness/sampling differs materially from the sketch, note the chosen values in
    the `DECISIONS.md` entry from Step 5.
  - Done when: outline is crisp at all three zoom levels, pulse is tasteful, `npm run typecheck` and
    `npm run smoke` both pass.

## Out of scope
- Outlining **build sites** (already crisp rect strokes) or **move pips** (no silhouette).
- Applying the pipeline to **enemies / player / companions** — the pipeline is *built* reusable, but
  wiring other sprites is a separate follow-up.
- Any change to queue mechanics, colours other than `COLORS.queued`, marching-ants/animated-dash
  styles, or a per-target colour scheme.
- Forcing `type: Phaser.WEBGL` (dropping the Canvas fallback) — we degrade gracefully instead.
- A stump/felled-tree outline (felled trees are tinted and un-queued; no outline needed).
