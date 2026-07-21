import { type CSSProperties } from 'react';
import { TILE_SIZE } from '../../../config';
import type { ParsedNodeDef } from '../../../systems/nodeDefs';
import { parseAssetId, tilesetAssetUrl } from '../../textureLoading';
import { colorToHex } from '../../nodeTypesUi';
import type { TerrainDef } from '../../terrainCatalog';
import { catalogTileCols, type AssetCatalog, type CatalogAsset } from '../../catalog';
import { useEditorStore, type ArmedObjectAsset } from '../../store/editorStore';
import {
  AssetSwatch,
  EMPTY_NODE_DEFS,
  nodePreviewUrl,
  resolveRecentSwatch,
  TERRAIN_SHEET_COLS_FALLBACK,
} from '../assetSwatch';
import { cn } from '../../lib/utils';
import { useIsCompact } from '../../hooks/useIsCompact';
import { useLongPress } from '../../hooks/useLongPress';
import { toast } from 'sonner';
import {
  PREVIEW_PX,
  COMPACT_PREVIEW_PX,
  libLabelClass,
  libSwatchClass,
  libCardClass,
  isObjectRegion,
} from './shared';
import { AssetReclassify } from './AssetReclassify';

/** On-screen swatch size (px) for a terrain's cropped fill-frame preview — matches `libSwatchClass`'s
 *  fixed `h-10 w-10` (2.5rem = 40px at the default root size) so the crop math lines up with the
 *  rendered box exactly, unlike `PREVIEW_PX`'s bigger frame-grid swatches. */
const TERRAIN_SWATCH_PX = 40;

/** The favourite heart (`.lib-heart`): pink when favourited, else muted. `className` sets placement —
 *  absolute in a frame swatch, static in a card row. Click is stopped so it never arms/paints the card. */
function FavHeart({
  fav,
  onToggle,
  className,
}: {
  fav: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex-none cursor-pointer text-[0.7rem]',
        fav ? 'text-pink' : 'text-border-muted',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {fav ? '♥' : '♡'}
    </span>
  );
}

/** A tile asset's expanded frame grid — one clickable swatch per frame, each with its own favourite
 *  heart (tile favourites are frame-specific, e.g. "these 3 grass variants"). `cols` is derived from
 *  the catalog's own `w`/`tileSize`, never hardcoded. */
export function TileFrameGrid({
  asset,
  brushAsset,
  favourites,
  onPick,
  onToggleFavourite,
}: {
  asset: CatalogAsset;
  brushAsset: string | null;
  favourites: ReadonlySet<string>;
  onPick: (assetId: string) => void;
  onToggleFavourite: (assetId: string) => void;
}) {
  const isCompact = useIsCompact();
  // Fixed-size offender (plan 027 step 10): the frame grid is a real spritesheet's own row/col layout,
  // so a wide sheet (e.g. a 25-col Floors tileset) is `cols * previewPx` px wide regardless — shrinking
  // the swatch on compact is the additive lever that keeps it usable in a ~320px drawer without
  // reflowing the grid away from its 1:1 match to the source sheet (see `COMPACT_PREVIEW_PX`'s doc).
  const previewPx = isCompact ? COMPACT_PREVIEW_PX : PREVIEW_PX;
  const cols = catalogTileCols(asset, TILE_SIZE);
  const nativeRows = Math.max(1, Math.round(asset.h / TILE_SIZE));
  const frames = asset.frames ?? cols * nativeRows;
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const bgSize = `${cols * previewPx}px ${nativeRows * previewPx}px`;
  // Occlusion (plan 028): on a mixed sheet, an object-role region declares a placeable prop; the 16px
  // grid cells beneath it are unusable terrain fragments, so hide them here (the props themselves are
  // armed from the AtlasSheetPicker rendered alongside). A cell is hidden iff its CENTRE falls inside
  // some object region — not any-pixel overlap, so a region bleeding 1px into a neighbouring terrain
  // cell can't silently delete that legitimate tile. `cols` is already floored (catalogTileCols), so a
  // sheet whose width isn't a clean multiple of TILE_SIZE still yields integer col/row math — no crash.
  const objRegions = (asset.regions ?? []).filter(isObjectRegion);
  const isOccluded = (col: number, row: number): boolean => {
    if (objRegions.length === 0) return false;
    const cx = col * TILE_SIZE + TILE_SIZE / 2;
    const cy = row * TILE_SIZE + TILE_SIZE / 2;
    return objRegions.some(
      (rg) => cx >= rg.x && cx < rg.x + rg.w && cy >= rg.y && cy < rg.y + rg.h,
    );
  };

  return (
    <div className="relative">
      <AssetReclassify asset={asset} />
      <div
        className="mb-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.75rem] text-fg-dim"
        title={asset.id}
      >
        {asset.id.split('/').pop()}
      </div>
      <div
        className={cn(
          'grid max-h-[260px] gap-px overflow-auto rounded-[3px] bg-inset p-0.5',
          isCompact && 'max-h-[45vh] gap-0.5 p-1',
        )}
        // gridTemplateColumns is computed from the catalog's own tile geometry — stays inline.
        style={{ gridTemplateColumns: `repeat(${cols}, ${previewPx}px)` }}
      >
        {Array.from({ length: frames }, (_, frame) => {
          const col = frame % cols;
          const row = Math.floor(frame / cols);
          if (isOccluded(col, row)) return null;
          const frameId = `${asset.id}#${frame}`;
          return (
            <TileFrameButton
              key={frame}
              frame={frame}
              frameId={frameId}
              isActive={brushAsset === frameId}
              isFav={favourites.has(frameId)}
              isCompact={isCompact}
              swatchStyle={{
                width: previewPx,
                height: previewPx,
                backgroundImage: `url(${url})`,
                backgroundPosition: `-${col * previewPx}px -${row * previewPx}px`,
                backgroundSize: bgSize,
              }}
              onPick={onPick}
              onToggleFavourite={onToggleFavourite}
            />
          );
        })}
      </div>
    </div>
  );
}

/** One frame swatch in a `TileFrameGrid` (plan 030 step 6 extracted this from the grid's map so it can
 *  own a `useLongPress` hook — hooks can't run inside a loop). Desktop: plain `onClick` pick + the
 *  visible overlay `FavHeart` (unchanged). Compact/touch: the long-press hook governs BOTH gestures —
 *  tap = pick, long-press = toggle favourite (with a toast) — and the overlay heart is dropped (it was
 *  the tap-thief on touch), so long-press is the only favourite path here. */
function TileFrameButton({
  frame,
  frameId,
  isActive,
  isFav,
  isCompact,
  swatchStyle,
  onPick,
  onToggleFavourite,
}: {
  frame: number;
  frameId: string;
  isActive: boolean;
  isFav: boolean;
  isCompact: boolean;
  swatchStyle: CSSProperties;
  onPick: (assetId: string) => void;
  onToggleFavourite: (assetId: string) => void;
}) {
  // Palette pick-mode selection state (plan 033 step 4) — read straight from the store so the check
  // overlay re-renders the instant this frame is (de)selected. In pick mode a tap still routes through
  // `onPick` (=`pickTile`), which branches to `togglePalettePickTile`; only the affordance changes here.
  const palettePickMode = useEditorStore((s) => s.palettePickMode);
  const palettePicked = useEditorStore((s) => s.palettePickSelection.includes(frameId));
  const showPickOverlay = palettePickMode && palettePicked;
  const longPress = useLongPress({
    onTap: () => onPick(frameId),
    onLongPress: () => {
      onToggleFavourite(frameId);
      toast(isFav ? 'Removed favourite' : '♥ Favourited', { duration: 1200 });
    },
  });
  return (
    <button
      className={cn(
        'relative rounded-[2px] border border-transparent bg-transparent p-0 leading-[0]',
        isActive && 'border-gold-light',
        // Selected-for-palette wins the ring so the multi-select is unmistakable while picking.
        showPickOverlay && 'border-selection',
      )}
      title={`frame ${frame}`}
      // Compact: the hook owns tap+long-press and swallows the trailing click; desktop keeps plain click.
      {...(isCompact ? longPress : { onClick: () => onPick(frameId) })}
    >
      <span
        className="pixelated block"
        // Per-frame sprite crop — backgroundImage/Position/Size are computed, so inline.
        style={swatchStyle}
      />
      {showPickOverlay && (
        // Selection tint + check — reuses the AtlasSheetPicker armed-region colour for one consistent
        // "this is selected" language across the Library.
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[rgba(95,208,255,0.28)] text-[0.7rem] font-bold text-fg-bright">
          ✓
        </span>
      )}
      {!isCompact && (
        <FavHeart
          fav={isFav}
          onToggle={() => onToggleFavourite(frameId)}
          className="absolute top-0 right-px"
        />
      )}
    </button>
  );
}

/** One "Nodes" pseudo-category entry (step 7) — click arms `armedNodeRef` for the Place tool. Nodes
 *  aren't favouritable (favourites are catalog asset ids; `NODES` refs are a different id space). A
 *  def whose default skin has no resolvable sprite yet (see `nodePreviewUrl`'s doc) falls back to a
 *  flat swatch tinted with the def's own `color` instead of crashing. */
export function NodeCard({
  def,
  isArmed,
  onArm,
}: {
  def: ParsedNodeDef;
  isArmed: boolean;
  onArm: () => void;
}) {
  const isCompact = useIsCompact();
  const url = nodePreviewUrl(def);
  return (
    <button className={libCardClass(isArmed, isCompact)} title={def.id} onClick={onArm}>
      {url ? (
        <span className={libSwatchClass} style={{ backgroundImage: `url(${url})` }} />
      ) : (
        <span
          className={cn(
            libSwatchClass,
            'flex items-center justify-center bg-none text-[0.6rem] font-semibold text-fg-dim',
          )}
          style={{ backgroundColor: colorToHex(def.color) }}
          title="No sprite assigned yet — set one in the Node Types panel"
        >
          ?
        </span>
      )}
      <span className={libLabelClass}>{def.name}</span>
    </button>
  );
}

/** One "Terrains" pseudo-category entry (step 10) — click arms the terrain brush. The preview crops
 *  the terrain's `fillFrame` (the FULL_KEY / fully-surrounded interior tile — also what a big filled
 *  area mostly reads as) out of its sheet, scaled to the swatch box; when the asset catalog hasn't
 *  resolved a matching sheet entry yet (a load-order race — the two catalogs fetch independently, see
 *  the mount effect) it falls back to a hardcoded column count rather than blocking the swatch. */
export function TerrainCard({
  def,
  catalog,
  isArmed,
  onArm,
}: {
  def: TerrainDef;
  catalog: AssetCatalog;
  isArmed: boolean;
  onArm: () => void;
}) {
  const isCompact = useIsCompact();
  const sheetAsset = catalog.assets.find(
    (a) => a.pack === def.pack && a.source.kind === 'sheetFrame' && a.source.sheet === def.sheet,
  );
  const cols = sheetAsset ? catalogTileCols(sheetAsset, TILE_SIZE) : TERRAIN_SHEET_COLS_FALLBACK;
  const rows = sheetAsset ? Math.max(1, Math.round(sheetAsset.h / TILE_SIZE)) : cols;
  const url = tilesetAssetUrl(def.pack, def.sheet);
  const col = def.fillFrame % cols;
  const row = Math.floor(def.fillFrame / cols);
  return (
    <button className={libCardClass(isArmed, isCompact)} title={def.id} onClick={onArm}>
      <span
        className={cn(libSwatchClass, 'pixelated')}
        // Per-frame sprite crop — overrides libSwatchClass's whole-image bg-contain/bg-center via
        // inline style's higher CSS precedence (mirrors TileFrameGrid's swatch math, at the fixed
        // card-swatch size).
        style={{
          backgroundImage: `url(${url})`,
          backgroundPosition: `-${col * TERRAIN_SWATCH_PX}px -${row * TERRAIN_SWATCH_PX}px`,
          backgroundSize: `${cols * TERRAIN_SWATCH_PX}px ${rows * TERRAIN_SWATCH_PX}px`,
        }}
      />
      <span className={libLabelClass}>{def.name}</span>
    </button>
  );
}

/** A single strip/object asset preview (whole image, letterboxed) — click arms decor placement.
 *  Objects aren't split into frames in the Library; a strip shows its full sheet. Wrapped in a
 *  `position:relative` `<div>` (rather than the card itself being one) so `AssetReclassify`'s ⚙
 *  trigger + popover can render as a SIBLING of the arm `<button>`, not nested inside it — the
 *  popover holds real `<select>`/`<input>`/`<button>` elements, which can't legally nest inside
 *  another `<button>`. */
export function AssetCard({
  asset,
  isFavourite,
  isArmed,
  onArm,
  onToggleFavourite,
}: {
  asset: CatalogAsset;
  isFavourite: boolean;
  isArmed: boolean;
  onArm: () => void;
  onToggleFavourite: () => void;
}) {
  const isCompact = useIsCompact();
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const label = asset.id.split('/').pop() ?? asset.id;
  // Compact/touch: long-press governs tap (arm) + long-press (toggle favourite) and drops the inline
  // heart, so the whole row is one clean tap target; desktop keeps plain click + the visible heart.
  const longPress = useLongPress({
    onTap: onArm,
    onLongPress: () => {
      onToggleFavourite();
      toast(isFavourite ? 'Removed favourite' : '♥ Favourited', { duration: 1200 });
    },
  });
  return (
    <div className="relative">
      <button
        className={libCardClass(isArmed, isCompact)}
        title={asset.id}
        {...(isCompact ? longPress : { onClick: onArm })}
      >
        <span className={libSwatchClass} style={{ backgroundImage: `url(${url})` }} />
        <span className={libLabelClass}>{label}</span>
        {!isCompact && (
          <FavHeart fav={isFavourite} onToggle={onToggleFavourite} className="static px-0.5" />
        )}
      </button>
      <AssetReclassify asset={asset} />
    </div>
  );
}

/** One Favourites-pseudo-category entry — resolves a favourited catalog id (which may carry
 *  `#frame`, e.g. a favourited tile frame) back to its `CatalogAsset` and renders the appropriate
 *  single-swatch view. A favourite whose asset no longer exists in the catalog (pack removed/
 *  regenerated) shows a small "missing" placeholder rather than crashing. */
export function FavouriteItem({
  catalog,
  favId,
  brushAsset,
  armedObjectAsset,
  onPickTile,
  onArmObject,
  onToggleFavourite,
}: {
  catalog: AssetCatalog;
  favId: string;
  brushAsset: string | null;
  armedObjectAsset: ArmedObjectAsset | null;
  onPickTile: (assetId: string) => void;
  onArmObject: (assetId: string) => void;
  onToggleFavourite: (assetId: string) => void;
}) {
  const isCompact = useIsCompact();
  const previewPx = isCompact ? COMPACT_PREVIEW_PX : PREVIEW_PX;
  // Palette pick-mode selection state (plan 033 step 4) — a favourited tile frame is a tile-frame
  // surface too, so it funnels through `onPickTile` (=`pickTile`) and honours pick mode; mirror the
  // TileFrameButton check overlay here. `favId` is the frame id used for the selection key.
  const palettePickMode = useEditorStore((s) => s.palettePickMode);
  const palettePicked = useEditorStore((s) => s.palettePickSelection.includes(favId));
  // Compact/touch tile-favourite gesture (plan 030 step 6): tap = pick, long-press = un-favourite,
  // matching TileFrameGrid so the heart never steals a pick tap here either. Called unconditionally
  // (rules of hooks); only wired in the tile branch below, and only on compact. The object branch
  // delegates to AssetCard, which has its own long-press.
  const tileLongPress = useLongPress({
    onTap: () => onPickTile(favId),
    onLongPress: () => {
      onToggleFavourite(favId);
      toast('Removed favourite', { duration: 1200 });
    },
  });
  let resolved: { asset: CatalogAsset; frame?: number } | null = null;
  try {
    const { pack, path, frame } = parseAssetId(favId);
    const baseId = `${pack}/${path}`;
    const asset = catalog.assets.find((a) => a.id === baseId);
    if (asset) resolved = { asset, frame };
  } catch {
    resolved = null;
  }

  if (!resolved) {
    return (
      <div className={cn(libCardClass(false, isCompact), 'text-danger')} title={favId}>
        <span className={libLabelClass}>missing: {favId}</span>
        <FavHeart fav onToggle={() => onToggleFavourite(favId)} className="static px-0.5" />
      </div>
    );
  }

  const { asset, frame } = resolved;
  if (asset.type === 'tile' && frame !== undefined) {
    // Reuse the shared crop renderer (plan 030 step 4) rather than re-deriving the frame math here —
    // `asset` already resolved above, so `swatch` is non-null, but the guard keeps this crash-free.
    const swatch = resolveRecentSwatch(
      { kind: 'tile', assetId: favId },
      catalog,
      EMPTY_NODE_DEFS,
      null,
    );
    return (
      <button
        className={cn(
          'relative rounded-[2px] border border-transparent bg-transparent p-0 leading-[0]',
          brushAsset === favId && 'border-gold-light',
          palettePickMode && palettePicked && 'border-selection',
        )}
        title={favId}
        {...(isCompact ? tileLongPress : { onClick: () => onPickTile(favId) })}
      >
        {swatch && <AssetSwatch swatch={swatch} sizePx={previewPx} />}
        {palettePickMode && palettePicked && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[rgba(95,208,255,0.28)] text-[0.7rem] font-bold text-fg-bright">
            ✓
          </span>
        )}
        {!isCompact && (
          <FavHeart
            fav
            onToggle={() => onToggleFavourite(favId)}
            className="absolute top-0 right-px"
          />
        )}
      </button>
    );
  }

  return (
    <AssetCard
      asset={asset}
      isFavourite
      isArmed={armedObjectAsset?.assetId === favId || brushAsset === favId}
      onArm={() => onArmObject(favId)}
      onToggleFavourite={() => onToggleFavourite(favId)}
    />
  );
}
