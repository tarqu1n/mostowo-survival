import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';

/**
 * Layers panel (plan 014 step 6) — lists the open map's tile layers, select/add/rename/delete/
 * reorder, a visibility eye (editor VIEW state, not map data — see `hiddenLayerIds` in the store),
 * and the `overhead` checkbox (real `TileLayer` data). Deleting/reordering/toggling overhead are each
 * one undoable command via the store.
 *
 * Displayed **top-first** (front-most/topmost render layer at the top of the list, the common
 * layers-panel convention) even though `map.layers` itself is stored bottom→top per the schema —
 * purely a display reversal; "bring forward"/"send backward" always operate on the underlying array.
 *
 * Re-render note: see `LibraryPanel`'s module doc — `map` is mutated in place, so this subscribes to
 * `docRevision`/`mapEpoch` only as re-render triggers and reads `map` fresh via `getState()`.
 */
export function LayersPanel() {
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const hiddenLayerIds = useEditorStore((s) => s.hiddenLayerIds);
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const map = useEditorStore.getState().map;

  if (!map) {
    return (
      <>
        <h2>Layers</h2>
        <p className="editor-placeholder">No map open.</p>
      </>
    );
  }

  const layers = map.layers; // stored bottom→top; index 0 = bottom/back

  function commitRename(layerId: string): void {
    const trimmed = renameValue.trim();
    if (trimmed.length > 0) useEditorStore.getState().renameLayer(layerId, trimmed);
    setRenamingId(null);
  }

  return (
    <>
      <h2>Layers</h2>
      <button onClick={() => useEditorStore.getState().addLayer()}>+ Add layer</button>
      <ul className="layers-list">
        {[...layers].reverse().map((layer) => {
          const index = layers.indexOf(layer);
          const isActive = layer.id === activeLayerId;
          const isHidden = hiddenLayerIds.includes(layer.id);
          const isRenaming = renamingId === layer.id;
          return (
            <li key={layer.id} className={`layers-item ${isActive ? 'is-active' : ''}`}>
              <button
                className="layers-eye"
                title={isHidden ? 'Show layer' : 'Hide layer (view only — not saved)'}
                onClick={() => useEditorStore.getState().toggleLayerVisibility(layer.id)}
              >
                {isHidden ? '🚫' : '👁'}
              </button>

              {isRenaming ? (
                <input
                  className="layers-rename-input"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(layer.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(layer.id);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <button
                  className="layers-name"
                  onClick={() => useEditorStore.getState().setActiveLayer(layer.id)}
                  onDoubleClick={() => {
                    setRenamingId(layer.id);
                    setRenameValue(layer.name);
                  }}
                  title="Click to select as the paint target, double-click to rename"
                >
                  {layer.name}
                </button>
              )}

              <label className="layers-overhead" title="Renders above entities in-game (overhead)">
                <input
                  type="checkbox"
                  checked={layer.overhead}
                  onChange={() => useEditorStore.getState().toggleLayerOverhead(layer.id)}
                />
                OH
              </label>

              <button
                title="Bring forward (render on top)"
                disabled={index === layers.length - 1}
                onClick={() => useEditorStore.getState().moveLayer(layer.id, 'forward')}
              >
                ↑
              </button>
              <button
                title="Send backward (render underneath)"
                disabled={index === 0}
                onClick={() => useEditorStore.getState().moveLayer(layer.id, 'backward')}
              >
                ↓
              </button>
              <button
                title="Delete layer"
                disabled={layers.length <= 1}
                onClick={() => useEditorStore.getState().deleteLayer(layer.id)}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
