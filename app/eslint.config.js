import js from '@eslint/js';
import themeTokens from './eslint-rules/theme-tokens.js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import { readdirSync } from 'node:fs';
import tseslint from 'typescript-eslint';

// A layer, as both spellings an import can name it by.
//
// The deep glob `**/artifacts/**` matches `../artifacts/ref` but not a bare
// `../artifacts` — and a layer with an `index.ts` is reached by exactly that bare
// form, so a rule written with only the deep pattern leaves the front door open.
function layer(...names) {
  return names.flatMap((name) => [`**/${name}`, `**/${name}/**`]);
}

// Exact relative spellings avoid treating `ui/theme/metrics` and third-party
// package subpaths as imports of the retired top-level directories.
function relativeLayer(...names) {
  const prefixes = ['..', '../..', '../../..', '../../../..', '../../../../..'];
  return names.flatMap((name) =>
    prefixes.flatMap((prefix) => [`${prefix}/${name}`, `${prefix}/${name}/**`]),
  );
}

/**
 * Restrictions that hold in every source file.
 *
 * Repeated into each block below because flat config replaces a rule's options
 * instead of merging them. The retired layers must stay unreachable so the
 * former architecture cannot grow back beside the Location-first application.
 */
const EVERYWHERE = [
  {
    group: layer('application', 'features', 'repositories', 'contracts', 'domain', 'kernels'),
    message: 'This layer was retired; use location, artifacts, panels, layouts, or session.',
  },
  {
    group: relativeLayer('metrics', 'components'),
    message: 'This layer was retired; use src/ui or src/panels.',
  },
];

/**
 * The layers a panel may not reach, as one shared pattern entry.
 *
 * Hoisted because it has to appear in two configuration objects below. Flat
 * config *replaces* a rule's options rather than merging them: when two blocks
 * both set `no-restricted-imports` for the same file, the later one wins
 * outright and the earlier one's patterns are gone with no diagnostic. The two
 * blocks are written so no file matches both, and both carry this entry.
 */
const PANEL_MAY_NOT_REACH = {
  // `layouts` is on the list for a different reason than the rest: it is not a
  // layer being replaced but the one directly above, and a panel that imported
  // the arrangement it appears in would close the loop the registry exists to
  // keep open.
  group: layer('app', 'layouts'),
  message:
    'A panel reads through src/artifacts and src/location; it may not reach its layout or app.',
};

/**
 * The panels that exist, read from disk rather than listed.
 *
 * A hand-kept list gets the direction of failure wrong: the panel someone
 * forgot to add is the one nobody may import, so the rule quietly stops
 * covering exactly the newest code. Reading the directory means a panel is
 * covered the moment it is created.
 */
const PANEL_DIRECTORIES = readdirSync(new URL('./src/panels', import.meta.url), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

// `panels/shared` is the explicit common display layer from new-design.md.
// Concrete panels may import it; it may not import any concrete panel.
const PANEL_SIBLING_DIRECTORIES = PANEL_DIRECTORIES.filter((name) => name !== 'shared');

/**
 * A panel's own directory, as named from outside `src/panels`.
 *
 * Separate from `layer('panels')` because the shared files directly under
 * `src/panels` — the registry, the panel contract — are public: a layout is
 * supposed to import those, and only those.
 */
const PANEL_INTERIORS = PANEL_DIRECTORIES.flatMap((name) => layer(`panels/${name}`));

/**
 * Every spelling a panel could reach a sibling by.
 *
 * This build has no path alias, so a cross-panel import is relative — `../run/x`
 * from a panel's own directory, `../../../run/x` from three levels down — and
 * none of those forms contains `panels/`, so `PANEL_INTERIORS` cannot see them.
 * The bare directory name does: a deep glob on `run` matches an import string
 * with a `run/` segment at any depth, which is every relative spelling at once
 * rather than the two or three someone thought to enumerate.
 */
const NO_SIBLING_PANELS = {
  group: PANEL_SIBLING_DIRECTORIES.flatMap((name) => layer(name)),
  message:
    'A panel may not import another panel. Share through src/artifacts, or lift what is common into src/panels.',
};

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
      'no-restricted-imports': ['error', { patterns: EVERYWHERE }],
    },
  },
  {
    // `location` is the base of the dependency order: everything may depend on
    // it and it may depend on nothing in `src`. The rule restricts the `../**`
    // import spelling, which is how that boundary would actually be crossed.
    files: ['src/location/**/*.ts', 'src/location/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...EVERYWHERE,
            {
              group: ['../**'],
              message: 'src/location may not import from the rest of src.',
            },
          ],
        },
      ],
    },
  },
  {
    // `ui` is the one layer with nothing to do with the product: cards, charts,
    // a theme and a number formatter, none of which know what a run or a panel
    // is. That is the whole property, and it is the property that decays first —
    // a control reaches for a store to save a prop, and the layer is business
    // code under a neutral name.
    //
    // Written as the list of layers it may not reach rather than `../**`,
    // because `ui/controls` legitimately imports `../charts` and `../theme`:
    // `../**` would ban the layer's own interior. `location` is on the list —
    // `ui` is below even that, since a `Location` is already a product idea.
    files: ['src/ui/**/*.ts', 'src/ui/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...EVERYWHERE,
            {
              group: layer(
                'app',
                'layouts',
                'session',
                'panels',
                'artifacts',
                'location',
                'features',
                'application',
                'repositories',
                'contracts',
                'domain',
                'kernels',
              ),
              message: 'src/ui knows nothing about the product; it may import only from src/ui.',
            },
            {
              // `metrics` and `components` cannot go through `layer()` like the
              // rest: those globs are unanchored, so `**/metrics` also matches
              // this layer's own `ui/theme/metrics` and `**/components` matches
              // the package path `echarts/components`. Naming the relative
              // spellings that actually leave `src/ui` separates them — a
              // sibling hop stays inside, a hop out of the layer does not.
              group: [
                '../metrics',
                '../metrics/**',
                '../../metrics',
                '../../metrics/**',
                '../components',
                '../components/**',
                '../../components',
                '../../components/**',
              ],
              message: 'src/ui knows nothing about the product; it may import only from src/ui.',
            },
          ],
        },
      ],
    },
  },
  {
    // `artifacts` sits one level above `location` and below everything else.
    // It may read a `Location`; it may not know that panels, layouts, sessions,
    // features, or the old repository layer exist. Listing the layers it must
    // not reach (rather than `../**`, which would also ban `../location`)
    // states the order directly.
    files: ['src/artifacts/**/*.ts', 'src/artifacts/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...EVERYWHERE,
            {
              group: layer(
                'app',
                'layouts',
                'session',
                'panels',
                'features',
                'application',
                'repositories',
                'ui',
                'components',
                'pages',
              ),
              message: 'src/artifacts may depend only on src/location.',
            },
          ],
        },
      ],
    },
  },
  {
    // `session` is the conversation backend, and sits beside `artifacts` rather
    // than above it: both read an address, neither reads the other. It renders
    // nothing, so everything from `panels` upwards is out of reach — a session
    // that knew which panel was showing would be a session per panel.
    files: ['src/session/**/*.ts', 'src/session/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...EVERYWHERE,
            {
              group: layer(
                'app',
                'layouts',
                'panels',
                'artifacts',
                'features',
                'application',
                'repositories',
                'ui',
                'components',
                'pages',
              ),
              message: 'src/session may depend only on src/location.',
            },
          ],
        },
      ],
    },
  },
  {
    // A layout arranges panels by name. It reads the registry and the address;
    // it does not reach inside a panel, or the arrangement would depend on what
    // the panels happen to be made of.
    files: ['src/layouts/**/*.ts', 'src/layouts/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...EVERYWHERE,
            {
              group: [
                ...layer('app', 'features', 'application', 'repositories'),
                ...PANEL_INTERIORS,
              ],
              message:
                'A layout names panels through src/panels/registry; it may not import a panel.',
            },
          ],
        },
      ],
    },
  },
  {
    // A panel reads its address and its artifacts, and renders. Reaching the
    // app or layout layer is how a panel stops being independently addressable.
    //
    // This half is the shared files directly under `src/panels`: the registry,
    // the panel contract, the read-problem card. They are not panels and have
    // no siblings to import.
    files: ['src/panels/*.ts', 'src/panels/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...EVERYWHERE, PANEL_MAY_NOT_REACH] }],
    },
  },
  {
    // Inside a panel's own directory the layer rule still applies — restated
    // rather than inherited, for the reason given at `PANEL_MAY_NOT_REACH` —
    // and one more holds: no panel imports another. Sharing goes down through
    // `src/artifacts`, or up into `src/panels`, never sideways.
    files: ['src/panels/*/**/*.ts', 'src/panels/*/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...EVERYWHERE, PANEL_MAY_NOT_REACH, NO_SIBLING_PANELS] },
      ],
    },
  },
  {
    // This file included: it reads `src/panels` off disk at configuration time,
    // which needs `URL` and `import.meta` — Node globals, not browser ones.
    files: ['*.js', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/ui/theme/**', 'src/**/*.test.{ts,tsx}', 'src/test/**'],
    plugins: { local: { rules: { 'theme-tokens': themeTokens } } },
    rules: { 'local/theme-tokens': 'error' },
  },
  prettier,
);
