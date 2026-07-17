import type { DecorRegion } from '../../systems/mapFormat';
import type { AssetCatalog } from '../catalog';
import { cn } from '../lib/utils';
import { PLACEHOLDER_SKIN_ASSET } from '../store/editorStore';
import { tilesetAssetUrl } from '../textureLoading';

/**
 * A square, pixel-crisp thumbnail for a node skin's (or its depleted stump's) `asset`/`region` —
 * shared by the Node Types panel's `SkinManager` (40px swatches) and the Inspector's node preview (a
 * larger image when a placed node is selected). Extracted from `NodeTypesTab`'s original local
 * `SpriteThumb` so both surfaces render skins identically; `size` is the only per-call knob.
 *
 * The crop math mirrors `LibraryPanel`'s atlas previews: for a `region`, scale so the region's LARGER
 * dimension fits the slot, then clip to the region's own scaled box (NOT a fixed square) — a square
 * clip on a tall, narrow tree would reveal the neighbouring sprite on the sheet. Degrades to labelled
 * "unset" (the unassigned-skin placeholder) / "missing" (asset not in the catalog) tiles rather than a
 * broken image, exactly as the Node Types panel did.
 */
export function SkinThumb({
  assetId,
  region,
  catalog,
  size = 40,
  className,
}: {
  assetId: string;
  region?: DecorRegion;
  catalog: AssetCatalog | null;
  size?: number;
  className?: string;
}) {
  if (assetId === PLACEHOLDER_SKIN_ASSET) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-[2px] border border-dashed border-border bg-inset text-center text-[0.6rem] leading-tight text-muted-2',
          className,
        )}
        style={{ width: size, height: size }}
      >
        unset
      </div>
    );
  }
  const asset = catalog?.assets.find((a) => a.id === assetId);
  if (!asset) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-[2px] border border-danger-strong bg-inset text-center text-[0.6rem] leading-tight text-danger',
          className,
        )}
        style={{ width: size, height: size }}
        title={assetId}
      >
        missing
      </div>
    );
  }
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  if (region) {
    const scale = size / Math.max(region.w, region.h);
    return (
      <div
        className={cn('flex items-center justify-center rounded-[2px] bg-inset', className)}
        style={{ width: size, height: size }}
        title={assetId}
      >
        <div
          className="pixelated overflow-hidden bg-no-repeat"
          style={{
            width: region.w * scale,
            height: region.h * scale,
            backgroundImage: `url(${url})`,
            backgroundPosition: `${-region.x * scale}px ${-region.y * scale}px`,
            backgroundSize: `${asset.w * scale}px ${asset.h * scale}px`,
          }}
        />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'pixelated rounded-[2px] bg-inset bg-contain bg-center bg-no-repeat',
        className,
      )}
      style={{ width: size, height: size, backgroundImage: `url(${url})` }}
      title={assetId}
    />
  );
}
