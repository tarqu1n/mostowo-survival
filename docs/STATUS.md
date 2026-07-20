# Status — what's built so far

Current-state summary of Mostowo Survival's shipped subsystems: what exists now and how it behaves.
[CLAUDE.md](../CLAUDE.md) carries the one-line summary + architecture map; the frozen detail behind
each entry lives in the referenced `plans/NNN-*.md`; the *why* lives in [DECISIONS.md](DECISIONS.md).

## Core loop + worker task system (plans 001–002)

Tap a tree → worker **pathfinds** (A*, routes around walls/trees) → multi-hit chop → yield into a
character `Inventory`. Orders **queue**: tap = act now / clear, **long-press = append**. **Build**
places a passable *blueprint*; the worker walks over and builds it into a solid, blocking wall over
time. **Cancel** clears the queue (blueprints survive). Data-driven content (`src/data/`), pure
systems (`src/systems/`: `pathfind`, `tasks`, `grid`, `Inventory`), decoupled `UIScene` HUD. On the
Phaser 3 + TypeScript + Vite scaffold (Boot→Preload→MainMenu→Game + UI overlay), GitHub Pages
auto-deploy.

## Combat + monsters (plans 003, 011)

Shared `BaseStats`/`CombatantStats`/`ObjectStats` schema (`src/data/types.ts`) + pure
`systems/combat.ts` resolve melee damage/hit-chance uniformly for player and enemy attacks. Three
HUD-toggled input modes: **Command** (tap-to-pathfind), **Combat** (virtual movepad + Punch button,
direct real-time control, bypasses pathfinder), **Inspect** (tap any tree/wall/zombie for a stats
panel). Player HP reaching 0 restarts the scene (no save system — restart = respawn with world reset).

The enemy (data id `kidZombie`) is a **generic, data-driven monster** driven by a pure FSM
(`src/systems/monsterAI.ts`): `idle`/`wander`/`patrol`/`chase` off radius-only aggro (`EnemyDef.vision`)
and distance-only de-aggro with a "losing the scent" veer band; `GameScene.updateZombies` persists the
`MonsterState` and moves toward `targetTile`. Tuning in `config.ts` ("Monster AI tuning"). Each
skeleton spawns holding a **club** (2 dmg, ~1500ms) or **knife** (1 dmg, ~750ms) rolled from
`EnemyDef.weaponPool` (`MONSTER_WEAPONS`, `src/data/weapons.ts`), held via **runtime anchor-pinning**
(no baked art) synced each tick by pure `weaponTransform` (`src/systems/attachment.ts`); the attack is
a coded swing tween. Supersedes plan 010's anchor-stamp tool. See
[ASSETS.md](wired-art.md#weapon-attachment-runtime-pinning-plan-011).

A second enemy, the **boar** (data id `boar`, plan 035b), is a **4-way directional** creature — the
enemy actor pipeline now supports two render paths via `EnemyDef.actorKind`: `'flip3'` (the skeleton's
single Run strip mirrored by `setFlipX`, the default) and `'dir4'` (a distinct strip per facing —
`Facing4` down/up/left/right, no flip — keyed by id under `ACTIVE_TILESET.actors.directional`, art from
its own pack). One `MonsterCharacter` handles both, branching on the discriminator (facing from velocity
via `facing4FromVelocity`, no weapon/hand rig for the weaponless boar, one 32px footprint). The boar is a
fast charger (speed 70, natural bite) and the default dev spawn; the skeleton stays a regression anchor.
See [CONVENTIONS.md](CONVENTIONS.md) ("Enemy rendering is a data discriminator").

### Footprint vs hurtbox

A creature's *footprint* (occupancy, one tile) is separate from its *hurtbox* (targeting extent;
`Hurtbox` in `src/data/types.ts`, `src/systems/hurtbox.ts`) so tall sprites are hittable by their
torso, not only their feet tile. Player and kid-zombie both use `{width:1,height:2}`. See
[CONVENTIONS.md](CONVENTIONS.md) ("Footprint vs hurtbox").

## Combat feel + feedback

- **Hit reactions:** on a landed hit both actors flash red (`HitFlashPipeline` PostFX on WebGL,
  `setTintFill` fallback on Canvas — [render/hitFlashPipeline.ts](../src/render/hitFlashPipeline.ts))
  and squash-flinch in lockstep. Logic stays keyed to `col`/`row`; feedback is purely visual.
- **Enemy attack tell:** before a bite the enemy freezes in a readable **wind-up** (plan 035a), tinting
  toward a warning colour; leaving contact cancels the strike (a whiff). The skeleton's tell is the coded
  tint + a **lunge** (`lungeAt`, Arcade `body.reset` out-and-back); the **boar plays its real Attack
  sheet** as the tell (plan 035b) on a punchier `BOAR_ATTACK_WINDUP_MS`, the strike landing as the anim
  completes.
- **Hit clarity:** camera kick (firm on player bitten, light on landing a punch) + a **damage
  vignette** — `render/vignetteTexture.ts` bakes a red radial edge-glow once, UIScene pulses it on a
  `player:hit` event. Kept off starvation drain.
- **Attack commitment:** while a Punch swing is in progress, move speed drops to `ATTACK_MOVE_SLOW`
  (20%) via `effectiveMoveSpeed()`, applied to pathfinder and Combat movepad (movepad vector stored as
  `combatMoveVec`, re-applied each frame).
- **Death animations:** player `death` state (`Death_Base`, 3-way) and skeleton `Death-Sheet` play as
  one-shot collapses at `DEATH_ANIM_FRAMERATE`. A killed zombie leaves the AI set at once but lingers
  as a **corpse** until anim + `DEATH_HOLD_MS` (`killZombie`). Player death routes through `killPlayer`:
  a `playerDying` flag freezes the world, then `scene.restart()` fires on a delayed call.

Tuning: `HIT_FLASH_*` / `ZOMBIE_LUNGE_*` / `*_SHAKE_*` / `DAMAGE_VIGNETTE_*` / `DEATH_*` /
`ATTACK_MOVE_SLOW` in `config.ts`. Still open: non-linear movement (accel/decel).

## Combat feel rework (plan 035a)

De-clunks ROADMAP step 1's core on the existing skeleton — combat should feel tense/exposed/committal,
not a power fantasy. Six pieces (numbers → [GAME-MECHANICS.md](GAME-MECHANICS.md); rationale →
[decisions/gameplay.md](decisions/gameplay.md) 2026-07-19):

- **Telegraphed skeleton attack:** the old instant contact-bite is now a readable **wind-up → strike**,
  driven caller-side in `MonsterCharacter` contact logic (the FSM stays movement-only). The tell is a
  ramping warning tint (`ENEMY_WINDUP_TINT`) + a freeze for `ENEMY_ATTACK_WINDUP_MS`, **carved out of
  the tail of the existing bite cadence** so DPS is unchanged — leaving contact mid-wind-up whiffs the
  strike (the cue to disengage). `enemyWindups` in `debugState`.
- **Mobile control cluster:** the movepad moved to the **left thumb**; a **right-thumb action cluster**
  (`combatMeleeButton` MELEE / `combatBowButton` BOW / a reserved dimmed **Spell** slot) sits
  bottom-right (`UIScene`). Melee roots you (`ATTACK_MOVE_SLOW` 0.2); the bow only lightly slows you
  (`BOW_MOVE_SLOW` 0.75) — the "ranged is safer" gap — both via `PlayerCharacter.effectiveMoveSpeed`
  (`attackLockUntil`/`bowLockUntil`).
- **Auto-surfacing controls:** a `combatActive` predicate (recomputed each frame — a live enemy within
  `COMBAT_ACTIVE_RADIUS_TILES` OR night) reveals the fighting HUD **and makes the movepad
  authoritative**, without ever calling `setMode('combat')` (that would `cancelAll()` the task queue).
  Chosen precedence: movepad drives, command-mode taps still queue orders; a pending order survives the
  reveal. `combatActive` in `debugState`.
- **Bow:** `combat:bow` auto-targets the **facing-biased nearest** live enemy within `BOW_RANGE_TILES`,
  applies **ranged** damage (`resolveRangedAttack`, dex-based, `BOW_BASE_DAMAGE`) as a **hitscan**, and
  flies a coded **arrow tracer** (pure FX). **Unlimited ammo.** The current target wears a stroked
  **highlight** re-synced each frame (`CombatFxManager`, mirrors `outlineCampfire` — not a baked halo);
  `bowTargetId` in `debugState`. Release body-pose is a **coded stand-in** (reuses the Pierce/`attack`
  strip — the pack has no bow rig/art yet).
- **Monster HP bars:** thin floating green→red bars above enemy hurtboxes (`CombatFxManager`),
  **attention-scoped** — the bow target's bar persists, any hit enemy flashes a brief bar that fades
  (`HP_BAR_SHOW_MS`), capped to `HP_BAR_MAX_VISIBLE` nearest, plus a near-death **alpha-throb** sprite
  tell so a capped-out enemy still reads as almost-dead. `enemyHpBarsVisible` in `debugState`.
- **Dev SPAWN ENEMY button** (replaced RANDOMISE) drops a skeleton by the player for fight-testing.

Sibling plan **035b** (deferred) adds the boar + the 4-way directional-actor pipeline. Still a coded
stand-in / flagged for playtest: the bow release anim + unlimited arrows (no ammo economy), plus all
`035a` tuning knobs.

## Melee attack shapes (plan 036)

Player melee is now a **data-driven tile-space attack shape** — `AttackShape = { reach; arc }` on a
weapon, resolved by pure `attackTiles(feet, facing, shape)` (`src/systems/hurtbox.ts`) into the set of
target tiles, oriented to a cardinal-snapped facing. `GameScene.attack()` runs the shape →
`EnemyManager.enemiesInTiles(tiles)` (every distinct alive enemy whose hurtbox covers any target tile)
→ per-target `resolveMeleeAttack` + `takeDamage`; **cleave hits every enemy in the shape, flat damage
each**, one camera shake if anything connected, a whiff still swings. `PlayerCharacter` carries an
optional `meleeWeapon?` (undefined = unarmed) resolved via `meleeShape()`/`meleeBaseDamage()`. Demo
`MELEE_WEAPONS` (`src/data/weapons.ts`, dev/test-only — no inventory/equipment): **spear** (reach 2,
`line`) and **cleaver** (reach 1, `wide`); unarmed = `UNARMED_MELEE_SHAPE` (reach 1, `single`) =
today's single-front-tile behaviour, unchanged. Numbers → [GAME-MECHANICS.md](GAME-MECHANICS.md);
rationale → [decisions/gameplay.md](decisions/gameplay.md) (2026-07-20).

**Enemies still use the proximity contact-bite** (Chebyshev ≤1 vs player body tiles, telegraphed) — a
type-only `attackShape?` seam exists on `MonsterWeapon` but nothing consumes it, so no enemy AI change.
Selectable in tests via the `setPlayerMelee(id)` `__test` seam + a `ScenarioSpec.melee?` field
(Tier-2 `tests/e2e/weapon-reach-arc.spec.ts`); no `DebugState` field added (tripwire golden unchanged).

## Day/night + hunger survival slice (plan 004)

Real-time **day/night cycle** (`src/systems/daynight.ts`, pure): a continuous clock drives a map-sized
tint overlay (smooth dawn/dusk ramps, flat mid-day/night) and a queryable `day`/`night` phase,
surfaced as a passive `Day N` HUD readout. **Night is tint + phase state only** — no enemy waves yet
(they layer on later via the same phase state).

**Hunger** (`src/systems/needs.ts`, pure) drains continuously and at zero cascades into combat-owned
`playerHp` (`damagePlayer`) on a fixed interval, reusing combat's death/restart path. A forageable
**berry bush** (`berryBush` node, `blocksPath:false`) yields **`berries`** (edible, `nutrition`) via a
**gather** player state (`Collect_Base` strips), distinct from chop/mine. A **Health & Wellbeing**
screen (STATUS button) shows hunger/health meters, read-only stats, and an available-to-eat list wired
to a `needs:eat` event. Survival state is **not persisted**.

## Inventory + resource nodes (plan 008)

`Inventory` is **slot-backed** (bounded `Array<Slot>`): items **stack** to a per-item `maxStack` and
**spill** into the next free slot; the bag can **fill up**. Surfaced as an always-visible **hotbar**
(`src/ui/SlotGrid.ts`, hidden in combat) plus an **ITEMS**-toggled full **INVENTORY** grid Panel.
`maxStack` is injected (`maxStackOf`) so the pure system stays data-agnostic. Harvesting into a full
bag **blocks and aborts the order** (guarded in `beginCurrent` and `runHarvest`).

Node machinery is generalised (`yieldItemId`/`yieldPerHit` + per-species render fields). A **rock node**
(`NODES.rock`) yields **stone** (mining reuses the chop interaction/anim).

## Item-icon generation pipeline (plan 009)

`scripts/gen-icons/` generates real item art with Gemini (`gemini-2.5-flash-image`) from a shared
style preamble + per-item prompt manifest (`prompts.py` — adding an item is one line), then PIL
post-processes: chroma-key out background → square-crop → downscale to **32×32** → optional palette
quantise. `wood`/`stone`/`berries` are generated + committed. **Gated on `GEMINI_API_KEY`** (LAN-only,
over Tailscale) and decoupled from the build; raw ~1024px generations are gitignored, only processed
32×32 PNGs are committed, and the game falls back to the item `color` rect if an icon is missing.
`--dry-run` composes prompts with no key/spend. See
[ASSETS.md](ASSETS.md#item-icons-gemini-pipeline-plan-009).

## Buildable campfire + build palette (plans 012, 016)

The wall-hardcoded build path is generalised into a build **palette** (BUILD opens a panel listing
every `BUILDABLES` entry with cost/affordability; pick one to select for placement). First non-wall
buildable is the **campfire** — a base-zone-only light + vision source with fuel drain, owned by
`CampfireManager` per the 013/015 manager pattern. Flame sprite **and** its light/vision radius
**scale with fuel** (single sprite scaled) so the fire grows as fed and dims as it burns down.
Refuelling is a **queued worker order** (`refuel` Action): tap the fire, worker walks over and tends
it one wood at a time, self-terminating when topped up or out of wood. A tap on the fire always
resolves to `refuel` (column-hit-tested over its whole tile stack). Tuned numbers:
[GAME-MECHANICS.md](GAME-MECHANICS.md).

**Attackable fire (plan 038 Step 1):** `CampfireManager.damageFire(id, amount)` drains the fire's
**fuel** — the mob→fire coupling the night wave's objective AI calls (plan 038 Step 4). It reuses the
existing fuel meter (no separate integrity meter) and douses on the same zero-crossing as a burn-out, so
an attacked-out fire and a neglected one are one state; relight is the existing feed-wood path. A
knocked-out fire is **not** a loss (only player death is) — it just floods darkness (decisions #1/#2 in
the plan). Exposed on the DEV `__test.damageFire(index, amount)` seam.

**Night wave + objective AI (plan 038 Steps 3–4):** `src/scenes/world/WaveDirector.ts` paces skeleton
spawns from the "treeline" (a walkable band off the defended centre — the lit hearth, else the player)
across the **night** phase on the `NIGHT_WAVE_BEATS` trickle→push→lull curve; started by the night
phase edge (`time:changed`), a first-tick phase reconcile (a scenario seeded into night), or the dev/
test `__test.beginWave` force seam. Wave mobs spawn with `objective: 'fire'`: a new `seek` FSM state
(`systems/monsterAI`) walks them to the nearest lit hearth and, on contact, reuses the telegraphed
wind-up/strike to **drain its fuel** (`attackFire` → `damageFire`, `WAVE_FIRE_ATTACK_DAMAGE`/hit) —
player radius-acquire still **preempts** (near you it fights you, the roaming-pull), returning to the
fire after. Spawn source anchors to the defended centre, not the literal grid perimeter (the-moon's
perimeter is ~140 tiles of void); switches to a real treeline edge with the arena map (roadmap Step 0).
The objective-target seam (`MonsterTickEnv.fire`/`attackFire`) is the one **plan 037** (destructible
walls/gate/trap) will build on.

**Loop-close + per-night escalation (plan 038 Step 5):** surviving a night rolls into a harder one —
`WaveDirector` captures a `NightEscalation` at wave start keyed off the in-game `dayCount` (pure
`systems/wave.ts`): each survived night opens with a bigger rush (`openingBurst`), paces denser
(`intervalScale`), and — from night 2 — mixes **boars** into the skeleton stream (`boarEvery`), all
clamped so a deep run can't wall you. Player death is still the only loss (`scene.restart`), which
resets `dayCount` → night 1. The fire-attack drain (`WAVE_FIRE_ATTACK_DAMAGE`) is tuned to a
deterministic anchor (a lone mob douses a full fire in ~24s — tense but reactable), the #1 feel knob
for playtest. The fire-fuel HUD + dev force-wave button are Step 6.

## Node harvest feel (plan 031)

- **Per-hit recoil:** each chop/mine hit nudges the node sprite directionally away from the actor
  with a squash pop, plus an **escalating tremble** that grows as HP→0 — both via a new
  `src/scenes/fx/NodeFxManager.ts` (mirrors `CombatFxManager`; see [CONVENTIONS.md](CONVENTIONS.md)
  "fx-teardown pattern").
- **Per-kind fell:** depletion plays a per-species payoff — tree **topples** (rotates about its
  base-anchored origin through `TREE_FELL_ARC_DEG` then fades), rock **crumbles** (shudder →
  shrink+fade), bush **rustles** (squash+fade). The selection glow halo tracks node motion for free
  (`TaskGlowRenderer.syncGlowTransforms` mirrors the sprite transform each frame, so transform-based
  motion animates the outline with no extra code).
- Camera-shake-on-fell is deferred (not built).

Tuning: `CHOP_RECOIL_PX`/`CHOP_RECOIL_MS`/`CHOP_RECOIL_SQUASH`/`CHOP_TREMBLE_PX`/`CHOP_TREMBLE_DEG`/
`TREE_FELL_MS`/`TREE_FELL_ARC_DEG`/`TREE_FELL_FADE_MS`/`ROCK_CRUMBLE_MS`/`BUSH_RUSTLE_MS` in `config.ts`.

## Rendering (art, glow, crisp actors)

- **Active art is Pixel Crawler** (plan 005): `ACTIVE_TILESET` in `src/data/tileset.ts`; the Zombie
  Apocalypse pack is retired to reference-only. A Skeleton (Base) sprite stands in for the kid zombie;
  player has 3-way directional facing, enemy flips by movement-x. Real 4-frame Idle bob wired
  (plan 011). See [ASSETS.md](ASSETS.md).
- **Baked glow, not shaders:** queued trees wear a **baked** halo texture (`src/render/glowTexture.ts`)
  behind the tree, head-of-queue pulses via an alpha tween — same on WebGL and Canvas, no per-frame
  shader. Replaced the retired plan-006 `OutlinePipeline`. See [RENDERING.md](RENDERING.md).
- **Ground bake:** baked into one `RenderTexture` in a single batched `beginDraw…endDraw` pass to kill
  fractional-zoom tile-seam bleed.
- **Crisp actors at every zoom:** actors render at native `render.scale = 1`, camera zoom integer-only
  (`ZOOM_STEP = 1`; `setZoom` rounds). See [RENDERING.md](RENDERING.md) ("Pixel-art scale must be
  integer").
- Player **chop** (Slice) + **punch** (Crush) directional swings; workers act from a resource's **base**
  tile and **face** the target (`faceTile`, `TREE_BASE_STAND_OFFSETS`). `TREE_TILES_TALL` = 5.

## Menu / UI kit

Menu UI stays in Phaser (no DOM overlay), on a Container-based UI kit (`src/ui/`: `Button`, `Panel`,
`arrangeRow/Column/Grid`, shared `theme`). The HUD (`UIScene`) and build/inventory panels are built
from these primitives. Rationale in [DECISIONS.md](DECISIONS.md) (2026-07-12).

## GameScene decomposition (plans 013, 015)

`GameScene.ts` (was 2,448 lines, now ~877) is decomposed into a `src/entities/` actor hierarchy
(`Character` → `PlayerCharacter`/`MonsterCharacter`) and scene managers: `BuildManager`,
`TaskGlowRenderer`, `CombatFxManager`, `PointerInputController`, `scenes/testApi.ts` (plan 013); plus
5 state-owning world subsystems `ResourceNodeManager`/`EnemyManager`/`SurvivalClock`/`VisionController`/
`ScenePicker` (under `src/scenes/world/` + `fx/`/`input/`) and free-fn setup helpers `registerActorAnims`
(`world/actorAnims.ts`) + `drawGround` (`world/groundRenderer.ts`) (plan 015). The task-loop/combat
spine (~260 lines) is a deliberate keep. No gameplay change; pinned by the `refactor-tripwire` Tier-2
golden snapshot. Landed alongside the project's first lint/format/markdownlint + pre-commit tooling.
See [DECISIONS.md](DECISIONS.md) (2026-07-13).

## Test harness (plan 007)

Three tiers: **Tier 1** Vitest unit tests over pure systems + data (`npm test`, plain Node); **Tier 2**
deterministic Playwright scenarios (`npm run e2e`) driven by a DEV-only `window.game.__test`
scenario/fixed-step API on `GameScene` (`applyScenario` builds a known world from a declarative spec;
`step(ms)` advances gameplay with zero wall-clock); **Tier 3** a thin boot canary (`npm run smoke`;
its real-WebGL run compiles the shaders as a free check). Two-speed dev loop (`npm run test:watch`
inner, full sweep at wrap-up) — see [WORKFLOW.md](WORKFLOW.md).

## Map Builder — dev-only editor (plans 014, 017)

A React-chrome-over-Phaser map editor (`editor.html` → `src/editor/`, excluded from the prod build)
for authoring the custom-JSON maps the runtime loader (plan 018) consumes. Paints tile layers, an
**autotile terrain brush** (8-neighbour blob logic, `src/systems/autotile.ts`), scenery (region-cropped
atlas sprites + animated strips), walkability, zones, and an irregular **shape mask**; undo/redo
throughout. A **World tab** positions maps in one global tile coordinate space (`world.json`) and
exports a 1px-per-tile thumbnail per map. Saves via a dev-only Vite middleware that regenerates
`manifest.json`. The map/world **file format + validators** are pure modules (`src/systems/mapFormat.ts`
/ `worldLayout.ts`), reused by editor and game. Zones have a runtime read path
(`src/systems/mapZones.ts` `zoneAt`) and a CI world-integrity test
(`src/data/maps/__tests__/world.test.ts`). Full detail: [EDITOR.md](EDITOR.md).

**Tabbed central pane (plan 017):** the central pane is a tabbed container — a permanent Map (and
placeholder World) tab plus on-demand, closable **object-editor tabs** (one per asset, from the
Library's ⚙); the Phaser canvas survives tab switches (panels hide via `visibility`), global shortcuts
gated to the Map tab. The object-editor tab hosts the reclassify UI (type dropdown, grid fields,
per-frame preview) and, for `object` sheets, a **manual region editor** (draw / select / move+resize /
grid-slice) writing `pack.json` `regions` to split tightly-packed atlases the connected-component
detector can't. **Animated-strip authoring** decouples grid geometry from the played frame set: strips
are authored as free **Columns × Rows** with per-cell **omission** (`omit`) — reaching game-runtime
code via `DecorAnim`/`parseDecorAnim` (`mapFormat.ts`) and the decor renderer (`decorSprites.ts`,
folding `frames`+`omit` into the anim cache key).

**Editor mobile/touch UX pass (plan 030):** reworked the two worst touch surfaces. **Library** — a
per-map **Recent strip** (grouped tiles) + persisted browse state (`src/editor/libraryViewStore.ts`),
full-width compact drawers that **auto-close on pick**, compact **drill-down** category nav with Back,
and **long-press to favourite** (tap = pick; `src/editor/hooks/useLongPress.ts`) replacing the
tap-thief heart on touch. **Node Types tab** — restacked to a full-width **collapsible list-on-top**
with a **collapsible Skins** section (thumbnail summary bar), on desktop + compact.

**Region select & move:** the **Select** tool doubles as a marquee — drag a box over empty map to
select a whole **area**, then move its entire contents one tile at a time (on-screen ← ↑ ↓ → in the
Toolbar / compact SelectionBar, or the arrow keys). The move relocates **every tile layer's cells, the
walkability/zone grids, each terrain mask, and every intersecting object/node/portal** as ONE undoable
command — for inserting space between existing content without re-authoring it. The void/shape mask is
deliberately not moved (structural). Pure block-move helpers live in `src/editor/regionOps.ts`
(`computeGridRegionMove`/`captureRegionObjects`/`normalizeRegion`), driven by the store's
`regionSelection` + `translateRegion(dCol,dRow)`; a move is refused whole if the box would leave the
map or land any content on void (mirrors `translateObjects`).

**Library role filter (plan 032):** every catalog asset carries a semantic `role` (`tile`/`object`/`actor`,
orthogonal to the structural `type`; tagged via `rules.actor` globs in `pack.json`). The Library's
`[Tiles] [Objects] [Actors]` chips filter the whole browse surface by role and **auto-sync to the active
tool**; **actors are hidden by default** (and can't be armed for placement), keeping creature/NPC sprites
out of the object palette until a dedicated actor editor exists.

**Tiling palette + quick layer selector (plan 033):** two always-visible, click-only surfaces that cut the
Library↔Inspector round-trips while laying out tiles. **Tiling palette** — named, per-map palettes persisted
in the map file (`MapMeta.tilePalettes`, syncing across devices like favourites); fill via the Library's
"Select for palette" → "Add to palette", one-tap a slot to arm the brush; structure edits are undoable,
the active-palette pointer is view-state. **Quick layer selector** — a compact control bound to the active
tile layer (tap-cycles, chevron dropdown jumps), in the desktop under-viewport bar + the compact ContextBar.

## Runtime map loader (plan 018)

The game **boots straight into one authored map** (`START_MAP_ID`, currently `test`) — no procedural
world gen. `PreloadScene` loads the map file + textures; `GameScene.buildWorld()` bakes authored tile
layers (`drawMapLayers`), renders decor (`DecorManager`), hydrates resource nodes from authored `node`
objects (`loadNodes`), and derives camera/physics bounds + a spawn-anchored base zone from the map
geometry. Map loading lives in `src/systems/mapRuntime.ts` (eager manifest/world + lazy per-map chunks
via `import.meta.glob`); walkability composites authored cells under runtime obstacles. Enemies stay
procedural; portals are parsed-and-held (no transitions yet). The old procedural
`drawGround`/`spawnTrees` path and fixed `MAP_WIDTH`/`MAP_HEIGHT`/`BASE_ZONE` consts are gone.

**Temp:** hunger is non-lethal (`HUNGER_LETHAL=false`) until the start map carries authored food.
Adjacent-ring streaming is [plan 019](../plans/019-l1-map-streaming.md). **Still to author:** the
test-content maps that exercise every feature end-to-end (plan 014 step 12) — which unblocks
re-enabling lethal hunger and plan 019's second placement.
