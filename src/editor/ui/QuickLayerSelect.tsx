import { ChevronDownIcon } from 'lucide-react';

import { useEditorStore } from '../store/editorStore';
import { useIsCompact } from '../hooks/useIsCompact';
import { cn } from '../lib/utils';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './dropdown-menu';

/**
 * Compact quick layer selector (plan 033 step 5) — a small two-part control bound to
 * `activeLayerId` / `setActiveLayer`, meant for the toolbar/context-bar (Step 6 wires it in; this
 * file only defines the control).
 *
 *   - Primary affordance: a tiny button showing the active layer's **number** (its 0-based position
 *     in the top-first order; "–" when `activeLayerId` is null) — the name lives in the tooltip/
 *     `aria-label` so the control stays small and never clips the compact ContextBar. Tapping
 *     **cycles** to the next layer, wrapping from the last back to the first, and is disabled when
 *     there are fewer than two layers.
 *   - Secondary affordance (desktop only): a chevron `DropdownMenu` to jump directly to any layer by
 *     name; the active layer is checked. On compact/touch it's cycle-only (the ContextBar is
 *     space-tight; direct selection stays available in the Inspector → Layers tab).
 *
 * Ordering matches `LayersPanel`: `map.layers` is stored bottom→top, but this presents **top-first**
 * (front-most layer first) in both the cycle order and the dropdown list — a display reversal only.
 *
 * Re-render note (see `LayersPanel`): `map` is mutated in place, so we subscribe to
 * `docRevision`/`mapEpoch` purely as re-render triggers and read `map` fresh via `getState()`.
 * `setActiveLayer` is a plain `set`; reconciliation of `activeLayerId` across history moves already
 * lives in the store (`reconcileActiveLayer`), so we never duplicate it here.
 */
export function QuickLayerSelect() {
  const isCompact = useIsCompact();
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);

  const map = useEditorStore.getState().map;
  // Present top-first (front-most layer first), matching LayersPanel; `map.layers` is bottom→top.
  const presented = map ? [...map.layers].reverse() : [];

  const activeIndex = presented.findIndex((l) => l.id === activeLayerId);
  const activeLayer = activeIndex === -1 ? null : presented[activeIndex];
  const canCycle = presented.length >= 2;

  function cycle(): void {
    if (presented.length === 0) return;
    // When nothing is active (or the id is stale), start at the first presented (top) layer;
    // otherwise advance one, wrapping past the end.
    const nextIndex = activeIndex === -1 ? 0 : (activeIndex + 1) % presented.length;
    useEditorStore.getState().setActiveLayer(presented[nextIndex].id);
  }

  // Show the layer's NUMBER (0-based, top-first — matching the LayersPanel/dropdown order) rather than
  // its name, so the control stays tiny and never clips the space-tight compact ContextBar. The name
  // lives in the tooltip/aria-label and the dropdown; "–" when no layer is active.
  const number = activeLayer ? String(activeIndex) : '–';
  const nameHint = activeLayer ? `Layer ${number}: ${activeLayer.name}` : 'No layer';

  // Compact/touch: just the number-cycle button (no chevron dropdown) — the ContextBar is space-tight
  // on a phone, and direct layer selection stays available in the Inspector → Layers tab. Desktop
  // keeps the chevron for one-tap direct jump.
  const cycleButton = (
    <Button
      variant="secondary"
      size={isCompact ? 'icon-lg' : 'icon-sm'}
      disabled={!canCycle}
      onClick={cycle}
      className={cn(
        'tabular-nums',
        !isCompact && 'rounded-r-none',
        isCompact && 'size-11 text-[0.95rem]',
      )}
      title={canCycle ? `${nameHint} — click to cycle layers` : nameHint}
      aria-label={canCycle ? `${nameHint}. Click to cycle layers` : nameHint}
    >
      {number}
    </Button>
  );

  if (isCompact) return <div className="inline-flex shrink-0 items-stretch">{cycleButton}</div>;

  return (
    <div className="inline-flex shrink-0 items-stretch">
      {cycleButton}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="icon-sm"
            disabled={presented.length === 0}
            className="rounded-l-none border-l border-border"
            title="Choose a layer"
            aria-label="Choose a layer"
          >
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {presented.map((layer) => (
            <DropdownMenuCheckboxItem
              key={layer.id}
              checked={layer.id === activeLayerId}
              onSelect={() => useEditorStore.getState().setActiveLayer(layer.id)}
            >
              {layer.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
