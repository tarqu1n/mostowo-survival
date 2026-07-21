import { type CSSProperties } from 'react';
import type { DecorAnim } from '../../../systems/mapFormat';
import { tilesetAssetUrl } from '../../textureLoading';
import type { CatalogAsset } from '../../catalog';
import { DECOR_ANIM_DEFAULT_FPS } from '../../store/editorStore';
import { cn } from '../../lib/utils';
import { useIsCompact } from '../../hooks/useIsCompact';
import { PREVIEW_PX, COMPACT_PREVIEW_PX, libLabelClass, libCardClass } from './shared';
import { AssetReclassify } from './AssetReclassify';

/** True if `asset` is a `strip` with fully resolvable, actually-multi-frame geometry — the only
 *  shape `AnimatedStripPicker` can safely animate (per plan guidance: don't guess frame math for a
 *  strip that lacks clean `frameWidth`/`frameHeight`/`frames`; fall back to the plain `AssetCard`
 *  instead). `frames >= 2`, not `> 0` (plan 014 step 7c bugfix): `stripFrameDims`'s "unresolved"
 *  fallback stamps `frames: 1` (the whole sheet as one unsliced frame) — `frames > 0` let THAT
 *  wrongly render via `AnimatedStripPicker` and stamp a useless `anim {…, frames: 1}` onto placed
 *  decor; a genuinely single-frame strip isn't an animation. */
export function isAnimatableStrip(
  asset: CatalogAsset,
): asset is CatalogAsset & { frameWidth: number; frameHeight: number; frames: number } {
  return (
    asset.type === 'strip' &&
    typeof asset.frameWidth === 'number' &&
    typeof asset.frameHeight === 'number' &&
    typeof asset.frames === 'number' &&
    asset.frames >= 2
  );
}

/**
 * Animated strip picker (step 7b) — a `strip` asset with resolvable per-frame geometry
 * (`isAnimatableStrip`). Shows a live preview of the strip playing in a ONE-FRAME window via a CSS
 * `steps()` animation. The swatch is exactly one scaled frame (`dispW`×`dispH`); the sheet is drawn
 * behind it at its true scaled width (`frames * dispW`) and `background-position-x` travels the whole
 * `-frames * dispW` over `steps(frames)`, so every step lands exactly on a frame boundary. (A
 * percentage `0% → 100%` travel — the earlier approach — under-shifts by `(frames-1)/frames` of a
 * frame each step because of CSS's percentage-position formula, which showed two half-frames sliding
 * sideways instead of a clean flip.) The travel distance is handed to the shared keyframe via the
 * `--strip-travel` custom property, since @keyframes can't read component values.
 *
 * This single-horizontal-row `steps()` math is only correct for a classic one-row, every-cell-played
 * strip (plan 017 step 6 decouples grid geometry from the played set via `omit`): a multi-row grid or
 * a strip with omitted cells falls back to a static first-frame swatch (`canAnimateInline` below)
 * instead of animating something visually wrong — the true animated preview for those lives in the
 * object-editor tab (step 6.5). Clicking arms the animated decor, carrying `omit` through when present;
 * placement stamps a fixed default `fps` (`DECOR_ANIM_DEFAULT_FPS`), never edited here (critique #6).
 */
export function AnimatedStripPicker({
  asset,
  isArmed,
  onArm,
}: {
  asset: CatalogAsset & { frameWidth: number; frameHeight: number; frames: number };
  isArmed: boolean;
  onArm: (assetId: string, anim: Omit<DecorAnim, 'fps'>) => void;
}) {
  const isCompact = useIsCompact();
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const scale = (isCompact ? COMPACT_PREVIEW_PX : PREVIEW_PX) / asset.frameHeight;
  const dispW = Math.round(asset.frameWidth * scale);
  const dispH = Math.round(asset.frameHeight * scale);
  const label = asset.id.split('/').pop() ?? asset.id;

  const cols = Math.max(1, Math.round(asset.w / asset.frameWidth));
  const rows = Math.max(1, Math.round(asset.h / asset.frameHeight));
  const omit = asset.omit ?? [];
  // The only geometry this swatch's single-row steps() math can honestly animate: one row, no
  // skipped cells. Anything else (a >1-row grid, or a row with an omitted cell) gets a static
  // first-frame swatch instead — see doc comment above.
  const canAnimateInline = rows === 1 && omit.length === 0;

  // The full animation is set inline (not via a CSS class): the keyframe `lib-strip-play` lives in
  // editor.css, but its duration/timing/travel all depend on the strip's frame count, so name +
  // iteration go here alongside them rather than in a utility. `--strip-travel` feeds the keyframe.
  const swatchStyle: CSSProperties & Partial<Record<'--strip-travel', string>> = canAnimateInline
    ? {
        width: dispW,
        height: dispH,
        backgroundImage: `url(${url})`,
        backgroundSize: `${asset.frames * dispW}px ${dispH}px`,
        animationName: 'lib-strip-play',
        animationIterationCount: 'infinite',
        animationDuration: `${asset.frames / DECOR_ANIM_DEFAULT_FPS}s`,
        animationTimingFunction: `steps(${asset.frames})`,
        '--strip-travel': `${-asset.frames * dispW}px`,
      }
    : {
        // Static first-frame swatch: crop cell 0 (top-left) out of the full grid, no animation.
        width: dispW,
        height: dispH,
        backgroundImage: `url(${url})`,
        backgroundSize: `${cols * dispW}px ${rows * dispH}px`,
        backgroundPosition: '0px 0px',
      };

  return (
    <div className="relative">
      <button
        // `.lib-strip-anim` was column layout on the card — flex-col/items-start override libCardClass.
        className={cn(libCardClass(isArmed, isCompact), 'flex-col items-start')}
        title={asset.id}
        onClick={() =>
          onArm(asset.id, {
            frameWidth: asset.frameWidth,
            frameHeight: asset.frameHeight,
            frames: asset.frames,
            ...(omit.length ? { omit } : {}),
          })
        }
      >
        <span className="pixelated mb-1 block bg-no-repeat" style={swatchStyle} />
        <span className={libLabelClass}>{label}</span>
      </button>
      <AssetReclassify asset={asset} />
    </div>
  );
}
