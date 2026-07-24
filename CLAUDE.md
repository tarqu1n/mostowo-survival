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

## Home server: guppi (non-prod)

**guppi is Matt's personal, NON-PRODUCTION home server** (the Beelink in the `guppi` repo) — safe to
connect to. A Claude Code **cloud session CAN reach it over Tailscale** using the `TAILSCALE_KEY` +
`GUPPI_PASSWORD` env vars it already carries (SSH login user is `guppi`, not `matt`) — do **not** say
guppi is unreachable from a sandbox. This is how the **Gemini image-gen key**
(`guppi/house-helper/.env`) is fetched for the item-icon + sprite pipelines. Verified end-to-end
recipe (install tailscale → userspace networking + SOCKS5 → `gssh`):
**[docs/MOBILE-EDITOR-ACCESS.md](docs/MOBILE-EDITOR-ACCESS.md#claude-getting-a-shell-on-guppi--working-on-the-build-there)**.
Keep any fetched key in-memory only; never commit or echo it.

## Build workflow (Hermes dev skills)

Build using the **Hermes dev skills** (from the `hermes-ai-tooling` repo): `plan-feature` →
`critique-plan` → `execute-plan`, one step at a time. Wiring, review gates, and the day-to-day loop:
[docs/WORKFLOW.md](docs/WORKFLOW.md).

## Architecture map

Data-driven content · pure systems · decoupled scenes:

- **`src/data/`** — content as data (`ITEMS`/`NODES`/`BUILDABLES`) + shared schemas (`types.ts`:
  `BaseStats`/`CombatantStats`/`ObjectStats`; `tileset.ts`: `ACTIVE_TILESET`).
- **`src/systems/`** — pure, testable logic: `pathfind` (A*), `tasks` (order queue) + `orders`
  (Action-kind registry — per-kind order metadata/decision core, mirrors `StructureManager`), `grid`,
  `Inventory`, `combat`, `mapFormat/` (schema/parse/serialize/resize behind a barrel).
- **`src/entities/`** — actor classes owning their sprite (`Character` → `PlayerCharacter`/`MonsterCharacter`).
- **`src/scenes/`** — Boot → Preload → MainMenu → Game (world); the HUD is a DOM overlay, not a scene
  (see `src/hud/`). Comms with the HUD via `game.events` (`build:*`, `mode:*`, `npc:*`, …) + shared
  `registry`. Game boots into an **authored map** loaded at runtime (`systems/mapRuntime.ts`, plan 018 —
  not procedural gen). `fx`/`input`/`build`/`combat`/`world` hold the extracted scene managers (`world/`
  = state-owning world subsystems, e.g. `ResourceNodeManager`/`EnemyManager`/`CompanionManager` — the
  last owns the single `NpcCharacter` ally; `combat/CombatController`). `GameScene` stays a thin
  composition root.
- **`src/hud/`** — the **DOM/React HUD overlay** (plan 046, Field Kit) floating over the canvas,
  replacing the deleted Phaser HUD + `src/ui/` kit. `store.ts` (Zustand mirror) ← `bridge.ts` (the sole
  `game.events`/`registry` touch-point; typed `emit` for HUD→world) → `GameHud.tsx` + `components/*`.
  Page-level, persists across GameScene restart; taps gated by DOM `pointer-events`. shadcn primitives
  copied into `src/hud/ui/`. Seam detail: [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
- **`src/render/`** — baked textures (e.g. `glowTexture.ts`), not frame-loop shaders.
- **`src/editor/`** — dev-only Map Builder (`editor.html`), styled with **Tailwind v4 + shadcn/ui**
  (canonical palette as `@theme` tokens in `editor.css`); excluded from the prod build. Its plain
  (unscoped, preflight-injecting) Tailwind ships only in `editor.html` — the game page loads its own
  Tailwind scoped under `#hud-root` (see `src/hud/`). State is Zustand: `store/editorStore.ts` composes domain `store/slices/*`;
  `EditorScene.ts` composes `scene/*` controllers (input/camera/texture-bake/render). Shared pure
  modules: `hooks/usePanZoom` + `zoom`/`regionGeometry`/`pixelAlpha` (unit-tested). Compact/touch shell
  below a breakpoint (`hooks/useIsCompact.ts`) swaps panels for drawers and adds a per-tool
  `ContextBar.tsx` mirroring keyboard actions on-screen. Hosted always-on on the home server **guppi**
  for phone authoring — how Claude gets a shell there and works on the live build:
  [docs/MOBILE-EDITOR-ACCESS.md](docs/MOBILE-EDITOR-ACCESS.md).
- **`tests/`** — three-tier harness (unit / scenario / boot canary).

Patterns each seam follows: [docs/CONVENTIONS.md](docs/CONVENTIONS.md).

## Status

Core loop, worker task system, build/blueprints, basic combat + a first enemy, the Pixel Crawler art
swap, a three-tier test harness, a first day/night + hunger survival slice, a generic monster AI +
swappable weapons system, the **night-wave + campfire-defense loop** (paced treeline spawns that
seek the fire, per-night escalation, loop-close; fire-out = darkness, not a loss), and **destructible
base-defence walls** (a 4-way palisade the player rotates + deconstructs; mobs siege a walled-off base
and take thorns damage) unified with the campfire under a **`StructureManager` behavior registry**
(plan 037), the **spike trap** (a trigger-once armed floor tile re-armed each morning by a queued
worker order — the third `StructureManager` behavior module, plan 040), the **NPC companion** (one
dev-spawned ally — day gather/repair off a separate `baseSupply` stockpile, 3 night postures, mob-aggroable
→ downed → auto-revives at dawn, plan 042), and the **workbench crafting station** (the first crafting
content — a buildable, mob-bashable/player-repairable HP bench that runs a player-queued `craft` worker
order at an HP-scaled rate to deliver items; the 4th `StructureManager` module, plan 048) have all
landed. **Full feature/plan history:** [docs/STATUS.md](docs/STATUS.md).

**Next:** the first-playable **MVP path is complete** (see [docs/ROADMAP.md](docs/ROADMAP.md): ✅ combat
rework → ✅ night wave + campfire defense → ✅ base-defence walls → ✅ trap (plan 040) → ✅ hunger (plan 041) →
✅ NPC (plan 042)); post-MVP **crafting** has begun (✅ workbench station, plan 048 → equippable items +
torch/durability/combat next, plan 049). Full vision in
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
- Art & assets pipeline (packs, catalog, tiles, icons, rendering) → [docs/README.md](docs/README.md#art--assets-pipeline). **Generating a tile/icon/sprite/prop? Default = the Gemini image-gen + post-process pipeline; pure code-synthesis is only for seamless-tiling terrain. Routing table: [docs/ASSETS.md](docs/ASSETS.md#which-pipeline-pick-this-before-generating-anything).**
