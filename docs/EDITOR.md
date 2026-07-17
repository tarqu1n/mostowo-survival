# Map Builder (dev-only editor)

The in-repo map editor (plan 014). A React chrome wrapping one Phaser viewport, served as a second
Vite page in dev only — **never** in the prod build (`build.rollupOptions.input` stays index-only).
Authors the custom-JSON maps the game loads at runtime.

## Run

```sh
npm run editor      # vite --open /editor.html
```

Dev-server only. It writes files through a `serve`-mode Vite middleware
(`scripts/vite-editor-api.mjs`, endpoints under `/__editor/*`) — there is no hosted/prod editor.

## Layout

Three panes: **Library** (left — asset catalog, search, favourites, Nodes, Terrains), **viewport**
(centre — the Phaser canvas, tabbed: a permanent **Map** tab + **World** tab, plus on-demand
object-editor tabs), **Inspector / Layers / Zones** (right). Toolbar on top: New/Open/Save/**Edit**,
undo/redo, tool strip, overlay toggles.

## Tools & shortcuts

Tools: pan, brush, eraser, fill, rect, eyedropper ("Pick"), select, place, portal, collision, zone, shape, terrain.
The **eyedropper** ("Pick") samples the tile or object under the cursor and arms it (then switches to the matching paint tool) — a click/tap works on touch; on desktop, Alt+click while a tile-paint tool is active does the same.
The **authoritative, always-current** shortcut list is the in-app **Shortcuts** panel, driven by
`src/editor/shortcuts.ts` — keep that file in sync when a shortcut changes (don't duplicate the
bindings here).

**Brush tool** — arm a tileset piece and rotate it in 90° steps (see Shortcuts panel for keys and toolbar buttons); a rotated tile becomes a distinct palette entry; ghost preview shows the pending angle. Fill and rect gestures paint at angle 0.

**Place tool — free rotation** — a rotation **wheel** (drag the dial, or type into its centre input; hold Shift while dragging to snap to 15°) sets an arbitrary angle stamped onto the next decor/node placed. The angle is sticky (`store.placeRotation`) so a whole row goes down at one angle. Decor and nodes both carry a `rotation` field (degrees, matching Phaser's clockwise `setAngle`); portals have none. The same wheel appears in the **Inspector** for a single selected decor/node — an Inspector wheel drag is one undoable command (commit-on-release, like the numeric fields), while the placement wheel is view-state (no history). Node rotation renders in the live game too (`ResourceNodeManager`), not just the editor.

## Touch / mobile (plan 027)

> **Actually running it on a phone?** See [MOBILE-EDITOR-ACCESS.md](MOBILE-EDITOR-ACCESS.md) —
> it's hosted on guppi over Tailscale (just open the URL), plus how autosave reaches GitHub, the
> git-conflict playbook when a phone Claude Code session also touches `master`, and the
> cloud-container fallback.

Below a compact breakpoint (`src/editor/hooks/useIsCompact.ts`,
`(max-width: 960px), (pointer: coarse) and (max-width: 1200px)`) the shell goes full-bleed: Library
and the tabbed Inspector/Layers/Zones/Reference column collapse into slide-in **Sheet drawers**
(edge-handle buttons), and the World tab's map tray becomes a drawer too. Above it, desktop is
**unchanged** (resizable Library split, fixed Inspector column).

**Library on touch (plan 030):** the compact Library/Inspector drawers are **full-width**. Picking any
asset **auto-closes** the Library drawer so you can paint immediately. A **Recent strip** at the top of
the panel (desktop + compact) re-picks recently-used assets in one tap — all tiles grouped into one
horizontally-scrolling swatch row, decor/node/terrain after. On compact, the category tree **drills
down**: picking a category hides the tree and gives the results grid the full height, with a `‹ Back`
control; and favouriting is **long-press** (tap = pick, long-press = toggle favourite + toast) with no
heart overlay — desktop keeps its visible ♥ click. Recent + browse state (search/category/expansion)
are view-state, persisted per-map to localStorage (see the persistence contract); favourites are
unchanged (per-zone/map in the `.map.json`).

Map viewport gestures: single-finger = the active tool's paint/place (same as left-click drag);
two-finger = pan by midpoint + pinch-zoom (integer ×1–4, snapped). World tab: two-finger pinch-zoom
about the midpoint only (no two-finger pan there); desktop mouse-drag-to-place + wheel-zoom
unchanged. **Limitation:** placing a map from the tray is drag-based and stays desktop-only — the
compact tray drawer is view-only on touch.

A per-tool **context bar** (`src/editor/ContextBar.tsx`, compact-only, bottom/thumb-reach) mirrors
the keyboard vocabulary on-screen: persistent Undo/Redo; brush rotate ∓90°; a paint-mode gesture
picker + erase/invert toggle for collision/zone/shape/terrain; free-pixel toggle for place/select;
multi-select toggle + Delete + 4-way nudge for select; underlay-visibility and skin-cycle when
applicable. Its erase/free-pixel/multi-select toggles are sticky store flags, independent of the
desktop-only momentary Alt/Shift modifiers they mirror.

**Toolbar actions:**

- **Edit map** (plan 025) — a dialog grouping two map-level operations, each with its own primary
  button + a shared Cancel. Toolbar button only (no shortcut); disabled when no map is open.
  - **Rename** — changes both the display name (`map.meta.name`) and the on-disk id (`map.meta.id`).
    Gated by a native confirm; an id already used by another map on disk is rejected before Apply; id
    must match `/^[a-z0-9-]+$/`. This is an **immediate, non-undoable disk migration** (not a normal
    edit-then-Save step) — see the persistence contract below for exactly what it writes/removes.
    Reverse a rename by renaming back.
  - **Resize** (plan 024, unchanged) — grow/crop the open map by per-edge tile deltas
    (Top/Right/Bottom/Left; `+` adds, `−` crops), with a live `W×H` preview; bounded to `1..512` per
    side. Apply is **blocked** if any object would fall outside the new bounds (the offending ids are
    listed); a crop that discards painted cells asks to confirm (undo restores it). One undoable step.
    For a placed map, a **top/left** edit auto-shifts the world placement origin so content stays
    fixed in global space (world layout goes dirty — **Save World** separately from Save Map); the
    reference underlay offset re-aligns too.

## Map vs World view

- **Map tab** — edit one map: paint tile layers, place/transform scenery, paint walkability, zones,
  and the shape mask; the autotile terrain brush; per-map undo/redo. When the open map is placed in
  the world, dimmed read-only **ghost strips** of placed neighbours render just outside its bounds
  (toggle: `overlays.ghosts`).
- **World tab** — position maps in one global tile coordinate space (`world.json`). Drag maps from a
  tray onto the grid; overlap of inside-cells = red error (Save disabled); seam/adjacency/island
  issues = amber warnings (non-blocking). Placements are the only thing the World tab writes.

## Reference overlay

**Map tab** tracing aid: semi-transparent reference image (e.g. OSM capture) rendered **over** the
tile layers (so opaque painted tiles never hide it — trace and check coverage through its alpha),
below the grid + editor guide overlays. References committed to `scripts/map-reference/out/` are
loaded via **dropdown** in the Reference panel; **file-picker / drag-drop** load ad-hoc images.
Transform settings (opacity, X/Y offset, scale) persist **per-map to localStorage** under
`mostowo-editor-underlay:` (key migrates on rename) — never in `.map.json` or prod. Sidecar JSON
auto-aligns to grid.
Toggle with `U` or panel checkbox. Phone-usable. Capture tool — new references in-editor via **Reference → "Capture new"** (name + `lat,lon` + radius, runs on dev-server), or batch-script via the CLI — see [map-reference/](../scripts/map-reference/README.md).
Manage a committed reference from the dropdown: **Recapture** re-runs the OSM capture in place from its own sidecar (same centre + extent, overwrites the image; needs a sidecar with capture metadata), and **Delete** removes its `out/<name>-reference.{png,json}` from the repo (`DELETE /__editor/map-references/:name`) — both evict the cached bytes, and Delete also clears the overlay if that reference is the one currently shown.

## Node Types (authored resource nodes)

A central-pane **Node Types** tab authors the resource-node registry (`src/data/maps/nodes.json`) —
replacing the old compile-time `NODES` constant. Per def: gameplay stats (name, HP, yield item +
amount, regrow, blocks-path, harvest anim, colours) plus a list of **skins** — interchangeable
sprites drawn from the asset catalog, each with a live sprite, an optional matching
**depleted/stump** sprite (absent ⇒ today's tint-to-`stumpColor` fallback), a weight, and optional
per-skin sizing overrides. **Duplicate** a def to spin up a yield **tier** (e.g. a bigger tree worth
more wood) with its own skins. Delete is blocked while any map still references the def.

**Layout (plan 030, desktop + compact):** a stacked view — a full-width **collapsible list on top**
(selecting a def collapses it to a `Node types — {name}` summary and shows that def's controls below;
tap the header to switch), then the stats form, then a **collapsible Skins** section (collapsed shows a
thumbnail summary bar + count; default expanded on desktop, collapsed on compact).

Three independent axes: **tier** = a separate def (gameplay), **skin** = which sprite a placed node
uses (aesthetics), **state** = live↔depleted (runtime, never authored/serialized). On placement a
skin is rolled **weighted-random** and persisted on the node (`NodeObject.skin`); override it in the
**Inspector** (Skin dropdown, shown when the def has ≥2 skins) or press **S** to cycle the selected
node's skin. An omitted `skin` ⇒ the def's first skin, so legacy maps round-trip byte-identical.

## File formats — source of truth is the code

Do **not** treat this doc as the schema. The authoritative shapes + validators are:

- **Map** (`*.map.json`): `src/systems/mapFormat.ts` — `parseMap`/`serializeMap`/`createEmptyMap`/
  `migrateMap`, and the `MapFile` type. `terrain` is editor-only (the game reads baked
  `TileLayer.cells`, never the semantic mask). Terrain autotile bakes at a cropped edge self-heal on the next Save via `rebakeTerrainsForSave()`.
- **World** (`world.json`): `src/systems/worldLayout.ts` — `parseWorldLayout`/`validateWorld`, the
  global-coord helpers, and the manifest seam.
- **Node defs** (`src/data/maps/nodes.json`, sibling of `world.json`): `src/systems/nodeDefs.ts` —
  `parseNodeDefs` (boot-time fail-fast parser AND the editor's form validator) + the `AuthoredNodeDef`/
  `NodeSkinDef` types. `version: 1`; a def's `skins[0]` is its default. Cross-file checks (map `ref` ∈
  defs, `NodeObject.skin` ∈ that def's skins, every skin `asset` ∈ catalog) live in the
  world-integrity test.

### Rules the validator enforces (know these before authoring)

- **Palette is append-only.** Layer cells are small ints indexing `palette`; `0` = empty. The editor
  never renumbers existing indices (GC is an explicit user action only) — so save diffs stay small.
- **Shape / void.** `shape.cells` (0 = void, 1 = inside; absent = all-inside). Void-consistency is an
  invariant: a void cell has `0` in every tile layer, zone `0`, and no object footprint over it. All
  paint tools skip void. Void feeds `isBlocked` as blocked at runtime.
- **Objects** are one array with a `kind` discriminator (`node`/`decor`/`portal`), each with a stable
  string `id`. Nodes have an optional `depthBias?: number` field for same-row draw-order control; absent ⇒ 0 (see `rowDepthOffset` in mapFormat.ts). Anything that can change at runtime **must be an object**, never painted into tile
  layers (see persistence contract).

## Generated artifacts — never hand-edit

- `src/data/maps/manifest.json` — regenerated by the editor middleware on every map/world save; the
  game's only eager map import.
- `public/assets/maps/thumbs/<id>.png` — 1px-per-tile thumbnail, re-baked on every map save (the
  future world-map screen's data source). A **rename** re-bakes it under the new id and removes the
  old `<oldId>.png` (manifest regenerates as part of the same delete).
- `public/assets/asset-catalog.json` — regen via `npm run assets:catalog`.

## Persistence contract

Authored map files are **immutable** and never carry runtime state. Persistent mutations (opened
gate, looted container, …) will be a future **save-side overlay** keyed `{mapId, objectId}`, applied
above the registry — so `loadMap` stays a pure authored-file fetch. Consequently tile
layers/walkability/zones/shape are never overlayable: **runtime-mutable things are objects with
stable ids**, and a gate opening = the overlay patches that object, its footprint vanishes, tiles
unblock via the existing `isBlocked` composition.

Each authored file has its own bespoke dev-middleware handler in `scripts/vite-editor-api.mjs`:
`GET/PUT /__editor/world`, `/__editor/maps/:id` (regenerates the manifest + thumbnail; also
**DELETE**, which removes the `.map.json` + thumb and regenerates the manifest), and `/__editor/nodes`
(writes `nodes.json`; no manifest regen — node defs aren't a map placement).

**Rename id-migration contract** (Edit map's Rename, plan 025): an immediate, non-undoable disk
migration — writes `<newId>.map.json` **first**, migrates in-memory + localStorage state, re-bakes
the thumb under the new id, saves the world layout if the map is placed (rewriting that placement's
`mapId`), then **DELETE**s `<oldId>.map.json` + its thumb **last** (write-new-before-delete-old, so a
failure never orphans the live map). Also migrates the `mostowo-editor-underlay:settings:<id>` and the
Library view-state keys (below) old→new.

**Library view-state (plan 030):** the Recent strip and browse state persist **per-map to
localStorage** (never in `.map.json`) under `mostowo-editor-library:recents:<mapId>` and
`…:browse:<mapId>` (`src/editor/libraryViewStore.ts`). `browse` excludes `search` (transient,
store-only — survives close/reopen, not a reload). Both keys migrate on rename and reset on map close.

## Regions on tile assets (plan 028)

The ⚙ Regions editor is reachable on a **tile**-classed asset too, via an "Edit regions" toggle
beside the Type dropdown — no type demotion. Regions drawn this way are tagged `role:'object'` on
save (a per-selected-box badge shows the role), letting a mixed sheet's props (e.g. a fountain on a
terrain sheet) become placeable while the sheet stays `tile` and terrain keeps tiling. Details +
occlusion/invariant: [ASSETS.md](assets-catalog.md#atlas-sprite-regions-plan-014-step-7a).

## Packs & catalog

How asset packs, the catalog, atlas regions, and type/grid overrides work: see
[ASSETS.md](ASSETS.md). The editor reads `asset-catalog.json` (+ `regions.json`, `terrains.json`);
it never touches the game's runtime registry.

## How the game loads maps

Through the lazy registry `src/systems/mapRuntime.ts`: eager `manifest.json` + `world.json`, each
`*.map.json` a lazy per-map chunk (`import.meta.glob`). The game boots into one authored map
(`START_MAP_ID`); adjacent-map streaming is [plan 019](../plans/019-l1-map-streaming.md). The editor
uses its dev middleware, never this registry — no coupling.
