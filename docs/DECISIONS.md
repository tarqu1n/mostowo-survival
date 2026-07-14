# Decision Log

Newest at the top. Each entry: what we decided, and *why*. Mark open questions clearly so a
future session knows what's still up for grabs.

Format: `YYYY-MM-DD — [DECIDED|PROPOSED|OPEN] Title` then a short rationale.

---

## 2026-07-14 — [DECIDED] Campfire fixes (plan 016): refuel is a worker order, flame scales (not sheet-swaps), outline is a rect

Post-playtest fixes to the plan-012 campfire. Four boundary calls (advisor-consulted before build):

- **Refuel is a queued `refuel` worker order, not an instant tap.** Tapping the fire enqueues an order
  (walk adjacent → tend one wood per `CAMPFIRE_FEED_INTERVAL_MS`), mirroring harvest, with the yellow
  queued outline and toggle-off-on-re-tap. Chosen over the old instant tap-to-feed so refuelling reads
  as work (and shares the task-queue spine). The order self-terminates on *conditions* (topped up: a
  full wood won't fit; or bag empty) since a fire persists — never on entity death.
- **Tap→action resolves in `ScenePicker.actionAt` (campfire → `refuel`), and the fire is column-hit-
  tested over its whole tile stack.** This structurally kills the "tap falls through to a move and the
  worker walks into the blocking fire tile" bug — a tap on the fire can never become a move — and the
  column test keeps it tappable regardless of the flickering flame's opaque pixels.
- **Flame grows/shrinks by SCALING one consistent sprite, not swapping the Bonfire_0x sheets.** Those
  sheets aren't a clean embers→roaring ramp (01/02/04 are braziers, 06/08 bare flames), so swapping
  them morphs the fire's *structure*. One sprite (Bonfire_07) scaled by `fuelFrac` reads coherently.
  The advisor's original objections to scaling (alpha-pick instability, glow re-sync) don't apply here
  because picking is column-based and the outline is a rect, not a sprite-following glow.
- **Queued outline is a stroked rect, not a baked-glow silhouette like queued trees.** `bakeGlowTexture`
  reads the whole multi-frame sheet (a 4-tile-wide smear) and the fire animates/scales — a rect over
  the tile column matches the queued-*site* style with none of that. The tree's soft glow was **not**
  reused for the fire.

**Deferred (logged, not done):** a general path-stall watchdog in `advancePath` — a move order beside
any wall can still corner-cut into a static collider and stall. Refuel removes the campfire trigger;
the general fix (no waypoint progress for N ms → repath/complete) is out of scope for plan 016.

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

## 2026-07-13 — [DECIDED] Buildable campfire + generalised build/palette (plan 012): four boundary calls

- **Base zone is a fixed rect for now.** `BASE_ZONE` (`config.ts`) is a hardcoded tile rectangle,
  explicitly a placeholder — expected to move to a dynamic/player-claimed base later.
- **Buildable selection via a build palette**, chosen over a cycle-through-buildables control or a
  dedicated button per buildable — scales cleanly as more buildables are added, and reuses the
  existing UI kit (`Panel`/`Button`/`arrangeColumn`).
- **Campfires get their own `CampfireManager`**, per the 013/015 world-manager pattern (a built
  campfire is a live, per-frame-simulated object — fuel drain, lit flips — not a placement-lifecycle
  concern like `BuildManager`). Lighting is wired via a single scene-mediated `lightSources()` closure
  (renamed from `litCampfires()` — see the de-ossification entry above) handed to both `SurvivalClock`
  (night-overlay mask) and `VisionController` (fog reveal) — no manager↔manager edge.
- **Enemy fog-gating is deferred** to the night-waves plan. This plan's "reveal" is purely the
  night-overlay hole the lit campfire cuts — enemies aren't vision-gated at all today (only the
  player is), so nothing new is hidden/shown about them.

Full mechanic write-up: [GAME-MECHANICS.md](GAME-MECHANICS.md).

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
the same hooks — see [STANDARDS.md](STANDARDS.md).

## 2026-07-12 — [DECIDED] Generic monster AI (pure FSM) + weapons via runtime anchor-pinning — supersedes plan 010's stamp tool for rigid slots (plan 011)

Turned the single-behaviour kid zombie into a data-driven monster, in two parts.

**AI** is a pure, unit-tested FSM (`src/systems/monsterAI.ts`: `stepMonster`) with four modes —
`idle`/`wander`/`patrol`/`chase` — driven by **radius-only aggro** (`EnemyDef.vision`, no
line-of-sight/wall occlusion) and **distance-only de-aggro** (no timeout): past
`MONSTER_CHASE_DROP_RADIUS_PX` the monster gives up, with a "losing the scent" **veer band** just
inside that radius (`MONSTER_VEER_BAND_PX`/`MONSTER_VEER_MAX_TILES`) that injects growing path noise
as the chase gets marginal, rather than a hard binary snap. `wander` = aimless roam with pauses
(`MONSTER_WANDER_RADIUS_TILES`/`MONSTER_IDLE_MS_MIN/MAX`); `patrol` = a fixed route with a pause at
each waypoint (`MONSTER_PATROL_PAUSE_MS`) — real content authoring a route is future work,
test/scenario-only for now. Zero Phaser imports in the FSM; `GameScene` just persists the returned
`.mode`/`targetTile`/`repath` onto each zombie.

**Weapons** are held via **runtime anchor-pinning**, not baked per-frame strips — the live pilot of
plan 010's own critique finding #3 (which floated pinning a single icon at runtime instead of
committing 26-frame stamped strips). An `AttachPoint {x,y,rot?}` per animation frame lives on
`StripAnim.anchors.mainHand` (co-located with the strip it's relative to); the pure
`weaponTransform` (`src/systems/attachment.ts`) resolves it through the strip's render footprint
into a world offset **every tick** — not on `animationupdate`, since lunge/veer tweens slide the
sprite between frame changes. One weapon sprite is pinned per monster and swapped/randomised at zero
art cost; the attack "animation" is a coded tween swing (rotate about the grip) since the pack ships
no mob attack strip. Each skeleton spawns with a **club** (2 dmg, ~1500ms) or **knife** (1 dmg,
~750ms) rolled from `EnemyDef.weaponPool`, stats owned solely by `src/data/weapons.ts`
(`MONSTER_WEAPONS`) — art (source/pivot/z) stays in the manifest, joined by a shared id, the same
art-vs-gameplay split the codebase already uses elsewhere.

**Supersedes, not merely diverges from, plan 010's anchor-stamp tool + rigid-slot baked strips**
(its critique findings #2/#3): runtime pinning is now the chosen path for *rigid* attachments
generally — the monster weapon today, and 010's player rigid slots (helmet/mainHand/offHand) later.
The stamp-and-bake tool and per-frame committed strips for rigid slots are now **redundant**; only
010's **deformable `chest`/`legs`** (cloth/mail that must bend with the body) still need
matching-pack or hand-drawn strips, since a pinned rigid icon can't deform. The two approaches
deliberately **share their low-level primitives** (`AttachPoint`, `weaponTransform`), so 010's rigid
slots can adopt pinning later as a **refactor**, not a rewrite. `plans/010-layered-equipment-system.md`'s
header is updated to record this so a future session doesn't resume the dead stamp tool.

## 2026-07-12 — [DECIDED] Theme is dark-fantasy, not zombie apocalypse (story pivot, follows the art)

The active art has been medieval-fantasy (Pixel Crawler — skeletons, orcs, bonfires) since plan 005,
but that swap was explicitly logged as **art-only, "not a story change"** (see 2026-07-11 [PROPOSED]
below): the story stayed a zombie apocalypse and the fantasy mobs were "reskinnable stand-ins". We're
now **making it a story change** — the game *is* a **dark-fantasy survival adventure**, not a zombie
one. This resolves the growing mismatch where the art, the title screen, and the enemy sprite
(skeleton) all read fantasy while the design docs still said "zombie apocalypse".

**Framing (kept deliberately light — a generic dark-fantasy wilds, not heavy bespoke lore):** you're
camped at Mostowo when the **old woods wake** — the dead don't stay down and creatures come out of the
treeline at night. Everything else is **unchanged**: the four pillars (base building · survival ·
crafting · base defense), the day/night risk/reward rhythm, hunger as the core pressure, the
real-Mostowo grounding, mobile-first, and the **dark-and-grotty-but-funny** tone (which fantasy
carries as well as horror did).

**Scope of this change:** prose/design docs only — `GAME-DESIGN.md` (pitch, setting, enemies, MVP),
`LORE.md`, and the one-liner in `CLAUDE.md`, plus the title-screen copy (already de-zombified: "MOSTOWO
/ SURVIVAL", tagline *"something stirs in the old woods"*). **Code identifiers are left as-is** for now
— the enemy's data id stays `kidZombie` / name `Kid Zombie`, and `zombieAt`/`ZombieUnit`/`zombieStats`
keep their names (a rename is a mechanical refactor to schedule separately, not a design decision). New
content should be authored fantasy-first; the zombie names in code are legacy, not intent.

Supersedes the "not a story change" caveat in the 2026-07-11 [PROPOSED] entry below.

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

## 2026-07-12 — [DECIDED] Day/night + hunger survival slice (plan 004): real-time cycle, hunger→health cascade, inventory reuse defers "Equipped"

**Day/night** is a continuous real-time clock (not tied to player action), driving a smooth tint
overlay + a queryable phase. **Night this slice is tint + phase state only** — no enemy waves; waves
layer on later off the same phase state, so the clock doesn't need revisiting when they land.

**Hunger** is a core ticking pressure (Don't-Starve-style) that, at zero, drains **combat-owned
`playerHp`** via plan 003's `damagePlayer` rather than a parallel health system — starvation death
reuses the existing scene-restart path for free. **Survival state (hunger/clock/phase) is not
persisted** — resets on every restart/reload, consistent with there being no save system yet.

**Eating happens via the Health & Wellbeing screen**, which also surfaces read-only player stats — a
deliberate superset of the design doc's "meters + eat list." **The inventory view is unchanged**,
reusing plan 008's existing panel/hotbar; the "Equipped" section from the original design sketch is
**deferred entirely to plan 010** rather than shipping a throwaway shell now.

**Bushes forage, trees/rocks chop/mine:** a new `gather` player state (`Collect_Base` strips) plays
for berry bushes, distinct from the existing chop/mine swings. `ResourceNodeDef` gained a required
`blocksPath` flag (bushes: `false`, non-blocking — the worker routes through and forages from an
adjacent tile; trees/rocks stay blocking) so build-placement and pathing gate on data, not a
tile-role special case.

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

## 2026-07-12 — [DECIDED] Data-driven hurtbox (footprint ≠ hurtbox); world props sized to the actor

Follow-on from the native-scale decision below. With the character now ~2 tiles tall, two problems
surfaced: (1) it dwarfed the trees, and (2) tall sprites + single-tile hit-testing meant you could be
next to an enemy's *drawn* torso yet whiff, because targeting only matched its feet tile.

**Decided:** separate a creature's **footprint** (movement/occupancy — always the single feet tile,
unchanged) from its **hurtbox** (combat targeting — a data-driven tile extent). `Hurtbox { width,
height }` on `CombatantStats` (`src/data/types.ts`), anchored at the feet tile, centred horizontally
and rising upward to match the drawn silhouette; pure helpers in `src/systems/hurtbox.ts`
(`hurtboxContains`/`hurtboxTiles`, `DEFAULT_HURTBOX = {1,1}`). Player and kid-zombie both declare
`{1,2}`. Consumed by `GameScene.zombieAt` (Punch + Inspect hit-tests) and by contact damage (a zombie
in melee reach of any player-body tile connects). For a `{1,1}` hurtbox every path reduces to the old
exact-tile behaviour, so it's a clean generalisation. Chosen over hardcoding "+1 tile" so future large
(`{2,3}` ogre) or small (`{1,1}` critter) monsters just declare their size — no targeting-code change.

Also bumped `TREE_TILES_TALL` 2.6 → 5 so a pine towers over the ~2-tile character (scaling the *world*
up, never the crisp actor down). Rule captured in [CONVENTIONS.md](CONVENTIONS.md) ("Footprint vs
hurtbox"). Verified: 8 new Tier-1 hurtbox unit tests + a Tier-2 "punch the overhang tile" regression.

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
[RENDERING.md](RENDERING.md) ("Pixel-art scale must be integer").

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

## 2026-07-12 — [DECIDED] Toward isolated test setups, not one live-game end-to-end smoke

The headless smoke drives the whole running game start-to-finish. That's already fragile and won't
scale as content grows — one linear playthrough can't cover every action/animation/interaction. Case
in point: the Punch step relied on a real-time movepad walk landing the player exactly one tile from a
chasing zombie; it flaked ~50% (the player walked *through* the collisionless zombie and co-located,
so Punch's single facing-adjacent tile was empty). Reworked to *aggro-then-settle* (walk only until
the zombie aggros, hold still, let it stop one tile below, then punch) — stable, but still indirect.
Direction: prefer **isolated, deterministic scenarios** — place the player + entities on known tiles,
set facing, trigger the one action under test, assert the result — over navigating there through live
play. The end-to-end smoke stays as a broad boot/core-loop sanity check; specific behaviours get their
own focused setups. **[RESOLVED 2026-07-12 — see the "Three-tier deterministic test harness" entry
below]** harness shape: a debug scenario API on GameScene, chosen over a dedicated test scene or a
query-param loader.

## 2026-07-12 — [DECIDED] Three-tier deterministic test harness (plan 007), retiring the live-game smoke

Resolves the harness-shape **[OPEN]** above. The single ~400-line `scripts/smoke.mjs` drove the
*whole* running game start-to-finish through the real UI and asserted ~35 things along one linear
playthrough — so it broke whenever anything on that path changed (the queue-marker assertion broke
when the outline shader landed; the chop step flaked on wall-clock timing when the glow got heavier),
and one playthrough can't cover every action. Replaced with three tiers:

1. **Unit tests — Vitest, plain Node (`npm test`).** The pure systems (`pathfind`, `tasks`, `combat`,
   `grid`, `stats`, `Inventory`) + data invariants, where most of the previously-smoke-asserted logic
   actually lives. Millisecond-fast, zero timing. Vitest because the project is already Vite (native
   fit, shared resolution/tsconfig). `Inventory` was made Node-testable by importing `eventemitter3`
   directly instead of via the full `phaser` package (behaviour-identical emitter — avoids Phaser's
   canvas feature-detection at import, so no jsdom/canvas-mock).
2. **Scenario tests — Playwright, deterministic (`npm run e2e`).** For the genuine
   integration/render/input surface that needs a browser (zoom/pan/camera, mode toggles, Inspect
   panels, the outline PostFX attach, movepad, scene restart, shader compile). Driven by a **DEV-only
   scenario API** on `GameScene` (`window.game.__test`): `applyScenario(spec)` builds a known world
   from a **declarative spec** (`{player:[3,3], trees:[[5,3]]}`) fed to one `applyScenario` — never
   hand-authored maps — and a **fixed-delta `step(ms)`** seam that stops the RAF loop and drives
   `game.step(t, fixedDelta)` so movement/chop/build/contact-cooldown/regrow resolve with **zero
   wall-clock** (a manual `scene.update()` would NOT advance physics/clock/timers). Named fixture
   builders (`tests/e2e/scenarios.ts`: `justATree`/`oneZombie`/`wallToRouteAround`) for shared shapes;
   one behaviour per spec, entities placed adjacent so there's no multi-second walk to race.
3. **Boot canary (`npm run smoke`).** What's left of the old smoke: boot the production bundle, reach
   `Game`+`UI`, render a few frames (compiling every WebGL shader), assert **zero console errors**,
   screenshot. No gameplay, no timing.

**Why a debug scenario API over the alternatives:** a separate test Scene would duplicate the
world-wiring we want to exercise; a query-param loader is just a less-flexible front-end to the same
setter. A method call from Playwright's `page.evaluate` reuses the real scene + real systems at the
lowest friction. **Gated on `import.meta.env.DEV`** so `vite build` dead-code-eliminates the install —
`window.game.__test` is genuinely absent from the shipped bundle — which forces the e2e runner to
serve `vite dev` (where `DEV===true`), NOT `vite preview` (production, `DEV===false`). Combat call
sites now take an injectable `rng` (default `Math.random`) so scenarios stay deterministic even if a
future enemy gains `dodge > 0`.

**Two-speed dev loop (the payoff):** inner loop `npm run test:watch` reruns only the unit tests whose
module graph touches the changed file (+ `npx playwright test <one-spec>` when browser fidelity is
needed); wrap-up gate `npm test` + `npm run e2e` + `npm run smoke`. See WORKFLOW.md.

## 2026-07-12 — [DECIDED] Workers chop/build from a resource's base tile, facing the target

Harvest prefers a *base* stand tile (the trunk row + the row below — `TREE_BASE_STAND_OFFSETS`; never
the canopy tiles directly above), falling back to any reachable adjacent tile if the base is walled
off. While working in place the worker turns to face the target (`faceTile`), so the chop/build swing
points at the tree/blueprint regardless of approach direction or a stale facing. Fixes: (a) chopping
from a canopy tile ~2 squares above the trunk, and (b) chopping while facing away when already stood
next to the tree. `reachableAdjacent` gained an optional candidate-offsets arg for (a). Rationale: a
tall sprite (2.6-tile pine) overhangs upward but only blocks its trunk tile, so "any adjacent" read
wrong — the base is where you'd actually chop. (Answers "do interactables need a target coordinate?":
yes, in effect — encode where the worker stands + which way it faces, per resource.)

## 2026-07-12 — [DECIDED] Player action swings: chop = Slice, punch = Crush (reskinnable stand-ins)

The player now plays directional action animations: **chop** = Pixel Crawler `Slice_Base` (loops
while felling in place), **punch** = `Crush_Base` (one-shot per Punch press). Wired as two extra
`PlayerState`s (`chop`/`punch`) alongside `idle`/`walk`, sharing the same `playerAnimKey`/render
footprint; action swings run at `ACTION_ANIM_FRAMERATE` (20 fps ⇒ ≈ one chop per `CHOP_INTERVAL_MS`).
A one-shot punch owns the sprite via a `punchLockUntil` time-gate in `updatePlayerAnim`; the swing
fires on every press (even a whiff) so input always feels heard. Rationale: the Body_A rig ships no
literal chop/punch strip, so Slice (axe-like side swing) and Crush (overhead smash) are the closest
melee motions — consistent with the plan-005 "fantasy mobs/actions as reskinnable stand-ins" stance.
The Skeleton mob has no attack strip (Idle/Run/Death only), so the enemy side of "fighting" is still
just contact damage with no dedicated attack pose — a future add.

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

## 2026-07-12 — [DECIDED] Swap active art to Pixel Crawler; zombie pack retired (plan 005)

Committed the swap proposed below: `ACTIVE_TILESET` now points to `PIXEL_CRAWLER_TILESET`
(`src/data/tileset.ts`). The old `ZOMBIE_APOCALYPSE_TILESET` const is removed (git history +
[docs/ASSETS.md](ASSETS.md#zombie-apocalypse-tileset--retired-reference-fallback-2026-07-11) retain
the record); its files stay under `public/assets/` as retired reference/fallback art, not deleted.
Manifest reshaped to a role-based schema (`TileSource` union — `image`/`sheetFrame` — plus
`StripAnim`/`ActorRender`), replacing the old approach, since the new schema is strip-only.

**Skeleton (Base)** mob is the sprite stand-in for the kid zombie — enemy data id `kidZombie` /
`name: 'Kid Zombie'` unchanged, only the sprite changed, consistent with the "reskinnable
stand-ins" call below.

Added **3-way directional facing for the player** (Down/Side/Up idle+walk strips; Side art faces
right, `flipX` mirrors left, driven by `lastFacing`). The **enemy stays single-orientation** (Run
strip only, frame 0 = idle, flips by movement-x) — mob sheets in this pack ship no directional
variants.

**Escape hatch (deferred, not done):** the zombie pack doesn't need to stay runnable (Matt's call
mid-plan), but could be made to fit the new strip-only schema by montaging its per-frame PNGs into
horizontal strips.

**Deferred primitive:** the new `sheetFrame` `TileSource` (a single fixed frame per tile) is also
the right shape for future adjacency-mask → frame **autotiling** — intentionally left as a
door-opener; only single fill frames are wired today (grass weighted-random, wall single fill).

Supersedes the [PROPOSED] entry directly below (Pixel Crawler is now committed/wired, not just the
leading candidate). Full narrative:
[docs/ASSETS.md](ASSETS.md#active-tileset--pixel-crawler-wired-in-plan-005).

## 2026-07-11 — [OPEN] Want a map editor; Pixel Crawler autotiler + demo polish gaps

Matt's steer after reviewing the autotiled demos: they're good enough for evaluation, but the real
need going forward is a **map editor so he can build/edit maps himself** rather than tuning a Python
compositor — that's the next tooling to plan (in-browser tile painter over the same
`Floors`/`Wall`/blob data the offline autotiler already understands;
[`scripts/pixel-crawler/autotile.py`](../scripts/pixel-crawler/autotile.py)'s 8-neighbour key logic is
the thing to port into the engine).

Known demo/autotiler polish gaps (deferred, not blocking the art decision):

- **`demo3_ruins` dirt corners** — the walled-enclosure floor still shows missing/!clean corner tiles.
- **Dirt has no surface texture** — the dirt fill reads flat; wants variation like the grass has.
- **Grass variation is too uniformly random** — the 6-fill random scatter looks noisy/even rather than
  naturally clustered; needs weighting/patchiness, not a flat random pick.

## 2026-07-11 — [PROPOSED] Adopt Pixel Crawler as the base art (re-theme to fantasy), darken later

Evaluated **Pixel Crawler — Free Pack v2.11** (Anokolisa) and made it the **leading replacement** for
the Zombie Apocalypse pack: better art quality and a style we prefer. Accepted trade-off — it's
**medieval-fantasy** (knights/orcs/skeletons/anvils/bonfires), not zombie/modern. Matt's call: keep
this art despite it **not being grim-dark enough yet**, and darken it *later* via grimmer
tiles/props/recolours + a lighting pass (proven viable by `demo2_camp_night.png`). So this swaps the
*art* and treats fantasy mobs as reskinnable stand-ins — **not** a story change, and **not yet wired
into `src/data/tileset.ts`** (evaluation only; still PROPOSED). If it pans out, buy more of Anokolisa's
paid packs (same grid/conventions). Full index + demos: pack
[`README.md`](../public/assets/tilesets/pixel-crawler/README.md) and
[`docs/ASSETS.md`](ASSETS.md#active-tileset--pixel-crawler-wired-in-plan-005). Zombie pack stays the
wired-in default until this is committed.

## 2026-07-11 — [DECIDED] Shared stats via typed adapters, not a class hierarchy

`InspectableStats` (the Inspect-mode panel's shape) is produced by small pure adapter functions
(`treeStats`/`wallStats`/`enemyStats`/`playerCombatStats` in `systems/stats.ts`) that read from
each runtime type's existing fields, rather than a shared base class or interface all entities
must implement. Rationale: trees/walls/enemies/the player already have different runtime shapes
(`TreeNode`/`BuildSite`/`EnemyUnit`/scene fields) built by different systems; forcing a common
class hierarchy across them would ripple through code that has nothing to do with inspection, for
a UI concern that only needs a read-only view. (Names refreshed 2026-07-13 for the zombie→enemy
rename; `EnemyUnit` itself later graduated to the `MonsterCharacter` class — see 2026-07-13 above.)

## 2026-07-11 — [DECIDED] Object inspection scope: trees + walls only, no new placeholder entity

Inspect mode (plan 003) covers trees, walls, zombies, and the player — no new crate/box entity was
added just to have a third kind of inspectable object. Rationale: nothing in the game creates such
an entity yet; adding one purely for the inspector would be speculative scaffolding.

## 2026-07-11 — [DECIDED] Tap-on-entity resolution: a dedicated Inspect mode, not tap/long-press overload

Viewing an entity's stats is a distinct HUD-toggled mode (tap anything while in Inspect mode), not
an overload of Command mode's existing tap (act now) / long-press (queue) semantics. Rationale:
Command-mode tap behaviour needed to stay exactly as-is (trees/build-sites/move), and overloading a
third meaning onto the same gesture would make it ambiguous which one fires.

## 2026-07-11 — [DECIDED] Three mutually-exclusive input modes: Command / Combat / Inspect

One HUD toggle pair switches between **Command** (default tap-to-pathfind, unchanged), **Combat**
(virtual movepad + Punch button, direct real-time control, bypasses the pathfinder/task queue), and
**Inspect** (tap anything for a stats panel, issues no commands). Only one non-Command mode is
active at a time; toggling one on flips the other off. Rationale: Combat's direct real-time control
and Command's tap-to-pathfind are fundamentally different input schemes that shouldn't both be live
at once — letting both interpret the same tap would fight over the player's movement.

## 2026-07-11 — [DECIDED] Direct tweaks auto-push on green; review gates stay on the plan loop only

For small changes Matt requests directly (tweaks/fixes/debug helpers, not plan steps): implement →
verify green (`npm run build` + `npm run smoke` where relevant) → commit → push to `master` without
stopping to ask. The stop-for-review checkpoints below apply to `plan-feature`/`critique-plan`/
`execute-plan` work, **not** to these one-off tweaks. Pause only if it's not green, ambiguous/
hard-to-reverse, or actually plan-scale. Rationale: ends the commit-then-ask friction on small live-test
iterations while keeping human review where it matters (the plan loop). Detail in WORKFLOW.md.

## 2026-07-11 — [DECIDED] Stop for Matt's review at plan / critique / each step (no unattended sweep)

The plan→critique→execute loop must **pause for Matt's input** at three gates: after a plan is written
(before critique), after the critique (before executing), and at the end of **every** executed step (per
the `execute-plan` skill's check-ins). Do not run the whole loop autonomously, even when told to "build
it" — that authorises the work, not skipping review. Rationale: Matt wants to review/steer before code
lands; a fully autonomous sweep robbed him of that. Detail in WORKFLOW.md → Review checkpoints.

## 2026-07-11 — [DECIDED] Genre & platform: browser pixel-art survival base-builder

Single-player, runs in the browser, no server. Themed around Mostowo (camping destination).
Rationale: fun personal project; browser = zero-install, shareable by link; no backend keeps
it cheap and simple to host and reason about.

## 2026-07-11 — [DECIDED] Engine: Phaser 3

User's pick. Mature, huge tutorial/ecosystem base, first-class 2D + pixel-art support
(`pixelArt: true`, nearest-neighbour scaling), scene system suits a game with menus + world + UI.

## 2026-07-11 — [DECIDED] Build workflow: Hermes plan → critique → execute skills

Use the `hermes-ai-tooling` dev skills for every non-trivial feature so work is structured and
resumable across devices. See docs/WORKFLOW.md.

## 2026-07-11 — [DECIDED] Record-everything-in-repo rule

All reusable decisions/preferences/workflows are committed to the repo, never left only in chat,
because sessions hop between devices. This log is part of that.

## 2026-07-11 — [DECIDED] Trunk-based solo workflow: commit each stage, push to `master`, auto-deploy

Solo project — no feature branches, no PRs. Work on `master`; commit each completed stage and push
straight to `master`. Every push to `master` triggers the GitHub Pages Action to build + deploy, so
"ship" = `git push`. Rationale: minimises ceremony for a one-person project and gives a live URL that
always reflects trunk. (Set `master` as the GitHub default branch in Settings — one-time.)

## 2026-07-11 — [DECIDED] Language: TypeScript; Build tool: Vite

A survival/crafting game grows complex fast; types pay off in inventory/recipe/save code and make
cold-resuming on another device far easier. Vite gives instant HMR and a trivial static `dist/`
build that drops straight onto a static host.

## 2026-07-11 — [DECIDED] Hosting: GitHub Pages via GitHub Actions

Push to the deploy branch → Action runs `vite build` → publishes. Deploy config lives in-repo (no
external accounts), which fits the cross-device rule. itch.io kept in mind as an optional *second*
distribution target later for reaching players.

## 2026-07-11 — [DECIDED] Art pipeline: programmatic placeholders first

Start with generated/coloured-rect placeholder art so we can build and feel the mechanics quickly
(ideal for on-the-go sessions), then swap in real pixel art (free CC0 tileset and/or hand-drawn)
once the slice is fun. Keeps art off the critical path.

## 2026-07-11 — [DECIDED] Premise & core loop: zombie apocalypse at Mostowo, day/night cycle

Camping at Mostowo when a zombie apocalypse hits (intro short story). Four pillars: base building,
survival, crafting, base defense. **Day** = scavenge camp/forest/surroundings for resources;
**base phase** = fortify (walls/traps), craft, unlock crafting stations; **night** = zombie animals,
humans, creatures come through the map. **Enemies are roaming (don't attack unless aggro'd) or
attacking** — this deliberately punishes staying out at night and makes "get home and defend" the
correct play. Full detail in GAME-DESIGN.md. Rationale: gives the day/night cycle real risk/reward
teeth and a clear emotional arc each cycle.

## 2026-07-11 — [DECIDED] Mobile-first, portrait, touch — scales to larger screens

Primary target is playing on a phone (portrait, touch). Must scale to any screen size (fit/letterbox
on desktop now; richer big-screen framing later). Scaffold: Phaser `Scale.FIT` from a fixed portrait
base resolution, `pixelArt: true`, touch as the baseline input. Rationale: Matt plays on his phone;
designing mobile-first avoids a painful retrofit.

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

## 2026-07-11 — [DECIDED] Art identity: dark & grotty, but humorous

Grimy survival-horror palette with comic items/enemies/visual gags. Rationale: distinctive tone,
and humour keeps a grim premise fun.

## 2026-07-11 — [DECIDED] Asset pipeline: free CC0 tilesets + Gemini "Nano Banana" (via guppi)

Start with CC0 tilesets (Kenney first) for a coherent base; generate bespoke on-theme items/enemies
with `gemini-2.5-flash-image` mirroring `guppi/house-helper/catalog_icons.py`. Key lives on the home
server (`GEMINI_API_KEY`, gitignored, LAN-only) so generation runs from a guppi-reachable machine and
processed sprites get committed. Detail in ASSETS.md.

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
