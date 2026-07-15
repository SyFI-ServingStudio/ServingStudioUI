# Chart Platform Hardening

## Summary

- Centralized the ECharts token projection, registered theme, tooltip policy,
  grid/axis primitives, and continuous cursor marker in `charts/platform.ts`.
- Forced every popup tooltip to canvas `richText` mode and replaced custom HTML
  formatter output with newline-delimited plain text.
- Neutralized HTML delimiters and zrender rich-text braces in analyzer-derived
  worker labels, kernel positions, backend names, and input-feature names before
  they reach series, legends, axes, or tooltips.
- Made `ChartCard` subscribe only to `openFocus`; its expand control is visible
  on keyboard focus and retains a high-contrast focus outline.

## Files

- `app/src/charts/platform.ts`: single chart-platform owner.
- `app/src/charts/{echartsRuntime,metricOption,options,overviewOptions}.ts`: theme
  registration and shared safe option primitives.
- `app/src/components/{EChart,ChartCard}.tsx`: registered-theme propagation and
  focused Zustand subscription/accessibility state.
- `app/src/charts/platform.test.ts`: malicious-label and tooltip-mode coverage.
- `app/src/components/{EChart,ChartCard}.test.tsx`: wrapper theme, keyboard
  visibility, focus payload, and unrelated-store-update regression coverage.

## Validation

- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings.
- `npm run format:check`: passed.
- `npm run test:unit`: 22 files, 164 tests passed.
- `npm run size`: passed. Initial JavaScript changed from 379.83 kB to
  380.26 kB gzip (+0.43 kB); all JavaScript chunks changed from 499.84 kB to
  500.28 kB gzip (+0.44 kB), both below their budgets.
- Production chart sources contain no HTML tooltip render mode, no zero-argument
  `useViz()` in `ChartCard`, and no `dangerouslySetInnerHTML`.

## Review

- Custom tooltip formatters intentionally omit ECharts' generated marker token:
  in rich-text mode that token is itself formatter markup. Series order and
  labels remain visible without accepting generated markup into the safe-text
  boundary.
- `CHART_THEME` remains re-exported from `options.ts` as a compatibility surface,
  but its only definition and the runtime registered theme live in
  `platform.ts`.
- Chart loading/empty/error props were not redesigned here. Doing so requires a
  shared discriminated state contract and broad call-site changes, which would
  exceed this bounded platform hardening and collide with feature refactors.

## Feedback

- Future option builders should use `richTextTooltip` and `safeChartText` for any
  external identity; direct tooltip object literals should be treated as a
  review failure.
- If chart status contracts are standardized later, prefer one discriminated
  `ChartState` prop over combinations of nullable `option`, `note`, and `empty`.
