# Game Mechanics — tuned numbers & flows

The gameplay-mechanics reference: what the systems *do* and the numbers they run on. History lives in
[STATUS.md](STATUS.md), rationale in [DECISIONS.md](DECISIONS.md) — this doc is the terse "how it
actually works" index, updated as mechanics land or their tuning changes.

## Buildables & build flow

Palette (BUILD button) → `buildManager.select(id)` enters build mode for that buildable → place a
ghost (gated by `tilePlaceable`: bounds/occupancy/reachability, plus the base-zone check for
`baseOnly` buildables) → cost is spent from the inventory **at placement**, not completion → a worker
`build` task runs over `BUILD_MS` → `finishSite` materialises the result, branching on
`def.behavior`: a *static* buildable (no `behavior` — the wall) becomes a static tile; a *live*
buildable (`behavior` set — the campfire) hands off to its runtime manager (`CampfireManager`) to
create the simulated sprite. (`behavior` is the live-vs-static discriminant; `animKey` is purely
visual — see [DECISIONS.md](DECISIONS.md) "generalise buildable runtime on buildable #2".) Buildables
are defined in [src/data/buildables.ts](../src/data/buildables.ts) (`BuildableDef`,
[src/data/types.ts](../src/data/types.ts)).

## Campfire

Cost **10 stone + 10 wood**; placeable **base-zone only**; **always burning once built** — drains fuel
continuously, day and night. Fuel max **120**, burns **1/s** (⇒ a full tank lasts ~120s, short of a
full day/night cycle — deliberate upkeep pressure), **+30 fuel per wood** fed (⇒ 4 wood refuels an
empty fire), starts full. Blocks its tile like a wall. Goes dark at 0 fuel.

**Flame + light scale with fuel (plan 016):** the fire sprite and its light/vision radius both lerp
with fuel — a full fire is native-size + **8-tile** light; a dying one shrinks to `CAMPFIRE_FLAME_MIN_FRAC`
of that size and `CAMPFIRE_LIGHT_MIN_FRAC` of that radius (both in [src/config.ts](../src/config.ts)).
A single consistent sprite is scaled (Bonfire_07); the Bonfire_0x sheets aren't a clean intensity ramp
to swap across, so scaling reads better than a per-level swap.

**Refuel is a queued worker order (plan 016), not an instant tap:** tapping the fire (command mode)
enqueues a `refuel` order — the worker walks adjacent, then feeds **1 wood every
`CAMPFIRE_FEED_INTERVAL_MS`** (tending, like chop/mine), showing the yellow queued outline; re-tapping
toggles it off. It self-terminates when a full wood no longer fits (topped up) or the bag runs dry.
Because a tap on the fire always resolves to `refuel` (never a move), it can't walk the worker into the
blocking fire tile.

All numbers are `CAMPFIRE_FUEL_MAX`/`_BURN_PER_SEC`/`_PER_WOOD`/`_FEED_INTERVAL_MS`/`_LIGHT_MIN_FRAC`/
`_FLAME_MIN_FRAC` in [src/config.ts](../src/config.ts). Owned at runtime by
[src/scenes/world/CampfireManager.ts](../src/scenes/world/CampfireManager.ts) (sprite scale, fuel tick,
`feedOne`); the `refuel` executor + tap→action resolution are in
[src/scenes/GameScene.ts](../src/scenes/GameScene.ts) / [ScenePicker](../src/scenes/input/ScenePicker.ts);
pure fuel math (`drainFuel`/`feedFuel`/`isLit`/`fuelFrac`) in
[src/systems/campfire.ts](../src/systems/campfire.ts).

## Workbench & crafting (plan 048)

Cost **50 wood**; placeable **base-zone only**; blocks its tile. A **live HP structure** (`maxHp` **60**,
inline on the buildable) like a wall: **night mobs bash it** (the generic structure-target seam) and the
**player repairs it** (a `repair` worker order — walk adjacent, then **+`WORKBENCH_REPAIR_PER_TICK` (4)**
hp every **`WORKBENCH_REPAIR_INTERVAL_MS` (500ms)** until full, worker-time only, no cost). At **0 HP it's
destroyed** (frees its tile), same as a wall. Renders a static `Workbench.png` sprite (object-region crop,
via `BuildableDef.objectSprite`); damage shows as a darkening tint (no crumble sheet).

**Crafting is a queued worker order (like refuel), not an instant tap:** tapping the bench (command mode)
opens the **`CraftMenu`** — pick a recipe → a `craft` order enqueues → the worker walks adjacent and works
the bench over **`CRAFT_BASE_MS` (8000ms)**, **scaled by bench HP**: rate = `Linear(CRAFT_DAMAGED_MIN_FRAC
(0.4), 1, hp/maxHp)`, so a full bench crafts in ~8s and a near-dead one at ~0.4× (never stalls). An
above-bench progress bar fills as it works; progress persists on the bench (re-queue resumes). On
completion the **cost is spent + the output added to the bag**; if unaffordable / bag-full **at completion**
the craft **fizzles** (red flash, no item). Several crafts can queue (append, not de-dupe).

**Recipes** ([src/data/recipes.ts](../src/data/recipes.ts)): `brand` (1 wood + 1 cloth) · `bow` (2 rope +
2 wood) · `sword` (2 wood + 1 stone) → 1 item each. Now **equippable** (plan 049, below); **`rope`** is a
new material dropped by `salvagedTent` salvage. The `CraftMenu` also offers a **Repair** action when the
bench is damaged.

Numbers: `CRAFT_BASE_MS`/`CRAFT_DAMAGED_MIN_FRAC`/`WORKBENCH_REPAIR_INTERVAL_MS`/`_PER_TICK` in
[src/config.ts](../src/config.ts). Runtime in
[src/scenes/world/WorkbenchBehavior.ts](../src/scenes/world/WorkbenchBehavior.ts) (sprite/HP/tint);
`craft`/`repair` executors + tap→menu in [src/scenes/GameScene.ts](../src/scenes/GameScene.ts) /
[ScenePicker](../src/scenes/input/ScenePicker.ts); menu UI in
[src/hud/components/CraftMenu.tsx](../src/hud/components/CraftMenu.tsx).

## Equipping & the brand (plan 049)

Three equip slots — **mainHand · ranged · offHand** — with an **empty default loadout** (unarmed melee,
no ranged, empty off hand). Tap an equippable item (one with an `equip` slot) in the **toolbar or pack**
to **toggle equip** (`equip:toggle`); the worn item shows a **gold outline**, and a consumable also shows
a **durability bar**. State lives in the pure [`Equipment`](../src/systems/Equipment.ts) system (mirrors
`Inventory`); durability lives only there.

- **Permanent gear (bow/sword)** moves bag↔slot freely — equip spends one from the pack, unequip returns
  it. **The brand is equip-to-consume:** equipping spends one and seeds its durability; unequipping (or
  draining to 0) **discards it** — no partial restash.
- **Main hand → melee:** the equipped item maps (via `ITEM_MELEE_WEAPON`) to its `MELEE_WEAPONS` stats —
  the **`sword`** is a `{reach:1, arc:'wide'}` 2-damage swing (vs unarmed's 1-damage single front tile).
  Empty main hand = unarmed (unchanged).
- **Ranged needs a bow:** with no bow in the ranged slot, `combat:bow` does nothing and the **Bow button
  is hidden** — the crafted bow is the first ranged weapon (see the bow bullet below).
- **The brand** (off-hand hand-torch): while equipped it **raises the player's night light** to
  `BRAND_LIGHT_RADIUS` (**TILE×3.5**, vs base `PLAYER_LIGHT_RADIUS` TILE×1.25) by growing the same disc
  the night overlay already draws — fog/sight is unchanged. It **drains in real time** (`BRAND_DURABILITY`
  **100** over `BRAND_LIFETIME_SEC` **90**s) whenever equipped and is **destroyed at 0**.

Tunables `BRAND_*` in [src/config.ts](../src/config.ts); wiring (`toggleEquip`/`tickBrand`/`playerLight`)
in [src/scenes/GameScene.ts](../src/scenes/GameScene.ts); HUD in
[Hotbar.tsx](../src/hud/components/Hotbar.tsx)/[PackDrawer.tsx](../src/hud/components/PackDrawer.tsx) off
the shared [hud/lib/equip.ts](../src/hud/lib/equip.ts) read-model.

## Combat feel & the bow (plan 035a)

All knobs in [src/config.ts](../src/config.ts); behaviour in [STATUS.md](STATUS.md), rationale in
[decisions/gameplay.md](decisions/gameplay.md).

- **Telegraphed enemy attack:** on entering melee contact the enemy freezes in a wind-up for
  `ENEMY_ATTACK_WINDUP_MS` (**350ms**), tinting toward `ENEMY_WINDUP_TINT`, then strikes. The wind-up
  is carved out of the *tail* of the bite cadence (weapon `attackMs` / `CONTACT_DAMAGE_COOLDOWN_MS`), so
  DPS is unchanged — leaving contact during it whiffs the strike.
- **The boar (plan 035b):** a 4-way directional (`dir4`) charger and the default dev spawn. Stats in
  `ENEMIES.boar` (`src/data/enemies.ts`): `maxHp` **5**, `speed` **70** (vs the zombie's 45), `vision`
  **100**, `strength` **2** (unarmed bite = `UNARMED_BASE_DAMAGE` 1 + 2 = 3), wide/short hurtbox
  `{2,1}`, no `weaponPool`. Its wind-up plays its **real Attack sheet** as the tell on the punchier
  `BOAR_ATTACK_WINDUP_MS` (**250ms**, sized to the 5-frame anim at `ACTION_ANIM_FRAMERATE`) rather than
  the coded tint; same carve-from-cadence rule. Render footprint tuned by `actors.directional.boar.render`
  in `src/data/tileset.ts` (**originY 0.82**).
- **Move-slow while committing:** melee roots you to `ATTACK_MOVE_SLOW` (**0.2**) during the swing lock;
  the bow only drops you to `BOW_MOVE_SLOW` (**0.75**) for `BOW_DRAW_MS` (**450ms**) — the "ranged is
  safer / kite-able" gap. Both applied via `PlayerCharacter.effectiveMoveSpeed` (melee wins if they
  overlap).
- **Attack cooldown:** a melee swing / bow loose can only re-fire once `ATTACK_COOLDOWN_MS` (**400ms**) /
  `BOW_COOLDOWN_MS` (**450ms**) has elapsed — a press inside the window is ignored outright (no swing FX,
  no damage), so mashing the button can't machine-gun hits or restart the swing. Gated in `GameScene`
  via `PlayerCharacter.meleeReadyAt` / `bowReadyAt`; distinct from the move-slow commit windows above.
- **Auto-surface:** the fighting HUD reveals + the movepad becomes authoritative whenever a live enemy
  is within `COMBAT_ACTIVE_RADIUS_TILES` (**7**, Chebyshev) OR it's night. **Hysteresis:** once engaged
  it only retracts past `COMBAT_ACTIVE_RADIUS_TILES + COMBAT_ACTIVE_HYSTERESIS_TILES` (**+3**), so an
  enemy loitering at the boundary can't flicker the HUD on/off. Never flips input `mode` (that would
  cancel the task queue); command-mode taps keep queuing orders.
- **Bow:** **requires a bow equipped in the ranged slot** (plan 049 — no bow ⇒ no ranged, Bow button
  hidden). Auto-targets the facing-biased nearest live enemy within `BOW_RANGE_TILES` (**6**,
  Euclidean), deals `BOW_BASE_DAMAGE` (**2**) + the attacker's `dex` (**0** today → 2/shot, kills a
  3-HP kidZombie in 2) via `resolveRangedAttack` — **hitscan**; the arrow is a coded tracer
  (`BOW_ARROW_LEN_PX` dash over `BOW_ARROW_MS`). **Unlimited ammo** (no arrows resource yet). The
  current target wears a stroked highlight (`COLORS.bowTarget`) until it dies or leaves range.
- **Monster HP bars:** `HP_BAR_WIDTH_PX`×`HP_BAR_HEIGHT_PX` (**16×2**) green→red bar
  (`COLORS.hpBarHigh`/`hpBarLow`), lifted `HP_BAR_GAP_PX` above the hurtbox. The **bow target** shows
  its bar persistently; any hit enemy shows one for `HP_BAR_SHOW_MS` (**2500ms**) then it fades; at most
  `HP_BAR_MAX_VISIBLE` (**5**) render (target first, then nearest). Below `HP_BAR_NEAR_DEATH_FRAC`
  (**0.34**) HP an enemy gets an alpha throb (`HP_BAR_NEAR_DEATH_ALPHA_MIN`..1 over
  `HP_BAR_NEAR_DEATH_PERIOD_MS`) so "almost dead" reads even with no bar.

All numbers are **proposed starting values — playtest-tune.**

## Melee attack shape (plan 036)

Player melee hits a **set of tiles** derived from the equipped weapon's `AttackShape = { reach; arc }`
([src/data/types.ts](../src/data/types.ts)), not a single fixed front tile. Pure
`attackTiles(feet, facing, shape)` ([src/systems/hurtbox.ts](../src/systems/hurtbox.ts)) generates them;
behaviour in [STATUS.md](STATUS.md), rationale in [decisions/gameplay.md](decisions/gameplay.md).

- **`reach`** — forward depth in tiles (clamped `≥1`). **`arc`** — lateral profile: `single` / `line` /
  `wide`. **Facing is snapped to a cardinal unit** (dominant axis wins; a `(0,0)` facing defaults to
  down), so an arc is always cardinal-oriented (no 8-way). The feet tile is never included; cells dedupe.
- **`single`** → just the tip, `feet + reach·f` (with `reach:1` = exactly today's one front tile).
- **`line`** → the straight column, `feet + d·f` for `d = 1..reach` (a spear thrust that reaches past
  the first tile).
- **`wide`** → a 3-wide swath to depth `reach`: for each `d = 1..reach`, the column tile plus both
  perpendicular flanks (`± p`, `p` perpendicular to facing) — a cleave that catches a crowd.
- **Every distinct alive enemy** whose hurtbox covers **any** target tile is hit once per swing
  (`EnemyManager.enemiesInTiles`); **cleave = flat damage to each**, not split.
- **Demo weapons** (`MELEE_WEAPONS`, [src/data/weapons.ts](../src/data/weapons.ts), dev/test-only):
  **spear** `{ reach: 2, arc: 'line', damage: 1 }`, **cleaver** `{ reach: 1, arc: 'wide', damage: 1 }`.
- **Unarmed** (no weapon) = `UNARMED_MELEE_SHAPE` `{ reach: 1, arc: 'single' }`
  ([src/config.ts](../src/config.ts), near `UNARMED_BASE_DAMAGE` **1**) — identical to pre-036 melee.

Demo weapon reach/damage are **starting values — playtest-tune.** Enemies keep their proximity bite (see
above); the `MonsterWeapon.attackShape?` seam is defined but unconsumed.

## Base zone

A constant-size rect anchored at (centred on) the spawn tile: `BASE_ZONE_SIZE` (tile extent) in
[src/config.ts](../src/config.ts), computed via `baseZoneFromSpawn(SPAWN_TILE, BASE_ZONE_SIZE)` —
**placeholder**, expected to be replaced by a dynamic/claimed base later. Checked via `isInBase(rect,
col, row)` in [src/systems/base.ts](../src/systems/base.ts); gates any `baseOnly` buildable's placement.

## Light/night interaction

Lit campfires cut inverted-mask holes in the night overlay
([src/scenes/world/SurvivalClock.ts](../src/scenes/world/SurvivalClock.ts)) and extend the vision
reveal ([src/scenes/fx/VisionController.ts](../src/scenes/fx/VisionController.ts)) — both fed by one
scene-mediated `lightSources()` closure over `CampfireManager` (behavior-neutral seam, so future light
emitters aggregate in without either consumer changing; no manager↔manager edge). Enemies are
**not** fog-gated yet (deferred to the night-waves plan) — the reveal is purely the night-overlay hole
making near-fire content readable, not a stealth mechanic. Mask technique (inverted geometry mask +
baked textures, no shader): [RENDERING.md](RENDERING.md).
