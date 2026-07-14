import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { Button } from '../ui/button';
import { cn } from '../lib/utils';

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

/** Shared heading treatment for this pane (plan 020 step 8) — reproduces the old `.editor-pane h2`
 *  uppercase/tracking/dim-colour look, which was dropped along with the shared rule (see LibraryPanel). */
const headingClass = 'mb-2 text-[0.85rem] uppercase tracking-[0.04em] text-fg-dim';

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
        <h2 className={headingClass}>Layers</h2>
        <p className="text-[0.9rem] text-muted-2">No map open.</p>
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
      <h2 className={headingClass}>Layers</h2>
      <Button size="sm" onClick={() => useEditorStore.getState().addLayer()}>
        + Add layer
      </Button>
      <ul className="mt-2.5 flex list-none flex-col gap-0.5 p-0">
        {[...layers].reverse().map((layer) => {
          const index = layers.indexOf(layer);
          const isActive = layer.id === activeLayerId;
          const isHidden = hiddenLayerIds.includes(layer.id);
          const isRenaming = renamingId === layer.id;
          return (
            <li
              key={layer.id}
              className={cn(
                'flex items-center gap-1 rounded-md px-1 py-[3px]',
                isActive && 'bg-surface',
              )}
            >
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0"
                title={isHidden ? 'Show layer' : 'Hide layer (view only — not saved)'}
                onClick={() => useEditorStore.getState().toggleLayerVisibility(layer.id)}
              >
                {isHidden ? '🚫' : '👁'}
              </Button>

              {isRenaming ? (
                <input
                  className="min-w-0 flex-1 rounded-[3px] border border-border bg-inset px-1 py-0.5 font-[inherit] text-fg"
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto flex-1 justify-start overflow-hidden px-1 py-0.5 text-left font-normal text-ellipsis whitespace-nowrap"
                  onClick={() => useEditorStore.getState().setActiveLayer(layer.id)}
                  onDoubleClick={() => {
                    setRenamingId(layer.id);
                    setRenameValue(layer.name);
                  }}
                  title="Click to select as the paint target, double-click to rename"
                >
                  {layer.name}
                </Button>
              )}

              <label
                className="flex flex-none items-center gap-0.5 text-[0.7rem] text-fg-dim"
                title="Renders above entities in-game (overhead)"
              >
                <input
                  type="checkbox"
                  checked={layer.overhead}
                  onChange={() => useEditorStore.getState().toggleLayerOverhead(layer.id)}
                />
                OH
              </label>

              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0"
                title="Bring forward (render on top)"
                disabled={index === layers.length - 1}
                onClick={() => useEditorStore.getState().moveLayer(layer.id, 'forward')}
              >
                ↑
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0"
                title="Send backward (render underneath)"
                disabled={index === 0}
                onClick={() => useEditorStore.getState().moveLayer(layer.id, 'backward')}
              >
                ↓
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0"
                title="Delete layer"
                disabled={layers.length <= 1}
                onClick={() => useEditorStore.getState().deleteLayer(layer.id)}
              >
                ✕
              </Button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
