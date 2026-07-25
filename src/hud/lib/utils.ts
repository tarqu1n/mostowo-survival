import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, resolving Tailwind utility conflicts (shadcn convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Suppress the browser's native long-press affordances on item/icon art (plan 051). A long-press on an
 * `<img>` on touch fires the OS "Open/Save Image" callout + a drag ghost, which fights the HUD's own
 * long-press-to-pin gesture (`useLongPress`). Apply this class to long-pressable art `<img>`s and their
 * slot `<button>`s, alongside `draggable={false}` on the img and `onContextMenu={preventImageCallout}`.
 * We only stop the *browser default* — the app gesture still fires — and never install a global
 * `contextmenu` blocker (that would break the editor / dev tooling).
 */
export const noImageCallout = 'select-none [-webkit-touch-callout:none]';

/** onContextMenu guard partnering {@link noImageCallout} — cancels the native menu on a long-press. */
export const preventImageCallout = (e: { preventDefault: () => void }): void => e.preventDefault();
