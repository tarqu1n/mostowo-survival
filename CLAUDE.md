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
- **`src/scenes/`** — Boot → Preload → MainMenu → Game (world) + `UIScene` HUD overlay; comms via
  `game.events` (`build:*`) + shared `registry`.
- **`src/ui/`** — Container-based UI kit (`Button`, `Panel`, `arrangeRow/Column/Grid`, `theme`).
- **`src/render/`** — baked textures (e.g. `glowTexture.ts`), not frame-loop shaders.
- **`tests/`** — three-tier harness (unit / scenario / boot canary).

Patterns each seam follows: [docs/CONVENTIONS.md](docs/CONVENTIONS.md).

## Status

Core loop, worker task system, build/blueprints, basic combat + a first enemy, the Pixel Crawler art
swap, a three-tier test harness, a first day/night + hunger survival slice, and a generic monster AI +
swappable weapons system have all landed. **Full feature/plan history:**
[docs/STATUS.md](docs/STATUS.md).

**Next:** enemy night-waves + the equipment queue — see [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md)
MVP slice; [docs/DECISIONS.md](docs/DECISIONS.md) for settled vs open.

## The game in one line

Camped at **Mostowo** when the **old woods wake**: by day scavenge the camp/forest, by night fortify
and defend your base as the dead and worse come out of the treeline. Pillars: **base building ·
survival · crafting · base defense**, on a **day/night cycle**. Dark-fantasy, grotty but funny. Full
vision in [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md).

## Docs

- [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md) — what the game *is* (premise, day/night loop, enemies, pillars, MVP)
- [docs/STATUS.md](docs/STATUS.md) — what's **built so far** (feature/plan history)
- [docs/LORE.md](docs/LORE.md) — intro story + real-Mostowo people/places/stories that theme the game
- [docs/ASSETS.md](docs/ASSETS.md) — art pipeline: active pack, sprite extraction, what's wired, where assets live
- [docs/ASSET-EXPERIMENTS.md](docs/ASSET-EXPERIMENTS.md) — art R&D log: tileset candidates, AI-gen trials, Gemini pipeline
- [docs/DECISIONS.md](docs/DECISIONS.md) — decision log (what we chose and why)
- [docs/RENDERING.md](docs/RENDERING.md) — custom PostFX pipelines + "when to reach for a shader"
- [docs/WORKFLOW.md](docs/WORKFLOW.md) — run / build / deploy / test commands + review gates
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — code conventions (data-driven design, scene wiring, input gating, worker tasks)
