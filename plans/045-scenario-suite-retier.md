# Test Setup Overhaul — Phase 2 (scenario-suite re-tier)

> Status: planned — run /execute-plan to begin.

## Summary

Cut the CI e2e wall and its render-contention flakiness by **re-tiering the Playwright scenario
suite** (plan 044's deferred Phase 2). The e2e tier is the CI cost and it is fragile on the target
hardware: the first real `ci.yml` run on `master` was **red** — 4 render-heavy driven-frame specs
timed out on the hosted runners — and the e2e shards gate CI at **~8.5 min** wall. The root cause of
both the wall and the flakes is the same: `TestApi.step(ms)` drives *rendered* frames on headless
SwiftShader (fill-rate-bound). Phase 2 removes that cost — a render-free `stepLogic(ms)`, logic-only
specs migrated to Node, truly-pure specs deleted (only once a Node test provably covers their wiring)
— so the browser tier keeps only what genuinely needs a browser. This is a **re-tier, not a coverage
cut**: every deleted spec's wiring is Node-covered first.

## Context & decisions

### Re-measurement (the plan-044 gate — justified)

First real `ci.yml` run on `master` (run #2, sha `f71204f`, 2 shards × 2 workers):

| Job | test-exec | job wall | result |
|---|---|---|---|
| static-unit | 2s | ~53s | ✅ |
| smoke | ~9s | ~62s | ✅ |
| e2e shard 1 | 5.8m | ~6m24s | ❌ (1 fail) |
| e2e shard 2 | 7.3m | ~8m36s | ❌ (3 fail) |

- e2e gates CI at **~8.5 min** (static+smoke are ~1 min). The 4 reds are all `page.evaluate`
  timeouts on **render-heavy driven-frame** specs: `campfire.spec:206` (refuel walk, 30s),
  `death.spec:8` (die→restart, 60s), `survival-daynight.spec:10` (day→night overlay, 30s),
  `wave.spec:77` (fire-seeker drains fuel, 30s). Per-test costs on this hardware are brutal:
  `survival-hunger` ~29s each, `wave › beginWave` **1.6m**, several `companion` specs 20–38s.
- Phase 1 was validated green on the *faster* web-session box; the slower/GPU-contended GitHub
  hosted runners expose the render cost as both the wall driver and the flake driver — exactly what
  Phase 2's `stepLogic` removes.

### Owner decisions (this session)

- **Interim CI-green first (Step 1), merged to master early:** master CI is red now; a quick
  Phase-1-style stabilization goes green, then the migration removes the render cost and the inflated
  timeouts come back down at the end (Step 8). **Merge Step 1 to master on its own** as soon as a
  `workflow_dispatch` branch run is green — only a real *push* run closes the `notify` tracking issue
  (`notify` is `github.event_name == 'push'`-only), so branch-only validation never closes it. Continue
  the migration on the branch after that merge; Step 8's timeout reduction lands via the final merge.
- **Hard-gate the deploy at the end (Step 9) via `workflow_run`:** once CI e2e is fast + green, gate
  the deploy on a green CI run (reverses plan 044's "non-blocking" note — a red run just slipped
  through to master). **Not** `needs: [ci]` — GitHub `needs:` only links jobs *within one workflow
  file*, and there is no `ci` job (ci.yml's jobs are `static-unit`/`e2e`/`smoke`/`notify`; deploy.yml's
  are `build`/`deploy`), so `needs: [ci]` would fail to parse. Instead trigger `deploy.yml` on
  `workflow_run: {workflows: [CI], types: [completed]}` and deploy only when
  `github.event.workflow_run.conclusion == 'success'`. This **serializes** deploy after CI (no longer
  parallel) — that is the intended trade for a gate. The incorrect `needs: [ci]` suggestion in
  `ci.yml`'s header comment (and plan 044) must be corrected too, not copied forward.

### Carried-over Phase-2 scope (from plan 044, critique-corrected)

- **Hard gate:** no spec deleted unless a Node test **provably covers its wiring first**.
- **Corrections (044 Finding 4):** `zoom.spec` = pure clamp/round driven by `emit` → Tier-1
  candidate (only the camera-apply is browser); `inspect.spec` = mixed (event-payload pure,
  alpha-hitbox trunk-pick genuinely render).
- **Delete only truly-pure:** `mode`, `weapon-reach-arc`, the wave **pacing-only slice**.
- **Convert to `stepLogic`, never delete (044 Finding 1):** wiring-guards through non-Node
  managers — `survival-hunger`, `survival-daynight`, `campfire`, the mixed `wave` tests (fire-objective
  AI, fire-seeks-vs-chases-player, roadmap Step-2 acceptance clock→wave→loop-close), plus the
  scene-coupled state specs (chop, mine, block-full, build, wall, wall-deconstruct, spike-trap,
  companion, death).
- **Split the mixed specs:** boar, glow, queue, combat, monster, pathing-repro, wall-enemy-attack —
  pure state → Node, keep a trimmed browser core. **Leave `refactor-tripwire` untouched.**
- **`stepLogic` seam is DEV-gated (044 Finding 5):** keep it minimal + documented.

### Research findings (verified this session)

- **Node coverage already deep** — `src/systems/__tests__/`: `wave.test.ts` (covers pure
  `intervalForNightProgress`/`escalationForNight`/`spawnKindForIndex`), `campfire`, `daynight`,
  `needs`, `combat`, `companionCombat`, `monsterAI`, `hurtbox`, `base`, `baseSupply`, `orders`,
  `tasks`, `pathfind`, `stats`, `grid`. The e2e specs mostly guard **wiring** (manager→scene→
  registry→event) *on top of* these covered systems, not the pure logic itself.
- **Manager-tick Node template** = `src/systems/__tests__/monsterAI.test.ts` (pure `stepMonster` FSM
  with a stub inputs bag). The mirror for a scene-manager is **`WaveDirector`**: `tick(delta)` +
  `beginWave()`/`onTimeChanged()` over a `WaveDirectorDeps` **closure** (`spawnEnemy`/`dims`/
  `isBlocked`/`defendCentre`/`rng`/`dayContext`) — all injectable, so it is Node-instantiable with a
  fake deps object capturing spawns. This is the pattern every manager-tick Node test follows.
- **`stepLogic` seam:** `TestApi.step(ms)` (`src/scenes/testApi.ts:429`) stops the RAF loop and drives
  `game.step(clock, fixedDelta)` in fixed 1/60s slices. The fill-rate cost is
  `SurvivalClock.composite()` (`src/scenes/world/SurvivalClock.ts:251`) — a per-frame RT `fill` + an
  `erase` per lit fire, called every `tick`. Suppressing that (DEV-gated) around the loop is the lever.
- **Grep classification (browser-signal vs pure-state-signal counts)** confirms the browser-heavy
  set: `follow`, `gestures`, `menu-start`, `queue`, `inspect`, `campfire-feed`; everything else is
  pure-state-driven (candidates for Node/`stepLogic`).
- **Validation channel:** `ci.yml` triggers on push-to-master + `workflow_dispatch`; branch
  discipline forbids pushing to master from the feature branch, so **validate each step via a
  `workflow_dispatch` CI run on the feature branch** (dispatch runs the full e2e; the `notify` job is
  `push`-only, so no tracking-issue noise). Locally, `npm run e2e` + `npm test` still gate per step.

### Direction alignment

`docs/ROADMAP.md`'s MVP build order explicitly leans on the DEV scenario API (`applyScenario`/`step`)
to "end in something you can feel and test" — a fast, reliable scenario tier is load-bearing for that
workflow, so this infra work pulls in the project's stated way of building.

## Steps

- [ ] **Step 1: Interim CI-green stabilization (unblock master)** `[inline]`
  - Get `master` CI green **without** migration, so the tracking issue closes during the multi-step
    work. Root-cause is hosted-runner slowness on render-bound driven frames (not logic bugs) — the
    4 reds are timeouts. Interim levers (choose by a `workflow_dispatch` benchmark, prefer the
    smallest change that goes reliably green): (a) raise the affected per-spec `test.setTimeout`
    / the global `playwright.config.ts` `timeout` to give headroom on slower CI hardware; and/or
    (b) reduce GPU contention — set the CI e2e step to `--workers=1` and/or raise the shard matrix
    `2 → 3` in `.github/workflows/ci.yml` (more runners, fewer tests each). Do **not** touch spec
    logic or add retries (`retries: 0` stays). Annotate every bumped timeout with a
    `// plan 045 Step 1 interim — reduced in Step 8 once stepLogic removes the render cost` comment
    so Step 8 finds them.
  - Files: `playwright.config.ts`, `.github/workflows/ci.yml`, the 4 failing specs (timeout
    annotations only): `tests/e2e/{death,survival-daynight,campfire,wave}.spec.ts`.
  - Side effects: more Actions minutes if shards increase; artifact-upload names already keyed by
    shard. Local `npm run e2e` unaffected (it doesn't shard).
  - Docs: none yet (Step 9 rewrites docs).
  - **Merge cadence (Finding 2):** once a `workflow_dispatch` branch run is green, merge *this step
    alone* to master (fast-forward or a small PR) so the real push run closes the `notify` tracking
    issue — branch `workflow_dispatch` runs never do (notify is push-only). Then keep migrating on the
    branch. If you'd rather not merge mid-migration, that's fine too — but then drop the
    "closes the tracking issue" goal: master simply stays red (CI is non-blocking; deploy is
    unaffected) until the final merge.
  - Done when: a `workflow_dispatch` CI run on the feature branch is **green** (all shards + smoke);
    the chosen levers + interim-timeout comments are in place; (if merging early) the master push run
    is green and the tracking issue auto-closes.

- [ ] **Step 2: Coverage-map audit (the hard gate)** `[inline]`
  - Read **all 30** `tests/e2e/*.spec.ts` and produce `plans/045-coverage-map.md`: one row per spec —
    `file | behaviour | verdict (delete / convert-stepLogic / split / leave) | manager(s) driven |
    Node-instantiable? | existing-or-needed Node twin`. Bake in the 044 corrections (zoom = Tier-1
    clamp candidate; inspect = mixed) and the carried-over verdicts above; **confirm or correct each
    by actually reading the spec**, don't copy blindly. The map is the contract for Steps 5–7.
  - **Hard rule (044 Finding 1):** a `delete` verdict is only valid if a Node test *already* covers
    that spec's wiring, or the map names the exact Node test to add first (in Step 3/5). Cross-check
    each delete candidate against `src/**/__tests__/*.test.ts` (esp. `wave`, `hurtbox`, `daynight`,
    `needs`, `combat`, `monsterAI`).
  - **Explicitly classify `survival-forage.spec.ts`** — it is the 30th spec and is absent from the
    carried-over verdict list above (Finding 5); give it a verdict like the rest (likely
    convert-stepLogic: it drives a `needs:eat` emit + forage through scene-coupled managers).
  - **Flag real-scene/real-map/real-camera wiring (Finding 3):** for every `delete` row, check whether
    any assertion exercises the *live* scene/map/camera (not just emit→reducer-pure state) — e.g.
    wave's "walkable spawns local to camp" (real map walkability) or zoom's "broadcasts clamped value"
    (real camera apply). If so, **downgrade that sub-assertion to convert-stepLogic**, don't delete it;
    a fake-deps Node twin won't cover it. Reserve `delete` for genuinely emit→reducer-pure blocks.
  - Side effects: none (read-only + one new plan doc).
  - Docs: the coverage map itself.
  - Done when: `plans/045-coverage-map.md` classifies all 30 specs; every `delete` row names its
    covering Node test (existing or to-be-added); `refactor-tripwire` is marked `leave`.

- [ ] **Step 3: Establish the manager-tick Node pattern (WaveDirector)** `[inline]`
  - Add `src/scenes/world/__tests__/waveDirector.test.ts`, mirroring `monsterAI.test.ts`: construct
    `WaveDirector` with a fake `WaveDirectorDeps` closure (a `spawnEnemy` that records `{id,col,row,
    opts}`, plus stub `dims`/`isBlocked`/`defendCentre`/`rng`/`dayContext`) and a minimal fake
    `scene` (only what the ctor's `events.once(SHUTDOWN,…)` needs). Drive `beginWave()`,
    `onTimeChanged({phase})`, and `tick(delta)`; assert the pacing/escalation/first-tick-reconcile/
    no-day-spawn/opening-burst/force-wave behaviour the wave **pacing-only** e2e slice asserts today.
    This is the Node twin that unlocks deleting that slice (Step 5), and the **template** every other
    manager-tick Node test copies.
  - Files: new `src/scenes/world/__tests__/waveDirector.test.ts`. If the ctor's Phaser coupling makes
    a fake scene awkward, prefer a tiny typed stub over importing Phaser; note the shape in the test
    header for reuse.
  - Side effects: none (new Node test). Runs under `npm test` (fast tier).
  - Docs: none (Step 9).
  - Done when: `waveDirector.test.ts` is green in Node and covers the wave pacing/escalation/reconcile/
    force-wave wiring; the file documents the "fake-deps manager-tick" pattern for later steps.

- [ ] **Step 4: Add a render-free `stepLogic(ms)` to `TestApi` (+ DEV-gated composite suppress)** `[inline]`
  - Add `stepLogic(ms)` beside `step(ms)` in `src/scenes/testApi.ts`: same fixed-1/60s
    `game.step(clock, fixedDelta)` loop, but **suppress the render cost** around it. Set before the
    loop, **always restore in a `finally`** (a thrown step must not leave the scene hidden/suppressed).
    Default `step(ms)` is unchanged (still renders — for the genuinely-render specs).
  - **Measure the levers independently before committing to the shipping-method edit (Finding 4):**
    the dominant cost of driving ~1320 frames may be the *whole* per-frame scene render, not only
    `SurvivalClock.composite()`. First try `scene.sys.setVisible(false)` (or skipping the render pass)
    alone and time a pilot spec; **only if** that doesn't remove the dominant cost, add the DEV-gated
    suppress flag read by `SurvivalClock.composite()` (early-return past the RT `fill` + per-fire
    `erase`). Prefer the smallest seam that gets the win — a config/scene lever beats editing a
    shipping method. If the flag is needed, keep it **minimal + DEV-only + documented** (044 Finding 5):
    one boolean, `import.meta.env.DEV`-gated, one comment at each site.
  - Expose `stepLogic` on `window.game.__test` (same DEV gate as `step`) and add a `stepLogic(page,
    ms)` helper in `tests/e2e/harness.ts` next to `step`.
  - Side effects: if the composite flag is used, `SurvivalClock.composite()` is a shipping method — the
    flag must be DEV-gated (`import.meta.env.DEV`) so `vite build` strips it and prod render is
    byte-identical; verify via `npm run smoke`. Either way, confirm a converted spec is faster + still
    correct.
  - Docs: none yet (Step 9).
  - Done when: `stepLogic` exists + is exposed; a pilot conversion (e.g. `survival-daynight`, currently
    ~29s/test on CI) drops to **a few seconds** and stays green; `step()` still renders; `npm run
    smoke` green (any flag absent from prod). Record which lever(s) were needed for Step 8's numbers.

- [ ] **Step 5: Migrate-down + DELETE the truly-pure specs (gated on Node coverage)** `[inline]`
  - **Only after** the covering Node test exists (Step 2 map + Step 3): delete the truly-pure specs
    and their now-redundant browser cost.
    - `mode.spec.ts` — add/confirm a Node test for the mode toggle state machine (mutually-exclusive
      command/combat/inspect + `mode:changed`); if the logic isn't Node-instantiable, **downgrade the
      verdict to convert-stepLogic** rather than delete. Then delete the spec.
    - `weapon-reach-arc.spec.ts` — confirm `hurtbox.test.ts` (or add) covers the reach/cleave hit-tile
      geometry; then delete.
    - The wave **pacing-only slice** in `wave.spec.ts` — delete only the genuinely emit→reducer-pure
      blocks now covered by Step 3's `waveDirector.test.ts` + existing `wave.test.ts` (pacing curve,
      escalation, force-wave, first-tick reconcile). **Do NOT delete** "beginWave starts a paced wave
      of **walkable spawns local to the camp**" — it exercises real-map walkability a fake-deps Node
      twin can't cover (Finding 3): **convert it to `stepLogic`** in Step 6 instead. Keep the mixed
      tests for Step 6.
    - `zoom.spec.ts` — Node-cover the pure clamp/round fn (extract it if not already a pure fn). The
      "broadcasts the clamped value" assertion reads the **real camera** (`cameraZoom`) — real-camera
      wiring a Node twin won't cover (Finding 3), so **keep a trimmed `stepLogic`/no-step browser
      assertion** for the camera-apply + broadcast rather than deleting outright. Only delete the
      spec entirely if the audit confirms the camera read adds nothing over the Node clamp test.
  - Side effects: `wave.spec.ts` is edited here (delete slice) **and** in Step 6 (convert mixed) — do
    Step 5's wave edits first to avoid churn. Update any shared fixtures in `tests/e2e/scenarios.ts`
    left unused.
  - Docs: none yet (Step 9).
  - Done when: the named specs/blocks are gone, each replaced by a green Node test proving the same
    wiring; `npm test` + `npm run e2e` green.

- [ ] **Step 6: Convert scene-coupled wiring-guards to `stepLogic` (never delete)** `[inline]`
  - Swap `step(...)` → `stepLogic(...)` in the specs that assert only **state** (no render/pointer/
    alpha) but drive **non-Node managers** (physics/clock/task-executor/StructureManager): the mixed
    `wave` tests (fire-objective AI, fire-seeks-vs-chases-player, **roadmap Step-2 acceptance**
    clock→wave→loop-close), `survival-hunger`, `survival-daynight`, `campfire`, and the scene-coupled
    state specs `chop`, `mine`, `block-full`, `build`, `wall`, `wall-deconstruct`, `spike-trap`,
    `companion`, `death`. These are the specs that timed out on CI — `stepLogic` removes the render
    cost that made them slow/flaky. Keep every assertion; only the stepping call changes.
  - Per spec: if any single assertion genuinely needs a rendered frame (alpha/RT/PostFX), leave *that*
    one on `step()` and `stepLogic` the rest — don't blanket-convert past a real render check.
  - Side effects: reuses the Step-1 interim timeout bumps (removed in Step 8). Re-run each converted
    spec locally to confirm determinism holds under the render-free loop.
  - Docs: none yet (Step 9).
  - Done when: the listed specs run on `stepLogic`, stay green, and are materially faster; no render
    assertion was silently dropped.

- [ ] **Step 7: Split the mixed specs (pure → Node, trim the browser core)** `[inline]`
  - For `boar`, `glow`, `queue`, `combat`, `monster`, `pathing-repro`, `wall-enemy-attack`: move the
    pure-state assertions into Node unit tests (new or existing `src/**/__tests__/`), and keep a
    **trimmed** browser spec holding only the genuine render/pointer/alpha/PostFX assertions
    (converting its non-render stepping to `stepLogic`). Leave the genuinely-browser specs as-is
    except `step→stepLogic` where no render is asserted: `follow`, `gestures`, `menu-start`,
    `inspect` (mixed — split its pure event-payload part to Node, keep the alpha-hitbox trunk-pick in
    browser). **Leave `refactor-tripwire.spec.ts` completely untouched.**
  - Side effects: new Node tests must not duplicate existing coverage — check the twin first. Deleting
    a moved assertion from a browser spec is a coverage move, not a cut: the Node test must land in the
    same step.
  - Docs: none yet (Step 9).
  - Done when: each mixed spec's pure part is Node-covered and its browser remainder is minimal +
    green; `refactor-tripwire` unchanged; `npm test` + `npm run e2e` green.

- [ ] **Step 8: Re-time, reduce the now-oversized timeouts, right-size shards/workers** `[inline]`
  - With render removed from the hot specs, re-measure the e2e wall via a `workflow_dispatch` CI run
    on the branch (and `npm run e2e` locally). **Reduce** the annotated interim timeouts from Step 1
    and any other now-oversized `test.setTimeout`/global `timeout` to fit the faster reality (grep the
    `plan 045 Step 1 interim` comments). Re-tune `playwright.config.ts` `workers` and the `ci.yml`
    shard matrix / `--workers` to the new benchmark (fewer shards may now suffice).
  - Side effects: config + timeout annotations only. Do the reduction *last* — trimming before the
    render cost is gone would re-introduce flakes (plan 044's explicit warning).
  - Docs: none yet (Step 9).
  - Done when: e2e wall is **at least halved from ~8.5 min (target ≲3–4 min)**, **green on two
    consecutive `workflow_dispatch` runs**, timeouts right-sized, before/after numbers recorded for
    Step 9. (Target is a guide, not a gate — record the real number even if it lands higher.)

- [ ] **Step 9: Hard-gate the deploy on CI + rewrite the docs** `[inline]`
  - Gate the deploy on a green CI run via **`workflow_run`** (Finding 1 — `needs: [ci]` is impossible:
    `needs:` only links jobs in the *same* file, and there is no `ci` job). Change `deploy.yml`'s
    trigger to `workflow_run: {workflows: [CI], types: [completed]}` (keep/adjust the branch filter to
    master) and guard the build/deploy jobs with
    `if: github.event.workflow_run.conclusion == 'success'` so a red CI (failed e2e/smoke) never
    deploys. This **serializes** deploy after CI — no longer parallel; that is the intended trade for a
    gate. Ensure the deploy still checks out the exact SHA CI ran (`github.event.workflow_run.head_sha`).
    **Also fix the stale `needs: [ci]` suggestion** in `ci.yml`'s header comment (lines ~6–7) so the
    wrong idea isn't propagated. Note the new trigger model in a workflow comment.
  - Docs (token-lean): `docs/testing.md` — Phase 2 done: `step` vs `stepLogic`, the re-tiered
    tier-table, new e2e wall, CI now a hard gate. `docs/decisions/testing.md` — dated `[DECIDED]`
    Phase-2 entry (re-tier rationale, `stepLogic` seam, delete/convert/split outcome, before/after
    numbers, the `workflow_run` gate) + `docs/DECISIONS.md` index line. `docs/STANDARDS.md` — tooling
    table: deploy now gated on CI (via `workflow_run`, serialized after CI). `docs/STATUS.md` —
    test-harness line refreshed. Root `CLAUDE.md` only if the "three-tier harness" line is now
    inaccurate (it isn't — leave it).
  - Side effects: with the `workflow_run` gate, a genuinely-red CI now stops deploys and deploy no
    longer runs parallel to CI — intended; call both out in the decision entry so they aren't a surprise.
  - Done when: `deploy.yml` triggers on `workflow_run` and deploys only on CI `conclusion == 'success'`
    (verified by a green→deploy and a forced red→no-deploy); the stale ci.yml comment is fixed; docs
    accurately + tersely describe the re-tiered suite and the gate; a fresh session could follow the
    `step`/`stepLogic` split without rediscovery.

## Out of scope

- Extracting the in-`GameScene` task executor / Arcade pathfinding / structure tick into Node-pure
  modules (would let the scene-coupled specs migrate fully instead of `stepLogic`) — deferred.
- `Phaser.HEADLESS` test build (rejected in 044 — RenderTexture/glow/HitFlash PostFX assume a live GL
  context).
- Adding **new** gameplay coverage beyond re-homing what exists (this is a re-tier, not a coverage push).
- Switching test runners — Vitest + Playwright stay.
- Deleting or altering `refactor-tripwire.spec.ts`.

## Critique

> Fresh-eyes review (2026-07-22). Verdict: sound, roadmap-aligned re-tier with disciplined
> delete-gating — but its capstone hard-gate (`needs: [ci]`) was technically infeasible as written,
> and Step 1's "unblock master" rationale didn't hold under branch-only validation. Both resolved in
> this revision (owner decisions: `workflow_run` gate; merge Step 1 to master early). Findings 3–6
> folded into Steps 2/4/5/8.

|#|Finding|Severity|Resolution in this revision|
|-|-------|--------|---------------------------|
|1|`needs: [ci]` can't gate across workflow files — no `ci` job exists; deploy.yml would fail to parse.|High|Step 9 rewritten to gate via `workflow_run` (deploy after CI, serialized) + fix the stale ci.yml comment. (Owner: `workflow_run`.)|
|2|`workflow_dispatch` branch runs never close the master `notify` tracking issue (notify is push-only).|Medium|Step 1 now states the merge cadence: merge Step 1 to master early so a real push run closes the issue. (Owner: merge early.)|
|3|Delete-bucket over-aggression: wave "walkable spawns local to camp" + zoom "broadcasts clamped value" hit real map/camera wiring a fake-deps Node twin won't cover.|Medium|Step 5 downgrades those to convert-`stepLogic`; Step 2 map must flag any delete row touching real scene/map/camera wiring.|
|4|Step 4 assumed `composite()` is *the* cost + made the shipping-method flag primary; full scene render may dominate.|Medium|Step 4 now measures `setVisible(false)` alone first; the DEV-gated composite flag is added only if needed.|
|5|`survival-forage.spec.ts` (30th spec) missing from the carried-over verdict list.|Low|Step 2 now classifies it explicitly (likely convert-`stepLogic`).|
|6|"materially/visibly faster" acceptance is soft (Steps 4/6/8).|Low|Step 4 names a per-test target (~29s→a few s); Step 8 targets ≥halved wall (≲3–4 min).|
