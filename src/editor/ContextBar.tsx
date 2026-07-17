import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BringToFront,
  CopyPlus,
  Eraser,
  Eye,
  EyeOff,
  LibraryBig,
  Palette,
  Pipette,
  Redo2,
  RotateCcw,
  RotateCw,
  SendToBack,
  SlidersHorizontal,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { TILE_SIZE } from '../config';
import { cn } from './lib/utils';
import { useEditorStore, type EditorTool, type PaintMode } from './store/editorStore';
import { Button } from './ui/button';
import { PanelBarButton } from './ui/PanelBarButton';
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
      <PanelBarButton side="left" icon={<LibraryBig />} label="Library" onClick={onOpenLibrary} />

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

            {/* Place: rotation wheel for the next placed decor/node (arbitrary angle). */}
            {activeTool === 'place' && (armedObjectAsset || armedNodeRef) && (
              <RotationWheel
                value={placeRotation}
                onChange={(deg) => st().setPlaceRotation(deg)}
                size={44}
                ariaLabel="Placement rotation"
              />
            )}

            {/* Select: multi-select toggle. The delete / nudge / rotate / depth actions live in the
                SelectionBar (the second bottom bar), shown above this one whenever anything is selected. */}
            {activeTool === 'select' && (
              <ToggleButton
                active={multiSelectActive}
                title="Add to the selection instead of replacing it (same as holding Shift)"
                onClick={() => st().setMultiSelectActive(!multiSelectActive)}
              >
                <CopyPlus />
                Multi
              </ToggleButton>
            )}
          </div>

          {/* Persistent-when-relevant: zoom out/in + underlay visibility + selected-node skin-cycle. */}
          <div className={cn(groupClass, 'shrink-0')}>
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="Zoom out"
              title="Zoom out"
              onClick={() => st().zoomViewport?.(-1)}
            >
              <ZoomOut />
            </Button>
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="Zoom in"
              title="Zoom in"
              onClick={() => st().zoomViewport?.(1)}
            >
              <ZoomIn />
            </Button>
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
      <PanelBarButton
        side="right"
        icon={<SlidersHorizontal />}
        label="Inspector"
        onClick={onOpenInspector}
      />
    </div>
  );
}

/**
 * Selection operations bar — the SECOND compact bottom bar, stacked directly above the {@link ContextBar}
 * and shown ONLY while one or more objects are selected on the Map tab. It surfaces the most-reached
 * per-object edits (nudge, rotate, restack, delete) on-screen so a phone user can move/rotate/delete a
 * selection without bouncing into the Inspector drawer — the awkward map↔inspector round-trip this bar
 * exists to kill. Compact-only, like the ContextBar (EditorApp mounts both only in the `isCompact` branch).
 *
 * Enablement mirrors the Inspector's batch buttons: rotate is decor-only (`rotateObjects` skips nodes/
 * portals), restack (bring forward / send back) applies to decor + nodes (`bumpDepth`), and nudge/delete
 * work on any selection. Rotate is a SINGLE button that cycles +90° per tap (the phone doesn't want the
 * desktop's ∓90° pair).
 */
export function SelectionBar() {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const map = useEditorStore((s) => s.map);
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  // `map` is mutated in place by store commands (see InspectorPanel's re-render note) — subscribe to the
  // revision counters so kind-derived enablement (rotate/restack) refreshes after an edit, not just a
  // selection change.
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);

  const st = useEditorStore.getState;

  // Nothing selected (or not on the Map tab) → the whole bar collapses, yielding its row back to the map.
  if (activeTabId !== 'map' || !map || selectedObjectIds.length === 0) return null;

  const selected = map.objects.filter((o) => selectedObjectIds.includes(o.id));
  const hasDecor = selected.some((o) => o.kind === 'decor');
  const canRestack = selected.some((o) => o.kind === 'decor' || o.kind === 'node');
  const ids = selectedObjectIds;

  return (
    // Sits above the ContextBar (which owns the bottom safe-area inset), so no bottom inset padding here.
    <div className="flex items-center gap-1.5 overflow-x-auto border-t border-surface bg-raised/95 px-2 py-1.5 backdrop-blur">
      {/* 4-way tile-step nudge (mirrors the Shift+arrow keyboard nudge). */}
      <div className={groupClass}>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Nudge left"
          title="Nudge one tile left (Shift+←)"
          onClick={() => nudge(-1, 0)}
        >
          <ArrowLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Nudge up"
          title="Nudge one tile up (Shift+↑)"
          onClick={() => nudge(0, -1)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Nudge down"
          title="Nudge one tile down (Shift+↓)"
          onClick={() => nudge(0, 1)}
        >
          <ArrowDown />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Nudge right"
          title="Nudge one tile right (Shift+→)"
          onClick={() => nudge(1, 0)}
        >
          <ArrowRight />
        </Button>
      </div>

      {/* Rotate — one button cycling +90° per tap (decor only). */}
      <Button
        variant="outline"
        size="icon-lg"
        aria-label="Rotate 90°"
        title="Rotate the selected decor 90°"
        disabled={!hasDecor}
        onClick={() => st().rotateObjects(ids, 90)}
      >
        <RotateCw />
      </Button>

      {/* Restack — bring forward / send back (decor via depth, nodes via depth-bias). */}
      <div className={groupClass}>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Bring forward"
          title="Bring forward (stack on top)"
          disabled={!canRestack}
          onClick={() => st().bumpDepth(ids, 1)}
        >
          <BringToFront />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Send back"
          title="Send back (stack underneath)"
          disabled={!canRestack}
          onClick={() => st().bumpDepth(ids, -1)}
        >
          <SendToBack />
        </Button>
      </div>

      {/* Delete the selection (moved off the ContextBar). Pushed to the far end. */}
      <Button
        variant="outline"
        size="icon-lg"
        aria-label="Delete selection"
        title="Delete the selected object(s) (Delete)"
        className="ml-auto"
        onClick={() => st().deleteObjects(ids)}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
