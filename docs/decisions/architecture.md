# Architecture decisions

GameScene decomposition, entities vs managers, stats adapters, buildable runtime, and map format/runtime.

Part of the [decision log index](../DECISIONS.md). Newest first.

---

## 2026-07-22 — [DECIDED] UI overhaul: DOM/React HUD overlay, "Field Kit" direction (plan 046)

Replaces the hand-placed Phaser HUD (`UIScene` + `src/scenes/hud/*`) with a **DOM/React
overlay** floating over the Phaser canvas. Research, three design directions, and interactive
mockups live in [`docs/ui-overhaul/`](../ui-overhaul/README.md); the build plan is
`plans/046-field-kit-hud-overlay.md`. Settled calls:

- **Engine split:** DOM/React owns all HUD/menus (bars, meters, day/night dial, hotbar,
  catalogs, drawers, inspect/companion/dev). Phaser keeps the world, camera, and *in-world*
  markers (build ghost, target outline, floating text, mob HP bars) + canvas gesture
  mechanics. A thin **event bridge** connects the existing `game.events` bus ⇄ a Zustand
  store (mirrors the editor's store-as-bridge pattern); GameScene's `wireBus()` event table
  is unchanged — only the `hudHitTest`/`isMovepadHeld` deps-closures and `scene.launch('UI')`
  wiring are touched, at cutover.
- **Direction:** **Field Kit (B)** — a persistent bottom command bar that morphs by mode
  (Scavenge/Build/Fight) + a persistent **6-slot manual-pin hotbar** + tabbed bottom-sheet
  catalogs (loadout-vs-catalog two-tier model). Chosen over the earlier Twin Grip lean for
  legibility/discoverability and as the safest first overhaul. Twin Grip / Emberlight are not
  built, but the bridge/tokens/primitives/hotbar/catalog work is direction-agnostic.
- **Stack:** reuse the editor's React 19 + Tailwind v4 + shadcn/ui (all already deps). This
  **reverses** the prior "the game page never loads Tailwind" isolation — Tailwind now ships
  on `index.html`, scoped under `#hud-root` with global preflight omitted (concrete mechanism
  in plan Step 1). The `src/editor/ui` primitives are copied to `src/hud/ui` for now
  (consolidation deferred).
- **Scope:** full HUD migration in one plan, **portrait-first** (CSS structured for a later
  landscape reflow), **spells deferred** (catalog is spell-ready but no spell content ships;
  combat keeps melee/bow).

## 2026-07-15 — [DECIDED] Map Builder editor + map/world file format (plan 014)

Resolves the 2026-07-11 [OPEN] "want a map editor" steer below. The editor is a **React chrome over
one Phaser viewport**, a dev-only second Vite page (`editor.html` → `src/editor/`), excluded from the
prod build. Full detail: [EDITOR.md](../EDITOR.md) + `plans/014-map-builder.md`. The settled calls:

- **Custom JSON, not Tiled.** Maps live in `src/data/maps/*.map.json`, validated through one pure
  choke point (`src/systems/mapFormat.ts` `parseMap`); world layout in `world.json`
  (`worldLayout.ts`). React for chrome (usability/filtering), Phaser for the viewport only.
- **Per-map palette is append-only** — layer cells index a `palette` array (`0` = empty); indices are
  never renumbered on save (keeps grid diffs tiny). **Autotile bakes are canonical** (the game loader
  stays dumb/pixel-exact); an editor-only semantic `terrain` mask is kept alongside and rebaked on
  save. **Zones** = a per-tile uint8 id layer + `defs`. **Walkability** = base-terrain passability
  only; runtime obstacles composite over it via `isBlocked`.
- **Objects = one array, `kind` discriminator** (`node`/`decor`/`portal`), every object a stable
  string `id`. **Connections/unlock-gates live in the registry, not map files** — maps expose named
  portals; the registry wires portal→portal (placeholder `MapConnections` for now). Map files never
  reference other maps.
- **Irregular shapes + one global tile coordinate space.** Each map has a per-tile shape mask
  (void = blocked); `world.json` places every map in signed global tile coords. This is the
  foundation for future **seamless walk-across** streaming and **cross-map monster pursuit** (a stated
  requirement) — the engine work is out of scope, but the data model doesn't block it.
- **Seams are derived, not authored** (computed at load from world.json + shape masks + walkability).
  **Validation split:** overlapping inside-cells / unknown mapId / structural invalidity = ERROR
  (fails loads); seam-walkability mismatch / diagonal-only adjacency / island / unplaced = WARNING.
- **Lazy registry from day one** (`mapRuntime.ts`: eager manifest+world, lazy per-map chunks) — the
  structure streaming needs, at the cost of one `await` today. **Committed 1px-per-tile thumbnails**
  are the future world-map screen's data source (drawable with zero map files loaded).
  **Fast-travel needs no format change** — it's a portal + a registry connection carrying a gate.
- **Persistence contract (no code yet):** authored map files are immutable; runtime state is a future
  save-side overlay keyed `{mapId, objectId}`. Therefore **anything runtime-mutable must be an
  object, never painted into tile layers** — tile/walkability/zone/shape cells are never overlayable.

## 2026-07-13 — [DECIDED] Buildable runtime stays bespoke for now; generalise on buildable #2

The campfire is the first *live* (per-frame-simulated) buildable, but it will be one of many
(turrets, crafting stations, chests, traps, farms, lamps…). We deliberately did **not** build a
generic structure/behavior framework yet — designing that abstraction from a population of one is how
you build the wrong one (the hard part isn't the tick loop, it's typing each behavior's deps + state,
which only a real second example reveals). Advisor-reviewed.

Instead we did a small **de-ossification pass** so the campfire specifics don't harden at the seams a
future generic manager would need:

- **`BuildableDef.behavior?: string`** is the live-vs-static discriminant (`'campfire'` today).
  `finishSite` branches on `def.behavior` (not `def.animKey`, which is now purely visual) to decide
  whether a completed buildable is handed to a runtime manager.
- **`litCampfires()` → `lightSources()`** across `CampfireManager`, `SurvivalClockDeps`,
  `VisionControllerDeps`, and the two GameScene closures. The consumed shape (`{x,y,radius}[]`) was
  already behavior-neutral; only the name said "campfire". A future lamp/torch emitter now aggregates
  into the same scene closure without `SurvivalClock`/`VisionController` changing at all.

Left **bespoke on purpose** (cheap to fold in later, 1–5 lines each): the dedicated `CampfireManager`,
its GameScene construct+tick lines, the `ScenePicker` campfire pick/inspect case, `campfireStats`, the
`feedAt` tap branch, and the testApi seams.

**Trigger — generalise when buildable #2 with a `behavior` field lands.** Build a `StructureManager`
owning a homogeneous `PlacedStructure[]` + a behavior registry: the scene calls `register(behaviorId,
module)` at `buildWorld()`, each module constructed with its own narrow deps (preserves the 013/015
coupling rule — one line per buildable, not one manager per buildable), exposing optional capability
methods (`tick`/`onTap`/`light`/`stats`) so `ScenePicker`/`SurvivalClock`/`VisionController` each get a
single `structures` route. `CampfireManager` dissolves into the first behavior module; `CampfireUnit`
→ `PlacedStructure`; the `game.__test` wrapper signatures stay and re-point internally. Est. ~half a
day, netted by the existing 216 unit + campfire e2e tests. Do NOT do it before #2 exists.

**2026-07-20 — [DONE] (plan 037 step 3).** The trigger fired at buildable #2 = the barricade wall, so
we folded BOTH campfire and wall into the generalisation in one pass. `src/scenes/world/StructureManager.ts`
owns the homogeneous `PlacedStructure[]` behind a behavior registry (`register('campfire'|'wall', module)`
in `buildWorld()`); `materialise` dispatches on `def.behavior`, and `tick`/`lightSources`/`reset`/`destroy`
fan out (union) across modules. `CampfireManager`/`WallManager` dissolved into `CampfireBehavior`/`WallBehavior`
(each a `StructureBehavior` with its own narrow deps); `CampfireUnit`/`PlacedWall` → `PlacedStructure<S>` +
per-behavior `state` (`CampfireState`/`WallState`). Every aggregated consumer (ScenePicker pick, SurvivalClock/
VisionController light, TaskGlowRenderer outline, `systems/stats`, EnemyManager fire/wall seam) routes through
the single manager; behavior-specific ops reach the module via `structureManager.behavior<M>(id)`. The
`game.__test` signatures are unchanged (re-pointed internally). Pure refactor — `refactor-tripwire` golden
unchanged.

## 2026-07-13 — [DECIDED] GameScene decomposition part 2: 5 world-subsystem boundary rulings (plan 015)

Continuing plan 013's manager extraction, plan 015 pulled the remaining state-owning world
subsystems out of `GameScene` (1385→~877 lines). Five boundary calls made along the way:

- **`nightOverlay` → `SurvivalClock`, not `VisionController`.** Ownership follows the sole
  alpha-writer — the clock is the only thing that ever mutates the overlay's alpha, so vision (fog of
  war) stays a separate, narrower concern.
- **`isBlocked` stays a scene `private readonly` arrow-field composite**, not extracted. It's an
  occupancy-first short-circuit passed by-ref into `MonsterTickEnv`/`testApi`, and it feeds the
  pathfinding spine directly — extracting it would add an indirection hop to the hottest per-tile check.
- **`ScenePicker` is a stateless class with deps but NO `SHUTDOWN` teardown** — unlike every other
  manager, it owns nothing (no tweens/sets/sprites), so there's nothing to tear down.
- **`resetTreesAndEnemies`/`randomiseWorld` stay thin scene orchestrators**, not manager methods —
  they're cross-manager transactions (clear + respawn across both `ResourceNodeManager` and
  `EnemyManager`), so each manager exposes a `clearAll({resetIds})` primitive and the scene composes
  the transaction.
- **Manager extraction order: `ResourceNodeManager` → `EnemyManager` → `SurvivalClock` →
  `VisionController` → `ScenePicker`** — `ScenePicker` last so its deps close over the *real* manager
  references rather than placeholders.

`world/actorAnims.ts` (`registerActorAnims`) and `world/groundRenderer.ts` (`drawGround`) also moved
out as plain free functions (not managers — one-shot `Phaser.Scene` setup, no deps object, no
teardown). No gameplay change; the `refactor-tripwire` golden `debugState()` snapshot still holds.

## 2026-07-13 — [DECIDED] GameScene decomposed into an entities layer + scene managers (plan 013); behaviour classes yes, data hierarchy no

`src/scenes/GameScene.ts` (2,448 lines, a third of all source at the plan's start) is now a
composition root + task loop + spawning/world-gen + mode/inspect glue (1,385 lines). Extracted: a
shallow `src/entities/` hierarchy (`Character` → `PlayerCharacter`/`MonsterCharacter`, replacing the
old `EnemyUnit` struct) for actors that genuinely share state + behaviour, plus
`BuildManager`/`TaskGlowRenderer`/`CombatFxManager`/`PointerInputController`/`scenes/testApi.ts` for
self-contained scene concerns. **No gameplay change** throughout — the Tier-2 Playwright suite +
`debugState()` shape (now a named `DebugState` type in `testApi.ts`, not
`ReturnType<GameScene['debugState']>`) were the behavioural contract; a new `refactor-tripwire` spec
pins a full snapshot as a standing regression alarm.

**Behaviour classes yes, data hierarchy no** — a conscious *refinement*, not a reversal, of the
2026-07-11 "shared stats via typed adapters" decision below (now refreshed to its post-rename names):
entities that truly share behaviour (movement, facing, combat hooks) get the `Character` hierarchy;
trees/build sites share no behaviour with each other or with `Character`, so they stay plain
interfaces and `systems/stats.ts`'s adapters remain the inspection seam.

**Advisor rationale (consulted 2026-07-12), adopted as-is:**

- **A plain class owns its sprite, not a `Sprite` subclass** — the footprint≠hurtbox split already
  means logical position isn't the sprite transform, so subclassing would entangle entity lifetime
  with the display list and the `debugState()` contract.
- **Camera merges into `PointerInputController`, not a separate manager** — pinch/pan/follow state
  IS gesture state; splitting it out would create the chattiest manager↔manager edge.
- **The task loop stays in `GameScene`** (`order/enqueue/beginCurrent/completeCurrent/runHarvest/
  runBuild/repath`) — it's the coordination spine touching player movement, inventory, sites and
  trees; only its *visuals* (glow sprites, queue markers) extracted, as `TaskGlowRenderer`.

**Coupling rules applied to every manager:** scene→manager is a direct method call, never a
`game.events` round-trip (the bus stays scene↔UIScene only); a manager's constructor takes the scene
plus a narrow deps object of closures over exactly the state it needs, never raw field access; no
manager↔manager coupling (the scene mediates); every manager registers `destroy()` on
`Phaser.Scenes.Events.SHUTDOWN`.

**Tooling adoption:** eslint + prettier + markdownlint-cli2 + husky/lint-staged (plan 013 Step 1)
landed first, isolated from the refactor's move-diffs, so every later step's commits pass through
the same hooks — see [STANDARDS.md](../STANDARDS.md).

## 2026-07-12 — [DECIDED] Menus stay in Phaser (canvas), built on a Container-based UI kit — no DOM overlay

Considered a DOM/HTML overlay for the heavier menus (inventory, build palette) vs building them in
Phaser like the existing HUD. **Decided: keep everything in Phaser.** The deciding factors for *this*
project: (1) we run `Phaser.Scale.FIT` over a fixed 360×640 base canvas (letterboxed) — a DOM overlay
lives in CSS pixels and would need continuous `scaleManager` re-transforms to track the letterbox +
scale, pure overhead the canvas path doesn't have; (2) pixel-art identity — HTML drags in the browser
box model/fonts we'd only have to style back down; (3) the HUD already has clean seams (event bus +
registry Inventory + `hudHitTest` input arbitration) that a second UI paradigm would fork; (4) world-
anchored interactions (drag item→tile, tooltips on a tree/zombie) stay in one coordinate system.
*Escape hatch if a genuinely form-heavy panel ever appears:* Phaser's `dom.createContainer` +
`this.add.dom(...)` positions DOM elements **in the scaled game space for you**, so one DOM element
can drop into `UIScene` as a targeted exception without abandoning the architecture.

The real pain wasn't canvas-vs-DOM, it was that `UIScene` hand-placed every rectangle + text with
inline x/y math. Fixed with a **small Container-based UI kit** in `src/ui/`:
- `theme.ts` — shared tokens (the colours/fonts the HUD repeated inline; a lift-and-name, not a restyle).
- `Button.ts` — a Container (bg rect + centred label). Centre-origin; input on the bg child, so a whole
  Button drops into `hudElements` and `hudHitTest`'s `getBounds()` union still works. `setToggled`
  (swap fill), `setDimmed`, `setLabel`; `default`/`danger`/`olive` variants + `activeFill` override.
- `Panel.ts` — a Container (bg + `addText` rows). Hidden by default; `show()/hide()` toggle the
  *container's* `visible`, so `panel.visible` reflects open/closed and it's a UI-tap region only while open.
- `layout.ts` — pure `arrangeRow/Column/Grid` helpers so menus stop hand-computing x/y.

First consumer is the HUD itself: every hand-rolled button (Build, Cancel, zoom ±, Follow, Combat/
Inspect, Punch, debug) and the Inspect panel now come from the kit. Button **screen coordinates and the
smoke-read public fields were preserved exactly** (`zoomText`, `inspectPanelBg/Title/Hp/Extra` — the
last four now back onto the Panel + its rows), so `npm run smoke` stays green unchanged, which also
confirms interactive children inside Containers work in the real WebGL runtime. The combat movepad
stays bespoke (a joystick, not a button). Build inventory/build-menu panels from these primitives next.

## 2026-07-11 — [RESOLVED] Want a map editor; Pixel Crawler autotiler + demo polish gaps

> **Resolved** by the 2026-07-15 [DECIDED] Map Builder entry at the top (plan 014 — editor built,
> `autotile.py`'s 8-neighbour key logic ported to `src/systems/autotile.ts`). The demo/autotiler
> polish gaps below stay open as art-tuning notes.

Matt's steer after reviewing the autotiled demos: they're good enough for evaluation, but the real
need going forward is a **map editor so he can build/edit maps himself** rather than tuning a Python
compositor — that's the next tooling to plan (in-browser tile painter over the same
`Floors`/`Wall`/blob data the offline autotiler already understands;
[`scripts/pixel-crawler/autotile.py`](../../scripts/pixel-crawler/autotile.py)'s 8-neighbour key logic is
the thing to port into the engine).

Known demo/autotiler polish gaps (deferred, not blocking the art decision):

- **`demo3_ruins` dirt corners** — the walled-enclosure floor still shows missing/!clean corner tiles.
- **Dirt has no surface texture** — the dirt fill reads flat; wants variation like the grass has.
- **Grass variation is too uniformly random** — the 6-fill random scatter looks noisy/even rather than
  naturally clustered; needs weighting/patchiness, not a flat random pick.

## 2026-07-11 — [DECIDED] Shared stats via typed adapters, not a class hierarchy

`InspectableStats` (the Inspect-mode panel's shape) is produced by small pure adapter functions
(`treeStats`/`wallStats`/`enemyStats`/`playerCombatStats` in `systems/stats.ts`) that read from
each runtime type's existing fields, rather than a shared base class or interface all entities
must implement. Rationale: trees/walls/enemies/the player already have different runtime shapes
(`TreeNode`/`BuildSite`/`EnemyUnit`/scene fields) built by different systems; forcing a common
class hierarchy across them would ripple through code that has nothing to do with inspection, for
a UI concern that only needs a read-only view. (Names refreshed 2026-07-13 for the zombie→enemy
rename; `EnemyUnit` itself later graduated to the `MonsterCharacter` class — see 2026-07-13 above.)

## 2026-07-11 — [DECIDED] Multi-map world: bolt-on areas + fast-travel special maps

World is many discrete maps, not one continuous map. Start map = camp + surroundings; adjacent areas
unlock as new bolt-on maps; special maps reached via fast travel once **car (repaired)** or **boat
(built)** is unlocked. Build a **data-driven map registry** with connections + unlock gates, persisted
in the save — don't hard-wire one world. Rationale: cheap content expansion and a clear progression/
exploration hook; decided early because it shapes the scene/loading architecture.

## 2026-07-11 — [DECIDED] Map is based on the real Mostowo site

The playable map traces a Google Maps screenshot of the actual camping spot; people, stories, and
landmarks of the place theme the content (LORE.md). Rationale: site-specific identity is what makes
this ours, not a generic zombie game.
