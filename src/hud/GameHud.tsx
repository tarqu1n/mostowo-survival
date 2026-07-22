/**
 * Root of the DOM/React HUD overlay (plan 046, Field Kit). Lives at the page level over the Phaser
 * canvas (mounted into #hud-root by main.tsx), NOT inside any Phaser scene — it persists across
 * GameScene death→restart. The root itself is click-through (pointer-events:none, set on #hud-root
 * in index.html); interactive controls opt back in as they are added in later steps.
 *
 * Step 1 skeleton: an empty root plus a temporary debug badge to prove the overlay mounts and paints
 * above the canvas. Real clusters (meters, hotbar, command bar, drawers) land from Step 5 on.
 */
export function GameHud() {
  return (
    <div className="hud-root" style={{ width: '100%', height: '100%' }}>
      {/* TEMP (Step 1): removed once real components mount. pointer-events:none — purely visual. */}
      <div
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
        HUD ✓
      </div>
    </div>
  );
}
