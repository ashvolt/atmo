import { defineConfig } from 'vitest/config';

/*
 * GitHub Pages serves a project site from a subpath (/atmo/), not the root, so
 * the production build needs a matching base. Every asset the app fetches at
 * runtime goes through import.meta.env.BASE_URL (see src/app/data.ts), so this
 * one setting moves the grids, textures and places index with it. The dev
 * server stays at / to keep local URLs short.
 *
 * Override with ATMO_BASE when deploying somewhere else, e.g. a custom domain
 * at the root: ATMO_BASE=/ npx vite build
 */
export default defineConfig(({ command }) => ({
  base: process.env.ATMO_BASE ?? (command === 'build' ? '/atmo/' : '/'),
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120000 },
}));
