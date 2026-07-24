# HUD build-stack decision — author the HUD in HTML, not Phaser

Why the in-game HUD is a **DOM/React overlay** rather than hand-placed Phaser — the engine
rationale behind plan 046 (shipped as `src/hud/`). Independent of which *visual* direction won
(see [README.md](README.md) for the pitch, research, and the three directions).

**Recommendation: a DOM/React HUD overlay over the Phaser canvas.** The Map Builder
(`src/editor/`) already runs React + Tailwind v4 + shadcn/ui, kept out of the game bundle —
the pipeline is proven. This matters more now: scrollable catalog grids, drag-to-pin, tabs
and safe-area layout are all things the browser gives for free.

- **DOM / React owns:** HUD bars, meters, day/night dial, resource counts; **hotbar**,
  build catalog, spellbook, pack, inspect card, companion & pause menus; scrollable grids,
  drag-to-pin, tabs (reusing the editor's shadcn primitives + Tailwind `@theme` tokens);
  safe-area insets, responsive layout, focus/accessibility.
- **Phaser keeps:** world, camera, entities, lighting; *in-world* markers that must live in
  world space (build ghost + grid snap, target outline, floating combat/gather text,
  monster HP bars, queue markers); gesture mechanics on the canvas (tap / long-press paint /
  pan / pinch) and the twin-thumb move/aim input.
- **Costs:** a thin event bridge (`game.events` ↔ React state); coordinate mapping for the
  few DOM→world actions; Tailwind loads on the game page (scoped; editor proves it). The
  alternative — hand-rolling flexbox, safe-areas, scrollable grids and a token system in
  Phaser — is the exact debt §1 of the pitch is made of.

Engine choice is **independent** of which look wins; all three directions sit on this stack.
