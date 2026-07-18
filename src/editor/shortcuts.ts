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
 *                          Alt = free-pixel, Shift-click = multi-select, drag = move; the
 *                          Collision/Zone/Shape/Terrain tools' Alt = paint-the-complement-value
 *                          modifier; and the tile-paint tools' Alt = eyedropper-sample modifier).
 * Both sites carry a comment pointing back here. If the two ever drift, THIS file is the one that's
 * wrong — fix it to match the handlers.
 *
 * The 'Touch / compact shell' group documents the on-screen ContextBar equivalents shown only below
 * the compact breakpoint (`ContextBar.tsx`, `hooks/useIsCompact.ts`) — no new bindings, just how the
 * same actions above surface on a touch/coarse-pointer screen. Keep it in sync too.
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
      {
        keys: ['Drag over empty map'],
        action:
          'Select tool: draw a box around a whole AREA — every tile on every layer, plus any objects/nodes it encloses (walkability/zones/terrain move with it too)',
      },
      {
        keys: ['↑ ↓ ← →'],
        action:
          'With an area (box) selected: move the whole group one tile (also the on-screen ← ↑ ↓ → controls) — insert space between things without redoing them. Click empty map to clear the box.',
      },
      {
        keys: ['S'],
        action: "Cycle the selected node's skin to the next variant (node with ≥2 skins)",
      },
      {
        keys: ['Bring forward / Send back (buttons)'],
        action:
          "Nudge the selected decor or node's depth bias for same-row draw order (Inspector has a numeric field too)",
      },
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
    title: 'Tile painting',
    shortcuts: [
      {
        keys: ['R'],
        action:
          'Rotate the tile the Brush paints +90° (a rotated tile is a distinct palette entry)',
      },
      { keys: ['Shift + R'], action: 'Rotate the painted tile −90°' },
      {
        keys: ['Alt + Click'],
        action:
          'Eyedropper — sample the tile (or object) under the cursor and arm it: with a tile-paint tool active (Brush/Eraser/Fill/Rect), picks the topmost object → the active layer’s tile → any visible tile. (No Alt key? Use the “Pick” toolbar tool — a plain click/tap does the same, works on touch.)',
      },
    ],
  },
  {
    title: 'Collision / Zones / Shape / Terrain',
    shortcuts: [
      {
        keys: ['Drag'],
        action:
          'Collision: mark blocked · Zone: paint the active zone · Shape: carve void · Terrain: paint the armed terrain (the toolbar Brush/Rect/Fill buttons pick the gesture)',
      },
      {
        keys: ['Alt + Drag'],
        action:
          'Collision: clear to walkable · Zone: clear the cell’s zone · Shape: restore to inside · Terrain: erase the armed terrain',
      },
    ],
  },
  {
    title: 'Edit',
    shortcuts: [
      { keys: ['Ctrl/Cmd + Z'], action: 'Undo (works on both the Map and World tabs)' },
      { keys: ['Shift + Ctrl/Cmd + Z'], action: 'Redo (works on both the Map and World tabs)' },
    ],
  },
  {
    title: 'Reference underlay',
    shortcuts: [
      { keys: ['U'], action: 'Toggle the reference underlay’s visibility (Map tab only)' },
    ],
  },
  {
    title: 'World view',
    shortcuts: [
      {
        keys: ['Drag from tray'],
        action: 'Place an unplaced map onto the world grid (snaps to whole tiles)',
      },
      { keys: ['Drag a placed map'], action: 'Reposition it (snaps to whole tiles)' },
      { keys: ['✕ on a map'], action: 'Remove it from the world (back to the unplaced tray)' },
      { keys: ['Mouse wheel'], action: 'Zoom the world grid' },
      { keys: ['Drag empty grid', 'Middle-drag'], action: 'Pan the world grid' },
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
  {
    // Compact/touch shell (plan 027). These aren't new bindings — every entry above still works
    // exactly as listed; this group documents the on-screen equivalents that appear ONLY below the
    // compact breakpoint (`useIsCompact`), where a mouse/keyboard may not be available.
    title: 'Touch / compact shell',
    shortcuts: [
      {
        keys: ['1 finger'],
        action: 'Paint/place with the active tool — same as Click + Drag above',
      },
      {
        keys: ['2 fingers'],
        action:
          'Map viewport: pan by midpoint + pinch-zoom (×1–4, snapped). World tab: pinch-zoom about the midpoint only (no two-finger pan there)',
      },
      {
        keys: ['Context bar (bottom)'],
        action:
          'Per-tool on-screen bar mirroring the keyboard vocabulary: Undo/Redo always; brush rotate ∓90°; erase/invert toggle for Collision/Zone/Shape/Terrain (mirrors Alt + Drag); free-pixel toggle for Place/Select (mirrors Alt hold); multi-select toggle (mirrors Shift + Click) + Delete + 4-way nudge for Select; a drawn area (box) gets its own 4-way whole-tile nudge (moves tiles + objects together); underlay toggle (mirrors U); skin-cycle (mirrors S) when one node is selected',
      },
      {
        keys: ['Drag from tray'],
        action:
          'Placing a map onto the World grid stays desktop-only — the compact tray drawer is view-only on touch',
      },
    ],
  },
];
