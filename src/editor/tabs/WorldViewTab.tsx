import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMap, getWorld, listMaps, putWorld } from '../api';
import { migrateMap, type MapFile } from '../../systems/mapFormat';
import {
  parseWorldLayout,
  validateWorld,
  type MapPlacement,
  type WorldLayout,
} from '../../systems/worldLayout';
import { pxToTile, unplacedMapIds } from '../worldViewOps';
import { useEditorStore } from '../store/editorStore';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

/**
 * World view tab (plan 014 step 9) — a pannable/zoomable React/DOM grid (NOT a second Phaser game;
 * there's exactly ONE `Phaser.Game`, in the Map tab's `PhaserViewport`) that positions every placed
 * map on a shared global tile grid. Each placed map draws as its committed 1px-per-tile thumbnail
 * (`/assets/maps/thumbs/<id>.png`, baked on every map save — see `EditorScene.bakeThumbnail` +
 * `Toolbar`), scaled to `width×height` tiles at the current zoom and positioned at
 * `origin.col/row × zoom`; a map whose thumbnail hasn't been baked yet degrades to a labelled
 * coloured rectangle at the right bbox size. Unplaced maps sit in a side tray; dragging one onto the
 * grid adds a placement, dragging a placed map repositions it (both snap to whole tiles). Every
 * placement edit routes through the store's world-domain history (`addPlacement`/`movePlacement`/
 * `removePlacement` → `applyWorldCommand`), so Ctrl+Z works uniformly with map edits.
 *
 * `validateWorld` (pure, `src/systems/worldLayout.ts`) runs live against the PROJECTED layout (the
 * committed placements with the in-flight drag applied) on every drag: any error (inside-cell
 * overlap, unknown map) highlights the implicated maps red and disables Save; warnings (seam
 * mismatch, diagonal-only adjacency, island, unplaced) surface as amber badges and never block. Save
 * writes ONLY `world.json` (`PUT /__editor/world`); the middleware regenerates `manifest.json`.
 *
 * Visibility: like every tab panel (see `ObjectEditorTab`'s header note), this owns no show/hide —
 * `EditorApp` mounts every panel at once and hides inactive ones with `invisible pointer-events-none`
 * (never `display:none`). This tab mounts once for the app's lifetime, so its one-shot mount fetch
 * (maps + `world.json`) runs a single time; it re-reads nothing live from other editor surfaces.
 */

/** Extra tiles of blank grid drawn around the placed maps' bounding box, so there's room to drag a
 *  new map in beside the others / reposition one outward. */
const MARGIN_TILES = 24;
const MIN_ZOOM = 1; // px per world tile
const MAX_ZOOM = 24;
const DEFAULT_ZOOM = 3;

/** Deterministic-ish fallback colour for a map with no baked thumbnail, keyed off its id. */
function fallbackColour(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 35% 32%)`;
}

/** Map ids quoted in a validateWorld error string (`maps "a" and "b" overlap…`,
 *  `placement references unknown map "x"`) — used to paint the implicated maps red. */
function idsInErrors(errors: string[]): Set<string> {
  const ids = new Set<string>();
  for (const e of errors) {
    for (const m of e.matchAll(/"([^"]+)"/g)) ids.add(m[1]);
  }
  return ids;
}

type WorldDrag =
  | { kind: 'place'; mapId: string }
  | { kind: 'move'; mapId: string; grabCol: number; grabRow: number }
  | { kind: 'pan'; startX: number; startY: number; startLeft: number; startTop: number };

export function WorldViewTab() {
  // world is mutated in place by store commands → subscribe to the revision counter as the re-render
  // trigger and read the live `world` via getState() in the body (mirrors ZonesPanel's pattern).
  const worldRevision = useEditorStore((s) => s.worldRevision);
  const worldDirty = useEditorStore((s) => s.worldDirty);
  const world = useEditorStore.getState().world;

  const [maps, setMaps] = useState<Record<string, MapFile>>({});
  const [allMapIds, setAllMapIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState<string[]>([]);
  const [missingThumbs, setMissingThumbs] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [saving, setSaving] = useState(false);
  const [hoverTile, setHoverTile] = useState<{ col: number; row: number } | null>(null);
  // Live drag preview: for 'place'/'move' the projected origin of the dragged map (whole tiles).
  const [preview, setPreview] = useState<{
    mapId: string;
    origin: { col: number; row: number };
  } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<WorldDrag | null>(null);
  // Cache-bust thumbnails once per mount so a fresh bake shows, without reloading every render.
  const thumbCacheBust = useRef(Date.now());

  // One-shot mount fetch: all map files (for dims + validateWorld) + world.json (unless the store
  // already holds unsaved edits — never clobber those, and preserve the in-place command closures).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ids = await listMaps();
        const loaded: Record<string, MapFile> = {};
        const failed: string[] = [];
        for (const id of ids) {
          try {
            loaded[id] = migrateMap(await getMap(id));
          } catch {
            failed.push(id);
          }
        }
        if (cancelled) return;
        setMaps(loaded);
        setAllMapIds(ids);
        setLoadFailed(failed);
        if (!useEditorStore.getState().worldDirty) {
          const w = parseWorldLayout(await getWorld());
          if (!cancelled) useEditorStore.getState().setWorld(w);
        }
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const metaOf = useCallback(
    (id: string): { width: number; height: number } => {
      const m = maps[id];
      return m ? { width: m.meta.width, height: m.meta.height } : { width: 10, height: 10 };
    },
    [maps],
  );

  // The layout to VALIDATE + DRAW: committed placements with any in-flight drag applied (moved
  // origin, or a freshly-placed ghost).
  const projected: MapPlacement[] = useMemo(() => {
    const base = world.placements.map((p) => ({ mapId: p.mapId, origin: { ...p.origin } }));
    if (preview) {
      const existing = base.find((p) => p.mapId === preview.mapId);
      if (existing) existing.origin = { ...preview.origin };
      else base.push({ mapId: preview.mapId, origin: { ...preview.origin } });
    }
    return base;
    // world.placements is mutated in place; worldRevision (subscribed above) drives recompute. (This
    // repo's eslint doesn't run react-hooks/exhaustive-deps — see ObjectEditorTab's note.)
  }, [preview, world.placements, worldRevision]);

  const validation = useMemo(
    () => validateWorld({ schemaVersion: 1, placements: projected }, maps),
    [projected, maps],
  );
  const errorIds = useMemo(() => idsInErrors(validation.errors), [validation.errors]);

  // World bounding box (in global tiles) → canvas origin + size. Derived from the PROJECTED layout so
  // the grid grows to include a map being dragged toward the edge.
  const bounds = useMemo(() => {
    let minCol = 0;
    let minRow = 0;
    let maxCol = 0;
    let maxRow = 0;
    let any = false;
    for (const p of projected) {
      const { width, height } = metaOf(p.mapId);
      const c0 = p.origin.col;
      const r0 = p.origin.row;
      const c1 = p.origin.col + width;
      const r1 = p.origin.row + height;
      if (!any) {
        minCol = c0;
        minRow = r0;
        maxCol = c1;
        maxRow = r1;
        any = true;
      } else {
        minCol = Math.min(minCol, c0);
        minRow = Math.min(minRow, r0);
        maxCol = Math.max(maxCol, c1);
        maxRow = Math.max(maxRow, r1);
      }
    }
    const originCol = (any ? minCol : 0) - MARGIN_TILES;
    const originRow = (any ? minRow : 0) - MARGIN_TILES;
    const cols = (any ? maxCol - minCol : 0) + MARGIN_TILES * 2;
    const rows = (any ? maxRow - minRow : 0) + MARGIN_TILES * 2;
    return { originCol, originRow, cols, rows };
  }, [projected, metaOf]);

  const unplaced = useMemo(
    () => unplacedMapIds(allMapIds, world.placements),
    [allMapIds, world.placements, worldRevision],
  );

  /** Global tile under a client point (accounts for scroll: the canvas rect already reflects it). */
  const clientToTile = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { col: bounds.originCol, row: bounds.originRow };
      return {
        col: bounds.originCol + pxToTile(clientX - rect.left, zoom),
        row: bounds.originRow + pxToTile(clientY - rect.top, zoom),
      };
    },
    [bounds.originCol, bounds.originRow, zoom],
  );

  // ---- Pointer handling (place / move / pan) ----

  const onTrayPointerDown = (e: React.PointerEvent, mapId: string): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { kind: 'place', mapId };
    const tile = clientToTile(e.clientX, e.clientY);
    setPreview({ mapId, origin: tile });
  };

  const onMapPointerDown = (e: React.PointerEvent, mapId: string): void => {
    // middle-button anywhere pans; left-button on a map body begins a reposition.
    if (e.button === 1) return; // let it bubble to the canvas pan handler
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    const tile = clientToTile(e.clientX, e.clientY);
    const placement = world.placements.find((p) => p.mapId === mapId);
    if (!placement) return;
    dragRef.current = {
      kind: 'move',
      mapId,
      grabCol: tile.col - placement.origin.col,
      grabRow: tile.row - placement.origin.row,
    };
    setPreview({ mapId, origin: { ...placement.origin } });
  };

  const onCanvasPointerDown = (e: React.PointerEvent): void => {
    // Empty-grid drag pans (middle button always pans, even over a map).
    const viewport = viewportRef.current;
    if (!viewport) return;
    canvasRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      startLeft: viewport.scrollLeft,
      startTop: viewport.scrollTop,
    };
  };

  const onCanvasPointerMove = (e: React.PointerEvent): void => {
    const tile = clientToTile(e.clientX, e.clientY);
    setHoverTile(tile);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'pan') {
      const viewport = viewportRef.current;
      if (viewport) {
        viewport.scrollLeft = drag.startLeft - (e.clientX - drag.startX);
        viewport.scrollTop = drag.startTop - (e.clientY - drag.startY);
      }
      return;
    }
    if (drag.kind === 'place') {
      setPreview({ mapId: drag.mapId, origin: tile });
      return;
    }
    // move
    setPreview({
      mapId: drag.mapId,
      origin: { col: tile.col - drag.grabCol, row: tile.row - drag.grabRow },
    });
  };

  const onCanvasPointerUp = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
      canvasRef.current.releasePointerCapture(e.pointerId);
    }
    const p = preview;
    setPreview(null);
    if (!drag || drag.kind === 'pan' || !p) return;
    if (drag.kind === 'place') {
      useEditorStore.getState().addPlacement(drag.mapId, p.origin);
    } else {
      useEditorStore.getState().movePlacement(drag.mapId, p.origin);
    }
  };

  // Cursor-anchored wheel zoom over the viewport (mirrors AtlasSheetPicker's idiom).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const contentX = el.scrollLeft + ox;
      const contentY = el.scrollTop + oy;
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + (e.deltaY < 0 ? 1 : -1)));
        if (next === z) return z;
        // keep the world point under the cursor stationary across the zoom
        requestAnimationFrame(() => {
          el.scrollLeft = (contentX / z) * next - ox;
          el.scrollTop = (contentY / z) * next - oy;
        });
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  async function handleSave(): Promise<void> {
    if (validation.errors.length > 0) return;
    setSaving(true);
    try {
      const layout: WorldLayout = useEditorStore.getState().world;
      const json = `${JSON.stringify(layout, null, 2)}\n`;
      parseWorldLayout(JSON.parse(json)); // validate the exact bytes before writing
      await putWorld(json);
      useEditorStore.getState().markWorldSaved();
      toast.success('Saved world layout.');
    } catch (e) {
      toast.error(`World save failed: ${(e as Error).message}`, { duration: 5000 });
    } finally {
      setSaving(false);
    }
  }

  const thumbUrl = (id: string): string =>
    `${import.meta.env.BASE_URL}assets/maps/thumbs/${id}.png?t=${thumbCacheBust.current}`;

  const hasErrors = validation.errors.length > 0;

  return (
    <div className="flex h-full w-full">
      {/* Side tray: unplaced maps. */}
      <aside className="flex w-[180px] shrink-0 flex-col gap-2 overflow-auto border-r border-surface bg-raised p-3">
        <h2 className="text-[0.85rem] uppercase tracking-[0.04em] text-fg-dim">Unplaced maps</h2>
        {loadError && <p className="text-[0.8rem] text-danger">{loadError}</p>}
        {loadFailed.length > 0 && (
          <p className="text-[0.72rem] text-danger">Failed to parse: {loadFailed.join(', ')}</p>
        )}
        {allMapIds.length === 0 && !loadError && (
          <p className="text-[0.85rem] text-muted-2">No maps found.</p>
        )}
        {unplaced.length === 0 && allMapIds.length > 0 && (
          <p className="text-[0.85rem] text-muted-2">Every map is placed.</p>
        )}
        {unplaced.map((id) => (
          <button
            key={id}
            type="button"
            className="cursor-grab touch-none rounded-md border border-border bg-inset px-2 py-1.5 text-left text-[0.8rem] text-fg hover:border-accent-border active:cursor-grabbing"
            title="Drag onto the grid to place"
            onPointerDown={(e) => onTrayPointerDown(e, id)}
          >
            {maps[id]?.meta.name ?? id}
            <span className="block text-[0.68rem] text-muted-2">
              {id} · {metaOf(id).width}×{metaOf(id).height}
            </span>
          </button>
        ))}
      </aside>

      {/* Main column: controls, grid, status bar. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none items-center gap-3 border-b border-surface bg-raised px-3 py-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                disabled={saving || hasErrors || !worldDirty}
                onClick={() => void handleSave()}
              >
                Save world
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {hasErrors
                ? 'Fix overlap/validation errors before saving'
                : worldDirty
                  ? 'Write world.json (PUT /__editor/world)'
                  : 'No unsaved world changes'}
            </TooltipContent>
          </Tooltip>
          {worldDirty && (
            <span className="text-gold" title="Unsaved world changes">
              ●
            </span>
          )}
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-1.5 text-[0.8rem] text-fg-dim">
            <Button
              variant="outline"
              size="icon-xs"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 1))}
            >
              −
            </Button>
            <span className="min-w-10 text-center">{zoom}px/tile</span>
            <Button
              variant="outline"
              size="icon-xs"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 1))}
            >
              +
            </Button>
          </div>
          <span className="text-[0.75rem] text-muted-2">
            Wheel = zoom · drag empty grid / middle-drag = pan
          </span>
        </div>

        {/* Scrollable grid viewport. */}
        <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-auto bg-inset">
          <div
            ref={canvasRef}
            className="pixelated relative touch-none select-none"
            style={{
              width: bounds.cols * zoom,
              height: bounds.rows * zoom,
              // faint tile grid via a repeating background at the current zoom
              backgroundImage:
                'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px),' +
                'linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)',
              backgroundSize: `${zoom}px ${zoom}px`,
            }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
          >
            {projected.map((p) => {
              const { width, height } = metaOf(p.mapId);
              const left = (p.origin.col - bounds.originCol) * zoom;
              const top = (p.origin.row - bounds.originRow) * zoom;
              const w = width * zoom;
              const h = height * zoom;
              const isError = errorIds.has(p.mapId);
              const noThumb = missingThumbs.has(p.mapId) || !maps[p.mapId];
              const isDragging = preview?.mapId === p.mapId;
              return (
                <div
                  key={p.mapId}
                  className={cn(
                    'absolute box-border border',
                    isError ? 'border-danger-strong' : 'border-accent-border',
                    isDragging && 'opacity-80',
                  )}
                  style={{ left, top, width: w, height: h }}
                  onPointerDown={(e) => onMapPointerDown(e, p.mapId)}
                >
                  {noThumb ? (
                    <div
                      className="flex h-full w-full items-center justify-center text-center text-[0.6rem] text-fg"
                      style={{ background: fallbackColour(p.mapId) }}
                    >
                      no thumbnail
                    </div>
                  ) : (
                    <img
                      src={thumbUrl(p.mapId)}
                      alt={p.mapId}
                      draggable={false}
                      className="pixelated block h-full w-full"
                      onError={() =>
                        setMissingThumbs((s) => {
                          if (s.has(p.mapId)) return s;
                          const next = new Set(s);
                          next.add(p.mapId);
                          return next;
                        })
                      }
                    />
                  )}
                  {isError && (
                    <div className="pointer-events-none absolute inset-0 bg-danger-strong/30" />
                  )}
                  <div className="pointer-events-none absolute left-0 top-0 max-w-full truncate bg-black/55 px-1 text-[0.62rem] leading-tight text-fg-bright">
                    {maps[p.mapId]?.meta.name ?? p.mapId}
                  </div>
                  <button
                    type="button"
                    title="Remove from world (return to tray)"
                    className="absolute right-0 top-0 flex size-4 items-center justify-center bg-black/55 text-[0.6rem] text-danger-fg hover:bg-danger-bg"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      useEditorStore.getState().removePlacement(p.mapId);
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Status bar: live coords + validation. */}
        <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t border-surface bg-raised px-3 py-1.5 text-[0.75rem]">
          <span className="text-fg-dim">
            {hoverTile ? `tile (${hoverTile.col}, ${hoverTile.row})` : '—'}
          </span>
          {preview && (
            <span className="text-gold-light">
              → placing at ({preview.origin.col}, {preview.origin.row})
            </span>
          )}
          {validation.errors.map((err, i) => (
            <span
              key={`e${i}`}
              className="rounded-sm bg-danger-bg px-1.5 py-0.5 text-danger-fg"
              title={err}
            >
              ⚠ {err}
            </span>
          ))}
          {validation.warnings.map((warn, i) => (
            <span
              key={`w${i}`}
              className="rounded-sm border border-gold/40 px-1.5 py-0.5 text-gold-light"
              title={warn}
            >
              {warn}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
