# Hunger Live

> Status: deployed

## Summary

Roadmap **Step 4 — "Hunger live"**: turn the already-built hunger system from a cosmetic drain into a
real day-long survival pressure. The whole system (drain math, starve→HP cascade, eating, HUD bar +
starving vignette, death→restart flow) already exists and is wired; it is only **non-lethal and
mis-tuned** because the start map (`the-moon`) historically had no food. This step is **tuning + one
flag flip**, not new machinery: retune the hunger drain for the 15-min day/night cycle, keep the
existing starve→HP cascade ratio, then (late, once food is on the map) flip `HUNGER_LETHAL` to `true`
so hunger can actually kill. Done when ignoring food across a day meaningfully threatens you and eating
relieves it.

## Context & decisions

**System map (all confirmed in-repo):**
- Config: `src/config.ts` — hunger block lines 373–399. `HUNGER_MAX = 100`, `HUNGER_DRAIN_PER_SEC = 0.4`
  (empties a full bar in ~250s — the value to retune), `STARVE_DAMAGE = 1`, `STARVE_DAMAGE_INTERVAL_MS = 2_000`
  (1 HP / 2s), `HUNGER_LETHAL = false` (line 399 — the flag to flip). Day/night: `DAY_MS = 660_000` (11 min),
  `NIGHT_MS = 240_000` (4 min); full cycle **900_000 ms (15 min)** via `systems/daynight.ts` `cycleLengthMs()`.
- Pure math: `src/systems/needs.ts` — `drainHunger`/`feed`/`isStarving` (unchanged; Tier-1 tested in
  `src/systems/__tests__/needs.test.ts`).
- Owning manager: `src/scenes/world/SurvivalClock.ts` — `tick(delta)` drains hunger + emits `hunger:changed`,
  accumulates `starveElapsed`, and at `hunger <= 0` calls `deps.damagePlayer(STARVE_DAMAGE)` **only when
  `HUNGER_LETHAL`** (the single flag check, line ~193). `eat(itemId)` (line ~274) is already wired via the
  `needs:eat` event. **No logic change needed here** — flipping the flag is the entire behavioural change;
  starve damage already routes `damagePlayer → killPlayer → scene.restart` (GameScene lines 1344 / 1476),
  and restart reconstructs `SurvivalClock` fresh (hunger back to full).
- Food: `src/data/items.ts:11` `berries` (`nutrition: 25`); `src/data/maps/nodes.json` `berryBush` node
  (`yieldItemId: berries`, `yieldPerHit: 2`, `regrowMs: 300000`). Eating in-scene is via the Wellbeing
  (STATUS) panel → emits `needs:eat` (`UIScene.ts` ~1002); scenario tests trigger it with
  `emit(page, 'needs:eat', { itemId: 'berries' })`.
- HUD: `UIScene.ts` FOOD bar + Wellbeing meter + starving vignette, all driven by `updateHungerBar` off
  `hunger:changed`. **No HUD work required** — the red/vignette starvation feedback already renders; the
  flip just makes it mean something.

**Owner decisions (this planning session):**
1. **Drain pace = "one food run per day"** — a full bar should empty over roughly one **day** (~11 min /
   660s). Target `HUNGER_DRAIN_PER_SEC ≈ 0.15` (100 / 660 ≈ 0.151 → ~667s to empty). Starting value to
   confirm by feel; the config comment already says "retune by feel".
   - **Arithmetic note (be precise in prose):** at 0.15/s a full bar empties at ~667s, i.e. **right as
     night falls** (`DAY_MS = 660s`) — it bottoms out *into early night*, not "by dusk". So a fully
     neglected day leaves you entering the wave starving. With ~10 HP at the unchanged 1 HP/2s cascade
     that's death ~27s into night 1 if you never ate all day.
   - **Owner call (this session): keep 0.15 as-is** — max pressure, eating must become habitual. The
     dusk-empty-into-wave stack is a **confirm-by-feel** item for execution (finding #2): verify a
     neglected day → wave night is *clawback-able* (eat to exit starving — 1 berry = +25, so ~4 berries
     refills the 100-pt bar), not an unrecoverable death spiral. If it spirals in play, soften the drain
     (e.g. ~0.13/s → ~770s, ~100s daytime buffer) as a feel pass — do not change the cascade.
2. **Starve cascade = keep the current ratio** — do **not** touch `STARVE_DAMAGE` / `STARVE_DAMAGE_INTERVAL_MS`.
   Only the hunger *drain* is retuned. (Observation, not an action: player has ~10 HP — `death.spec` asserts
   post-restart `playerHp === 10` — so at the unchanged 1 HP / 2s the run from empty→death is ~20s, i.e. once
   the bar bottoms out death comes fast. Left as-is per this decision; flag it for a later feel pass, don't
   change it now.)
3. **`HUNGER_LETHAL` = dev toggle, defaulted true at the end** — keep it as the plain, easily-flippable
   `config.ts` const (a one-line `false` for playtesting), reframe its comment from "TEMP stopgap" to a
   dev toggle, and set the shipped default to `true` as the **final** step (flip lethal *late*).

**Precondition owned by Matt (out of this plan's code scope):** berry bushes get placed on the `the-moon`
start map via the Map Builder editor (which autocommits to `master`). Lethal hunger with no food on the
loaded map = guaranteed starve-out, so **the flag-flip step (Step 3) is gated on food actually being present
on `the-moon`** — the executor must verify this, not assume it. **As of writing `the-moon.map.json` carries
NO `berryBush` node** (only trees + rocks), so the gate is live and real today.

**Branch/deploy hazard (finding #3 — the one trunk-safety risk).** The branch split is asymmetric: map JSON
lands on `master` via the editor, while this plan's code/tuning lands on the feature branch — and **trunk
auto-deploys**. So verifying food at *flip-time on the feature branch* is not enough: if the `HUNGER_LETHAL=true`
flip merges to trunk **before** the berry bushes have reached trunk, the live build is a guaranteed
starve-out. **The food-present check must be re-verified against trunk at MERGE**, not only when the flag is
flipped locally (see Step 3).

**Known-red test that this step turns green:** `tests/e2e/survival-hunger.spec.ts` → "a starving player
loses HP" currently **fails by design** while `HUNGER_LETHAL=false` (tracked in plans 014 & 018; e2e is
**not** gated on deploy, so trunk stays shippable). Flipping the flag in Step 3 makes it pass — a built-in
acceptance signal, not a new test to write.

## Steps

- [x] **Step 1: Retune the hunger drain for the 15-min cycle** `[inline]`
  - Outcome: `src/config.ts` — `HUNGER_DRAIN_PER_SEC` 0.4 → 0.15; block comment above rewritten
    (~667s ≈ one day, feel-tunable toward ~0.13/s). Stale rate comment in `tests/e2e/survival-hunger.spec.ts`
    fixed. Verified `needs.test.ts` passes the rate in explicitly (no hard-coded 0.4). `npm run test` green
    (838 unit tests); typecheck clean.
  - In `src/config.ts`, change `HUNGER_DRAIN_PER_SEC` from `0.4` to **`0.15`** (empties a full 100-point bar
    in ~667s ≈ one 660s day — the "one food run per day" target). Leave `HUNGER_MAX`, `STARVE_DAMAGE`,
    `STARVE_DAMAGE_INTERVAL_MS` untouched (owner decision 2).
  - Update the stale block comment above (lines ~373–379): the "~250s" / "old ~210s cycle" text is now wrong.
    Restate: at 0.15/s a full bar lasts ~667s ≈ one day, so a day of neglect leaves you starving by dusk;
    note the value is feel-tunable. Keep the pointer that flipping `HUNGER_LETHAL` is the remaining Step-4 work.
  - Fix the stale rate comment in `tests/e2e/survival-hunger.spec.ts:16` (`// 0.4/s × 3s ≈ 1.2 drained`) to
    match the new rate; the assertion (`after.hunger < before.hunger`) still holds and needs no change.
  - Side effects: `SurvivalClock.tick` reads the const directly — no other wiring. Confirm `needs.test.ts`
    (Tier-1) doesn't hard-code `0.4` (it passes the rate in explicitly, so it shouldn't — verify).
  - Docs: none beyond the config comment (STATUS.md is updated in Step 3 with the whole change).
  - Done when: `HUNGER_DRAIN_PER_SEC === 0.15`; `npm run test` (unit) green; `npm run e2e -- survival-hunger`
    "hunger drains over time" still passes.

- [x] **Step 2: Add a Tier-2 "full day of neglect empties the bar" test** `[inline]`
  - Outcome: **Deviation — the planned `step(page, DAY_MS + 10_000)` is infeasible in this harness.**
    `__test.step(ms)` runs `ms/(1000/60)` full game-loop iterations synchronously over the large
    the-moon scene (~25ms/slice), so stepping a whole day (~40k slices) blows the 30s Playwright
    timeout — the passing specs only step ~150–360 slices (a few seconds of game time). So, like
    `survival-daynight.spec.ts`, the retune is validated by *rate* over a short window instead of by
    stepping a literal day: new test "the retuned drain matches ~0.15/s (a full bar ≈ one day)" seeds
    a full bar, steps 6s, asserts ~0.9 drained (excludes the old 0.4/s ≈ 2.4) — from which "empties in
    ~667s ≈ DAY_MS" follows arithmetically. `tests/e2e/survival-hunger.spec.ts`. Passes.
  - In `tests/e2e/survival-hunger.spec.ts`, add a flag-independent test that validates the retune target:
    seed `applyScenario(page, { hunger: HUNGER_MAX, clockMs: 0 /* day start */ })`, then `step` a **full day
    plus a small margin** — `step(page, DAY_MS + 10_000)` — and assert the bar is near-empty:
    `expect(after.hunger).toBeLessThan(5)`. **Do NOT** use `toBeLessThanOrEqual(1)` or frame it as "reached 0 /
    isStarving" (finding #1): at 0.15/s over exactly `DAY_MS` (660s) drain is 99.0 → hunger `1.0`, which sits
    on the float boundary and is **not** starving (`isStarving` is `hunger <= 0`, `needs.ts`). Stepping past
    `DAY_MS` and asserting `< 5` clears the boundary and states the real claim: a full bar no longer survives a
    day untouched. Do **not** assert HP loss here (the flag is still false at this point; the HP-cascade
    assertion is the existing known-red test, un-redded in Step 3). Import `HUNGER_MAX` and `DAY_MS` from
    `src/config`; mirror the `clockMs`/`step` pattern in `tests/e2e/survival-daynight.spec.ts` and the
    seed/assert shape already in this file.
  - Side effects: none — additive test only.
  - Docs: none.
  - Done when: the new test passes with the Step-1 drain; existing hunger/daynight/forage specs still green.

- [x] **Step 3: Flip `HUNGER_LETHAL` on (dev toggle), verify the cascade, update docs** `[inline]`
  - Outcome: **Food gate satisfied** — 5 `berryBush` nodes added to `the-moon.map.json` near the camp
    tree/rock cluster (cols 111–114, rows 140–142) in a prior commit on THIS branch, so the food and the
    flag-flip travel together (the branch-split trunk hazard is moot — no separate editor→master path).
    `src/config.ts` `HUNGER_LETHAL` false → true, comment reframed to a dev toggle. Cascade tests added
    to `survival-hunger.spec.ts` (both feasible within the step budget — see Step 2): "neglecting food
    drains the bar to zero and then costs HP" (drain→starve→HP from a near-empty seed) and "eating a
    berry relieves hunger and keeps the player off the starve cascade"; the previously known-red "a
    starving player loses HP" now passes. Dropped the doubly-stale `GameScene.ts:360` comment. Docs:
    `STATUS.md` (hunger live), `ROADMAP.md` Step 4 ✅ + DELIVERED note + "IN the loop" line, `CLAUDE.md`
    Next-line marker ✅. Boot canary green (also hardened `scripts/smoke.mjs` to retry the MainMenu tap —
    a pre-existing single-tap race, unrelated). Also fixed a pre-existing red `death.spec.ts` (stale
    `MAP_WIDTH/2` spawn assertion → `SPAWN_TILE`). Full `npm run e2e` + `npm run test` + build green.
  - **Gate first (twice — finding #3):** confirm the loaded start map (`START_MAP_ID = 'the-moon'`) actually
    carries `berryBush` node(s) — inspect `src/data/maps/the-moon.map.json` for `kind: "node"` entries
    referencing `berryBush` (Matt places these via the editor; as of planning there are **none**). (1) Verify
    before flipping locally, and (2) **re-verify against `master`/trunk at MERGE**, because map JSON reaches
    trunk via the editor autocommit on a different path than this branch and **trunk auto-deploys** — a flag
    that merges ahead of the berries ships an unwinnable starve-out. If food is not present in either check,
    stop and report — do not flip / do not merge the flip.
  - In `src/config.ts`: set `HUNGER_LETHAL = true`. Reframe its comment (lines ~395–398) from "TEMP stopgap …
    keep non-lethal until authored food lands" to a **dev toggle**: e.g. "Dev toggle — starvation reduces HP
    only when true. Default on for the MVP survival loop; set `false` to disable starvation death during
    playtesting." Keep it a plain top-level `export const` (owner decision 3 — it stays a one-line flip).
  - Add the roadmap's acceptance test(s) to `tests/e2e/survival-hunger.spec.ts` now the flag is live — the
    "day with/without eating" cascade:
    - *Without eating:* seed `{ hunger: HUNGER_MAX, clockMs: 0 }`, then step **past empty plus a starve
      interval** — the bar only reaches 0 at ~667s, so `step(page, DAY_MS + 15_000)` (≈675s: empty + a couple
      of 2s starve ticks) — and assert `playerHp` dropped below its start (cascade fired). (Do **not** use
      "a full day plus one starve interval" = ~662s — at 0.15/s that's hunger ~0.7, still fed, no damage.) The
      existing "a starving player loses HP" test already covers the empty-start case and now goes green — keep it.
    - *With eating:* mirror `tests/e2e/survival-forage.spec.ts` — forage a seeded bush for berries (or seed a
      berry supply), let hunger fall, `emit(page, 'needs:eat', { itemId: 'berries' })`, assert hunger rises and
      the player does **not** die across the same span. Proves "eating relieves it."
  - Side effects: `damagePlayer → killPlayer → scene.restart` now reachable via starvation — the existing
    `death.spec.ts` restart pattern covers the reset (hunger back to full on restart); no new death plumbing.
    Sanity-check the boot canary (`scripts/smoke.mjs`) still boots (it doesn't run long enough to starve).
  - Docs (terse, high-signal):
    - `docs/STATUS.md:444` — change "hunger is non-lethal (`HUNGER_LETHAL=false`)…" to: hunger is **live** —
      drain retuned to ~0.15/s (full bar ≈ one day), `HUNGER_LETHAL=true` (dev toggle), starve→HP cascade
      unchanged. Note it under the survival slice as the roadmap Step-4 landing.
    - `docs/ROADMAP.md` Step 4 — mark ✅ / add a "Progress — DELIVERED" note like the other steps (drain 0.4→0.15,
      flag flipped as a dev toggle, cascade ratio unchanged, food on `the-moon` via editor); flip the Status/Next
      line's `→ hunger →` marker to ✅ in `CLAUDE.md` **Status** block ("✅ trap → ✅ hunger → NPC").
    - `src/scenes/GameScene.ts:360` — the inline "hunger stays non-lethal via HUNGER_LETHAL" comment is now
      **doubly stale** (it also references `test.map.json`, not the loaded `the-moon`); just **drop it**.
  - Done when: `npm run test` + full `npm run e2e` green (the previously-red "a starving player loses HP" now
    passes; new with/without-eating tests pass); `HUNGER_LETHAL === true`; docs above updated. Manually
    verifiable in-game: boot, ignore food for a day → starving vignette → HP drain → death→restart; foraging
    and eating berries recovers the bar.

## Out of scope

- **Placing berry bushes on `the-moon`** — Matt authors these in the Map Builder editor (autocommits to
  `master`). This plan only *verifies* they exist before flipping lethal.
- **Changing the starve→HP cascade** (`STARVE_DAMAGE` / interval) — explicitly kept at the current ratio;
  the ~20s empty→death sharpness is noted for a possible later feel pass, not changed here.
- **New eat UX** (hotbar/quick-eat keypress) — eating stays via the Wellbeing panel / `needs:eat` event.
- **HUD/vignette work** — the starving feedback already renders.
- **Any NPC work** — that's roadmap Step 5, the next plan.

## Critique

Fresh-eyes review (independent sub-agent, grounded against source). **Verdict:** a tightly-scoped,
accurately-grounded plan that fits roadmap Step 4 cleanly — proceed; two Medium executability/feel issues +
the merge-time food gate, no High blockers. All load-bearing claims verified against source (config values,
the single `HUNGER_LETHAL` guard, the known-red test, harness seed fields, berries nutrition, ~10 HP → ~20s
empty→death). Findings #1, #3, #4, #5 are folded into the steps above; #2 is kept as a confirm-by-feel item
(owner chose to keep the ~0.15 drain as-is).

|#|Finding|Lens|Severity|Resolution|
|-|-------|----|--------|----------|
|1|Step-2 test knife-edge: 0.15/s over `DAY_MS` drains exactly 99 → hunger `1.0`, on the float boundary, and not `isStarving` (`hunger<=0`)|Executability|Medium|✅ Folded in: step `DAY_MS + 10_000`, assert `< 5`, dropped the "reached 0 / isStarving" framing (also fixed the Step-3 "without eating" step duration)|
|2|~0.15/s empties the bar right as night falls; a neglected day dies ~27s into the wave with ~0 daytime buffer|Gaps/feel + roadmap|Medium|⏳ Owner keeps 0.15 as-is; **confirm-by-feel** during execution that dusk-empty + wave is clawback-able, else soften to ~0.13/s (cascade untouched)|
|3|Food gate checked at flip-time on the feature branch, but map JSON autocommits to `master` and trunk auto-deploys — flag merging ahead of berries ships an unwinnable starve-out|Reversibility/sequencing|Medium|✅ Folded in: gate now re-verified against trunk **at merge**, not only at flip; noted `the-moon` carries 0 `berryBush` today|
|4|"One food run per day" is loose — 1 berry = +25, so ~4 berries refill the 100-pt bar|Right-sizing|Low|✅ Noted in decisions; confirm-by-feel covers it|
|5|`GameScene:360` comment is doubly stale (also references `test.map.json`)|Consistency|Low|✅ Folded in: Step 3 now says drop it outright|
