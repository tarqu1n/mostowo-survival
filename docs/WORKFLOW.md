# Workflow & Conventions

How to work on Mostowa Survival from any device. Update this whenever the "how" changes.

## Git

- **Feature branch for agent work:** `claude/mostowa-survival-setup-qdqfgj` (current). Develop
  and push here; open a PR to `main` when a slice is ready.
- Commit in small, described steps. Push often (work may resume on another device).

## Hermes dev skills (how we build)

Skills come from the `hermes-ai-tooling` repo and are available in-session:

- **`plan-feature`** — produces a step-by-step plan under `plans/`. Use before writing non-trivial code.
- **`critique-plan`** — independent adversarial review of a plan before executing.
- **`execute-plan`** — carries out the plan step-by-step with check-ins.

Loop: *plan → critique → (revise) → execute → commit → push*.

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
npm run preview   # serve the production build locally (http://localhost:4173/Mostowa-survival/)
npm run typecheck # types only, no build
```

Verified working on Node 22 (Phaser 3.90, Vite 6, TypeScript 5.9). `npm run build` typechecks then
bundles; the ~1.4 MB JS chunk is Phaser itself (~341 KB gzipped) — expected, not worth splitting.

**Deploy: GitHub Pages via GitHub Actions** (`.github/workflows/deploy.yml`). On push to `main` (or
manual "Run workflow"), it runs `npm ci` → `npm run build` → publishes `dist/`. Assets resolve under
`/Mostowa-survival/` in production (Vite `base`, see `vite.config.ts`; override with `BASE_PATH` if
the repo is renamed or served elsewhere).

> **One-time setup (only Matt can do this):** repo **Settings → Pages → Source: "GitHub Actions"**.
> The Action won't publish until this is set and the branch reaches `main`. Live URL will be
> `https://tarqu1n.github.io/Mostowa-survival/`.

### Smoke-testing a build

Headless check that the game actually boots (canvas present, no runtime errors) without a device:
`npm run build && npm run preview`, then load the preview URL in a headless Chromium and assert a
non-zero `<canvas>`. Chromium is pre-installed at `/opt/pw-browsers/` in web sessions.

## Code conventions

_To be firmed up as we go. Starting position:_

- **Data-driven design.** Items, recipes, buildings, resource nodes = data (TS/JSON), not
  hard-coded logic. Adding content should mean editing data, not writing new systems.
- **Systems over god-objects.** Keep inventory / crafting / time-of-day / resources as separate,
  testable modules.
- **Scenes:** Boot → Preload → Menu → Game (world) → UI overlay. Keep UI decoupled from world logic.
- **Pixel art:** integer scaling, `pixelArt: true`, nearest-neighbour; design at a fixed low base
  resolution and scale up.
- Keep functions small; name for the domain (resource, node, recipe, stockpile), not the framework.
