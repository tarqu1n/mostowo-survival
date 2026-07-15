import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../editorStore';
import type { AssetCatalog, CatalogAsset } from '../../catalog';

/** The store is a module-level singleton and tab state isn't cleared by `newMap`, so each test resets
 *  the tab slice back to its initial shape (the two permanent tabs, `map` active, no catalog). */
function resetTabs(): void {
  useEditorStore.setState({
    tabs: [
      { id: 'map', kind: 'map' },
      { id: 'world', kind: 'world' },
    ],
    activeTabId: 'map',
    catalog: null,
  });
}

/** Minimal `AssetCatalog` listing the given asset ids — `reconcileTabs` only reads `assets[].id`, but
 *  we build fully-typed `CatalogAsset`s to keep the fixture honest (no `any`). */
function catalogWith(...ids: string[]): AssetCatalog {
  const assets: CatalogAsset[] = ids.map((id) => ({
    id,
    pack: 'test-pack',
    type: 'object',
    source: { kind: 'image', path: id },
    w: 16,
    h: 16,
    category: 'misc',
    tags: [],
  }));
  return { packs: [], assets };
}

const tabIds = (): string[] => useEditorStore.getState().tabs.map((t) => t.id);

describe('editorStore tabs', () => {
  beforeEach(resetTabs);

  it('openObjectTab appends an object tab and activates it', () => {
    useEditorStore.getState().openObjectTab('pack/rock.png');
    expect(tabIds()).toEqual(['map', 'world', 'object:pack/rock.png']);
    expect(useEditorStore.getState().activeTabId).toBe('object:pack/rock.png');
    expect(useEditorStore.getState().tabs[2]).toEqual({
      id: 'object:pack/rock.png',
      kind: 'object',
      assetId: 'pack/rock.png',
    });
  });

  it('openObjectTab on an already-open asset dedupes (no duplicate) and just re-activates it', () => {
    useEditorStore.getState().openObjectTab('pack/a.png');
    useEditorStore.getState().activateTab('map'); // switch away
    useEditorStore.getState().openObjectTab('pack/a.png'); // re-open the same asset

    expect(tabIds()).toEqual(['map', 'world', 'object:pack/a.png']); // still exactly one object tab
    expect(useEditorStore.getState().activeTabId).toBe('object:pack/a.png');
  });

  it('activateTab switches to an existing tab; a no-op for an unknown id', () => {
    useEditorStore.getState().openObjectTab('pack/a.png');
    useEditorStore.getState().activateTab('world');
    expect(useEditorStore.getState().activeTabId).toBe('world');

    useEditorStore.getState().activateTab('object:does-not-exist');
    expect(useEditorStore.getState().activeTabId).toBe('world'); // unchanged
  });

  it('closeTab removes an object tab and activates its left neighbour when it was active', () => {
    useEditorStore.getState().openObjectTab('pack/a.png');
    useEditorStore.getState().openObjectTab('pack/b.png'); // now active
    // tabs: [map, world, object:a, object:b]; close the active last tab.
    useEditorStore.getState().closeTab('object:pack/b.png');

    expect(tabIds()).toEqual(['map', 'world', 'object:pack/a.png']);
    expect(useEditorStore.getState().activeTabId).toBe('object:pack/a.png'); // left neighbour
  });

  it('closeTab keeps the current active tab when a non-active tab is closed', () => {
    useEditorStore.getState().openObjectTab('pack/a.png');
    useEditorStore.getState().openObjectTab('pack/b.png'); // active
    useEditorStore.getState().closeTab('object:pack/a.png'); // close the OTHER one

    expect(tabIds()).toEqual(['map', 'world', 'object:pack/b.png']);
    expect(useEditorStore.getState().activeTabId).toBe('object:pack/b.png'); // still active
  });

  it('closeTab on the last active object tab falls back to its left neighbour (world)', () => {
    useEditorStore.getState().openObjectTab('pack/a.png'); // active; tabs: [map, world, object:a]
    useEditorStore.getState().closeTab('object:pack/a.png');

    expect(tabIds()).toEqual(['map', 'world']);
    expect(useEditorStore.getState().activeTabId).toBe('world');
  });

  it('closeTab is a no-op on the permanent map/world tabs', () => {
    useEditorStore.getState().openObjectTab('pack/a.png');
    useEditorStore.getState().activateTab('map');

    useEditorStore.getState().closeTab('map');
    useEditorStore.getState().closeTab('world');

    expect(tabIds()).toEqual(['map', 'world', 'object:pack/a.png']);
    expect(useEditorStore.getState().activeTabId).toBe('map');
  });

  it('setCatalog drops an object tab whose asset vanished and re-points the active tab', () => {
    useEditorStore.getState().openObjectTab('pack/kept.png');
    useEditorStore.getState().openObjectTab('pack/gone.png'); // active tab is the one about to vanish

    useEditorStore.getState().setCatalog(catalogWith('pack/kept.png'));

    expect(tabIds()).toEqual(['map', 'world', 'object:pack/kept.png']);
    expect(useEditorStore.getState().activeTabId).toBe('map'); // dropped active → falls back to map
  });

  it('setCatalog keeps a surviving active object tab active', () => {
    useEditorStore.getState().openObjectTab('pack/gone.png');
    useEditorStore.getState().openObjectTab('pack/kept.png'); // active + survives

    useEditorStore.getState().setCatalog(catalogWith('pack/kept.png'));

    expect(tabIds()).toEqual(['map', 'world', 'object:pack/kept.png']);
    expect(useEditorStore.getState().activeTabId).toBe('object:pack/kept.png');
  });

  it('setCatalog(null) keeps all tabs (does not nuke object tabs just because the catalog cleared)', () => {
    useEditorStore.getState().openObjectTab('pack/a.png');
    useEditorStore.getState().setCatalog(null);

    expect(tabIds()).toEqual(['map', 'world', 'object:pack/a.png']);
    expect(useEditorStore.getState().activeTabId).toBe('object:pack/a.png');
  });
});

/** Node Types (plan 021 step 8) — a THIRD permanent, non-closable tab. These tests reset to the
 *  store's real initial tab shape (map/world/nodeTypes), unlike `resetTabs()` above (which deliberately
 *  strips `nodeTypes` to keep the object-tab tests' expected arrays unchanged). */
describe('editorStore tabs: nodeTypes (plan 021 step 8)', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: [
        { id: 'map', kind: 'map' },
        { id: 'world', kind: 'world' },
        { id: 'nodeTypes', kind: 'nodeTypes' },
      ],
      activeTabId: 'map',
      catalog: null,
    });
  });

  it('is present alongside map/world and can be activated', () => {
    expect(tabIds()).toEqual(['map', 'world', 'nodeTypes']);
    useEditorStore.getState().activateTab('nodeTypes');
    expect(useEditorStore.getState().activeTabId).toBe('nodeTypes');
  });

  it('closeTab is a no-op on the permanent nodeTypes tab', () => {
    useEditorStore.getState().activateTab('nodeTypes');
    useEditorStore.getState().closeTab('nodeTypes');

    expect(tabIds()).toEqual(['map', 'world', 'nodeTypes']);
    expect(useEditorStore.getState().activeTabId).toBe('nodeTypes');
  });

  it('survives setCatalog reconciliation (never an object tab, never dropped)', () => {
    useEditorStore.getState().setCatalog(catalogWith('pack/a.png'));
    expect(tabIds()).toEqual(['map', 'world', 'nodeTypes']);
  });
});
