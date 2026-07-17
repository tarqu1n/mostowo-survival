import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CopyPlus,
  Eraser,
  Eye,
  EyeOff,
  LibraryBig,
  Move,
  Palette,
  Pipette,
  Redo2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from 'lucide-react';
import { TILE_SIZE } from '../config';
import { cn } from './lib/utils';
import { useEditorStore, type EditorTool, type PaintMode } from './store/editorStore';
import { Button } from './ui/button';
import { RotationWheel } from './ui/RotationWheel';

/**
 * Per-tool context bar (plan 027 Step 9) — a compact action bar anchored to the bottom edge of the
 * full-bleed viewport for thumb reach in phone portrait. It gives touch users an on-screen equivalent
 * of the editor's whole keyboard vocabulary (rotate, erase/free-pixel/multi-select modifiers, delete,
 * nudge, underlay toggle, skin-cycle, undo/redo), so the map is fully editable without a keyboard.
 *
 * It is rendered ONLY in the compact shell (EditorApp mounts it only in the `isCompact` branch), so
 * desktop keeps its keyboard modifiers and toolbar-hosted rotate/paint-mode controls unchanged — the
 * sticky modifier toggles below stay touch-only, exactly as plan 027 Step 9 requires.
 *
 * The erase/free-pixel/multi-select toggles write the STICKY store flags from Step 2
 * (`eraseActive`/`freePixelActive`/`multiSelectActive`), which `EditorScene` OR's with the momentary
 * physical Alt/Shift — so tapping a toggle here can never be wiped by a later keyup/blur.
 */

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

/** Per-tool wording for the erase/invert toggle — the four target-grid tools each mean something
 *  different by "the Alt action" (see the tool tooltips in Toolbar.tsx), but all route through the one
 *  `eraseActive` sticky flag. */
const ERASE_META: Record<string, { label: string; title: string }> = {
  collision: {
    label: 'Walkable',
    title: 'Paint walkable instead of blocked (same as holding Alt)',
  },
  zone: { label: 'Clear', title: 'Clear the zone instead of assigning it (same as holding Alt)' },
  shape: {
    label: 'Restore',
    title: 'Restore cells to inside instead of voiding (same as holding Alt)',
  },
  terrain: {
    label: 'Erase',
    title: 'Erase the terrain instead of painting it (same as holding Alt)',
  },
};

const groupClass = 'flex items-center gap-1.5';

/** A stateful (pressed = active) toggle button matching the toolbar's active-control look. */
function ToggleButton({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="outline"
      size="lg"
      aria-pressed={active}
      title={title}
      className={cn('font-normal', active && 'bg-active text-fg-bright hover:bg-active')}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** Nudge the current selection by one whole tile (works for every object kind — decor via px, node/
 *  portal via tile steps), mirroring the Shift+arrow keyboard nudge. Sub-tile (1px) nudge stays a
 *  keyboard-only refinement — a phone thumb doesn't want pixel precision. */
function nudge(dx: number, dy: number): void {
  const ids = useEditorStore.getState().selectedObjectIds;
  if (ids.length === 0) return;
  useEditorStore.getState().translateObjects(ids, {
    dxPx: dx * TILE_SIZE,
    dyPx: dy * TILE_SIZE,
    dCol: dx,
    dRow: dy,
  });
}

/** Large, labelled panel toggle for the far edges of the bar — the phone-thumb entry point to the
 *  Library (far left) and Inspector (far right) drawers. Bigger than the tool buttons and always
 *  present, so the panels are reachable on every tab, not just Map. */
function PanelButton({
  side,
  icon,
  label,
  onClick,
}: {
  side: 'left' | 'right';
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      size="lg"
      aria-label={`Open ${label}`}
      title={`Open ${label}`}
      onClick={onClick}
      className={cn(
        'h-12 shrink-0 flex-col gap-0.5 px-3 text-[0.7rem] font-normal',
        side === 'left' ? 'mr-auto' : 'ml-auto',
        "[&_svg:not([class*='size-'])]:size-6",
      )}
    >
      {icon}
      {label}
    </Button>
  );
}

export function ContextBar({
  onOpenLibrary,
  onOpenInspector,
}: {
  onOpenLibrary: () => void;
  onOpenInspector: () => void;
}) {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const map = useEditorStore((s) => s.map);
  const activeTool = useEditorStore((s) => s.activeTool);
  const brushAsset = useEditorStore((s) => s.brushAsset);
  const brushRotation = useEditorStore((s) => s.brushRotation);
  const paintMode = useEditorStore((s) => s.paintMode);
  const armedObjectAsset = useEditorStore((s) => s.armedObjectAsset);
  const armedNodeRef = useEditorStore((s) => s.armedNodeRef);
  const placeRotation = useEditorStore((s) => s.placeRotation);
  const eraseActive = useEditorStore((s) => s.eraseActive);
  const freePixelActive = useEditorStore((s) => s.freePixelActive);
  const multiSelectActive = useEditorStore((s) => s.multiSelectActive);
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  const underlay = useEditorStore((s) => s.underlay);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);

  const st = useEditorStore.getState;
  // The tool actions are a Map-tab surface (World has its own controls; object-editor tabs have
  // none). The Library / Inspector edge buttons, though, live on every tab — so the bar frame always
  // renders and only the middle tool cluster is gated to the Map tab.
  const showTools = activeTabId === 'map' && !!map;
  const hasSelection = selectedObjectIds.length > 0;
  // A single selected node exposes the skin-cycle action (the 'S' shortcut).
  const singleNode =
    map && selectedObjectIds.length === 1
      ? map.objects.find((o) => o.id === selectedObjectIds[0] && o.kind === 'node')
      : undefined;
  const erase = showTools && PAINT_MODE_TOOLS.has(activeTool) ? ERASE_META[activeTool] : undefined;

  return (
    <div
      // Anchored to the bottom edge (EditorApp positions this absolutely over the viewport). The
      // safe-area padding keeps the row clear of the portrait home indicator (viewport-fit=cover).
      className="flex items-center gap-2 border-t border-surface bg-raised/95 px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur"
    >
      {/* Library — far left, the phone entry point to the asset drawer (was a floating edge handle). */}
      <PanelButton side="left" icon={<LibraryBig />} label="Library" onClick={onOpenLibrary} />

      {showTools && (
        <>
          {/* Persistent undo/redo — always reachable at thumb height. */}
          <div className={cn(groupClass, 'shrink-0')}>
            <Button
              variant="secondary"
              size="icon-lg"
              aria-label="Undo"
              title="Undo (Ctrl/Cmd+Z)"
              disabled={!canUndo}
              onClick={() => st().undo()}
            >
              <Undo2 />
            </Button>
            <Button
              variant="secondary"
              size="icon-lg"
              aria-label="Redo"
              title="Redo (Shift+Ctrl/Cmd+Z)"
              disabled={!canRedo}
              onClick={() => st().redo()}
            >
              <Redo2 />
            </Button>
          </div>

          {/* Tool-contextual actions — scrolls horizontally if the row can't fit in portrait. */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {/* Brush: rotate the painted tile (R / Shift+R). */}
            {activeTool === 'brush' && (
              <div className={groupClass}>
                <Button
                  variant="outline"
                  size="icon-lg"
                  aria-label="Rotate tile −90°"
                  title="Rotate the painted tile −90° (Shift+R)"
                  disabled={!brushAsset}
                  onClick={() => st().rotateBrush(-90)}
                >
                  <RotateCcw />
                </Button>
                <span className="w-9 text-center text-[0.85rem] text-fg-muted tabular-nums">
                  {brushRotation}°
                </span>
                <Button
                  variant="outline"
                  size="icon-lg"
                  aria-label="Rotate tile +90°"
                  title="Rotate the painted tile +90° (R)"
                  disabled={!brushAsset}
                  onClick={() => st().rotateBrush(90)}
                >
                  <RotateCw />
                </Button>
              </div>
            )}

            {/* Eyedropper: no modifiers — just a tap samples. A hint stands in for the missing tooltip. */}
            {activeTool === 'eyedropper' && (
              <span className="flex items-center gap-1.5 text-[0.8rem] text-fg-muted">
                <Pipette className="size-4 shrink-0" />
                Tap a tile or object to pick it
              </span>
            )}

            {/* Collision / Zone / Shape / Terrain: gesture (brush/rect/fill) + the erase/invert toggle. */}
            {PAINT_MODE_TOOLS.has(activeTool) && (
              <>
                <div className={groupClass} title="Gesture for this tool">
                  {PAINT_MODES.map((mode) => (
                    <ToggleButton
                      key={mode.id}
                      active={paintMode === mode.id}
                      title={`${mode.label} gesture`}
                      onClick={() => st().setPaintMode(mode.id)}
                    >
                      {mode.label}
                    </ToggleButton>
                  ))}
                </div>
                {erase && (
                  <ToggleButton
                    active={eraseActive}
                    title={erase.title}
                    onClick={() => st().setEraseActive(!eraseActive)}
                  >
                    <Eraser />
                    {erase.label}
                  </ToggleButton>
                )}
              </>
            )}

            {/* Place / Select: free-pixel placement toggle (decor only — same as holding Alt). */}
            {(activeTool === 'place' || activeTool === 'select') && (
              <ToggleButton
                active={freePixelActive}
                title="Place/drag decor at free pixels instead of snapping to tile centre (same as holding Alt). Nodes/portals are always tile-snapped."
                onClick={() => st().setFreePixelActive(!freePixelActive)}
              >
                <Move />
                Free px
              </ToggleButton>
            )}

            {/* Place: rotation wheel for the next placed decor/node (arbitrary angle). */}
            {activeTool === 'place' && (armedObjectAsset || armedNodeRef) && (
              <RotationWheel
                value={placeRotation}
                onChange={(deg) => st().setPlaceRotation(deg)}
                size={44}
                ariaLabel="Placement rotation"
              />
            )}

            {/* Select: multi-select toggle + Delete + tile-step nudge. */}
            {activeTool === 'select' && (
              <>
                <ToggleButton
                  active={multiSelectActive}
                  title="Add to the selection instead of replacing it (same as holding Shift)"
                  onClick={() => st().setMultiSelectActive(!multiSelectActive)}
                >
                  <CopyPlus />
                  Multi
                </ToggleButton>
                <Button
                  variant="outline"
                  size="lg"
                  disabled={!hasSelection}
                  title="Delete the selected object(s) (Delete)"
                  onClick={() => hasSelection && st().deleteObjects(selectedObjectIds)}
                >
                  <Trash2 />
                  Delete
                </Button>
                <div className={groupClass}>
                  <Button
                    variant="outline"
                    size="icon-lg"
                    aria-label="Nudge left"
                    title="Nudge one tile left (Shift+←)"
                    disabled={!hasSelection}
                    onClick={() => nudge(-1, 0)}
                  >
                    <ArrowLeft />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-lg"
                    aria-label="Nudge up"
                    title="Nudge one tile up (Shift+↑)"
                    disabled={!hasSelection}
                    onClick={() => nudge(0, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-lg"
                    aria-label="Nudge down"
                    title="Nudge one tile down (Shift+↓)"
                    disabled={!hasSelection}
                    onClick={() => nudge(0, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-lg"
                    aria-label="Nudge right"
                    title="Nudge one tile right (Shift+→)"
                    disabled={!hasSelection}
                    onClick={() => nudge(1, 0)}
                  >
                    <ArrowRight />
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Persistent-when-relevant: underlay visibility + selected-node skin-cycle. */}
          <div className={cn(groupClass, 'shrink-0')}>
            {underlay && (
              <Button
                variant="outline"
                size="icon-lg"
                aria-label={
                  underlay.visible ? 'Hide reference underlay' : 'Show reference underlay'
                }
                title="Toggle the reference underlay (U)"
                onClick={() => st().toggleUnderlayVisible()}
              >
                {underlay.visible ? <Eye /> : <EyeOff />}
              </Button>
            )}
            {singleNode && (
              <Button
                variant="outline"
                size="icon-lg"
                aria-label="Cycle node skin"
                title="Cycle the selected node's skin (S)"
                onClick={() => st().cycleNodeSkin(singleNode.id)}
              >
                <Palette />
              </Button>
            )}
          </div>
        </>
      )}

      {/* Inspector — far right, the phone entry point to the properties/layers drawer. */}
      <PanelButton
        side="right"
        icon={<SlidersHorizontal />}
        label="Inspector"
        onClick={onOpenInspector}
      />
    </div>
  );
}
