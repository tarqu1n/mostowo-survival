import { useMemo } from 'react';
import { RECIPES } from '@/data/recipes';
import { ITEMS } from '@/data/items';
import type { RecipeDef } from '@/data/types';
import { useHudStore } from '@/hud/store';
import { hudBridge } from '@/hud/hooks/useBridge';
import { cn } from '@/hud/lib/utils';
import { Button } from '@/hud/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/hud/ui/sheet';

/**
 * Workbench craft menu (plan 048 Step 7) — the DOM recipe list opened by tapping a workbench (the
 * `craft:menuOpen` game event, held in the store's `craftMenu`). A bottom sheet mirroring BuildCatalog:
 * each `workbench` recipe shows its name + cost with an affordability dim, and a tap emits `craft:queue`
 * back to GameScene (which enqueues the real `craft` worker order) then closes. When the bench is
 * damaged (`hp < maxHp`) a Repair action is offered too, emitting `craft:repair` (the player repair
 * order from Step 4). Presentational only: reads `RECIPES`/`ITEMS` + the store's inventory, emits via
 * the bridge — never touches the bus directly.
 */
export interface CraftMenuProps {
  /** Whether the menu is open (from the `craft:menuOpen` game event). */
  open: boolean;
  /** The tapped bench's id — routed back on every recipe/Repair pick. `null` only while closed. */
  benchId: string | null;
  /** The bench's live hp/maxHp at open — the Repair action shows only when `hp < maxHp`. */
  hp: number;
  maxHp: number;
  /** Close the menu (clears the open state the parent owns). */
  onClose: () => void;
}

/** Can the player afford this recipe right now? Compares its `cost` against the inventory snapshot
 *  (same shape as BuildCatalog's affordability check). */
const canAfford = (cost: Record<string, number>, inventory: Record<string, number>): boolean =>
  Object.entries(cost).every(([id, qty]) => (inventory[id] ?? 0) >= qty);

export function CraftMenu({ open, benchId, hp, maxHp, onClose }: CraftMenuProps) {
  const inventory = useHudStore((s) => s.inventory);
  // The workbench's recipes, in declaration order — read from data like BuildCatalog reads BUILDABLES.
  const recipes = useMemo(
    () => Object.values(RECIPES).filter((r) => r.station === 'workbench'),
    [],
  );
  const damaged = hp < maxHp;

  const queue = (recipe: RecipeDef): void => {
    if (benchId)
      hudBridge()?.emit({ type: 'craft:queue', payload: { benchId, recipeId: recipe.id } });
    onClose();
  };
  const repair = (): void => {
    if (benchId) hudBridge()?.emit({ type: 'craft:repair', payload: { benchId } });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="bottom" className="gap-3 pb-6">
        <SheetHeader className="pb-0">
          <SheetTitle>Workbench</SheetTitle>
          <SheetDescription>Pick a recipe to craft · a worker carries it out</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 px-4">
          {recipes.map((recipe) => {
            const affordable = canAfford(recipe.cost, inventory);
            return (
              <button
                key={recipe.id}
                type="button"
                aria-label={recipe.name}
                disabled={!affordable}
                onClick={() => queue(recipe)}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md border border-border bg-secondary p-3 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  !affordable && 'opacity-40',
                )}
              >
                <span className="text-sm font-medium text-foreground">{recipe.name}</span>
                <span className="flex flex-wrap justify-end gap-2">
                  {Object.entries(recipe.cost).map(([id, qty]) => (
                    <span key={id} className="text-[11px] text-muted-foreground">
                      {qty} {ITEMS[id]?.name ?? id}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}

          {damaged && (
            <Button variant="outline" className="mt-1" onClick={repair}>
              Repair bench
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
