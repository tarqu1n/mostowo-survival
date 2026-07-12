# Basic Combat: Combat Mode, Punch, First Zombie, Stats Inspector

> Status: deployed

## Summary

First combat slice. Adds a player-toggled **Combat mode** (virtual movepad + a Punch button,
direct real-time control) that coexists with the existing tap-to-command mode; a **shared stats
model** so trees, walls, zombies, and the player all expose a common "inspectable" shape; a
**dedicated Inspect mode** (tap anything to see its stats); and the **first real enemy** — a kid
zombie wired in from the already-staged tileset, with just enough AI (idle → chase → contact
damage) to be a live target. Punch deals a flat 1 damage to start; everything else about combat
numbers is tuned by feel later, not specified here.

This is the seam GAME-DESIGN.md's "Night: a short timed wave of a couple of roaming/attacking
zombies" (MVP slice item 4) plugs into, and reuses the worker/task/pathfinding core exactly as
CLAUDE.md's Status note anticipated ("the seam the NPC companions plug into" — a zombie unit is
architecturally the same kind of thing).

## Context & decisions

**Scaffold to build on:**

- `src/scenes/GameScene.ts` — owns the player `Sprite` (Arcade body), the unified pointer gate
  (`onPointerDown`/`onPointerMove`/`onPointerUp`, `GameScene.ts:397-479`), `actionAt()`
  (`:482-485`, currently a binary tree-hit-else-move fallthrough), `advancePath()`/`physics.moveTo`
  waypoint movement, `trees: TreeNode[]` and `sites: BuildSite[]` runtime arrays.
- `src/data/types.ts` / `src/data/nodes.ts` — the established **static def + scene-local runtime
  wrapper** pattern: `ResourceNodeDef` (pure catalog data: id/name/maxHp/...) is embedded by
  reference inside a scene-local `TreeNode { sprite, def, hp, alive, col, row }`; `chop()` mutates
  `hp`/`alive` on the instance, never the def. `BuildableDef`/`BuildSite` follow the same split
  (no HP on walls yet — confirmed, see below).
- `src/scenes/UIScene.ts` — parallel HUD scene; talks to `GameScene` via `this.game.events`
  (e.g. `build:toggle`/`build:modeChanged`, `tasks:cancel`/`tasks:changed`) plus the Phaser
  `registry` for shared state (`inventory`, `zoom`). New buttons follow the existing template:
  `Rectangle` + `Text`, `setInteractive({ useHandCursor: true })`, push into `this.hudElements` so
  `hudHitTest()` excludes them from world taps, listeners torn down on `SHUTDOWN`.
- `src/systems/{tasks,pathfind,grid}.ts` — confirmed Phaser-free/pure. `grid.ts`: `TILE_SIZE=16`,
  `worldToTile`/`tileToWorldCenter`/`snapToTileCenter`/`tileKey`.
- `src/data/tileset.ts` — `TilesetManifest.actors.player: string[]` is a flat walk-frame list; no
  per-direction frames exist for the player (single reused walk anim, idle = frame 0). The staged
  zombie tileset's `kid-zombie-animation-frames/` and `damaged-kid-zombie-animation-frames/`
  (`public/assets/tilesets/zombie-apocalypse/sprites/`) each have 9 frames, same shape as the
  player's walk/damaged sets — one cycle per state, not per-direction.
- `scripts/smoke.mjs` — headless Playwright driver against `npm run preview`; taps HUD/world
  coordinates via `toClient`/`worldToClient`, asserts on `window.game` state. Extend this rather
  than inventing a second test mechanism.
- `src/config.ts` — tunables live here (`TILE_SIZE`, `INTERACT_RANGE`, `CHOP_INTERVAL_MS`, `COLORS`,
  etc.). Add new combat tunables here, not inline magic numbers.

**Direction** (CLAUDE.md / GAME-DESIGN.md / DECISIONS.md): mobile-first touch, data-driven catalogs,
systems decoupled from Phaser, UI decoupled via `UIScene`, trunk-based on `master`. GAME-DESIGN.md's
"Enemy design" section specs **roaming (won't attack unless aggro'd) vs attacking** as the long-term
target — this slice deliberately implements only a minimal slice of that (see Out of scope).

**Decisions locked with the user for this slice:**

- **Three mutually-exclusive input modes**, one HUD toggle pair: **Command** (default — today's
  tap-to-pathfind/harvest/build, unchanged), **Combat** (movepad bottom-right drives the player
  directly, bypassing the pathfinder; action buttons bottom-left, starting with one **Punch**
  button), **Inspect** (tap anything to see its stats panel instead of issuing a command). Only
  one non-Command mode is active at a time; toggling one off returns to Command, toggling the
  other switches directly without needing to pass through Command.
- **Facing direction** is a new tracked concept (the player has none today): store `lastFacing:
  {dCol, dRow}` on the player, updated from the last nonzero movepad vector in Combat mode or the
  last move direction in Command mode. Punch acts on the tile at `playerTile() + lastFacing`. No
  new directional art needed — this is gameplay-only, sprite stays the single reused frame/anim.
- **Punch**: flat **1 damage**, single facing-adjacent tile, no range/arc beyond that. Only affects
  zombies (does not double as a harvest tool — trees keep using the existing chop action).
- **Tap-on-entity semantics**: resolved via the dedicated Inspect mode above — Command-mode tap
  behaviour for trees/build-sites/empty-tiles is **unchanged**; Inspect mode is the only way to
  view a stats panel.
- **Inspectable object scope**: trees and walls (build sites), no new placeholder crate/box entity
  this slice. Walls currently have **no HP/durability field at all** (`BuildSite` only tracks
  `progress`/`done`) — this slice adds a `maxHp`/durability-style stat to `BuildableDef` purely so
  the wall has something to display in its stats panel. This is **not** the "wall HP/damage from
  combat" mechanic plan 002 deferred — walls remain indestructible in combat this slice; only the
  *display* stat is added now as forward-compatible scaffolding.
- **Shared stats model — real schema, not just a display shape.** Two tiers, both plain
  `interface`s (no class hierarchy, just `extends` for field composition):
  ```ts
  interface BaseStats {
    maxHp: number;
    armour: number;     // flat reduction to incoming damage
    speed: number;       // px/s; 0 for anything that doesn't move
    vision?: number;      // world-px sight/detection radius; omit if not applicable
  }
  interface CombatantStats extends BaseStats {
    strength: number;    // flat bonus to melee damage dealt
    dex: number;          // flat bonus to ranged damage dealt (unused this slice, no ranged weapon)
    dodge: number;        // % subtracted from attacker's hit chance
  }
  interface ObjectStats extends BaseStats {
    activationRange?: number;  // proximity trigger (traps etc.), unused this slice
  }
  ```
  `EnemyDef` and the player's own stats bag compose `CombatantStats`. `ResourceNodeDef`
  (trees) and `BuildableDef` (walls) compose `ObjectStats`, meaning they **do** carry
  `armour`/`speed` fields (set to `0`) for schema consistency, but per an explicit user call:
  those fields are **inert for objects this slice** — no damage-resolution code reads an
  object's `armour`, nothing moves an object by its `speed`, and the Step 7 inspector panel
  **omits armour/speed from the display for objects** (they'd just always read "0" and mean
  nothing yet). `maxHp` is a static/catalog-only field — **current** HP is always tracked
  separately on the runtime instance (`TreeNode.hp`, `ZombieUnit.hp`, a new `playerHp`),
  exactly mirroring the existing tree pattern; it is never duplicated onto the stats shape
  itself.
- **Full schema locked in now, deliberately, even where unused this slice.** A fresh-eyes critique
  of this plan flagged `dex`/`rangedDamage`, the `dodge`/hit-chance roll, and `activationRange` as
  premature — nothing this slice's content (one melee enemy, one flat-damage punch) exercises them.
  That's correct as an observation, but it's an explicit user call to keep the full stat shape now
  rather than revisit it piecemeal later: the goal is knowing and remembering the whole shape of
  things once, not minimizing this slice's line count. Recorded here so a future reader doesn't
  mistake this for an oversight.
- **Combat resolution formulas (v1, flat, tune-by-feel like everything else)** — new pure
  `src/systems/combat.ts` (Phaser-free, alongside `tasks`/`pathfind`/`grid`):
  - `meleeDamage(attacker: CombatantStats, weaponBaseDamage: number) = weaponBaseDamage + attacker.strength`
  - `rangedDamage(attacker: CombatantStats, weaponBaseDamage: number) = weaponBaseDamage + attacker.dex` (defined now for the schema's sake; nothing calls it this slice — no ranged weapon exists yet)
  - `hitChance(defender: CombatantStats) = clamp(100 - defender.dodge, 5, 100)` (a 5% floor so dodge
    can never make something literally unhittable; with every current entity's `dodge = 0` this is
    always 100% — the roll is mechanically present but a no-op until something sets `dodge > 0`)
  - `damageTaken(incoming: number, defender: CombatantStats) = max(0, incoming - defender.armour)`
  - A single `resolveMeleeAttack(attacker, defender, weaponBaseDamage): number` composes the above
    (rolls hit chance, then computes `damageTaken(meleeDamage(...), defender)`, returns the actual
    HP to subtract, or `0` on a miss) — both Punch (Step 5) and the zombie's contact attack (Step 4)
    call this **one** function rather than each hand-rolling damage math.
  - A new `UNARMED_BASE_DAMAGE = 1` constant in `config.ts` is `weaponBaseDamage` for both Punch and
    zombie-bite — this is what makes Punch's already-agreed "flat 1 damage" fall out naturally
    (player `strength: 0` + `UNARMED_BASE_DAMAGE: 1` − zombie `armour: 0` = 1), rather than being a
    separately hardcoded number in `punch()`.
- **`vision` replaces two things this slice would otherwise invent separately**: a zombie's own
  `vision` stat *is* its aggro-detection radius (world-px distance to the player — no separate
  `AGGRO_RADIUS` constant needed), and the player's `vision` stat is what the existing fog-of-war
  code should read instead of the current flat `VISION_RADIUS` config constant (which becomes just
  the *starting value* assigned into the player's stats, not something read directly at render
  time).
- **`speed` replaces the separate `moveSpeed` field** this plan previously put directly on
  `EnemyDef` — it's just `CombatantStats.speed` now. Consider (judgement call for whoever executes
  Step 3) also migrating the player's existing hardcoded `this.speed = 90` to read from the new
  player stats bag, since duplicating the number in two places would drift.
- **Player stats**: no player stats exist today. This slice adds a `playerStats: CombatantStats`
  bag on `GameScene` (starting values below) plus a separate mutable `playerHp: number` (mirrors the
  def/runtime-hp split used everywhere else). A `damagePlayer(amount: number)` method runs incoming
  hits through `damageTaken`/clamps at 0.
- **Death = restart, not a soft heal.** This is a survival game — death should mean losing the run,
  not shrugging off a hit. On `playerHp` reaching 0: log it, then call `this.scene.restart()`
  (Phaser's own scene-restart API) rather than resetting `playerHp` in place. No save/load system
  exists yet (`docs/GAME-DESIGN.md`'s Persistence section: localStorage saves are explicitly future
  work), so "restart" for this slice is simply Phaser tearing down and recreating the scene fresh —
  player back at spawn with full HP, trees/sites/the zombie all back at their initial state too.
  This is **not** scoped to include a game-over screen/message or any death penalty beyond losing
  progress made since scene load — just the restart mechanic itself. Once a real save system lands,
  "restart" should become "reload last save," but that's a future slice's problem, not this one's.
  (This also resolves the death-loop risk a fresh-eyes critique flagged for the old in-place-heal
  design — restarting the whole scene means the zombie can't still be standing adjacent to
  immediately re-damage the player, since its position/state resets too.)
- **Zombie AI (minimal, not the full roaming/aggro model)**: one state machine, two states —
  `idle` (stationary, does nothing) and `chasing` (re-pathfinds toward the player's current tile
  via `systems/pathfind.ts` every ~300ms and walks it via the same `physics.moveTo` waypoint
  approach `advancePath()` uses, not a new movement system). Transitions: `idle → chasing` when the
  world-px distance to the player is within the zombie's own `def.vision` (see above — no separate
  radius constant); no `chasing → idle` deaggro this slice (full roaming/aggro nuance is explicitly
  deferred). While `chasing` and adjacent to the player, calls `resolveMeleeAttack(zombieStats,
  playerStats, UNARMED_BASE_DAMAGE)` and applies the result via `damagePlayer(...)` on a cooldown
  (new `CONTACT_DAMAGE_COOLDOWN_MS` config constant, e.g. 1000ms) rather than every frame.
- **First zombie**: the **kid zombie** (weakest/simplest). Starting `CombatantStats`:
  `maxHp: 3, armour: 0, speed: 45, vision: 80 (5 tiles), strength: 1, dex: 0, dodge: 0` — `maxHp: 3`
  matches the tree's `maxHp: 3` so Punch (1 damage) takes 3 hits, mirroring the chop feel; `speed:
  45` ≈ half the player's `90` (chaseable but outrunnable); `strength: 1` is what a zombie bite
  actually uses via `resolveMeleeAttack` instead of a separate `contactDamage` field (dropped from
  `EnemyDef` — melee damage is now always derived from `strength`, whichever entity is attacking).
  Exactly one instance spawns for this slice (a fixed test position on the map) — wave-spawning is
  out of scope.
- **Starting numbers for the full cast** (all placeholders, tune by feel):

  ||maxHp|armour|speed|vision|strength|dex|dodge|
  |---|---|---|---|---|---|---|---|
  |Player|10|0|90|80 (5 tiles)|0|0|0|
  |Kid zombie|3|0|45|80 (5 tiles)|1|—|0|
  |Tree (object)|3|0 (inert)|0 (inert)|—|—|—|—|
  |Wall (object)|10|0 (inert)|0 (inert)|—|—|—|—|

## Steps

- [x] **Step 1: Shared stats schema + combat resolution + EnemyDef catalog** `[inline]`
  - Outcome: `src/data/types.ts` gained `BaseStats`/`CombatantStats`/`ObjectStats`/`EnemyDef`/
    `InspectableStats`; `ResourceNodeDef`/`BuildableDef` now `extends ObjectStats` (their `maxHp`
    field is inherited, not duplicated). New `src/data/enemies.ts` (`ENEMIES.kidZombie`). New
    `src/systems/combat.ts` (`meleeDamage`/`rangedDamage`/`hitChance`/`damageTaken`/
    `resolveMeleeAttack`, `rng` injectable). Added `PLAYER_MAX_HP`/`PLAYER_START_SPEED`/
    `PLAYER_START_VISION`/`UNARMED_BASE_DAMAGE`/`CONTACT_DAMAGE_COOLDOWN_MS` to `config.ts`.
    Updated `NODES.tree` (`armour: 0, speed: 0`) and `BUILDABLES.wall` (`maxHp: 10, armour: 0,
    speed: 0`) — only two literals existed, confirmed via grep. `npm run typecheck` passes;
    `resolveMeleeAttack(player, kidZombie, 1, () => 0)` returns `1` as intended.
  - In `src/data/types.ts`, add the three-interface schema from Context & decisions verbatim
    (`BaseStats`, `CombatantStats extends BaseStats`, `ObjectStats extends BaseStats`), plus:
    ```ts
    export interface EnemyDef extends CombatantStats {
      id: string;
      name: string;
      color: number;  // placeholder tint until the real sprite is wired (Step 2)
    }
    export interface InspectableStats {
      name: string;
      maxHp: number;
      currentHp?: number;
      extra?: { label: string; value: string }[];
    }
    ```
    Update the existing `ResourceNodeDef` and `BuildableDef` interfaces to also `extends
    ObjectStats` (check their current fields first — `ResourceNodeDef` already has `maxHp`, so
    extending `ObjectStats` just adds `armour`/`speed` as new required fields; `BuildableDef` gains
    `maxHp`/`armour`/`speed` all as new fields).
  - Create `src/data/enemies.ts` mirroring `src/data/nodes.ts`'s exact style (header comment,
    `Record<string, EnemyDef>` keyed catalog):
    ```ts
    export const ENEMIES: Record<string, EnemyDef> = {
      kidZombie: {
        id: 'kidZombie', name: 'Kid Zombie', color: 0x6b8f3e,
        maxHp: 3, armour: 0, speed: 45, vision: 80, strength: 1, dex: 0, dodge: 0,
      },
    };
    ```
  - In `src/data/nodes.ts`, add `armour: 0, speed: 0` to the `tree` entry (inert placeholders, see
    Context). In `src/data/buildables.ts`, add `maxHp: 10, armour: 0, speed: 0` to the `wall` entry
    (same — `maxHp` is a real display stat per the locked decision, `armour`/`speed` are inert).
  - Create `src/systems/combat.ts` mirroring `tasks.ts`/`pathfind.ts`'s header-comment-plus-pure-
    functions style (no Phaser import): `meleeDamage`, `rangedDamage`, `hitChance`, `damageTaken`,
    and `resolveMeleeAttack` exactly as specified in Context & decisions. `resolveMeleeAttack` should
    take a `rng: () => number` parameter (defaulting to `Math.random`) so the hit-chance roll is
    injectable/deterministic for the Step 8 smoke test rather than hardcoding `Math.random()` inside
    the pure function.
  - Add `UNARMED_BASE_DAMAGE = 1` and `CONTACT_DAMAGE_COOLDOWN_MS = 1000` to `src/config.ts` next to
    the other tunables (the latter is used by Step 4, defined here since it's a combat tunable).
  - Side effects: the new required fields on `ResourceNodeDef`/`BuildableDef` are **not** optional,
    so grep for every existing literal of each type (currently just `NODES.tree` and
    `BUILDABLES.wall` per Step 1's own research — confirm no others exist) and update them in the
    same pass or `npm run build` will fail to type-check.
  - Docs: none (internal data model, covered by the Step 8 doc pass).
  - Done when: `npm run build` type-checks with the new fields/file in place; a quick manual check
    in a scratch script or the browser console that `resolveMeleeAttack({...player defaults},
    {...kidZombie defaults}, UNARMED_BASE_DAMAGE)` returns `1` confirms the formula composes as
    intended before any scene code consumes it.

- [x] **Step 2: Wire the kid zombie tileset entry** `[delegate]`
  - Outcome: `tileset.ts` gained `actors.kidZombie`/`kidZombieDamaged` (9+9 filename-sorted paths) +
    `kidZombieFrameKey`/`kidZombieDamagedFrameKey` helpers. `PreloadScene.ts` loads both frame
    sets. `GameScene.ts::create()` builds `'kid-zombie-walk'`/`'kid-zombie-damaged'` anims right
    after `'player-walk'` (guarded, no sprite/spawn yet — that's Step 4). Verified via a real
    headless-browser run: zero 404s/console errors, both anim keys exist with 9 frames each.
  - In `src/data/tileset.ts`, extend `TilesetManifest`'s `actors` shape to add zombie frame lists
    alongside the existing `player: string[]`, e.g. `kidZombie: string[]` (walk cycle, the 9 files
    in `public/assets/tilesets/zombie-apocalypse/sprites/kid-zombie-animation-frames/`) and
    `kidZombieDamaged: string[]` (the 9 files in
    `.../sprites/damaged-kid-zombie-animation-frames/`). Populate `ZOMBIE_APOCALYPSE_TILESET`'s
    `actors` with both arrays, each entry a path relative to
    `public/assets/tilesets/zombie-apocalypse/sprites/`, in filename-sorted order (mirror exactly
    how `actors.player`'s 9 entries are listed — same folder-then-sequential-filename style).
  - Add zombie equivalents of the existing `playerFrameKey` helper (check its exact name/signature
    around `tileset.ts:61-64` and mirror it 1:1, e.g. `kidZombieFrameKey(i)` /
    `kidZombieDamagedFrameKey(i)`), and equivalents of however `PreloadScene`/wherever
    `ACTIVE_TILESET.actors.player` frames get `this.load.image()`'d and turned into a Phaser
    animation (`GameScene.ts:115-122` builds `'player-walk'` — find where those images are loaded,
    likely `PreloadScene.ts`, and add the same for the zombie's two frame sets, naming the anims
    `'kid-zombie-walk'` and `'kid-zombie-damaged'`).
  - Side effects: preload adds ~18 more small image loads; check `PreloadScene.ts`'s loading-bar
    logic (if any) isn't hardcoded to an expected asset count.
  - Docs: none.
  - Done when: `npm run dev`, open the browser console, confirm no 404s for the new asset paths and
    that `this.anims.get('kid-zombie-walk')` / `'kid-zombie-damaged'` exist (inspectable via
    `window.game.anims` in devtools). The zombie doesn't need to be on-screen yet — that's Step 4.

- [x] **Step 3: Player stats, facing, and HP** `[inline]`
  - Outcome: `GameScene` gained `playerStats: CombatantStats` (from new `PLAYER_MAX_HP`/
    `PLAYER_START_SPEED`/`PLAYER_START_VISION` config constants), `playerHp`, `lastFacing`, and
    `damagePlayer()` (emits `player:hpChanged`, restarts the scene at 0 HP). Migrated the old
    `this.speed`/`VISION_RADIUS` reads to `this.playerStats.speed`/`.vision` (single source of
    truth, small contained rename). `lastFacing` is updated in `advancePath()` from the sign of
    the current waypoint delta. **Judgement call beyond the plan's literal text:** since
    `scene.restart()` reuses the same Scene instance (class field initializers don't rerun),
    added an explicit reset block at the top of `create()` clearing every plain-data
    collection/counter (`trees`, `sites`, `occupied`, `queue`, `zombies`, etc.) — otherwise a
    death-restart would accumulate stale entries instead of giving a clean respawn. `npm run
    typecheck` passes once Step 4/5 consume `damagePlayer`/`lastFacing` (both were flagged
    `noUnusedLocals` until wired up, expected given how tightly these steps couple).
  - In `GameScene.ts`, add `playerStats: CombatantStats` initialized to the Context & decisions
    "Player" row (`{ maxHp: 10, armour: 0, speed: 90, vision: 80, strength: 0, dex: 0, dodge: 0 }`
    — pull the `10`/`90`/`80` into named `config.ts` constants `PLAYER_MAX_HP`,
    `PLAYER_START_SPEED`, `PLAYER_START_VISION` rather than inlining, since these were previously
    separate ad hoc things (`this.speed`, the global `VISION_RADIUS`) now consolidating here).
    Judgement call: also migrate the existing `this.speed`-based movement code and any fog-of-war
    code currently reading `VISION_RADIUS` directly to read `this.playerStats.speed`/`.vision`
    instead, so there's one source of truth — do this if it's a small, contained rename; leave a
    `// TODO` and skip it if the fog-of-war code turns out to be more tangled than expected (not
    worth blocking this step on an unrelated refactor).
  - Add a separate mutable `playerHp: number` (starts at `playerStats.maxHp`) — kept apart from
    `playerStats` exactly like `TreeNode.hp` is kept apart from `ResourceNodeDef.maxHp`.
  - Add a `damagePlayer(amount: number)` method: `playerHp = Math.max(0, playerHp - amount)`; emit
    `player:hpChanged` (`{ hp: playerHp, maxHp: playerStats.maxHp }`) whenever `playerHp` changes,
    following the existing `tasks:changed`/`build:modeChanged` event convention. If `playerHp` hits
    0: `console.log` a message (e.g. `'player down — restarting'`), then call `this.scene.restart()`
    — do this **last**, after the log and event emit, since Phaser tears the scene down immediately
    on restart. No in-place HP reset — death means starting the scene over (see Context &
    decisions's "Death = restart" entry): player, trees, sites, and the zombie all return to their
    initial spawn state for free, since `create()` reruns from scratch.
  - Add a `lastFacing: { dCol: number; dRow: number }` field (defaulting to `{ dCol: 0, dRow: 1 }`,
    facing down), updated: in Combat mode from the movepad's current nonzero vector each frame it's
    active (this step just adds the field/update-hook; Step 6 wires the actual movepad input that
    feeds it); in Command/pathfind movement, from the sign of the current waypoint delta each time
    `advancePath()` picks a new waypoint (capture the existing direction, don't recompute it).
  - Side effects: none yet beyond the optional speed/vision migration above — nothing calls
    `damagePlayer`, reads `lastFacing`, or resolves an attack against `playerStats` until Steps 4-6.
  - Docs: none.
  - Done when: `npm run build` passes; a manual `window.game.scene.getScene('Game').damagePlayer(1)`
    in devtools console logs the emitted event (check via a temporary
    `game.events.on('player:hpChanged', console.log)` in devtools) and clamps/resets correctly at 0.

- [x] **Step 4: Zombie runtime unit + minimal chase/contact-damage AI** `[inline]`
  - Outcome: `ZombieUnit` interface + `zombies: ZombieUnit[]` array added to `GameScene.ts`,
    mirroring `TreeNode`. One `kidZombie` spawns at a fixed test tile `(11, 30)` — 10 tiles south
    of the player's spawn `(11, 20)`, well outside the zombie's `vision: 80px` (5 tiles) so it
    starts genuinely idle rather than immediately aggroing. `updateZombies()` runs every frame:
    idle→chasing on a vision-radius check, chase via `findPath` re-planned every ~300ms +
    `advanceZombie()` (a per-zombie duplicate of `advancePath`'s waypoint-walk, parameterized by
    sprite/path/speed rather than forcing a shared function per the plan's "don't force a shared
    function if the existing code isn't already factored for reuse" guidance), contact damage via
    `resolveMeleeAttack` + `damagePlayer` on `CONTACT_DAMAGE_COOLDOWN_MS`. No new Arcade collider
    between player and zombie — contact damage is tile-distance-based, per plan. `npm run
    typecheck` passes.
  - In `GameScene.ts`, add a scene-local `interface ZombieUnit { id: string; sprite:
    Phaser.GameObjects.Sprite; def: EnemyDef; hp: number; alive: boolean; col: number; row: number;
    state: 'idle' | 'chasing'; lastContactAt: number; lastRepathAt: number; path: {col:number;
    row:number}[] }`, mirroring `TreeNode`'s shape/placement exactly. Add a `zombies: ZombieUnit[]`
    array (mirrors `trees`).
  - Spawn exactly one `kidZombie` instance at scene creation, at a fixed test tile a few tiles from
    the player's start position (pick any currently-walkable, unobstructed tile — check `occupied`/
    tree placement to avoid overlap), `hp: ENEMIES.kidZombie.maxHp`, `state: 'idle'`, sprite textured
    with `kidZombieFrameKey(0)` from Step 2, playing `'kid-zombie-walk'` only while actually moving
    (mirror `updatePlayerAnim`'s velocity-gated play/stop pattern) and forcing frame 0 at rest.
  - Add a per-frame (or throttled) update step for each live zombie: compute the world-px distance
    to the player; if `state === 'idle'` and that distance is within `zombie.def.vision`, set
    `state = 'chasing'` (this *is* the aggro check — no separate radius constant). If `'chasing'`:
    if adjacent to the player (tile distance ≤ 1) and `now - lastContactAt >=
    CONTACT_DAMAGE_COOLDOWN_MS` (the `config.ts` constant added in Step 1), call
    `resolveMeleeAttack(zombie.def, this.playerStats, UNARMED_BASE_DAMAGE)` from `systems/combat.ts`
    and apply the returned amount via `damagePlayer(...)`, updating `lastContactAt` regardless of
    whether the roll hit (the cooldown gates *attempts*, not just successful hits); else, if `now -
    lastRepathAt >= 300`, recompute a path to the player's current tile via `systems/pathfind.ts`'s
    existing A* function (same one `GameScene` already calls for the worker) and advance the zombie
    toward the next waypoint using the same `physics.moveTo`-based waypoint approach `advancePath()`
    uses for the player (extract/duplicate the minimal piece needed — don't force a shared function
    if the existing code isn't already factored for reuse, but do check first whether it's easy to
    parameterize `advancePath`-style logic to take an arbitrary sprite+path instead of assuming
    `this.player`).
  - Side effects: the zombie sprite needs its own physics body separate from the player's; check
    collision/overlap setup doesn't need new Arcade colliders for this slice (contact damage this
    slice is tile-distance-based, not physics-overlap-based, to keep it simple).
  - Docs: none.
  - Done when: loading the game shows the kid zombie sprite on the map; walking the player within
    the zombie's `vision` distance makes it start moving toward the player; standing adjacent for a
    few seconds visibly ticks `playerHp` down (checkable via the Step 3 devtools listener) at the
    cooldown rate, not every frame — and given every current entity's `dodge: 0`, every attempt
    should land (this is a good moment to sanity-check the `hitChance` floor/clamp is doing the
    right thing, even though it's a no-op at these starting numbers).

- [x] **Step 5: Punch action** `[inline]`
  - Outcome: `GameScene.punch()` computes `playerTile() + lastFacing`, finds a live zombie by
    tile-equality, resolves damage via `resolveMeleeAttack(playerStats, zombie.def,
    UNARMED_BASE_DAMAGE)`, destroys + removes the zombie at `hp <= 0` (no stump-equivalent, per
    plan). Wired to a new `combat:punch` game-event (emitted by Step 6's Punch button), registered/
    torn down alongside the other `build:*`/`tasks:*` listeners. `npm run build` (typecheck + vite
    build) passes.
  - In `GameScene.ts`, add a `punch()` method: compute the facing tile
    (`playerTile() + lastFacing`, using `systems/grid.ts` helpers), find a live zombie in
    `zombies` occupying that tile (mirror how `treeAt()` hit-tests, but by tile-equality against
    `zombie.col`/`row` rather than a world-space rect), and if found: call
    `resolveMeleeAttack(this.playerStats, zombie.def, UNARMED_BASE_DAMAGE)` from
    `systems/combat.ts` and subtract the returned amount from `zombie.hp` (this is the one place
    Punch's "flat 1 damage" actually resolves — via the shared formula, not a hardcoded `1`); if
    `zombie.hp <= 0`, set `alive = false`, destroy its sprite, and remove it from `zombies` (mirror
    however `chop()`'s felling/removal works for consistency, including whether felled trees leave
    a stump — a dead zombie can just be removed outright, no zombie-stump equivalent needed).
  - Wire `punch()` to fire on a `combat:punch` event (emitted by the Combat-mode Punch button —
    built in Step 6) via `this.game.events.on('combat:punch', () => this.punch())` in the scene's
    event-wiring section (mirror where `build:toggle`/`tasks:cancel` listeners are already
    registered).
  - Side effects: none beyond the `zombies` array mutation already covered.
  - Docs: none.
  - Done when: with the Step 6 Punch button in place, tapping it while facing the zombie reduces its
    HP by 1 per press, and it disappears after 3 punches (matching `maxHp: 3`). Until Step 6 exists,
    this is verifiable by manually emitting the event from devtools:
    `window.game.events.emit('combat:punch')`.

- [x] **Step 6: Combat mode — HUD toggle, movepad, Punch button** `[inline]`
  - Outcome: `UIScene` gained COMBAT/INSPECT toggle buttons (left side, below the wood/queue
    readout) emitting `mode:combatToggle`/`mode:inspectToggle`, a virtual movepad (circle base +
    knob, bottom-right, drag tracked via a scene-level pointermove/up gated by pointer id) and a
    Punch button (bottom-left), both hidden outside Combat mode. `GameScene` owns the authoritative
    `mode` (mirrored back to UIScene via `mode:changed`, re-emitted on death-restart since UIScene
    itself doesn't restart), drives player velocity directly from `combat:move`/`combat:moveEnd`
    (bypassing the task queue), and cancels any in-flight Command-mode task on entering Combat.
    **Judgement calls beyond the plan's literal text** (verified necessary via a real headless-
    browser run, not just typecheck):
    1. Gated the existing tap-to-pathfind/queue-paint logic in `onPointerMove`/`onPointerUp`
       behind `mode === 'command'` — without this, a world tap/drag while in Combat mode still
       queued Command-mode move orders that fought the movepad's direct velocity control, and
       Inspect-mode taps fell through to Command-mode move orders too (Step 7 will replace the
       blanket `if (this.mode !== 'command') return` with an explicit Inspect branch + a
       combat-only return in that same spot).
    2. Guarded `update()`'s idle-branch `setVelocity(0,0)` behind `mode !== 'combat'` — otherwise
       every frame's queue-empty check (Combat mode never populates the queue) stomped the
       velocity `onCombatMove` had just set, so the player never actually moved.
    3. Movepad facing snaps to the drag's **dominant axis** (cardinal, not raw per-axis sign) —
       found via live testing: a near-vertical drag still carries a tiny nonzero horizontal
       component, and `Math.sign` on that noise flipped `lastFacing` diagonal, so Punch missed a
       zombie the player was squarely facing. Confirmed fixed: toggled Combat, walked to the
       zombie via the movepad, Punch landed 3/3 (zombie destroyed on the 3rd), then toggled back
       through Inspect to Command and confirmed tap-to-move still works unchanged.
  - In `UIScene.ts`, add a small mode-toggle control (two icon-style buttons or a single
    cycle-button — match whatever's visually simplest given the existing HUD button template) that
    tracks a local `mode: 'command' | 'combat' | 'inspect'` and emits `mode:combatToggle` /
    `mode:inspectToggle` on press (toggling that mode on flips the other off if it was active —
    mutually exclusive, per the locked decision). `GameScene` listens for these, updates its own
    mode state, and emits `mode:changed` with the resulting mode back to `UIScene` so the HUD (this
    step) and the Inspect panel (Step 7) can react to the authoritative mode.
  - When `mode === 'combat'`: show a virtual movepad in the bottom-right (a fixed circular base +
    draggable knob, standard mobile-joystick pattern — `pointerdown`/`pointermove`/`pointerup`
    scoped to a HUD zone already excluded from world-tap handling via `hudHitTest`/`hudElements`)
    emitting `combat:move` with a normalized `{dx, dy}` vector on drag and `combat:moveEnd` on
    release, and a Punch button bottom-left (same Rectangle+Text template as other HUD buttons)
    emitting `combat:punch` on tap. Hide both when leaving Combat mode.
  - In `GameScene.ts`, listen for `combat:move`: while in Combat mode, directly set the player
    body's velocity from the vector (scaled by `this.playerStats.speed`, or `this.speed` if Step 3
    left the migration as a TODO) instead of going through
    `advancePath()`/the task queue, and update `lastFacing` (Step 3) from the vector whenever it's
    nonzero; `combat:moveEnd` zeroes velocity. Ensure entering Combat mode doesn't fight with an
    in-flight Command-mode task (e.g. clear/pause the current `TaskQueue` action on entering Combat
    mode — simplest correct behavior: treat it like the existing Cancel action).
  - Side effects: check the existing pinch-zoom/pan gesture handling in `onPointerDown`/`Move`/`Up`
    doesn't fire while a finger is on the movepad or Punch button (should already be excluded via
    `hudHitTest`, but verify — the movepad's drag shouldn't be mistaken for the world-pan drag
    threshold logic).
  - Docs: none.
  - Done when: toggling Combat mode shows the movepad+Punch button and hides on toggle-off;
    dragging the movepad moves the player directly (visibly not path-following); tapping Punch while
    facing the zombie damages it (ties together Step 5).

- [x] **Step 7: Inspect mode — stats panel + tap routing** `[inline]`
  - Outcome: new `src/systems/stats.ts` (`treeStats`/`wallStats`/`zombieStats`/
    `playerCombatStats`, the last unused this slice per plan — schema completeness, same pattern as
    `rangedDamage` in Step 1). `TreeNode`/`BuildSite`/`ZombieUnit` exported from `GameScene.ts` so
    `stats.ts` can type against them (type-only import, no runtime circular dependency).
    `GameScene.onPointerUp` gates `mode === 'inspect'` into a new `inspectAt()` (zombie → tree →
    site priority, emits `inspect:show`/`inspect:hide`) ahead of the Step 6 `mode !== 'command'`
    return, exactly as anticipated there. `UIScene` renders a centered stats panel (title/HP/extra
    rows), shown on `inspect:show`, hidden on `inspect:hide` / tapping the panel itself / leaving
    Inspect mode. Verified live in-browser: tree, kid zombie (full combatant stat block), and a
    building blueprint (`Status: Building`) each show correct panels; tapping empty ground and
    tapping the panel itself both dismiss it; Command-mode tap-to-move/chop/build all still work
    unchanged after cycling through every mode.
  - Write four adapter functions mapping runtime instances to `InspectableStats` (probably
    colocated in `src/data/types.ts` or a new small `src/systems/stats.ts` if that reads cleaner —
    use judgement, keep them simple pure functions, no new class hierarchy). **Objects and
    combatants populate different fields**, per the locked "armour/speed are inert for objects"
    decision — object adapters must NOT surface `armour`/`speed` (they'd always read a meaningless
    `0`), combatant adapters should surface the full stat block:
    - `treeStats(node: TreeNode): InspectableStats` → `{ name: 'Tree', maxHp: node.def.maxHp,
      currentHp: node.hp }` (no `extra` — no other display-worthy fields on a tree this slice).
    - `wallStats(site: BuildSite): InspectableStats` → `{ name: 'Wall', maxHp:
      BUILDABLES.wall.maxHp, extra: [{ label: 'Status', value: site.done ? 'Built' : 'Building' }]
      }` (no `currentHp` — walls have no runtime damage state this slice, just the static
      display stat plus its build-progress status).
    - `zombieStats(unit: ZombieUnit): InspectableStats` → `{ name: unit.def.name, maxHp:
      unit.def.maxHp, currentHp: unit.hp, extra: [{ label: 'Armour', value:
      String(unit.def.armour) }, { label: 'Speed', value: String(unit.def.speed) }, { label:
      'Vision', value: String(unit.def.vision) }, { label: 'Strength', value:
      String(unit.def.strength) }, { label: 'Dodge', value: String(unit.def.dodge) }] }`.
    - `playerCombatStats(stats: CombatantStats, hp: number): InspectableStats` → same shape as
      `zombieStats`, sourced from `this.playerStats`/`this.playerHp` (named `playerCombatStats` to
      avoid clashing with the `playerStats` field already added on `GameScene` in Step 3).
  - In `GameScene.ts`'s pointer-up handling (`actionAt()` / around `GameScene.ts:482-485`), add an
    early branch: if `mode === 'inspect'`, hit-test the tapped point against zombies (by tile),
    then trees (`treeAt`, already exists), then build sites, in that priority order (closest-thing-
    wins is fine, but pick zombie-first since they're the newest/most interesting), and if a hit is
    found, emit `inspect:show` with that entity's adapted `InspectableStats`; if the tap hits empty
    ground, do nothing (no panel, no command — Inspect mode issues no commands at all, per the
    locked decision). Skip the existing tree/move fallthrough entirely while in Inspect mode.
  - In `UIScene.ts`, listen for `inspect:show` and render a simple panel (a `Rectangle` + `Text`
    block is enough — name, HP or `currentHp/maxHp`, any `extra` rows) positioned somewhere it
    won't collide with the mode-toggle/movepad zones; add it to `hudElements` while visible so a tap
    dismissing it doesn't leak through as a world tap. Dismiss on tapping the panel itself (emit
    `inspect:hide`) or on tapping anywhere else while it's open (simplest: any subsequent tap while
    a panel is open closes it rather than opening a new one, unless that tap is itself on another
    inspectable entity — use judgement, don't over-build this).
  - Side effects: confirm Command-mode tap behavior (tree/build-site/move) is provably untouched —
    the new branch must be a strict `mode === 'inspect'` gate at the very top of the existing
    handler, not interleaved with it.
  - Docs: none.
  - Done when: toggling Inspect mode and tapping the zombie, a tree, or a wall each shows a stats
    panel with that entity's name + HP; tapping empty ground shows nothing; toggling back to
    Command mode restores today's exact tap behavior (verify chop/build/move all still work).

- [x] **Step 8: Smoke test coverage + docs** `[delegate — done inline, retained full plan context]`
  - Outcome: `GameScene.debugState()` extended with `zombies`/`playerHp`/`mode`. `scripts/smoke.mjs`
    gained a combat pass: Inspect-mode panels for the zombie/tree/wall + empty-ground dismiss,
    movepad-driven approach to the zombie, contact-damage ticking `playerHp` down, death triggering
    `scene.restart()` with position/zombie/mode verified back at initial spawn state, then (post-
    restart) walking to the fresh zombie and Punching it dead in 3 hits. All 4 doc files updated
    (CLAUDE.md Status, GAME-DESIGN.md MVP item 4 + Enemy design note, DECISIONS.md — 4 new dated
    entries, ASSETS.md — kid zombie wired-in note); also corrected the tileset pack's own
    `public/assets/tilesets/zombie-apocalypse/README.md`, which still claimed "not wired into the
    game loader yet" (stale since before plan 003, but caught during this doc pass).
  - **Real bug found and fixed via the full smoke run** (not just the new assertions): the new
    permanent COMBAT/INSPECT toggle buttons occupy screen space that a **pre-existing** smoke-test
    tap (`center(2, 2)`, chosen before these buttons existed) now lands on at `MIN_ZOOM`. That
    silently toggled Combat mode mid-run, which (correctly, per Step 6's mode-gating) swallowed
    several *subsequent* Command-mode tap/long-press assertions — cascading into ~4 unrelated-
    looking failures (queue-paint outline, hold-drag queueing, final pathfind-around-obstacle
    check) that had nothing to do with their own logic. Relocated that tap to `center(2, 6)`,
    clear of the new HUD row; documented why inline. `npm run build && npm run smoke` — full suite
    green, zero console/page errors.
  - Extend `scripts/smoke.mjs` (mirror its existing style — `toClient`/`worldToClient` helpers,
    `ok`/`fail` assertions, drives the real page) to add a combat pass: toggle Combat mode, tap the
    movepad to walk toward the zombie's fixed spawn tile, tap Punch three times facing it, assert
    (via `window.game` state — however `zombies`/`playerHp` end up exposed for inspection, e.g. a
    debug getter on the scene mirroring however `trees`/`inventory` are currently exposed to the
    smoke script) that the zombie is gone after 3 punches; separately assert standing adjacent long
    enough ticks `playerHp` down and, once it hits 0, the scene restarts (re-query `window.game`
    state afterward and confirm the player's HP/position and the zombie are back to their initial
    spawn values, re-`waitForFunction(() => window.game?.isBooted)`-style settling first if the
    restart needs a beat); toggle Inspect mode and tap the tree/wall/zombie(if still alive)/spawn a
    fresh one if needed, asserting a stats
    panel appears with expected fields. Keep assertions loose on exact pixel positions/timing the
    same way the existing chop/build assertions already tolerate.
  - Update docs:
    - `CLAUDE.md` Status section: note Combat mode + Punch + the first zombie + Inspect mode landed
      (plan 003), same terse style as the existing plan 001/002 summary sentence.
    - `docs/GAME-DESIGN.md`: mark MVP slice item 4 ("Night: a short timed wave...") as partially
      done — the punch/zombie/contact-damage piece exists, wave-spawning/day-night tint/traps still
      todo — and add a short note under "Enemy design" that the roaming/aggro model here is
      deliberately a minimal stub (idle/chasing only), full nuance still to design.
    - `docs/DECISIONS.md`: append dated `[DECIDED]` entries for the mode-toggle model (Command/
      Combat/Inspect, mutually exclusive), the tap-on-entity resolution (dedicated Inspect mode,
      not tap/long-press overload), the object-inspection scope (trees + walls, no new crate), and
      the shared-stats-via-adapters approach (vs. a deep class hierarchy) — mirror the existing
      terse `## YYYY-MM-DD — [DECIDED] Title` + one-paragraph-rationale format exactly.
    - `docs/ASSETS.md`: note the kid zombie is now wired in from the staged tileset (walk +
      damaged-reaction frames), still placeholder-tinted rather than fully styled.
  - Side effects: none beyond the files touched.
  - Docs: this step *is* the doc pass — see above.
  - Done when: `npm run build && npm run preview` in one terminal, `npm run smoke` in another,
    all assertions pass including the new combat ones; all four doc files updated.

## Critique

Fresh-eyes review verdict: well-researched and accurate about the codebase, but the data/combat
layer over-builds for a first slice whose only content is one enemy and one flat-damage attack.

|#|Finding|Lens|Severity|Outcome|
|---|---|---|---|---|
|1|Full stats schema + `combat.ts` (dex, dodge/hit-chance roll, `rangedDamage`, `activationRange`) exercised by nothing this slice actually does|Alternative approaches / Right-sizing|High|**Kept as-is, deliberately** — explicit user call to lock the full shape in now rather than revisit piecemeal later (see Context & decisions)|
|2|8 steps bundle 3 input modes + combat engine + AI + tileset wiring + inspector + smoke tests + 4 doc updates into one pass — denser than plans 001/002|Right-sizing / scope discipline|Medium|Not addressed — still open, see below|
|3|Plan pivots to combat while CLAUDE.md's Status line says "Next: survival systems (day/night, hunger)"; Step 8 doesn't reconcile that pointer|Roadmap/strategic fit|Medium|Not addressed — still open, see below|
|4|In-place HP reset on death let an adjacent zombie immediately re-damage the "reset" player (silent death-loop)|Gaps & risks|Low|**Resolved** — death now triggers `scene.restart()` instead of an in-place heal (see Context & decisions's "Death = restart" entry); the whole scene resets, so the zombie can't still be adjacent|

Findings #2 and #3 remain open as of this critique pass — not yet decided with the user.

## Out of scope

- Ranged weapons/ammo (pistol/shotgun), and any weapon-switching UI.
- NPC companions actually fighting, or existing at all as a second friendly unit.
- Traps, base-defense placement, and the full night-wave spawner/pacing/day-night tint.
- Full roaming-vs-attacking nuance from GAME-DESIGN.md (noise-based aggro, deaggro, pack-pulling,
  multiple enemy types beyond the one kid zombie, wandering-while-idle) — this slice's AI is
  intentionally just idle/chasing on a radius check.
- Wall HP/damage *from combat* (breaching, zombies attacking walls) — only a static display stat
  is added to `BuildableDef` this slice; walls remain indestructible in play.
- Any functional use of `armour`/`speed` on objects (trees/walls) — present in the data for schema
  consistency, explicitly inert (no damage math reads them, nothing moves by them, the inspector
  hides them for objects).
- Balancing Strength/Dex/Dodge/Armour beyond the placeholder starting numbers in Context &
  decisions, and any ranged-damage use of Dex (no ranged weapon exists to call `rangedDamage` yet —
  it's defined for schema completeness only).
- Any UI exposing raw hit-chance/dodge math to the player (e.g. a "% to hit" readout) — the roll
  happens invisibly inside `resolveMeleeAttack`.
- A game-over screen/message, death penalties beyond losing the run's progress, and any
  "reload last save" behavior — no save system exists yet, so `scene.restart()` is the whole
  mechanic this slice; it just isn't dressed up with UI/messaging.
- Directional player/zombie sprites or animations — facing is gameplay-logic-only this slice.
- New placeholder crate/box entity — inspectable objects are trees + walls only.
- Damage numbers/floating combat text, sound effects, hit-flash VFX, screen shake — purely
  functional combat this slice, juice comes later.
