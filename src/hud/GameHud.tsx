import { BASE_WIDTH, BASE_HEIGHT } from '@/config';
import { useCanvasRect } from './hooks/useCanvasRect';
import { useBridge } from './hooks/useBridge';
import { useHudStore } from './store';

/**
 * Root of the DOM/React HUD overlay (plan 046, Field Kit). Lives at the page level over the Phaser
 * canvas (mounted into #hud-root by main.tsx), NOT inside any Phaser scene — it persists across
 * GameScene death→restart. The root itself is click-through (pointer-events:none, set on #hud-root
 * in index.html); interactive controls opt back in as they are added in later steps.
 *
 * Layering (Step 2):
 *  - `.hud-design` — positioned exactly over the live canvas rect and CSS-scaled so children author
 *    in fixed 360×640 design units (same space Phaser draws in). World-aligned markers go here.
 *  - `.hud-safe` — an inset sublayer carrying `env(safe-area-inset-*)`, so interactive controls
 *    stay clear of notches / home indicators. Interactive clusters mount inside this from Step 5 on.
 */
export function GameHud() {
  useBridge();
  const rect = useCanvasRect();

  // Until the canvas is measured, render nothing positioned — avoids a flash at the wrong place.
  if (!rect) return null;

  return (
    <div className="hud-root" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div
        className="hud-design"
        style={{
          position: 'absolute',
          left: rect.left,
          top: rect.top,
          width: BASE_WIDTH,
          height: BASE_HEIGHT,
          transform: `scale(${rect.scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
      >
        {/* Interactive-safe sublayer: everything tappable lives inside these safe-area insets. */}
        <div
          className="hud-safe"
          style={{
            position: 'absolute',
            inset: 0,
            paddingTop: 'env(safe-area-inset-top)',
            paddingRight: 'env(safe-area-inset-right)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            paddingLeft: 'env(safe-area-inset-left)',
          }}
        >
          {/* TEMP (Step 2): four design-space corner markers to prove alignment to the canvas rect.
              Removed once real clusters land. Inside .hud-safe so they also show the inset. */}
          <CornerMarker corner="tl" />
          <CornerMarker corner="tr" />
          <CornerMarker corner="bl" />
          <CornerMarker corner="br" />
        </div>
      </div>

      {/* TEMP (Step 1→2): overlay-mounted badge, now also reporting the measured scale. */}
      <div
        data-testid="hud-badge"
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          padding: '2px 6px',
          borderRadius: 4,
          background: 'rgba(20, 16, 15, 0.7)',
          color: '#f4ecd8',
          font: '11px ui-monospace, monospace',
          pointerEvents: 'none',
        }}
      >
        HUD ✓ ×{rect.scale.toFixed(2)}
      </div>

      {/* TEMP (Step 3): live store readout proving the event bridge feeds the store in-game. Removed
          once the real meter cluster lands (Step 9). */}
      <StoreReadout />
    </div>
  );
}

/** TEMP debug readout (Step 3): HP / hunger / day straight off the HUD store, to eyeball that the
 *  bridge maps live game events into the store. Subscribes to just the fields it shows. */
function StoreReadout() {
  const hp = useHudStore((s) => s.hp);
  const maxHp = useHudStore((s) => s.maxHp);
  const hunger = useHudStore((s) => s.hunger);
  const maxHunger = useHudStore((s) => s.maxHunger);
  const dayPhase = useHudStore((s) => s.dayPhase);
  const dayCount = useHudStore((s) => s.dayCount);
  return (
    <div
      data-testid="hud-store-readout"
      style={{
        position: 'absolute',
        top: 26,
        left: 8,
        padding: '2px 6px',
        borderRadius: 4,
        background: 'rgba(20, 16, 15, 0.7)',
        color: '#f4ecd8',
        font: '11px ui-monospace, monospace',
        pointerEvents: 'none',
      }}
    >
      HP {Math.round(hp)}/{maxHp} · food {Math.round(hunger)}/{maxHunger} · Day {dayCount} [
      {dayPhase}]
    </div>
  );
}

/** TEMP debug marker (Step 2). An 8×8 design-unit square hugging one corner of the design layer. */
function CornerMarker({ corner }: { corner: 'tl' | 'tr' | 'bl' | 'br' }) {
  const v = corner[0] === 't' ? { top: 0 } : { bottom: 0 };
  const h = corner[1] === 'l' ? { left: 0 } : { right: 0 };
  return (
    <div
      data-testid={`hud-corner-${corner}`}
      style={{ position: 'absolute', width: 8, height: 8, background: '#5fd0ff', ...v, ...h }}
    />
  );
}
