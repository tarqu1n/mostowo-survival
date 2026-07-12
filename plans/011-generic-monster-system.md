# Generic Monster System (AI states + swappable weapons)

> Status: planned — run /execute-plan to begin. **Sequenced AI-first** (Matt's call after the
> critique): **Phase A** (monster AI FSM — clean, unit-tested, the night-waves prerequisite) lands and
> is reviewed **before** **Phase B** (weapons + idle bob — visual, eyeball-gated). You can stop after
> Phase A if priorities shift. Code anchors are from a source sweep on 2026-07-12 — **reconfirm each
> `file:line` before editing** (they drift).

## Critique

Fresh-eyes review (independent sub-agent, source-only), run on the first draft.

**Verdict:** Well-grounded and on the right technical path (runtime anchor-pinning is the correct,
advisor-backed, roadmap-aligned call over 010's baked strips) — but the plan bundles a clean,
fully-testable, night-waves-critical AI FSM with a riskier, eyeball-only weapon+idle-footprint
subsystem, so the real question is whether to split/sequence, not any defect in the "how."

| # | Finding | Lens | Severity | Suggested action |
| - | ------- | ---- | -------- | ---------------- |
| 1 | Couples the roadmap-critical, unit-testable AI FSM with a visually-risky, human-verify-only weapon-attachment + idle-footprint subsystem; the stated "Next" (night-waves) needs only the AI half, and contact damage already works without held weapons | Right-sizing / roadmap | Medium | **RESOLVED — sequenced AI-first (Phase A / Phase B) in one plan, review gate between** |
| 2 | Piloting runtime pinning supersedes 010's stamp-tool + rigid-slot baked strips (010's own finding #3), yet it's framed only as "shared primitives, 010 deferred/untouched" — a future session could resume 010's now-redundant tooling | Cross-cutting consistency / reversibility | Medium | Step B7 records pinning **supersedes** the stamp tool for rigid slots (only deformable chest/legs still need strips) **and updates 010's header** |
| 3 | The two biggest new pieces have no machine gate: per-tick weapon pin and the 32px→`scale:2` idle render swap on a physics-bodied sprite vs `fitActorBody` — the scale/origin↔Arcade-body interaction rests entirely on a manual eyeball | Executability / gaps & risks | Medium | Steps B4/B5 stay `[inline]` + per-step review; the idle scale-swap↔body interaction is called out as its own in-step check |
| 4 | Patrol state is built ahead of any consumer — no live monster has a route (scenario/test-only); wander is the only roaming mode the design doc names | Right-sizing | Low | Accepted (locked with Matt, cheap branch in a pure fn) — noted as test-only surface until content uses it |
| 5 | Weapon-stat source-of-truth hedged ("pull from config if you prefer"); and manifest `weapons.scale?` isn't constrained to integers despite the settled integer-pixel-scale decision | Cross-cutting consistency | Low | `src/data/weapons.ts` is the **single** source for damage/attackMs; weapon `scale` **must be integer** |

## Summary

Turn the single-behaviour "kid zombie" (rendered as the Pixel Crawler **Skeleton – Base**) into a
**generic, data-driven monster** that other mobs (the rest of the Skeleton Crew, the Orc Crew) can
reuse. Delivered in two sequenced phases:

- **Phase A — Behaviour (clean, testable).** A proper AI state machine
  (`idle · wander · patrol · chase`) extracted into a **pure, unit-tested** `src/systems/` module.
  Radius-only aggro; **distance-only de-aggro** with a "losing the scent" **veer band** at the edge of
  chase range; wander = aimless random roam with pauses; patrol = a set route with pauses. This is the
  half the stated **Next (enemy night-waves)** actually needs, and it has full machine coverage.
- **Phase B — Weapons + idle bob (visual, eyeball-gated).** Give the monster a **held weapon** via
  **runtime anchor-pinning** (an `AttachPoint` per animation frame; one weapon sprite repositioned
  every tick), so weapons are **swappable / randomised** with zero baked art. Each skeleton spawns
  with a **club** (slow, 2 dmg) or a **knife** (fast, 1 dmg), wired to real damage + cadence; the
  attack "animation" is a **coded swing** (rotate the weapon about its grip) since the pack ships no
  mob attack strip. Also wires the real **idle bob** the pack ships but we never loaded.

Proven by: `npm run build` clean · `npm test` (new unit + data tests green) · `npm run smoke` green ·
and — for Phase B only — a manual screenshot/behaviour eyeball (weapon sits in the hand through
idle/walk and mirrors on left-facing; club vs knife visibly differ in pace and damage). Phase A is
fully machine-verifiable (pure-logic unit tests + scenario assertions on monster `mode`).

## Context & decisions

### Direction fit
`CLAUDE.md` **Next: enemy night-waves + the equipment queue**. Phase A (a generic monster with a
proper AI FSM) is the direct night-waves prerequisite and lands first. Phase B (an equippable,
swappable weapon) is the substrate the equipment queue arms. The plan stops short of the wave
scheduler and the equip UI (see Out of scope).

### Locked with Matt (do NOT re-litigate)
- **Patrol vs wander:** *patrol* = walks a **set path**, pausing occasionally; *wander* = **entirely
  random** roam, stopping and changing direction. Both are distinct calm states; `idle` is the pause.
  (Per critique #4: patrol is **test/scenario-only surface until real content authors a route** — the
  branch is a cheap arm of the pure FSM, kept so night-waves content can use it without a rework.)
- **De-aggro:** **distance only** (no timeout). As the player nears the outer edge of chase range the
  monster **keeps chasing but veers off** (injected path noise, ramping with distance) as if losing
  track; past the hard drop distance it gives up and returns to its calm state.
- **Spotting:** **radius only** — aggro when the player is within range, **no line-of-sight/wall
  occlusion**.
- **Idle:** **wire the real 4-frame Idle bob** (`Skeleton - Base/Idle/Idle-Sheet.png`) — Phase B. Its
  canvas is **32px** vs Run's **64px**, so it needs its own render footprint (see below). Phase A keeps
  today's frozen Run-frame-0 idle pose; Phase B upgrades it.
- **Weapons:** **club** (slow attack, **2** damage) or **knife** (fast attack, **1** damage),
  **randomised per spawn**, **swappable** by design.

### Architecture (from the advisor — implement this shape)
- **Runtime anchor-pinning, NOT plan 010's baked per-frame strips.** One weapon sprite pinned to a
  per-frame `AttachPoint`; swap/randomise is O(1) and the coded swing is a tween on that one sprite
  (impossible with baked strips). This is the live pilot of **plan 010's own critique finding #3**.
- **Supersedes, not merely diverges (critique #2).** Runtime pinning is now the chosen path for
  *rigid* attachments (monster weapon; and later the player's *rigid* slots — helmet/mainHand/offHand).
  Plan 010's **anchor-stamp tool + rigid-slot baked strips become redundant**; only 010's
  **deformable** slots (chest/legs cloth/mail via matching-pack strips) still need the strip approach.
  Step B7 records this **and updates 010's header** so a future session doesn't resume the dead tool.
- **Share the primitives.** Monster and the player's future rigid slots share the low-level
  **`AttachPoint` shape + the pure `weaponTransform` fn**, so 010's rigid slots later adopt pinning as
  a **refactor, not a rewrite**.
- **Anchor data lives on `StripAnim`** — an anchor array is meaningless except relative to a specific
  strip's frames, and co-location lets a data test assert `anchors.mainHand.length === frames`.
- **Sync the weapon EVERY update tick, not on the `animationupdate` event** — the lunge/veer tweens
  slide the sprite *between* frame changes, so an event-only sync goes stale (mirrors plan 010's
  locked per-tick approach).
- **Art vs gameplay split (matches the codebase):** weapon **art** (source PNG, grip pivot, draw `z`,
  integer scale) goes in the **manifest** `tileset.ts` (role-based, pack-relative paths — like
  `tiles.tree`); weapon **gameplay** (damage, attack cadence, display name) is owned **solely** by
  **`src/data/weapons.ts`** (critique #5 — no duplicate in config). Keyed by a shared weapon `id`.

### Idle-footprint decision (Phase B)
Add an optional `render?: ActorRender` to `StripAnim`. When a strip's canvas differs from the actor
default (32px idle vs 64px default), it carries its own scale/origin; GameScene applies the active
strip's render on state change. Idle art is 32px → render at **`scale: 2`** (integer, stays crisp)
with an origin that keeps the feet on the tile, so it visually matches the 64px Run. All other strips
omit `render` and inherit the actor default (no change to walk/death). **Critique #3:** the
scale/origin swap must not disturb the Arcade physics body — body sizing (`fitActorBody`) stays on the
64px footprint; only the *sprite* display swaps. This interaction is an explicit in-step check in B4.

### Weapon combat model (Phase B)
- Canonical stats in `src/data/weapons.ts`: `club { damage: 2, attackMs: ~1500 }` (slow),
  `knife { damage: 1, attackMs: ~750 }` (fast). No second copy in config.
- Bite resolution today: `resolveMeleeAttack(z.def, playerStats, UNARMED_BASE_DAMAGE, rng)` gated by
  `CONTACT_DAMAGE_COOLDOWN_MS` (`GameScene.ts:~1708-1716`). Change to feed the **equipped weapon's**
  `damage` as the base and gate on the **weapon's `attackMs`** (per-zombie), so a knife bites roughly
  twice as often as a club. Unarmed (no weapon) keeps `UNARMED_BASE_DAMAGE` + the shared cooldown.

### AI model (pure FSM — Phase A)
- Extract the idle→chase decision (currently private in `updateZombies`, `GameScene.ts:~1690-1729`)
  into **`src/systems/monsterAI.ts`**: a pure `stepMonster(prev, inputs, rng) → decision` where
  `inputs` carry monster tile + world pos, player world pos, `acquireRadiusPx` (= `def.vision`),
  `chaseDropRadiusPx`, `veerBandPx`, `veerMaxTiles`, patrol route + index, and elapsed timers.
  `decision` returns the next `mode`, an optional **target tile** (already veer-perturbed for chase),
  and a `repath` flag. GameScene keeps doing the *effects* (A* `findPath`, `advanceZombie`, tween
  movement). RNG injected (mirror `combat.ts`'s `rng`) so tests are deterministic.
- States: `idle` (stand, wait a random `MONSTER_IDLE_MS`), then → `wander` (random reachable tile
  within `MONSTER_WANDER_RADIUS_TILES`, walk it, back to idle) **or** `patrol` (advance to the next
  route waypoint, pause, next) depending on whether the monster has a patrol route. `chase` on
  acquire; within the veer band, perturb the chase target by up to `veerMaxTiles` (ramping with
  proximity to the drop radius); past `chaseDropRadiusPx` → back to calm.
- **Genericity:** parameterised by `EnemyDef` + weapon data, so a new mob is a new `EnemyDef` (+
  manifest render skin) with no logic change. Only `kidZombie`/skeleton is wired now; a per-enemy-id
  render manifest (multiple skins) is **deferred** (one enemy today).

### Codebase seams (reconfirm before editing)
- `src/config.ts` — enemy/combat constants `~:110-174` (`CONTACT_DAMAGE_COOLDOWN_MS=1000` `:133`,
  `UNARMED_BASE_DAMAGE=1` `:122`, `ZOMBIE_LUNGE_PX=7` `:163`/`ZOMBIE_LUNGE_MS=120` `:164`,
  `DEATH_HOLD_MS` `:174`). **No aggro/chase-range constant exists**; repath cadence is a hardcoded
  `300` literal (`GameScene.ts:~1718`).
- `src/data/tileset.ts` — `StripAnim` `:38-44`, `ActorRender` `:47-51`, enemy actor `:165-173`,
  keys `enemyWalkKey` `:202`/`enemyDeathKey` `:205`.
- `src/data/types.ts` — `EnemyDef` `:102-106`, `CombatantStats` `:42-47`.
- `src/data/enemies.ts` — `kidZombie` `:8-20`.
- `src/data/__tests__/data.test.ts` — `ENEMIES` invariants `~:106-137`.
- `src/systems/combat.ts` — `resolveMeleeAttack` `:27-35`; new pure modules `monsterAI.ts` +
  `attachment.ts` sit alongside; tests in `src/systems/__tests__/`.
- `src/scenes/GameScene.ts` — `ZombieUnit` `:106-119`; anim-create loop `:400-417`;
  `spawnZombies`/`addZombie` `:1626-1654`; `advanceZombie` `:1658-1675`; `updateZombieAnim`
  `:1678-1687`; `updateZombies` `:1690-1729`; `zombieLungeAt` `:1248-1274`; tween-map cleanup
  `cleanupActorFx` `:1279-1285` / `resetCombatFx` `:1289-1299`; `killZombie` `:1307-1325` (note the
  **TEMP** `CORPSE_LINGER_MS` 5-min override `:1318-1320` — leave as-is, out of scope); punch-death
  path `punch()` `:1150-1165`; `debugState` `:1972-2027`; scenario apply `:1914-1919`
  (`ScenarioSpec.zombies` `:159`).
- `src/scenes/PreloadScene.ts` — actor strip loads `:97-98` (currently only `enemy.walk`/`enemy.death`).
- Tests: unit (`src/systems/__tests__/`, `npm test`), scenario (`tests/e2e/*.spec.ts` via
  `window.game.__test` seam in `tests/e2e/harness.ts`; enemy coverage `tests/e2e/combat.spec.ts`),
  boot canary (`scripts/smoke.mjs`, `npm run smoke`).

### Verification reality
`npm run smoke` catches load 404s / boot exceptions but **cannot** validate per-frame weapon alignment
or AI feel. **Phase A** is fully machine-checkable (pure unit tests + scenario assertions on `mode`).
**Phase B** acceptance additionally needs a **manual eyeball** for the weapon pin/swing + the idle
scale-swap (critique #3).

## Steps

### Phase A — Monster AI FSM (review gate at end of phase)

- [x] **Step A1: AI / movement config constants** `[inline]`
  - In `src/config.ts` add, with terse comments: `MONSTER_CHASE_DROP_RADIUS_PX` (hard de-aggro dist,
    ~200), `MONSTER_VEER_BAND_PX` (outer band where chase degrades, ~60), `MONSTER_VEER_MAX_TILES`
    (~3), `MONSTER_REPATH_MS` (300 — replaces the `updateZombies` literal), `MONSTER_IDLE_MS_MIN`/
    `MONSTER_IDLE_MS_MAX` (~700/2000), `MONSTER_WANDER_RADIUS_TILES` (~4), `MONSTER_PATROL_PAUSE_MS`
    (~1000). Acquire radius stays `EnemyDef.vision` (no new const). **No weapon/swing constants yet
    (Phase B).**
  - Side effects: none (new exports only). Done when: `tsc` clean; constants exported.
  - Outcome: added an 8-const "Monster AI tuning" block to `src/config.ts` (after `ZOMBIE_LUNGE_MS`,
    before the death-timing block) with the values above and a terse doc comment. Only file touched.
    `npx tsc --noEmit` clean.

- [x] **Step A2: Pure monster-AI state machine + unit tests** `[inline]`
  - New `src/systems/monsterAI.ts`: pure `stepMonster(prev, inputs, rng)` (types exported) with the
    FSM in Context (idle/wander/patrol/chase; radius acquire = `inputs.acquireRadiusPx`; distance-only
    de-aggro with the veer-band perturbation; wander vs patrol by presence of a route). No Phaser
    imports — plain `{col,row}`/world coords + numbers; return `{ mode, targetTile?, repath }`.
    Injected `rng: () => number`.
  - `src/systems/__tests__/monsterAI.test.ts`: acquire at radius edge; **no** acquire just outside;
    chase→give-up past drop radius; veer perturbation stays within `veerMaxTiles` and ramps with
    distance; wander picks within radius; patrol advances waypoints + wraps; determinism with a seeded
    rng.
  - Side effects: none (new pure module). Done when: `npm test` green; module has zero Phaser/scene
    imports.
  - Outcome: added `src/systems/monsterAI.ts` (pure FSM) + `src/systems/__tests__/monsterAI.test.ts`
    (13 tests). Decision shape is `{ state, targetTile, repath }` — the caller **persists `state`**
    (its `.mode` is the FSM mode), moves toward `targetTile` (`null` = stand), and repaths only when
    `repath` is true. State carries `timerMs` (idle/patrol-pause gate, `0` = no gate),
    `goalTile`/`patrolRoute`/`patrolIndex`, `lastChaseRepathMs`. Added a `initialMonsterState(route?)`
    factory and an exported `chaseVeerMaxTiles(...)` ramp helper. **Arrival at a roam goal is detected
    by tile-equality** (`monster` tile == `goalTile`) — so A3 must snap the monster tile onto reached
    waypoints (as `advanceZombie` already does) and add a small guard so an unreachable roam pick
    (empty A* path) doesn't leave the monster standing forever. All 118 unit tests green; `tsc` clean;
    zero Phaser/scene imports.

- [x] **Step A3: Wire the AI system into GameScene** `[inline]`
  - `updateZombies` (`:1690-1729`): replace the inline idle→chase block with a `stepMonster(...)` call;
    add per-instance AI fields to `ZombieUnit` (`:106`) — `mode`, `modeSinceMs`/timers, `wanderTarget?`,
    `patrolRoute?`, `patrolIndex`. Use `MONSTER_REPATH_MS` (drop the `300` literal). Feed `def.vision`
    as acquire radius + the new config radii. Chase target from `stepMonster` (already veer-perturbed)
    → existing `findPath`/`advanceZombie`. **Idle stays today's frozen Run-frame-0 pose** (Phase B
    upgrades it) — `updateZombieAnim` (`:1678-1687`) unchanged except reading `mode` instead of a bare
    velocity check if convenient.
  - Scenario support: let `ScenarioSpec.zombies` (`:159`, applied `:1914-1919`) specify an optional
    `patrolRoute` and starting `mode`; surface the monster `mode` in `debugState` (`:1972-2027`).
  - Side effects: enemy update path only; player untouched. No manifest/data-schema change in Phase A.
  - Docs: none (Phase B's Step B7 owns docs). Done when: build clean; a monster idles, wanders (or
    patrols a scenario route), chases on approach, and **veers off then gives up** as the player reaches
    the range edge.
  - Outcome: rewired `updateZombies` to call `stepMonster` and act on `{ mode, targetTile, repath }`.
    `ZombieUnit` gained `ai: MonsterState` (nested) and **dropped** the old `state` + `lastRepathAt`
    fields (repath timing now lives in `ai.lastChaseRepathMs`; the `300` literal is gone → `MONSTER_REPATH_MS`).
    `updateZombieAnim` left unchanged (velocity-driven frozen-frame-0 idle stands). `addZombie` gained an
    `opts?: { patrolRoute?; mode? }`; `ScenarioSpec.zombies` object form accepts `patrolRoute`
    (tuples → `Cell[]`) + starting `mode`; `debugState` now returns `zombieModes: MonsterMode[]` (live,
    in order). Added a scene-side guard: an unreachable calm-mode pick (empty A* path) drops the monster
    back to idle so it re-picks (chase keeps retrying). Only `src/scenes/GameScene.ts` + `src/config.ts`
    import touched. `tsc`/`npm run build`/`npm test` (118)/`npm run smoke` all green. Behavioural proof
    (chase / give-up / patrol) is machine-verified in A4.

- [x] **Step A4: Phase-A test coverage — scenario + smoke** `[inline]`
  - New `tests/e2e/monster.spec.ts` (or extend `combat.spec.ts`) via the `applyScenario`/`step`/`state`
    seam: (a) a monster in range enters `chase`; (b) a monster driven to the range edge **gives up**
    (`mode` leaves `chase`); (c) a patrol-route monster cycles waypoints. Run `npm run smoke`; fix any
    boot error.
  - Side effects: test-only + the small `debugState` `mode` field (from A3). Done when: `npm test` +
    `npm run e2e` + `npm run smoke` all green. **← Phase A review gate: the night-waves-ready monster
    lands here, independently reviewable.**
  - Outcome: added `tests/e2e/monster.spec.ts` (3 specs: radius-acquire→chase; chase→give-up when the
    2×-faster player sprints past the 200px drop radius; patrol-route waypoint cycling). Two deviations
    from plan: (1) added a **`zombieTiles`** observable to `debugState` (+ synced the harness
    `DebugState` mirror, which was also missing A3's `zombieModes`) — `patrol` mode never returns to
    `idle`, so cycling is only provable via position. (2) **Bug fix in `updateZombies`** surfaced by the
    patrol test: A3's "empty path → reset to idle" guard conflated `findPath`'s `[]` (same-tile —
    "already there") with `null` (unreachable), so a patroller spawned **on** its first waypoint looped
    idle↔patrol forever. Now guards on `path === null` only. Files: `tests/e2e/monster.spec.ts` (new),
    `tests/e2e/harness.ts`, `src/scenes/GameScene.ts`. `tsc`/`build`/`npm test` (118)/`npm run e2e`
    (34)/`npm run smoke` all green. **Phase A complete.**

### Phase B — Weapons + idle bob (visual; eyeball-gated)

- [x] **Step B1: Data + manifest schema — anchors, idle strip, weapon catalogue, swing config** `[inline]`
  - `src/data/tileset.ts`: add `export interface AttachPoint { x: number; y: number; rot?: number }`.
    Extend `StripAnim` with optional `anchors?: { mainHand?: AttachPoint[] }` (doc: length MUST equal
    `frames`) and `render?: ActorRender` (per-strip footprint override; doc the idle-footprint reason).
    Extend the `enemy` actor with `idle: StripAnim` (the 32px `Skeleton - Base/Idle/Idle-Sheet.png`,
    `frameSize: 32, frames: 4`, its own `render:{scale:2,…}` with **integer** scale, and 4 `mainHand`
    anchors) and `weapons: Record<string, { source: TileSource; pivot: [number, number]; z: number;
    scale?: number }>` for `club` + `knife` (`source` = `{kind:'image', path:'_derived/weapons/<name>.png'}`;
    **`scale` must be an integer** — critique #5, same reason as actors/zoom). Add 6 `mainHand` anchors
    to the existing `walk` strip. Add `enemyIdleKey='enemy-idle'`. **Anchor coords are rough first-pass
    values**, hand-tuned in B4/B5.
  - `src/data/weapons.ts` (new): `export const MONSTER_WEAPONS: Record<string, { id: string; name:
    string; damage: number; attackMs: number }>` = club `{damage:2, attackMs:1500}`, knife
    `{damage:1, attackMs:750}`. **This is the single source of truth for weapon stats** (critique #5).
  - `src/data/types.ts`: add `weaponPool?: string[]` to `EnemyDef`. `src/data/enemies.ts`:
    `kidZombie.weaponPool = ['club','knife']`.
  - `src/config.ts`: add swing-feel constants `WEAPON_SWING_ARC_DEG` (~75), `WEAPON_SWING_SCALE_POP`
    (~1.12), `WEAPON_SWING_MS` (~140). (Swing *feel* only — not weapon *stats*.)
  - `src/data/__tests__/data.test.ts`: (a) every enemy StripAnim with `anchors.mainHand` has
    `length === frames`; (b) every id in every `EnemyDef.weaponPool` exists in `MONSTER_WEAPONS` **and**
    in the manifest `weapons` catalogue; (c) every manifest `weapons[*].scale` (when set) is an integer.
  - Side effects: `StripAnim`/`ActorRender` additions are **optional**, so the player manifest +
    PreloadScene/GameScene still compile unchanged. Docs: module doc in `tileset.ts`. Done when: `tsc`
    + `npm test` green; new data tests pass; `ACTIVE_TILESET` player path unchanged.
  - Outcome: `tileset.ts` — added `AttachPoint` + `WeaponArt` interfaces; extended `StripAnim` with
    optional `anchors?.{mainHand}` (frame-px space, len === frames) + `render?` footprint override;
    extended the `enemy` actor type with required `idle`/`weapons` and populated the manifest (32px
    idle strip w/ `render{scale:2,originY:0.95}` + 4 anchors — **confirmed Idle-Sheet is 128×32 = 4×32px**;
    6 walk anchors; club/knife weapon-art rows pointing at `_derived/weapons/*.png` — files land in B2);
    added `enemyIdleKey`. New `src/data/weapons.ts` (`MONSTER_WEAPONS` — club 2dmg/1500ms, knife
    1dmg/750ms, single source of truth). `types.ts` `EnemyDef.weaponPool?`; `enemies.ts`
    `kidZombie.weaponPool=['club','knife']`. `config.ts` swing-feel consts (`WEAPON_SWING_ARC_DEG 75`,
    `_SCALE_POP 1.12`, `_MS 140`). `data.test.ts` +4 tests (anchor len === frames; weaponPool resolves
    in both catalogues; weapon scale integer-when-set; MONSTER_WEAPONS keyed by id w/ positive stats).
    `tsc` clean; `npm test` 122 green (+4). Anchor/pivot/idle-origin values are rough placeholders,
    hand-tuned in B4/B5. No runtime path changed (nothing loads the new assets/keys yet).

- [x] **Step B2: Extract club + knife art from `Bone.png`** `[inline]`
  - `python3 scripts/pixel-crawler/extract.py --list "Weapons/Bone/Bone.png"` to read component
    indices/bboxes, **eyeball which is a club and which is a knife/dagger**, then
    `extract.py "Weapons/Bone/Bone.png" <idx> _derived/weapons/club.png` and likewise `knife.png`.
    Verify each is a single clean component (`sips`/`--list`). Note the grip end (informs B1's `pivot`).
  - Side effects: writes only under `.../pixel-crawler/_derived/weapons/` (pack-safe). Docs: two rows in
    the `docs/ASSETS.md` derived-file manifest. Done when: both PNGs exist, single-object, load without
    error.
  - Outcome: `--list` showed 13 components; extracted **club = idx 1** (bone mace, 14×80, bulbous knob
    top, grip+pommel bottom) and **knife = idx 7** (bone dagger, 6×27, grip bottom) → clean single
    objects (viewed), both grips at the bottom (confirms B1 pivot `[0.5, 0.9]`). Files:
    `_derived/weapons/{club,knife}.png` + 2 rows in `docs/ASSETS.md`. ⚠️ **B5 note:** the club is 80px
    vs the ~30px skeleton — oversized at native scale (integer-scale rule = no clean down-scale), so
    B5's eyeball must resolve sizing (bake a smaller derived variant, or accept a big characterful bone
    club). Flag raised at the B4/B5 check-in.

- [x] **Step B3: Pure weapon-attach transform + unit tests** `[inline]`
  - New `src/systems/attachment.ts`: pure `weaponTransform({ anchor, actorRender, stripRender, frameW,
    frameH, flipX, extraRot })` → `{ x, y, rotation, flipX }` (offset relative to the actor origin in
    world px, honouring the strip's own render when present; **flipX mirrors the x-offset and negates
    rotation**; `extraRot` is the additive swing angle). Shared primitive 010's rigid slots will reuse.
  - `src/systems/__tests__/attachment.test.ts`: symmetric x under flipX; rotation negates under flipX;
    `extraRot` adds to the anchor's resting `rot`; a 32px-strip anchor maps to the same world offset as
    the equivalent 64px point (footprint independence).
  - Side effects: none. Done when: `npm test` green; no Phaser imports.
  - Outcome: added `src/systems/attachment.ts` (`weaponTransform(input) → { x, y, rotation, flipX }`,
    pure) + `src/systems/__tests__/attachment.test.ts` (6 tests). Offset = `(anchor - origin×frameSize) ×
    scale` in world px, using the strip's own render when present (`stripRender ?? actorRender`) — that's
    what makes 32px@2 and 64px@1 agree. `flipX` mirrors x and negates the angle; `rotation` is in
    **degrees** (`anchor.rot + extraRot`) to match the swing constants. Type-only import of
    `AttachPoint`/`ActorRender` from `data/tileset` (erased at build) — **zero Phaser imports**. `tsc`
    clean; `npm test` 128 green (+6).

- [ ] **Step B4: Wire the real idle bob (32px footprint swap)** `[inline]`
  - Load the idle strip: extend `PreloadScene.ts:97-98` to also load `enemy.idle` (its own frameSize).
  - Anim create (`:400-417`): add an `enemyIdleKey` looping anim (frameRate ~6 for a slow bob,
    `repeat:-1`).
  - `updateZombieAnim` (`:1678-1687`): when the monster is in a stationary calm mode play `enemyIdleKey`
    **and apply the idle strip's `render`** (swap `setScale`/`setOrigin` on state change, revert to the
    actor default when moving); when moving play `enemyWalkKey`. Keep `flipX` from velocity.
  - **Critique #3 in-step check:** the scale/origin swap must NOT resize/move the Arcade body —
    `fitActorBody` stays on the 64px footprint; only the sprite display swaps. Explicitly verify the
    body/contact tile is unchanged across an idle↔walk transition (assert via `debugState` col/row +
    an eyeball that the feet stay on the same tile).
  - Side effects: enemy render path only. Docs: none. Done when: build clean; an idle monster visibly
    breathes/sways, and its hurtbox/contact tile is provably unchanged by the swap.

- [ ] **Step B5: Wire the weapon — pin, swing, combat** `[inline]`
  - Instance state: add `weapon?: { id; sprite: Phaser.GameObjects.Sprite; def:
    (typeof MONSTER_WEAPONS)[string]; swingRot: number }` to `ZombieUnit` (`:106`).
  - Spawn/roll (`addZombie` `:1630-1654`): if `EnemyDef.weaponPool` non-empty, pick one (random, or a
    scenario override), create the weapon sprite from manifest `weapons[id]` (texture = derived image,
    `setOrigin` at the **grip pivot**, `setDepth(sprite.depth + z)`, `setScale`, no physics body).
  - Load (`PreloadScene.ts`): `load.image` each manifest `weapons[*].source` (static, no anim).
  - Per-tick sync (EVERY tick — not `animationupdate`): read `sprite.anims.currentFrame?.index ?? 0`,
    look up the active strip's `anchors.mainHand[index]`, call `weaponTransform(...)` with current
    `flipX` + the unit's additive `swingRot`, apply to the weapon sprite.
  - Swing (extend `zombieLungeAt` `:1248-1274`): alongside the body lunge, tween `weapon.swingRot`
    through `WEAPON_SWING_ARC_DEG` (yoyo, `WEAPON_SWING_MS`) + a small `WEAPON_SWING_SCALE_POP`;
    register in a weapon-tween map cleaned up by `cleanupActorFx` (`:1279-1285`)/`resetCombatFx`
    (`:1289-1299`) so a death mid-swing can't poke a destroyed sprite.
  - Combat (bite resolution `:1708-1716`): feed the equipped weapon's `damage` as the base into
    `resolveMeleeAttack` and gate `lastContactAt` on the weapon's `attackMs` (fall back to
    `UNARMED_BASE_DAMAGE` + `CONTACT_DAMAGE_COOLDOWN_MS` when unarmed).
  - Death (`killZombie` `:1307-1325` **and** `punch()` `:1150-1165`): detach + hide/destroy the weapon
    sprite; stop its swing tween.
  - Side effects: enemy `setDepth(9)` must leave room for `+z`; weapon draws in front for this
    side-facing rig. Corpse linger unchanged. Docs: none. Done when: build clean; a skeleton holds its
    weapon through idle/walk, mirrors on left-facing, swings on attack; club vs knife differ in pace and
    HP removed per hit.

- [ ] **Step B6: Phase-B test coverage — scenario + smoke** `[inline]`
  - Extend `debugState` with the equipped `weaponId`. Scenario tests: a **club** spawn removes 2 HP per
    landed bite and a **knife** removes 1 (force the weapon via a scenario override). Run `npm run
    smoke`; fix any 404 (new idle + weapon images, new anim keys).
  - Side effects: test-only + the `debugState` `weaponId` field. Done when: `npm test` + `npm run e2e` +
    `npm run smoke` all green.

- [ ] **Step B7: Docs** `[delegate sonnet]`
  - `docs/ASSETS.md` — short **"Weapon attachment (runtime pinning)"** note: anchors-on-`StripAnim`, one
    pinned sprite synced per tick, coded swing, the two derived weapon rows (B2), the wired idle strip
    (32px footprint). Cross-link, don't duplicate, the extraction section.
  - `docs/DECISIONS.md` — log: monster weapons via **runtime pinning** (pilots 010 finding #3);
    **pinning SUPERSEDES 010's anchor-stamp tool + rigid-slot baked strips** (only deformable
    chest/legs still need strips); **shared primitives** (`AttachPoint` + `weaponTransform`) +
    convergence intent (010's rigid slots later adopt pinning); AI = pure FSM with radius aggro /
    distance-only de-aggro + veer band; wander vs patrol; club/knife stats.
  - `plans/010-layered-equipment-system.md` — **update its header** (critique #2): note that plan 011
    superseded the stamp tool / rigid-slot strips via runtime pinning; 010 remains only for the
    deformable slots + matching-pack route, still deferred.
  - `docs/STATUS.md` — one entry: generic monster AI + swappable weapons landed (plan 011).
  - `CLAUDE.md` Status — one lean line.
  - Side effects: docs only. Done when: docs match shipped code; the 010 header + DECISIONS entry state
    the supersession, not just "shared primitives".

## Out of scope

- **All player equipment / plan 010** — untouched; 011 only *shares primitives* and *records the
  supersession* of 010's now-redundant rigid-slot tooling.
- **The Python anchor-stamp tooling** (seed/stamp/preview) — runtime pinning needs none; 011 marks it
  superseded for rigid slots.
- **Enemy weapon → inventory/loot** — no dropping on death, no pickup; hidden/destroyed on kill.
- **Death-frame weapon anchoring** — weapon detaches/hides on death rather than tracking the 96px
  collapse frames.
- **Multi-slot monster gear / armour** — one `mainHand` weapon only.
- **A per-enemy-id render manifest (multiple mob skins)** — systems are generic, but only the one
  skeleton skin is wired.
- **Enemy night-waves / spawn scheduler** and the **equipment queue UI** — the milestone this feeds.
- **Line-of-sight aggro** — radius only.
- **Live patrol content** — patrol is a scenario/test-only branch until night-waves content authors a
  route (critique #4).
- Fixing the **TEMP `CORPSE_LINGER_MS`** 5-min override — pre-existing, left as-is.
