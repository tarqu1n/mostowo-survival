# Savage Node Lifecycle

> Status: planned — run /execute-plan to begin.

## Summary

Turn the destroyed-tent (`savagedTent`) node into a full two-stage lifecycle: **savage** it once
(a long, ~20s timed action, tent shaking throughout) to roll its loot and leave a permanent **ruined
husk** that still blocks its tile; then optionally **clear** the husk (an even longer ~40s action)
to remove it, yield a little scrap, and free the tile for building/pathing. Adds a `oneShot`
no-regrow node option, a new generic `clear` order kind (works on any depleted one-shot node), a
timed progress-accumulator harvest model with **progress that persists across cancel**, and a
continuous shake FX on the node while either action is in progress. Player-only.

The art (17 live + 17 `_ruined` depleted sprites) and the loot table are already done and committed;
this feature is purely the mechanic + fx wiring on top.

## Context & decisions

Owner decisions (this session):

- **Durations:** savage **20s**, clear **40s** — real-time *timed* actions (not many quick hits),
  modelled on the existing `build` progress-accumulator (`runBuild`, `site.progress += delta`,
  `BUILD_MS`), with a continuous shake for the whole window. New config `SAVAGE_MS = 20000`,
  `CLEAR_MS = 40000` (generic; per-def override is out of scope).
- **Clear yields a little scrap:** a small second loot payout on clear — modelled as an optional
  per-def `clearLoot?: LootTable` (reuses `systems/loot.ts`). `savagedTent` gets a small table
  (e.g. cloth 1–2, wood 1). A one-shot node with no `clearLoot` clears silently.
- **Progress persists:** the accumulated action time is stored **on the node** and survives
  cancel/re-queue (resuming continues where it left off). It resets only when a stage completes
  (savage→ruin resets it for the clear stage; clear removes the node).
- **Generic clear, player-only:** `clear` is a new order kind valid on *any* depleted `oneShot`
  node, not just the tent. No NPC-companion wiring.
- **Ruined husk keeps blocking + is clickable until cleared:** reverses today's behaviour where a
  depleted node (`alive=false`) stops blocking (`hasBlockingNode` requires `alive`) and is
  unclickable (`pickSpriteAt` skips `!alive`). A dead **one-shot** node must stay a present,
  tile-occupying, tappable obstacle so "clear the area to build" is meaningful.
- **Player anim:** both savage and clear use the `gather` (rummage/dismantle) motion — savage via
  the existing `harvestAnim:'savage'`→`gather` map (`harvestAnimMotion`); clear maps to `gather`
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
- **Tests:** `data.test.ts` (NODES invariants + savagedTent test 86-92), `world.test.ts`
  (placement + catalog), `nodeDefs.test.ts` (parser), `orders.test.ts` (exhaustive), e2e via
  `order(page, action)` (`tests/e2e/harness.ts:137`) + `testApi.ts` (`trees`/`treeById`/`debugState`).

## Steps

- [ ] **Step 1: `oneShot` + `clearLoot` node-def schema (+ savagedTent data)** `[delegate]` (parallel: A)
  - `src/data/types.ts`: on `ResourceNodeDef` add optional `oneShot?: boolean` (no regrow — stays in
    its depleted/ruined state forever) and `clearLoot?: LootTable` (rolled when the ruin is cleared),
    documented near `regrowMs`/`loot` (~L89-110), same "required-but-ignored when set" note style as
    `yieldItemId` (ignored when `loot` present).
  - `src/systems/nodeDefs.ts`: add both to `AuthoredNodeDef` (L54-81); add `'oneShot'` and
    `'clearLoot'` to `AUTHORED_NODE_DEF_KEYS` (L318-335, else strict `expectNoExtraKeys` throws);
    parse in `parseAuthoredNodeDef` (`oneShot` via a boolean check; `clearLoot` via the existing
    `parseLootTable`) and carry both into the returned record in `parseNodeDefs` (L455-475). Keep
    `regrowMs` required + `>0` (it stays validated but is ignored when `oneShot` — do NOT relax it).
  - `src/data/maps/nodes.json`: on `savagedTent` (L335-357) add `"oneShot": true` and a small
    `"clearLoot": { "rolls": 1, "drops": [ {cloth 1-2 w2}, {wood 1-1 w1} ] }`.
  - `src/systems/__tests__/nodeDefs.test.ts`: add accept cases (`oneShot:true`, a valid `clearLoot`)
    and reject cases (non-boolean `oneShot`, malformed `clearLoot`), mirroring the existing
    savage/loot parser tests (L316-385).
  - `src/data/__tests__/data.test.ts`: extend the `savagedTent` test (L86-92) to assert
    `oneShot===true` and `clearLoot` defined; keep the generic NODES invariants (incl. `regrowMs>0`
    at L60) green.
  - Side effects: none at runtime yet (flags unused until Step 2/5). Every other node omits both →
    `undefined` → unchanged.
  - Docs: none this step (covered in Step 8).
  - Done when: `npm test` green; `parseNodeDefs` accepts the new savagedTent; `NODES.savagedTent.oneShot === true`.

- [ ] **Step 2: `clear` order kind registry (pure)** `[delegate]` (parallel: A)
  - `src/systems/tasks.ts`: add `| { kind: 'clear'; treeId: string }` to the `Action` union (L7-14).
  - `src/systems/orders.ts`: add the `clear` case to `orderTargetId` (return `a.treeId`, L24-41); add
    an `ORDER_META.clear` entry (L66-74) with `highlight: 'tree'` (reuses the node glow) and
    `dedupeOnEnqueue: true` (re-tap toggles the order off — the cancel path).
  - `src/systems/__tests__/orders.test.ts`: add `clear` to the fixtures and to BOTH exhaustive
    assertions — the `dedupeOnEnqueue===false` set stays `['build','move']` (clear is a dedupe kind),
    and the highlight-classification loop (L57-63) must include `clear → 'tree'`. Add a
    `toggleOrder`/`isOrderQueued` case for `clear` mirroring `harvest`.
  - Side effects: `orderBeginners`/`orderRunners` in GameScene are `Record<Action['kind'], …>` — once
    `clear` is in the union, TypeScript will require entries there; those are added in Step 5, so this
    step alone will leave a **type error in GameScene until Step 5 lands**. Sequence 2 before 5;
    don't ship 2 alone. (Acceptable within a plan run; note for the executor.)
  - Docs: none this step.
  - Done when: `orders.test.ts` green; the union + registry compile in isolation (systems typecheck).

- [ ] **Step 3: no-regrow + ruin stays blocking + node removal (`ResourceNodeManager`)** `[inline]`
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
  - Side effects: `GameScene.isBlocked` now treats a savaged tent as an obstacle until cleared
    (intended). `pickSpriteAt` still skips it until Step 4. `TreeNode` gains a field — check
    `addNode` initialises it and no serialization assumes the old shape.
  - Docs: none this step.
  - Done when: unit/boot green; savaging a `oneShot` node leaves a permanent ruin that still blocks
    (verify via `isBlocked`); `removeNode` frees the tile + repaths.

- [ ] **Step 4: picker — savage vs clear on the same tile** `[inline]`
  - `src/scenes/ScenePicker.ts`: in `pickSpriteAt` (L161-212) stop skipping dead **one-shot** nodes —
    change the `if (!t.alive) continue;` (L185) to also allow `t.def.oneShot` ruins through (still
    skip regrowing dead stumps). In `actionAt` (L76-94), branch by node state, mirroring the
    armed/spent-trap branch (L84-89): a live node → `{kind:'harvest', treeId}` (savage is just the
    loot-harvest of the savagedTent, unchanged); a dead one-shot ruin → `{kind:'clear', treeId}`.
  - `src/scenes/GameScene.ts` `onTap` (L707-722): add `clear` to the kinds that `enqueue` (alongside
    `harvest|refuel|rearm`) so a tap on a ruin queues the clear.
  - Side effects: depth-ordered raycast unchanged; ensure a ruin under a live node can't both match.
    The queue-glow for a `clear` target is handled in Step 6.
  - Docs: none this step.
  - Done when: tapping a live tent enqueues `harvest`; tapping the ruin enqueues `clear` (assert via
    a scenario `order`/`debugState`, or manual).

- [ ] **Step 5: timed savage + `clear` execution (durations, persistent progress, scrap, removal)** `[inline]`
  - `src/config.ts`: add `SAVAGE_MS = 20000`, `CLEAR_MS = 40000` near `BUILD_MS` (L107).
  - `src/scenes/GameScene.ts`:
    - **Timed savage:** in `runHarvest` (L1307-1333), when the target node is a long/timed harvest
      (discriminate on `tree.def.oneShot && tree.def.loot`, i.e. the savage node), replace the
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
  - Side effects: `beginCurrent` resets `chopElapsed`/path but must NOT reset `tree.progressMs`.
    Bag-full / unreachable aborts should mirror `beginHarvest`. Confirm the savage still credits loot
    exactly once (single `chop` at completion, `maxHp:1`).
  - Docs: none this step.
  - Done when: savaging takes ~20s (progress persists across cancel) then leaves a ruin; clearing
    takes ~40s, yields the scrap, removes the node, frees the tile; trees/rocks/bushes unchanged.

- [ ] **Step 6: continuous shake FX during savage/clear** `[inline]`
  - `src/scenes/fx/NodeFxManager.ts`: add `startShake(sprite, restX, restY, baseAngle, baseScale)`
    and `stopShake(sprite)`. `startShake` runs a `repeat:-1` tween writing a small constant-amplitude
    `sin`-based position+angle jitter each `onUpdate` (reuse the tremble math at L149-152 but with a
    fixed amplitude, no `depletion·decay`); guard `if (!sprite.active) return`; store in its own
    keyed Map (like `recoilTweens`). `stopShake` `.stop()`s it and snaps the sprite back to
    `restX/restY/baseAngle/baseScale`. Add new `config.ts` tunables (`NODE_SHAKE_PX`,
    `NODE_SHAKE_DEG`, `NODE_SHAKE_HZ`). Extend `reset()`/`destroy()`/`armShutdown()` to clear the new
    Map (teardown discipline — never `sprite.destroy()` on shutdown path).
  - Wire from GameScene (Step 5): `startShake` when a savage/clear action begins accumulating (on
    arrival), `stopShake` on `completeCurrent`/cancel and at each stage completion. Route through a
    narrow dep like the existing `playChopFx` (fx lives in `scenes/fx`, GameScene mediates).
  - Side effects: the queued-order glow halo mirrors the sprite transform for free (no extra wiring).
    Ensure a cancelled action stops the shake (no orphan looping tween) — stop on every exit path.
  - Docs: RENDERING.md — one terse line that the node shake is a looping tween (not a per-frame
    shader), consistent with the "bake/loop, no frame-loop shaders" stance.
  - Done when: node visibly shakes for the whole savage/clear and snaps to rest on
    finish/cancel; boot canary clean (no console errors, sprite active-guards hold).

- [ ] **Step 7: queue-glow highlight for `clear` targets** `[delegate]`
  - `src/scenes/fx/TaskGlowRenderer.ts`: the `'tree'` highlight branch (L77-81) only glows
    `tree?.alive` nodes; allow a `clear` order's target (a dead one-shot ruin) to glow too — gate on
    `tree.alive || tree.def.oneShot` for the `clear` kind (keep live-only for `harvest`). Reuse the
    existing `bakeGlowTexture` path — the halo bakes from the ruin's own frame automatically.
  - Side effects: none beyond the highlight; the glow texture is cached per texture frame.
  - Docs: none.
  - Done when: a queued `clear` shows the same silhouette glow on the ruin that a queued `harvest`
    shows on a live node.

- [ ] **Step 8: tests + docs** `[inline]`
  - Scenario (`tests/e2e/`): add a spec driving the full lifecycle via `order(page, {kind:'harvest',
    treeId})` then `{kind:'clear', treeId}`, advancing the clock; assert loot credited, node becomes
    `!alive` and **stays** ruined after advancing past a normal regrow window (no regrow), the tile
    is blocked while ruined then freed after clear, clear yields the scrap, and the node is gone from
    `trees()`. Add a `debugState` field for ruined/clearable node ids if the assertions need it
    (mirror `queuedTreeIds`), via `src/scenes/testApi.ts`.
  - Unit: if any progress/threshold logic is cleanly extractable as a pure helper, unit-test it;
    otherwise rely on the scenario + the Step 1/2 parser/registry tests.
  - Docs (terse, high-signal): update `docs/wired-art.md` savage section (regrow→one-shot; the
    savage/clear lifecycle + durations; clearLoot); `docs/STATUS.md` (new subsystem entry);
    `docs/DECISIONS.md` + a gameplay shard note (one-shot node, generic clear, persistent progress,
    shake-as-looping-tween). Mention the `savage`/`clear` player-anim stand-in (`gather`).
  - Side effects: keep `data.test.ts`/`world.test.ts`/`orders.test.ts`/`nodeDefs.test.ts` green;
    run `npm run assets:catalog` only if any asset path changed (it shouldn't).
  - Done when: `npm run check` + e2e + boot canary all green; docs updated.

## Out of scope

- NPC-companion savaging/clearing (player-only for now; companion `repair`-style wiring deferred).
- A bespoke `savage`/`clear` player animation strip (reuses the `gather` motion stand-in).
- Per-def override of `SAVAGE_MS`/`CLEAR_MS` (global config constants for now).
- Applying `oneShot`/`clear` to any node other than `savagedTent` in shipped data (the mechanic is
  generic, but only the tent uses it this pass).
- A visible numeric progress bar/UI for the action (the shake + player swing convey progress; a
  build-style alpha ramp is optional polish, not required).
- Changing the loot economy/balance beyond adding the small `clearLoot`.
