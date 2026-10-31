import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // все интерфейсы: нужно для доступа с роутера (KeenDNS)
    allowedHosts: ['erp.spoki.keenetic.pro'],
    proxy: { '/api': 'http://localhost:3000' },
    fs: { allow: ['../..'] },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
