# Inventory Stacking + Placeholder Icons

> Status: **done** — all steps executed, full sweep green (Tier 1/2/3), pushed. Icons are placeholders;
> real art lands via plan 009. Critiqued (see `## Critique`); amended per findings #1/#2, Gemini
> pipeline split to plan 009.

## Summary

Turn the throwaway top-left wood counter into a real **inventory**: items **stack** in bounded
**slots** (a max stack per resource), shown as an always-visible **hotbar** plus a toggle-open
**full grid panel**. Harvesting **blocks when the inventory is full** (and aborts the order so the
worker doesn't swing forever). Items render **32×32** icons; this plan commits simple **placeholder**
icons so the game is green from the start — the **repeatable Gemini icon-generation pipeline** that
replaces them with real art is split into its own slice (**plan 009**), which can run whenever the LAN
key is reachable without blocking the mechanic.

Seed content is **wood + stone** (two item types so stacking/variety and the icon *set* are both
visible). Wood is chopped from trees today; **stone gets a real in-world source** — a **rock resource
node** you harvest for stone, built by *generalising the existing tree/node machinery* (a rock is just
another node species) rather than a parallel system. Mining reuses the current harvest interaction/anim
(a dedicated pickaxe/mine action is out of scope).

## Context & decisions

**Locked with Matt (do NOT re-litigate):**

- **Inventory model = slot-grid, bounded.** Fixed slot count; each stack fills one slot up to that
  item's `maxStack`; overflow spills into the next free slot; the bag can genuinely fill up.
- **UI = both** an always-visible **hotbar row** *and* a **button-toggled full grid Panel**.
- **Full behaviour = block harvest.** When the yield can't fully fit, don't chop (no ground-drop, no
  soft-cap this slice).
- **Item set = wood + stone** only. Icons at **32×32**.
- **Stone is a real resource** (Matt, this revision): add a **rock harvest node** *before* the inventory
  work, by generalising the existing resource-node system (not a dev-grant, not a separate entity type).
  Mining **reuses the chop interaction/anim** (reskinnable stand-in, per the pack's documented treatment);
  a dedicated pickaxe/mine animation + tool is a later concern.
- **Icons = placeholders only this plan** (Matt, post-critique): the real **Gemini generation pipeline**
  (script + shared style preamble + per-item prompt manifest → 32×32 downscale/quantise) is **split into
  plan 009**, gated on the `GEMINI_API_KEY` (in `guppi/house-helper/.env`, LAN-only — reachable via
  Tailscale; the Gemini endpoint itself is a public Google API, only the key needs the LAN). Plan 008
  commits placeholder PNGs so the mechanic ships green regardless.
- **Block-harvest aborts the order** (Matt, post-critique — critique finding #1): guarding only the
  per-hit yield would leave the worker swinging forever on an un-fellable node. So when the bag can't
  accept the yield, **abort/complete the harvest task** (don't just skip the hit), and the Tier-2 test
  asserts the **queue goes idle**, not merely that the count is unchanged.

**Patterns/files to mirror (from research):**

- `src/systems/Inventory.ts` — pure `EventEmitter`, **no Phaser import** (plain-Node testable, see
  `vitest.config.ts`). Current API: `get/add/has/canAfford/spend/snapshot`, emits `'change'` with
  `snapshot()`. Keep every existing method working (UIScene + GameScene + data tests depend on them).
- `src/data/types.ts` `ItemDef` (`id/name/color`) + `src/data/items.ts` (`ITEMS` record). Data-driven:
  new content = new record, not new code (CONVENTIONS.md).
- `src/scenes/UIScene.ts` — HUD kit usage (`Button`, `Panel`, `arrangeRow`); reads shared `Inventory`
  from `this.registry`, subscribes to its `'change'`; `hudHitTest` gates world taps against **visible**
  HUD elements; listeners torn down in `SHUTDOWN`. `src/ui/` kit has `arrangeRow/Column/Grid` + `theme`.
- `src/scenes/PreloadScene.ts` — role-keyed asset loading via `this.load.image/spritesheet`, URLs under
  `${BASE_URL}assets/...`, `encodeURI`'d.
- `src/scenes/GameScene.ts` — chop yield at `this.inv.add(tree.def.woodItemId, tree.def.woodPerHit)`
  (~line 1017); DEV `__test.applyScenario` seeds inventory (`spec.inventory` / `spec.wood`, ~line 1281)
  and `registry.set('inventory', this.inv)` (~line 281).
- **Resource-node machinery to reuse (rock step):** `src/data/nodes.ts` (`NODES`, `tree` def) +
  `ResourceNodeDef` in `types.ts` — but its yield fields are wood-specific (`woodItemId`/`woodPerHit`) →
  generalise to `yieldItemId`/`yieldPerHit`. In `GameScene`, nodes live in `this.trees: TreeNode[]`
  (harvest, glow, task `treeId`, pathfinding occupancy `this.trees.some(...)` all key off it). A rock is
  just a `TreeNode` with a rock `def`, rock sprite, and `yieldItemId:'stone'` — **reuse the array + harvest
  loop**; the `TreeNode`/`treeId` *identifier* rename to `ResourceNode`/`nodeId` is optional polish, not
  required for stone to work. Node sprite is `ACTIVE_TILESET.tiles.tree` (single `TileSource`) — add a
  `tiles.rock` source (extract a rock from the pack's `Rocks` sheet via `scripts/pixel-crawler/extract.py`,
  else fall back to the node `color` rect) and resolve per species.
- `scripts/gen-art/` (Node fetch CLI, `lib.mjs` `parseArgs/requireEnv/writeBase64Png`) and
  `scripts/pixel-crawler/` (**Python + PIL/numpy** image tooling). The Gemini reference
  (`guppi/house-helper/catalog_icons.py`) is Python → the icon pipeline is **Python** (consistent with
  both the reference impl and the existing PIL tooling; PIL does the downscale/key-out/quantise).
- `config.ts` — tunables live here (`BASE_WIDTH=360`, `BASE_HEIGHT=640`, `TILE_SIZE=16`, `COLORS`).

**Key design choice — pure Inventory stays data-agnostic.** `maxStack` is per-item *data*, but
Inventory must not import `ITEMS` (would pull data into a pure system + break plain-Node tests). So the
constructor takes injected options: `new Inventory({ capacity, maxStackOf: (id) => number })`. Production
wires `maxStackOf: (id) => ITEMS[id]?.maxStack ?? DEFAULT_MAX_STACK`; unit tests pass tiny resolvers
inline (matches the "build tiny inputs inline" test convention). Called with **no args**, Inventory
defaults to large capacity + `Infinity` max stack, so it behaves like today (existing tests stay green).

**Slots as single source of truth.** Internally an `Array<{id,count}|null>` of length `capacity`;
`get`/`snapshot` aggregate across slots, `slots()` returns a copy for the UI. `add(id,n)` fills existing
partial stacks of `id` first, then empty slots, up to `maxStack` each, and **returns the amount actually
added** (leftover = `n - added`); emits `'change'` only if something was added. `canAccept(id,n)` = would
all `n` fit.

## Steps

- [x] **Step 1: Item data — `maxStack`, `icon`, add stone** `[delegate sonnet]` (parallel: A)
  - `src/data/types.ts`: add `maxStack: number` and `icon: string` (asset path relative to
    `public/assets/icons/`, e.g. `wood.png`) to `ItemDef`. Keep `color` (placeholder/fallback tint).
  - `src/data/items.ts`: set `wood` `maxStack: 50` + `icon: 'wood.png'`; add `stone`
    (`{ id:'stone', name:'Stone', color:<grey ~0x8a8a8a>, maxStack:50, icon:'stone.png' }`).
  - `src/data/__tests__/data.test.ts`: extend invariants — every `ItemDef.id === key`, `maxStack > 0`,
    non-empty `icon` (mirror existing invariant style).
  - Side effects: `UIScene.refreshWood`/`ITEMS.wood.color` still valid (Step 5 replaces that widget).
    Write-disjoint from Step 2 (touches `types.ts`/`items.ts`/`data.test.ts`) and independent → parallel A.
    Note: Step 3 also edits `types.ts` (yield-field rename) so it runs *after* this step, not alongside.
  - Docs: none here.
  - Done when: `npm test` green; `npm run build` typechecks with the new `ItemDef` fields.

- [x] **Step 2: Inventory system — slots, stacking, capacity** `[inline]` (parallel: A)
  - Rewrite `src/systems/Inventory.ts` to be slot-backed per the design above. Constructor
    `{ capacity = <large default>, maxStackOf = () => Infinity } = {}`. Keep `get/has/canAfford/spend/
    snapshot` behaviour identical for callers; `spend` deducts across slots (clearing emptied slots).
    Add: `add(id,n=1): number` (returns amount added), `canAccept(id,n=1): boolean`,
    `slots(): ReadonlyArray<{id:string;count:number}|null>` (copy). Emit `'change'` only on real change.
  - Add config constants: `INVENTORY_SLOTS = 20`, `HOTBAR_SLOTS = 5` (≤ INVENTORY_SLOTS),
    `DEFAULT_MAX_STACK = 50` in `src/config.ts`.
  - Extend `src/systems/__tests__/Inventory.test.ts`: partial-stack fill → new slot spill; `maxStack`
    respected; `add` returns leftover when capacity/stack exhausted; `canAccept` false when no room;
    `spend` across multiple slots; `snapshot`/`get` aggregate; **existing no-arg tests still pass**.
  - Side effects: `GameScene` constructs `new Inventory()` (~line 281) — updated in Step 6 to inject
    capacity + `maxStackOf`; leaving it no-arg here keeps the build green between steps.
  - Docs: none (system-level; STATUS.md updated in Step 7).
  - Done when: `npm test` green (new stacking tests + all existing Inventory/data tests).

- [x] **Step 3: Stone as a harvestable resource (rock node)** `[inline]`
  - **Generalise yield fields:** rename `ResourceNodeDef.woodItemId`/`woodPerHit` →
    `yieldItemId`/`yieldPerHit` in `src/data/types.ts`; update `NODES.tree` in `src/data/nodes.ts` and the
    single consumer in `GameScene` (`this.inv.add(tree.def.woodItemId, tree.def.woodPerHit)`, ~line 1017).
  - **Add the rock node:** `NODES.rock` (`yieldItemId:'stone'`, `yieldPerHit:1`, its own `maxHp`/`regrowMs`,
    grey `color`/`stumpColor`) mirroring `tree`. Reuse the existing node machinery — spawn a few rocks into
    `this.trees` (a rock is a `TreeNode` with the rock def + rock sprite); harvest/glow/occupancy/task-queue
    all work unchanged since they key off the generic node. Resolve the sprite per species.
  - **Rock sprite:** add `tiles.rock: TileSource` to the manifest (`src/data/tileset.ts`) + load it in
    `PreloadScene`; extract a rock from the pack's `Rocks` sheet via `scripts/pixel-crawler/extract.py`
    (add it to the derived-file manifest in `docs/ASSETS.md`). **If extraction is fiddly, fall back to a
    placeholder rect in the node `color`** — don't block the step on art.
  - **Per-species render params (critique #2):** `addTree` hardcodes the pine's height/anchor
    (`treeScale` via `TREE_TILES_TALL = 2.6`, `setOrigin(0.5, 0.92)`, and `TREE_BASE_STAND_OFFSETS`) —
    a rock must **not** inherit these or it renders ~2.6 tiles tall and mis-anchored. Add render fields to
    the node data (e.g. `tilesTall`/`originX`/`originY`, and stand-offsets) or pass a render descriptor,
    and parameterise the spawn path (`addTree` → `addNode(def, render)`) so each species sizes/anchors
    itself. A rock is ~1 tile, centred/base-anchored.
  - **Harvest interaction:** reuse the current chop targeting + swing anim for rocks (mining == chopping
    mechanically this slice). No new input/mode.
  - Side effects: pathfinding blocks on live nodes (`this.trees.some`) so rocks are obstacles like trees —
    intended. The `TreeNode`/`treeId` → `ResourceNode`/`nodeId` identifier rename is **optional** and can be
    deferred (note it in the step output); the required change is the *data* generalisation + rock spawn.
    Extend `__test.applyScenario` with a `rocks:` seed mirroring `trees:` (and optionally scatter rocks in
    the `⟳ TREES` debug regen) so scenarios/manual play can produce stone.
  - Tests: unit-cover the yield-field rename is a pure data change (`data.test.ts` node invariants still
    hold — update field names). Add a Tier-2 scenario: place a rock adjacent, harvest it, assert `stone`
    lands in the inventory via `state()`/`inspect`.
  - Docs: `docs/ASSETS.md` (rock in the derived-file manifest); `docs/STATUS.md` note deferred to Step 7.
  - Done when: `npm test` + `npm run e2e` green; in-game you can harvest a rock and stone accrues.

- [x] **Step 4: Placeholder icons + Preload loads them** `[delegate sonnet]`
  - Create committed **32×32** placeholder PNGs `public/assets/icons/wood.png` + `stone.png` (simple
    on-theme flat squares w/ a letter, transparent bg — generate with a tiny PIL snippet, commit the
    PNGs). These guarantee icon texture keys always resolve until real art lands.
  - `src/scenes/PreloadScene.ts`: load each `ITEMS` entry's icon as `this.load.image(iconKey(id), url)`
    where `url = ${BASE_URL}assets/icons/${icon}`. Add an `iconKey(id) => 'icon:'+id` helper (colocate
    with the other key helpers). Icons are standalone images (not sheet-sliced) — no `TILE_SIZE` framing.
  - Side effects: depends on Step 1 (`ITEMS[*].icon`). Also edits `PreloadScene` — sequential after Step 3
    (which added rock-sprite loading there). Keep robust: UI (Step 5) falls back to `color` rect if a
    texture key is missing, so a future icon-less item never hard-crashes.
  - Docs: none here (item-icon docs — where icons live, placeholder→real flow — land with the pipeline in plan 009).
  - Done when: `npm run build` clean; icons present in `dist/`; `npm run smoke` still 0 console errors.

- [x] **Step 5: SlotGrid widget + hotbar & inventory Panel in UIScene** `[inline]`
  - Add `src/ui/SlotGrid.ts` — a `Container` widget that lays out `n` slots (bordered cells via kit
    `theme`, `arrangeGrid`/`arrangeRow`), and an `update(slots, itemLookup)` that per non-empty slot draws
    the item **icon** sprite (texture `iconKey(id)`, scaled to the cell) **or** falls back to a `color`
    rect, plus a small count label (hidden when count ≤ 1). Export from `src/ui/index.ts`.
  - `src/scenes/UIScene.ts`:
    - Remove the single wood swatch + `woodText` + `refreshWood`.
    - **Hotbar:** a `SlotGrid` of `HOTBAR_SLOTS` (first N inventory slots), always-visible, bottom-center;
      **hidden in combat mode** (like the combat controls) to avoid clashing with movepad/punch. Reflow
      the existing bottom-left control-hint text so they don't overlap.
    - **Full panel:** an `INVENTORY` `Button` (top-right stack, under BUILD/CANCEL) toggles a `Panel`
      containing a `SlotGrid` of all `INVENTORY_SLOTS` (dismissible, like the inspect panel).
    - Subscribe both grids to the shared `Inventory` `'change'` (read `inv.slots()`); seed on `create`.
      Add every new interactive/visible element to `hudElements` for `hudHitTest`; tear down listeners in
      `SHUTDOWN`.
  - Side effects: `hudHitTest` must see the hotbar/panel/button so world taps under them don't chop/move.
    Panel open/close is visibility-driven (matches inspect panel). Depends on Steps 1, 2, 4.
  - Docs: none here.
  - Done when: `npm run build` clean; manual/e2e check — hotbar shows a live wood stack that grows while
    chopping and rolls to a 2nd slot past `maxStack`; INVENTORY button opens/closes the grid; taps on
    them don't leak to the world; hotbar hidden in combat mode.

- [x] **Step 6: Block harvest when full (abort the order) + wire real capacity/maxStack** `[inline]`
  - `src/scenes/GameScene.ts`: construct `new Inventory({ capacity: INVENTORY_SLOTS, maxStackOf: (id) =>
    ITEMS[id]?.maxStack ?? DEFAULT_MAX_STACK })`. Guard the harvest yield (now generic — covers both trees
    and Step 3 rocks): if `!inv.canAccept(node.def.yieldItemId, node.def.yieldPerHit)`, block it.
  - **Abort the order — REQUIRED, not optional (critique #1).** The harvest task only completes when the
    node's `hp <= 0` (~`GameScene:1023`); if we merely skip the per-hit yield, `hp` never decrements, the
    task never resolves, and the worker swings forever on a jammed queue head (blocking every queued order
    until CANCEL). So on `!canAccept` at harvest time, **abort/complete the current harvest task** (clear
    the queue head, stop targeting the node) rather than just no-op the hit. Light feedback only (reuse an
    existing flash; no new HUD text). Prefer checking room **before** committing to/continuing a harvest
    order, so a full-bag tap on a node doesn't even start the walk-and-swing.
  - Let `__test.applyScenario` set a small `capacity` to exercise block-when-full (the inventory seed is
    already generic over ids — verify `stone` round-trips too).
  - Side effects: `applyScenario` inventory reset/seed (~line 1263/1281) must still round-trip via the new
    slot API (`spend(snapshot)` to clear, `add` to seed). Verify determinism (Tier-2 harness).
  - Tests: add/extend a Tier-2 scenario (`tests/e2e/`) — seed a tiny-capacity bag **full**, order a
    harvest, drive `step()`, and assert **both**: (a) the item count is unchanged, **and (b) the task
    queue goes idle** (`state()` shows `current === null && pending === 0`) — i.e. the worker isn't stuck
    swinging. Extend `__test` inspect to expose inventory counts if needed.
  - Docs: none here.
  - Done when: `npm test` + `npm run e2e` green; harvesting into a full bag doesn't increment the item
    **and** leaves the worker idle (no jammed queue).

- [x] **Step 7: Wrap-up — docs + full sweep + push** `[inline]`
  - Update `docs/STATUS.md` (feature/plan history: inventory stacking + hotbar/panel + rock/stone node +
    block-when-full; note item icons are **placeholders**, real art via **plan 009**).
  - Wrap-up gate: `npm test` + `npm run e2e` + `npm run smoke` all green; commit each coherent stage and
    `git push -u origin claude/inventory-stacking-icons-dmdjvx` per WORKFLOW.md.
  - Done when: full sweep green, docs updated, work pushed.

> **Icon generation → plan 009** (`plans/009-gemini-icon-pipeline.md`): the repeatable Gemini script +
> shared style preamble + per-item prompt manifest + 32×32 downscale/quantise that replaces the
> placeholder PNGs with real art. Split out post-critique (finding #3) so this mechanic isn't gated on a
> LAN-only key; run 009 whenever the key is reachable.

### Parallelism

- **Group A: Steps 1 & 2** — item-data (`types.ts`+`items.ts`+`data.test.ts`) vs Inventory-system
  (`Inventory.ts`+`config.ts`+`Inventory.test.ts`): write-disjoint, no data/ordering dependency (Inventory
  takes an injected `maxStackOf`, not `ITEMS`). Step 1 is a clean `[delegate]`; Step 2 is `[inline]` for
  API-design judgement — if both are delegated they may run concurrently.
- Steps **3→7 are sequential**: Step 3 also edits `types.ts` (yield-field rename) so it follows Step 1;
  Steps 3/4 both edit `PreloadScene`, Steps 5/6 share `UIScene`/`GameScene` — so no further parallelism.

## Out of scope

- **The Gemini icon-generation pipeline** — moved to **plan 009** (this plan ships placeholder icons only).
- **A dedicated mining action** — pickaxe/mine animation + a distinct tool/interaction. Rocks reuse the
  chop targeting + swing anim this slice (Step 3). Also **rock art polish** beyond one extracted/placeholder
  rock sprite.
- **Ground-drop / item pickups** when full (chose block-harvest), **drag-to-rearrange / split stacks**,
  and **equip/consume from slots** — later inventory UX (the hotbar is display-only this slice — critique #4).
- **Persistence** of inventory to localStorage/IndexedDB (tracked separately).
- **Crafting/recipes** consuming stacks — separate system.
- The `TreeNode`/`treeId` → `ResourceNode`/`nodeId` **identifier rename** — optional polish; the data-level
  yield-field generalisation (Step 3) is what's required for stone.

## Critique

Fresh-eyes review (independent sub-agent, 2026-07-12). **Verdict:** strategically sound and unusually
well-grounded in the codebase — safe to execute after tightening two under-specified reuse points; the
bundled Gemini pipeline was the main scope risk, not a correctness one. Findings #1/#2 folded into the
plan above; #3 resolved by splitting the pipeline to plan 009; #4 accepted (locked with Matt).

| # | Finding | Severity | Resolution |
| - | ------- | -------- | ---------- |
| 1 | Block-harvest that only skips the per-hit yield never fells the node → harvest task never completes → worker swings forever on a jammed queue. | Medium | **Folded in** (Step 6): abort the order on `!canAccept`, required; Tier-2 asserts queue idles. |
| 2 | Rock reusing tree-shaped rendering inherits the pine's `treeScale` (2.6 tiles) + origin → renders oversized/mis-anchored. | Medium | **Folded in** (Step 3): per-species render params (scale/origin/stand-offsets); `addTree`→`addNode(def, render)`. |
| 3 | Plan bundles four semi-independent efforts incl. a second Python art-gen pipeline gated on a LAN-only key. | Medium | **Resolved**: Gemini pipeline split to plan 009; mechanic ships on placeholders. |
| 4 | Hotbar has no functional role this slice (display duplication of first N slots). | Low | **Accepted** (locked with Matt): keep as display-only; no select/consume plumbing built. |
