import { useState } from 'react';
import { serializeMap, parseMap, migrateMap } from '../systems/mapFormat';
import { getMap, putMap } from './api';
import { useEditorStore, type EditorTool } from './store/editorStore';
import { NewMapDialog, type NewMapFields } from './NewMapDialog';
import { OpenMapDialog } from './OpenMapDialog';
import type { ToastFn } from './Toast';

/** The paint tools + pan + the step-7 object tools, in display order. Collision/zone/shape land in a
 *  later step. */
const TOOLS: Array<{ id: EditorTool; label: string; title: string }> = [
  { id: 'pan', label: 'Pan', title: 'Pan the viewport (also: middle-drag or Space+drag)' },
  {
    id: 'select',
    label: 'Select',
    title: 'Pick objects (click, shift-click for multi-select), drag to move, Delete to remove',
  },
  { id: 'brush', label: 'Brush', title: 'Paint the selected Library asset (drag)' },
  { id: 'eraser', label: 'Eraser', title: 'Clear cells to empty (drag)' },
  { id: 'fill', label: 'Fill', title: 'Flood-fill same-value cells' },
  { id: 'rect', label: 'Rect', title: 'Paint a rectangle (drag)' },
  {
    id: 'place',
    label: 'Place',
    title: 'Place the object armed in the Library (arm a decor/node asset first)',
  },
  { id: 'portal', label: 'Portal', title: 'Draw a tile rect, then name it + set its facing' },
];

/**
 * Top toolbar (plan 014 step 5, extended step 6): New / Open / Save, Undo / Redo, a paint-tool strip,
 * the current map name + dirty dot, and the Map/World view switch. Save serializes → re-validates
 * through `parseMap` → PUTs; a validation or IO failure flashes an error toast rather than writing
 * junk. World view itself lands in step 9 (the switch just flips `view`).
 */
export function Toolbar({ showToast }: { showToast: ToastFn }) {
  const map = useEditorStore((s) => s.map);
  const mapId = useEditorStore((s) => s.mapId);
  const dirty = useEditorStore((s) => s.dirty);
  const view = useEditorStore((s) => s.view);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const activeTool = useEditorStore((s) => s.activeTool);
  const armedObjectAsset = useEditorStore((s) => s.armedObjectAsset);
  const armedNodeRef = useEditorStore((s) => s.armedNodeRef);
  const snapToTileCenter = useEditorStore((s) => s.snapToTileCenter);

  const [showNew, setShowNew] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave(): Promise<void> {
    const current = useEditorStore.getState().map;
    if (!current) return;
    setSaving(true);
    try {
      const json = serializeMap(current);
      parseMap(JSON.parse(json)); // validate the exact bytes we're about to write
      await putMap(current.meta.id, json);
      useEditorStore.getState().markSaved();
      showToast(`Saved "${current.meta.name}".`, 'ok');
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleOpen(id: string): Promise<void> {
    try {
      const raw = await getMap(id);
      const loaded = migrateMap(raw);
      useEditorStore.getState().loadMap(loaded, id);
      setShowOpen(false);
      showToast(`Opened "${loaded.meta.name}".`, 'ok');
    } catch (e) {
      showToast(`Open failed: ${(e as Error).message}`, 'error');
    }
  }

  function handleCreate(fields: NewMapFields): void {
    useEditorStore.getState().newMap(fields.id, fields.name, fields.width, fields.height);
    setShowNew(false);
    showToast(`Created "${fields.name}" — remember to Save.`, 'ok');
  }

  return (
    <header className="editor-toolbar">
      <div className="editor-toolbar-group">
        <button onClick={() => setShowNew(true)}>New</button>
        <button onClick={() => setShowOpen(true)}>Open</button>
        <button onClick={() => void handleSave()} disabled={!map || saving}>
          Save
        </button>
      </div>

      <div className="editor-toolbar-group">
        <button
          onClick={() => useEditorStore.getState().undo()}
          disabled={!canUndo}
          title="Undo (Ctrl/Cmd+Z)"
        >
          Undo
        </button>
        <button
          onClick={() => useEditorStore.getState().redo()}
          disabled={!canRedo}
          title="Redo (Shift+Ctrl/Cmd+Z)"
        >
          Redo
        </button>
      </div>

      <div className="editor-toolbar-group">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            className={activeTool === tool.id ? 'is-active' : ''}
            title={tool.title}
            disabled={!map || (tool.id === 'place' && !armedObjectAsset && !armedNodeRef)}
            onClick={() => useEditorStore.getState().setActiveTool(tool.id)}
          >
            {tool.label}
          </button>
        ))}
      </div>

      <div className="editor-toolbar-group">
        <label
          className="editor-snap-toggle"
          title="Snap decor placement/drag to tile centres (hold Alt for free pixels). Nodes/portals are always tile-snapped."
        >
          <input
            type="checkbox"
            checked={snapToTileCenter}
            onChange={() => useEditorStore.getState().setSnapToTileCenter(!snapToTileCenter)}
          />
          Snap
        </label>
      </div>

      <div className="editor-toolbar-group editor-toolbar-title">
        {map ? (
          <span>
            {map.meta.name} <span className="editor-mapid">({mapId})</span>
            {dirty && (
              <span className="editor-dirty" title="Unsaved changes">
                {' '}
                ●
              </span>
            )}
          </span>
        ) : (
          <span className="editor-placeholder">No map open</span>
        )}
      </div>

      <div className="editor-toolbar-group editor-toolbar-view">
        <button
          className={view === 'map' ? 'is-active' : ''}
          onClick={() => useEditorStore.getState().setView('map')}
        >
          Map
        </button>
        <button
          className={view === 'world' ? 'is-active' : ''}
          onClick={() => useEditorStore.getState().setView('world')}
        >
          World
        </button>
      </div>

      {showNew && <NewMapDialog onCreate={handleCreate} onCancel={() => setShowNew(false)} />}
      {showOpen && (
        <OpenMapDialog onOpen={(id) => void handleOpen(id)} onCancel={() => setShowOpen(false)} />
      )}
    </header>
  );
}
