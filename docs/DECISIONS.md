# Decision Log

Newest at the top. Each entry: what we decided, and *why*. Mark open questions clearly so a
future session knows what's still up for grabs.

Format: `YYYY-MM-DD — [DECIDED|PROPOSED|OPEN] Title` then a short rationale.

---

> **Structure:** this file is the **date-ordered index**. Each entry's full text now lives in a topic
> shard under [`decisions/`](decisions/); below, every entry keeps its exact heading (so inbound
> `DECISIONS.md#<slug>` links still resolve) plus a one-line summary and a link to its shard. The
> mutable **Open questions** section stays here at the bottom.

Shards: [rendering](decisions/rendering.md) · [architecture](decisions/architecture.md) · [assets](decisions/assets.md) · [gameplay](decisions/gameplay.md) · [testing](decisions/testing.md) · [project-setup](decisions/project-setup.md)

---

## 2026-07-19 — [DECIDED] Crafting via hybrid stations gate; base claim = the campfire heart (lit area)

Hybrid station tiering (distinct kinds + in-place upgrades) as the recipe gate that climbs with map-unlocks; base claim redefined as the fire's lit area, superseding the fixed base rect.

→ [gameplay.md](decisions/gameplay.md#2026-07-19--decided-crafting-via-hybrid-stations-gate-base-claim--the-campfire-heart-lit-area)

## 2026-07-19 — [DECIDED] Core-loop framing: three-horizon progression, hard-countdown-no-fallback dusk, progress-keyed escalation, pacing targets

Nested progression (siege/growth/escape), no-fallback dusk + legibility/range costs, progress-keyed escalation, pacing targets; trap/wave/companion shapes captured as intent.

→ [gameplay.md](decisions/gameplay.md#2026-07-19--decided-core-loop-framing-three-horizon-progression-hard-countdown-no-fallback-dusk-progress-keyed-escalation-pacing-targets)

## 2026-07-16 — [DECIDED] Node + buildable y-sort by base row via shared `rowDepthOffset`; optional `depthBias` for manual same-row node ordering (plan 029)

Base-row y-sort for nodes/buildables via a shared `rowDepthOffset`; optional per-node `depthBias`.

→ [rendering.md](decisions/rendering.md#2026-07-16--decided-node--buildable-y-sort-by-base-row-via-shared-rowdepthoffset-optional-depthbias-for-manual-same-row-node-ordering-plan-029)

## 2026-07-16 — [DECIDED] Per-region roles on mixed tile/object sheets, not physically splitting the sheet (plan 028)

Mixed tile/object sheets carry per-region object roles rather than physically splitting the PNG.

→ [assets.md](decisions/assets.md#2026-07-16--decided-per-region-roles-on-mixed-tileobject-sheets-not-physically-splitting-the-sheet-plan-028)

## 2026-07-16 — [DECIDED] CraftPix ingest: 4 theme packs, no-shadow variants, directional sheets sliced

CraftPix ingest: consolidate into 4 theme packs, prefer no-shadow variants, slice directional sheets at ingest.

→ [assets.md](decisions/assets.md#2026-07-16--decided-craftpix-ingest-4-theme-packs-no-shadow-variants-directional-sheets-sliced)

## 2026-07-15 — [DECIDED] Map Builder editor + map/world file format (plan 014)

React-chrome-over-Phaser dev editor; custom JSON map/world format via one `parseMap` choke point.

→ [architecture.md](decisions/architecture.md#2026-07-15--decided-map-builder-editor--mapworld-file-format-plan-014)

## 2026-07-14 — [DECIDED] Editor styling → Tailwind v4 + shadcn/ui (dev-only)

Dev-only Map Builder migrated to Tailwind v4 + shadcn/ui with one palette source of truth; zero prod impact.

→ [project-setup.md](decisions/project-setup.md#2026-07-14--decided-editor-styling--tailwind-v4--shadcnui-dev-only)

## 2026-07-14 — [DECIDED] Campfire fixes (plan 016): refuel is a worker order, flame scales (not sheet-swaps), outline is a rect

Post-playtest campfire calls: refuel as a worker order, flame scales one sprite, queued outline is a rect.

→ [gameplay.md](decisions/gameplay.md#2026-07-14--decided-campfire-fixes-plan-016-refuel-is-a-worker-order-flame-scales-not-sheet-swaps-outline-is-a-rect)

## 2026-07-13 — [DECIDED] Buildable runtime stays bespoke for now; generalise on buildable #2

Keep the campfire buildable bespoke; generalise into a `StructureManager` only when buildable #2 lands.

→ [architecture.md](decisions/architecture.md#2026-07-13--decided-buildable-runtime-stays-bespoke-for-now-generalise-on-buildable-2)

## 2026-07-13 — [DECIDED] Buildable campfire + generalised build/palette (plan 012): four boundary calls

First buildable campfire + build palette; fixed base-zone rect, own `CampfireManager`, enemy fog-gating deferred.

→ [gameplay.md](decisions/gameplay.md#2026-07-13--decided-buildable-campfire--generalised-buildpalette-plan-012-four-boundary-calls)

## 2026-07-13 — [DECIDED] GameScene decomposition part 2: 5 world-subsystem boundary rulings (plan 015)

Plan 015 pulls the remaining world subsystems out of GameScene; five boundary rulings.

→ [architecture.md](decisions/architecture.md#2026-07-13--decided-gamescene-decomposition-part-2-5-world-subsystem-boundary-rulings-plan-015)

## 2026-07-13 — [DECIDED] GameScene decomposed into an entities layer + scene managers (plan 013); behaviour classes yes, data hierarchy no

Plan 013 splits GameScene into an entities layer + scene managers; behaviour classes yes, data hierarchy no.

→ [architecture.md](decisions/architecture.md#2026-07-13--decided-gamescene-decomposed-into-an-entities-layer--scene-managers-plan-013-behaviour-classes-yes-data-hierarchy-no)

## 2026-07-12 — [DECIDED] Generic monster AI (pure FSM) + weapons via runtime anchor-pinning — supersedes plan 010's stamp tool for rigid slots (plan 011)

Data-driven monster FSM (radius aggro) + weapons via runtime anchor-pinning; supersedes plan 010's stamp tool.

→ [gameplay.md](decisions/gameplay.md#2026-07-12--decided-generic-monster-ai-pure-fsm--weapons-via-runtime-anchor-pinning--supersedes-plan-010s-stamp-tool-for-rigid-slots-plan-011)

## 2026-07-12 — [DECIDED] Theme is dark-fantasy, not zombie apocalypse (story pivot, follows the art)

Story pivots from zombie apocalypse to dark-fantasy to match the art; docs/copy only, code ids unchanged.

→ [assets.md](decisions/assets.md#2026-07-12--decided-theme-is-dark-fantasy-not-zombie-apocalypse-story-pivot-follows-the-art)

## 2026-07-12 — [DECIDED] Bake the ground in bounded vertical chunks to kill the residual dark horizontal lines

Split the ground bake into height-capped RenderTexture chunks to kill mediump-GPU horizontal lines.

→ [rendering.md](decisions/rendering.md#2026-07-12--decided-bake-the-ground-in-bounded-vertical-chunks-to-kill-the-residual-dark-horizontal-lines)

## 2026-07-12 — [DECIDED] Day/night + hunger survival slice (plan 004): real-time cycle, hunger→health cascade, inventory reuse defers "Equipped"

Real-time day/night clock + hunger→health cascade reusing combat HP; survival state not persisted.

→ [gameplay.md](decisions/gameplay.md#2026-07-12--decided-daynight--hunger-survival-slice-plan-004-real-time-cycle-hungerhealth-cascade-inventory-reuse-defers-equipped)

## 2026-07-12 — [DECIDED] Render the backing store at device resolution (RENDER_SCALE) to kill tile seams

Supersample the backing store by an integer `RENDER_SCALE` from DPR to kill fractional-upscale seams.

→ [rendering.md](decisions/rendering.md#2026-07-12--decided-render-the-backing-store-at-device-resolution-render_scale-to-kill-tile-seams)

## 2026-07-12 — [DECIDED] Map decoupled from viewport, doubled to offset the larger actors

Separate map size from viewport (2x map); batch the whole ground bake in one pass to fix perf.

→ [rendering.md](decisions/rendering.md#2026-07-12--decided-map-decoupled-from-viewport-doubled-to-offset-the-larger-actors)

## 2026-07-12 — [DECIDED] Data-driven hurtbox (footprint ≠ hurtbox); world props sized to the actor

Separate footprint (occupancy) from a data-driven hurtbox (combat targeting) on `CombatantStats`.

→ [gameplay.md](decisions/gameplay.md#2026-07-12--decided-data-driven-hurtbox-footprint--hurtbox-world-props-sized-to-the-actor)

## 2026-07-12 — [DECIDED] Actors render at native 1:1; camera zoom is integer-only

Author actors at native scale and restrict camera zoom to integer steps so nearest-neighbour stays crisp.

→ [rendering.md](decisions/rendering.md#2026-07-12--decided-actors-render-at-native-11-camera-zoom-is-integer-only)

## 2026-07-12 — [DECIDED] Menus stay in Phaser (canvas), built on a Container-based UI kit — no DOM overlay

Keep all menus in Phaser (no DOM overlay), built on a small Container-based UI kit. (Closest fit: UI structure.)

→ [architecture.md](decisions/architecture.md#2026-07-12--decided-menus-stay-in-phaser-canvas-built-on-a-container-based-ui-kit--no-dom-overlay)

## 2026-07-12 — [DECIDED] Queued-tree glow: bake once, don't shade every frame (supersedes the PostFX pipeline)

Bake the queued-tree halo once into a cached texture + alpha tween; retires the per-frame PostFX pipeline.

→ [rendering.md](decisions/rendering.md#2026-07-12--decided-queued-tree-glow-bake-once-dont-shade-every-frame-supersedes-the-postfx-pipeline)

## 2026-07-12 — [DECIDED] Queued-tree highlight via a custom WebGL PostFX glow pipeline (plan 006)

Queued-harvest glow via a custom WebGL PostFX outline pipeline (later superseded by the bake).

→ [rendering.md](decisions/rendering.md#2026-07-12--decided-queued-tree-highlight-via-a-custom-webgl-postfx-glow-pipeline-plan-006)

## 2026-07-12 — [DECIDED] Toward isolated test setups, not one live-game end-to-end smoke

Direction: prefer isolated deterministic scenarios over one live-game end-to-end smoke.

→ [testing.md](decisions/testing.md#2026-07-12--decided-toward-isolated-test-setups-not-one-live-game-end-to-end-smoke)

## 2026-07-12 — [DECIDED] Three-tier deterministic test harness (plan 007), retiring the live-game smoke

Three tiers: Vitest units, deterministic Playwright scenarios via a DEV-only scenario API, a boot canary.

→ [testing.md](decisions/testing.md#2026-07-12--decided-three-tier-deterministic-test-harness-plan-007-retiring-the-live-game-smoke)

## 2026-07-12 — [DECIDED] Workers chop/build from a resource's base tile, facing the target

Workers harvest/build from a resource's base stand tile, turning to face the target.

→ [gameplay.md](decisions/gameplay.md#2026-07-12--decided-workers-chopbuild-from-a-resources-base-tile-facing-the-target)

## 2026-07-12 — [DECIDED] Player action swings: chop = Slice, punch = Crush (reskinnable stand-ins)

Player chop=Slice, punch=Crush as reskinnable stand-in action animations; enemy still contact-damage only.

→ [gameplay.md](decisions/gameplay.md#2026-07-12--decided-player-action-swings-chop--slice-punch--crush-reskinnable-stand-ins)

## 2026-07-12 — [DECIDED] Ground baked into one RenderTexture (fixes fractional-zoom tile seams)

Bake all ground tiles into one RenderTexture to fix cross-frame bleed seams at fractional zoom.

→ [rendering.md](decisions/rendering.md#2026-07-12--decided-ground-baked-into-one-rendertexture-fixes-fractional-zoom-tile-seams)

## 2026-07-12 — [DECIDED] Swap active art to Pixel Crawler; zombie pack retired (plan 005)

Commit the art swap to Pixel Crawler; role-based manifest, 3-way player facing, zombie pack retired.

→ [assets.md](decisions/assets.md#2026-07-12--decided-swap-active-art-to-pixel-crawler-zombie-pack-retired-plan-005)

## 2026-07-11 — [RESOLVED] Want a map editor; Pixel Crawler autotiler + demo polish gaps

Steer toward building a map editor (resolved by plan 014); autotiler/demo polish gaps left open. (Mixed-topic.)

→ [architecture.md](decisions/architecture.md#2026-07-11--resolved-want-a-map-editor-pixel-crawler-autotiler--demo-polish-gaps)

## 2026-07-11 — [PROPOSED] Adopt Pixel Crawler as the base art (re-theme to fantasy), darken later

Proposed adopting Pixel Crawler as base art (fantasy re-theme, darken later); evaluation only at the time.

→ [assets.md](decisions/assets.md#2026-07-11--proposed-adopt-pixel-crawler-as-the-base-art-re-theme-to-fantasy-darken-later)

## 2026-07-11 — [DECIDED] Shared stats via typed adapters, not a class hierarchy

Produce inspectable stats via small pure adapter functions, not a shared class hierarchy.

→ [architecture.md](decisions/architecture.md#2026-07-11--decided-shared-stats-via-typed-adapters-not-a-class-hierarchy)

## 2026-07-11 — [DECIDED] Object inspection scope: trees + walls only, no new placeholder entity

Inspect mode covers trees/walls/enemies/player only; no placeholder entity added just to be inspectable.

→ [gameplay.md](decisions/gameplay.md#2026-07-11--decided-object-inspection-scope-trees--walls-only-no-new-placeholder-entity)

## 2026-07-11 — [DECIDED] Tap-on-entity resolution: a dedicated Inspect mode, not tap/long-press overload

Viewing stats is a dedicated Inspect mode, not an overload of Command-mode tap/long-press.

→ [gameplay.md](decisions/gameplay.md#2026-07-11--decided-tap-on-entity-resolution-a-dedicated-inspect-mode-not-taplong-press-overload)

## 2026-07-11 — [DECIDED] Three mutually-exclusive input modes: Command / Combat / Inspect

One HUD toggle switches between mutually-exclusive Command / Combat / Inspect input modes.

→ [gameplay.md](decisions/gameplay.md#2026-07-11--decided-three-mutually-exclusive-input-modes-command--combat--inspect)

## 2026-07-11 — [DECIDED] Direct tweaks auto-push on green; review gates stay on the plan loop only

Small direct requests auto-commit+push on green; review gates apply only to the plan loop.

→ [project-setup.md](decisions/project-setup.md#2026-07-11--decided-direct-tweaks-auto-push-on-green-review-gates-stay-on-the-plan-loop-only)

## 2026-07-11 — [DECIDED] Stop for Matt's review at plan / critique / each step (no unattended sweep)

The plan→critique→execute loop pauses for review at plan, critique, and every executed step.

→ [project-setup.md](decisions/project-setup.md#2026-07-11--decided-stop-for-matts-review-at-plan--critique--each-step-no-unattended-sweep)

## 2026-07-11 — [DECIDED] Genre & platform: browser pixel-art survival base-builder

Genre/platform: single-player browser pixel-art survival base-builder, no server, themed on Mostowo.

→ [project-setup.md](decisions/project-setup.md#2026-07-11--decided-genre--platform-browser-pixel-art-survival-base-builder)

## 2026-07-11 — [DECIDED] Engine: Phaser 3

Engine choice: Phaser 3 for mature 2D + pixel-art support and a scene system.

→ [project-setup.md](decisions/project-setup.md#2026-07-11--decided-engine-phaser-3)

## 2026-07-11 — [DECIDED] Build workflow: Hermes plan → critique → execute skills

Use the Hermes plan→critique→execute dev skills for every non-trivial feature.

→ [project-setup.md](decisions/project-setup.md#2026-07-11--decided-build-workflow-hermes-plan--critique--execute-skills)

## 2026-07-11 — [DECIDED] Record-everything-in-repo rule

Record every reusable decision/preference/workflow in the repo, never only in chat.

→ [project-setup.md](decisions/project-setup.md#2026-07-11--decided-record-everything-in-repo-rule)

## 2026-07-11 — [DECIDED] Trunk-based solo workflow: commit each stage, push to `master`, auto-deploy

Trunk-based solo workflow: commit each stage, push to `master`, auto-deploy — no branches/PRs.

→ [project-setup.md](decisions/project-setup.md#2026-07-11--decided-trunk-based-solo-workflow-commit-each-stage-push-to-master-auto-deploy)

## 2026-07-11 — [DECIDED] Language: TypeScript; Build tool: Vite

Language TypeScript, build tool Vite — types + instant HMR + trivial static build.

→ [project-setup.md](decisions/project-setup.md#2026-07-11--decided-language-typescript-build-tool-vite)

## 2026-07-11 — [DECIDED] Hosting: GitHub Pages via GitHub Actions

Host on GitHub Pages via a GitHub Actions build; deploy config lives in-repo.

→ [project-setup.md](decisions/project-setup.md#2026-07-11--decided-hosting-github-pages-via-github-actions)

## 2026-07-11 — [DECIDED] Art pipeline: programmatic placeholders first

Start with programmatic placeholder art to build mechanics fast, swap in real pixel art later.

→ [assets.md](decisions/assets.md#2026-07-11--decided-art-pipeline-programmatic-placeholders-first)

## 2026-07-11 — [DECIDED] Premise & core loop: zombie apocalypse at Mostowo, day/night cycle

Premise + core loop: zombie-apocalypse-at-Mostowo day/night risk/reward with four pillars. (Later re-themed.)

→ [gameplay.md](decisions/gameplay.md#2026-07-11--decided-premise--core-loop-zombie-apocalypse-at-mostowo-daynight-cycle)

## 2026-07-11 — [DECIDED] Mobile-first, portrait, touch — scales to larger screens

Mobile-first portrait touch target via Phaser Scale.FIT from a fixed base; scales to larger screens.

→ [project-setup.md](decisions/project-setup.md#2026-07-11--decided-mobile-first-portrait-touch--scales-to-larger-screens)

## 2026-07-11 — [DECIDED] Multi-map world: bolt-on areas + fast-travel special maps

Many discrete maps with a data-driven registry, connections, and unlock gates — not one continuous map.

→ [architecture.md](decisions/architecture.md#2026-07-11--decided-multi-map-world-bolt-on-areas--fast-travel-special-maps)

## 2026-07-11 — [DECIDED] Map is based on the real Mostowo site

The playable map traces the real Mostowo site; its people/stories theme the content. (Closest fit: map/world.)

→ [architecture.md](decisions/architecture.md#2026-07-11--decided-map-is-based-on-the-real-mostowo-site)

## 2026-07-11 — [DECIDED] Art identity: dark & grotty, but humorous

Art identity: a grimy survival-horror palette with comic items/enemies — dark but humorous.

→ [assets.md](decisions/assets.md#2026-07-11--decided-art-identity-dark--grotty-but-humorous)

## 2026-07-11 — [DECIDED] Asset pipeline: free CC0 tilesets + Gemini "Nano Banana" (via guppi)

Asset pipeline: CC0 tilesets first, then bespoke on-theme sprites via Gemini run from a guppi-reachable box.

→ [assets.md](decisions/assets.md#2026-07-11--decided-asset-pipeline-free-cc0-tilesets--gemini-nano-banana-via-guppi)

---

## Open questions

- **[OPEN] Skill loading across devices:** install the `hermes-dev` plugin via the `hermes-skills`
  marketplace vs vendoring skills into `.claude/skills/`. (Tracked in WORKFLOW.md.)
- **[OPEN] MVP vertical slice details:** exact mechanics/scope for the first playable — to be nailed
  down by a `plan-feature` plan. Draft slice is in GAME-DESIGN.md.
- **[DONE] Testing rework — shipped (plan 007):** the fragile live-game smoke is retired for a
  three-tier harness (Vitest unit tests + deterministic Playwright scenarios driven by a DEV-only
  `window.game.__test` scenario/fixed-step API + a thin boot canary). Harness shape settled on the
  debug scenario API. See the 2026-07-12 "Three-tier deterministic test harness" decision above and
  WORKFLOW.md for the day-to-day two-speed loop.
