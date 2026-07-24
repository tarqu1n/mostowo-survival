import type { PointerEvent as ReactPointerEvent } from 'react';
import { useHudStore } from '../store';
import { hudBridge } from '../hooks/useBridge';
import { ITEMS } from '@/data/items';
import { Button } from '@/hud/ui/button';

/**
 * Blueprint-Mode commit bar (plan 050 Step 7) — the thumb-zone bar shown while a line-tool drag has
 * painted a pending run (rendered by `GameHud`'s `ActionLayer`, gated on `buildMode` AND a non-empty
 * run). It reads the live `runTally` the game emits on every run mutation (`build:runChanged`) and
 * shows how many tiles the run will actually blueprint (`affordableCount`) of how many are placeable,
 * the affordable subset's total cost, and the serial worker ETA. Confirm commits the run
 * (`build:commitRun` → blueprint + enqueue the affordable subset, spend its cost, clear); Cancel drops
 * it with no spend (`build:cancelRun`).
 *
 * Both buttons fire on POINTER-DOWN, not click (mirrors the combat Attack/Bow buttons + the line-tool
 * FAB — see CommandBar.onPress): a browser only synthesizes `click` for the PRIMARY pointer, so a
 * press while the movepad holds it would be dropped by `onClick`; `pointerdown` is delivered for every
 * pointer, keeping the buttons live during a movepad hold.
 */
export function CommitBar() {
  const run = useHudStore((s) => s.runTally);

  const onPress = (type: 'build:commitRun' | 'build:cancelRun') => (e: ReactPointerEvent) => {
    e.preventDefault();
    hudBridge()?.emit({ type });
  };

  return (
    <div
      data-testid="hud-commit-bar"
      className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-inset/85 p-2"
    >
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-xs font-medium text-fg-bright">
          {run.affordableCount} of {run.placeableCount} tiles
        </span>
        <span className="truncate text-[10px] text-fg-muted">
          {costLabel(run.totalCost)} · {etaLabel(run.etaMs)}
        </span>
      </div>
      <Button variant="secondary" size="sm" onPointerDown={onPress('build:cancelRun')}>
        Cancel
      </Button>
      <Button size="sm" onPointerDown={onPress('build:commitRun')}>
        Confirm
      </Button>
    </div>
  );
}

/** "6 Wood · 2 Stone" — each non-zero cost entry as qty + item name (mirrors the catalog cost label);
 *  a nothing-to-spend run (no affordable tiles) shows a dash. */
function costLabel(cost: Record<string, number>): string {
  const parts = Object.entries(cost)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => `${qty} ${ITEMS[id]?.name ?? id}`);
  return parts.length ? parts.join(' · ') : '—';
}

/** Serial worker build ETA (ms → a friendly "~Ns"), floored at 1s so a payable run never reads "~0s". */
function etaLabel(ms: number): string {
  if (ms <= 0) return '—';
  return `~${Math.max(1, Math.round(ms / 1000))}s`;
}
