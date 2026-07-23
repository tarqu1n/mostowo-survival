import { useState, type ReactNode } from 'react';
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
  RotateCcw,
  RotateCw,
  SendToBack,
  SlidersHorizontal,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { TILE_SIZE } from '../config';
import { cn } from './lib/utils';
import { useEditorStore, type EditorTool, type PaintMode } from './store/editorStore';
import { regionMoveInBounds } from './regionOps';
import { Button } from './ui/button';
import { PanelBarButton } from './ui/PanelBarButton';
import { QuickLayerSelect } from './ui/QuickLayerSelect';
import { RotationWheel } from './ui/RotationWheel';

/**
 * Per-tool context bar (plan 027 Step 9) — a compact action bar anchored to the bottom edge of the
 * full-bleed viewport for thumb reach in phone portrait. It gives touch users an on-screen equivalent
 * of the editor's whole keyboard vocabulary (rotate, erase/free-pixel/multi-select modifiers, delete,
 * nudge, underlay toggle, skin-cycle), so the map is fully editable without a keyboard. Undo/redo are
 * NOT here — they live as icon buttons in the top toolbar, freeing this bar's width for tool actions.
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

/** Nudge the current selection one step in `(dx,dy)`, mirroring the keyboard arrow nudge. `fine` picks
 *  the step the way Shift does on the keyboard: `false` = one whole tile (works for every object kind —
 *  decor via px, node/portal via tile steps); `true` = 1px, a decor-only sub-tile refinement (nodes/
 *  portals are tile-addressed, so a 1px delta leaves them put — same as plain-arrow on the keyboard).
 *  Exposed on the touch SelectionBar via a step toggle so a phone gets both, not just whole tiles. */
function nudge(dx: number, dy: number, fine: boolean): void {
  const ids = useEditorStore.getState().selectedObjectIds;
  if (ids.length === 0) return;
  const step = fine ? 1 : TILE_SIZE;
  useEditorStore.getState().translateObjects(ids, {
    dxPx: dx * step,
    dyPx: dy * step,
    dCol: fine ? 0 : dx,
    dRow: fine ? 0 : dy,
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
          {/* Undo/redo live in the top toolbar (icon buttons) — kept off this bar to free thumb-height
              width for the tool-contextual controls. */}
          {/* Tool-contextual actions — scrolls horizontally if the row can't fit in portrait. */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {/* Brush: pick the active tile layer, then rotate the painted tile (R / Shift+R). The
                quick layer selector sits with the tiling controls since it targets the TILE layer the
                brush paints onto. */}
            {activeTool === 'brush' && (
              <div className={groupClass}>
                <QuickLayerSelect />
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
  const activeTool = useEditorStore((s) => s.activeTool);
  const regionSelection = useEditorStore((s) => s.regionSelection);
  // `map` is mutated in place by store commands (see InspectorPanel's re-render note) — subscribe to the
  // revision counters so kind-derived enablement (rotate/restack) refreshes after an edit, not just a
  // selection change.
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);
  // Sticky nudge step for the on-screen arrows: whole-tile by default, or 1px for fine positioning
  // (the phone equivalent of plain-arrow vs Shift+arrow on the keyboard). Held here rather than in the
  // store because it's a touch-bar-local preference; the bar stays mounted across selection changes
  // (it returns null when nothing's selected), so the choice persists between selections.
  const [fineNudge, setFineNudge] = useState(false);

  const st = useEditorStore.getState;

  // Off the Map tab (or no map) → the whole bar collapses, yielding its row back to the map.
  if (activeTabId !== 'map' || !map) return null;

  // Region select & move: a marquee box is drawn → surface a 4-way WHOLE-TILE nudge that moves the
  // whole group (tiles on every layer + walkability/zones/terrain + intersecting objects). Mutually
  // exclusive with an object selection (drawing a box clears the object selection). Each arrow is
  // disabled at the map edge (the store also refuses that move); a nudge onto void just no-ops.
  const region = activeTool === 'select' ? regionSelection : null;
  if (region) {
    const { width, height } = map.meta;
    const canMove = (dx: number, dy: number): boolean =>
      regionMoveInBounds(region, dx, dy, width, height);
    return (
      <div className="flex items-center gap-1.5 overflow-x-auto border-t border-surface bg-raised/95 px-2 py-1.5 backdrop-blur">
        <div className={groupClass}>
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Move region left"
            title="Move the selected area one tile left (←)"
            disabled={!canMove(-1, 0)}
            onClick={() => st().translateRegion(-1, 0)}
          >
            <ArrowLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Move region up"
            title="Move the selected area one tile up (↑)"
            disabled={!canMove(0, -1)}
            onClick={() => st().translateRegion(0, -1)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Move region down"
            title="Move the selected area one tile down (↓)"
            disabled={!canMove(0, 1)}
            onClick={() => st().translateRegion(0, 1)}
          >
            <ArrowDown />
          </Button>
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Move region right"
            title="Move the selected area one tile right (→)"
            disabled={!canMove(1, 0)}
            onClick={() => st().translateRegion(1, 0)}
          >
            <ArrowRight />
          </Button>
        </div>
        <span className="text-[0.8rem] text-fg-muted tabular-nums">
          {region.w}×{region.h} tiles
        </span>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Clear region selection"
          title="Clear the selected area"
          className="ml-auto"
          onClick={() => st().setRegionSelection(null)}
        >
          <X />
        </Button>
      </div>
    );
  }

  // Otherwise fall back to the per-object selection bar — hidden when nothing's selected.
  if (selectedObjectIds.length === 0) return null;

  const selected = map.objects.filter((o) => selectedObjectIds.includes(o.id));
  const hasDecor = selected.some((o) => o.kind === 'decor');
  const canRestack = selected.some((o) => o.kind === 'decor' || o.kind === 'node');
  const ids = selectedObjectIds;
  // 1px is a decor-only refinement — nodes/portals are tile-addressed and can't sub-tile, so keep the
  // step whole for a selection with no decor (the toggle disables itself in that case too).
  const fine = fineNudge && hasDecor;
  const stepWord = fine ? 'pixel' : 'tile';

  return (
    // Sits above the ContextBar (which owns the bottom safe-area inset), so no bottom inset padding here.
    <div className="flex items-center gap-1.5 overflow-x-auto border-t border-surface bg-raised/95 px-2 py-1.5 backdrop-blur">
      {/* 4-way nudge (mirrors the arrow-key nudge) + a step toggle so touch gets BOTH the whole-tile
          snap and 1px fine positioning (the phone stand-in for plain-arrow vs Shift+arrow). The step
          toggle is a DECOR-only refinement — nodes/portals are tile-addressed (col/row, no sub-tile
          position), so for a selection with no decor it's hidden entirely rather than shown disabled:
          a greyed control stuck on "1 tile" reads as a broken picker (phone feedback). The arrows
          then just move whole tiles, the only meaningful step for that selection. */}
      <div className={groupClass}>
        {hasDecor && (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Nudge step: 1 ${stepWord}`}
            aria-pressed={fine}
            title={`Nudge step — tap to switch (now 1 ${stepWord})`}
            className={cn(
              'w-14 shrink-0 font-normal tabular-nums',
              fine && 'bg-active text-fg-bright hover:bg-active',
            )}
            onClick={() => setFineNudge((v) => !v)}
          >
            {fine ? '1 px' : '1 tile'}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Nudge left"
          title={`Nudge one ${stepWord} left (←)`}
          onClick={() => nudge(-1, 0, fine)}
        >
          <ArrowLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Nudge up"
          title={`Nudge one ${stepWord} up (↑)`}
          onClick={() => nudge(0, -1, fine)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Nudge down"
          title={`Nudge one ${stepWord} down (↓)`}
          onClick={() => nudge(0, 1, fine)}
        >
          <ArrowDown />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Nudge right"
          title={`Nudge one ${stepWord} right (→)`}
          onClick={() => nudge(1, 0, fine)}
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
