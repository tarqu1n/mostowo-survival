# Project-setup decisions

Engine, TS/Vite, hosting, git/workflow, trunk-based flow, and editor styling.

Part of the [decision log index](../DECISIONS.md). Newest first.

---

## 2026-07-14 — [DECIDED] Editor styling → Tailwind v4 + shadcn/ui (dev-only)

The dev-only Map Builder editor (`src/editor/**`) migrated from a 1292-line hand-written `editor.css`
to **Tailwind v4** (CSS-first, no config — `@tailwindcss/vite`) + **shadcn/ui** as the component layer
(copied into `src/editor/ui/`, own-the-code, not an npm dep). Rationale: colocated styling for fast
visual iteration, and reusable accessible primitives instead of re-hand-rolling UI. Key choices:

- **One palette source of truth.** The brown/cream palette is a single set of `@theme` tokens in
  `editor.css`; shadcn's semantic CSS vars are wired to those same tokens (one palette, not two).
- **Dev-only, zero prod impact.** Tailwind is imported only by `editor.css` → `editor.html`. The game
  page (`index.html` / Phaser) never loads it, so Tailwind's preflight never touches the game, and the
  editor stays excluded from `vite build` (`rollupOptions.input: 'index.html'`).
- `editor.css` is now just the Tailwind entry: `@import`, the token blocks, a minimal page baseline,
  the `pixelated` utility, and the `lib-strip-play` keyframe — no hand-written component rules.

Full plan + step history: `plans/020-editor-tailwind-shadcn.md`.

## 2026-07-11 — [DECIDED] Direct tweaks auto-push on green; review gates stay on the plan loop only

For small changes Matt requests directly (tweaks/fixes/debug helpers, not plan steps): implement →
verify green (`npm run build` + `npm run smoke` where relevant) → commit → push to `master` without
stopping to ask. The stop-for-review checkpoints below apply to `plan-feature`/`critique-plan`/
`execute-plan` work, **not** to these one-off tweaks. Pause only if it's not green, ambiguous/
hard-to-reverse, or actually plan-scale. Rationale: ends the commit-then-ask friction on small live-test
iterations while keeping human review where it matters (the plan loop). Detail in WORKFLOW.md.

## 2026-07-11 — [DECIDED] Stop for Matt's review at plan / critique / each step (no unattended sweep)

The plan→critique→execute loop must **pause for Matt's input** at three gates: after a plan is written
(before critique), after the critique (before executing), and at the end of **every** executed step (per
the `execute-plan` skill's check-ins). Do not run the whole loop autonomously, even when told to "build
it" — that authorises the work, not skipping review. Rationale: Matt wants to review/steer before code
lands; a fully autonomous sweep robbed him of that. Detail in WORKFLOW.md → Review checkpoints.

## 2026-07-11 — [DECIDED] Genre & platform: browser pixel-art survival base-builder

Single-player, runs in the browser, no server. Themed around Mostowo (camping destination).
Rationale: fun personal project; browser = zero-install, shareable by link; no backend keeps
it cheap and simple to host and reason about.

## 2026-07-11 — [DECIDED] Engine: Phaser 3

User's pick. Mature, huge tutorial/ecosystem base, first-class 2D + pixel-art support
(`pixelArt: true`, nearest-neighbour scaling), scene system suits a game with menus + world + UI.

## 2026-07-11 — [DECIDED] Build workflow: Hermes plan → critique → execute skills

Use the `hermes-ai-tooling` dev skills for every non-trivial feature so work is structured and
resumable across devices. See docs/WORKFLOW.md.

## 2026-07-11 — [DECIDED] Record-everything-in-repo rule

All reusable decisions/preferences/workflows are committed to the repo, never left only in chat,
because sessions hop between devices. This log is part of that.

## 2026-07-11 — [DECIDED] Trunk-based solo workflow: commit each stage, push to `master`, auto-deploy

Solo project — no feature branches, no PRs. Work on `master`; commit each completed stage and push
straight to `master`. Every push to `master` triggers the GitHub Pages Action to build + deploy, so
"ship" = `git push`. Rationale: minimises ceremony for a one-person project and gives a live URL that
always reflects trunk. (Set `master` as the GitHub default branch in Settings — one-time.)

## 2026-07-11 — [DECIDED] Language: TypeScript; Build tool: Vite

A survival/crafting game grows complex fast; types pay off in inventory/recipe/save code and make
cold-resuming on another device far easier. Vite gives instant HMR and a trivial static `dist/`
build that drops straight onto a static host.

## 2026-07-11 — [DECIDED] Hosting: GitHub Pages via GitHub Actions

Push to the deploy branch → Action runs `vite build` → publishes. Deploy config lives in-repo (no
external accounts), which fits the cross-device rule. itch.io kept in mind as an optional *second*
distribution target later for reaching players.

## 2026-07-11 — [DECIDED] Mobile-first, portrait, touch — scales to larger screens

Primary target is playing on a phone (portrait, touch). Must scale to any screen size (fit/letterbox
on desktop now; richer big-screen framing later). Scaffold: Phaser `Scale.FIT` from a fixed portrait
base resolution, `pixelArt: true`, touch as the baseline input. Rationale: Matt plays on his phone;
designing mobile-first avoids a painful retrofit.
