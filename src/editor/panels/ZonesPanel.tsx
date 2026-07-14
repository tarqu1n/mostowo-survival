import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { Button } from '../ui/button';
import { cn } from '../lib/utils';

/**
 * Zones panel (plan 014 step 8) — create/rename/recolour/delete zone defs (lowest-free uint8 id,
 * allocated by `createZone`), and select the ACTIVE zone the Zone tool paints with (`activeZoneId`).
 * Selecting a zone here is also what makes the Library's Favourites filter follow it (wired back in
 * step 6 — see `LibraryPanel`'s `favourites` lookup, which already keys off `activeZoneId`; this
 * panel only needed to give `activeZoneId` a UI to set, not re-wire the favourites side).
 *
 * Mirrors `LayersPanel`'s shape closely (list, inline rename via double-click, delete), since zones
 * are "the same brush/undo/storage machinery as walkability" per the plan — recolour is the one
 * extra control (a native `<input type="color">`, committed on change/blur like the rename field).
 *
 * Re-render note: mirrors `LayersPanel`/`InspectorPanel` — `map` is mutated in place by store
 * commands, so this subscribes to `docRevision`/`mapEpoch` purely as re-render triggers and reads the
 * current `map` via `getState()` in the render body.
 */

const headingClass = 'mb-2 text-[0.85rem] uppercase tracking-[0.04em] text-fg-dim';
const placeholderClass = 'text-[0.9rem] text-muted-2';

export function ZonesPanel() {
  const activeZoneId = useEditorStore((s) => s.activeZoneId);
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const map = useEditorStore.getState().map;

  if (!map) {
    return (
      <>
        <h2 className={headingClass}>Zones</h2>
        <p className={placeholderClass}>No map open.</p>
      </>
    );
  }

  const defs = map.zones.defs;

  function commitRename(id: number): void {
    const trimmed = renameValue.trim();
    if (trimmed.length > 0) useEditorStore.getState().renameZone(id, trimmed);
    setRenamingId(null);
  }

  return (
    <>
      <h2 className={headingClass}>Zones</h2>
      <Button size="sm" onClick={() => useEditorStore.getState().createZone()}>
        + Add zone
      </Button>
      {defs.length === 0 && (
        <p className={cn(placeholderClass, 'mt-2')}>
          No zones yet — add one, then use the Zone tool to paint it.
        </p>
      )}
      <ul className="mt-2.5 flex list-none flex-col gap-0.5 p-0">
        {defs.map((def) => {
          const isActive = def.id === activeZoneId;
          const isRenaming = renamingId === def.id;
          return (
            <li
              key={def.id}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-1 py-[3px]',
                isActive && 'bg-surface',
              )}
            >
              <input
                type="color"
                className="h-5 w-5 shrink-0 cursor-pointer rounded-[3px] border border-border bg-transparent p-0"
                value={def.colour}
                title="Zone colour"
                onChange={(e) => useEditorStore.getState().recolourZone(def.id, e.target.value)}
              />

              {isRenaming ? (
                <input
                  className="min-w-0 flex-1 rounded-[3px] border border-border bg-inset px-1 py-0.5 font-[inherit] text-fg"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(def.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(def.id);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-auto flex-1 justify-start overflow-hidden px-1 py-0.5 text-left font-normal text-ellipsis whitespace-nowrap',
                    isActive && 'text-fg-bright',
                  )}
                  title="Click to set as the active zone (the Zone tool paints it), double-click to rename"
                  onClick={() =>
                    useEditorStore.getState().setActiveZoneId(isActive ? null : def.id)
                  }
                  onDoubleClick={() => {
                    setRenamingId(def.id);
                    setRenameValue(def.name);
                  }}
                >
                  {def.name}
                </Button>
              )}

              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0"
                title="Delete zone (clears every cell painted with it)"
                onClick={() => useEditorStore.getState().deleteZone(def.id)}
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
