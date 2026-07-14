import { useCallback, useEffect, useRef, useState } from 'react';
import { TILE_SIZE } from '../config';
import { useEditorStore } from './store/editorStore';
import { Toolbar } from './Toolbar';
import { PhaserViewport } from './PhaserViewport';
import { ObjectEditorTab } from './tabs/ObjectEditorTab';
import { LibraryPanel } from './panels/LibraryPanel';
import { LayersPanel } from './panels/LayersPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { PortalDialog } from './PortalDialog';
import { useToast, ToastHost } from './Toast';

/**
 * Map Builder shell (plan 014 step 5, extended steps 6-7): toolbar on top, then a three-pane body —
 * Library (left), the tabbed central pane (centre), Inspector + Layers (right). The central pane is a
 * tab strip over a panel area (plan 017 step 2): the permanent Map + World tabs plus an object-editor
 * tab per Library ⚙ click. Every tab's panel is mounted at once and shown/hidden by `visibility`
 * (never `display:none`) so the Phaser map canvas — expensive, stateful, `Scale.RESIZE` — survives
 * every switch instead of being torn down and rebuilt. Everything shares state through
 * `useEditorStore`; this component wires the panes, the tab strip, the global undo/redo + delete
 * shortcuts (gated to the Map tab), and the Portal-tool's name/facing dialog.
 */

/** Arrow key → unit direction (screen space: up = -y). Drives the selected-object nudge below. */
const NUDGE_DIRS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

const LIBRARY_WIDTH_KEY = 'mostowo-editor-library-width';
const LIBRARY_WIDTH_DEFAULT = 240;
const LIBRARY_WIDTH_MIN = 180;
const LIBRARY_WIDTH_MAX = 560;

function loadLibraryWidth(): number {
  const raw = Number(localStorage.getItem(LIBRARY_WIDTH_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return LIBRARY_WIDTH_DEFAULT;
  return Math.min(LIBRARY_WIDTH_MAX, Math.max(LIBRARY_WIDTH_MIN, raw));
}

export function EditorApp() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const map = useEditorStore((s) => s.map);
  const pendingPortalRect = useEditorStore((s) => s.pendingPortalRect);
  const { toast, showToast } = useToast();

  const [libraryWidth, setLibraryWidth] = useState(loadLibraryWidth);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [isResizingLibrary, setIsResizingLibrary] = useState(false);

  // Drag-resize for the Library pane (left sidebar). Tracks pointermove/up on window rather than the
  // handle itself, so the drag keeps following the cursor even once it leaves the thin handle strip.
  const onLibraryResizeStart = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      resizeRef.current = { startX: e.clientX, startWidth: libraryWidth };
      setIsResizingLibrary(true);
    },
    [libraryWidth],
  );

  useEffect(() => {
    if (!isResizingLibrary) return;
    const onMove = (e: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const next = r.startWidth + (e.clientX - r.startX);
      setLibraryWidth(Math.min(LIBRARY_WIDTH_MAX, Math.max(LIBRARY_WIDTH_MIN, next)));
    };
    const onUp = () => {
      resizeRef.current = null;
      setIsResizingLibrary(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [isResizingLibrary]);

  useEffect(() => {
    localStorage.setItem(LIBRARY_WIDTH_KEY, String(libraryWidth));
  }, [libraryWidth]);

  // Ctrl/Cmd+Z = undo, Shift+Ctrl/Cmd+Z = redo, Delete/Backspace = remove the selected object(s),
  // arrow keys = nudge the selection. Ignored while typing in a dialog/Inspector field (the SAME
  // input-guard for all, so these never fire while editing a numeric field).
  // NOTE: any shortcut added/changed here must be reflected in `shortcuts.ts` (the Shortcuts panel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // These all act on the MAP document; ignore them entirely unless the Map tab is showing, so
      // e.g. pressing Delete while an object-editor tab is active never silently deletes selected
      // map objects (read via getState — this effect has an empty dep array). Top correctness risk
      // of the tabbed pane (plan 017 step 2).
      if (useEditorStore.getState().activeTabId !== 'map') return;
      const el = document.activeElement;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
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
    <div className="editor-shell">
      <Toolbar showToast={showToast} />
      <div
        className="editor-body"
        style={{ gridTemplateColumns: `${libraryWidth}px 6px 1fr 280px` }}
      >
        <aside className="editor-pane editor-pane--library">
          <LibraryPanel />
        </aside>
        <div
          className={`editor-resize-handle ${isResizingLibrary ? 'is-dragging' : ''}`}
          onPointerDown={onLibraryResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Library panel"
        />
        <main className="editor-pane editor-pane--viewport">
          <div className="editor-tab-strip" role="tablist">
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
                  className={`editor-tab ${isActive ? 'is-active' : ''}`}
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
                  <span className="editor-tab-label">{label}</span>
                  {closable && (
                    <span
                      className="editor-tab-close"
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
          {/* Every tab's panel is mounted at once, absolutely filling the panel area; only the active
              one is visible. Inactive panels are hidden with `visibility` (via .is-hidden), NEVER
              `display:none` — display:none would collapse the Scale.RESIZE Phaser canvas to 0×0. So
              the Map panel (and its live Phaser game) stays mounted regardless of the active tab. */}
          <div className="editor-tab-panels">
            {tabs.map((tab) => {
              const hidden = tab.id !== activeTabId;
              const panelClass = `editor-tab-panel ${hidden ? 'is-hidden' : ''}`;
              if (tab.kind === 'map') {
                return (
                  <div key={tab.id} className={panelClass}>
                    <PhaserViewport />
                    {!map && <div className="editor-empty-hint">New or Open a map to begin.</div>}
                  </div>
                );
              }
              if (tab.kind === 'world') {
                return (
                  <div key={tab.id} className={panelClass}>
                    <div className="editor-empty-hint">World view — coming in step 9.</div>
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
        <aside className="editor-pane editor-pane--inspector">
          <InspectorPanel />
          <hr className="editor-pane-divider" />
          <LayersPanel />
        </aside>
      </div>
      <ToastHost toast={toast} />
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
  );
}
