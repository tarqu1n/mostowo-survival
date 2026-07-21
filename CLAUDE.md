# Mostowo Survival

A browser-based **pixel-art survival / base-building game** (**Phaser 3 + TypeScript + Vite**),
themed around Mostowo — the camping destination it's named after. Single-player, runs entirely in
the browser, no backend.

> **Token budget:** this file loads on every turn — keep it a **lean index**. Push detail into the
> linked docs and reference it by pointer; don't inline it here.

## Cross-device / cross-session rule

Worked on from **whatever device is to hand** (often on a phone, mid-journey, across many short
sessions). So **every reusable decision, preference, or workflow goes in the repo**, never only in
chat — if a future session would waste time rediscovering it, write it down here or in a linked doc.

## Build workflow (Hermes dev skills)

Build using the **Hermes dev skills** (from the `hermes-ai-tooling` repo): `plan-feature` →
`critique-plan` → `execute-plan`, one step at a time. Wiring, review gates, and the day-to-day loop:
[docs/WORKFLOW.md](docs/WORKFLOW.md).

## Architecture map

Data-driven content · pure systems · decoupled scenes:

- **`src/data/`** — content as data (`ITEMS`/`NODES`/`BUILDABLES`) + shared schemas (`types.ts`:
  `BaseStats`/`CombatantStats`/`ObjectStats`; `tileset.ts`: `ACTIVE_TILESET`).
- **`src/systems/`** — pure, testable logic: `pathfind` (A*), `tasks` (order queue), `grid`,
  `Inventory`, `combat`.
- **`src/entities/`** — actor classes owning their sprite (`Character` → `PlayerCharacter`/`MonsterCharacter`).
- **`src/scenes/`** — Boot → Preload → MainMenu → Game (world) + `UIScene` HUD overlay; comms via
  `game.events` (`build:*`) + shared `registry`. Game boots into an **authored map** loaded at runtime
  (`systems/mapRuntime.ts`, plan 018 — not procedural gen). `fx`/`input`/`build`/`world` hold the extracted
  scene managers (`world/` = the state-owning world subsystems, e.g. `ResourceNodeManager`/`EnemyManager`).
- **`src/ui/`** — Container-based UI kit (`Button`, `Panel`, `arrangeRow/Column/Grid`, `theme`).
- **`src/render/`** — baked textures (e.g. `glowTexture.ts`), not frame-loop shaders.
- **`src/editor/`** — dev-only Map Builder (`editor.html`), styled with **Tailwind v4 + shadcn/ui**
  (canonical palette as `@theme` tokens in `editor.css`); excluded from the prod build — the game
  page never loads Tailwind. Compact/touch shell below a breakpoint (`hooks/useIsCompact.ts`) swaps
  panels for drawers and adds a per-tool `ContextBar.tsx` mirroring keyboard actions on-screen.
  Hosted always-on on the home server **guppi** for phone authoring — how Claude gets a shell there
  and works on the live build: [docs/MOBILE-EDITOR-ACCESS.md](docs/MOBILE-EDITOR-ACCESS.md).
- **`tests/`** — three-tier harness (unit / scenario / boot canary).

Patterns each seam follows: [docs/CONVENTIONS.md](docs/CONVENTIONS.md).

## Status

Core loop, worker task system, build/blueprints, basic combat + a first enemy, the Pixel Crawler art
swap, a three-tier test harness, a first day/night + hunger survival slice, a generic monster AI +
swappable weapons system, the **night-wave + campfire-defense loop** (paced treeline spawns that
seek the fire, per-night escalation, loop-close; fire-out = darkness, not a loss), and **destructible
base-defence walls** (a 4-way palisade the player rotates + deconstructs; mobs siege a walled-off base
and take thorns damage) unified with the campfire under a **`StructureManager` behavior registry**
(plan 037), and the **spike trap** (a trigger-once armed floor tile re-armed each morning by a queued
worker order — the third `StructureManager` behavior module, plan 040) have all landed. **Full
feature/plan history:** [docs/STATUS.md](docs/STATUS.md).

**Next:** the ordered path to a first playable MVP is in [docs/ROADMAP.md](docs/ROADMAP.md) (✅ combat
rework → ✅ night wave + campfire defense → ✅ base-defence walls → ✅ trap (plan 040) → ✅ hunger (plan 041) → NPC).
Full vision in
[docs/GAME-DESIGN.md](docs/GAME-DESIGN.md); [docs/DECISIONS.md](docs/DECISIONS.md) for settled vs open.

## The game in one line

Camped at **Mostowo** when the **old woods wake**: by day scavenge the camp/forest, by night fortify
and defend your base as the dead and worse come out of the treeline. Pillars: **base building ·
survival · crafting · base defense**, on a **day/night cycle**. Dark-fantasy, grotty but funny. Full
vision in [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md).

## Docs

Full grouped map: [docs/README.md](docs/README.md). Load the one leaf a task needs. Most-used directly:

- [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md) — what the game *is* (premise, day/night loop, enemies, pillars, MVP)
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — architecture patterns per `src/` seam (data-driven, scenes, input gating, worker tasks)
- [docs/STANDARDS.md](docs/STANDARDS.md) — tooling (lint/format/hooks), naming, TS posture, commit style
- [docs/WORKFLOW.md](docs/WORKFLOW.md) — run / build / deploy + review gates; tests → [docs/testing.md](docs/testing.md)
- [docs/DECISIONS.md](docs/DECISIONS.md) — decision-log index (what we chose and why; links to topic shards)
- [docs/STATUS.md](docs/STATUS.md) — current state of what's built, by subsystem
- Art & assets pipeline (packs, catalog, tiles, icons, rendering) → [docs/README.md](docs/README.md#art--assets-pipeline)
