import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

/**
 * The build of an emotion package that externalized dependencies load.
 *
 * Tests run Node with `--conditions development`, so MUI, left to Node,
 * requires emotion's development CommonJS build, while a test's own emotion
 * import is resolved for the browser: two instances, and a CacheProvider
 * (src/embed) that MUI never sees. Pointing the test's import at the file
 * Node loads makes them one. The browser build bundles one instance anyway.
 */
function nodeBuild(name: string, file: string): string {
  const path = join(dirname(require.resolve(`${name}/package.json`)), 'dist', file);
  if (!existsSync(path)) throw new Error(`${name} has no ${file}; update vitest.config.ts`);
  return path;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@emotion\/react$/,
        replacement: nodeBuild('@emotion/react', 'emotion-react.development.cjs.js'),
      },
      {
        find: /^@emotion\/cache$/,
        replacement: nodeBuild('@emotion/cache', 'emotion-cache.development.cjs.js'),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    // The suite loads bounded real JSON fixtures and finishes in a few seconds.
    // A single child process avoids the intermittent thread-pool shutdown race
    // that can fail CI after every assertion has already passed.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/vite-env.d.ts'],
    },
  },
});
