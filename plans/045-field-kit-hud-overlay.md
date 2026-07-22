# Field Kit — DOM/React HUD Overlay

> Status: planned — run /execute-plan to begin.

## Summary

Replace the entire hand-placed Phaser HUD (`src/scenes/UIScene.ts` + `src/scenes/hud/*`)
with a **DOM/React overlay** floating over the Phaser game canvas, implementing the
**Field Kit** direction from [`docs/ui-overhaul/`](../docs/ui-overhaul/README.md): a
persistent bottom **command bar that morphs by mode** (Scavenge / Build / Fight), a
persistent 6-slot quick-swap **hotbar** above it, circular meter rings + a day/night dial +
resource chips up top, and deep menus (build catalog, pack, status) as tabbed bottom-sheet
drawers using the **loadout-vs-catalog** two-tier model. The world, camera, and all
in-world markers stay in Phaser; a thin **event bridge** connects `game.events` ⇄ a React
Zustand store. This is a full migration in one plan, portrait-first, spells deferred.

## Context & decisions

**Decisions (from planning):**

- **Scope:** full HUD migration — every current widget ported to React, plus the new
  hotbar and catalogs, in this one plan.
- **Spells:** deferred. Build the catalog/drawer structure data-driven off `BUILDABLES` +
  the `Inventory`, design the hotbar to accept spells later, but ship **no spell UI**.
  Combat keeps the existing melee/bow buttons; the dead Phaser `SPELL` slot is not carried
  over.
- **Hotbar:** 6 slots, **manual pin** (long-press an item in a catalog/pack to pin it).
  New const `HUD_HOTBAR_SLOTS = 6` (leave legacy `HOTBAR_SLOTS = 5` untouched — it dies
  with the Phaser widget). Loadout persists to `localStorage`.
- **Orientation:** portrait-first. Author in the existing `360×640` design space; lay out
  with flex/grid + `env(safe-area-inset-*)` so landscape is a later reflow, not a rewrite.
  Do NOT tune landscape in this plan.

**Stack already present (no new deps):** `react@19`, `react-dom@19`, `zustand@5`,
`radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`,
`tailwindcss@4` + `@tailwindcss/vite`, `@vitejs/plugin-react` (registered globally). shadcn
primitives exist as copied source in `src/editor/ui/*.tsx`; `cn` in `src/editor/lib/utils.ts`.

**Patterns to mirror:**

- **React↔Phaser bridge = a Zustand store** (`src/editor/store/editorStore.ts`): "React
  components subscribe via the hook; the Phaser scene reads via `getState()`/`.subscribe`;
  neither side imports the other." Our bridge is the inverse of `PhaserViewport.tsx` — React
  floats *above* the canvas rather than hosting it.
- **Event bus is the sanctioned scene↔UI seam** (`docs/CONVENTIONS.md`): the HUD is a bus
  peer. `GameScene.wireBus()` (`src/scenes/GameScene.ts:~799`) already treats
  `game.events` as opaque strings, so a DOM emitter is a **drop-in peer to `UIScene` and
  needs zero GameScene changes** (except the movepad-held path, Step 10).
- **Event names** (`namespace:action`, verified): outbound (world→HUD) `player:hpChanged`,
  `player:hit`, `hunger:changed`, `fire:changed`, `supply:changed`, `time:changed`,
  `tasks:changed`, `mode:changed`, `build:modeChanged`, `demolish:modeChanged`,
  `combat:activeChanged`, `inspect:show`, `inspect:hide`, `zoom:changed`,
  `camera:followChanged`, `npc:menuOpen`, `build:select`; inbound (HUD→world)
  `build:toggle`, `build:select`, `build:rotate`, `demolish:toggle`, `tasks:cancel`,
  `zoom:delta`, `camera:center`, `combat:attack`, `combat:bow`, `combat:move`,
  `combat:moveEnd`, `mode:combatToggle`, `mode:inspectToggle`, `needs:eat`,
  `npc:assignDayRole`, `npc:assignNightPosture`, `npc:beginPlaceGuard`,
  `npc:cancelPlaceGuard`, `debug:spawnEnemy`, `debug:spawnNpc`, `debug:toggleTime`,
  `debug:forceWave`.
- **Registry keys** (live state): `inventory` (the shared `Inventory` instance, extends
  `eventemitter3`, emits `'change'`), `playerStats`, `hunger`, `dayPhase`, `dayCount`,
  `zoom`, `following`.
- **Coordinate space:** canvas is `Scale.FIT`, `width/height = BASE_WIDTH/HEIGHT ×
  RENDER_SCALE`, **letterboxed + centered** in `#game`. The overlay must track the live
  canvas rect (`game.scale.canvas.getBoundingClientRect()`, resubscribe on
  `Phaser.Scale.Events.RESIZE`) to map design px → CSS px. `BASE_WIDTH=360`,
  `BASE_HEIGHT=640`, `TILE_SIZE=16` in `src/config.ts`.
- **Teardown:** cross-scene listeners are torn down on `SHUTDOWN` (restart-leak hazard). The
  bridge must mirror this — re-sync on GameScene START/SHUTDOWN and clean up on React
  unmount.
- **Data:** `src/data/types.ts` (`ItemDef`, `BuildableDef {id,name,cost,color,icon?,
  orientable?,...}`), `ITEMS` (`wood`/`stone`/`berries`), `BUILDABLES`
  (`wall`/`campfire`/`spike_trap`). No spell schema exists. `Inventory`
  (`src/systems/Inventory.ts`) is display-only today.
- **Conventions:** `strict` TS, no `any` without a why-comment, `readonly` data records,
  `jsx: react-jsx`, path alias `@/* → src/*`. Commits `type(scope): summary`. Pre-commit
  `lint-staged` (eslint+prettier on `*.tsx`), pre-push typecheck+unit. Tests: Vitest node
  (pure units), Playwright e2e (`window.game.__test`, DEV-only), `npm run smoke`.

**Direction fit (`README.md`/`ROADMAP.md`):** MVP path is complete; the game is explicitly
mobile-first/portrait/touch and "the day must be legible." This overhaul is the natural
next investment after the feature-complete MVP — it retires the UI debt catalogued in
`docs/ui-overhaul/README.md §1` and unblocks the depth (many buildings, later spells) the
roadmap implies.

**Top risk — flagged for Step 1:** this deliberately **reverses** the current isolation
guarantee ("the game page never loads Tailwind"). Tailwind preflight must be scoped so it
cannot touch the canvas or leak resets into game DOM. Prove the scoping before building any
component on top of it.

## Steps

- [ ] **Step 1: Mount an empty React overlay on the game page + scope Tailwind** `[inline]`
  - `index.html`: add `<div id="hud-root">` over `#game` (absolute, inset 0, `z-index`
    above the canvas, `pointer-events:none`). `src/hud/hud.css`: `@import "tailwindcss"`
    with **preflight scoped to `#hud-root`** (Tailwind v4: keep base reset from leaking onto
    `#game`/canvas — scope under the root selector; verify no global `*{}` reset bleeds).
    `src/hud/main.tsx`: `createRoot(#hud-root).render(<StrictMode><GameHud/></StrictMode>)`,
    `import './hud.css'`; invoke it from `src/main.ts` after the Phaser boot. `src/hud/
    GameHud.tsx`: skeleton root (`pointer-events:none`) with a temporary debug badge.
  - Side effects: prod bundle now ships React+Tailwind on the only prod entry
    (`index.html` — Rollup input is already pinned there, no `vite.config.ts` change).
    Confirm `npm run build`, `npm run smoke`, and the e2e boot canary stay green; confirm
    canvas pixel-art crispness and that no preflight reset touches game DOM.
  - Docs: correct the "game page never loads Tailwind" claim in `docs/STANDARDS.md`
    (now: scoped Tailwind on the game page under `#hud-root`); bump `docs/ui-overhaul/
    README.md` status to "in progress".
  - Done when: game boots with the React root over the canvas, badge visible,
    build+smoke+e2e green, canvas visually unchanged.

- [ ] **Step 2: Canvas-rect coordinate mapping + safe-area design-space layer** `[inline]`
  - `src/hud/hooks/useCanvasRect.ts`: read `window.game.scale.canvas` rect, compute
    `scale = rect.width / BASE_WIDTH` + letterbox offsets, resubscribe on
    `Phaser.Scale.Events.RESIZE`; guard when `window.game` is absent. In `GameHud`, position
    an inner `.hud-design` layer over the canvas rect (CSS `transform: translate() scale()`)
    so children author in `360×640` units, and apply `env(safe-area-inset-*)` to an
    interactive-safe sublayer.
  - Side effects: none in game code.
  - Done when: debug markers at the four design-space corners align to the canvas across
    window resize and letterboxing (portrait + a deliberately wide window); insets visibly
    inset the interactive layer.

- [ ] **Step 3: HUD store + event bridge (+ unit test)** `[inline]`
  - `src/hud/store.ts`: Zustand store — `hp/maxHp`, `hunger`, `fire`, `supply {wood,rock}`,
    `dayPhase/dayCount/time`, `waveInfo`, `tasks` summary, `mode`, `buildMode/selection/
    orientable`, `demolishMode`, `combatActive`, `inspectTarget`, `inventory` snapshot,
    `hotbar` loadout (6 slots), `following/zoom`. `src/hud/bridge.ts`: on init subscribe all
    outbound events + registry `inventory` `'change'` → store setters; expose typed
    `emit(event, payload)` for the inbound union; teardown fn mirroring the `SHUTDOWN`
    convention; re-sync on GameScene START/SHUTDOWN and on React unmount. Wire bridge init
    at mount.
  - Side effects: **GameScene needs no change.** Must survive GameScene restart (death →
    scene restart) without leaking listeners or going stale.
  - Docs: code comments only.
  - Done when: `src/hud/__tests__/bridge.test.ts` (node-pure, mock emitter + registry)
    passes for event→store mapping, `emit` passthrough, and teardown; a temporary `GameHud`
    readout shows live HP/hunger/day ticking in-game.

- [ ] **Step 4: Game-scoped shared primitives, tokens, and data prep** `[delegate]`
  - Extract the `@theme` palette tokens from `src/editor/editor.css` into
    `src/ui-react/tokens.css`; import it from `src/hud/hud.css` (do **not** rewire
    `editor.css` now — consolidation is out of scope). Create `src/hud/ui/` by copying the
    shadcn primitives the HUD needs from `src/editor/ui/`: `button`, `tabs`, `sheet`,
    `dialog`, `tooltip`, `slider`, `select`; add `src/hud/lib/utils.ts` (`cn`), fixing import
    paths to game scope. Data prep so parallel components only *read* shared files:
    `src/config.ts` add `HUD_HOTBAR_SLOTS = 6`; `src/data/types.ts` add optional
    `category?: 'defense' | 'survival' | 'craft'` to `BuildableDef`; `src/data/buildables.ts`
    tag the three existing entries (`wall`→defense, `spike_trap`→defense,
    `campfire`→survival).
  - Side effects: minor duplication with `src/editor/ui` (accepted; future consolidation is
    out of scope). Adding an optional field to `BuildableDef` is backwards-compatible.
  - Done when: primitives typecheck and a sample `<Button>`/`<Tabs>` renders styled inside
    `GameHud`; `BUILDABLES` entries carry a category; typecheck + lint clean.

- [ ] **Step 5: Top-cluster components** `[delegate]` (parallel: A)
  - Create three self-contained presentational components under `src/hud/components/`, each
    reading `useHudStore` and emitting via `bridge.emit`, styled with `src/hud/ui` +
    tokens, authored in design units, portrait-first: `MeterBars.tsx` (HP/food/fire/supply
    as circular rings, state+trend, fire hidden when no hearth, red only at threshold),
    `DayNightDial.tsx` (sun/moon arc + "Day N" + night wave banner), `ResourceChips.tsx`
    (wood/rock chips + zoom `[-] % [+]` → `zoom:delta` and follow → `camera:center`).
  - Side effects: none — write-disjoint from other component steps; not yet composed into
    `GameHud`.
  - Done when: each typechecks/lints and renders correctly when temporarily mounted; matches
    the mockup (`docs/ui-overhaul/pitch.html`, Field Kit). Full behaviour verified at Step 9.

- [ ] **Step 6: Action components — hotbar + morphing command bar** `[delegate]` (parallel: A)
  - `src/hud/components/Hotbar.tsx` (6 slots from `HUD_HOTBAR_SLOTS`, renders the store
    loadout, tap → use/equip/select, long-press → pin intent via a store action, empty slots
    dimmed, icons from `ITEMS`/`BUILDABLES`), `src/hud/components/CommandBar.tsx`
    (presentational morph by `mode` prop: **scavenge** = Build/Pack/Craft/Status; **build** =
    buildable tray + Rotate/Place/Cancel; **fight** = movepad + Attack/Bow — emits the
    matching events), `src/hud/components/Movepad.tsx` (drag → `combat:move {dx,dy}` /
    `combat:moveEnd`, and reports held-state up via a callback).
  - Side effects: write-disjoint; the movepad-held → GameScene wiring is deferred to Step 10.
  - Done when: components typecheck/lint and render each mode layout matching the mockup;
    movepad emits normalized vectors. Behaviour verified at Step 10.

- [ ] **Step 7: Drawer components — build catalog, pack, status** `[delegate]` (parallel: A)
  - `src/hud/components/BuildCatalog.tsx` (tabbed Defense/Survival/Craft from
    `BuildableDef.category`, scrollable grid off `BUILDABLES` with cost + affordability dim,
    select → `build:select`, long-press → pin), `src/hud/components/PackDrawer.tsx` (full
    inventory grid from the store snapshot, selectable slots, consumable tap → `needs:eat`,
    long-press → pin), `src/hud/components/StatusDrawer.tsx` (meters + stats from
    `playerStats` + eat list → `needs:eat`). Use the `sheet` primitive for the drawer shell.
  - Side effects: write-disjoint; pin-to-hotbar store mutation + persistence lands at Step 11.
  - Done when: each typechecks/lints and renders the populated grid/drawer matching the
    mockup. Behaviour verified at Step 11.

- [ ] **Step 8: Overlay components — inspect, companion, dev** `[delegate]` (parallel: A)
  - `src/hud/components/InspectCard.tsx` (entity stats bottom sheet from
    `store.inspectTarget`, close → `inspect:hide`), `src/hud/components/CompanionMenu.tsx`
    (Day/Night posture sections reusing the pure `NPC_MENU_SECTIONS` model from
    `src/scenes/npcMenu.ts`, emits `npc:assignDayRole`/`npc:assignNightPosture`/
    `npc:beginPlaceGuard`), `src/hud/components/DevMenu.tsx` (gated on `import.meta.env.DEV`,
    emits `debug:spawnEnemy`/`debug:spawnNpc`/`debug:toggleTime`/`debug:forceWave`).
  - Side effects: write-disjoint. `npcMenu.ts` is pure and importable — read-only reuse.
  - Done when: each typechecks/lints and renders matching the current Phaser equivalents.
    Behaviour verified at Step 12.

- [ ] **Step 9: Integrate the top cluster + retire HudBars/TopCenterControls** `[inline]`
  - Compose `MeterBars` + `DayNightDial` + `ResourceChips` into `GameHud`; subscribe them to
    the store. Remove `HudBars` and `TopCenterControls` construction/wiring from
    `src/scenes/UIScene.ts`. Move the damage + hunger vignettes to a DOM overlay layer in
    `GameHud` (CSS radial-gradient tied to `player:hit` / hunger threshold) and drop the
    Phaser vignette images.
  - Side effects: `UIScene` still runs (other widgets remain) — ensure no double-render of
    migrated widgets. Watch the restart path.
  - Docs: none.
  - Done when: e2e/manual — HP/food/fire/supply, day/night phase + wave banner, zoom, and
    follow all match prior behaviour and update live; vignettes fire on hit/starving.

- [ ] **Step 10: Integrate hotbar + command bar + movepad-held bridge; retire
  BuildControls/CombatControls/ModeControls** `[inline]`
  - Compose `Hotbar` + `CommandBar` (+ `Movepad`) into `GameHud`; drive the morph from
    `mode:changed` / `build:modeChanged` / `combat:activeChanged`. Wire the movepad-held
    coupling: bridge sets a registry key `movepadHeld` (bool); `src/scenes/input/
    PointerInputController.ts` reads it in place of the old `isMovepadHeld` internal so world
    gestures stay suppressed while the DOM movepad is active. Emit `combat:move`/`moveEnd`,
    `combat:attack`/`bow`, `build:toggle`/`select`/`rotate`, `demolish:toggle`,
    `tasks:cancel`, `mode:combatToggle`/`inspectToggle`. Remove `BuildControls`,
    `CombatControls`, `ModeControls` from `UIScene`.
  - Side effects: `PointerInputController` change is the one non-trivial GameScene-side edit
    — keep it minimal (read registry flag). Verify build-placement pointer ownership and
    combat drag still don't fall through to pan.
  - Docs: none.
  - Done when: e2e (`build`, `combat`, `gestures` specs, DOM-adapted) — placing/rotating/
    demolishing walls, cancel-queue, movepad movement, melee/bow, and mode toggles all work;
    empty-HUD taps still reach the world.

- [ ] **Step 11: Integrate drawers + pin-to-hotbar + interactive inventory; retire
  WellbeingPanel/InventoryWidget/build palette** `[inline]`
  - Wire `BuildCatalog`, `PackDrawer`, `StatusDrawer` as bottom sheets opened from the
    command bar. Implement pin-to-hotbar (store loadout mutation + `localStorage` persistence,
    keyed per save). Make inventory slots interactive (select + eat via `needs:eat`; build
    quick-select via `build:select`). Weapon slots: pin is allowed but "use" wires to the
    existing melee/bow for now (no equipment system — see Out of scope). Remove
    `WellbeingPanel`, `InventoryWidget`, and the Phaser build palette from `UIScene`.
  - Side effects: `Inventory` becomes read-for-display + eat/select actions via events; no
    change to `Inventory` internals. Persisted loadout must tolerate items no longer owned.
  - Docs: none.
  - Done when: eat from pack/status, build-select from the catalog, pin an item and see it on
    the hotbar (surviving reload), and open/close drawers by swipe — all verified.

- [ ] **Step 12: Integrate inspect + companion + dev; retire InspectPanel/NpcAssignMenu/
  DevMenu** `[inline]`
  - Compose `InspectCard`, `CompanionMenu`, `DevMenu` into `GameHud`; wire `inspect:show`/
    `inspect:hide`, `npc:menuOpen` + `npc:*`, `debug:*`. Remove `InspectPanel`,
    `NpcAssignMenu`, and the Phaser `DevMenu` from `UIScene`.
  - Side effects: the NPC guard-placement flow (`npc:beginPlaceGuard` → one-tap point place)
    must still work end-to-end through the DOM menu.
  - Docs: none.
  - Done when: inspect an enemy/tree/structure, assign companion Day/Night postures + place a
    guard point, and use dev spawn/time/wave — all verified.

- [ ] **Step 13: Cutover — remove UIScene + retire the hudHitTest input path** `[inline]`
  - Remove `UIScene` from the scene list in `src/main.ts` and delete `src/scenes/UIScene.ts`
    + `src/scenes/hud/*` (now fully replaced). Retire the `hudHitTest`/`addHudElement` path
    and its `PointerInputController` closure — DOM `pointer-events` capture now gates taps
    (root `pointer-events:none`, `auto` on controls; empty HUD space falls through to the
    canvas). Keep the `movepadHeld` gate from Step 10. Check `src/ui/*` (Phaser kit) for any
    remaining non-editor consumers; if none, delete it, else leave with a note.
  - Side effects: existing e2e specs that assert on the canvas HUD must move to DOM queries
    (`tests/e2e/*.spec.ts` — `combat`, `build`, `wave`, `gestures`, `menu-start`); update
    `tests/e2e/refactor-tripwire.spec.ts`. `window.game.__test` may need small HUD-state
    hooks (DEV-only).
  - Docs: none (docs land in Step 14).
  - Done when: no `UIScene` in the scene list, no dead Phaser HUD code, full e2e suite +
    smoke green, and manual play shows the complete DOM HUD with world gestures intact.

- [ ] **Step 14: DOM e2e coverage + docs** `[inline]`
  - Add `tests/e2e/hud-*.spec.ts` (Playwright DOM-driven) for meters, day/night, hotbar pin,
    build catalog select, drawers open/close + eat, inspect, and companion assign. Update
    docs: `docs/ui-overhaul/README.md` (status → built, note deviations), `docs/CONVENTIONS.md`
    (new `src/hud/` seam — DOM overlay HUD, the event bridge, DOM pointer-events gating
    replacing `hudHitTest`), `docs/STANDARDS.md` (scoped Tailwind on the game page),
    `docs/STATUS.md` (UI overhaul landed), and add a `docs/DECISIONS.md` entry (DOM/React
    HUD over Phaser; Field Kit; spells deferred; 6-slot manual-pin hotbar; portrait-first).
    Keep doc edits terse/high-signal.
  - Side effects: none.
  - Done when: new specs pass in CI; docs reflect the shipped architecture.

## Out of scope

- **Spells / attacks system** (data schema, casting, spellbook UI) — deferred by decision;
  structure is spell-ready but no spell content ships.
- **Equipment system** — no real weapon-equip slot; hotbar weapon slots reuse the existing
  melee/bow actions until an equipment system exists.
- **Landscape layout tuning** — portrait-first; CSS is structured for a later landscape
  reflow but it is not built or tuned here.
- **Consolidating `src/editor/ui` and `src/hud/ui`** into one shared package (and rewiring
  `editor.css`/`components.json` aliases) — deliberately duplicated for now.
- **Twin Grip / Emberlight** directions and the always-open radial wheel — Field Kit only.
- **New juice/haptics** beyond parity (tap-ack, vignettes) — polish pass is separate.
