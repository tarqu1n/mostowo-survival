import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../editorStore';
import { parseWorldLayout } from '../../../systems/worldLayout';

/** The store is a module-level singleton; reset the world layout + history before each test by
 *  seeding an empty layout (setWorld also clears worldDirty) and creating a throwaway map (which
 *  clears the shared history stack via `newMap`). */
function reset(): void {
  useEditorStore.getState().newMap('scratch', 'Scratch', 4, 4);
  useEditorStore.getState().setWorld({ schemaVersion: 1, placements: [] });
}

describe('editorStore: world placements (step 9)', () => {
  beforeEach(() => reset());

  it('addPlacement adds a placement and marks the world dirty', () => {
    const ok = useEditorStore.getState().addPlacement('a', { col: 0, row: 0 });
    expect(ok).toBe(true);
    expect(useEditorStore.getState().world.placements).toEqual([
      { mapId: 'a', origin: { col: 0, row: 0 } },
    ]);
    expect(useEditorStore.getState().worldDirty).toBe(true);
  });

  it('addPlacement refuses a duplicate map id', () => {
    useEditorStore.getState().addPlacement('a', { col: 0, row: 0 });
    expect(useEditorStore.getState().addPlacement('a', { col: 5, row: 5 })).toBe(false);
    expect(useEditorStore.getState().world.placements.length).toBe(1);
  });

  it('addPlacement is undoable/redoable through the shared history stack', () => {
    useEditorStore.getState().addPlacement('a', { col: 2, row: 3 });
    expect(useEditorStore.getState().canUndo).toBe(true);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().world.placements).toEqual([]);
    expect(useEditorStore.getState().canRedo).toBe(true);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().world.placements).toEqual([
      { mapId: 'a', origin: { col: 2, row: 3 } },
    ]);
  });

  it('movePlacement updates the origin, undoably; a no-op move returns false', () => {
    useEditorStore.getState().addPlacement('a', { col: 0, row: 0 });
    expect(useEditorStore.getState().movePlacement('a', { col: 0, row: 0 })).toBe(false); // unchanged
    expect(useEditorStore.getState().movePlacement('a', { col: 10, row: -4 })).toBe(true);
    expect(useEditorStore.getState().world.placements[0].origin).toEqual({ col: 10, row: -4 });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().world.placements[0].origin).toEqual({ col: 0, row: 0 });
  });

  it('movePlacement refuses an unknown map id', () => {
    expect(useEditorStore.getState().movePlacement('nope', { col: 1, row: 1 })).toBe(false);
  });

  it('removePlacement removes it, undoably (restored at its original index)', () => {
    useEditorStore.getState().addPlacement('a', { col: 0, row: 0 });
    useEditorStore.getState().addPlacement('b', { col: 10, row: 0 });
    expect(useEditorStore.getState().removePlacement('a')).toBe(true);
    expect(useEditorStore.getState().world.placements.map((p) => p.mapId)).toEqual(['b']);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().world.placements.map((p) => p.mapId)).toEqual(['a', 'b']);
  });

  it('world placements survive a JSON round-trip through parseWorldLayout', () => {
    useEditorStore.getState().addPlacement('a', { col: 0, row: 0 });
    useEditorStore.getState().addPlacement('b', { col: 45, row: 12 });
    const layout = useEditorStore.getState().world;
    const json = `${JSON.stringify(layout, null, 2)}\n`;
    const reparsed = parseWorldLayout(JSON.parse(json));
    expect(reparsed.placements).toEqual([
      { mapId: 'a', origin: { col: 0, row: 0 } },
      { mapId: 'b', origin: { col: 45, row: 12 } },
    ]);
  });

  it('setWorld clears worldDirty and bumps worldRevision (a disk reseed, not a user edit)', () => {
    const before = useEditorStore.getState().worldRevision;
    useEditorStore.getState().addPlacement('a', { col: 0, row: 0 });
    expect(useEditorStore.getState().worldDirty).toBe(true);
    useEditorStore.getState().setWorld({ schemaVersion: 1, placements: [] });
    expect(useEditorStore.getState().worldDirty).toBe(false);
    expect(useEditorStore.getState().worldRevision).toBeGreaterThan(before);
  });

  it('a world undo bumps worldRevision, not docRevision (domain routing)', () => {
    const docBefore = useEditorStore.getState().docRevision;
    useEditorStore.getState().addPlacement('a', { col: 0, row: 0 });
    const worldRevAfterAdd = useEditorStore.getState().worldRevision;
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().worldRevision).toBeGreaterThan(worldRevAfterAdd);
    // The map document was untouched by the world undo.
    expect(useEditorStore.getState().docRevision).toBe(docBefore);
  });
});
