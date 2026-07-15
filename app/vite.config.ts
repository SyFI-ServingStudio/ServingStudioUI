import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built bundle works when served from any path (e.g. python -m http.server dist/)
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true, port: 5177, strictPort: true, allowedHosts: true },
  preview: { host: true, port: 8778, allowedHosts: true },
});
