# Decision Log

Newest at the top. Each entry: what we decided, and *why*. Mark open questions clearly so a
future session knows what's still up for grabs.

Format: `YYYY-MM-DD — [DECIDED|PROPOSED|OPEN] Title` then a short rationale.

---

## 2026-07-11 — [DECIDED] Genre & platform: browser pixel-art survival base-builder

Single-player, runs in the browser, no server. Themed around Mostowa (camping destination).
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

## 2026-07-11 — [DECIDED] Language: TypeScript; Build tool: Vite

A survival/crafting game grows complex fast; types pay off in inventory/recipe/save code and make
cold-resuming on another device far easier. Vite gives instant HMR and a trivial static `dist/`
build that drops straight onto a static host.

## 2026-07-11 — [DECIDED] Hosting: GitHub Pages via GitHub Actions

Push to the deploy branch → Action runs `vite build` → publishes. Deploy config lives in-repo (no
external accounts), which fits the cross-device rule. itch.io kept in mind as an optional *second*
distribution target later for reaching players.

## 2026-07-11 — [DECIDED] Art pipeline: programmatic placeholders first

Start with generated/coloured-rect placeholder art so we can build and feel the mechanics quickly
(ideal for on-the-go sessions), then swap in real pixel art (free CC0 tileset and/or hand-drawn)
once the slice is fun. Keeps art off the critical path.

## 2026-07-11 — [DECIDED] Premise & core loop: zombie apocalypse at Mostowa, day/night cycle

Camping at Mostowa when a zombie apocalypse hits (intro short story). Four pillars: base building,
survival, crafting, base defense. **Day** = scavenge camp/forest/surroundings for resources;
**base phase** = fortify (walls/traps), craft, unlock crafting stations; **night** = zombie animals,
humans, creatures come through the map. **Enemies are roaming (don't attack unless aggro'd) or
attacking** — this deliberately punishes staying out at night and makes "get home and defend" the
correct play. Full detail in GAME-DESIGN.md. Rationale: gives the day/night cycle real risk/reward
teeth and a clear emotional arc each cycle.

## 2026-07-11 — [DECIDED] Mobile-first, portrait, touch — scales to larger screens

Primary target is playing on a phone (portrait, touch). Must scale to any screen size (fit/letterbox
on desktop now; richer big-screen framing later). Scaffold: Phaser `Scale.FIT` from a fixed portrait
base resolution, `pixelArt: true`, touch as the baseline input. Rationale: Matt plays on his phone;
designing mobile-first avoids a painful retrofit.

## 2026-07-11 — [DECIDED] Multi-map world: bolt-on areas + fast-travel special maps

World is many discrete maps, not one continuous map. Start map = camp + surroundings; adjacent areas
unlock as new bolt-on maps; special maps reached via fast travel once **car (repaired)** or **boat
(built)** is unlocked. Build a **data-driven map registry** with connections + unlock gates, persisted
in the save — don't hard-wire one world. Rationale: cheap content expansion and a clear progression/
exploration hook; decided early because it shapes the scene/loading architecture.

## 2026-07-11 — [DECIDED] Map is based on the real Mostowa site

The playable map traces a Google Maps screenshot of the actual camping spot; people, stories, and
landmarks of the place theme the content (LORE.md). Rationale: site-specific identity is what makes
this ours, not a generic zombie game.

## 2026-07-11 — [DECIDED] Art identity: dark & grotty, but humorous

Grimy survival-horror palette with comic items/enemies/visual gags. Rationale: distinctive tone,
and humour keeps a grim premise fun.

## 2026-07-11 — [DECIDED] Asset pipeline: free CC0 tilesets + Gemini "Nano Banana" (via guppi)

Start with CC0 tilesets (Kenney first) for a coherent base; generate bespoke on-theme items/enemies
with `gemini-2.5-flash-image` mirroring `guppi/house-helper/catalog_icons.py`. Key lives on the home
server (`GEMINI_API_KEY`, gitignored, LAN-only) so generation runs from a guppi-reachable machine and
processed sprites get committed. Detail in ASSETS.md.

---

## Open questions

- **[OPEN] Skill loading across devices:** install the `hermes-dev` plugin via the `hermes-skills`
  marketplace vs vendoring skills into `.claude/skills/`. (Tracked in WORKFLOW.md.)
- **[OPEN] MVP vertical slice details:** exact mechanics/scope for the first playable — to be nailed
  down by a `plan-feature` plan. Draft slice is in GAME-DESIGN.md.
