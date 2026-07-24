import type { PointerEvent as ReactPointerEvent } from 'react';
import { useHudStore } from '../store';
import { hudBridge } from '../hooks/useBridge';
import type { InboundEvent } from '../bridge';
import { BUILDABLES } from '@/data/buildables';
import { ITEMS } from '@/data/items';
import type { BuildableDef } from '@/data/types';
import { Button } from '@/hud/ui/button';
import { cn } from '@/hud/lib/utils';
import { Movepad } from './Movepad';

/**
 * Field Kit command bar (plan 046 Step 6) — the persistent bottom bar that MORPHS by mode, replacing
 * the legacy Phaser `ModeControls` / `BuildControls` / `CombatControls` trays. Presentational: the
 * active layout is driven by the `mode` PROP (integration sets it at Step 10, not a store read), and
 * each control emits its matching inbound event on the bridge or calls a drawer-open callback prop.
 *
 *  - **scavenge** → Build · Pack · Status (Build also toggles build mode; the rest open drawers)
 *  - **build**    → a buildable tray + Rotate / Place / Cancel / Demolish
 *  - **fight**    → the {@link Movepad} + Attack / Bow
 *
 * There is deliberately no Craft button: item crafting (plan 048) is a STATION interaction, not a
 * global mode — the player taps a placed workbench to open its recipe menu (`CraftMenu`), exactly as
 * tapping a campfire refuels it or tapping the companion opens its assignment menu. A context-free
 * command-bar Craft button would have no bench to craft at, so crafting stays bench-tapped and the
 * bar keeps its three modes.
 */
export type CommandBarMode = 'scavenge' | 'build' | 'fight';

interface CommandBarProps {
  mode: CommandBarMode;
  /** Open the build catalog (Step 7 drawer). Fired alongside `build:toggle` from the scavenge Build button. */
  onBuild?: () => void;
  /** Open the pack/inventory drawer (Step 7). */
  onPack?: () => void;
  /** Open the status/wellbeing drawer (Step 7). */
  onStatus?: () => void;
  /** Passed through to the fight-mode {@link Movepad}: reports its held-state up (Step 10 wiring). */
  onMoveHeldChange?: (held: boolean) => void;
  className?: string;
}

/** Send an inbound (HUD→world) event, if the bridge is live. */
function emit(event: InboundEvent): void {
  hudBridge()?.emit(event);
}

/**
 * Fire an inbound event on POINTER-DOWN rather than click — the fix for "the attack buttons don't
 * work while holding the movepad". A browser only synthesizes a `click` for the PRIMARY pointer (the
 * first finger down); while the movepad holds that primary pointer, a second finger tapping Attack/Bow
 * is a non-primary pointer and never generates a `click`, so an `onClick` handler is silently dropped.
 * `pointerdown` IS delivered for every pointer, so the combat buttons must key off it to stay live
 * during a movepad hold. `preventDefault` stops the button stealing focus / emitting a redundant
 * synthesized click. (Press-to-fire also just feels more responsive for a combat action.)
 */
function onPress(event: InboundEvent) {
  return (e: ReactPointerEvent) => {
    e.preventDefault();
    emit(event);
  };
}

export function CommandBar({
  mode,
  onBuild,
  onPack,
  onStatus,
  onMoveHeldChange,
  className,
}: CommandBarProps) {
  // Build-layout state (not the `mode` prop, which drives the morph): the selected buildable
  // highlights its tray chip, `orientable` gates Rotate, `demolishMode` reflects the Demolish toggle.
  const selection = useHudStore((s) => s.selection);
  const orientable = useHudStore((s) => s.orientable);
  const demolishMode = useHudStore((s) => s.demolishMode);
  // Ranged is gated on an equipped bow (plan 049): no bow ⇒ hide the Bow button (and the world no-ops
  // a stray `combat:bow`). The crafted bow is the first ranged weapon — a deliberate early-game gate.
  const hasBow = useHudStore((s) => s.equipment.ranged !== null);

  // Utility rail state (always visible, independent of the morph): the raw game mode drives the
  // Fight/Inspect toggle highlights, and the queue summary reveals Cancel Queue when work is pending.
  const gameMode = useHudStore((s) => s.mode);
  const tasks = useHudStore((s) => s.tasks);
  const hasQueue = tasks.current !== null || tasks.pending > 0;

  return (
    <div
      data-testid="hud-command-bar"
      className={cn(
        'pointer-events-auto flex flex-col gap-1.5 rounded-xl border border-border bg-inset/85 p-2',
        className,
      )}
    >
      {/* Utility rail — mode toggles + cancel-queue, replacing the legacy ModeControls + the
          BuildControls Cancel button. Always shown so you can switch mode / clear the queue from any
          morph. Fight ↔ mode:combatToggle, Inspect ↔ mode:inspectToggle (the only path into inspect
          mode). Cancel Queue appears only with pending work. */}
      <div className="flex items-center gap-1.5">
        <Button
          size="xs"
          variant={gameMode === 'combat' ? 'default' : 'secondary'}
          aria-pressed={gameMode === 'combat'}
          onClick={() => emit({ type: 'mode:combatToggle' })}
        >
          Fight
        </Button>
        <Button
          size="xs"
          variant={gameMode === 'inspect' ? 'default' : 'secondary'}
          aria-pressed={gameMode === 'inspect'}
          onClick={() => emit({ type: 'mode:inspectToggle' })}
        >
          Inspect
        </Button>
        {hasQueue && (
          <Button
            size="xs"
            variant="destructive"
            className="ml-auto"
            onClick={() => emit({ type: 'tasks:cancel' })}
          >
            Cancel Queue
          </Button>
        )}
      </div>

      {mode === 'scavenge' && (
        <div className="flex gap-1.5">
          <Button
            className="h-10 flex-1"
            onClick={() => {
              emit({ type: 'build:toggle' });
              onBuild?.();
            }}
          >
            Build
          </Button>
          <Button variant="secondary" className="h-10 flex-1" onClick={onPack}>
            Pack
          </Button>
          <Button variant="secondary" className="h-10 flex-1" onClick={onStatus}>
            Status
          </Button>
        </div>
      )}

      {mode === 'build' && (
        <div className="flex flex-col gap-2">
          {/* Buildable tray — horizontally scrollable; tap picks the structure to place. */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {Object.values(BUILDABLES).map((def) => (
              <button
                key={def.id}
                type="button"
                onClick={() => emit({ type: 'build:select', payload: { id: def.id } })}
                className={cn(
                  'w-16 shrink-0 rounded-lg border px-1 py-1.5 text-center',
                  selection === def.id
                    ? 'border-accent-border bg-surface text-fg-bright'
                    : 'border-border bg-surface-subtle text-fg-muted',
                )}
              >
                <span className="block truncate text-[9px] leading-tight">{def.name}</span>
                <span className="mt-0.5 block truncate text-[8px] text-gold">{costLabel(def)}</span>
              </button>
            ))}
          </div>
          {/* Confirm cluster. Rotate shows only for an orientable selection (mirrors legacy BuildControls). */}
          <div className="flex gap-1.5">
            {orientable && (
              <Button
                variant="secondary"
                className="h-9 flex-1"
                onClick={() => emit({ type: 'build:rotate' })}
              >
                Rotate
              </Button>
            )}
            <Button
              className="h-9 flex-1"
              onClick={() => {
                // Placement is a world-tap on the map (wired at Step 10), so Place is a confirm/no-op
                // here — kept for parity with the mockup's ✔ Place button.
              }}
            >
              Place
            </Button>
            <Button
              variant={demolishMode ? 'default' : 'destructive'}
              className="h-9 flex-1"
              onClick={() => emit({ type: 'demolish:toggle' })}
            >
              Demolish
            </Button>
            <Button
              variant="destructive"
              className="h-9 flex-1"
              onClick={() => emit({ type: 'build:toggle' })}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === 'fight' && (
        <div className="flex items-center justify-between">
          <Movepad size={60} onHeldChange={onMoveHeldChange} />
          <div className="flex items-center gap-2">
            {/* Pointer-down, not click: these must fire as a non-primary pointer while the movepad
                holds the primary one — see onPress. The Bow button shows only with a bow equipped
                (plan 049); Attack (unarmed or a main-hand weapon) is always available. */}
            {hasBow && (
              <Button
                variant="secondary"
                className="size-11 rounded-full p-0"
                onPointerDown={onPress({ type: 'combat:bow' })}
              >
                Bow
              </Button>
            )}
            <Button
              variant="destructive"
              className="size-14 rounded-full p-0 text-base"
              onPointerDown={onPress({ type: 'combat:attack' })}
            >
              Attack
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "10 Stone · 10 Wood" — each cost entry as qty + item name (mirrors legacy BuildControls). */
function costLabel(def: BuildableDef): string {
  return Object.entries(def.cost)
    .map(([id, qty]) => `${qty} ${ITEMS[id]?.name ?? id}`)
    .join(' · ');
}
