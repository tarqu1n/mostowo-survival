# Salvage Node Lifecycle

> Status: deployed

## Summary

Turn the destroyed-tent (`salvagedTent`) node into a full two-stage lifecycle: **salvage** it once
(a long, ~20s timed action, tent shaking throughout) to roll its loot and leave a permanent **ruined
husk** that still blocks its tile; then optionally **clear** the husk (an even longer ~40s action)
to remove it, yield a little scrap, and free the tile for building/pathing. Adds a `oneShot`
no-regrow node option, a new generic `clear` order kind (works on any depleted one-shot node), a
timed progress-accumulator harvest model with **progress that persists across cancel**, and
in-progress feedback (a continuous shake + a **progress bar** above the node) while either action
runs. Player-only.

The art (17 live + 17 `_ruined` depleted sprites) and the loot table are already done and committed;
this feature is purely the mechanic + fx wiring on top.

## Context & decisions

Owner decisions (this session):

- **Durations:** salvage **20s**, clear **40s** — real-time *timed* actions (not many quick hits),
  modelled on the existing `build` progress-accumulator (`runBuild`, `site.progress += delta`,
  `BUILD_MS`), with a continuous shake for the whole window. New config `SAVAGE_MS = 20000`,
  `CLEAR_MS = 40000` (generic; per-def override is out of scope).
- **Clear yields a little scrap:** a small second loot payout on clear — modelled as an optional
  per-def `clearLoot?: LootTable` (reuses `systems/loot.ts`). `salvagedTent` gets a small table
  (e.g. cloth 1–2, wood 1). A one-shot node with no `clearLoot` clears silently.
- **Progress persists:** the accumulated action time is stored **on the node** and survives
  cancel/re-queue (resuming continues where it left off). It resets only when a stage completes
  (salvage→ruin resets it for the clear stage; clear removes the node). *(The critique flagged this as
  the costliest/lowest-value element and suggested resetting per-order like `chopElapsed`; owner
  confirmed keeping the persistent behaviour.)*
- **Generic clear, player-only:** `clear` is a new order kind valid on *any* depleted `oneShot`
  node, not just the tent. No NPC-companion wiring.
- **Ruined husk keeps blocking + is clickable until cleared:** reverses today's behaviour where a
  depleted node (`alive=false`) stops blocking (`hasBlockingNode` requires `alive`) and is
  unclickable (`pickSpriteAt` skips `!alive`). A dead **one-shot** node must stay a present,
  tile-occupying, tappable obstacle so "clear the area to build" is meaningful.
- **Player anim:** both salvage and clear use the `gather` (rummage/dismantle) motion — salvage via
  the existing `harvestAnim:'salvage'`→`gather` map (`harvestAnimMotion`); clear maps to `gather`
  too. No new player strip (reskin-stand-in convention).

Direction (CLAUDE.md / ROADMAP): MVP is complete; this is post-MVP scavenge content that reinforces
the **base-building + survival** pillars (clearing wrecks to reclaim buildable ground). Keep it
data-driven (`src/data/*`), pure-where-possible (`systems/`), and covered by the three-tier harness.

Key files/patterns to mirror (from research):

- **Order kind end-to-end:** `Action` union (`systems/tasks.ts:7-14`) → `orderTargetId`
  (`systems/orders.ts:24-41`) → `ORDER_META` (`orders.ts:66-74`) → `orderBeginners`/`orderRunners`
  (`GameScene.ts:1152-1164` / `1133-1144`) → input enqueue → `orders.test.ts` exhaustive
  assertions (fixtures 8-13, `ORDER_META` checks 47-64).
- **`deconstruct` = the remove-and-free-tile precedent:** `beginDeconstruct`/`runDeconstruct`
  (`GameScene.ts:1211-1222` / `1389-1398`); effect `WallBehavior.retireWall`
  (`WallBehavior.ts:188-192`) = `freeTile` + `repath` + drop from array + `sprite.destroy()`.
- **`build` = the timed-progress precedent:** `runBuild` (`GameScene.ts:1335-1348`).
- **`playChop` tremble math** (`NodeFxManager.ts:142-158`) to reuse for a looping shake; keyed-Map +
  teardown pattern like `recoilTweens`.
- **Regrow site:** the single `scene.time.delayedCall(regrowMs, …)` at `ResourceNodeManager.ts:330`.
- **Picker state-branch precedent:** `actionAt` already returns different actions for armed-vs-spent
  trap on the same tile (`ScenePicker.ts:84-89`); mirror that for alive-vs-ruined node. The
  `!t.alive` skip to change is `pickSpriteAt` `ScenePicker.ts:185`.
- **Tile gate:** `GameScene.isBlocked` (`1069-1075`) composes `hasBlockingNode`
  (`ResourceNodeManager.ts:239-241`).
- **Tests:** `data.test.ts` (NODES invariants + salvagedTent test 86-92), `world.test.ts`
  (placement + catalog), `nodeDefs.test.ts` (parser), `orders.test.ts` (exhaustive), e2e via
  `order(page, action)` (`tests/e2e/harness.ts:137`) + `testApi.ts` (`trees`/`treeById`/`debugState`).

## Steps

- [x] **Step 1: `oneShot` + `clearLoot` node-def schema (+ salvagedTent data)** `[delegate]` (parallel: A)
  - Outcome: added `oneShot?: boolean` + `clearLoot?: LootTable` to `ResourceNodeDef` (`src/data/types.ts`), `AuthoredNodeDef` + `AUTHORED_NODE_DEF_KEYS` + `parseAuthoredNodeDef`/`parseNodeDefs` (`src/systems/nodeDefs.ts`, `oneShot` via `expectBoolean`, `clearLoot` via existing `parseLootTable`); `regrowMs` left required+`>0`. `salvagedTent` in `nodes.json` gets `oneShot:true` + `clearLoot` (cloth 1–2 w2, wood 1 w1, 1 roll). Tests extended in `nodeDefs.test.ts` + `data.test.ts`. Full suite 962 green; `NODES.salvagedTent.oneShot === true`.
  - `src/data/types.ts`: on `ResourceNodeDef` add optional `oneShot?: boolean` (no regrow — stays in
    its depleted/ruined state forever) and `clearLoot?: LootTable` (rolled when the ruin is cleared),
    documented near `regrowMs`/`loot` (~L89-110), same "required-but-ignored when set" note style as
    `yieldItemId` (ignored when `loot` present).
  - `src/systems/nodeDefs.ts`: add both to `AuthoredNodeDef` (L54-81); add `'oneShot'` and
    `'clearLoot'` to `AUTHORED_NODE_DEF_KEYS` (L318-335, else strict `expectNoExtraKeys` throws);
    parse in `parseAuthoredNodeDef` (`oneShot` via a boolean check; `clearLoot` via the existing
    `parseLootTable`) and carry both into the returned record in `parseNodeDefs` (L455-475). Keep
    `regrowMs` required + `>0` (it stays validated but is ignored when `oneShot` — do NOT relax it).
  - `src/data/maps/nodes.json`: on `salvagedTent` (L335-357) add `"oneShot": true` and a small
    `"clearLoot": { "rolls": 1, "drops": [ {cloth 1-2 w2}, {wood 1-1 w1} ] }`.
  - `src/systems/__tests__/nodeDefs.test.ts`: add accept cases (`oneShot:true`, a valid `clearLoot`)
    and reject cases (non-boolean `oneShot`, malformed `clearLoot`), mirroring the existing
    salvage/loot parser tests (L316-385).
  - `src/data/__tests__/data.test.ts`: extend the `salvagedTent` test (L86-92) to assert
    `oneShot===true` and `clearLoot` defined; keep the generic NODES invariants (incl. `regrowMs>0`
    at L60) green.
  - Side effects: none at runtime yet (flags unused until Step 2/5). Every other node omits both →
    `undefined` → unchanged.
  - Docs: none this step (covered in Step 8).
  - Done when: `npm test` green; `parseNodeDefs` accepts the new salvagedTent; `NODES.salvagedTent.oneShot === true`.

- [x] **Step 2: `clear` order kind registry (pure)** `[delegate]` (parallel: A)
  - Outcome: added `{ kind: 'clear'; treeId }` to the `Action` union (`src/systems/tasks.ts`); `orderTargetId` `clear` case + `ORDER_META.clear = { highlight:'tree', dedupeOnEnqueue:true }` (`src/systems/orders.ts`); fixtures + exhaustive assertions in `orders.test.ts` (16 green). Full `tsc` clean incl. GameScene (optional mapped types, no forced beginner/runner). No runtime `clear` handler until Step 5. Pre-existing `docs/ui-overhaul/pitch.html` format-check failure is unrelated to this change.
  - `src/systems/tasks.ts`: add `| { kind: 'clear'; treeId: string }` to the `Action` union (L7-14).
  - `src/systems/orders.ts`: add the `clear` case to `orderTargetId` (return `a.treeId`, L24-41); add
    an `ORDER_META.clear` entry (L66-74) with `highlight: 'tree'` (reuses the node glow) and
    `dedupeOnEnqueue: true` (re-tap toggles the order off — the cancel path).
  - `src/systems/__tests__/orders.test.ts`: add `clear` to the fixtures and to BOTH exhaustive
    assertions — the `dedupeOnEnqueue===false` set stays `['build','move']` (clear is a dedupe kind),
    and the highlight-classification loop (L57-63) must include `clear → 'tree'`. Add a
    `toggleOrder`/`isOrderQueued` case for `clear` mirroring `harvest`.
  - Side effects: `orderBeginners`/`orderRunners` in GameScene are **optional** mapped types
    (`{ [K in Action['kind']]?: … }`), so adding a union variant does NOT force entries there — Step 2
    should fully typecheck on its own (GameScene included), and the runtime dispatch simply has no
    `clear` handler until Step 5 (a `clear` order would no-op, but nothing enqueues one until Step 4).
    So Step 2 is independently shippable; no "type error until Step 5" caveat applies.
  - Docs: none this step.
  - Done when: `npm run check` green (full typecheck, not just systems); `orders.test.ts` green.

- [x] **Step 3: no-regrow + ruin stays blocking + node removal (`ResourceNodeManager`)** `[inline]`
  - Outcome: `src/scenes/world/ResourceNodeManager.ts` — regrow `delayedCall` now guarded by `if (!tree.def.oneShot)`; `hasBlockingNode` counts dead one-shot ruins as blocking (`blocksPath && (alive || oneShot)`); added `removeNode(id)` (guarded sprite.destroy + splice + repath, mirrors `retireWall`). `src/entities/types.ts` — added persistent `progressMs: number` to `TreeNode`, initialised `0` in `addNode`. Typecheck clean, 962 unit tests green. Note: the `menu-start` boot canary already fails **identically on origin/master** (a tap near spawn lands `harvest`, not `move`) — pre-existing, unrelated to this change (verified in a clean master worktree); the boot itself succeeds.
  - `src/scenes/world/ResourceNodeManager.ts`:
    - Guard the regrow at L330: `if (!tree.def.oneShot) this.scene.time.delayedCall(regrowMs, …)`.
      When `oneShot`, the node stays `alive=false` in its depleted (ruined) sprite permanently.
    - `hasBlockingNode` (L239-241): count a dead one-shot node as still blocking —
      `t.def.blocksPath && (t.alive || t.def.oneShot)`. (A regrowing stump still frees its tile as
      today; only permanent one-shot ruins keep blocking.)
    - Add `removeNode(id: string): void` mirroring `WallBehavior.retireWall`: find the node,
      `sprite.destroy()`, splice from `this.trees`, call `deps.repath()`. Guard double-remove.
    - Add a small `progressMs: number` field to `TreeNode` (`src/entities/types.ts`, default 0 in
      `addNode`) — the persistent per-node action accumulator (used by Step 5). Do NOT reset it in the
      harvest loop's `beginCurrent`.
  - Side effects: `GameScene.isBlocked` now treats a salvaged tent as an obstacle until cleared
    (intended). `pickSpriteAt` still skips it until Step 4. `TreeNode` gains a field — check
    `addNode` initialises it and no serialization assumes the old shape.
  - Docs: none this step.
  - Done when: unit/boot green; savaging a `oneShot` node leaves a permanent ruin that still blocks
    (verify via `isBlocked`); `removeNode` frees the tile + repaths.

- [x] **Step 4: picker — salvage vs clear on the same tile** `[inline]`
  - Outcome: `src/scenes/input/ScenePicker.ts` — `pickSpriteAt` now lets dead `oneShot` ruins through (`if (!t.alive && !t.def.oneShot) continue;`); `actionAt` branches the `tree` pick live→`harvest` vs ruin→`clear` on `t.alive`. `src/scenes/GameScene.ts` — `onTap` adds `clear` to the enqueue kinds (falls in behind current work like harvest/rearm). Inspect spot-check (critique #6): `treeStats` on a ruin returns `Tree 0/1` — sane, consistent with a live salvagedTent already inspecting as "Tree". Typecheck clean, 962 unit tests green; tap→clear asserted via scenario in Step 8.
  - `src/scenes/ScenePicker.ts`: in `pickSpriteAt` (L161-212) stop skipping dead **one-shot** nodes —
    change the `if (!t.alive) continue;` (L185) to also allow `t.def.oneShot` ruins through (still
    skip regrowing dead stumps). In `actionAt` (L76-94), branch by node state, mirroring the
    armed/spent-trap branch (L84-89): a live node → `{kind:'harvest', treeId}` (salvage is just the
    loot-harvest of the salvagedTent, unchanged); a dead one-shot ruin → `{kind:'clear', treeId}`.
  - `src/scenes/GameScene.ts` `onTap` (L707-722): add `clear` to the kinds that `enqueue` (alongside
    `harvest|refuel|rearm`) so a tap on a ruin queues the clear.
  - Side effects: depth-ordered raycast unchanged; ensure a ruin under a live node can't both match.
    The queue-glow for a `clear` target is handled in Step 7. Inspect side effect (critique #6):
    making dead one-shot ruins pass `pickSpriteAt` also makes them **inspectable** (`inspectAt`'s
    `tree` branch → `treeStats`) — spot-check that `treeStats` renders sanely for a depleted node
    (e.g. shows the ruin as cleared/0-hp rather than garbage); likely harmless/desirable.
  - Docs: none this step.
  - Done when: tapping a live tent enqueues `harvest`; tapping the ruin enqueues `clear` (assert via
    a scenario `order`/`debugState`, or manual).

- [x] **Step 5: timed salvage + `clear` execution (durations, persistent progress, scrap, removal)** `[inline]`
  - Outcome: `src/config.ts` — added `SALVAGE_MS=20000`, `CLEAR_MS=40000`. `src/scenes/GameScene.ts` — imported both + `rollLoot`; `runHarvest` branches `oneShot && loot` nodes onto a `tree.progressMs += delta` accumulator that fells ONCE at `SALVAGE_MS` (resets progress to 0 for the clear stage), hit-cadence path unchanged for trees/rocks/bushes; added `beginClear` (stand-adjacent, standOffsets, aborts if gone/alive/not-oneShot) + `runClear` (progress to `CLEAR_MS` → roll `clearLoot` into `inv` → `removeNode` → complete); registered `clear` in `orderBeginners`/`orderRunners`; updated the `enqueue` dedupe-kinds comment. Critique #4: overflow-drop on a near-full bag is **unchanged from the old single-hit salvage** (salvagedTent is maxHp:1, so `chop` already rolls the full `loot` table behind the `canAccept(cloth,1)` gate) — only the *timing* changed; documented, not re-gated. `progressMs` never reset in `beginCurrent`, so cancel/re-queue resumes. Shake/progress-bar fx are marked `// Step 6 wires …` (not yet present → no leak). Typecheck clean, 962 unit tests green; ~20s/~40s lifecycle asserted via scenario in Step 8.
  - `src/config.ts`: add `SAVAGE_MS = 20000`, `CLEAR_MS = 40000` near `BUILD_MS` (L107).
  - `src/scenes/GameScene.ts`:
    - **Timed salvage:** in `runHarvest` (L1307-1333), when the target node is a long/timed harvest
      (discriminate on `tree.def.oneShot && tree.def.loot`, i.e. the salvage node), replace the
      `chopElapsed >= CHOP_INTERVAL_MS` hit cadence with a progress-accumulator on the node:
      `tree.progressMs += delta`; drive the shake (Step 6) + the `gather` swing
      (`harvestAnimMotion` already gives `gather`); at `progressMs >= SAVAGE_MS` call
      `resourceNodeManager.chop(tree, facing)` ONCE (rolls loot + depletes; no regrow via `oneShot`),
      reset `tree.progressMs = 0` (for the later clear stage), `stopShake`, `completeCurrent()`. The
      hit-based path for trees/rocks/bushes is unchanged. Progress lives on the node so cancelling
      (re-tap / walk away) keeps it; re-queuing resumes.
    - **Clear:** add `beginClear(a)` (mirror `beginDeconstruct`/`beginHarvest`: `treeById`, abort if
      gone or not a clearable ruin, `reachableAdjacent` to the node tile with `standOffsets`,
      `pathTo`) and register in `orderBeginners`; add `runClear(a, delta)` (mirror `runBuild`
      progress + `runDeconstruct` completion): on arrival `faceTile`, set the `gather` swing, start
      shake, `tree.progressMs += delta`; at `>= CLEAR_MS` roll `tree.def.clearLoot` (if present) via
      `rollLoot` into the inventory, `resourceNodeManager.removeNode(a.treeId)`, `stopShake`,
      `completeCurrent()`. Register in `orderRunners`.
    - `enqueue` (L1276-1286) already handles a `dedupeOnEnqueue` kind generically — `clear` toggles
      off on re-tap (progress persists on the node, so re-issuing resumes).
  - Side effects: `beginCurrent` resets `chopElapsed`/path (and now runs the Step 6 shake/bar
    teardown) but must NOT reset `tree.progressMs`. Bag-full / unreachable aborts should mirror
    `beginHarvest`. Confirm the salvage still credits loot exactly once (single `chop` at completion,
    `maxHp:1`). Bag-full gate (critique #4): `beginHarvest` only checks `canAccept(yieldItemId, 1)`,
    but salvage rolls the whole `loot` table (2 rolls) — after a 20s wait a nearly-full bag could
    silently drop most of it. Either loosen the gate to a fuller pre-check for salvage nodes, or
    explicitly accept the overflow-drop (document which); do not leave it unconsidered.
  - Docs: none this step.
  - Done when: savaging takes ~20s (progress persists across cancel) then leaves a ruin; clearing
    takes ~40s, yields the scrap, removes the node, frees the tile; trees/rocks/bushes unchanged.

- [x] **Step 6: in-progress feedback — continuous shake + progress bar** `[inline]`
  - Outcome: `src/scenes/fx/NodeFxManager.ts` — added `startShake` (idempotent, captures rest from the sprite, `repeat:-1` loop-continuous jitter) / `stopShake` (snaps back) / `stopAllShakes`, and `showActionProgress` (HP-bar-style `{bg,fg}` pool, anchored off `getBounds().top`) / `hideActionProgress` / `hideAllActionProgress`; extended `reset()`/`destroy()` for both new Maps. `src/config.ts` — `NODE_SHAKE_PX/DEG/HZ`, `NODE_PROGRESS_BAR_W/H/Y_OFFSET`, `COLORS.nodeProgressBg/Fg` (amber fill so it doesn't read as an HP bar). `src/scenes/GameScene.ts` — blanket `stopAllShakes()`+`hideAllActionProgress()` at the TOP of `beginCurrent` (critique #1 cancel-teardown); salvage branch of `runHarvest` + `runClear` drive shake+bar each frame and stop/hide before the fell/removeNode. `docs/RENDERING.md` — terse note (looping tween, not a shader; bar mirrors the HP-bar renderer; cancel-teardown chokepoint). Signature deviation: `startShake(sprite)` captures rest internally (node is at rest on first call, guaranteed by the blanket teardown) rather than taking explicit rest params — cleaner than threading skin scale through GameScene. Typecheck + 962 unit tests green; `chop` e2e green (node-fx path boots/harvests).
  - **Shake** — `src/scenes/fx/NodeFxManager.ts`: add `startShake(sprite, restX, restY, baseAngle,
    baseScale)` and `stopShake(sprite)`. `startShake` runs a `repeat:-1` tween writing a small
    constant-amplitude `sin`-based position+angle jitter each `onUpdate` (reuse the tremble math at
    L149-152 but with a fixed amplitude, no `depletion·decay`); guard `if (!sprite.active) return`;
    store in its own keyed Map (like `recoilTweens`). `stopShake` `.stop()`s it and snaps the sprite
    back to rest. New `config.ts` tunables (`NODE_SHAKE_PX`, `NODE_SHAKE_DEG`, `NODE_SHAKE_HZ`).
  - **Progress bar** — a world-space bar above the node that fills 0→1 over the action, since salvage
    (20s) / clear (40s) are long and need a readable countdown. **Mirror the enemy HP bar**
    (`src/scenes/fx/CombatFxManager.ts` `syncEnemyHealthBars`, ~L370-420: a lazily-created `{bg, fg}`
    rectangle pair, positioned/sized each frame above the sprite, destroyed when no longer shown).
    Add `showActionProgress(sprite, frac)` (create-or-update the `{bg, fg}` pair keyed by sprite,
    `fg.width = barW * frac`, placed just above the node's top using its display bounds) and
    `hideActionProgress(sprite)` (destroy the pair) to `NodeFxManager`. New `config.ts` tunables
    (`NODE_PROGRESS_BAR_W`, `_H`, `_Y_OFFSET`, bg/fg colours — reuse the HP-bar palette for
    consistency).
  - **Teardown:** extend `NodeFxManager.reset()`/`destroy()`/`armShutdown()` to stop/destroy both new
    Maps (shake tweens + progress-bar pairs) — never `sprite.destroy()` on the shutdown path.
  - **Wiring + the cancel-teardown (critique #1, IMPORTANT):** a toggle-cancel (re-tapping a queued
    action) routes through `toggleOrder` → `beginCurrent`, **NOT** `completeCurrent` — so relying on
    the runner/`completeCurrent` to stop the shake would leak an infinite `repeat:-1` tween writing
    the node transform forever + a floating bar. Fix: add a **single blanket teardown at the TOP of
    `beginCurrent`** — `nodeFx.stopAllShakes()` + `nodeFx.hideAllActionProgress()` (add these
    clear-everything helpers; safe because only one player action runs at a time). Then on arrival a
    runner calls `startShake`; each frame while accumulating, `showActionProgress(sprite,
    tree.progressMs / duration)`; on stage completion (`completeCurrent`) also stop/hide. Route
    through narrow deps like the existing `playChopFx` (GameScene mediates; fx stays in `scenes/fx`).
    Do NOT depend on the runner alone to clean up on cancel — `beginCurrent` is the one guaranteed
    chokepoint for both cancel and switching to another order.
  - Side effects: the queued-order glow halo mirrors the sprite transform for free. With the
    `beginCurrent` blanket teardown, every exit path (finish, cancel, walk-away, switch order, node
    removed) is covered. The bar must sit above the (tall) node art — position from the sprite's
    display top, not a fixed offset.
  - Docs: RENDERING.md — one terse line that the node shake is a looping tween + the action progress
    bar mirrors the enemy HP-bar renderer (no frame-loop shader).
  - Done when: during salvage/clear the node shakes and a progress bar above it fills smoothly to full
    over the duration (and reflects persisted progress on resume); both vanish on finish/cancel; boot
    canary clean.

- [x] **Step 7: queue-glow highlight for `clear` targets** `[delegate]`
  - Outcome: `src/scenes/fx/TaskGlowRenderer.ts` — the `'tree'` case in `refreshQueueHighlights()` now branches on `a.kind`: `harvest` keeps the live-only gate (`tree?.alive`), `clear` uses `tree?.alive || tree?.def.oneShot` so a dead one-shot ruin glows the same silhouette halo (reuses the existing `bakeGlowTexture` path unchanged). Optional-chaining safety preserved; `if (tree && glows)` narrows `tree` for `addTreeGlow`. Note: the head-of-queue breathing *pulse* (`headHarvestTreeId`) stays `harvest`-only by design — a queued `clear` gets the static glow, not the pulse (pulse wasn't in scope for clear). Typecheck clean, 962 unit tests green. Committed `02aff7f`.
  - `src/scenes/fx/TaskGlowRenderer.ts`: the `'tree'` highlight branch (L77-81) only glows
    `tree?.alive` nodes; allow a `clear` order's target (a dead one-shot ruin) to glow too — gate on
    `tree.alive || tree.def.oneShot` for the `clear` kind (keep live-only for `harvest`). Reuse the
    existing `bakeGlowTexture` path — the halo bakes from the ruin's own frame automatically.
  - Side effects: none beyond the highlight; the glow texture is cached per texture frame.
  - Docs: none.
  - Done when: a queued `clear` shows the same silhouette glow on the ruin that a queued `harvest`
    shows on a live node.

- [x] **Step 8: tests + docs** `[inline]`
  - Outcome: **e2e** `tests/e2e/salvage-lifecycle.spec.ts` — drives the full salvage→clear lifecycle: places a `salvagedTent` adjacent to the player, salvages it (asserts ≥2 loot items, node !alive+oneShot+still-blocking, `currentKind` null), advances a driven window (still ruined, no regrow), then orders `clear` (asserts the ruin glows via `outlinedTreeIds`, gated on `isWebGL` — Step 7), and after completion asserts ≥1 clearLoot scrap, node gone from `nodes()`, tile freed (`blocked`→false). **Harness/testApi additions:** `ScenarioSpec.tents`/`ScenarioResult.tentIds` (place wrecked tents), a standalone `nodes()` read seam (`{id,col,row,alive,oneShot}[]`, like `walls()` — NOT in DebugState, so the refactor-tripwire golden is untouched), and a `setNodeProgress(id,ms)` seam that seeds the persistent `progressMs` so the 20s/40s timed actions cross their thresholds in a few driven frames (mirrors `campfireFuel` seeding) — which also exercises resume-from-persisted-progress. **Loot asserted as RANGES** (chop/`runClear` roll off `Math.random`, not the injected rng — exact roll math is Tier-1 in `loot.test.ts`). **No new unit helper** (no cleanly-extractable pure logic beyond the Step 1/2 parser/registry tests). **Docs:** `wired-art.md` (regrow→one-shot lifecycle + durations + `clearLoot` + `clear` anim stand-in), `STATUS.md` (new "Salvage node lifecycle" subsystem entry), `DECISIONS.md` index + full `decisions/gameplay.md` entry (oneShot/generic-clear/persistent-progress/shake-as-looping-tween). **Deviation from plan:** used a standalone `nodes()` seam + `setNodeProgress` rather than a new DebugState `ruinedNodeIds` field — cleaner (no golden churn, directly proves "gone from `trees()`") and the seed makes the timed actions feasible under headless fixed-step rendering (~45ms/frame makes a real 20s+40s+regrow-window advance blow the timeout). The full-window (600 000ms `regrowMs`) no-regrow advance is infeasible to drive; the guarantee is structural (`oneShot` never schedules the regrow `delayedCall`) and the spec drives a modest window as a persistence check (documented in-spec). Gates: typecheck clean; 962 unit green; eslint 0 errors; markdownlint 0 errors; prettier clean; `salvage-lifecycle` + `refactor-tripwire`/`glow`/`chop`/`mine` e2e green. Pre-existing `menu-start` boot-canary case + `docs/ui-overhaul/pitch.html` format failure are unrelated (verified on origin/master).
  - Scenario (`tests/e2e/`): add a spec driving the full lifecycle via `order(page, {kind:'harvest',
    treeId})` then `{kind:'clear', treeId}`, advancing the clock; assert loot credited, node becomes
    `!alive` and **stays** ruined after advancing past a normal regrow window (no regrow), the tile
    is blocked while ruined then freed after clear, clear yields the scrap, and the node is gone from
    `trees()`. Add a `debugState` field for ruined/clearable node ids if the assertions need it
    (mirror `queuedTreeIds`), via `src/scenes/testApi.ts`.
  - Unit: if any progress/threshold logic is cleanly extractable as a pure helper, unit-test it;
    otherwise rely on the scenario + the Step 1/2 parser/registry tests.
  - Docs (terse, high-signal): update `docs/wired-art.md` salvage section (regrow→one-shot; the
    salvage/clear lifecycle + durations; clearLoot); `docs/STATUS.md` (new subsystem entry);
    `docs/DECISIONS.md` + a gameplay shard note (one-shot node, generic clear, persistent progress,
    shake-as-looping-tween). Mention the `salvage`/`clear` player-anim stand-in (`gather`).
  - Side effects: keep `data.test.ts`/`world.test.ts`/`orders.test.ts`/`nodeDefs.test.ts` green;
    run `npm run assets:catalog` only if any asset path changed (it shouldn't).
  - Done when: `npm run check` + e2e + boot canary all green; docs updated.

- [x] **Step 9: editor authoring for `oneShot` + loot/clearLoot (follow-up)** `[inline]`
  - Outcome: post-plan follow-up (owner request) — the Map Builder's **Node Types** tab
    (`src/editor/tabs/NodeTypesTab.tsx`) previously could not author the plan-047 fields, so
    `oneShot`/`loot`/`clearLoot` were hand-edited in `nodes.json`. Added: a **"One-time harvest"**
    checkbox next to "Blocks path" (patches `oneShot`, omitted-not-`false` when unchecked, with a
    tooltip explaining no-regrow + husk-blocks-till-cleared), and a reusable **`LootTableEditor`**
    rendered twice — "Loot table (per harvest)" (`loot`) and "Clear loot (one-time harvest)"
    (`clearLoot`). Each: an "+ Add table" affordance when absent, and when present a `rolls` count +
    weighted drop rows (item Select from `ITEMS` / min / max / weight) with add/remove-drop and a
    "Remove table" (→ `undefined`). Wired through the SAME batched-draft → `validateNodeDefPatch` →
    `updateNodeDef` (`parseNodeDefs`) choke point the rest of the stats form uses — no second
    validation path; `statsEqual` gains a `lootEqual` (JSON) compare + `oneShot` for the dirty gate.
    **Verified in the running editor** (headless Chromium against `editor.html`): the `salvagedTent`
    def reads back correctly — One-time harvest checked, salvage anim, the 4-drop loot table (rolls 2)
    - 2-drop clearLoot (rolls 1), and the SKINS (17) row. Gates: typecheck clean, eslint 0 errors,
    prettier clean, 962 unit tests green. NB: the node + all 17 skins (+ ruined depleted swaps + 34 art
    PNGs + asset-catalog entries) already existed from the pre-047 tent-art work — nothing to rebuild.

## Out of scope

- NPC-companion savaging/clearing (player-only for now; companion `repair`-style wiring deferred).
- A bespoke `salvage`/`clear` player animation strip (reuses the `gather` motion stand-in).
- Per-def override of `SAVAGE_MS`/`CLEAR_MS` (global config constants for now).
- Applying `oneShot`/`clear` to any node other than `salvagedTent` in shipped data (the mechanic is
  generic, but only the tent uses it this pass).
- Changing the loot economy/balance beyond adding the small `clearLoot`.

## Critique

> Fresh-eyes review (pre-execution). Verdict: a well-researched, pattern-faithful plan with no
> blockers; the one real risk is teardown of the new looping shake/progress-bar on a toggle-cancel,
> plus a scope question on persistent progress — proceed, fixing these during execution.
>
> Resolutions folded into the steps above: **#1** — blanket shake/bar teardown at the top of
> `beginCurrent` (Step 6). **#2** — owner confirmed keeping persistent progress. **#3** — corrected
> (optional mapped types; Step 2 typechecks standalone). **#4/#6** — noted in Steps 5/4.

|#|Finding|Lens|Severity|Suggested action|
|-|-------|----|--------|----------------|
|1|Looping shake + progress bar have no reliable stop on a toggle-cancel (cancel routes through `beginCurrent`, not `completeCurrent`) → orphan infinite tween + floating bar.|Gaps/risks|Medium|Blanket teardown (stop all shakes + hide all bars) at the top of `beginCurrent`. *(folded into Step 6)*|
|2|Persistent-across-cancel progress is the highest-complexity/lowest-value element for marginal single-player benefit.|Right-sizing|Medium|Owner confirmed: keep it.|
|3|Step 2's "TypeScript error until Step 5" note is a phantom — `orderBeginners`/`orderRunners` are optional mapped types.|Executability|Low|Corrected: Step 2 typechecks standalone; run full `npm run check`.|
|4|`runHarvest` bag-full gate checks only `canAccept(yieldItemId,1)`, but salvage rolls the whole loot table → near-full bag can drop most loot after a 20s wait.|Gaps/risks|Low|Fuller pre-check for salvage, or explicitly accept. *(noted in Step 5)*|
|5|`clear` shares the `'tree'` highlight class → needs an `a.kind` branch for the `alive‖oneShot` gate.|Cross-cutting|Low|Branch on `a.kind` in the `'tree'` case (Step 7).|
|6|Clickable ruins become inspectable (`inspectAt`→`treeStats`) — unmentioned side effect.|Gaps/risks|Low|Spot-check `treeStats` on a depleted node. *(noted in Step 4)*|
|7|Feature isn't on the explicit post-MVP roadmap list; net-new content scoped this session.|Roadmap fit|Low|Owner-scoped; no code concern.|
