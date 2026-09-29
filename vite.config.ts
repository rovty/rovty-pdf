import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Preserve HarfBuzz's module-relative WASM URL and asynchronous initialization.
  optimizeDeps: { include: ['@embedpdf/pdfium'], exclude: ['harfbuzzjs'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, manifest: true },
  worker: { format: 'es' },
  server: { strictPort: true },
});
