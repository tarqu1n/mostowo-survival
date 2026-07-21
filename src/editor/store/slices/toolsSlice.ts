import { paletteSlotRotationKey } from '../shared';
import type { EditorSlice, EditorState, EditorTool, LibraryRoleFilter } from '../types';

/** Tool → auto-synced `libraryRoleFilter` (plan 032 step 3, critique #3's settled mapping), applied by
 *  `setActiveTool` unless the user manually overrode the filter since the last tool switch (see
 *  `libraryRoleFilterOverridden`). Every tool NOT listed here (`pan`, `select`, `collision`, `zone`,
 *  `shape`, `portal`, `eyedropper`) keeps whatever filter was already active — it neither forces nor
 *  blocks a filter, it's just not one of the tools this plan wires up. `'actor'` never appears as a
 *  value here: actors are only ever shown via a manual chip click (`setLibraryRoleFilter`), never by
 *  switching tools. */
const TOOL_LIBRARY_FILTER: Partial<Record<EditorTool, LibraryRoleFilter>> = {
  brush: 'tile',
  rect: 'tile',
  fill: 'tile',
  eraser: 'tile',
  terrain: 'tile',
  place: 'object',
};
/** Shared body for `setBrushRotation`/`rotateBrush`: sets `brushRotation`, and — when a palette slot is
 *  currently armed — records that angle as the slot's working rotation so re-selecting it restores it.
 *  A no-op on the memory when nothing from the strip is armed (`selectedPaletteSlot` null). */
function rememberSlotRotation(
  s: EditorState,
  brushRotation: 0 | 90 | 180 | 270,
): Partial<EditorState> {
  if (!s.selectedPaletteSlot) return { brushRotation };
  const key = paletteSlotRotationKey(s.selectedPaletteSlot.paletteId, s.selectedPaletteSlot);
  return {
    brushRotation,
    paletteSlotRotations: { ...s.paletteSlotRotations, [key]: brushRotation },
  };
}

export const toolsSlice: EditorSlice<
  Pick<
    EditorState,
    | 'activeTool'
    | 'libraryRoleFilter'
    | 'libraryRoleFilterOverridden'
    | 'brushAsset'
    | 'brushRotation'
    | 'selectedPaletteSlot'
    | 'paletteSlotRotations'
    | 'armedObjectAsset'
    | 'armedNodeRef'
    | 'snapToTileCenter'
    | 'placeRotation'
    | 'pendingPortalRect'
    | 'paintMode'
    | 'eraseActive'
    | 'freePixelActive'
    | 'multiSelectActive'
    | 'altHeld'
    | 'shiftHeld'
    | 'overlays'
    | 'setActiveTool'
    | 'setLibraryRoleFilter'
    | 'setBrushAsset'
    | 'setBrushRotation'
    | 'rotateBrush'
    | 'setArmedObjectAsset'
    | 'setArmedNodeRef'
    | 'setSnapToTileCenter'
    | 'setPlaceRotation'
    | 'setPendingPortalRect'
    | 'setPaintMode'
    | 'setEraseActive'
    | 'setFreePixelActive'
    | 'setMultiSelectActive'
    | 'setAltHeld'
    | 'setShiftHeld'
    | 'toggleOverlay'
  >
> = (set) => ({
  activeTool: 'pan',
  libraryRoleFilter: 'tile',
  libraryRoleFilterOverridden: false,
  brushAsset: null,
  brushRotation: 0,
  selectedPaletteSlot: null,
  paletteSlotRotations: {},
  armedObjectAsset: null,
  armedNodeRef: null,
  snapToTileCenter: true,
  placeRotation: 0,
  pendingPortalRect: null,
  paintMode: 'brush',
  eraseActive: false,
  freePixelActive: false,
  multiSelectActive: false,
  altHeld: false,
  shiftHeld: false,
  overlays: { grid: true, walkability: false, zones: false, ghosts: false },
  setActiveTool: (activeTool) =>
    set((s): Partial<EditorState> => {
      const mapped = TOOL_LIBRARY_FILTER[activeTool];
      const libraryRoleFilter =
        !s.libraryRoleFilterOverridden && mapped ? mapped : s.libraryRoleFilter;
      // The marquee region belongs to the Select tool — drop it when switching to any other tool so
      // a stale box never lingers (or accepts a nudge) under an unrelated tool.
      const regionSelection = activeTool === 'select' ? s.regionSelection : null;
      return {
        activeTool,
        libraryRoleFilter,
        libraryRoleFilterOverridden: false,
        regionSelection,
      };
    }),
  setLibraryRoleFilter: (filter) =>
    set({ libraryRoleFilter: filter, libraryRoleFilterOverridden: true }),
  // `brushRotation` is deliberately NOT reset here — it's sticky across arming a new asset.
  // `selectedPaletteSlot` IS cleared: arming from anywhere other than `selectPaletteSlot` (Library
  // pick, eyedropper) means the strip's sticky highlight no longer refers to what's armed.
  setBrushAsset: (brushAsset) => set({ brushAsset, selectedPaletteSlot: null }),
  setBrushRotation: (brushRotation) =>
    set((s): Partial<EditorState> => rememberSlotRotation(s, brushRotation)),
  rotateBrush: (delta) =>
    set((s): Partial<EditorState> => {
      const brushRotation = ((((s.brushRotation + delta) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
      return rememberSlotRotation(s, brushRotation);
    }),
  // Arming one kind clears the other — only one thing is ever armed at a time (see module doc).
  setArmedObjectAsset: (armedObjectAsset) =>
    set((s): Partial<EditorState> => ({
      armedObjectAsset,
      armedNodeRef: armedObjectAsset ? null : s.armedNodeRef,
    })),
  setArmedNodeRef: (armedNodeRef) =>
    set((s): Partial<EditorState> => ({
      armedNodeRef,
      armedObjectAsset: armedNodeRef ? null : s.armedObjectAsset,
    })),
  setSnapToTileCenter: (snapToTileCenter) => set({ snapToTileCenter }),
  setPlaceRotation: (deg) =>
    set({ placeRotation: Number.isFinite(deg) ? ((deg % 360) + 360) % 360 : 0 }),
  setPendingPortalRect: (pendingPortalRect) => set({ pendingPortalRect }),
  setPaintMode: (paintMode) => set({ paintMode }),
  setEraseActive: (eraseActive) => set({ eraseActive }),
  setFreePixelActive: (freePixelActive) => set({ freePixelActive }),
  setMultiSelectActive: (multiSelectActive) => set({ multiSelectActive }),
  setAltHeld: (altHeld) => set({ altHeld }),
  setShiftHeld: (shiftHeld) => set({ shiftHeld }),
  toggleOverlay: (key) =>
    set((s): Partial<EditorState> => ({ overlays: { ...s.overlays, [key]: !s.overlays[key] } })),
});
