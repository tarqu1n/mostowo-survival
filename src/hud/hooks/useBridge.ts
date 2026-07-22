import { useEffect } from 'react';
import { initBridge } from '../bridge';
import type { Bridge, EventBus, Registry } from '../bridge';

/**
 * The live event bridge (plan 046 Step 3), or `null` before the HUD mounts / after it unmounts.
 * Non-hook callers (HUD controls firing inbound events in later steps) reach it through here so they
 * don't need to thread a prop/context down; it is set by {@link useBridge} for the HUD's lifetime.
 */
let active: Bridge | null = null;
export function hudBridge(): Bridge | null {
  return active;
}

/** The shape of `window.game` the bridge needs — Phaser's `Game` exposes `events` + `registry`. */
interface GameWindow {
  game?: { events: EventBus; registry: Registry };
}

/**
 * Wire the bridge to `window.game` for the lifetime of the mounted HUD, and tear it down on unmount.
 * StrictMode-safe: the effect cleanup disposes every subscription, so React's dev double-invoke
 * (mount→unmount→mount) re-subscribes cleanly instead of leaking listeners. `game.events` +
 * `game.registry` outlive every scene, so subscribing once here (not per scene) is correct.
 */
export function useBridge(): void {
  useEffect(() => {
    const game = (window as unknown as GameWindow).game;
    if (!game) {
      // The HUD still renders (from store defaults); without a game there is nothing to bridge to.
      console.error('[hud] window.game absent at mount — event bridge not wired');
      return;
    }
    const bridge = initBridge(game.events, game.registry);
    active = bridge;
    return () => {
      bridge.dispose();
      if (active === bridge) active = null;
    };
  }, []);
}
