import { useState } from 'react';
import type { PortalFacing, PortalRect } from '../systems/mapFormat';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const FACINGS: PortalFacing[] = ['up', 'down', 'left', 'right'];

/** A labelled field row (`<Label>` + control), shared by the two fields below. */
const fieldClass = 'flex flex-col gap-1.5';

/**
 * Modal shown after a valid Portal-tool drag (mirrors `NewMapDialog`'s structure): collects a name +
 * facing, then the caller creates the `kind:'portal'` object. Facing defaults to whichever axis the
 * rect is longer on (a wide rect reads as a horizontal threshold → default 'down'; a tall rect reads
 * as a vertical one → default 'right'); a square rect defaults to 'down'.
 *
 * Rendered conditionally by `EditorApp` (only mounted while a portal rect is pending), so `open` is
 * always `true`; `onOpenChange(false)` (Escape, overlay click, or the Dialog's own close button) is
 * wired straight to the existing `onCancel` prop so the caller's contract is unchanged.
 */
export function PortalDialog({
  rect,
  onConfirm,
  onCancel,
}: {
  rect: PortalRect;
  onConfirm: (name: string, facing: PortalFacing) => void;
  onCancel: () => void;
}) {
  const defaultFacing: PortalFacing = rect.h > rect.w ? 'right' : 'down';
  const [name, setName] = useState('');
  const [facing, setFacing] = useState<PortalFacing>(defaultFacing);

  const valid = name.trim().length > 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="bg-popover text-popover-foreground sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>New portal</DialogTitle>
        </DialogHeader>
        <p className="text-[0.9rem] text-muted-2">
          Rect: col {rect.col}, row {rect.row}, {rect.w}×{rect.h}
        </p>
        <div className="flex flex-col gap-3">
          <div className={fieldClass}>
            <Label htmlFor="portal-name">Name</Label>
            <Input
              id="portal-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="South road"
            />
          </div>
          <div className={fieldClass}>
            <Label htmlFor="portal-facing">Facing</Label>
            <Select value={facing} onValueChange={(v) => setFacing(v as PortalFacing)}>
              <SelectTrigger id="portal-facing" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FACINGS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={() => onConfirm(name.trim(), facing)}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
