import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Node API runs on :8080; Vite proxies API and boundary data to it.
// In production `npm run build` writes web/dist, which the Node server serves directly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/data': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
