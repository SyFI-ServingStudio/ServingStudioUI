import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built bundle works when served from any path (e.g. python -m http.server dist/)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const analyzerTarget = env.ANALYZER_PROXY_TARGET || 'http://127.0.0.1:8787';

  return {
    base: './',
    plugins: [react()],
    server: {
      host: true,
      port: 5177,
      strictPort: true,
      allowedHosts: true,
      // The browser remains same-origin; only Vite knows where the local Rust
      // service listens. ANALYZER_PROXY_TARGET can point at another dev host.
      proxy: { '/api': { target: analyzerTarget, changeOrigin: false } },
    },
    preview: { host: true, port: 8778, allowedHosts: true },
  };
});
