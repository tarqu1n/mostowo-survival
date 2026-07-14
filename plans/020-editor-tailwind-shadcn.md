# Editor Styling → Tailwind v4 + shadcn/ui

> Status: deployed

## Summary

Migrate the **dev-only Map Builder editor** (`src/editor/**`, served from `editor.html`) from its
single 1292-line hand-written `editor.css` to **Tailwind v4** (CSS-first, no config file) with
**shadcn/ui** as the default component layer. The editor's dark warm-brown palette becomes a single
canonical set of `@theme` tokens, shadcn's CSS variables are wired to those same tokens (one palette,
not two), and every editor React component moves to Tailwind utilities + shadcn primitives. The
Phaser game (`index.html` / `src/main.ts` / scenes / entities) is **untouched** — it never imports
`editor.css` and must never receive Tailwind's preflight. Goal: a canonical token source + colocated
styling so visual iteration is fast, and reusable accessible components (Dialog, Slider, Tabs, Select,
Tooltip, Button, Resizable, …) instead of re-hand-rolling UI.

## Context & decisions

Decisions taken during planning:

- **Migration depth: full** — delete the hand-written `editor.css`. The file is *repurposed*, not
  merely removed: it becomes the lean Tailwind entry (`@import "tailwindcss"`, `@theme` tokens,
  shadcn base layer, and the 2–3 things that genuinely cannot be utilities — see below). "Delete
  editor.css" means all ~1292 lines of component rules go; a small token/base entry remains.
- **Rollout: POC first, then fan out** — set up Tailwind + tokens + shadcn, migrate one hard
  component (`LibraryPanel`) to prove the pattern, then migrate the rest (several in parallel).
- **Comments: only load-bearing ones survive** — carry over comments that explain genuine gotchas;
  drop comments that just restate what a utility says plainly. Known load-bearing rationale to
  preserve (as JSX comments at the relevant `className`):
  - Tab panels use `visibility:hidden` (not `display:none`) so the **Phaser `Scale.RESIZE` canvas in
    the Map panel keeps its layout size and never collapses to 0×0** (`editor.css:204-206`).
  - Zoom-row controls share a **22px height/baseline**, and the row is budgeted to ~200px because the
    Library column is fixed-width (`editor.css:1011`-area, the block just hand-edited).
  - `image-rendering: pixelated` on sprite previews is deliberate (crisp pixel art).
- **shadcn scope: everywhere** — shadcn is the default for all editor UI where a primitive exists
  (Dialog, Slider, Tabs, Select, Tooltip, Button, Card, ScrollArea, Separator, Input, Label,
  DropdownMenu, Resizable, Sonner toast). Panels/toolbar layout that has no shadcn equivalent stays
  as plain Tailwind divs. shadcn is **copy-in, own-the-code** (not an npm dep); it pulls small Radix
  primitives as real deps.

Repo facts the steps rely on (verified):

- **One Vite config** (`vite.config.ts`), two HTML entries: game `index.html`→`src/main.ts`, editor
  `editor.html`→`src/editor/main.tsx`. `build.rollupOptions.input` is pinned to `'index.html'`
  (lines 17-19) so the editor never ships to prod. `react()` plugin always active; `editorApiPlugin()`
  gated to `command === 'serve'`.
- `editor.css` is imported in **exactly one place**: `src/editor/main.tsx:3`. Game baseline styles are
  inlined in `index.html`'s `<style>` block — independent of `editor.css`.
- **No existing Tailwind / PostCSS / CSS-modules.** `tsconfig.json` has **no `paths`**; `vite.config.ts`
  has **no `resolve.alias`**. React 19.2, TypeScript `moduleResolution: bundler`.
- **Global bare-element selectors in `editor.css`** that interact with Tailwind preflight:
  `html, body` (7-19), `button` + `:hover`/`:disabled`/`.is-active` (25-47), `:root { color-scheme }`
  (3-5), `#editor-root` (21-23). No bare `input`/`select`/`a` resets.
- **Dynamic styles that MUST stay inline `style={}` (not utilities)** — sprite-frame rendering in
  `LibraryPanel.tsx` (`backgroundImage`/`backgroundPosition`/`backgroundSize`, `gridTemplateColumns`
  from JS; the `--strip-travel` custom prop feeding `@keyframes lib-strip-play`) and
  `ObjectEditorTab.tsx` (per-frame `backgroundImage`/`Position`/`Size`, frame-grid `gridTemplate*`),
  plus `EditorApp.tsx:145` `gridTemplateColumns` from `libraryWidth` state.

Palette → token mapping (28 distinct hex, from the sweep). Define raw values in `@theme`, then wire
shadcn's semantic CSS vars to them:

|Role|Hex|Suggested token|
|---|---|---|
|app root bg|`#14100f`|`--color-app`|
|deepest inset (inputs, wells)|`#0e0b0a`|`--color-inset`|
|dark inset variant|`#17120f`|`--color-inset-2`|
|raised surface (toolbar)|`#1b1614`|`--color-raised`|
|subtle surface / hover-row|`#241d1a`|`--color-surface-subtle`|
|default surface / button bg|`#2c2420`|`--color-surface`|
|surface/border variant|`#3a302b`|`--color-surface-3`|
|default border / button hover|`#3a2f2a`|`--color-border`|
|muted border|`#6a5d54`|`--color-border-muted`|
|active/pressed brown|`#5a4632`|`--color-accent`|
|active border|`#7a5c3c`|`--color-accent-border`|
|brightest fg / headings|`#f4ecd8`|`--color-fg-bright`|
|primary fg|`#e8e0d8`|`--color-fg`|
|fg variant|`#d8c9bb`|`--color-fg-2`|
|secondary fg|`#c9bcae`|`--color-fg-muted`|
|muted fg|`#a99a8c`|`--color-muted`|
|most-used muted/label|`#8a7f76`|`--color-muted-2`|
|gold accent (dirty dot)|`#e0b020`|`--color-gold`|
|light-gold highlight|`#f0d890`|`--color-gold-light`|
|cyan selection/portal|`#5fd0ff`|`--color-selection`|
|pink accent|`#e0708a`|`--color-pink`|
|warm accent|`#e0a08c`|`--color-warm`|
|danger fg|`#e07a6a`|`--color-danger`|
|danger strong|`#b23b3b`|`--color-danger-strong`|
|danger dark bg|`#4a2420`|`--color-danger-bg`|
|danger light fg|`#f4d0c8`|`--color-danger-fg`|
|toast-ok bg|`#2f4632`|`--color-ok-bg`|
|toast-ok border|`#46703c`|`--color-ok-border`|

shadcn semantic mapping (in `:root`): `--background`=app, `--foreground`=fg, `--card`/`--popover`=raised,
`--primary`=accent w/ `--primary-foreground`=fg-bright, `--secondary`=surface, `--muted`=surface-subtle
w/ `--muted-foreground`=muted-2, `--accent`=border(hover) w/ `--accent-foreground`=gold-light,
`--destructive`=danger-strong w/ `--destructive-foreground`=danger-fg, `--border`=border, `--input`=inset,
`--ring`=accent-border, `--radius`=`4px` (matches the existing `border-radius:4px`).

## Steps

- [x] **Step 1: Install Tailwind v4 + wire Vite + add `@/` path alias** `[inline]`
  - Outcome: installed `tailwindcss` + `@tailwindcss/vite` (dev-deps). `vite.config.ts` — added
    `tailwindcss()` after `react()`, and `resolve.alias` `@`→`src` (via `fileURLToPath`). `tsconfig.json`
    — added `baseUrl: "."` + `paths` `@/*`→`./src/*`. `vitest.config.ts` — added matching `resolve.alias`.
    Verified: `tsc --noEmit` clean; `npm run build` emits only the game entry (`index.html` + game chunks,
    no `editor.html`); `@/editor/EditorApp` resolves under tsc (throwaway probe); `npm run dev` serves both
    `/` (200) and `/editor.html` (200). No Tailwind import added to any game file yet (Step 2). Skipped the
    optional `prettier-plugin-tailwindcss` (plan allows; avoids lint-staged churn).
  - `npm i -D tailwindcss @tailwindcss/vite`. Add `@tailwindcss/vite` to the `plugins` array in
    `vite.config.ts` (after `react()`). Keep `rollupOptions.input: 'index.html'` — the editor stays
    dev-only; Tailwind processes CSS but only emits into the editor bundle because only `editor.css`
    imports Tailwind (next step).
  - Add path alias `@/*` → `./src/*` in **two** places that must agree: `tsconfig.json`
    (`compilerOptions.paths`) and `vite.config.ts` (`resolve.alias`, resolve `@` to the `src` dir).
  - Do **not** add `@import "tailwindcss"` to `index.html` or any game file — Tailwind's preflight must
    never load on the game page.
  - Optional nicety: `npm i -D prettier-plugin-tailwindcss` for class sorting (only if it slots into the
    existing prettier config without churn; skip if it complicates lint-staged).
  - **Baseline (do this before any visual change):** with `npm run editor`, capture reference
    screenshots of the busy panels — Library (atlas + zoom row + animated strip) and the Object editor
    (sprite grid + per-frame previews) — plus one of the game page. These are the manual visual baseline
    for Steps 12–13 (there are no CSS regression tests; editor `__tests__` are logic-only). Save them in
    the session scratchpad, not the repo.
  - Side effects: `vitest.config.ts` and `playwright.config.ts` — if any editor test imports via the new
    `@/` alias later, vitest needs the same `resolve.alias`; add it there too so tests resolve. Check
    `npm run build` (`tsc --noEmit && vite build`) still produces only the game entry.
  - Docs: none yet (batch doc edits in Step 12).
  - Done when: `npm run dev` serves both pages; game page renders unchanged; `tsc --noEmit` passes;
    `@/foo` resolves in an editor file; baseline screenshots captured.

- [x] **Step 2: Define `@theme` tokens + shadcn theme + `cn` util + `components.json`** `[inline]`
  - Outcome: `src/editor/editor.css` head rewritten to the Tailwind entry — `@import 'tailwindcss'`,
    `@theme` palette (28 tokens), `:root` shadcn semantic vars wired to those tokens, `@theme inline`
    binding shadcn utilities, plus `@utility pixelated` and the `lib-strip-play` keyframe. All old
    component rules left in place below (culled in Step 12); the old `.pixelated` class + duplicate
    keyframe left as harmless dupes for the Step 12 cull. Created `src/editor/lib/utils.ts` (`cn`) and
    installed `clsx` + `tailwind-merge`. **Deviation (collision fix, not in plan):** three of the plan's
    suggested palette names collide with shadcn's semantic utility names, so — `#5a4632` is
    `--color-active` (not `--color-accent`); `#a99a8c` is `--color-fg-dim` (not `--color-muted`); and
    `#3a2f2a` (default border) has NO palette token — use shadcn's `border-border`/`bg-border`. This
    keeps every hex defined once with no circular `var()` refs. **`shadcn init` NOT run** — hand-wrote
    `components.json` (plan's sanctioned fallback) to keep the untrusted CLI from touching `index.html`
    or scaffolding a root stylesheet in this non-interactive session. Verified: `tsc --noEmit` clean;
    dev server serves `/editor.html` + `/` both 200; compiled `editor.css` (33 KB) emits all palette
    tokens, wires shadcn vars with no circular refs, keeps the keyframe + `pixelated`; a throwaway
    `bg-surface`/`text-fg`/`bg-primary` probe generated correctly; `git status` shows only
    `editor.css`, `components.json`, `src/editor/lib/` changed — `index.html` untouched, no root CSS.
  - Rewrite `src/editor/editor.css` head into the Tailwind entry: `@import "tailwindcss";` then an
    `@theme { … }` block defining the palette tokens from the table above, a `:root { … }` block with
    shadcn's semantic CSS vars wired to those tokens (mapping above), and `@theme inline { … }` binding
    shadcn's color utilities (`--color-background`, `--color-primary`, …) to the `:root` vars per the
    Tailwind-v4 shadcn convention. **Leave the existing component rules in place below for now** — they
    are removed as each component migrates (final cull in Step 12). Update the file's line-1 comment
    ("plain CSS … no framework") to describe the new role.
  - Preserve the un-utility-able primitives in this entry file: the `@keyframes lib-strip-play`
    animation and its `--strip-travel` consumer, and a `@utility pixelated { image-rendering: pixelated }`
    (Tailwind v4 `@utility`) to replace the `.pixelated` class.
  - Create `cn` helper at `src/editor/lib/utils.ts` (`clsx` + `tailwind-merge`): `npm i clsx tailwind-merge`.
  - `npx shadcn@latest init` — choose CSS-variables theme, base color neutral; point `components.json`
    at: css = `src/editor/editor.css`, components/ui = `src/editor/ui`, utils = `@/editor/lib/utils`,
    aliases using the `@/` alias from Step 1. After init, **overwrite any tokens shadcn generated with
    ours** so there is one palette.
  - **Treat the CLI output as untrusted (critique #2):** this is a non-standard layout (nested CSS entry,
    components under `src/editor/ui`, no Tailwind config file, React 19), so the CLI may mis-detect the
    project, scaffold a *root* global CSS, or edit unexpected files. `git status`/diff **every** file it
    writes; confirm it wrote to `src/editor/editor.css` and **never touched `index.html`** or a new root
    global stylesheet. If init misbehaves, abandon it and hand-write `components.json` + the `cn` util
    instead. Do **not** add `--legacy-peer-deps` reflexively — only if a plain install actually errors on
    a React 19 peer conflict (Radix/sonner/react-resizable-panels support React 19); if you add it, note
    why in the PR.
  - Side effects: confirm the base `button {}` reset in `editor.css` is not yet removed (components still
    rely on it until they migrate).
  - Docs: none yet (Step 12).
  - Done when: a throwaway `<div className="bg-surface text-fg">` shows the correct brown/cream;
    `components.json` + `cn` exist; the CLI's file writes have been diffed and are confined to the editor
    (no `index.html`/root-CSS changes); game page unchanged. **Note:** with full `@import "tailwindcss"`,
    preflight is now live editor-wide, so un-migrated panels (bullets/heading margins/box-sizing) may look
    slightly off until their step lands — this is expected and accepted (single-user local tool), not a
    regression to chase.

- [x] **Step 3: Scaffold the known-needed shadcn primitives (up front, deliberately)** `[delegate sonnet]`
  - Outcome: ran `npx shadcn@latest add button dialog slider tabs select tooltip card scroll-area
    separator input label sonner resizable --yes` (non-interactive, no OAuth). All 13 components landed
    under `src/editor/ui/` (only files there), each importing `cn` from `@/editor/lib/utils`; Button/Dialog
    use semantic tokens (`bg-primary`/`bg-background`/etc.) wired to the brown/cream palette — no per-component
    recolour needed. CLI touched only `package.json`/`package-lock.json`; `index.html`, `editor.css` token
    blocks, and `components.json` all verified untouched; no root global CSS scaffolded. **Deviations:** modern
    shadcn (v4.13) installs the unified `radix-ui` meta-package + `next-themes` (not per-primitive
    `@radix-ui/react-*`), and its own dep-install silently omitted `class-variance-authority`/`lucide-react`
    (imported by button/tabs/dialog/resizable/select/sonner) — had to `npm i` those two by hand. Runtime deps
    added: `radix-ui`, `next-themes`, `react-resizable-panels`, `sonner`, `class-variance-authority`,
    `lucide-react`. `--legacy-peer-deps` NOT needed (clean install on React 19). `tsc --noEmit` clean after the
    manual dep fix. Nothing staged/committed.
  - Add the primitives the later steps actually reference — **not a speculative set**. Each name below is
    used by a specific migration step: `button` (Toolbar/Library/Layers), `slider` (Library zoom),
    `scroll-area` (Library atlas), `tooltip` (Library/Toolbar), `dialog`+`input`+`label`+`select`
    (the four dialogs + Inspector), `tabs` (central tab strip / Object editor), `separator`+`card`
    (Inspector/panels), `resizable` (EditorApp shell), `sonner` (EditorApp toaster):
    `npx shadcn@latest add button dialog slider tabs select tooltip card scroll-area separator input
    label sonner resizable`. (Drop `dropdown-menu` unless a migration step turns out to need it.)
  - **Why up front, not on demand (critique #3):** doing it here — instead of per-step — is what keeps the
    parallel group (Steps 6–11) write-disjoint. If each parallel step ran its own `shadcn add`, they'd all
    mutate `package.json`/lockfile concurrently and clobber each other. Concentrating every dependency
    install in this one sequential step removes that race. The cost (a couple of primitives possibly ending
    up unused) is paid back by Step 12, which trims any that no migration referenced.
  - Verify each lands under `src/editor/ui/` and imports `cn` from the aliased utils path. Quick
    visual/token sanity pass on Button and Dialog (should already read brown/cream via the wired vars — no
    per-component recolour).
  - Side effects: pulls `@radix-ui/*`, `sonner`, `react-resizable-panels`, `class-variance-authority` into
    `dependencies` — this is the one step that installs runtime deps, by design. Confirm `tsc --noEmit`
    passes with the generated files.
  - Docs: none (Step 12).
  - Done when: the listed components exist under `src/editor/ui/`, compile, and render in-theme; all deps
    installed here (no later step needs `npm i`).

- [x] **Step 4: POC — migrate `LibraryPanel.tsx`; establish the conventions** `[inline]`
  - Outcome: migrated `src/editor/panels/LibraryPanel.tsx` fully to Tailwind utilities + shadcn
    (`Button`, `Slider`, `Tooltip`); logic/refs/effects and every `key=` untouched. **Deviation (needed,
    advisor-approved):** the interim base element resets in `editor.css` (`html,body`, `#editor-root`,
    `button`+states) were wrapped in `@layer base { … }` — Tailwind utilities/shadcn live in the layered
    `utilities` layer, and an UNLAYERED `button {}` reset would otherwise beat them on every migrated
    button (incl. shadcn `<Button>`). Layering it lets utilities win on migrated elements while
    un-migrated component classes (still unlayered) keep beating the base layer. Step 12 deletes that
    whole `@layer base` block with the rest. No other `editor.css` change (orphaned `.lib-*` rules left
    for Step 12). Verified in the running editor (Playwright screenshots): tree bounds at 40vh + scrolls,
    search/placeholders correct, atlas picker's Slider/+/−/cog share one 22px baseline, hotspots + sheet
    render pixel-correct, animated strip still plays; un-migrated Toolbar/Inspector/tabs keep their look
    (layering fix confirmed both directions); no page errors; `tsc`/eslint clean; 138 editor tests pass;
    `npm run build` emits only the game entry (no `editor.html`). **ScrollArea NOT used here** — see
    conventions #6 (both Library scroll regions are unsuitable); Step 12 will trim it if still unused.
    Conventions captured below for the parallel group.
  - Migrate the hardest component first (45 classNames, 11 inline styles incl. the just-edited zoom
    row). This step **defines the patterns every later step follows** — capture them in the PR/step
    notes: (a) how dynamic sprite `style={}` props coexist with utility classNames (keep the computed
    `backgroundImage/Position/Size`, `gridTemplateColumns`, `--strip-travel` as inline `style`; use
    `pixelated` utility for crispness); (b) replace the hand-rolled zoom `<input type=range>` with shadcn
    `Slider`, the +/− and cog with shadcn `Button size="icon"`, the atlas scroll area with `ScrollArea`,
    `title=` tooltips with shadcn `Tooltip`; (c) carry over ONLY load-bearing comments (the 22px
    baseline / column-width budget rationale on the zoom row).
  - Do **not** delete the corresponding rules from `editor.css` yet — leave orphans for Step 12's single
    cull (keeps this step from racing later parallel steps on the shared CSS file).
  - Side effects: `LibraryPanel` uses the drag-resize width owned by `EditorApp` (Step 5) — do not change
    the width mechanism here; just consume whatever width it's given. The animated-strip-picker keyframe
    lives in the entry CSS (Step 2) — confirm it still animates.
  - Docs: append the agreed conventions to this plan's notes so parallel steps can follow them verbatim.
  - Done when: Library panel looks the same or better (zoom row tidy, slider brown), atlas/sprite
    previews and the animated strip still render pixel-correct, no console errors.

- [x] **Step 5: Migrate `EditorApp.tsx` shell — shadcn `Resizable` + Sonner toaster** `[inline]`
  - Outcome: migrated **all** of `EditorApp.tsx`'s markup to utilities + shadcn (Step 5 is the sole
    editor of this file, so the tab strip + tab panels were done here too, not deferred to Step 10):
    shell/body/panes → flex utilities; the Library↔centre split → shadcn `Resizable`; the tab-strip
    chips → styled `<button>`s via `cn()` (plain buttons, not Radix Tabs — Radix `TabsContent` uses
    `hidden`/display:none which would collapse the Phaser canvas); the inactive-panel
    **`visibility:hidden`** ported as `invisible pointer-events-none` with the load-bearing
    Phaser-`Scale.RESIZE` comment preserved. Mounted one root `<TooltipProvider delayDuration={300}>`
    (and dropped LibraryPanel's now-redundant local one, per convention #5) + one Sonner `<Toaster>`.
    Converted the Toast system to Sonner: the 5 `showToast(…)` call sites in `Toolbar.tsx` → `toast.success`/
    `toast.error` (error `duration:5000` to keep the old lingering-error behaviour; ok default 2500 on the
    Toaster), removed the `showToast` prop + `ToastFn` import, and **deleted `src/editor/Toast.tsx`**.
    The old `<hr>` divider → shadcn `<Separator className="my-3.5" />`. **Deviation (major, drove the
    wiring): `react-resizable-panels` here is v4 (4.12.2), a big API change from the classic shadcn
    assumptions** — `orientation` not `direction`; numeric sizes are **pixels**, so percentages must be
    **strings** (`defaultSize="20"`); there is **no `autoSaveId`** — persistence is the `useDefaultLayout({
    id, storage: localStorage })` hook whose `{defaultLayout, onLayoutChanged}` are spread on the group,
    and panels need `id`s (`"library"`/`"center"`). **Judgement call:** kept the Inspector a fixed 280px
    column OUTSIDE the panel group (only Library↔centre resizable — one handle, matching the original).
    **Toast-colour parity:** styled Sonner success green (`#2f4632`) / error red via
    `toastOptions.classNames` with the `!` important suffix to beat sonner's runtime `--normal-bg`.
    Verified in the running editor (Playwright): resize works (232→371px), width **persists across reload**
    (371px), success toast renders green (`bg=rgb(47,70,50)=#2f4632`) bottom-centre, New-map creates and the
    Phaser grid renders in the Map tab (viewport unaffected by the `Resizable` swap), **zero console errors**;
    `tsc`/eslint clean, 138 editor tests pass, `npm run build` emits only the game entry. **Accepted
    transient (critique #1):** un-migrated Inspector/Layers `<h2>`s lost the `.editor-pane h2` uppercase
    styling (their ancestor class is gone) — Steps 7/8 restyle those headings with utilities.
  - Replace the hand-rolled three-pane grid + `.editor-resize-handle` drag logic + inline
    `gridTemplateColumns` (line 145) with shadcn `Resizable` (`react-resizable-panels`): Library panel as
    a resizable left panel (preserve its min/max and the persisted width behaviour), viewport centre,
    inspector right. Judgement call: keep the current persisted-width UX.
  - Mount the Sonner `<Toaster/>` here and convert `Toast` call sites to `sonner`'s `toast()`; delete the
    hand-rolled `Toast.tsx` and its `editor.css` rules' usages (leave the CSS orphaned for Step 12).
  - Side effects: this is the only step that edits `EditorApp.tsx` and removes `Toast.tsx`, so it is kept
    OUT of the parallel group. Verify the Phaser viewport pane still sizes correctly after switching to
    `Resizable` (the `visibility:hidden` tab-panel rule must survive — see Step 10).
  - Docs: none (Step 12).
  - Done when: panes resize smoothly, Library width persists as before, toasts appear via Sonner, no
    dead `Toast` import remains, viewport unaffected.

- [x] **Step 6: Migrate `Toolbar.tsx`** `[delegate sonnet]` (parallel: A)
  - Outcome: migrated `src/editor/Toolbar.tsx` only (12 classNames, no inline styles). New/Open/Save/Undo/
    Redo/Keys → shadcn `Button variant="secondary" size="sm"`; the 8 paint-tool chips → `variant="ghost"
    size="sm"` with the POC active/inactive pattern (`bg-active text-fg-bright` vs `text-fg-muted
    hover:bg-surface`). `.editor-toolbar` → flex utilities; `.editor-toolbar-group` → local `groupClass`.
    **Deviation:** map-id/placeholder use `text-muted-2` not the plan's literal `text-muted` — `--color-muted`
    resolves to a background token (surface-subtle), `muted-2` is the actual `#8a7f76` grey (matches
    LibraryPanel). Snap toggle stays native (no shadcn Checkbox scaffolded). Added shadcn `Tooltip` on sparse
    controls (Undo/Redo/Keys/Snap/dirty-dot), removing their native `title`; paint-tool buttons keep native
    `title` (convention #5). tsc/eslint clean; only Toolbar.tsx changed.
  - 12 classNames, no inline styles. Buttons → shadcn `Button`; the map-id / dirty-dot text → utilities
    (`text-muted`, gold dirty indicator via `text-gold`); toolbar groups → flex utilities. Follow Step 4
    conventions. Edit only `Toolbar.tsx`; do not touch `editor.css`.
  - Side effects: none beyond its own file.
  - Docs: none (Step 12).
  - Done when: toolbar matches prior layout, buttons/active states correct, only `Toolbar.tsx` changed.

- [x] **Step 7: Migrate `panels/InspectorPanel.tsx`** `[delegate sonnet]` (parallel: A)
  - Outcome: migrated `src/editor/panels/InspectorPanel.tsx` only (22 classNames). `NumberField`s + Portal
    Name → shadcn `Input`+`Label` (`useId()` pairs); Portal Facing → shadcn `Select` (value/onValueChange
    maps 1:1); 8 batch-action buttons → `Button variant="outline" size="sm"` (disabled/title/onClick kept).
    Restored the lost `.editor-pane h2` look via shared `headingClass = 'mb-2 text-[0.85rem] uppercase
    tracking-[0.04em] text-fg-dim'` on all three headings (per Step 5 note). `fieldInputClass` adds
    `md:text-[0.8rem]` to cancel shadcn Input's `md:text-sm`. **Deviation:** Flip X/Y checkboxes kept native
    (no shadcn Checkbox scaffolded; were unstyled before). tsc/eslint clean; only InspectorPanel.tsx changed.
  - 22 classNames, no inline styles. Fields/inputs → shadcn `Input`/`Label`/`Select`; snap toggle →
    shadcn control; sections → utilities/`Separator`. Follow Step 4 conventions. Edit only this file.
  - Side effects: none.
  - Docs: none (Step 12).
  - Done when: inspector renders/behaves identically, only `InspectorPanel.tsx` changed.

- [x] **Step 8: Migrate `panels/LayersPanel.tsx`** `[delegate sonnet]` (parallel: A)
  - Outcome: migrated `src/editor/panels/LayersPanel.tsx` only (7 classNames). Eye/name-select/reorder/delete/
    "+ Add layer" → shadcn `Button` (`variant="ghost" size="icon-xs"` for compact toggles, `size="sm"` for
    the name row / add). Active-row highlight preserved exactly (`bg-surface`, was `.layers-item.is-active`);
    rename input + overhead checkbox stay native (mirrors LibraryPanel). Heading restored via `headingClass`
    (uppercase/tracking/`text-fg-dim`). **Deviation (accepted):** ghost Buttons add a subtle hover cue the
    old per-control CSS lacked — same tradeoff already made in LibraryPanel's `TreeItem`. Repeated per-row
    controls keep native `title` (convention #5). tsc/eslint clean; only LayersPanel.tsx changed.
  - 7 classNames. Layer rows/toggles → utilities + shadcn `Button`/toggle. Edit only this file.
  - Side effects: none.
  - Docs: none (Step 12).
  - Done when: layers panel unchanged in look/behaviour, only `LayersPanel.tsx` changed.

- [x] **Step 9: Migrate the four dialogs → shadcn `Dialog`** `[delegate sonnet]` (parallel: A)
  - Outcome: migrated all four dialogs only. Each wrapped in shadcn `Dialog`/`DialogContent`/`DialogHeader`/
    `DialogTitle`/`DialogFooter`; fields → `Input`/`Label`, PortalDialog Facing → shadcn `Select`. **Open/close
    contract unchanged:** all four are conditionally mounted by their parent, so `open` is literal `true` and
    `onOpenChange` routes Radix's close events to the existing `onCancel`/`onClose` prop. `OpenMapDialog`
    map-id list → full-width `outline` Buttons in an `overflow-auto` div; `ShortcutsDialog` renders the same
    `SHORTCUT_GROUPS` from `shortcuts.ts` (untouched, confirmed no diff), long list stays plain `overflow-y-auto`
    (max-height in normal flow, not flex-bounded → ScrollArea guidance). **Deviation:** removed ShortcutsDialog's
    hand-rolled `window.keydown` Escape listener — Radix Dialog already fires `onOpenChange(false)` on Escape
    (avoids a double `onClose`); behaviour preserved. tsc/eslint clean; only the four dialog files changed.
  - `NewMapDialog.tsx`, `OpenMapDialog.tsx`, `PortalDialog.tsx`, `ShortcutsDialog.tsx` (4/7/4/8
    classNames). Wrap each in shadcn `Dialog`; inputs → `Input`/`Select`/`Label`; keep each dialog's
    existing logic/props. These four files are disjoint from every other step's files.
  - Side effects: `ShortcutsDialog` renders shortcut content sourced from `shortcuts.ts` — migrate
    **styling only**, do not alter the shortcut list/content (keep the in-app Shortcuts panel in sync
    with `shortcuts.ts` as before).
  - Docs: none (Step 12).
  - Done when: all four dialogs open/close/submit as before with shadcn styling; only those four files
    changed.

- [x] **Step 10: Migrate `tabs/ObjectEditorTab.tsx`** `[delegate sonnet]` (parallel: A)
  - Outcome: migrated `src/editor/tabs/ObjectEditorTab.tsx` only (all 54 classNames → palette utilities).
    Primitives: `Button` (chips/zoom±/Apply/Save/Reset/Delete/Slice), `Select` (Type), `Slider`+`Tooltip` for
    the region-editor zoom row (mirrors LibraryPanel's `AtlasSheetPicker`). Native `<input>` (col/row/x-y-w-h/
    slice) and native frame-swatch `<button>` kept (bulk/repeated + pixel-crop math, per POC); swatches keep
    native `title`/`aria-label`. All **5 dynamic inline styles preserved + commented** (sheet-preview box;
    frame-grid `gridTemplate*`; per-frame swatch bg math; region canvas; region box rect). Omitted-frame
    diagonal cross ported as an `after:` utility using `var(--color-danger)` (not raw hex). **Deviations:**
    did NOT import `../ui/tabs` (this file renders no tab strip — that's EditorApp's job); added `Slider`/
    `Tooltip` for the shared zoom control. The Phaser-canvas `visibility:hidden` rule lives in EditorApp (not
    here) — added a module-doc note pointing there. tsc/eslint clean; only ObjectEditorTab.tsx changed.
  - Largest component (54 classNames, 5 dynamic inline styles). Apply Step 4's dynamic-sprite pattern
    verbatim: keep computed `backgroundImage/Position/Size` and frame-grid `gridTemplate*` as inline
    `style={}`; everything else → utilities; per-frame swatches keep `pixelated`. The central tab strip's
    active/hidden panels: **preserve the `visibility:hidden` (not `display:none`) behaviour** — port it as
    a utility (`invisible` + `pointer-events-none`) with the load-bearing comment about the Phaser canvas.
    Edit only this file.
  - Side effects: none beyond its own file (tab-panel visibility rule interacts with the Phaser Map panel
    — the comment must survive).
  - Docs: none (Step 12).
  - Done when: object editor renders sprite sheet, grid overlay, and per-frame previews pixel-correctly;
    reclassify controls work; only `ObjectEditorTab.tsx` changed.

- [x] **Step 11: Migrate `PhaserViewport.tsx`** `[delegate haiku]` (parallel: A)
  - Outcome: migrated `src/editor/PhaserViewport.tsx` only. `className="editor-viewport-host pixelated"`
    (`.editor-viewport-host` = `width:100%;height:100%`) → `"w-full h-full pixelated"`. Ref/mount logic
    (`hostRef`, `useEffect`, Phaser.Game config, cleanup) untouched. tsc/eslint clean; only this file changed.
  - 1 className, trivial — swap to the equivalent utility class. Do not alter the Phaser mount/ref logic.
  - Side effects: none.
  - Docs: none (Step 12).
  - Done when: viewport mounts and renders the Phaser canvas unchanged.

- [x] **Step 12: Cull `editor.css` to the lean entry + orphan-class sweep + docs** `[inline]`
  - Outcome: `src/editor/editor.css` culled 1425 → 149 lines — deleted every orphaned `.editor-*`/
    `.lib-*`/`.layers-*`/`.insp-*` component rule plus the duplicate `lib-strip-play` keyframe and
    `.pixelated` class that Step 2 left below. Kept: `@import 'tailwindcss'`, the `@theme`/`:root`/
    `@theme inline` token blocks, the `pixelated` `@utility`, the canonical `lib-strip-play` keyframe.
    **Deviation from the plan's "delete the whole `@layer base` block" bullet (necessary):** kept a
    minimal `@layer base` with `html,body` (bg/color/font) + `#editor-root` height — Tailwind preflight
    does NOT set page background/text colour and `editor.html` carries no inline `<style>`, so a full
    delete would render the editor white with a collapsed root. Only the `button {}` resets were
    dropped (every editor button is now a shadcn `<Button>` or a self-styled native `<button>` with
    explicit bg/border utilities — verified all 11 natives self-style). Orphan sweep clean: no
    `className="editor-…/lib-…"` strings remain in the TSX (only the `pixelated` utility + `lib-strip-play`
    keyframe ref). Deleted 3 unused scaffolded primitives (`ui/card.tsx`, `ui/scroll-area.tsx`,
    `ui/tabs.tsx`); no runtime dep freed (each is still pulled by an in-use primitive), so no
    `package.json` change. Docs: added a `src/editor/` line to CLAUDE.md's architecture map, a tooling
    bullet to `docs/STANDARDS.md`, and a dated `[DECIDED]` entry to `docs/DECISIONS.md`. Verified:
    `tsc --noEmit` clean; `eslint src/editor` 0 errors (5 pre-existing `unbound-method` warnings in
    `EditorScene.ts`, unrelated); markdownlint 0 errors on the 3 docs. Build/visual parity deferred to
    Step 13.
  - Delete every hand-written component rule now orphaned by Steps 4–11, leaving only: `@import
    "tailwindcss"`, the `@theme`/`:root`/`@theme inline` token blocks, the `lib-strip-play` keyframe,
    and the `pixelated` `@utility`. Remove the global `button {}` / `html,body {}` resets now that
    preflight + shadcn cover them (verify nothing visually regresses — this is the riskiest cull).
  - Grep the editor tree for any remaining `className="editor-…"` / `lib-…` strings and remove dead ones;
    grep `editor.css` for selectors no longer referenced and delete them. Target: the file is ~token/base
    only, near-zero component CSS.
  - **Trim unused primitives (critique #3):** grep `src/editor/ui/` for each component scaffolded in
    Step 3; delete any `ui/*.tsx` that no migrated component imports, and drop the now-unused runtime dep
    if nothing else pulls it. Keeps the copied-in surface to only what's actually used.
  - Docs (terse, high-signal):
    - `CLAUDE.md` architecture map — note editor styling stack (Tailwind v4 + shadcn, dev-only) on the
      `src/editor/` line.
    - `docs/STANDARDS.md` tooling section — add Tailwind v4 + shadcn for the editor (+ prettier-plugin if
      added in Step 1).
    - `docs/DECISIONS.md` — new dated entry: editor styling → Tailwind v4 + shadcn, tokens as single
      palette source, dev-only so no prod-bundle impact.
  - Side effects: this is the only step (besides 2/4/5) that edits `editor.css`, and it runs after all
    migrations — no parallel conflict. Confirm the game page still has zero Tailwind/preflight bleed.
  - Done when: `editor.css` contains no component rules; no orphaned `className` strings; docs updated.

- [x] **Step 13: Verify end-to-end** `[inline]`
  - Outcome: all gates green. `tsc --noEmit` clean; `npm run build` emits only the game entry
    (`dist/index.html` + game chunks, **no `editor.html`**, nothing editor-related in `dist/`);
    138/138 editor unit tests pass (`vitest run src/editor`). Drove the running editor headless
    (Playwright, dev server on :5174): **base-reset cull confirmed safe** — editor `body` bg
    `rgb(20,16,15)`=#14100f, text `rgb(232,224,216)`=#e8e0d8, `#editor-root` height 900 (the slimmed
    `@layer base` correctly supplies what preflight doesn't); chrome renders correct (toolbar with
    active-chip fill, Library tree, uppercase Inspector/Layers headings); shadcn New-Map **Dialog**
    renders correct (card, focus ring, Cancel/Create buttons); creating a map renders the **Phaser grid
    in the Map tab** (the `visibility:hidden` tab-panel rule preserved the canvas), fires a green
    (#2f4632) **Sonner toast** bottom-centre, populates the Layers panel + gold dirty-dot; 99 buttons
    render styled. **Game page: zero preflight bleed** — `body` bg unchanged #14100f, margin 0, no
    Tailwind/preflight rules in its stylesheets, no page errors. **Pre-existing finding (NOT a plan-020
    regression, flagged for Matt):** opening the Shortcuts dialog logs a React duplicate-key warning —
    `shortcuts.ts` has three `action: 'Pan the viewport'` entries and `ShortcutsDialog.tsx` keys rows on
    `sc.action`; the `key={sc.action}` strategy is unchanged from HEAD (present before the migration),
    so it's out of scope for this styling plan. One-line fix if wanted: key on index or the keys array.
  - `tsc --noEmit`, `npm run build` (must emit only the game entry, editor excluded), run the editor
    (`npm run editor`) and click through: toolbar, all four dialogs, layers, inspector, library
    (zoom/slider/atlas/strip), object editor (sprite grid + per-frame), resizable panes, a toast.
    Compare the busy panels against the **Step 1 baseline screenshots** — sprite/atlas/frame previews must
    be pixel-identical; chrome may differ (that's the point). Load the **game** page and confirm it is
    visually and behaviourally unchanged (no preflight bleed, no Tailwind classes leaking). Run the
    existing editor `__tests__` / any e2e that boots the editor.
  - Side effects: if the game page shows any reset/preflight change, the Tailwind import scoping (Step 1/2)
    leaked — fix before closing.
  - Docs: none.
  - Done when: both pages verified, tests green, build clean.

## Conventions (established in Step 4 POC — parallel steps 6–11 follow these verbatim)

1. **Imports:** relative (`../ui/button`, `../lib/utils`), matching each editor file's existing style —
   not the `@/` alias.
2. **Buttons → shadcn `<Button>`**, using `variant`/`size` **as-is (no per-component recolour** — the
   variants already read brown/cream via the wired tokens). Text/nav rows: `variant="ghost"` +
   `cn('h-auto justify-start font-normal …', active ? 'bg-active text-fg-bright hover:bg-active' :
   'text-fg-muted hover:bg-surface')`. Icon controls: `size="icon-xs"` (+ `size-[Npx]` to hit an exact
   baseline — `tailwind-merge` dedups the size). `tailwind-merge` lets you override any base Button
   utility via `className`.
3. **Dynamic inline styles STAY inline** `style={}`: computed `backgroundImage`/`backgroundPosition`/
   `backgroundSize`, `gridTemplate*`, and CSS custom props (e.g. `--strip-travel`). Add a one-line `//`
   comment at the `style={}` saying why. A **named keyframe** whose duration/timing is data-dependent:
   set the whole `animation*` set inline (incl. `animationName`/`animationIterationCount`); keep only the
   `@keyframes` in `editor.css`.
4. **Pixel-art crispness → the `pixelated` utility** (never inline `image-rendering`, never the old
   `.pixelated` class).
5. **Tooltips:** shadcn `Tooltip` (`<Tooltip><TooltipTrigger asChild>…</TooltipTrigger><TooltipContent>…
   </TooltipContent></Tooltip>`) **only for sparse, discrete chrome controls**, and **remove the native
   `title`** on those (avoid a double tooltip). **Keep native `title=` on bulk/repeated list items**
   (frame swatches, cards, hotspots) — don't wrap many items in Radix. Needs a `TooltipProvider`
   ancestor: Step 5 mounts **one** `<TooltipProvider>` at the EditorApp root, so steps 6–11 use `Tooltip`
   **without** adding their own provider. (LibraryPanel has a temporary local provider Step 5 will make
   redundant.)
6. **ScrollArea only where the container has a definite/flex-bounded height.** A `max-height` region in
   normal auto-flow does **not** bound Radix's viewport (it overran the pane in testing) → keep those a
   plain `overflow-auto` div. Ref-driven imperative scroll/pan/zoom → plain div (Radix owns its internal
   viewport node).
7. **Colours are palette utilities, never raw hex:** `bg-app/inset/raised/surface/surface-subtle`,
   `text-fg/fg-bright/fg-2/fg-muted/fg-dim/muted-2`, `border-border` (the default `#3a2f2a`),
   `border-border-muted`, `bg-active`+`accent-border`, `text-gold/gold-light/pink/warm/danger`,
   `border-gold-light`, `border-selection`, etc. **Only exception:** semi-transparent overlays with no
   token (e.g. `bg-[rgba(240,216,144,0.08)]`) as arbitrary values.
8. **Radius:** `rounded-md` (=4px, shadcn default) for standard corners; `rounded-[2px]`/`rounded-[3px]`
   for the tighter swatch/grid corners the originals used.
9. **Touch only your own component file.** Do **not** delete old `.lib-*`/`.editor-*` rules from
   `editor.css` — they stay orphaned for Step 12 (keeps parallel steps write-disjoint).
10. **Extract repeated shapes** to small local helpers / const class-strings (see `libCardClass`,
    `libSwatchClass`, `libLabelClass`, `TreeItem`, `FavHeart` in `LibraryPanel.tsx`).

## Out of scope

- The Phaser game and all of `src/` outside `src/editor/**` (scenes, entities, systems, data, render).
  No game styling, no `index.html` changes.
- Production bundle behaviour — the editor remains dev-only and excluded from `vite build`.
- Functional/behavioural changes to the editor beyond the `Resizable` swap (which preserves current UX)
  and Toast→Sonner. No new features, no layout redesign — visual parity (or minor tidy) is the bar.
- The item-icon / asset-generation pipelines and the `/__editor/` dev API (`vite-editor-api.mjs`).
- `prettier-plugin-tailwindcss` is optional; skip if it complicates the existing lint-staged setup.

## Critique

Verdict: Solid, well-researched plan with accurate repo facts and a correctly write-disjoint parallel
group — one real hazard (Tailwind preflight goes global at Step 2 and coexists with un-migrated hand-CSS
through Step 11) was surfaced and **consciously accepted** (single-user local tool; transient mid-migration
wobble is fine). Findings #2–#4 rolled into the steps.

|#|Finding|Lens|Severity|Resolution|
|-|-------|----|--------|----------|
|1|Preflight activates editor-wide at Step 2, so un-migrated panels (box-sizing, heading/list margins, bullets) can regress during Steps 4–11|Gaps/executability|High|**Accepted, not fixed** — local single-user tool, transient only. Step 2 acceptance reworded to expect diffs, not parity.|
|2|`shadcn init` assumed to work against a non-standard layout (nested CSS entry, `src/editor/ui`, no config, React 19); `--legacy-peer-deps` was a blind hedge|Alternatives/gaps|Medium|Step 2 now treats CLI output as untrusted: diff every file, confirm no `index.html`/root-CSS writes, hand-write `components.json` if it misbehaves, only add `--legacy-peer-deps` if a plain install actually errors.|
|3|"shadcn everywhere" + all-primitives-up-front adds maintenance surface / risks dead components|Right-sizing/operational|Medium|Step 3 rescoped to the known-needed set (each name tied to a step) and justified up-front-ness by parallel-group write-disjointness; Step 12 trims unused primitives + deps.|
|4|Acceptance checks are eyeball-only; logic tests won't catch CSS regressions|Gaps/risks|Low|Step 1 captures baseline screenshots of busy panels; Step 13 diffs sprite/atlas/frame previews against them (must be pixel-identical).|
