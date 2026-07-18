import type { TilePaletteSlot } from '../../systems/mapFormat';
import { useEditorStore } from '../store/editorStore';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../lib/utils';
import { useIsCompact } from '../hooks/useIsCompact';
import {
  AssetSwatch,
  EMPTY_NODE_DEFS,
  resolveRecentSwatch,
  type RecentSwatch,
} from './assetSwatch';

/**
 * Tile-palette strip (plan 033 step 3) — a quick-access tray of curated tiles, mirroring `RecentStrip`
 * (same `assetSwatch` renderer, same swatch conventions) so palette and Library swatches can never
 * drift. Renders a palette switcher (a compact `Select` over the map's named palettes + a "＋" that
 * appends a new one), then the active palette's slots as one-tap swatches that arm the brush via
 * `selectPaletteSlot`, each with a remove affordance.
 *
 * Re-render note: see `LibraryPanel`'s module doc — palette STRUCTURE lives in `map.meta.tilePalettes`,
 * mutated in place by store commands (stable object references), so this subscribes to `docRevision`/
 * `mapEpoch` purely as re-render triggers and reads `map` fresh via `getState()` in the render body,
 * rather than selecting `map` itself (which wouldn't detect an in-place mutation). The
 * `activeTilePaletteId`/`brushAsset`/`brushRotation` pointers ARE plain store fields, so those select
 * normally.
 */

/** Palette-strip swatch size (px), matching `RecentStrip`'s. Compact is deliberately BIGGER: the swatch
 *  doubles as the tap target on touch, so it wants to clear the ~44px guideline (swatch + padding). */
const PALETTE_SWATCH_PX = 34;
const PALETTE_SWATCH_PX_COMPACT = 40;

/** Stable key + dedupe identity for a slot — matches the store's own `assetId`+`rotation` slot key. */
const slotKey = (slot: TilePaletteSlot): string => `${slot.assetId}#${slot.rotation ?? 0}`;

export function PaletteStrip() {
  const isCompact = useIsCompact();
  const catalog = useEditorStore((s) => s.catalog);
  const terrainCatalog = useEditorStore((s) => s.terrainCatalog);
  const activeTilePaletteId = useEditorStore((s) => s.activeTilePaletteId);
  // Brush state drives the active-slot highlight — a slot is highlighted when its asset+rotation match
  // the currently-armed brush (mirrors how the Library/Recent strip rings the active pick).
  const brushAsset = useEditorStore((s) => s.brushAsset);
  const brushRotation = useEditorStore((s) => s.brushRotation);
  // Re-render triggers only — see module doc. The actual palette structure is read fresh below.
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);

  const sizePx = isCompact ? PALETTE_SWATCH_PX_COMPACT : PALETTE_SWATCH_PX;

  const map = useEditorStore.getState().map;
  const palettes = map?.meta.tilePalettes ?? [];
  // Resolve the active palette from the reconciled pointer, falling back to the first (the pointer can
  // momentarily lag a structural add before reconcile/`set` lands).
  const activePalette = palettes.find((p) => p.id === activeTilePaletteId) ?? palettes[0] ?? null;

  const addTilePalette = (): void => useEditorStore.getState().addTilePalette();

  // No palettes yet: a single "New palette" affordance (legacy maps only materialise a palette the
  // moment the user creates one — never on open).
  if (palettes.length === 0) {
    return (
      <div className="mb-2.5 flex flex-col gap-1 border-b border-surface pb-2">
        <Button
          size="sm"
          variant="outline"
          className={cn('w-full', isCompact && 'h-11')}
          onClick={addTilePalette}
        >
          ＋ New palette
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-2.5 flex flex-col gap-1.5 border-b border-surface pb-2">
      {/* No heading of its own — the switcher below already names the active palette (with the
          Select's built-in down-arrow), so a "PALETTE" title would just be redundant height. */}
      <div className="flex items-center gap-1.5">
        <Select
          value={activePalette?.id ?? undefined}
          onValueChange={(id) => useEditorStore.getState().setActiveTilePalette(id)}
        >
          <SelectTrigger
            size="sm"
            className={cn('min-w-0 flex-1', isCompact && 'h-11 text-[0.95rem]')}
          >
            <SelectValue placeholder="Palette" />
          </SelectTrigger>
          <SelectContent>
            {palettes.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size={isCompact ? 'icon-lg' : 'icon-sm'}
          variant="outline"
          className="flex-none"
          title="Add palette"
          onClick={addTilePalette}
        >
          ＋
        </Button>
      </div>

      {activePalette && activePalette.slots.length === 0 && (
        <p className="text-[0.8rem] text-muted-2">Add tiles from the Library.</p>
      )}

      {activePalette && activePalette.slots.length > 0 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {activePalette.slots.map((slot, index) => (
            <PaletteSlotSwatch
              key={slotKey(slot)}
              slot={slot}
              index={index}
              paletteId={activePalette.id}
              sizePx={sizePx}
              isCompact={isCompact}
              isActive={brushAsset === slot.assetId && brushRotation === (slot.rotation ?? 0)}
              swatch={
                catalog
                  ? resolveRecentSwatch(
                      { kind: 'tile', assetId: slot.assetId },
                      catalog,
                      EMPTY_NODE_DEFS,
                      terrainCatalog,
                    )
                  : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One palette slot: a tap-to-arm swatch plus a remove affordance. Desktop shows a small ✕ overlay on
 *  hover; compact drops it below the swatch as its own ≥44px tap target (overlaying a 44px control on a
 *  40px swatch would swallow the whole tap), mirroring `LayersPanel`'s compact reflow. `swatch` is
 *  `null` only when the catalog hasn't loaded or the tile id no longer resolves — the box still renders
 *  (empty) so removing a now-stale slot stays possible. */
function PaletteSlotSwatch({
  slot,
  index,
  paletteId,
  sizePx,
  isCompact,
  isActive,
  swatch,
}: {
  slot: TilePaletteSlot;
  index: number;
  paletteId: string;
  sizePx: number;
  isCompact: boolean;
  isActive: boolean;
  swatch: RecentSwatch | null;
}) {
  const title = slot.rotation ? `${slot.assetId} (${slot.rotation}°)` : slot.assetId;
  const remove = (): void => useEditorStore.getState().removeTilePaletteSlot(paletteId, index);

  return (
    <div className={cn('group relative flex flex-none flex-col items-center gap-0.5')}>
      <button
        type="button"
        className={cn(
          'flex flex-none items-center justify-center rounded-[3px] border bg-inset p-0.5 hover:border-gold-light',
          isCompact && 'p-1',
          // Active slot gets the gold ring (mirrors `--color-active`/`--color-selection` picks in the
          // Library); inactive stays transparent-bordered.
          isActive ? 'border-gold-light bg-surface' : 'border-transparent',
        )}
        title={title}
        onClick={() => useEditorStore.getState().selectPaletteSlot(slot)}
      >
        <span
          className="flex items-center justify-center"
          style={{ width: sizePx, height: sizePx }}
        >
          {swatch && <AssetSwatch swatch={swatch} sizePx={sizePx} />}
        </span>
      </button>
      {isCompact ? (
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-center rounded-[3px] text-[0.85rem] text-fg-muted hover:bg-surface"
          title="Remove from palette"
          onClick={remove}
        >
          ✕
        </button>
      ) : (
        <button
          type="button"
          className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border border-border bg-inset text-[0.6rem] leading-none text-fg-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
          title="Remove from palette"
          onClick={remove}
        >
          ✕
        </button>
      )}
    </div>
  );
}
