import { useEffect, useState } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
import { LibraryBig, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { TILE_SIZE } from '../config';
import { cn } from './lib/utils';
import { useIsCompact } from './hooks/useIsCompact';
import { useEditorStore } from './store/editorStore';
import { loadCatalog } from './catalogSource';
import { loadTerrainCatalog } from './terrainCatalogSource';
import { loadNodeDefs } from './nodeDefsSource';
import { loadPalettes, installPaletteAutosave } from './palettesSource';
import { Toolbar } from './Toolbar';
import { ContextBar, SelectionBar } from './ContextBar';
import { PhaserViewport } from './PhaserViewport';
import { ObjectEditorTab } from './tabs/ObjectEditorTab';
import { WorldViewTab } from './tabs/WorldViewTab';
import { NodeTypesTab } from './tabs/NodeTypesTab';
import { LibraryPanel, PalettePickControls } from './panels/LibraryPanel';
import { PaletteStrip } from './panels/PaletteStrip';
import { QuickLayerSelect } from './ui/QuickLayerSelect';
import { LayersPanel } from './panels/LayersPanel';
import { ZonesPanel } from './panels/ZonesPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { ReferencePanel } from './panels/ReferencePanel';
import { PortalDialog } from './PortalDialog';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';
import { PanelBarButton } from './ui/PanelBarButton';
import { Toaster } from './ui/sonner';
import { TooltipProvider } from './ui/tooltip';

/**
 * Map Builder shell (plan 014 step 5, extended steps 6-7): toolbar on top, then a three-pane body —
 * Library (left), the tabbed central pane (centre), Inspector + Layers (right). The Library↔centre
 * split is a shadcn `Resizable` group whose layout persists via its `autoSaveId` (plan 020 Step 5);
 * the Inspector stays a fixed-width column. The central pane is a tab strip over a panel area (plan
 * 017 step 2): the permanent Map + World tabs plus an object-editor tab per Library ⚙ click. Every
 * tab's panel is mounted at once and shown/hidden by `visibility` (never `display:none`) so the
 * Phaser map canvas — expensive, stateful, `Scale.RESIZE` — survives every switch instead of being
 * torn down and rebuilt. Everything shares state through `useEditorStore`; this component wires the
 * panes, the tab strip, the global undo/redo + delete shortcuts (gated to the Map tab), and the
 * Portal-tool's name/facing dialog. One `TooltipProvider` here powers every editor Tooltip; one
 * Sonner `Toaster` renders all toasts.
 */

/** Arrow key → unit direction (screen space: up = -y). Drives the selected-object nudge below. */
const NUDGE_DIRS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * The central tabbed pane (Map / World / Node Types / object-editor tabs) holding the single
 * `Phaser.Game` (plan 027 Step 8: extracted so BOTH the desktop resizable shell and the compact
 * full-bleed shell render the *same* subtree). Every tab panel is mounted at once, `absolute inset-0`,
 * hidden with `invisible pointer-events-none` (never `display:none`) so the Scale.RESIZE Phaser canvas
 * survives every tab switch. Switching breakpoint remounts this (rare, and lossless — map/camera state
 * lives in the store and the scene reloads on create).
 */
function CenterPane() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const map = useEditorStore((s) => s.map);

  return (
    <main className="flex h-full flex-col overflow-hidden bg-inset">
      <div
        className="flex flex-none items-stretch gap-0.5 overflow-x-auto border-b border-surface bg-raised px-1.5 pt-1"
        role="tablist"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const closable = tab.kind === 'object';
          const label =
            tab.kind === 'map'
              ? 'Map'
              : tab.kind === 'world'
                ? 'World'
                : tab.kind === 'nodeTypes'
                  ? 'Node Types'
                  : (tab.assetId.split('/').pop() ?? tab.assetId);
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={cn(
                'flex max-w-[200px] flex-none cursor-pointer items-center gap-1.5 rounded-t-[5px] border border-b-0 px-2.5 py-1 text-[0.8rem]',
                isActive
                  ? 'border-border bg-inset text-fg-bright'
                  : 'border-surface bg-surface-subtle text-fg-dim hover:bg-surface hover:text-fg-muted',
              )}
              title={tab.kind === 'object' ? tab.assetId : label}
              onClick={() => useEditorStore.getState().activateTab(tab.id)}
              // Middle-click closes an object tab (a common tab-strip convention). onAuxClick
              // fires for non-primary buttons; guard on button === 1 (middle).
              onAuxClick={(e) => {
                if (closable && e.button === 1) {
                  e.preventDefault();
                  useEditorStore.getState().closeTab(tab.id);
                }
              }}
            >
              <span className="truncate">{label}</span>
              {closable && (
                <span
                  className="inline-flex size-4 flex-none cursor-pointer items-center justify-center rounded-[3px] text-[0.7rem] leading-none text-muted-2 hover:bg-danger-bg hover:text-danger-fg"
                  role="button"
                  aria-label="Close tab"
                  title="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    useEditorStore.getState().closeTab(tab.id);
                  }}
                >
                  ✕
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* Every tab's panel is mounted at once, absolutely filling the panel area; only the active one
          is visible. Inactive panels are hidden with `invisible` (visibility:hidden), NEVER
          `hidden`/display:none — display:none would collapse the Scale.RESIZE Phaser canvas to 0×0. */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const hidden = tab.id !== activeTabId;
          const panelClass = cn('absolute inset-0', hidden && 'invisible pointer-events-none');
          if (tab.kind === 'map') {
            return (
              <div
                key={tab.id}
                className={panelClass}
                // Drag-drop an image onto the Map viewport → reference underlay (plan 022, desktop
                // convenience). onDragOver must preventDefault for onDrop to fire; only image files
                // route through, and the store no-ops if no map is open.
                onDragOver={(e) => {
                  if (Array.from(e.dataTransfer.types).includes('Files')) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }
                }}
                onDrop={(e) => {
                  const file = Array.from(e.dataTransfer.files).find((f) =>
                    f.type.startsWith('image/'),
                  );
                  if (file) {
                    e.preventDefault();
                    void useEditorStore.getState().setUnderlayImageFromFile(file);
                  }
                }}
              >
                <PhaserViewport />
                {!map && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[0.95rem] text-border-muted">
                    New or Open a map to begin.
                  </div>
                )}
              </div>
            );
          }
          if (tab.kind === 'world') {
            return (
              <div key={tab.id} className={panelClass}>
                <WorldViewTab />
              </div>
            );
          }
          if (tab.kind === 'nodeTypes') {
            return (
              <div key={tab.id} className={panelClass}>
                <NodeTypesTab />
              </div>
            );
          }
          return (
            <div key={tab.id} className={panelClass}>
              <ObjectEditorTab assetId={tab.assetId} />
            </div>
          );
        })}
      </div>
    </main>
  );
}

/**
 * The consolidated right-column panels (plan 027 Step 7) — Inspector / Layers / Zones / Reference as
 * one tabbed container. Extracted (Step 8) so it can be docked in the desktop aside OR hosted inside a
 * compact slide-in Sheet. All four `forceMount` + `data-[state=inactive]:hidden` so each panel's local
 * state survives tab switches. `className` lets the host tune height/padding (docked vs. drawer).
 */
function InspectorTabs({ className }: { className?: string }) {
  return (
    <Tabs defaultValue="inspector" className={cn('flex min-h-0 flex-1 flex-col gap-0', className)}>
      <TabsList className="m-2 grid shrink-0 grid-cols-4">
        <TabsTrigger value="inspector" className="px-1 text-xs">
          Inspector
        </TabsTrigger>
        <TabsTrigger value="layers" className="px-1 text-xs">
          Layers
        </TabsTrigger>
        <TabsTrigger value="zones" className="px-1 text-xs">
          Zones
        </TabsTrigger>
        <TabsTrigger value="reference" className="px-1 text-xs">
          Reference
        </TabsTrigger>
      </TabsList>
      <TabsContent
        forceMount
        value="inspector"
        className="min-h-0 overflow-auto p-3 data-[state=inactive]:hidden"
      >
        <InspectorPanel />
      </TabsContent>
      <TabsContent
        forceMount
        value="layers"
        className="min-h-0 overflow-auto p-3 data-[state=inactive]:hidden"
      >
        <LayersPanel />
      </TabsContent>
      <TabsContent
        forceMount
        value="zones"
        className="min-h-0 overflow-auto p-3 data-[state=inactive]:hidden"
      >
        <ZonesPanel />
      </TabsContent>
      <TabsContent
        forceMount
        value="reference"
        className="min-h-0 overflow-auto p-3 data-[state=inactive]:hidden"
      >
        <ReferencePanel />
      </TabsContent>
    </Tabs>
  );
}

export function EditorApp() {
  const pendingPortalRect = useEditorStore((s) => s.pendingPortalRect);
  const isCompact = useIsCompact();
  // Compact-only slide-in drawer state (plan 027 Step 8). Local, not in the store: flipping back to
  // desktop unmounts the compact branch, which closes both Sheets — no reset logic needed.
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // Opening an object-editor tab from the Library's ⚙ (any of its call sites) activates an
  // `object:<id>` tab. On compact the Library is a full-screen modal drawer, so the freshly-opened
  // editor tab would otherwise stay hidden behind it — close the drawer when an object tab becomes
  // active so the edit surface is what you actually see. No-op on desktop (the drawer isn't rendered).
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const map = useEditorStore((s) => s.map);
  useEffect(() => {
    if (activeTabId.startsWith('object:')) setLibraryOpen(false);
  }, [activeTabId]);

  // Tiling bars (palette strip + quick layer selector) are a Map-tab surface: the World and
  // object-editor tabs have no tile layers, so gate to the Map tab with a map open. Deliberately NOT
  // further gated to the brush/tile-paint tool — the palette doubles as a one-glance reference while
  // selecting/placing, so it stays visible across every Map-tab tool (plan 033 Step 6 default).
  const showTilingBar = activeTabId === 'map' && !!map;

  // Opening/closing a compact drawer is exactly where a finger's `touchend` can get swallowed by the
  // modal Sheet, stranding a phantom touch that later jams `EditorScene` in pinch-zoom (see the store's
  // `pointerGestureResetNonce` doc). Bump the reset nonce on every toggle so the scene drops that stale
  // tracking deterministically. Runs on both edges (and harmlessly once on mount, when there's nothing
  // to clear).
  useEffect(() => {
    useEditorStore.getState().resetPointerGesture();
  }, [libraryOpen, inspectorOpen]);

  // Load the asset catalog + terrain/node defs on editor BOOT, not lazily when the Library first opens
  // (plan 021 / plan 030): every surface that renders sprites — the Node Types tab's skin thumbnails,
  // the Inspector's node preview, object-editor tabs — reads the catalog from the store, so it must be
  // resident from the start. Previously this lived in `LibraryPanel`'s mount effect, so on the compact
  // shell (where the Library is an on-demand drawer) those sprites showed "missing" until you opened it.
  useEffect(() => {
    loadCatalog().catch((e: unknown) => {
      toast.error(`Asset catalog failed to load: ${(e as Error).message}`, { duration: 6000 });
    });
    // Terrain defs + node defs load independently — a failure is logged, not fatal (the store keeps its
    // bundled seed), mirroring the original per-loader handling.
    loadTerrainCatalog().catch((e: unknown) => {
      console.warn('[editor] terrain catalog failed to load:', (e as Error).message);
    });
    loadNodeDefs().catch((e: unknown) => {
      console.warn('[editor] node defs failed to load:', (e as Error).message);
    });
    // Global tile palettes (plan 033 step 9): load from disk, THEN install the autosave subscriber —
    // installing after the load resolves means the load's own `setTilePalettes` doesn't trigger a
    // redundant re-save. `installPaletteAutosave` returns an unsubscribe, torn down on effect cleanup.
    let unsubPalettes: (() => void) | undefined;
    loadPalettes()
      .catch((e: unknown) => {
        console.warn('[editor] palettes failed to load:', (e as Error).message);
      })
      .finally(() => {
        unsubPalettes = installPaletteAutosave();
      });
    return () => {
      unsubPalettes?.();
    };
  }, []);

  // react-resizable-panels v4 persistence: restores the Library/centre split on load and saves it
  // after each drag (localStorage). Replaces the old hand-rolled pixel-width + localStorage logic.
  const layout = useDefaultLayout({ id: 'mostowo-editor-layout', storage: localStorage });

  // Ctrl/Cmd+Z = undo, Shift+Ctrl/Cmd+Z = redo, Delete/Backspace = remove the selected object(s),
  // arrow keys = nudge the selection. Ignored while typing in a dialog/Inspector field (the SAME
  // input-guard for all, so these never fire while editing a numeric field).
  // NOTE: any shortcut added/changed here must be reflected in `shortcuts.ts` (the Shortcuts panel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const activeTabId = useEditorStore.getState().activeTabId;
      const el = document.activeElement;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      // Undo/redo drive the ONE shared history stack, which spans both map edits and world-layout
      // placements (plan 014 step 9) — so they're allowed on the Map AND World tabs (the store's
      // undo/redo bump the right side effects per the reverted entry's domain). An object-editor tab
      // has its own local form state and no document history, so undo/redo stay disabled there.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (activeTabId !== 'map' && activeTabId !== 'world') return;
        e.preventDefault();
        if (e.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
        return;
      }
      // Delete/nudge act on the MAP document only — ignore them unless the Map tab is showing, so
      // e.g. pressing Delete while the World or an object-editor tab is active never silently deletes
      // selected map objects. Top correctness risk of the tabbed pane (plan 017 step 2).
      if (activeTabId !== 'map') return;
      // U = toggle the reference underlay's visibility. Plain 'u' only (no Ctrl/Cmd/Alt), so it
      // doesn't collide with browser/OS bindings; the store action itself no-ops when there's no
      // underlay loaded, so this is safe to call unconditionally on the Map tab.
      if (e.key.toLowerCase() === 'u' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        useEditorStore.getState().toggleUnderlayVisible();
        return;
      }
      // S = cycle the selected node's skin to the next in its def's list (plan 021 step 9). Plain 's'
      // only, single node selected; the store action no-ops for defs with <2 skins. The INPUT/SELECT
      // guard above means this never fires while editing a field.
      if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const ids = useEditorStore.getState().selectedObjectIds;
        if (ids.length === 1) {
          const sel = useEditorStore.getState().map?.objects.find((o) => o.id === ids[0]);
          if (sel?.kind === 'node') {
            e.preventDefault();
            useEditorStore.getState().cycleNodeSkin(ids[0]);
          }
        }
        return;
      }
      // R = rotate the pending brush tile +90° (Shift+R = −90°), for the Brush tool with an asset
      // armed (plan 026). Plain 'r'/'R' only; the store cycles through 0/90/180/270. The INPUT/SELECT
      // guard above means it never fires while editing a field; no-op unless the brush is armed.
      if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const st = useEditorStore.getState();
        if (st.activeTool === 'brush' && st.brushAsset) {
          e.preventDefault();
          st.rotateBrush(e.shiftKey ? -90 : 90);
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = useEditorStore.getState().selectedObjectIds;
        if (ids.length > 0) {
          e.preventDefault();
          useEditorStore.getState().deleteObjects(ids);
        }
        return;
      }
      // Arrow keys nudge the selection for fine positioning: plain = 1px (decor only — nodes/portals
      // are tile-addressed and don't sub-tile), Shift = one whole tile (everything). Routes through the
      // same void-validated, undoable `translateObjects` a drag uses — one undo entry per press.
      const dir = NUDGE_DIRS[e.key];
      if (dir) {
        const state = useEditorStore.getState();
        const ids = state.selectedObjectIds;
        if (ids.length > 0) {
          e.preventDefault();
          const coarse = e.shiftKey;
          const step = coarse ? TILE_SIZE : 1;
          state.translateObjects(ids, {
            dxPx: dir.x * step,
            dyPx: dir.y * step,
            dCol: coarse ? dir.x : 0,
            dRow: coarse ? dir.y : 0,
          });
        } else if (state.activeTool === 'select' && state.regionSelection) {
          // No object selected but a marquee region is drawn → arrow keys move the whole area one
          // WHOLE tile (region moves are always tile-stepped; Shift has no finer step to offer).
          e.preventDefault();
          state.translateRegion(dir.x, dir.y);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Track the physical Alt/Shift modifiers into the store's MOMENTARY fields (plan 027 step 2). These
  // are a separate override OR'd into the sticky context-bar toggles at read time in EditorScene —
  // so a keyup/blur here can never wipe a toggle the (future) context bar set. Read `e.altKey`/
  // `e.shiftKey` off every key event (robust to key-repeat and to the modifier's own down/up), and
  // clear both on `window` blur so a modifier held while focus leaves doesn't get stuck on. The
  // INPUT/TEXTAREA/SELECT guard is deliberately NOT applied — modifier intent should track globally,
  // and these writes have no effect on text editing.
  useEffect(() => {
    const syncMods = (e: KeyboardEvent): void => {
      const st = useEditorStore.getState();
      if (st.altHeld !== e.altKey) st.setAltHeld(e.altKey);
      if (st.shiftHeld !== e.shiftKey) st.setShiftHeld(e.shiftKey);
    };
    const clearMods = (): void => {
      const st = useEditorStore.getState();
      if (st.altHeld) st.setAltHeld(false);
      if (st.shiftHeld) st.setShiftHeld(false);
    };
    window.addEventListener('keydown', syncMods);
    window.addEventListener('keyup', syncMods);
    window.addEventListener('blur', clearMods);
    return () => {
      window.removeEventListener('keydown', syncMods);
      window.removeEventListener('keyup', syncMods);
      window.removeEventListener('blur', clearMods);
    };
  }, []);

  return (
    // One TooltipProvider for the whole editor — steps 6-11 use <Tooltip> without adding their own.
    <TooltipProvider delayDuration={300}>
      {/* h-dvh (not h-screen/100vh): a 100vh inner child re-introduces the mobile browser-chrome
          clip that #editor-root's 100dvh avoids (plan 027, Step 1). 100dvh == 100vh on desktop. */}
      <div className="flex h-dvh flex-col">
        <Toolbar />
        {/* min-h-0 lets the viewport pane shrink instead of overflowing the shell. */}
        <div className="flex min-h-0 flex-1">
          {isCompact ? (
            // ── Compact shell (plan 027 Step 8): full-bleed CenterPane with Library / Inspector as
            //    slide-in Sheet drawers opened from the ContextBar's far-left/right buttons. Sheets are
            //    modal (Radix default) so they can't paint through to the Phaser canvas beneath; each
            //    carries its own bottom bar repeating that button as a CLOSE toggle in the same spot the
            //    drawer covers. A per-tool ContextBar (Step 9) sits along the bottom edge for thumb
            //    reach, giving touch users an on-screen equivalent of every keyboard action. ──
            <div className="flex min-h-0 w-full flex-1 flex-col">
              <div className="relative min-h-0 w-full flex-1">
                <CenterPane />

                <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
                  {/* Full-width: the drawer is a modal picker, not a persistent panel — trading canvas
                      visibility for touch-friendly tap targets is the explicit ask (plan 030 Step 5). */}
                  <SheetContent
                    side="left"
                    className="w-full max-w-none gap-0 border-surface bg-raised p-0"
                  >
                    <div className="flex-none border-b border-surface px-3 py-2">
                      <SheetTitle className="text-sm">Library</SheetTitle>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-3">
                      <LibraryPanel onPick={() => setLibraryOpen(false)} />
                    </div>
                    {/* The Library button persists at the same bottom-left spot while open, now a CLOSE
                        toggle — tapping where you opened it dismisses the drawer (mirrors the ContextBar
                        button beneath, which the drawer covers). */}
                    <div className="flex flex-none items-center border-t border-surface px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
                      <PanelBarButton
                        side="left"
                        icon={<LibraryBig />}
                        label="Library"
                        active
                        onClick={() => setLibraryOpen(false)}
                      />
                      {/* Palette multi-select entry — a small palette+plus toggle on the RIGHT of the
                          drawer's bottom bar (mirroring the Library close-toggle on the left), per phone
                          feedback that a full-width "Select for palette" button wasted Library space. */}
                      <PalettePickControls />
                    </div>
                  </SheetContent>
                </Sheet>

                <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
                  {/* Full-width to match the Library drawer (plan 030 Step 5). */}
                  <SheetContent
                    side="right"
                    className="w-full max-w-none gap-0 border-surface bg-raised p-0"
                  >
                    <div className="flex-none border-b border-surface px-3 py-2 pr-9">
                      <SheetTitle className="text-sm">Inspector</SheetTitle>
                    </div>
                    <InspectorTabs className="flex-1" />
                    {/* Inspector button persists bottom-right as a CLOSE toggle while open (see Library). */}
                    <div className="flex flex-none items-center border-t border-surface px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
                      <PanelBarButton
                        side="right"
                        icon={<SlidersHorizontal />}
                        label="Inspector"
                        active
                        onClick={() => setInspectorOpen(false)}
                      />
                    </div>
                  </SheetContent>
                </Sheet>
              </div>

              {/* Palette strip: a thin always-visible tiling strip stacked above SelectionBar +
                  ContextBar, so one-tap tile switching never requires opening the Library drawer. It
                  sits OUTSIDE the canvas region (a flex-none row, not overlaying it) and stacks cleanly
                  with SelectionBar (which self-hides when nothing is selected). Map-tab gated. */}
              {showTilingBar && (
                <div className="flex flex-none items-center overflow-x-auto border-t border-surface bg-raised px-2 py-1.5">
                  <PaletteStrip />
                </div>
              )}

              {/* Selection-operations bar: a second bottom bar stacked above the ContextBar, shown only
                  while something is selected (it self-hides otherwise). */}
              <SelectionBar />
              <ContextBar
                onOpenLibrary={() => setLibraryOpen(true)}
                onOpenInspector={() => setInspectorOpen(true)}
              />
            </div>
          ) : (
            // ── Desktop shell: today's exact layout — Library ↔ centre resizable split (persisted via
            //    autoSaveId), Inspector a fixed 280px column outside the group. ──
            <>
              <ResizablePanelGroup
                orientation="horizontal"
                className="min-w-0 flex-1"
                defaultLayout={layout.defaultLayout}
                onLayoutChanged={layout.onLayoutChanged}
              >
                {/* String sizes are percentages in v4 (numbers would be pixels). */}
                <ResizablePanel id="library" defaultSize="20" minSize="13" maxSize="45">
                  <aside className="box-border h-full overflow-auto border-r border-surface bg-raised p-3">
                    <LibraryPanel />
                  </aside>
                </ResizablePanel>
                <ResizableHandle className="hover:bg-active" />
                <ResizablePanel id="center" minSize="30">
                  {/* Wrap CenterPane so a slim tiling bar can dock directly beneath the viewport
                      without depending on the Library aside being open. CenterPane keeps a positioned,
                      full-size parent (relative flex-1 min-h-0) so its Scale.RESIZE canvas viewport is
                      never collapsed; the bar is a flex-none sibling row below it. */}
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="relative min-h-0 flex-1">
                      <CenterPane />
                    </div>
                    {showTilingBar && (
                      <div className="flex flex-none items-center gap-2 border-t border-surface bg-raised px-2 py-1.5">
                        <QuickLayerSelect />
                        <div className="min-w-0 flex-1 overflow-x-auto">
                          <PaletteStrip />
                        </div>
                      </div>
                    )}
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
              <aside className="box-border flex w-[280px] shrink-0 flex-col border-l border-surface bg-raised">
                <InspectorTabs />
              </aside>
            </>
          )}
        </div>
        {/* Match the old toast colours: green success / red error (the shared brown popover would make
            the two indistinguishable). `!` beats sonner's runtime-injected --normal-bg. */}
        <Toaster
          position="bottom-center"
          duration={2500}
          toastOptions={{
            classNames: {
              success: 'bg-ok-bg! border-ok-border! text-fg!',
              error: 'bg-danger-bg! border-danger-strong! text-danger-fg!',
            },
          }}
        />
        {pendingPortalRect && (
          <PortalDialog
            rect={pendingPortalRect}
            onConfirm={(name, facing) => {
              useEditorStore.getState().createPortal(pendingPortalRect, name, facing);
              useEditorStore.getState().setPendingPortalRect(null);
            }}
            onCancel={() => useEditorStore.getState().setPendingPortalRect(null)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
