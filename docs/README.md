# Docs index

Full, grouped map of the project docs. `CLAUDE.md` points here so its always-loaded
surface stays lean — load the one leaf a task needs, not the whole set.

## Game & design

- [GAME-DESIGN.md](GAME-DESIGN.md) — what the game *is*: premise, day/night loop, enemies, pillars, MVP slice
- [ROADMAP.md](ROADMAP.md) — the ordered build path to a first playable MVP (scope locked; post-MVP deferred list)
- [LORE.md](LORE.md) — intro story + real-Mostowo people/places/stories that theme the game
- [GAME-MECHANICS.md](GAME-MECHANICS.md) — tuned mechanics & numbers (costs, fuel, radii, base zone)
- [STATUS.md](STATUS.md) — current state of what's built, by subsystem (+ `plan NNN` refs into `plans/`)

## Decisions (the "why")

- [DECISIONS.md](DECISIONS.md) — date-ordered **index** of every decision; each entry links to its topic shard. Open questions live here too.
- Topic shards (bodies): [rendering](decisions/rendering.md) · [architecture](decisions/architecture.md) · [assets](decisions/assets.md) · [gameplay](decisions/gameplay.md) · [testing](decisions/testing.md) · [project-setup](decisions/project-setup.md)

## Engineering & workflow

- [CONVENTIONS.md](CONVENTIONS.md) — architecture patterns each `src/` seam follows (data-driven, systems, scenes, input gating, worker tasks)
- [STANDARDS.md](STANDARDS.md) — tooling (lint/format/hooks), naming, TS posture, commit style
- [WORKFLOW.md](WORKFLOW.md) — run / build / deploy commands, Hermes skills, review gates
- [testing.md](testing.md) — three-tier harness, scenario API, boot determinism, how to add a test
- [EDITOR.md](EDITOR.md) — dev-only Map Builder (`npm run editor`): panes, tools, map/world file format, persistence contract
- [MOBILE-EDITOR-ACCESS.md](MOBILE-EDITOR-ACCESS.md) — working on the game **from your phone**: the editor hosted on guppi over Tailscale, how autosave reaches GitHub, the **git-conflict playbook** (editor clone vs a phone Claude Code clone both on `master`), and the cloud-container fallback ([`scripts/phone-editor.sh`](../scripts/phone-editor.sh))

## Art & assets pipeline

- [ASSETS.md](ASSETS.md) — art-pipeline **hub**: art direction, retired reference pack, item-icon overview, where files live (points to the two below)
- [wired-art.md](wired-art.md) — the concrete wired-art inventory: active Pixel Crawler tileset, sprite extraction, art-swap frames, runtime weapon pinning
- [assets-catalog.md](assets-catalog.md) — asset catalog & pack-manifest schema: `pack.json`, `regions.json`, atlas regions, type/grid overrides, ingested packs
- [TILE-AUTHORING.md](TILE-AUTHORING.md) — authoring self-made terrain tiles that tile seamlessly against a stock pack (global-band + connector technique)
- [CRAFTPIX.md](CRAFTPIX.md) — importing CraftPix.net asset packs (scripted ingest): theme packs, no-shadow variants, directional-sheet slicing
- [ASSET-EXPERIMENTS.md](ASSET-EXPERIMENTS.md) — art R&D log: tileset candidates, AI-gen trials, `style_match.py`
- [gemini-pipeline.md](gemini-pipeline.md) — operational Gemini item-icon pipeline (endpoint, key, workflow); see also [scripts/gen-icons/README.md](../scripts/gen-icons/README.md)
- [AI-SPRITE-PIPELINE.md](AI-SPRITE-PIPELINE.md) — reusable playbook for **generating animated pack-matching sprites** via Gemini image-to-image + an outline-first cel-shade downscale (Rogue attack was the first); includes prior-art / papers
- [RENDERING.md](RENDERING.md) — custom PostFX pipelines + "when to reach for a shader"

## Archival (decision provenance — the *why* behind already-shipped work)

Load only when you need the rationale/history behind a change that has **already landed** — not current spec.

- Cleanup audit (plan-043 pass, all findings applied): [smells](cleanup/smells.md) (severity-ranked code smells + what was done) · [standards](cleanup/standards.md) (STANDARDS/CONVENTIONS drift in `src/`, each resolved) · [perf](cleanup/perf.md) (`GameScene.update()` hot-path allocation audit) · [extensibility](cleanup/extensibility.md) ("edit data not code" seam + testability proposals)
- UI/HUD overhaul (plan 046, shipped as the `src/hud/` Field Kit): [ui-overhaul/README.md](ui-overhaul/README.md) — research, UX flows, DOM-vs-Phaser build-stack decision, the three design directions + which shipped; interactive mockup of the candidates in [build-ui-options.html](build-ui-options.html)
