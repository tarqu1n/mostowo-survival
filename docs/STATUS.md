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

The larger character then drove two follow-ups: trees scaled up (`TREE_TILES_TALL` 2.6 → 5) so a pine
towers over it, and a **data-driven hurtbox** so tall sprites are hittable by their drawn torso, not
only their feet tile — a creature's *footprint* (occupancy, one tile) is now separate from its
*hurtbox* (targeting extent; `Hurtbox` in `src/data/types.ts`, `src/systems/hurtbox.ts`). Both the
player and kid-zombie use `{width:1,height:2}`; future large/small monsters just declare their own.
See [CONVENTIONS.md](CONVENTIONS.md) ("Footprint vs hurtbox").

Finally the **map was decoupled from the viewport and doubled** (`MAP_WIDTH`/`MAP_HEIGHT` = 2× base, a
45×80-tile world; `BASE_*` stays the viewport/HUD size) so the world gives room to roam/build
proportional to the bigger actors — the camera now scrolls/follows at every zoom. Doubling the ground
bake exposed a per-tile `drawFrame` flush that took ~25s on the headless renderer; the ground is now
baked in one batched `beginDraw…endDraw` pass (~160ms). See [DECISIONS.md](DECISIONS.md) (2026-07-12).

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

## Day/night + hunger survival slice (plan 004)

A real-time **day/night cycle** (`src/systems/daynight.ts`, pure): a continuous clock drives a
map-sized tint overlay (smooth dawn/dusk ramps, flat mid-day/night) and a queryable `day`/`night`
phase, surfaced as a passive `Day N` HUD readout. **Night is tint + phase state only** this slice —
no enemy waves yet (they layer on later via the same phase state).

**Hunger** (`src/systems/needs.ts`, pure) drains continuously and, at zero, **cascades into
combat-owned `playerHp`** (`damagePlayer`, plan 003) on a fixed interval — reusing combat's existing
death/restart path rather than a second health system. A new forageable **berry bush** (`berryBush`
node, non-blocking, `blocksPath:false`) yields **`berries`** (a first edible item, `nutrition`) via a
new **gather** player state (`Collect_Base` strips), distinct from the chop/mine swings. A **Health &
Wellbeing** screen (STATUS button → Panel) shows hunger/health meters, read-only player stats, and an
**available-to-eat** list wired to a `needs:eat` event; the inventory view is unchanged, reusing plan
008's existing panel (no throwaway "Equipped" shell — deferred to plan 010). Survival state is **not
persisted**. New Tier-1 `daynight`/`needs` unit tests + three Tier-2 scenarios
(`survival-{daynight,hunger,forage}`).

## Combat hit feedback + enemy attack tell

Combat now *reads*. On a landed hit, both the player and a zombie **flash red and squash-"flinch"**:
one tween over a plain `{ t }` object (1→0) drives a live **`HitFlashPipeline`** PostFX (WebGL; a
`setTintFill` fallback on Canvas — see [render/hitFlashPipeline.ts](../src/render/hitFlashPipeline.ts)
+ docs/RENDERING.md) *and* a scale-only squash, so flash and flinch decay in lockstep and the squash
never fights the actor's Arcade body. The skeleton ships **no attack strip**, so a zombie's bite is a
coded **lunge** toward its target (`GameScene.zombieLungeAt`) — it moves the Arcade **body** via
`body.reset` (a `sprite.x` tween would be stomped by physics each frame) out-and-back, only during the
stationary contact phase, settling well inside the contact cooldown. All feedback is purely visual:
logic stays keyed to `col`/`row`. Tuning lives in `config.ts` (`HIT_FLASH_*`, `ZOMBIE_LUNGE_*`);
`debugState` surfaces `playerFlash` + `{player,zombie}HitFlashes`/`zombieAttacks` counters, asserted by
two new Tier-2 `combat` scenarios (the boot canary's real-WebGL run compiles the shader as a free check).

## Death animations (both actors)

Death now *plays* instead of blinking out. The player's `death` `PlayerState` (`Death_Base`, 3-way)
and the skeleton's `Death-Sheet` (single-orientation) are wired as one-shot collapses at a slower
`DEATH_ANIM_FRAMERATE`. A **killed zombie** leaves the AI set at once (so nothing chases/counts it) but
its sprite lingers as a **corpse** playing the collapse, removed only after the anim + `DEATH_HOLD_MS`
(`GameScene.killZombie`; the old path `destroy()`-ed on the same frame). **Player death** routes
through `killPlayer`: a `playerDying` flag freezes the world (update() early-returns, further
bites/starve ticks are swallowed) while the collapse plays, then the existing "Death = restart"
`scene.restart()` fires on a `delayedCall`. Combat-FX/dying resets live in `resetCombatFx()` (shared by
create() + the scenario reset). `debugState` adds `corpses` + `playerDying`; a new Tier-2 `combat`
scenario proves the corpse is gated on the animation, and the existing `death` spec still covers the
freeze→restart (its `'restarting'` log now lives inside `killPlayer`, so it exercises the new path).
Tuning: `DEATH_ANIM_FRAMERATE` / `DEATH_HOLD_MS` in `config.ts`.
