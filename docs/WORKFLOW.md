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

## Run / build / deploy

_TBD — filled in once the stack is chosen. Expected shape (Vite):_

```bash
npm install       # install deps
npm run dev       # local dev server with hot reload
npm run build     # static production build -> dist/
npm run preview   # serve the production build locally
```

Deploy target: _TBD (GitHub Pages via Actions is the leading candidate)._

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
