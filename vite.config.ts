import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import playgamaBridge from '@playgama/bridge/vite';

// Relative base so the build works when hosted in a subdirectory (portals, itch.io, Playgama).
export default defineConfig({
  base: './',
  plugins: [react(), playgamaBridge({ mode: 'local' })],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], react: ['react', 'react-dom'] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
