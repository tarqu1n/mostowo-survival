import { useState } from 'react';
import type { PortalFacing, PortalRect } from '../systems/mapFormat';

const FACINGS: PortalFacing[] = ['up', 'down', 'left', 'right'];

/**
 * Modal shown after a valid Portal-tool drag (mirrors `NewMapDialog`'s structure): collects a name +
 * facing, then the caller creates the `kind:'portal'` object. Facing defaults to whichever axis the
 * rect is longer on (a wide rect reads as a horizontal threshold → default 'down'; a tall rect reads
 * as a vertical one → default 'right'); a square rect defaults to 'down'.
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
    <div className="editor-modal-backdrop" onClick={onCancel}>
      <div className="editor-modal" onClick={(e) => e.stopPropagation()}>
        <h3>New portal</h3>
        <p className="editor-placeholder">
          Rect: col {rect.col}, row {rect.row}, {rect.w}×{rect.h}
        </p>
        <label>
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="South road"
          />
        </label>
        <label>
          Facing
          <select value={facing} onChange={(e) => setFacing(e.target.value as PortalFacing)}>
            {FACINGS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <div className="editor-modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button disabled={!valid} onClick={() => onConfirm(name.trim(), facing)}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
