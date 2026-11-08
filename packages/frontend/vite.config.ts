import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  // the repo's `.env`: only VITE_* reach the client (VITE_PUBLIC_ORIGIN, D-180)
  envDir: '../..',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true, // все интерфейсы: нужно для доступа с роутера (KeenDNS)
    allowedHosts: ['erp.spoki.keenetic.pro'],
    // API_PROXY: the API address in docker-compose.app.dev.yml (http://api:3000, D-197)
    proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:3000' },
    fs: { allow: ['../..'] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The vendor chunk holds HeroUI, React Aria and AG Grid (about 1.5 MB); it is loaded once and cached.
    chunkSizeWarningLimit: 1700,
    rolldownOptions: {
      output: {
        // react and react-dom are never put into a chunk of their own (React 19 fails at load when they are split);
        // the heavy libraries share one vendor chunk, everything else stays in the entry and the lazy chunks.
        codeSplitting: {
          groups: [
            {
              name: 'vendor',
              test: /node_modules[\\/](@heroui|react-aria|react-aria-components|react-stately|@react-aria|@react-stately|@react-types|@internationalized|ag-grid-community|ag-grid-react|@tanstack|tailwind-variants|tailwind-merge)/,
            },
          ],
        },
      },
    },
  },
});
