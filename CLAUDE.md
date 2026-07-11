# Mostowo Survival

A browser-based **pixel-art survival / base-building game**, themed around Mostowo (the
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

Core loop + **worker task system** landed (plans 001–002): tap a tree → the worker **pathfinds** to it
(A*, routing around walls + trees) → multi-hit chop → wood into a character `Inventory`. Orders **queue**
(tap = act now / clear; **long-press = append**); **Build** places a passable *blueprint* and the worker
walks over and **builds it over time** into a solid, blocking wall. **Cancel** clears the queue
(blueprints survive). Data-driven items/nodes/buildables (`src/data/`), pure systems (`src/systems/`:
`pathfind`, `tasks`, `grid`, `Inventory`), decoupled `UIScene` HUD. On the **Phaser 3 + TypeScript +
Vite** mobile-first scaffold (Boot→Preload→MainMenu→Game + UI overlay), GitHub Pages auto-deploy.
Verified via headless smoke (`npm run smoke`).

**Basic combat landed (plan 003):** a shared `BaseStats`/`CombatantStats`/`ObjectStats` schema
(`src/data/types.ts`) + pure `systems/combat.ts` resolve melee damage/hit-chance uniformly for
Punch and enemy attacks. Three mutually-exclusive HUD-toggled input modes — **Command** (today's
tap-to-pathfind, unchanged), **Combat** (virtual movepad + Punch button, direct real-time control,
bypasses the pathfinder), **Inspect** (tap any tree/wall/zombie for a stats panel). The first enemy,
a **kid zombie** (data id `kidZombie`), has minimal idle→chasing AI and contact damage; player HP
reaching 0 restarts the scene (no save system yet, so "restart" = back to spawn with the world
reset). The worker/task/pathfinding core is the seam both the zombie's AI and the eventual NPC
companions plug into.

**Active art swapped to Pixel Crawler (plan 005):** `ACTIVE_TILESET` in `src/data/tileset.ts` is
now the **Pixel Crawler** pack — the Zombie Apocalypse pack is retired to reference-only under
`public/assets/`. A Skeleton (Base) mob sprite stands in for the kid zombie (data id/name
unchanged); the player has full 3-way directional facing (enemy flips by movement-x only). See
[docs/ASSETS.md](docs/ASSETS.md) and [docs/DECISIONS.md](docs/DECISIONS.md) for the full picture.

Next: survival systems (day/night, hunger) — see [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md) MVP
slice; [docs/DECISIONS.md](docs/DECISIONS.md) for settled vs open.

## The game in one line

Camping at **Mostowo** when a **zombie apocalypse** hits: by day scavenge the camp/forest, by night
fortify and defend your base. Pillars: **base building · survival · crafting · base defense**, on a
**day/night cycle**. Dark-and-grotty but funny. Full vision in [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md).

## Docs

- [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md) — what the game *is* (premise, day/night loop, enemies, pillars, MVP)
- [docs/LORE.md](docs/LORE.md) — intro story + real-Mostowo people/places/stories that theme the game
- [docs/ASSETS.md](docs/ASSETS.md) — art direction + pipeline (CC0 tilesets, Gemini "Nano Banana" via guppi)
- [docs/DECISIONS.md](docs/DECISIONS.md) — decision log (what we chose and why)
- [docs/WORKFLOW.md](docs/WORKFLOW.md) — run / build / deploy / code conventions
