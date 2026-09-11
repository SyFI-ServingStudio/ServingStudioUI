import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

function commaSeparatedValues(value: string | undefined): string[] | undefined {
  const values = value
    ?.split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return values && values.length > 0 ? values : undefined;
}

// base './' so the built bundle works when served from any path (e.g. python -m http.server dist/)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const analyzerTarget = env.ANALYZER_PROXY_TARGET || 'http://127.0.0.1:8787';
  const conversationTarget = env.CONVERSATION_PROXY_TARGET || 'http://127.0.0.1:8765';
  const serverHost = env.VIBESIM_UI_HOST || '127.0.0.1';
  const allowedHosts = commaSeparatedValues(env.VIBESIM_UI_ALLOWED_HOSTS);

  return {
    base: './',
    plugins: [react()],
    build: {
      rollupOptions: {
        // The Location-first application is the single production entry.
        input: {
          main: fileURLToPath(new URL('index.html', import.meta.url)),
        },
      },
    },
    server: {
      host: serverHost,
      port: 5177,
      strictPort: true,
      allowedHosts,
      // The browser remains same-origin; only Vite knows where the local Rust
      // service listens. Rewriting Host lets the analyzer enforce its own
      // target-host allowlist instead of trusting the browser-facing hostname.
      // One entry per service, because each prefix now names the service that
      // owns it. The table used to list eight overlapping paths, which is what
      // happens when two services share a bare `/api/`: nothing about a route
      // said where it belonged, so every route had to be enumerated.
      proxy: {
        // The Rust Analyzer's versioned, read-only artifact API.
        '/api/analyzer/v1': { target: analyzerTarget, changeOrigin: true },
        // Its browser-profiling sink, deliberately outside the read-only
        // prefix above so a deployment can expose one without the other.
        '/api/dev': { target: analyzerTarget, changeOrigin: true },
        // The conversation backend: workspaces, conversations, jobs, files,
        // the token-gated `/tools/` surface other agents call, and the
        // `/internal/` callbacks managed runs post to.
        '/api/agent/v1': { target: conversationTarget, changeOrigin: true },
      },
    },
    preview: { host: serverHost, port: 8778, allowedHosts },
  };
});
