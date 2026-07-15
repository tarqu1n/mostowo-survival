import { useEffect, useMemo, useState } from 'react';
import type { DecorRegion } from '../systems/mapFormat';
import { tilesetAssetUrl } from './textureLoading';
import type { AssetCatalog, CatalogAsset, CatalogRegion } from './catalog';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { cn } from './lib/utils';

/**
 * Reusable catalog sprite picker (plan 021 step 8) — used by the Node Types panel's skin manager to
 * pick a skin's LIVE sprite and its optional DEPLETED sprite. Deliberately self-contained rather than
 * extracted out of `LibraryPanel` (per the plan's risk call: `LibraryPanel`'s catalog browsing is
 * deeply entangled with map-placement arming/favourites/reclassify — pulling a shared component out
 * of it risked regressing decor placement for a UI surface with no test coverage of its own). It reads
 * the SAME catalog data (`AssetCatalog`/`CatalogAsset`/`CatalogRegion`) and produces the exact same
 * `{asset, region?}` shape `DecorObject`/`NodeSkinDef` both use, so a skin's chosen sprite renders
 * identically to a placed decor object with the same asset+region.
 *
 * Two steps, mirroring the Library's own two-shape split (step 7b):
 *  1. A searchable thumbnail grid of every catalog asset. Clicking an asset with NO detected
 *     `regions` picks it immediately (whole image, no crop) — matches `AssetCard`'s behaviour.
 *  2. Clicking an asset WITH `regions` (an atlas sheet, e.g. `Rocks.png`) drills into a region step:
 *     the whole sheet at a fixed fit-to-width scale with each region as a clickable hotspot — mirrors
 *     `AtlasSheetPicker`'s "show the whole sheet, click the sprite on it" without its zoom/pan
 *     (unnecessary complexity for a one-shot pick). Matches the Library's convention of NOT offering
 *     a "whole sheet" fallback once an asset has regions — a multi-sprite atlas is always cropped.
 */

const GRID_MAX_PX = 320;

function catalogAssetUrl(asset: CatalogAsset): string {
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  return tilesetAssetUrl(asset.pack, path);
}

export function NodeSpritePickerDialog({
  open,
  onOpenChange,
  title,
  catalog,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  catalog: AssetCatalog | null;
  onPick: (asset: string, region?: DecorRegion) => void;
}) {
  const [search, setSearch] = useState('');
  const [drillInto, setDrillInto] = useState<CatalogAsset | null>(null);

  // Reset transient state whenever the dialog closes, so reopening it always starts fresh.
  useEffect(() => {
    if (!open) {
      setSearch('');
      setDrillInto(null);
    }
  }, [open]);

  const assets = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    if (q.length === 0) return catalog.assets;
    return catalog.assets.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [catalog, search]);

  function pickWhole(asset: CatalogAsset): void {
    onPick(asset.id, undefined);
    onOpenChange(false);
  }

  function pickRegion(asset: CatalogAsset, region: CatalogRegion): void {
    onPick(asset.id, { x: region.x, y: region.y, w: region.w, h: region.h });
    onOpenChange(false);
  }

  function selectAsset(asset: CatalogAsset): void {
    if ((asset.regions?.length ?? 0) > 0) {
      setDrillInto(asset);
    } else {
      pickWhole(asset);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col overflow-hidden sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {drillInto ? (
          <RegionStep
            asset={drillInto}
            onBack={() => setDrillInto(null)}
            onPickRegion={(region) => pickRegion(drillInto, region)}
          />
        ) : (
          <>
            <Input
              autoFocus
              placeholder="Search assets by id / category / tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="grid grid-cols-4 gap-2 overflow-y-auto pr-1">
              {assets.length === 0 && (
                <p className="col-span-4 py-6 text-center text-[0.85rem] text-muted-2">
                  {catalog ? 'No matches.' : 'Catalog still loading…'}
                </p>
              )}
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className="flex flex-col items-center gap-1 rounded-md border border-transparent p-1.5 text-left hover:border-active hover:bg-surface"
                  title={asset.id}
                  onClick={() => selectAsset(asset)}
                >
                  <span
                    className="pixelated h-10 w-10 flex-none rounded-[2px] bg-inset bg-contain bg-center bg-no-repeat"
                    style={{ backgroundImage: `url(${catalogAssetUrl(asset)})` }}
                  />
                  <span className="w-full truncate text-center text-[0.68rem] text-fg-muted">
                    {asset.id.split('/').pop()}
                  </span>
                  {(asset.regions?.length ?? 0) > 0 && (
                    <span className="text-[0.62rem] text-muted-2">
                      {asset.regions!.length} sprites
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Region-hotspot step (drilled into from an atlas-sheet asset) — a fixed fit-to-width render of the
 *  whole sheet with a clickable hotspot per detected region. Mirrors `LibraryPanel`'s
 *  `AtlasSheetPicker` hotspot geometry/styling without its zoom/pan (a one-shot pick doesn't need
 *  it — see module doc). */
function RegionStep({
  asset,
  onBack,
  onPickRegion,
}: {
  asset: CatalogAsset;
  onBack: () => void;
  onPickRegion: (region: CatalogRegion) => void;
}) {
  const url = catalogAssetUrl(asset);
  const scale = Math.min(1, GRID_MAX_PX / Math.max(asset.w, asset.h));
  const dispW = Math.round(asset.w * scale);
  const dispH = Math.round(asset.h * scale);
  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" className="self-start" onClick={onBack}>
        ← Back to search
      </Button>
      <p className="text-[0.8rem] text-fg-dim">
        Click a sprite on the sheet to crop it as this skin.
      </p>
      <div className="max-h-[420px] overflow-auto rounded-[3px] bg-inset">
        <div
          className="pixelated relative bg-no-repeat"
          style={{
            width: dispW,
            height: dispH,
            backgroundImage: `url(${url})`,
            backgroundSize: `${dispW}px ${dispH}px`,
          }}
        >
          {(asset.regions ?? []).map((region) => (
            <button
              key={region.key}
              type="button"
              className={cn(
                'absolute m-0 rounded-[2px] border p-0',
                'border-[rgba(240,216,144,0.35)] bg-[rgba(240,216,144,0.08)] hover:border-[rgba(240,216,144,0.85)] hover:bg-[rgba(240,216,144,0.22)]',
              )}
              title={`${region.w}×${region.h} @ (${region.x},${region.y})`}
              style={{
                left: region.x * scale,
                top: region.y * scale,
                width: Math.max(4, region.w * scale),
                height: Math.max(4, region.h * scale),
              }}
              onClick={() => onPickRegion(region)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
