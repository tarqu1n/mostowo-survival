/**
 * Base-aware URL for an item icon served from `public/assets/icons/`.
 *
 * The HUD is a DOM/React overlay, so it points plain `<img>` tags at the icon files rather than
 * using Phaser texture keys. Those URLs MUST carry Vite's configured `base` (`import.meta.env.BASE_URL`)
 * — mirroring PreloadScene's Phaser `this.load.image(...)` path — or they 404 under any non-root base
 * (the GitHub Pages build lives under `/mostowo-survival/`, the guppi/Tailscale build under a subpath).
 * A hardcoded root-absolute `/assets/icons/...` only works in plain desktop dev where `base` is `/`.
 *
 * Single source of truth for both the Hotbar and the Pack drawer so the two renderers can't drift.
 */
export function iconUrl(file: string): string {
  return encodeURI(`${import.meta.env.BASE_URL}assets/icons/${file}`);
}
