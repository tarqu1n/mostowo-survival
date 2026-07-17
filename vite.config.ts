import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { editorApiPlugin } from './scripts/vite-editor-api.mjs';

// GitHub Pages serves a project site under /<repo>/, so assets must resolve there in production.
// Locally (dev/preview) we want '/'. Override with BASE_PATH env if the repo/host path changes.
const base =
  process.env.BASE_PATH ?? (process.env.NODE_ENV === 'production' ? '/mostowo-survival/' : '/');

export default defineConfig(({ command }) => ({
  base,
  resolve: {
    // `@/*` → `src/*`. Must stay in sync with tsconfig.json and vitest.config.ts.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    // Explicit so the dev-only editor page (editor.html, plan 014) can never sneak into the prod
    // bundle — only the game entry ships.
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    // Hosts the dev server will answer to, beyond the always-allowed localhost/IP. Vite's
    // dev-server host check (a DNS-rebinding guard) otherwise returns "Blocked request." for an
    // unknown Host header — which is exactly what a reverse proxy in front of the editor sends.
    // Off (undefined) for normal desktop dev; set `EDITOR_ALLOWED_HOSTS` (comma-separated) when
    // fronting the editor with a proxy — e.g. running it on guppi behind `tailscale serve`, where
    // the phone hits `https://<host>.ts.net:<port>` and the Host header is that MagicDNS name.
    // See docs/MOBILE-EDITOR-ACCESS.md.
    allowedHosts: process.env.EDITOR_ALLOWED_HOSTS
      ? process.env.EDITOR_ALLOWED_HOSTS.split(',')
          .map((h) => h.trim())
          .filter(Boolean)
      : undefined,
    watch: {
      // The Map Builder editor (dev-only) writes these on Save: map/world/nodes JSON + the
      // regenerated manifest.json (`scripts/vite-editor-api.mjs`), the thumbnail PNGs, and captured
      // reference underlays. `manifest.json`/`world.json`/`*.map.json` are all in the game page's
      // module graph (`src/systems/mapRuntime.ts`), so writing one makes Vite broadcast a
      // full-reload to EVERY connected client — including the editor tab, which then snaps back to
      // its onload state mid-save (the save itself still lands on disk). Ignoring these paths in the
      // watcher stops that spurious reload; a real content change is picked up on the next explicit
      // reload / dev-server restart, which is the editor's workflow anyway.
      //
      // The asset pipeline (Object Editor "reclassify" / Regions editor "Apply", via
      // `/__editor/asset-override` + `/__editor/asset-regions`) rewrites the pack manifests and
      // regenerates `public/assets/asset-catalog.json`. Those live under `public/`, and Vite
      // force-reloads on ANY `public/` change (not just module-graph files) — same spurious reload.
      // Safe to ignore too: the editor already refetches `asset-catalog.json` with a cache-buster
      // after every Apply (`src/editor/catalogSource.ts`), so it never needed the reload.
      ignored: [
        '**/src/data/maps/**',
        '**/public/assets/maps/thumbs/**',
        '**/public/assets/tilesets/**',
        '**/public/assets/asset-catalog.json',
        '**/scripts/map-reference/out/**',
      ],
    },
  },
  plugins: [
    react(),
    // Tailwind v4 (editor-only). Only src/editor/editor.css does `@import "tailwindcss"`, and only
    // editor.html imports that CSS — so the game page (index.html) never receives Tailwind preflight.
    tailwindcss(),
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
