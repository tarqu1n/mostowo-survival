import type { CatalogAsset } from '../../catalog';
import { useEditorStore } from '../../store/editorStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { cn } from '../../lib/utils';
import { useIsCompact } from '../../hooks/useIsCompact';

/**
 * Per-asset reclassify affordance (plan 014 step 7c, rewired plan 017 step 2) — a small ⚙ trigger on
 * every `TileFrameGrid`/`AssetCard`/`AtlasSheetPicker`/`AnimatedStripPicker`. Clicking it opens the
 * asset's full-size object-editor TAB (`openObjectTab`) instead of the old cramped popover, so the
 * type/frame-grid reclassify controls (a placeholder in step 2, fleshed out in step 3) get the room
 * to render a correct preview. Two placements: the default self-anchors to the top-right corner of any
 * `position:relative` card wrapper (see `AssetCard`'s doc); `inline` (used by `AtlasSheetPicker`, which
 * already has a zoom toolbar row to sit in) drops the absolute positioning and renders as a normal flex
 * item at the end of that row instead. Clicks are `stopPropagation`'d so opening the tab never also
 * arms/paints the underlying card.
 */
export function AssetReclassify({
  asset,
  inline = false,
}: {
  asset: CatalogAsset;
  inline?: boolean;
}) {
  const isCompact = useIsCompact();
  function open(): void {
    useEditorStore.getState().openObjectTab(asset.id);
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // Flex-centered square (not a bare font-size bump) so the ⚙ — which sits off-centre in its
          // own em-box — lands dead-centre. `inline` (atlas zoom row) drops the corner anchoring and
          // matches the row's 22px baseline; default self-anchors to the card's top-right corner. On
          // compact both grow towards a real tap target (the `inline` row already grew to size-10 to
          // match its neighbouring zoom buttons; the default corner badge grows to size-8 — it can't
          // reach the full size-10 without overrunning a small swatch's own corner).
          className={cn(
            'z-[5] flex cursor-pointer items-center justify-center rounded-md border border-border bg-inset leading-none text-muted-2 hover:border-active hover:text-gold',
            inline ? 'size-[22px] text-[14px]' : 'absolute top-0.5 right-0.5 size-5 text-[12px]',
            isCompact && (inline ? 'size-10 text-[18px]' : 'size-8 text-[15px]'),
          )}
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              open();
            }
          }}
        >
          ⚙
        </span>
      </TooltipTrigger>
      <TooltipContent>Reclassify: force type / frame grid</TooltipContent>
    </Tooltip>
  );
}
