import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The app owns one path segment on the AI Hub host: https://aihub.<domain>/naas/.
 * The load balancer forwards /naas/* here without rewriting it, so the
 * bundle is built for that prefix (`base`) and nginx serves it from
 * /usr/share/nginx/html/naas/.
 *
 * Every API call is a relative, same-origin path served by aihub-bff, never by
 * this app's container. In development, Vite serves the bundle on :5173 and
 * forwards `/auth`, `/api` and `/platform` to a local BFF on :8080 — the same
 * one the hub uses, run as described in README.md.
 */
const SLUG = 'naas';

const BFF_TARGET = process.env.BFF_ORIGIN ?? 'http://localhost:8080';

export default defineConfig({
  base: `/${SLUG}/`,
  plugins: [react()],
  // maplibre-gl ships a prebuilt worker that pre-bundling breaks. A no-op for
  // apps that do not depend on it.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/auth': { target: BFF_TARGET, changeOrigin: false },
      '/api': { target: BFF_TARGET, changeOrigin: false },
      '/platform': { target: BFF_TARGET, changeOrigin: false },
    },
  },
  // MapLibre spawns its worker with `{ type: 'module' }` (it only falls back to
  // a classic worker for a `.cjs` URL), so a worker bundle Vite emits for a
  // `?worker&url` import has to be ESM too — Vite's default here is 'iife'.
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
});
