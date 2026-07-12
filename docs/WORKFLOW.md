# Workflow & Conventions

How to work on Mostowo Survival from any device. Update this whenever the "how" changes.

## Git — trunk-based, solo

It's just Matt working on this, so **no feature branches, no PRs**:

- **Work directly on `master`.** Commit each stage as it's completed, and **push straight to
  `master`** (`git push`). Don't open PRs or stack review branches.
- Commit in small, described steps with clear messages. **Push often** — work may resume on another
  device mid-task, and unpushed work is invisible there.
- A "completed stage" = a coherent, working increment (builds + boots). Finish it → commit → push.

## Hermes dev skills (how we build)

Skills come from the `hermes-ai-tooling` repo and are available in-session:

- **`plan-feature`** — produces a step-by-step plan under `plans/`. Use before writing non-trivial code.
- **`critique-plan`** — independent adversarial review of a plan before executing.
- **`execute-plan`** — carries out the plan step-by-step with check-ins.

Loop: *plan → critique → (revise) → execute → commit → push*.

### Review checkpoints — STOP for Matt's input (do not run the loop unattended)

Matt reviews the work at the gates, so **do not chain plan → critique → execute → deploy in one
autonomous sweep.** Stop and hand back for input at each of these points:

1. **After a plan is written** (before running `critique-plan`) — Matt may want to read/adjust it first.
2. **After the critique** (before executing) — Matt decides whether to accept, revise, or drop findings.
3. **At the end of every executed plan step** — as the `execute-plan` skill prescribes: report what the
   step produced and check in before starting the next step (or parallel group).

This holds even when a task says "build it" / "do it": that authorises the *work*, not skipping the
review gates. When in doubt, stop and ask rather than press on.

**Direct tweaks (outside the plan loop) = auto-push on green.** For a small change Matt asks for
directly (a tweak, a fix, a debug helper — not a `plan-feature` step), don't stop to ask before
pushing: implement it, verify it's **green** (`npm run build` typechecks + builds, and `npm run smoke`
passes when there's runtime surface), then commit and push to `master` (auto-deploys). Only pause if
it's *not* green, if it's ambiguous/hard-to-reverse, or if it's actually plan-scale work (then it goes
through plan → critique → execute with the gates above). Commits are authored as
`Claude <noreply@anthropic.com>` (repo git config) so GitHub marks them verified.

> Cross-device note: to make these skills load automatically in a fresh session on another
> machine, install the `hermes-skills` marketplace / `hermes-dev` plugin per that repo's README,
> or vendor them into `.claude/skills/`. TODO: decide and wire this up (tracked in DECISIONS.md).

## Stack

**Phaser 3 + TypeScript + Vite.** Single-page static app, no backend. Client-side saves
(`localStorage` → IndexedDB later).

## Run / build / deploy

```bash
npm install       # install deps
npm run dev       # local dev server with hot reload (Vite)
npm run build     # typecheck (tsc --noEmit) + static production build -> dist/
npm run preview   # serve the production build locally (http://localhost:4173/mostowo-survival/)
npm run typecheck # types only, no build

# Tests (see "Testing" below for the two-speed loop)
npm test          # Tier-1 unit tests (Vitest, plain Node, fast)
npm run test:watch# Tier-1 watch mode — reruns only the tests affected by the file you just saved
npm run e2e       # Tier-2 deterministic Playwright scenarios (starts its own `vite dev`)
npm run smoke     # Tier-3 boot canary (needs `npm run preview` running)
```

Verified working on Node 22 (Phaser 3.90, Vite 6, TypeScript 5.9). `npm run build` typechecks then
bundles; the ~1.4 MB JS chunk is Phaser itself (~341 KB gzipped) — expected, not worth splitting.

**Deploy: GitHub Pages via GitHub Actions** (`.github/workflows/deploy.yml`). **Every push to
`master`** (or a manual "Run workflow") runs `npm ci` → `npm run build` → publishes `dist/` to Pages
— so shipping is just `git push`. Assets resolve under `/mostowo-survival/` in production (Vite
`base`, see `vite.config.ts`; override with `BASE_PATH` if the repo is renamed or served elsewhere).

> **One-time setup (only Matt can do this, in repo Settings):**
> 1. **Settings → Pages → Source: "GitHub Actions".**
> 2. **Settings → Branches (or the branch dropdown) → set default branch to `master`** so fresh
>    clones and the Pages environment use it.
>
> After that, every `git push` to `master` auto-deploys to `https://tarqu1n.github.io/mostowo-survival/`.

## Code conventions

_To be firmed up as we go. Starting position:_

- **Data-driven design.** Items, recipes, buildings, resource nodes = data (TS/JSON), not
  hard-coded logic. Adding content should mean editing data, not writing new systems.
- **Systems over god-objects.** Keep inventory / crafting / time-of-day / resources as separate,
  testable modules.
- **Scenes:** Boot → Preload → Menu → Game (world) → UI overlay. Keep UI decoupled from world logic.
  The core-loop slice set the pattern: content is data in **`src/data/`** (`ITEMS`/`NODES`/`BUILDABLES`
  + `types.ts`), logic is small modules in **`src/systems/`** (`Inventory`, `grid`), and the HUD is a
  parallel **`UIScene`** launched over `GameScene` — not baked in. Cross-scene comms via
  `this.game.events` (`build:*`) + a shared instance in `this.registry` (the `Inventory`).
- **World-scene input gates on the HUD hit-region.** A scene-level `input.on('pointerdown')` fires for
  *every* tap, including ones over the overlay — so `GameScene` ignores pointers inside `UIScene`'s
  hit-region (`hudHitTest`) before routing move/chop/build. Route all pointer handlers (`down` + `move`)
  through one intent gate.
- **Tear down cross-scene listeners** in `this.events.once(SHUTDOWN, …)` — `game.events`/`registry`
  outlive a scene, so listeners double-register on restart otherwise.
- **Worker task system** (plan 002): units move via A* (`src/systems/pathfind.ts` — `findPath` returns
  `[]`=already-there / `null`=unreachable / a tile list; `reachableAdjacent` finds a stand-tile next to
  a target). Orders are a `TaskQueue` of `Action`s (`src/systems/tasks.ts`); **tap = act-now (replace),
  long-press ≥`LONGPRESS_MS` = append**, resolved on `pointerup` with a drag reject. Building is a timed
  on-site job: place a passable *blueprint* (wood reserved on placement), worker paths to a reachable
  adjacent tile and works `BUILD_MS`, then it becomes a blocking wall. `hudHitTest` is visibility-aware
  so hidden buttons don't swallow world taps. Pathing obstacles = completed walls + live trees.
- **Pixel art:** integer scaling, `pixelArt: true`, nearest-neighbour; design at a fixed low base
  resolution and scale up.
- Keep functions small; name for the domain (resource, node, recipe, stockpile), not the framework.

## Testing

A **three-tier deterministic harness** (plan 007 — see DECISIONS.md for the *why*). The old
single live-game playthrough was retired: it raced real-time walks/chops and broke whenever anything
on its one linear path changed. Now:

| Tier | What | Command | When |
| --- | --- | --- | --- |
| **1 — unit** | Pure systems (`pathfind`/`tasks`/`combat`/`grid`/`stats`/`Inventory`) + data invariants, in plain Node | `npm test` | most iteration |
| **2 — scenario** | Browser-real integration/render/input, one behaviour per spec, driven deterministically | `npm run e2e` | when a change needs browser fidelity |
| **3 — boot canary** | Production bundle boots, reaches Game+UI, renders (compiles shaders), zero console errors | `npm run smoke` | before shipping |

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
