/**
 * Canonical list of the Map Builder's keyboard + mouse shortcuts — the SINGLE SOURCE OF TRUTH the
 * in-editor Shortcuts panel (`ShortcutsDialog.tsx`, opened from the toolbar's "⌨ Keys" button)
 * renders from.
 *
 * ⚠️ MAINTENANCE RULE: this list is documentation, not behaviour — nothing here wires a key to an
 * action. Whenever you ADD, REMOVE, or CHANGE a real shortcut, update this file in the same change.
 * The shortcuts are actually handled in two places:
 *   - `EditorApp.tsx`   — the window `keydown` handler (undo/redo, delete, arrow-nudge).
 *   - `EditorScene.ts`  — the Phaser input wiring (wheel-zoom, pan, and the pointer-tool modifiers:
 *                          Alt = free-pixel, Shift-click = multi-select, drag = move; plus the
 *                          Collision/Zone/Shape tools' Alt = paint-the-complement-value modifier).
 * Both sites carry a comment pointing back here. If the two ever drift, THIS file is the one that's
 * wrong — fix it to match the handlers.
 */

export interface Shortcut {
  /** One or more key/gesture alternatives, each rendered as a `<kbd>` and joined with "or"
   *  (e.g. `['Delete', 'Backspace']`). A combo stays one string (e.g. `'Ctrl/Cmd + Z'`). */
  keys: string[];
  /** What it does, in plain language. */
  action: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Selection & objects',
    shortcuts: [
      { keys: ['Click'], action: 'Select the object under the cursor (with the Select tool)' },
      { keys: ['Shift + Click'], action: 'Add/remove an object from the multi-selection' },
      { keys: ['Click + Drag'], action: 'Move the selected object(s)' },
      { keys: ['↑ ↓ ← →'], action: 'Nudge the selection 1px (decor) for fine positioning' },
      { keys: ['Shift + ↑ ↓ ← →'], action: 'Move the selection one whole tile' },
      { keys: ['Delete', 'Backspace'], action: 'Delete the selected object(s)' },
    ],
  },
  {
    title: 'Placement',
    shortcuts: [
      {
        keys: ['Alt (hold)'],
        action: 'Place/drag decor at free pixels, bypassing tile-centre snap',
      },
    ],
  },
  {
    title: 'Collision / Zones / Shape',
    shortcuts: [
      {
        keys: ['Drag'],
        action:
          'Collision: mark blocked · Zone: paint the active zone · Shape: carve void (the toolbar Brush/Rect/Fill buttons pick the gesture)',
      },
      {
        keys: ['Alt + Drag'],
        action:
          'Collision: clear to walkable · Zone: clear the cell’s zone · Shape: restore to inside',
      },
    ],
  },
  {
    title: 'Edit',
    shortcuts: [
      { keys: ['Ctrl/Cmd + Z'], action: 'Undo' },
      { keys: ['Shift + Ctrl/Cmd + Z'], action: 'Redo' },
    ],
  },
  {
    title: 'Camera',
    shortcuts: [
      { keys: ['Mouse wheel'], action: 'Zoom in / out (×1–×4)' },
      { keys: ['Middle-drag'], action: 'Pan the viewport' },
      { keys: ['Space + Drag'], action: 'Pan the viewport' },
      { keys: ['Pan tool + Drag'], action: 'Pan the viewport' },
    ],
  },
];
