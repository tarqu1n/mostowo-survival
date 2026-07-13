import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './editor.css';

/**
 * Map Builder — dev-only editor entry (plan 014 step 4). `editor.html` → this file, a second Vite
 * page never present in the prod build (`vite.config.ts` pins `build.rollupOptions.input` to
 * `index.html` only). Just the three-pane shell for now: Library (left), Phaser viewport (centre,
 * step 5), Inspector/Layers (right). No game/Phaser code imported here — the editor's Phaser
 * viewport and the zustand store land in step 5; the save API this step wires up lives in
 * `src/editor/api.ts` / `scripts/vite-editor-api.mjs`.
 */
function EditorShell() {
  return (
    <div className="editor-shell">
      <aside className="editor-pane editor-pane--library">
        <h2>Library</h2>
        <p className="editor-placeholder">Asset library — coming in step 6.</p>
      </aside>
      <main className="editor-pane editor-pane--viewport">
        <div className="editor-viewport-placeholder pixelated">Viewport — coming in step 5.</div>
      </main>
      <aside className="editor-pane editor-pane--inspector">
        <h2>Inspector / Layers</h2>
        <p className="editor-placeholder">Inspector + layers — coming in steps 5-8.</p>
      </aside>
    </div>
  );
}

const container = document.getElementById('editor-root');
if (!container) throw new Error('editor.html is missing #editor-root');

createRoot(container).render(
  <StrictMode>
    <EditorShell />
  </StrictMode>,
);
