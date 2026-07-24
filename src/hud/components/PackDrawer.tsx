import { useMemo, useRef, useState } from 'react';
import { ITEMS } from '@/data/items';
import { useHudStore } from '@/hud/store';
import { hudBridge } from '@/hud/hooks/useBridge';
import { cn } from '@/hud/lib/utils';
import { iconUrl } from '@/hud/lib/icons';
import { equipViewOf, isEquippable, type EquipView } from '@/hud/lib/equip';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/hud/ui/sheet';

/**
 * Pack (inventory) drawer (plan 046 Step 7) — the Field Kit's Tier-2 full inventory. A bottom `sheet`
 * whose open state is controlled by the parent (the command bar wires it at Step 11). Replaces the
 * legacy Phaser `InventoryWidget` grid, adding the interactions the old grid lacked (§ pitch: "the
 * slot grid can't select, drag, or equip"): tap to select a slot, tap a consumable to eat it,
 * long-press any slot to pin it to the hotbar.
 *
 * Edibility is data-driven off `ITEMS[id].nutrition` (present ⇒ edible — see ItemDef); there is an
 * explicit flag, so no per-item fallback (e.g. hardcoding `berries`) is needed. Presentational only:
 * reads the inventory snapshot from the store, emits `needs:eat` via the bridge, pins via the store.
 */

interface PackDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Long-press vs tap on a single slot (see BuildCatalog for rationale — inlined per file, no shared hook). */
function useLongPress(onTap: () => void, onLongPress: () => void, ms = 450) {
  const timer = useRef<number | null>(null);
  const longFired = useRef(false);
  const clear = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  return {
    onPointerDown: (): void => {
      longFired.current = false;
      timer.current = window.setTimeout(() => {
        longFired.current = true;
        onLongPress();
      }, ms);
    },
    onPointerUp: (): void => {
      clear();
      if (!longFired.current) onTap();
    },
    onPointerLeave: clear,
    onPointerCancel: clear,
  };
}

/** An item is edible iff its data carries `nutrition` (ItemDef flag). */
const isEdible = (id: string): boolean => ITEMS[id]?.nutrition != null;

/** Phaser stores item tints as hex numbers; render the fallback swatch (no icon) as a CSS colour. */
const hexColor = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

function PackSlot({
  id,
  count,
  selected,
  equip,
  onSelect,
}: {
  id: string;
  count: number;
  selected: boolean;
  equip: EquipView;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const def = ITEMS[id];
  const edible = isEdible(id);
  const equippable = isEquippable(id);
  const press = useLongPress(
    () => {
      // Tap an equippable → toggle equip (plan 049); a consumable → eat it (guarded to stock > 0);
      // anything else → just select the slot.
      if (equippable) hudBridge()?.emit({ type: 'equip:toggle', payload: { itemId: id } });
      else if (edible && count > 0)
        hudBridge()?.emit({ type: 'needs:eat', payload: { itemId: id } });
      else onSelect(id);
    },
    () => useHudStore.getState().pinToHotbar({ kind: 'item', id }),
  );
  return (
    <button
      type="button"
      aria-label={def?.name ?? id}
      aria-pressed={equippable ? equip.equipped : selected}
      className={cn(
        'relative flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-border bg-secondary p-1 text-center transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        selected && 'ring-2 ring-ring',
        equip.equipped && 'ring-2 ring-gold', // equipped (plan 049) → yellow outline (wins over select)
      )}
      {...press}
    >
      {def?.icon ? (
        <img
          src={iconUrl(def.icon)}
          alt=""
          className="size-12 [image-rendering:pixelated]"
          aria-hidden
        />
      ) : (
        <span
          className="size-12 rounded-sm border border-border"
          style={{ backgroundColor: hexColor(def?.color ?? 0x888888) }}
          aria-hidden
        />
      )}
      <span className="text-[10px] leading-none font-medium text-foreground">
        {def?.name ?? id}
      </span>
      {/* Bag count, or an "equipped" tag when the item is worn (and thus out of the bag). */}
      <span className="absolute right-1 bottom-0.5 text-[10px] text-muted-foreground">
        {equip.equipped ? 'equipped' : `×${count}`}
      </span>
      {/* Durability bar for an equipped consumable (the brand, plan 049) — shrinks as it drains (Step 6). */}
      {equip.durabilityFrac !== null && (
        <span
          data-testid="hud-pack-durability"
          className="pointer-events-none absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-black/50"
        >
          <span
            className="block h-full rounded-full"
            style={{
              width: `${equip.durabilityFrac * 100}%`,
              backgroundColor: 'var(--color-gold)',
            }}
          />
        </span>
      )}
    </button>
  );
}

export function PackDrawer({ open, onOpenChange }: PackDrawerProps): React.JSX.Element {
  const inventory = useHudStore((s) => s.inventory);
  const equipment = useHudStore((s) => s.equipment);
  const [selected, setSelected] = useState<string | null>(null);

  // The store's inventory is an aggregate {id: count} snapshot; render one slot per stocked item, PLUS
  // any currently-equipped item (equipping spends it out of the bag, so it'd otherwise vanish from the
  // pack and there'd be no way to tap it to unequip — plan 049). Equipped items list first.
  const entries = useMemo(() => {
    const equippedIds = [equipment.mainHand, equipment.ranged, equipment.offHand]
      .filter((w): w is NonNullable<typeof w> => w !== null)
      .map((w) => w.id);
    const stocked = Object.entries(inventory).filter(
      ([id, count]) => count > 0 && !equippedIds.includes(id),
    );
    return [...equippedIds.map((id) => [id, inventory[id] ?? 0] as const), ...stocked];
  }, [inventory, equipment]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="pointer-events-auto max-h-[80%]">
        <SheetHeader>
          <SheetTitle>Pack</SheetTitle>
          <SheetDescription>Tap food to eat · long-press to pin to your loadout</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Your pack is empty.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {entries.map(([id, count]) => (
                <PackSlot
                  key={id}
                  id={id}
                  count={count}
                  selected={selected === id}
                  equip={equipViewOf(equipment, id)}
                  onSelect={setSelected}
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
