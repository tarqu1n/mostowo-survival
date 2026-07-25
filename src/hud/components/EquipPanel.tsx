import type { EquipSlot } from '@/data/types';
import { ITEMS } from '@/data/items';
import { useHudStore } from '@/hud/store';
import { hudBridge } from '@/hud/hooks/useBridge';
import { cn, noImageCallout, preventImageCallout } from '@/hud/lib/utils';
import { iconUrl } from '@/hud/lib/icons';
import { equipViewOf } from '@/hud/lib/equip';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/hud/ui/sheet';

/**
 * Equipment panel (plan 051 Step 4) — a Diablo-style paper-doll: a body silhouette with the three LIVE
 * equip slots (`mainHand` / `offHand` / `ranged`) positioned over the figure. The first real
 * inventory-management surface for the equip system (plan 049 left equip implicit on the toolbar/pack).
 *
 * Purely presentational: reads the already-mirrored `equipment` snapshot from the store and drives
 * unequip through the SAME `equip:toggle` bridge event the pack/toolbar use — no new plumbing. Tapping a
 * filled slot unequips it (a torch returns to the pack with its charge, Step 2); tapping an empty slot
 * is inert (equipping is driven from the pack, where the item lives). Only the three live slots show —
 * no head/chest/legs placeholders (a full paper-doll with per-pose body art stays deferred to plan 010).
 */

interface EquipPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The three live slots and where each box sits over the silhouette (percent of the doll box). Anchors
 *  read anatomically: main hand at the figure's right hand, off hand at its left, ranged across the
 *  shoulder/back. `top`/`left` are the box CENTRES (translated -50% in the style). */
const SLOT_LAYOUT: ReadonlyArray<{
  slot: EquipSlot;
  label: string;
  glyph: string;
  top: string;
  left: string;
}> = [
  { slot: 'ranged', label: 'Ranged', glyph: '🏹', top: '14%', left: '50%' },
  { slot: 'mainHand', label: 'Main Hand', glyph: '⚔️', top: '52%', left: '16%' },
  { slot: 'offHand', label: 'Off Hand', glyph: '🔥', top: '52%', left: '84%' },
];

/** One paper-doll slot box: shows the worn item's icon + a durability bar for a consumable, or a dimmed
 *  glyph/label when empty. A filled box taps to unequip; an empty one is inert. */
function SlotBox({
  slot,
  label,
  glyph,
}: {
  slot: EquipSlot;
  label: string;
  glyph: string;
}): React.JSX.Element {
  const worn = useHudStore((s) => s.equipment[slot]);
  const equipment = useHudStore((s) => s.equipment);
  const def = worn ? ITEMS[worn.id] : null;
  const view = worn ? equipViewOf(equipment, worn.id) : null;

  return (
    <button
      type="button"
      disabled={!worn}
      aria-label={worn ? `${def?.name ?? worn.id} — tap to unequip` : `${label} (empty)`}
      onContextMenu={preventImageCallout}
      onClick={() => {
        if (worn) hudBridge()?.emit({ type: 'equip:toggle', payload: { itemId: worn.id } });
      }}
      className={cn(
        'relative flex size-14 flex-col items-center justify-center gap-0.5 rounded-md border bg-secondary/90 p-1 text-center',
        noImageCallout,
        worn
          ? 'border-gold ring-2 ring-gold' // filled → gold ring (mirrors the pack/toolbar equipped outline)
          : 'border-border border-dashed opacity-60', // empty → dimmed dashed placeholder
      )}
    >
      {worn && def?.icon ? (
        <img
          src={iconUrl(def.icon)}
          alt=""
          aria-hidden
          draggable={false}
          onContextMenu={preventImageCallout}
          className={cn('size-9 [image-rendering:pixelated]', noImageCallout)}
        />
      ) : (
        <span className="text-lg opacity-70" aria-hidden>
          {glyph}
        </span>
      )}
      <span className="text-[8px] leading-none font-medium text-muted-foreground">
        {worn ? (def?.name ?? worn.id) : label}
      </span>
      {/* Durability bar for a worn consumable (the torch) — mirrors the pack's gold bar. */}
      {view?.durabilityFrac != null && (
        <span className="pointer-events-none absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-black/50">
          <span
            className="block h-full rounded-full"
            style={{ width: `${view.durabilityFrac * 100}%`, backgroundColor: 'var(--color-gold)' }}
          />
        </span>
      )}
    </button>
  );
}

/** A plain humanoid outline (no art-gen) the slot boxes sit over — theme-token stroked, decorative. */
function BodySilhouette(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 100 150"
      className="absolute inset-0 h-full w-full text-border"
      fill="currentColor"
      aria-hidden
    >
      {/* Head */}
      <circle cx="50" cy="18" r="13" />
      {/* Torso + arms + legs as one blocky silhouette. */}
      <path
        d="M50 33
               C40 33 33 38 33 48
               L20 62 L14 58 L10 64 L26 78 L33 70
               L33 96 L40 96 L40 150 L47 150 L47 104 L53 104 L53 150 L60 150 L60 96 L67 96
               L67 70 L74 78 L90 64 L86 58 L80 62 L67 48
               C67 38 60 33 50 33 Z"
      />
    </svg>
  );
}

export function EquipPanel({ open, onOpenChange }: EquipPanelProps): React.JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="pointer-events-auto max-h-[80%]">
        <SheetHeader>
          <SheetTitle>Gear</SheetTitle>
          <SheetDescription>Tap a worn item to unequip · equip from your pack</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 pb-6">
          {/* The paper doll: a fixed-aspect box holding the silhouette with the three slot boxes
              absolutely positioned over their anatomical anchors. */}
          <div className="relative h-64 w-44 opacity-95">
            <BodySilhouette />
            {SLOT_LAYOUT.map(({ slot, label, glyph, top, left }) => (
              <div
                key={slot}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ top, left }}
              >
                <SlotBox slot={slot} label={label} glyph={glyph} />
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
