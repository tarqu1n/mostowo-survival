import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameHud } from './GameHud';
import './hud.css';

/**
 * Mounts the DOM/React HUD overlay into #hud-root (declared in index.html, floating over #game).
 * Called from src/main.ts AFTER the Phaser game boots, so `window.game` exists for the bridge that
 * later steps attach. The overlay outlives every scene — it is created once here and never torn down
 * with a scene SHUTDOWN (see plan 046 Lifecycle).
 */
export function mountHud() {
  const root = document.getElementById('hud-root');
  if (!root) {
    // Non-fatal: the game still runs without the HUD. Loud enough to catch a missing #hud-root.
    console.error('[hud] #hud-root not found — HUD overlay not mounted');
    return;
  }
  createRoot(root).render(
    <StrictMode>
      <GameHud />
    </StrictMode>,
  );
}
