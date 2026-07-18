import { useRef, useState } from 'react';
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
import { EditMapDialog } from './EditMapDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Ban,
  ChevronDown,
  DoorOpen,
  Eraser,
  Hand,
  Mountain,
  MousePointer2,
  PaintBucket,
  Paintbrush,
  Pipette,
  Scissors,
  SlidersHorizontal,
  Square,
  SquareDashed,
  Stamp,
  X,
  type LucideIcon,
} from 'lucide-react';
import { regionMoveInBounds } from './regionOps';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useIsCompact } from './hooks/useIsCompact';
import { RotationWheel } from './ui/RotationWheel';
import { cn } from './lib/utils';

/** The paint tools + pan + the step-7 object tools + the step-8 collision/zone/shape tools, in
 *  display order. */
const TOOLS: Array<{ id: EditorTool; label: string; title: string; icon: LucideIcon }> = [
  {
    id: 'pan',
    label: 'Pan',
    title: 'Pan the viewport (also: middle-drag or Space+drag)',
    icon: Hand,
  },
  {
    id: 'select',
    label: 'Select',
    title:
      'Pick objects (click, shift-click for multi-select), drag to move, Delete to remove. Drag a box over empty map to select a whole area (tiles + objects) and move it a tile at a time.',
    icon: MousePointer2,
  },
  {
    id: 'brush',
    label: 'Brush',
    title: 'Paint the selected Library asset (drag)',
    icon: Paintbrush,
  },
  { id: 'eraser', label: 'Eraser', title: 'Clear cells to empty (drag)', icon: Eraser },
  { id: 'fill', label: 'Fill', title: 'Flood-fill same-value cells', icon: PaintBucket },
  { id: 'rect', label: 'Rect', title: 'Paint a rectangle (drag)', icon: Square },
  {
    id: 'eyedropper',
    label: 'Pick',
    title:
      'Eyedropper — click a tile or object to sample it and arm it (then switches to the matching paint tool). On desktop: Alt+click with a tile-paint tool.',
    icon: Pipette,
  },
  {
    id: 'place',
    label: 'Place',
    title: 'Place the object armed in the Library (arm a decor/node asset first)',
    icon: Stamp,
  },
  {
    id: 'portal',
    label: 'Portal',
    title: 'Draw a tile rect, then name it + set its facing',
    icon: DoorOpen,
  },
  {
    id: 'collision',
    label: 'Collision',
    title:
      'Paint base-terrain walkability (drag = blocked, Alt+drag = walkable). Mode below picks brush/rect/fill.',
    icon: Ban,
  },
  {
    id: 'zone',
    label: 'Zone',
    title:
      'Paint the active zone (drag = assign, Alt+drag = clear). Select a zone in the Zones panel first.',
    icon: SquareDashed,
  },
  {
    id: 'shape',
    label: 'Shape',
    title:
      "Carve the map's irregular shape (drag = void, Alt+drag = restore inside). Mode below picks brush/rect/fill.",
    icon: Scissors,
  },
  {
    id: 'terrain',
    label: 'Terrain',
    title:
      'Paint an autotiled terrain onto the active layer (drag = paint, Alt+drag = erase). Arm a terrain in the Library first; mode below picks brush/rect/fill.',
    icon: Mountain,
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

/** How long a finger must rest on a tool before its name pops (touch has no hover). */
const LONG_PRESS_MS = 400;
/** A drag past this many px is a scroll/pan, not a hold — cancels the pending long-press. */
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

/**
 * One tool as an icon button for the compact tool bar (mobile). A tap selects the tool; a
 * press-and-hold pops a tooltip naming it — the touch stand-in for desktop hover — and the hold
 * suppresses the follow-up select so reading a tool's name never switches to it. The tooltip is
 * controlled (`open`) rather than left to Radix's hover/focus, because a coarse pointer has neither.
 */
function ToolIconButton({
  tool,
  active,
  disabled,
  onSelect,
}: {
  tool: (typeof TOOLS)[number];
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const heldRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const Icon = tool.icon;

  const clearTimer = (): void => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  };

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={tool.label}
          aria-pressed={active}
          disabled={disabled}
          className={cn(
            active ? 'bg-active text-fg-bright hover:bg-active' : 'text-fg-muted hover:bg-surface',
          )}
          onPointerDown={(e) => {
            heldRef.current = false;
            startRef.current = { x: e.clientX, y: e.clientY };
            clearTimer();
            timerRef.current = window.setTimeout(() => {
              heldRef.current = true;
              setOpen(true);
            }, LONG_PRESS_MS);
          }}
          onPointerMove={(e) => {
            const start = startRef.current;
            if (
              start &&
              Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE_PX
            ) {
              clearTimer();
            }
          }}
          onPointerUp={clearTimer}
          onPointerLeave={() => {
            clearTimer();
            setOpen(false);
          }}
          onPointerCancel={() => {
            clearTimer();
            setOpen(false);
          }}
          onClick={() => {
            // A press-and-hold popped the tooltip — consume the trailing click so the tool doesn't
            // also switch. Leave the tooltip up to read; the next tap anywhere dismisses it.
            if (heldRef.current) {
              heldRef.current = false;
              return;
            }
            setOpen(false);
            onSelect();
          }}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[240px]">
        <span className="font-medium">{tool.label}</span> — {tool.title}
      </TooltipContent>
    </Tooltip>
  );
}

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
  const brushAsset = useEditorStore((s) => s.brushAsset);
  const brushRotation = useEditorStore((s) => s.brushRotation);
  const armedObjectAsset = useEditorStore((s) => s.armedObjectAsset);
  const armedNodeRef = useEditorStore((s) => s.armedNodeRef);
  const snapToTileCenter = useEditorStore((s) => s.snapToTileCenter);
  const placeRotation = useEditorStore((s) => s.placeRotation);
  const paintMode = useEditorStore((s) => s.paintMode);
  const regionSelection = useEditorStore((s) => s.regionSelection);
  const overlays = useEditorStore((s) => s.overlays);
  const isCompact = useIsCompact();

  const [showNew, setShowNew] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
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

  // ── Reusable clusters (plan 027 Step 6) — defined once, arranged differently per breakpoint ──

  const activeToolMeta = TOOLS.find((t) => t.id === activeTool);

  /** The 12-tool strip. On compact this lives inside a horizontally-scrollable rail. */
  const toolStrip = (
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
  );

  // Tool-contextual controls (paint-mode gesture, brush rotation). Desktop keeps them inline on the
  // toolbar; on compact they move to the bottom ContextBar (plan 027 Step 9), so the compact header
  // no longer renders these two groups.
  const paintModeGroup = PAINT_MODE_TOOLS.has(activeTool) ? (
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
  ) : null;

  const rotateGroup =
    activeTool === 'brush' ? (
      <div className={groupClass} title="Rotate the tile the brush paints (R / Shift+R)">
        <Button
          variant="outline"
          size="sm"
          disabled={!brushAsset}
          title="Rotate the painted tile −90° (Shift+R)"
          onClick={() => useEditorStore.getState().rotateBrush(-90)}
        >
          ⟲ −90°
        </Button>
        <span className="w-9 text-center text-[0.85rem] text-fg-muted tabular-nums">
          {brushRotation}°
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!brushAsset}
          title="Rotate the painted tile +90° (R)"
          onClick={() => useEditorStore.getState().rotateBrush(90)}
        >
          ⟳ +90°
        </Button>
      </div>
    ) : null;

  // Place tool: a rotation wheel setting the angle stamped onto the next decor/node placed (arbitrary
  // degrees). Only shown once something is armed — an unarmed place tool has nothing to rotate.
  const placeRotateGroup =
    activeTool === 'place' && (armedObjectAsset || armedNodeRef) ? (
      <div
        className={groupClass}
        title="Rotation applied to placed objects — drag the wheel or type"
      >
        <RotationWheel
          value={placeRotation}
          onChange={(deg) => useEditorStore.getState().setPlaceRotation(deg)}
          ariaLabel="Placement rotation"
        />
      </div>
    ) : null;

  // Select tool: when a marquee region is drawn, a 4-way whole-tile nudge that moves the whole area
  // (tiles on every layer + walkability/zones/terrain + intersecting objects). Mirrors the compact
  // SelectionBar's region controls; each arrow disables at the map edge. Arrow keys do the same.
  const regionNudgeGroup =
    activeTool === 'select' && regionSelection && map ? (
      <div className={groupClass} title="Move the selected area a tile at a time (arrow keys)">
        <Button
          variant="outline"
          size="sm"
          aria-label="Move region left"
          disabled={!regionMoveInBounds(regionSelection, -1, 0, map.meta.width, map.meta.height)}
          onClick={() => useEditorStore.getState().translateRegion(-1, 0)}
        >
          <ArrowLeft />
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Move region up"
          disabled={!regionMoveInBounds(regionSelection, 0, -1, map.meta.width, map.meta.height)}
          onClick={() => useEditorStore.getState().translateRegion(0, -1)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Move region down"
          disabled={!regionMoveInBounds(regionSelection, 0, 1, map.meta.width, map.meta.height)}
          onClick={() => useEditorStore.getState().translateRegion(0, 1)}
        >
          <ArrowDown />
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Move region right"
          disabled={!regionMoveInBounds(regionSelection, 1, 0, map.meta.width, map.meta.height)}
          onClick={() => useEditorStore.getState().translateRegion(1, 0)}
        >
          <ArrowRight />
        </Button>
        <span className="px-1 text-[0.8rem] text-fg-muted tabular-nums">
          {regionSelection.w}×{regionSelection.h}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label="Clear region selection"
          title="Clear the selected area"
          onClick={() => useEditorStore.getState().setRegionSelection(null)}
        >
          <X />
        </Button>
      </div>
    ) : null;

  /** Overflow "⋯" menu — the least-used View controls (overlay toggles + Snap), plus Keys on
   *  compact where the standalone Keys button is dropped. Overlay/Snap items `preventDefault` on
   *  select so the menu stays open while toggling several. */
  const overflowMenu = (includeKeys: boolean) => (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" aria-label="View & display options">
              <SlidersHorizontal />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>View & display options</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Overlays</DropdownMenuLabel>
        {OVERLAYS.map((overlay) => (
          <DropdownMenuCheckboxItem
            key={overlay.id}
            checked={overlays[overlay.id]}
            title={overlay.title}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => useEditorStore.getState().toggleOverlay(overlay.id)}
          >
            {overlay.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={snapToTileCenter}
          title="Snap decor placement/drag to tile centres (hold Alt for free pixels). Nodes/portals are always tile-snapped."
          onSelect={(e) => e.preventDefault()}
          onCheckedChange={() => useEditorStore.getState().setSnapToTileCenter(!snapToTileCenter)}
        >
          Snap to tile centre
        </DropdownMenuCheckboxItem>
        {includeKeys && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setShowShortcuts(true)}>
              ⌨ Keyboard & mouse shortcuts
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const undoRedoGroup = (
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
  );

  const dialogs = (
    <>
      {showNew && <NewMapDialog onCreate={handleCreate} onCancel={() => setShowNew(false)} />}
      {showEdit && <EditMapDialog onCancel={() => setShowEdit(false)} />}
      {showOpen && (
        <OpenMapDialog onOpen={(id) => void handleOpen(id)} onCancel={() => setShowOpen(false)} />
      )}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </>
  );

  // ── Compact (phone/tablet) shell: File collapses to a menu; the tool strip drops off the top row
  //    entirely and becomes its own full-width icon bar underneath (below), so the tools are no
  //    longer crammed into a tiny scrollable box; the View checkboxes + Keys button fold into the
  //    overflow menu. ──
  if (isCompact) {
    return (
      <>
        <header className="flex items-center gap-2 border-b border-surface bg-raised px-2 py-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="shrink-0">
                File
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => setShowNew(true)}>New…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowOpen(true)}>Open…</DropdownMenuItem>
              <DropdownMenuItem disabled={!map || saving} onSelect={() => void handleSave()}>
                Save
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!map} onSelect={() => setShowEdit(true)}>
                Edit map…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {undoRedoGroup}

          {/* Active-tool name — the icon bar below highlights it, this spells it out. */}
          <span className="shrink-0 text-[0.8rem] font-medium text-fg-bright">
            {activeToolMeta?.label ?? '—'}
          </span>

          {/* Map name + dirty dot, pushed to the right (truncated to fit). */}
          <span className="ml-auto flex shrink items-center gap-1 overflow-hidden text-[0.8rem]">
            {map ? (
              <>
                <span className="truncate text-fg-muted">{map.meta.name}</span>
                {dirty && <span className="shrink-0 text-gold">●</span>}
              </>
            ) : (
              <span className="text-muted-2">No map</span>
            )}
          </span>

          {overflowMenu(true)}
        </header>

        {/* Second bar (plan: mobile toolbar): the full tool set as icon buttons on their own
            full-width row. Tap to select; press-and-hold pops the tool's name (touch has no hover).
            Wraps to as many rows as needed so every tool is reachable without a scroll. The
            tool-contextual controls (paint-mode gesture, brush rotation) live in the bottom
            ContextBar on compact (plan 027 Step 9), not here. */}
        <div className="flex flex-wrap items-center gap-1 border-b border-surface bg-raised px-2 py-1.5">
          {TOOLS.map((tool) => (
            <ToolIconButton
              key={tool.id}
              tool={tool}
              active={activeTool === tool.id}
              disabled={!map || (tool.id === 'place' && !armedObjectAsset && !armedNodeRef)}
              onSelect={() => useEditorStore.getState().setActiveTool(tool.id)}
            />
          ))}
        </div>

        {dialogs}
      </>
    );
  }

  // ── Desktop shell: grouped clusters on one tightened row; the View checkboxes move into the "⋯"
  //    overflow menu (declutter), Keys stays a discrete button. ──
  return (
    // The shadcn Tooltips on the sparse chrome controls (Undo/Redo, Keys, the dirty dot) are powered
    // by the single TooltipProvider mounted at the EditorApp root (plan 020 Step 5). The paint-tool
    // strip keeps native `title`s instead — it's a repeated list, not discrete chrome.
    <header className="flex items-center gap-3 border-b border-surface bg-raised px-3 py-1.5">
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
        <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)} disabled={!map}>
          Edit
        </Button>
      </div>

      {undoRedoGroup}

      {toolStrip}
      {paintModeGroup}
      {rotateGroup}
      {placeRotateGroup}
      {regionNudgeGroup}

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

      {overflowMenu(false)}

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

      {dialogs}
    </header>
  );
}
