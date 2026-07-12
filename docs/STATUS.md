# Status — what's built so far

The feature/plan history for Mostowo Survival, newest work at the bottom of each block. The root
[CLAUDE.md](../CLAUDE.md) carries the one-line summary + architecture map; this is the detail behind
it. The *why* behind each choice lives in [DECISIONS.md](DECISIONS.md).

## Core loop + worker task system (plans 001–002)

Tap a tree → the worker **pathfinds** to it (A*, routing around walls + trees) → multi-hit chop →
wood into a character `Inventory`. Orders **queue** (tap = act now / clear; **long-press = append**);
**Build** places a passable *blueprint* and the worker walks over and **builds it over time** into a
solid, blocking wall. **Cancel** clears the queue (blueprints survive). Data-driven items/nodes/buildables
(`src/data/`), pure systems (`src/systems/`: `pathfind`, `tasks`, `grid`, `Inventory`), decoupled
`UIScene` HUD. On the **Phaser 3 + TypeScript + Vite** mobile-first scaffold (Boot→Preload→MainMenu→Game
+ UI overlay), GitHub Pages auto-deploy. Verified via headless smoke (`npm run smoke`).

## Basic combat + first enemy (plan 003)

A shared `BaseStats`/`CombatantStats`/`ObjectStats` schema (`src/data/types.ts`) + pure
`systems/combat.ts` resolve melee damage/hit-chance uniformly for Punch and enemy attacks. Three
mutually-exclusive HUD-toggled input modes — **Command** (tap-to-pathfind, unchanged), **Combat**
(virtual movepad + Punch button, direct real-time control, bypasses the pathfinder), **Inspect** (tap
any tree/wall/zombie for a stats panel). The first enemy, a **kid zombie** (data id `kidZombie`), has
minimal idle→chasing AI and contact damage; player HP reaching 0 restarts the scene (no save system
yet, so "restart" = back to spawn with the world reset). The worker/task/pathfinding core is the seam
both the zombie's AI and the eventual NPC companions plug into.

## Active art swapped to Pixel Crawler (plan 005)

`ACTIVE_TILESET` in `src/data/tileset.ts` is now the **Pixel Crawler** pack — the Zombie Apocalypse
pack is retired to reference-only under `public/assets/`. A Skeleton (Base) mob sprite stands in for
the kid zombie (data id/name unchanged); the player has full 3-way directional facing (enemy flips by
movement-x only). See [ASSETS.md](ASSETS.md) and [DECISIONS.md](DECISIONS.md) for the full picture.

## Post-005 polish

Player **chop** (Slice) + **punch** (Crush) directional action swings; ground baked into one
`RenderTexture` to kill the fractional-zoom (150%) tile-seam bleed; workers chop/build from a
resource's **base** tile and **face** the target (`faceTile`, `TREE_BASE_STAND_OFFSETS`). Queued trees
now wear a **soft silhouette glow** — a **baked** halo texture (`src/render/glowTexture.ts`) drawn
behind the tree, head-of-queue pulses via an alpha tween. This replaced the plan-006 per-frame WebGL
PostFX pipeline (`OutlinePipeline`, retired): a tree's silhouette is static, so the halo is baked once
per species instead of shaded every frame — same look on WebGL *and* Canvas (no fallback fork), no
shader in the frame loop; see [RENDERING.md](RENDERING.md). See [DECISIONS.md](DECISIONS.md)
(2026-07-12).

**Crisp actors at every zoom:** actors now render at native `render.scale = 1` and camera zoom is
integer-only (`ZOOM_STEP = 1`; `setZoom` rounds every path). Same root cause as the ground bake — a
fractional on-screen texel scale (`render.scale × zoom`) makes nearest-neighbour uneven — but a small
framed sprite can't hide it behind a continuous texture the way the baked ground does. The player had
rendered at `scale 0.5`, crisp only at the even default 200% and stretched/clipping at 300%
(`0.5 × 3 = 1.5`). See [RENDERING.md](RENDERING.md) ("Pixel-art scale must be integer") and
[DECISIONS.md](DECISIONS.md) (2026-07-12).

## Three-tier test harness landed (plan 007)

The fragile live-game smoke is retired for **Tier 1** Vitest unit tests over the pure systems + data
(`npm test`, plain Node), **Tier 2** deterministic Playwright scenarios (`npm run e2e`) driven by a
DEV-only `window.game.__test` scenario/fixed-step API on `GameScene` (`applyScenario` builds a known
world from a declarative spec; `step(ms)` advances gameplay with zero wall-clock), and **Tier 3** a
thin boot canary (`npm run smoke`). Two-speed dev loop (`npm run test:watch` inner, full sweep at
wrap-up) — see [WORKFLOW.md](WORKFLOW.md).

## Menu UI on a Container-based UI kit

**Menu UI stays in Phaser (no DOM overlay)**, on a small Container-based UI kit (`src/ui/`: `Button`,
`Panel`, `arrangeRow/Column/Grid`, shared `theme`). The HUD (`UIScene`) is refactored onto it; build
inventory/build-menu panels from these primitives. Rationale in [DECISIONS.md](DECISIONS.md)
(2026-07-12).

## Inventory stacking + rock/stone node (plan 008)

The throwaway wood counter is now a real **inventory**: `Inventory` is **slot-backed** (a bounded
`Array<Slot>`), items **stack** to a per-item `maxStack` and **spill** into the next free slot, and
the bag can genuinely **fill up** — surfaced as an always-visible **hotbar** (`src/ui/SlotGrid.ts`,
bottom-centre, hidden in combat) plus an **ITEMS**-toggled full **INVENTORY** grid Panel. `maxStack`
is injected (`maxStackOf`), so the pure system stays data-agnostic and plain-Node testable.
Harvesting into a **full bag blocks and aborts the order** (guarded in both `beginCurrent` and
`runHarvest`) so the worker never swings forever on a node it can't fell.

**Stone is a real resource:** the tree/node machinery is generalised (`woodItemId/woodPerHit` →
`yieldItemId/yieldPerHit`, plus per-species render fields so a rock isn't sized/anchored like a pine),
and a **rock node** (`NODES.rock`, grey boulder extracted from the pack's `Rocks` sheet) yields
**stone** — mining reuses the chop interaction/anim. Item icons are **32×32 placeholders** this slice;
the repeatable **Gemini icon-generation pipeline** that replaces them with real art is **plan 009**
(gated on a LAN-only key, so the mechanic ships green on placeholders). New Tier-1 stacking tests +
Tier-2 `mine`/`block-full` scenarios.
