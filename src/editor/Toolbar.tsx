import { useState } from 'react';
import { serializeMap, parseMap, migrateMap } from '../systems/mapFormat';
import { getMap, putMap, putThumb } from './api';
import {
  useEditorStore,
  type EditorOverlays,
  type EditorTool,
  type PaintMode,
} from './store/editorStore';
import { NewMapDialog, type NewMapFields } from './NewMapDialog';
import { OpenMapDialog } from './OpenMapDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from './lib/utils';

/** The paint tools + pan + the step-7 object tools + the step-8 collision/zone/shape tools, in
 *  display order. */
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
  {
    id: 'collision',
    label: 'Collision',
    title:
      'Paint base-terrain walkability (drag = blocked, Alt+drag = walkable). Mode below picks brush/rect/fill.',
  },
  {
    id: 'zone',
    label: 'Zone',
    title:
      'Paint the active zone (drag = assign, Alt+drag = clear). Select a zone in the Zones panel first.',
  },
  {
    id: 'shape',
    label: 'Shape',
    title:
      "Carve the map's irregular shape (drag = void, Alt+drag = restore inside). Mode below picks brush/rect/fill.",
  },
  {
    id: 'terrain',
    label: 'Terrain',
    title:
      'Paint an autotiled terrain onto the active layer (drag = paint, Alt+drag = erase). Arm a terrain in the Library first; mode below picks brush/rect/fill.',
  },
];

/** Tools that share the brush/rect/fill gesture selector (`paintMode`, step 8, extended step 10)
 *  instead of each gesture having its own `EditorTool` id like tile painting does — see the store's
 *  `PaintMode` doc. */
const PAINT_MODE_TOOLS: ReadonlySet<EditorTool> = new Set([
  'collision',
  'zone',
  'shape',
  'terrain',
]);
const PAINT_MODES: Array<{ id: PaintMode; label: string }> = [
  { id: 'brush', label: 'Brush' },
  { id: 'rect', label: 'Rect' },
  { id: 'fill', label: 'Fill' },
];

/** Overlay toggles shown as checkboxes, mirroring the existing Snap checkbox. */
const OVERLAYS: Array<{ id: keyof EditorOverlays; label: string; title: string }> = [
  { id: 'grid', label: 'Grid', title: 'Show the tile grid' },
  {
    id: 'walkability',
    label: 'Collision',
    title:
      'Red tint = blocked base terrain. Hatched cells = a runtime obstacle (decor collision/node) on top, read-only.',
  },
  { id: 'zones', label: 'Zones', title: 'Show each zone as a coloured tint + name label' },
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
  const paintMode = useEditorStore((s) => s.paintMode);
  const overlays = useEditorStore((s) => s.overlays);

  const [showNew, setShowNew] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave(): Promise<void> {
    const current = useEditorStore.getState().map;
    if (!current) return;
    setSaving(true);
    try {
      // Full terrain rebake BEFORE serialize (plan 014 step 10, advisor rule: baked cells are
      // canonical, the terrain mask is editor-only convenience) — a safety net that guarantees the
      // saved `cells` can never silently drift from the authored mask, even if an incremental rebake
      // ever missed a cell. A no-drift save (the common case) is a no-op.
      useEditorStore.getState().rebakeTerrainsForSave();
      const json = serializeMap(current);
      parseMap(JSON.parse(json)); // validate the exact bytes we're about to write
      await putMap(current.meta.id, json);
      useEditorStore.getState().markSaved();
      toast.success(`Saved "${current.meta.name}".`);
      // Every successful map save also (re)bakes the 1px-per-tile thumbnail the World view renders
      // from (plan 014 step 9), so thumbnails never drift from content. The bake capability is
      // installed by EditorScene through the store (the bridge is store-only — no scene ref here).
      // A thumb-export failure must NOT fail the save — the map is already persisted — so it only
      // warns (toast + console), never re-throws into the error branch below.
      void exportThumbnail(current.meta.id);
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`, { duration: 5000 });
    } finally {
      setSaving(false);
    }
  }

  /** Bake + upload the thumbnail; swallow failures into a mild warning (see `handleSave`). */
  async function exportThumbnail(id: string): Promise<void> {
    try {
      const bake = useEditorStore.getState().bakeThumbnail;
      const blob = bake ? await bake() : null;
      if (blob) await putThumb(id, blob);
    } catch (e) {
      console.warn('[editor] thumbnail export failed:', e);
      toast(`Saved, but thumbnail export failed: ${(e as Error).message}`, { duration: 4000 });
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

      {PAINT_MODE_TOOLS.has(activeTool) && (
        <div className={groupClass} title="Gesture for the Collision/Zone/Shape tools">
          {PAINT_MODES.map((mode) => (
            <Button
              key={mode.id}
              variant="ghost"
              size="sm"
              className={cn(
                'font-normal',
                paintMode === mode.id
                  ? 'bg-active text-fg-bright hover:bg-active'
                  : 'text-fg-muted hover:bg-surface',
              )}
              onClick={() => useEditorStore.getState().setPaintMode(mode.id)}
            >
              {mode.label}
            </Button>
          ))}
        </div>
      )}

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

      <div className={groupClass}>
        {OVERLAYS.map((overlay) => (
          <Tooltip key={overlay.id}>
            <TooltipTrigger asChild>
              <label className="flex cursor-pointer items-center gap-1 text-[0.85rem]">
                <input
                  type="checkbox"
                  checked={overlays[overlay.id]}
                  onChange={() => useEditorStore.getState().toggleOverlay(overlay.id)}
                />
                {overlay.label}
              </label>
            </TooltipTrigger>
            <TooltipContent>{overlay.title}</TooltipContent>
          </Tooltip>
        ))}
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
