import { useEffect, useState } from 'react';
import { listMaps } from './api';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

/** Modal for Open: lists map ids from `GET /__editor/maps`; picking one loads it (in the toolbar).
 *  Rendered conditionally by the toolbar (`{showOpen && <OpenMapDialog .../>}`), so it's only ever
 *  mounted while open — `open` is therefore always `true`; `onOpenChange(false)` (Escape, overlay
 *  click, or the Dialog's own close button) is wired straight to the existing `onCancel` prop so the
 *  toolbar's contract is unchanged. */
export function OpenMapDialog({
  onOpen,
  onCancel,
}: {
  onOpen: (id: string) => void;
  onCancel: () => void;
}) {
  const [ids, setIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listMaps()
      .then(setIds)
      .catch((e: unknown) => setError((e as Error).message));
  }, []);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="bg-popover text-popover-foreground sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>Open map</DialogTitle>
        </DialogHeader>
        {error && <p className="text-[0.8rem] text-danger">{error}</p>}
        {!ids && !error && <p className="text-[0.9rem] text-muted-2">Loading…</p>}
        {ids && ids.length === 0 && (
          <p className="text-[0.9rem] text-muted-2">No maps yet — create one with New.</p>
        )}
        {ids && ids.length > 0 && (
          <ul className="m-0 flex max-h-[260px] list-none flex-col gap-1 overflow-auto p-0">
            {ids.map((id) => (
              <li key={id}>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => onOpen(id)}
                >
                  {id}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
