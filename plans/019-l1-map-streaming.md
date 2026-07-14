# L1 Map Streaming (active map + adjacent ring)

> Status: planned — run /execute-plan after [plan 018](018-runtime-map-loader.md) has shipped.
> Depends on: 018 (the L0 loader, `mapRuntime.ts`, `mapWalkability.ts`, per-map `originPx` rendering).

## Summary

Layer **adjacent-ring streaming** onto the L0 loader from plan 018: keep the **active map plus its
bbox-adjacent neighbours** loaded, and stream maps in/out as the player crosses seams in the shared
signed-integer global tile grid. Loading stays lazy per-map chunks (018's delivery); this plan adds
the multi-map loaded state, a global `mapAt`-routed `isBlocked`, and the load/evict lifecycle.

## Prerequisites (read first — from plan-018 critique #4)

L1 is **logic-complete on its own but cannot be verified end-to-end without ≥2 placed maps**, and has
one correctness trap that must be handled up front:

1. **Content prereq (external, editor):** `world.json` must contain **real placements** — at minimum
   the start map plus one neighbour authored + placed adjacent to it via the editor. Today
   `world.json.placements` is `[]`. Authoring this is content work (editor, concurrent chat's
   territory) and is a prerequisite for this plan's live acceptance, not a step here.
2. **Empty-placements freeze trap:** with `placements === []`, `WORLD_INDEX.mapAt(gcol,grow)` returns
   `null` for **every** tile, so a naive "unowned → blocked" rule (Step B2) would block the whole world
   and freeze the player. This directly contradicts 018's `originOf` "start map may be unplaced"
   fallback. **Resolution (Step B2):** when the world has 0 or 1 placements, fall back to L0
   single-map behaviour — treat the one loaded start map as the whole world (do not route `isBlocked`
   through `mapAt`; use the loaded map's local walkability directly at its `originOf` offset). Only
   engage `mapAt` routing + streaming when ≥2 maps are placed.

## Context & decisions (from plan 018's design discussion — unchanged)

- **Ring = manifest BBOX-adjacency, NOT `seams()`.** `seams()` needs the neighbour already loaded,
  defeating the purpose; bbox over-inclusion is a harmless preload. Orthogonal bbox touch only.
- **Trigger:** on the player crossing a seam (`mapAt(playerTile)` changes) → recompute ring, load new
  members, evict maps outside `{active ∪ ring}`. Pre-load the ring so neighbours are ready *before* the
  player reaches the seam (load on active-change, not on edge-contact).
- **Coordinates:** everything already in global tile coords (018 rendered each map offset by
  `originOf(id) × TILE_SIZE`); L1 generalises the single loaded map to a keyed set.
- **Async loading** reuses 018's on-demand texture pattern (queue → `load.start()` → `COMPLETE` →
  instantiate) — but now runs mid-game for neighbours, not just at Preload.

## Steps

- [ ] **Step B1: Pure ring + eviction math** `[delegate sonnet]`
  - Create `src/systems/mapStreaming.ts`: `bboxAdjacentNeighbours(activeId, placements, metas):
    string[]` — maps whose bboxes (`origin` + `metas.width/height`) touch the active map's bbox
    **orthogonally** (share an edge segment; diagonal-only does not count). `keepSet(activeId, ring):
    Set<string>` = `{active} ∪ ring`. `toEvict(loadedIds, keepSet): string[]`. Pure; reuse
    `worldLayout` types. Explicitly NOT `seams()`-based.
  - Unit tests (`mapFormat.test.ts` style) with synthetic placements: edge-adjacent vs diagonal-only vs
    gap; keep/evict sets; the **0/1-placement case returns an empty ring** (feeds B2's fallback).
  - Done when: helpers + tests pass.

- [ ] **Step B2: Multi-map loaded state + global `isBlocked` (with single-map fallback)** `[inline]`
  - Generalise `GameScene`'s single `startMap` into a keyed registry:
    `Map<string,{map:MapFile, origin:{col,row}, /* handles for eviction */}>`. Render each loaded map's
    layers (018 A4) + decor (018 A7) + nodes (018 A6) offset by its own `origin×TILE_SIZE`.
  - Rework `isBlocked` to operate in GLOBAL tile coords **only when ≥2 maps are placed**:
    `WORLD_INDEX.mapAt(gcol,grow)` → owning loaded map → `mapBlocks(map, gcol-origin.col,
    grow-origin.row)`; a cell owned by an unloaded map, or unowned, is blocked. **When 0/1 maps are
    placed (prereq #2), keep 018's single-map `isBlocked`** against the one loaded map at its origin —
    do not route through `mapAt` (which would block everything). Keep build/node/decor obstacle sources
    global.
  - Side effects: node/decor managers must track which map each instance belongs to (for B3 eviction).
    Confirm no lingering single-map assumptions in player/enemy tile math (all should already use global
    tile coords via `grid.ts`).
  - Done when: with two synthetic placed+loaded maps the player pathfinds across the seam and both
    render at correct offsets; with 0/1 placements the game behaves exactly as 018 L0 (no freeze).

- [ ] **Step B3: Streaming lifecycle (load/evict on seam crossing)** `[inline]`
  - Each `update`, read `WORLD_INDEX.mapAt(playerTile)`. When it changes from the current active id
    (and ≥2 maps placed): set active; `ring = bboxAdjacentNeighbours(...)` (B1); **async-load** any
    `keepSet` member not loaded (`loadMapFile` + on-demand textures per 018 A10's pattern + instantiate
    via B2); **evict** `toEvict(loaded, keepSet)` — destroy that map's RTs/sprites/nodes and release its
    on-demand textures. Load the ring on active-change (ahead of arrival), not on edge-contact.
    Optionally emit a `world:streaming` event for a future UIScene indicator (no consumer required).
  - Side effects: texture release must not free a texture still used by a retained map — reference-count
    or release only sheets unique to the evicted map. Guard against evicting a map whose async load is
    still in flight (cancel or ignore the late completion).
  - Done when (needs the placed second map): walking off the start map's edge into the neighbour streams
    it in with no stall, walking back evicts the far map, and no textures/RTs leak across several
    crossings.

- [ ] **Step B4: Multi-map camera / physics bounds** `[delegate sonnet]`
  - Camera + physics bounds span the **union bbox of the placed maps** (stable across streaming, unlike
    the loaded-set which changes). Full-map fog/night overlays (018 A9) cover the active map (or loaded
    union). Revisit the `worldPx` threading from 018 A9/A11 to accept a union extent.
  - Done when: the camera does not clamp at a single map's edge when a neighbour is placed; overlays
    cover the visible world.

## Out of scope
- Everything 018 excludes (editor edits, schema changes, authored spawn, enemy authoring, portal
  transitions).
- **Authoring the second adjacent map + placements** — external content prerequisite (editor).
- **Viewport/camera chunk streaming ("L2")** — hand-authored zones don't need it.
- **Cross-map monster AI** (chasing across seams) — the global-coord substrate enables it, but wiring
  it is a later feature.
