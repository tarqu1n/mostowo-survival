# Testing

How the Mostowo Survival test harness works — the three-tier structure, the two-speed loop, the scenario API, boot determinism, and how to add a test.

## Testing

A **three-tier deterministic harness** (plan 007 — see DECISIONS.md for the *why*). The old
single live-game playthrough was retired: it raced real-time walks/chops and broke whenever anything
on its one linear path changed. Now:

|Tier|What|Command|When|
|---|---|---|---|
|**1 — unit**|Pure systems (`pathfind`/`tasks`/`combat`/`grid`/`stats`/`Inventory`) + data invariants, in plain Node|`npm test`|most iteration|
|**2 — scenario**|Browser-real integration/render/input, one behaviour per spec, driven deterministically|`npm run e2e`|when a change needs browser fidelity|
|**3 — boot canary**|Production bundle boots, reaches Game+UI, renders (compiles shaders), zero console errors|`npm run smoke`|before shipping|

### Two-speed loop — run only what you touch

- **Inner loop (sub-second, on save):** `npm run test:watch` reruns *only* the unit tests whose module
  graph touches the file you changed (edit `combat.ts` → only combat tests run). Targeted forms work
  out of the box: `npx vitest run <name>` (one file) and `npx vitest related $(git diff --name-only)`
  (exactly what your working-tree changes affect). No browser — this covers the bulk of iteration.
- **Feature-level check (seconds):** when a change needs browser fidelity, run *just the one scenario*,
  not the suite: `npx playwright test chop`, or by test name `npx playwright test -g "routes around"`.
- **Wrap-up gate (before finishing a feature):** the full sweep — `npm test` + `npm run e2e` +
  `npm run smoke`. Fast enough to run often because the heavy work moved to Tier 1 and Tier 2 is a
  handful of adjacent-entity scenarios, not a playthrough. (CI additionally runs `npm test` before a
  deploy — see `.github/workflows/deploy.yml`.)

### The scenario API (Tier 2)

Scenarios drive a **DEV-only** control surface on `GameScene`, reachable at `window.game.__test`:
`applyScenario(spec)` builds a known world from a declarative spec, `step(ms)` advances gameplay in
fixed 1/60s slices with **zero wall-clock** (stops the RAF loop, drives `game.step`), plus
`setRng`/`order`/`enqueue`/`inspect`/`state`/`blocked`. It is **gated on `import.meta.env.DEV`** so
`vite build` strips it entirely — it exists only under `vite dev`, which is why `playwright.config.ts`
serves `vite dev`, never `vite preview`. Chromium is pre-installed at `/opt/pw-browsers/` in web
sessions; both the e2e config and the boot canary honour `SMOKE_CHROMIUM_PATH`.

### Boot determinism (the ex-"boot-timeout" flake) — [RESOLVED 2026-07-12]

`startGame` used to wait for `game.isBooted` then immediately tap the title screen. But Phaser flips
`isBooted` almost instantly — long before PreloadScene finishes loading assets and MainMenuScene's
`create()` registers its "tap to start" `pointerdown` listener. Under parallel-worker load that gap
widened, the tap landed *before* MainMenu was listening, got dropped, and `startGame` then hung the
full 15s waiting for a `__test` that never installed (fail at `harness.ts`, the `__test` wait). Two
fixes, both root-cause, not papered over (`retries: 0` stays):

- **`harness.ts` — `bootIntoGame`:** wait for the **MainMenu scene to be ACTIVE** (not just booted),
  then tap, and **retry the tap while MainMenu is still active** so a dropped tap self-heals; stop
  once the Game scene takes over (no stray move orders). Shared by `startGame` and global-setup.
- **Server warm-up — `tests/e2e/global-setup.ts` + `optimizeDeps.include` (vite.config):** a cold
  `.vite/deps` cache let Vite re-optimize *after* workers connected and fire a full page reload
  ("[vite] page reload …") that wiped mid-boot pages. `globalSetup` boots the game once before the
  workers fan out so dep-optimization + the module-graph transform settle serially → every worker
  hits a fully warm server, no reload. Validated: 37/37 green across repeated **cold** runs at 5 and
  8 workers (previously failed reliably when cold).

### Adding a test

- **A unit test:** drop `src/systems/__tests__/<name>.test.ts` (or `*.test.ts` beside the module).
  `import { describe, it, expect } from 'vitest'`; build tiny inputs inline (e.g. a grid via an
  `isBlocked` closure over a Set) — no scene, no Phaser. `npm run test:watch` picks it up.
- **A scenario:** add `tests/e2e/<concern>.spec.ts`. Use the helpers in `tests/e2e/harness.ts`
  (`startGame`, `applyScenario`, `step`, `state`, `order`/`enqueue`, `emit`, `captured`, …) and a
  fixture from `tests/e2e/scenarios.ts` (or an inline spec). Shape: `startGame` → `applyScenario(...)`
  → do the ONE action → drive `step(...)` if time-based → assert via `state()`/`captured()`. Place
  entities **adjacent** so there's no multi-second walk. Add a named fixture builder only once ≥2
  specs want the same shape. `retries: 0` — if it flakes, fix the determinism, don't paper over it.
