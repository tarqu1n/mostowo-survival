import { defineConfig } from 'vite';

// GitHub Pages serves a project site under /<repo>/, so assets must resolve there in production.
// Locally (dev/preview) we want '/'. Override with BASE_PATH env if the repo/host path changes.
const base = process.env.BASE_PATH ?? (process.env.NODE_ENV === 'production' ? '/Mostowa-survival/' : '/');

export default defineConfig({
  base,
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
