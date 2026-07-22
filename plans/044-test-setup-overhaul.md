# Test Setup Review & Overhaul (Phase 1)

> Status: planned — run /execute-plan to begin.

## Summary

End the friction with the test suite: it is run constantly and is slow. **Phase 1 (this plan)** takes
the low-risk, high-ROI levers that remove the slow tier from the human hot loop and protect `master`,
without touching test coverage: cut Vitest per-run overhead, move the heavy Playwright tier off the
local critical path (fast unit inner-loop + a fast pre-push gate + a new CI workflow that runs e2e),
fix the live flakes so the suite is green, right-size Playwright, and write down a **when-to-run-what**
policy (the cross-device rule: it must be in the repo). **Phase 2 (deferred, a future plan)** —
re-tiering the scenario suite (migrate logic-only specs to Node, render-free `stepLogic`, delete
redundant specs) — is scoped below but intentionally NOT executed until Phase 1 lands and the friction
is re-measured. This phasing is a deliberate response to the critique (see `## Critique`): Phase 1
alone should resolve the felt friction, and the risky, coverage-reducing work waits for evidence.

## Context & decisions

### Measured baseline (this session, 4-CPU box, 2 Playwright workers)

- **Tier 1 (unit, `npm test`):** 925 tests / 66 files. Tests execute in **910ms** but the suite takes
  **8.8s** wall — the rest is Vitest overhead (collect 5.6s + transform 2.1s + prepare 5.1s across
  workers). `vitest.config.ts` sets no `pool`/`isolate`, so it defaults to `forks` + `isolate:true`
  = one child process per file re-transforming the graph.
- **Tier 2 (scenario, `npm run e2e`):** 106 tests, **10.5 minutes**, and **5 failed on a plain run**
  (campfire-feed, follow, menu-start, monster-patrol, survival-forage — pointer/timing-sensitive).
  One test, `wave.spec.ts › beginWave starts a paced wave`, takes **1.1 minutes alone**. Root cause:
  `TestApi.step(ms)` (testApi.ts:429) drives real rendered frames via `Phaser.Game.step()` —
  `step(22000)` = 1320 rendered frames on headless SwiftShader (fill-rate-bound under parallel load).
  A slow suite that is also intermittently red = the friction.
- **Tier 3 (smoke, boot canary):** fine as-is. No gameplay/timing.
- **CI (`.github/workflows/deploy.yml`):** runs **only** `npm test` (unit) on push to master; NO e2e,
  smoke, typecheck, lint, or format gate; no separate CI workflow. The slow valuable tier is a
  hand-run local tax that does not protect master.
- **Hooks:** `.husky/pre-commit` = `npx lint-staged` (staged files only). No `pre-push` hook.
- Discipline is good: `retries:0` by policy, zero `.skip`/`.only`/`.todo`, no lint-disables, systems
  100% unit-covered, long timeouts annotated. This is a structural mismatch, not rot.

### Why Phase 1 alone fixes the felt friction

The pain is "tests run all the time and are slow." Today the local wrap-up gate runs the 10.5-min e2e
by hand. Phase 1 makes the **inner loop** fast unit only, the **pre-push** gate fast (typecheck +
unit), and **delegates e2e to CI** — so the human almost never waits on the browser tier locally. The
e2e wall-time itself is still ~10 min, but it is off the critical path and green. Making e2e itself
cheap (render-free/migration) is the Phase-2 optimisation, justified only if re-measurement shows the
CI-delegated e2e is still a bottleneck.

### Decisions (from the user, this session — incl. post-critique)

- **Scope:** full overhaul intended, but **phased** — ship Phase 1 (Steps below) first, re-measure,
  then plan Phase 2. (Critique Finding 2.)
- **CI shape:** a **separate, non-deploy `ci.yml`** on push to master (+ `workflow_dispatch`), running
  the full gate (typecheck + lint + lint:md + format:check + unit + e2e sharded + smoke), in parallel
  with the deploy workflow. **Non-blocking, but wires a failure notification** so a red run is seen and
  does not rot into ignored noise. (Critique Finding 3 — "keep non-blocking + notify".)
- **Pre-push:** **fast only** — `typecheck + unit`; e2e/smoke live in CI. Skippable with `--no-verify`
  for phone/WIP (cross-device rule).
- **Phase-2 migration (deferred):** aggressive migrate-down, but **only truly-pure specs get deleted**;
  specs that guard *wiring* through non-Node-instantiable managers get render-free `stepLogic`, never
  deletion. (Critique Finding 1 — see Phase 2 below for the corrected classification.)

### Target "when to run what" (the policy this plan encodes)

|Moment|Runs|Speed target|
|---|---|---|
|On save (inner loop)|`vitest` watch — only affected unit tests|<1s|
|Pre-commit hook|`lint-staged` (staged files)|sub-second|
|Pre-push hook (skippable)|`npm run typecheck && npm test`|a few s|
|CI on push (`ci.yml`, parallel to deploy)|typecheck + lint + lint:md + format:check + unit + e2e (sharded) + smoke|CI-time|
|Manual full local gate|`npm run check` (unit) / `npm run check:all` (+ e2e + smoke)|on demand|
|Deploy (`deploy.yml`)|unchanged: `npm ci` + `npm test` + `npm run build`|fast|

### Patterns to mirror

- Unit delta tests: `src/systems/__tests__/{wave,needs,campfire,combat,daynight}.test.ts`.
- Scenario helpers/seams: `tests/e2e/harness.ts`, `src/scenes/testApi.ts`, `tests/e2e/scenarios.ts` —
  the self-healing retried menu-tap in `harness.bootIntoGame` is the model for stabilising pointer flakes.
- Docs are LLM context — token-lean edits (STANDARDS.md "markdown-is-model-context" rule).

## Steps (Phase 1)

- [x] **Step 1: Cut Vitest per-run overhead** `[inline]`
  - Outcome: `vitest.config.ts` — added `pool: 'threads'` + `isolate: false` with an explanatory
    comment. `npm test` wall dropped **7.86s → ~1.3s** (925 tests / 66 files, all green across two
    runs). Overhead was the whole cost: prepare 4.63s→0.25s, collect 4.96s→2.18s, transform 1.75s→1.3s;
    test-exec itself was already ~0.5s. **No editor-store carve-out needed** — the Zustand store specs'
    existing `beforeEach` resets hold under `isolate:false`. No red tests, so no scoped isolation added.
  - Edit `vitest.config.ts`: switch to `pool: 'threads'` and set `isolate: false` (all unit tests are
    pure Node with no cross-file side effects). Re-run `npm test` and record the new wall time.
  - **Risk to check:** module-singleton bleed with `isolate:false` — the editor Zustand store tests
    (`src/editor/store/__tests__/*`) share module state (they already `beforeEach`-reset, but verify).
    If any test goes red, scope isolation: keep `isolate:false` globally but add a `test.projects` (or
    `poolOptions`) entry re-enabling isolation for `src/editor/store/**`, OR add the missing resets.
    Do NOT ship a red suite.
  - Side effects: `npm run check` and CI both call `npm test` — they inherit the speedup.
  - Docs: none yet (Step 6 rewrites testing.md with final numbers).
  - Done when: `npm test` is green and materially faster (target: overhead roughly halved); the config
    comment explains the pool/isolate choice and any editor-store carve-out.

- [x] **Step 2: Add a fast pre-push hook + `check:all` script** `[delegate]` (parallel: A)
  - Outcome: new `.husky/pre-push` (executable, husky-v9 plain script) runs `npm run typecheck && npm test`
    with a comment noting `--no-verify` skips it for phone/WIP pushes. `package.json` gains
    `check:all` (`npm run check && npm run e2e && npm run smoke`) + `test:related`
    (`vitest related --run`); `check` unchanged. Verified: typecheck exit 0, `npm test` green
    (925/66, ~1.5s), hook executable, package.json valid.
  - Create `.husky/pre-push` running `npm run typecheck && npm test` (mirror `.husky/pre-commit` style;
    husky v9 — a plain script). Make it executable. Add a one-line comment that it is skippable via
    `--no-verify` and why (cross-device: phone/WIP pushes).
  - Add `package.json` scripts: `"check:all": "npm run check && npm run e2e && npm run smoke"` (full
    local gate incl. browser tiers); keep `check` as the fast unit-only gate. Optionally add
    `"test:related": "vitest related --run"` for the documented targeted form.
  - Side effects: `prepare`/husky installs hooks on `npm install`; the new hook auto-installs.
  - Docs: none yet (Step 6).
  - Done when: `git push` triggers typecheck+unit locally; `--no-verify` skips it; `npm run check:all`
    exists and runs the full gate.

- [x] **Step 3: Add a separate CI workflow — unit + e2e (sharded) + smoke + static gates, non-blocking, with failure notify** `[inline]`
  - Outcome: new `.github/workflows/ci.yml` — push-to-master + `workflow_dispatch`, parallel to (not
    depended-on by) `deploy.yml`. Jobs: **static-unit** (npm ci → typecheck → lint → lint:md →
    format:check → test); **e2e** (2-shard matrix, `playwright install --with-deps chromium`,
    `playwright test --shard=i/2 --workers=2`, retries:0, uploads report+traces on failure);
    **smoke** (build with NODE_ENV=production → `npm run preview &` → dependency-free curl poll →
    `npm run smoke`). **Notify** (Finding 3): `notify` job (`if: always()`, `issues: write`) uses
    `actions/github-script` to open/update a single "🔴 CI failing on master" tracking issue on any
    failure and close it when green — no secrets, built-in GITHUB_TOKEN. CI is a signal, not a deploy
    gate (comment notes `needs: [ci]` as the later hard-gate option). Verified all static+unit gates
    pass locally via `npm run check` (exit 0); YAML validates. **Real master-push run + forced-failure
    notification can't be exercised from this feature branch (trigger is master-only) — deferred to
    Step 6 / post-merge.**
  - Create `.github/workflows/ci.yml`, triggered on `push` to `master` and `workflow_dispatch`,
    independent of and parallel to `deploy.yml` (do NOT make deploy depend on it — non-blocking signal).
  - Jobs: (1) **static+unit** — `npm ci` → `typecheck` → `lint` → `lint:md` → `format:check` → `test`.
    (2) **e2e** — matrix-**sharded** 2–4 shards (`playwright test --shard=${{matrix.shard}}/N`), each:
    `npm ci` → `npx playwright install --with-deps chromium` → run its shard; upload HTML report/traces
    on failure. Start `workers: 2`; benchmark. Keep `retries: 0`. (3) **smoke** — `npm ci` →
    `npm run build` → `npm run preview &` → `npm run smoke` (honour the Chromium-path env the smoke
    script reads).
  - **Failure notification (Finding 3):** on any job failure, notify so a red run is actually seen.
    Preferred: post to the guppi notifier via its MQTT/webhook path if reachable from Actions; if not,
    use a GitHub-native signal (a `actions/github-script` step that opens/updates a single tracking
    issue, or rely on GitHub's own failed-workflow email). Pick the simplest reliable one for a solo
    repo and note the choice in a workflow comment. Do NOT hardcode secrets — use repo Actions secrets.
  - Note in a comment: CI is a signal, not a deploy gate (deploy.yml still ships on green unit test);
    to hard-gate later, add `needs: [ci]` to the deploy job.
  - Side effects: new Actions minutes. `E2E_PORT`/`SMOKE_URL`/`SMOKE_CHROMIUM_PATH` envs already exist.
  - Docs: STANDARDS.md tooling table + testing.md (Step 6).
  - Done when: pushing to master runs `ci.yml` green (unit + all shards + smoke) alongside deploy;
    e2e is sharded, reports artifacts on failure, and a failing run produces a visible notification.

- [x] **Step 4: Fix the live flakes (make the suite reliably green), no migration** `[inline]`
  - Outcome: **e2e green on two consecutive cold runs (106 tests, ~9.3 min each, 0 fail/flake)**; no
    `waitForTimeout`-driven gameplay remains anywhere (retries stay 0). Root-caused each named flake
    against the headless renderer (SwiftShader) — several were NOT what the plan assumed:
    - **campfire-feed** — was real: `waitForTimeout(3000)` real-time 4-tile walk didn't finish under
      load (wood unconsumed). Rebuilt deterministic: player seeded adjacent, follow-cam settled with a
      driven frame, self-healing confirmed-queued flame tap, walk+tend via `step`.
    - **follow** — real drag raced the live RAF loop → converted to interleaved `step()` processing.
    - **survival-forage** — NOT a timing flake: a **stale assertion** (berryBush `yieldPerHit` is 3,
      not 2 — data drifted). Fixed the expected counts (3, then 2 after eating).
    - **menu-start** — NOT a leak: two stale issues — the boot-race dropped press (fixed with an
      await-ready gate on MainMenu active) and a **moved map spawn** (hardcoded 22,40 → now 118,140).
      Now reads the spawn dynamically + picks a walkable self-validation tile via `blocked()` (map-agnostic).
    - **monster (patrol)** — deterministic already; kept as-is + added `test.setTimeout(60s)` (it renders
      ~576 driven frames; an earlier iteration bump had blown the 30s default).
    - **Bonus game-bug (beyond the 5):** a cold run surfaced a real **crash** — a mob draining the
      campfire (`damageFire → applyFlame`) crashed intermittently because Phaser's 1-based
      `AnimationFrame.index` was passed as a 0-based `startFrame` and slipped through Phaser's `>` guard
      on the last frame (`frames[n]` undefined → `getFirstTick` reads `.duration`). Fixed in
      `CampfireBehavior.applyFlame` (0-based + clamp). Files: the 5 specs + `src/scenes/world/CampfireBehavior.ts`.
  - Root-cause and fix determinism in-place (retries stay 0; do NOT defer any of these to Phase 2):
    - **campfire-feed** — remove the last `waitForTimeout`-driven gameplay (real-time walking + a raw
      pointer tap): rebuild with `applyScenario` adjacency + `step`, and stabilise the flame tap the way
      `harness.bootIntoGame` self-heals the menu tap (await scene-ready, retry the tap).
    - **follow, menu-start** — pointer specs flaky under parallel load: apply the same await-ready +
      retried-pointer pattern; reduce to the minimal reliable pointer assertion if needed.
    - **monster-patrol** — physics movement over time: make waypoints/timing deterministic; give real
      headroom rather than hiding a flake.
    - **survival-forage** — driven by a `needs:eat` emit + forage; stabilise the ordering
      deterministically with `step` (no wall-clock).
  - Side effects: touches `tests/e2e/harness.ts` pointer helpers and the named specs only.
  - Docs: none (Step 6).
  - Done when: `npm run e2e` is green on **two consecutive cold runs**; no `waitForTimeout`-driven
    gameplay remains in any spec.

- [x] **Step 5: Re-measure and right-size Playwright workers/timeouts** `[delegate → done inline]`
  - Outcome: set `workers: '50%'` explicitly in `playwright.config.ts` (was unset → Playwright's
    implicit half-vCPU default = 2 on the 4-vCPU box), `fullyParallel` unchanged (still true). Chosen
    by benchmark: the suite is fill-rate-bound on headless SwiftShader, so half the cores is the sweet
    spot — 106 tests **green on two consecutive cold runs at ~9.3 min** at this level. **Before/after
    e2e wall:** ~10.5 min **red** (5 fails, plan baseline) → **~9.3 min green** — the win is the Step-4
    flake fixes (deterministic `step` vs real-time waits + no crash), not worker count (already ~2).
    Left the annotated long timeouts untouched (Phase 2's `stepLogic` removes the render cost they cover).
  - With the suite green, re-time `npm run e2e` and record it. Right-size `workers` in
    `playwright.config.ts` to a benchmarked value (half vCPU as a start) and confirm `fullyParallel`
    still holds. Do NOT reduce the annotated long timeouts yet — they cover render-heavy driven frames
    that Phase 2 (`stepLogic`) removes; trimming them now would re-introduce flakes.
  - Side effects: config only; re-run to confirm green.
  - Done when: worker count is benchmarked, suite is green, before/after e2e wall-time recorded.

- [ ] **Step 6: Verify end-to-end and capture final numbers** `[inline]`
  - Run the full local gate: `npm run typecheck`, `npm run lint`, `npm test` (record wall time),
    `npm run e2e` twice cold (record wall time; expect 0 fail/flake), `npm run smoke`. Confirm `ci.yml`
    is green on a real push and that a forced failure fires the notification.
  - Done when: all tiers green; before/after numbers (Tier-1 wall, Tier-2 wall, flake count) captured
    for the docs and the decision entry.

- [ ] **Step 7: Rewrite the testing docs + decision log (Phase-1 scope)** `[inline]`
  - `docs/testing.md`: rewrite the tier table + two-speed loop to match reality — the when-to-run-what
    matrix (Context above), e2e now a **CI** gate (off the local critical path) with `check:all` as the
    manual full sweep, and the new pre-push hook. Add a short "Phase 2 (planned)" pointer to the
    re-tiering work. Token-lean.
  - `docs/STANDARDS.md`: update the "Tooling — what runs where" table (add pre-push row + the `ci.yml`
    row; correct the CI scope).
  - `docs/decisions/testing.md`: add a dated `[DECIDED]` entry summarising Phase 1 (Vitest overhead,
    pre-push, non-blocking CI + notify, flake fixes, before/after numbers) + note Phase 2 is deferred
    pending re-measurement; add an index line in `docs/DECISIONS.md`.
  - `docs/WORKFLOW.md` + root `CLAUDE.md`: fix any test commands/claims that changed (e.g. `check:all`,
    e2e-in-CI). Update `docs/STATUS.md` test-harness line.
  - Done when: docs accurately, tersely describe the Phase-1 setup; a fresh session could follow the
    when-to-run-what policy without rediscovery (cross-device rule satisfied).

## Phase 2 — DEFERRED (plan 045, to be written after Phase 1 re-measurement)

Do **not** execute this now. Plan it as `045` only if, after Phase 1, the CI-delegated e2e is still a
measured bottleneck. Scope, with the critique's corrections already applied:

- **Audit & coverage-map all 30 specs** (the hard gate): no spec may be deleted unless a Node test
  **provably covers its wiring first**. Correct the soft classifications (Finding 4): `zoom.spec.ts` is
  pure clamp/round logic driven by `emit` → Tier-1 candidate; `inspect.spec.ts` is mixed (event-payload
  pure, alpha-hitbox trunk pick genuinely render).
- **Establish a manager-tick Node pattern** using `WaveDirector` (`tick(delta)` + `WaveDirectorDeps`
  closure deps) as the template; mirror `monsterAI.test.ts`.
- **Render-free `stepLogic(ms)`** on `TestApi`: hide the scene (`scene.sys.setVisible(false)`) around
  the fixed-step loop + guard `SurvivalClock.composite()` behind a DEV-gated suppress flag (Finding 5 —
  keep the seam minimal + documented), then restore. Default `step()` keeps rendering.
- **Migrate down + delete ONLY truly-pure specs:** `mode`, `weapon-reach-arc`, and the **pacing-only
  slice** of `wave` (no-day-spawn, pacing, first-tick reconcile, escalation, force-wave).
- **Convert to `stepLogic`, do NOT delete (Finding 1):** the wiring-guard specs whose managers are not
  Node-instantiable — **survival-hunger** (clock→drain→HP cascade; the roadmap's regression guard),
  **survival-daynight**, **campfire** (feed→sprite→lit), and the **mixed `wave` tests** (fire-objective
  AI, fire-seeks-vs-chases-player, and the **roadmap Step-2 acceptance** clock→wave→loop-close cascade),
  plus the scene-coupled state specs (chop, mine, block-full, build, wall, wall-deconstruct, spike-trap,
  companion, death).
- **Split the mixed specs** (boar, glow, queue, combat, monster, pathing-repro, wall-enemy-attack):
  move pure state to Node, keep a trimmed browser core. Leave `refactor-tripwire` untouched.
- Then re-time and reduce the now-oversized timeouts.

## Out of scope (both phases)

- Extracting the in-`GameScene` task executor / Arcade pathfinding / structure tick into Node-pure
  modules (would let the scene-coupled specs migrate fully instead of `stepLogic`) — deferred.
- `Phaser.HEADLESS` test build (rejected — RenderTexture/glow/HitFlash PostFX assume a live GL context).
- Making deploy hard-depend on CI (`needs: [ci]`) — chosen non-blocking + notify; revisit later.
- Adding new gameplay test coverage beyond what exists (this is a re-tier, not a coverage push).
- Switching test runners — Vitest + Playwright stay.

## Critique

> Fresh-eyes review (2026-07-22). Verdict: thorough, honest, discipline-aware plan whose factual claims
> almost all check out — but the original Step 6's delete list contradicted the plan's own feasibility
> finding and would have irreversibly dropped integration coverage (incl. the roadmap's Step-2
> acceptance test). Resolved by phasing (Phase 2 deferred) + the corrected delete/convert split above.

|#|Finding|Severity|Resolution in this revision|
|-|-------|--------|---------------------------|
|1|Original Step 6 deleted specs guarding wiring through non-Node-instantiable managers (survival-hunger/daynight/campfire; wave's fire-objective + Step-2 acceptance) with no Node twin.|High|Phase 2 now **converts** these to `stepLogic` (never deletes); only truly-pure specs (mode, weapon-reach-arc, wave pacing-slice) are deletable, and deletion is gated on proven Node coverage.|
|2|12-step overhaul heavy for an MVP-complete, solo, phone-driven project; highest-ROI is the config/CI/flake work.|Medium|**Phased** — Phase 1 = Steps 1–7 (overhead, pre-push, CI, flakes, re-time, docs); Phase 2 (migrate/delete/`stepLogic`) deferred to plan 045 pending re-measurement.|
|3|Non-blocking `ci.yml` (red still deploys) rots into ignored noise on a solo repo.|Medium|CI stays non-blocking but Step 3 now **wires a failure notification**; `needs: [ci]` gating noted as a later option.|
|4|Soft (a)/(b)/(c) edges: `zoom.spec` is pure clamp logic (mis-filed browser); `inspect.spec` is mixed.|Low|Folded into the Phase-2 audit as an explicit correction.|
|5|`stepLogic` injects a DEV-gated suppress flag into a shipping system (`SurvivalClock.composite()`).|Low|Accepted (DEV-gated); Phase 2 note says keep the seam minimal + documented.|
