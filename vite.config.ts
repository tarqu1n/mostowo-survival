import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { editorApiPlugin } from './scripts/vite-editor-api.mjs';

// GitHub Pages serves a project site under /<repo>/, so assets must resolve there in production.
// Locally (dev/preview) we want '/'. Override with BASE_PATH env if the repo/host path changes.
const base =
  process.env.BASE_PATH ?? (process.env.NODE_ENV === 'production' ? '/mostowo-survival/' : '/');

export default defineConfig(({ command }) => ({
  base,
  build: {
    target: 'es2020',
    sourcemap: true,
    // Explicit so the dev-only editor page (editor.html, plan 014) can never sneak into the prod
    // bundle — only the game entry ships.
    rollupOptions: {
      input: 'index.html',
    },
  },
  plugins: [
    react(),
    // Map Builder editor save API (`/__editor/...`) — dev-server only; harmless to instantiate
    // during a build since it only implements `configureServer` (never invoked outside `vite dev`),
    // but gated here anyway to keep intent explicit.
    ...(command === 'serve' ? [editorApiPlugin()] : []),
  ],
  // Pre-bundle the heavy deps at server startup instead of discovering them lazily on the first
  // request. With a cold `.vite/deps` cache the optimizer otherwise re-bundles *after* clients have
  // connected and fires a full page reload ("[vite] page reload …"); under parallel e2e workers that
  // reload wipes a mid-boot page and was one path into the "boot-timeout" flake (the harness's tap
  // race in tests/e2e/harness.ts was the other). Declaring them up front makes optimization
  // deterministic → no cold-start reload. Also speeds first `vite dev` boot on the mobile workflow.
  optimizeDeps: {
    include: ['phaser', 'eventemitter3'],
  },
}));
