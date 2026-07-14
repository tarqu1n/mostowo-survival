import { useState } from 'react';
import { serializeMap, parseMap, migrateMap } from '../systems/mapFormat';
import { getMap, putMap } from './api';
import { useEditorStore, type EditorTool } from './store/editorStore';
import { NewMapDialog, type NewMapFields } from './NewMapDialog';
import { OpenMapDialog } from './OpenMapDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from './lib/utils';

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

/** `.editor-toolbar-group` (plan 020 Step 6) — a row of related controls within the toolbar; every
 *  group shares the same gap/alignment. */
const groupClass = 'flex items-center gap-1.5';

/**
 * Top toolbar (plan 014 step 5, extended step 6): New / Open / Save, Undo / Redo, a paint-tool strip,
 * and the current map name + dirty dot. Save serializes → re-validates through `parseMap` → PUTs; a
 * validation or IO failure flashes an error toast rather than writing junk. The Map/World (and
 * object-editor) switch now lives in the central-pane tab strip (plan 017 step 2), not here.
 */
export function Toolbar() {
  const map = useEditorStore((s) => s.map);
  const mapId = useEditorStore((s) => s.mapId);
  const dirty = useEditorStore((s) => s.dirty);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const activeTool = useEditorStore((s) => s.activeTool);
  const armedObjectAsset = useEditorStore((s) => s.armedObjectAsset);
  const armedNodeRef = useEditorStore((s) => s.armedNodeRef);
  const snapToTileCenter = useEditorStore((s) => s.snapToTileCenter);

  const [showNew, setShowNew] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
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
      toast.success(`Saved "${current.meta.name}".`);
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`, { duration: 5000 });
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
      toast.success(`Opened "${loaded.meta.name}".`);
    } catch (e) {
      toast.error(`Open failed: ${(e as Error).message}`, { duration: 5000 });
    }
  }

  function handleCreate(fields: NewMapFields): void {
    useEditorStore.getState().newMap(fields.id, fields.name, fields.width, fields.height);
    setShowNew(false);
    toast.success(`Created "${fields.name}" — remember to Save.`);
  }

  return (
    // The shadcn Tooltips on the sparse chrome controls (Undo/Redo, Keys, Snap, the dirty dot) are
    // powered by the single TooltipProvider mounted at the EditorApp root (plan 020 Step 5). The
    // paint-tool strip below keeps native `title`s instead — it's a repeated list, not discrete chrome.
    <header className="flex items-center gap-4 border-b border-surface bg-raised px-3 py-1.5">
      <div className={groupClass}>
        <Button variant="secondary" size="sm" onClick={() => setShowNew(true)}>
          New
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setShowOpen(true)}>
          Open
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!map || saving}
        >
          Save
        </Button>
      </div>

      <div className={groupClass}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => useEditorStore.getState().undo()}
              disabled={!canUndo}
            >
              Undo
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo (Ctrl/Cmd+Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => useEditorStore.getState().redo()}
              disabled={!canRedo}
            >
              Redo
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo (Shift+Ctrl/Cmd+Z)</TooltipContent>
        </Tooltip>
      </div>

      <div className={groupClass}>
        {TOOLS.map((tool) => {
          const active = activeTool === tool.id;
          return (
            <Button
              key={tool.id}
              variant="ghost"
              size="sm"
              className={cn(
                'font-normal',
                active
                  ? 'bg-active text-fg-bright hover:bg-active'
                  : 'text-fg-muted hover:bg-surface',
              )}
              title={tool.title}
              disabled={!map || (tool.id === 'place' && !armedObjectAsset && !armedNodeRef)}
              onClick={() => useEditorStore.getState().setActiveTool(tool.id)}
            >
              {tool.label}
            </Button>
          );
        })}
      </div>

      <div className={groupClass}>
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex cursor-pointer items-center gap-1 text-[0.85rem]">
              <input
                type="checkbox"
                checked={snapToTileCenter}
                onChange={() => useEditorStore.getState().setSnapToTileCenter(!snapToTileCenter)}
              />
              Snap
            </label>
          </TooltipTrigger>
          <TooltipContent>
            Snap decor placement/drag to tile centres (hold Alt for free pixels). Nodes/portals are
            always tile-snapped.
          </TooltipContent>
        </Tooltip>
      </div>

      <div className={cn(groupClass, 'flex-1 justify-center text-[0.9rem]')}>
        {map ? (
          <span>
            {map.meta.name} <span className="text-[0.8rem] text-muted-2">({mapId})</span>
            {dirty && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-gold"> ●</span>
                </TooltipTrigger>
                <TooltipContent>Unsaved changes</TooltipContent>
              </Tooltip>
            )}
          </span>
        ) : (
          <span className="text-muted-2">No map open</span>
        )}
      </div>

      <div className={groupClass}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="secondary" size="sm" onClick={() => setShowShortcuts(true)}>
              ⌨ Keys
            </Button>
          </TooltipTrigger>
          <TooltipContent>Keyboard & mouse shortcuts</TooltipContent>
        </Tooltip>
      </div>

      {showNew && <NewMapDialog onCreate={handleCreate} onCancel={() => setShowNew(false)} />}
      {showOpen && (
        <OpenMapDialog onOpen={(id) => void handleOpen(id)} onCancel={() => setShowOpen(false)} />
      )}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </header>
  );
}
