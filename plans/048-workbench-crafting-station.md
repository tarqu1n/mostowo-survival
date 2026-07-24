# Workbench — First Crafting Station

> Status: planned — run /execute-plan to begin. **Gate 1 open**: plan-only deliverable; stop for
> Matt's review. Split out of the original combined plan after the Gate-2 critique (see
> `## Critique resolution`). The **equip system + torch/durability + combat rewire** is the sibling
> plan **049**; this plan (crafting station) is its prerequisite and ships first.

## Summary

The game's first **crafting station**: a **workbench**, buildable for **50 wood**, that has HP,
is bashed by night mobs like a wall, is repaired by a player worker order, and **crafts slower while
damaged**. Crafting is a new **`craft` worker order** — tap the bench, pick a recipe, and a worker
walks over and works it over time (rate scaled by the bench's current HP). The workbench is a fourth
`StructureManager` behavior module, mirroring the wall's HP/damage/repair spine.

It ships with a recipe model and the three starter recipes the sibling equip plan (049) needs —
**brand** (a hand-held torch: wood + cloth), **bow** (rope + wood), and **sword** (wood + stone) —
plus a new **rope** resource scavenged from the wrecked-tent salvage loot. Crafting delivers these as
**items into the pack**; they are plain (inert) bag items here and become **equippable + functional
in plan 049** (equip slots, torch light, durability, combat). So this plan's proof is the *crafting
loop itself* — build a bench, queue a craft, watch HP scale the speed, receive the item — not the
items' eventual combat/light behaviour.

Verified by `npm run build`, `npm test` (recipe/data/orders units), `npm run e2e` (a build→craft→
mob-bash→repair scenario), and `npm run smoke` (boot canary — catches icon 404s / boot throws).

## Critique resolution (Gate-2, plan-048-combined)

- **#1 (High) — split the plan.** Done: this is the crafting half; the equip half is **049**. Each is
  ~7 steps, matching the repo's one-feature-per-plan cadence (040/042/046/047).
- **#2 (Medium) — workbench HP unmandated.** *Overridden by Matt* — the HP / mob-attack / repair /
  crafts-slower-when-damaged surface is an explicit owner requirement, so it stays (the finding
  reflected the doc-only view; the owner prompt mandates it). This plan keeps the full station.
- **#5 (Medium) — redundant bow recipe.** Resolved in 049 by **not** default-equipping the bow, so
  crafting the bow is the first-ranged gate; this plan just supplies the recipe.
- Item naming **#7**: the craftable hand-torch is the **`brand`** item so it doesn't collide with the
  buildable perimeter **`torch`** GAME-DESIGN reserves. (Applied here since the item id is minted here.)

## Context & decisions

**Owner decisions — do NOT re-litigate:**

- **Workbench**: buildable, **50 wood**, via the existing build menu / Build catalog (`category:'craft'`).
  Has **HP**; **night mobs attack it**; **player repairs it**; **crafts slower while damaged** (rate
  scales with HP, never fully stalls). `baseOnly:true`, `blocksPath:true`.
- **Sprite**: the **`Workbench.png` object, smallest wooden variant (left column, 2nd row down)** in
  the editor Objects library — wired via the plan-028 object-region path.
- **Crafting = a player-queued worker order** (like `build`/`refuel`): walk-adjacent → timed progress
  accumulator → item delivered to the bag. **Player-only** (NPC companion does not craft this pass).
- **Rope** = a new resource **added to the existing `salvagedTent` salvage loot** (`nodes.json`), no
  new node — reuses the plan-047 lifecycle.
- **Recipes**: `brand` = wood + cloth · `bow` = rope + wood · `sword` = wood + stone. (Cloth already
  drops from tents.)

**Key patterns/files to mirror (verified against the current tree):**

- **StructureManager registry** (`src/scenes/world/StructureManager.ts`): register a 4th
  `StructureBehavior` under `'workbench'` in `buildWorld()`. **Copy `WallBehavior.ts`** for the HP
  spine — `materialise`/`takeDamage`/`repair`/`stats`/`highlightBounds`/`reset`/`destroy` + the
  SHUTDOWN-vs-reset sprite-teardown rule (class docs there). `CampfireBehavior.ts` is the reference
  for a per-tick + the `WorkbenchStructure` state record on `entities/types.ts`.
- **Enemy attack on structures** (`src/scenes/world/EnemyManager.ts:64-72,233-236`): the **generic
  structure-target seam** `structureAt`/`attackStructure` (plan 037 chunk 2c) today resolves to a
  wall via the GameScene wiring. Extend that wiring to resolve a **blocking workbench** and route
  damage to `WorkbenchBehavior.takeDamage` — **no monster-AI change** (the bench `blocksPath:true`,
  so a mob pathing to the fire/player bashes it if in the way).
- **Player repair** reuses the wall `repair` order (`src/systems/orders.ts:38-39,76`,
  CompanionManager's repair planner is companion-only — the player path is what we extend).
- **Order kind end-to-end** (the `salvage`/`clear` precedent, plan 047): `Action` union
  (`src/systems/tasks.ts`) → `orderTargetId` + `ORDER_META` (`src/systems/orders.ts:24-77`) →
  `begin`/`run` dispatch tables in `GameScene.ts` → input enqueue → exhaustive `orders.test.ts`.
  `build`'s `runBuild` progress-accumulator is the model for the timed craft; `refuel`
  (walk-adjacent-then-tend) is the model for "work at a structure".
- **HUD** (`src/hud/`): `bridge.ts` (sole `game.events`/`registry` seam) → `store.ts` (Zustand mirror)
  → components. The Build catalog (`BuildCatalog.tsx`/`CommandBar.tsx`) already reserves a `'craft'`
  category tab (`types.ts` `category?: 'defense'|'survival'|'craft'`). A new craft-menu component uses
  the shadcn `sheet`/`dialog` primitives (like `PackDrawer.tsx`). Progress bar mirrors plan 047's
  above-node bar.
- **Config** (`src/config.ts`): add `WORKBENCH_MAX_HP` (~60), `CRAFT_BASE_MS` (~8000),
  `CRAFT_DAMAGED_MIN_FRAC` (~0.4) next to the `CAMPFIRE_*` block. All numbers are tunable starting
  points.
- **Icons**: `ItemDef.icon` is required and `PreloadScene` loads `icons/<file>` (a missing PNG is a
  smoke 404). Ship **placeholder icons** for `rope`/`brand`/`bow`/`sword` (solid-tint PNGs via the
  existing `scripts/` bake, or the smallest safe stand-in). Real art via the Gemini pipeline (plan
  009) is a follow-up.

**Direction fit** (ROADMAP/GAME-DESIGN): **crafting** is a named pillar and the MVP loop is complete,
so this is the right first piece of post-MVP crafting content. GAME-DESIGN frames crafting as "a
queued station task over `craftMs`" — exactly the worker-order model here.

## Steps

- [x] **Step 1: Rope resource + craftable item stubs + tent loot** `[delegate sonnet]`
  - `src/data/items.ts`: add `rope` (inedible material) and the recipe outputs as **plain items** —
    `brand` (name "Brand"), `bow`, `sword`, each `maxStack: 1`, placeholder colour + icon. **No
    `equip`/`durability` fields yet** (those + combat/light land in 049; these stay inert bag items).
  - `src/data/maps/nodes.json`: add a `rope` drop to the `salvagedTent` `loot` table
    (`{ "itemId": "rope", "min": 1, "max": 2, "weight": 2 }`); optionally a small `clearLoot` rope
    entry.
  - Add the 4 placeholder icon PNGs so `PreloadScene` doesn't 404.
  - Side effects: `data.test.ts` validates every `ItemDef`; `parseLootTable` cross-checks
    `itemId ∈ ITEMS`. Salvage fixtures asserting exact drops may need the new entry.
  - Done when: `npm test` + build + smoke green; salvaging a tent can yield rope.
  - Outcome: added `rope` (material, `maxStack:50`) + inert `brand`/`bow`/`sword` (`maxStack:1`, no
    equip/durability) to `src/data/items.ts`; added `rope` drops to both `salvagedTent.loot` and
    `.clearLoot` in `nodes.json`; new `scripts/craft-items-art.mjs` bakes 4 placeholder 32×32 icons to
    `public/assets/icons/{rope,brand,bow,sword}.png` (tent-art.mjs convention, zlib-only, re-runnable);
    updated `tests/e2e/salvage-lifecycle.spec.ts` loot assertions for the new drop. `npm test` (967
    tests), `npm run build`, `npm run smoke` all green.

- [ ] **Step 2: Workbench buildable data + sprite/object region** `[inline]`
  - `src/data/buildables.ts`: add `workbench` — `cost:{ wood:50 }`, `behavior:'workbench'`,
    `category:'craft'`, `maxHp: WORKBENCH_MAX_HP`, `blocksPath:true`, `baseOnly:true`, with
    `originY`/`tilesTall` for a ~1-tile bench. Wire its sprite to the **small wooden `Workbench.png`**
    region via the plan-028 object-region path (`tileset.ts` object regions + PreloadScene load);
    confirm the exact region id from the editor library data.
  - Side effects: the Build catalog surfaces its first `'craft'`-category tab — verify
    `CommandBar`/`BuildCatalog` render a tab per non-empty category. `data.test.ts` buildable checks.
  - Done when: the workbench appears in the Build menu at 50 wood and renders its wooden sprite.

- [ ] **Step 3: `WorkbenchBehavior` StructureManager module** `[inline]`
  - New `src/scenes/world/WorkbenchBehavior.ts` implementing `StructureBehavior` — copy `WallBehavior`
    for `materialise`/`takeDamage`/`repair`/`stats`/`highlightBounds`/`reset`/`destroy` + the
    SHUTDOWN/reset sprite rule. Add `WorkbenchStructure` to `entities/types.ts` (`hp`/`maxHp`, plus a
    `craft: { recipeId; progress } | null` field for Step 6). Register under `'workbench'` in
    `buildWorld()`. Damage feedback = a tint/frame step (no crumble sheet needed).
  - Side effects: `StructureManager.stats`/`highlightBounds`/`materialise` already dispatch on
    `behavior` — just the registration + new module.
  - Done when: a built workbench is a live structure with HP that Inspect shows; build passes.

- [ ] **Step 4: Mobs attack + player repairs the workbench** `[inline]`
  - Extend the GameScene wiring of `EnemyManager` `structureAt`/`attackStructure` (currently
    wall-only) to also resolve a **blocking workbench** and route damage to
    `WorkbenchBehavior.takeDamage`. Allow the player `repair` order to target a workbench (add a
    workbench branch to the repair `begin`/`run`, or generalise the wall repair to any structure with
    HP).
  - Side effects: `EnemyManager.ts` dep wiring, `orders.ts`/GameScene repair dispatch. No monster-AI
    change (bench `blocksPath`).
  - Done when: a night mob adjacent to a workbench damages it; a queued repair restores it; a
    scenario test shows both.

- [ ] **Step 5: Recipe data model** `[delegate sonnet]`
  - New `src/data/recipes.ts`: `RECIPES: Record<string, RecipeDef>` where `RecipeDef =
    { id; name; station: 'workbench'; cost: Record<string,number>; output: { itemId; count }; craftMs }`.
    Entries: `brand` (`{ wood:1, cloth:1 }` → 1 brand), `bow` (`{ rope:2, wood:2 }` → 1 bow), `sword`
    (`{ wood:2, stone:1 }` → 1 sword). Add validation (costs/outputs ∈ ITEMS, station ∈ BUILDABLES).
  - Side effects: none until Step 6.
  - Done when: recipes resolve + validate; `npm test` green.

- [ ] **Step 6: `craft` worker order (HP-scaled)** `[inline]`
  - `src/systems/tasks.ts`: add `{ kind:'craft', benchId, recipeId }` to `Action`. `src/systems/orders.ts`:
    `orderTargetId` → `benchId`; `ORDER_META.craft` (`highlight:'structure'`, `dedupeOnEnqueue:false`
    — several crafts may queue). Extend `orders.test.ts` exhaustively. GameScene `begin`/`run`: walk
    adjacent to the bench (like `refuel`), then accumulate craft progress via the `runBuild` model,
    **rate scaled by bench HP** (`Phaser.Math.Linear(CRAFT_DAMAGED_MIN_FRAC, 1, hp/maxHp)`); on
    completion spend `recipe.cost` and `add` `recipe.output` to the bag (fizzle with feedback if
    unaffordable at completion). Progress lives on `WorkbenchStructure.craft`.
  - Side effects: the enqueue quartet/`describeActionTarget`/glow renderer read the registry, so this
    is one `ORDER_META` entry + the scene handlers.
  - Done when: a queued craft at a healthy bench delivers the item; a damaged bench is visibly slower;
    unit + build green.

- [ ] **Step 7: HUD craft menu + tests + docs** `[inline]`
  - Tapping a workbench opens a **recipe list** (a drawer/sheet like `PackDrawer`): each recipe shows
    name, cost, affordability; tap → new `craft:queue` bridge event → GameScene enqueues the `craft`
    order. Show the bench's craft progress (above-bench bar, à la plan 047). Fill the plan-046 Craft
    stub in `CommandBar` now that a craft system exists.
  - e2e (`tests/e2e/`): build bench → craft brand → it arrives in the pack; mob bashes bench → repair
    it → craft speed recovers. Use the DEV scenario API.
  - Docs (terse): `docs/STATUS.md` (crafting subsystem), `docs/DECISIONS.md` (craft-as-worker-order,
    HP-scaled rate, workbench = attackable structure), `docs/GAME-MECHANICS.md` (workbench), `CLAUDE.md`
    Status one-liner, flip this plan's Status.
  - Done when: build bench → tap → craft brand/bow/sword → they arrive in the pack; `npm run check:all`
    green.

## Out of scope

- **Equip / durability / torch light / combat** — that's plan **049**. Crafted `brand`/`bow`/`sword`
  are inert bag items until 049 makes them equippable and functional.
- **NPC companion crafting** — player-only this pass.
- **More stations / recipes / a tech tree** — one workbench, three recipes; the `RECIPES` model is
  built to grow.
- **Real item art** — placeholder icons now; Gemini pipeline (plan 009) is a follow-up.
- **Arrows/ammo** — the bow stays unlimited-ammo (deferred roadmap item).
