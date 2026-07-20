# The Night Wave + Loop-Close

> Status: planned — run /execute-plan to begin.

## Summary

Build the MVP's **first playable loop** (roadmap Step 2): night falls → a paced wave of skeletons
comes from the map edge → they path to and **attack the campfire (the fire-heart) and the player** →
you defend to dawn → **day N+1** arrives a little harder. **Lose** = the player dies. **The fire is NOT
a loss condition** (owner decision, 2026-07-20 — see decisions #1/#2): a fire knocked out (by mob
attacks draining its fuel, or plain neglect) just **loses its light → darkness floods in** — a dire,
recoverable state you claw back by relighting, not a game-over. This is the riskiest unbuilt piece and
the earliest "feel the loop" milestone. It reuses the existing seams almost entirely — the day/night
clock + `time:changed` event, `CampfireManager` + `lightSources()`, the `MonsterCharacter`/`EnemyManager`
FSM + `addEnemy`, and the existing death→`scene.restart()` path — and adds a **`WaveDirector`** scheduler
over them plus one genuinely new piece: **objective-target enemy AI** (path to & attack the fire, not
just the player). The "attackable fire" is just an `attackFire`→`damageFire` seam that drains the
**existing fuel meter** — no new integrity meter, no loss funnel (decision #2).

**Milestones:** **A — Fire-heart** (Steps 1–2): the fire becomes an attackable target whose light can be
knocked out (drain its fuel to 0 → it douses → dark; feed wood → relit) — NOT a loss — with retuned
fuel; testable in isolation via a direct `damageFire` test seam, no wave needed.
**B — The wave loop** (Steps 3–5): night-triggered paced spawns + objective AI + loop-close/escalation —
the playable loop. **C — Surface & harness** (Steps 6–7): dev force-wave hook, HUD, scenario API + tests.
The fire-heart **light-radius claim** (lit radius replaces the base rect for placement) is **peeled to
plan 039** as a non-blocking follow-up — it's orthogonal to the defend loop and carries a trickier design
change (see critique #3); 038 keeps using the existing base rect for `baseOnly` placement.

## Context & decisions

**Direction:** `docs/ROADMAP.md` Step 2 (operational spec) + `docs/GAME-DESIGN.md` "The night wave —
shape" (`:220-250`) and "Base claim — the campfire heart" (`:344-372`, settled `docs/decisions/gameplay.md:175-190`,
[DECIDED] 2026-07-19). GAME-DESIGN closing line (`:249-250`): *"the same FSM + spawn system, spawning
attackers-from-treeline on a paced schedule tied to the night phase, with the existing radius aggro
doing the roaming-pull for free."* — i.e. the wave is **a paced scheduler over existing spawn/AI**, not
new combat.

**Locked decisions (planning defaults — recorded for execution):**

1. **No fire loss — REVERSED 2026-07-20 (owner).** *Was:* "fire loss = instant." *Now:* the fire being
   knocked out is **NOT a loss** — only **player death** loses. A knocked-out fire floods darkness (a
   dire, recoverable state); **claw-back by relighting IS the MVP behavior** (feed wood → relit). This
   flips the roadmap's "lean instant-loss" and moves claw-back from Out-of-scope to in-scope. The
   knock-out mechanic still matters as *pressure* (fighting the wave in the dark), just not a fail state.
2. **No separate integrity meter — REVERSED 2026-07-20 (owner), follows from #1.** *Was:* a distinct
   `integrity` meter as the attacked-out loss route. *Now:* with no loss route, a second meter has no
   purpose. **Mob attacks drain the fire's existing `fuel`** (via `damageFire`) — the same meter natural
   burn drains and feeding wood restores — so an attacked fire dims (light radius lerps with fuel) and
   goes out exactly like a neglected one, and relighting recovers it. No `integrity` field on
   `CampfireUnit`; the inert `maxHp:20` stays Inspect-only. `damageFire` clamps fuel ≥0 and douses on a
   zero-crossing (same path as burn-out) so the visual is coherent by construction.
2b. **Fire-out darkness stays full — owner decision 2026-07-20.** No ambient/vision floor when the light
   is out; losing the light is *meant* to be dire. **No change to the night overlay / `VisionController`**
   — leave rendering as-is (this plan touches no vision code).
3. **Spawn source = code-side edge rule** (spawn along the map perimeter, biased to a direction — the
   "wood-facing" edge), no map authoring. Authored treeline markers are post-MVP (no marker/point entity
   exists today — `MapObject` is only node/decor/portal; zones are unused and the-moon has none).
4. **Pacing = data-driven trickle→push→lull** over normalized night progress (`tNorm` from
   `time:changed`), numbers placeholder/tunable. Escalation = a small **per-night** bump (count +
   composition), data-driven, progress-keyed (`gameplay.md:192`).
5. **Objective-target AI is built minimally** (nearest-lit-hearth pos/id + an `attackFire` callback) —
   just enough for the wave, its first consumer. The deferred plan 037 (enemy-attacks-wall) will refactor
   the seam to its needs rather than this plan pre-designing them (critique #4). Budgeted as a **new FSM
   state**, not a target swap.
6. **Fuel retune, not cycle retune.** The cycle is already 15 min (`DAY_MS 660_000` + `NIGHT_MS 240_000`,
   `config.ts:336-338`); only the **campfire fuel** constants are stale (`config.ts:386-405`). Retune
   those.
7. **Scope:** the wave loop is one plan; the base-claim placement swap is **peeled to plan 039**
   (non-blocking) per critique #3.

**Key files & patterns to mirror (from repo sweep):**

- **Clock + night hook:** `src/systems/daynight.ts` — `type DayPhase = 'day'|'night'` (`:14`, no
  dawn/dusk enum), `phaseAt` (`:22`), `cycleLengthMs` (`:17`), `dayCountForTotal` (`:52`).
  `src/scenes/world/SurvivalClock.ts` `tick` (`:139-157`) emits **`game.events.emit('time:changed',
  { phase, dayCount, cycleMs, tNorm })` only on a phase/day *transition*** (`:146-156`) + sets `registry`
  `dayPhase`/`dayCount`. **⚠ `setDayPhase`/`setClockMs` seeds do NOT necessarily emit `time:changed`** —
  so the WaveDirector must **reconcile the current phase on its first tick**, not rely on the event alone
  (critique #1). `tNorm` gives night-progress for the pacing beats. (UIScene consumes `time:changed` at
  `:557`,`:975`; `GameScene.updateCombatActive` polls `registry` `dayPhase` at `:1182`.)
- **Campfire:** `src/scenes/world/CampfireManager.ts` — `materialise`/`tick(delta)` (`:144`),
  `lightSources()` (`:233`), `inLight(x,y)` (`:248`), `feedOne`/`feedAt`, `campfireById` (`:267`,
  "tolerates a fire destroyed mid-order"). `CampfireUnit` tracks `fuel`/`lit`, not hp. Fuel consts + the
  stale-tuning comment: `config.ts:386-405` (`CAMPFIRE_FUEL_MAX=120`, `_BURN_PER_SEC=1`, `_PER_WOOD=30`,
  `_FEED_INTERVAL_MS=1000`, `_LIGHT_MIN_FRAC=0.4`). Fire `maxHp:20` inert (`buildables.ts:27`, comment `:8-9`).
- **Loss/restart (exists — reuse):** `GameScene.damagePlayer` (`:1003-1011`) → `killPlayer()`
  (`:1124-1131`) logs `"player down — restarting"` then `scene.restart()` after a death hold; `update()`
  freezes on `playerChar.dying` (`:648-651`). **New:** a `loseGame(reason)` both `killPlayer` and a
  fire-out check funnel into. No game-over screen — `scene.restart()` rebuilds via `create()`→`buildWorld()`.
- **Vision (mostly free):** night = `SurvivalClock.nightOverlay` (`:93-118`) with an inverted mask
  punched per lit fire (redrawn each tick, `:220-224`); fog = `fx/VisionController.ts`. Both read
  `lightSources()` per-frame, so **a knocked-out fire → its disc vanishes → darkness re-floods that frame**
  (night mask re-closes; fog reveal is one-way). Enemy hide-in-dark gating is NOT built (deferred) — out
  of scope here.
- **Enemy spawn + AI:** `EnemyManager.spawnEnemies()` (`:102`, hard-codes one `kidZombie` — the
  skeleton-art enemy) called at `GameScene.ts:357`; the spawn primitive is `addEnemy(id,col,row,opts)`
  (`:106`). AI = pure FSM `stepMonster` (`src/systems/monsterAI.ts`), chase targets **player only**;
  `MonsterTickEnv` (`EnemyManager.ts:147`) carries only player targets + `damagePlayer`. Telegraphed
  wind-up/strike block (`MonsterCharacter.update:235,249-265`) reusable. Radius aggro pulls mobs to the
  player "for free" when near. Enemy ids in `src/data/enemies.ts`; monster weapons `src/data/weapons.ts`.
- **World-manager convention (for `WaveDirector`):** `src/scenes/world/*` — `constructor(scene, deps)`
  with `deps` a narrow closure interface (never manager↔manager direct; scene mediates — see
  `EnemyManagerDeps`/`CampfireManagerDeps`/`SurvivalClockDeps`); construct **side-effect-free** then a
  separate begin/hook; per-frame `tick(delta)` from `GameScene.update` **above** the no-action early-return
  (`:655,:659`); `reset()` (runtime, may destroy sprites) vs `destroy()` (SHUTDOWN, drops refs only, clears
  `time` events — never pokes sprites), wired via `scene.events.once(SHUTDOWN,…)`. Construct in
  `buildWorld()` **after** SurvivalClock (`:479`). Dev hooks in `wireBus()` (`:502-542`, mirror
  `debug:toggleTime` at `:508`).
- **HUD:** `UIScene.ts` — passive top-centre `timeText` `Day N [phase]` (`:313`, synced on `time:changed`
  `:975`); dev `GO NIGHT/GO DAY` button emits `debug:toggleTime` → `SurvivalClock.toggleDayNight` (extend
  to also force a wave). Fire-**fuel** bar mirrors the HP/hunger bar pattern (no integrity meter, decision
  #2); a night/wave indicator slots beside `timeText`.
- **Scenario/test API:** `testApi.ts` + `GameScene` `TestApi` (`:552-638`) — `setClockMs`/`setDayPhase`/
  `setDayCount`, `addEnemy`, `step(ms)` (deterministic 1/60s slices). **`DebugState` tripwire**
  (`testApi.ts:35-81`, serializer `:394`, `refactor-tripwire.spec.ts` golden): new fields **appended at
  END**, edited across `testApi.ts` + `tests/e2e/harness.ts` + the golden together. Three tiers: unit /
  scenario / boot canary (`docs/testing.md`).

## Steps

- [x] **Step 1: Attackable fire (`damageFire` drains fuel) + test seam** `[inline]` — *rescoped
  2026-07-20 (owner): NO integrity meter, NO loss funnel — see decisions #1/#2.*
  - Outcome: added `CampfireManager.damageFire(id, amount)` (drains the existing `fuel`, douses on the
    zero-crossing exactly like burn-out — no new field, no `GameScene`/`entities/types.ts` change) +
    `TestApi.damageFire(index, amount)` wired through `GameScene.installTestApi`, `GameTestApi`
    (`testTypes.ts`), and the `harness.ts` wrapper. Purely additive — zero behaviour change to existing
    flows (there was never a fire-loss to remove). Docs flipped: `ROADMAP.md` (both the intro + Step 2
    bullet), `docs/decisions/gameplay.md`, `docs/STATUS.md` (new "Attackable fire" note). Tier-2 test
    added to `tests/e2e/campfire.spec.ts` (douse-without-loss → relight); no `DebugState`/tripwire touch.
    **Verified:** `typecheck` + `lint` clean; 813/813 unit tests pass; campfire e2e — my new test + the
    existing burn-out/relight test pass. **Pre-existing (NOT mine):** `campfire.spec.ts` "tryPlace ...
    base zone" fails on the clean tree too — a stale test using pre-`SPAWN_TILE`-move base-zone coords
    (plan 039 base-claim territory), unrelated to this step.
  - Add a `CampfireManager.damageFire(id, amount)` seam that drains the fire's **existing `fuel`** (clamped
    ≥0), then douses on a zero-crossing exactly like the per-frame burn (`if (c.lit && !isLit(c.fuel))
    this.douse(c)`) so an attacked-out fire and a burned-out fire are identical state. No new field on
    `CampfireUnit`; the inert `maxHp:20` stays Inspect-only. Relight is the **existing** feed-wood path
    (unchanged) — no new recovery logic. This is the mob→fire coupling Step 4's `attackFire` calls.
  - **No loss funnel.** Do NOT add `loseGame`, do NOT refactor `killPlayer`, do NOT add a per-tick
    fire-out check. Player death → `scene.restart()` stays exactly as-is (the only loss). The fire going
    dark is just darkness (rendering already re-floods the night mask when no light source remains — no
    change needed there; owner wants it fully dark, decision #2b).
  - **Test seam (here, not Step 7):** expose `damageFire(index, amount)` on the `__test` API (index-based,
    mirroring `feedCampfire(index)`) so the attackable fire is acceptance-testable *without* the wave AI.
    Damage numbers placeholder, tuned in Step 5.
  - Side effects: `CampfireManager` (the `damageFire` seam only — tick/reset/materialise unchanged, no
    integrity to init); `testApi.ts` (`TestApi.damageFire` + `TestApiDeps` if needed) + `harness.ts` +
    `testTypes.ts` `GameTestApi`. **No `DebugState` field** (fuel/lit already surfaced in
    `campfires[]`), so **no tripwire bump** this step. `GameScene`/`entities/types.ts` untouched.
  - Docs: `docs/STATUS.md`; flip the fire-loss lines in `docs/decisions/gameplay.md` + `docs/ROADMAP.md`
    Step 2 (fire out = dire darkness, not a loss — decisions #1/#2).
  - Done when: Tier-2 scenario — `__test.damageFire(0, N)` enough to drain a lit fire's fuel to 0 → it
    douses (`campfires[0].lit === false`, `inLight` false around it) and **no restart fires**; then
    `feedCampfire(0)` relights it. Existing `campfire.spec.ts` (burn-out → relight) stays green unchanged.
    **No wave/objective AI needed.**

- [ ] **Step 2: Retune campfire fuel for the 15-min cycle** `[delegate]`
  - Data-only: retune `CAMPFIRE_FUEL_MAX` / `CAMPFIRE_FUEL_BURN_PER_SEC` / `CAMPFIRE_FUEL_PER_WOOD` in
    `config.ts:386-405` so a fed fire comfortably survives a night with a couple of refuels (not ~13% of a
    cycle / ~7 refuels), per the stale-tuning comment there. Update that comment for the 15-min cycle + new
    intent. Leave exact feel-tuning flagged for Step 5.
  - Side effects: hunger drain carries the same stale comment (`config.ts:344-347`) but **`HUNGER_LETHAL`
    stays false** (roadmap Step 4) — do NOT flip hunger; only note it.
  - Docs: the config comment; `docs/STATUS.md` line.
  - Done when: `npm run build`/tests green; a fire with a normal fuel load stays `lit` across a night in a
    scenario (assert `lit` at representative `cycleMs` points).

- [ ] **Step 3: WaveDirector — night-triggered paced spawns from the edge (+ begin-wave seam)** `[inline]`
  - New `src/scenes/world/WaveDirector.ts` (world-manager convention: narrow `deps` closures —
    `spawnEnemy(id,col,row,opts)`→`enemyManager.addEnemy`, `dims()`, `enemies()`, `campfires()`/`lightSources()`,
    `dayContext()`; constructed after SurvivalClock; `tick(delta)` above the early-return; `reset()`/
    `destroy()` split; SHUTDOWN wiring). Begin/end a wave on `time:changed` (`phase==='night'` start,
    `phase==='day'` end — stop spawning, leftover mobs remain, "the lull is a trap"). **Also reconcile the
    current phase on the first tick** so a scenario seeded directly into night starts a wave without a
    transition event (critique #1).
  - **Begin-wave test/dev seam (here, not later):** expose `__test.beginWave()`/`forceWave` so the wave is
    deterministically startable in scenarios independent of clock edges.
  - **Spawn source:** a code-side **edge rule** — perimeter tiles of the loaded grid (`dims()`), biased to
    one direction (the "wood-facing" edge; sensible default constant + comment). Spawn `kidZombie`.
  - **Pacing:** a **data-driven** schedule expressing trickle→push→lull over night `tNorm` (placeholder
    numbers). Use a tick accumulator (the `chopElapsed` idiom, `GameScene.ts:932-938`) or `scene.time`
    events cleared in `destroy()`. Guard against spawning during the death freeze.
  - Side effects: `GameScene.buildWorld` construct + `update` tick + `wireBus` (subscribe/off);
    `EnemyManager` (`addEnemy`/`all()` suffice); `testApi.ts` (begin-wave seam).
  - Docs: `docs/STATUS.md` (WaveDirector); a `docs/CONVENTIONS.md` note only if it adds a new pattern.
  - Done when: Tier-2 scenario — via `__test.beginWave()` **or** by crossing the day→night boundary with
    `step`, skeletons appear from the biased edge on a paced cadence (assert perimeter spawn tiles +
    arrival spread over time); no spawns during day.

- [ ] **Step 4: Objective-target enemy AI (path to & attack the fire)** `[inline]`
  - Extend `MonsterTickEnv` (`EnemyManager.ts:147`) minimally: a **nearest-lit-hearth** target (pos/id) +
    an `attackFire(id, dmg)` callback mirroring `damagePlayer`. Keep it minimal — let plan 037 refactor
    later (critique #4).
  - Add a new FSM behaviour in `monsterAI.stepMonster` / `MonsterCharacter.update`: a wave mob's default
    objective is the **fire** — path toward the nearest lit hearth and, on contact, **reuse the telegraphed
    wind-up/strike block** to call `attackFire` (→ `damageFire`, Step 1). Existing **radius aggro to the
    player** still preempts (near the player it fights the player — the roaming-pull), then returns to the
    fire. Budget as a real new state, not a swap.
  - Wave-mobs opt in to the fire objective via a per-enemy property set by the WaveDirector spawn;
    dev-spawned/scenario enemies stay player-targeting as today.
  - Side effects: `EnemyManager.update` env; `monsterAI` FSM + tests (`src/systems/__tests__/monsterAI*`);
    `MonsterCharacter`; the fire's fuel (Step 1) becomes mob-drainable → its light can be knocked out.
  - Docs: `docs/STATUS.md`; note the objective-target seam is the one plan 037 will build on.
  - Done when: Tier-2 scenario — a wave skeleton with no player nearby paths to the fire and attacks it
    (its `fuel` drops, assertable via `campfires[]` after `step`, and it can be driven to douse → dark);
    a skeleton near the player instead engages the player.

- [ ] **Step 5: Loop-close + per-night escalation + tuning pass** `[inline]`
  - On `phase==='day'` with an incremented `dayCount` (night survived), the WaveDirector records it and
    **escalates the next wave** via a data-driven curve (count + composition — more skeletons, later nights
    add a boar). `dayCount` already increments in the clock; the director keys difficulty off it.
  - Tuning pass now that the loop runs: fire **fuel** drain (natural burn + `damageFire` from mob attacks,
    Step 1/4) vs wave DPS vs night length, plus the pacing numbers → a night is *winnable but tense* and
    keeping the fire lit is a real ask (letting it go dark should sting via the darkness, not end the run).
    Keep in data/config with comments; final numbers may be "by feel", but each has an acceptance anchor
    (e.g. "night 1 survivable with N refuels + M kills"; not a bare "feels right").
  - Side effects: WaveDirector state (survived-night counter, per-night config); `reset()` restores day-1
    baseline for scenarios.
  - Docs: `docs/STATUS.md`; `docs/ROADMAP.md` — Step 2 loop closes.
  - Done when: Tier-2 scenario — run a full night→dawn: player+fire survive → `dayCount` increments → the
    next night spawns more/tougher than the first (assert spawn count/composition delta across two nights).

- [ ] **Step 6: Dev force-wave hook + HUD (night/wave indicator + fire-fuel bar)** `[inline]`
  - Dev hook: `debug:forceWave` (wired in `wireBus`, mirror `debug:toggleTime` at `:508`) that jumps to
    night AND kicks off a wave immediately (reusing Step 3's begin-wave seam); surface it on/next to the
    existing `GO NIGHT` dev button.
  - HUD (`UIScene.ts`): a **fire-fuel bar** (the fire's light/life meter — mirror the HP/hunger bar
    pattern, synced on a new `fire:changed` event from CampfireManager, emitted when fuel changes — burn,
    feed, or `damageFire`) and a small **night/wave indicator** beside `timeText` (reuse the `time:changed`
    payload). Passive, additive. *(No integrity meter — the bar tracks `fuel`, decision #2.)*
  - Side effects: `GameScene.wireBus` + SHUTDOWN off; `CampfireManager` emits `fire:changed` on fuel
    change; `UIScene` new passive elements.
  - Docs: `docs/STATUS.md`; `docs/WORKFLOW.md` dev-hooks note if one exists (else skip).
  - Done when: the dev force-wave control starts a wave on demand in-game; the fire-fuel bar tracks burn +
    `damageFire` + feed; the night indicator shows during night.

- [ ] **Step 7: Scenario API surface, tests, tripwire & docs** `[inline]`
  - `testApi.ts`: consolidate the `__test` seams (`damageFire` from Step 1, `beginWave` from Step 3) and
    expose new `DebugState` fields (active-wave state, spawn count this night — **no `integrity` field**,
    decision #2; fuel/lit already surfaced in `campfires[]`) **appended at END** of the interface +
    serializer (`:394`); update `tests/e2e/harness.ts` + the `refactor-tripwire` golden together
    (intentional bump). Ensure `applyScenario` can seed a hearth + start a night deterministically.
  - Tests: Tier-1 pure tests for new pure logic (pacing-curve sampling, edge-tile selection, escalation
    curve); a Tier-2 spec for the roadmap acceptance test ("clock to night → assert edge
    spawns → step to dawn → assert survival + day increment"). Confirm `npm run smoke`.
  - Docs: `docs/ROADMAP.md` (Step 2 done); `docs/STATUS.md`; `docs/GAME-DESIGN.md`/`docs/DECISIONS.md`
    touch-ups if built behaviour refines the design; CLAUDE.md Status line.
  - Side effects: the tripwire golden is the main gotcha — bump it deliberately.
  - Done when: all three tiers green (unit + scenario + boot canary), tripwire passes against the updated
    golden, and the roadmap Step 2 acceptance scenario passes end-to-end.

## Out of scope

- **Fire-heart light-radius CLAIM** (lit radius replaces the base-placement rect) → **plan 039** (peeled
  per critique #3; non-blocking, orthogonal to the defend loop). 038 keeps the existing `BASE_ZONE` rect
  for `baseOnly` placement.
- **Defence structures** (plan 037 — destructible walls, gate, spike trap): deferred; they reuse Step 4's
  objective-target seam and are tuned against this live wave.
- **Multiple hearths / unioned claims, walls extending the claim, torches** — MVP has the single hearth.
- ~~**Claw-back / relight-to-recover** after the fire is out — instant-loss for MVP.~~ **NOW IN SCOPE**
  (decisions #1/#2 reversed 2026-07-20): the fire is not a loss condition; relighting a doused fire is
  the recovery, and it's just the existing feed-wood path.
- **Enemy hide-in-dark / fog aggro gating** (deferred from plan 012) — the wave doesn't need it.
- **Authored treeline / spawn-marker map entities** — code-side edge rule for MVP (decision #3).
- **Hunger going lethal** (roadmap Step 4) — `HUNGER_LETHAL` stays false; only the fuel comment is touched.
- **Game-over screen / run summary / MainMenu return** — reuse the existing `scene.restart()` death path.
- **New enemy types beyond skeleton (+ optional boar in later nights)** — richer roster is post-MVP.

## Critique

> Independent fresh-eyes review (critique-plan), 2026-07-20. **Applied** — findings #1–#5 folded into the
> steps/decisions above (test seams pulled into Steps 1 & 3; first-tick phase reconcile; claim peeled to
> plan 039; objective seam kept minimal; integrity-0 also douses). Recorded here for provenance.
>
> **⚠ Superseded in part (owner, 2026-07-20, at execution start):** decisions #1/#2 were reversed — the
> fire is **no longer a loss condition** and there is **no integrity meter** (`damageFire` drains fuel).
> This moots critique #5 (no two loss routes to keep symmetric) and softens #2 (Milestone A is now
> testable purely via the `damageFire`→fuel→douse seam, no loss to assert). The verdict's "integrity as a
> distinct meter / instant-loss" core bets below are historical — see the updated Summary + decisions.

**Verdict:** Well-grounded, roadmap-aligned plan with the right core bets (separate `WaveDirector`,
integrity as a distinct meter, code-side edge rule, instant-loss) — proceed after tightening a few Medium
sequencing/testability items and reconsidering the Step 3 bundle; nothing High.

|#|Finding|Lens|Severity|Suggested action|
|-|-------|----|--------|----------------|
|1|`time:changed` fires only on a transition; seeds into night don't emit it, so a WaveDirector on the event alone won't start; the fixing seam was scheduled too late.|Gaps/sequencing|Medium|✔ Begin-wave seam + first-tick phase reconcile moved into Step 3; done-whens reworded.|
|2|Milestone A's "testable with a scripted enemy" was false — integrity→loss needs objective AI (Step 4) or a `damageFire` seam (was deferred to Step 7).|Executability|Medium|✔ `damageFire`/`loseGame` test seam added in Step 1; wording fixed.|
|3|Base-rect→light-radius claim swap is orthogonal to the loop, carries the bootstrap one-way door, and changes placement (21×27 rect → fuel-fluctuating ~8-tile disc).|Scope discipline|Medium|✔ Peeled to plan 039; 038 keeps the base rect.|
|4|Objective AI built "generic for 037" risks the wrong abstraction before 037's needs are known.|Alt approaches|Low|✔ Seam kept minimal (nearest-hearth + `attackFire`); 037 refactors later.|
|5|Integrity-0 knockout left the fire visually "lit" until restart — two loss routes not symmetric.|Fire-model coherence|Low|✔ `damageFire`-to-0 now also douses.|
