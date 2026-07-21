import type { NamedTilePalette, TilePaletteSlot } from '../../../systems/mapFormat';
import { paletteSlotRotationKey } from '../shared';
import type { EditorSlice, EditorState } from '../types';

/** Next auto `palette_NNNN` id (plan 033) — scans existing palette ids so re-adding after a delete/undo
 *  never collides. Mirrors `nextLayerId`'s scan-for-max `<prefix>_NNNN` scheme used across the format. */
function nextTilePaletteId(palettes: readonly NamedTilePalette[]): string {
  let max = 0;
  for (const p of palettes) {
    const m = /^palette_(\d+)$/.exec(p.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `palette_${String(max + 1).padStart(4, '0')}`;
}
/** If `activeTilePaletteId` no longer names a palette in the GLOBAL `tilePalettes` slice (removed, or a
 *  fresh load replaced the set), fall back to the first palette, or `null` for an empty set (plan 033
 *  step 9). Pure resolver behind the `reconcileActiveTilePalette` store action — the pointer is
 *  reconciled after every palette-slice mutation so it never dangles (mirrors `reconcileActiveLayer`).
 *  Map-independent now: tile palettes are global editor curation, not map data. */
function resolveActiveTilePalette(
  palettes: readonly NamedTilePalette[],
  activeTilePaletteId: string | null,
): string | null {
  if (activeTilePaletteId && palettes.some((p) => p.id === activeTilePaletteId)) {
    return activeTilePaletteId;
  }
  return palettes[0]?.id ?? null;
}

export const tilePalettesSlice: EditorSlice<
  Pick<
    EditorState,
    | 'tilePalettes'
    | 'activeTilePaletteId'
    | 'palettePickMode'
    | 'palettePickSelection'
    | 'setTilePalettes'
    | 'reconcileActiveTilePalette'
    | 'setActiveTilePalette'
    | 'addTilePalette'
    | 'addTilesToActivePalette'
    | 'removeTilePaletteSlot'
    | 'renameTilePalette'
    | 'deleteTilePalette'
    | 'selectPaletteSlot'
    | 'togglePalettePickMode'
    | 'togglePalettePickTile'
    | 'clearPalettePick'
  >
> = (set, get) => ({
  tilePalettes: [],
  activeTilePaletteId: null,
  palettePickMode: false,
  palettePickSelection: [],
  // ---- tile palettes (plan 033 step 9 — GLOBAL, auto-saved, NOT undoable) ----

  setTilePalettes: (palettes) => {
    set({ tilePalettes: palettes });
    get().reconcileActiveTilePalette();
  },

  reconcileActiveTilePalette: () =>
    set((s) => ({
      activeTilePaletteId: resolveActiveTilePalette(s.tilePalettes, s.activeTilePaletteId),
    })),

  setActiveTilePalette: (id) => set({ activeTilePaletteId: id }),

  addTilePalette: (name) => {
    const palettes = get().tilePalettes;
    const id = nextTilePaletteId(palettes);
    const created: NamedTilePalette = {
      id,
      name: name?.trim() || `Palette ${palettes.length + 1}`,
      slots: [],
    };
    // Plain immutable append — the global slice is the source of truth (no map history, no dirty).
    set({ tilePalettes: [...palettes, created], activeTilePaletteId: id });
  },

  addTilesToActivePalette: (entries) => {
    if (entries.length === 0) return;
    const palettes = get().tilePalettes;
    // Lazy first-palette creation: with no palettes yet, materialise "Palette 1" and make it active.
    // Otherwise target the active palette (falling back to the first if the pointer is null/dangling).
    const lazyCreate = palettes.length === 0;
    const created: NamedTilePalette | null = lazyCreate
      ? { id: nextTilePaletteId(palettes), name: 'Palette 1', slots: [] }
      : null;
    const active = get().activeTilePaletteId;
    const target = created ?? palettes.find((p) => p.id === active) ?? palettes[0];
    // Dedupe exact `assetId`+`rotation` duplicates — against the target's existing slots AND within
    // this batch. Slot key normalises a missing rotation to 0.
    const slotKey = (s: TilePaletteSlot): string => `${s.assetId}#${s.rotation ?? 0}`;
    const seen = new Set(target.slots.map(slotKey));
    const toAppend: TilePaletteSlot[] = [];
    for (const e of entries) {
      const key = slotKey(e);
      if (seen.has(key)) continue;
      seen.add(key);
      // Normalise rotation omit-when-absent so slots round-trip byte-identical (Step 1 contract).
      toAppend.push(
        e.rotation ? { assetId: e.assetId, rotation: e.rotation } : { assetId: e.assetId },
      );
    }
    if (toAppend.length === 0 && !created) return; // nothing new and no structural change to make
    // Build the next palette set immutably: a NEW target object with a NEW slots array, and (when
    // lazily created) the new palette appended.
    const updatedTarget: NamedTilePalette = { ...target, slots: [...target.slots, ...toAppend] };
    const nextPalettes = created
      ? [...palettes, updatedTarget]
      : palettes.map((p) => (p.id === target.id ? updatedTarget : p));
    set({
      tilePalettes: nextPalettes,
      // A lazily-created palette becomes active as view-state.
      ...(created ? { activeTilePaletteId: created.id } : {}),
    });
  },

  removeTilePaletteSlot: (paletteId, index) => {
    const palettes = get().tilePalettes;
    const palette = palettes.find((p) => p.id === paletteId);
    if (!palette || index < 0 || index >= palette.slots.length) return;
    const updated: NamedTilePalette = {
      ...palette,
      slots: palette.slots.filter((_, i) => i !== index),
    };
    set({ tilePalettes: palettes.map((p) => (p.id === paletteId ? updated : p)) });
  },

  renameTilePalette: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return; // ignore an empty rename — keep the previous name
    set((s) => ({
      tilePalettes: s.tilePalettes.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
    }));
  },

  deleteTilePalette: (id) => {
    set((s) => ({ tilePalettes: s.tilePalettes.filter((p) => p.id !== id) }));
    // Repoint the active pointer if we just removed the active palette (→ first remaining, or null).
    get().reconcileActiveTilePalette();
  },

  selectPaletteSlot: (slot) => {
    // Brush-arm, NOT a palette mutation — replicates `pickTile`'s store-level arm sequence
    // (LibraryPanel.tsx `pickTile`; that copy also does component-only recents/onPick side effects,
    // so this can't call it directly). Adds a `brushRotation` set for the slot's rotation.
    const s = get();
    s.setBrushAsset(slot.assetId); // NB: clears `selectedPaletteSlot` — we re-set it below
    const paletteId = get().activeTilePaletteId;
    // Restore this slot's remembered working rotation (from an earlier rotate) if we have one, so
    // switching away and back doesn't reset it — else fall back to the slot's own stored rotation.
    const remembered = get().paletteSlotRotations[paletteSlotRotationKey(paletteId, slot)];
    // `setBrushRotation` here is a no-op on the memory: `selectedPaletteSlot` is still null (cleared
    // just above), so restoring the angle can't overwrite what it just read.
    s.setBrushRotation(remembered ?? ((slot.rotation ?? 0) as 0 | 90 | 180 | 270));
    if (s.activeTool !== 'brush' && s.activeTool !== 'rect') s.setActiveTool('brush');
    // Remember which slot (in which palette) this armed, so the strip keeps it highlighted through
    // later `rotateBrush` calls even once `brushRotation` no longer equals the slot's own rotation.
    set({
      selectedPaletteSlot: { paletteId, assetId: slot.assetId, rotation: slot.rotation },
    });
  },

  togglePalettePickMode: () =>
    set((s): Partial<EditorState> => {
      const palettePickMode = !s.palettePickMode;
      // Leaving pick mode clears the selection so a stale set never lingers into the next session.
      return {
        palettePickMode,
        palettePickSelection: palettePickMode ? s.palettePickSelection : [],
      };
    }),

  togglePalettePickTile: (assetId) =>
    set((s): Partial<EditorState> => ({
      palettePickSelection: s.palettePickSelection.includes(assetId)
        ? s.palettePickSelection.filter((a) => a !== assetId)
        : [...s.palettePickSelection, assetId],
    })),

  clearPalettePick: () => set({ palettePickSelection: [] }),
});
