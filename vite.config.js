import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Development and preview deliberately share one stable origin/storage.
// Refuse a busy port instead of silently opening a different, empty database.
export default defineConfig(({ mode }) => ({
  plugins: [react(), mode === 'single' && viteSingleFile({ useRecommendedBuildConfig: false })].filter(Boolean),
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true, fs: { strict: true, allow: [fileURLToPath(new URL('.', import.meta.url))] } },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: mode === 'single' ? {
    outDir: 'dist-single',
    emptyOutDir: false,
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: () => true,
    modulePreload: false,
    copyPublicDir: false,
    rolldownOptions: { output: { codeSplitting: false } },
    chunkSizeWarningLimit: 10000,
  } : { outDir: 'dist', sourcemap: true },
}));
