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
object-editor tabs), **Inspector / Layers / Zones** (right). Toolbar on top: New/Open/Save,
undo/redo, tool strip, overlay toggles.

## Tools & shortcuts

Tools: pan, brush, eraser, fill, rect, select, place, portal, collision, zone, shape, terrain.
The **authoritative, always-current** shortcut list is the in-app **Shortcuts** panel, driven by
`src/editor/shortcuts.ts` — keep that file in sync when a shortcut changes (don't duplicate the
bindings here).

**Toolbar actions:**

- **Resize** — grow/crop the open map by per-edge tile deltas (Top/Right/Bottom/Left; `+` adds, `−`
  crops), with a live `W×H` preview; bounded to `1..512` per side. Apply is **blocked** if any object
  would fall outside the new bounds (the offending ids are listed); a crop that discards painted
  cells asks to confirm (undo restores it). One undoable step. For a placed map, a **top/left** edit
  auto-shifts the world placement origin so content stays fixed in global space (world layout goes
  dirty — **Save World** separately from Save Map); the reference underlay offset re-aligns too.
  Toolbar button only (no shortcut); disabled when no map is open.

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
`mostowo-editor-underlay:` — never in `.map.json` or prod. Sidecar JSON auto-aligns to grid.
Toggle with `U` or panel checkbox. Phone-usable. Capture tool — new references in-editor via **Reference → "Capture new"** (name + `lat,lon` + radius, runs on dev-server), or batch-script via the CLI — see [map-reference/](../scripts/map-reference/README.md).

## Node Types (authored resource nodes)

A central-pane **Node Types** tab authors the resource-node registry (`src/data/maps/nodes.json`) —
replacing the old compile-time `NODES` constant. Per def: gameplay stats (name, HP, yield item +
amount, regrow, blocks-path, harvest anim, colours) plus a list of **skins** — interchangeable
sprites drawn from the asset catalog, each with a live sprite, an optional matching
**depleted/stump** sprite (absent ⇒ today's tint-to-`stumpColor` fallback), a weight, and optional
per-skin sizing overrides. **Duplicate** a def to spin up a yield **tier** (e.g. a bigger tree worth
more wood) with its own skins. Delete is blocked while any map still references the def.

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
  string `id`. Anything that can change at runtime **must be an object**, never painted into tile
  layers (see persistence contract).

## Generated artifacts — never hand-edit

- `src/data/maps/manifest.json` — regenerated by the editor middleware on every map/world save; the
  game's only eager map import.
- `public/assets/maps/thumbs/<id>.png` — 1px-per-tile thumbnail, re-baked on every map save (the
  future world-map screen's data source).
- `public/assets/asset-catalog.json` — regen via `npm run assets:catalog`.

## Persistence contract

Authored map files are **immutable** and never carry runtime state. Persistent mutations (opened
gate, looted container, …) will be a future **save-side overlay** keyed `{mapId, objectId}`, applied
above the registry — so `loadMap` stays a pure authored-file fetch. Consequently tile
layers/walkability/zones/shape are never overlayable: **runtime-mutable things are objects with
stable ids**, and a gate opening = the overlay patches that object, its footprint vanishes, tiles
unblock via the existing `isBlocked` composition.

Each authored file has its own bespoke dev-middleware handler in `scripts/vite-editor-api.mjs`:
`GET/PUT /__editor/world`, `/__editor/maps/:id` (regenerates the manifest + thumbnail), and
`/__editor/nodes` (writes `nodes.json`; no manifest regen — node defs aren't a map placement).

## Packs & catalog

How asset packs, the catalog, atlas regions, and type/grid overrides work: see
[ASSETS.md](ASSETS.md). The editor reads `asset-catalog.json` (+ `regions.json`, `terrains.json`);
it never touches the game's runtime registry.

## How the game loads maps

Through the lazy registry `src/systems/mapRuntime.ts`: eager `manifest.json` + `world.json`, each
`*.map.json` a lazy per-map chunk (`import.meta.glob`). The game boots into one authored map
(`START_MAP_ID`); adjacent-map streaming is [plan 019](../plans/019-l1-map-streaming.md). The editor
uses its dev middleware, never this registry — no coupling.
