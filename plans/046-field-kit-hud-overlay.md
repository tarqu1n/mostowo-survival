# Field Kit — DOM/React HUD Overlay

> Status: in review

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
  peer. `GameScene.wireBus()` (`src/scenes/GameScene.ts:~799`) already treats `game.events`
  as opaque strings, so the DOM emitter drops in as a peer to `UIScene` for all *event*
  traffic. **GameScene-side edits are NOT zero** — they are confined and land at defined
  steps: the `hudHitTest`/`isMovepadHeld` **deps-closures** (`GameScene.ts:~663/672/782`,
  direct method calls, not events) are rewired at Step 10, and the `this.ui` field +
  `scene.launch('UI')`/`scene.get('UI')` wiring is removed at Step 13 (cutover). No changes
  to the `wireBus()` event table itself.
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
- **Lifecycle:** the React overlay lives at the **page** level and must **persist across
  GameScene death→restart** — it does NOT tear down on scene `SHUTDOWN`. Bridge listeners
  attach to the scene-outliving `game.events` (+ registry `inventory`); on GameScene `START`
  the bridge **re-syncs** store state (GameScene re-emits current values at ~`GameScene.ts:
  783-793`), and only fully unsubscribes on React unmount / `game.destroy`. (Contrast: the
  old per-scene `UIScene` DID tear down on SHUTDOWN — that convention does not transfer.)
- **Data:** `src/data/types.ts` (`ItemDef`, `BuildableDef {id,name,cost,color,icon?,
  orientable?,...}`), `ITEMS` (`wood`/`stone`/`berries`), `BUILDABLES`
  (`wall`/`campfire`/`spike_trap`). No spell schema exists. `Inventory`
  (`src/systems/Inventory.ts`) is display-only today.
- **Conventions:** `strict` TS, no `any` without a why-comment, `readonly` data records,
  `jsx: react-jsx`, path alias `@/* → src/*`. Commits `type(scope): summary`. Pre-commit
  `lint-staged` (eslint+prettier on `*.tsx`), pre-push typecheck+unit. Tests: Vitest node
  (pure units), Playwright e2e (`window.game.__test`, DEV-only), `npm run smoke`.

**Direction decision (recorded, not just chat):** owner (Matt) selected **Field Kit** over
the earlier Twin Grip front-runner. `docs/ui-overhaul/README.md` status is updated to record
this and there is a `docs/DECISIONS.md` entry (per the repo's "every reusable decision goes
in the repo" rule). The shared infrastructure (event bridge, tokens, primitives, hotbar,
catalog grids) is direction-agnostic; only the morphing command bar is Field-Kit-specific —
so most of the migration survives even if the interaction model is later revisited.

**Direction fit (`README.md`/`docs/ROADMAP.md`):** MVP path is complete; the game is
explicitly mobile-first/portrait/touch and "the day must be legible." This overhaul is the
natural next investment after the feature-complete MVP — it retires the UI debt catalogued in
`docs/ui-overhaul/README.md §1` and unblocks the depth (many buildings, later spells).

**Top risk — flagged for Step 1:** this deliberately **reverses** the current isolation
guarantee ("the game page never loads Tailwind"). There is **no in-repo precedent** for
scoped preflight — the editor owns its whole page and never scopes it, so that is not a
proof point. The concrete Tailwind v4 mechanism (see Step 1) must be nailed down and canvas
crispness proven at the Step 1 gate before any component is built on top.

## Steps

- [x] **Step 1: Mount an empty React overlay on the game page + scope Tailwind** `[inline]`
  - Outcome: `index.html` gains `#hud-root` (absolute inset-0, z-index 10, `pointer-events:none`,
    positioned inline so layout holds pre-mount). `src/hud/hud.css` scopes Tailwind v4 by declaring
    `@layer theme, base, components, utilities;` then importing only `tailwindcss/theme.css` +
    `tailwindcss/utilities.css` (NO preflight) + a reset scoped under `#hud-root`. `src/hud/main.tsx`
    (`mountHud()` → `createRoot(#hud-root)`) + `src/hud/GameHud.tsx` (skeleton + debug badge), invoked
    from `src/main.ts` after `new Phaser.Game`. Docs: `docs/STANDARDS.md` Tailwind claim corrected
    (game page now loads scoped Tailwind), `docs/ui-overhaul/README.md` status → "in progress".
    `npm run build` green; built CSS verified free of global preflight (no `*`/`html`/`body`/`canvas`
    reset — only Tailwind's harmless `--tw-*` var defaults + the `#hud-root` reset), canvas crispness
    untouched. `npm run smoke` boot canary passed clean (0 console/page errors). Lint + prettier clean.
    Note: full e2e deferred to end of plan (env renders headless frames ~1.7× slower than the
    reference box; frame-stepping specs tip the 30s Playwright timeout — not a functional regression).
  - `index.html`: add `<div id="hud-root">` over `#game` (absolute, inset 0, `z-index`
    above the canvas, `pointer-events:none`). `src/hud/hud.css` — **concrete Tailwind v4
    scoping** (there is no repo precedent; do NOT just `@import "tailwindcss"`, which injects
    a global `*,::before,::after{}` preflight reset that would touch the canvas/`#game`):
    import the layers explicitly and **omit global preflight** — `@layer theme, base,
    components, utilities;` then `@import "tailwindcss/theme.css" layer(theme);` and
    `@import "tailwindcss/utilities.css" layer(utilities);` (skip `preflight.css`), and
    hand-write a minimal reset scoped under `#hud-root` (box-sizing, margin, font) so no rule
    selects the canvas or bare `html/body`. `src/hud/main.tsx`:
    `createRoot(#hud-root).render(<StrictMode><GameHud/></StrictMode>)`, `import './hud.css'`;
    invoke from `src/main.ts` after the Phaser boot. `src/hud/GameHud.tsx`: skeleton root
    (`pointer-events:none`) with a temporary debug badge.
  - Side effects: prod bundle now ships React+Tailwind on the only prod entry
    (`index.html` — Rollup input is already pinned there, no `vite.config.ts` change).
    Confirm `npm run build`, `npm run smoke`, and the e2e boot canary stay green; confirm
    canvas pixel-art crispness and that no preflight reset touches game DOM.
  - Docs: correct the "game page never loads Tailwind" claim in `docs/STANDARDS.md`
    (now: scoped Tailwind on the game page under `#hud-root`); bump `docs/ui-overhaul/
    README.md` status to "in progress".
  - Done when: game boots with the React root over the canvas, badge visible,
    build+smoke+e2e green, canvas visually unchanged.

- [x] **Step 2: Canvas-rect coordinate mapping + safe-area design-space layer** `[inline]`
  - Outcome: `src/hud/hooks/useCanvasRect.ts` reads `window.game.scale.canvas` rect → `{left,top,
    width,height,scale=width/BASE_WIDTH}`, resubscribes on `Phaser.Scale.Events.RESIZE` + window
    resize/orientationchange + `visualViewport` resize/scroll, and rAF-polls through the boot window
    until the canvas exists (guards absent `window.game`). `GameHud` now positions a `.hud-design`
    layer at the canvas rect (`transform: scale()`, origin top-left) so children author in 360×640
    units, with an inner `.hud-safe` sublayer carrying `env(safe-area-inset-*)` padding for
    interactive controls. Temp corner markers + a scale readout on the badge. No game code touched.
    Verified via a one-off headless check (three viewports: portrait-tight 360×640 no-letterbox,
    portrait-phone 390×693 top-offset 113, wide-letterbox 338×600 left-offset 497) — all four
    design-corner markers align to the canvas rect within 1.5px. Safe-area insets wired via env()
    (resolve to 0 headless / no-notch; visible only on a notched device). typecheck + lint clean.
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

- [x] **Step 3: HUD store + event bridge (+ unit test)** `[inline]`
  - Outcome: `src/hud/store.ts` — Zustand store (`subscribeWithSelector`, mirrors `useEditorStore`)
    with every planned field + named setter actions; `HotbarSlot`/`HOTBAR_SLOTS=6` local (Step 4 adds
    the `HUD_HOTBAR_SLOTS` config const). Notable calls: `waveInfo` is derived (`{active: phase===
    'night'}`) since there is NO dedicated wave event — a wave runs the whole night; `orientable` is
    computed from `BUILDABLES` in `setSelection`; a `hitNonce` counter models the payload-less
    `player:hit` for the Step 9 vignette; `needs:eat` payload key is `itemId` (verified against
    `SurvivalClock.onNeedsEat`), NPC role/posture inbound payloads are the real `NpcDayRole`/
    `NpcNightPosture` unions. `src/hud/bridge.ts` — `initBridge(bus, registry)` subscribes all 16
    outbound events → setters, rebinds the `Inventory` `'change'` listener when the registry
    `inventory` swaps (fresh instance each restart — detaches the dead one first, listens to both
    `setdata` + `changedata-inventory`), and returns `{emit(InboundEvent), dispose()}`; the typed
    `InboundEvent` union is the HUD→world channel later steps fire on. Modelled against minimal
    `EventBus`/`Registry` interfaces so the test mocks them. `src/hud/hooks/useBridge.ts` wires
    init/dispose in a StrictMode-safe effect + exposes the singleton via `hudBridge()`; `GameHud`
    calls it + shows a TEMP `StoreReadout` (removed at Step 9). NO game-code change (no `wireBus`
    edit). `src/hud/__tests__/bridge.test.ts` (7 tests, node-pure) green: full event→store mapping,
    `emit` passthrough, inventory rebind, death→restart re-sync (store persists, rebinds to the new
    inventory, dead one stops driving it), dispose. typecheck + lint clean; smoke boot canary green
    (HUD mounts + bridge wires, 0 console errors); one-off headless in-game check confirmed the
    readout updates live for day/night toggle (`[day]`→`[night]`) and hunger drain (`food 100`→`41`).
  - `src/hud/store.ts`: Zustand store — `hp/maxHp`, `hunger`, `fire`, `supply {wood,rock}`,
    `dayPhase/dayCount/time`, `waveInfo`, `tasks` summary, `mode`, `buildMode/selection/
    orientable`, `demolishMode`, `combatActive`, `inspectTarget`, `inventory` snapshot,
    `hotbar` loadout (6 slots), `following/zoom`. `src/hud/bridge.ts`: on init subscribe all
    outbound events + registry `inventory` `'change'` → store setters; expose typed
    `emit(event, payload)` for the inbound union; re-sync on GameScene `START`, persist
    across `SHUTDOWN`, unsubscribe only on React unmount / `game.destroy` (see Lifecycle
    above). Wire bridge init at mount.
  - Side effects: no `wireBus()` **event-table** change in this step (the deps-closure +
    `scene` wiring edits come at Steps 10/13). Must survive GameScene restart (death → scene
    restart) without leaking listeners or going stale — re-sync, don't tear down.
  - Docs: code comments only.
  - Done when: `src/hud/__tests__/bridge.test.ts` (node-pure, mock emitter + registry)
    passes for event→store mapping, `emit` passthrough, and restart re-sync (state survives a
    simulated SHUTDOWN→START); a temporary `GameHud` readout shows live HP/hunger/day
    ticking in-game.

- [x] **Step 4: Game-scoped shared primitives, tokens, and data prep** `[delegate]`
  - Outcome: `src/ui-react/tokens.css` — the `@theme` palette + `:root` shadcn-semantic + `@theme
    inline` utility-binding blocks copied VERBATIM from `editor.css` (editor-only bits omitted:
    `@import 'tailwindcss'`, `@utility pixelated`, `lib-strip-play`, `@layer base html/body/#editor-
    root`); imported from `src/hud/hud.css` after the Tailwind layer imports. `src/hud/lib/utils.ts`
    (`cn`) + `src/hud/ui/{button,tabs,sheet,dialog,tooltip,slider,select}.tsx` copied from
    `src/editor/ui/` — only rewrite was `@/editor/lib/utils`→`@/hud/lib/utils` (+ `@/editor/ui/button`
    →`@/hud/ui/button` in dialog.tsx). `src/config.ts` += `HUD_HOTBAR_SLOTS = 6` (store's local
    `HOTBAR_SLOTS` left untouched — low-churn; a later step migrates it). `src/data/types.ts`
    `BuildableDef` += `readonly category?: 'defense'|'survival'|'craft'`; `src/data/buildables.ts`
    tagged wall/spike_trap→defense, campfire→survival. **Correction to Step 1's reset (applied here,
    inline):** the `#hud-root` reset in `hud.css` was UNLAYERED, so it outranked `@layer utilities`
    and silently defeated spacing/border utilities + `<button>` bg/color across the HUD (the sample
    Button rendered unstyled). Wrapped it in `@layer base` (ranked below `utilities` by the layer
    decl) — scoping invariant intact, utilities now win inside the overlay (mirrors editor.css).
    Verified: typecheck + lint clean (0 errors; no warnings in touched files); `npm run build` +
    built-CSS scoping re-check clean (no global `*`/`html`/`body`/`canvas` preflight; `.bg-primary`
    etc. present); 932 unit tests + smoke canary green; one-off headless render confirmed a sample
    `<Button>` now computes `bg-primary` rgb(90,70,50)=`--color-active`, padding 8/16px, radius 4px
    (temp sample then removed — GameHud restored exactly). Duplication with `src/editor/ui` accepted
    per plan.
  - Extract the `@theme` palette tokens from `src/editor/editor.css` into
    `src/ui-react/tokens.css`; import it from `src/hud/hud.css` (do **not** rewire
    `editor.css` now — consolidation is out of scope). Create `src/hud/ui/` by copying the
    shadcn primitives the HUD needs from `src/editor/ui/`: `button`, `tabs`, `sheet`,
    `dialog`, `tooltip`, `slider`, `select`; add `src/hud/lib/utils.ts` (`cn`), fixing import
    paths to game scope. Data prep so parallel components only *read* shared files:
    `src/config.ts` add `HUD_HOTBAR_SLOTS = 6`; `src/data/types.ts` add optional
    `category?: 'defense' | 'survival' | 'craft'` to `BuildableDef`; `src/data/buildables.ts`
    tag the three existing entries (`wall`→defense, `spike_trap`→defense, `campfire`→
    survival). The `craft` value stays in the union for future content but **no `craft`
    buildable exists yet**, so the catalog must render tabs only for categories that have ≥1
    entry (today: Defense, Survival — no empty Craft tab).
  - Side effects: minor duplication with `src/editor/ui` (accepted; future consolidation is
    out of scope). Adding an optional field to `BuildableDef` is backwards-compatible.
  - Done when: primitives typecheck and a sample `<Button>`/`<Tabs>` renders styled inside
    `GameHud`; `BUILDABLES` entries carry a category; typecheck + lint clean.

- [x] **Step 5: Top-cluster components** `[delegate]` (parallel: A)
  - Outcome: `src/hud/components/{MeterBars,DayNightDial,ResourceChips}.tsx`. MeterBars = SVG
    stroke-dasharray rings (HP/food/fire/supply); HP/food go danger only below threshold (HP ≤0.3
    per legacy UIScene, food ≤`HUNGER_LOW_FRACTION` from config), fire ring hidden when `fire===null`;
    **trend omitted** (store carries no history — documented). DayNightDial = sun/moon arc driven by
    `time` (0..1), "Day N" + NIGHT WAVE banner when `waveInfo.active`. ResourceChips = wood/rock chips
    - zoom `[−] % [+]` emitting `zoom:delta` ±`ZOOM_STEP` (=1, the real control's step, imported from
    config — not the ±0.25 the brief guessed) with [−]/[+] dimmed at MIN/MAX_ZOOM, + follow toggle →
    `camera:center`. Reads hp/maxHp/hunger/maxHunger/fire/supply/time/dayCount/dayPhase/waveInfo/zoom/
    following. Interactive rows get `pointer-events:auto`. typecheck + lint clean (own files). Render
    verified for real at Step 9. (Note: supply appears in both MeterBars and ResourceChips per the
    plan's dual listing — overlap reconciled at Step 9 integration.)
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

- [x] **Step 6: Action components — hotbar + morphing command bar** `[delegate]` (parallel: A)
  - Outcome: `src/hud/components/{Hotbar,CommandBar,Movepad}.tsx`. Hotbar = `HUD_HOTBAR_SLOTS` (6)
    slots from `store.hotbar`, empty dimmed; tap → buildable `build:select`, edible item
    (`ITEMS[id].nutrition != null`) `needs:eat`, weapon/other = no-op (equipment deferred); item icons
    resolve from `${BASE_URL}assets/icons/…`, **buildables fall back to a text label** (`BuildableDef`
    has no `icon` field — confirmed) with a TODO; long-press is a tap-suppressing placeholder (real
    pin lives on catalog/pack). CommandBar morphs by a `mode` PROP ('scavenge'|'build'|'fight'), reads
    `selection`/`orientable`/`demolishMode` for chip highlight/Rotate-gate/Demolish-toggle; emits
    `build:toggle`/`build:select`/`build:rotate`/`demolish:toggle`/`combat:attack`/`combat:bow`, Place
    is a confirm/no-op (world-tap places at Step 10), exposes `onBuild`/`onPack`/`onCraft`/`onStatus`
    - `onMoveHeldChange` callback props for the drawer opens. Movepad = draggable thumb, pure
    `normalize(dx,dy,radius)` clamps magnitude ≤1 (scale-independent), emits `combat:move`/`moveEnd` +
    `onHeldChange`. No store writes (pin deferred to Step 7/11). typecheck + lint clean. Behaviour
    verified at Step 10.
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

- [x] **Step 7: Drawer components — build catalog, pack, status** `[delegate]` (parallel: A)
  - Outcome: `src/hud/components/{BuildCatalog,PackDrawer,StatusDrawer}.tsx`, each a bottom `sheet`
    with an `open`/`onOpenChange` prop (command-bar wiring lands Step 11). BuildCatalog derives tabs
    from the DISTINCT `category` values present in `BUILDABLES` (first-appearance order) — today
    Defense (wall, spike_trap) + Survival (campfire), no Craft tab; grid tiles show cost + dim when
    unaffordable (vs `store.inventory`); select → `build:select` (+ closes), long-press →
    `pinToHotbar({kind:'buildable',id})`. PackDrawer = `store.inventory` grid; edible tap (data-driven
    `ITEMS[id].nutrition != null`, guarded stock>0) → `needs:eat`, long-press →
    `pinToHotbar({kind:'item',id})`. StatusDrawer renders store-backed meters (hp/hunger/fire/supply)
    - edible eat-list; **playerStats stat rows deferred** with a `TODO(Step 11/integration)` since the
    HUD store doesn't expose `playerStats` (did NOT add a store field or read the registry). A compact
    `useLongPress` (450ms) inlined per file. typecheck + lint clean. Behaviour verified at Step 11.
  - `src/hud/components/BuildCatalog.tsx` (tabs derived from the categories actually present
    in `BUILDABLES` — today Defense/Survival, no empty Craft tab; a category grid appears
    only when it has ≥1 entry, so tabs grow automatically as content lands — scrollable grid
    with cost + affordability dim, select → `build:select`, long-press → pin),
    `src/hud/components/PackDrawer.tsx` (full
    inventory grid from the store snapshot, selectable slots, consumable tap → `needs:eat`,
    long-press → pin), `src/hud/components/StatusDrawer.tsx` (meters + stats from
    `playerStats` + eat list → `needs:eat`). Use the `sheet` primitive for the drawer shell.
  - Side effects: write-disjoint; pin-to-hotbar store mutation + persistence lands at Step 11.
  - Done when: each typechecks/lints and renders the populated grid/drawer matching the
    mockup. Behaviour verified at Step 11.

- [x] **Step 8: Overlay components — inspect, companion, dev** `[delegate]` (parallel: A)
  - Outcome: `src/hud/components/{InspectCard,CompanionMenu,DevMenu}.tsx`. InspectCard = bottom `sheet`
    mirroring `store.inspectTarget` (open iff non-null); name + HP bar (danger ≤33%) or Max-HP row +
    `extra[]` rows; close → emits `inspect:hide`. **Bridge fix applied here (parent):** `inspect:hide`
    was absent from the `InboundEvent` union (Step 3 gap — it was outbound-only); added `| { type:
    'inspect:hide' }` to bridge.ts and dropped the agent's `as unknown` cast (the bridge's own
    `inspect:hide` listener clears the store, so the card's open state stays a pure store mirror).
    CompanionMenu = iterates the pure `NPC_MENU_SECTIONS` (read-only from `@/scenes/npcMenu`) into
    Day/Night `Button` sections; `dayRole` opt → `npc:assignDayRole`, `nightPosture` opt →
    `npc:assignNightPosture`, guard-here opt → `npc:beginPlaceGuard`; active option via
    `isNpcMenuOptionActive`; open/dayRole/nightPosture/onClose are PROPS (`npc:menuOpen` wiring at
    Step 12). DevMenu = whole render gated on `import.meta.env.DEV` (returns null in prod), four
    buttons emit `debug:spawnEnemy`/`spawnNpc`/`toggleTime`/`forceWave` (toggle label tracks
    `dayPhase`). typecheck + lint clean. Behaviour verified at Step 12.
  - `src/hud/components/InspectCard.tsx` (entity stats bottom sheet from
    `store.inspectTarget`, close → `inspect:hide`), `src/hud/components/CompanionMenu.tsx`
    (Day/Night posture sections reusing the pure `NPC_MENU_SECTIONS` model from
    `src/scenes/npcMenu.ts`, emits `npc:assignDayRole`/`npc:assignNightPosture`/
    `npc:beginPlaceGuard`), `src/hud/components/DevMenu.tsx` (gated on `import.meta.env.DEV`,
    emits `debug:spawnEnemy`/`debug:spawnNpc`/`debug:toggleTime`/`debug:forceWave`).
  - Side effects: write-disjoint. `npcMenu.ts` is pure and importable — read-only reuse.
  - Done when: each typechecks/lints and renders matching the current Phaser equivalents.
    Behaviour verified at Step 12.

- [x] **Step 9: Integrate the top cluster + retire HudBars/TopCenterControls** `[inline]`
  - Outcome: `GameHud` now composes `MeterBars`+`DayNightDial`+`ResourceChips` inside `.hud-safe`
    (they self-position TL/TC/TR) and drops the temp Step 1–3 badge/readout/corner-markers. Damage +
    starving vignettes moved to a DOM `Vignettes` layer over the canvas rect: the red damage flash
    pulses via the Web Animations API on the store's `hitNonce` (instant-rise → Cubic-ease-out fade,
    mirroring the old tween), the yellow starving tint is a steady radial-gradient whose opacity ramps
    from `HUNGER_LOW_FRACTION` down (reusing the shared `*_VIGNETTE_*` config, converted `0xRRGGBB`→CSS).
    `UIScene` retirements: removed `HudBars` + `TopCenterControls` construction/fields/imports, the
    `zoom:changed`/`camera:followChanged`/`fire:changed`/`supply:changed`/`player:hit` subs + teardown,
    the Phaser vignette bakes (+ `bakeVignetteTexture` import, now unused there), `onPlayerHit`, and the
    `hudBars.*`/`hungerVignette`/`topCenter.setTime` lines from `updateHealthBar`/`updateHungerBar`/
    `onTimeChanged` — those methods now feed ONLY the WellbeingPanel (retired Step 11) + the DEV
    phase label. No double-render (the always-on bars are DOM-only now). **e2e adaptation:** the
    `zoom`/`follow` specs were already event-driven (`emit` + camera/registry/`captured`), NOT Phaser-HUD
    queries, so they pass UNCHANGED — verified all 4 green. Left `src/scenes/hud/{HudBars,
    TopCenterControls}.ts` + `render/vignetteTexture.ts` on disk for the Step 13 dead-code sweep.
    typecheck + lint (0 errors) + 932 unit + build + smoke green; a headless in-game check confirmed
    live meters, DOM zoom raising the camera + `%` readout, Follow emitting `camera:center`, and both
    vignettes firing.
  - Compose `MeterBars` + `DayNightDial` + `ResourceChips` into `GameHud`; subscribe them to
    the store. Remove `HudBars` and `TopCenterControls` construction/wiring from
    `src/scenes/UIScene.ts`. Move the damage + hunger vignettes to a DOM overlay layer in
    `GameHud` (CSS radial-gradient tied to `player:hit` / hunger threshold) and drop the
    Phaser vignette images.
  - Side effects: `UIScene` still runs (other widgets remain) — ensure no double-render of
    migrated widgets. Watch the restart path. **Adapt the e2e spec(s) covering this cluster
    in THIS step** (zoom/follow assertions in `gestures`/`zoom` specs now query the DOM, not
    canvas objects) — do not defer them to cutover.
  - Docs: none.
  - Done when: adapted zoom/follow spec(s) pass; HP/food/fire/supply, day/night phase + wave
    banner, zoom, and follow all match prior behaviour and update live; vignettes fire on
    hit/starving.

- [x] **Step 10: Integrate hotbar + command bar + movepad-held bridge; retire
  BuildControls/CombatControls/ModeControls** `[inline]`
  - Outcome: `GameHud` gained a bottom `ActionLayer` — the persistent `Hotbar` above the morphing
    `CommandBar`; `barMode` is derived from the store (`buildMode` → build, else `mode==='combat' ||
    combatActive` → fight, else scavenge — mirrors the old UIScene precedence). **CommandBar extended
    at integration:** the Step-6 component had no mode-toggle / cancel-queue affordances, so a
    persistent utility rail was added (Fight → `mode:combatToggle`, Inspect → `mode:inspectToggle`,
    Cancel Queue → `tasks:cancel`, shown only when `tasks` has work) — this is where the retired
    `ModeControls` + `BuildControls` Cancel button now live. Movepad-held coupling: added
    `Bridge.setMovepadHeld` → sets the registry `movepadHeld` flag; `GameScene`'s `isMovepadHeld` dep
    now reads `registry.get('movepadHeld') === true` (was `this.ui.isMovepadHeld()`), reset to false
    each (re)start. `UIScene` retirements: removed `BuildControls`/`CombatControls`/`ModeControls`
    (imports, fields, construction, their `build:*`/`demolish:*`/`tasks:changed`/`combat:activeChanged`
    subs + teardown, `isMovepadHeld`, `refreshCombatControls`/`combatControlsShown`/
    `onCombatActiveChanged`, the R-key + control-hint), trimmed `onModeChanged` to just the
    inspect-panel hide, dropped `refreshBuildPalette` from `refreshInventory`, simplified `onEscape`,
    and hid the Phaser hotbar (`inventory.setHotbarVisible(false)`) to avoid a double hotbar (the rest
    of InventoryWidget retires Step 11). Only GameScene-side edit is the one-line registry read.
    **e2e:** build/combat/gestures/follow (24) + zoom (4) all pass UNCHANGED — event-driven, not
    Phaser-HUD queries. typecheck + lint (0 err) + 932 unit + build + smoke green; a headless DOM check
    confirmed the build/fight morphs, `movepadHeld` toggling true/false on movepad drag, and the
    Fight/Inspect/Cancel-Queue emits.
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

- [x] **Step 11: Integrate drawers + pin-to-hotbar + interactive inventory; retire
  WellbeingPanel/InventoryWidget/build palette** `[inline]`
  - Outcome: `GameHud`'s `ActionLayer` now owns a single `openDrawer` state and renders `BuildCatalog`
    /`PackDrawer`/`StatusDrawer`, wired to `CommandBar`'s `onBuild`/`onPack`/`onStatus`. **Craft button
    dropped** (deviation, flagged): the game has no item-crafting system — building structures IS the
    only crafting — so the mockup's Craft affordance had no backing action; removed `onCraft` prop +
    button (documented in CommandBar). **playerStats:** added a `playerStats: CombatantStats | null`
    store field + `setPlayerStats`; `bridge.ts` reads registry `playerStats` at init and follows
    `setdata`/`changedata-playerStats` (mirrors the inventory bind, disposed cleanly) — StatusDrawer's
    Step-7 TODO resolved, stat rows (Max HP/Armour/Speed/Vision/Strength/Dex/Dodge) now render, hidden
    until the bag resolves. **Persistence:** new pure `src/hud/hotbarStorage.ts` (null-safe
    localStorage, normalises to `HUD_HOTBAR_SLOTS`, drops stale/unknown ids to empty slots but keeps
    unowned-but-valid pins, malformed record → treated absent never throws); `useBridge` hydrates it at
    mount (`loadHotbar(START_MAP_ID)`) then subscribes to persist every `hotbar` change (`saveHotbar`).
    **Keyed per save via `START_MAP_ID`** (`mostowo-hud:hotbar:the-moon`) — the game has no save-slot
    system yet, so the loaded map id stands in as the save identity (key scheme extends when real saves
    land). PackDrawer/StatusDrawer eat (`needs:eat`) + BuildCatalog select (`build:select`) + long-press
    pin were already built in Step 7 — this step wired them live. **Retired from `UIScene`:**
    `WellbeingPanel` + `InventoryWidget` (imports, fields, construction, the `inv`/`playerHp`/`playerMaxHp`
    state, `refreshInventory`/`updateHealthBar`/`updateHungerBar`/`seedMaxHp`/`onPlayerHp`/`onHungerChanged`
    - their `player:hpChanged`/`hunger:changed` subs, and `setHotbarVisible`); the `.ts` files stay on disk
    for the Step 13 sweep (matches Steps 9–10). The Phaser build palette was already gone (Step 10). Only
    remaining UIScene widgets: Inspect/Dev/NPC-assign (Step 12). **Verification:** `npm run typecheck`
    (0 errors, TS 5.9.3 — note: this container booted with node_modules unpopulated + a stray global tsc
    6.0.2 that emitted a spurious `baseUrl` TS5101; a clean `npm ci` fixed it, no tsconfig change needed),
    `npm run lint` (0 errors; ~100 pre-existing test/e2e `any` warnings), `npm run build`, and
    `SMOKE_CHROMIUM_PATH=… npm run smoke` all green; `npm test` 939 passing (+7 new: 2 bridge playerStats,
    5 hotbarStorage). Targeted e2e green UNCHANGED (event-driven, not Phaser-HUD queries): build (3),
    block-full, survival-forage, survival-hunger (5) = 10 passed. A one-off headless DOM check confirmed
    Status/Pack/Build drawers open, Build tabs = Defense/Survival (no Craft), long-press pins "Wall" onto
    the hotbar, it persists to `mostowo-hud:hotbar:the-moon` and survives a reload, 0 console errors.
  - Wire `BuildCatalog`, `PackDrawer`, `StatusDrawer` as bottom sheets opened from the
    command bar. Implement pin-to-hotbar (store loadout mutation + `localStorage` persistence,
    keyed per save). Make inventory slots interactive (select + eat via `needs:eat`; build
    quick-select via `build:select`). Weapon slots: pin is allowed but "use" wires to the
    existing melee/bow for now (no equipment system — see Out of scope). Remove
    `WellbeingPanel`, `InventoryWidget`, and the Phaser build palette from `UIScene`.
  - Side effects: `Inventory` becomes read-for-display + eat/select actions via events; no
    change to `Inventory` internals. Persisted loadout must tolerate items no longer owned.
    Adapt the e2e spec(s) covering the build palette / inventory to DOM queries in THIS step.
  - Docs: none.
  - Done when: eat from pack/status, build-select from the catalog, pin an item and see it on
    the hotbar (surviving reload), and open/close drawers by swipe — all verified.

- [x] **Step 12: Integrate inspect + companion + dev; retire InspectPanel/NpcAssignMenu/
  DevMenu** `[inline]`
  - Compose `InspectCard`, `CompanionMenu`, `DevMenu` into `GameHud`; wire `inspect:show`/
    `inspect:hide`, `npc:menuOpen` + `npc:*`, `debug:*`. Remove `InspectPanel`,
    `NpcAssignMenu`, and the Phaser `DevMenu` from `UIScene`.
  - Side effects: the NPC guard-placement flow (`npc:beginPlaceGuard` → one-tap point place)
    must still work end-to-end through the DOM menu. Adapt any inspect/companion e2e spec(s)
    to DOM queries in THIS step.
  - Docs: none.
  - Done when: inspect an enemy/tree/structure, assign companion Day/Night postures + place a
    guard point, and use dev spawn/time/wave — all verified.
  - Outcome: touched `src/hud/store.ts` (new `companionMenu` state + `openCompanionMenu`/
    `closeCompanionMenu` actions; `import type` for NPC role/posture — erased, no Phaser
    coupling), `src/hud/bridge.ts` (subscribe outbound `npc:menuOpen` → `openCompanionMenu`;
    extend `mode:changed` to clear inspect when leaving inspect mode — the DOM port of the
    retired `UIScene.onModeChanged`, since GameScene's `setMode` emits only `mode:changed`,
    never `inspect:hide`), `src/hud/GameHud.tsx` (new `Overlays` sub-component composing
    `InspectCard`/`CompanionMenu`/`DevMenu` into `.hud-safe`; companion `onClose` is
    close-only — must NOT emit `npc:cancelPlaceGuard` or "Guard here" would disarm its own
    just-armed placement), and `src/scenes/UIScene.ts` (removed all three widgets + their bus
    wiring + `onModeChanged`/`onTimeChanged`; `onEscape` simplified to the guard-cancel;
    `hudHitTest`/`hudElements` now empty but kept for the Step 13 retirement). `CompanionMenu`
    ignores `npc:menuOpen`'s `x`/`y` (bottom sheet, not the legacy anchored popover). The three
    Phaser widget `.ts` files stay on disk for the Step 13 sweep (matches Steps 9–11). No e2e
    rewrite needed — the `inspect`/`companion`/`mode` specs are bus/event-driven, not
    widget-driven. Verified: typecheck + lint (0 errors) + build (DevMenu strings dead-code-
    eliminated from prod; "Assign companion" ships) + smoke + `inspect`/`companion`/`mode` e2e
    (19 passed) + a one-off headless DOM check (10/10: cards open on their events,
    "Repair"→`npc:assignDayRole=repair`, "Guard here"→`npc:beginPlaceGuard`, mode-change clears
    inspect, DevMenu FORCE WAVE→`debug:forceWave`).

- [x] **Step 13: Cutover — remove UIScene + retire the hudHitTest input path** `[inline]`
  - Remove `UIScene` from the scene list in `src/main.ts`; remove the GameScene-side wiring
    that references it — the `this.ui` field and any `scene.launch('UI')`/`scene.get('UI')`
    calls (`GameScene.ts`) — then delete `src/scenes/UIScene.ts` + `src/scenes/hud/*` (now
    fully replaced). Retire the `hudHitTest`/`addHudElement` deps-closure and its
    `PointerInputController` use — DOM `pointer-events` capture now gates taps (root
    `pointer-events:none`, `auto` on controls; empty HUD space falls through to the canvas).
    Keep the `movepadHeld` gate from Step 10. **Sweep now-dead consts** in `src/config.ts`
    (`HOTBAR_SLOTS`, `INVENTORY_SLOTS` — verify no remaining consumers; `HUD_HOTBAR_SLOTS`
    supersedes). Check `src/ui/*` (Phaser kit) for any remaining non-editor consumers; if
    none, delete it, else leave with a note.
  - Side effects: most canvas-HUD specs were DOM-adapted in their retiring steps (9–12); this
    step handles the **remainder + cross-cutting** — `tests/e2e/refactor-tripwire.spec.ts`
    (structure guard) and any spec still asserting on `UIScene`. `window.game.__test` may need
    small DEV-only HUD-state hooks. Confirm no spec still references deleted Phaser HUD code.
  - Docs: none (docs land in Step 14).
  - Done when: no `UIScene` in the scene list, no dead Phaser HUD code, full e2e suite +
    smoke green, and manual play shows the complete DOM HUD with world gestures intact.
  - Outcome: `src/main.ts` — dropped the `UIScene` import + removed it from the scene list.
    `src/scenes/GameScene.ts` — removed the `UIScene` import + `this.ui` field, the `hudHitTest`
    dep from the `PointerInputController` deps-closure, and the `scene.launch('UI')`/`scene.get`
    wiring in `buildWorld` (the four state re-emits — `mode:changed`/`combat:activeChanged`/
    `demolish:modeChanged`/`supply:changed` — STAY: the page-level HUD bridge re-syncs from them
    on each restart); also simplified `openNpcMenu` to drop the now-ignored `x`/`y` popover-anchor
    payload (removing the last `RENDER_SCALE` use here) and refreshed the stale `UIScene` comment
    references throughout to "the HUD". `src/scenes/input/PointerInputController.ts` — retired the
    `hudHitTest` dep, `pointerOnHud`, and the `downOnUI` field + all its gate checks; taps are now
    gated purely by DOM `pointer-events` (the `movepadHeld` registry flag stays). `src/config.ts`
    — deleted `HOTBAR_SLOTS` (its only consumer was the deleted InventoryWidget); **kept
    `INVENTORY_SLOTS`** (still the real `Inventory` capacity in GameScene + used by
    `block-full.spec.ts` — verified, so NOT dead). Deleted `src/scenes/UIScene.ts`,
    `src/scenes/hud/*` (11 files), and the whole Phaser UI kit `src/ui/*` (6 files — verified its
    only importers were the deleted `scenes/hud/*`). `scripts/smoke.mjs` — swapped the retired
    "UI scene active" assertion for a "DOM HUD mounted (command bar present)" check. No
    `refactor-tripwire`/`__test` changes needed (the tripwire asserts `debugState()`, not the
    HUD; no spec had an executable `UIScene` reference — only historical comments). Verified:
    typecheck + lint (0 errors) + build + smoke + the input-critical/structure e2e set
    (`refactor-tripwire`, `gestures`, `follow`, `build`, `combat`, `zoom`, `mode` — 28 passed) +
    a one-off headless gating check (5/5: full HUD renders, no Phaser `UI` scene, command-bar tap
    intercepts, empty HUD space falls through to the CANVAS). Full e2e suite deferred to Step 14
    per the plan's end-of-plan verification.

- [x] **Step 14: DOM e2e coverage + docs** `[inline]`
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
  - Outcome: added 3 DOM-driven spec files (9 tests, all green) — `tests/e2e/hud-cluster.spec.ts`
    (meters reflect HP/food/fire/supply events, day/night dial + wave banner, starving vignette
    ramp), `tests/e2e/hud-drawers.spec.ts` (build catalog opens + Defense/Survival tabs + select→
    `build:select`+close; pack lists stock + tap-consumable→`needs:eat`; long-press-pin→hotbar +
    survives reload via localStorage), `tests/e2e/hud-overlays.spec.ts` (inspect card mirror +
    dismiss→`inspect:hide`; mode-change clears inspect; companion menu opens on `npc:menuOpen`,
    rows emit `npc:assignDayRole`/`npc:beginPlaceGuard`). They drive the real DOM controls +
    the bus, no canvas/timing. Docs: `docs/ui-overhaul/README.md` status → BUILT (v5) + deviations;
    `docs/CONVENTIONS.md` scenes/input/manager bullets rewritten + a new `src/hud/` seam bullet
    (DOM overlay, bridge, `pointer-events` gating, persist-across-restart lifecycle); `docs/STATUS.md`
    "Menu / UI kit" replaced with a "HUD — DOM/React overlay" section; `docs/DECISIONS.md` + the
    `architecture` shard: existing 2026-07-22 entry marked **Landed 2026-07-23** with deviations
    (rather than a duplicate entry); `CLAUDE.md` architecture map updated (`src/scenes/` no longer
    lists a HUD scene; `src/ui/` bullet replaced by `src/hud/`; editor "never loads Tailwind" claim
    corrected). `docs/STANDARDS.md` already carried the scoped-Tailwind note from Step 1 (left as-is).
    Verified: typecheck + lint (0 errors) + the 3 new specs (9 passed) — the full-suite run is the
    remaining pre-review gate below.

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
- **Craft catalog tab** — hidden until at least one `craft`-category buildable exists (the
  category is reserved in the schema; the tab renders itself once content lands).
- **New juice/haptics** beyond parity (tap-ack, vignettes) — polish pass is separate.

## Critique

> Reviewed 2026-07-22 (fresh-eyes pass). Findings below were resolved in this revision:
> plan renumbered 045→**046** (045 was reserved for the test re-tier); direction decision
> recorded in `docs/ui-overhaul/README.md` + `docs/DECISIONS.md`; the "zero GameScene
> changes" claim corrected (deps-closure at Step 10, `scene`/`this.ui` removal at Step 13);
> Tailwind v4 preflight-scoping mechanism made concrete (Step 1); e2e adaptation distributed
> into each retiring step; bridge lifecycle reworded to persist-and-re-sync; dead consts
> swept at Step 13; empty Craft tab dropped. Full-migration scope confirmed by owner.

**Verdict:** Technically well-grounded and convention-aware; the two blocking issues
(unratified direction + plan-number collision) are resolved, remaining findings folded into
the steps.

|#|Finding|Lens|Severity|Resolution|
|-|-------|----|--------|----------|
|1|Built Field Kit while docs recorded Twin Grip as front-runner; decision only in chat|Strategic fit / reversibility|High|Owner (Matt) confirmed Field Kit; recorded in `docs/ui-overhaul/README.md` + `DECISIONS.md`|
|2|Plan number 045 already reserved for the test re-tier (Phase 2 of plan 044)|Consistency|Medium|Renumbered to 046|
|3|"Zero GameScene changes" inaccurate (`this.ui`, `scene.launch`, deps-closures)|Gaps / executability|Medium|Reworded; edits assigned to Steps 10 & 13|
|4|Full catalog/loadout for 3 buildables + empty Craft tab|Right-sizing|Medium|Full migration kept (owner); Craft tab hidden until content exists|
|5|Tailwind preflight scoping hand-wavy; "editor proves it" a false precedent|Gaps / risks|Medium|Concrete v4 layer-import + scoped reset in Step 1; false precedent removed|
|6|e2e adaptation big-banged at cutover|Executability / sequencing|Medium|Each retiring step (9–12) now adapts its own spec(s)|
|7|Bridge "teardown on SHUTDOWN" wrong for a page-level overlay|Gaps|Low|Reworded to persist across restart + re-sync on START|
|8|Dead `HOTBAR_SLOTS`/`INVENTORY_SLOTS` left in config|Consistency|Low|Swept in Step 13 cleanup|
