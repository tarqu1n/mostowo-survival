import { ITEMS } from '@/data/items';
import { useHudStore } from '@/hud/store';
import { hudBridge } from '@/hud/hooks/useBridge';
import { cn } from '@/hud/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/hud/ui/sheet';
import { Button } from '@/hud/ui/button';

/**
 * Status drawer (plan 046 Step 7) — the Field Kit's Health & Wellbeing screen. A bottom `sheet`
 * whose open state is controlled by the parent (the command bar wires it at Step 11). Replaces the
 * legacy Phaser `WellbeingPanel`: renders the survival meters and the tap-to-eat edible list
 * (→ `needs:eat`, guarded to stock > 0), matching its behaviour.
 *
 * STATS: the store's `playerStats` (armour/speed/strength/… — the player's combat stat bag, surfaced by
 * GameScene on the registry and mirrored into the store by the bridge at Step 11) drives the stat rows,
 * matching the legacy WellbeingPanel; rows are hidden until it resolves.
 *
 * Presentational only: reads the store, emits `needs:eat` via the bridge.
 */

interface StatusDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A left-anchored two-layer meter (track + coloured fill scaled by ratio), mirroring the legacy bars. */
function Meter({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}): React.JSX.Element {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          {Math.round(value)} / {Math.round(max)}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${ratio * 100}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function StatusDrawer({ open, onOpenChange }: StatusDrawerProps): React.JSX.Element {
  const hp = useHudStore((s) => s.hp);
  const maxHp = useHudStore((s) => s.maxHp);
  const hunger = useHudStore((s) => s.hunger);
  const maxHunger = useHudStore((s) => s.maxHunger);
  const fire = useHudStore((s) => s.fire);
  const supply = useHudStore((s) => s.supply);
  const inventory = useHudStore((s) => s.inventory);
  const playerStats = useHudStore((s) => s.playerStats);

  // Edible items are data-driven off ITEMS[id].nutrition (present ⇒ edible — see ItemDef).
  const edibles = Object.values(ITEMS).filter((it) => it.nutrition != null);

  // Player stat rows (mirrors the legacy WellbeingPanel). `vision` is optional on the stat bag.
  const statRows: { label: string; value: number | string }[] = playerStats
    ? [
        { label: 'Max HP', value: playerStats.maxHp },
        { label: 'Armour', value: playerStats.armour },
        { label: 'Speed', value: playerStats.speed },
        { label: 'Vision', value: playerStats.vision ?? '—' },
        { label: 'Strength', value: playerStats.strength },
        { label: 'Dex', value: playerStats.dex },
        { label: 'Dodge', value: playerStats.dodge },
      ]
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="pointer-events-auto max-h-[80%]">
        <SheetHeader>
          <SheetTitle>Status</SheetTitle>
          <SheetDescription>Health &amp; wellbeing</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="flex flex-col gap-3">
            <Meter label="Health" value={hp} max={maxHp} color="var(--color-ok-border)" />
            <Meter label="Hunger" value={hunger} max={maxHunger} color="var(--color-gold)" />
            {fire && (
              <Meter
                label={fire.lit ? 'Fire' : 'Fire (out)'}
                value={fire.fuel}
                max={fire.maxFuel}
                color="var(--color-warm)"
              />
            )}
          </div>

          <div className="flex justify-around rounded-md border border-border bg-secondary p-2 text-center text-xs">
            <div>
              <div className="text-muted-foreground">Base wood</div>
              <div className="font-medium text-foreground">{supply.wood}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Base rock</div>
              <div className="font-medium text-foreground">{supply.rock}</div>
            </div>
          </div>

          {statRows.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Stats
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {statRows.map((row) => (
                  <div key={row.label} className="flex justify-between">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-medium text-foreground">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Available to eat
            </p>
            {edibles.map((it) => {
              const count = inventory[it.id] ?? 0;
              return (
                <Button
                  key={it.id}
                  variant="outline"
                  className={cn('justify-between', count <= 0 && 'opacity-40')}
                  disabled={count <= 0}
                  onClick={() =>
                    hudBridge()?.emit({ type: 'needs:eat', payload: { itemId: it.id } })
                  }
                >
                  <span>{it.name}</span>
                  <span className="text-muted-foreground">
                    ×{count} · +{it.nutrition}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
