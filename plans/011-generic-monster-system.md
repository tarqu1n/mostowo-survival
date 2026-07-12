# Generic Monster System (AI states + swappable weapons)

> Status: planned — run /execute-plan to begin. Code anchors are from a source sweep on 2026-07-12;
> **reconfirm each `file:line` before editing** (they drift).

## Summary

Turn the single-behaviour "kid zombie" (rendered as the Pixel Crawler **Skeleton – Base**) into a
**generic, data-driven monster** that other mobs (the rest of the Skeleton Crew, the Orc Crew) can
reuse. Two halves:

1. **Behaviour** — a proper AI state machine (`idle · wander · patrol · chase`) extracted into a
   **pure, unit-tested** `src/systems/` module. Radius-only aggro; **distance-only de-aggro** with a
   "losing the scent" **veer band** at the edge of chase range; wander = aimless random roam with
   pauses; patrol = a set route with pauses. Plus wiring the real **idle bob** animation the pack
   ships but we never loaded.
2. **Weapons** — give the monster a **held weapon** via **runtime anchor-pinning** (an `AttachPoint`
   per animation frame; one weapon sprite repositioned every tick), so weapons are **swappable /
   randomised** with zero baked art. Each skeleton spawns with a **club** (slow, 2 dmg) or a
   **knife** (fast, 1 dmg), wired through to real attack damage + cadence. The attack "animation" is
   a **coded swing** (rotate the weapon about its grip) since the pack ships no mob attack strip.

Proven by: `npm run build` clean · `npm test` (new unit + data tests green) · `npm run smoke` green ·
a manual screenshot/behaviour eyeball (weapon sits in the hand through idle/walk and mirrors on
left-facing; a chased player at the range edge sees the monster veer off; club vs knife visibly
differ in pace and damage).

## Context & decisions

### Direction fit
`CLAUDE.md` **Next: enemy night-waves + the equipment queue**. This plan is the substrate for both: a
generic monster (AI + equippable weapon) is what night-waves spawn and what an equipment queue arms.
It intentionally stops short of the wave scheduler and the equip UI (see Out of scope).

### Locked with Matt (do NOT re-litigate)
- **Patrol vs wander:** *patrol* = walks a **set path**, pausing occasionally; *wander* = **entirely
  random** roam, stopping and changing direction. Both are distinct calm states; `idle` is the pause.
- **De-aggro:** **distance only** (no timeout). As the player nears the outer edge of chase range the
  monster **keeps chasing but veers off** (injected path noise, ramping with distance) as if losing
  track; past the hard drop distance it gives up and returns to its calm state.
- **Spotting:** **radius only** — aggro when the player is within range, **no line-of-sight/wall
  occlusion**.
- **Idle:** **wire the real 4-frame Idle bob** (`Skeleton - Base/Idle/Idle-Sheet.png`), not the
  current frozen Run-frame-0. Its canvas is **32px** vs Run's **64px**, so it needs its own render
  footprint (see idle-footprint decision below).
- **Weapons:** **club** (slow attack, **2** damage) or **knife** (fast attack, **1** damage),
  **randomised per spawn**, **swappable** by design.

### Architecture (from the advisor — implement this shape)
- **Runtime anchor-pinning, NOT plan 010's baked per-frame strips.** One weapon sprite pinned to a
  per-frame `AttachPoint`; swap/randomise is O(1) and the coded swing is a tween on that one sprite
  (impossible with baked strips). This is the live pilot of **plan 010's own critique finding #3**.
- **Diverge from the player intentionally, share the primitives.** Monster = one *rigid* hand weapon
  → pin it. Player (plan 010, deferred) = *deformable* multi-slot armour → strips. Share the
  low-level **`AttachPoint` shape + the pure transform fn** so plan 010's *rigid* slots
  (helmet/mainHand/offHand) later adopt pinning as a **refactor, not a rewrite**. Record that
  convergence intent in `docs/DECISIONS.md`.
- **Anchor data lives on `StripAnim`** — an anchor array is meaningless except relative to a specific
  strip's frames, and co-location lets a data test assert `anchors.mainHand.length === frames`.
- **Sync the weapon EVERY update tick, not on the `animationupdate` event** — the lunge/veer tweens
  slide the sprite *between* frame changes, so an event-only sync goes stale (mirrors plan 010's
  locked per-tick approach).
- **Art vs gameplay split (matches the codebase):** weapon **art** (source PNG, grip pivot, draw `z`,
  scale) goes in the **manifest** `tileset.ts` (role-based, pack-relative paths — like `tiles.tree`);
  weapon **gameplay** (damage, attack cadence, display name) goes in **`src/data/`** (like `nodes.ts`
  bundles a node's gameplay). Keyed by a shared weapon `id`.

### Idle-footprint decision
Add an optional `render?: ActorRender` to `StripAnim`. When a strip's canvas differs from the actor
default (the 32px idle vs the 64px default), it carries its own scale/origin; GameScene applies the
active strip's render on state change. Idle art is 32px → render at **`scale: 2`** (integer, stays
crisp) with an origin that keeps the feet on the tile, so it visually matches the 64px Run. All other
strips omit `render` and inherit the actor default (no change to walk/death).

### Weapon combat model
- `club`: `damage 2`, `attackMs ≈ 1500` (slow). `knife`: `damage 1`, `attackMs ≈ 750` (fast).
- Bite resolution today: `resolveMeleeAttack(z.def, playerStats, UNARMED_BASE_DAMAGE, rng)` gated by
  `CONTACT_DAMAGE_COOLDOWN_MS` (`GameScene.ts:~1708-1716`). Change to feed the **equipped weapon's**
  `damage` as the base and gate on the **weapon's `attackMs`** (per-zombie), so a knife bites roughly
  twice as often as a club. Unarmed (no weapon) keeps `UNARMED_BASE_DAMAGE` + the shared cooldown.

### AI model (pure FSM)
- Extract the idle→chase decision (currently private in `updateZombies`, `GameScene.ts:~1690-1729`)
  into **`src/systems/monsterAI.ts`**: a pure `stepMonster(prev, inputs, rng) → decision` where
  `inputs` carry monster tile + world pos, player world pos, `acquireRadiusPx` (= `def.vision`),
  `chaseDropRadiusPx`, `veerBandPx`, `veerMaxTiles`, patrol route + index, and elapsed timers.
  `decision` returns the next `mode`, an optional **target tile** (already veer-perturbed for chase),
  and a `repath` flag. GameScene keeps doing the *effects* (A* `findPath`, `advanceZombie`, tween
  movement) — the pure fn only decides mode + target. RNG injected (mirror `combat.ts`'s `rng`) so
  tests are deterministic.
- States: `idle` (stand, play idle bob, wait a random `MONSTER_IDLE_MS`), then → `wander` (pick a
  random reachable tile within `MONSTER_WANDER_RADIUS_TILES`, walk it, back to idle) **or** `patrol`
  (advance to the next route waypoint, pause, next) depending on whether the monster has a patrol
  route. `chase` on acquire; within the veer band, perturb the chase target tile by up to
  `veerMaxTiles` (ramping with proximity to the drop radius); past `chaseDropRadiusPx` → back to calm.
- **Genericity:** the system is parameterised by `EnemyDef` + weapon data, so a new mob is a new
  `EnemyDef` (+ manifest render skin) with no logic change. Only `kidZombie`/skeleton is wired now;
  a per-enemy-id render manifest (multiple skins) is **deferred** (one enemy exists today).

### Codebase seams (reconfirm before editing)
- `src/config.ts` — enemy/combat constants live `~:110-174` (`CONTACT_DAMAGE_COOLDOWN_MS=1000` `:133`,
  `UNARMED_BASE_DAMAGE=1` `:122`, `ZOMBIE_LUNGE_PX=7` `:163`/`ZOMBIE_LUNGE_MS=120` `:164`,
  `DEATH_HOLD_MS` `:174`). **No aggro/chase-range constant exists** and the repath cadence is a
  hardcoded `300` literal (`GameScene.ts:~1718`). Add the AI + swing constants here.
- `src/data/tileset.ts` — `StripAnim` `:38-44`, `ActorRender` `:47-51`, enemy actor `:165-173`
  (`render` `:168`, `walk`/`death` strips), keys `enemyWalkKey` `:202`/`enemyDeathKey` `:205`. **Add**
  `AttachPoint`, `StripAnim.anchors?`/`StripAnim.render?`, enemy `idle` strip + `weapons` catalogue.
- `src/data/types.ts` — `EnemyDef` `:102-106`, `CombatantStats` `:42-47`. **Add** `EnemyDef.weaponPool?`.
- `src/data/enemies.ts` — `kidZombie` `:8-20`. **Add** its `weaponPool: ['club','knife']`.
- `src/data/__tests__/data.test.ts` — `ENEMIES` invariants `~:106-137`. **Add** the anchor-length +
  weapon-pool-validity data tests here.
- `src/systems/combat.ts` — `resolveMeleeAttack` `:27-35`. New pure modules `monsterAI.ts` +
  `attachment.ts` sit alongside; tests in `src/systems/__tests__/`.
- `src/scenes/GameScene.ts` — `ZombieUnit` `:106-119`; anim-create loop `:400-417`;
  `spawnZombies`/`addZombie` `:1626-1654`; `advanceZombie` `:1658-1675`; `updateZombieAnim`
  `:1678-1687`; `updateZombies` `:1690-1729`; `zombieLungeAt` `:1248-1274`; tween-map cleanup
  `cleanupActorFx` `:1279-1285` / `resetCombatFx` `:1289-1299`; `killZombie` `:1307-1325` (note the
  **TEMP** `CORPSE_LINGER_MS` 5-min override `:1318-1320` — leave as-is, out of scope); punch-death
  path `punch()` `:1150-1165`; `debugState` `:1972-2027`; scenario apply `:1914-1919`.
- `src/scenes/PreloadScene.ts` — actor strip loads `:97-98` (currently only `enemy.walk`/`enemy.death`).
- Tests: unit (`src/systems/__tests__/`, `npm test`), scenario (`tests/e2e/*.spec.ts` via
  `window.game.__test` seam in `tests/e2e/harness.ts`; enemy coverage `tests/e2e/combat.spec.ts`),
  boot canary (`scripts/smoke.mjs`, `npm run smoke`).

### Verification reality
`npm run smoke` catches load 404s / boot exceptions but **cannot** validate per-frame weapon
alignment or AI feel (as with plans 005/010). So acceptance = build + unit/data tests + smoke green
**plus** a manual eyeball. Pure logic (AI decisions, attach transform) is the machine-checkable core;
the visual pin + swing feel needs a human screenshot.

## Steps

- [ ] **Step 1: AI + swing constants (config)** `[inline]`
  - In `src/config.ts` add, with terse comments: `MONSTER_CHASE_DROP_RADIUS_PX` (hard de-aggro dist,
    ~200), `MONSTER_VEER_BAND_PX` (outer band where chase degrades, ~60), `MONSTER_VEER_MAX_TILES`
    (~3), `MONSTER_REPATH_MS` (300 — replaces the `updateZombies` literal), `MONSTER_IDLE_MS_MIN`/
    `MONSTER_IDLE_MS_MAX` (~700/2000), `MONSTER_WANDER_RADIUS_TILES` (~4), `MONSTER_PATROL_PAUSE_MS`
    (~1000), and swing feel `WEAPON_SWING_ARC_DEG` (~75), `WEAPON_SWING_SCALE_POP` (~1.12),
    `WEAPON_SWING_MS` (~140, ≤ `ZOMBIE_LUNGE_MS`-ish so rotated pixels never dwell). Acquire radius
    stays `EnemyDef.vision` (no new const).
  - Side effects: none (new exports only). Done when: `tsc` clean; constants exported.

- [ ] **Step 2: Data + manifest schema — anchors, idle strip, weapon catalogue** `[inline]`
  - `src/data/tileset.ts`: add `export interface AttachPoint { x: number; y: number; rot?: number }`
    (frame-canvas px, degrees). Extend `StripAnim` with optional `anchors?: { mainHand?: AttachPoint[] }`
    (doc: length MUST equal `frames`) and `render?: ActorRender` (per-strip footprint override; doc
    the idle-footprint reason). Extend the `enemy` actor with `idle: StripAnim` (the 32px
    `Skeleton - Base/Idle/Idle-Sheet.png`, `frameSize: 32, frames: 4`, its own `render:{scale:2,…}`,
    and `anchors.mainHand` = 4 hand points) and `weapons: Record<string, { source: TileSource;
    pivot: [number, number]; z: number; scale?: number }>` for `club` + `knife` (`source` =
    `{kind:'image', path:'_derived/weapons/<name>.png'}`). Also add `mainHand` anchors to the existing
    `walk` strip (6 points). Add an `enemyIdleKey='enemy-idle'` export. **Leave anchor coordinates as
    rough first-pass values** (hand-tuned in Step 6/7 against the previewer/game).
  - `src/data/weapons.ts` (new): `export const MONSTER_WEAPONS: Record<string, { id: string; name:
    string; damage: number; attackMs: number }>` = club `{damage:2, attackMs:1500}`, knife
    `{damage:1, attackMs:750}` (pull the numbers from config if you prefer; keep art out of here).
  - `src/data/types.ts`: add `weaponPool?: string[]` to `EnemyDef`. `src/data/enemies.ts`: set
    `kidZombie.weaponPool = ['club','knife']`.
  - `src/data/__tests__/data.test.ts`: add tests — (a) every `enemy` StripAnim with `anchors.mainHand`
    has `length === frames`; (b) every id in every `EnemyDef.weaponPool` exists in `MONSTER_WEAPONS`
    **and** in the manifest `weapons` catalogue.
  - Side effects: `StripAnim`/`ActorRender` are reused by the player too — additions are **optional**,
    so the player manifest and PreloadScene/GameScene still compile unchanged. Docs: module doc in
    `tileset.ts` (note anchors + per-strip render as new behaviour). Done when: `tsc` + `npm test`
    green; new data tests pass; `ACTIVE_TILESET` player path unchanged.

- [ ] **Step 3: Extract club + knife art from `Bone.png`** `[inline]`
  - Use `python3 scripts/pixel-crawler/extract.py --list "Weapons/Bone/Bone.png"` to read component
    indices/bboxes, **eyeball which is a club and which is a knife/dagger**, then
    `extract.py "Weapons/Bone/Bone.png" <idx> _derived/weapons/club.png` and likewise `knife.png`.
    Verify each is a single clean component at a sensible pixel size (`sips`/`--list`). Pick a grip
    end for each (informs Step 2's `pivot`).
  - Side effects: writes only under `public/assets/tilesets/pixel-crawler/_derived/weapons/`
    (pack-safe, like the tree/rock). Docs: add two rows to the derived-file manifest in
    `docs/ASSETS.md` (`output ← source sheet · component index`). Done when: both PNGs exist, are
    single-object, and load via `load.image` without error.

- [ ] **Step 4: Pure monster-AI state machine + unit tests** `[inline]`
  - New `src/systems/monsterAI.ts`: a pure `stepMonster(prev, inputs, rng)` (types exported) with the
    FSM in Context (idle/wander/patrol/chase; radius acquire = `inputs.acquireRadiusPx`; distance-only
    de-aggro with the veer-band perturbation; wander vs patrol by presence of a route). No Phaser
    imports — operate on plain `{col,row}`/world coords + numbers; return `{ mode, targetTile?,
    repath }`. Injected `rng: () => number`.
  - `src/systems/__tests__/monsterAI.test.ts`: cover acquire at radius edge; **no** acquire just
    outside; chase→give-up past drop radius; veer perturbation stays within `veerMaxTiles` and ramps
    with distance; wander picks within radius; patrol advances waypoints + wraps; determinism with a
    seeded rng.
  - Side effects: none (new pure module). Docs: none. Done when: `npm test` green; module has zero
    Phaser/scene imports.

- [ ] **Step 5: Pure weapon-attach transform + unit tests** `[inline]`
  - New `src/systems/attachment.ts`: pure `weaponTransform({ anchor, actorRender, stripRender,
    frameW, frameH, flipX, extraRot })` → `{ x, y, rotation, flipX }` (offset relative to the actor
    origin in world px, honouring the strip's own render when present; **flipX mirrors the x-offset
    and negates rotation**; `extraRot` is the additive swing angle). This is the shared primitive
    plan 010's rigid slots will reuse.
  - `src/systems/__tests__/attachment.test.ts`: symmetric x under flipX; rotation negates under flipX;
    `extraRot` adds to the anchor's resting `rot`; a 32px-strip anchor maps to the same world offset
    as the equivalent 64px point (footprint independence).
  - Side effects: none. Docs: none. Done when: `npm test` green; no Phaser imports.

- [ ] **Step 6: Wire idle anim + the AI system into GameScene** `[inline]`
  - **Load** the idle strip: extend `PreloadScene.ts:97-98` to also load `enemy.idle` (its own
    frameSize).
  - **Anim create** (`GameScene.ts:400-417`): add an `enemyIdleKey` looping anim (frameRate ~6 for a
    slow bob, `repeat:-1`).
  - **AI wiring** (`updateZombies` `:1690-1729`): replace the inline idle→chase block with a call to
    `stepMonster(...)`; add the per-instance AI fields to `ZombieUnit` (`:106`) — `mode`,
    `modeSinceMs`/timers, `wanderTarget?`, `patrolRoute?`, `patrolIndex`. Use `MONSTER_REPATH_MS`
    (drop the `300` literal). Feed `def.vision` as acquire radius + the new config radii. Chase target
    comes from `stepMonster` (already veer-perturbed) → existing `findPath`/`advanceZombie`.
  - **Idle render + anim** (`updateZombieAnim` `:1678-1687`): when the monster is in a stationary calm
    mode play `enemyIdleKey` (apply the idle strip's `render` — swap `setScale`/`setOrigin` on state
    change, revert to the actor default when moving); when moving play `enemyWalkKey`. Keep `flipX`
    from velocity.
  - **Scenario support**: allow `ScenarioSpec.zombies` (`:159`, applied `:1914-1919`) to specify an
    optional `patrolRoute` and `mode`, and surface the monster `mode` in `debugState` (`:1972-2027`)
    for Step 8.
  - Side effects: touches the enemy update/render path only; player untouched. The idle-render swap
    must not fight `fitActorBody` — recompute/leave the body as today (body sizing stays on the 64px
    footprint; only the *sprite* display swaps). Docs: none (Step 9). Done when: build clean; in-game
    a monster idles with the bob, wanders/patrols, chases on approach, and **veers off then gives up**
    as the player reaches the range edge.

- [ ] **Step 7: Wire the weapon — pin, swing, combat** `[inline]`
  - **Instance state**: add `weapon?: { id: string; sprite: Phaser.GameObjects.Sprite; def:
    (typeof MONSTER_WEAPONS)[string]; swingRot: number }` to `ZombieUnit` (`:106`).
  - **Spawn/roll** (`addZombie` `:1630-1654`): if the `EnemyDef.weaponPool` is non-empty, pick one
    (random, or a scenario override), create the weapon sprite from the manifest `weapons[id]`
    (texture = the derived image, `setOrigin` at the **grip pivot**, `setDepth(sprite.depth + z)`,
    `setScale`, no physics body); store on the unit.
  - **Load** (`PreloadScene.ts`): `load.image` each manifest `weapons[*].source` (static, no anim).
  - **Per-tick sync** (in the enemy update, EVERY tick — not `animationupdate`): read
    `sprite.anims.currentFrame?.index ?? 0`, look up the active strip's `anchors.mainHand[index]`,
    call `weaponTransform(...)` with the current `flipX` + the unit's additive `swingRot`, and apply
    to the weapon sprite.
  - **Swing** (extend `zombieLungeAt` `:1248-1274`): alongside the body lunge, tween the unit's
    `weapon.swingRot` through an arc (`WEAPON_SWING_ARC_DEG`, yoyo, `WEAPON_SWING_MS`) + a small
    `WEAPON_SWING_SCALE_POP`; register in a weapon-tween map cleaned up by `cleanupActorFx`
    (`:1279-1285`) / `resetCombatFx` (`:1289-1299`) so a death mid-swing can't poke a destroyed
    sprite.
  - **Combat effect** (bite resolution `:1708-1716`): feed the equipped weapon's `damage` as the base
    into `resolveMeleeAttack` and gate `lastContactAt` on the **weapon's `attackMs`** (fall back to
    `UNARMED_BASE_DAMAGE` + `CONTACT_DAMAGE_COOLDOWN_MS` when unarmed). So knife ≈ 2× the bite rate of
    a club, club hits for 2.
  - **Death** (`killZombie` `:1307-1325` **and** the punch-death path `punch()` `:1150-1165`): detach
    + hide (or `destroy`) the weapon sprite; stop its swing tween.
  - Side effects: the enemy `depth` (`setDepth(9)`) must leave room for `+z`; ensure the weapon draws
    in front for this side-facing rig. Corpse linger is unchanged. Docs: none (Step 9). Done when:
    build clean; a skeleton visibly holds its weapon through idle/walk, mirrors on left-facing, swings
    on attack; club-armed vs knife-armed monsters differ in pace and in HP removed per hit.

- [ ] **Step 8: Test coverage — scenario + smoke + debug hooks** `[inline]`
  - Add `debugState` fields for the enemy `mode` and equipped `weaponId` (already partly done in
    Step 6). New `tests/e2e/monster.spec.ts` (or extend `combat.spec.ts`): (a) a monster in range
    enters `chase`; (b) a monster driven to the range edge **gives up** (`mode` leaves `chase`);
    (c) a **club** spawn removes 2 HP per landed bite and a **knife** removes 1 (force the weapon via
    the scenario override); (d) a patrol-route monster cycles waypoints. Reuse the
    `applyScenario`/`step`/`state` seam.
  - Run `npm run smoke` and fix any load 404 / boot error (new idle + weapon images, new anim keys).
  - Side effects: test-only + the small `debugState` additions. Docs: none. Done when: `npm test` +
    `npm run e2e` + `npm run smoke` all green.

- [ ] **Step 9: Docs** `[delegate sonnet]`
  - `docs/ASSETS.md` — a short **"Weapon attachment (runtime pinning)"** note under the sprite
    pipeline: anchors-on-`StripAnim`, one pinned sprite synced per tick, coded swing, the two derived
    weapon rows (from Step 3), and the wired idle strip (32px footprint). Cross-link, don't duplicate,
    the extraction section.
  - `docs/DECISIONS.md` — log: monster weapons via **runtime pinning** (chosen over baked strips;
    pilots plan 010 finding #3); **intentional divergence from plan 010** with **shared primitives**
    (`AttachPoint` + `weaponTransform`) and the **convergence intent** (010's rigid slots later adopt
    pinning); AI = pure FSM, **radius aggro / distance-only de-aggro with a veer band**; wander vs
    patrol semantics; club/knife stats. Note plan 010 stays **deferred/untouched**.
  - `docs/STATUS.md` — one entry: generic monster AI + swappable weapons landed (plan 011).
  - `CLAUDE.md` Status — one lean line.
  - `scripts/pixel-crawler/README.md` — one row if extraction usage changed (else skip).
  - Side effects: docs only. Done when: docs match the shipped code + the DECISIONS entry states the
    010 relationship.

## Out of scope

- **All player equipment / plan 010** — stays deferred and untouched; this plan only *shares
  primitives* it will later reuse.
- **The Python anchor-stamp tooling** (seed/stamp/preview) — runtime pinning needs none.
- **Enemy weapon → inventory/loot** — no dropping the weapon on death, no picking it up; it's just
  hidden/destroyed on kill.
- **Death-frame weapon anchoring** — the weapon detaches/hides on death rather than tracking the 96px
  collapse frames (deferred flavour).
- **Multi-slot monster gear / armour** — one `mainHand` weapon only.
- **A per-enemy-id render manifest (multiple mob skins)** — the *systems* are generic, but only the
  one skeleton skin is wired; new skins are a later add.
- **Enemy night-waves / spawn scheduler** and the **equipment queue UI** — the milestone this feeds,
  not built here.
- **Line-of-sight aggro** — radius only this pass.
- Fixing the **TEMP `CORPSE_LINGER_MS`** 5-min override — pre-existing, left as-is.
