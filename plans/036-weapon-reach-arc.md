# Weapon Reach / Arc — Tile-Space Attack Shapes

> Status: planned — run /execute-plan to begin.

## Summary

Give melee a **data-driven attack shape** in tile space so a weapon can express **reach** (tiles
forward) and an **arc** (lateral/forward tile pattern) — a spear that reaches 2, a cleave that hits
several enemies at once, and (as a side benefit) melee that connects with the whole of a wide/tall
enemy rather than a single tile. Today `GameScene.attack()` hits exactly **one** tile (`feet +
lastFacing`) with hardcoded unarmed damage. This replaces that with a pure `attackTiles(...)` generator
resolved against enemy hurtboxes — **staying grid-native and deterministic** (one source of truth on
`col/row`, no physics/geometric hitboxes), and testable via the existing Tier-1 + Tier-2 harness.

Rationale + the "why tiles, not physics hitboxes" decision: see the discussion captured in
[decisions/gameplay.md](../docs/decisions/gameplay.md) (Step 5 adds the entry). Combat is the **danger
verb** per [GAME-DESIGN.md](../docs/GAME-DESIGN.md), so scope stays tight and data-driven; base-defense
crowds ([ROADMAP.md](../docs/ROADMAP.md): night wave) are the motivating use of cleave.

## Context & decisions

**Locked decisions (from planning):**

1. **Shape model = `reach` + `arc` preset.** `AttackShape = { reach: number; arc: 'single' | 'wide' |
   'line' }`. Reach = forward depth in tiles (≥1); arc = lateral profile. Chosen over a numeric
   `arcWidth` or an explicit offset list for authorability + a small, fully-testable combo space.
2. **Player melee only now; shape is _expressible_ for monsters.** The player's melee is rewired to the
   shape. The `AttackShape` type is shared and an optional `attackShape?` seam is added to the monster
   attack data, but **the skeleton + boar keep today's proximity contact-bite unchanged** (their bite is
   Chebyshev ≤1 against player body tiles — not a directed attack; see finding below). No enemy AI change.
3. **Mechanism + unarmed default + dev/test-only demo weapons.** Unarmed stays `{reach:1, arc:'single'}`
   = today's single front tile (no regression). Add a small `MELEE_WEAPONS` data map (mirrors
   `MONSTER_WEAPONS`) with demo entries (spear, cleaver) selectable via a `__test` seam (+ optional DEV
   button). **No inventory/equipment/economy item** — the player has no equipment system today and we are
   not building one here.
4. **Cleave hits every enemy in the shape, flat damage each** (one swing = N hits, each enemy once).
5. **Diagonal facing snaps to the dominant axis** inside the generator (mirrors `onCombatMove`'s existing
   snap at `GameScene.ts:1178-1187`), so an arc is always cardinal-oriented. True 8-way arcs are out of
   scope.

**Key findings (from a repo sweep — mirror these):**

- **Player facing** is `Character.lastFacing = {dCol,dRow}` (sign vector, `src/entities/Character.ts:25`).
  Combat-mode entry (`onCombatMove`) forces it **cardinal**, but `faceTile`/pathfinder can leave it
  **diagonal** — the generator must snap (decision 5). Scenario/test facings (`FacingSpec`
  `'up'|'down'|'left'|'right'`) are always cardinal (`src/entities/types.ts`, `testApi.ts:240`).
- **`GameScene.attack()`** (`src/scenes/GameScene.ts:1011-1026`): target = `feet + lastFacing` (one tile);
  `enemyManager.enemyAt(col,row)`; `resolveMeleeAttack(playerChar.stats, enemy.def, UNARMED_BASE_DAMAGE,
  rng)`; `takeDamage`; kill or `flashHit`+camera-shake. Wired on `'combat:attack'` (`:507`).
  `fx.playAttackSwing()` fires on every press (even a whiff) — keep that.
- **No player weapon/equipment exists.** `PlayerCharacter` stats are combat-neutral (strength/dex/dodge/
  armour = 0). `UNARMED_BASE_DAMAGE = 1` (`src/config.ts:142`).
- **Hurtbox helpers** (`src/systems/hurtbox.ts`, pure): `hurtboxContains(feet,box,target)`,
  `hurtboxTiles(feet,box)`, `spread(width)`, `DEFAULT_HURTBOX={1,1}`. `EnemyManager.enemyAt` uses
  `hurtboxContains` (`src/scenes/world/EnemyManager.ts:130-137`). `Hurtbox` type in `src/data/types.ts:36`.
  Tier-1 tests already in `src/systems/__tests__/hurtbox.test.ts`.
- **Combat math** (`src/systems/combat.ts`, pure): `resolveMeleeAttack(attacker, defender,
  weaponBaseDamage, rng)` → 0 on a dodge-miss else `max(0, base+strength-armour)`. dodge is 0 on
  everything today → deterministic. Tier-1 tests in `src/systems/__tests__/combat.test.ts`.
- **Monster weapons** (`src/data/weapons.ts`): `MonsterWeapon = {id,name,damage,attackMs}`;
  `MONSTER_WEAPONS = {club,knife}`. Enemy bite is **proximity** (Chebyshev ≤1 vs `playerBodyTiles`),
  telegraphed (`MonsterCharacter.update` ~`:234`) — **not** a directed attack, so it's untouched here.
- **Test harness**: `applyScenario`/`emit`/`step`/`state` (`tests/e2e/harness.ts`); `enemies` spec accepts
  `[col,row]` or `{at,id,mode,weaponId,...}` and supports multiple enemies (`combat.spec.ts:193`);
  `emit(page,'combat:attack')`. `DebugState` combat fields: `enemies, enemyModes, enemyTiles,
  enemyHitFlashes, enemyAttacks, corpses, playerHp`. ⚠️ **`refactor-tripwire.spec.ts` asserts a FULL exact
  `DebugState` snapshot** — a new field means editing `harness.ts`, `testApi.ts` (interface + serializer),
  and the golden. **This plan adds NO `DebugState` field** (reach/arc is asserted via `enemies`/`playerHp`/
  `enemyHitFlashes` outcomes + Tier-1 tile-set tests), so the tripwire needs no change — verify it stays
  green.
- **Config convention**: per-subsystem JSDoc block + `export const` group; tag constants with the plan
  number. New melee constants go near `UNARMED_BASE_DAMAGE`/`ATTACK_MOVE_SLOW` (`src/config.ts:~142`).

**Attack-tile generator semantics (author precisely — the executor must not guess):**

`attackTiles(feet: Cell, facing: {dCol,dRow}, shape: AttackShape): Cell[]`
- Snap facing to a cardinal unit `f`: `Math.abs(dCol) >= Math.abs(dRow) ? {dCol: Math.sign(dCol)||0,
  dRow:0} : {dCol:0, dRow: Math.sign(dRow)}`. If `f` is `(0,0)` (never expected), default to `{0,1}` (down).
- Perpendicular unit `p = {dCol: -f.dRow, dRow: f.dCol}`.
- `reach` clamped to `≥1`. Tiles (deduped, feet tile itself never included):
  - **`'single'`** → just the tip: `[ feet + reach·f ]`. With `reach:1` this is exactly today's one front tile.
  - **`'line'`** → the straight column, every tile in the path: `feet + d·f` for `d = 1..reach`.
  - **`'wide'`** → a 3-wide swath to depth `reach`: for `d = 1..reach`, `feet + d·f`, `feet + d·f + p`,
    `feet + d·f − p`.
- Return distinct `Cell`s (dedupe by `col,row`).

Demo weapons: `spear = {reach:2, arc:'line', damage:1}`, `cleaver = {reach:1, arc:'wide', damage:1}`.
Unarmed default (no weapon) = `{reach:1, arc:'single'}`, `damage = UNARMED_BASE_DAMAGE`.

## Steps

- [ ] **Step 1: `AttackShape` type + pure `attackTiles` generator + Tier-1 tests** `[inline]`
  - Add `AttackShape` to `src/data/types.ts` (near `Hurtbox`): `{ reach: number; arc: 'single' | 'wide' |
    'line' }`, with a doc comment covering the exact semantics above (reach = forward depth; arc = lateral
    profile; oriented to a cardinal-snapped facing).
  - Add `attackTiles(feet, facing, shape)` to `src/systems/hurtbox.ts` (co-locate with the other pure
    combat-tile geometry; import `Cell` from `./pathfind` as that file already does). Implement exactly the
    generator semantics in Context (dominant-axis snap, perpendicular, per-arc tile sets, dedupe, `reach≥1`).
    Pure, Phaser-free.
  - Tier-1 tests in `src/systems/__tests__/` (extend `hurtbox.test.ts` or a new `attackShape.test.ts`):
    assert exact tile sets for each `arc` (`single`/`line`/`wide`) at `reach` 1 and 2, across all four
    cardinal facings; assert a **diagonal facing snaps** to the dominant axis (e.g. `{1,1}` → same as
    `{1,0}`); assert `reach:1,arc:'single'` equals the single `feet+facing` tile (today's behaviour);
    assert dedupe (no repeated cells).
  - Side effects: `src/data/types.ts` consumers (additive type only). No runtime behaviour changes yet.
  - Docs: none (Step 5).
  - Done when: typecheck clean, new Tier-1 tests green, full `vitest` green, no behaviour change in-game.

- [ ] **Step 2: Melee weapon data + player melee-shape source** `[inline]`
  - In `src/data/weapons.ts` add, alongside `MONSTER_WEAPONS`: a `MeleeWeapon` type `{ id: string; name:
    string; damage: number; attackShape: AttackShape }` and a `MELEE_WEAPONS: Record<string, MeleeWeapon>`
    with the two demo entries (`spear {reach:2,arc:'line',damage:1}`, `cleaver {reach:1,arc:'wide',
    damage:1}`). Add a shared `UNARMED_MELEE_SHAPE: AttackShape = {reach:1, arc:'single'}` constant (here or
    in `config.ts` near `UNARMED_BASE_DAMAGE` — pick config.ts to match the tuning-constant convention).
  - Give `PlayerCharacter` an optional equipped melee weapon: a field `meleeWeapon?: MeleeWeapon`
    (undefined = unarmed) with a setter (e.g. `setMeleeWeapon(w?: MeleeWeapon)`), and a resolver the scene
    can call, e.g. `meleeShape(): AttackShape` (weapon's shape or the unarmed default) and
    `meleeBaseDamage(): number` (weapon.damage or `UNARMED_BASE_DAMAGE`). Keep it minimal — no inventory,
    no equipment slots, no render change.
  - Add the optional **monster expressibility seam** (decision 2): an optional `attackShape?: AttackShape`
    on `MonsterWeapon` (and/or `EnemyDef`) with a doc note that the enemy contact-bite path does **not**
    consume it yet (future work) — type-only, no consumer, no data set on existing entries.
  - Side effects: `src/data/weapons.ts` + `PlayerCharacter` are additive; nothing reads the new player
    field until Step 3. Confirm `MONSTER_WEAPONS` / existing data tests still pass.
  - Docs: none (Step 5).
  - Done when: typecheck clean, `vitest` green (incl. `data.test.ts`), player still behaves unarmed
    (nothing consumes the new field yet).

- [ ] **Step 3: Rewire `GameScene.attack()` to the shape + multi-hit** `[inline]`
  - Add `EnemyManager.enemiesInTiles(tiles: Cell[]): MonsterCharacter[]` — every **distinct alive** enemy
    whose hurtbox (`hurtboxContains`, `def.hurtbox ?? DEFAULT_HURTBOX`) covers **any** of `tiles` (dedupe by
    enemy reference; one enemy covering several arc tiles is returned once). Mirror `enemyAt`'s hurtbox use.
  - Rewrite `GameScene.attack()`: keep `fx.playAttackSwing()` (fires on every press). Compute
    `shape = playerChar.meleeShape()`, `tiles = attackTiles(playerChar.tile(), playerChar.lastFacing,
    shape)`, `targets = enemyManager.enemiesInTiles(tiles)`. For each target: `dmg = resolveMeleeAttack(
    playerChar.stats, target.def, playerChar.meleeBaseDamage(), rng)`; `takeDamage`; if dead
    `enemyManager.killEnemy`, else if `dmg>0` `fx.flashHit(target.sprite)`. Fire **one** camera shake for
    the swing if **any** target was hit (not per enemy). No target → still just the swing (whiff), as today.
  - **Regression guard:** unarmed default (`reach:1, arc:'single'`) must reproduce today's exact
    single-front-tile behaviour — the existing `combat.spec.ts` (3-hit adjacent kill, tall-enemy torso hit,
    hit-flash, corpse) must stay green **without edits**.
  - Side effects: `GameScene.attack` no longer uses `enemyAt` directly (still used elsewhere — leave it).
    `refactor-tripwire` must stay green (no `DebugState` change). Watch for the killing-hit-skips-flash
    invariant the tripwire encodes (a target killed does not `flashHit`).
  - Docs: none (Step 5).
  - Done when: `combat.spec.ts` + `refactor-tripwire.spec.ts` green unchanged; a cleave/spear shape (set via
    a temporary direct call or the Step-4 seam) hits the expected enemies; typecheck + `vitest` green.

- [ ] **Step 4: Dev/test seam + Tier-2 scenarios** `[inline]`
  - Add a `__test` API method to select the player's melee weapon deterministically, e.g.
    `setPlayerMelee(id: string | null)` (looks up `MELEE_WEAPONS[id]` or clears to unarmed) — wire it in
    `src/scenes/testApi.ts` + the `GameTestApi` type + the `harness.ts` wrapper. Optionally also accept a
    `melee?: string` field on `ScenarioSpec` so a scenario can spawn the player already holding a demo
    weapon (mirror how `weaponId` is threaded for enemies).
  - Optional (nice-to-have, keep tight): a DEV-menu button to cycle unarmed → spear → cleaver for manual
    playtest. If the dev-panel layout can't take another button cheaply, skip it — the `__test` seam is the
    required deliverable; note the skip.
  - Tier-2 e2e (`tests/e2e/`, e.g. `weapon-reach-arc.spec.ts`) using the multi-enemy `enemies` spec +
    `emit('combat:attack')`:
    - **Reach:** enemy 2 tiles ahead, facing it. Unarmed → one attack does **not** hit (still 1 enemy);
      after `setPlayerMelee('spear')` → the attack hits/kills it. Proves reach 2.
    - **Cleave:** two enemies on the two flank tiles in front (e.g. facing right at `[10,10]`, enemies at
      `[11,9]` and `[11,11]`), `setPlayerMelee('cleaver')`, one `combat:attack` → **both** take damage in a
      single swing (both die if 1-HP via a low-HP scenario, or both show `enemyHitFlashes`). Proves cleave.
    - **Unarmed regression:** an enemy on a flank tile is **not** hit unarmed (single-tile) — guards that
      the default stays narrow.
  - Side effects: `testApi.ts`, `harness.ts`, `ScenarioSpec` (`src/entities/types.ts`) if the scenario field
    is added. No `DebugState` field (assert via `enemies`/`playerHp`/`enemyHitFlashes`).
  - Docs: none (Step 5).
  - Done when: new e2e green; `combat.spec` + `refactor-tripwire` still green; typecheck + lint clean.

- [ ] **Step 5: Docs + full test sweep** `[inline]`
  - `docs/STATUS.md`: melee now uses a tile-space `AttackShape` (reach + arc); demo `MELEE_WEAPONS`;
    cleave/spear; note enemies still use proximity bite.
  - `docs/GAME-MECHANICS.md`: the shape model + `attackTiles` semantics (single/line/wide, cardinal-snap),
    the demo weapon stats, and any new config knobs (`UNARMED_MELEE_SHAPE`).
  - `docs/decisions/gameplay.md`: a dated entry — **melee hit detection is tile-space reach/arc, not
    physics/geometric hitboxes** (one source of truth on `col/row`, deterministic/testable; enemy bite
    stays proximity; shape is data so weapons/mobs can carry it). This captures the discussion that
    prompted the plan.
  - `docs/CONVENTIONS.md`: a line on the attacker-shape-vs-defender-hurtbox split if it reads as a reusable
    pattern.
  - Full three-tier sweep + lint: `npm run typecheck`, `vitest` (Tier-1/2 unit), full Playwright e2e,
    `eslint`, `markdownlint`, `prettier --check`. Confirm `refactor-tripwire` unchanged.
  - Done when: docs updated (terse, high-signal); all tiers + lint green (modulo any pre-existing,
    unrelated e2e failures — verify against the base commit, don't fix here).

## Parallelisation

None — Steps 1→2→3→4→5 are a strict dependency chain (type/generator → weapon data → attack rewire →
seam/tests → docs). All `[inline]` (each needs judgement or tight coordination with combat internals);
no write-disjoint delegatable cluster.

## Out of scope

- **Physics/geometric hitboxes** (Arcade overlap, AABB, pixel collision) — explicitly rejected; stay
  grid-native (see the decisions entry).
- **Player equipment/inventory system** — no equippable weapon items, slots, or economy; demo weapons are
  data + a dev/test seam only.
- **Changing enemy attacks** — the skeleton/boar contact-bite stays proximity-based and telegraphed; the
  monster `attackShape?` seam is defined but not consumed.
- **Line-of-sight / obstacle blocking** of reach (a spear "through" a wall still hits) — future.
- **8-way (diagonal) arcs**, per-tile damage falloff, knockback, swing arc VFX beyond the existing
  `playAttackSwing` — future/none.
- **The bow / ranged** — untouched.

## Open questions (decide at execution / playtest)

- Demo weapon damage/reach values (`spear` reach 2, `cleaver` wide) are starting points — playtest-tune.
- Whether to ship the optional DEV cycle button (Step 4) or leave the demo weapons test-only.
- Whether `UNARMED_MELEE_SHAPE` lives in `config.ts` (tuning convention) or `data/weapons.ts` (co-located
  with `MELEE_WEAPONS`) — Step 2 picks one; trivial to move.
