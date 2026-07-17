import { useEffect, useMemo, useState } from 'react';
import type { DecorRegion } from '../systems/mapFormat';
import { tilesetAssetUrl } from './textureLoading';
import { regionKey, type AssetCatalog, type CatalogAsset, type CatalogRegion } from './catalog';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { cn } from './lib/utils';
import { useIsCompact } from './hooks/useIsCompact';

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
 *  1. A searchable thumbnail grid of catalog assets — `role:'actor'` sprites (creatures/NPCs) are
 *     hidden by default (a node's sprite is object-ish decor, not a character), behind an "Actors"
 *     toggle, mirroring the Library palette's actor-hiding (plan 032). Clicking an asset with NO detected
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
  const isCompact = useIsCompact();
  const [search, setSearch] = useState('');
  const [showActors, setShowActors] = useState(false);
  const [drillInto, setDrillInto] = useState<CatalogAsset | null>(null);

  // Reset transient state whenever the dialog closes, so reopening it always starts fresh (actors
  // hidden again).
  useEffect(() => {
    if (!open) {
      setSearch('');
      setShowActors(false);
      setDrillInto(null);
    }
  }, [open]);

  const assets = useMemo(() => {
    if (!catalog) return [];
    // Actors (creature/NPC sprites) are excluded by default — a node skin is object-ish decor, not a
    // character — unless the "Actors" toggle is on. Applied before the text filter so the count and
    // the "No matches" state both reflect the role gate.
    const base = showActors ? catalog.assets : catalog.assets.filter((a) => a.role !== 'actor');
    const q = search.trim().toLowerCase();
    if (q.length === 0) return base;
    return base.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [catalog, search, showActors]);

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
      <DialogContent
        className={cn(
          'flex max-h-[80vh] flex-col overflow-hidden sm:max-w-[560px]',
          isCompact && 'max-h-[90dvh]',
        )}
      >
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
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                className={cn('flex-1', isCompact && 'h-11')}
                placeholder="Search assets by id / category / tag…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {/* Actors are hidden by default (see the `assets` memo); this reveals them. Styled like
                  the Library's role-filter chips (plan 032) for a consistent active-look. */}
              <button
                type="button"
                aria-pressed={showActors}
                onClick={() => setShowActors((v) => !v)}
                title="Show character/creature (actor) sprites — hidden by default"
                className={cn(
                  'flex-none rounded-md border border-transparent bg-inset px-2 py-1 text-[0.75rem] text-fg-muted hover:bg-surface',
                  showActors && 'border-gold-light bg-surface text-fg-bright',
                  isCompact && 'min-h-11 px-3 py-2 text-[0.85rem]',
                )}
              >
                Actors
              </button>
            </div>
            <div
              className={cn(
                'grid grid-cols-4 gap-2 overflow-y-auto pr-1',
                isCompact && 'grid-cols-3 gap-3',
              )}
            >
              {assets.length === 0 && (
                <p className="col-span-full py-6 text-center text-[0.85rem] text-muted-2">
                  {catalog ? 'No matches.' : 'Catalog still loading…'}
                </p>
              )}
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-md border border-transparent p-1.5 text-left hover:border-active hover:bg-surface',
                    isCompact && 'gap-1.5 p-2',
                  )}
                  title={asset.id}
                  onClick={() => selectAsset(asset)}
                >
                  <span
                    className={cn(
                      'pixelated h-10 w-10 flex-none rounded-[2px] bg-inset bg-contain bg-center bg-no-repeat',
                      isCompact && 'h-14 w-14',
                    )}
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
  const isCompact = useIsCompact();
  const url = catalogAssetUrl(asset);
  // On compact, render the sheet bigger (viewport scrolls to compensate) so small atlas regions land
  // closer to a comfortable tap size — the hotspot geometry is still an exact crop of the sheet, so it
  // can't be padded up to 44px without misregistering the pick; enlarging the whole sheet is the
  // additive lever available here (a note on the disproportionate-cost tradeoff in the PR report).
  const gridMaxPx = isCompact ? GRID_MAX_PX * 1.6 : GRID_MAX_PX;
  const scale = Math.min(1, gridMaxPx / Math.max(asset.w, asset.h));
  const dispW = Math.round(asset.w * scale);
  const dispH = Math.round(asset.h * scale);
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        className={cn('self-start', isCompact && 'h-11')}
        onClick={onBack}
      >
        ← Back to search
      </Button>
      <p className="text-[0.8rem] text-fg-dim">
        Click a sprite on the sheet to crop it as this skin.
      </p>
      <div
        className={cn(
          'max-h-[420px] overflow-auto rounded-[3px] bg-inset',
          isCompact && 'max-h-[55vh]',
        )}
      >
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
              key={regionKey(region)}
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
