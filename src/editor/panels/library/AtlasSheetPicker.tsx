import { useState } from 'react';
import type { DecorRegion } from '../../../systems/mapFormat';
import { tilesetAssetUrl } from '../../textureLoading';
import { regionKey, type CatalogAsset, type CatalogRegion } from '../../catalog';
import type { ArmedObjectAsset } from '../../store/editorStore';
import { Button } from '../../ui/button';
import { Slider } from '../../ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { cn } from '../../lib/utils';
import { useIsCompact } from '../../hooks/useIsCompact';
import { usePanZoom } from '../../hooks/usePanZoom';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, clampZoom } from '../../zoom';
import { isObjectRegion } from './shared';
import { AssetReclassify } from './AssetReclassify';

/** Max on-screen width/height (px) for an atlas sheet preview (step 7b) — caps a dense sheet like
 *  `Furniture.png` (800×864) to something that fits the Library pane; hotspots scale down with it so
 *  they still land on the right sprite. Sheets already smaller than this render at native size. */
const ATLAS_PREVIEW_MAX_PX = 240;

/**
 * Atlas sheet picker (step 7b) — an `object` asset with detected `regions` (e.g. `Furniture.png`,
 * `Rocks.png`). Renders the WHOLE sheet with each region as an absolutely-positioned transparent
 * hotspot button — "show the whole sheet, click the sprite on it" per the user's explicit ask. A
 * swatch-per-region grid would misrepresent these sheets: regions are irregular sizes at irregular
 * positions (not a uniform tile grid), so cropping each into a same-size cell would lose the sheet's
 * actual layout/relationships. A base "fit" scale caps a big sheet down to `ATLAS_PREVIEW_MAX_PX`; a
 * `zoom` control (1–8×, via the +/− buttons, the slider, or the mouse wheel over the sheet)
 * multiplies it so the author can enlarge dense sheets enough to see/click small sprites — the canvas
 * overflows into a scrollable viewport and hotspots scale with the effective scale so they stay on
 * their sprite. Pan/zoom (cursor-anchored wheel zoom + hold-Space/middle-drag pan) is provided by the
 * shared `usePanZoom` hook (plan 043 step 5); zoom bounds/clamp come from `zoom.ts`.
 */
export function AtlasSheetPicker({
  asset,
  armedObjectAsset,
  onArmRegion,
  heading,
}: {
  asset: CatalogAsset;
  armedObjectAsset: ArmedObjectAsset | null;
  onArmRegion: (assetId: string, region: DecorRegion) => void;
  /** Label line above the sheet. Defaults to the file name; a mixed tile sheet (plan 028) passes a
   *  distinguishing heading so its "Objects on …" hotspot view reads apart from the frame grid above. */
  heading?: string;
}) {
  const isCompact = useIsCompact();
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  // On compact, fit to a bigger budget (mirrors NodeSpritePickerDialog's RegionStep) — the sheet is the
  // same "click the sprite on the sheet" hotspot picker, so a bigger base render gives every hotspot a
  // bigger tap target before the user even reaches for the zoom control.
  const previewMaxPx = isCompact ? ATLAS_PREVIEW_MAX_PX * 1.4 : ATLAS_PREVIEW_MAX_PX;
  const fitScale = Math.min(1, previewMaxPx / Math.max(asset.w, asset.h));

  // `usePanZoom` owns the 1–8× zoom, but its cursor-anchored wheel-zoom + re-anchor need the EFFECTIVE
  // scale (fitScale × zoom), which depends on the zoom the hook returns. Mirror that effective scale
  // into state and feed it back: adjusting it during render (React's derived-state pattern) re-renders
  // synchronously BEFORE paint, so the hook's `[scale]` layout effect always sees the current scale and
  // no stale-sized frame is ever painted — matching the pre-refactor single-`scale` behaviour.
  const [scale, setScale] = useState(fitScale);
  const {
    zoom,
    setZoom,
    spaceHeld,
    isPanning,
    viewportRef,
    hoveringRef,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
  } = usePanZoom(scale);
  const nextScale = fitScale * zoom;
  if (nextScale !== scale) setScale(nextScale);

  const dispW = Math.round(asset.w * scale);
  const dispH = Math.round(asset.h * scale);
  const armedRegion = armedObjectAsset?.assetId === asset.id ? armedObjectAsset.region : undefined;

  return (
    <div className="relative">
      <div
        className="mb-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.75rem] text-fg-dim"
        title={asset.id}
      >
        {heading ?? asset.id.split('/').pop()}
      </div>
      {/* Zoom-row controls all share a 22px height so the row keeps ONE baseline, and the whole row is
          budgeted to ~200px because the Library column is a fixed 240px — every control size below is
          picked to fit that budget with the cog on the end. On compact the Library is a full-width
          drawer (Step 8), not the fixed 240px column, so the row is freed up to use bigger controls. */}
      <div className={cn('mb-1.5 flex items-center gap-1.5', isCompact && 'gap-2.5')}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              className={cn('size-[22px] shrink-0', isCompact && 'size-10')}
              disabled={zoom <= ZOOM_MIN}
              onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
            >
              −
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom out</TooltipContent>
        </Tooltip>
        <Slider
          className={cn('w-[78px] shrink-0', isCompact && 'w-[110px]')}
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP}
          value={[zoom]}
          aria-label="Atlas zoom"
          onValueChange={([v]) => setZoom(clampZoom(v))}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              className={cn('size-[22px] shrink-0', isCompact && 'size-10')}
              disabled={zoom >= ZOOM_MAX}
              onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
            >
              +
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom in</TooltipContent>
        </Tooltip>
        <span
          className={cn(
            'min-w-6 flex-none text-right text-[0.7rem] text-fg-dim',
            isCompact && 'text-[0.8rem]',
          )}
        >
          {zoom}×
        </span>
        <AssetReclassify asset={asset} inline />
      </div>
      {/* Plain overflow div, NOT shadcn ScrollArea: this viewport's scroll offset is driven imperatively
          through `viewportRef` — cursor-anchored wheel-zoom re-anchoring (layout effect), space/middle-
          drag panning that reads & writes scrollLeft/scrollTop, and a non-passive native wheel listener.
          Radix ScrollArea owns its internal viewport node and doesn't expose that ref, so it can't host
          this logic. (Convention: ScrollArea is for simple overflow; keep a plain div for ref-driven
          imperative scroll/pan/zoom.) */}
      <div
        className={cn(
          'max-h-[320px] overflow-auto rounded-[3px] bg-inset',
          isCompact && 'max-h-[50vh]',
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
          className={cn(
            'pixelated relative overflow-hidden rounded-[3px] bg-inset bg-no-repeat',
            spaceHeld && 'cursor-grab',
            isPanning && 'cursor-grabbing',
          )}
          // Sheet image + its scaled render size are computed — stay inline.
          style={{
            width: dispW,
            height: dispH,
            backgroundImage: `url(${url})`,
            backgroundSize: `${dispW}px ${dispH}px`,
          }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
        >
          {(asset.regions ?? []).filter(isObjectRegion).map((region: CatalogRegion) => {
            const isArmed =
              armedRegion !== undefined &&
              armedRegion.x === region.x &&
              armedRegion.y === region.y &&
              armedRegion.w === region.w &&
              armedRegion.h === region.h;
            return (
              <button
                key={regionKey(region)}
                className={cn(
                  'absolute m-0 rounded-[2px] border p-0',
                  isArmed
                    ? 'border-selection bg-[rgba(95,208,255,0.28)]'
                    : 'border-[rgba(240,216,144,0.35)] bg-[rgba(240,216,144,0.08)] hover:border-[rgba(240,216,144,0.85)] hover:bg-[rgba(240,216,144,0.22)]',
                )}
                title={`${region.w}×${region.h} @ (${region.x},${region.y})`}
                // Hotspot rect is computed from region geometry × scale — stays inline.
                style={{
                  left: region.x * scale,
                  top: region.y * scale,
                  width: Math.max(4, region.w * scale),
                  height: Math.max(4, region.h * scale),
                }}
                onClick={() =>
                  onArmRegion(asset.id, { x: region.x, y: region.y, w: region.w, h: region.h })
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
