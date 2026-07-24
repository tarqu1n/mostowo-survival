import { useMemo, useRef } from 'react';
import { BUILDABLES } from '@/data/buildables';
import { ITEMS } from '@/data/items';
import type { BuildableDef } from '@/data/types';
import { useHudStore } from '@/hud/store';
import { hudBridge } from '@/hud/hooks/useBridge';
import { cn } from '@/hud/lib/utils';
import { BuildableIcon } from './BuildableIcon';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/hud/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/hud/ui/tabs';

/**
 * Build catalog drawer (plan 046 Step 7) — the Field Kit's Tier-2 build browser. A bottom `sheet`
 * whose open state is controlled by the parent (the command bar wires it at Step 11). Replaces the
 * legacy Phaser `BuildControls` palette: mirrors its behaviour (per-entry cost + affordability dim,
 * select → `build:select`) in the two-tier loadout/catalog model — full grids live here, the hotbar
 * holds the quick picks.
 *
 * Tabs are DATA-DRIVEN off the distinct `category` values actually present in `BUILDABLES` (today
 * only 'defense' + 'survival' have entries → exactly those two tabs; 'craft' is reserved in the
 * schema but has no entry, so no Craft tab renders — tabs grow automatically as content lands).
 * Entries with no `category` are omitted from the tabbed grids (none exist today).
 *
 * Presentational only: reads the store, emits via the bridge. Select → `build:select`; long-press →
 * pins to the hotbar (the pin mutation is in-memory today; persistence lands at Step 11).
 */

interface BuildCatalogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Long-press vs tap on a single tile: a tap fires `onTap`, a press held past `ms` fires
 *  `onLongPress` and suppresses the trailing tap. Inlined (not a shared hook) so this component owns
 *  no cross-file dependency; the pack drawer carries its own copy. */
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

/** Phaser stores buildable tints as hex numbers; render the placeholder swatch as a CSS colour. */
const hexColor = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** Capitalise a category id for its tab label ('defense' → 'Defense'). */
const label = (category: string): string => category.charAt(0).toUpperCase() + category.slice(1);

/** Can the player afford this buildable right now? Compares its `cost` against the inventory snapshot. */
const canAfford = (cost: Record<string, number>, inventory: Record<string, number>): boolean =>
  Object.entries(cost).every(([id, qty]) => (inventory[id] ?? 0) >= qty);

function BuildTile({
  def,
  affordable,
  onOpenChange,
}: {
  def: BuildableDef;
  affordable: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const press = useLongPress(
    () => {
      // Select → enter build mode (GameScene handles placement); close the catalog like the legacy
      // palette did on pick. Long-press instead pins the buildable to the loadout for next time.
      hudBridge()?.emit({ type: 'build:select', payload: { id: def.id } });
      onOpenChange(false);
    },
    () => useHudStore.getState().pinToHotbar({ kind: 'buildable', id: def.id }),
  );
  return (
    <button
      type="button"
      aria-label={def.name}
      className={cn(
        'flex flex-col items-center gap-1 rounded-md border border-border bg-secondary p-2 text-center transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        !affordable && 'opacity-40',
      )}
      {...press}
    >
      <BuildableIcon
        def={def}
        className="size-12"
        fallback={
          <span
            className="size-12 rounded-sm border border-border"
            style={{ backgroundColor: hexColor(def.color) }}
            aria-hidden
          />
        }
      />
      <span className="text-xs font-medium text-foreground">{def.name}</span>
      <span className="flex flex-wrap justify-center gap-1">
        {Object.entries(def.cost).map(([id, qty]) => (
          <span key={id} className="text-[10px] text-muted-foreground">
            {qty} {ITEMS[id]?.name ?? id}
          </span>
        ))}
      </span>
    </button>
  );
}

export function BuildCatalog({ open, onOpenChange }: BuildCatalogProps): React.JSX.Element {
  const inventory = useHudStore((s) => s.inventory);

  // Distinct categories in first-appearance order across BUILDABLES — only those with ≥1 entry, so
  // the tab list grows itself as new categorised content lands. Grouped map: category → its entries.
  const { categories, byCategory } = useMemo(() => {
    const byCategory = new Map<string, BuildableDef[]>();
    for (const def of Object.values(BUILDABLES)) {
      if (!def.category) continue; // untabbed buildables are skipped (none today)
      const list = byCategory.get(def.category);
      if (list) list.push(def);
      else byCategory.set(def.category, [def]);
    }
    return { categories: [...byCategory.keys()], byCategory };
  }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="pointer-events-auto max-h-[80%]">
        <SheetHeader>
          <SheetTitle>Build</SheetTitle>
          <SheetDescription>Pick to place · long-press to pin to your loadout</SheetDescription>
        </SheetHeader>
        {categories.length > 0 && (
          <Tabs defaultValue={categories[0]} className="min-h-0 flex-1 px-4 pb-4">
            <TabsList className="w-full">
              {categories.map((category) => (
                <TabsTrigger key={category} value={category}>
                  {label(category)}
                </TabsTrigger>
              ))}
            </TabsList>
            {categories.map((category) => (
              <TabsContent key={category} value={category} className="min-h-0 overflow-y-auto">
                <div className="grid grid-cols-3 gap-2">
                  {(byCategory.get(category) ?? []).map((def) => (
                    <BuildTile
                      key={def.id}
                      def={def}
                      affordable={canAfford(def.cost, inventory)}
                      onOpenChange={onOpenChange}
                    />
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
