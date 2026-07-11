# Mostowa Survival

A browser-based **pixel-art survival / base-building game**, themed around Mostowa (the
camping destination this project is named after). Built with **Phaser 3**. Single-player,
runs entirely in the browser, no backend.

This file is loaded on every turn — keep it a **lean index** and push detail into the
linked docs. When a decision, preference, or workflow is settled, record it in the repo
(see below) so any future session on any device can pick up without re-discovering it.

## Cross-device / cross-session rule

This project is worked on from **whatever device is to hand** (often mid-journey, on a
phone or laptop, across many short sessions). Therefore:

- **Every reusable decision, preference, or workflow goes in the repo**, never only in chat.
- Deploy steps, code conventions, and "how do I run this" live in [docs/WORKFLOW.md](docs/WORKFLOW.md).
- The *why* behind non-obvious choices lives in [docs/DECISIONS.md](docs/DECISIONS.md) (a running log).
- If you learn something a future session would waste time rediscovering, write it down here or in a linked doc.

## Build workflow (Hermes skills)

We build using the **Hermes dev skills** (from the `hermes-ai-tooling` repo):

1. `plan-feature` → write a step-by-step plan into `plans/`.
2. `critique-plan` → fresh-eyes adversarial review of that plan.
3. `execute-plan` → carry it out one step at a time.

See [docs/WORKFLOW.md](docs/WORKFLOW.md) for how these are wired in and the day-to-day dev loop.

## Status

Project bootstrapping. Stack and hosting under discussion — see
[docs/DECISIONS.md](docs/DECISIONS.md) for what's settled vs open.

## Docs

- [docs/DECISIONS.md](docs/DECISIONS.md) — decision log (what we chose and why)
- [docs/WORKFLOW.md](docs/WORKFLOW.md) — run / build / deploy / code conventions
- [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md) — what the game *is* (mechanics, scope, theme)
