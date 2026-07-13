# GameScene OOP Refactor (tooling + entities layer + scene decomposition)

> Status: in review

## Summary
Two-part hardening pass. **Part one (Step 1):** land the project's code-quality tooling — a coding
standards doc, ESLint + Prettier + markdownlint, and husky/lint-staged pre-commit hooks running
lint + format on staged files (full `tsc --noEmit` lives in `npm run check` and the CI deploy gate,
not the hook) — so everything after is written and committed under the new rules. **Part two (Steps 2–6):** behaviour-preserving refactor of `src/scenes/GameScene.ts`
(2,448 lines — a third of all source) into a maintainable structure: a new **`src/entities/`** layer
with a shallow class hierarchy (`Character` → `PlayerCharacter` / `MonsterCharacter`) for the actors
that genuinely share state + behaviour, plus extraction of self-contained scene concerns (combat FX,
pointer/camera gestures, build placement, queue-glow rendering, the DEV test API) into managers with
a uniform `destroy()`-on-SHUTDOWN contract. GameScene remains the composition root and keeps the
task-execution loop. **No gameplay changes**; the Tier-2 Playwright suite and the `__test`
API / `debugState()` shape are the behavioural contract and must keep passing throughout.

## Context & decisions

**User decisions (this planning session):**
- **Scope:** GameScene + entity classes. `systems/`, `data/`, `ui/` untouched unless a move forces
  a re-point. Whole-`src/` restructure is out of scope.
- **Strictly behaviour-preserving:** bugs found along the way are noted in the step report, not fixed.
- **OOP style:** follow the research — shallow hierarchy for genuinely shared behaviour, composition
  for the rest. No ECS, no deep trees.
- **Slicing:** fewer, bigger steps (6), each leaving the game runnable and tests green.

**User decisions (tooling addendum):**
- **Hooks via husky + lint-staged** — auto-install on `npm install` (fits the cross-device rule;
  every clone gets the hooks with zero manual setup).
- **Prettier alongside ESLint** — ESLint for correctness, Prettier for formatting (TS, JSON, CSS,
  HTML — **not markdown**, see below); one-time whole-repo reformat commit.
- **Markdown lint is token-optimised** — the `.md` files here are loaded into LLM context, so the
  lint posture is "minimum tokens": any rule that forces *extra* characters (blank-line padding,
  URL wrapping, mandatory H1s) is disabled; rules that *strip* characters (trailing spaces, repeated
  blank lines, padded emphasis) are enforced. Prettier is excluded from `.md` because its markdown
  formatter inserts blank-line padding — `markdownlint-cli2 --fix` is the sole markdown formatter.
- **Pre-commit hook is lint-staged-only** (staged-file lint + format — fast everywhere). Originally
  chosen as "full `tsc` on every commit", downgraded per critique finding #1: the primary workflow is
  phone/short-session/commit-small, and a whole-project tsc on every WIP commit fights that. Full
  `tsc` still gates via `npm run check` and the CI deploy workflow; `git commit --no-verify` is the
  documented escape hatch.
- **Tooling lands FIRST** (Step 1), so the reformat commit is isolated from the refactor's move-diffs
  and all refactor commits pass through the hooks.

**Research verdict (Phaser 3 + TS community guidance):**
- SRP is the SOLID principle that pays off; scenes should be thin composition roots that wire
  subsystems, each owning its own update/teardown. Heavy DI/interface layers and full ECS are
  over-engineering at this scale.
- Shallow inheritance is fine; the anti-pattern is deep trees and stuffing logic into them.
- **Keep simulation state out of display objects** — domain state (hp, stats, AI) lives in plain
  classes; sprites render it.
- Event-bus with discipline: scene↔UIScene stays on `game.events`; don't extend the bus to
  intra-scene manager chatter.

**Advisor architecture decisions (consulted 2026-07-12, adopted):**
1. **Entity shape:** plain `Character` class that **owns** a sprite — NOT a `Phaser.GameObjects.Sprite`
   subclass. `EnemyUnit` is already a struct-owning-a-sprite, so this is the minimal
   behaviour-preserving promotion; the footprint≠hurtbox split means logical position already isn't
   the sprite transform; subclassing would entangle entity lifetime with the display list and the
   `debugState()` contract.
2. **Hierarchy stops at `Character` → `PlayerCharacter` / `MonsterCharacter`.** Trees (`TreeNode`)
   and build sites (`BuildSite`) stay plain interfaces — they share no behaviour, and the
   2026-07-11 DECISIONS entry (typed stat adapters over a forced class hierarchy) stands for them.
   Record this as a conscious *refinement* of that decision in DECISIONS.md: behaviour classes yes,
   data hierarchy no; the `systems/stats.ts` adapters remain the inspection seam.
3. **Decision/effect split is preserved:** `systems/monsterAI.ts` keeps *deciding* (pure FSM);
   `MonsterCharacter` *executes* decisions. Same for `attachment.ts` (stays pure; `Character` calls it)
   and `needs.ts` (hunger is a player need driven by the scene, not a `Character` trait).
4. **Camera merges into pointer input:** one `PointerInputController` owning tap/long-press-paint/
   pan/pinch/follow — pinch/pan/follow state is gesture state; splitting camera out would create the
   chattiest manager↔manager edge.
5. **The task loop stays in GameScene** (`order/enqueue/beginCurrent/completeCurrent/runHarvest/`
   `runBuild/repath`): it is the coordination spine touching player movement, inventory, sites and
   trees. Only its *visuals* (glow sprites, queue markers) extract, as `TaskGlowRenderer`.
6. **Combat FX go in a `CombatFxManager` keyed by sprite** (the existing tween maps are already
   sprite-keyed — near-zero-diff). Characters expose semantic hooks (`onHurt`, `die`); the scene/hooks
   call the FX manager. FX bookkeeping in `Character` would give every character scene/tween refs and
   duplicated cleanup.
7. **Coupling rules:** scene→manager = direct method calls; managers receive narrow interfaces at
   construction; no manager↔manager events; `game.events` reserved for scene↔UIScene as today.
   Every manager/entity registers `destroy()` on `Events.SHUTDOWN` (tween Maps/Sets are the known
   restart-leak hazard).
8. **`debugState()` stays one centralized serializer** (may delegate to managers/entities for slices)
   so the test contract cannot fragment.

**Key repo facts (from the survey — starting point is commit `aa9ca3c`, clean tree, zombie→enemy
rename complete):**
- **No linter or formatter exists today** — scripts are only `typecheck`/`test`/`e2e`/`smoke`/
  `build`. Step 1 is greenfield tooling.
- GameScene owns ~45 state fields and ~80 methods across 12 responsibility clusters; `create()` is
  230 lines (state reset + anims + world build + camera/fog + UI launch + 12 event listeners +
  SHUTDOWN teardown + DEV `__test` install); `update()` drives clock/hunger → action switch →
  anim/vision/enemies.
- Entity shapes `TreeNode`/`BuildSite`/`EnemyUnit`/`PointerPick` + test types
  `ScenarioSpec`/`ScenarioResult`/`GameTestApi` + `FacingSpec`/`FACING_DELTAS` are defined *in*
  GameScene.ts (lines ~93–234). `src/systems/stats.ts` imports entity types from the scene — the one
  systems→scene back-edge; this refactor kills it.
- Player has no class: raw sprite field + hardcoded stats in `create()` (from `config.ts` constants)
  plus ~15 scene methods. Monsters: `EnemyUnit` interface + ~10 scene methods
  (`spawnEnemies/advanceEnemy/updateEnemyAnim/syncEnemyAttachments/setEnemyFootprint/enemyLungeAt/`
  `killEnemy` + the `updateEnemies` orchestration).
- Tier-2 Playwright specs (`tests/e2e/*.spec.ts` via `harness.ts`) assert on `debugState()` fields
  and drive `testApplyScenario/testStep/...` — **the de-facto contract**. Tier-1 Vitest units cover
  `systems/`; only `stats.test.ts` imports scene types (re-point in Step 2). Tier-3 = `npm run smoke`.
- Commands: `npm run check` (typecheck + unit), `npm run e2e`, `npm run smoke`.

**Conventions to honour throughout:** systems over god-objects; data-driven content; footprint≠hurtbox;
sprite-raycast picking (`pickSpriteAt`/`alphaHit`); cross-scene comms only via `game.events` +
registry, torn down on SHUTDOWN; world-scene input gated through `hudHitTest`.

**Parallelism:** none — Step 1 reformats the whole repo and every later step edits `GameScene.ts`,
so steps are write-overlapping and strictly sequential, in order.

## Steps

- [x] **Step 1: Coding standards doc + lint/format/markdown tooling + pre-commit hooks** `[delegate sonnet]`
  - Outcome: landed as commit `328b4d0` (60 files). eslint@10 (not v9 — latest stable, flat config unchanged) +
    typescript-eslint + prettier + markdownlint-cli2 + husky/lint-staged; `check` now runs
    typecheck+lint+lint:md+format:check+test; hook = `npx lint-staged` only. Reformat: 35 .ts + 16 .md files.
    `unbound-method`/`no-explicit-any` downgraded to warn (TODO(lint) in eslint.config.js); MD060 set to
    `tight` tables. All checks green (check, e2e 37/37, build, smoke); hook demo passed.
    ⚠ Machine needs Node ≥22 on PATH (global 20.11.0 breaks lint-staged; node@22 installed keg-only via brew).
  - **Dev dependencies (exact set, latest stable):** `eslint` (v9 flat config), `typescript-eslint`,
    `eslint-config-prettier`, `prettier`, `markdownlint-cli2`, `husky`, `lint-staged`. No plugins
    beyond these — minimal-dependency default.
  - **ESLint:** `eslint.config.js` (flat) — `typescript-eslint` recommended (type-aware where cheap)
    with `eslint-config-prettier` last. Ignore `dist/`, `public/`, `node_modules/`, `playwright-report/`,
    `test-results/`. Pragmatic posture for a codebase that has never been linted: rules that fire
    heavily on existing code and are style-only get set to `warn` with a `// TODO(lint)` note in the
    config; correctness rules stay `error`. Zero `error`-level findings after the fix pass; do NOT
    rewrite logic to satisfy style rules (behaviour-preserving applies here too).
  - **Prettier:** `.prettierrc` matching the dominant existing style — infer from the codebase; expected:
    2-space indent, single quotes, semicolons, trailing commas, `printWidth: 100`. `.prettierignore`
    mirrors ESLint ignores + `public/assets/` + `**/*.md` (Prettier's markdown formatter inserts
    blank-line padding — token bloat; markdown belongs to markdownlint alone).
  - **markdownlint:** `.markdownlint-cli2.jsonc` **already landed at repo root during planning** —
    Step 1 only adds the `lint:md` script/hook wiring and runs the fix pass; don't re-create it.
    **Token-optimised posture** — these files are LLM context, so enforce the minimum-character form:
    - Disable token-ADDING rules: `MD013` (line length — wrapping churn, no token benefit), `MD022`,
      `MD031`, `MD032` (blank-line padding around headings/fences/lists), `MD034` (bare URLs are the
      cheapest form — no `<>`/link wrapping), `MD041` (no mandatory leading H1), `MD045` (no forced
      image alt text), `MD040` (no mandatory fence language — add only where it aids comprehension).
    - Keep/enforce token-REDUCING or neutral-consistency rules: `MD009` (no trailing spaces), `MD012`
      max 1 consecutive blank line, `MD019`/`MD021`/`MD023` (no extra heading spaces/indent),
      `MD026`/`MD027` (no trailing heading punctuation / blockquote padding), `MD030` (minimum spaces
      after list markers), `MD037`–`MD039` (no padding inside emphasis/code/links), `MD004` (consistent
      `-` bullets), `MD035` (`---` as the hr form), `MD047` (single trailing newline).
    - Fix trivial violations in existing docs; config-off anything else that would force prose
      rewrites (don't mass-edit content to satisfy style).
  - **Scripts (package.json):** `lint` (`eslint .`), `lint:fix`, `lint:md` (`markdownlint-cli2`),
    `format` (`prettier --write .`), `format:check`, `prepare` (`husky`). Extend `check` to
    `typecheck && lint && lint:md && format:check && test`.
  - **Hooks:** `.husky/pre-commit` → `npx lint-staged` only (staged files — fast on any device; NO
    whole-project tsc in the hook, per critique #1; typecheck gates via `npm run check` + the CI
    deploy workflow). `lint-staged` config in package.json:
    `*.ts` → `eslint --fix` + `prettier --write`; `*.md` → `markdownlint-cli2 --fix` **only** (no
    Prettier on markdown); `*.{json,css,html}` → `prettier --write`.
  - **One-time pass:** `lint:fix` + `format` + markdownlint fix across the repo, committed as its own
    isolated commit (message: `chore: adopt eslint/prettier/markdownlint + pre-commit hooks`) so the
    reformat noise never mixes with refactor move-diffs.
  - **Standards doc:** new `docs/STANDARDS.md` (terse, token-lean): tooling summary (what runs when —
    editor, pre-commit, `npm run check`), naming conventions (files, classes, events, registry keys —
    document what the codebase already does), TS posture (`strict`, no `any` without a comment,
    prefer readonly fields), comment policy (constraints only, per existing style), commit message
    convention (existing `feat/fix/docs/chore(scope):` pattern from git history), the
    **markdown-is-model-context rule** (docs are loaded into LLM context — write token-lean: no
    padding blank lines, bare URLs, terse bullets over prose; the markdownlint config enforces the
    mechanical part), what runs where (hook = staged lint/format; `npm run check` + CI = full
    typecheck/tests; `git commit --no-verify` as the escape hatch), and a pointer to CONVENTIONS.md
    for architecture patterns. Link it from CLAUDE.md's docs list (one line) and from
    CONVENTIONS.md's header.
  - Side effects: `npm install` diff (`package.json`, lockfile); the reformat touches most files —
    verify `npm run check` and `npm run e2e` still green after (formatting is behaviour-neutral; tsc
    and tests prove it). Hooks will gate every subsequent step's commits — deliberate.
  - Docs: `docs/STANDARDS.md` (new), CLAUDE.md docs list +1 line, `docs/WORKFLOW.md` — add the new
    scripts + hook behaviour to the commands section (terse).
  - Done when: `npm run check` (now incl. lint/format/md) green; `npm run e2e` green; a scratch commit
    demonstrably triggers the hook (then is amended/dropped); reformat landed as one isolated commit.

- [x] **Step 2: Entities module, types move, and a `debugState()` golden tripwire** `[delegate sonnet]`
  - Outcome: commit `f288c16`. Work was found already authored on disk (separate session) and was
    verified + finished here: formatted the new spec, fixed one baked snapshot value (`hunger` 60.1 →
    60.5 — stale hand-calc vs the final 10×200ms settle loop; 60.5 = 62 − 0.4/s × 3.75s driven, matches
    clockMs), ran gates. `src/entities/types.ts` + `testTypes.ts` moved verbatim; systems→scene
    back-edge dead (stats.ts/stats.test.ts/harness.ts/scenarios.ts re-pointed). Deviation:
    `testTypes.ts` keeps a type-only `GameScene` import for `ReturnType<GameScene['debugState']>` —
    re-point in Step 6 when debugState moves. check green; e2e 38/38; tripwire stable ×4 runs.
  - Create `src/entities/types.ts` and move from `GameScene.ts` verbatim: `TreeNode`, `BuildSite`,
    `EnemyUnit`, `PointerPick`, `FacingSpec`, `FACING_DELTAS` (keep names/shapes identical). Move the
    test-contract types (`ScenarioSpec`, `ScenarioResult`, `GameTestApi`) to `src/entities/testTypes.ts`
    (they'll be consumed by the Step 6 TestApi module; re-export from GameScene.ts meanwhile if
    anything imports them from there). Update all imports: `GameScene.ts`, `src/systems/stats.ts`
    (kills the systems→scene back-edge), `src/systems/__tests__/stats.test.ts`, `tests/e2e/harness.ts`
    if it imports scene types, and any other importer (`grep -rn "from '.*scenes/GameScene'" src tests`).
  - Add the refactor tripwire: a new Playwright spec `tests/e2e/refactor-tripwire.spec.ts` that applies
    one rich scenario (reuse `scenarios.ts` builders — e.g. trees + a rock + a wall + one enemy),
    steps a fixed number of ticks, and asserts a **full snapshot** of `debugState()` against an
    inline expected object (not a stored snapshot file — deterministic via the seeded rng and
    `testClock`). **Float discipline (critique #2):** exact deep-equal ONLY for discrete fields
    (tiles, counts, modes, ids, hp); float-carrying fields (`px`/`py`, hunger, night alpha, anything
    tween-derived) are rounded to a fixed precision (or `toBeCloseTo`) before comparing — Steps 3–6
    relocate movement/tween math and last-bit float drift must not fire false alarms. This is the
    cheap "did the refactor change behaviour?" alarm for Steps 3–6.
  - Side effects: import paths only; no logic moves. Check `vite`/`tsconfig` need nothing (plain
    relative imports).
  - Docs: none yet (Step 6 batches doc updates).
  - Done when: `npm run check` green; `npm run e2e` green including the new tripwire spec; grep shows
    no remaining `from '../scenes/GameScene'` (or similar) type imports outside `src/scenes/`.

- [x] **Step 3: Extract `CombatFxManager`** `[delegate sonnet]`
  - Outcome: commit `b77236c`. New `src/scenes/fx/CombatFxManager.ts` (300 lines); GameScene 2490→2303,
    owns no tween Map/Set fields (remaining Maps/Sets are build/queue/glow — Step 6). Counters exposed as
    `getPlayerFlash()`-style methods (get-accessors would collide with the verbatim-moved private fields).
    Deviation: constructor stashes deps only; new `armShutdown()` called from `create()` registers the
    SHUTDOWN destroy — Phaser doesn't wire scene.events until just before create(), and eager construction
    in create() measurably raised tripwire flake (~9%→0 over 60 serial runs after the split).
    Deps = narrow closures (`getPlayerSprite`/`getFacing`/`getLastFacingDCol`/`setAttackLockUntil`).
    check green; e2e 38/38 ×5; build + smoke pass. Pre-existing issues noted: tripwire contact-bite
    ~100ms real-clock margin (testStep seeds from time.now — follow-up candidate); menu-start flake;
    stale vite preview on :4173 predating the session.
  - Create `src/scenes/fx/CombatFxManager.ts` (presentation-side, so under `scenes/`, mirroring how
    `render/` holds baked textures — it needs the scene for tweens). Move from GameScene verbatim:
    `hitFlashTweens`, `lungeTweens`, `weaponSwingTweens`, `hitFlashOn`, `corpses`, and methods
    `flashHit`, `enemyLungeAt` (drops its prefix — becomes `lungeAt` on the manager), `playAttackSwing`, `cleanupActorFx`,
    `resetCombatFx`, plus the corpse bookkeeping from `killEnemy`/`killPlayer` (the kill *logic* stays
    in the scene for now; Step 4 moves it into the classes — this step only takes the tween/FX
    bookkeeping). Keep the FX counters used by `debugState()` (`playerFlash`, `playerHitFlashes`,
    `enemyHitFlashes`) readable — expose them as manager getters and have `debugState()` read through.
  - Constructor takes the scene; registers its own `destroy()` on `Events.SHUTDOWN` (flush all tween
    maps/sets — this replaces the scene's current teardown of those fields). Scene calls are direct
    method calls per the coupling rules.
  - Side effects: `killEnemy`, `killPlayer`, `hitPipeline`, `attack`, `updateEnemies`, and the SHUTDOWN
    handler in `create()` all touch these fields — re-point them. The WebGL hit-flash PostFX pipeline
    registered in BootScene is used by `flashHit`; do not re-register it.
  - Docs: none yet.
  - Done when: `npm run check` + `npm run e2e` green (tripwire + `combat`, `death`, `monster` specs
    especially); GameScene no longer owns any tween Map/Set fields.

- [x] **Step 4: Introduce `Character` → `PlayerCharacter` / `MonsterCharacter`** `[inline]`
  - Outcome: done inline. New `src/entities/Character.ts` (abstract; owns sprite, hp/stats/lastFacing/
    path; shared advancePath as a template method — `onBeforeStep` hook = player facing,
    `onWaypointReached` = monster col/row sync; `fitBody`, `tile()`, `takeDamage`/`die` hooks),
    `PlayerCharacter.ts` (sprite+stat construction from config, updateAnim(harvestSwing),
    attackLockUntil, effectiveMoveSpeed whole, dying flag, die() returns anim duration) and
    `MonsterCharacter.ts` (replaces `EnemyUnit` — deleted, all refs updated, no alias; constructor =
    old addEnemy incl. weapon roll/fists; `update(MonsterTickEnv)` executes the FSM decision with
    narrow env callbacks `lungeAt`/`onPlayerHurt`/`damagePlayer`). Per advisor decision 6 the
    kill orchestration stayed scene-side: killPlayer/killEnemy pair `die()` with FX-manager calls +
    the delayedCall/restart scheduling. GameScene keeps a `private get player()` sprite getter so
    camera/fog/pointer code is untouched; 2,304 → 1,931 lines, no player-anim/facing/enemy-execution
    methods left. Deviation: eslint gained `no-unused-vars` `argsIgnorePattern: '^_'` (hook default
    params). check green; e2e 38/38; tripwire ×4 stable; `EnemyUnit` grep = comments only.
  - The biggest step — needs judgement; keep it inline. Create in `src/entities/`:
    - `Character.ts` — plain abstract class **owning** `sprite` (+ body typing), `stats: CombatantStats`,
      `hp`, `lastFacing`, path state (`path`, `pathIndex`); shared behaviour moved from the scene:
      facing (`facingDir`/`faceTile`), body fitting (`fitActorBody`), tile-position helper
      (`playerTile` generalised to `tile()`), path-following step (the shared core of
      `advancePath`/`advanceEnemy`), `takeDamage`/`die` as semantic hooks that *callers* pair with
      `CombatFxManager` calls. Constructor takes narrow deps (scene or an interface exposing what it
      truly needs — tweens/anims access should NOT leak in; FX stays in the manager).
    - `PlayerCharacter.ts` — extends Character. Absorbs: hardcoded stat construction from `create()`
      (keep constants in `config.ts`; construction moves here), `updatePlayerAnim`, `playerHp`,
      `attackLockUntil`, and `effectiveMoveSpeed` **moved whole** (advisor flag: hunger × combat-mode ×
      animation interplay must not be split across Character/needs — the scene passes hunger/mode in).
      `damagePlayer` → `takeDamage` override + scene keeps emitting `player:hpChanged`/`player:hit`
      on the bus (events stay scene-owned). `killPlayer` logic moves in; FX/corpse calls route through
      `CombatFxManager`.
    - `MonsterCharacter.ts` — extends Character; replaces the `EnemyUnit` interface (delete it from
      `entities/types.ts`; keep a `type EnemyUnit = MonsterCharacter` alias only if the diff-noise is
      worth avoiding, else update all references). Fields: `def`, `ai: MonsterState`, `weapon`, `hands`,
      footprint state. Absorbs: `advanceEnemy`, `updateEnemyAnim`, `syncEnemyAttachments` (calls pure
      `attachment.ts`), `setEnemyFootprint`, `killEnemy` logic, and the per-monster slice of
      `updateEnemies` (execute a `stepMonster` decision: repath/move/contact-bite via
      `resolveMeleeAttack`). The scene keeps: the `enemies[]` collection, spawn (`spawnEnemies`),
      the per-frame loop that feeds each monster its inputs + rng, and all bus emissions.
  - Explicitly NOT moving: task loop (`order/enqueue/beginCurrent/completeCurrent/runHarvest/runBuild/`
    `repath`), hunger/starvation (scene + `needs.ts`), mode switching, spawning/world-gen, inspect/picking.
  - Side effects: `systems/stats.ts` adapters (`enemyStats`/`playerCombatStats`) — re-point to the new
    classes (public readonly fields keep adapters working); `hurtbox.ts` call sites; `debugState()`
    reads many player/enemy fields — read through the classes, **output shape unchanged**;
    `testApplyScenario`/`testResetWorld` construct enemies — use the class constructor; scenario spec
    field names unchanged.
  - Docs: none yet.
  - Done when: `npm run check` green; full `npm run e2e` green (tripwire unchanged); GameScene has no
    player-anim/facing/enemy-execution methods left; `grep -n "EnemyUnit" src | grep -v entities` is
    empty (or only the deliberate alias).

- [x] **Step 5: Extract `PointerInputController` (gestures + camera)** `[delegate sonnet]`
  - Outcome: delegated (sonnet). New `src/scenes/input/PointerInputController.ts` (298 lines) owns the
    13 gesture/camera fields + onPointerDown/Move/Up, paintQueueAt, pointer helpers, and
    loadStoredZoom/setZoom/adjustZoom/setFollowing/centerOnPlayer. Deps callbacks: hudHitTest,
    getPlayerSprite, isBuildMode/onBuildDown/onBuildMove, getMode, onTap/onPaint/onInspect (build +
    mode dispatch stay scene-side). GameScene 1,931 → 1,743 lines; create() registers no raw pointer
    handlers; zoom:delta/camera:center listeners re-point to controller; registry/bus names unchanged.
    Deviations: constructed fresh in create() (no armShutdown split — input/events already wired by
    then), which also fixes a latent stale-`following`-field quirk across death-restarts; new
    clearPaintedTiles() for testResetWorld. check green; e2e 38/38; build pass; tripwire ×3 (agent) +
    ×3 solo + combo ×3 (orchestrator). Verified pre-existing (not this step): tripwire contact-bite
    flake under parallel spec load — failing fields are bite-cadence only (enemyAttacks/
    playerHitFlashes/playerHp), matching the Step 3 note; testStep-seeds-from-time.now fix remains a
    follow-up candidate.
  - Create `src/scenes/input/PointerInputController.ts`. Move verbatim from GameScene: the 16 gesture
    fields (`downScreen`, `downOnUI`, `sawPointerDown`, `pressStart`, `queuePainting`,
    `paintedThisGesture`, `pinching`, `pinchDist`, `isPanning`, `lastPanX/Y`, `following`, …) and
    methods `onPointerDown/Move/Up`, `activePointerCount`, `pointerDistance`, `pointerOnHud`, plus the
    camera side: `loadStoredZoom`, `setZoom`, `adjustZoom`, `setFollowing`, `centerOnPlayer`,
    `userZoom`. Camera and gestures stay together (advisor decision 4).
  - The controller receives at construction: the scene, a `hudHitTest` gate, and narrow callbacks for
    the *intents* it resolves (`onTap(actionAt)`, `onPaint(paintQueueAt)`, `onInspect(inspectAt)`) —
    mode-dependent intent dispatch can stay in the scene via those callbacks; the controller owns only
    gesture mechanics. It wires its own `input.on(...)` listeners and removes them in `destroy()` on
    SHUTDOWN. Registry/bus writes (`zoom:changed`, `camera:followChanged`, `following`, `zoom` registry
    keys) move with the methods — this is an existing scene↔UIScene contract, keep names identical.
  - Side effects: UIScene listens for `zoom:delta`/`camera:center` on the bus and GameScene currently
    handles them — those two listeners re-point to controller methods; `updateVision`/`fogShape`
    stay in the scene (vision ≠ gesture); `debugState()` exposes zoom/follow — read through getters.
  - Docs: none yet.
  - Done when: `npm run check` green; `npm run e2e` green with special attention to `gestures`, `zoom`,
    `follow`, `queue`, `mode` specs; GameScene's `create()` no longer registers raw pointer handlers.

- [x] **Step 6: `BuildManager` + `TaskGlowRenderer` + TestApi module + `create()` slim + docs** `[delegate sonnet]`
  - Outcome: delegated (sonnet; first agent died mid-run after authoring the two manager files — a
    second agent verified + reused them, fixing one bug in the unwired draft: `BuildManager.destroy()`
    called `reset()` whose `walls.clear()` throws at SHUTDOWN because Arcade tears down first; destroy
    now only drops the ghost). New: `src/scenes/build/BuildManager.ts` (243), `src/scenes/fx/`
    `TaskGlowRenderer.ts` (186), `src/scenes/testApi.ts` (362 — exports named `DebugState`;
    `entities/testTypes.ts` GameScene import re-pointed per Step 2 flag). create() = resetState/
    buildWorld/wireBus/installTestApi; PointerInputController deps re-pointed only; harness/scenarios/
    UIScene/stats.ts untouched; debugState key order preserved. Docs batched: CONVENTIONS (entities
    layer + manager pattern), STANDARDS (entities/ vs scenes/ placement), DECISIONS (2026-07-13
    entry incl. critique #5 rename refresh), STATUS, CLAUDE.md. GameScene 1,743 → 1,385 lines — misses the
    "well under 1,000" target; everything the plan names is extracted, the remainder is what the plan
    says stays (task loop, spawning, combat glue) — further cuts would be new scope. check green;
    e2e 38/38 (agent ×2 + orchestrator ×1); tripwire ×3; smoke + build pass (one smoke flake =
    pre-existing menu-start flake vs the stale :4173 preview). Pre-existing noted: randomiseWorld
    never resets nextTreeId/nextEnemyId (cosmetic id growth).
  - `src/scenes/build/BuildManager.ts`: move `buildMode`, `walls`, `occupied`, `sites`, `siteTiles`,
    `ghost`, `nextSiteId` and methods `toggleBuild`, `siteById`, `siteAt`, `tilePlaceable`,
    `updateGhost`, `placeOrEnqueueBuild`, `createBlueprint`, `finishSite`. Scene task loop calls it
    directly (`runBuild` stays in the scene, calls `buildManager.finishSite(...)`). Owns its ghost/site
    GameObjects and destroys them on SHUTDOWN. Bus events `build:toggle`(in)/`build:modeChanged`(out)
    keep flowing through the scene or move with the methods — names unchanged.
  - `src/scenes/fx/TaskGlowRenderer.ts`: move `queueMarkers`, `outlinedTreeIds`, `glowSprites`,
    `glowPulse` and methods `refreshQueueHighlights`, `addTreeGlow`, `syncGlowTransforms`,
    `headHarvestTreeId`. Pure presentation over the queue — reads the queue/trees via narrow accessors.
  - `src/scenes/testApi.ts` (DEV-only): move `testResetWorld`, `testApplyScenario`, `testStep`,
    `testInspect`, `debugState`, `isTileBlocked` (~220 lines) into a module/class receiving a facade
    over the scene + managers + entities. `debugState()` remains ONE serializer function here,
    delegating to manager/entity getters — **assembled output shape byte-identical** (tripwire spec
    proves it). The `import.meta.env.DEV` guard and `window.game.__test` install stay as today.
  - Slim `create()`: group the remainder into named private methods (`resetState`, `buildWorld`,
    `wireBus`, `installTestApi`) — mechanical grouping only, no behaviour change. `update()` should
    now read as: clock/needs → task-loop switch → delegated `player.update`/monster loop/manager syncs.
  - Docs (batched, terse):
    - `docs/CONVENTIONS.md`: new short section — entities layer (plain classes owning sprites,
      decision/effect split, hierarchy stops at Character), manager pattern (direct calls, narrow
      constructor deps, `destroy()` on SHUTDOWN, no manager↔manager events).
    - `docs/STANDARDS.md`: add any naming/layout rules that crystallised during the refactor
      (`entities/` vs `scenes/` submodule placement).
    - `docs/DECISIONS.md`: dated entry — "behaviour classes yes, data hierarchy no" as a conscious
      refinement of 2026-07-11 (adapters remain the inspection seam); advisor rationale one-liner
      for plain-class-owns-sprite; camera-in-input; task loop stays in scene; tooling adoption
      (eslint/prettier/markdownlint/husky) one-liner. Also refresh the stale pre-rename names in the
      2026-07-11 adapter entry (`zombieStats`/`ZombieUnit` → `enemyStats`/`EnemyUnit`) — critique #5.
    - `docs/STATUS.md`: one line — plan 013 landed.
    - `CLAUDE.md` architecture map: add `src/entities/` bullet (one line).
  - Side effects: `stats.ts` back-edge must remain dead; `harness.ts` untouched (API surface identical);
    UIScene untouched.
  - Done when: `npm run check`, full `npm run e2e`, and `npm run smoke` all green; `GameScene.ts` is
    down to composition root + task loop + spawning/world-gen + mode/inspect glue (target: well under
    1,000 lines); docs updated.

## Out of scope
- Any gameplay/balance change, bug fix, or rename beyond what the moves force (bugs found → noted in
  step reports, fixed later).
- Restructuring `systems/`, `data/`, `ui/`, other scenes, or folder layout beyond `src/entities/` and
  the new `src/scenes/` submodules.
- Trees/build-sites as classes (`WorldEntity`) — explicitly rejected; interfaces + stat adapters stand.
- ECS, DI containers, or interface-per-manager abstraction layers.
- Making player stats data-driven (`data/` player def) — worth doing, but it changes a seam this plan
  deliberately freezes; schedule separately.
- CI enforcement of lint/format — `.github/workflows/deploy.yml` DOES exist (gates deploy on
  `npm ci` → `npm run test` → `npm run build`, so typecheck rides `build`); lint/format stays
  hook-only for now, joining the CI gate later if hook-skipping becomes a problem.
- Additional ESLint plugins (import-sorting, unicorn, etc.) — start minimal; add later if missed.
- The equipment queue / night-waves features (next on the roadmap; this refactor clears the ground
  for them).

## Critique
> Fresh-eyes review 2026-07-12. Verdict: well-grounded, disciplined, behaviour-preserving; factual
> claims check out; direction pulls toward the roadmap. No blockers. **All findings below have been
> applied to this plan revision** (#1: hook downgraded to lint-staged-only; #2: float tolerance in
> tripwire; #3: CI claim corrected; #4: rename wording fixed; #5: folded into Step 6 docs).

|#|Finding|Severity|Resolution|
|-|-------|--------|----------|
|1|Full `tsc` in pre-commit hook fights the phone/short-session workflow|Medium|Hook is lint-staged-only; tsc gates via `npm run check` + CI deploy|
|2|Tripwire deep-equal on raw floats → false alarms when Steps 3–6 relocate movement/tween math|Medium|Discrete fields exact; float fields rounded/`toBeCloseTo`|
|3|"No CI pipeline exists" was stale — `.github/workflows/deploy.yml` gates deploy on test+build|Low|Corrected in Out of scope|
|4|"`enemyLungeAt` (rename `lungeAt`)" read backwards|Low|Reworded: drops prefix on the manager|
|5|2026-07-11 DECISIONS adapter entry still uses pre-rename `zombieStats`/`ZombieUnit`|Low|Refresh folded into Step 6 DECISIONS edit|
