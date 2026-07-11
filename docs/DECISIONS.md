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

---

## Open questions (to resolve in the architecture discussion)

- **[OPEN] Language:** TypeScript vs JavaScript. (Recommendation: TypeScript — a survival/crafting
  game grows complex fast; types pay off in inventory/recipe/save code.)
- **[OPEN] Build tool:** Vite is the strong default (fast HMR, trivial static build).
- **[OPEN] Hosting / deploy:** GitHub Pages via Actions vs itch.io vs Cloudflare/Netlify.
- **[OPEN] Art pipeline:** programmatic placeholder art first vs pull in a free tileset (e.g. Kenney) now.
- **[OPEN] MVP vertical slice:** which mechanics make the first playable build.
