# Inventory Stacking + Item Icons

> Status: planned — run /critique-plan (review gate) then /execute-plan to begin.

## Summary

Turn the throwaway top-left wood counter into a real **inventory**: items **stack** in bounded
**slots** (a max stack per resource), shown as an always-visible **hotbar** plus a toggle-open
**full grid panel**. Chopping (and future harvesting) **blocks when the inventory is full**. Alongside
the mechanic, stand up a **repeatable icon-generation pipeline** — a Gemini ("Nano Banana") script
driven by a **shared style preamble + per-item prompt manifest** so a whole *set* of icons comes out
consistent — with hard downscale/quantise to a **32×32** pixel target. Placeholder icons are committed
now so the game stays green; real icons are generated once the LAN key is reachable.

Seed content is **wood + stone** (two item types so stacking/variety and the icon *set* are both
visible). Wood is obtained by chopping today; stone gets a **dev-only starter grant** so the second
stack shows — a real stone *source* (rock/mining node) is out of scope here.

## Context & decisions

**Locked with Matt (do NOT re-litigate):**

- **Inventory model = slot-grid, bounded.** Fixed slot count; each stack fills one slot up to that
  item's `maxStack`; overflow spills into the next free slot; the bag can genuinely fill up.
- **UI = both** an always-visible **hotbar row** *and* a **button-toggled full grid Panel**.
- **Full behaviour = block harvest.** When the yield can't fully fit, don't chop (no ground-drop, no
  soft-cap this slice).
- **Item set = wood + stone** only. Icons at **32×32**.
- **Icons via Gemini**, generated for real this session **if** the `GEMINI_API_KEY` (in
  `guppi/house-helper/.env` on Matt's LAN) is reachable — Matt enables **Tailscale**; the Gemini
  endpoint itself (`generativelanguage.googleapis.com`) is a *public* Google API, so only the **key**
  needs the LAN. If it's not reachable in-session, ship the pipeline + committed **placeholder** icons
  and Matt runs generation later. The game must be green either way.

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

- [ ] **Step 1: Inventory system — slots, stacking, capacity** `[inline]` (parallel: A)
  - Rewrite `src/systems/Inventory.ts` to be slot-backed per the design above. Constructor
    `{ capacity = <large default>, maxStackOf = () => Infinity } = {}`. Keep `get/has/canAfford/spend/
    snapshot` behaviour identical for callers; `spend` deducts across slots (clearing emptied slots).
    Add: `add(id,n=1): number` (returns amount added), `canAccept(id,n=1): boolean`,
    `slots(): ReadonlyArray<{id:string;count:number}|null>` (copy). Emit `'change'` only on real change.
  - Add config constants: `INVENTORY_SLOTS` (e.g. 20), `HOTBAR_SLOTS` (e.g. 5, ≤ INVENTORY_SLOTS),
    `DEFAULT_MAX_STACK` (e.g. 50) in `src/config.ts`.
  - Extend `src/systems/__tests__/Inventory.test.ts`: partial-stack fill → new slot spill; `maxStack`
    respected; `add` returns leftover when capacity/stack exhausted; `canAccept` false when no room;
    `spend` across multiple slots; `snapshot`/`get` aggregate; **existing no-arg tests still pass**.
  - Side effects: `GameScene` constructs `new Inventory()` (~line 281) — updated in Step 5 to inject
    capacity + `maxStackOf`; leaving it no-arg here keeps the build green between steps.
  - Docs: none (system-level; STATUS.md updated in Step 7).
  - Done when: `npm test` green (new stacking tests + all existing Inventory/data tests).

- [ ] **Step 2: Item data — `maxStack`, `icon`, add stone** `[delegate sonnet]` (parallel: A)
  - `src/data/types.ts`: add `maxStack: number` and `icon: string` (asset path relative to
    `public/assets/icons/`, e.g. `wood.png`) to `ItemDef`. Keep `color` (placeholder/fallback tint).
  - `src/data/items.ts`: set `wood` `maxStack` + `icon: 'wood.png'`; add `stone`
    (`{ id:'stone', name:'Stone', color:<grey>, maxStack:<n>, icon:'stone.png' }`).
  - `src/data/__tests__/data.test.ts`: extend invariants — every `ItemDef.id === key`, `maxStack > 0`,
    non-empty `icon` (mirror existing invariant style).
  - Side effects: `UIScene.refreshWood`/`ITEMS.wood.color` still valid (Step 4 replaces that widget).
    Write-disjoint from Step 1 (touches `types.ts`/`items.ts`/`data.test.ts` only) and no data dependency
    on it → runs in parallel group A.
  - Docs: none here.
  - Done when: `npm test` green; `npm run build` typechecks with the new `ItemDef` fields.

- [ ] **Step 3: Placeholder icons + Preload loads them** `[delegate sonnet]`
  - Create committed **32×32** placeholder PNGs `public/assets/icons/wood.png` + `stone.png` (simple
    on-theme flat squares w/ a letter, transparent bg — generate with a tiny PIL snippet, commit the
    PNGs). These guarantee icon texture keys always resolve until real art lands.
  - `src/scenes/PreloadScene.ts`: load each `ITEMS` entry's icon as `this.load.image(iconKey(id), url)`
    where `url = ${BASE_URL}assets/icons/${icon}`. Add an `iconKey(id) => 'icon:'+id` helper (colocate
    with the other key helpers). Icons are standalone images (not sheet-sliced) — no `TILE_SIZE` framing.
  - Side effects: depends on Step 2 (`ITEMS[*].icon`). Keep robust: UI (Step 4) falls back to `color`
    rect if a texture key is somehow missing, so a future icon-less item never hard-crashes.
  - Docs: none here (asset-location note added in Step 6's `docs/ASSETS.md` edit).
  - Done when: `npm run build` clean; icons present in `dist/`; `npm run smoke` still 0 console errors.

- [ ] **Step 4: SlotGrid widget + hotbar & inventory Panel in UIScene** `[inline]`
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
    Panel open/close is visibility-driven (matches inspect panel). Depends on Steps 1–3.
  - Docs: none here.
  - Done when: `npm run build` clean; manual/e2e check — hotbar shows a live wood stack that grows while
    chopping and rolls to a 2nd slot past `maxStack`; INVENTORY button opens/closes the grid; taps on
    them don't leak to the world; hotbar hidden in combat mode.

- [ ] **Step 5: Block harvest when full + wire real capacity/maxStack + dev stone** `[inline]`
  - `src/scenes/GameScene.ts`: construct `new Inventory({ capacity: INVENTORY_SLOTS, maxStackOf: (id) =>
    ITEMS[id]?.maxStack ?? DEFAULT_MAX_STACK })`. Guard the chop yield: if
    `!inv.canAccept(woodItemId, woodPerHit)`, **don't chop** (skip the hit; light feedback — e.g. reuse an
    existing flash/no-op path, no new HUD text required). Optionally stop targeting a node when full.
  - Dev-only **starter stone**: under `import.meta.env.DEV`, grant a few `stone` at world init so the
    second item type is visible in the grid (not shipped in production play). Also accept `stone` in the
    `__test.applyScenario` inventory seed (already generic over ids — verify) and let scenarios set a
    small `capacity` to exercise block-when-full.
  - Side effects: `applyScenario` inventory reset/seed (~line 1263/1281) must still round-trip via the new
    slot API (`spend(snapshot)` to clear, `add` to seed). Verify determinism (Tier-2 harness).
  - Tests: add/extend a Tier-2 scenario (`tests/e2e/`) — seed a tiny-capacity bag near-full, chop, assert
    the chop is **blocked** (wood count unchanged) via `state()`/`inspect`. Extend `__test` inspect to
    expose inventory counts if needed.
  - Docs: none here.
  - Done when: `npm test` + `npm run e2e` green; chopping into a full bag no longer increments wood.

- [ ] **Step 6: Gemini icon-generation pipeline (script + prompt manifest + docs)** `[inline]`
  - New `scripts/gen-icons/`:
    - `prompts.py` (or `.json`) — a **shared style preamble** (dark-grotty-but-funny; single centered
      item; flat/transparent or solid keyable background; chunky readable silhouette; limited palette;
      slight top-down 3/4 item-icon framing; **no text/no border**; designed to survive a hard 32×32
      downscale) **+ one subject line per item** (`wood`, `stone`, …). Adding an item = one line.
    - `generate.py` — reads the manifest, POSTs to
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`
      with header `x-goog-api-key: $GEMINI_API_KEY` (env; error clearly if unset, mirroring
      `gen-art/lib.mjs requireEnv`). Saves raw ~1024px PNG to `scripts/.gen-icons/raw/<id>.png`
      (gitignored), then **PIL post-process** → key out background to alpha → square-crop → **nearest-
      neighbour downscale to 32×32** → optional palette quantise → `public/assets/icons/<id>.png`
      (committed). Flags: `--only <id>` (regen one), `--dry-run` (build prompts, no API call), `--raw-only`.
    - `README.md` — mirror `scripts/gen-art/README.md`: the Tailscale/LAN-key note (key from
      `guppi/house-helper/.env`, never commit), run commands, the style rules, that **raw is gitignored /
      processed 32×32 PNGs are committed**, and how to add a new item.
  - `.gitignore`: add `scripts/.gen-icons/` (raw scratch) — mirror `scripts/.gen-art/`.
  - Docs: update `docs/ASSETS.md` (new **Item icons** subsection: pipeline, 32×32 target, where icons
    live `public/assets/icons/`, placeholder→real flow) and `docs/ASSET-EXPERIMENTS.md` (promote the
    Gemini "proposed workflow" to the **actual** `scripts/gen-icons/` pipeline; note the Tailscale route
    to the key).
  - Side effects: script files are write-disjoint from game code; it only *writes into*
    `public/assets/icons/` when run (overwriting Step 3 placeholders — intended). Depends on Step 2 (item
    ids for the manifest). Pure tooling — no game build impact.
  - Done when: `python3 scripts/gen-icons/generate.py --dry-run` prints the composed per-item prompts;
    docs updated; `.gitignore` covers raw scratch.

- [ ] **Step 7: Generate real icons (gated on key) + wrap-up sweep** `[inline]` — **review checkpoint**
  - **If** the `GEMINI_API_KEY` is reachable this session (Matt confirms Tailscale up / provides the key,
    and the agent proxy allows `generativelanguage.googleapis.com`): run
    `python3 scripts/gen-icons/generate.py`, eyeball the 32×32 results at in-game scale, replace the
    placeholder `wood.png`/`stone.png`, note origin. **Else:** leave placeholders committed; Matt runs the
    pipeline locally later. Record which happened.
  - Update `docs/STATUS.md` (feature/plan history: inventory stacking + hotbar/panel + icon pipeline).
  - Wrap-up gate: `npm test` + `npm run e2e` + `npm run smoke` all green; commit each coherent stage and
    `git push -u origin claude/inventory-stacking-icons-dmdjvx` per WORKFLOW.md.
  - Done when: full sweep green, docs updated, work pushed; real vs placeholder icon status recorded.

### Parallelism

- **Group A: Steps 1 & 2** — both `[delegate]`-able in isolation, no data/ordering dependency
  (Inventory takes an injected `maxStackOf`, not `ITEMS`), and write-disjoint (`Inventory.ts`+`config.ts`+
  `Inventory.test.ts` vs `types.ts`+`items.ts`+`data.test.ts`). Step 1 is tagged `[inline]` for API-design
  judgement, so in practice only Step 2 is a clean delegate; if Step 1 is also delegated they may run
  concurrently. Steps 3→7 are sequential (each builds on prior output; Steps 4/5 share UIScene/GameScene
  and the icon dir, so no further parallelism).

## Out of scope

- **A real stone source** (rock resource node / mining action + sprite) — stone is dev-granted/seedable
  only this slice; a `NODES` rock entry is a future plan.
- **Ground-drop / item pickups** when full (chose block-harvest), **drag-to-rearrange / split stacks**,
  and **equip/consume from slots** — later inventory UX.
- **Persistence** of inventory to localStorage/IndexedDB (tracked separately).
- **Icons beyond wood + stone**, and **any non-icon art** (tiles/mobs) — the pipeline is built to extend,
  but only these two are generated now.
- **Crafting/recipes** consuming stacks — separate system.
