# Test Suite Re-tier (Phase 2)

> Status: deployed — committed core (Steps 1–2) merged to master. Phase 2b (Steps 3–8) stays opt-in,
> gated on recorded CI-wall-blocking-work evidence (see "Why now / the real gate") — re-raise as a new
> plan if that evidence shows up.

## Summary

Cut the Playwright e2e wall (currently ~9.3 min, 124 tests / 36 specs) without losing coverage. Post
critique, the plan is **split into a committed low-risk core and an opt-in, gated remainder**:

- **Committed (do now):** a **render-free `stepLogic(ms)`** on the test API (removes the per-slice WebGL
  draw + `SurvivalClock.composite()` RT cost that dominates the render-heavy specs) + a re-time & docs
  pass. This is the one lever with a standalone payoff, low risk, and no coverage change.
- **Phase 2b (OPT-IN, gated):** the 36-spec audit, Node migration, spec **deletion**, and the
  **shared-boot** refactor — held until there is *recorded, concrete evidence the CI e2e wall is
  blocking real work*, not merely that it is ~9 min.

Lever **A** (verify a step with the one guarding spec, not the full suite — the *actual* felt friction)
already shipped. The critique's core point: A + plan 044 already moved e2e **off the human critical
path** (CI is async, non-blocking, notify-on-red), so the aggressive re-tier is premature until impact —
not wall-time number — is demonstrated.

## Context & decisions

### Why now / the real gate (critique Finding 1 — HIGH)

The felt friction was **in-session agent work running the whole suite between plan steps** — fixed by
lever A. The ~9-min CI run does **not** make a human wait (push-triggered, parallel to deploy,
non-blocking). Plan 044 deferred this Phase 2 "until re-measured as a **bottleneck**"; re-measuring the
*number* is not the same as showing *impact*. **Therefore:**

- **Execute the committed steps (1–2) freely** — `stepLogic` pays off inside every future in-loop
  single-spec run (lever A's `npx playwright test <name>`), independent of the CI wall.
- **Do NOT start Phase 2b (Steps 3–8)** until this is recorded here: a concrete instance of the CI e2e
  wall costing real work (e.g. "waited on the 9-min shard to confirm a hotfix before shipping", or a
  measured merge-throughput hit). Absent that, prefer to stop after Step 2 and accept the wall.

### Measured baseline (this session, 4-vCPU box, 2 Playwright workers — matches plan 044's box)

- **~9.3 min, 124 test blocks across 36 spec files**, green (`retries: 0`).
- **Render cost is concentrated:** ~256 s of *driven game-time* is rendered across the suite; the top 8
  specs are ~76% of it — `companion` (~52 s driven), `wave` (~46 s), `survival-hunger` (~21 s),
  `combat` (~19 s), `campfire` (~16 s), `death` (~14 s), `monster` (~13 s), `workbench` (~13 s).
  **`stepLogic` (Step 1) attacks this directly and is why the committed core is worth doing.**
- **8 specs drive zero frames** (pure interaction/state): `glow`, `inspect`, `mode`, `zoom`,
  `hud-cluster`, `hud-drawers`, `hud-fight-controls`, `hud-overlays`.
- **Per-test boot ×124** — no `beforeAll`/`describe.serial` anywhere; every `test()` calls
  `startGame(page)`. Removing this needs shared-boot (Phase 2b Step 7) — the higher-risk lever.

### Key technical facts (verified against source this session + by the critique — mirror exactly)

- **`step(ms)` — `src/scenes/testApi.ts:461-470`.** Stops the RAF loop once (`game.loop.stop()`), then
  loops `round(ms/16.67)` slices calling `game.step(testClock, fixed)` = **full frame, update AND WebGL
  render**. Render-coupled work also runs in the *update* path above GameScene's no-action early-return
  (`GameScene.ts:1046`, early-return ~1087-1100): `SurvivalClock.tick → composite()`,
  `fx.syncEnemyHealthBars`, HitFlash PostFX. **So render-free needs BOTH a draw-skip AND a
  `composite()` suppress flag** — confirmed by critique. Boot uses full `step()`, so **boot-time
  RenderTexture/PostFX/glow construction is unaffected** (critique verified this — Finding 5 residual
  risk is only *which* draw-skip mechanism, not whether boot breaks).
- **`SurvivalClock.composite()` — `src/scenes/world/SurvivalClock.ts:270-286`**, called from
  `tick(delta)` (`:174`), `applyClock()` (`:243`), ctor seed (`:150`); early-returns at full daylight
  (`alpha <= 0`, `:279`). Minimal seam: a `suppressRender` boolean short-circuiting at the top.
- **`applyScenario`/`resetWorld` (`testApi.ts:247-290`)** resets world/domain state (entities, build,
  structures, companion, `WaveDirector.reset()`, task queue, player, `clockMs`/`dayPhase`/`dayCount`/
  `hunger`/`baseSupply`/inventory/HP). It does **NOT** reset (the shared-boot reset-shim list — critique
  Finding 4 adds the last two): `game.__captured` (per-boot in `harness.ts:103-118`), the capture event
  listeners (`on` with no `off`), the **stopped RAF loop**, `eatReadyAt` (`SurvivalClock.ts:106`),
  camera zoom/scroll/follow, DOM/HUD/Zustand state, **`TestApi.testClock`** (monotonic, never re-zeroed),
  and **`SurvivalClock.progressElapsed`** (day-cycle accumulator). → shared-boot is safe only for pure
  world-logic specs + an explicit per-test reset shim.
- **Node manager-tick template.** Mirror `src/systems/__tests__/monsterAI.test.ts` — deps as plain
  values/closures via a `baseInputs()`-style struct (`isBlocked: () => false`, `dims`, `rng =
  mulberry32(seed)`). **`WaveDirector`** (`world/WaveDirector.ts`) is the manager template: `tick`/
  `beginWave`/`spawnOne`/`pickSpawnTile` use only `WaveDirectorDeps` closures (`:28-44`); ctor needs
  `scene.events.once(SHUTDOWN,…)` → pass a `{ events: new EventEmitter() }` stub. Pure/Node-ready:
  `systems/wave.ts`, `systems/pathfind.ts`, `monsterAI.ts`, `systems/tasks.ts`. Scene-coupled:
  `EnemyManager`, `CompanionManager`, `CampfireBehavior`, the GameScene task executor
  (`orderRunners`/`orderBeginners`, `GameScene.ts:1196-1232`).

### Decisions

- **Committed core = Steps 1–2 only.** Phase 2b (Steps 3–8) is opt-in and gated on recorded CI-impact
  evidence (Finding 1). The stepLogic-only path is the *default*, not a buried fallback (Finding 6).
- **Deletion is the last resort, not the goal.** On an already-green suite, prefer **split** over
  **delete**; the deletion "gate" is discipline-only, so bias away from it (Findings 3, 8). Concretely:
  **`zoom` is reclassified delete → split** — it also guards the emit→clamp→camera→`zoom:changed`
  broadcast wiring, so a thin browser assertion stays (Finding 3).
- **Two stepping modes are a permanent maintenance surface** (Finding 2): keep the `stepLogic` seam
  minimal and document the `step` vs `stepLogic` rule prominently (Step 2 docs).
- **`retries: 0` stays** throughout — flakes are determinism bugs to fix, never hidden.
- **Plan number:** `045` fills the slot plan 044 + `docs/testing.md` reserved (sequence jumps 044→046).

### Patterns to mirror

- Node manager tick: `monsterAI.test.ts` (deps struct) + `WaveDirector` (`WaveDirectorDeps`).
- Existing unit deltas: `src/systems/__tests__/{wave,needs,campfire,combat,daynight}.test.ts`.
- Scenario helpers/seams: `tests/e2e/harness.ts`, `src/scenes/testApi.ts`, `tests/e2e/scenarios.ts`.
- Docs are LLM context — terse, high-signal edits (STANDARDS.md "markdown-is-model-context").

## Steps — Committed core (execute now)

- [x] **Step 1: Render-free `stepLogic(ms)` — spike the draw-skip, then adopt** `[inline]`
  - Outcome: mechanism = drive `game.scene.update(clock, fixed)` (Phaser `SceneManager.update`) directly
    instead of `game.step(...)`, skipping only `preRender`/`scene.render`/`postRender`; same update path
    (Arcade Physics/Tweens/Clock) as `step()`. Added `TestApi.stepLogic(ms)` (`src/scenes/testApi.ts`)
    - `SurvivalClock.suppressRender` flag (`src/scenes/world/SurvivalClock.ts`, early-return in
    `composite()`) + wiring in `GameScene.installTestApi()`/`testTypes.ts` + `stepLogic(page, ms)` in
    `tests/e2e/harness.ts`. Converted whole files (no mixed render/non-render assertions found) to
    `stepLogic`: `survival-hunger`, `survival-daynight`, `companion`, `campfire`, `combat`, `death`,
    `monster`, `workbench`, `wave`. `glow.spec.ts` untouched, stays on `step()`. Verified: `npm run
    typecheck`/`npm test` (992/992)/prettier clean; `npm run build` → seam stripped (0 occurrences in
    `dist`); `npm run smoke` passes; two cold `npx playwright test` runs of the 9 converted specs + `glow`
    → 73/73 both times (~2m29s, ~2m33s). No true old-`step()` before/after wall-time captured for this
    exact set (see Step 2 for re-timing the full suite). Not committed yet.
  - **First spike the mechanism** (Finding 5): find the cleanest way to run the fixed 1/60 s update loop
    while dropping the WebGL draw — candidates: `scene.sys.setVisible(false)` around the loop, pausing
    the renderer, or driving `scene.update(time,delta)` + `scene.physics.world.update` directly instead
    of `game.step`. Pick whichever keeps physics/tweens/timers/clock advancing identically to `step()`
    but skips `renderer.render`. Confirm by diffing a converted spec's non-render assertions against the
    `step()` version.
  - Add `stepLogic(ms)` to `TestApi` (`src/scenes/testApi.ts`) beside `step(ms)` using that mechanism,
    AND set a new `SurvivalClock.suppressRender` flag for the loop's duration so `composite()`
    (`SurvivalClock.ts:270-286`) short-circuits its RenderTexture ops (add the flag with an early
    `return` at the top; expose set/clear only via the DEV `stepLogic` path; verify `applyClock()` +
    ctor-seed composite calls are covered or unreached under logic-only stepping). Restore
    visibility/flag afterward; leave the RAF loop as `step()` does.
  - Add a `stepLogic(page, ms)` wrapper in `tests/e2e/harness.ts` mirroring `step`.
  - Convert the **top render-cost specs whose assertions don't read a rendered frame** to `stepLogic`
    (`survival-hunger`, `survival-daynight`, `companion`, `campfire`, `combat`, `death`, `monster`,
    `workbench`, and `wave`'s non-render tests). Keep render-dependent assertions (glow/outline/PostFX,
    screenshots, `isWebGL`) on `step()`. Where a spec mixes both, split the assertion, not the file.
  - Side effects: the DEV gate (`import.meta.env.DEV`) must still strip the seam from `vite build`
    (smoke unaffected). `retries: 0` — fix any flake at the source, don't paper over.
  - Docs: none yet (Step 2).
  - Done when: converted specs are green on **two consecutive cold runs** with identical non-render
    assertions and a **visibly lower e2e wall**; `npm run build` + `npm run smoke` pass (seam stripped
    from prod); a render-dependent spec (e.g. `glow`) still uses and passes under `step()`.

- [x] **Step 2: Re-time, right-size timeouts, document `step` vs `stepLogic`** `[inline]`
  - Outcome: parent session ran two cold full-suite `npm run e2e` passes post-Step-1 (hook blocks
    unfiltered runs, so this had to run outside delegation) — **130 tests, ~6.5min then ~6.3min**
    (was ~9.3 min / 124 tests before Step 1; count grew for unrelated reasons). Delegated sub-agent
    right-sized `test.setTimeout` in the 9 converted specs to 15-20s (from 60-120s render-era values,
    2-4x headroom over ~3.3-5.3s observed) in `companion.spec.ts`/`death.spec.ts`/`monster.spec.ts`/
    `wave.spec.ts`/`workbench.spec.ts` (`survival-hunger`/`survival-daynight`/`campfire`/`combat` had
    no oversized timeouts to touch). CI shard balance (`ci.yml`, 2 shards) checked and left alone — now
    balanced by even test count rather than by luck on render-seconds. Docs updated: `docs/testing.md`
    (Phase 2 note → shipped + new numbers + a prominent `step` vs `stepLogic` table in the scenario-API
    section + "adding a test" guidance), `docs/WORKFLOW.md` + `CLAUDE.md` (refreshed ~9.3min → ~6.5min),
    `docs/STATUS.md` (plan 045 committed-core note, Phase 2b still opt-in/gated). Verified: `npm test`
    992/992, `npm run build` + `npm run smoke` green, filtered re-runs of all touched specs green,
    typecheck/lint/format clean. Not committed yet by the sub-agent — parent session committing next.
  - Run `npm test`, `npm run e2e` twice cold (record wall + fail/flake=0), `npm run smoke`. With the
    render cost gone from the converted specs, right-size their now-oversized `test.setTimeout(...)` and
    re-run to confirm still green. Re-benchmark `workers` only if the profile shifted.
  - Docs: `docs/testing.md` — update the "Phase 2 (planned, plan 045)" note to reflect stepLogic shipped
    - new numbers, and **prominently document the `step` (renders) vs `stepLogic` (logic-only) rule** and
    when each applies (Finding 2), in the scenario-API + "adding a test" sections. `docs/WORKFLOW.md` +
    `CLAUDE.md` — refresh the e2e wall number. `docs/STATUS.md` — note stepLogic landed.
  - Side effects: CI (`ci.yml`) shards inherit the faster specs — confirm shard balance still even.
  - Done when: before/after e2e wall recorded; green on two cold runs; timeouts right-sized; the
    `step`-vs-`stepLogic` rule is documented where test-authors will see it.

## Steps — Phase 2b (OPT-IN — do NOT start until the Finding-1 gate is discharged)

> **Gate:** execute-plan should **stop after Step 2** and confirm with the user that a concrete
> CI-wall-blocking-work instance has been recorded in "Why now / the real gate" above. Without it,
> these steps are premature (critique Finding 1). If proceeding, prefer **split over delete** throughout.

- [ ] **Step 3: Establish the Node manager-tick pattern with `WaveDirector`** `[delegate]`
  - Add `src/scenes/world/__tests__/waveDirector.test.ts` mirroring `monsterAI.test.ts`: `WaveDirector`
    with a `{ events: new EventEmitter() }` scene stub + a `WaveDirectorDeps` of fakes; cover the wave
    **pacing** slice (no day spawns, paced interval, first-tick reconcile, escalation, force-wave). Does
    not delete anything — proves the Node twin exists (the Step 6 gate input).
  - Done when: `npx vitest run waveDirector` green in plain Node; covered behaviours listed.

- [ ] **Step 4: Audit & coverage-map all 36 specs — the hard gate** `[inline]`
  - Append a `## Coverage map` table here tagging every spec: **delete** (truly pure — needs a named
    green Node test first), **convert-to-`stepLogic`** (done for the Step-1 set; tag the rest),
    **split** (pure state → Node + trimmed browser core), **keep** (`refactor-tripwire`, genuine
    render/pointer). Apply the decisions: **`zoom` → split** (keep the `zoom:changed`/camera wiring
    assertion; move pure clamp/round to a Tier-1 test), `inspect` → split. For each, flag share-boot
    safety (pure world-logic = yes; capture/camera/HUD = no).
  - Done when: all 36 specs have a disposition; every **delete** names the pre-existing green Node test;
    share-boot-safe vs per-test-boot is marked.

- [ ] **Step 5: Split the mixed specs** `[delegate]` (parallel: A)
  - For each **split**-tagged spec (`boar`, `glow`, `queue`, `combat`, `monster`, `pathing-repro`,
    `wall-enemy-attack`, `zoom`, `inspect`), move pure state/decision assertions to Node; keep a trimmed
    browser core for the genuine render/physics/pointer path. Leave `refactor-tripwire` untouched.
    Separate files → one parallel batch of delegated sub-agents (write-disjoint); each gets its
    coverage-map row + Node-twin location.
  - Done when: each split spec's pure assertions live in green Node tests; its browser core is minimal
    and green (`retries: 0`).

- [ ] **Step 6: Delete ONLY the Node-proven-pure specs** `[inline]`
  - For each remaining **delete**-tagged spec, first confirm the named Node test is green, then delete
    the browser spec (or its pure slice). Candidates limited to genuinely pure ones (`mode`,
    `weapon-reach-arc`, the `wave` pacing-slice covered by Step 3). **Do not delete `zoom`** (split in
    Step 5). Update `tests/e2e/scenarios.ts` if a fixture is now unused.
  - Done when: each deletion is backed by a green Node test named in the map; unit + e2e still green.

- [ ] **Step 7: Boot-once-per-file for share-boot-safe specs + a per-test reset shim** `[inline]`
  - For coverage-map share-boot-safe specs, introduce `test.describe.serial` + `beforeAll(startGame)`,
    resetting per test via `applyScenario` plus a **reset shim** in `harness.ts` (or a
    `__test.resetForNextTest()` seam) clearing the accumulators `resetWorld` misses: `game.__captured`
    (re-zero, don't re-register listeners), camera zoom/scroll/follow, `eatReadyAt`, **`TestApi.testClock`**,
    **`SurvivalClock.progressElapsed`**, and the RAF-loop state left by stepping (Finding 4). Leave
    capture/camera/HUD specs on per-test boot.
  - Side effects: highest bleed risk — validate each shared spec in isolation AND in-file order and diff;
    if a spec flakes only when shared, revert it to per-test boot and note why. This isolation-diff is the
    net that catches any accumulator not enumerated above.
  - Done when: converted files boot once, pass two cold runs identically to per-test boot, boot-count
    drop reflected in wall time, no bleed.

- [ ] **Step 8: Phase-2b re-time + docs** `[inline]`
  - Re-time (twice cold, flake=0), right-size any remaining timeouts, confirm CI shard balance. Docs:
    finalise `docs/testing.md` (three-tier reality post-migration), `docs/STATUS.md`, `docs/DECISIONS.md`
    (note the re-tier). Set this plan `> Status: in review` at final review.
  - Done when: before/after wall recorded across the whole re-tier; green on two cold runs; docs match reality.

## Out of scope

- Extracting the GameScene task executor / Arcade pathfinding / structure tick into Node-pure modules
  (would let scene-coupled specs migrate fully instead of `stepLogic`) — deferred, as in plan 044.
- `Phaser.HEADLESS` build (rejected in plan 044 — RenderTexture/glow/HitFlash PostFX assume live GL).
- Making deploy hard-depend on CI (`needs: [ci]`) — stays non-blocking + notify.
- New gameplay coverage beyond what exists — this is a re-tier, not a coverage push.
- Switching test runners — Vitest + Playwright stay.
- Lever A (already shipped): verify-with-one-spec guidance in the docs + `execute-plan` skill.

## Critique

> Independent fresh-eyes review (uncontaminated sub-agent). **The committed/opt-in restructure above and
> the zoom-split + reset-list fixes were made in response to it.**

**Verdict: Technically accurate and well-gated, but strategically premature — an 8-step re-tier (with
spec deletion + a shared-boot refactor) to shave a CI wall that is already off the human critical path,
with no recorded evidence the gate it depends on is satisfied. Ship Step 1 (+re-time) at most until that
evidence exists.**

|#|Finding|Lens|Severity|Suggested action|Resolution|
|-|-|-|-|-|-|
|1|Optimizes a CI wall already off the human loop; gate demands *impact* evidence, plan gave only a wall-time number.|Roadmap / gate|High|Don't execute past Step 1 (+re-time) until "CI e2e blocks X" is recorded.|Restructured: Steps 1–2 committed, 3–8 opt-in behind the recorded-impact gate.|
|2|Two stepping modes + reset shim = permanent maintenance surface for a solo dev.|Operational|Medium|Minimal seam; document step-vs-stepLogic prominently.|Step 2 docs task added; seam kept minimal.|
|3|`zoom` delete→Tier-1 contradicts the plan's own don't-delete-wiring rule.|Reversibility|Medium|Reclassify `zoom` as split.|Done — `zoom` now split (Steps 4–5), explicitly not deleted (Step 6).|
|4|Reset list omits `TestApi.testClock` + `SurvivalClock.progressElapsed`.|Gaps|Medium|Enumerate all accumulators.|Both added to the Step 7 shim + Context.|
|5|Step 1 render-skip mechanism unverified.|Executability|Medium|Spike it first.|Step 1 now spikes the mechanism before adopting.|
|6|Cheaper stepLogic-only path buried as a fallback.|Alternatives|Low|Surface it as the default.|It is now the committed default; 3–8 are opt-in.|
|7|Stale `UIScene`/`src/ui` references linger.|Consistency|Low|Keep DOM/HUD framing.|Plan uses DOM/HUD/Zustand framing only.|
|8|Deletion gate is discipline-only; marginal reward for one-way risk.|Reversibility|Low|Bias toward split over delete.|Deletion isolated to Step 6, candidates minimised, split preferred.|
