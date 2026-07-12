# Deterministic Test Harness (Unit Tests + Scenario Setups, Retire the Live-Game Smoke)

> Status: planned — run /critique-plan next, then hand back to Matt before /execute-plan (WORKFLOW.md gates).

## Summary
The single 419-line `scripts/smoke.mjs` drives the **whole running game start-to-finish through the
real UI** and asserts ~35 things along one linear playthrough. It breaks whenever anything on that
path changes (this session alone: the queue-marker assertion broke when the outline shader landed, and
the chop step flaked on wall-clock timing when the glow got heavier), and it will only get worse as
content grows — one playthrough cannot cover every action, and every real-time walk/chop/build is a
timing race. Replace it with a **deterministic three-tier harness**:

1. **Unit tests (Vitest, no browser)** over the pure systems (`pathfind`, `tasks`, `combat`, `grid`,
   `stats`, `Inventory`) + data invariants — millisecond-fast, zero timing, where *most* of the
   currently-asserted logic actually lives.
2. **Scenario tests (Playwright, deterministic)** for the genuine integration/rendering/input surface
   — driven by a **test-only scenario-setup API** on `GameScene` that *constructs a known world*
   (place player/entities on named tiles, set inventory/facing/mode) and a **fixed-delta step** seam
   so time-based actions complete deterministically instead of via `waitForTimeout`. Each scenario
   tests **one** behaviour.
3. **One thin boot canary** (kept from the old smoke): the game boots, reaches `Game`+`UI`, and logs
   **zero console errors** (this also compiles every WebGL shader). No gameplay, no timing.

The point: the flaky, all-or-nothing playthrough becomes a fast unit layer + a handful of isolated,
deterministic integration scenarios that only touch Phaser when they must.

## Context & decisions

**Direction settled with the user:** move tests to a *specifically constructed environment* rather
than the live game, because driving the growing game itself will never keep up. This plan is the
concrete shape of the `docs/DECISIONS.md` 2026-07-12 "isolated test setups" entry and resolves its
**[OPEN] harness-shape** question.

**One minimal setup per behaviour (settled with the user):** every test constructs only the world it
needs — chop = player + one adjacent tree; combat = player + one adjacent zombie; pathfind = player +
a wall to route around. This is the payoff of leaving the live game: fast (nothing unrelated ticks),
isolated (a pathfind change can't break a combat test), and the setup *is* the spec of what's tested.
Two guard-rails so it doesn't rot into a pile of bespoke maps:
- **Declarative specs, not map files.** The differences between setups are one-line data
  (`{player:[3,3], trees:[[5,3]]}` vs `{player:[3,3], zombies:[[4,3]]}`) fed to the *same*
  `applyScenario(spec)` — never separate hand-authored maps.
- **Named fixture builders for shared shapes.** A small `scenarios.ts` of builders (`justATree()`,
  `oneZombie()`, `wallToRouteAround()`) returning specs, so common setups are reused, not copy-pasted;
  any test may override. Don't over-abstract — add a builder only once ≥2 tests want it.
- **One behaviour per test.** The chop test never also asserts combat.
- **Small = few entities placed adjacent, not a shrunk canvas.** Tier 1 builds a literal tiny grid
  (e.g. 5×5) inline; Tier 2 keeps the real Phaser world but places entities adjacent so there's no
  multi-second walk to assert through.

**Harness shape — recommended (decide at critique):** a **hybrid**, *not* a single mechanism —
- **Tier 1 = Vitest**, chosen because the project is already Vite (`vite@6`, `vitest` is the native
  fit, shares `tsconfig`/resolution). Pure systems import no Phaser (verified — only `Inventory.ts`
  does), so they test in plain Node.
- **Tier 2 = a debug scenario API on `GameScene`** (reachable via `window.game`), chosen over the two
  rejected alternatives from the open question: a **separate test Scene** duplicates the world-wiring
  we want to exercise; a **query-param loader** is just a less-flexible front-end to the same setter.
  A method call from Playwright's `page.evaluate` is the lowest-friction, highest-fidelity option and
  reuses the real scene + real systems. Gate it so it never ships as a player-facing surface (see
  Step 4's `__test` namespace + build note).
- **Determinism seam:** the killer feature is a **fixed-delta step** (`__test.step(ms)`) that advances
  gameplay by a known amount with the Phaser loop paused — so chop intervals, build progress, contact
  cooldowns, and (later) day/night all resolve without wall-clock sleeps. This is what removes the
  flakiness class, not just the current chop poll band-aid.

**Key facts from repo research (anchors to respect):**
- **No test framework yet:** `package.json` scripts are `dev/build/preview/typecheck/smoke`; devDeps
  are `playwright typescript vite`. Add `vitest` (+ `jsdom` only if Tier-1 needs it, see below).
- **Pure vs Phaser-coupled systems:** `src/systems/{pathfind,tasks,combat,grid,stats}.ts` import **no
  Phaser** → test directly in Node. **`src/systems/Inventory.ts` imports Phaser** (extends
  `Phaser.Events.EventEmitter`). Importing full `phaser` in Node touches `window`/`document` and needs
  Vitest's `environment: 'jsdom'`. Prefer the truly-Phaser-free tests as the fast default; put
  Inventory (and anything Phaser-touching) behind a `jsdom` test-env override, OR decouple its emitter
  (Phaser's is `eventemitter3`) in a small follow-up — **do not** refactor Inventory as part of this
  plan unless jsdom proves painful; note it and move on.
- **The world is already deterministic on boot:** `spawnTrees()`
  ([GameScene.ts:826-834](src/scenes/GameScene.ts#L826)) places **fixed** trees at `[5,8] [14,12]
  [8,20]`; `spawnZombies()` ([GameScene.ts:910-912](src/scenes/GameScene.ts#L910)) fixed-spawns
  `kidZombie` at `(11,30)`. The only randomness is `regenerateTrees()`
  ([GameScene.ts:852-869](src/scenes/GameScene.ts#L856)), a **TEMP debug HUD button** the smoke never
  presses. **So today's flakiness is NOT world randomness — it is real-time timing of walks/chops.**
  The scenario API should still *own* placement (not rely on the boot fixtures) so tests are readable
  and survive future spawn changes.
- **Existing test seams to build on:** `GameScene.debugState()`
  ([GameScene.ts:1084-1108](src/scenes/GameScene.ts#L1084)) already returns queue/path/sites/mode/
  playerHp/outlinedTreeIds/etc.; `isTileBlocked(col,row)` ([GameScene.ts:1118](src/scenes/GameScene.ts#L1118))
  wraps `isBlocked`. `window.game` is set unconditionally in `main.ts:35`. The scenario API is the
  symmetric *input* side of these read seams.
- **What the smoke covers today (coverage map to preserve, re-homed):** menu→world + HUD (§0); zoom
  clamp + readout (§0b); pan breaks follow / FOLLOW re-engages (§0c); chop→wood (§1); long-press queue
  fill (§2); queued-tree glow highlight (§2b); hold-drag paint (§2b); Cancel clears queue (§3);
  build-mode + blueprint wood spend + passable-while-building (§4); Cancel non-destructive (§5);
  build→solid wall (§6); pathfinding routes around / won't path onto walls (§7); Inspect panels for
  zombie/tree/wall/empty (§8a); Combat movepad + contact damage + death-restart (§8b); Punch kills
  zombie in 3 (§8c); zero console errors (final). Re-home per Step 6's table.
- **Which of those are pure logic (→ Tier 1):** chop yield (Inventory + node hp), queue fill/cancel/
  append (`tasks.ts` `TaskQueue`), blueprint cost + build completion math (buildables + Inventory),
  wall blocks / blueprint passable (`grid.ts` occupancy), pathfinding around/onto walls (`pathfind.ts`
  `findPath`/`reachableAdjacent`), combat damage + 3-hit kill + contact cooldown (`combat.ts`
  `resolveMeleeAttack`). **Which genuinely need Phaser (→ Tier 2):** menu/HUD wiring, zoom/pan/camera,
  input-mode toggles, Inspect panels (UIScene↔GameScene), glow-attach on the sprite, movepad direct
  control, scene restart, shader-compile.
- **Deploy/gates:** `master` push auto-deploys ([docs/WORKFLOW.md](docs/WORKFLOW.md)); the plan→
  critique→execute gates mean **this plan stops here** — no execution in the same sweep.
- **Tooling:** `tsconfig` `strict` + `noUnusedLocals/Parameters`; `npm run typecheck` = `tsc --noEmit`.
  Playwright is pinned but the container's pre-installed Chromium lives at `/opt/pw-browsers/chromium`;
  `smoke.mjs` already honours `SMOKE_CHROMIUM_PATH` — mirror that in the new runner.

## Steps

- [ ] **Step 1: Add Vitest + the test scripts** `[inline]`
  - Add `vitest` to `devDependencies`. Add `vitest.config.ts` (reuse Vite resolution; default
    `environment: 'node'`; a second project/override with `environment: 'jsdom'` for any Phaser-
    touching test file, e.g. by glob `**/*.jsdom.test.ts`).
  - `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`. Leave `smoke` for now
    (Step 5 slims it). Consider a `"check": "npm run typecheck && npm run test"` convenience.
  - Done when: `npm test` runs Vitest with zero test files failing (an empty run is fine at this step).

- [ ] **Step 2: Unit-test the Phaser-free pure systems** `[delegate sonnet]` (parallel: A)
  - New `src/systems/__tests__/` (or `*.test.ts` beside each). Cover, from the coverage map:
    - `pathfind.test.ts` — `findPath` reaches an open tile routing around a wall; returns null onto a
      blocked tile; `reachableAdjacent` picks a walkable neighbour. Build the grid inline (no scene).
    - `tasks.test.ts` — `TaskQueue`: `all()` = `[current, ...pending]`; append/replace/next/clear;
      pending count transitions used by §2/§3.
    - `combat.test.ts` — `resolveMeleeAttack`: flat-1 damage, 3 hits kill a maxHp-3 zombie, hit-chance
      edges; contact-cooldown math if it lives here.
    - `grid.test.ts` — `worldToTile`/`tileToWorldCenter`/`snapToTileCenter`/`tileKey` round-trips.
    - `stats.test.ts` — whatever `stats.ts` exposes (schema/derivations).
  - These are the assertions that keep breaking indirectly; make them direct and fast.
  - Done when: `npm test` green; each pure system has meaningful coverage of its current smoke-implied
    behaviour.

- [ ] **Step 3: Unit-test Inventory + data invariants** `[delegate sonnet]` (parallel: A)
  - `Inventory` needs Phaser → put it in a `*.jsdom.test.ts` (Step 1's jsdom override). Test add/get,
    the `wood` accounting behind chop-yield and blueprint-spend, and that it emits on change. If
    importing `phaser` under jsdom is slow/flaky, **stop and flag** the emitter-decouple option rather
    than fighting it.
  - Data invariants (pure, node): `src/data/{nodes,buildables,enemies,items,types}` — e.g. every
    buildable's cost items exist, `kidZombie` maxHp/damage match what combat tests assume, node maxHp
    sane. These catch data-edit regressions cheaply.
  - Done when: `npm test` green including the jsdom file; data invariants assert real constraints.

- [ ] **Step 4: Build the scenario-setup + fixed-step API on GameScene** `[inline]`
  - Add a **test-only** control surface, namespaced so it reads as non-production. Two shapes are
    acceptable — pick at execute: (a) methods on `GameScene` exposed via
    `window.game.__test = { applyScenario, step, ... }`, or (b) a `src/debug/testApi.ts` the scene
    installs. Guard install behind `import.meta.env.DEV` **or** a `?test=1` query flag so it is absent
    from the normal production bundle (note in `docs/DECISIONS.md`).
  - `applyScenario(spec)`: reset the world (reuse the `create()` reset block —
    [GameScene.ts:173-197](src/scenes/GameScene.ts#L173)) then deterministically set: player tile +
    facing, inventory contents, mode (`command|combat|inspect`), and place exactly the trees / zombies
    / walls / blueprints the spec lists (own placement — do not lean on `spawnTrees`/`spawnZombies`
    fixtures). Return once the world matches the spec.
  - `step(ms)`: advance gameplay by a fixed delta with the **Phaser loop paused** (pause in test mode,
    then pump `scene.update(t, ms)` yourself), so chop intervals (`CHOP_INTERVAL_MS`), build progress
    (`BUILD_MS`), contact cooldown, and future day/night resolve deterministically — no `waitForTimeout`.
    Verify pausing + manual-stepping doesn't double-drive physics; if that proves fiddly, the fallback
    is a bounded poll (like the chop fix already in `smoke.mjs`) — but prefer real stepping.
  - Extend `debugState()` only if a scenario needs a read it lacks (keep it the one read seam).
  - Done when: from the browser console, `window.game.__test.applyScenario({player:[3,3], trees:[[5,3]],
    wood:0})` then repeated `__test.step(CHOP_INTERVAL_MS)` after ordering a chop yields wood
    deterministically; the API is absent from a plain `npm run build` bundle (grep the output).

- [ ] **Step 5: Port the integration/input/render assertions to deterministic scenarios** `[delegate sonnet]`
  - New `scripts/scenarios/` (or `tests/e2e/`) Playwright runner mirroring `smoke.mjs`'s browser
    launch (honour `SMOKE_CHROMIUM_PATH`, viewport, zero-console-error listener). One file per concern,
    each: load → `applyScenario(...)` → do the ONE action → `step()` if time-based → assert via
    `debugState()`/inspect state. Port only the **Tier-2** rows: zoom clamp/readout, pan/follow,
    input-mode toggles, Inspect panels (zombie/tree/wall/empty), queued-tree **glow attaches**
    (`outlinedTreeIds`/`pulsingTreeId`), build→wall→pathfinding-on-real-grid, death→restart. No
    multi-second walks — place entities adjacent and `step()`.
  - Wire `npm run e2e` (or fold into `test`). Keep honouring the pre-installed Chromium path.
  - Done when: each scenario passes **repeatably** (run the suite ≥5× — the bar the current smoke
    fails); no `waitForTimeout`-based gameplay assertions remain.

- [ ] **Step 6: Slim `smoke.mjs` to a boot canary + retire the playthrough** `[inline]`
  - Reduce `scripts/smoke.mjs` to: boot, reach `Game`+`UI` active, assert **zero console/page errors**
    (keeps the shader-compile gate), screenshot for eyeballing — delete the §0–§8 playthrough now
    covered by Tiers 1–2. Rename to `scripts/boot-check.mjs` if clearer; update the `smoke` script.
  - Confirm every retired assertion has a Tier-1 or Tier-2 home (use the coverage map as a checklist —
    nothing silently dropped).
  - Done when: `npm run smoke` (boot canary) + `npm test` + `npm run e2e` all green; the linear
    playthrough is gone.

- [ ] **Step 7: Document + update CI/workflow references** `[delegate sonnet]` (parallel: B)
  - `docs/WORKFLOW.md`: the test story is now `npm test` (fast, pre-commit) + `npm run e2e` (scenario)
    + `npm run smoke` (boot canary); how to add a unit test and a scenario. `docs/DECISIONS.md`: dated
    entry resolving the harness-shape open question (Vitest + scenario API + fixed-step; why the live
    playthrough was retired). Flip the `docs/DECISIONS.md` "isolated test setups" **[OPEN]** to
    **[DECIDED]**. `CLAUDE.md`: refresh the "Testing direction" note. If a GitHub Actions workflow runs
    the smoke, point it at `npm test` (+ e2e) too.
  - Done when: docs describe the three tiers and how to extend them; the open question is closed.

## Out of scope
- Rewriting game systems for testability **beyond** at most decoupling `Inventory`'s emitter (only if
  jsdom is genuinely painful — otherwise untouched).
- 100% coverage or snapshot/visual-regression testing (the boot screenshot stays eyeball-only).
- New gameplay, balancing, or content — this is test infrastructure only.
- Replacing Playwright or changing the deploy pipeline.
- Building scenario coverage for features that don't exist yet (day/night, hunger get tests when they
  get behaviour) — though `__test.step()` is designed to make those easy later.
