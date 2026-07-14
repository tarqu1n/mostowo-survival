import { useEffect } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
import { TILE_SIZE } from '../config';
import { cn } from './lib/utils';
import { useEditorStore } from './store/editorStore';
import { Toolbar } from './Toolbar';
import { PhaserViewport } from './PhaserViewport';
import { ObjectEditorTab } from './tabs/ObjectEditorTab';
import { WorldViewTab } from './tabs/WorldViewTab';
import { LibraryPanel } from './panels/LibraryPanel';
import { LayersPanel } from './panels/LayersPanel';
import { ZonesPanel } from './panels/ZonesPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { PortalDialog } from './PortalDialog';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable';
import { Separator } from './ui/separator';
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

export function EditorApp() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const map = useEditorStore((s) => s.map);
  const pendingPortalRect = useEditorStore((s) => s.pendingPortalRect);

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
        const ids = useEditorStore.getState().selectedObjectIds;
        if (ids.length > 0) {
          e.preventDefault();
          const coarse = e.shiftKey;
          const step = coarse ? TILE_SIZE : 1;
          useEditorStore.getState().translateObjects(ids, {
            dxPx: dir.x * step,
            dyPx: dir.y * step,
            dCol: coarse ? dir.x : 0,
            dRow: coarse ? dir.y : 0,
          });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    // One TooltipProvider for the whole editor — steps 6-11 use <Tooltip> without adding their own.
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col">
        <Toolbar />
        {/* min-h-0 lets the viewport pane shrink instead of overflowing the shell. */}
        <div className="flex min-h-0 flex-1">
          {/* Library ↔ centre split; the Inspector (right) is a fixed 280px column outside the group,
              matching the original single-handle layout. autoSaveId persists the split across reloads. */}
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
                {/* Every tab's panel is mounted at once, absolutely filling the panel area; only the
                    active one is visible. Inactive panels are hidden with `invisible` (visibility:hidden),
                    NEVER `hidden`/display:none — display:none would collapse the Scale.RESIZE Phaser
                    canvas to 0×0. So the Map panel (and its live Phaser game) stays mounted regardless
                    of the active tab. */}
                <div className="relative min-h-0 flex-1">
                  {tabs.map((tab) => {
                    const hidden = tab.id !== activeTabId;
                    const panelClass = cn(
                      'absolute inset-0',
                      hidden && 'invisible pointer-events-none',
                    );
                    if (tab.kind === 'map') {
                      return (
                        <div key={tab.id} className={panelClass}>
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
                    return (
                      <div key={tab.id} className={panelClass}>
                        <ObjectEditorTab assetId={tab.assetId} />
                      </div>
                    );
                  })}
                </div>
              </main>
            </ResizablePanel>
          </ResizablePanelGroup>
          <aside className="box-border w-[280px] shrink-0 overflow-auto border-l border-surface bg-raised p-3">
            <InspectorPanel />
            <Separator className="my-3.5" />
            <LayersPanel />
            <Separator className="my-3.5" />
            <ZonesPanel />
          </aside>
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
