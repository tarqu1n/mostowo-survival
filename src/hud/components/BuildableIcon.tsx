import type { ReactNode } from 'react';
import type { BuildableDef } from '@/data/types';
import { cn } from '@/hud/lib/utils';
import { iconUrl } from '@/hud/lib/icons';

/**
 * Shared buildable-art renderer (plan 050 Step 10). When a buildable carries an `icon` (a PNG basename
 * under `public/assets/icons/`) this renders a base-aware, pixel-crisp `<img>` — mirroring how items
 * render their icons (see `PackDrawer`/`Hotbar`); when `icon` is unset it renders the caller's own
 * `fallback` unchanged. Buildable-icon art is a deferred follow-up, so today NO buildable sets `icon`
 * and every site shows its existing fallback (colour swatch or text label) — this only wires the code
 * path so dropping icon files into the data later "just works".
 *
 * The fallback differs per site (the catalog uses a colour swatch, the hotbar/command tray a text
 * label), so it's passed in rather than baked in here; the single shared concern is constructing the
 * icon `<img>` (URL + pixelated rendering + a11y) in one place so the render sites can't drift.
 *
 * `className` sizes/styles the `<img>` to match its host slot (so an icon lands the same size as the
 * swatch/text it replaces). The image is `aria-hidden` because every call site already labels its
 * button (`aria-label`), so the icon would otherwise double-announce.
 */
export function BuildableIcon({
  def,
  className,
  fallback,
}: {
  def: BuildableDef;
  className?: string;
  fallback: ReactNode;
}): React.JSX.Element {
  if (def.icon) {
    return (
      <img
        src={iconUrl(def.icon)}
        alt=""
        aria-hidden
        draggable={false}
        className={cn(className, '[image-rendering:pixelated]')}
      />
    );
  }
  return <>{fallback}</>;
}
