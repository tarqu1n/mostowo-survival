import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../editorStore';
import nodesJson from '../../../data/maps/nodes.json';
import type { AuthoredNodeDef, NodeDefsFile } from '../../../systems/nodeDefs';

/** The committed seed (`tree`/`rock`/`berryBush`, each with exactly one `default` skin) — deep-cloned
 *  per `reset()` so a test's mutation of `nodeDefs`/its skins can never bleed into another test. */
const SEED_DEFS = (nodesJson as NodeDefsFile).defs;

/** Resets BOTH the node-defs registry (back to the committed `nodes.json` seed) and the open map
 *  (fresh 6x6 scratch, mirrors `editorStoreObjects.test.ts`'s reset) — the delete/remove-skin guards
 *  cross-check against the currently open map's placed nodes, so both need a clean slate per test. */
function reset(): void {
  useEditorStore.getState().newMap('scratch', 'Scratch', 6, 6);
  useEditorStore.getState().setNodeDefs(JSON.parse(JSON.stringify(SEED_DEFS)) as AuthoredNodeDef[]);
}

describe('editorStore: node defs registry (plan 021 step 7)', () => {
  beforeEach(() => reset());

  describe('createNodeDef', () => {
    it('appends a def with sensible defaults and a fresh id, marks dirty, bumps revision', () => {
      const revBefore = useEditorStore.getState().nodeDefsRevision;
      const id = useEditorStore.getState().createNodeDef();
      expect(id).toBe('node');

      const { nodeDefs, nodeDefsParsed, nodeDefsDirty, nodeDefsRevision } =
        useEditorStore.getState();
      expect(nodeDefs).toHaveLength(4);
      expect(nodeDefsParsed.node).toBeDefined();
      expect(nodeDefsParsed.node.skins).toHaveLength(1);
      expect(nodeDefsDirty).toBe(true);
      expect(nodeDefsRevision).toBeGreaterThan(revBefore);
    });

    it('increments the fresh id on repeated creates', () => {
      const id1 = useEditorStore.getState().createNodeDef();
      const id2 = useEditorStore.getState().createNodeDef();
      expect(id1).toBe('node');
      expect(id2).toBe('node_2');
    });
  });

  describe('duplicateNodeDef', () => {
    it('deep-copies a def with a fresh id/name; editing the copy leaves the source untouched', () => {
      const newId = useEditorStore.getState().duplicateNodeDef('tree');
      expect(newId).toBe('tree_copy');

      const parsedAfterCopy = useEditorStore.getState().nodeDefsParsed;
      expect(parsedAfterCopy.tree_copy).toMatchObject({
        maxHp: parsedAfterCopy.tree.maxHp,
        yieldItemId: parsedAfterCopy.tree.yieldItemId,
      });
      expect(parsedAfterCopy.tree_copy.name).toBe('Tree copy');

      useEditorStore.getState().updateNodeDef('tree_copy', { maxHp: 999 });
      expect(useEditorStore.getState().nodeDefsParsed.tree.maxHp).toBe(3); // source untouched
    });

    it('returns null (no mutation) for an unknown id', () => {
      const before = useEditorStore.getState().nodeDefs.length;
      expect(useEditorStore.getState().duplicateNodeDef('nope')).toBeNull();
      expect(useEditorStore.getState().nodeDefs).toHaveLength(before);
    });
  });

  describe('updateNodeDef', () => {
    it('commits a valid patch', () => {
      const ok = useEditorStore.getState().updateNodeDef('tree', { maxHp: 99 });
      expect(ok).toBe(true);
      expect(useEditorStore.getState().nodeDefsParsed.tree.maxHp).toBe(99);
    });

    it('refuses an invalid patch (non-positive maxHp), leaving state unchanged', () => {
      const ok = useEditorStore.getState().updateNodeDef('tree', { maxHp: -1 });
      expect(ok).toBe(false);
      expect(useEditorStore.getState().nodeDefsParsed.tree.maxHp).toBe(3);
    });

    it('refuses an unknown id', () => {
      expect(useEditorStore.getState().updateNodeDef('nope', { maxHp: 1 })).toBe(false);
    });
  });

  describe('deleteNodeDef', () => {
    it('refuses (guarded) when a placed node in the open map references the def', () => {
      useEditorStore.getState().placeNode('tree', 1, 1);
      const ok = useEditorStore.getState().deleteNodeDef('tree');
      expect(ok).toBe(false);
      expect(useEditorStore.getState().nodeDefsParsed.tree).toBeDefined();
    });

    it('deletes an unreferenced def', () => {
      const ok = useEditorStore.getState().deleteNodeDef('berryBush');
      expect(ok).toBe(true);
      expect(useEditorStore.getState().nodeDefsParsed.berryBush).toBeUndefined();
      expect(useEditorStore.getState().nodeDefs.some((d) => d.id === 'berryBush')).toBe(false);
    });

    it('refuses an unknown id', () => {
      expect(useEditorStore.getState().deleteNodeDef('nope')).toBe(false);
    });
  });

  describe('skin sub-actions', () => {
    it('addSkin appends a fresh skin id', () => {
      const skinId = useEditorStore.getState().addSkin('tree');
      expect(skinId).toBe('skin');
      expect(useEditorStore.getState().nodeDefsParsed.tree.skins.map((s) => s.id)).toEqual([
        'default',
        'skin',
      ]);
    });

    it('addSkin returns null for an unknown def', () => {
      expect(useEditorStore.getState().addSkin('nope')).toBeNull();
    });

    it('updateSkin commits a valid patch', () => {
      const ok = useEditorStore.getState().updateSkin('tree', 'default', { weight: 5 });
      expect(ok).toBe(true);
      expect(useEditorStore.getState().nodeDefsParsed.tree.skins[0].weight).toBe(5);
    });

    it('updateSkin refuses an invalid patch (non-positive weight)', () => {
      const ok = useEditorStore.getState().updateSkin('tree', 'default', { weight: -1 });
      expect(ok).toBe(false);
      expect(useEditorStore.getState().nodeDefsParsed.tree.skins[0].weight).toBe(1);
    });

    it('removeSkin refuses when it would leave the def with zero skins', () => {
      const ok = useEditorStore.getState().removeSkin('rock', 'default');
      expect(ok).toBe(false);
      expect(useEditorStore.getState().nodeDefsParsed.rock.skins).toHaveLength(1);
    });

    it('removeSkin refuses (guarded) when a placed node in the open map uses that specific skin', () => {
      useEditorStore.getState().addSkin('tree'); // tree now has skins: default, skin
      useEditorStore.getState().placeNode('tree', 1, 1);
      const map = useEditorStore.getState().map!;
      const obj = map.objects[0];
      if (obj.kind === 'node') obj.skin = 'default';

      const ok = useEditorStore.getState().removeSkin('tree', 'default');
      expect(ok).toBe(false);
      expect(useEditorStore.getState().nodeDefsParsed.tree.skins.map((s) => s.id)).toContain(
        'default',
      );
    });

    it('removeSkin succeeds for a spare skin nothing placed references', () => {
      useEditorStore.getState().addSkin('tree');
      const ok = useEditorStore.getState().removeSkin('tree', 'skin');
      expect(ok).toBe(true);
      expect(useEditorStore.getState().nodeDefsParsed.tree.skins.map((s) => s.id)).toEqual([
        'default',
      ]);
    });

    it('moveSkin reorders — the moved skin becomes the new skins[0]', () => {
      useEditorStore.getState().addSkin('tree');
      const ok = useEditorStore.getState().moveSkin('tree', 'skin', 0);
      expect(ok).toBe(true);
      expect(useEditorStore.getState().nodeDefsParsed.tree.skins.map((s) => s.id)).toEqual([
        'skin',
        'default',
      ]);
    });
  });

  describe('setNodeDefs / markNodeDefsSaved', () => {
    it('installs a valid registry and clears the dirty flag', () => {
      useEditorStore.getState().createNodeDef(); // dirties the store
      const defs = useEditorStore.getState().nodeDefs;
      useEditorStore.getState().setNodeDefs(defs);
      expect(useEditorStore.getState().nodeDefsDirty).toBe(false);
    });

    it('refuses an invalid registry (duplicate ids), leaving the prior registry in place', () => {
      const before = useEditorStore.getState().nodeDefs;
      const invalid = [...before, { ...before[0] }]; // duplicate id
      useEditorStore.getState().setNodeDefs(invalid);
      expect(useEditorStore.getState().nodeDefs).toBe(before); // unchanged reference — refused
    });

    it('round-trips through a save/reload cycle (serialize -> parse -> setNodeDefs)', () => {
      useEditorStore.getState().createNodeDef();
      useEditorStore.getState().updateNodeDef('node', { name: 'Renamed' });
      const before = useEditorStore.getState().nodeDefsParsed;

      const json = JSON.stringify({ version: 1, defs: useEditorStore.getState().nodeDefs });
      const reread = JSON.parse(json) as { defs: AuthoredNodeDef[] };
      useEditorStore.getState().markNodeDefsSaved();
      useEditorStore.getState().setNodeDefs(reread.defs);

      expect(useEditorStore.getState().nodeDefsParsed.node.name).toBe('Renamed');
      expect(useEditorStore.getState().nodeDefsParsed).toEqual(before);
      expect(useEditorStore.getState().nodeDefsDirty).toBe(false);
    });
  });
});
