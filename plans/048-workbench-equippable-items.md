# Workbench + Equippable Items (Torch · Bow · Rope)

> Status: planned — run /execute-plan to begin. **Gate 1 open**: this is the plan-only deliverable;
> stop here for Matt's review before /critique-plan.

## Summary

The first **crafting station** and the first **equippable, durable item**, plus the inventory
plumbing both need. A **workbench** (buildable for 50 wood) is a fourth `StructureManager` behavior
module: it has HP, is bashed by night mobs like a wall, is repaired by a player worker order, and
**crafts slower while damaged**. Crafting is a new **`craft` worker order** — tap the bench, pick a
recipe, a worker walks over and works it over time (rate scaled by the bench's HP). The first two
recipes are the **torch** (wood + cloth) and the **bow** (rope + wood); **rope** is a new resource
added to the wrecked-tent salvage loot.

To make any of that equippable, this plan lands the **equip system** the HUD has stubbed out since
plan 046 ("no equipment system yet"): three equip slots — **main hand** (default: sword), **ranged**
(default: bow), **off hand** (utility, empty by default) — surfaced on the toolbar/pack. Tapping an
equippable item **toggles equip** (a **yellow outline** marks the equipped slot). The **torch** is
the first consumable equippable: equipped in the off hand it casts a **fixed-radius light around the
player**, drains **durability in real time** while equipped, shows a **durability bar** in the
toolbar and pack, and is **destroyed at zero**.

Verified by `npm run build` (typecheck + bundle), `npm test` (unit — Inventory/Equipment/orders/data),
`npm run e2e` (a craft + equip lifecycle scenario), and `npm run smoke` (boot canary — catches icon
404s / boot throws).

## Context & decisions

**Owner decisions (this session) — do NOT re-litigate:**

- **Three equip slots**: `mainHand` · `ranged` · `offHand`. Default loadout **main hand = sword,
  ranged = bow, off hand = empty**. (Resolves the task's slot ambiguity: the bow is the *ranged*
  weapon, not the off-hand default; the off hand is the utility slot the torch goes in.) The default
  sword+bow preserves today's always-available melee + bow combat exactly.
- **Crafting = a player-queued worker order** at the bench (like `build`/`refuel`): walk-adjacent →
  timed progress accumulator → item delivered. **Bench HP scales the craft rate** — full HP = full
  speed, low HP = slower (never fully stalls). Player-only this pass (NPC companion does not craft —
  mirrors plan 047's player-only scoping).
- **Workbench** = a **buildable, 50 wood**, placed through the existing build menu / Build catalog
  (mirrors campfire/wall). Sprite = the **`Workbench.png` object, smallest wooden variant (left
  column, 2nd row down)** in the editor Objects library — wired via the plan-028 object-region path.
  Has HP; **mobs attack it** (reuse the plan-037 generic structure-target seam); player repairs it
  (reuse the wall `repair` order).
- **Rope** = a new resource **added to the existing `salvagedTent` salvage loot** (`nodes.json`), no
  new node — reuses the plan-047 lifecycle.
- **Torch** = **fixed light radius** while equipped (smaller than the campfire), **real-time
  durability drain only while equipped**, **destroyed at 0**. A player-following light disc, not a
  structure.
- **Torch recipe = wood + cloth; bow recipe = rope + wood** (cloth already drops from tents).

**Durability model (design call — flag at the gate if wrong):**

- `ItemDef` gains optional **`equip?: EquipSlot`** (which slot it fits) and **`durability?: number`**
  (present ⇒ a *consumable* equippable that depletes while equipped; absent ⇒ permanent gear like the
  sword/bow).
- Durable items are **non-stackable** (`maxStack: 1`). The `Inventory` `Slot` gains an optional
  **`durability?`** so a partially-used item keeps its charge *in the bag* (this is why the pack can
  show a half-spent torch). `add` never merges a durable item into an existing stack (each is its own
  slot); stacking of plain resources is unchanged.
- **Equip = a move** bag↔slot: equipping pulls the item out of the bag into the `Equipment` slot
  (durability travels with it); unequipping puts it back (durability preserved) — no
  "unequip = free repair" exploit. At **0 durability the equipped item is consumed** (removed
  entirely, slot → null).

**Key patterns/files to mirror (verified against the current tree):**

- **StructureManager behavior registry** (`src/scenes/world/StructureManager.ts`): the workbench is a
  4th `StructureBehavior` module. Copy **`WallBehavior.ts`** almost verbatim for the HP shape —
  `materialise` / `takeDamage` / `repair` / `stats` / `highlightBounds` / `reset` / `destroy`, plus
  the SHUTDOWN-vs-reset sprite-teardown rule (class docs there). Register in `buildWorld()` under
  `'workbench'`. `CampfireBehavior.ts` is the reference for the light-source seam and per-tick.
- **Order kind end-to-end** (the `salvage`/`clear` precedent, plan 047): `Action` union
  (`src/systems/tasks.ts`) → `orderTargetId` + `ORDER_META` (`src/systems/orders.ts:24-77`) →
  `begin`/`run` dispatch tables in `GameScene.ts` → input enqueue → exhaustive `orders.test.ts`.
  `build`'s `runBuild` progress-accumulator is the model for the timed craft; `refuel`
  (walk-adjacent-then-tend) is the model for "work at a structure".
- **Enemy attack on structures** (`src/scenes/world/EnemyManager.ts:64-72,233-236`): the
  **generic structure-target seam** `structureAt`/`attackStructure` already exists (plan 037 chunk
  2c) and today resolves to a wall via the GameScene wiring. Extend that wiring to resolve a
  **blocking workbench** too and route damage to `WorkbenchBehavior.takeDamage` — no monster-AI
  change (the bench `blocksPath:true`, so a mob pathing to fire/player bashes it if in the way).
- **Light union** (`src/scenes/world/SurvivalClock.ts:44-52,282-285` + `VisionController`): both read
  a `lightSources()` closure the scene assembles from `StructureManager.lightSources()`. The torch
  **appends one more disc centred on the player** (radius `TORCH_LIGHT_TILES × TILE_SIZE`) while
  equipped — one edit to the scene's `lightSources` closure; both consumers pick it up for free.
- **Inventory** (`src/systems/Inventory.ts`): pure, event-emitter, plain-Node testable (no Phaser
  import). The new **`Equipment`** system mirrors this exactly (extends `eventemitter3`, emits
  `'change'`, injected item lookups — never imports `ITEMS`). Unit-test both.
- **HUD seam** (`src/hud/`): `bridge.ts` is the sole `game.events`/`registry` touch-point; `store.ts`
  is the Zustand mirror; `Hotbar.tsx` (the "toolbar") already has the equip stub
  (`slotHasAction` / `activate` — "weapon/other item → no-op … no equipment system yet") and
  `PackDrawer.tsx` is the pack. Combat actions are `combat:attack` (main hand) + `combat:bow`
  (ranged) from `CommandBar.tsx`.
- **Weapon stats** (`src/data/weapons.ts`): `MELEE_WEAPONS` (`damage` + `attackShape`) is the
  source of truth for melee gameplay; `PlayerCharacter` holds one equipped `MeleeWeapon`. The equip
  system drives *which* melee weapon id is active (main hand) and whether the bow is present (ranged).
- **Config** (`src/config.ts`): add the new tunables here (durability, torch radius, craft timings)
  next to the `CAMPFIRE_*` / `HUNGER_*` blocks. All numbers below are **starting points, tunable**.
- **Icons**: `ItemDef.icon` is required and `PreloadScene` loads `icons/<file>` (a missing PNG is a
  smoke 404). Ship **placeholder icons** for `rope`/`torch`/`sword`/`bow` (solid-tint PNGs via the
  existing `scripts/` bake, or the smallest safe stand-in) so smoke stays green; real art via the
  Gemini pipeline (plan 009) is a follow-up, not in scope.

**Direction fit** (ROADMAP/GAME-DESIGN): the MVP loop is complete; **crafting** is a named pillar
("base building · survival · crafting · base defense") and torches are explicitly listed as
**post-MVP** in the ROADMAP scope notes. This plan is the first crafting content and the equip spine
everything future (armour, more tools) reuses. Keep it data-driven (`src/data/*`), pure where
possible (`src/systems/*`), covered by the three-tier harness.

## Steps

### Part A — Data + pure systems (foundation)

- [ ] **Step 1: Item model, equip types, new item data + config** `[inline]`
  - `src/data/types.ts`: add `export type EquipSlot = 'mainHand' | 'ranged' | 'offHand'`; add optional
    `equip?: EquipSlot` and `durability?: number` to `ItemDef` (doc them: `equip` = slot it fits;
    `durability` present ⇒ consumable equippable that depletes while equipped).
  - `src/data/items.ts`: add `rope` (inedible material), `torch`
    (`equip:'offHand', durability: TORCH_DURABILITY, maxStack: 1`), `sword`
    (`equip:'mainHand', maxStack: 1`), `bow` (`equip:'ranged', maxStack: 1`). Placeholder colours +
    icon filenames.
  - `src/config.ts`: `TORCH_DURABILITY` (units; = ms of burn if drained 1/ms, or a plain max with a
    per-sec drain — pick a clean pair, e.g. `TORCH_DURABILITY = 100`, `TORCH_DRAIN_PER_SEC` sized so a
    torch lasts ~90s equipped), `TORCH_LIGHT_TILES` (~3.5, < campfire), `WORKBENCH_*` (maxHp ~60,
    craft base ms ~8000, `CRAFT_DAMAGED_MIN_FRAC` ~0.4).
  - Side effects: `data.test.ts` validates every `ItemDef` — extend it for the new fields. Icons must
    exist (Step covered by the placeholder-icon note in Context; add the PNGs here so Preload doesn't
    404).
  - Docs: none (Step 15 owns docs).
  - Done when: `npm run build` + `npm test` green; new items resolve in `ITEMS` with valid icons.

- [ ] **Step 2: Inventory — per-slot durability + non-stacking durables** `[inline]`
  - `src/systems/Inventory.ts`: extend `Slot` to `{ id; count; durability? }`. `add` gains an optional
    `durability` and, for a durable item (`maxStackOf(id) <= 1` **or** durability provided), always
    uses a fresh slot (never merges). `spend`/`get`/`canAccept`/`snapshot`/`slots` stay correct for
    both. Keep the module Phaser-free.
  - Side effects: `Inventory.test.ts` — add cases for durable add/spend/no-merge; existing stacking
    cases must stay green. The HUD `inventory` snapshot (aggregate counts) is unchanged in shape.
  - Docs: none.
  - Done when: unit tests cover durable + stackable paths; existing callers untouched behaviourally.

- [ ] **Step 3: `Equipment` pure system** `[inline]`
  - New `src/systems/Equipment.ts` mirroring `Inventory`'s style (extends `eventemitter3`, no Phaser
    import, injected lookups). State: `Record<EquipSlot, { id: string; durability: number | null } | null>`.
    API: `get(slot)`, `equip(slot, id, durability?)`, `unequip(slot)`, `drain(slot, amount)` →
    `'ok' | 'destroyed'`, `slotOf(id)`, `snapshot()` (plain object for the HUD), emits `'change'`.
    Constructor seeds the default loadout (`mainHand: sword`, `ranged: bow`) via an injected default
    map so the system stays data-agnostic.
  - Side effects: none yet (not wired). New `Equipment.test.ts`.
  - Done when: unit tests cover equip/unequip/swap/drain-to-destroy + default seed.

### Part B — Equip in the world + HUD + combat

- [ ] **Step 4: Wire Equipment into GameScene + bridge/store** `[inline]`
  - Construct `Equipment` in the scene (alongside `Inventory`), seed the default loadout, and add the
    **equip/unequip move** logic (bag↔slot, spend/add, durability transfer) as a scene method.
  - `src/hud/bridge.ts`: add inbound `equip:toggle` (payload `{ slot?, itemId }`) and outbound
    `equipment:changed` (payload: the `Equipment` snapshot incl. per-slot durability). Mirror into
    `src/hud/store.ts` (`equipment` state).
  - Side effects: `bridge.test.ts` covers the new events; store selectors added. Registry/`game.events`
    only via `bridge.ts` (the seam rule).
  - Done when: emitting `equip:toggle` from the HUD moves an item bag↔slot and the store mirrors it;
    `npm run build` green.

- [ ] **Step 5: Toolbar + Pack equip UX (yellow outline + durability bar)** `[inline]`
  - `src/hud/components/Hotbar.tsx`: replace the equip stub — `slotHasAction` returns true for an
    equippable item; `activate` emits `equip:toggle`. Draw a **yellow outline** on a slot whose item
    is currently equipped (read `equipment` from the store). Draw a **durability bar** for an item
    with `durability` (equipped or a partially-used one in the bag).
  - `src/hud/components/PackDrawer.tsx`: same equip toggle + durability bar in the pack grid.
  - Side effects: purely presentational + the one new emit; no world change beyond Step 4.
  - Done when: tapping a torch/sword/bow toggles its equipped outline; durability renders; smoke green.

- [ ] **Step 6: Equip → combat wiring** `[inline]`
  - Main-hand item → the active `MeleeWeapon` on `PlayerCharacter` (map `sword`'s item id to a
    `MELEE_WEAPONS` entry; empty main hand → unarmed fallback). Ranged slot gates `combat:bow`: no
    bow equipped → the Bow action is a no-op (and the `CommandBar` Bow button reflects it — hidden or
    disabled). Update `Equipment` `'change'` → re-sync the player's melee weapon.
  - Side effects: touches `CombatController`/`PlayerCharacter`/`CommandBar`. Default loadout keeps
    today's behaviour (melee + bow both live), so combat tests stay green.
  - Done when: unequipping the bow disables ranged fire; swapping the main hand changes melee
    shape/damage; `npm test` + build green.

### Part C — Torch (light + real-time drain)

- [ ] **Step 7: Torch runtime — player light + durability drain + destroy** `[inline]`
  - A small per-frame update (in GameScene or a tiny `TorchController` in `world/`, mirroring the
    manager style): while an `offHand` item with `durability` is equipped, `Equipment.drain(offHand,
    TORCH_DRAIN_PER_SEC × dt)`; on `'destroyed'` clear the slot + emit `equipment:changed`. Append a
    player-centred `LightSource` (`radius = TORCH_LIGHT_TILES × TILE_SIZE`) to the scene's
    `lightSources()` closure **only while a lit torch is equipped**, so `SurvivalClock` (night
    overlay) + `VisionController` (fog) both reveal around the player for free.
  - Side effects: the `lightSources` closure edit (`GameScene` — where `SurvivalClockDeps.lightSources`
    / `VisionController` are wired). HUD durability bar (Step 5) animates down; on destroy the slot
    clears.
  - Done when: equipping a torch lights a disc that follows the player at night, drains visibly, and
    the torch vanishes at 0; e2e can assert the drain→destroy.

### Part D — Rope resource

- [ ] **Step 8: Rope from tent salvage** `[delegate sonnet]`
  - `src/data/maps/nodes.json`: add a `rope` drop to the `salvagedTent` `loot` table (e.g.
    `{ "itemId": "rope", "min": 1, "max": 2, "weight": 2 }`); optionally a small `clearLoot` rope
    entry. (The `rope` item itself is added in Step 1.)
  - Side effects: `parseLootTable` cross-checks `itemId ∈ ITEMS` — depends on Step 1's `rope`. Any
    salvage test fixture asserting exact drops may need the new entry noted.
  - Docs: none.
  - Done when: salvaging a tent can yield rope; `npm test` (data/loot) green.

### Part E — Workbench structure

- [ ] **Step 9: Workbench buildable data + sprite/object region** `[inline]`
  - `src/data/buildables.ts`: add `workbench` — `cost:{ wood:50 }`, `behavior:'workbench'`,
    `category:'craft'`, `maxHp: WORKBENCH_MAX_HP`, `blocksPath:true`, `baseOnly:true` (build in base),
    appropriate `originY`/`tilesTall`. Wire its sprite to the **small wooden `Workbench.png`** region
    via the plan-028 object-region path (`tileset.ts` object regions + PreloadScene load); confirm the
    exact region id in the editor library data.
  - Side effects: the Build catalog gains its first `craft`-category entry (a new tab surfaces — see
    `CommandBar`/`BuildCatalog` category handling). `data.test.ts` buildable validation.
  - Done when: the workbench appears in the Build menu at 50 wood and renders its wooden sprite.

- [ ] **Step 10: `WorkbenchBehavior` StructureManager module** `[inline]`
  - New `src/scenes/world/WorkbenchBehavior.ts` implementing `StructureBehavior` — copy `WallBehavior`
    for `materialise`/`takeDamage`/`repair`/`stats`/`highlightBounds`/`reset`/`destroy` + the
    SHUTDOWN/reset sprite rule. Add a `WorkbenchStructure` type in `entities/types.ts` (`hp`/`maxHp`;
    later a `craftProgress`). Register under `'workbench'` in `buildWorld()`. Damage stages can be a
    tint/frame step (no crumble sheet needed).
  - Side effects: `StructureManager.stats`/`highlightBounds`/`materialise` dispatch on `behavior`
    already generalise — just the registration + the new module.
  - Done when: a built workbench is a live structure with HP that Inspect shows; build passes.

- [ ] **Step 11: Mobs attack + player repairs the workbench** `[inline]`
  - Extend the GameScene wiring of `EnemyManager` `structureAt`/`attackStructure` (currently
    wall-only) to also resolve a **blocking workbench** and route damage to
    `WorkbenchBehavior.takeDamage`. Allow the wall `repair` order to target a workbench (or add a
    workbench branch to the repair `begin`/`run`) so the player can queue a repair.
  - Side effects: `EnemyManager.ts` dep wiring, `orders.ts`/GameScene repair dispatch. No monster-AI
    change (bench `blocksPath`). Night-wave scenario should show a mob bashing a bench.
  - Done when: a night mob adjacent to a workbench damages it; a queued repair restores it; tests green.

### Part F — Crafting

- [ ] **Step 12: Recipe data** `[delegate sonnet]`
  - New `src/data/recipes.ts`: `RECIPES: Record<string, RecipeDef>` where `RecipeDef =
    { id; name; station: 'workbench'; cost: Record<string,number>; output: { itemId; count }; craftMs }`.
    Two entries: `torch` (`{ wood:1, cloth:1 }` → 1 torch) and `bow` (`{ rope:2, wood:2 }` → 1 bow).
    Add a `data.test.ts`-style validation (costs/outputs ∈ ITEMS).
  - Side effects: none until Step 13 consumes it.
  - Docs: none.
  - Done when: recipes resolve and validate; `npm test` green.

- [ ] **Step 13: `craft` worker order (HP-scaled)** `[inline]`
  - `src/systems/tasks.ts`: add `{ kind:'craft', benchId, recipeId }` to the `Action` union.
    `src/systems/orders.ts`: `orderTargetId` → `benchId`; `ORDER_META.craft` (`highlight:'structure'`,
    `dedupeOnEnqueue:false` — you can queue several crafts). Extend the exhaustive `orders.test.ts`.
    GameScene `begin`/`run`: walk adjacent to the bench (like `refuel`), then accumulate craft
    progress with the `runBuild` accumulator model, **rate scaled by bench HP**
    (`lerp(CRAFT_DAMAGED_MIN_FRAC, 1, hp/maxHp)`); on completion spend `recipe.cost` and `add`
    `recipe.output` to the bag (fizzle with feedback if unaffordable at completion).
  - Side effects: the enqueue quartet/`describeActionTarget`/glow renderer read the registry, so this
    is a single `ORDER_META` entry + the scene handlers. Bench progress state lives on
    `WorkbenchStructure`.
  - Done when: a queued craft at a healthy bench delivers the item; a damaged bench is visibly slower;
    unit + build green.

- [ ] **Step 14: HUD craft menu** `[inline]`
  - Tapping a workbench (interact/inspect) opens a **recipe list** (a drawer/sheet like `PackDrawer`,
    using the shadcn `sheet`/`dialog` primitives): each recipe shows name, cost, affordability; tap →
    emit a new `craft:queue` bridge event → GameScene enqueues the `craft` order. Show the bench's
    craft progress (reuse the queued-order highlight + a small progress bar, à la plan 047's node
    progress bar).
  - Side effects: `bridge.ts`/`store.ts` (`craft:queue` + selected-bench state), a new component +
    `GameHud.tsx` wiring, `CommandBar` may surface a "Craft" affordance now that a craft system exists
    (the plan-046 stub can be filled).
  - Done when: you can build a bench, tap it, craft a torch and a bow, and see them arrive + equip
    them; smoke green.

### Part G — Tests + docs

- [ ] **Step 15: Scenario/e2e coverage + docs** `[delegate sonnet]`
  - e2e (`tests/e2e/`): a lifecycle spec — build workbench → craft torch → equip → light + drain →
    destroy; craft bow from rope+wood → equip → ranged fire works. Use the DEV scenario API
    (`applyScenario`/`step`). Add a mob-bashes-bench + repair scenario.
  - Docs (terse, token-lean): `docs/STATUS.md` (crafting/equip subsystem), `docs/DECISIONS.md` (equip
    slots, durability model, craft-as-worker-order, torch light), `docs/GAME-MECHANICS.md` (workbench
    + torch), `CLAUDE.md` Status one-liner, and flip this plan's Status to *in review* → *deployed*.
  - Done when: `npm run check:all` green; docs describe the shipped behaviour.

## Out of scope

- **NPC companion crafting** — player-only this pass (the companion still gathers/repairs off
  `baseSupply`, but does not run the bench).
- **Equipment *rendering*** (paper-doll layers on the player sprite) — that's deferred plan 010; a
  torch/sword/bow held in-hand is not visually rendered on the body here (HUD-slot + light only).
- **Real item art** — placeholder icons ship now; the Gemini icon pipeline (plan 009) generates real
  torch/bow/sword/rope icons as a follow-up.
- **Relightable / stashable spent torches, torch as a throwable, multiple light colours** — a torch
  is a single burn-until-spent consumable.
- **More stations / recipes / tech tree** — one workbench, two recipes. Recipe *categories*, a second
  station, and armour/tool equippables are future content the `RECIPES`/`Equipment`/`EquipSlot` model
  is built to grow into.
- **Arrows/ammo for the bow** — the bow stays unlimited-ammo (roadmap's deferred ammo resource is a
  separate task).
