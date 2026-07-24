import { useRef } from 'react';
import { useHudStore } from '../store';
import type { HotbarSlot } from '../store';
import { hudBridge } from '../hooks/useBridge';
import { HUD_HOTBAR_SLOTS, LONGPRESS_MS } from '@/config';
import { ITEMS } from '@/data/items';
import { BUILDABLES } from '@/data/buildables';
import { cn } from '@/hud/lib/utils';
import { iconUrl } from '@/hud/lib/icons';
import { equipViewOf, isEquippable } from '@/hud/lib/equip';
import { BuildableIcon } from './BuildableIcon';

/**
 * Field Kit hotbar (plan 046 Step 6) — the always-visible quick-swap loadout row (`HUD_HOTBAR_SLOTS`
 * slots) that rides just above the command bar. Renders the store's `hotbar` loadout; empty slots are
 * dimmed. Tapping a filled slot uses/equips/selects its entry:
 *  - buildable → `build:select` (opens placement for that structure);
 *  - edible item (has `nutrition`, e.g. berries) → `needs:eat`;
 *  - equippable item (has `equip`, e.g. brand/bow/sword) → `equip:toggle` (plan 049): a yellow outline
 *    marks the equipped slot and a lit brand shows a durability bar;
 *  - other item (plain resource) → no-op.
 *
 * Long-press is the "pin" affordance in the pitch, but the pin ACTION (`pinToHotbar`) is exercised
 * from the catalog/pack entries (Step 7), not from within the bar. Here long-press is a self-contained
 * placeholder gesture: it suppresses the tap so a held slot doesn't fire use/equip, leaving room for a
 * reassign/clear affordance at Step 11.
 */
export function Hotbar({ className }: { className?: string }) {
  const hotbar = useHudStore((s) => s.hotbar);
  const slots = Array.from({ length: HUD_HOTBAR_SLOTS }, (_, i) => hotbar[i] ?? null);

  return (
    <div
      data-testid="hud-hotbar"
      className={cn(
        'pointer-events-auto flex gap-[5px] rounded-xl border border-border bg-inset/60 px-1.5 py-1',
        className,
      )}
    >
      {slots.map((slot, i) => (
        <SlotButton key={i} slot={slot} />
      ))}
    </div>
  );
}

/** Whether tapping this slot actually does something: a buildable selects it for placement, an edible
 *  eats it, an equippable toggles equip (plan 049). A plain resource (wood/stone) has NO action, so it
 *  must neither fire nor give the tap "pop" (see SlotButton). */
function slotHasAction(slot: NonNullable<HotbarSlot>): boolean {
  return (
    slot.kind === 'buildable' ||
    ITEMS[slot.id]?.nutrition != null ||
    (slot.kind === 'item' && isEquippable(slot.id))
  );
}

/** Fire the tap action for a filled slot (see the component doc for the per-kind mapping). Only ever
 *  called for slots where {@link slotHasAction} is true. */
function activate(slot: NonNullable<HotbarSlot>): void {
  const bridge = hudBridge();
  if (!bridge) return;
  if (slot.kind === 'buildable') {
    bridge.emit({ type: 'build:select', payload: { id: slot.id } });
    return;
  }
  const def = ITEMS[slot.id];
  if (def?.nutrition != null) {
    bridge.emit({ type: 'needs:eat', payload: { itemId: slot.id } });
  } else if (def?.equip != null) {
    bridge.emit({ type: 'equip:toggle', payload: { itemId: slot.id } });
  }
}

/** Live stack count for an item slot (from the mirrored inventory), or `null` when a count shouldn't
 *  show — buildables (no stock count) and non-stackable items (`maxStack <= 1`, e.g. a future weapon),
 *  so singletons stay clean while consumables like berries surface how many remain. */
function useSlotCount(slot: HotbarSlot): number | null {
  return useHudStore((s) => {
    if (!slot || slot.kind !== 'item') return null;
    if ((ITEMS[slot.id]?.maxStack ?? 1) <= 1) return null;
    return s.inventory[slot.id] ?? 0;
  });
}

/** True iff this slot holds an edible item (drives the eat cooldown sweep + tap gate). */
function isEdibleSlot(slot: HotbarSlot): boolean {
  return !!slot && slot.kind === 'item' && ITEMS[slot.id]?.nutrition != null;
}

/** One hotbar slot. Empty → a dimmed, inert cell; filled → tap-to-use with a long-press guard. A
 *  stackable item also shows its live count (bottom-right) and dims when the stack is depleted. A valid
 *  tap gives a quick scale "pop" under the finger; an edible on the shared eat cooldown greys out under
 *  a shrinking sweep and ignores taps for the window (the game enforces the same, see SurvivalClock). */
function SlotButton({ slot }: { slot: HotbarSlot }) {
  const count = useSlotCount(slot);
  const depleted = count === 0; // stackable item with none left (null count → not a counted slot)
  const equipment = useHudStore((s) => s.equipment);
  const equip = slot?.kind === 'item' ? equipViewOf(equipment, slot.id) : null;
  const cooldownActive = useHudStore((s) => s.eatCooldownActive);
  const cooldownMs = useHudStore((s) => s.eatCooldownMs);
  const cooldownNonce = useHudStore((s) => s.eatCooldownNonce);
  const edible = isEdibleSlot(slot);
  const onCooldown = edible && cooldownActive; // this slot is a food slot mid-cooldown → inert
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const clearTimer = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const onPointerDown = (): void => {
    if (!slot) return;
    longPressed.current = false;
    clearTimer();
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      // Long-press within the bar: pin is driven from catalog/pack entries (Step 7), so this is a
      // placeholder — it only marks the gesture so the tap below is suppressed. TODO(Step 11):
      // reassign/clear affordance.
    }, LONGPRESS_MS);
  };

  const onPointerUp = (): void => {
    clearTimer();
    if (longPressed.current) return; // held long enough to be a long-press → don't fire the tap
    if (!slot || onCooldown) return; // no slot, or a food slot still cooling down → ignore the tap
    if (!slotHasAction(slot)) return; // no action (e.g. wood/stone) → no pop, nothing to fire
    // Pop under the finger — immediate tactile ack of the use, restarts cleanly on rapid taps.
    btnRef.current?.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(0.82)' }, { transform: 'scale(1)' }],
      { duration: 200, easing: 'ease-out' },
    );
    activate(slot);
  };

  return (
    <button
      ref={btnRef}
      type="button"
      disabled={!slot}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={clearTimer}
      onPointerCancel={clearTimer}
      className={cn(
        'relative grid size-11 place-items-center overflow-hidden rounded-lg border border-border bg-surface-subtle/95',
        !slot && 'opacity-40',
        depleted && 'opacity-50', // out of stock — dim but keep it pinned (refills on next forage)
        equip?.equipped && 'ring-2 ring-gold', // equipped in a slot (plan 049) → yellow outline
      )}
      aria-label={slot ? `${slotLabel(slot)}${count !== null ? ` (${count})` : ''}` : 'empty slot'}
      aria-pressed={equip?.equipped ?? undefined}
    >
      {slot && <SlotContent slot={slot} />}
      {/* Durability bar for an equipped consumable (the brand, plan 049) — a thin gold bar along the
          bottom that shrinks as it drains (Step 6); absent for permanent gear (bow/sword). */}
      {equip?.durabilityFrac !== null && equip !== null && (
        <span
          data-testid="hud-hotbar-durability"
          className="pointer-events-none absolute inset-x-0.5 bottom-0.5 h-1 overflow-hidden rounded-full bg-black/50"
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
      {count !== null && (
        <span
          data-testid="hud-hotbar-count"
          className="absolute right-0 bottom-0 rounded-tl bg-inset/90 px-0.5 font-mono leading-none text-fg-bright"
          style={{ fontSize: 8 }}
        >
          {count}
        </span>
      )}
      {/* Eat cooldown: a dark conic wedge over the slot that shrinks as the window elapses (keyed on the
          nonce so each eat replays it). Only on food slots, and only while the shared cooldown runs. */}
      {onCooldown && (
        <span
          key={cooldownNonce}
          data-testid="hud-hotbar-cooldown"
          className="hud-cooldown pointer-events-none absolute inset-0 rounded-lg"
          style={{ animationDuration: `${cooldownMs}ms` }}
        />
      )}
    </button>
  );
}

/** Icon art or a short text label, for either kind. Items and buildables both render their `icon` PNG
 *  when the data carries one, falling back to the short name (no buildable ships an icon yet — the art
 *  is a deferred plan-050 follow-up, but the render path is wired via {@link BuildableIcon}). */
function SlotContent({ slot }: { slot: NonNullable<HotbarSlot> }) {
  if (slot.kind === 'item') {
    const def = ITEMS[slot.id];
    if (def?.icon) {
      return (
        <img
          src={iconUrl(def.icon)}
          alt={def.name}
          className="size-9 [image-rendering:pixelated]"
          draggable={false}
        />
      );
    }
    return <SlotText>{def?.name ?? slot.id}</SlotText>;
  }
  // Buildable: an icon PNG when the data sets one (none do yet), else the short name.
  const def = BUILDABLES[slot.id];
  if (!def) return <SlotText>{slot.id}</SlotText>;
  return <BuildableIcon def={def} className="size-9" fallback={<SlotText>{def.name}</SlotText>} />;
}

function SlotText({ children }: { children: string }) {
  return (
    <span className="px-0.5 text-center text-[8px] leading-tight text-fg-muted">{children}</span>
  );
}

/** Human-readable slot label for the button's accessible name. */
function slotLabel(slot: NonNullable<HotbarSlot>): string {
  const def = slot.kind === 'item' ? ITEMS[slot.id] : BUILDABLES[slot.id];
  return def?.name ?? slot.id;
}
