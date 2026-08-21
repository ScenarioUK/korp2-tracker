import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The SPA lives in ui/ and builds into dist/ui, which src/http/spa.ts serves as
 * static files from the same Express app — one container, one origin.
 *
 * `npm run dev:ui` runs Vite's dev server and proxies /api to the Express
 * process on 3000, so the token flow behaves the same in dev as in production.
 */
export default defineConfig({
  root: 'ui',
  plugins: [react()],
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': { target: `http://localhost:${process.env.PORT ?? 3000}`, changeOrigin: false },
    },
  },
});
