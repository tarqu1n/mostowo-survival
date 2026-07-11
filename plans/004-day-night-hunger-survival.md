# Day/Night Cycle + Hunger (Survival Slice)

> Status: planned — run /execute-plan to begin.

## Summary

The survival slice from GAME-DESIGN.md's MVP item 4 and the day/night pillar. Adds a **real-time
day/night clock** that auto-advances every frame, drives a full-screen **darkening tint** that
smoothly transitions across dawn/dusk, and exposes a readable **phase state** (`day`/`night`) +
**day count** other systems can query. Adds the **hunger** core need: a meter that ticks down with
time, and — when it hits zero — **starves the player**, draining the health introduced by the combat
slice (plan 003). Food enters the world two ways: a new **edible item** and a **forageable berry-bush
node** (a walkable resource node mirroring the tree/chop machinery). Eating happens through a new
**Health & Wellbeing screen** — an in-HUD overlay showing the hunger + health meters, the player's
**stats** (from combat's stats bag), and a "what's available to eat" list you tap to consume. A
**second, separate overlay** holds the **inventory** (full item list) and an **equipped-items**
section (a display shell — there's no equipment model yet, so equipped slots render empty, ready for
a future equip system). Night is **tint + phase only this slice** — no enemy spawning (that layers on
after combat). Nothing is persisted; all survival state resets on reload (consistent with the
un-saved world today).

## Context & decisions

**Locked with the user:**
- **Time model:** fixed real-time loop (continuous auto-advancing cycle, smooth tint). Because a
  production-speed cycle is untestable via `waitForTimeout`, add debug fast-forward hooks (Step 8)
  mirroring the existing `debug:regenTrees` event so the smoke test can drive the clock/hunger.
- **Night scope:** darkening tint + queryable phase state only. **No enemy waves this slice.**
- **Health:** builds on **plan 003 (combat), now EXECUTED and deployed to `master`** (this plan branch
  is rebased on top of it). The real, in-code contract (verified, current anchors):
  `private playerStats!: CombatantStats` (`GameScene.ts:96`, populated `:171`),
  `private playerHp` (`:97`, initialised to `playerStats.maxHp` at `:180`),
  `private damagePlayer(amount: number)` (`:626` — `playerHp = Math.max(0, playerHp - amount)`, emits
  `player:hpChanged { hp, maxHp }` at `:628`, and on `playerHp <= 0` calls `this.scene.restart()` at
  `:629-631`; no game-over screen, no save). **Starvation routes damage through `damagePlayer(...)`**,
  reusing that exact death path. Two facts that resolve critique findings: `debugState()` (`:952`)
  **already returns `playerHp`** (`:962/:976`) plus `mode`/`zombies`, so the smoke reads HP directly —
  no need to add it. But `playerStats` is a **private field, not on the registry**, so the Wellbeing
  screen's stats rows require GameScene to `registry.set('playerStats', this.playerStats)` (added in
  Step 6). Combat also shipped an `InspectableStats` type + an Inspect-mode stats panel in `UIScene` —
  the Wellbeing stats rows should reuse that rendering shape for consistency.
- **Food source:** both — a new edible item **and** a forageable berry-bush node.
- **Persistence:** **runtime-only, none this slice.** Saving only the clock/hunger while the world,
  inventory, walls and position all reset on reload would be incoherent; real persistence lands with a
  full save system later. Do **not** add a `localStorage` survival save.
- **Eat UX:** a **Health & Wellbeing screen** (not a bare eat button): meters for hunger + health,
  the player's **stats** (plan 003's `playerStats: CombatantStats` — maxHp/armour/speed/strength/
  dex/dodge/vision), and an edible-items list; tap an item to eat one unit.
- **Two separate overlays** (user call): overlay A = Health & Wellbeing (needs meters + stats +
  eat); overlay B = **Inventory + Equipped**, a distinct panel opened by its own button, listing the
  full inventory and an **equipped-items display shell**. There is **no equipment model** in the game
  (no equippable items, no slots — plan 003's attack is unarmed Punch), so equipped renders as empty
  placeholder slots wired to display whatever a future equipment model provides; **no equip/unequip
  action this slice.** Both overlays share one reusable in-`UIScene` panel helper (built in Step 6,
  reused in Step 7).

**Codebase seams (anchors REFRESHED against post-combat `master` — plan 003 landed and shifted every
line number; reconfirm before editing but these are current as of the rebase):**
- **Tick seam:** `src/scenes/GameScene.ts` `override update(_time, delta)` (**now `:293`**). The idle
  branch (`if (!this.queue.current)` early-return) and the busy `switch` (`:309/:312`) return without a
  shared tail, so **anything that must run every frame regardless of worker state (clock advance,
  hunger drain) goes at the TOP of `update()`, above the early-return.** `delta` (ms) is the per-frame
  unit; the **accumulator pattern** to mirror is `runHarvest` (`:483`, `chopElapsed += delta`, fire on
  crossing `CHOP_INTERVAL_MS`) / `runBuild` (`:496`, `site.progress += delta`). **Large-delta guard:**
  on tab-refocus Phaser can hand a big `delta`; `drainHunger` clamps to `[0,max]` and the starvation
  `while`-loop is bounded (decrements each iteration), so no NaN/runaway — but keep the drain math
  clamp-first.
- **Full-screen overlay precedent (the tint):** `GameScene.ts:244` —
  `this.add.rectangle(BASE_WIDTH/2, BASE_HEIGHT/2, BASE_WIDTH, BASE_HEIGHT, 0x000000, 0.2).setDepth(5)
  .setMask(fogMask)` (the fog dim). **The world is base-sized** (the map ≈ `BASE_WIDTH×BASE_HEIGHT`
  world px and the camera clamps to it), which is why this **world-space** rect (centred on the map,
  **no `setScrollFactor`**) always covers the viewport. The night overlay must **mirror this exactly**:
  world-space, same centre/size, **no `setScrollFactor(0)`** (Finding 5 — earlier draft contradicted
  itself; drop it). Only difference: a higher depth so it dims globally. Depth map: world content 0–4,
  fog overlay 5, ghost 6 (`:252`), player 10 (`:221`). A **global** darken sits **above the player**
  (`setDepth(15)`) so everything dims uniformly; still under the HUD (`UIScene` is a separate scene on
  top). Alpha-ramp model: `site.rect.setAlpha(...)` in `runBuild`.
- **Post-combat HUD occupancy (plan 003 filled zones the earlier draft treated as free — new buttons
  must avoid these):** top-left = wood counter (`10,12`) + queue text (`10,26`); **left, below
  wood/queue = COMBAT + INSPECT mode toggles** (`UIScene.ts:160-179`); top-center = zoom row + FOLLOW;
  top-right = BUILD + CANCEL; **bottom-right = virtual movepad** (centre `300,540`, radius 40) and
  **bottom-left = Punch** — but these two are **hidden unless mode==='combat'** (`:181`), so they're
  free in Command mode yet a *persistent* button placed there would collide when Combat is toggled.
  Inspect mode shows a **centered stats panel**. Safe slots for the new STATUS/BAG buttons: the
  right edge below CANCEL, or stacked near the mode toggles — **not** the two bottom corners. The
  day/night readout (passive) fits top-center under FOLLOW or top-left under the queue text.
- **Cross-scene comms:** two channels. `this.registry` for initial-state reads (`inventory` `:186`,
  `zoom` `:1020`, `following` `:232,1040`); `this.game.events` for live updates. GameScene setters write
  **both** (`registry.set` + `emit('*:changed', …)`) so a scene restart re-seeds correctly — mirror
  this for new state. Events emitted: `tasks:changed` (`:448`), `build:modeChanged` (`:880`),
  `zoom:changed` (`:1026`), `camera:followChanged` (`:1047`). **Teardown:** every `.on` needs a matching
  `.off` in the `SHUTDOWN` block (GameScene `:277-287`, UIScene `:286-294`) or restart double-registers.
- **HUD template:** `UIScene.ts` `BASE_WIDTH=360 × BASE_HEIGHT=640` portrait. Interactive button =
  `Rectangle(...).setStrokeStyle(1, COLORS.ui, 0.6).setInteractive({ useHandCursor: true })` + centred
  `Text` (`fontFamily:'monospace', fontSize:'12px', color:'#e8dcc0'`), **pushed to `this.hudElements`**
  so `hudHitTest` excludes it from world taps (`:79-87`). A **passive readout/meter** (wood counter
  `:66-68`) is a plain rect+text and is **not** pushed to `hudElements`. Live-update pattern:
  seed from `registry` in `create()`, then subscribe to the `*:changed` event. Free HUD space: left
  edge below the queue text (y≳40) and the bottom band between the two bottom corners.
- **Inventory** (`src/systems/Inventory.ts`, extends `Phaser.Events.EventEmitter`, emits `'change'`
  after every mutation; UIScene subscribes to the instance directly): has `get/add/has/canAfford/
  spend/snapshot` but **no `remove`** — eating needs a new `remove(id, n=1): boolean`. **Finding 7:**
  the existing `spend` decrements but **leaves 0-count keys in the map** (it does `set(id, get(id)-n)`,
  never deletes), and `snapshot()` returns them. So `remove` must **match `spend`** (decrement, leave
  the 0-key, emit `'change'`, return false if `< n`) — do **not** delete the key — and any consumer
  that iterates `snapshot()` (the Step 7 inventory list, the Step 6 edible list) must **skip
  0-count entries** so emptied items don't render as ghost rows.
- **Data pattern** (static def + scene-local runtime wrapper): `src/data/types.ts` — `ItemDef
  {id,name,color}`; **`ResourceNodeDef` now `extends ObjectStats`** (plan 003 added `maxHp,armour,
  speed,vision?`) plus `{id,name,woodItemId,woodPerHit,regrowMs,color,stumpColor}`; `BuildableDef
  extends ObjectStats`. Player stats use `CombatantStats` (extends `BaseStats` with strength/dex/
  dodge); `InspectableStats {name,maxHp,currentHp?,extra?}` is the panel-render shape. `src/data/
  items.ts` has only `wood`; `src/data/nodes.ts` only `tree` (note its inert `armour:0,speed:0`). New
  node/item entries must include the inherited `ObjectStats` fields (`armour:0,speed:0`). Runtime
  `TreeNode {id,sprite,def,hp,alive,col,row}` embeds the def by reference; `chop()` mutates the
  instance, never the def; `maxHp` is catalog-only, current `hp` is per-instance.
- **Harvest lifecycle (the forage template):** `spawnTrees` (`:712`) → `addTree` (`:722`), harvest
  order resolves via a tree hit-test → `{kind:'harvest'}`; **live trees block pathing via `isBlocked`
  (`:323-324`, `this.trees.some(t => t.alive && …)`)**; `runHarvest` (`:483`) accumulates `chopElapsed`
  then `chop()` (`:764`) does `hp-=1`, **`this.inv.add(tree.def.woodItemId, tree.def.woodPerHit)`** (the
  item-into-inventory line to mirror), stump tint on depletion, `this.time.delayedCall(tree.def.
  regrowMs, …)` (`:773`) to regrow. **Second node-array site (Finding 2):** `tilePlaceable` (`:892`)
  independently does `this.trees.some(t => t.alive && …)` at `:896` to forbid building on a live node —
  so `blocksPath` must be honoured in **both** `isBlocked` and `tilePlaceable`, not just pathing.
  Worker stands **adjacent** to harvest via `reachableAdjacent` (`:403`), never on the target tile.
- **Config** (`src/config.ts`): all tunables live here; `COLORS` `as const` (`:54`, comment invites
  expansion). `TILE_SIZE=16`, `BASE_WIDTH/HEIGHT` `:9-10`.
- **Smoke** (`scripts/smoke.mjs`): Playwright vs `npm run preview`; reads
  `window.game.registry.get('inventory')`, `GameScene.debugState()` (`GameScene.ts:952`, the
  primary state seam — **add fields here for assertions**), `GameScene.isTileBlocked(col,row)` (`:983`).
  Taps via `tapBase`/`tapWorld`/`longPressWorld`; assertions are manual `ok()`/`fail()`; page errors
  collected and asserted empty. **Only zoom persists** (`localStorage`, key `mostowa:zoom`) — confirm
  no game-state save exists.

**Direction (README / GAME-DESIGN / DECISIONS):** mobile-first portrait touch, data-driven catalogs,
**systems decoupled from Phaser** (pure modules in `src/systems/`), UI decoupled via `UIScene`,
trunk-based on `master`, programmatic placeholder art first. Hunger is called out as a **core**
Don't-Starve-style pressure (constant, punishes hoarding), and the Health & Wellbeing screen +
"what's available to eat" section are described design intent — this slice builds the first cut of both.

## Steps

- [ ] **Step 1: Day/night clock — pure system, tick, and darkening tint overlay** `[inline]`
  - New pure module `src/systems/daynight.ts` (Phaser-free, alongside `tasks`/`pathfind`/`grid`):
    `export type DayPhase = 'day' | 'night'`; `cycleLengthMs()` = `DAY_MS + NIGHT_MS`; `phaseAt(cycleMs:
    number): DayPhase` (day while `cycleMs < DAY_MS`, else night); `tintAlphaAt(cycleMs: number):
    number` — 0 through the day, ramping up to `NIGHT_MAX_ALPHA` at night, cross-fading over
    `TWILIGHT_MS` at each day↔night boundary (dusk ramp up over the last `TWILIGHT_MS` of day, dawn
    ramp down over the first `TWILIGHT_MS` of day); `dayCountForTotal(totalMs: number): number` =
    `Math.floor(totalMs / cycleLengthMs()) + 1` (day 1 at t=0). Keep every function pure of Phaser and
    of module-level mutable state — pass values in.
  - `src/config.ts`: add `DAY_MS = 120_000`, `NIGHT_MS = 90_000`, `TWILIGHT_MS = 8_000`, and to
    `COLORS` add `night: 0x0a1020` (deep blue-black). Add `NIGHT_MAX_ALPHA = 0.55`. Values are
    tune-by-feel like the combat numbers — pick these as defaults.
  - `GameScene.ts`:
    - Fields: `private clockMs = 0` (total elapsed), `private dayPhase: DayPhase = 'day'`,
      `private dayCount = 1`, `private nightOverlay!: Phaser.GameObjects.Rectangle`.
    - In `create()`, build the overlay right after the fog overlay (`:244`), **mirroring the fog rect
      exactly** (world-space, **no `setScrollFactor`** — the map is base-sized so a world-space rect
      covers the viewport; Finding 5): `this.nightOverlay = this.add.rectangle(BASE_WIDTH/2,
      BASE_HEIGHT/2, BASE_WIDTH, BASE_HEIGHT, COLORS.night, 0).setDepth(15)` (depth 15 = above the
      player at 10, so the dim is global). Do **not** call `setInteractive` (rects aren't interactive
      by default — confirm it stays non-interactive so it never eats pointers).
    - At the **TOP of `update(_time, delta)`, above the early-return (`:293`)**: `this.clockMs += delta`;
      `const cycleMs = this.clockMs % cycleLengthMs()`; set `this.nightOverlay.setAlpha(tintAlphaAt(
      cycleMs))`; compute `phaseAt`/`dayCountForTotal`; when either changes from the stored value,
      update the field, `this.registry.set('dayPhase'/'dayCount', …)` and emit
      `time:changed { phase, dayCount, cycleMs, tNorm: cycleMs / cycleLengthMs() }`. Emit `time:changed`
      on the frame the phase or day flips (the HUD readout in Step 2 also reads `registry` for its
      initial value). Seed `registry.set('dayPhase','day')`/`set('dayCount',1)` in `create()`.
  - Side effects: adds one always-per-frame `setAlpha` — negligible. The overlay must not intercept
    pointers (rectangles aren't interactive unless `setInteractive` is called — confirm it isn't).
    Ensure it sits below `UIScene` (it does — separate scene). Check depth 15 doesn't hide the build
    ghost (depth 6) in a way that matters at night — a dimmed ghost is acceptable.
  - Docs: none yet (batched into Step 8).
  - Done when: `npm run build` is green; running the game visibly darkens toward night and lightens
    toward day on a loop; `debugState()` (extended in Step 8) will expose `clockMs`/`dayPhase`/`dayCount`.

- [ ] **Step 2: Day/night HUD readout** `[delegate]`
  - `UIScene.ts`: add a **passive** readout (plain rect+text, **not** pushed to `hudElements`) showing
    the current phase + day, e.g. `Day 1 ☀` / `Day 1 ☾` (ASCII fallback `Day 1 [day]`/`[night]` if the
    glyph renders poorly at 12px). Place it top-center-ish in free space (below the zoom row / above
    the build indicator — pick a slot that doesn't overlap existing elements; the bottom-center build
    indicator is hidden unless building, top band is partly free). Follow the wood-counter template
    (`:66-68`).
    - Seed initial text from `this.registry.get('dayPhase') ?? 'day'` and `get('dayCount') ?? 1` in
      `create()`.
    - Subscribe to `time:changed` in the listener-registration block (`:277-283`); update the text in
      the handler; **add the matching `.off` in the SHUTDOWN block** (`:286-294`).
  - Side effects: none beyond one more HUD element; verify it doesn't overlap the zoom/follow/build
    widgets at 360px wide.
  - Docs: none (Step 8).
  - Done when: build green; the readout updates from day→night→day and increments the day number each
    full cycle.

- [ ] **Step 3: Edible item + Inventory.remove (food plumbing)** `[delegate]`
  - `src/data/types.ts`: extend `ItemDef` with `nutrition?: number` (present ⇒ edible; the hunger
    restored per unit).
  - `src/data/items.ts`: add `berries: { id: 'berries', name: 'Berries', color: 0x7a2f4a, nutrition:
    25 }`.
  - `src/systems/Inventory.ts`: add `remove(id: string, n = 1): boolean` — if `this.get(id) < n` return
    `false`; else `this.items.set(id, this.get(id) - n)` (**leave the 0-count key in the map, exactly
    like `spend` does — do NOT delete it**; Finding 7), `this.emit('change', this.snapshot())`, return
    `true`. Mirror `spend`'s structure. Consumers that iterate `snapshot()` skip 0-count entries
    (Steps 6/7).
  - Side effects: `ItemDef.nutrition` is optional so `wood` and all existing usage stay valid. No
    caller uses `remove` yet (wired in Steps 5/6). Smoke reads `inventory.get('wood')` — unaffected.
  - Docs: none (Step 8).
  - Done when: build green; `remove` returns false when short and decrements + emits otherwise
    (exercise via a throwaway check or the Step 8 smoke).

- [ ] **Step 4: Forageable berry-bush node (generalise the resource-node system)** `[inline]`
  - Goal: trees and berry bushes are both `ResourceNodeDef` entries differing only in **data**, per the
    data-driven convention.
  - `src/data/types.ts`: rename `ResourceNodeDef.woodItemId → yieldItemId` and `woodPerHit →
    yieldPerHit` (generic yield), and add `blocksPath: boolean` (trees block pathing, bushes don't).
    Keep `stumpColor` (bushes can reuse it as a picked/depleted tint).
  - `src/data/nodes.ts`: update `tree` to the new field names + `blocksPath: true`; add
    `berryBush: { id:'berryBush', name:'Berry Bush', maxHp: 1, armour: 0, speed: 0, yieldItemId:
    'berries', yieldPerHit: 2, regrowMs: 20_000, blocksPath: false, color: <berry-green>, stumpColor:
    <depleted> }` (single-pick `maxHp:1`; `armour:0,speed:0` are the inert `ObjectStats` fields
    `ResourceNodeDef` inherits — see the tree entry).
  - `GameScene.ts`:
    - Propagate the rename (`tree.def.woodItemId → yieldItemId`, `woodPerHit → yieldPerHit` in `chop()`
      `:764`).
    - **Honour `def.blocksPath` at BOTH node-array sites (Finding 2), not just pathing:** `isBlocked`
      (`:323-324`) and `tilePlaceable` (`:892`, the `this.trees.some(...)` at `:896`) both currently
      treat every live node as an obstacle — gate each on `t.def.blocksPath` so a bush blocks neither
      routing nor build-placement (a bush is walkable and buildable-over). Audit for any other
      `this.trees.some/find/filter/forEach` site while there.
    - Spawn berry bushes at **fixed, deterministic coordinates** (mirror `spawnTrees` `:712`, which
      places trees at known tiles) — the smoke test taps a **known bush tile**, so the coords must be
      stable, not random. **Prefer generalising to one runtime array** (`nodes: ResourceNode[]`) driven
      by `def` if the churn is contained; if it balloons, add a second `bushes` array reusing the
      identical `addTree`/harvest/`chop` functions and note the duplication for later cleanup. The
      harvest hit-test must include bushes so tapping one yields a `{kind:'harvest'}` order.
  - Provide a placeholder bush sprite the way trees get theirs (check how `addTree` `:722` obtains the
    `'tree'` texture and mirror it — a solid-colour rect/image if no bush art is staged; do **not**
    block on real art).
  - Side effects: making bushes non-blocking touches routing **and** build-placement — verify (a) the
    worker routes **through** bush tiles (a bush no longer forces a detour), (b) it still harvests by
    standing on a **reachable adjacent** tile via `reachableAdjacent` `:403` (never on the target), and
    (c) building on/over a bush tile is now allowed and doesn't crash the placement check. Regrow reuses
    the same `delayedCall(regrowMs)` path.
  - Docs: none (Step 8).
  - Done when: build green; tapping a berry bush routes the worker **through** other bush tiles (unlike
    trees), it stands **adjacent** and harvests `berries` into the inventory, and the bush depletes
    then regrows; building over a bush tile is permitted.

- [ ] **Step 5: Hunger need — model, per-frame drain, and starvation → health cascade** `[inline]`
  - New pure module `src/systems/needs.ts` (Phaser-free): `drainHunger(current, deltaMs, drainPerSec,
    max)` → `clamp(current - drainPerSec*deltaMs/1000, 0, max)`; `feed(current, nutrition, max)` →
    `Math.min(max, current + nutrition)`; `isStarving(hunger)` → `hunger <= 0`.
  - `src/config.ts`: add `HUNGER_MAX = 100`, `HUNGER_DRAIN_PER_SEC = 0.4` (≈250 s from full to empty —
    ~1.5 cycles; tune by feel), `STARVE_DAMAGE = 1`, `STARVE_DAMAGE_INTERVAL_MS = 2_000` (1 HP per 2 s
    while starving).
  - `GameScene.ts`:
    - Fields: `private hunger = HUNGER_MAX`, `private starveElapsed = 0`.
    - At the **top of `update()`** (next to the Step 1 clock advance, above the early-return): drain
      `this.hunger = drainHunger(this.hunger, delta, HUNGER_DRAIN_PER_SEC, HUNGER_MAX)`; when the
      integer/rounded displayed value changes, emit `hunger:changed { hunger: this.hunger, max:
      HUNGER_MAX }` and `registry.set('hunger', this.hunger)` (seed both in `create()`). Starvation
      accumulator mirroring the chop-interval pattern: `if (isStarving(this.hunger)) { this.starveElapsed
      += delta; while (this.starveElapsed >= STARVE_DAMAGE_INTERVAL_MS) { this.starveElapsed -=
      STARVE_DAMAGE_INTERVAL_MS; this.damagePlayer(STARVE_DAMAGE); } } else { this.starveElapsed = 0; }`
      — **`damagePlayer` is plan 003's method**; integer damage keeps HP whole and reuses 003's
      death=`scene.restart()` path (a fully-starved player who takes no other damage still dies over
      time, then the scene restarts — hunger resets to `HUNGER_MAX` on restart since it's a field
      re-initialised in `create()`).
    - Add an `eat(itemId: string): boolean` method (used by Step 6): if the item isn't edible
      (`ITEMS[itemId]?.nutrition == null`) or `!this.inv.remove(itemId, 1)`, return false; else
      `this.hunger = feed(this.hunger, ITEMS[itemId].nutrition!, HUNGER_MAX)`, emit
      `hunger:changed`/`registry.set`, return true. Expose it for the Step 6 UI to call (via a
      `game.events` listener, e.g. `needs:eat { itemId }`, registered/torn-down in the debug-event
      block (`:268/:280`) — matching the existing event-in pattern like `build:toggle`).
  - Side effects: **plan 003 is already deployed**, so `damagePlayer` (`:626`), `playerHp`, and the
    death path exist — no ordering risk. `ItemDef.nutrition` is added in Step 3, so `eat` can read it.
    The hunger tick runs every frame regardless of worker state (above the early-return). NaN/large-
    delta safety: `drainHunger` clamps to `[0,max]` and the `while` starvation loop is bounded (it
    decrements each iteration), so a big tab-refocus `delta` at most deals a burst of capped damage.
  - Docs: none (Step 8).
  - Done when: build green; hunger visibly falls over time (via the Step 6 meter or `debugState`);
    forcing hunger to 0 (Step 8 debug hook) starts ticking `playerHp` down every 2 s and eventually
    triggers 003's restart; eating raises hunger.

- [ ] **Step 6: Reusable overlay panel + Health & Wellbeing screen (meters + stats + "what's available to eat")** `[inline]`
  - **Reusable panel helper (built here, reused by Step 7):** factor a small in-`UIScene` overlay
    primitive so both overlays share one implementation — a dimmed full-screen backdrop rect + a
    centred panel rect (both high depth so they sit above other HUD elements) + a close affordance (an
    ✕ button and/or tapping the backdrop) + open/close that manages `hudElements` membership (add the
    backdrop + interactive rows on open so world taps don't leak through; remove/hide on close —
    `hudHitTest` is visibility-aware so hidden elements already don't swallow taps). Only one overlay
    open at a time (opening one closes the other). Keep it a plain object/method group within
    `UIScene`, not a new Phaser scene (simpler; the world keeps running underneath — real-time
    survival). Panels populate their body via a per-overlay render callback.
  - `UIScene.ts`: add a **STATUS** button (interactive, pushed to `hudElements`, button template
    `:79-87`) in a free HUD slot (e.g. top-left under the wood counter, or bottom-left) that toggles
    the Health & Wellbeing overlay via the helper. Panel contents:
    - **Hunger meter:** label + a bar = background rect + foreground rect whose width =
      `barWidth * hunger / HUNGER_MAX` (there's no existing bar widget — the closest analog is
      `site.rect` width/alpha feedback; build a simple two-rect bar). Colour it (e.g. amber), turn it
      red when `isStarving`/near-zero. Seed from `registry.get('hunger') ?? HUNGER_MAX`; live-update on
      `hunger:changed`.
    - **Health meter:** same two-rect bar, seeded from `registry.get('playerHp')`/plan 003's
      `player:hpChanged { hp, maxHp }` event (subscribe to it; if 003 stores HP only via the event and
      not the registry, seed lazily to `maxHp` and fill in on the first event). If plan 003's exact
      HP surface differs, adapt to whatever it emits.
    - **Player stats:** a read-only list of plan 003's `playerStats: CombatantStats`
      (maxHp, armour, speed, strength, dex, dodge, and `vision` if present) rendered as
      `label: value` rows (mirror 003's Inspect-mode stats-panel display style if that's landed).
      These are static this slice (nothing changes them) — read once from `registry.get('playerStats')`.
      **Dependency:** requires GameScene to expose `playerStats` on the registry; if plan 003 doesn't
      already `registry.set('playerStats', this.playerStats)` in `create()`, add that one line as part
      of this step (it's 003's data, surfaced for the HUD).
    - **"What's available to eat" list:** iterate `ITEMS` for entries with `nutrition != null`, show
      each with its live count from `this.inv.get(id)` and its nutrition; make each row interactive
      (button template) — tapping it emits `needs:eat { itemId: id }` (Step 5 handles it) **only when
      count > 0**; rows with 0 render disabled/greyed. Refresh the list counts on the Inventory
      `'change'` event (subscribe to the instance like `refreshWood` does, `:276`) and on
      `hunger:changed`.
    - While the panel is open, its interactive rows/close/backdrop must be in `hudElements` so world
      taps don't leak through; when closed, remove/hide them (respect `hudHitTest`'s visibility-aware
      check — hidden elements already don't swallow taps).
  - **Teardown:** every new `.on` (`hunger:changed`, `player:hpChanged`, Inventory `'change'`) gets a
    matching `.off` in the UIScene SHUTDOWN block (`:286-294`).
  - Side effects: this is the first modal overlay in the HUD (via the reusable helper) — make sure
    opening it doesn't break the existing `hudHitTest` world-tap gating for the buttons underneath
    (they're covered by the backdrop which should itself be in `hudElements`). Verify the panel lays
    out within 360×640 and is thumb-reachable.
  - Docs: none (Step 8).
  - Done when: build green; STATUS opens the screen showing live hunger + health bars, the player
    stat rows, and an edible list; tapping Berries (count>0) decrements the count, raises the hunger
    bar, and closes/stays-open consistently; the bars track live as hunger drains and HP changes.

- [ ] **Step 7: Inventory + Equipped overlay (display shell)** `[inline]`
  - `UIScene.ts`: add a second HUD button (e.g. **BAG** / **INV**, interactive, pushed to
    `hudElements`, button template `:79`) in a free slot distinct from STATUS, that opens a second
    overlay **reusing the Step 6 panel helper** (opening it closes the Wellbeing overlay — one at a
    time). Panel contents:
    - **Inventory section:** iterate `this.inv.snapshot()` and render one row per item **with
      `count > 0`** (skip 0-count keys — `spend`/`remove` leave emptied keys in the map, Finding 7):
      item name (from `ITEMS[id].name`), a colour swatch (from `ITEMS[id].color`, like the wood
      counter), and the count. Read-only (no drop/use here; eating stays on the Wellbeing screen).
      Refresh the rows on the Inventory `'change'` event (subscribe to the instance like `refreshWood`),
      so foraging/eating updates the list live while it's open. When every count is 0, show a subtle
      "Empty" line.
    - **Equipped section:** a **display shell only** — render a small fixed set of empty slot boxes
      (e.g. 2–3 rects with a `—`/"empty" label) under an "Equipped" heading, plus a caption like
      "Nothing equipped". Drive it from `registry.get('equipped') ?? {}` (slot→itemId map) so that when
      a future equipment model populates that registry key the same render fills the slots — but this
      slice sets nothing there, so every slot renders empty. **No equip/unequip interaction.**
  - **Teardown:** the Inventory `'change'` subscription (and any panel-specific listeners) get matching
    `.off` in the UIScene SHUTDOWN block (`:286-294`).
  - Side effects: second overlay through the shared helper — verify the "only one open at a time"
    logic and `hudElements` add/remove works when toggling between STATUS and BAG. No new game-state or
    events; purely a read view over `Inventory` + a placeholder. Confirm layout within 360×640.
  - Docs: none (Step 8).
  - Done when: build green; BAG opens a distinct overlay listing all held items with live counts
    (forage a berry → its row/count appears/updates) and an "Equipped" section of empty slots;
    opening BAG closes the Wellbeing overlay and vice-versa.

- [ ] **Step 8: Debug hooks, smoke coverage, and docs** `[inline]`
  - **Debug hooks (so the smoke test can drive a real-time system):** in `GameScene.ts`, add
    `game.events` handlers mirroring `debug:regenTrees` (registered/torn-down in the `:268/:280` block):
    `debug:setHunger { value }` (set `this.hunger`, emit `hunger:changed`) and `debug:advanceTime
    { ms }` (add to `this.clockMs`, recompute phase/overlay/day and emit `time:changed`). These are
    dev-only, matching the existing TEMP `⟳ TREES` convention — no HUD button required; the smoke
    driver emits them via `window.game.scene.getScene('Game').game.events.emit(...)` or a small exposed
    helper. Prefer exposing thin methods (`debugSetHunger`, `debugAdvanceTime`) on GameScene for the
    driver to call, consistent with `debugState()`.
  - **`debugState()`** (`GameScene.ts:952`): it **already returns `playerHp`** (`:962/:976`), `mode`,
    and `zombies` — only add `hunger`, `dayPhase`, `dayCount`, `clockMs` to the returned snapshot for
    the new assertions (don't re-add `playerHp`).
  - **`scripts/smoke.mjs`:** extend the existing run (don't add a second harness). Add assertions:
    (a) advance time into night via `debugAdvanceTime`, assert `debugState().dayPhase === 'night'` and
    that the night overlay alpha rose (assert via `debugState()`/a queried alpha, or that a later
    `advanceTime` rolls `dayCount` up); (b) forage a berry bush (tap it via `tapWorld` at the **fixed
    bush tile from Step 4's deterministic spawn**, `waitForTimeout` for the walk+pick) and assert
    `inventory.get('berries')` rose; (c) set hunger to 0 via `debugSetHunger`, wait >
    `STARVE_DAMAGE_INTERVAL_MS`, assert `debugState().playerHp` (already exposed by combat) fell;
    (d) open STATUS, eat a berry, assert `hunger` rose and `berries` count fell;
    (e) open BAG and assert the inventory overlay is present / shows the held items (a light check —
    e.g. the overlay's item rows reflect `inventory.snapshot()`). Keep the manual `ok()`/`fail()` style
    and the final page-errors-empty assertion.
  - **Docs:**
    - `CLAUDE.md` Status line: append that the survival slice (day/night tint + phase, hunger core +
      starvation→health cascade, forageable food, Health & Wellbeing screen with stats, and a separate
      Inventory + Equipped overlay — equipped a display shell) landed as plan 004; note night is
      tint+phase only (enemies later).
    - `docs/GAME-DESIGN.md`: tick MVP slice item 4's "day/night tint + a survival meter ticking through
      it" as ✅ (day/night + hunger), leaving "short timed wave" as the remaining todo; add a terse note
      under Hunger / Survival systems that the first cut is built (real-time cycle, hunger→health
      cascade via combat's `playerHp`, Health & Wellbeing screen shipped as the eat surface).
    - `docs/DECISIONS.md`: add a dated `[DECIDED]` entry — real-time day/night loop; night = tint+phase
      only this slice; hunger drains combat-owned `playerHp` on starvation; survival state **not**
      persisted (runtime-only) pending a full save system; eat via the Health & Wellbeing screen
      (which also shows player stats); inventory + equipped live in a separate overlay, with equipped a
      **display shell** (no equipment model yet — deferred to a future plan).
    - `docs/WORKFLOW.md` "Smoke-testing the core loop": one line that the smoke now also drives
      day/night + hunger via the `debugAdvanceTime`/`debugSetHunger` hooks.
  - Side effects: debug hooks ship in the build — acceptable (so does `debug:regenTrees`); keep them
    clearly labelled dev-only. Confirm `npm run build` **and** `npm run smoke` (needs `npm run preview`
    running) are both green.
  - Done when: `npm run build` + `npm run smoke` green with the new assertions passing; all four docs
    updated.

## Out of scope

- **Enemy night waves / combat spawning** — night is tint + phase only; waves layer on after combat
  (plan 003) via the phase state this slice exposes.
- **Persistence / save-load** of survival (or any) game state — runtime-only this slice; a full save
  system is a separate later plan.
- **Equipment system** — no equippable items, equip slots, or equip/unequip action this slice. The
  "Equipped" section is a **display shell** driven by a `registry.get('equipped')` map that stays empty;
  a real equipment model (equippable item data, slots, equip flow, combat effect) is a future plan.
- **Additional needs** beyond hunger (warmth, energy, thirst) and the hunger→spoilage/cooking economy —
  hunger + the health cascade only; the Wellbeing screen is built to accommodate more needs later.
- **Cooking / food crafting / spoilage**, multiple food types beyond the one berry item, and food from
  sources other than the berry bush.
- **Real day/night or bush/food pixel art** — placeholder art only (per the art-pipeline decision).
- **NPC companion feeding** (companions consuming food) — depends on the companion system, not built.
- **Daily narrative events** (the day-opens-with-a-choice feature) — separate design, not this slice.

## Critique

Fresh-eyes adversarial review (independent sub-agent, ran against plan 003 + code). **All findings
resolved in this revision** — recorded here so the executor sees what was addressed.

**Verdict:** Solid, well-researched plan; its headline mechanic + half its UI hard-depended on the
then-unexecuted combat plan 003 — since resolved (003 is now deployed and this branch is rebased on
it), with the remaining ripples tightened.

| # | Finding | Severity | Resolution |
| - | ------- | -------- | ---------- |
| 1 | Starvation→health cascade + health/stats UI all require plan 003's `playerHp`/`damagePlayer`/`playerStats`, yet 003 was only planned; CLAUDE.md said survival was "Next" | High | **003 executed & deployed** (user confirmed); branch rebased onto it; Context now cites the real in-code contract + anchors. Combat-first ordering accepted. |
| 2 | `blocksPath` ripple under-enumerated — `tilePlaceable` (`:896`) also does `this.trees.some(...)`, not just `isBlocked` (`:324`) | Medium | Step 4 now gates **both** sites (and audits other `this.trees.some` sites) on `def.blocksPath`. |
| 3 | Equipped section is empty UI for an out-of-scope equipment model | Medium | **Kept as a display shell** (user call); scoped explicitly as a shell in Step 7 + Out of scope, no equip logic. |
| 4 | Smoke coupling: `playerHp` exposure + "known bush tile" determinism | Medium | `debugState()` **already exposes `playerHp`** (verified `:962`); Step 4 pins **fixed bush spawn coords**; Step 8 reads `debugState().playerHp`. |
| 5 | Night-overlay self-contradiction: "match fog rect" vs. `setScrollFactor(0)` | Low | Step 1 now mirrors the fog rect exactly — world-space, **no `setScrollFactor`**. |
| 6 | Step 4 acceptance implied worker stands *on* the bush | Low | Reworded: bushes are non-blocking for **routing**; worker still stands **adjacent** (`reachableAdjacent`) to harvest. |
| 7 | `Inventory.remove` "delete key at 0" mismatched `spend` (which leaves 0-keys) | Low | Step 3 `remove` **leaves the 0-key like `spend`**; Steps 6/7 consumers **skip 0-count** rows. |

Also folded in (the critique predated combat landing on-branch): all file:line anchors refreshed to
post-combat `master`, and a post-combat **HUD occupancy map** added so the new STATUS/BAG buttons and
day/night readout avoid combat's mode-toggle / movepad / Punch zones.
