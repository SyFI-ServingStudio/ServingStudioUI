import js from '@eslint/js';
import themeTokens from './eslint-rules/theme-tokens.js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'public/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // `value == null` is the one intentional coercive comparison: it covers
      // both absent states without weakening comparisons between real values.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'react/prop-types': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Every feature except `worker`: reach a feature only through its
              // index.ts so a stage cannot quietly become a shared bucket that
              // its siblings deep-import. Bare directory names (not
              // `**/features/<name>/*`) so a sibling writing `../cluster/X` is
              // caught too — that spelling is how the shared-bucket drift
              // started. `worker` is deliberately absent: App.tsx imports single
              // modules out of it precisely to keep the lazy
              // cost-tree chunk off the eager entry path, and its barrel would
              // drag that chunk back in.
              group: [
                '**/cluster/*',
                '**/kernel/*',
                '**/optimality/*',
                '**/pool/*',
                '**/run-overview/*',
                '**/system-map/*',
                '**/timeline/*',
                '**/trace/*',
              ],
              message: 'Import this feature through its public index.ts entry.',
            },
            {
              // The shared metric-chart layer is a layer, not a feature: it has
              // one public surface and no stage-specific internals.
              group: ['**/metrics/*'],
              message: 'Import the shared metric layer through src/metrics/index.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['vite.config.ts', 'vitest.config.ts', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // These context modules intentionally export a Provider and its matching
    // hook. Split them only when feature boundaries, not hot reload, demand it.
    files: ['src/application/*Provider.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/theme.ts', 'src/theme/**', 'src/**/*.test.{ts,tsx}', 'src/test/**'],
    plugins: { local: { rules: { 'theme-tokens': themeTokens } } },
    rules: { 'local/theme-tokens': 'error' },
  },
  prettier,
);
