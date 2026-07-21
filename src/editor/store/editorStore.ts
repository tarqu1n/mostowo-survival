/**
 * Editor document store (plan 014 step 5, extended steps 6-7) — the SINGLE React↔Phaser bridge. React
 * components subscribe via the `useEditorStore` hook; the Phaser `EditorScene` reads via
 * `useEditorStore.getState()` and `useEditorStore.subscribe(selector, listener)`. Neither side
 * imports the other; both talk only to this store.
 *
 * Every document mutation routes through the encapsulated `HistoryStack` (`applyCommand`/`undo`/
 * `redo`), so undo/redo is uniform. Two counters signal the Phaser scene what to do without it
 * re-diffing the whole `MapFile`:
 *  - `mapEpoch` bumps when the WHOLE document is replaced (New/Open/Close) → full texture (re)load,
 *    bake and camera fit.
 *  - `docRevision` bumps on every in-place edit (applyCommand/undo/redo) → rebake. Paint actions also
 *    populate `pendingDirty` (consumed+cleared by `EditorScene.onDocEdited`) so a brush/eraser/fill/
 *    rect edit rebakes only the touched chunks of the active layer instead of the whole map; anything
 *    that doesn't set it (undo/redo, layer add/rename/delete/reorder/overhead, favourites) falls back
 *    to the existing full chunked rebake — correct, just not narrowed (acceptable: none of those are
 *    a per-cell hot path like a paint drag). Layer reorder needs no extra signal beyond that fallback:
 *    `EditorScene`'s per-chunk rebake re-reads `map.layers[layerIndex]` by ARRAY POSITION every time,
 *    and a chunk-RT's depth is fixed to that same position at creation — so re-running the full
 *    per-chunk loop after `map.layers` has been reordered already redraws the right content at the
 *    right depth with no depth-reassignment step. Layer ADD/DELETE change `map.layers.length`, which
 *    `onDocEdited` already detects to trigger a full `syncDocument()` rebuild (new/removed RT).
 *
 *  A dimension-changing edit (`resizeMap`, plan 024) also just rides `docRevision`, not a dedicated
 *  third counter — it's an in-place edit like any other applyCommand/undo/redo move, it just happens
 *  to swap in arrays of a NEW width/height rather than same-sized ones. Nothing here distinguishes
 *  "same dims, cells changed" from "dims changed" — that's the Phaser scene's job (a baked-dims
 *  fallback, plan 024 step 3: `EditorScene` compares the map's current `meta.width/height` against
 *  what it last baked at and does a full rebuild, not a rebake, when they differ), not this store's.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { EditorState } from './types';
import { documentSlice } from './slices/documentSlice';
import { toolsSlice } from './slices/toolsSlice';
import { underlaySlice } from './slices/underlaySlice';
import { worldSlice } from './slices/worldSlice';
import { nodeDefsSlice } from './slices/nodeDefsSlice';
import { resizeRenameSlice } from './slices/resizeRenameSlice';
import { paintSlice } from './slices/paintSlice';
import { walkabilitySlice } from './slices/walkabilitySlice';
import { zonesSlice } from './slices/zonesSlice';
import { shapeSlice } from './slices/shapeSlice';
import { terrainSlice } from './slices/terrainSlice';
import { layersSlice } from './slices/layersSlice';
import { favouritesSlice } from './slices/favouritesSlice';
import { tilePalettesSlice } from './slices/tilePalettesSlice';
import { objectsSlice } from './slices/objectsSlice';

/**
 * The editor document store, composed from per-domain Zustand slices (plan 043 step 7). Each slice is
 * a `(set, get) => ({...})` factory owning one domain's state + actions; they share the combined
 * `get()`/`set()`, so cross-slice action calls (e.g. a paint action calling `get().applyCommand`) work
 * transparently. `subscribeWithSelector` is preserved so `EditorScene` can subscribe by selector.
 */
export const useEditorStore = create<EditorState>()(
  subscribeWithSelector((...a) => ({
    ...documentSlice(...a),
    ...toolsSlice(...a),
    ...underlaySlice(...a),
    ...worldSlice(...a),
    ...nodeDefsSlice(...a),
    ...resizeRenameSlice(...a),
    ...paintSlice(...a),
    ...walkabilitySlice(...a),
    ...zonesSlice(...a),
    ...shapeSlice(...a),
    ...terrainSlice(...a),
    ...layersSlice(...a),
    ...favouritesSlice(...a),
    ...tilePalettesSlice(...a),
    ...objectsSlice(...a),
  })),
);

// ---- public surface re-export (unchanged import path for every consumer) ----
export type {
  ArmedObjectAsset,
  EditorCatalog,
  EditorOverlays,
  EditorState,
  EditorTab,
  EditorTool,
  LibraryRoleFilter,
  PaintMode,
  PendingDirty,
  TranslateDelta,
  UnderlayState,
} from './types';
export { paletteSlotRotationKey } from './shared';
export { PLACEHOLDER_SKIN_ASSET } from './slices/nodeDefsSlice';
export { DECOR_ANIM_DEFAULT_FPS } from './slices/objectsSlice';
