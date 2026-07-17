# Workflow

How to work on Mostowo Survival from any device — git, the build loop, run/build/deploy, and tests.
Update this whenever the "how" changes. **Code structure/patterns** (how each `src/` seam is written)
live separately in [CONVENTIONS.md](CONVENTIONS.md).

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

> Cross-device note: the `hermes-dev` plugin auto-loads via committed `.claude/settings.json`
> (`extraKnownMarketplaces` → the `hermes-skills` marketplace on GitHub `third-bridge/hermes-ai-tooling`,
> plus `enabledPlugins`). A fresh session on any device picks it up (approve the marketplace trust
> prompt once). To update after the plugin changes on `master`: `/plugin marketplace update
> hermes-skills` then `/plugin update hermes-dev`, and restart the session.

## Stack

**Phaser 3 + TypeScript + Vite.** Single-page static app, no backend. Client-side saves
(`localStorage` → IndexedDB later).

## Run / build / deploy

```bash
npm install       # install deps
npm run dev       # local dev server with hot reload (Vite)
npm run editor    # dev-only Map Builder editor (React shell, opens editor.html) — never in the prod build
npm run build     # typecheck (tsc --noEmit) + static production build -> dist/
npm run preview   # serve the production build locally (http://localhost:4173/mostowo-survival/)
npm run typecheck # types only, no build

# Lint/format/markdown (see STANDARDS.md for the full posture)
npm run lint      # ESLint (flat config, eslint.config.js)
npm run lint:fix  # ESLint --fix
npm run lint:md   # markdownlint-cli2 (docs are LLM context — token-lean lint posture)
npm run format    # Prettier --write (not .md — markdownlint owns that)
npm run format:check
npm run check     # typecheck && lint && lint:md && format:check && test — the full local gate

# Tests (see testing.md for the two-speed loop)
npm test          # Tier-1 unit tests (Vitest, plain Node, fast)
npm run test:watch# Tier-1 watch mode — reruns only the tests affected by the file you just saved
npm run e2e       # Tier-2 deterministic Playwright scenarios (starts its own `vite dev`)
npm run smoke     # Tier-3 boot canary (needs `npm run preview` running)
```

**Pre-commit hook** (husky + lint-staged, installed automatically by `npm install` via the `prepare`
script): `.husky/pre-commit` runs `npx lint-staged` — lints/formats **staged files only**, so it's
fast even mid-refactor on a phone. It does **not** run the full typecheck/test suite — that's
`npm run check`'s job (and CI's). Skip it with `git commit --no-verify` when you need to (e.g. a WIP
commit you'll clean up before pushing).

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

## Dev menu (in-game debug tools)

A **DEV** toggle at the bottom-right of the HUD opens an olive dev-menu panel (built from the
`src/ui` kit in `UIScene`). Current tools:

- **⟳ Randomise** — clears the scattered world (all resource nodes + zombies, leaving your
  walls/blueprints) and scatters a fresh random batch: a mix of trees/rocks/bushes plus 1–4 zombies
  (kept a few tiles clear of the player). Emits `debug:randomise` → `GameScene.randomiseWorld`.
- **Day/night** — flips the cycle to the opposite phase of the current in-game day (label shows the
  target: "GO NIGHT"/"GO DAY"). Emits `debug:toggleTime` → `GameScene.toggleDayNight`.

**Add new debug affordances here** (a button in the panel → a `debug:*` event → a `GameScene`
handler) rather than scattering ad-hoc buttons across the HUD.

## Testing

→ [how the test harness works, scenario API, adding a test](testing.md)
