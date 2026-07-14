import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { EditorScene } from './EditorScene';

/**
 * Mounts the `Phaser.Game` running `EditorScene` into a host div (the centre pane), and destroys it
 * on unmount (plan 014 step 5). This component is the deliberate React↔Phaser mount seam — it's the
 * one place allowed to import both. All state flows through the editor store, not props: the scene
 * reads/subscribes to the store directly, so this component takes no map data.
 *
 * `Scale.RESIZE` makes the canvas track the pane size; `transparent` lets the dark pane show
 * through; `pixelArt` = integer nearest-neighbour, matching the game.
 */
export function PhaserViewport() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      transparent: true,
      pixelArt: true,
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      scene: [EditorScene],
    });
    // StrictMode double-invokes effects in dev: this cleanup destroys the first game before the
    // second mounts, so only one canvas ever survives.
    return () => {
      game.destroy(true);
    };
  }, []);

  return <div ref={hostRef} className="w-full h-full pixelated" />;
}
