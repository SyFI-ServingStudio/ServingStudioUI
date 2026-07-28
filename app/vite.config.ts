import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

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
    server: {
      host: serverHost,
      port: 5177,
      strictPort: true,
      allowedHosts,
      // The browser remains same-origin; only Vite knows where the local Rust
      // service listens. Rewriting Host lets the analyzer enforce its own
      // target-host allowlist instead of trusting the browser-facing hostname.
      proxy: {
        // The Rust Analyzer owns only its versioned, read-only artifact API.
        // Workspace, conversation, and managed-run state belong to the shared
        // conversation backend; explicit prefixes prevent accidental overlap.
        '/api/v1': { target: analyzerTarget, changeOrigin: true },
        '/api/workspaces': { target: conversationTarget, changeOrigin: true },
        '/api/agent': { target: conversationTarget, changeOrigin: true },
        '/api/internal': { target: conversationTarget, changeOrigin: true },
        '/api/eval': { target: conversationTarget, changeOrigin: true },
      },
    },
    preview: { host: serverHost, port: 8778, allowedHosts },
  };
});
