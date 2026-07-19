import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { tilesetAssetUrl } from '../textureLoading';
import type { CatalogAsset, CatalogAssetType } from '../catalog';
import { loadCatalog } from '../catalogSource';
import { putAssetOverride, putAssetRegions } from '../api';
import {
  applyReclassify,
  assetRelPath,
  reclassifyGrid,
  seedCols,
  seedOmit,
  seedRows,
  suggestGrids,
} from '../reclassify';
import { detectRegionAt, sanitiseClientRegions, seedRegions, sliceBox, type Box } from '../regions';
import { useIsCompact } from '../hooks/useIsCompact';
import { useEditorStore } from '../store/editorStore';
import { Button } from '../ui/button';
import { NumberInput } from '../ui/numberInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Slider } from '../ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../lib/utils';

/**
 * Object-editor tab (plan 017 step 3) — the full-size reclassify surface opened from the Library's ⚙
 * for a single catalog asset, replacing the cramped, clip-prone `AssetReclassify` popover (plan 014
 * step 7c). It looks its asset up from the store catalog by `assetId`; if the lookup fails (the asset
 * was removed/renamed on a catalog regen) it renders a graceful "asset no longer in catalog" state
 * instead of crashing.
 *
 * The room a tab gives (vs. a corner popover) buys the actual fix: a **correctly cropped per-frame
 * preview**. The old library swatch renders a multi-row strip (e.g. a 2×2 furnace sheet, `rows > 1`)
 * wrong because it assumes a single horizontal row; here each frame `i` is cropped at
 * `col = i % cols`, `row = floor(i / cols)` (see `reclassify.ts`), so a 2×2 shows as a real 2×2.
 *
 * Draft `type`/`cols`/`rows`/`omit` are LOCAL React state (an uncommitted form) — canonical truth is
 * server-side `pack.json`, surfaced by the post-Apply catalog refetch. On Apply we PUT the override,
 * refetch the catalog into the store (which updates the Library live too), and re-seed the draft from
 * the freshly-resolved catalog entry.
 *
 * The tab body is type-conditional (plan 017 step 4): a DRAFT type of `object` swaps the frame-grid
 * preview for a `RegionsEditor` (below) — an editable overlay of `pack.json` `regions` boxes on a
 * zoomable sheet (draw / select+delete / move+resize / grid-slice) that writes the whole region list
 * through `putAssetRegions`. `strip`/`tile` keep the step-3 frame-grid preview.
 *
 * NOTE on tab-panel visibility (plan 020 Step 10): this component owns none — `EditorApp.tsx`'s central
 * tab strip mounts every tab's panel at once and hides inactive ones with `invisible pointer-events-none`
 * (never `hidden`/display:none, which would collapse the Scale.RESIZE Phaser canvas in the Map tab to
 * 0×0). This file only ever renders while it's some tab's content; it doesn't do any showing/hiding of
 * its own.
 */
export function ObjectEditorTab({ assetId }: { assetId: string }) {
  const catalog = useEditorStore((s) => s.catalog);
  const asset = catalog?.assets.find((a) => a.id === assetId);
  const filename = assetId.split('/').pop() ?? assetId;

  if (!asset) {
    return (
      <div className={objTabClass}>
        <h2 className={objTitleClass}>{filename}</h2>
        <p className="-mt-1 mb-2 text-[0.8rem] text-danger">
          This asset is no longer in the catalog — it may have been removed or renamed on disk.
        </p>
        <p className={objIdClass}>{assetId}</p>
      </div>
    );
  }

  return <ObjectEditorForm asset={asset} />;
}

/** On-screen sizes for the two previews. `SHEET_MAX` fits the whole sheet into a legible box (up- or
 *  down-scaled); `FRAME_TARGET` is the size each cropped per-frame swatch is scaled towards. */
const SHEET_MAX = 280;
const FRAME_TARGET = 72;

/* Shared class strings for the repeated object-editor/regions-editor shapes (plan 020 Step 10). */
const objTabClass = 'h-full w-full overflow-auto p-4 px-[18px]';
const objTitleClass = 'mb-3 text-base text-fg-bright';
const objIdClass = 'break-all text-[0.78rem] text-muted-2';
const objInputClass = 'rounded-md border border-border bg-inset px-2 py-1 text-fg';
// The primary-action bar (Apply / Save regions / Reset). Stuck to the bottom of the tab's scroll
// container (`objTabClass`, the nearest `overflow-auto` ancestor) so the buttons are ALWAYS reachable —
// they used to scroll off the bottom on short viewports and on mobile. Negative margins bleed it to the
// full tab width and cancel the container's `p-4` bottom padding so it sits flush at the very bottom;
// `bg-background` (the tab's own colour) lets content scroll cleanly underneath.
const objActionsClass =
  'sticky bottom-0 z-10 -mx-[18px] -mb-4 flex gap-2 border-t border-surface bg-background px-[18px] pt-2.5 pb-3';

/** `.editor-object-frame`: a per-frame click-to-omit swatch button reset to a bare pixel crop, with an
 *  omitted cell dimmed + desaturated + crossed out with a diagonal double-gradient (`after:`), matching
 *  the old `.is-omitted::after`. */
const objFrameClass = (omitted: boolean): string =>
  cn(
    'relative block cursor-pointer border border-border bg-inset-2 bg-no-repeat p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold',
    omitted &&
      "border-danger opacity-40 grayscale-[80%] after:absolute after:inset-0 after:content-[''] after:bg-[linear-gradient(to_top_right,transparent_46%,var(--color-danger)_46%,var(--color-danger)_54%,transparent_54%),linear-gradient(to_bottom_right,transparent_46%,var(--color-danger)_46%,var(--color-danger)_54%,transparent_54%)]",
  );

/** A labelled control row (`.editor-object-field`): a small dim caption above the input/select. */
function ObjField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.72rem] text-muted-2">{label}</span>
      {children}
    </label>
  );
}

/** The shared error/warnings blocks under either form (`.editor-object-error`/`.editor-object-warnings`). */
function FormError({ message }: { message: string }) {
  return <p className="text-[0.8rem] text-danger">{message}</p>;
}
function FormWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="flex max-h-24 flex-col gap-0.5 overflow-y-auto text-[0.72rem] text-muted-2">
      {warnings.slice(0, 6).map((w, i) => (
        <div key={i}>{w}</div>
      ))}
    </div>
  );
}

/** The reclassify form — only rendered with a resolved `asset`, so its hooks never sit behind the
 *  missing-asset branch above. */
function ObjectEditorForm({ asset }: { asset: CatalogAsset }) {
  const [type, setType] = useState<CatalogAssetType>(asset.type);
  const [cols, setCols] = useState(() => seedCols(asset));
  const [rows, setRows] = useState(() => seedRows(asset));
  const [omit, setOmit] = useState<number[]>(() => seedOmit(asset));
  // plan 028: on a `tile` sheet, open the Regions editor to author `object`-role prop regions
  // WITHOUT demoting the sheet to `type:'object'`. Only meaningful while the draft type is `tile`.
  const [regionMode, setRegionMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Re-seed the draft whenever the underlying catalog entry actually changes VALUE (after our own Apply
  // regenerates it, or another surface reclassifies it). Deps are the resolved grid values (cols now
  // recovered from `frameWidth`, plus an `omit` signature), NOT `asset` identity, so a same-value
  // refetch (the Library's mount fetch) never clobbers an in-progress edit; the mount double-seed
  // (identical to the useState initialisers) is harmless. This repo's eslint doesn't run
  // react-hooks/exhaustive-deps, so there's no lint either way.
  useEffect(() => {
    setType(asset.type);
    setCols(seedCols(asset));
    setRows(seedRows(asset));
    setOmit(seedOmit(asset));
    setRegionMode(false);
    setWarnings([]);
    setErr(null);
  }, [asset.type, asset.frames, asset.frameWidth, asset.frameHeight, (asset.omit ?? []).join(',')]);

  const relPath = asset.id.slice(asset.pack.length + 1);
  const sheetUrl = tilesetAssetUrl(
    asset.pack,
    asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path,
  );
  // `cells` = total grid cells (`cols*rows` = the geometry-mode `frames`). `omitInRange` drops any
  // stale omit index that a later cols/rows shrink pushed out of bounds, so a shrunk-then-Applied grid
  // can never PUT an out-of-range omit; it's the omit we thread everywhere (grid, preview, Apply).
  const cells = cols * rows;
  const omitInRange = omit.filter((i) => Number.isInteger(cells) && i >= 0 && i < cells);
  const grid = reclassifyGrid(asset, type, cols, rows, omitInRange);
  const isStrip = type === 'strip';
  const isObject = type === 'object';
  const isTile = type === 'tile';

  // Set a grid dimension and prune any omit index the new geometry no longer contains, so a later grow
  // can't resurrect a stale omission at a cell the user never intended.
  const changeCols = (v: number): void => {
    const next = Math.max(1, Math.round(Number(v) || 1));
    setCols(next);
    setOmit((o) => o.filter((i) => i < next * rows));
  };
  const changeRows = (v: number): void => {
    const next = Math.max(1, Math.round(Number(v) || 1));
    setRows(next);
    setOmit((o) => o.filter((i) => i < cols * next));
  };
  const toggleOmit = (i: number): void => {
    setOmit((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i].sort((a, b) => a - b)));
  };

  // Whole-sheet preview scale (fits SHEET_MAX; upscales tiny sheets, downscales big ones).
  const sheetScale = SHEET_MAX / Math.max(asset.w, asset.h);
  const sheetW = Math.round(asset.w * sheetScale);
  const sheetH = Math.round(asset.h * sheetScale);

  // Per-frame swatch scale — only used when the strip grid is valid.
  const frameScale =
    grid.frameWidth && grid.frameHeight
      ? FRAME_TARGET / Math.max(grid.frameWidth, grid.frameHeight)
      : 1;
  const cellW = grid.frameWidth ? Math.round(grid.frameWidth * frameScale) : 0;
  const cellH = grid.frameHeight ? Math.round(grid.frameHeight * frameScale) : 0;

  async function commit(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const result = await applyReclassify(asset, type, cols, rows, omitInRange);
      setWarnings(result.warnings);
      // Refetch → setCatalog: updates the store (this tab re-derives its `asset`, the re-seed effect
      // fires) and the Library panel in one shot.
      await loadCatalog();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A control row is only needed for the strip grid (cols/rows) or a tile's object-region toggle —
  // for a plain `object`/`tile` sheet everything lives in the header row, so the row is suppressed
  // entirely rather than left as an empty gap.
  const hasControlsRow = isStrip || isTile;

  return (
    <div className={objTabClass}>
      {/* Single header row (plan 031): filename + path/dims + the Type select all on one line, so the
          mobile viewport isn't eaten by three stacked rows. Wraps gracefully on very narrow widths;
          the Type control pushes to the right on roomy ones (`ml-auto`). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-base text-fg-bright">{filenameOf(asset)}</h2>
        <span className={objIdClass}>
          {relPath} · {asset.w}×{asset.h}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[0.72rem] text-muted-2">Type</span>
          <Select value={type} onValueChange={(v) => setType(v as CatalogAssetType)}>
            <SelectTrigger size="sm" className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tile">tile</SelectItem>
              <SelectItem value="strip">Animated strip</SelectItem>
              <SelectItem value="object">object</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {hasControlsRow && (
          <div className="flex flex-wrap items-end gap-3">
            {/* plan 028: a mixed `tile` sheet can author `object`-role prop regions without becoming an
                object. Toggling this swaps the frame-grid preview for the Regions editor while the type
                stays `tile` (Save writes object-role regions, no demotion). Inline button (no caption
                row) so region editing keeps as much vertical budget as possible for the canvas. */}
            {isTile && (
              <Button
                type="button"
                variant={regionMode ? 'default' : 'outline'}
                size="sm"
                aria-pressed={regionMode}
                onClick={() => setRegionMode((v) => !v)}
              >
                {regionMode ? '✏ Editing regions' : 'Edit regions'}
              </Button>
            )}

            {isStrip && (
              <>
                <ObjField label="Columns">
                  <NumberInput
                    min={1}
                    value={cols}
                    className={cn(objInputClass, 'w-20')}
                    onValue={changeCols}
                  />
                </ObjField>
                <ObjField label="Rows">
                  <NumberInput
                    min={1}
                    value={rows}
                    className={cn(objInputClass, 'w-20')}
                    onValue={changeRows}
                  />
                </ObjField>
              </>
            )}
          </div>
        )}

        {/* type:object → the Regions editor (plan 017 step 4); strip/tile keep the step-3 frame-grid
            preview. Branches on the DRAFT type, so picking `object` in the dropdown makes the sheet's
            regions editable even for an asset currently classified strip/tile (Save also forces the
            `object` type override in that case). plan 028: a `tile` sheet in `regionMode` also opens
            the Regions editor, but in object-ROLE mode — Save keeps the sheet `tile`. */}
        {isObject ? (
          <RegionsEditor asset={asset} sheetUrl={sheetUrl} />
        ) : isTile && regionMode ? (
          <RegionsEditor asset={asset} sheetUrl={sheetUrl} objectRoleRegions />
        ) : (
          <>
            {isStrip && (
              <div className="flex flex-wrap gap-1.5">
                {suggestGrids(asset.w, asset.h).map((s) => (
                  <Button
                    key={`${s.rows}x${s.cols}`}
                    type="button"
                    variant="outline"
                    size="xs"
                    title={`${asset.w / s.cols}×${asset.h / s.rows} per frame`}
                    onClick={() => {
                      setCols(s.cols);
                      setRows(s.rows);
                      setOmit([]);
                    }}
                  >
                    {s.cols}×{s.rows}
                  </Button>
                ))}
              </div>
            )}

            {isStrip && !grid.valid && (
              <FormError
                message={`columns (${cols}) and rows (${rows}) must divide the sheet (${asset.w}×${asset.h}) into whole pixels, and at least one cell must play.`}
              />
            )}

            <div className="flex flex-wrap items-start gap-7">
              {/* Whole-sheet preview with a live grid overlay (strip only) — recomputed every render
                  straight from the current cols/rows, so it tracks keystrokes with no debounce. */}
              <figure className="flex flex-col gap-1.5">
                <figcaption className="text-[0.72rem] text-muted-2">Sheet</figcaption>
                <div
                  className="pixelated relative border border-border bg-no-repeat"
                  // Sheet render size + image are computed from the asset's own dims — stays inline.
                  style={{
                    width: sheetW,
                    height: sheetH,
                    backgroundImage: `url(${sheetUrl})`,
                    backgroundSize: '100% 100%',
                  }}
                >
                  {isStrip && grid.valid && grid.cols !== undefined && (
                    <div
                      className="absolute inset-0 grid"
                      // Grid overlay tracks the live cols/rows draft — computed, stays inline.
                      style={{
                        gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
                        gridTemplateRows: `repeat(${rows}, 1fr)`,
                      }}
                    >
                      {Array.from({ length: grid.cols * rows }, (_, i) => (
                        <span key={i} className="border border-gold opacity-85" />
                      ))}
                    </div>
                  )}
                </div>
              </figure>

              {/* The fix — a CORRECTLY cropped per-frame preview, now doubling as the click-to-omit
                  grid (plan 017 step 6.5). Every one of the `cells` grid cells is rendered (not just
                  the played ones), each cropped at `col = i % cols`, `row = floor(i / cols)`; a 2×2
                  sheet reads as a real 2×2, not a squished single row. Clicking a cell toggles its
                  membership of `omit` — an omitted cell dims + crosses out and drops from the played
                  set. Strip-only + valid-grid-only (a non-integer grid or an all-omitted grid shows
                  the error instead, since `grid.valid` now also requires ≥1 played frame). */}
              {isStrip && grid.valid && grid.cols !== undefined && (
                <figure className="flex flex-col gap-1.5">
                  <figcaption className="text-[0.72rem] text-muted-2">
                    Frames ({grid.played.length} played / {cells} cells · {grid.cols}×{rows})
                  </figcaption>
                  <div className="flex max-w-[340px] flex-wrap gap-1.5">
                    {Array.from({ length: grid.frames ?? cells }, (_, i) => {
                      const col = i % grid.cols!;
                      const row = Math.floor(i / grid.cols!);
                      const omitted = omitInRange.includes(i);
                      return (
                        <button
                          key={i}
                          type="button"
                          className={objFrameClass(omitted)}
                          title={
                            omitted
                              ? `frame ${i} (omitted — click to include)`
                              : `frame ${i} (click to omit)`
                          }
                          aria-label={
                            omitted
                              ? `frame ${i} (omitted — click to include)`
                              : `frame ${i} (click to omit)`
                          }
                          aria-pressed={omitted}
                          onClick={() => toggleOmit(i)}
                          style={{
                            // Per-frame crop rect is computed from grid geometry × frame scale — inline.
                            width: cellW,
                            height: cellH,
                            backgroundImage: `url(${sheetUrl})`,
                            backgroundSize: `${grid.cols! * cellW}px ${rows * cellH}px`,
                            backgroundPosition: `-${col * cellW}px -${row * cellH}px`,
                          }}
                        />
                      );
                    })}
                  </div>
                </figure>
              )}
            </div>

            {err && <FormError message={err} />}
            <FormWarnings warnings={warnings} />

            <div className={objActionsClass}>
              <Button
                type="button"
                disabled={busy || (isStrip && !grid.valid)}
                onClick={() => void commit()}
              >
                {busy ? 'Applying…' : 'Apply'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** An asset's display filename (last path segment of its id). */
function filenameOf(asset: CatalogAsset): string {
  return asset.id.split('/').pop() ?? asset.id;
}

/* ---- Regions editor (plan 017 step 4) ---- */

/** Fallback fit target for the editable sheet (before the 1–8× zoom multiplier), used only until the
 *  viewport's real size is measured (see `viewBox` below). Bigger than the Library's atlas picker
 *  (240) — the tab has the room, and region editing wants pixels to grab. */
const REGION_SHEET_FALLBACK = 480;
const REGION_ZOOM_MIN = 1;
const REGION_ZOOM_MAX = 8;
const REGION_ZOOM_STEP = 0.5;
const clampRegionZoom = (z: number): number =>
  Math.min(
    REGION_ZOOM_MAX,
    Math.max(REGION_ZOOM_MIN, Math.round(z / REGION_ZOOM_STEP) * REGION_ZOOM_STEP),
  );

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Static per-handle position + resize-cursor classes for `.editor-region-handle.h-*` — none of this is
 *  data-dependent, so it's a lookup of utility strings rather than inline style. */
const HANDLE_POS: Record<Handle, string> = {
  nw: 'left-0 top-0 cursor-nwse-resize',
  n: 'left-1/2 top-0 cursor-ns-resize',
  ne: 'left-full top-0 cursor-nesw-resize',
  e: 'left-full top-1/2 cursor-ew-resize',
  se: 'left-full top-full cursor-nwse-resize',
  s: 'left-1/2 top-full cursor-ns-resize',
  sw: 'left-0 top-full cursor-nesw-resize',
  w: 'left-0 top-1/2 cursor-ew-resize',
};

/** A live pointer-drag on the canvas: drawing a new box from an anchor, moving an existing one, or
 *  resizing one from a specific handle. `index` is the box being manipulated. */
type Drag =
  | { mode: 'draw'; index: number; ax: number; ay: number }
  | { mode: 'move'; index: number; px: number; py: number; orig: Box }
  | { mode: 'resize'; index: number; handle: Handle; orig: Box }
  | { mode: 'pan'; startX: number; startY: number; startLeft: number; startTop: number };

const clampN = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Box spanning two anchor points (draw), normalised so w/h are non-negative. */
function normRect(ax: number, ay: number, bx: number, by: number): Box {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** New box from dragging `handle` to sheet-point (sx,sy), keeping the opposite edge(s) fixed and
 *  clamped in-bounds with a 1px minimum on the moving edge. */
function resizeBox(orig: Box, handle: Handle, sx: number, sy: number, w: number, h: number): Box {
  let left = orig.x;
  let right = orig.x + orig.w;
  let top = orig.y;
  let bottom = orig.y + orig.h;
  if (handle === 'nw' || handle === 'w' || handle === 'sw') left = clampN(sx, 0, right - 1);
  if (handle === 'ne' || handle === 'e' || handle === 'se') right = clampN(sx, left + 1, w);
  if (handle === 'nw' || handle === 'n' || handle === 'ne') top = clampN(sy, 0, bottom - 1);
  if (handle === 'sw' || handle === 's' || handle === 'se') bottom = clampN(sy, top + 1, h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The `type:object` tab body — an editable overlay of `pack.json` `regions` boxes on a zoomable full
 * sheet, folded into the object-editor tab (plan 017 step 4). Boxes seed from the asset's current
 * catalog regions (or one whole-sheet box if it has none). Interactions: DOUBLE-CLICK a sprite to
 * auto-detect a tight box around it (client-side flood-fill, see `detectRegionAt`), DRAW (drag empty
 * sheet), SELECT+DELETE (click a box → live x/y/w/h + ✕/Delete), MOVE (drag body) + RESIZE (8 handles),
 * and GRID-SLICE (cols×rows → replace one box with an even grid — one action splits a merged crop row).
 * Save writes the whole list through `putAssetRegions` (+ a `type:object` override first if the sheet
 * isn't already an object) then the shared `loadCatalog` refetch, so the Library and this tab re-derive
 * from one fresh fetch. Reset writes an empty list = clears the override = auto-detection. The
 * scale/positioning math mirrors the Library's `AtlasSheetPicker` (deliberately not shared — the
 * pointer editing diverges enough that a focused copy is cleaner than a forced abstraction).
 */
function RegionsEditor({
  asset,
  sheetUrl,
  objectRoleRegions = false,
}: {
  asset: CatalogAsset;
  sheetUrl: string;
  /** plan 028: these regions are `object`-role decor on a sheet that KEEPS its `type` (a mixed
   *  `tile` sheet declaring placeable props). When set, Save tags each region `role:'object'` and
   *  does NOT demote the sheet to `type:'object'`. Default false = the classic reclassify path
   *  (regions ARE the object atlas; Save forces `type:'object'`). */
  objectRoleRegions?: boolean;
}) {
  const [boxes, setBoxes] = useState<Box[]>(() => seedRegions(asset));
  const [selected, setSelected] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewBox, setViewBox] = useState({ w: REGION_SHEET_FALLBACK, h: REGION_SHEET_FALLBACK });
  const [sliceCols, setSliceCols] = useState(2);
  const [sliceRows, setSliceRows] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const isCompact = useIsCompact();
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  // plan 031: a sticky pan toggle. Middle-mouse / hold-Space pan needs a mouse + keyboard, so on touch
  // there was no way to pan at all — a drag just drew or moved a box. With this on, ANY left/touch drag
  // pans the viewport instead (see `isPanTrigger`). Defaults off so drawing is still the primary drag.
  const [panMode, setPanMode] = useState(false);
  const hoveringRef = useRef(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const boxesRef = useRef(boxes);
  const pendingAnchor = useRef<{ cx: number; cy: number; ox: number; oy: number } | null>(null);
  // Decoded alpha channel of the sheet (row-major, one byte/pixel) for double-click auto-detect —
  // populated async once the PNG loads; null until then (a double-click before it's ready no-ops).
  const alphaRef = useRef<{ data: Uint8Array; w: number; h: number } | null>(null);

  useEffect(() => {
    boxesRef.current = boxes;
  }, [boxes]);

  // Decode the sheet to an offscreen canvas and cache its alpha channel so double-click detection reads
  // pixels without a server round-trip. Same-origin (Vite serves `/assets/…`), so the canvas isn't
  // tainted and `getImageData` is allowed. Re-runs only when the sheet URL changes.
  useEffect(() => {
    let cancelled = false;
    alphaRef.current = null;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const alpha = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
      alphaRef.current = { data: alpha, w: canvas.width, h: canvas.height };
    };
    img.src = sheetUrl;
    return () => {
      cancelled = true;
    };
  }, [sheetUrl]);

  // Re-seed boxes whenever the catalog's regions for this asset change VALUE (after our own Save's
  // refetch, or another surface's edit). Keyed on a stable signature, NOT `asset` identity, so a
  // same-value refetch (the Library's mount fetch) never clobbers an in-progress edit — same guard as
  // the outer form's re-seed effect.
  const regionsSig = JSON.stringify(asset.regions ?? null);
  useEffect(() => {
    setBoxes(seedRegions(asset));
    setSelected(null);
    setErr(null);
    setWarnings([]);
  }, [regionsSig]);

  // Fit the sheet to however much room the viewport actually has (the tab can be resized, and this
  // pane no longer lives in a small fixed-size popover) rather than a hardcoded pixel target.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitScale = Math.min(1, viewBox.w / asset.w, viewBox.h / asset.h);
  const scale = fitScale * zoom;
  const dispW = Math.round(asset.w * scale);
  const dispH = Math.round(asset.h * scale);

  // Cursor-anchored wheel zoom (mirrors AtlasSheetPicker): keep the content point under the cursor
  // stationary across the zoom, and use a native non-passive listener so `preventDefault` can stop the
  // viewport's own scroll.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    const a = pendingAnchor.current;
    if (!el || !a) return;
    el.scrollLeft = a.cx * scale - a.ox;
    el.scrollTop = a.cy * scale - a.oy;
    pendingAnchor.current = null;
  }, [scale]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      pendingAnchor.current = {
        cx: (el.scrollLeft + ox) / scale,
        cy: (el.scrollTop + oy) / scale,
        ox,
        oy,
      };
      setZoom((z) => clampRegionZoom(z + (e.deltaY < 0 ? REGION_ZOOM_STEP : -REGION_ZOOM_STEP)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale]);

  // Hold Space to pan (middle-mouse-drag works too, unconditionally — see onCanvasPointerDown). Gated
  // on `hoveringRef` (set by the viewport's pointer enter/leave below) rather than global focus: every
  // object-editor tab stays mounted for the app's lifetime and is only hidden via CSS `visibility`
  // (see EditorApp.tsx), so an ungated listener would steal the spacebar from whichever tab is actually
  // visible.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.code !== 'Space' || e.repeat || !hoveringRef.current) return;
      e.preventDefault();
      setSpaceHeld(true);
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === 'Space') setSpaceHeld(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  function toSheet(e: React.PointerEvent): { sx: number; sy: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      sx: Math.round(clampN((e.clientX - rect.left) / scale, 0, asset.w)),
      sy: Math.round(clampN((e.clientY - rect.top) / scale, 0, asset.h)),
    };
  }

  function capture(e: React.PointerEvent): void {
    canvasRef.current?.setPointerCapture(e.pointerId);
    // `preventScroll` so focusing the (tall) canvas doesn't scroll it into view inside the tab's
    // overflow-auto container — that jump pushed the toolbar (zoom + Pan toggle) up off-screen the
    // moment you started drawing or selecting a box. Focus itself is still needed for Space-pan/Delete.
    canvasRef.current?.focus({ preventScroll: true });
  }

  /** Middle mouse (any target), left+Space, or the sticky Pan toggle (`panMode`, the touch path) starts
   *  a pan instead of the usual draw/move/resize — checked ahead of those so it works whether the drag
   *  starts on empty sheet, a box, or a handle. `e.button === 0` covers a touch pointerdown too. */
  function isPanTrigger(e: React.PointerEvent): boolean {
    return e.button === 1 || (e.button === 0 && (spaceHeld || panMode));
  }

  function startPan(e: React.PointerEvent): void {
    e.preventDefault();
    const el = viewportRef.current;
    dragRef.current = {
      mode: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      startLeft: el?.scrollLeft ?? 0,
      startTop: el?.scrollTop ?? 0,
    };
    setIsPanning(true);
    capture(e);
  }

  function onCanvasPointerDown(e: React.PointerEvent): void {
    if (isPanTrigger(e)) {
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const { sx, sy } = toSheet(e);
    const index = boxes.length;
    setBoxes((bs) => [...bs, { x: sx, y: sy, w: 0, h: 0 }]);
    setSelected(index);
    dragRef.current = { mode: 'draw', index, ax: sx, ay: sy };
    capture(e);
  }

  function onBoxPointerDown(e: React.PointerEvent, i: number): void {
    if (isPanTrigger(e)) return; // let it bubble to onCanvasPointerDown to start the pan
    if (e.button !== 0) return;
    e.stopPropagation();
    const { sx, sy } = toSheet(e);
    setSelected(i);
    dragRef.current = { mode: 'move', index: i, px: sx, py: sy, orig: boxes[i] };
    capture(e);
  }

  function onHandlePointerDown(e: React.PointerEvent, i: number, handle: Handle): void {
    if (isPanTrigger(e)) return; // let it bubble to onCanvasPointerDown to start the pan
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected(i);
    dragRef.current = { mode: 'resize', index: i, handle, orig: boxes[i] };
    capture(e);
  }

  function onCanvasPointerMove(e: React.PointerEvent): void {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'pan') {
      const el = viewportRef.current;
      if (el) {
        el.scrollLeft = d.startLeft - (e.clientX - d.startX);
        el.scrollTop = d.startTop - (e.clientY - d.startY);
      }
      return;
    }
    const { sx, sy } = toSheet(e);
    setBoxes((bs) =>
      bs.map((b, i) => {
        if (i !== d.index) return b;
        if (d.mode === 'draw') return normRect(d.ax, d.ay, sx, sy);
        if (d.mode === 'move') {
          return {
            x: clampN(d.orig.x + (sx - d.px), 0, asset.w - d.orig.w),
            y: clampN(d.orig.y + (sy - d.py), 0, asset.h - d.orig.h),
            w: d.orig.w,
            h: d.orig.h,
          };
        }
        return resizeBox(d.orig, d.handle, sx, sy, asset.w, asset.h);
      }),
    );
  }

  function onCanvasPointerUp(e: React.PointerEvent): void {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
      canvasRef.current.releasePointerCapture(e.pointerId);
    }
    if (d.mode === 'pan') {
      setIsPanning(false);
      return;
    }
    // A draw that never grew (a bare click on empty sheet) leaves a degenerate box — drop it, which
    // makes an empty click read as "deselect".
    if (d.mode === 'draw') {
      const b = boxesRef.current[d.index];
      if (b && (b.w < 1 || b.h < 1)) {
        setBoxes((bs) => bs.filter((_, i) => i !== d.index));
        setSelected((sel) => (sel === d.index ? null : sel));
      }
    }
  }

  // Double-click a sprite → flood-fill its opaque blob (tight: gap:0, no bridging into touching
  // neighbours — see `detectRegionAt`) and add the box as a new selected region. Catches sprites the
  // batch pass drops or over-merges: it only cares what's under the click. No-op on a miss (empty space
  // beyond the seed radius) or before the alpha channel has decoded. The two stray degenerate boxes the
  // underlying click/click cycle draws are already dropped by `onCanvasPointerUp`, so this only ever
  // appends the detected box.
  function onCanvasDoubleClick(e: React.MouseEvent): void {
    const a = alphaRef.current;
    if (!a) return;
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = Math.floor(clampN((e.clientX - rect.left) / scale, 0, a.w - 1));
    const py = Math.floor(clampN((e.clientY - rect.top) / scale, 0, a.h - 1));
    const box = detectRegionAt(a.data, a.w, a.h, px, py);
    if (!box) return;
    let idx = 0;
    setBoxes((bs) => {
      idx = bs.length;
      return [...bs, box];
    });
    setSelected(idx);
  }

  function onCanvasKeyDown(e: React.KeyboardEvent): void {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) {
      e.preventDefault();
      deleteSelected();
    }
  }

  function deleteSelected(): void {
    if (selected === null) return;
    setBoxes((bs) => bs.filter((_, i) => i !== selected));
    setSelected(null);
  }

  function gridSlice(): void {
    if (selected === null) return;
    const target = boxes[selected];
    if (!target) return;
    const cells = sliceBox(target, sliceCols, sliceRows);
    setBoxes((bs) => [...bs.filter((_, i) => i !== selected), ...cells]);
    setSelected(null);
  }

  function updateSelected(field: keyof Box, raw: number): void {
    if (selected === null) return;
    const v = Math.max(0, Math.round(raw));
    setBoxes((bs) =>
      bs.map((b, i) => {
        if (i !== selected) return b;
        const next = { ...b, [field]: v };
        next.x = clampN(next.x, 0, asset.w - 1);
        next.y = clampN(next.y, 0, asset.h - 1);
        next.w = clampN(next.w, 1, asset.w - next.x);
        next.h = clampN(next.h, 1, asset.h - next.y);
        return next;
      }),
    );
  }

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const cleaned = sanitiseClientRegions(boxes, asset.w, asset.h);
      const relPath = assetRelPath(asset);
      // plan 028: object-role regions on a mixed `tile` sheet keep the sheet tiling — tag every
      // region `role:'object'` and do NOT demote the type. The classic path (regions ARE the object
      // atlas) forces `type:'object'` first when the sheet isn't already one (separate serialised
      // regen) and writes bare rects (implicit object role).
      const clean = objectRoleRegions
        ? cleaned.map((b) => ({ ...b, role: 'object' as const }))
        : cleaned;
      if (!objectRoleRegions && asset.type !== 'object') {
        await putAssetOverride(asset.pack, relPath, { type: 'object' });
      }
      const result = await putAssetRegions(asset.pack, relPath, clean);
      setWarnings(result.warnings);
      await loadCatalog();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // "Auto-detect objects" — hand the segmentation back to the SERVER rather than reimplementing it
  // client-side. `gen_regions.py` only runs a detection pass on `object`-classified sheets, so first
  // force `type:object` if the sheet isn't one yet (e.g. the user just picked "object" in the dropdown
  // but hasn't Saved), THEN PUT an empty regions list — which deletes the regions override so
  // `objects.py` `components()` (the connected-component detector) repopulates it. The `loadCatalog`
  // refetch re-seeds the boxes to the freshly detected set. In object-ROLE mode (a mixed `tile` sheet)
  // the server never auto-detects, so there this same button just clears the hand-authored regions.
  async function autoDetect(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const relPath = assetRelPath(asset);
      if (!objectRoleRegions && asset.type !== 'object') {
        await putAssetOverride(asset.pack, relPath, { type: 'object' });
      }
      const result = await putAssetRegions(asset.pack, relPath, []);
      setWarnings(result.warnings);
      await loadCatalog();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedBox = selected !== null ? boxes[selected] : null;

  return (
    <div className="flex flex-col gap-2">
      {/* One compact toolbar carries everything — count · zoom · pan on the left, the primary actions
          (Save / Clear) pinned right. No helper text, no separate bottom button row: the canvas is the
          primary function, so it gets the vertical budget. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[0.78rem] text-fg-dim">
          {boxes.length} region{boxes.length === 1 ? '' : 's'}
        </span>
        <div className="flex max-w-[220px] flex-none items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                className="size-[22px] shrink-0"
                disabled={zoom <= REGION_ZOOM_MIN}
                onClick={() => setZoom((z) => clampRegionZoom(z - REGION_ZOOM_STEP))}
              >
                −
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom out</TooltipContent>
          </Tooltip>
          <Slider
            className="w-[78px] shrink-0"
            min={REGION_ZOOM_MIN}
            max={REGION_ZOOM_MAX}
            step={REGION_ZOOM_STEP}
            value={[zoom]}
            aria-label="Region editor zoom"
            onValueChange={([v]) => setZoom(clampRegionZoom(v))}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                className="size-[22px] shrink-0"
                disabled={zoom >= REGION_ZOOM_MAX}
                onClick={() => setZoom((z) => clampRegionZoom(z + REGION_ZOOM_STEP))}
              >
                +
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom in</TooltipContent>
          </Tooltip>
          <span className="min-w-6 flex-none text-right text-[0.7rem] text-fg-dim">{zoom}×</span>
        </div>
        {/* Pan toggle (plan 031) — the touch-friendly equivalent of middle-mouse / hold-Space. While
            on, a drag anywhere pans instead of drawing/moving a box. A real tap target on compact. */}
        <Button
          type="button"
          variant={panMode ? 'default' : 'outline'}
          size="sm"
          aria-pressed={panMode}
          className="shrink-0"
          onClick={() => setPanMode((v) => !v)}
        >
          {panMode ? '✋ Panning' : '✋ Pan'}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save regions'}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void autoDetect()}
              >
                {objectRoleRegions ? 'Clear all' : 'Auto-detect'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Double-click a sprite to auto-box it · drag to draw · click a box to select (move,
              resize, slice, Delete) · ✋ Pan / middle-drag / Space to pan
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div
          className={cn(
            'min-w-[280px] grow shrink basis-[420px] overflow-auto rounded-[3px] bg-inset',
            // The canvas is the primary function, so it takes the tab's vertical budget. On desktop the
            // box fields sit in a side column, so the canvas can stay tall unconditionally. On compact
            // they wrap BELOW the canvas, so shrink it only WHEN a box is selected — keeps x/y/w/h +
            // Delete + slice reachable with a short scroll — and keep it near-full-height otherwise.
            isCompact
              ? selectedBox
                ? 'h-[48vh] max-h-[48vh]'
                : 'h-[68vh] max-h-[68vh]'
              : 'h-[80vh] max-h-[80vh]',
          )}
          ref={viewportRef}
          onPointerEnter={() => {
            hoveringRef.current = true;
          }}
          onPointerLeave={() => {
            hoveringRef.current = false;
          }}
        >
          <div
            ref={canvasRef}
            className={cn(
              'pixelated relative cursor-crosshair overflow-hidden rounded-[3px] bg-inset bg-no-repeat outline-none touch-none',
              (spaceHeld || panMode) && 'cursor-grab',
              isPanning && 'cursor-grabbing',
            )}
            tabIndex={0}
            // Sheet image + its scaled render size are computed — stay inline.
            style={{
              width: dispW,
              height: dispH,
              backgroundImage: `url(${sheetUrl})`,
              backgroundSize: `${dispW}px ${dispH}px`,
            }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onDoubleClick={onCanvasDoubleClick}
            onKeyDown={onCanvasKeyDown}
          >
            {boxes.map((b, i) => (
              <div
                key={i}
                className={cn(
                  'absolute cursor-move border border-gold-light/55 bg-gold-light/6 hover:border-gold-light/90',
                  i === selected && 'border-selection bg-selection/16',
                )}
                // Box rect is computed from stored sheet-space coords × scale — stays inline.
                style={{
                  left: b.x * scale,
                  top: b.y * scale,
                  width: Math.max(2, b.w * scale),
                  height: Math.max(2, b.h * scale),
                }}
                onPointerDown={(e) => onBoxPointerDown(e, i)}
              >
                {i === selected &&
                  HANDLES.map((hd) => (
                    <span
                      key={hd}
                      className={cn(
                        'absolute -mt-[5px] -ml-[5px] size-[9px] rounded-[2px] border border-inset bg-selection',
                        HANDLE_POS[hd],
                      )}
                      onPointerDown={(e) => onHandlePointerDown(e, i, hd)}
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>

        {selectedBox && (
          <div
            className={cn(
              'flex min-w-[180px] grow shrink basis-[200px] flex-col gap-3',
              // Desktop: a slim side column beside the canvas. Compact: full-width under it (the canvas
              // takes the whole row first), so the box fields aren't squeezed into a narrow gutter.
              isCompact ? 'basis-full' : 'max-w-[260px]',
            )}
          >
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                {(['x', 'y', 'w', 'h'] as const).map((f) => (
                  <ObjField key={f} label={f}>
                    <NumberInput
                      min={f === 'w' || f === 'h' ? 1 : 0}
                      value={selectedBox[f]}
                      className={cn(objInputClass, 'w-full')}
                      onValue={(n) => updateSelected(f, n)}
                    />
                  </ObjField>
                ))}
              </div>
              {/* plan 028: per-region role. One role in this MVP (`object`), so a read-only badge —
                  the field exists + persists (Save tags every region `object`), extensible to a
                  Select when `tile`-role regions land. */}
              {objectRoleRegions && (
                <ObjField label="Role">
                  <span className="inline-flex w-fit items-center rounded-[3px] border border-border bg-panel-2 px-1.5 py-0.5 text-[0.72rem] text-fg-dim">
                    object
                  </span>
                </ObjField>
              )}
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="self-start"
                onClick={deleteSelected}
              >
                ✕ Delete box
              </Button>
              <div className="flex flex-col gap-1">
                <span className="text-[0.72rem] text-muted-2">Grid-slice into</span>
                <div className="flex items-center gap-1.5">
                  <NumberInput
                    min={1}
                    aria-label="Columns"
                    value={sliceCols}
                    className={cn(objInputClass, 'w-[52px] px-1.5')}
                    onValue={(n) => setSliceCols(Math.max(1, Math.round(n)))}
                  />
                  <span>×</span>
                  <NumberInput
                    min={1}
                    aria-label="Rows"
                    value={sliceRows}
                    className={cn(objInputClass, 'w-[52px] px-1.5')}
                    onValue={(n) => setSliceRows(Math.max(1, Math.round(n)))}
                  />
                  <Button type="button" size="sm" onClick={gridSlice}>
                    Slice
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {err && <FormError message={err} />}
      <FormWarnings warnings={warnings} />
    </div>
  );
}
