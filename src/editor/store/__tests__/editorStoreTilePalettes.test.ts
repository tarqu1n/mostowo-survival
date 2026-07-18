import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../editorStore';
import type { NamedTilePalette, TilePaletteSlot } from '../../../systems/mapFormat';

const ASSET_A = 'pixel-crawler/Environment/Tilesets/Floors_Tiles.png#252';
const ASSET_B = 'pixel-crawler/Environment/Tilesets/Floors_Tiles.png#253';

/**
 * Plan 033 step 9 — tile palettes are now a GLOBAL, auto-saved store slice (`tilePalettes`), NOT map
 * data and NOT part of the undo history. These tests exercise the slice + its immutable mutations +
 * pointer reconcile synchronously; the autosave subscriber (`palettesSource.ts`) is separate and not
 * under test here (no api/network is touched).
 */

/** Reset to a clean slice + a fresh map. `setTilePalettes([])` clears the GLOBAL slice (it survives
 *  `newMap` by design, so tests must reset it explicitly). */
function reset(width = 4, height = 4): void {
  useEditorStore.getState().setTilePalettes([]);
  useEditorStore.getState().newMap('scratch', 'Scratch', width, height);
  useEditorStore.getState().setBrushAsset(null);
  useEditorStore.getState().setBrushRotation(0);
}

describe('editorStore tile palettes (plan 033 step 9 — global slice)', () => {
  beforeEach(() => reset());

  it('starts with no palettes and a null active pointer', () => {
    const s = useEditorStore.getState();
    expect(s.tilePalettes).toEqual([]);
    expect(s.activeTilePaletteId).toBeNull();
  });

  it('addTilePalette appends a named palette to the slice and makes it active (no map dirty/history)', () => {
    const rev0 = useEditorStore.getState().docRevision;
    useEditorStore.getState().addTilePalette();
    const s = useEditorStore.getState();
    expect(s.tilePalettes).toHaveLength(1);
    expect(s.tilePalettes[0]).toMatchObject({ name: 'Palette 1', slots: [] });
    expect(s.tilePalettes[0].id).toMatch(/^palette_\d{4}$/);
    expect(s.activeTilePaletteId).toBe(s.tilePalettes[0].id);
    // Palettes are NOT map data — no docRevision bump, no dirty, nothing on the undo stack.
    expect(s.docRevision).toBe(rev0);
    expect(s.dirty).toBe(true); // dirty is from newMap; addTilePalette didn't touch it further
    expect(s.canUndo).toBe(false);
  });

  it('addTilePalette uses "Palette N" (N = count+1) and honours an explicit name', () => {
    useEditorStore.getState().addTilePalette();
    useEditorStore.getState().addTilePalette('Walls');
    useEditorStore.getState().addTilePalette();
    const palettes = useEditorStore.getState().tilePalettes;
    expect(palettes.map((p) => p.name)).toEqual(['Palette 1', 'Walls', 'Palette 3']);
    // ids scan-for-max, zero-padded, never collide
    expect(palettes.map((p) => p.id)).toEqual(['palette_0001', 'palette_0002', 'palette_0003']);
  });

  it('structural palette edits are NOT undoable (no map history entry created)', () => {
    useEditorStore.getState().addTilePalette();
    useEditorStore.getState().addTilesToActivePalette([{ assetId: ASSET_A }]);
    useEditorStore
      .getState()
      .removeTilePaletteSlot(useEditorStore.getState().tilePalettes[0].id, 0);
    // None of these touched the undo stack.
    expect(useEditorStore.getState().canUndo).toBe(false);
  });

  it('setActiveTilePalette switches the pointer without touching the slice or the map', () => {
    useEditorStore.getState().addTilePalette(); // palette_0001
    useEditorStore.getState().addTilePalette(); // palette_0002
    const rev = useEditorStore.getState().docRevision;
    useEditorStore.getState().setActiveTilePalette('palette_0001');
    const s = useEditorStore.getState();
    expect(s.activeTilePaletteId).toBe('palette_0001');
    expect(s.docRevision).toBe(rev);
    expect(s.tilePalettes).toHaveLength(2);
  });

  it('addTilesToActivePalette lazily creates "Palette 1" when the slice is empty, and makes it active', () => {
    expect(useEditorStore.getState().tilePalettes).toEqual([]);
    useEditorStore.getState().addTilesToActivePalette([{ assetId: ASSET_A }]);
    const s = useEditorStore.getState();
    expect(s.tilePalettes).toHaveLength(1);
    expect(s.tilePalettes[0].name).toBe('Palette 1');
    expect(s.tilePalettes[0].slots).toEqual([{ assetId: ASSET_A }]);
    expect(s.activeTilePaletteId).toBe(s.tilePalettes[0].id);
  });

  it('addTilesToActivePalette bulk-appends to the active palette, deduping exact assetId+rotation', () => {
    useEditorStore.getState().addTilePalette();
    useEditorStore.getState().addTilesToActivePalette([
      { assetId: ASSET_A },
      { assetId: ASSET_B, rotation: 90 },
      { assetId: ASSET_A }, // dup within batch
    ]);
    // Re-adding an existing slot (same assetId+rotation) is a no-op; a new rotation is distinct.
    useEditorStore.getState().addTilesToActivePalette([
      { assetId: ASSET_A }, // dup vs existing
      { assetId: ASSET_A, rotation: 90 }, // distinct rotation
    ]);
    const slots = useEditorStore.getState().tilePalettes[0].slots;
    expect(slots).toEqual([
      { assetId: ASSET_A },
      { assetId: ASSET_B, rotation: 90 },
      { assetId: ASSET_A, rotation: 90 },
    ]);
  });

  it('addTilesToActivePalette mutates immutably (a new array + new target object, old refs untouched)', () => {
    useEditorStore.getState().addTilePalette();
    const before = useEditorStore.getState().tilePalettes;
    const beforePalette = before[0];
    useEditorStore.getState().addTilesToActivePalette([{ assetId: ASSET_A }]);
    const after = useEditorStore.getState().tilePalettes;
    expect(after).not.toBe(before); // new array reference
    expect(after[0]).not.toBe(beforePalette); // new palette object
    expect(beforePalette.slots).toEqual([]); // old object never mutated
  });

  it('removeTilePaletteSlot removes the slot at index (immutably); out-of-range is a safe no-op', () => {
    useEditorStore.getState().addTilePalette();
    const id = useEditorStore.getState().tilePalettes[0].id;
    useEditorStore
      .getState()
      .addTilesToActivePalette([{ assetId: ASSET_A }, { assetId: ASSET_B, rotation: 180 }]);

    useEditorStore.getState().removeTilePaletteSlot(id, 0);
    expect(useEditorStore.getState().tilePalettes[0].slots).toEqual([
      { assetId: ASSET_B, rotation: 180 },
    ]);

    const snapshot = useEditorStore.getState().tilePalettes;
    useEditorStore.getState().removeTilePaletteSlot(id, 99);
    expect(useEditorStore.getState().tilePalettes[0].slots).toHaveLength(1);
    expect(useEditorStore.getState().tilePalettes).toBe(snapshot); // no-op didn't replace the array
  });

  it('setTilePalettes installs a loaded set and reconciles the pointer to the first palette', () => {
    const loaded: NamedTilePalette[] = [
      { id: 'palette_0001', name: 'A', slots: [{ assetId: ASSET_A }] },
      { id: 'palette_0002', name: 'B', slots: [] },
    ];
    useEditorStore.getState().setTilePalettes(loaded);
    const s = useEditorStore.getState();
    expect(s.tilePalettes).toEqual(loaded);
    expect(s.activeTilePaletteId).toBe('palette_0001');
  });

  it('reconcileActiveTilePalette repoints a dangling pointer to the first palette (or null when empty)', () => {
    useEditorStore.getState().setTilePalettes([{ id: 'palette_0001', name: 'A', slots: [] }]);
    useEditorStore.getState().setActiveTilePalette('palette_9999'); // dangling
    useEditorStore.getState().reconcileActiveTilePalette();
    expect(useEditorStore.getState().activeTilePaletteId).toBe('palette_0001');

    useEditorStore.getState().setTilePalettes([]);
    expect(useEditorStore.getState().activeTilePaletteId).toBeNull();
  });

  it('a map load/switch does NOT clear the global tilePalettes slice or its pointer', () => {
    useEditorStore.getState().addTilePalette('Keep');
    useEditorStore.getState().addTilesToActivePalette([{ assetId: ASSET_A }]);
    const paletteId = useEditorStore.getState().tilePalettes[0].id;

    // Open a different map — palettes are global, so they survive untouched.
    useEditorStore.getState().newMap('other', 'Other', 6, 6);
    let s = useEditorStore.getState();
    expect(s.tilePalettes).toHaveLength(1);
    expect(s.tilePalettes[0].slots).toEqual([{ assetId: ASSET_A }]);
    expect(s.activeTilePaletteId).toBe(paletteId);

    // Closing the map likewise leaves the slice alone.
    useEditorStore.getState().closeMap();
    s = useEditorStore.getState();
    expect(s.tilePalettes).toHaveLength(1);
    expect(s.activeTilePaletteId).toBe(paletteId);
  });

  it('selectPaletteSlot arms the brush: sets brushAsset + brushRotation and switches to the brush tool', () => {
    useEditorStore.getState().setActiveTool('pan');
    const slot: TilePaletteSlot = { assetId: ASSET_B, rotation: 270 };
    useEditorStore.getState().selectPaletteSlot(slot);
    const s = useEditorStore.getState();
    expect(s.brushAsset).toBe(ASSET_B);
    expect(s.brushRotation).toBe(270);
    expect(s.activeTool).toBe('brush');
  });

  it('selectPaletteSlot defaults rotation to 0 and keeps a brush-consuming tool (rect) as-is', () => {
    useEditorStore.getState().setBrushRotation(90);
    useEditorStore.getState().setActiveTool('rect');
    useEditorStore.getState().selectPaletteSlot({ assetId: ASSET_A });
    const s = useEditorStore.getState();
    expect(s.brushAsset).toBe(ASSET_A);
    expect(s.brushRotation).toBe(0);
    expect(s.activeTool).toBe('rect'); // already brush-consuming — not forced to 'brush'
  });

  it('selectPaletteSlot is a pure brush-arm — no palette mutation, no history', () => {
    useEditorStore
      .getState()
      .setTilePalettes([{ id: 'palette_0001', name: 'A', slots: [{ assetId: ASSET_A }] }]);
    const before = useEditorStore.getState().tilePalettes;
    useEditorStore.getState().selectPaletteSlot({ assetId: ASSET_A });
    expect(useEditorStore.getState().tilePalettes).toBe(before);
    expect(useEditorStore.getState().canUndo).toBe(false);
  });

  it('Library pick-mode state toggles and clears (transient, no command/dirty)', () => {
    expect(useEditorStore.getState().palettePickMode).toBe(false);

    useEditorStore.getState().togglePalettePickMode();
    expect(useEditorStore.getState().palettePickMode).toBe(true);

    useEditorStore.getState().togglePalettePickTile(ASSET_A);
    useEditorStore.getState().togglePalettePickTile(ASSET_B);
    useEditorStore.getState().togglePalettePickTile(ASSET_A); // toggle off
    expect(useEditorStore.getState().palettePickSelection).toEqual([ASSET_B]);

    useEditorStore.getState().clearPalettePick();
    expect(useEditorStore.getState().palettePickSelection).toEqual([]);

    useEditorStore.getState().togglePalettePickTile(ASSET_A);
    useEditorStore.getState().togglePalettePickMode(); // leaving pick mode clears selection
    expect(useEditorStore.getState().palettePickMode).toBe(false);
    expect(useEditorStore.getState().palettePickSelection).toEqual([]);
  });
});
