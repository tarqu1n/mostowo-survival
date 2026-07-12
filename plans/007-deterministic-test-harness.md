# Deterministic Test Harness (Unit Tests + Scenario Setups, Retire the Live-Game Smoke)

> Status: planned, critiqued (fresh-eyes pass folded in — fixed B1 the `step()` mechanism, B2 the
> DEV-gate vs server contradiction, + S3/S4/S5/S6/S7/N8/N9). Hand back to Matt before /execute-plan
> (WORKFLOW.md gates).

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

**Two-speed dev loop (the real goal — run only what you touch, full sweep before wrap-up):** the
whole point is speed, so both tiers must be **selectively runnable**, not all-or-nothing like the
current smoke:
- **Inner loop (sub-second, on save):** `vitest` watch reruns *only the unit tests whose module graph
  touches the changed file* (edit `combat.ts` → only combat tests run). Targeted forms:
  `vitest run <name>` and `vitest related $(git diff --name-only)` (run exactly what the working-tree
  changes affect). No browser. This covers the bulk of iteration.
- **Feature-level check:** when a change needs browser fidelity, run **just that one scenario**
  (seconds), not the suite — which requires each scenario to be an independently runnable/filterable
  file (see Step 5; this is why Tier 2 should use the Playwright **test runner** for native
  `--grep`/per-file selection rather than one hand-rolled monolith).
- **Wrap-up gate (before finishing a feature):** `npm test` (all unit) + `npm run e2e` (all scenarios)
  + `npm run smoke` (boot canary) — the full sweep. Fast enough to run often *because* the heavy work
  moved to Tier 1 and the browser tier is a handful of adjacent-entity scenarios, not a playthrough.

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
  gameplay by a known amount by **stopping the game loop and driving `game.step(t, fixedDelta)`**
  (which runs each scene's `Systems.step` → Arcade physics → clock → timers → tweens) — so movement,
  chop intervals, build progress, contact cooldowns, regrow and (later) day/night all resolve without
  wall-clock sleeps. This is what removes the flakiness class, not the current chop poll band-aid.
  **NB (critique B1):** a naive `scene.update(t, ms)` pump does *not* do this — physics/clock/timers
  don't advance from it; Step 4 spells out the correct mechanism.

**Key facts from repo research (anchors to respect):**
- **No test framework yet:** `package.json` scripts are `dev/build/preview/typecheck/smoke`; devDeps
  are `playwright typescript vite`. Add `vitest` and `@playwright/test` (pinned to the same 1.61.x as
  `playwright`). Aim for **all tests in plain Node** — reach for `jsdom`(+canvas-mock) only if forced.
- **Pure vs Phaser-coupled systems:** `src/systems/{pathfind,tasks,combat,grid}.ts` import **no
  Phaser** → test directly in Node. `stats.ts` is runtime-pure too (only a **type-only** import of
  GameScene interfaces — erased; keep it type-only). **`src/systems/Inventory.ts` imports Phaser** just
  for `Phaser.Events.EventEmitter` (which *is* `eventemitter3`). Importing full `phaser` in Node runs
  its canvas feature-detection and needs jsdom + a canvas mock — a known-painful path (critique S5), so
  the **default is to keep Inventory Node-testable**: alias `phaser`→stub in `vitest.config`, or have
  Inventory import `eventemitter3` directly. jsdom is the last resort, not the plan.
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
  - Add `vitest` to `devDependencies`. Add `vitest.config.ts` (reuse Vite resolution; `environment:
    'node'` — the goal is *all* tests run in plain Node, see Step 3's Inventory decision; only add a
    `jsdom` override glob if a test genuinely can't avoid the DOM). Set **`passWithNoTests: true`**
    (critique S7 — `vitest run` with zero test files otherwise exits non-zero, breaking this step's
    done-when and any pre-test CI).
  - `package.json` scripts — support the two-speed loop from the start: `"test": "vitest run"` (full,
    for the wrap-up gate), `"test:watch": "vitest"` (inner loop — reruns only affected tests on save).
    Targeted runs need no extra script (`npx vitest run <name>`, `npx vitest related <files>` work out
    of the box). A `"check": "npm run typecheck && npm run test"` convenience is fine.
  - Done when: `npm test` exits 0 with no test files (`passWithNoTests`); `npm run test:watch`
    watches; `npx vitest run <name>` runs a single file — confirm the selective forms work.

- [ ] **Step 2: Unit-test the Phaser-free pure systems** `[delegate sonnet]` (parallel: A)
  - New `src/systems/__tests__/` (or `*.test.ts` beside each). Cover, from the coverage map:
    - `pathfind.test.ts` — `findPath` reaches an open tile routing around a wall; returns null onto a
      blocked tile; `reachableAdjacent` picks a walkable neighbour. Build the grid inline (no scene).
    - `tasks.test.ts` — `TaskQueue`: `all()` = `[current, ...pending]`; append/replace/next/clear;
      pending count transitions used by §2/§3.
    - `combat.test.ts` — `resolveMeleeAttack`: flat-1 damage, 3 hits kill a maxHp-3 zombie, hit-chance
      edges; contact-cooldown math if it lives here.
    - `grid.test.ts` — `worldToTile`/`tileToWorldCenter`/`snapToTileCenter`/`tileKey` round-trips.
    - `stats.test.ts` — whatever `stats.ts` exposes. Note (critique S6): `stats.ts` uses a **type-only**
      `import type { TreeNode, BuildSite, ZombieUnit } from '../scenes/GameScene'` — erased at runtime
      so purity holds, but those interfaces carry Phaser fields, so the test builds partial-mock casts;
      keep the import type-only (a value import would silently pull Phaser into the Node run).
  - These are the assertions that keep breaking indirectly; make them direct and fast.
  - Done when: `npm test` green; each pure system has meaningful coverage of its current smoke-implied
    behaviour.

- [ ] **Step 3: Unit-test Inventory + data invariants** `[delegate sonnet]` (parallel: A)
  - `Inventory` extends `Phaser.Events.EventEmitter` ([Inventory.ts:1](src/systems/Inventory.ts#L1)),
    but that class **is** `eventemitter3`. Critique S5: importing the full `phaser` package under jsdom
    runs its `Device`/canvas feature-detection at import (touches `document`/`canvas.getContext`) and
    typically needs `vitest-canvas-mock` — a known-painful path. **Default: keep the Inventory test in
    plain Node** by removing the full-phaser import from the test path — either alias `phaser` → a stub
    in `vitest.config.ts`, or (cleanest) have `Inventory` import `eventemitter3` directly instead of via
    `phaser`. Only fall back to jsdom + canvas-mock if neither is workable. Test add/get, the `wood`
    accounting behind chop-yield/blueprint-spend, and that it emits on change.
  - Data invariants (pure, node): `src/data/{nodes,buildables,enemies,items,types}` — e.g. every
    buildable's cost items exist, `kidZombie` maxHp/damage match what combat tests assume, node maxHp
    sane. These catch data-edit regressions cheaply.
  - Done when: `npm test` green including the jsdom file; data invariants assert real constraints.

- [ ] **Step 4: Build the scenario-setup + fixed-step API on GameScene** `[inline]`
  - Add a **test-only** control surface, namespaced so it reads as non-production: install
    `window.game.__test = { applyScenario, step, setRng, ... }` (methods on `GameScene`, or a
    `src/debug/testApi.ts` the scene installs). **Gate purely on `import.meta.env.DEV`** — NOT a
    `?test=1` runtime flag — so Vite dead-code-eliminates the whole install block from `vite build` and
    it is genuinely absent from the shipped bundle. *This forces the e2e server to be `vite dev` (where
    `DEV===true`), which Step 5 must honour* — critique B2: `vite preview` serves the **production**
    build where `DEV===false`, so a DEV-gated API would be `undefined` under preview and every scenario
    would fail setup. Do not mix the two guards; they give contradictory guarantees. (Note in
    `docs/DECISIONS.md`.)
  - `applyScenario(spec)`: reset the world (reuse the `create()` reset block —
    [GameScene.ts:173-197](src/scenes/GameScene.ts#L173)) then deterministically set: player tile +
    facing, inventory contents, mode (`command|combat|inspect`), and place exactly the trees / zombies
    / walls / blueprints the spec lists (own placement — do not lean on `spawnTrees`/`spawnZombies`
    fixtures). Return once the world matches the spec.
  - `setRng(fn)` (critique S3): the scene's combat call sites default to `Math.random` —
    `resolveMeleeAttack(...)` at [GameScene.ts:757](src/scenes/GameScene.ts#L757) and the zombie
    contact attack at [GameScene.ts:990](src/scenes/GameScene.ts#L990) pass **no** rng. It's only
    deterministic today because `kidZombie.dodge` and player `dodge` are both `0` (hitChance clamps to
    100). Thread an injectable rng from the scene into those calls and let `__test.setRng` (or a
    `spec.rng`) pin it, so combat scenarios survive any future `dodge > 0`.
  - `step(ms)` — the determinism seam. **Do NOT call `scene.update()` directly** (critique B1: movement
    is Arcade-physics velocity integration via `physics.moveTo` at [GameScene.ts:391](src/scenes/GameScene.ts#L391)
    / [:956](src/scenes/GameScene.ts#L956); the scene clock `this.time.now` gates contact damage/repath
    at [GameScene.ts:974-990](src/scenes/GameScene.ts#L974); regrow is a `time.delayedCall` at
    [:899](src/scenes/GameScene.ts#L899) — none of these advance from a manual `scene.update` call, so
    it would freeze exactly what we need to drive). Instead **stop the game loop** (`game.loop.stop()`)
    and drive the whole pipeline with a manual monotonic clock: loop `game.step(t, fixedDelta)` with
    `t += fixedDelta` for `ms/fixedDelta` iterations — this runs each scene's `Systems.step` → Arcade
    `World.update` → `Clock` → `TweenManager` → render, deterministically. This is the standard Phaser
    fixed-step technique; chop/build/contact-cooldown/regrow/tweens all advance with zero wall-clock.
    (No bounded-poll fallback — that reintroduces the flakiness this plan exists to kill.)
  - Extend `debugState()` only if a scenario needs a read it lacks (keep it the one read seam).
  - Done when: with the app on `vite dev`, `window.game.__test.applyScenario({player:[3,3],
    trees:[[5,3]], wood:0})` then order a chop and loop `__test.step(fixedDelta)` yields wood
    deterministically (worker actually walks + chops under the driven loop); a manual `step`-driven
    zombie closes distance and its contact damage fires; and `grep` of a plain `npm run build` bundle
    shows **no** `__test` install code.

- [ ] **Step 5: Port the integration/input/render assertions to deterministic scenarios** `[delegate sonnet]`
  - **One independently runnable file per concern** (`tests/e2e/{chop,combat,build,inspect,zoom,...}.spec.ts`)
    — this is what lets you run *only* the scenario for the feature you're touching during dev.
    **Recommended: use the Playwright test runner (`@playwright/test`)** rather than extending the
    hand-rolled `smoke.mjs` node script, because it gives per-file selection, `--grep` by test name,
    parallelism, and retries for free (`npx playwright test chop`, `npx playwright test -g "routes around"`).
    Add `@playwright/test` **pinned to the same 1.61.x line** as the existing bare `playwright` dep
    (critique S7 — version drift vs the pre-installed browser). `playwright.config.ts`: `use.launchOptions.executablePath`
    from `SMOKE_CHROMIUM_PATH`; **`webServer` = `vite dev`, NOT `vite preview`** (critique B2 — the
    `__test` API is DEV-gated per Step 4, so it exists only under dev); set `webServer.url` to match the
    dev base path (`vite.config` `base` is `/` in dev, `/mostowo-survival/` only in production — N8);
    **`retries: 0`** so flakes surface instead of hiding (N9).
  - Each spec: load → `applyScenario(...)` → do the ONE action → drive `__test.step(...)` if time-based
    → assert via `debugState()`/inspect state. Port the **Tier-2** rows: zoom clamp/readout, pan/follow,
    input-mode toggles, Inspect panels (zombie/tree/wall/empty), queued-tree **glow attaches**
    (`outlinedTreeIds`/`pulsingTreeId`), build→wall→pathfinding-on-real-grid, death→restart, **and the
    timing-sensitive input gestures the tiers would otherwise orphan** (critique S4): long-press-append
    and hold-drag-paint (`pressStart`/`LONGPRESS_MS` at [GameScene.ts:641](src/scenes/GameScene.ts#L641)/
    [:673](src/scenes/GameScene.ts#L673)) — now testable deterministically via driven `step`. No
    multi-second walks — place entities adjacent and `step()`.
  - `package.json`: `"e2e": "playwright test"` (full, wrap-up gate). A single scenario is just
    `npx playwright test <file>`. Keep honouring the pre-installed Chromium path.
  - Done when: `npx playwright test chop` runs **only** the chop scenario (proves selective running);
    the full `npm run e2e` passes **repeatably** (≥5×, `retries:0` — the bar the current smoke fails);
    no `waitForTimeout`-based gameplay assertions remain.

- [ ] **Step 6: Slim `smoke.mjs` to a boot canary + retire the playthrough** `[inline]`
  - Reduce `scripts/smoke.mjs` to: boot, reach `Game`+`UI` active, assert **zero console/page errors**
    (keeps the shader-compile gate), screenshot for eyeballing — delete the §0–§8 playthrough now
    covered by Tiers 1–2. Rename to `scripts/boot-check.mjs` if clearer; update the `smoke` script.
  - Confirm every retired assertion has a Tier-1 or Tier-2 home (use the coverage map as a checklist —
    nothing silently dropped).
  - Done when: `npm run smoke` (boot canary) + `npm test` + `npm run e2e` all green; the linear
    playthrough is gone.

- [ ] **Step 7: Document + update CI/workflow references** `[delegate sonnet]` (parallel: B)
  - `docs/WORKFLOW.md`: document the **two-speed loop** as the day-to-day workflow, not just the script
    list — *inner loop:* `npm run test:watch` (auto-scoped to changed files) + `npx playwright test
    <the-one-scenario>` when you need browser fidelity; *wrap-up gate:* `npm test` + `npm run e2e` +
    `npm run smoke`. Include how to add a unit test and a scenario, and the `vitest related` /
    per-file forms. `docs/DECISIONS.md`: dated entry resolving the harness-shape open question (Vitest
    + scenario API + fixed-step; per-behaviour minimal scenarios; why the live playthrough was retired)
    and flip the "isolated test setups" **[OPEN]** → **[DECIDED]**. `CLAUDE.md`: refresh the "Testing
    direction" note. If a GitHub Actions workflow runs the smoke, point it at `npm test` (+ e2e) too.
  - Done when: docs describe the three tiers, the two-speed run-only-what-you-touch workflow, and how
    to extend them; the open question is closed.

## Out of scope
- Rewriting game systems for testability **beyond** the small seams this plan needs: `Inventory`'s
  emitter import (Step 3) and threading an injectable `rng` into the scene's combat calls (Step 4, S3).
  No broader refactor.
- 100% coverage or snapshot/visual-regression testing (the boot screenshot stays eyeball-only).
- New gameplay, balancing, or content — this is test infrastructure only.
- Replacing Playwright or changing the deploy pipeline.
- Building scenario coverage for features that don't exist yet (day/night, hunger get tests when they
  get behaviour) — though `__test.step()` is designed to make those easy later.
