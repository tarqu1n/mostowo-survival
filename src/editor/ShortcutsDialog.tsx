import { SHORTCUT_GROUPS } from './shortcuts';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

/**
 * Keyboard + mouse shortcuts reference (opened from the toolbar's "⌨ Keys" button). Pure lookup — it
 * renders `SHORTCUT_GROUPS` (the single source of truth in `shortcuts.ts`) and holds no shortcut logic
 * of its own; to change what's listed here, edit that file. Closes on backdrop click, the Dialog's own
 * close button, the Close button, or Escape — all via Radix Dialog's built-in `onOpenChange`, so the
 * manual `window.keydown` Escape listener the pre-migration version used is no longer needed (Radix
 * already calls `onOpenChange(false)` on Escape). Mirrors `PortalDialog`'s modal structure.
 *
 * Rendered conditionally by the toolbar (`{showShortcuts && <ShortcutsDialog .../>}`), so it's only
 * ever mounted while open — `open` is therefore always `true`; `onOpenChange(false)` is wired straight
 * to the existing `onClose` prop so the toolbar's contract is unchanged.
 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="bg-popover text-popover-foreground sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="mb-3 max-h-[65vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="mb-3.5">
              <h4 className="mb-1.5 text-[0.78rem] uppercase tracking-[0.05em] text-muted-2">
                {group.title}
              </h4>
              <dl className="m-0">
                {group.shortcuts.map((sc) => (
                  <div
                    key={sc.action}
                    className="grid grid-cols-[190px_1fr] items-baseline gap-2.5 py-[3px] text-[0.85rem]"
                  >
                    <dt className="m-0">
                      {sc.keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="text-[0.75rem] text-muted-2"> or </span>}
                          <kbd className="inline-block rounded-md border border-b-2 border-border bg-inset px-1.5 py-px font-[inherit] text-[0.72rem] leading-[1.4] whitespace-nowrap text-fg">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </dt>
                    <dd className="m-0 text-fg-muted">{sc.action}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
